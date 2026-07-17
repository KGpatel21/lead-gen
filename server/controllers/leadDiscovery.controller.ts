/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Lead-discovery pipeline endpoints (Phases 1–5).
 * Places → Firecrawl → Gemini reasoning → SES send.
 */

import { Request, Response } from "express";
import {
  businessRepository,
  businessProfileRepository,
  emailRepository,
  campaignRepository,
} from "../db/repositories";
import { placesService, PlacesNotConfiguredError } from "../services/places.service";
import { firecrawlService, FirecrawlNotConfiguredError } from "../services/firecrawl.service";
import { sesService, SesNotConfiguredError } from "../services/ses.service";
import { aiService, GeminiNotConfiguredError } from "../services/ai.service";
import { logAudit } from "../services/db.service";
import { CampaignStatus } from "../../src/types";
import { AuthenticatedRequest } from "../middleware/auth.middleware";

function apiError(res: Response, err: unknown) {
  const anyErr = err as any;
  if (err instanceof PlacesNotConfiguredError
   || err instanceof FirecrawlNotConfiguredError
   || err instanceof SesNotConfiguredError
   || err instanceof GeminiNotConfiguredError) {
    res.status((err as any).httpStatus || 503).json({ success: false, error: (err as Error).message });
    return;
  }
  const msg = anyErr?.message || String(err);
  console.error("[leadDiscovery] error:", msg);
  res.status(500).json({ success: false, error: msg });
}

export class LeadDiscoveryController {
  /**
   * POST /api/leads/search
   * Body: { query: string, city?: string, count?: number, pageToken?: string }
   */
  public static async search(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { query, city, count, pageToken } = req.body || {};
    if (typeof query !== "string" || query.trim() === "") {
      res.status(400).json({ success: false, error: "query is required." });
      return;
    }
    try {
      const result = await placesService.searchAndPersist({
        query: query.trim(),
        city: typeof city === "string" && city.trim() ? city.trim() : undefined,
        count: typeof count === "number" ? count : undefined,
        pageToken: typeof pageToken === "string" && pageToken ? pageToken : undefined,
      });
      await logAudit(`Places search: "${query}"${city ? " in " + city : ""}`, "LEAD", {
        userId: req.user?.id,
        userEmail: req.user?.email,
        details: `returned=${result.totalFetched} cachedPages=${result.cachedPages} freshPages=${result.freshPages}`,
        ipAddress: req.ip,
      });
      res.json({
        success: true,
        totalFetched: result.totalFetched,
        cachedPages: result.cachedPages,
        freshPages: result.freshPages,
        nextPageToken: result.nextPageToken,
        businesses: result.businesses,
      });
    } catch (err) {
      apiError(res, err);
    }
  }

  /**
   * POST /api/business/analyze
   * Body: { businessId: string } | { businessIds: string[] }
   * Scrapes the website of each business via Firecrawl and stores a profile.
   */
  public static async analyze(req: AuthenticatedRequest, res: Response): Promise<void> {
    const rawIds: string[] = Array.isArray(req.body?.businessIds)
      ? req.body.businessIds
      : req.body?.businessId
      ? [req.body.businessId]
      : [];
    if (rawIds.length === 0) {
      res.status(400).json({ success: false, error: "businessId or businessIds required." });
      return;
    }
    const results: Array<{
      businessId: string;
      businessName?: string;
      status: "SUCCESS" | "FAILED" | "SKIPPED";
      reason?: string;
      cache?: boolean;
    }> = [];

    for (const businessId of rawIds) {
      const business = await businessRepository.findById(businessId);
      if (!business) {
        results.push({ businessId, status: "FAILED", reason: "Business not found" });
        continue;
      }
      if (!business.website) {
        await businessProfileRepository.upsert({
          businessId: business.id,
          firecrawlStatus: "FAILED",
          firecrawlError: "No website on record",
        });
        results.push({ businessId, businessName: business.name, status: "SKIPPED", reason: "no website" });
        continue;
      }
      try {
        const scraped = await firecrawlService.scrape(business.website);
        await businessProfileRepository.upsert({
          businessId: business.id,
          rawScrapedMarkdown: scraped.markdown.slice(0, 60_000),
          extractedDescription: scraped.extracted.description,
          extractedServices: scraped.extracted.services,
          extractedProducts: scraped.extracted.products,
          extractedIndustry: scraped.extracted.industry,
          extractedAboutUs: scraped.extracted.aboutUs,
          extractedTechnologies: scraped.extracted.technologies,
          extractedCompanySize: scraped.extracted.companySize,
          extractedSocialLinks: scraped.extracted.socialLinks,
          extractedEmails: scraped.extracted.emails,
          extractedPhones: scraped.extracted.phones,
          firecrawlStatus: "SUCCESS",
        });
        results.push({
          businessId,
          businessName: business.name,
          status: "SUCCESS",
          cache: scraped.fromCache,
        });
      } catch (err) {
        if (err instanceof FirecrawlNotConfiguredError) {
          res.status(503).json({ success: false, error: err.message });
          return;
        }
        const msg = (err as Error).message;
        await businessProfileRepository.upsert({
          businessId: business.id,
          firecrawlStatus: "FAILED",
          firecrawlError: msg,
        });
        results.push({ businessId, businessName: business.name, status: "FAILED", reason: msg });
      }
    }

    await logAudit(`Firecrawl analyze on ${rawIds.length} business(es)`, "LEAD", {
      userId: req.user?.id,
      userEmail: req.user?.email,
      details: `success=${results.filter((r) => r.status === "SUCCESS").length}`,
      ipAddress: req.ip,
    });

    res.json({ success: true, results });
  }

  /**
   * POST /api/email/generate
   * Body: {
   *   businessId: string,
   *   campaignId?: string,   // if omitted, one campaign is created for the batch
   *   toEmail?: string,      // override; else uses profile.emails[0] or falls back to placeholder
   *   senderName: string, senderCompany: string, targetService: string,
   *   valueProp?: string, tone?: string,
   * }
   * Returns the persisted `emails` row with status = READY.
   */
  public static async generate(req: AuthenticatedRequest, res: Response): Promise<void> {
    const {
      businessId,
      campaignId,
      toEmail,
      senderName,
      senderCompany,
      targetService,
      valueProp,
      tone,
    } = req.body || {};

    if (typeof businessId !== "string" || !businessId) {
      res.status(400).json({ success: false, error: "businessId is required." });
      return;
    }
    if (typeof senderName !== "string" || !senderName.trim()) {
      res.status(400).json({ success: false, error: "senderName is required." });
      return;
    }
    if (typeof senderCompany !== "string" || !senderCompany.trim()) {
      res.status(400).json({ success: false, error: "senderCompany is required." });
      return;
    }
    if (typeof targetService !== "string" || !targetService.trim()) {
      res.status(400).json({ success: false, error: "targetService is required." });
      return;
    }

    const business = await businessRepository.findById(businessId);
    if (!business) {
      res.status(404).json({ success: false, error: "Business not found." });
      return;
    }

    try {
      // Resolve destination address: caller override → extracted email → null
      let resolvedTo = typeof toEmail === "string" && toEmail.trim() ? toEmail.trim() : null;
      if (!resolvedTo) {
        const profile = await businessProfileRepository.findByBusinessId(businessId);
        resolvedTo = profile?.extractedEmails?.[0] ?? null;
      }

      const generated = await aiService.generateEmailForBusiness({
        businessId,
        targetService: targetService.trim(),
        senderName: senderName.trim(),
        senderCompany: senderCompany.trim(),
        valueProp: typeof valueProp === "string" ? valueProp : undefined,
        tone: typeof tone === "string" ? (tone as any) : undefined,
      });

      const email = await emailRepository.create({
        campaignId: typeof campaignId === "string" && campaignId ? campaignId : undefined,
        businessId,
        toEmail: resolvedTo || "",
        subject: generated.subject,
        bodyText: generated.bodyText,
        bodyHtml: generated.bodyHtml,
        openingLine: generated.openingLine,
        painPoints: generated.painPoints,
        benefits: generated.benefits,
        cta: generated.cta,
        confidenceScore: generated.confidenceScore,
        emailTone: generated.emailTone,
        status: resolvedTo ? "READY" : "PENDING", // PENDING when no destination is on file
      });

      res.status(201).json({ success: true, email, business });
    } catch (err) {
      apiError(res, err);
    }
  }

  /**
   * POST /api/campaign/create
   * Body: { name: string, businessIds: string[], subjectPreview?: string }
   * Creates an outbound campaign whose target set is a list of businesses.
   */
  public static async createCampaign(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { name, businessIds } = req.body || {};
    if (typeof name !== "string" || !name.trim()) {
      res.status(400).json({ success: false, error: "name is required." });
      return;
    }
    if (!Array.isArray(businessIds) || businessIds.length === 0) {
      res.status(400).json({ success: false, error: "businessIds must be a non-empty array." });
      return;
    }
    const businesses = await businessRepository.findManyByIds(businessIds);
    if (businesses.length === 0) {
      res.status(400).json({ success: false, error: "No matching businesses." });
      return;
    }
    const campaign = await campaignRepository.create({
      name: name.trim(),
      status: CampaignStatus.DRAFT,
      subjectTemplate: `Quick question about {{company}}`,
      bodyTemplate: `Hi,\n\n{{personalizedLine}}\n\n— ${req.user?.email || ""}`,
    });
    await logAudit(`Campaign created via lead discovery: ${campaign.name}`, "CAMPAIGN", {
      userId: req.user?.id,
      userEmail: req.user?.email,
      details: `businesses=${businesses.length}`,
      ipAddress: req.ip,
    });
    res.status(201).json({ success: true, campaign, businessCount: businesses.length });
  }

  /**
   * POST /api/campaign/:id/send
   * Sends every READY / RETRY email in the campaign via Amazon SES.
   * Sequential to respect account send-rate; production usage should
   * back this by BullMQ once Phase-2 queue lands.
   */
  public static async send(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { id: campaignId } = req.params;
    const campaign = await campaignRepository.findById(campaignId);
    if (!campaign) {
      res.status(404).json({ success: false, error: "Campaign not found." });
      return;
    }
    if (!sesService.isConfigured()) {
      res.status(503).json({
        success: false,
        error: "SES not fully configured (need AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, SES_FROM_EMAIL).",
      });
      return;
    }
    const queue = await emailRepository.listReadyForCampaign(campaignId);
    if (queue.length === 0) {
      res.json({ success: true, message: "No READY emails to send.", sent: 0, failed: 0 });
      return;
    }
    await campaignRepository.setStatus(campaignId, CampaignStatus.RUNNING);
    let sent = 0, failed = 0;
    for (const email of queue) {
      if (!email.toEmail) {
        await emailRepository.setStatus(email.id, "FAILED", { errorMessage: "No destination email on file." });
        failed++; continue;
      }
      try {
        await sesService.sendEmailRow(email);
        await campaignRepository.incrementCounters(campaignId, { sentCount: 1 });
        sent++;
      } catch (err) {
        failed++;
        console.warn("[send] SES failed for", email.id, (err as Error).message);
      }
    }
    await logAudit(`SES campaign send: ${campaign.name}`, "SMTP", {
      userId: req.user?.id,
      userEmail: req.user?.email,
      details: `sent=${sent} failed=${failed}`,
      ipAddress: req.ip,
    });
    res.json({ success: true, sent, failed, total: queue.length });
  }

  public static async pause(req: Request, res: Response): Promise<void> {
    const paused = await emailRepository.pauseAllForCampaign(req.params.id);
    await campaignRepository.setStatus(req.params.id, CampaignStatus.PAUSED);
    res.json({ success: true, paused });
  }

  public static async resume(req: Request, res: Response): Promise<void> {
    const resumed = await emailRepository.resumeAllForCampaign(req.params.id);
    await campaignRepository.setStatus(req.params.id, CampaignStatus.RUNNING);
    res.json({ success: true, resumed });
  }

  public static async cancel(req: Request, res: Response): Promise<void> {
    const cancelled = await emailRepository.cancelAllForCampaign(req.params.id);
    await campaignRepository.setStatus(req.params.id, CampaignStatus.COMPLETED);
    res.json({ success: true, cancelled });
  }

  public static async getCampaign(req: Request, res: Response): Promise<void> {
    const c = await campaignRepository.findById(req.params.id);
    if (!c) {
      res.status(404).json({ success: false, error: "Campaign not found." });
      return;
    }
    const emails = await emailRepository.listByCampaign(req.params.id);
    res.json({ success: true, campaign: c, emails });
  }

  public static async getCampaignStats(req: Request, res: Response): Promise<void> {
    const stats = await emailRepository.statsByCampaign(req.params.id);
    res.json({ success: true, stats });
  }
}
