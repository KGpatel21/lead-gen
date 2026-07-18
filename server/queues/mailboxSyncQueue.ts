/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * BullMQ queue for periodic mailbox-sync jobs.
 *
 * Repeatable job per email_account:
 *   { name: `poll:${accountId}`, data: { accountId }, repeat: { every: 5min } }
 *
 * The worker pulls the account, gets the right MailboxReader, incrementally
 * fetches new messages, upserts them into `replies`, and classifies each new
 * reply via Groq.
 */

import { Queue, QueueEvents, JobsOptions } from "bullmq";
import { bullConnection } from "./connection";

export const MAILBOX_SYNC_QUEUE_NAME = "mailbox-sync";

export interface MailboxSyncJobData {
  accountId: string;
  workspaceId: string;
  reason?: "manual" | "schedule";
}

export const mailboxSyncQueue = new Queue<MailboxSyncJobData>(MAILBOX_SYNC_QUEUE_NAME, {
  connection: bullConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 30_000 },
    removeOnComplete: { age: 3_600 * 24 * 7, count: 5_000 },
    removeOnFail: { age: 3_600 * 24 * 30, count: 5_000 },
  },
});

export const mailboxSyncQueueEvents = new QueueEvents(MAILBOX_SYNC_QUEUE_NAME, {
  connection: bullConnection,
});

const POLL_INTERVAL_MS = parseInt(process.env.MAILBOX_POLL_INTERVAL_MS || `${5 * 60 * 1000}`, 10);

export async function scheduleAccountPoll(
  accountId: string,
  workspaceId: string,
  everyMs: number = POLL_INTERVAL_MS
): Promise<void> {
  // BullMQ v5 repeatable job — use a stable jobId so we do not double-schedule.
  const jobKey = `poll:${accountId}`;
  const opts: JobsOptions = {
    repeat: { every: everyMs },
    jobId: jobKey,
  };
  await mailboxSyncQueue.add(jobKey, { accountId, workspaceId, reason: "schedule" }, opts);
}

export async function unscheduleAccountPoll(accountId: string): Promise<void> {
  const jobKey = `poll:${accountId}`;
  const repeatableJobs = await mailboxSyncQueue.getRepeatableJobs();
  for (const j of repeatableJobs) {
    if (j.name === jobKey || j.id === jobKey) {
      await mailboxSyncQueue.removeRepeatableByKey(j.key);
    }
  }
}

export async function triggerOneShotSync(accountId: string, workspaceId: string): Promise<string> {
  const job = await mailboxSyncQueue.add(
    `poll:once:${accountId}`,
    { accountId, workspaceId, reason: "manual" },
    { priority: 1 }
  );
  return job.id!;
}

export async function mailboxQueueStats() {
  return mailboxSyncQueue.getJobCounts("waiting", "active", "delayed", "completed", "failed", "prioritized");
}
