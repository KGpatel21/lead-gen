/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Suppression list. Membership is permanent — every send-time check
 * consults this table. Populated by:
 *   - SNS bounce notifications (permanent bounces only)
 *   - SNS complaint notifications
 *   - User-triggered unsubscribe (/unsubscribe/:token)
 *   - Admin manual insert
 */

import crypto from "crypto";
import { pool } from "../pool";

export type SuppressionReason = "bounce" | "complaint" | "unsubscribe" | "manual";

export interface Suppression {
  id: string;
  email: string;
  reason: SuppressionReason;
  bounceType?: string;
  bounceSubtype?: string;
  source?: string;
  notes?: string;
  campaignId?: string;
  suppressedAt: string;
}

export interface AddSuppressionInput {
  email: string;
  reason: SuppressionReason;
  bounceType?: string;
  bounceSubtype?: string;
  source?: string;
  notes?: string;
  campaignId?: string;
}

const iso = (v: unknown): string =>
  v instanceof Date ? v.toISOString() : v == null ? "" : String(v);

function mapRow(r: any): Suppression {
  return {
    id: r.id,
    email: r.email,
    reason: r.reason as SuppressionReason,
    bounceType: r.bounce_type || undefined,
    bounceSubtype: r.bounce_subtype || undefined,
    source: r.source || undefined,
    notes: r.notes || undefined,
    campaignId: r.campaign_id || undefined,
    suppressedAt: iso(r.suppressed_at),
  };
}

export const suppressionRepository = {
  async isSuppressed(email: string): Promise<boolean> {
    const r = await pool.query(
      "SELECT 1 FROM email_suppressions WHERE LOWER(email) = LOWER($1) LIMIT 1",
      [email]
    );
    return r.rows.length > 0;
  },

  async findByEmail(email: string): Promise<Suppression | null> {
    const r = await pool.query(
      "SELECT * FROM email_suppressions WHERE LOWER(email) = LOWER($1) LIMIT 1",
      [email]
    );
    return r.rows[0] ? mapRow(r.rows[0]) : null;
  },

  async list(limit = 500): Promise<Suppression[]> {
    const r = await pool.query(
      "SELECT * FROM email_suppressions ORDER BY suppressed_at DESC LIMIT $1",
      [limit]
    );
    return r.rows.map(mapRow);
  },

  async add(input: AddSuppressionInput): Promise<Suppression> {
    const id = `supp-${Date.now()}-${crypto.randomUUID().split("-")[0]}`;
    const r = await pool.query(
      `INSERT INTO email_suppressions (id, email, reason, bounce_type, bounce_subtype, source, notes, campaign_id)
       VALUES ($1, LOWER($2), $3, $4, $5, $6, $7, $8)
       ON CONFLICT ((LOWER(email))) DO UPDATE SET
         reason = EXCLUDED.reason,
         bounce_type = COALESCE(EXCLUDED.bounce_type, email_suppressions.bounce_type),
         bounce_subtype = COALESCE(EXCLUDED.bounce_subtype, email_suppressions.bounce_subtype),
         source = COALESCE(EXCLUDED.source, email_suppressions.source),
         notes = COALESCE(EXCLUDED.notes, email_suppressions.notes),
         suppressed_at = NOW()
       RETURNING *`,
      [
        id,
        input.email,
        input.reason,
        input.bounceType || null,
        input.bounceSubtype || null,
        input.source || null,
        input.notes || null,
        input.campaignId || null,
      ]
    );
    return mapRow(r.rows[0]);
  },

  async remove(email: string): Promise<boolean> {
    const r = await pool.query(
      "DELETE FROM email_suppressions WHERE LOWER(email) = LOWER($1)",
      [email]
    );
    return (r.rowCount ?? 0) > 0;
  },
};
