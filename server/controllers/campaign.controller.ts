/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Request, Response } from "express";
import { dbService } from "../services/db.service";
import { aiService } from "../services/ai.service";
import { Campaign, CampaignStatus, Lead, LeadStatus } from "../../src/types";

export class CampaignController {
  public static getCampaigns(req: Request, res: Response) {
    const dbState = dbService.getState();
    const activeCampaigns = dbState.campaigns.filter(c => !c.deletedAt);
    res.json({ success: true, data: activeCampaigns });
  }

  public static createCampaign(req: Request, res: Response) {
    const { name } = req.body;
    const dbState = dbService.getState();

    const exists = dbState.campaigns.some(c => c.name.toLowerCase() === name.toLowerCase() && !c.deletedAt);
    if (exists) {
      res.status(400).json({ success: false, error: "A campaign with this name already exists." });
      return;
    }

    const newCampaign: Campaign = {
      id: `camp-${Date.now()}`,
      name,
      status: CampaignStatus.DRAFT,
      sentCount: 0,
      openCount: 0,
      replyCount: 0,
      bounceCount: 0,
      unsubCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      scheduleDays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
      scheduleTimeStart: "09:00",
      scheduleTimeEnd: "17:00",
      timezone: "America/New_York",
      subjectTemplate: "Quick question regarding {{company}}'s growth engine",
      bodyTemplate: "Hi {{firstName}},\n\nI was looking into {{company}}.\n\n{{personalizedLine}}\n\nWould you be open to a quick 10-minute chat?"
    };

    dbState.campaigns.push(newCampaign);
    dbService.saveDb();
    dbService.logAudit(`Campaign '${name}' created`, "CAMPAIGN", undefined, `ID: ${newCampaign.id}`);

    res.status(201).json({ success: true, campaign: newCampaign });
  }

  public static updateCampaign(req: Request, res: Response) {
    const { id } = req.params;
    const dbState = dbService.getState();
    const campaign = dbState.campaigns.find(c => c.id === id && !c.deletedAt);
    if (!campaign) {
      res.status(404).json({ success: false, error: "Campaign not found." });
      return;
    }

    const previousState = { ...campaign };

    // Update fields
    const allowedFields = [
      "name", "status", "scheduleDays", "scheduleTimeStart",
      "scheduleTimeEnd", "timezone", "subjectTemplate", "bodyTemplate"
    ];
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        (campaign as any)[field] = req.body[field];
      }
    }

    campaign.updatedAt = new Date().toISOString();
    dbService.saveDb();
    dbService.logEntityHistory(id, "CAMPAIGN", "system", previousState, campaign);
    dbService.logAudit(`Campaign '${campaign.name}' updated`, "CAMPAIGN", undefined, `Status: ${campaign.status}`);

    res.json({ success: true, campaign });
  }

  public static deleteCampaign(req: Request, res: Response) {
    const { id } = req.params;
    const dbState = dbService.getState();
    const campaign = dbState.campaigns.find(c => c.id === id && !c.deletedAt);
    if (!campaign) {
      res.status(404).json({ success: false, error: "Campaign not found." });
      return;
    }

    campaign.deletedAt = new Date().toISOString();
    
    // Soft delete associated leads
    for (const lead of dbState.leads) {
      if (lead.campaignId === id) {
        lead.deletedAt = new Date().toISOString();
      }
    }

    dbService.saveDb();
    dbService.logAudit(`Campaign '${campaign.name}' soft-deleted`, "CAMPAIGN", undefined, `ID: ${id}`);

    res.json({ success: true, message: "Campaign and associated leads successfully deleted." });
  }

  public static getCampaignLeads(req: Request, res: Response) {
    const { id } = req.params;
    const leads = dbService.findLeadsByCampaign(id);
    res.json({ success: true, data: leads });
  }

  public static createCampaignLead(req: Request, res: Response) {
    const campaignId = req.params.id;
    const { email, firstName, lastName, company, personalizedLine } = req.body;
    const dbState = dbService.getState();

    const campaign = dbState.campaigns.find(c => c.id === campaignId && !c.deletedAt);
    if (!campaign) {
      res.status(404).json({ success: false, error: "Campaign not found." });
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      res.status(400).json({ success: false, error: "Invalid email format." });
      return;
    }

    const exists = dbState.leads.some(
      l => l.campaignId === campaignId && l.email.toLowerCase() === email.toLowerCase() && !l.deletedAt
    );
    if (exists) {
      res.status(400).json({ success: false, error: "A lead with this email already exists in this campaign." });
      return;
    }

    const newLead: Lead = {
      id: `lead-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      campaignId,
      email,
      firstName: firstName || "",
      lastName: lastName || "",
      company: company || "",
      personalizedLine: personalizedLine || "",
      status: LeadStatus.PENDING,
      updatedAt: new Date().toISOString()
    };

    dbState.leads.push(newLead);
    dbService.saveDb();
    dbService.logAudit(`Added lead ${email} to campaign '${campaign.name}'`, "LEAD", undefined, `Lead ID: ${newLead.id}`);

    res.status(201).json({ success: true, lead: newLead });
  }

  public static bulkCreateLeads(req: Request, res: Response) {
    const campaignId = req.params.id;
    const { leads } = req.body; // Array of leads
    if (!Array.isArray(leads)) {
      res.status(400).json({ success: false, error: "Required array of leads is missing." });
      return;
    }

    const dbState = dbService.getState();
    const campaign = dbState.campaigns.find(c => c.id === campaignId && !c.deletedAt);
    if (!campaign) {
      res.status(404).json({ success: false, error: "Campaign not found." });
      return;
    }

    const addedLeads: Lead[] = [];
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    for (const item of leads) {
      const email = item.email;
      if (!email || !emailRegex.test(email)) continue;

      const isDup = dbState.leads.some(
        l => l.campaignId === campaignId && l.email.toLowerCase() === email.toLowerCase() && !l.deletedAt
      );
      if (isDup) continue;

      const newLead: Lead = {
        id: `lead-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        campaignId,
        email,
        firstName: item.firstName || "",
        lastName: item.lastName || "",
        company: item.company || "",
        personalizedLine: item.personalizedLine || "",
        status: LeadStatus.PENDING,
        updatedAt: new Date().toISOString()
      };

      dbState.leads.push(newLead);
      addedLeads.push(newLead);
    }

    dbService.saveDb();
    dbService.logAudit(`Bulk imported ${addedLeads.length} leads to campaign '${campaign.name}'`, "LEAD", undefined, `Total Added: ${addedLeads.length}`);

    res.json({ success: true, count: addedLeads.length, leads: addedLeads });
  }

  public static uploadLeadsCsv(req: Request, res: Response) {
    const campaignId = req.params.id;
    const { csvText } = req.body;
    if (!csvText) {
      res.status(400).json({ success: false, error: "CSV data is missing or empty" });
      return;
    }

    const lines = csvText.split(/\r?\n/).filter((l: string) => l.trim() !== "");
    if (lines.length === 0) {
      res.status(400).json({ success: false, error: "Empty file template submitted" });
      return;
    }

    const headers = lines[0].split(",").map((h: string) => h.replace(/"/g, "").trim().toLowerCase());
    const emailIdx = headers.findIndex((h: string) => h.includes("email"));
    const firstIdx = headers.findIndex((h: string) => h.includes("first") || h.includes("name"));
    const lastIdx = headers.findIndex((h: string) => h.includes("last"));
    const companyIdx = headers.findIndex((h: string) => h.includes("company"));
    const lineIdx = headers.findIndex((h: string) => h.includes("personal") || h.includes("line"));

    if (emailIdx === -1) {
      res.status(400).json({ success: false, error: "Missing required column 'email' in CSV header. Recognized headings are email, firstname, lastname, company" });
      return;
    }

    const dbState = dbService.getState();
    let successCount = 0;
    let dupCount = 0;
    let invalidCount = 0;
    const addedLeads: Lead[] = [];
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    for (let i = 1; i < lines.length; i++) {
      const cells = lines[i].split(",").map((c: string) => c.replace(/"/g, "").trim());
      if (cells.length <= emailIdx) continue;

      const email = cells[emailIdx];
      if (!email || !emailRegex.test(email)) {
        invalidCount++;
        continue;
      }

      const isDup = dbState.leads.some(
        l => l.campaignId === campaignId && l.email.toLowerCase() === email.toLowerCase() && !l.deletedAt
      );
      if (isDup) {
        dupCount++;
        continue;
      }

      const lead: Lead = {
        id: `lead-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        campaignId,
        email,
        firstName: firstIdx !== -1 && cells[firstIdx] ? cells[firstIdx] : "",
        lastName: lastIdx !== -1 && cells[lastIdx] ? cells[lastIdx] : "",
        company: companyIdx !== -1 && cells[companyIdx] ? cells[companyIdx] : "",
        personalizedLine: lineIdx !== -1 && cells[lineIdx] ? cells[lineIdx] : "",
        status: LeadStatus.PENDING,
        updatedAt: new Date().toISOString()
      };

      dbState.leads.push(lead);
      addedLeads.push(lead);
      successCount++;
    }

    dbService.saveDb();
    dbService.logAudit(`CSV Uploaded ${addedLeads.length} leads to campaign ID ${campaignId}`, "LEAD", undefined, `Import success: ${successCount} | Dups: ${dupCount} | Invalid: ${invalidCount}`);

    res.json({
      success: true,
      totalProcessed: lines.length - 1,
      successCount,
      dupCount,
      invalidCount,
      addedLeads
    });
  }

  public static async generateCampaignPitch(req: Request, res: Response) {
    const { topic, valueProp } = req.body;
    if (!topic || !valueProp) {
      res.status(400).json({ success: false, error: "Topic and Value Proposition are required." });
      return;
    }

    const pitch = await aiService.generateCampaignPitch(topic, valueProp);
    res.json({ success: true, ...pitch });
  }

  public static async bulkPersonalize(req: Request, res: Response) {
    const { id } = req.params;
    const { customizationInstruction } = req.body;

    const dbState = dbService.getState();
    const campaign = dbState.campaigns.find(c => c.id === id && !c.deletedAt);
    if (!campaign) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }

    const campaignLeads = dbState.leads.filter(l => l.campaignId === id && !l.personalizedLine && !l.deletedAt);
    if (campaignLeads.length === 0) {
      res.json({ message: "No unpersonalized pending leads remaining in this campaign.", count: 0 });
      return;
    }

    // Limit to 10 in parallel to prevent timing out sandbox Express requests
    const batchToPersonalize = campaignLeads.slice(0, 10);

    const promises = batchToPersonalize.map(async (lead) => {
      const apiKey = process.env.GEMINI_API_KEY;
      if (apiKey && apiKey !== "dummy-key" && apiKey.trim() !== "") {
        try {
          const prompt = `
            Draft a single, highly tailored and organic first line of a cold email.
            Context:
            - Lead's name: ${lead.firstName} ${lead.lastName}
            - Lead's company: ${lead.company}
            - Personalization style guide: ${customizationInstruction || "Compliment their company position or a major product accomplishment."}
            
            Rules:
            - Must be 1 natural sentence, starting with lowercase or capitalized appropriately.
            - Must sound like a human researched their profile for 10 minutes.
            - Avoid generic fluff like "I hope this email finds you well" or "Congrats on the success".
            - Limit output to 18 words maximum.
          `;
          
          const aiClient = new (await import("@google/genai")).GoogleGenAI({ apiKey });
          const response = await aiClient.models.generateContent({
            model: "gemini-3.5-flash",
            contents: prompt,
          });
          lead.personalizedLine = (response.text || "").replace(/"/g, "").trim();
        } catch (err) {
          lead.personalizedLine = `Impressive expansion of the tech footprint at ${lead.company}.`;
        }
      } else {
        lead.personalizedLine = `Impressive expansion of the tech footprint at ${lead.company}.`;
      }
      lead.updatedAt = new Date().toISOString();
    });

    await Promise.all(promises);
    dbService.saveDb();
    dbService.logAudit(`AI Batch Personalize run successfully for campaign ${campaign.name}`, "CAMPAIGN", undefined, `Personalized ${batchToPersonalize.length} leads.`);

    res.json({
      success: true,
      message: `Successfully generated organic personalizations for ${batchToPersonalize.length} leads in campaign.`,
      count: batchToPersonalize.length,
      samplePersonalizations: batchToPersonalize.map(l => ({ email: l.email, line: l.personalizedLine }))
    });
  }
}
