/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Request, Response } from "express";
import { config } from "../config";
import { pool } from "../db/pool";
import {
  campaignRepository,
  leadRepository,
  smtpRepository,
  domainRepository,
  replyRepository,
  queueRepository,
  agentRepository,
  DEFAULT_AGENTS,
} from "../db/repositories";
import { queueService } from "../services/queue.service";
import { aiService, GeminiNotConfiguredError } from "../services/ai.service";
import { logAudit } from "../services/db.service";
import { CampaignStatus, ReplySentiment } from "../../src/types";
import { AuthenticatedRequest } from "../middleware/auth.middleware";

export class SystemController {
  public static async getDashboardStats(_req: Request, res: Response): Promise<void> {
    const [campaigns, activeSmtps, activeDomains] = await Promise.all([
      campaignRepository.list(),
      smtpRepository.list(),
      domainRepository.list(),
    ]);

    const totalSent = campaigns.reduce((s, c) => s + c.sentCount, 0);
    const totalOpen = campaigns.reduce((s, c) => s + c.openCount, 0);
    const totalReply = campaigns.reduce((s, c) => s + c.replyCount, 0);
    const totalBounce = campaigns.reduce((s, c) => s + c.bounceCount, 0);

    const avgOpenRate   = totalSent > 0 ? Math.round((totalOpen   / totalSent) * 100) : 0;
    const avgReplyRate  = totalSent > 0 ? Math.round((totalReply  / totalSent) * 100) : 0;
    const avgBounceRate = totalSent > 0 ? Math.round((totalBounce / totalSent) * 100) : 0;

    const activeCampaignsCount = campaigns.filter((c) => c.status === CampaignStatus.RUNNING).length;
    const avgReputation = activeSmtps.length > 0
      ? Math.round(activeSmtps.reduce((s, x) => s + x.reputationScore, 0) / activeSmtps.length)
      : 0;
    const avgDomainHealth = activeDomains.length > 0
      ? Math.round(activeDomains.reduce((s, x) => s + x.healthScore, 0) / activeDomains.length)
      : 0;

    // Real 7-day timeline from queue.sent + replies received (Postgres-authoritative)
    const timelineQ = await pool.query(
      `WITH days AS (
         SELECT generate_series(CURRENT_DATE - INTERVAL '6 days', CURRENT_DATE, INTERVAL '1 day')::date AS d
       )
       SELECT
         d,
         COALESCE((SELECT COUNT(*)::int FROM queue    WHERE status='SENT' AND DATE(last_attempt) = d), 0) AS sent,
         COALESCE((SELECT COUNT(*)::int FROM replies  WHERE deleted_at IS NULL AND DATE(received_at) = d), 0) AS replies
       FROM days ORDER BY d ASC`
    );
    const sentOverTime = timelineQ.rows.map((r: any) => ({
      date: new Date(r.d).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      sent: r.sent,
      opens: 0,
      replies: r.replies,
    }));
    const domainReputationTrend = sentOverTime.map((row) => ({ date: row.date, avgScore: avgDomainHealth }));
    const warmupTrend = sentOverTime.map((row) => ({ date: row.date, sent: 0, recovered: 0 }));

    const sentimentCounts = await replyRepository.recentSentimentCounts();
    const repliesSentimentBreakdown = [
      { name: "Interested",       value: sentimentCounts[ReplySentiment.INTERESTED]     || 0, color: "#10B981" },
      { name: "Not Interested",   value: sentimentCounts[ReplySentiment.NOT_INTERESTED] || 0, color: "#9CA3AF" },
      { name: "Meeting Booked",   value: sentimentCounts[ReplySentiment.MEETING]        || 0, color: "#3B82F6" },
      { name: "Spam",             value: sentimentCounts[ReplySentiment.SPAM]           || 0, color: "#EF4444" },
    ];

    const recent = (await replyRepository.list()).slice(0, 5);

    res.json({
      totalSent,
      avgOpenRate,
      avgReplyRate,
      avgBounceRate,
      activeCampaignsCount,
      avgReputation,
      avgDomainHealth,
      recentReplies: recent,
      timeline: { sentOverTime, domainReputationTrend, warmupTrend, repliesSentimentBreakdown },
    });
  }

  /**
   * Dev-only: fully clears user-generated data. Never runs in production.
   */
  public static async clearDatabase(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (config.isProduction) {
      res.status(403).json({ success: false, error: "Not available in production." });
      return;
    }
    await pool.query(
      "TRUNCATE queue, agent_logs, entity_history, audit_logs, replies, leads, campaigns, templates, domains, smtp_accounts, team_members, users RESTART IDENTITY CASCADE"
    );
    await agentRepository.ensureDefaults(DEFAULT_AGENTS);
    await logAudit("Database wiped (dev-only endpoint)", "SECURITY", {
      userId: req.user?.id,
      userEmail: req.user?.email,
      ipAddress: req.ip,
    });
    res.json({ success: true, message: "Database wiped." });
  }

  public static async getReplies(_req: Request, res: Response): Promise<void> {
    const data = await replyRepository.list();
    res.json({ success: true, data });
  }

  public static async readReply(req: Request, res: Response): Promise<void> {
    await replyRepository.markRead(req.params.id);
    const r = await replyRepository.findById(req.params.id);
    if (!r) {
      res.status(404).json({ success: false, error: "Reply not found." });
      return;
    }
    res.json({ success: true, reply: r });
  }

  public static async sendReplyMessage(req: Request, res: Response): Promise<void> {
    const { id } = req.params;
    const { messageText } = req.body;
    if (typeof messageText !== "string" || messageText.trim() === "") {
      res.status(400).json({ success: false, error: "messageText is required." });
      return;
    }
    const reply = await replyRepository.findById(id);
    if (!reply) {
      res.status(404).json({ success: false, error: "Reply not found." });
      return;
    }
    // Real outbound send from an inbox requires a linked SMTP account.
    // For now, log the manual response — Phase 2 wires IMAP/SMTP threading.
    await logAudit(`Manual reply drafted to ${reply.leadEmail}`, "REPLY", {
      details: messageText.slice(0, 200),
    });
    res.json({ success: true, message: "Response recorded. Outbound send will ship in Phase 2 (IMAP threading)." });
  }

  public static async generateAiReply(req: Request, res: Response): Promise<void> {
    const reply = await replyRepository.findById(req.params.id);
    if (!reply) {
      res.status(404).json({ success: false, error: "Reply not found." });
      return;
    }
    try {
      const result = await aiService.classifySentimentAndDraftReply(reply.body);
      await replyRepository.setSentiment(reply.id, result.sentiment);
      res.json({ success: true, ...result });
    } catch (err) {
      if (err instanceof GeminiNotConfiguredError) {
        res.status(503).json({ success: false, error: err.message });
        return;
      }
      res.status(500).json({ success: false, error: (err as Error).message });
    }
  }

  public static async getAgents(_req: Request, res: Response): Promise<void> {
    const data = await agentRepository.list();
    res.json({ success: true, data });
  }

  public static async getAgentLogs(_req: Request, res: Response): Promise<void> {
    const data = await agentRepository.listLogs(200);
    res.json({ success: true, data });
  }

  public static async runAgentTask(req: Request, res: Response): Promise<void> {
    const { id } = req.params;
    const { inputPayload } = req.body;
    if (typeof inputPayload !== "string" || inputPayload.trim() === "") {
      res.status(400).json({ success: false, error: "inputPayload is required." });
      return;
    }
    try {
      const output = await aiService.runAgent(id, inputPayload);
      res.json({ success: true, output });
    } catch (err) {
      if (err instanceof GeminiNotConfiguredError) {
        res.status(503).json({ success: false, error: err.message });
        return;
      }
      res.status(500).json({ success: false, error: (err as Error).message });
    }
  }

  public static async getQueue(req: Request, res: Response): Promise<void> {
    const campaignId = (req.query.campaignId as string) || undefined;
    const status = (req.query.status as any) || undefined;
    const page = parseInt((req.query.page as string) || "1", 10);
    const limit = Math.min(200, parseInt((req.query.limit as string) || "50", 10));
    const { items, total } = await queueRepository.listPage({ campaignId, status }, page, limit);
    res.json({ success: true, data: items, meta: { page, limit, total } });
  }

  public static async retryQueueItem(req: Request, res: Response): Promise<void> {
    const ok = await queueService.retryQueueItem(req.params.id);
    if (!ok) {
      res.status(404).json({ success: false, error: "Queue item not found." });
      return;
    }
    res.json({ success: true });
  }

  public static async retryCampaignQueue(req: Request, res: Response): Promise<void> {
    const n = await queueService.retryCampaignQueue(req.params.campaignId);
    res.json({ success: true, message: `Re-queued ${n} failed dispatches.` });
  }

  public static async deleteQueueItem(req: Request, res: Response): Promise<void> {
    const ok = await queueService.deleteQueueItem(req.params.id);
    if (!ok) {
      res.status(404).json({ success: false, error: "Queue item not found." });
      return;
    }
    res.json({ success: true });
  }

  public static async clearFailedQueue(_req: Request, res: Response): Promise<void> {
    const n = await queueService.clearFailedItems();
    res.json({ success: true, message: `Pruned ${n} failed queue records.` });
  }

  /**
   * Automation actions kicked from the UI. Previously this endpoint fabricated
   * fake leads (Math.random pick from hardcoded arrays) and fake incoming
   * replies. Those behaviors are gone — every real action requires real inputs.
   */
  public static async triggerAutomationTask(req: Request, res: Response): Promise<void> {
    const { task } = req.body;

    if (task === "sending") {
      const { queueWorker } = await import("../workers/queue.worker");
      await queueWorker.runWorkerStep();
      res.json({ success: true, message: "Queue worker sweep executed." });
      return;
    }

    if (task === "lead-research" || task === "email-generation") {
      // Kick the next un-researched lead through Gemini enrichment.
      const pendingCampaigns = (await campaignRepository.list()).filter((c) => c.status === CampaignStatus.RUNNING);
      for (const c of pendingCampaigns) {
        const batch = await leadRepository.listPendingNeedingResearch(c.id, 1);
        if (batch.length > 0) {
          try {
            const lead = await aiService.enrichAndResearchLead(batch[0].id);
            res.json({ success: true, message: `Enrichment complete for ${lead?.company}`, lead });
            return;
          } catch (err) {
            if (err instanceof GeminiNotConfiguredError) {
              res.status(503).json({ success: false, error: err.message });
              return;
            }
            res.status(500).json({ success: false, error: (err as Error).message });
            return;
          }
        }
      }
      res.json({ success: true, message: "All leads in running campaigns already have AI enrichment." });
      return;
    }

    if (task === "lead-import" || task === "reply-detection") {
      // Simulator endpoints removed. Real leads come from CSV/manual/autopilot;
      // real replies will come from Phase 2 IMAP ingestion.
      res.status(410).json({
        success: false,
        error:
          "Simulator removed. Use CSV upload / Autopilot for leads, or wait for Phase 2 IMAP ingestion for replies.",
      });
      return;
    }

    res.status(400).json({ success: false, error: `Unsupported automation task: ${task}` });
  }

  /**
   * Autopilot: run Gemini + Google Search grounding to prospect a topic and
   * write the results into a new campaign. No fake fallback anymore — if
   * Gemini isn't configured we return 503.
   */
  public static async dispatchAutopilotSearch(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { topic, platforms, count } = req.body;
    if (typeof topic !== "string" || topic.trim() === "") {
      res.status(400).json({ success: false, error: "Topic is required." });
      return;
    }
    const parsedCount = typeof count === "number" && count > 0 && count <= 100 ? count : 10;

    // Resolve platform filter deterministically (no random).
    const t = topic.toLowerCase();
    let platform = "LinkedIn";
    if ((platforms && String(platforms).toLowerCase().includes("map")) || t.includes("google maps") || t.includes("maps")) platform = "Google Maps";
    else if ((platforms && String(platforms).toLowerCase().includes("instagram")) || t.includes("instagram") || t.includes(" ig ")) platform = "Instagram";
    else if ((platforms && String(platforms).toLowerCase().includes("twitter")) || t.includes("twitter")) platform = "Twitter";

    try {
      const result = await aiService.autopilotProspect({ topic: topic.trim(), platform, count: parsedCount });

      // Persist as a new campaign + leads.
      const cleanTopic = topic.replace(/[^a-zA-Z0-9 ]/g, "").substring(0, 30).trim();
      const campaign = await campaignRepository.create({
        name: `Autonomous [${cleanTopic}] — ${new Date().toISOString().slice(0, 16)}`,
        status: CampaignStatus.DRAFT,
        subjectTemplate: `Quick question regarding {{company}}'s scaling metrics`,
        bodyTemplate:
          "Hi {{firstName}},\n\n{{personalizedLine}}\n\nWe help teams like {{company}} scale their outbound. Have 5 minutes this week?\n\nBest,\n" + (req.user?.email || ""),
      });

      const createdLeads = await leadRepository.bulkCreate(
        (result.prospects || []).map((p) => ({
          campaignId: campaign.id,
          email: p.email || `hello@${(p.company || "prospect").toLowerCase().replace(/[^a-z0-9]/g, "")}.com`,
          firstName: p.firstName,
          lastName: p.lastName,
          company: p.company,
          personalizedLine: p.personalizedLine,
          phone: p.phone,
          platform: p.platform || platform,
          profileUrl: p.profileUrl,
          descriptionMeta: p.descriptionMeta,
          proposedService: p.proposedService,
        }))
      );

      await agentRepository.logRun({
        agentId: "agent-lead-hunter",
        input: `Autopilot: "${topic}" on ${platform} (${parsedCount})`,
        output: `Compiled ${createdLeads.length} prospects. Strategy: ${result.strategy?.slice(0, 200)}`,
        status: "SUCCESS",
      });

      res.json({ success: true, strategy: result.strategy, campaign, leads: createdLeads });
    } catch (err) {
      if (err instanceof GeminiNotConfiguredError) {
        res.status(503).json({ success: false, error: err.message });
        return;
      }
      res.status(500).json({ success: false, error: (err as Error).message });
    }
  }

  public static async verifyDiagnostics(_req: Request, res: Response): Promise<void> {
    const [campaignCount, queueStats, activeSmtps, activeDomains, replies, leads] = await Promise.all([
      campaignRepository.list().then((r) => r.length),
      queueRepository.stats(),
      smtpRepository.list().then((r) => r.length),
      domainRepository.list().then((r) => r.length),
      replyRepository.list().then((r) => r.length),
      leadRepository.list().then((r) => r.length),
    ]);
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      counts: { campaignCount, activeSmtps, activeDomains, replies, leads, queue: queueStats.total },
      queueBreakdown: queueStats,
      aiConfigured: aiService.isConfigured(),
    });
  }
}
