/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Router } from "express";
import { AuthController } from "../controllers/auth.controller";
import { CampaignController } from "../controllers/campaign.controller";
import { LeadController } from "../controllers/lead.controller";
import { SmtpController } from "../controllers/smtp.controller";
import { SystemController } from "../controllers/system.controller";
import { BillingController } from "../controllers/billing.controller";
import { SyncController } from "../controllers/sync.controller";
import { LeadDiscoveryController } from "../controllers/leadDiscovery.controller";
import { authenticateJwt, requireRole } from "../middleware/auth.middleware";
import { rateLimiter } from "../middleware/rateLimiter.middleware";
import { csrfProtection } from "../middleware/csrf.middleware";
import { validatePayload } from "../middleware/validation.middleware";
import { SecurityRole } from "../../src/types";

const router = Router();

// Apply global route hardening middlewares
router.use(rateLimiter);
router.use(csrfProtection);

// --- AUTHENTICATION & TEAM ---
router.post(
  "/auth/register",
  validatePayload({ name: "string", email: "string", password: "string" }),
  AuthController.register
);
router.post(
  "/auth/login",
  validatePayload({ email: "string", password: "string" }),
  AuthController.login
);
router.get("/auth/me", authenticateJwt, AuthController.getMe);
router.get("/team", authenticateJwt, AuthController.getTeam);
router.post(
  "/team/invite",
  authenticateJwt,
  requireRole([SecurityRole.ADMIN]),
  validatePayload({ name: "string", email: "string" }),
  AuthController.inviteTeamMember
);

// --- CAMPAIGNS ---
router.get("/campaigns", authenticateJwt, CampaignController.getCampaigns);
router.post(
  "/campaigns",
  authenticateJwt,
  validatePayload({ name: "string" }),
  CampaignController.createCampaign
);
router.put("/campaigns/:id", authenticateJwt, CampaignController.updateCampaign);
router.delete("/campaigns/:id", authenticateJwt, CampaignController.deleteCampaign);

// Campaign Leads Association
router.get("/campaigns/:id/leads", authenticateJwt, CampaignController.getCampaignLeads);
router.post("/campaigns/:id/leads", authenticateJwt, CampaignController.createCampaignLead);
router.post("/campaigns/:id/leads/bulk", authenticateJwt, CampaignController.bulkCreateLeads);
router.post("/campaigns/:id/leads/upload", authenticateJwt, CampaignController.uploadLeadsCsv);
router.post("/campaigns/:id/ai-bulk-personalize", authenticateJwt, CampaignController.bulkPersonalize);

// AI & Copywriting
router.post("/ai/generate-campaign-pitch", authenticateJwt, CampaignController.generateCampaignPitch);

// --- LEADS ---
router.get("/leads", authenticateJwt, LeadController.getLeads);
router.put("/leads/:leadId", authenticateJwt, LeadController.updateLead);
router.put("/leads/:leadId/crm", authenticateJwt, LeadController.updateLeadCrm);
router.delete("/leads/:leadId", authenticateJwt, LeadController.deleteLead);
router.post("/leads/:leadId/send-now", authenticateJwt, LeadController.sendEmailNow);
router.post("/leads/:leadId/enrich-research", authenticateJwt, LeadController.enrichResearchLead);
router.post("/campaigns/:id/ai-bulk-enrich-research", authenticateJwt, LeadController.bulkEnrichResearchLeads);

// --- SMTP & DELIVERABILITY ---
router.get("/smtp", authenticateJwt, SmtpController.getSmtpAccounts);
router.get("/smtp-accounts", authenticateJwt, SmtpController.getSmtpAccounts);
router.post(
  "/smtp",
  authenticateJwt,
  validatePayload({ name: "string", email: "string", smtpHost: "string", smtpPort: "number" }),
  SmtpController.createSmtpAccount
);
router.post(
  "/smtp-accounts",
  authenticateJwt,
  validatePayload({ name: "string", email: "string", smtpHost: "string", smtpPort: "number" }),
  SmtpController.createSmtpAccount
);
router.put("/smtp/:id", authenticateJwt, SmtpController.updateSmtpAccount);
router.put("/smtp-accounts/:id", authenticateJwt, SmtpController.updateSmtpAccount);
router.delete("/smtp/:id", authenticateJwt, SmtpController.deleteSmtpAccount);
router.delete("/smtp-accounts/:id", authenticateJwt, SmtpController.deleteSmtpAccount);
router.post("/smtp/:id/test", authenticateJwt, SmtpController.testSmtpAccount);
router.post("/smtp-accounts/:id/test", authenticateJwt, SmtpController.testSmtpAccount);

// Domain Warmup & DNS Records
router.get("/domains", authenticateJwt, SmtpController.getDomains);
router.post(
  "/domains",
  authenticateJwt,
  validatePayload({ domainName: "string" }),
  SmtpController.createDomain
);
router.post("/domains/:id/verify", authenticateJwt, SmtpController.verifyDomain);
router.delete("/domains/:id", authenticateJwt, SmtpController.deleteDomain);

// Email Templates
router.get("/templates", authenticateJwt, SmtpController.getTemplates);
router.post(
  "/templates",
  authenticateJwt,
  validatePayload({ name: "string", subject: "string", body: "string" }),
  SmtpController.createTemplate
);

// --- SYSTEM & AUTOMATION ---
router.get("/dashboard/stats", authenticateJwt, SystemController.getDashboardStats);
router.post("/testing/verify", authenticateJwt, SystemController.verifyDiagnostics);
router.post("/testing/clear-database", authenticateJwt, SystemController.clearDatabase);

// Replies (Inbox)
router.get("/replies", authenticateJwt, SystemController.getReplies);
router.put("/replies/:id/read", authenticateJwt, SystemController.readReply);
router.post("/replies/:id/send", authenticateJwt, SystemController.sendReplyMessage);
router.post("/replies/:id/ai-reply", authenticateJwt, SystemController.generateAiReply);

// Autonomous Agents
router.get("/agents", authenticateJwt, SystemController.getAgents);
router.get("/agents/logs", authenticateJwt, SystemController.getAgentLogs);
router.post("/agents/:id/run", authenticateJwt, SystemController.runAgentTask);

// Queue Inspection
router.get("/queue", authenticateJwt, SystemController.getQueue);
router.post("/queue/:id/retry", authenticateJwt, SystemController.retryQueueItem);
router.post("/queue/campaign/:campaignId/retry", authenticateJwt, SystemController.retryCampaignQueue);
router.delete("/queue/:id", authenticateJwt, SystemController.deleteQueueItem);
router.delete("/queue/failed/all", authenticateJwt, SystemController.clearFailedQueue);

// Task Automation Handlers
router.post("/automation/trigger", authenticateJwt, SystemController.triggerAutomationTask);
router.post("/autopilot/dispatch", authenticateJwt, SystemController.dispatchAutopilotSearch);

// --- LEAD DISCOVERY PIPELINE (Places → Firecrawl → Gemini reasoning → SES) ---
router.post("/leads/search", authenticateJwt, LeadDiscoveryController.search);
router.post("/business/analyze", authenticateJwt, LeadDiscoveryController.analyze);
router.post("/email/generate", authenticateJwt, LeadDiscoveryController.generate);
router.post("/campaign/create", authenticateJwt, LeadDiscoveryController.createCampaign);
router.post("/campaign/:id/send", authenticateJwt, LeadDiscoveryController.send);
router.post("/campaign/:id/pause", authenticateJwt, LeadDiscoveryController.pause);
router.post("/campaign/:id/resume", authenticateJwt, LeadDiscoveryController.resume);
router.post("/campaign/:id/cancel", authenticateJwt, LeadDiscoveryController.cancel);
router.get("/campaign/:id", authenticateJwt, LeadDiscoveryController.getCampaign);
router.get("/campaign/:id/stats", authenticateJwt, LeadDiscoveryController.getCampaignStats);

// --- BILLING & SUBSCRIPTIONS ---
router.post("/billing/checkout", authenticateJwt, BillingController.createCheckoutSession);
router.post("/billing/portal", authenticateJwt, BillingController.createPortalSession);
router.post("/billing/webhook", BillingController.handleWebhook);

// --- GMAIL & OUTLOOK SYNC ---
router.get("/sync/oauth/google", SyncController.initiateGoogleOAuth);
router.get("/sync/oauth/google/callback", SyncController.handleGoogleCallback);
router.get("/sync/oauth/microsoft", SyncController.initiateMicrosoftOAuth);
router.get("/sync/oauth/microsoft/callback", SyncController.handleMicrosoftCallback);
router.get("/sync/accounts", authenticateJwt, SyncController.getSyncedAccounts);
router.post("/sync/trigger", authenticateJwt, SyncController.triggerManualSync);

export default router;
