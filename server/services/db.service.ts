/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Thin bootstrap facade around the real persistence layer.
 *
 * Historical note: previous versions of this file held all state in a giant
 * in-memory object that was full-table upserted to Postgres on every write.
 * That is gone. All state lives in Postgres. Controllers use repositories.
 *
 * This file remains as a boot entrypoint (runs migrations, seeds default
 * agent metadata) and to expose a legacy `logAudit` helper.
 */

import { pool, pingDatabase } from "../db/pool";
import { runMigrations } from "../db/migrations";
import {
  agentRepository,
  auditRepository,
  DEFAULT_AGENTS,
} from "../db/repositories";
import { AuditLog } from "./db.service.types";

let bootstrapPromise: Promise<void> | null = null;

async function bootstrap(): Promise<void> {
  await runMigrations();
  await agentRepository.ensureDefaults(DEFAULT_AGENTS);
  const ok = await pingDatabase();
  if (!ok) throw new Error("[db.service] Post-migration ping returned no rows");
  console.log("[db.service] bootstrap complete; PostgreSQL is the sole source of truth.");
}

export function initDatabase(): Promise<void> {
  if (!bootstrapPromise) bootstrapPromise = bootstrap();
  return bootstrapPromise;
}

export { pool };

export async function logAudit(
  action: string,
  category: AuditLog["category"],
  opts: { userId?: string; userEmail?: string; details?: string; ipAddress?: string } = {}
): Promise<void> {
  try {
    await auditRepository.log({
      action,
      category,
      userId: opts.userId,
      userEmail: opts.userEmail,
      details: opts.details,
      ipAddress: opts.ipAddress,
    });
  } catch (err: any) {
    console.error("[audit] write failed:", err?.message);
  }
}
