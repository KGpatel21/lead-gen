/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * BullMQ worker that consumes the `email-send` queue.
 */

import { Worker } from "bullmq";
import { bullConnection } from "./connection";
import { EMAIL_QUEUE_NAME, EmailSendJobData } from "./emailQueue";
import { emailRepository, followUpRuleRepository } from "../db/repositories";
import { sesService, RecipientSuppressedError, NoSenderAvailableError, SesNotConfiguredError } from "../services/ses.service";
import { scheduleFollowUp } from "./followUpQueue";
import { config } from "../config";

const CONCURRENCY = parseInt(process.env.EMAIL_WORKER_CONCURRENCY || "3", 10);

export const emailSendWorker = new Worker<EmailSendJobData, { messageId?: string; senderEmail: string }>(
  EMAIL_QUEUE_NAME,
  async (job) => {
    const { emailId, campaignId, orgName, reason } = job.data;
    const email = await emailRepository.findById(emailId);
    if (!email) throw new Error(`Email ${emailId} vanished before send.`);
    if (email.status === "CANCELLED" || email.status === "PAUSED") {
      // Drop silently. Not an error.
      return { senderEmail: "-" };
    }

    // The controller may have paused the row after we picked the job up.
    if (["SENT", "BOUNCED", "COMPLAINED"].includes(email.status)) {
      return { senderEmail: "-", messageId: email.messageId };
    }

    const dispatched = await sesService.sendEmailRow(email, { orgName });

    // If this was the initial send, seed follow-up jobs.
    if (
      reason === "initial" &&
      campaignId &&
      email.followUpStep === 0
    ) {
      await seedFollowUps(email.id, campaignId, dispatched.senderEmail, job.data);
    }

    return { messageId: dispatched.messageId, senderEmail: dispatched.senderEmail };
  },
  {
    connection: bullConnection,
    concurrency: CONCURRENCY,
    lockDuration: 60_000,
  }
);

emailSendWorker.on("failed", async (job, err) => {
  if (!job) return;
  if (err instanceof RecipientSuppressedError) {
    // Not a retryable failure. Job is complete-as-far-as-worker-is-concerned.
    return;
  }
  if (err instanceof NoSenderAvailableError) {
    // Requeue with 5-minute delay so a fresh sender can rotate in.
    await job.moveToDelayed(Date.now() + 5 * 60_000, "no-sender").catch(() => { /* ignore */ });
  }
  if (err instanceof SesNotConfiguredError) {
    // Config issue — do not spin retries. Fail hard.
    return;
  }
});

async function seedFollowUps(
  initialEmailId: string,
  campaignId: string,
  senderEmail: string,
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
        senderName: "", // populated by follow-up worker via campaign context
        senderCompany: "",
        targetService: "",
        tone: "Consultative",
        orgName: jobData.orgName,
      },
      rule.delayDays * 24 * 60 * 60 * 1000
    );
  }
  console.log(
    `[email-worker] seeded ${rules.length} follow-ups for email=${initialEmailId} sender=${senderEmail} campaign=${campaignId} baseUrl=${config.publicBaseUrl}`
  );
}
