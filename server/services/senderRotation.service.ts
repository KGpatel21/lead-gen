/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sender rotation strategy layer.
 *
 * Uses `sender_pools.strategy` to pick the next healthy account:
 *   - round_robin  — cursor-persistent across restarts (rotation_state)
 *   - random       — uniform pick over eligible accounts
 *   - least_used   — pick lowest sent_today
 *   - weighted     — weight column on sender_pool_members
 *   - health       — highest reputation, then least used
 *
 * All strategies respect daily_send_limit / is_active / is_healthy /
 * SES verification.
 *
 * `pickAccountForCampaign` is the front door. It falls back to the
 * workspace's global round-robin when the campaign has no pool bound.
 */

import crypto from "crypto";
import {
  emailAccountRepository,
  EmailAccount,
  senderPoolRepository,
  rotationStateRepository,
} from "../db/repositories";
import { pool } from "../db/pool";

export interface RotationInput {
  workspaceId: string;
  campaignId?: string;
  poolId?: string;
  stepAccountId?: string;   // step-level pin
  stepPoolId?: string;      // step-level pool override
  exclude?: Set<string>;    // account ids we already tried for failover
}

async function eligibleAccounts(
  workspaceId: string,
  memberIds: string[],
  exclude: Set<string>
): Promise<EmailAccount[]> {
  const accounts = await emailAccountRepository.listActiveHealthy(workspaceId);
  return accounts.filter(
    (a) =>
      !exclude.has(a.id) &&
      memberIds.includes(a.id) &&
      a.sentToday < a.dailySendLimit
  );
}

function uniformPick<T>(arr: T[]): T | null {
  if (arr.length === 0) return null;
  const idx = crypto.randomInt(0, arr.length);
  return arr[idx];
}

async function pickFromPool(
  workspaceId: string,
  poolId: string,
  exclude: Set<string>
): Promise<EmailAccount | null> {
  const senderPool = await senderPoolRepository.findById(poolId, workspaceId);
  if (!senderPool || !senderPool.isActive) return null;
  const members = await senderPoolRepository.listMembers(poolId);
  if (members.length === 0) return null;

  const memberIds = members.map((m) => m.accountId);
  const eligible = await eligibleAccounts(workspaceId, memberIds, exclude);
  if (eligible.length === 0) return null;

  switch (senderPool.strategy) {
    case "round_robin": {
      // Persistent cursor per pool.
      const state = await rotationStateRepository.ensure(poolId, workspaceId);
      // Order eligible accounts by member's stable creation order.
      const orderedIds = memberIds.filter((id) => eligible.some((a) => a.id === id));
      if (orderedIds.length === 0) return null;
      const idx = state.cursorIndex % orderedIds.length;
      const chosenId = orderedIds[idx];
      const chosen = eligible.find((a) => a.id === chosenId) || eligible[0];
      const nextIdx = (orderedIds.indexOf(chosen.id) + 1) % orderedIds.length;
      await rotationStateRepository.advance(poolId, nextIdx, chosen.id);
      return chosen;
    }
    case "random":
      return uniformPick(eligible);
    case "least_used": {
      const sorted = [...eligible].sort((a, b) => a.sentToday - b.sentToday);
      return sorted[0];
    }
    case "weighted": {
      const weights = eligible.map((a) => {
        const m = members.find((mm) => mm.accountId === a.id);
        return Math.max(1, m?.weight ?? 1);
      });
      const total = weights.reduce((s, w) => s + w, 0);
      let roll = crypto.randomInt(0, total);
      for (let i = 0; i < eligible.length; i++) {
        roll -= weights[i];
        if (roll < 0) return eligible[i];
      }
      return eligible[eligible.length - 1];
    }
    case "health": {
      const sorted = [...eligible].sort(
        (a, b) =>
          b.reputationScore - a.reputationScore || a.deliveryCount - b.deliveryCount
      );
      return sorted[0];
    }
    default:
      return uniformPick(eligible);
  }
}

export const senderRotationService = {
  /**
   * Front door: resolve a sender for the next send.
   * Priority order:
   *   1. step-level pin (stepAccountId)
   *   2. step-level pool override (stepPoolId)
   *   3. campaign-level pool (poolId from campaigns.sender_pool_id)
   *   4. workspace-wide round-robin fallback
   */
  async pickAccountForCampaign(input: RotationInput): Promise<EmailAccount | null> {
    const exclude = input.exclude || new Set<string>();

    // 1. Explicit pin from the step.
    if (input.stepAccountId && !exclude.has(input.stepAccountId)) {
      const a = await emailAccountRepository.findById(input.stepAccountId, input.workspaceId);
      if (a && a.isActive && a.isHealthy && a.sentToday < a.dailySendLimit) return a;
    }

    // 2. Step pool.
    if (input.stepPoolId) {
      const picked = await pickFromPool(input.workspaceId, input.stepPoolId, exclude);
      if (picked) return picked;
    }

    // 3. Campaign pool.
    let campaignPoolId = input.poolId;
    if (!campaignPoolId && input.campaignId) {
      const r = await pool.query(
        "SELECT sender_pool_id FROM campaigns WHERE id = $1 AND workspace_id = $2",
        [input.campaignId, input.workspaceId]
      );
      campaignPoolId = r.rows[0]?.sender_pool_id || undefined;
    }
    if (campaignPoolId) {
      const picked = await pickFromPool(input.workspaceId, campaignPoolId, exclude);
      if (picked) return picked;
    }

    // 4. Fallback: workspace round-robin.
    const rr = await emailAccountRepository.pickRoundRobin(input.workspaceId);
    if (rr && !exclude.has(rr.id)) return rr;
    return null;
  },
};
