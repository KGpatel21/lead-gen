/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Persistent round-robin cursor per sender pool. Survives restarts so
 * rotation stays fair even after workers restart.
 */

import crypto from "crypto";
import { pool } from "../pool";

export interface RotationState {
  id: string;
  poolId: string;
  workspaceId: string;
  lastAccountId?: string;
  cursorIndex: number;
  totalPicks: number;
  updatedAt: string;
}

const iso = (v: unknown): string =>
  v instanceof Date ? v.toISOString() : v == null ? "" : String(v);

function mapRow(r: any): RotationState {
  return {
    id: r.id,
    poolId: r.pool_id,
    workspaceId: r.workspace_id,
    lastAccountId: r.last_account_id || undefined,
    cursorIndex: r.cursor_index || 0,
    totalPicks: Number(r.total_picks || 0),
    updatedAt: iso(r.updated_at),
  };
}

export const rotationStateRepository = {
  async findByPool(poolId: string): Promise<RotationState | null> {
    const r = await pool.query("SELECT * FROM rotation_state WHERE pool_id = $1", [poolId]);
    return r.rows[0] ? mapRow(r.rows[0]) : null;
  },

  async ensure(poolId: string, workspaceId: string): Promise<RotationState> {
    const existing = await this.findByPool(poolId);
    if (existing) return existing;
    const id = `rot-${Date.now()}-${crypto.randomUUID().split("-")[0]}`;
    const r = await pool.query(
      `INSERT INTO rotation_state (id, pool_id, workspace_id, cursor_index, total_picks)
       VALUES ($1,$2,$3,0,0)
       ON CONFLICT (pool_id) DO UPDATE SET updated_at = NOW()
       RETURNING *`,
      [id, poolId, workspaceId]
    );
    return mapRow(r.rows[0]);
  },

  async advance(poolId: string, nextIndex: number, accountId: string): Promise<void> {
    await pool.query(
      `UPDATE rotation_state
         SET cursor_index = $1,
             last_account_id = $2,
             total_picks = total_picks + 1,
             updated_at = NOW()
       WHERE pool_id = $3`,
      [nextIndex, accountId, poolId]
    );
  },
};
