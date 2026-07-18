/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * BullMQ worker that consumes the `email-send` queue.
 * Provider-neutral: dispatch goes through emailDispatchService which
 * picks the right vendor for the picked account.
 */

import { Worker } from "bullmq";
import { bullConnection } from "./connection";
import { EMAIL_QUEUE_NAME, EmailSendJobData } from "./emailQueue";
import { emailRepository, followUpRuleRepository } from "../db/repositories";
import { emailDispatchService, RecipientSuppressedError, NoSenderAvailableError } from "../services/emailDispatch.service";
import { EmailProviderNotConfiguredError } from "../providers/email";
import { scheduleFollowUp } from "./followUpQueue";

const CONCURRENCY = parseInt(process.env.EMAIL_WORKER_CONCURRENCY || "3", 10);

export const emailSendWorker = new Worker<EmailSendJobData, { accountId?: string }>(
  EMAIL_QUEUE_NAME,
  async (job) => {
    const { emailId, campaignId, orgName, reason } = job.data;
    const email = await emailRepository.findById(emailId);
    if (!email) throw new Error(`Email ${emailId} vanished before send.`);
    if (email.status === "CANCELLED" || email.status === "PAUSED") {
      return {};
    }
    if (["SENT", "BOUNCED", "COMPLAINED"].includes(email.status)) {
      return { accountId: email.senderIdentityId };
    }

    const updated = await emailDispatchService.sendEmailRow(email, { orgName });

    // Seed follow-up jobs only when the initial send succeeded.
    if (reason === "initial" && campaignId && (updated.followUpStep || 0) === 0) {
      await seedFollowUps(updated.id, campaignId, job.data);
    }

    return { accountId: updated.senderIdentityId };
  },
  {
    connection: bullConnection,
    concurrency: CONCURRENCY,
    lockDuration: 60_000,
  }
);

emailSendWorker.on("failed", async (job, err) => {
  if (!job) return;
  if (err instanceof RecipientSuppressedError) return;              // terminal, not retriable
  if (err instanceof EmailProviderNotConfiguredError) return;       // config problem, terminal
  if (err instanceof NoSenderAvailableError) {
    // Delay and try again — a fresh sender might rotate in.
    await job.moveToDelayed(Date.now() + 5 * 60_000, "no-sender").catch(() => { /* ignore */ });
  }
});

async function seedFollowUps(
  initialEmailId: string,
  campaignId: string,
  jobData: EmailSendJobData
): Promise<void> {
  const email = await emailRepository.findById(initialEmailId);
  if (!email || !email.businessId) return;
  const rules = await followUpRuleRepository.ensureDefaults(campaignId);
  for (const rule of rules) {
    if (!rule.isActive) continue;
    await scheduleFollowUp(
      {
        campaignId,
        businessId: email.businessId,
        recipientEmail: email.toEmail,
        initialEmailId,
        step: rule.step,
        senderName: "",
        senderCompany: "",
        targetService: "",
        tone: "Consultative",
        orgName: jobData.orgName,
      },
      rule.delayDays * 24 * 60 * 60 * 1000
    );
  }
  console.log(`[email-worker] seeded ${rules.length} follow-ups for email=${initialEmailId} campaign=${campaignId}`);
}
