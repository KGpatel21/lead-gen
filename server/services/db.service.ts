/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import path from "path";
import pg from "pg";
import crypto from "crypto";
import {
  Campaign,
  Lead,
  SmtpAccount,
  Domain,
  EmailTemplate,
  Reply,
  TeamMember,
  AiAgent,
  AgentTaskLog,
  SecurityRole,
  AgentRole,
  CampaignStatus,
  LeadStatus,
  ReplySentiment,
  WarmupPhase
} from "../../src/types";

export interface DbUser {
  id: string;
  name: string;
  email: string;
  role: SecurityRole;
  passwordHash: string;
  passwordSalt: string;
  createdAt: string;
  deletedAt?: string;
  subscriptionPlan?: string;
  subscriptionStatus?: string;
}

export interface AuditLog {
  id: string;
  timestamp: string;
  userId?: string;
  userEmail?: string;
  action: string;
  category: 'CAMPAIGN' | 'LEAD' | 'SMTP' | 'QUEUE' | 'REPLY' | 'AUTHENTICATION' | 'SECURITY' | 'ERROR';
  ipAddress?: string;
  details?: string;
}

export interface EntityHistory {
  id: string;
  entityId: string;
  entityType: 'CAMPAIGN' | 'DOMAIN' | 'TEMPLATE';
  changedAt: string;
  changedBy: string;
  previousState: string; // JSON Stringified State
  newState: string;      // JSON Stringified State
}

export interface QueueItem {
  id: string;
  campaignId: string;
  leadId: string;
  to: string;
  subject: string;
  body: string;
  scheduledAt: string; // ISO String
  status: 'QUEUED' | 'PENDING' | 'SENT' | 'FAILED';
  attempts: number;
  errorMessage?: string;
  lastAttempt?: string;
  priority?: number; // 1 = High, 2 = Med, 3 = Low
}

export interface DatabaseState {
  campaigns: Campaign[];
  leads: Lead[];
  smtpAccounts: SmtpAccount[];
  domains: Domain[];
  templates: EmailTemplate[];
  replies: Reply[];
  teamMembers: TeamMember[];
  agents: AiAgent[];
  agentLogs: AgentTaskLog[];
  queue: QueueItem[];
  users: DbUser[];
  auditLogs: AuditLog[];
  history: EntityHistory[];
  isInitialized: boolean;
}

const defaultAgents: AiAgent[] = [
  {
    id: "agent-lead-hunter",
    name: "Lead Hunter Pro",
    role: AgentRole.LEAD_HUNTER,
    description: "Prospects high-converting target leads for specific business niches, looks up domains, and writes direct intro icebreakers.",
    status: "IDLE",
    systemPrompt: "You are Lead Hunter Pro, an elite sales prospecting agent. Your job is to search for high-value prospect leads in a given niche and location. Synthesize contact details, company name, contact motivation, and a bespoke icebreaker. Return the leads in structured, easy-to-read markdown table.",
    model: "gemini-3.5-flash",
    taskCount: 0
  },
  {
    id: "agent-copywriter",
    name: "Copywriter Ninja",
    role: AgentRole.OUTREACH_WRITER,
    description: "Drafts highly personalized cold email templates using psychological copy blocks (AIDA, PAS).",
    status: "IDLE",
    systemPrompt: "You are Copywriter Ninja, a world-class cold email outreach copywriter. Your job is to generate dynamic sequence scripts based on target industries, value propositions, and pain points. Return 1 high-converting email template with subject and body tags.",
    model: "gemini-3.5-flash",
    taskCount: 0
  },
  {
    id: "agent-classifier",
    name: "Smart Triage Classifier",
    role: AgentRole.INBOX_CLASSIFIER,
    description: "Filters incoming replies, categorizes sentiments (interested/objections), and drafts suggested objections handlings.",
    status: "IDLE",
    systemPrompt: "You are Smart Triage Classifier. Parse the incoming email text, label its core sentiment as 'interested', 'not interested', 'meeting booked', or 'spam/optout'. Suggest a bulletproof action plan and pitch-perfect follow-up draft.",
    model: "gemini-3.5-flash",
    taskCount: 0
  },
  {
    id: "agent-deliverability",
    name: "Inbox Health Sentry",
    role: AgentRole.DELIVERABILITY_SECURE,
    description: "Scans campaign copies for spam trigger terms, excessive punctuation, and certifies SPF/DKIM sanity.",
    status: "IDLE",
    systemPrompt: "You are Inbox Health Sentry, a technical deliverability specialist. Analyze the draft for spam trigger words, formatting red flags, and SPF/DKIM verification. Suggest direct fixes to preserve high email reputation scores.",
    model: "gemini-3.5-flash",
    taskCount: 0
  }
];

// Production fallback seeds
const initialCampaigns: Campaign[] = [
  {
    id: "camp-1",
    name: "SaaS Founder Outbound Campaign",
    status: CampaignStatus.RUNNING,
    sentCount: 151,
    openCount: 121,
    replyCount: 21,
    bounceCount: 4,
    unsubCount: 2,
    createdAt: "2026-05-15T12:00:00Z",
    updatedAt: "2026-05-29T12:00:00Z",
    scheduleDays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
    scheduleTimeStart: "09:00",
    scheduleTimeEnd: "17:00",
    timezone: "America/New_York",
    subjectTemplate: "Quick question regarding {{company}}'s growth engine",
    bodyTemplate: "Hi {{firstName}},\n\nI active-routed a quick analysis of {{company}} and realized you are doing awesome work. However, did you know that 35% of outbound marketing campaigns drop off due to poor SMTP configurations?\n\n{{personalizedLine}}\n\nWe built Outbound.AI to solve this. Are you open to a 10-minute slot next week?\n\nBest,\nKrutarth Patel"
  },
  {
    id: "camp-2",
    name: "Enterprise AI Personalization Pitch",
    status: CampaignStatus.PAUSED,
    sentCount: 32,
    openCount: 18,
    replyCount: 3,
    bounceCount: 1,
    unsubCount: 0,
    createdAt: "2026-05-20T10:00:00Z",
    updatedAt: "2026-05-28T15:20:00Z",
    scheduleDays: ["Monday", "Wednesday", "Friday"],
    scheduleTimeStart: "10:00",
    scheduleTimeEnd: "16:00",
    timezone: "America/Los_Angeles",
    subjectTemplate: "Proposal for integrating LLMs into {{company}}'s customer support",
    bodyTemplate: "Hi {{firstName}},\n\nLoved your recent presentation regarding customer loyalty. At {{company}}, I am sure you value support response times.\n\n{{personalizedLine}}\n\nWe can integrate real-time Gemini agent systems into your workflows within 7 days.\n\nLet me know if you would like to explore this."
  }
];

const initialLeads: Lead[] = [
  {
    id: "lead-1",
    campaignId: "camp-1",
    email: "sarah.m@stripe.com",
    firstName: "Sarah",
    lastName: "Miller",
    company: "Stripe",
    personalizedLine: "Loved Stripe's recent launch of automated billing reconciliations.",
    status: LeadStatus.REPLIED,
    updatedAt: "2026-05-29T12:00:00Z"
  },
  {
    id: "lead-2",
    campaignId: "camp-1",
    email: "kevin@hubspot.com",
    firstName: "Kevin",
    lastName: "Vance",
    company: "HubSpot",
    personalizedLine: "Awesome article on CRM workflow scaling.",
    status: LeadStatus.REPLIED,
    updatedAt: "2026-05-29T10:30:00Z"
  },
  {
    id: "lead-3",
    campaignId: "camp-1",
    email: "brad.t@booking.com",
    firstName: "Brad",
    lastName: "Taylor",
    company: "Booking.com",
    personalizedLine: "Great work expanding the virtual concierge systems.",
    status: LeadStatus.REPLIED,
    updatedAt: "2026-05-28T16:45:00Z"
  },
  {
    id: "lead-4",
    campaignId: "camp-1",
    email: "john.doe@apple.com",
    firstName: "John",
    lastName: "Doe",
    company: "Apple Inc.",
    personalizedLine: "",
    status: LeadStatus.SENT,
    updatedAt: "2026-05-29T08:00:00Z"
  },
  {
    id: "lead-5",
    campaignId: "camp-1",
    email: "marcus.aurelius@stoicgrowth.com",
    firstName: "Marcus",
    lastName: "Aurelius",
    company: "Stoic Growth",
    personalizedLine: "Your essays on marketing discipline are timeless.",
    status: LeadStatus.OPENED,
    updatedAt: "2026-05-29T09:12:00Z"
  },
  {
    id: "lead-6",
    campaignId: "camp-1",
    email: "bounced-email@invalid-domain-test.xyz",
    firstName: "Dave",
    lastName: "Crash",
    company: "FakeCorp",
    personalizedLine: "",
    status: LeadStatus.BOUNCED,
    updatedAt: "2026-05-28T11:00:00Z"
  },
  {
    id: "lead-7",
    campaignId: "camp-2",
    email: "emily.clarke@salesforce.com",
    firstName: "Emily",
    lastName: "Clarke",
    company: "Salesforce",
    personalizedLine: "Your presentation at the AI summit was incredibly enlightening regarding agentic architecture.",
    status: LeadStatus.REPLIED,
    updatedAt: "2026-05-28T15:20:00Z"
  },
  {
    id: "lead-8",
    campaignId: "camp-2",
    email: "harvey.specter@pearsonhardman.com",
    firstName: "Harvey",
    lastName: "Specter",
    company: "Pearson Hardman",
    personalizedLine: "Your litigation win record is highly impressive.",
    status: LeadStatus.OPENED,
    updatedAt: "2026-05-27T10:00:00Z"
  }
];

const initialSmtpAccounts: SmtpAccount[] = [
  {
    id: "smtp-1",
    email: "sales@outbound.enterpriseai.io",
    smtpHost: "smtp.gmail.com",
    smtpPort: 465,
    username: "sales@outbound.enterpriseai.io",
    dailyLimit: 50,
    sentToday: 18,
    warmupEnabled: true,
    warmupPhase: WarmupPhase.MEDIUM,
    reputationScore: 98,
    warmupDailyLimit: 25,
    warmupSentToday: 12,
    spamRisk: "LOW"
  },
  {
    id: "smtp-2",
    email: "partner@outbound.enterpriseai.io",
    smtpHost: "smtp.gmail.com",
    smtpPort: 465,
    username: "partner@outbound.enterpriseai.io",
    dailyLimit: 50,
    sentToday: 32,
    warmupEnabled: true,
    warmupPhase: WarmupPhase.ADVANCED,
    reputationScore: 99,
    warmupDailyLimit: 40,
    warmupSentToday: 28,
    spamRisk: "LOW"
  },
  {
    id: "smtp-3",
    email: "team@acmeleads.org",
    smtpHost: "smtp.sendgrid.net",
    smtpPort: 587,
    username: "apikey",
    dailyLimit: 100,
    sentToday: 84,
    warmupEnabled: true,
    warmupPhase: WarmupPhase.BEGINNER,
    reputationScore: 71,
    warmupDailyLimit: 15,
    warmupSentToday: 8,
    spamRisk: "MEDIUM"
  }
];

const initialDomains: Domain[] = [
  {
    id: "dom-1",
    name: "enterpriseai.io",
    spfStatus: "VALID",
    dkimStatus: "VALID",
    dmarcStatus: "VALID",
    healthScore: 99,
    inboxCount: 2,
    blacklistStatus: "CLEAN"
  },
  {
    id: "dom-2",
    name: "acmeleads.org",
    spfStatus: "VALID",
    dkimStatus: "PENDING",
    dmarcStatus: "INVALID",
    healthScore: 60,
    inboxCount: 1,
    blacklistStatus: "WARNING"
  },
  {
    id: "dom-3",
    name: "outboundsolution.com",
    spfStatus: "VALID",
    dkimStatus: "VALID",
    dmarcStatus: "VALID",
    healthScore: 94,
    inboxCount: 0,
    blacklistStatus: "CLEAN"
  }
];

const initialTemplates: EmailTemplate[] = [
  {
    id: "temp-1",
    name: "AI Quick Pitch",
    subject: "Quick question regarding {{company}}'s development pipelines",
    body: "Hi {{firstName}},\n\nI was looking through your firm's engineering specifications. Are your developers running into latency bottlenecks when building with foundational LLM models?\n\n{{personalizedLine}}\n\nWe designed an edge proxy that reduces latency by 35%.\n\nWould you be open to a 5-minute feedback call next Wednesday?\n\nBest,\nAlex",
    category: "Software Development",
    createdAt: "2026-05-15T12:00:00Z"
  }
];

const initialReplies: Reply[] = [
  {
    id: "rep-1",
    campaignId: "camp-1",
    campaignName: "SaaS Founder Outbound Campaign",
    leadEmail: "sarah.m@stripe.com",
    firstName: "Sarah",
    lastName: "Miller",
    company: "Stripe",
    subject: "Re: Quick question regarding Stripe's growth engine",
    body: "Thanks for reaching out, Alex! This actually looks very relevant. Our sales operations team has been struggling with deliverability rates on our custom lists. Would you be open to chatting next Tuesday afternoon? Let me know what timezone works best.",
    sentiment: ReplySentiment.INTERESTED,
    timestamp: "2026-05-29T12:00:00Z",
    isRead: false,
    aiSuggestedReply: "Dear Sarah, I would love to connect. I am based in Eastern Time. Next Tuesday at 2 PM EDT works perfectly on my end. Here is my booking link: calendly.com/alex-outbound/10min or feel free to send yours over! Looking forward to chatting."
  }
];

const initialTeamMembers: TeamMember[] = [
  {
    id: "team-1",
    name: "Krutarth Patel",
    email: "krutarth123456798@gmail.com",
    role: SecurityRole.ADMIN,
    status: "ACTIVE",
    joinedAt: "2026-05-01T08:00:00Z"
  },
  {
    id: "team-2",
    name: "Alex Johnson",
    email: "alex@enterpriseai.io",
    role: SecurityRole.USER,
    status: "ACTIVE",
    joinedAt: "2026-05-05T09:30:00Z"
  }
];

// PostgreSQL client pool initialization
let pool: pg.Pool | null = null;
if (process.env.DATABASE_URL) {
  try {
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes("localhost") || process.env.DATABASE_URL.includes("127.0.0.1")
        ? false
        : { rejectUnauthorized: false }
    });
    console.log("[PostgreSQL] Client Connection Pool allocated.");
  } catch (err) {
    console.error("[PostgreSQL] Error allocating pool:", err);
  }
}

class DbService {
  private dbState: DatabaseState = {
    campaigns: [],
    leads: [],
    smtpAccounts: [],
    domains: [],
    templates: [],
    replies: [],
    teamMembers: [],
    agents: [],
    agentLogs: [],
    queue: [],
    users: [],
    auditLogs: [],
    history: [],
    isInitialized: false,
  };

  private leadIndexByEmail: Map<string, Lead> = new Map();
  private leadIndexByCampaign: Map<string, Lead[]> = new Map();
  private queueIndexByCampaign: Map<string, QueueItem[]> = new Map();

  constructor() {
    this.loadDb();
  }

  public getState(): DatabaseState {
    return this.dbState;
  }

  public getPool(): pg.Pool | null {
    return pool;
  }

  /**
   * Initializes database schema tables and constraints.
   */
  private async runPostgresMigrations() {
    if (!pool) throw new Error("Database pool unconfigured");
    const client = await pool.connect();
    try {
      console.log("[PostgreSQL] Executing schema migrations and schema constraints...");
      await client.query("BEGIN;");

      // Campaigns table
      await client.query(`
        CREATE TABLE IF NOT EXISTS campaigns (
          id VARCHAR PRIMARY KEY,
          name VARCHAR NOT NULL,
          status VARCHAR NOT NULL,
          sent_count INTEGER DEFAULT 0,
          open_count INTEGER DEFAULT 0,
          reply_count INTEGER DEFAULT 0,
          bounce_count INTEGER DEFAULT 0,
          unsub_count INTEGER DEFAULT 0,
          created_at VARCHAR NOT NULL,
          updated_at VARCHAR NOT NULL,
          schedule_days TEXT NOT NULL,
          schedule_time_start VARCHAR NOT NULL,
          schedule_time_end VARCHAR NOT NULL,
          timezone VARCHAR NOT NULL,
          subject_template TEXT NOT NULL,
          body_template TEXT NOT NULL,
          deleted_at VARCHAR
        );
      `);

      // Leads table
      await client.query(`
        CREATE TABLE IF NOT EXISTS leads (
          id VARCHAR PRIMARY KEY,
          campaign_id VARCHAR REFERENCES campaigns(id) ON DELETE SET NULL,
          email VARCHAR NOT NULL,
          first_name VARCHAR,
          last_name VARCHAR,
          company VARCHAR,
          personalized_line TEXT,
          status VARCHAR NOT NULL,
          updated_at VARCHAR NOT NULL,
          crm_stage VARCHAR,
          phone VARCHAR,
          platform VARCHAR,
          profile_url VARCHAR,
          description_meta TEXT,
          proposed_service TEXT,
          error_message TEXT,
          deleted_at VARCHAR,
          website VARCHAR,
          business_description TEXT,
          services TEXT,
          technologies TEXT
        );
      `);

      // SMTP Accounts table
      await client.query(`
        CREATE TABLE IF NOT EXISTS smtp_accounts (
          id VARCHAR PRIMARY KEY,
          name VARCHAR NOT NULL,
          email VARCHAR NOT NULL,
          username VARCHAR NOT NULL,
          smtp_host VARCHAR NOT NULL,
          smtp_port INTEGER NOT NULL,
          smtp_password TEXT NOT NULL,
          daily_limit INTEGER NOT NULL,
          sent_today INTEGER DEFAULT 0,
          reputation_score INTEGER DEFAULT 100,
          warmup_enabled BOOLEAN DEFAULT FALSE,
          warmup_daily_limit INTEGER DEFAULT 15,
          warmup_phase VARCHAR,
          created_at VARCHAR NOT NULL,
          deleted_at VARCHAR
        );
      `);

      // Domains table
      await client.query(`
        CREATE TABLE IF NOT EXISTS domains (
          id VARCHAR PRIMARY KEY,
          name VARCHAR NOT NULL,
          spf_status VARCHAR NOT NULL,
          dkim_status VARCHAR NOT NULL,
          dmarc_status VARCHAR NOT NULL,
          health_score INTEGER DEFAULT 100,
          created_at VARCHAR NOT NULL,
          deleted_at VARCHAR
        );
      `);

      // Templates table
      await client.query(`
        CREATE TABLE IF NOT EXISTS templates (
          id VARCHAR PRIMARY KEY,
          name VARCHAR NOT NULL,
          subject TEXT NOT NULL,
          body TEXT NOT NULL,
          category VARCHAR DEFAULT 'General',
          created_at VARCHAR NOT NULL,
          deleted_at VARCHAR
        );
      `);

      // Replies table
      await client.query(`
        CREATE TABLE IF NOT EXISTS replies (
          id VARCHAR PRIMARY KEY,
          campaign_id VARCHAR REFERENCES campaigns(id) ON DELETE SET NULL,
          lead_id VARCHAR REFERENCES leads(id) ON DELETE SET NULL,
          from_email VARCHAR NOT NULL,
          subject TEXT NOT NULL,
          body_text TEXT NOT NULL,
          sentiment VARCHAR NOT NULL,
          received_at VARCHAR NOT NULL,
          is_read BOOLEAN DEFAULT FALSE,
          reply_thread TEXT,
          deleted_at VARCHAR
        );
      `);

      // Team Members table
      await client.query(`
        CREATE TABLE IF NOT EXISTS team_members (
          id VARCHAR PRIMARY KEY,
          name VARCHAR NOT NULL,
          email VARCHAR NOT NULL,
          role VARCHAR NOT NULL,
          status VARCHAR NOT NULL,
          created_at VARCHAR NOT NULL,
          deleted_at VARCHAR
        );
      `);

      // Users table
      await client.query(`
        CREATE TABLE IF NOT EXISTS users (
          id VARCHAR PRIMARY KEY,
          name VARCHAR NOT NULL,
          email VARCHAR UNIQUE NOT NULL,
          role VARCHAR NOT NULL,
          password_hash VARCHAR NOT NULL,
          password_salt VARCHAR NOT NULL,
          created_at VARCHAR NOT NULL,
          deleted_at VARCHAR,
          subscription_plan VARCHAR,
          subscription_status VARCHAR
        );
      `);

      // Queue table
      await client.query(`
        CREATE TABLE IF NOT EXISTS queue (
          id VARCHAR PRIMARY KEY,
          campaign_id VARCHAR REFERENCES campaigns(id) ON DELETE CASCADE,
          lead_id VARCHAR REFERENCES leads(id) ON DELETE CASCADE,
          to_email VARCHAR NOT NULL,
          subject TEXT NOT NULL,
          body TEXT NOT NULL,
          scheduled_at VARCHAR NOT NULL,
          status VARCHAR NOT NULL,
          attempts INTEGER DEFAULT 0,
          error_message TEXT,
          last_attempt VARCHAR,
          priority INTEGER DEFAULT 2
        );
      `);

      // Audit Logs table
      await client.query(`
        CREATE TABLE IF NOT EXISTS audit_logs (
          id VARCHAR PRIMARY KEY,
          timestamp VARCHAR NOT NULL,
          user_id VARCHAR,
          user_email VARCHAR,
          action VARCHAR NOT NULL,
          category VARCHAR NOT NULL,
          details TEXT
        );
      `);

      // Indexes for rapid O(1) searches and foreign key queries
      await client.query("CREATE INDEX IF NOT EXISTS idx_leads_campaign_id ON leads (campaign_id);");
      await client.query("CREATE INDEX IF NOT EXISTS idx_queue_campaign_id ON queue (campaign_id);");
      await client.query("CREATE INDEX IF NOT EXISTS idx_replies_campaign_id ON replies (campaign_id);");
      await client.query("CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs (timestamp DESC);");

      await client.query("COMMIT;");
      console.log("[PostgreSQL] Migrations completed successfully.");
    } catch (err) {
      await client.query("ROLLBACK;");
      console.error("[PostgreSQL] Migration transaction failed, rolling back:", err);
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Initializes and hydrates from PostgreSQL directly. Seeding occurs dynamically if DB tables are empty.
   */
  public async loadDb() {
    if (!pool) {
      if (process.env.NODE_ENV === "production") {
        console.error("[DATABASE ERROR] No database connection available. Production requires a PostgreSQL database.");
        throw new Error("PostgreSQL pool connection is unavailable in production mode.");
      }
      console.warn("[DATABASE WARNING] DATABASE_URL is missing. Operating in local sandbox mode with rich seed data.");
      this.dbState = {
        campaigns: [...initialCampaigns],
        leads: [...initialLeads],
        smtpAccounts: [...initialSmtpAccounts],
        domains: [...initialDomains],
        templates: [...initialTemplates],
        replies: [...initialReplies],
        teamMembers: [...initialTeamMembers],
        agents: [...defaultAgents],
        agentLogs: [],
        queue: [],
        users: [],
        auditLogs: [],
        history: [],
        isInitialized: true,
      };
      this.rebuildIndexes();
      return;
    }

    try {
      // 1. Ensure Migrations have completed successfully
      await this.runPostgresMigrations();

      const client = await pool.connect();
      try {
        // Check if database needs seeding
        const checkCount = await client.query("SELECT COUNT(*) FROM campaigns");
        const count = parseInt(checkCount.rows[0].count, 10);

        if (count === 0) {
          console.log("[PostgreSQL] Campaigns table is empty. Engaging secure, dynamic database seeding protocol...");
          
          this.dbState = {
            campaigns: [...initialCampaigns],
            leads: [...initialLeads],
            smtpAccounts: [...initialSmtpAccounts],
            domains: [...initialDomains],
            templates: [...initialTemplates],
            replies: [...initialReplies],
            teamMembers: [...initialTeamMembers],
            agents: [...defaultAgents],
            agentLogs: [],
            queue: [],
            users: [],
            auditLogs: [],
            history: [],
            isInitialized: true,
          };
          
          this.rebuildIndexes();
          await this.syncStateToPostgres();
          console.log("[PostgreSQL] Dynamic database seeding complete.");
          return;
        }

        console.log("[PostgreSQL] Hydrating application memory structures directly from SQL database rows...");
        
        // Hydrate campaigns
        const resCampaigns = await client.query("SELECT * FROM campaigns WHERE deleted_at IS NULL ORDER BY created_at DESC");
        this.dbState.campaigns = resCampaigns.rows.map(r => ({
          id: r.id,
          name: r.name,
          status: r.status as CampaignStatus,
          sentCount: r.sent_count,
          openCount: r.open_count,
          replyCount: r.reply_count,
          bounceCount: r.bounce_count,
          unsubCount: r.unsub_count,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
          scheduleDays: JSON.parse(r.schedule_days),
          scheduleTimeStart: r.schedule_time_start,
          scheduleTimeEnd: r.schedule_time_end,
          timezone: r.timezone,
          subjectTemplate: r.subject_template,
          bodyTemplate: r.body_template,
          deletedAt: r.deleted_at || undefined
        }));

        // Hydrate users
        const resUsers = await client.query("SELECT * FROM users ORDER BY created_at DESC");
        this.dbState.users = resUsers.rows.map(r => ({
          id: r.id,
          name: r.name,
          email: r.email,
          role: r.role as SecurityRole,
          passwordHash: r.password_hash,
          passwordSalt: r.password_salt,
          createdAt: r.created_at,
          deletedAt: r.deleted_at || undefined,
          subscriptionPlan: r.subscription_plan || undefined,
          subscriptionStatus: r.subscription_status || undefined
        }));

        // Hydrate leads
        const resLeads = await client.query("SELECT * FROM leads WHERE deleted_at IS NULL");
        this.dbState.leads = resLeads.rows.map(r => ({
          id: r.id,
          campaignId: r.campaign_id || undefined,
          email: r.email,
          firstName: r.first_name || "",
          lastName: r.last_name || "",
          company: r.company || "",
          personalizedLine: r.personalized_line || "",
          status: r.status as LeadStatus,
          updatedAt: r.updated_at,
          crmStage: r.crm_stage || undefined,
          phone: r.phone || undefined,
          platform: r.platform || undefined,
          profileUrl: r.profile_url || undefined,
          descriptionMeta: r.description_meta || undefined,
          proposedService: r.proposed_service || undefined,
          errorMessage: r.error_message || undefined,
          deletedAt: r.deleted_at || undefined,
          website: r.website || undefined,
          businessDescription: r.business_description || undefined,
          services: r.services ? JSON.parse(r.services) : undefined,
          technologies: r.technologies ? JSON.parse(r.technologies) : undefined
        }));

        // Hydrate SMTP Accounts
        const resSmtp = await client.query("SELECT * FROM smtp_accounts WHERE deleted_at IS NULL");
        this.dbState.smtpAccounts = resSmtp.rows.map(r => ({
          id: r.id,
          email: r.email,
          username: r.username,
          smtpHost: r.smtp_host,
          smtpPort: r.smtp_port,
          smtpPassword: r.smtp_password,
          dailyLimit: r.daily_limit,
          sentToday: r.sent_today,
          reputationScore: r.reputation_score,
          warmupEnabled: r.warmup_enabled,
          warmupDailyLimit: r.warmup_daily_limit,
          warmupSentToday: 0, // dynamic warmups reset on pool boot
          warmupPhase: r.warmup_phase as WarmupPhase || undefined,
          spamRisk: "LOW"
        }));

        // Hydrate Domains
        const resDomains = await client.query("SELECT * FROM domains WHERE deleted_at IS NULL");
        this.dbState.domains = resDomains.rows.map(r => ({
          id: r.id,
          name: r.name,
          spfStatus: r.spf_status,
          dkimStatus: r.dkim_status,
          dmarcStatus: r.dmarc_status,
          healthScore: r.health_score,
          inboxCount: 0,
          blacklistStatus: "CLEAN"
        }));

        // Hydrate templates
        const resTemplates = await client.query("SELECT * FROM templates WHERE deleted_at IS NULL");
        this.dbState.templates = resTemplates.rows.map(r => ({
          id: r.id,
          name: r.name,
          subject: r.subject,
          body: r.body,
          category: r.category || "General",
          createdAt: r.created_at,
          deletedAt: r.deleted_at || undefined
        }));

        // Hydrate Team Members
        const resTeam = await client.query("SELECT * FROM team_members WHERE deleted_at IS NULL");
        this.dbState.teamMembers = resTeam.rows.map(r => ({
          id: r.id,
          name: r.name,
          email: r.email,
          role: r.role as SecurityRole,
          status: r.status,
          joinedAt: r.created_at,
          deletedAt: r.deleted_at || undefined
        }));

        // Hydrate Replies
        const resReplies = await client.query("SELECT * FROM replies WHERE deleted_at IS NULL ORDER BY received_at DESC");
        this.dbState.replies = resReplies.rows.map(r => ({
          id: r.id,
          campaignId: r.campaign_id || "",
          campaignName: "", // hydrated dynamically
          leadEmail: r.from_email,
          firstName: "",
          lastName: "",
          company: "",
          subject: r.subject,
          body: r.body_text,
          sentiment: r.sentiment as ReplySentiment,
          timestamp: r.received_at,
          isRead: r.is_read,
          aiSuggestedReply: r.reply_thread || undefined
        }));

        // Hydrate Queue items
        const resQueue = await client.query("SELECT * FROM queue");
        this.dbState.queue = resQueue.rows.map(r => ({
          id: r.id,
          campaignId: r.campaign_id,
          leadId: r.lead_id,
          to: r.to_email,
          subject: r.subject,
          body: r.body,
          scheduledAt: r.scheduled_at,
          status: r.status as 'QUEUED' | 'PENDING' | 'SENT' | 'FAILED',
          attempts: r.attempts,
          errorMessage: r.error_message || undefined,
          lastAttempt: r.last_attempt || undefined,
          priority: r.priority || 2
        }));

        // Hydrate Audit Logs
        const resAudit = await client.query("SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT 1000");
        this.dbState.auditLogs = resAudit.rows.map(r => ({
          id: r.id,
          timestamp: r.timestamp,
          userId: r.user_id || undefined,
          userEmail: r.user_email || undefined,
          action: r.action,
          category: r.category as AuditLog['category'],
          details: r.details || undefined
        }));

        // Keep default agents hydrated in memory
        this.dbState.agents = [...defaultAgents];
        this.dbState.isInitialized = true;

        this.rebuildIndexes();
        console.log("SUCCESS: PostgreSQL Hydrated Database State Loaded successfully.");
      } finally {
        client.release();
      }
    } catch (err) {
      console.error("FATAL: Failed to initialize/load PostgreSQL database state:", err);
      throw err;
    }
  }

  /**
   * Save database changes synchronously in cache, and asynchronously push transactions to PostgreSQL.
   */
  public saveDb() {
    this.rebuildIndexes();
    if (pool) {
      this.syncStateToPostgres().catch(err => {
        console.error("[PostgreSQL Sync Fail] Relational synchronization error:", err);
      });
    }
  }

  /**
   * Performs full upsert statements on SQL tables to keep PostgreSQL synchronized.
   */
  private async syncStateToPostgres() {
    if (!pool) return;
    const client = await pool.connect();
    try {
      await client.query("BEGIN;");

      // 1. Sync Campaigns
      for (const c of this.dbState.campaigns) {
        await client.query(`
          INSERT INTO campaigns (id, name, status, sent_count, open_count, reply_count, bounce_count, unsub_count, created_at, updated_at, schedule_days, schedule_time_start, schedule_time_end, timezone, subject_template, body_template, deleted_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
          ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name, status = EXCLUDED.status, sent_count = EXCLUDED.sent_count, open_count = EXCLUDED.open_count, reply_count = EXCLUDED.reply_count,
            bounce_count = EXCLUDED.bounce_count, unsub_count = EXCLUDED.unsub_count, updated_at = EXCLUDED.updated_at, deleted_at = EXCLUDED.deleted_at;
        `, [c.id, c.name, c.status, c.sentCount, c.openCount, c.replyCount, c.bounceCount, c.unsubCount, c.createdAt, c.updatedAt, JSON.stringify(c.scheduleDays), c.scheduleTimeStart, c.scheduleTimeEnd, c.timezone, c.subjectTemplate, c.bodyTemplate, c.deletedAt || null]);
      }

      // 2. Sync Users
      for (const u of this.dbState.users) {
        await client.query(`
          INSERT INTO users (id, name, email, role, password_hash, password_salt, created_at, deleted_at, subscription_plan, subscription_status)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name, email = EXCLUDED.email, role = EXCLUDED.role, password_hash = EXCLUDED.password_hash, password_salt = EXCLUDED.password_salt,
            deleted_at = EXCLUDED.deleted_at, subscription_plan = EXCLUDED.subscription_plan, subscription_status = EXCLUDED.subscription_status;
        `, [u.id, u.name, u.email, u.role, u.passwordHash, u.passwordSalt, u.createdAt, u.deletedAt || null, u.subscriptionPlan || null, u.subscriptionStatus || null]);
      }

      // 3. Sync Leads
      for (const l of this.dbState.leads) {
        await client.query(`
          INSERT INTO leads (id, campaign_id, email, first_name, last_name, company, personalized_line, status, updated_at, crm_stage, phone, platform, profile_url, description_meta, proposed_service, error_message, deleted_at, website, business_description, services, technologies)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
          ON CONFLICT (id) DO UPDATE SET
            campaign_id = EXCLUDED.campaign_id, email = EXCLUDED.email, first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, company = EXCLUDED.company,
            personalized_line = EXCLUDED.personalized_line, status = EXCLUDED.status, updated_at = EXCLUDED.updated_at, crm_stage = EXCLUDED.crm_stage, phone = EXCLUDED.phone,
            platform = EXCLUDED.platform, profile_url = EXCLUDED.profile_url, description_meta = EXCLUDED.description_meta, proposed_service = EXCLUDED.proposed_service,
            error_message = EXCLUDED.error_message, deleted_at = EXCLUDED.deleted_at, website = EXCLUDED.website, business_description = EXCLUDED.business_description,
            services = EXCLUDED.services, technologies = EXCLUDED.technologies;
        `, [
          l.id, l.campaignId || null, l.email, l.firstName || null, l.lastName || null, l.company || null, l.personalizedLine || null, l.status, l.updatedAt, l.crmStage || null,
          l.phone || null, l.platform || null, l.profileUrl || null, l.descriptionMeta || null, l.proposedService || null, l.errorMessage || null, l.deletedAt || null,
          l.website || null, l.businessDescription || null, l.services ? JSON.stringify(l.services) : null, l.technologies ? JSON.stringify(l.technologies) : null
        ]);
      }

      // 4. Sync SMTP Accounts
      for (const s of this.dbState.smtpAccounts) {
        await client.query(`
          INSERT INTO smtp_accounts (id, name, email, username, smtp_host, smtp_port, smtp_password, daily_limit, sent_today, reputation_score, warmup_enabled, warmup_daily_limit, warmup_phase, created_at, deleted_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
          ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name, email = EXCLUDED.email, username = EXCLUDED.username, smtp_host = EXCLUDED.smtp_host, smtp_port = EXCLUDED.smtp_port,
            daily_limit = EXCLUDED.daily_limit, sent_today = EXCLUDED.sent_today, reputation_score = EXCLUDED.reputation_score, warmup_enabled = EXCLUDED.warmup_enabled,
            warmup_daily_limit = EXCLUDED.warmup_daily_limit, warmup_phase = EXCLUDED.warmup_phase, deleted_at = EXCLUDED.deleted_at;
        `, [s.id, s.username || "SMTP Account", s.email, s.username, s.smtpHost, s.smtpPort, s.smtpPassword || "", s.dailyLimit, s.sentToday || 0, s.reputationScore || 100, s.warmupEnabled || false, s.warmupDailyLimit || 15, s.warmupPhase || null, "2026-07-10", null]);
      }

      // 5. Sync Domains
      for (const d of this.dbState.domains) {
        await client.query(`
          INSERT INTO domains (id, name, spf_status, dkim_status, dmarc_status, health_score, created_at, deleted_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name, spf_status = EXCLUDED.spf_status, dkim_status = EXCLUDED.dkim_status, dmarc_status = EXCLUDED.dmarc_status,
            health_score = EXCLUDED.health_score, deleted_at = EXCLUDED.deleted_at;
        `, [d.id, d.name, d.spfStatus || "MISSING", d.dkimStatus || "MISSING", d.dmarcStatus || "MISSING", d.healthScore || 100, "2026-07-10", null]);
      }

      // 6. Sync Templates
      for (const t of this.dbState.templates) {
        await client.query(`
          INSERT INTO templates (id, name, subject, body, created_at, deleted_at)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name, subject = EXCLUDED.subject, body = EXCLUDED.body, deleted_at = EXCLUDED.deleted_at;
        `, [t.id, t.name, t.subject, t.body, t.createdAt || "2026-07-10", null]);
      }

      // 7. Sync Team Members
      for (const m of this.dbState.teamMembers) {
        await client.query(`
          INSERT INTO team_members (id, name, email, role, status, created_at, deleted_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name, email = EXCLUDED.email, role = EXCLUDED.role, status = EXCLUDED.status, deleted_at = EXCLUDED.deleted_at;
        `, [m.id, m.name, m.email, m.role, m.status, m.joinedAt || "2026-07-10", m.deletedAt || null]);
      }

      // 8. Sync Replies
      for (const r of this.dbState.replies) {
        await client.query(`
          INSERT INTO replies (id, campaign_id, lead_id, from_email, subject, body_text, sentiment, received_at, is_read, reply_thread, deleted_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          ON CONFLICT (id) DO UPDATE SET
            campaign_id = EXCLUDED.campaign_id, lead_id = EXCLUDED.lead_id, from_email = EXCLUDED.from_email, subject = EXCLUDED.subject,
            body_text = EXCLUDED.body_text, sentiment = EXCLUDED.sentiment, is_read = EXCLUDED.is_read, reply_thread = EXCLUDED.reply_thread, deleted_at = EXCLUDED.deleted_at;
        `, [r.id, r.campaignId || null, null, r.leadEmail, r.subject, r.body, r.sentiment, r.timestamp, r.isRead || false, r.aiSuggestedReply || null, null]);
      }

      // 9. Sync Queue Items
      for (const q of this.dbState.queue) {
        await client.query(`
          INSERT INTO queue (id, campaign_id, lead_id, to_email, subject, body, scheduled_at, status, attempts, error_message, last_attempt, priority)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          ON CONFLICT (id) DO UPDATE SET
            status = EXCLUDED.status, attempts = EXCLUDED.attempts, error_message = EXCLUDED.error_message, last_attempt = EXCLUDED.last_attempt, priority = EXCLUDED.priority;
        `, [q.id, q.campaignId, q.leadId, q.to, q.subject, q.body, q.scheduledAt, q.status, q.attempts || 0, q.errorMessage || null, q.lastAttempt || null, q.priority || 2]);
      }

      await client.query("COMMIT;");
    } catch (err) {
      await client.query("ROLLBACK;");
      throw err;
    } finally {
      client.release();
    }
  }

  private rebuildIndexes() {
    this.leadIndexByEmail.clear();
    this.leadIndexByCampaign.clear();
    this.queueIndexByCampaign.clear();

    for (const lead of this.dbState.leads) {
      if (lead.deletedAt) continue;
      this.leadIndexByEmail.set(lead.email.toLowerCase(), lead);

      const campLeads = this.leadIndexByCampaign.get(lead.campaignId) || [];
      campLeads.push(lead);
      this.leadIndexByCampaign.set(lead.campaignId, campLeads);
    }

    for (const item of this.dbState.queue) {
      const campItems = this.queueIndexByCampaign.get(item.campaignId) || [];
      campItems.push(item);
      this.queueIndexByCampaign.set(item.campaignId, campItems);
    }
  }

  public findLeadByEmail(email: string): Lead | undefined {
    return this.leadIndexByEmail.get(email.toLowerCase());
  }

  public findLeadsByCampaign(campaignId: string): Lead[] {
    return this.leadIndexByCampaign.get(campaignId) || [];
  }

  public findQueueItemsByCampaign(campaignId: string): QueueItem[] {
    return this.queueIndexByCampaign.get(campaignId) || [];
  }

  public logAudit(
    action: string,
    category: AuditLog['category'],
    userId?: string,
    details?: string,
    userEmail?: string
  ) {
    const log: AuditLog = {
      id: `audit-${Date.now()}-${crypto.randomUUID().split("-")[0]}`,
      timestamp: new Date().toISOString(),
      action,
      category,
      userId,
      userEmail,
      details
    };
    this.dbState.auditLogs.unshift(log);

    if (this.dbState.auditLogs.length > 1000) {
      this.dbState.auditLogs = this.dbState.auditLogs.slice(0, 1000);
    }
    this.saveDb();
  }

  public logEntityHistory(
    entityId: string,
    entityType: EntityHistory['entityType'],
    changedBy: string,
    previousState: any,
    newState: any
  ) {
    const historyItem: EntityHistory = {
      id: `hist-${Date.now()}-${crypto.randomUUID().split("-")[0]}`,
      entityId,
      entityType,
      changedAt: new Date().toISOString(),
      changedBy,
      previousState: JSON.stringify(previousState),
      newState: JSON.stringify(newState)
    };
    this.dbState.history.unshift(historyItem);
    this.saveDb();
  }
}

export const dbService = new DbService();
