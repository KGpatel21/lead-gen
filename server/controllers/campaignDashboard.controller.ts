/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 5 campaign analytics dashboard.
 *
 * GET /api/campaigns/:id/dashboard    → per-campaign funnel
 * GET /api/campaigns/dashboard        → workspace-wide summary (all campaigns)
 *
 * Metrics: queued, sending, completed, paused, failed, waiting,
 * current step / upcoming step, reply rate, open rate, bounce rate,
 * meeting rate, unsub rate — per campaign, per sender, per provider.
 */

import { Response } from "express";
import { WorkspaceScopedRequest } from "../middleware/workspaceContext.middleware";
import { pool } from "../db/pool";
import { campaignRepository, campaignProspectRepository, sequenceStepRepository } from "../db/repositories";
import { emailQueue } from "../queues/emailQueue";
import { sequenceAdvanceQueue } from "../queues/sequenceTickQueue";

function rate(numer: number, denom: number): number {
  if (denom <= 0) return 0;
  return Math.round((numer / denom) * 1000) / 10;
}

async function statusBucketByCampaign(workspaceId: string, campaignId: string) {
  const r = await pool.query(
    `SELECT status, COUNT(*)::int AS n FROM emails
     WHERE workspace_id = $1 AND campaign_id = $2
     GROUP BY status`,
    [workspaceId, campaignId]
  );
  const buckets: Record<string, number> = {
    READY: 0, RETRY: 0, SENDING: 0, SENT: 0, FAILED: 0, PAUSED: 0, CANCELLED: 0, BOUNCED: 0, COMPLAINED: 0, GENERATING: 0, PENDING: 0,
  };
  for (const row of r.rows) buckets[row.status] = row.n;
  return buckets;
}

async function eventCounts(workspaceId: string, campaignId: string) {
  const r = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'SENT') AS sent,
       COUNT(*) FILTER (WHERE opened_at IS NOT NULL) AS opened,
       COUNT(*) FILTER (WHERE clicked_at IS NOT NULL) AS clicked,
       COUNT(*) FILTER (WHERE reply_received_at IS NOT NULL) AS replied,
       COUNT(*) FILTER (WHERE bounced_at IS NOT NULL) AS bounced,
       COUNT(*) FILTER (WHERE complained_at IS NOT NULL) AS complained
     FROM emails
     WHERE workspace_id = $1 AND campaign_id = $2`,
    [workspaceId, campaignId]
  );
  const row = r.rows[0] || {};
  return {
    sent: Number(row.sent || 0),
    opened: Number(row.opened || 0),
    clicked: Number(row.clicked || 0),
    replied: Number(row.replied || 0),
    bounced: Number(row.bounced || 0),
    complained: Number(row.complained || 0),
  };
}

async function meetingsCount(workspaceId: string, campaignId: string): Promise<number> {
  const r = await pool.query(
    `SELECT COUNT(*)::int AS n FROM replies
     WHERE workspace_id = $1 AND campaign_id = $2
       AND (category = 'Meeting Requested' OR sentiment = 'Meeting')`,
    [workspaceId, campaignId]
  );
  return r.rows[0]?.n || 0;
}

async function unsubCount(workspaceId: string, campaignId: string): Promise<number> {
  const r = await pool.query(
    `SELECT COUNT(*)::int AS n FROM email_suppressions
     WHERE workspace_id = $1 AND campaign_id = $2 AND LOWER(reason) IN ('unsubscribe','unsubscribed')`,
    [workspaceId, campaignId]
  );
  return r.rows[0]?.n || 0;
}

async function perSender(workspaceId: string, campaignId: string) {
  const r = await pool.query(
    `SELECT e.sender_identity_id AS account_id, ea.email, ea.provider,
            COUNT(*) FILTER (WHERE e.status = 'SENT')::int AS sent,
            COUNT(*) FILTER (WHERE e.opened_at IS NOT NULL)::int AS opened,
            COUNT(*) FILTER (WHERE e.reply_received_at IS NOT NULL)::int AS replied,
            COUNT(*) FILTER (WHERE e.bounced_at IS NOT NULL)::int AS bounced
       FROM emails e
       LEFT JOIN email_accounts ea ON ea.id = e.sender_identity_id
       WHERE e.workspace_id = $1 AND e.campaign_id = $2
             AND e.sender_identity_id IS NOT NULL
       GROUP BY e.sender_identity_id, ea.email, ea.provider`,
    [workspaceId, campaignId]
  );
  return r.rows.map((row) => ({
    accountId: row.account_id,
    email: row.email,
    provider: row.provider,
    sent: Number(row.sent || 0),
    opened: Number(row.opened || 0),
    replied: Number(row.replied || 0),
    bounced: Number(row.bounced || 0),
    openRate: rate(Number(row.opened || 0), Number(row.sent || 0)),
    replyRate: rate(Number(row.replied || 0), Number(row.sent || 0)),
  }));
}

async function perProvider(workspaceId: string, campaignId: string) {
  const r = await pool.query(
    `SELECT COALESCE(e.provider, ea.provider) AS provider,
            COUNT(*) FILTER (WHERE e.status = 'SENT')::int AS sent,
            COUNT(*) FILTER (WHERE e.reply_received_at IS NOT NULL)::int AS replied,
            COUNT(*) FILTER (WHERE e.bounced_at IS NOT NULL)::int AS bounced
       FROM emails e
       LEFT JOIN email_accounts ea ON ea.id = e.sender_identity_id
       WHERE e.workspace_id = $1 AND e.campaign_id = $2
       GROUP BY COALESCE(e.provider, ea.provider)`,
    [workspaceId, campaignId]
  );
  return r.rows
    .filter((row) => row.provider)
    .map((row) => ({
      provider: row.provider,
      sent: Number(row.sent || 0),
      replied: Number(row.replied || 0),
      bounced: Number(row.bounced || 0),
      replyRate: rate(Number(row.replied || 0), Number(row.sent || 0)),
    }));
}

async function nextUpcoming(campaignId: string): Promise<{ prospectId: string; step: number; when: string | null } | null> {
  const r = await pool.query(
    `SELECT id, current_step, next_send_at
       FROM campaign_prospects
      WHERE campaign_id = $1 AND status = 'active' AND next_send_at IS NOT NULL
      ORDER BY next_send_at ASC
      LIMIT 1`,
    [campaignId]
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    prospectId: row.id,
    step: row.current_step ?? 0,
    when: row.next_send_at ? new Date(row.next_send_at).toISOString() : null,
  };
}

async function stopReasonBreakdown(campaignId: string) {
  const r = await pool.query(
    `SELECT stop_reason, COUNT(*)::int AS n FROM campaign_prospects
     WHERE campaign_id = $1 AND stop_reason IS NOT NULL
     GROUP BY stop_reason`,
    [campaignId]
  );
  const out: Record<string, number> = {};
  for (const row of r.rows) out[row.stop_reason] = row.n;
  return out;
}

async function buildCampaignSummary(workspaceId: string, campaignId: string) {
  const camp = await campaignRepository.findById(campaignId, workspaceId);
  if (!camp) return null;
  const [buckets, ev, meetings, unsubs, senders, providers, prospectStats, upcoming, stopReasons, stepCount] =
    await Promise.all([
      statusBucketByCampaign(workspaceId, campaignId),
      eventCounts(workspaceId, campaignId),
      meetingsCount(workspaceId, campaignId),
      unsubCount(workspaceId, campaignId),
      perSender(workspaceId, campaignId),
      perProvider(workspaceId, campaignId),
      campaignProspectRepository.statsByCampaign(campaignId),
      nextUpcoming(campaignId),
      stopReasonBreakdown(campaignId),
      sequenceStepRepository.countActive(campaignId),
    ]);
  return {
    id: camp.id,
    name: camp.name,
    status: camp.status,
    createdAt: camp.createdAt,
    updatedAt: camp.updatedAt,
    buckets: {
      queued:    buckets.READY + buckets.PENDING + buckets.GENERATING,
      sending:   buckets.SENDING,
      completed: buckets.SENT,
      paused:    buckets.PAUSED,
      failed:    buckets.FAILED,
      waiting:   buckets.RETRY,
      cancelled: buckets.CANCELLED,
      bounced:   buckets.BOUNCED,
      complained: buckets.COMPLAINED,
    },
    rates: {
      openRate:   rate(ev.opened,    ev.sent),
      replyRate:  rate(ev.replied,   ev.sent),
      bounceRate: rate(ev.bounced,   ev.sent),
      meetingRate: rate(meetings,    ev.sent),
      unsubRate:  rate(unsubs,       ev.sent),
      clickRate:  rate(ev.clicked,   ev.sent),
    },
    counts: {
      ...ev,
      meetings,
      unsubs,
    },
    prospects: prospectStats,
    stopReasons,
    upcoming,
    currentStepMax: stepCount,
    perSender: senders,
    perProvider: providers,
  };
}

export class CampaignDashboardController {
  public static async workspace(req: WorkspaceScopedRequest, res: Response): Promise<void> {
    const campaigns = await campaignRepository.list(req.workspaceId);
    const summaries = await Promise.all(
      campaigns.map((c) => buildCampaignSummary(req.workspaceId!, c.id))
    );
    const [emailQueueCounts, advanceQueueCounts] = await Promise.all([
      emailQueue.getJobCounts("waiting", "delayed", "prioritized", "active", "completed", "failed").catch(() => ({})),
      sequenceAdvanceQueue.getJobCounts("waiting", "delayed", "prioritized", "active", "completed", "failed").catch(() => ({})),
    ]);
    res.json({
      success: true,
      workspaceId: req.workspaceId,
      queues: {
        emailSend: emailQueueCounts,
        sequenceAdvance: advanceQueueCounts,
      },
      campaigns: summaries.filter(Boolean),
    });
  }

  public static async oneCampaign(req: WorkspaceScopedRequest, res: Response): Promise<void> {
    const summary = await buildCampaignSummary(req.workspaceId!, req.params.id);
    if (!summary) { res.status(404).json({ success: false, error: "campaign not found" }); return; }
    res.json({ success: true, dashboard: summary });
  }
}
