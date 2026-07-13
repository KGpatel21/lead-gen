/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Request, Response } from "express";
import { dbService } from "../services/db.service";
import { aiService } from "../services/ai.service";
import { LeadStatus } from "../../src/types";

export class LeadController {
  public static getLeads(req: Request, res: Response) {
    const dbState = dbService.getState();
    const activeLeads = dbState.leads.filter(l => !l.deletedAt);
    res.json({ success: true, data: activeLeads });
  }

  public static updateLead(req: Request, res: Response) {
    const { leadId } = req.params;
    const dbState = dbService.getState();
    const lead = dbState.leads.find(l => l.id === leadId && !l.deletedAt);
    if (!lead) {
      res.status(404).json({ success: false, error: "Lead not found." });
      return;
    }

    const fields = ["firstName", "lastName", "company", "email", "status", "personalizedLine"];
    for (const f of fields) {
      if (req.body[f] !== undefined) {
        (lead as any)[f] = req.body[f];
      }
    }

    lead.updatedAt = new Date().toISOString();
    dbService.saveDb();
    res.json({ success: true, lead });
  }

  public static updateLeadCrm(req: Request, res: Response) {
    const { leadId } = req.params;
    const { crmStage } = req.body;
    if (!crmStage) {
      res.status(400).json({ success: false, error: "crmStage parameter is required." });
      return;
    }

    const dbState = dbService.getState();
    const lead = dbState.leads.find(l => l.id === leadId && !l.deletedAt);
    if (!lead) {
      res.status(404).json({ success: false, error: "Lead not found." });
      return;
    }

    lead.crmStage = crmStage;
    lead.updatedAt = new Date().toISOString();
    dbService.saveDb();
    dbService.logAudit(`Lead ${lead.email} CRM stage updated to '${crmStage}'`, "LEAD");

    res.json({ success: true, lead });
  }

  public static deleteLead(req: Request, res: Response) {
    const { leadId } = req.params;
    const dbState = dbService.getState();
    const lead = dbState.leads.find(l => l.id === leadId && !l.deletedAt);
    if (!lead) {
      res.status(404).json({ success: false, error: "Lead not found." });
      return;
    }

    lead.deletedAt = new Date().toISOString();
    dbService.saveDb();
    dbService.logAudit(`Lead ${lead.email} deleted`, "LEAD");

    res.json({ success: true, message: "Lead soft-deleted successfully." });
  }

  public static async sendEmailNow(req: Request, res: Response) {
    const { leadId } = req.params;
    const dbState = dbService.getState();
    const lead = dbState.leads.find(l => l.id === leadId && !l.deletedAt);
    if (!lead) {
      res.status(404).json({ success: false, error: "Lead not found." });
      return;
    }

    const campaign = dbState.campaigns.find(c => c.id === lead.campaignId);
    if (!campaign) {
      res.status(404).json({ success: false, error: "Associated campaign not found." });
      return;
    }

    try {
      // Choose healthy SMTP
      const smtp = dbState.smtpAccounts.find(s => !s.deletedAt && s.reputationScore > 50);
      if (!smtp) {
        res.status(400).json({ success: false, error: "No healthy SMTP server available for immediate dispatch." });
        return;
      }

      // Generate personalization
      const { subject, body } = await aiService.researchLeadAndGenerateEmail(lead.id, campaign.id);

      // Perform send (simulated or real)
      if (smtp.smtpPassword) {
        const { smtpService } = await import("../services/smtp.service");
        await smtpService.sendRealSmtpEmail(smtp, lead.email, subject, body);
      }

      lead.status = LeadStatus.SENT;
      lead.crmStage = "Contacted";
      lead.updatedAt = new Date().toISOString();

      smtp.sentToday += 1;
      campaign.sentCount += 1;

      dbService.saveDb();
      dbService.logAudit(`Instant email dispatched directly to ${lead.email}`, "SMTP", undefined, `Sender: ${smtp.email}`);

      res.json({ success: true, message: `Email dispatched successfully to ${lead.email}`, lead });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || "Failed to dispatch instant outreach." });
    }
  }

  public static async enrichResearchLead(req: Request, res: Response) {
    const { leadId } = req.params;
    const updated = await aiService.enrichAndResearchLead(leadId);
    if (!updated) {
      res.status(404).json({ success: false, error: "Lead not found for enrichment." });
      return;
    }

    res.json({ success: true, message: `Lead enriched successfully.`, lead: updated });
  }

  public static async bulkEnrichResearchLeads(req: Request, res: Response) {
    const { id: campaignId } = req.params;
    const dbState = dbService.getState();
    const leads = dbState.leads.filter(l => l.campaignId === campaignId && l.status === LeadStatus.PENDING && !l.aiEmails && !l.deletedAt);
    if (leads.length === 0) {
      res.json({ success: true, message: "No un-researched leads left in this campaign.", count: 0 });
      return;
    }

    // Slice to 5 in parallel to prevent gateway timeouts in client container
    const batch = leads.slice(0, 5);
    const promises = batch.map(l => aiService.enrichAndResearchLead(l.id));
    await Promise.all(promises);

    res.json({
      success: true,
      message: `Successfully generated deep research for ${batch.length} leads in background batch.`,
      count: batch.length
    });
  }
}
