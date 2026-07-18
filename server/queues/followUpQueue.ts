/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Follow-up scheduler queue.
 *
 * Job payload:
 *   { campaignId, businessId, recipientEmail, initialEmailId, step }
 *
 * A follow-up job is scheduled with `delay = delayDays * 24h` at the moment
 * the initial email is enqueued (or when a prior follow-up sends). The worker:
 *   1. Re-checks: has the recipient replied? If yes, drop the follow-up.
 *   2. Re-checks: is the recipient on the suppression list? If yes, drop.
 *   3. Otherwise: calls the AI email generator with the follow-up rule prompt,
 *      inserts a fresh emails row (follow_up_of, follow_up_step), and enqueues
 *      it on `email-send`.
 */

import { Queue, QueueEvents, JobsOptions } from "bullmq";
import { bullConnection } from "./connection";

export const FOLLOW_UP_QUEUE_NAME = "follow-up";

export interface FollowUpJobData {
  campaignId: string;
  businessId: string;
  recipientEmail: string;
  initialEmailId: string;
  step: number;                  // 1, 2, 3, ...
  senderName: string;
  senderCompany: string;
  targetService: string;
  tone?: "Direct" | "Warm" | "Consultative" | "Playful";
  orgName?: string;
}

export const followUpQueue = new Queue<FollowUpJobData>(FOLLOW_UP_QUEUE_NAME, {
  connection: bullConnection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: "exponential", delay: 30_000 },
    removeOnComplete: { age: 3_600 * 24 * 30, count: 5_000 },
    removeOnFail: { age: 3_600 * 24 * 60, count: 5_000 },
  },
});

export const followUpQueueEvents = new QueueEvents(FOLLOW_UP_QUEUE_NAME, {
  connection: bullConnection,
});
followUpQueueEvents.on("failed", ({ jobId, failedReason }) => {
  console.warn(`[follow-up-queue] job ${jobId} failed: ${(failedReason || "").slice(0, 200)}`);
});

export async function scheduleFollowUp(
  data: FollowUpJobData,
  delayMs: number
): Promise<string> {
  const opts: JobsOptions = { delay: delayMs, priority: 2 };
  const job = await followUpQueue.add("run", data, opts);
  return job.id!;
}
