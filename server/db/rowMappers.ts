/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Single source of truth for `snake_case` PG row → `camelCase` domain object.
 * Keeps repositories free of ceremony and makes hydration diffs auditable.
 */

import {
  Campaign,
  CampaignStatus,
  Lead,
  LeadStatus,
  SmtpAccount,
  WarmupPhase,
  Domain,
  EmailTemplate,
  Reply,
  ReplySentiment,
  TeamMember,
  SecurityRole,
  AiAgent,
  AgentRole,
  AgentTaskLog,
} from "../../src/types";
import { DbUser, AuditLog, QueueItem } from "../services/db.service.types";

const iso = (v: unknown): string =>
  v instanceof Date ? v.toISOString() : v == null ? "" : String(v);

const jsonOrNull = (v: unknown) => (v == null ? null : typeof v === "string" ? JSON.parse(v) : v);

export const mapUser = (r: any): DbUser => ({
  id: r.id,
  name: r.name,
  email: r.email,
  role: r.role as SecurityRole,
  passwordHash: r.password_hash,
  passwordSalt: r.password_salt,
  workspaceId: r.workspace_id || undefined,
  createdAt: iso(r.created_at),
  deletedAt: r.deleted_at ? iso(r.deleted_at) : undefined,
  subscriptionPlan: r.subscription_plan || undefined,
  subscriptionStatus: r.subscription_status || undefined,
  stripeCustomerId: r.stripe_customer_id || undefined,
  stripeSubscriptionId: r.stripe_subscription_id || undefined,
  subscriptionPeriodEnd: r.subscription_period_end != null ? Number(r.subscription_period_end) : undefined,
});

export const mapTeamMember = (r: any): TeamMember => ({
  id: r.id,
  name: r.name,
  email: r.email,
  role: r.role as SecurityRole,
  status: r.status,
  joinedAt: iso(r.created_at),
  deletedAt: r.deleted_at ? iso(r.deleted_at) : undefined,
});

export const mapCampaign = (r: any): Campaign => ({
  id: r.id,
  name: r.name,
  status: r.status as CampaignStatus,
  sentCount: r.sent_count,
  openCount: r.open_count,
  replyCount: r.reply_count,
  bounceCount: r.bounce_count,
  unsubCount: r.unsub_count,
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
  scheduleDays: jsonOrNull(r.schedule_days) ?? [],
  scheduleTimeStart: r.schedule_time_start,
  scheduleTimeEnd: r.schedule_time_end,
  timezone: r.timezone,
  subjectTemplate: r.subject_template,
  bodyTemplate: r.body_template,
  deletedAt: r.deleted_at ? iso(r.deleted_at) : undefined,
});

export const mapLead = (r: any): Lead => ({
  id: r.id,
  campaignId: r.campaign_id || "",
  email: r.email,
  firstName: r.first_name || "",
  lastName: r.last_name || "",
  company: r.company || "",
  personalizedLine: r.personalized_line || "",
  status: r.status as LeadStatus,
  updatedAt: iso(r.updated_at),
  crmStage: r.crm_stage || undefined,
  phone: r.phone || undefined,
  platform: r.platform || undefined,
  profileUrl: r.profile_url || undefined,
  descriptionMeta: r.description_meta || undefined,
  proposedService: r.proposed_service || undefined,
  errorMessage: r.error_message || undefined,
  deletedAt: r.deleted_at ? iso(r.deleted_at) : undefined,

  website: r.website || undefined,
  businessDescription: r.business_description || undefined,
  googleReviews: jsonOrNull(r.google_reviews) || undefined,
  services: jsonOrNull(r.services) || undefined,
  socialLinks: jsonOrNull(r.social_links) || undefined,
  businessHours: r.business_hours || undefined,
  bookingLinks: r.booking_links || undefined,
  latestPosts: jsonOrNull(r.latest_posts) || undefined,
  technologies: jsonOrNull(r.technologies) || undefined,
  industry: r.industry || undefined,
  employees: r.employees || undefined,
  companySummary: r.company_summary || undefined,
  aiResearch: jsonOrNull(r.ai_research) || undefined,
  aiEmails: jsonOrNull(r.ai_emails) || undefined,
});

export const mapSmtpAccount = (r: any): SmtpAccount => ({
  id: r.id,
  email: r.email,
  smtpHost: r.smtp_host,
  smtpPort: r.smtp_port,
  username: r.username,
  smtpPassword: r.smtp_password || "",
  dailyLimit: r.daily_limit,
  sentToday: r.sent_today,
  warmupEnabled: r.warmup_enabled,
  warmupPhase: (r.warmup_phase as WarmupPhase) || WarmupPhase.BEGINNER,
  warmupDailyLimit: r.warmup_daily_limit,
  warmupSentToday: r.warmup_sent_today,
  reputationScore: r.reputation_score,
  spamRisk: (r.spam_risk as "LOW" | "MEDIUM" | "HIGH") || "LOW",
  errorMessage: r.error_message || undefined,
  deletedAt: r.deleted_at ? iso(r.deleted_at) : undefined,
});

export const mapDomain = (r: any): Domain => ({
  id: r.id,
  name: r.name,
  spfStatus: r.spf_status as Domain["spfStatus"],
  dkimStatus: r.dkim_status as Domain["dkimStatus"],
  dmarcStatus: r.dmarc_status as Domain["dmarcStatus"],
  healthScore: r.health_score,
  inboxCount: 0,
  blacklistStatus: r.blacklist_status as Domain["blacklistStatus"],
  deletedAt: r.deleted_at ? iso(r.deleted_at) : undefined,
});

export const mapTemplate = (r: any): EmailTemplate => ({
  id: r.id,
  name: r.name,
  subject: r.subject,
  body: r.body,
  category: r.category || "General",
  createdAt: iso(r.created_at),
});

export const mapReply = (r: any): Reply => ({
  id: r.id,
  campaignId: r.campaign_id || "",
  campaignName: r.campaign_name || "",
  leadEmail: r.from_email,
  firstName: r.first_name || "",
  lastName: r.last_name || "",
  company: r.company || "",
  subject: r.subject,
  body: r.body_text,
  sentiment: r.sentiment as ReplySentiment,
  timestamp: iso(r.received_at),
  isRead: r.is_read,
  aiSuggestedReply: r.ai_suggested_reply || undefined,
  deletedAt: r.deleted_at ? iso(r.deleted_at) : undefined,
});

export const mapAgent = (r: any): AiAgent => ({
  id: r.id,
  name: r.name,
  role: r.role as AgentRole,
  description: r.description,
  status: r.status,
  systemPrompt: r.system_prompt,
  model: r.model,
  taskCount: r.task_count,
});

export const mapAgentLog = (r: any): AgentTaskLog => ({
  id: r.id,
  agentId: r.agent_id,
  timestamp: iso(r.timestamp),
  input: r.input,
  output: r.output,
  status: r.status,
});

export const mapQueueItem = (r: any): QueueItem => ({
  id: r.id,
  campaignId: r.campaign_id,
  leadId: r.lead_id,
  to: r.to_email,
  subject: r.subject,
  body: r.body,
  scheduledAt: iso(r.scheduled_at),
  status: r.status,
  attempts: r.attempts,
  priority: r.priority,
  errorMessage: r.error_message || undefined,
  lastAttempt: r.last_attempt ? iso(r.last_attempt) : undefined,
});

export const mapAudit = (r: any): AuditLog => ({
  id: r.id,
  timestamp: iso(r.timestamp),
  userId: r.user_id || undefined,
  userEmail: r.user_email || undefined,
  action: r.action,
  category: r.category as AuditLog["category"],
  ipAddress: r.ip_address || undefined,
  details: r.details || undefined,
});
