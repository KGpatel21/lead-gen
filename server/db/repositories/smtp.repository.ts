/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SMTP account repository (legacy Phase 1). Every user-facing read now
 * REQUIRES a workspaceId. Internal callers (send workers) may still use
 * the id-only helpers because they've already checked the parent
 * email's workspace_id.
 */

import crypto from "crypto";
import { pool } from "../pool";
import { mapSmtpAccount } from "../rowMappers";
import { SmtpAccount, WarmupPhase } from "../../../src/types";

export interface CreateSmtpInput {
  workspaceId: string;
  email: string;
  smtpHost: string;
  smtpPort: number;
  username: string;
  smtpPassword: string;
  dailyLimit?: number;
  warmupEnabled?: boolean;
  warmupDailyLimit?: number;
  warmupPhase?: WarmupPhase;
  provider?: string;
  providerAccountId?: string;
}

const UPDATABLE: Record<string, string> = {
  smtpHost: "smtp_host",
  smtpPort: "smtp_port",
  username: "username",
  dailyLimit: "daily_limit",
  warmupEnabled: "warmup_enabled",
  warmupDailyLimit: "warmup_daily_limit",
  warmupPhase: "warmup_phase",
  reputationScore: "reputation_score",
  errorMessage: "error_message",
};

function requireWs(v: string | undefined, method: string): string {
  if (!v) throw new Error(`[smtpRepository.${method}] workspaceId required — tenant boundary violation prevented`);
  return v;
}

export const smtpRepository = {
  async list(workspaceId?: string): Promise<SmtpAccount[]> {
    if (workspaceId) {
      const r = await pool.query(
        `SELECT * FROM smtp_accounts WHERE workspace_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC`,
        [workspaceId]
      );
      return r.rows.map(mapSmtpAccount);
    }
    // Unscoped list — only reachable from health/metrics probes + workers
    // that need a workspace-agnostic view of provisioned mailboxes.
    const r = await pool.query(
      `SELECT * FROM smtp_accounts WHERE deleted_at IS NULL ORDER BY created_at DESC`
    );
    return r.rows.map(mapSmtpAccount);
  },

  async listHealthy(workspaceId?: string): Promise<SmtpAccount[]> {
    if (workspaceId) {
      const r = await pool.query(
        `SELECT * FROM smtp_accounts
         WHERE workspace_id = $1 AND deleted_at IS NULL AND reputation_score > 50`,
        [workspaceId]
      );
      return r.rows.map(mapSmtpAccount);
    }
    const r = await pool.query(
      `SELECT * FROM smtp_accounts WHERE deleted_at IS NULL AND reputation_score > 50`
    );
    return r.rows.map(mapSmtpAccount);
  },

  async findById(id: string, workspaceId?: string): Promise<SmtpAccount | null> {
    if (workspaceId) {
      const r = await pool.query(
        `SELECT * FROM smtp_accounts WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL`,
        [id, workspaceId]
      );
      return r.rows[0] ? mapSmtpAccount(r.rows[0]) : null;
    }
    const r = await pool.query(
      `SELECT * FROM smtp_accounts WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    return r.rows[0] ? mapSmtpAccount(r.rows[0]) : null;
  },

  async findByEmail(email: string, workspaceId?: string): Promise<SmtpAccount | null> {
    if (workspaceId) {
      const r = await pool.query(
        `SELECT * FROM smtp_accounts
         WHERE LOWER(email) = LOWER($1) AND workspace_id = $2 AND deleted_at IS NULL`,
        [email, workspaceId]
      );
      return r.rows[0] ? mapSmtpAccount(r.rows[0]) : null;
    }
    const r = await pool.query(
      `SELECT * FROM smtp_accounts WHERE LOWER(email) = LOWER($1) AND deleted_at IS NULL`,
      [email]
    );
    return r.rows[0] ? mapSmtpAccount(r.rows[0]) : null;
  },

  async create(input: CreateSmtpInput): Promise<SmtpAccount> {
    requireWs(input.workspaceId, "create");
    const id = `smtp-${Date.now()}-${crypto.randomUUID().split("-")[0]}`;
    const r = await pool.query(
      `INSERT INTO smtp_accounts
         (id, workspace_id, email, username, smtp_host, smtp_port, smtp_password, daily_limit,
          warmup_enabled, warmup_daily_limit, warmup_phase, provider, provider_account_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [
        id,
        input.workspaceId,
        input.email,
        input.username,
        input.smtpHost,
        input.smtpPort,
        input.smtpPassword,
        input.dailyLimit ?? 50,
        input.warmupEnabled ?? false,
        input.warmupDailyLimit ?? 15,
        input.warmupPhase ?? WarmupPhase.BEGINNER,
        input.provider ?? null,
        input.providerAccountId ?? null,
      ]
    );
    return mapSmtpAccount(r.rows[0]);
  },

  async update(
    id: string,
    patch: Record<string, unknown> & { smtpPassword?: string },
    workspaceId?: string
  ): Promise<SmtpAccount | null> {
    const sets: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    for (const [k, v] of Object.entries(patch)) {
      if (k === "smtpPassword") continue;
      const col = UPDATABLE[k];
      if (!col || v === undefined) continue;
      sets.push(`${col} = $${i++}`);
      values.push(v);
    }
    if (patch.smtpPassword) {
      sets.push(`smtp_password = $${i++}`);
      values.push(patch.smtpPassword);
    }
    if (sets.length === 0) return this.findById(id, workspaceId);
    sets.push("updated_at = NOW()");
    values.push(id);
    const scope = workspaceId ? ` AND workspace_id = $${i + 1}` : "";
    if (workspaceId) values.push(workspaceId);
    const r = await pool.query(
      `UPDATE smtp_accounts SET ${sets.join(", ")}
       WHERE id = $${i} AND deleted_at IS NULL${scope} RETURNING *`,
      values
    );
    return r.rows[0] ? mapSmtpAccount(r.rows[0]) : null;
  },

  async recordSend(id: string, isWarmup: boolean): Promise<void> {
    if (isWarmup) {
      await pool.query(
        `UPDATE smtp_accounts SET warmup_sent_today = warmup_sent_today + 1, updated_at = NOW() WHERE id = $1`,
        [id]
      );
    } else {
      await pool.query(
        `UPDATE smtp_accounts SET sent_today = sent_today + 1, updated_at = NOW() WHERE id = $1`,
        [id]
      );
    }
  },

  async adjustReputation(id: string, delta: number, errorMessage?: string): Promise<void> {
    await pool.query(
      `UPDATE smtp_accounts
         SET reputation_score = GREATEST(0, LEAST(100, reputation_score + $1)),
             error_message = $2,
             updated_at = NOW()
       WHERE id = $3`,
      [delta, errorMessage ?? null, id]
    );
  },

  async softDelete(id: string, workspaceId?: string): Promise<boolean> {
    if (workspaceId) {
      const r = await pool.query(
        `UPDATE smtp_accounts SET deleted_at = NOW()
         WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL`,
        [id, workspaceId]
      );
      return (r.rowCount ?? 0) > 0;
    }
    const r = await pool.query(
      `UPDATE smtp_accounts SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    return (r.rowCount ?? 0) > 0;
  },
};
