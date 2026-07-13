/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Request, Response } from "express";
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

export class LeadController {
  public static async getLeads(_req: Request, res: Response): Promise<void> {
    const data = await leadRepository.list();
    res.json({ success: true, data });
  }

  public static async updateLead(req: Request, res: Response): Promise<void> {
    const { leadId } = req.params;
    const updated = await leadRepository.update(leadId, req.body);
    if (!updated) {
      res.status(404).json({ success: false, error: "Lead not found." });
      return;
    }
    res.json({ success: true, lead: updated });
  }

  public static async updateLeadCrm(req: Request, res: Response): Promise<void> {
    const { leadId } = req.params;
    const { crmStage } = req.body;
    if (typeof crmStage !== "string" || crmStage.trim() === "") {
      res.status(400).json({ success: false, error: "crmStage is required." });
      return;
    }
    const updated = await leadRepository.update(leadId, { crmStage });
    if (!updated) {
      res.status(404).json({ success: false, error: "Lead not found." });
      return;
    }
    await logAudit(`Lead ${updated.email} moved to CRM stage '${crmStage}'`, "LEAD");
    res.json({ success: true, lead: updated });
  }

  public static async deleteLead(req: Request, res: Response): Promise<void> {
    const { leadId } = req.params;
    const lead = await leadRepository.findById(leadId);
    if (!lead) {
      res.status(404).json({ success: false, error: "Lead not found." });
      return;
    }
    await leadRepository.softDelete(leadId);
    await logAudit(`Lead ${lead.email} deleted`, "LEAD");
    res.json({ success: true });
  }

  public static async sendEmailNow(req: Request, res: Response): Promise<void> {
    const { leadId } = req.params;
    const lead = await leadRepository.findById(leadId);
    if (!lead) {
      res.status(404).json({ success: false, error: "Lead not found." });
      return;
    }
    const campaign = await campaignRepository.findById(lead.campaignId);
    if (!campaign) {
      res.status(404).json({ success: false, error: "Associated campaign not found." });
      return;
    }
    const smtps = await smtpRepository.listHealthy();
    const smtp = smtps.find((s) => !!s.smtpPassword);
    if (!smtp) {
      res.status(400).json({ success: false, error: "No healthy SMTP account with credentials configured." });
      return;
    }
    try {
      const { subject, body } = await aiService.composeInitialEmail(lead.id, campaign.id);
      await smtpService.sendRealSmtpEmail(smtp, lead.email, subject, body);
      await leadRepository.setStatus(lead.id, LeadStatus.SENT, { crmStage: "Contacted" });
      await smtpRepository.recordSend(smtp.id, smtp.warmupEnabled);
      await campaignRepository.incrementCounters(campaign.id, { sentCount: 1 });
      await logAudit(`Instant email to ${lead.email}`, "SMTP", { details: `via ${smtp.email}` });
      const refreshed = await leadRepository.findById(lead.id);
      res.json({ success: true, message: `Email dispatched to ${lead.email}`, lead: refreshed });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || "Send failed." });
    }
  }

  public static async enrichResearchLead(req: Request, res: Response): Promise<void> {
    const { leadId } = req.params;
    try {
      const lead = await aiService.enrichAndResearchLead(leadId);
      if (!lead) {
        res.status(404).json({ success: false, error: "Lead not found." });
        return;
      }
      res.json({ success: true, lead });
    } catch (err) {
      if (err instanceof GeminiNotConfiguredError) {
        res.status(503).json({ success: false, error: err.message });
        return;
      }
      res.status(500).json({ success: false, error: (err as Error).message });
    }
  }

  public static async bulkEnrichResearchLeads(req: Request, res: Response): Promise<void> {
    const { id: campaignId } = req.params;
    const batch = await leadRepository.listPendingNeedingResearch(campaignId, 5);
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
