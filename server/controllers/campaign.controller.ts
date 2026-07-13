/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Request, Response } from "express";
import {
  campaignRepository,
  leadRepository,
  historyRepository,
} from "../db/repositories";
import { logAudit } from "../services/db.service";
import { aiService, GeminiNotConfiguredError } from "../services/ai.service";
import { CampaignStatus, LeadStatus } from "../../src/types";
import { AuthenticatedRequest } from "../middleware/auth.middleware";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class CampaignController {
  public static async getCampaigns(_req: Request, res: Response): Promise<void> {
    const data = await campaignRepository.list();
    res.json({ success: true, data });
  }

  public static async createCampaign(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { name } = req.body;
    if (typeof name !== "string" || name.trim() === "") {
      res.status(400).json({ success: false, error: "Campaign name is required." });
      return;
    }
    const dupe = await campaignRepository.findByNameActive(name);
    if (dupe) {
      res.status(409).json({ success: false, error: "A campaign with this name already exists." });
      return;
    }
    const campaign = await campaignRepository.create({
      name: name.trim(),
      subjectTemplate: "Quick question regarding {{company}}'s growth engine",
      bodyTemplate:
        "Hi {{firstName}},\n\nI was looking into {{company}}.\n\n{{personalizedLine}}\n\nWould you be open to a quick 10-minute chat?",
    });
    await logAudit(`Campaign '${campaign.name}' created`, "CAMPAIGN", {
      userId: req.user?.id,
      userEmail: req.user?.email,
      details: `ID: ${campaign.id}`,
      ipAddress: req.ip,
    });
    res.status(201).json({ success: true, campaign });
  }

  public static async updateCampaign(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { id } = req.params;
    const previous = await campaignRepository.findById(id);
    if (!previous) {
      res.status(404).json({ success: false, error: "Campaign not found." });
      return;
    }
    const updated = await campaignRepository.update(id, req.body);
    if (!updated) {
      res.status(404).json({ success: false, error: "Campaign not found." });
      return;
    }
    await historyRepository.log({
      entityId: id,
      entityType: "CAMPAIGN",
      changedBy: req.user?.email || "system",
      previousState: previous,
      newState: updated,
    });
    await logAudit(`Campaign '${updated.name}' updated`, "CAMPAIGN", {
      userId: req.user?.id,
      userEmail: req.user?.email,
      details: `Status: ${updated.status}`,
      ipAddress: req.ip,
    });
    res.json({ success: true, campaign: updated });
  }

  public static async deleteCampaign(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { id } = req.params;
    const campaign = await campaignRepository.findById(id);
    if (!campaign) {
      res.status(404).json({ success: false, error: "Campaign not found." });
      return;
    }
    await campaignRepository.softDelete(id);
    await leadRepository.softDeleteByCampaign(id);
    await logAudit(`Campaign '${campaign.name}' deleted`, "CAMPAIGN", {
      userId: req.user?.id,
      userEmail: req.user?.email,
      details: `ID: ${id}`,
      ipAddress: req.ip,
    });
    res.json({ success: true, message: "Campaign and associated leads deleted." });
  }

  public static async getCampaignLeads(req: Request, res: Response): Promise<void> {
    const { id } = req.params;
    const data = await leadRepository.listByCampaign(id);
    res.json({ success: true, data });
  }

  public static async createCampaignLead(req: Request, res: Response): Promise<void> {
    const campaignId = req.params.id;
    const { email, firstName, lastName, company, personalizedLine } = req.body;
    if (!EMAIL_REGEX.test(email || "")) {
      res.status(400).json({ success: false, error: "Invalid email format." });
      return;
    }
    const campaign = await campaignRepository.findById(campaignId);
    if (!campaign) {
      res.status(404).json({ success: false, error: "Campaign not found." });
      return;
    }
    const dupe = await leadRepository.findByEmailInCampaign(campaignId, email);
    if (dupe) {
      res.status(409).json({ success: false, error: "Lead with this email is already in this campaign." });
      return;
    }
    const lead = await leadRepository.create({
      campaignId,
      email,
      firstName,
      lastName,
      company,
      personalizedLine,
    });
    await logAudit(`Added lead ${email} to '${campaign.name}'`, "LEAD", { details: lead.id });
    res.status(201).json({ success: true, lead });
  }

  public static async bulkCreateLeads(req: Request, res: Response): Promise<void> {
    const campaignId = req.params.id;
    const { leads } = req.body;
    if (!Array.isArray(leads)) {
      res.status(400).json({ success: false, error: "Field 'leads' must be an array." });
      return;
    }
    const campaign = await campaignRepository.findById(campaignId);
    if (!campaign) {
      res.status(404).json({ success: false, error: "Campaign not found." });
      return;
    }
    const valid = leads.filter((l) => l && EMAIL_REGEX.test(l.email || ""));
    const created = await leadRepository.bulkCreate(
      valid.map((l) => ({
        campaignId,
        email: l.email,
        firstName: l.firstName || "",
        lastName: l.lastName || "",
        company: l.company || "",
        personalizedLine: l.personalizedLine || "",
      }))
    );
    await logAudit(`Bulk imported ${created.length} leads to '${campaign.name}'`, "LEAD");
    res.json({ success: true, count: created.length, leads: created });
  }

  public static async uploadLeadsCsv(req: Request, res: Response): Promise<void> {
    const campaignId = req.params.id;
    const { csvText } = req.body;
    if (typeof csvText !== "string" || csvText.trim() === "") {
      res.status(400).json({ success: false, error: "CSV text is required." });
      return;
    }
    const campaign = await campaignRepository.findById(campaignId);
    if (!campaign) {
      res.status(404).json({ success: false, error: "Campaign not found." });
      return;
    }

    const lines = csvText.split(/\r?\n/).filter((l: string) => l.trim() !== "");
    if (lines.length === 0) {
      res.status(400).json({ success: false, error: "CSV file is empty." });
      return;
    }
    const headers = lines[0].split(",").map((h: string) => h.replace(/"/g, "").trim().toLowerCase());
    const emailIdx = headers.findIndex((h: string) => h.includes("email"));
    const firstIdx = headers.findIndex((h: string) => h.includes("first") || h === "name");
    const lastIdx  = headers.findIndex((h: string) => h.includes("last"));
    const companyIdx = headers.findIndex((h: string) => h.includes("company"));
    const lineIdx  = headers.findIndex((h: string) => h.includes("personal") || h.includes("line"));

    if (emailIdx === -1) {
      res.status(400).json({ success: false, error: "Missing 'email' column in CSV header." });
      return;
    }

    let successCount = 0, dupCount = 0, invalidCount = 0;
    for (let i = 1; i < lines.length; i++) {
      const cells = lines[i].split(",").map((c: string) => c.replace(/"/g, "").trim());
      const email = cells[emailIdx];
      if (!email || !EMAIL_REGEX.test(email)) { invalidCount++; continue; }
      const dupe = await leadRepository.findByEmailInCampaign(campaignId, email);
      if (dupe) { dupCount++; continue; }
      await leadRepository.create({
        campaignId,
        email,
        firstName: firstIdx !== -1 ? cells[firstIdx] : "",
        lastName: lastIdx !== -1 ? cells[lastIdx] : "",
        company: companyIdx !== -1 ? cells[companyIdx] : "",
        personalizedLine: lineIdx !== -1 ? cells[lineIdx] : "",
      });
      successCount++;
    }
    await logAudit(`CSV imported ${successCount} leads for '${campaign.name}'`, "LEAD", {
      details: `success=${successCount} dup=${dupCount} invalid=${invalidCount}`,
    });
    res.json({ success: true, totalProcessed: lines.length - 1, successCount, dupCount, invalidCount });
  }

  public static async generateCampaignPitch(req: Request, res: Response): Promise<void> {
    const { topic, valueProp } = req.body;
    if (!topic || !valueProp) {
      res.status(400).json({ success: false, error: "Topic and valueProp are required." });
      return;
    }
    try {
      const pitch = await aiService.generateCampaignPitch(topic, valueProp);
      res.json({ success: true, ...pitch });
    } catch (err) {
      if (err instanceof GeminiNotConfiguredError) {
        res.status(503).json({ success: false, error: err.message });
        return;
      }
      res.status(500).json({ success: false, error: (err as Error).message });
    }
  }

  public static async bulkPersonalize(req: Request, res: Response): Promise<void> {
    const { id } = req.params;
    const { customizationInstruction } = req.body;
    const campaign = await campaignRepository.findById(id);
    if (!campaign) {
      res.status(404).json({ success: false, error: "Campaign not found." });
      return;
    }
    const batch = await leadRepository.listPendingWithoutPersonalization(id, 10);
    if (batch.length === 0) {
      res.json({ success: true, message: "No unpersonalized pending leads remaining.", count: 0 });
      return;
    }
    if (!aiService.isConfigured()) {
      res.status(503).json({ success: false, error: "Gemini not configured. Set GEMINI_API_KEY." });
      return;
    }
    const results = await Promise.all(
      batch.map(async (lead) => {
        try {
          const line = await aiService.personalizeLine(lead, customizationInstruction || "");
          await leadRepository.update(lead.id, { personalizedLine: line });
          return { email: lead.email, line };
        } catch (err) {
          return { email: lead.email, line: "", error: (err as Error).message };
        }
      })
    );
    await logAudit(`AI batch personalize on '${campaign.name}'`, "CAMPAIGN", {
      details: `Personalized ${results.length} leads.`,
    });
    res.json({
      success: true,
      message: `Personalized ${results.filter((r) => r.line).length} of ${results.length} leads.`,
      count: results.filter((r) => r.line).length,
      samplePersonalizations: results,
    });
  }
}
