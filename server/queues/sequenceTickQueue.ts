/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sequence-tick queue: a repeatable job that scans campaign_prospects
 * for rows whose `next_send_at <= NOW()` and dispatches them via the
 * sequence engine. Every prospect advance also enqueues a follow-on
 * `sequence-advance:<id>` job for that prospect so the tick loop stays
 * small and each advance runs isolated.
 *
 * Every schedulable job survives restart via BullMQ + Redis.
 */

import { Queue, Worker, JobsOptions } from "bullmq";
import { bullConnection } from "./connection";
import { log } from "../observability/logger";
import { config } from "../config";

export const SEQUENCE_TICK_QUEUE_NAME = "sequence-tick";
export const SEQUENCE_ADVANCE_QUEUE_NAME = "sequence-advance";

export interface SequenceAdvanceJobData {
  prospectId: string;
}

// Advance queue: one job per prospect ready to advance.
export const sequenceAdvanceQueue = new Queue<SequenceAdvanceJobData>(SEQUENCE_ADVANCE_QUEUE_NAME, {
  connection: bullConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 15_000 },
    removeOnComplete: { age: 3_600 * 24 * 7, count: 5_000 },
    removeOnFail: { age: 3_600 * 24 * 14, count: 5_000 },
  },
});

// Tick queue: one repeatable job that scans campaign_prospects.
export const sequenceTickQueue = new Queue(SEQUENCE_TICK_QUEUE_NAME, {
  connection: bullConnection,
  defaultJobOptions: {
    attempts: 2,
    removeOnComplete: { age: 3_600, count: 200 },
    removeOnFail: { age: 3_600 * 24, count: 200 },
  },
});

export async function scheduleSequenceTick(everyMs: number = 60_000): Promise<void> {
  const parsed = parseInt(process.env.SEQUENCE_TICK_INTERVAL_MS || String(everyMs), 10);
  const effective = isFinite(parsed) && parsed >= 15_000 ? parsed : 60_000;
  await sequenceTickQueue.add(
    "tick",
    {},
    {
      repeat: { every: effective },
      jobId: "sequence-tick:global",
      removeOnComplete: true,
    } as JobsOptions
  );
  log.info({ everyMs: effective }, "sequence-tick scheduled");
}

export async function triggerAdvance(prospectId: string, delayMs?: number): Promise<string> {
  const job = await sequenceAdvanceQueue.add(
    "advance",
    { prospectId },
    {
      jobId: `advance:${prospectId}:${Date.now()}`,
      delay: delayMs && delayMs > 0 ? delayMs : undefined,
    }
  );
  return job.id!;
}

// The tick worker: scans DB, enqueues advances.
export const sequenceTickWorker = new Worker(
  SEQUENCE_TICK_QUEUE_NAME,
  async () => {
    const { campaignProspectRepository } = await import("../db/repositories");
    const due = await campaignProspectRepository.listDueForSend(500, new Date());
    for (const p of due) {
      await triggerAdvance(p.id);
    }
    if (due.length > 0) {
      log.info({ dueCount: due.length }, "sequence-tick: enqueued advances");
    }
    return { dueCount: due.length };
  },
  {
    connection: bullConnection,
    concurrency: 1,
    lockDuration: 60_000,
  }
);

sequenceTickWorker.on("failed", (job, err) => {
  log.warn({ jobId: job?.id, err: err?.message }, "sequence-tick job failed");
});

// The advance worker: one prospect per job.
export const sequenceAdvanceWorker = new Worker<SequenceAdvanceJobData, unknown>(
  SEQUENCE_ADVANCE_QUEUE_NAME,
  async (job) => {
    const { sequenceEngineService } = await import("../services/sequenceEngine.service");
    const result = await sequenceEngineService.advanceProspect(job.data.prospectId);
    return result;
  },
  {
    connection: bullConnection,
    concurrency: parseInt(process.env.SEQUENCE_ADVANCE_CONCURRENCY || "3", 10),
    lockDuration: 90_000,
  }
);

sequenceAdvanceWorker.on("failed", (job, err) => {
  log.warn({ jobId: job?.id, prospectId: job?.data?.prospectId, err: err?.message }, "sequence-advance failed");
});

// Silence unused warnings for config import used to keep .env cache warm.
void config;
