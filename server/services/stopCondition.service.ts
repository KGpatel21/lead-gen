/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Centralized stop-condition evaluator.
 *
 * The sequence engine calls `shouldStop(prospectId)` before every send.
 * If any of these are true, we set the prospect's status to 'stopped'
 * and record the reason:
 *
 *   - replied            (any inbound reply linked to this prospect's lead)
 *   - meeting_booked     (reply.category === 'Meeting Requested')
 *   - unsubscribed       (workspace-scoped email_suppressions with reason 'unsubscribe')
 *   - bounced            (permanent bounce)
 *   - complained         (SES complaint)
 *   - manual             (user click)
 *   - campaign_paused    (campaign.status === PAUSED)
 *   - closed             (lead.crm_stage === 'closed_won' | 'closed_lost')
 *
 * The suppression/bounce/reply hooks also expose *push* functions so the
 * SES-events handler and reply-sync worker can proactively stop prospects
 * the moment the signal arrives (rather than waiting for the next
 * scheduled send).
 */

import { pool } from "../db/pool";
import {
  campaignRepository,
  campaignProspectRepository,
  leadRepository,
  StopReason,
} from "../db/repositories";
import { CampaignStatus } from "../../src/types";
import { log } from "../observability/logger";

export interface StopDecision {
  stop: boolean;
  reason?: StopReason;
}

async function findLeadEmail(leadId: string): Promise<string | null> {
  const lead = await leadRepository.findById(leadId);
  return lead?.email?.toLowerCase() || null;
}

export const stopConditionService = {
  async shouldStop(prospectId: string): Promise<StopDecision> {
    const prospect = await campaignProspectRepository.findById(prospectId);
    if (!prospect) return { stop: true, reason: "manual" };
    if (prospect.status === "stopped") return { stop: true, reason: prospect.stopReason };
    if (prospect.status === "paused") return { stop: true, reason: "campaign_paused" };
    if (prospect.status === "completed") return { stop: true, reason: "no_more_steps" };

    const campaign = await campaignRepository.findById(prospect.campaignId);
    if (!campaign || campaign.deletedAt) return { stop: true, reason: "campaign_completed" };
    if (campaign.status === CampaignStatus.PAUSED) return { stop: true, reason: "campaign_paused" };
    if (campaign.status === CampaignStatus.COMPLETED) return { stop: true, reason: "campaign_completed" };

    const email = await findLeadEmail(prospect.leadId);
    if (!email) return { stop: true, reason: "manual" };

    // Suppression check (workspace-scoped).
    const supp = await pool.query(
      `SELECT reason FROM email_suppressions
       WHERE workspace_id = $1 AND LOWER(email) = $2 LIMIT 1`,
      [prospect.workspaceId, email]
    );
    if (supp.rows[0]) {
      const r = String(supp.rows[0].reason || "").toLowerCase();
      if (r === "bounce" || r === "bounced") return { stop: true, reason: "bounced" };
      if (r === "complaint" || r === "complained") return { stop: true, reason: "complained" };
      if (r === "unsubscribe" || r === "unsubscribed") return { stop: true, reason: "unsubscribed" };
      return { stop: true, reason: "manual" };
    }

    // Reply check — any past email in this campaign for this recipient has a reply.
    const replied = await pool.query(
      `SELECT reply_received_at, id FROM emails
       WHERE campaign_id = $1 AND LOWER(to_email) = $2 AND reply_received_at IS NOT NULL
       LIMIT 1`,
      [prospect.campaignId, email]
    );
    if (replied.rows[0]) return { stop: true, reason: "replied" };

    // Meeting-booked check: a reply with category = 'Meeting Requested' for
    // this workspace + campaign + reply from this recipient.
    const meeting = await pool.query(
      `SELECT 1 FROM replies
       WHERE workspace_id = $1 AND campaign_id = $2
         AND LOWER(from_email) = $3
         AND (category = 'Meeting Requested' OR sentiment = 'Meeting')
       LIMIT 1`,
      [prospect.workspaceId, prospect.campaignId, email]
    );
    if ((meeting.rowCount ?? 0) > 0) return { stop: true, reason: "meeting_booked" };

    // Lead CRM closed.
    const closed = await pool.query(
      `SELECT crm_stage FROM leads WHERE id = $1`,
      [prospect.leadId]
    );
    const stage = String(closed.rows[0]?.crm_stage || "").toLowerCase();
    if (stage.includes("closed") || stage === "won" || stage === "lost") {
      return { stop: true, reason: "closed" };
    }

    return { stop: false };
  },

  /**
   * Push-side: a reply just landed. Stop this recipient across every active
   * campaign in the workspace. Called by mailboxSync.service after a
   * successful upsert.
   */
  async onReplyReceived(workspaceId: string, recipientEmail: string, isMeeting: boolean = false): Promise<number> {
    const reason: StopReason = isMeeting ? "meeting_booked" : "replied";
    const n = await campaignProspectRepository.stopByEmailAcrossWorkspace(
      workspaceId,
      recipientEmail.toLowerCase(),
      reason
    );
    if (n > 0) {
      log.info({ workspaceId, recipientEmail, stopped: n, reason }, "stopCondition: replies stopped prospects");
    }
    return n;
  },

  async onBounced(workspaceId: string, recipientEmail: string): Promise<number> {
    return campaignProspectRepository.stopByEmailAcrossWorkspace(
      workspaceId,
      recipientEmail.toLowerCase(),
      "bounced"
    );
  },

  async onComplained(workspaceId: string, recipientEmail: string): Promise<number> {
    return campaignProspectRepository.stopByEmailAcrossWorkspace(
      workspaceId,
      recipientEmail.toLowerCase(),
      "complained"
    );
  },

  async onUnsubscribed(workspaceId: string, recipientEmail: string): Promise<number> {
    return campaignProspectRepository.stopByEmailAcrossWorkspace(
      workspaceId,
      recipientEmail.toLowerCase(),
      "unsubscribed"
    );
  },
};
