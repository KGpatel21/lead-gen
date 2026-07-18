/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unified email account repository (Phase 4).
 *
 * A single row per connected sender. Rotating dispatch, health tracking,
 * and OAuth state all live here. Providers are transport-neutral: the row
 * carries either SMTP creds, OAuth tokens, or an SES verification status.
 */

import crypto from "crypto";
import { pool } from "../pool";

export type ProviderKind = "ses" | "smtp" | "gmail_oauth" | "outlook_oauth";
export type ProviderCategory = "transactional" | "user_mailbox";

export interface EmailAccount {
  id: string;
  provider: ProviderKind;
  providerKind: ProviderCategory;
  email: string;
  displayName?: string;
  fromDomain?: string;
  sesVerificationStatus: "PENDING" | "VERIFIED" | "FAILED";
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure?: boolean;
  smtpUsername?: string;
  smtpPasswordEncrypted?: string;
  oauthProviderUserId?: string;
  oauthScopes?: string;
  oauthAccessTokenEncrypted?: string;
  oauthRefreshTokenEncrypted?: string;
  oauthAccessTokenExpiresAt?: string;
  imapHost?: string;
  imapPort?: number;
  imapSecure?: boolean;
  imapUsername?: string;
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
  warmupEnabled: boolean;
  warmupStatus?: string;
  lastSyncAt?: string;
  lastProviderLatencyMs?: number;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

const iso = (v: unknown): string =>
  v instanceof Date ? v.toISOString() : v == null ? "" : String(v);

function mapRow(r: any): EmailAccount {
  return {
    id: r.id,
    provider: (r.provider || "ses") as ProviderKind,
    providerKind: (r.provider_kind || "transactional") as ProviderCategory,
    email: r.email,
    displayName: r.display_name || undefined,
    fromDomain: r.from_domain || undefined,
    sesVerificationStatus: r.ses_verification_status as EmailAccount["sesVerificationStatus"],
    smtpHost: r.smtp_host || undefined,
    smtpPort: r.smtp_port == null ? undefined : Number(r.smtp_port),
    smtpSecure: r.smtp_secure == null ? undefined : Boolean(r.smtp_secure),
    smtpUsername: r.smtp_username || undefined,
    smtpPasswordEncrypted: r.smtp_password_encrypted || undefined,
    oauthProviderUserId: r.oauth_provider_user_id || undefined,
    oauthScopes: r.oauth_scopes || undefined,
    oauthAccessTokenEncrypted: r.oauth_access_token_encrypted || undefined,
    oauthRefreshTokenEncrypted: r.oauth_refresh_token_encrypted || undefined,
    oauthAccessTokenExpiresAt: r.oauth_access_token_expires_at ? iso(r.oauth_access_token_expires_at) : undefined,
    imapHost: r.imap_host || undefined,
    imapPort: r.imap_port == null ? undefined : Number(r.imap_port),
    imapSecure: r.imap_secure == null ? undefined : Boolean(r.imap_secure),
    imapUsername: r.imap_username || undefined,
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
    warmupEnabled: !!r.warmup_enabled,
    warmupStatus: r.warmup_status || undefined,
    lastSyncAt: r.last_sync_at ? iso(r.last_sync_at) : undefined,
    lastProviderLatencyMs: r.last_provider_latency_ms == null ? undefined : Number(r.last_provider_latency_ms),
    lastError: r.last_error || undefined,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
    deletedAt: r.deleted_at ? iso(r.deleted_at) : undefined,
  };
}

/** Fields any provider can update on itself. */
export interface EmailAccountPatch {
  displayName?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure?: boolean;
  smtpUsername?: string;
  smtpPasswordEncrypted?: string;
  oauthProviderUserId?: string;
  oauthScopes?: string;
  oauthAccessTokenEncrypted?: string | null;
  oauthRefreshTokenEncrypted?: string | null;
  oauthAccessTokenExpiresAt?: Date | null;
  imapHost?: string;
  imapPort?: number;
  imapSecure?: boolean;
  imapUsername?: string;
  sesVerificationStatus?: EmailAccount["sesVerificationStatus"];
  dailySendLimit?: number;
  isActive?: boolean;
  isHealthy?: boolean;
  warmupEnabled?: boolean;
  warmupStatus?: string;
  lastProviderLatencyMs?: number;
}

const patchColumnMap: Record<string, string> = {
  displayName: "display_name",
  smtpHost: "smtp_host",
  smtpPort: "smtp_port",
  smtpSecure: "smtp_secure",
  smtpUsername: "smtp_username",
  smtpPasswordEncrypted: "smtp_password_encrypted",
  oauthProviderUserId: "oauth_provider_user_id",
  oauthScopes: "oauth_scopes",
  oauthAccessTokenEncrypted: "oauth_access_token_encrypted",
  oauthRefreshTokenEncrypted: "oauth_refresh_token_encrypted",
  oauthAccessTokenExpiresAt: "oauth_access_token_expires_at",
  imapHost: "imap_host",
  imapPort: "imap_port",
  imapSecure: "imap_secure",
  imapUsername: "imap_username",
  sesVerificationStatus: "ses_verification_status",
  dailySendLimit: "daily_send_limit",
  isActive: "is_active",
  isHealthy: "is_healthy",
  warmupEnabled: "warmup_enabled",
  warmupStatus: "warmup_status",
  lastProviderLatencyMs: "last_provider_latency_ms",
};

export interface CreateEmailAccountInput {
  provider: ProviderKind;
  providerKind?: ProviderCategory;
  email: string;
  displayName?: string;
  dailySendLimit?: number;
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure?: boolean;
  smtpUsername?: string;
  smtpPasswordEncrypted?: string;
  imapHost?: string;
  imapPort?: number;
  imapSecure?: boolean;
  imapUsername?: string;
}

export const emailAccountRepository = {
  async list(): Promise<EmailAccount[]> {
    const r = await pool.query(
      "SELECT * FROM email_accounts WHERE deleted_at IS NULL ORDER BY created_at DESC"
    );
    return r.rows.map(mapRow);
  },

  async findById(id: string): Promise<EmailAccount | null> {
    const r = await pool.query("SELECT * FROM email_accounts WHERE id = $1", [id]);
    return r.rows[0] ? mapRow(r.rows[0]) : null;
  },

  async findByEmail(email: string): Promise<EmailAccount | null> {
    const r = await pool.query(
      "SELECT * FROM email_accounts WHERE LOWER(email) = LOWER($1) AND deleted_at IS NULL",
      [email]
    );
    return r.rows[0] ? mapRow(r.rows[0]) : null;
  },

  async create(input: CreateEmailAccountInput): Promise<EmailAccount> {
    const id = `acct-${Date.now()}-${crypto.randomUUID().split("-")[0]}`;
    const domain = input.email.split("@")[1] || null;
    const r = await pool.query(
      `INSERT INTO email_accounts
         (id, provider, provider_kind, email, display_name, from_domain, daily_send_limit,
          smtp_host, smtp_port, smtp_secure, smtp_username, smtp_password_encrypted,
          imap_host, imap_port, imap_secure, imap_username)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING *`,
      [
        id,
        input.provider,
        input.providerKind || (input.provider === "ses" ? "transactional" : "user_mailbox"),
        input.email.trim().toLowerCase(),
        input.displayName || null,
        domain,
        input.dailySendLimit ?? 200,
        input.smtpHost || null,
        input.smtpPort ?? null,
        input.smtpSecure ?? null,
        input.smtpUsername || null,
        input.smtpPasswordEncrypted || null,
        input.imapHost || null,
        input.imapPort ?? null,
        input.imapSecure ?? null,
        input.imapUsername || null,
      ]
    );
    return mapRow(r.rows[0]);
  },

  async update(id: string, patch: EmailAccountPatch): Promise<EmailAccount | null> {
    const sets: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    for (const [key, val] of Object.entries(patch)) {
      const col = patchColumnMap[key];
      if (!col || val === undefined) continue;
      if (val instanceof Date) { sets.push(`${col} = $${i++}`); values.push(val.toISOString()); }
      else { sets.push(`${col} = $${i++}`); values.push(val); }
    }
    if (sets.length === 0) return this.findById(id);
    sets.push("updated_at = NOW()");
    values.push(id);
    const r = await pool.query(
      `UPDATE email_accounts SET ${sets.join(", ")} WHERE id = $${i} AND deleted_at IS NULL RETURNING *`,
      values
    );
    return r.rows[0] ? mapRow(r.rows[0]) : null;
  },

  async softDelete(id: string): Promise<void> {
    await pool.query(
      "UPDATE email_accounts SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1",
      [id]
    );
  },

  async listActiveHealthy(): Promise<EmailAccount[]> {
    const r = await pool.query(
      `SELECT * FROM email_accounts
       WHERE deleted_at IS NULL AND is_active = TRUE AND is_healthy = TRUE
         AND (provider != 'ses' OR ses_verification_status = 'VERIFIED')`
    );
    return r.rows.map(mapRow);
  },

  /**
   * Round-robin selection. Atomically decrements the per-day quota so two
   * workers cannot double-pick.
   */
  async pickRoundRobin(accountIds?: string[]): Promise<EmailAccount | null> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE email_accounts
           SET sent_today = 0, sent_today_reset_on = CURRENT_DATE, updated_at = NOW()
         WHERE (sent_today_reset_on IS NULL OR sent_today_reset_on < CURRENT_DATE)
           AND deleted_at IS NULL`
      );
      const wherePart = accountIds && accountIds.length > 0 ? "AND id = ANY($1)" : "";
      const params = accountIds && accountIds.length > 0 ? [accountIds] : [];
      const r = await client.query(
        `SELECT * FROM email_accounts
         WHERE deleted_at IS NULL
           AND is_active = TRUE
           AND is_healthy = TRUE
           AND (provider != 'ses' OR ses_verification_status = 'VERIFIED')
           AND sent_today < daily_send_limit
           AND reputation_score > 40
           ${wherePart}
         ORDER BY last_used_at NULLS FIRST, last_used_at ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED`,
        params
      );
      if (!r.rows[0]) { await client.query("ROLLBACK"); return null; }
      const picked = mapRow(r.rows[0]);
      await client.query(
        `UPDATE email_accounts
           SET sent_today = sent_today + 1, last_used_at = NOW(), updated_at = NOW()
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

  /**
   * Least-used selection (by delivery_count + sent_today).
   */
  async pickLeastUsed(accountIds?: string[]): Promise<EmailAccount | null> {
    const wherePart = accountIds && accountIds.length > 0 ? "AND id = ANY($1)" : "";
    const params = accountIds && accountIds.length > 0 ? [accountIds] : [];
    const r = await pool.query(
      `SELECT * FROM email_accounts
       WHERE deleted_at IS NULL AND is_active = TRUE AND is_healthy = TRUE
         AND (provider != 'ses' OR ses_verification_status = 'VERIFIED')
         AND sent_today < daily_send_limit
         ${wherePart}
       ORDER BY (delivery_count + sent_today) ASC, last_used_at NULLS FIRST
       LIMIT 1`,
      params
    );
    if (!r.rows[0]) return null;
    // Atomically bump sent_today.
    await pool.query(
      "UPDATE email_accounts SET sent_today = sent_today + 1, last_used_at = NOW(), updated_at = NOW() WHERE id = $1",
      [r.rows[0].id]
    );
    return mapRow(r.rows[0]);
  },

  async recordDelivery(id: string): Promise<void> {
    await pool.query(
      `UPDATE email_accounts
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
      `UPDATE email_accounts
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
      `UPDATE email_accounts
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
      `UPDATE email_accounts
         SET reputation_score = GREATEST(0, reputation_score - 0.5),
             last_error = $1,
             updated_at = NOW()
       WHERE id = $2`,
      [errorMessage.slice(0, 500), id]
    );
  },

  async recordProviderLatency(id: string, latencyMs: number): Promise<void> {
    await pool.query(
      "UPDATE email_accounts SET last_provider_latency_ms = $1, updated_at = NOW() WHERE id = $2",
      [latencyMs, id]
    );
  },
};
