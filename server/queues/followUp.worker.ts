/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * BullMQ worker that consumes the `follow-up` queue.
 *
 * For each scheduled follow-up:
 *   1. Check the initial email + recipient in DB.
 *   2. Skip if a reply has been recorded, or if the recipient is suppressed,
 *      or if the campaign was cancelled.
 *   3. Ask the AI service to generate a fresh follow-up email.
 *   4. Insert a new emails row with `follow_up_of` + `follow_up_step` set.
 *   5. Enqueue the row on `email-send`.
 */

import { Worker } from "bullmq";
import { bullConnection } from "./connection";
import { FOLLOW_UP_QUEUE_NAME, FollowUpJobData } from "./followUpQueue";
import {
  emailRepository,
  suppressionRepository,
  campaignRepository,
  followUpRuleRepository,
} from "../db/repositories";
import { aiService } from "../services/ai.service";
import { enqueueEmail } from "./emailQueue";
import { CampaignStatus } from "../../src/types";

export const followUpWorker = new Worker<FollowUpJobData>(
  FOLLOW_UP_QUEUE_NAME,
  async (job) => {
    const data = job.data;

    const campaign = await campaignRepository.findById(data.campaignId);
    if (!campaign) return { skipped: "campaign missing" };
    if (
      campaign.status === CampaignStatus.PAUSED ||
      campaign.status === CampaignStatus.COMPLETED
    ) {
      return { skipped: `campaign status=${campaign.status}` };
    }

    if (await suppressionRepository.isSuppressed(data.recipientEmail)) {
      return { skipped: "recipient suppressed" };
    }

    const past = await emailRepository.listPastRecipientForFollowUp(data.campaignId, data.recipientEmail);
    if (past.hasReply) {
      return { skipped: "reply already received" };
    }

    const rule = await followUpRuleRepository.findAt(data.campaignId, data.step);
    if (!rule) return { skipped: "rule missing" };

    // Regenerate a follow-up specifically tuned by the rule's body_instruction.
    // Prompts are kept unchanged; the AI service `generateEmailForBusiness` runs
    // against the same business facts. We adapt the target service string to
    // include the follow-up instruction so the copywriter shortens accordingly.
    const followInstruction = rule.bodyInstruction || "Short, polite bump referencing the first email.";
    const composed = await aiService.generateEmailForBusiness({
      businessId: data.businessId,
      senderName: data.senderName || "Sales",
      senderCompany: data.senderCompany || (data.orgName || "Outbound.AI"),
      targetService: data.targetService || "the same offer",
      valueProp: followInstruction,
      tone: data.tone || "Consultative",
    });

    const subject =
      rule.subjectPrefix && !composed.subject.toLowerCase().startsWith("re:")
        ? `${rule.subjectPrefix}${composed.subject}`
        : composed.subject;

    const row = await emailRepository.create({
      campaignId: data.campaignId,
      businessId: data.businessId,
      toEmail: data.recipientEmail,
      subject,
      bodyText: composed.bodyText,
      bodyHtml: composed.bodyHtml,
      openingLine: composed.openingLine,
      painPoints: composed.painPoints,
      benefits: composed.benefits,
      cta: composed.cta,
      confidenceScore: composed.confidenceScore,
      emailTone: composed.emailTone,
      status: "READY",
    });
    // Link back to the initial email + record step.
    await emailRepository.linkFollowUp(row.id, data.initialEmailId, data.step);

    await enqueueEmail(row.id, data.campaignId, {
      reason: "followup",
      followUpStep: data.step,
      orgName: data.orgName,
    });

    console.log(
      `[follow-up-worker] step ${data.step} scheduled email=${row.id} to=${data.recipientEmail}`
    );

    return { emailId: row.id, step: data.step };
  },
  {
    connection: bullConnection,
    concurrency: 2,
    lockDuration: 90_000,
  }
);

followUpWorker.on("failed", (job, err) => {
  console.warn(`[follow-up-worker] job ${job?.id} failed: ${(err?.message || "").slice(0, 200)}`);
});
