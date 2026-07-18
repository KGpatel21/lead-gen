/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Email dispatch queue (BullMQ).
 *
 * Job payload:
 *   { emailId: string, campaignId?: string }
 *
 * Job options honored:
 *   - `delay`      → scheduled send
 *   - `priority`   → 1 (high) … 3 (low). Default 2.
 *   - `attempts`   → 4 (initial + 3 retries)
 *   - `backoff`    → exponential 1s, 2s, 4s
 *
 * Lifecycle:
 *   - enqueue()         → adds a job. campaign.status stays as-is.
 *   - pauseCampaign()   → BullMQ pause + email rows → PAUSED
 *   - resumeCampaign()  → BullMQ resume + email rows → READY
 *   - cancelCampaign()  → removes future jobs + email rows → CANCELLED
 */

import { Queue, QueueEvents, JobsOptions } from "bullmq";
import { bullConnection } from "./connection";
import { emailRepository, campaignRepository } from "../db/repositories";
import { CampaignStatus } from "../../src/types";

export const EMAIL_QUEUE_NAME = "email-send";

export interface EmailSendJobData {
  emailId: string;
  campaignId?: string;
  orgName?: string;
  followUpStep?: number;
  reason?: "initial" | "followup" | "manual" | "retry";
}

export const emailQueue = new Queue<EmailSendJobData>(EMAIL_QUEUE_NAME, {
  connection: bullConnection,
  defaultJobOptions: {
    attempts: 4,
    backoff: { type: "exponential", delay: 1_000 },
    removeOnComplete: { age: 3_600 * 24 * 7, count: 5_000 },
    removeOnFail: { age: 3_600 * 24 * 30, count: 5_000 },
  },
});

export const emailQueueEvents = new QueueEvents(EMAIL_QUEUE_NAME, {
  connection: bullConnection,
});
emailQueueEvents.on("failed", ({ jobId, failedReason }) => {
  console.warn(`[email-queue] job ${jobId} failed: ${(failedReason || "").slice(0, 200)}`);
});
emailQueueEvents.on("completed", ({ jobId }) => {
  console.log(`[email-queue] job ${jobId} completed`);
});

export interface EnqueueOptions {
  delayMs?: number;
  priority?: 1 | 2 | 3;
  reason?: EmailSendJobData["reason"];
  orgName?: string;
  followUpStep?: number;
}

export async function enqueueEmail(
  emailId: string,
  campaignId?: string,
  opts: EnqueueOptions = {}
): Promise<string> {
  const jobOptions: JobsOptions = {
    delay: opts.delayMs && opts.delayMs > 0 ? opts.delayMs : undefined,
    priority: opts.priority ?? 2,
  };
  const job = await emailQueue.add(
    "send",
    {
      emailId,
      campaignId,
      orgName: opts.orgName,
      followUpStep: opts.followUpStep,
      reason: opts.reason ?? "initial",
    },
    jobOptions
  );
  return job.id!;
}

/**
 * Enqueue every READY / RETRY email for a campaign. Returns the number
 * of jobs added.
 */
export async function enqueueCampaign(campaignId: string, opts: EnqueueOptions = {}): Promise<number> {
  const rows = await emailRepository.listReadyForCampaign(campaignId);
  let added = 0;
  for (const email of rows) {
    await enqueueEmail(email.id, campaignId, opts);
    added++;
  }
  if (added > 0) await campaignRepository.setStatus(campaignId, CampaignStatus.RUNNING);
  return added;
}

/**
 * Pauses processing at the BullMQ level AND flips affected email rows to
 * PAUSED so they don't get re-enqueued if the server restarts.
 */
export async function pauseCampaign(campaignId: string): Promise<{ paused: number }> {
  const paused = await emailRepository.pauseAllForCampaign(campaignId);
  await emailQueue.pause();
  await campaignRepository.setStatus(campaignId, CampaignStatus.PAUSED);
  return { paused };
}

export async function resumeCampaign(campaignId: string): Promise<{ resumed: number }> {
  const resumed = await emailRepository.resumeAllForCampaign(campaignId);
  await emailQueue.resume();
  await campaignRepository.setStatus(campaignId, CampaignStatus.RUNNING);
  return { resumed };
}

/**
 * Cancels every future job for the campaign, marks pending emails CANCELLED,
 * and completes the campaign.
 */
export async function cancelCampaign(campaignId: string): Promise<{ cancelled: number; removedJobs: number }> {
  const cancelled = await emailRepository.cancelAllForCampaign(campaignId);
  const removedJobs = await removeCampaignJobs(campaignId);
  await campaignRepository.setStatus(campaignId, CampaignStatus.COMPLETED);
  return { cancelled, removedJobs };
}

async function removeCampaignJobs(campaignId: string): Promise<number> {
  const states: Array<"waiting" | "delayed" | "prioritized"> = ["waiting", "delayed", "prioritized"];
  let removed = 0;
  for (const state of states) {
    const jobs = await emailQueue.getJobs([state], 0, 10_000, true);
    for (const job of jobs) {
      if (job.data.campaignId === campaignId) {
        try { await job.remove(); removed++; } catch { /* ignore */ }
      }
    }
  }
  return removed;
}

export async function queueStats() {
  const counts = await emailQueue.getJobCounts("waiting", "delayed", "prioritized", "active", "completed", "failed");
  return counts;
}
