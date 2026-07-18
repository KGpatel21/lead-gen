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
import { EmailAccountController } from "../controllers/emailAccount.controller";
import { SenderPoolController } from "../controllers/senderPool.controller";
import { OAuthController } from "../controllers/oauth.controller";
import { SuppressionController } from "../controllers/suppression.controller";
import { FollowUpController } from "../controllers/followUp.controller";
import { TemplatesController } from "../controllers/templates.controller";
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
router.get("/queue/email/stats", authenticateJwt, LeadDiscoveryController.queueStats);

// --- EMAIL ACCOUNTS (Phase 4 — unified across SES, SMTP, Gmail OAuth, Outlook OAuth) ---
router.get("/email-accounts", authenticateJwt, EmailAccountController.list);
router.get("/email-accounts/presets", authenticateJwt, EmailAccountController.presets);
router.post("/email-accounts", authenticateJwt, EmailAccountController.create);
router.put("/email-accounts/:id", authenticateJwt, EmailAccountController.update);
router.post("/email-accounts/:id/test", authenticateJwt, EmailAccountController.test);
router.post("/email-accounts/:id/active", authenticateJwt, EmailAccountController.setActive);
router.post("/email-accounts/:id/reconnect", authenticateJwt, EmailAccountController.reconnect);
router.delete("/email-accounts/:id", authenticateJwt, EmailAccountController.delete);

// Backward-compatible alias for Phase 3 clients: sender-identities is a subset
// of email-accounts. Both paths route to the same controller.
router.get("/sender-identities", authenticateJwt, EmailAccountController.list);
router.post("/sender-identities", authenticateJwt, EmailAccountController.create);
router.post("/sender-identities/:id/active", authenticateJwt, EmailAccountController.setActive);
router.delete("/sender-identities/:id", authenticateJwt, EmailAccountController.delete);

// --- SENDER POOLS (Phase 4) ---
router.get("/sender-pools", authenticateJwt, SenderPoolController.list);
router.get("/sender-pools/:id", authenticateJwt, SenderPoolController.get);
router.post("/sender-pools", authenticateJwt, SenderPoolController.create);
router.put("/sender-pools/:id", authenticateJwt, SenderPoolController.update);
router.delete("/sender-pools/:id", authenticateJwt, SenderPoolController.delete);
router.post("/sender-pools/:id/members", authenticateJwt, SenderPoolController.addMember);
router.delete("/sender-pools/:id/members/:accountId", authenticateJwt, SenderPoolController.removeMember);
router.post("/sender-pools/bind-campaign", authenticateJwt, SenderPoolController.bindToCampaign);

// --- OAUTH (Phase 4) ---
router.get("/oauth/google/start", authenticateJwt, OAuthController.googleStart);
router.get("/oauth/google/callback", OAuthController.googleCallback);
router.get("/oauth/microsoft/start", authenticateJwt, OAuthController.microsoftStart);
router.get("/oauth/microsoft/callback", OAuthController.microsoftCallback);

// --- SUPPRESSION LIST (Phase 3) ---
router.get("/suppressions", authenticateJwt, SuppressionController.list);
router.post("/suppressions", authenticateJwt, SuppressionController.add);
router.delete("/suppressions/:email", authenticateJwt, SuppressionController.remove);

// --- FOLLOW-UP RULES (Phase 3) ---
router.get("/campaign/:campaignId/follow-ups", authenticateJwt, FollowUpController.list);
router.post("/campaign/:campaignId/follow-ups/ensure-defaults", authenticateJwt, FollowUpController.ensureDefaults);
router.post("/campaign/:campaignId/follow-ups", authenticateJwt, FollowUpController.setRule);

// --- TEMPLATES (Phase 3 — extends /templates from earlier phases) ---
router.get("/templates/v2", authenticateJwt, TemplatesController.list);
router.post("/templates/v2", authenticateJwt, TemplatesController.create);
router.put("/templates/v2/:id", authenticateJwt, TemplatesController.update);
router.post("/templates/v2/:id/duplicate", authenticateJwt, TemplatesController.duplicate);
router.post("/templates/v2/:id/preview", authenticateJwt, TemplatesController.preview);
router.get("/templates/v2/:id/history", authenticateJwt, TemplatesController.history);
router.delete("/templates/v2/:id", authenticateJwt, TemplatesController.remove);

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
