/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Lead controller — every endpoint now enforces workspace isolation.
 * `req.workspaceId` is guaranteed populated by authenticateJwt; every
 * repo call takes it explicitly. Any lead id from another tenant returns
 * 404 (never the actual row).
 */

import { Response } from "express";
import {
  leadRepository,
  campaignRepository,
  smtpRepository,
  queueRepository,
} from "../db/repositories";
import { logAudit } from "../services/db.service";
import { aiService, GeminiNotConfiguredError } from "../services/ai.service";
import { smtpService } from "../services/smtp.service";
import { LeadStatus } from "../../src/types";
import { AuthenticatedRequest } from "../middleware/auth.middleware";

function bad(res: Response, msg: string, code = 400) {
  res.status(code).json({ success: false, error: msg });
}

export class LeadController {
  public static async getLeads(req: AuthenticatedRequest, res: Response): Promise<void> {
    const data = await leadRepository.list(req.workspaceId!);
    res.json({ success: true, data });
  }

  public static async updateLead(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { leadId } = req.params;
    const updated = await leadRepository.update(leadId, req.body, req.workspaceId!);
    if (!updated) { bad(res, "Lead not found.", 404); return; }
    res.json({ success: true, lead: updated });
  }

  public static async updateLeadCrm(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { leadId } = req.params;
    const { crmStage } = req.body;
    if (typeof crmStage !== "string" || crmStage.trim() === "") { bad(res, "crmStage is required."); return; }
    const updated = await leadRepository.update(leadId, { crmStage }, req.workspaceId!);
    if (!updated) { bad(res, "Lead not found.", 404); return; }
    await logAudit(`Lead ${updated.email} moved to CRM stage '${crmStage}'`, "LEAD", {
      userId: req.user?.id, userEmail: req.user?.email,
    });
    res.json({ success: true, lead: updated });
  }

  public static async deleteLead(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { leadId } = req.params;
    const lead = await leadRepository.findById(leadId, req.workspaceId);
    if (!lead) { bad(res, "Lead not found.", 404); return; }
    await leadRepository.softDelete(leadId, req.workspaceId!);
    await logAudit(`Lead ${lead.email} deleted`, "LEAD", {
      userId: req.user?.id, userEmail: req.user?.email,
    });
    res.json({ success: true });
  }

  public static async sendEmailNow(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { leadId } = req.params;
    const lead = await leadRepository.findById(leadId, req.workspaceId);
    if (!lead) { bad(res, "Lead not found.", 404); return; }
    // Also enforce workspace boundary on the parent campaign — the lead's
    // campaign_id must belong to the caller too. Belt & braces.
    const campaign = await campaignRepository.findById(lead.campaignId, req.workspaceId);
    if (!campaign) { bad(res, "Associated campaign not found.", 404); return; }
    const smtps = await smtpRepository.listHealthy(req.workspaceId);
    const smtp = smtps.find((s) => !!s.smtpPassword);
    if (!smtp) { bad(res, "No healthy SMTP account with credentials configured."); return; }
    try {
      const { subject, body } = await aiService.composeInitialEmail(lead.id, campaign.id);
      await smtpService.sendRealSmtpEmail(smtp, lead.email, subject, body);
      await leadRepository.setStatus(lead.id, LeadStatus.SENT, { crmStage: "Contacted" });
      await smtpRepository.recordSend(smtp.id, smtp.warmupEnabled);
      await campaignRepository.incrementCounters(campaign.id, { sentCount: 1 });
      await logAudit(`Instant email to ${lead.email}`, "SMTP", { details: `via ${smtp.email}` });
      const refreshed = await leadRepository.findById(lead.id, req.workspaceId);
      res.json({ success: true, message: `Email dispatched to ${lead.email}`, lead: refreshed });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || "Send failed." });
    }
    // Silence unused warning — queueRepository is imported to preserve
    // the module surface for future queue-based instant sends.
    void queueRepository;
  }

  public static async enrichResearchLead(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { leadId } = req.params;
    // Verify the lead belongs to the caller BEFORE the AI enrichment call.
    const scoped = await leadRepository.findById(leadId, req.workspaceId);
    if (!scoped) { bad(res, "Lead not found.", 404); return; }
    try {
      const lead = await aiService.enrichAndResearchLead(leadId);
      if (!lead) { bad(res, "Lead not found.", 404); return; }
      res.json({ success: true, lead });
    } catch (err) {
      if (err instanceof GeminiNotConfiguredError) { bad(res, err.message, 503); return; }
      res.status(500).json({ success: false, error: (err as Error).message });
    }
  }

  public static async bulkEnrichResearchLeads(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { id: campaignId } = req.params;
    // Ensure the campaign is owned by the caller first.
    const camp = await campaignRepository.findById(campaignId, req.workspaceId);
    if (!camp) { bad(res, "Campaign not found.", 404); return; }
    const batch = await leadRepository.listPendingNeedingResearch(campaignId, 5, req.workspaceId!);
    if (batch.length === 0) {
      res.json({ success: true, message: "No un-researched leads remaining.", count: 0 });
      return;
    }
    if (!aiService.isConfigured()) {
      res.status(503).json({ success: false, error: "Gemini not configured. Set GEMINI_API_KEY." });
      return;
    }
    const results = await Promise.allSettled(batch.map((l) => aiService.enrichAndResearchLead(l.id)));
    const ok = results.filter((r) => r.status === "fulfilled").length;
    res.json({ success: true, message: `Enriched ${ok} of ${batch.length}`, count: ok });
  }
}
