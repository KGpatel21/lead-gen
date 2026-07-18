/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sender identities: verified SES emails / domains used by the send worker
 * on a round-robin schedule with per-identity daily caps and health tracking.
 */

import crypto from "crypto";
import { pool } from "../pool";

export type SesIdentityType = "EMAIL" | "DOMAIN";
export type SesVerificationStatus = "PENDING" | "VERIFIED" | "FAILED";

export interface SenderIdentity {
  id: string;
  email: string;
  displayName?: string;
  fromDomain?: string;
  sesIdentityType: SesIdentityType;
  sesVerificationStatus: SesVerificationStatus;
  dailySendLimit: number;
  sentToday: number;
  sentTodayResetOn?: string;
  reputationScore: number;
  bounceCount: number;
  complaintCount: number;
  deliveryCount: number;
  lastUsedAt?: string;
  isActive: boolean;
  isHealthy: boolean;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface CreateSenderIdentityInput {
  email: string;
  displayName?: string;
  sesIdentityType?: SesIdentityType;
  dailySendLimit?: number;
}

const iso = (v: unknown): string =>
  v instanceof Date ? v.toISOString() : v == null ? "" : String(v);

function mapRow(r: any): SenderIdentity {
  return {
    id: r.id,
    email: r.email,
    displayName: r.display_name || undefined,
    fromDomain: r.from_domain || undefined,
    sesIdentityType: r.ses_identity_type as SesIdentityType,
    sesVerificationStatus: r.ses_verification_status as SesVerificationStatus,
    dailySendLimit: r.daily_send_limit,
    sentToday: r.sent_today,
    sentTodayResetOn: r.sent_today_reset_on ? String(r.sent_today_reset_on) : undefined,
    reputationScore: Number(r.reputation_score),
    bounceCount: r.bounce_count,
    complaintCount: r.complaint_count,
    deliveryCount: r.delivery_count,
    lastUsedAt: r.last_used_at ? iso(r.last_used_at) : undefined,
    isActive: r.is_active,
    isHealthy: r.is_healthy,
    lastError: r.last_error || undefined,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
    deletedAt: r.deleted_at ? iso(r.deleted_at) : undefined,
  };
}

export const senderIdentityRepository = {
  async list(): Promise<SenderIdentity[]> {
    const r = await pool.query(
      "SELECT * FROM sender_identities WHERE deleted_at IS NULL ORDER BY created_at DESC"
    );
    return r.rows.map(mapRow);
  },

  async findById(id: string): Promise<SenderIdentity | null> {
    const r = await pool.query("SELECT * FROM sender_identities WHERE id = $1", [id]);
    return r.rows[0] ? mapRow(r.rows[0]) : null;
  },

  async findByEmail(email: string): Promise<SenderIdentity | null> {
    const r = await pool.query(
      "SELECT * FROM sender_identities WHERE LOWER(email) = LOWER($1) AND deleted_at IS NULL",
      [email]
    );
    return r.rows[0] ? mapRow(r.rows[0]) : null;
  },

  async create(input: CreateSenderIdentityInput): Promise<SenderIdentity> {
    const id = `sid-${Date.now()}-${crypto.randomUUID().split("-")[0]}`;
    const domain = input.email.split("@")[1] || null;
    const r = await pool.query(
      `INSERT INTO sender_identities (id, email, display_name, from_domain, ses_identity_type, daily_send_limit)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [
        id,
        input.email.trim().toLowerCase(),
        input.displayName || null,
        domain,
        input.sesIdentityType || "EMAIL",
        input.dailySendLimit ?? 200,
      ]
    );
    return mapRow(r.rows[0]);
  },

  async setVerificationStatus(id: string, status: SesVerificationStatus): Promise<void> {
    await pool.query(
      "UPDATE sender_identities SET ses_verification_status = $1, updated_at = NOW() WHERE id = $2",
      [status, id]
    );
  },

  async setActive(id: string, active: boolean): Promise<void> {
    await pool.query(
      "UPDATE sender_identities SET is_active = $1, updated_at = NOW() WHERE id = $2",
      [active, id]
    );
  },

  async softDelete(id: string): Promise<void> {
    await pool.query(
      "UPDATE sender_identities SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1",
      [id]
    );
  },

  /**
   * Return the next eligible sender for round-robin dispatch.
   * Eligibility (all AND):
   *   - active + healthy + not soft-deleted
   *   - verification status = VERIFIED
   *   - sent_today < daily_send_limit (with automatic daily reset)
   *   - reputation_score > 40
   * Order:
   *   - last_used_at NULLS FIRST (fair to new senders)
   *   - then oldest last_used_at
   *
   * Atomically increments `sent_today` and stamps `last_used_at` in the same
   * transaction so two concurrent workers never double-pick.
   */
  async pickNextForRotation(): Promise<SenderIdentity | null> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // Reset counters that rolled past midnight.
      await client.query(
        `UPDATE sender_identities
           SET sent_today = 0, sent_today_reset_on = CURRENT_DATE, updated_at = NOW()
         WHERE (sent_today_reset_on IS NULL OR sent_today_reset_on < CURRENT_DATE)
           AND deleted_at IS NULL`
      );
      const r = await client.query(
        `SELECT * FROM sender_identities
         WHERE deleted_at IS NULL
           AND is_active = TRUE
           AND is_healthy = TRUE
           AND ses_verification_status = 'VERIFIED'
           AND sent_today < daily_send_limit
           AND reputation_score > 40
         ORDER BY last_used_at NULLS FIRST, last_used_at ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED`
      );
      if (!r.rows[0]) {
        await client.query("ROLLBACK");
        return null;
      }
      const picked = mapRow(r.rows[0]);
      await client.query(
        `UPDATE sender_identities
           SET sent_today = sent_today + 1,
               last_used_at = NOW(),
               updated_at = NOW()
         WHERE id = $1`,
        [picked.id]
      );
      await client.query("COMMIT");
      picked.sentToday += 1;
      picked.lastUsedAt = new Date().toISOString();
      return picked;
    } catch (err) {
      try { await client.query("ROLLBACK"); } catch { /* ignore */ }
      throw err;
    } finally {
      client.release();
    }
  },

  async recordDelivery(id: string): Promise<void> {
    await pool.query(
      `UPDATE sender_identities
         SET delivery_count = delivery_count + 1,
             reputation_score = LEAST(100, reputation_score + 0.5),
             updated_at = NOW()
       WHERE id = $1`,
      [id]
    );
  },

  async recordBounce(id: string, permanent: boolean): Promise<void> {
    const delta = permanent ? -6 : -1;
    await pool.query(
      `UPDATE sender_identities
         SET bounce_count = bounce_count + 1,
             reputation_score = GREATEST(0, reputation_score + $1),
             is_healthy = CASE WHEN GREATEST(0, reputation_score + $1) < 40 THEN FALSE ELSE is_healthy END,
             updated_at = NOW()
       WHERE id = $2`,
      [delta, id]
    );
  },

  async recordComplaint(id: string): Promise<void> {
    await pool.query(
      `UPDATE sender_identities
         SET complaint_count = complaint_count + 1,
             reputation_score = GREATEST(0, reputation_score - 12),
             is_healthy = CASE WHEN reputation_score - 12 < 50 THEN FALSE ELSE is_healthy END,
             updated_at = NOW()
       WHERE id = $1`,
      [id]
    );
  },

  async recordFailure(id: string, errorMessage: string): Promise<void> {
    await pool.query(
      `UPDATE sender_identities
         SET reputation_score = GREATEST(0, reputation_score - 0.5),
             last_error = $1,
             updated_at = NOW()
       WHERE id = $2`,
      [errorMessage.slice(0, 500), id]
    );
  },
};
