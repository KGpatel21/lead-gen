/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sender pools: named groups of email accounts with a rotation strategy.
 * A campaign optionally binds to one pool; when it does, the send worker
 * picks a sender from the pool via the strategy on each dispatch.
 */

import crypto from "crypto";
import { pool } from "../pool";
import { emailAccountRepository, EmailAccount } from "./emailAccount.repository";

export type PoolStrategy = "round_robin" | "least_used" | "random" | "weighted" | "health";

export interface SenderPool {
  id: string;
  name: string;
  strategy: PoolStrategy;
  campaignId?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SenderPoolMember {
  id: string;
  poolId: string;
  accountId: string;
  weight: number;
  createdAt: string;
}

const iso = (v: unknown): string =>
  v instanceof Date ? v.toISOString() : v == null ? "" : String(v);

function mapPool(r: any): SenderPool {
  return {
    id: r.id,
    name: r.name,
    strategy: r.strategy as PoolStrategy,
    campaignId: r.campaign_id || undefined,
    isActive: r.is_active,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}
function mapMember(r: any): SenderPoolMember {
  return { id: r.id, poolId: r.pool_id, accountId: r.account_id, weight: r.weight, createdAt: iso(r.created_at) };
}

export const senderPoolRepository = {
  async list(workspaceId?: string): Promise<SenderPool[]> {
    if (workspaceId) {
      const r = await pool.query(
        "SELECT * FROM sender_pools WHERE workspace_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC",
        [workspaceId]
      );
      return r.rows.map(mapPool);
    }
    const r = await pool.query(
      "SELECT * FROM sender_pools WHERE deleted_at IS NULL ORDER BY created_at DESC"
    );
    return r.rows.map(mapPool);
  },

  async findById(id: string, workspaceId?: string): Promise<SenderPool | null> {
    if (workspaceId) {
      const r = await pool.query("SELECT * FROM sender_pools WHERE id = $1 AND workspace_id = $2", [id, workspaceId]);
      return r.rows[0] ? mapPool(r.rows[0]) : null;
    }
    const r = await pool.query("SELECT * FROM sender_pools WHERE id = $1", [id]);
    return r.rows[0] ? mapPool(r.rows[0]) : null;
  },

  async create(input: { workspaceId: string; name: string; strategy?: PoolStrategy; campaignId?: string }): Promise<SenderPool> {
    if (!input.workspaceId) throw new Error("senderPoolRepository.create requires workspaceId");
    const id = `pool-${Date.now()}-${crypto.randomUUID().split("-")[0]}`;
    const r = await pool.query(
      `INSERT INTO sender_pools (id, workspace_id, name, strategy, campaign_id) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [id, input.workspaceId, input.name, input.strategy || "round_robin", input.campaignId || null]
    );
    return mapPool(r.rows[0]);
  },

  async update(id: string, patch: Partial<{ name: string; strategy: PoolStrategy; isActive: boolean }>): Promise<SenderPool | null> {
    const sets: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    if (patch.name != null) { sets.push(`name = $${i++}`); values.push(patch.name); }
    if (patch.strategy != null) { sets.push(`strategy = $${i++}`); values.push(patch.strategy); }
    if (patch.isActive != null) { sets.push(`is_active = $${i++}`); values.push(patch.isActive); }
    if (sets.length === 0) return this.findById(id);
    sets.push("updated_at = NOW()");
    values.push(id);
    const r = await pool.query(
      `UPDATE sender_pools SET ${sets.join(", ")} WHERE id = $${i} AND deleted_at IS NULL RETURNING *`,
      values
    );
    return r.rows[0] ? mapPool(r.rows[0]) : null;
  },

  async delete(id: string): Promise<void> {
    await pool.query("UPDATE sender_pools SET deleted_at = NOW() WHERE id = $1", [id]);
  },

  async addMember(poolId: string, accountId: string, weight: number = 1): Promise<SenderPoolMember> {
    const id = `pmem-${Date.now()}-${crypto.randomUUID().split("-")[0]}`;
    const r = await pool.query(
      `INSERT INTO sender_pool_members (id, pool_id, account_id, weight)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (pool_id, account_id) DO UPDATE SET weight = EXCLUDED.weight
       RETURNING *`,
      [id, poolId, accountId, weight]
    );
    return mapMember(r.rows[0]);
  },

  async removeMember(poolId: string, accountId: string): Promise<boolean> {
    const r = await pool.query(
      "DELETE FROM sender_pool_members WHERE pool_id = $1 AND account_id = $2",
      [poolId, accountId]
    );
    return (r.rowCount ?? 0) > 0;
  },

  async listMembers(poolId: string): Promise<SenderPoolMember[]> {
    const r = await pool.query("SELECT * FROM sender_pool_members WHERE pool_id = $1", [poolId]);
    return r.rows.map(mapMember);
  },

  /**
   * Pick the next sender from a pool using its strategy.
   * Returns null if no eligible sender is available.
   */
  async pickFromPool(poolId: string): Promise<EmailAccount | null> {
    const pool = await this.findById(poolId);
    if (!pool || !pool.isActive) return null;
    const members = await this.listMembers(poolId);
    if (members.length === 0) return null;
    const accountIds = members.map((m) => m.accountId);

    switch (pool.strategy) {
      case "round_robin":
        return emailAccountRepository.pickRoundRobin(accountIds);
      case "least_used":
        return emailAccountRepository.pickLeastUsed(accountIds);
      case "random": {
        // Uniform random pick among members that are still under quota.
        const accounts = await emailAccountRepository.listActiveHealthy();
        const eligible = accounts.filter((a) => accountIds.includes(a.id) && a.sentToday < a.dailySendLimit);
        if (eligible.length === 0) return null;
        return eligible[Math.floor(Math.random() * eligible.length)];
      }
      case "weighted": {
        // Weighted random pick — weight comes from the member row.
        const accounts = await emailAccountRepository.listActiveHealthy();
        const eligible = accounts.filter((a) => accountIds.includes(a.id) && a.sentToday < a.dailySendLimit);
        if (eligible.length === 0) return null;
        const weights = eligible.map((a) => {
          const m = members.find((mm) => mm.accountId === a.id);
          return Math.max(1, m?.weight ?? 1);
        });
        const total = weights.reduce((s, w) => s + w, 0);
        let roll = Math.random() * total;
        for (let i = 0; i < eligible.length; i++) {
          roll -= weights[i];
          if (roll <= 0) return eligible[i];
        }
        return eligible[eligible.length - 1];
      }
      case "health": {
        // Highest reputation first, then least used.
        const accounts = await emailAccountRepository.listActiveHealthy();
        const eligible = accounts
          .filter((a) => accountIds.includes(a.id) && a.sentToday < a.dailySendLimit)
          .sort((a, b) => (b.reputationScore - a.reputationScore) || (a.deliveryCount - b.deliveryCount));
        return eligible[0] || null;
      }
      default:
        return emailAccountRepository.pickRoundRobin(accountIds);
    }
  },
};
