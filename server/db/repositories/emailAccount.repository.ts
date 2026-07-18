/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unified email account repository (Phase 4 + Phase 3.5 hardening).
 *
 * A single row per connected sender. Every query is workspace-scoped:
 * pass a workspaceId to any list/find/pick method to enforce isolation.
 * Passing no workspaceId is only allowed from internal jobs that already
 * know the account.id (SNS event handlers, direct BullMQ worker lookups).
 *
 * Encryption:
 *   - SMTP passwords + OAuth refresh/access tokens are stored AES-256-CBC.
 *   - The active encryption key id is tagged on every write for future
 *     rotation.
 */

import crypto from "crypto";
import { pool } from "../pool";
import { config } from "../../config";

export type ProviderKind = "ses" | "smtp" | "gmail_oauth" | "outlook_oauth";
export type ProviderCategory = "transactional" | "user_mailbox";

export interface EmailAccount {
  id: string;
  workspaceId: string;
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
  encryptionKeyId?: string;
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
    workspaceId: r.workspace_id || "",
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
    encryptionKeyId: r.encryption_key_id || undefined,
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
  workspaceId: string;
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
  async list(workspaceId?: string): Promise<EmailAccount[]> {
    if (workspaceId) {
      const r = await pool.query(
        "SELECT * FROM email_accounts WHERE workspace_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC",
        [workspaceId]
      );
      return r.rows.map(mapRow);
    }
    const r = await pool.query(
      "SELECT * FROM email_accounts WHERE deleted_at IS NULL ORDER BY created_at DESC"
    );
    return r.rows.map(mapRow);
  },

  async findById(id: string, workspaceId?: string): Promise<EmailAccount | null> {
    if (workspaceId) {
      const r = await pool.query(
        "SELECT * FROM email_accounts WHERE id = $1 AND workspace_id = $2",
        [id, workspaceId]
      );
      return r.rows[0] ? mapRow(r.rows[0]) : null;
    }
    const r = await pool.query("SELECT * FROM email_accounts WHERE id = $1", [id]);
    return r.rows[0] ? mapRow(r.rows[0]) : null;
  },

  async findByEmail(email: string, workspaceId?: string): Promise<EmailAccount | null> {
    if (workspaceId) {
      const r = await pool.query(
        "SELECT * FROM email_accounts WHERE LOWER(email) = LOWER($1) AND workspace_id = $2 AND deleted_at IS NULL",
        [email, workspaceId]
      );
      return r.rows[0] ? mapRow(r.rows[0]) : null;
    }
    const r = await pool.query(
      "SELECT * FROM email_accounts WHERE LOWER(email) = LOWER($1) AND deleted_at IS NULL",
      [email]
    );
    return r.rows[0] ? mapRow(r.rows[0]) : null;
  },

  async create(input: CreateEmailAccountInput): Promise<EmailAccount> {
    if (!input.workspaceId) throw new Error("emailAccountRepository.create requires workspaceId");
    const id = `acct-${Date.now()}-${crypto.randomUUID().split("-")[0]}`;
    const domain = input.email.split("@")[1] || null;
    const r = await pool.query(
      `INSERT INTO email_accounts
         (id, workspace_id, provider, provider_kind, email, display_name, from_domain, daily_send_limit,
          smtp_host, smtp_port, smtp_secure, smtp_username, smtp_password_encrypted,
          imap_host, imap_port, imap_secure, imap_username, encryption_key_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       RETURNING *`,
      [
        id,
        input.workspaceId,
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
        input.smtpPasswordEncrypted ? config.encryptionKeyId : null,
      ]
    );
    return mapRow(r.rows[0]);
  },

  async update(id: string, patch: EmailAccountPatch, workspaceId?: string): Promise<EmailAccount | null> {
    const sets: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    for (const [key, val] of Object.entries(patch)) {
      const col = patchColumnMap[key];
      if (!col || val === undefined) continue;
      if (val instanceof Date) { sets.push(`${col} = $${i++}`); values.push(val.toISOString()); }
      else { sets.push(`${col} = $${i++}`); values.push(val); }
    }
    // Retag encryption_key_id whenever we rewrite a secret.
    if (patch.smtpPasswordEncrypted !== undefined || patch.oauthAccessTokenEncrypted !== undefined || patch.oauthRefreshTokenEncrypted !== undefined) {
      sets.push(`encryption_key_id = $${i++}`);
      values.push(config.encryptionKeyId);
    }
    if (sets.length === 0) return this.findById(id, workspaceId);
    sets.push("updated_at = NOW()");
    values.push(id);
    const scope = workspaceId ? ` AND workspace_id = $${i + 1}` : "";
    if (workspaceId) values.push(workspaceId);
    const r = await pool.query(
      `UPDATE email_accounts SET ${sets.join(", ")} WHERE id = $${i} AND deleted_at IS NULL${scope} RETURNING *`,
      values
    );
    return r.rows[0] ? mapRow(r.rows[0]) : null;
  },

  async softDelete(id: string, workspaceId?: string): Promise<void> {
    if (workspaceId) {
      await pool.query(
        "UPDATE email_accounts SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1 AND workspace_id = $2",
        [id, workspaceId]
      );
    } else {
      await pool.query(
        "UPDATE email_accounts SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1",
        [id]
      );
    }
  },

  async listActiveHealthy(workspaceId?: string): Promise<EmailAccount[]> {
    if (workspaceId) {
      const r = await pool.query(
        `SELECT * FROM email_accounts
         WHERE deleted_at IS NULL AND is_active = TRUE AND is_healthy = TRUE
           AND workspace_id = $1
           AND (provider != 'ses' OR ses_verification_status = 'VERIFIED')`,
        [workspaceId]
      );
      return r.rows.map(mapRow);
    }
    const r = await pool.query(
      `SELECT * FROM email_accounts
       WHERE deleted_at IS NULL AND is_active = TRUE AND is_healthy = TRUE
         AND (provider != 'ses' OR ses_verification_status = 'VERIFIED')`
    );
    return r.rows.map(mapRow);
  },

  /**
   * Round-robin pick, workspace-scoped. Atomically decrements the per-day
   * quota so two workers cannot double-pick.
   */
  async pickRoundRobin(workspaceId?: string, accountIds?: string[]): Promise<EmailAccount | null> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE email_accounts
           SET sent_today = 0, sent_today_reset_on = CURRENT_DATE, updated_at = NOW()
         WHERE (sent_today_reset_on IS NULL OR sent_today_reset_on < CURRENT_DATE)
           AND deleted_at IS NULL`
      );
      const filters: string[] = [
        "deleted_at IS NULL",
        "is_active = TRUE",
        "is_healthy = TRUE",
        "(provider != 'ses' OR ses_verification_status = 'VERIFIED')",
        "sent_today < daily_send_limit",
        "reputation_score > 40",
      ];
      const params: unknown[] = [];
      let i = 1;
      if (workspaceId) { filters.push(`workspace_id = $${i++}`); params.push(workspaceId); }
      if (accountIds && accountIds.length > 0) { filters.push(`id = ANY($${i++})`); params.push(accountIds); }
      const r = await client.query(
        `SELECT * FROM email_accounts
         WHERE ${filters.join(" AND ")}
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

  async pickLeastUsed(workspaceId?: string, accountIds?: string[]): Promise<EmailAccount | null> {
    const filters: string[] = [
      "deleted_at IS NULL",
      "is_active = TRUE",
      "is_healthy = TRUE",
      "(provider != 'ses' OR ses_verification_status = 'VERIFIED')",
      "sent_today < daily_send_limit",
    ];
    const params: unknown[] = [];
    let i = 1;
    if (workspaceId) { filters.push(`workspace_id = $${i++}`); params.push(workspaceId); }
    if (accountIds && accountIds.length > 0) { filters.push(`id = ANY($${i++})`); params.push(accountIds); }
    const r = await pool.query(
      `SELECT * FROM email_accounts
       WHERE ${filters.join(" AND ")}
       ORDER BY (delivery_count + sent_today) ASC, last_used_at NULLS FIRST
       LIMIT 1`,
      params
    );
    if (!r.rows[0]) return null;
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
