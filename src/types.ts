/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export enum CampaignStatus {
  DRAFT = "DRAFT",
  RUNNING = "RUNNING",
  PAUSED = "PAUSED",
  COMPLETED = "COMPLETED"
}

export enum LeadStatus {
  PENDING = "PENDING",
  SENT = "SENT",
  OPENED = "OPENED",
  CLICKED = "CLICKED",
  REPLIED = "REPLIED",
  BOUNCED = "BOUNCED",
  FAILED = "FAILED"
}

export enum WarmupPhase {
  BEGINNER = "BEGINNER",
  MEDIUM = "MEDIUM",
  ADVANCED = "ADVANCED"
}

export enum ReplySentiment {
  INTERESTED = "Interested",
  PRICING = "Pricing",
  MEETING = "Meeting",
  SPAM = "Spam",
  NOT_INTERESTED = "Not Interested"
}

export enum SecurityRole {
  ADMIN = "ADMIN",
  USER = "USER",
  TEAM_MEMBER = "TEAM_MEMBER"
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: SecurityRole;
  createdAt: string;
}

export interface Campaign {
  id: string;
  name: string;
  status: CampaignStatus;
  sentCount: number;
  openCount: number;
  replyCount: number;
  bounceCount: number;
  unsubCount: number;
  createdAt: string;
  updatedAt: string;
  scheduleDays: string[]; // ['Monday', 'Tuesday', ...]
  scheduleTimeStart: string; // '09:00'
  scheduleTimeEnd: string; // '17:00'
  timezone: string;
  subjectTemplate: string;
  bodyTemplate: string;
  flexibleDeliveryInterval?: string;
  deletedAt?: string;
}

export interface EnrichedReviews {
  rating: number;
  reviewCount: number;
  keyReviews: string[];
}

export interface EnrichedSocialLinks {
  linkedin?: string;
  instagram?: string;
  facebook?: string;
  twitter?: string;
}

export interface AiResearchData {
  businessSummary: string;
  painPoints: string[];
  opportunities: string[];
  improvementSuggestions: string[];
  aiLeadScore: number;
}

export interface GeneratedEmailDetail {
  subject: string;
  preview: string;
  opening: string;
  body: string;
  cta: string;
  signature: string;
  spamScore: number;
  readabilityScore: number;
  tone: string;
}

export interface AiEmailsData {
  initial: GeneratedEmailDetail;
  followUp1: GeneratedEmailDetail;
  followUp2: GeneratedEmailDetail;
  followUp3: GeneratedEmailDetail;
}

export interface Lead {
  id: string;
  campaignId: string;
  email: string;
  firstName: string;
  lastName: string;
  company: string;
  personalizedLine: string;
  status: LeadStatus;
  updatedAt: string;
  crmStage?: "Lead" | "Contacted" | "Opened" | "Interested" | "Meeting" | "Proposal" | "Won" | "Lost";
  phone?: string;
  platform?: string;
  profileUrl?: string;
  descriptionMeta?: string;
  proposedService?: string;
  errorMessage?: string;
  deletedAt?: string;

  // Lead Enrichment
  website?: string;
  businessDescription?: string;
  googleReviews?: EnrichedReviews;
  services?: string[];
  socialLinks?: EnrichedSocialLinks;
  businessHours?: string;
  bookingLinks?: string;
  latestPosts?: string[];
  technologies?: string[];
  industry?: string;
  employees?: string;
  companySummary?: string;

  // AI Research
  aiResearch?: AiResearchData;

  // AI Email Generation
  aiEmails?: AiEmailsData;
}

export interface SmtpAccount {
  id: string;
  email: string;
  smtpHost: string;
  smtpPort: number;
  username: string;
  dailyLimit: number;
  sentToday: number;
  warmupEnabled: boolean;
  warmupPhase: WarmupPhase;
  reputationScore: number; // 0-100
  warmupDailyLimit: number;
  warmupSentToday: number;
  spamRisk: "LOW" | "MEDIUM" | "HIGH";
  smtpPassword?: string;
  errorMessage?: string;
  deletedAt?: string;
}

export interface Domain {
  id: string;
  name: string;
  spfStatus: "VALID" | "INVALID" | "PENDING";
  dkimStatus: "VALID" | "INVALID" | "PENDING";
  dmarcStatus: "VALID" | "INVALID" | "PENDING";
  healthScore: number; // 0-100
  inboxCount: number;
  blacklistStatus: "CLEAN" | "BLACKLISTED" | "WARNING";
  deletedAt?: string;
}

export interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
  category: string;
  createdAt: string;
}

export interface UnsubscribeList {
  id: string;
  email: string;
  unsubscribedAt: string;
}

export interface WarmupLog {
  id: string;
  smtpAccountId: string;
  date: string; // 'YYYY-MM-DD'
  sentCount: number;
  receivedCount: number;
  spamRecoveredCount: number;
  reputationScore: number;
}

export interface EmailLog {
  id: string;
  campaignId: string;
  leadEmail: string;
  smtpAccountEmail: string;
  subject: string;
  status: LeadStatus;
  timestamp: string;
}

export interface Reply {
  id: string;
  campaignId: string;
  campaignName: string;
  leadEmail: string;
  firstName: string;
  lastName: string;
  company: string;
  subject: string;
  body: string;
  sentiment: ReplySentiment;
  timestamp: string;
  isRead: boolean;
  aiSuggestedReply?: string;
  deletedAt?: string;
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: SecurityRole;
  status: "ACTIVE" | "INVITED";
  joinedAt: string;
  deletedAt?: string;
}

export interface CampaignStatistics {
  sentOverTime: { date: string; sent: number; opens: number; replies: number }[];
  domainReputationTrend: { date: string; avgScore: number }[];
  warmupTrend: { date: string; sent: number; recovered: number }[];
  repliesSentimentBreakdown: { name: string; value: number }[];
}

export enum AgentRole {
  LEAD_HUNTER = "LEAD_HUNTER",
  OUTREACH_WRITER = "OUTREACH_WRITER",
  INBOX_CLASSIFIER = "INBOX_CLASSIFIER",
  DELIVERABILITY_SECURE = "DELIVERABILITY_SECURE"
}

export interface AiAgent {
  id: string;
  name: string;
  role: AgentRole;
  description: string;
  status: "IDLE" | "ACTIVE" | "COMPLETED" | "ERROR";
  systemPrompt: string;
  model: string;
  taskCount: number;
}

export interface AgentTaskLog {
  id: string;
  agentId: string;
  timestamp: string;
  input: string;
  output: string;
  status: "SUCCESS" | "FAILED";
}

