/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The heart of Phase 5: the sequence engine.
 *
 * For a given campaign_prospect that is due to send:
 *   1. Re-check stop conditions. Stop if any trip.
 *   2. Load the SequenceStep for (campaign, current_step, ab_group).
 *      If no step exists, the sequence is complete.
 *   3. Compose the message (AI or manual) via sequenceComposer.
 *   4. Insert an `emails` row with prospect_id, sequence_step_index,
 *      ab_group set so downstream analytics can slice per-step.
 *   5. Enqueue the row on the standard email-send BullMQ queue with a
 *      pinned sender if the step requests one.
 *   6. Advance current_step + set next_send_at via workingCalendar.
 *
 * This replaces the *original path* for prospects that belong to a
 * campaign_prospects row. The classic "READY emails table + follow_up_rules"
 * path from Phase 3 still works unchanged for campaigns that were not
 * enrolled through the sequence engine.
 */

import {
  campaignRepository,
  campaignProspectRepository,
  sequenceStepRepository,
  leadRepository,
  emailRepository,
  CampaignProspect,
  SequenceStep,
} from "../db/repositories";
import { Campaign } from "../../src/types";
import { workingCalendarService } from "./workingCalendar.service";
import { sequenceComposerService } from "./sequenceComposer.service";
import { stopConditionService } from "./stopCondition.service";
import { enqueueEmail } from "../queues/emailQueue";
import { log } from "../observability/logger";

export interface AdvanceSummary {
  prospectId: string;
  status: "sent" | "stopped" | "skipped" | "no_step" | "error";
  reason?: string;
  emailId?: string;
  nextStep?: number;
  nextSendAt?: string;
  jobId?: string;
}

async function scheduleFirstStep(
  campaign: Campaign,
  prospect: CampaignProspect
): Promise<Date | null> {
  const firstStep = await sequenceStepRepository.findAt(campaign.id, 0, prospect.abGroup);
  if (!firstStep) return null;
  const earliest = new Date(Date.now() + firstStep.delayHours * 60 * 60 * 1000);
  const slot = await workingCalendarService.nextSendSlot({
    campaign: campaign as any,
    prospect,
    earliest,
  });
  return workingCalendarService.applyJitter(slot, campaign as any);
}

export const sequenceEngineService = {
  /**
   * Enrolls a lead into a campaign's sequence. Idempotent per (campaign,lead).
   * Computes an initial next_send_at using the campaign schedule + step 0
   * delay + jitter.
   */
  async enroll(input: {
    workspaceId: string;
    campaignId: string;
    leadId: string;
    businessId?: string;
    abGroup?: string;
    timezone?: string;
    startAt?: Date;
  }): Promise<CampaignProspect> {
    const lead = await leadRepository.findById(input.leadId);
    if (!lead) throw new Error(`Lead ${input.leadId} not found`);
    const campaign = await campaignRepository.findById(input.campaignId, input.workspaceId);
    if (!campaign) throw new Error(`Campaign ${input.campaignId} not found`);
    const enrolled = await campaignProspectRepository.enroll({
      workspaceId: input.workspaceId,
      campaignId: input.campaignId,
      leadId: input.leadId,
      businessId: input.businessId,
      abGroup: input.abGroup || "A",
      timezone: input.timezone || (lead as any).timezone,
    });
    try {
      const scheduledAt = input.startAt || (await scheduleFirstStep(campaign, enrolled));
      if (scheduledAt) {
        await campaignProspectRepository.setNextSend(enrolled.id, scheduledAt);
      }
    } catch (err: any) {
      log.warn(
        { err: err?.message, prospectId: enrolled.id, campaignId: campaign.id },
        "sequenceEngine.enroll: initial scheduling failed — prospect saved without next_send_at"
      );
      await campaignProspectRepository.recordError(enrolled.id, err?.message || "schedule failed");
    }
    const refreshed = await campaignProspectRepository.findById(enrolled.id);
    return refreshed || enrolled;
  },

  async enrollBulk(input: {
    workspaceId: string;
    campaignId: string;
    leadIds: string[];
    startAt?: Date;
  }): Promise<{ enrolled: number; skipped: number }> {
    let enrolled = 0;
    let skipped = 0;
    for (const leadId of input.leadIds) {
      try {
        await this.enroll({
          workspaceId: input.workspaceId,
          campaignId: input.campaignId,
          leadId,
          startAt: input.startAt,
        });
        enrolled++;
      } catch (err: any) {
        skipped++;
        log.warn({ err: err?.message, leadId }, "sequenceEngine: enrollment skipped");
      }
    }
    return { enrolled, skipped };
  },

  /**
   * Advance a single prospect: compose + enqueue + reschedule.
   * Never throws — returns an AdvanceSummary describing what happened.
   */
  async advanceProspect(prospectId: string): Promise<AdvanceSummary> {
    const prospect = await campaignProspectRepository.findById(prospectId);
    if (!prospect) return { prospectId, status: "error", reason: "prospect not found" };

    // Stop-condition gate.
    const stop = await stopConditionService.shouldStop(prospectId);
    if (stop.stop) {
      await campaignProspectRepository.setStatus(prospectId, "stopped", stop.reason);
      return { prospectId, status: "stopped", reason: stop.reason };
    }

    const campaign = await campaignRepository.findById(prospect.campaignId, prospect.workspaceId);
    if (!campaign) return { prospectId, status: "error", reason: "campaign not found" };

    // Find the step for current_step + ab_group; fall back to variant 'A'
    // if the prospect's AB variant has no step (e.g. only A is defined).
    let step: SequenceStep | null = await sequenceStepRepository.findAt(
      campaign.id,
      prospect.currentStep,
      prospect.abGroup
    );
    if (!step && prospect.abGroup !== "A") {
      step = await sequenceStepRepository.findAt(campaign.id, prospect.currentStep, "A");
    }
    if (!step) {
      await campaignProspectRepository.setStatus(prospectId, "completed", "no_more_steps");
      return { prospectId, status: "no_step", reason: "sequence ended" };
    }

    // Compose (AI or template) and persist an `emails` row.
    let composed;
    try {
      composed = await sequenceComposerService.compose({
        prospect,
        step,
        campaign: campaign as any,
        senderName: (campaign as any).senderName || "",
        senderCompany: (campaign as any).senderCompany || "",
        targetService: (campaign as any).goal || "",
      });
    } catch (err: any) {
      await campaignProspectRepository.recordError(prospectId, err?.message || "compose failed");
      return { prospectId, status: "error", reason: err?.message || "compose failed" };
    }

    const lead = await leadRepository.findById(prospect.leadId);
    if (!lead) return { prospectId, status: "error", reason: "lead vanished" };

    // Insert the emails row. followUpStep + sequence_step_index give downstream
    // dashboards a clean per-step breakdown.
    const row = await emailRepository.create({
      workspaceId: prospect.workspaceId,
      campaignId: prospect.campaignId,
      businessId: prospect.businessId,
      leadId: prospect.leadId,
      toEmail: lead.email,
      subject: composed.subject,
      bodyText: composed.bodyText,
      bodyHtml: composed.bodyHtml,
      openingLine: composed.personalization,
      confidenceScore: composed.confidence,
      emailTone: composed.tone,
      status: "READY",
    });

    // Wire prospect + step index + ab group onto the emails row.
    await pool_query(
      "UPDATE emails SET prospect_id = $1, sequence_step_index = $2, ab_group = $3, follow_up_step = $4 WHERE id = $5",
      [prospect.id, step.stepIndex, step.abGroup, step.stepIndex, row.id]
    );

    // Pin sender identity if the step has one.
    if (step.accountId) {
      await emailRepository.linkSender(row.id, step.accountId);
    }

    // Enqueue on the email-send worker.
    const jobId = await enqueueEmail(row.id, prospect.campaignId, {
      reason: step.stepIndex === 0 ? "initial" : "followup",
      followUpStep: step.stepIndex,
      orgName: (campaign as any).name,
    });

    // Compute next step's slot for scheduling.
    const nextStepIndex = prospect.currentStep + 1;
    const nextStep = await sequenceStepRepository.findAt(
      campaign.id,
      nextStepIndex,
      prospect.abGroup
    );
    let nextSendAt: Date | null = null;
    if (nextStep) {
      const earliest = new Date(Date.now() + nextStep.delayHours * 60 * 60 * 1000);
      const slot = await workingCalendarService.nextSendSlot({
        campaign: campaign as any,
        prospect,
        earliest,
      });
      nextSendAt = workingCalendarService.applyJitter(slot, campaign as any);
    }

    await campaignProspectRepository.markSent(prospect.id, nextStepIndex, nextSendAt);
    log.info(
      {
        prospectId, campaignId: prospect.campaignId, emailId: row.id,
        step: step.stepIndex, ab: step.abGroup, jobId, nextSendAt: nextSendAt?.toISOString(),
      },
      "sequenceEngine: advanced"
    );

    return {
      prospectId,
      status: "sent",
      emailId: row.id,
      nextStep: nextStepIndex,
      nextSendAt: nextSendAt?.toISOString(),
      jobId,
    };
  },

  /**
   * Preview: what would we send if we advanced this prospect right now?
   * Composes but does not persist / enqueue.
   */
  async previewNext(prospectId: string) {
    const prospect = await campaignProspectRepository.findById(prospectId);
    if (!prospect) throw new Error("prospect not found");
    const campaign = await campaignRepository.findById(prospect.campaignId, prospect.workspaceId);
    if (!campaign) throw new Error("campaign not found");
    const step = await sequenceStepRepository.findAt(campaign.id, prospect.currentStep, prospect.abGroup)
      ?? await sequenceStepRepository.findAt(campaign.id, prospect.currentStep, "A");
    if (!step) return { end: true };
    const composed = await sequenceComposerService.compose({
      prospect, step, campaign: campaign as any,
    });
    return {
      end: false,
      stepIndex: step.stepIndex,
      abGroup: step.abGroup,
      subject: composed.subject,
      bodyText: composed.bodyText,
      personalization: composed.personalization,
      tone: composed.tone,
      confidence: composed.confidence,
      usedAi: composed.usedAi,
    };
  },
};

// Local helper to avoid dragging pool import — keeps the file focused.
async function pool_query(sql: string, params: unknown[]) {
  const { pool } = await import("../db/pool");
  return pool.query(sql, params);
}
