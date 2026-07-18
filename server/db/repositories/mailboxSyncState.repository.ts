/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Per-account mailbox sync cursor. One row per email_account.
 */

import crypto from "crypto";
import { pool } from "../pool";
import type { SyncCursor } from "../../providers/mailbox";

export interface MailboxSyncStateRow {
  id: string;
  accountId: string;
  workspaceId: string;
  lastSyncAt?: string;
  lastUid?: number;
  lastHistoryId?: string;
  lastDeltaLink?: string;
  lastError?: string;
  consecutiveErrors: number;
  createdAt: string;
  updatedAt: string;
}

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : v == null ? "" : String(v));

function mapRow(r: any): MailboxSyncStateRow {
  return {
    id: r.id,
    accountId: r.account_id,
    workspaceId: r.workspace_id,
    lastSyncAt: r.last_sync_at ? iso(r.last_sync_at) : undefined,
    lastUid: r.last_uid == null ? undefined : Number(r.last_uid),
    lastHistoryId: r.last_history_id || undefined,
    lastDeltaLink: r.last_delta_link || undefined,
    lastError: r.last_error || undefined,
    consecutiveErrors: r.consecutive_errors,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

export const mailboxSyncStateRepository = {
  async getByAccount(accountId: string): Promise<MailboxSyncStateRow | null> {
    const r = await pool.query("SELECT * FROM mailbox_sync_state WHERE account_id = $1", [accountId]);
    return r.rows[0] ? mapRow(r.rows[0]) : null;
  },

  async list(workspaceId?: string): Promise<MailboxSyncStateRow[]> {
    if (workspaceId) {
      const r = await pool.query(
        "SELECT * FROM mailbox_sync_state WHERE workspace_id = $1 ORDER BY updated_at DESC",
        [workspaceId]
      );
      return r.rows.map(mapRow);
    }
    const r = await pool.query("SELECT * FROM mailbox_sync_state ORDER BY updated_at DESC");
    return r.rows.map(mapRow);
  },

  async ensureFor(accountId: string, workspaceId: string): Promise<MailboxSyncStateRow> {
    const existing = await this.getByAccount(accountId);
    if (existing) return existing;
    const id = `msync-${Date.now()}-${crypto.randomUUID().split("-")[0]}`;
    const r = await pool.query(
      `INSERT INTO mailbox_sync_state (id, account_id, workspace_id) VALUES ($1,$2,$3)
       ON CONFLICT (account_id) DO NOTHING RETURNING *`,
      [id, accountId, workspaceId]
    );
    if (r.rows[0]) return mapRow(r.rows[0]);
    const again = await this.getByAccount(accountId);
    if (!again) throw new Error("failed to create mailbox_sync_state");
    return again;
  },

  toCursor(row: MailboxSyncStateRow | null): SyncCursor {
    if (!row) return {};
    return {
      lastUid: row.lastUid,
      lastHistoryId: row.lastHistoryId,
      lastDeltaLink: row.lastDeltaLink,
      lastSyncAt: row.lastSyncAt ? new Date(row.lastSyncAt) : undefined,
    };
  },

  async recordSuccess(accountId: string, cursor: SyncCursor): Promise<void> {
    await pool.query(
      `UPDATE mailbox_sync_state SET
         last_sync_at        = COALESCE($2::timestamptz, NOW()),
         last_uid            = COALESCE($3, last_uid),
         last_history_id     = COALESCE($4, last_history_id),
         last_delta_link     = COALESCE($5, last_delta_link),
         last_error          = NULL,
         consecutive_errors  = 0,
         updated_at          = NOW()
       WHERE account_id = $1`,
      [
        accountId,
        cursor.lastSyncAt ? cursor.lastSyncAt.toISOString() : null,
        cursor.lastUid ?? null,
        cursor.lastHistoryId ?? null,
        cursor.lastDeltaLink ?? null,
      ]
    );
  },

  async recordFailure(accountId: string, errorMessage: string): Promise<void> {
    await pool.query(
      `UPDATE mailbox_sync_state SET
         last_error = $2,
         consecutive_errors = consecutive_errors + 1,
         updated_at = NOW()
       WHERE account_id = $1`,
      [accountId, errorMessage.slice(0, 500)]
    );
  },
};
