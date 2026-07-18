/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workspace-scoped suppression cache backed by Redis SETs.
 *
 * On boot / miss, warms the cache from Postgres. On every add/remove the
 * suppression repository invalidates via `invalidate(workspaceId, email)`.
 *
 * Read path is O(1) SISMEMBER — no DB round-trip per send.
 */

import { redisService } from "./redis.service";
import { suppressionRepository } from "../db/repositories";
import { log } from "../observability/logger";

const KEY_PREFIX = "suppression:ws:";
const WARM_TTL_SECONDS = 60 * 60 * 12; // 12h — the DB is source-of-truth
const WARMED_MARKER = "__warmed__";

function keyFor(workspaceId: string): string {
  return `${KEY_PREFIX}${workspaceId}`;
}

async function warmWorkspaceIfNeeded(workspaceId: string): Promise<void> {
  const client = redisService.getClient();
  const key = keyFor(workspaceId);
  const isWarmed = await client.sismember(key, WARMED_MARKER);
  if (isWarmed === 1) return;

  const emails = await suppressionRepository.listAllSuppressedEmails(workspaceId);
  // Always include the sentinel so an empty suppression list still counts
  // as warmed.
  const members = [WARMED_MARKER, ...emails.map((e) => e.toLowerCase())];
  if (members.length > 0) await client.sadd(key, ...members);
  await client.expire(key, WARM_TTL_SECONDS);
  log.debug({ workspaceId, count: emails.length }, "suppression cache warmed");
}

export const suppressionCacheService = {
  async isSuppressed(email: string, workspaceId: string): Promise<boolean> {
    try {
      await warmWorkspaceIfNeeded(workspaceId);
      const client = redisService.getClient();
      const n = await client.sismember(keyFor(workspaceId), email.toLowerCase());
      return n === 1;
    } catch (err) {
      // Redis miss → fall back to DB. Never fail a send because the cache is down.
      log.warn({ err: (err as Error).message, workspaceId }, "suppression cache miss, falling back to DB");
      return suppressionRepository.isSuppressed(email, workspaceId);
    }
  },

  /**
   * Bulk check — return the subset of the input that IS suppressed.
   * Used at enqueue time to filter out entire batches without one-at-a-time
   * DB round-trips.
   */
  async filterSuppressed(emails: string[], workspaceId: string): Promise<Set<string>> {
    if (emails.length === 0) return new Set();
    try {
      await warmWorkspaceIfNeeded(workspaceId);
      const client = redisService.getClient();
      const pipeline = client.pipeline();
      const lowered = emails.map((e) => e.toLowerCase());
      for (const e of lowered) pipeline.sismember(keyFor(workspaceId), e);
      const results = await pipeline.exec();
      const suppressed = new Set<string>();
      results?.forEach(([err, val], idx) => {
        if (!err && val === 1) suppressed.add(lowered[idx]);
      });
      return suppressed;
    } catch (err) {
      log.warn({ err: (err as Error).message }, "suppression bulk cache miss, falling back to DB");
      const out = new Set<string>();
      for (const e of emails) {
        if (await suppressionRepository.isSuppressed(e, workspaceId)) out.add(e.toLowerCase());
      }
      return out;
    }
  },

  async invalidateAdd(email: string, workspaceId: string): Promise<void> {
    try {
      const client = redisService.getClient();
      await client.sadd(keyFor(workspaceId), email.toLowerCase());
    } catch (err) {
      log.warn({ err: (err as Error).message }, "suppression cache add invalidate failed");
    }
  },

  async invalidateRemove(email: string, workspaceId: string): Promise<void> {
    try {
      const client = redisService.getClient();
      await client.srem(keyFor(workspaceId), email.toLowerCase());
    } catch (err) {
      log.warn({ err: (err as Error).message }, "suppression cache remove invalidate failed");
    }
  },
};
