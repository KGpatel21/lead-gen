/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Typed endpoint functions. Wrap `api.*` so call sites read like domain
 * operations, not URL strings.
 */

import { api, session, StoredUser } from "./client";
import {
  Campaign, Lead, SmtpAccount, Domain, EmailTemplate, Reply,
  TeamMember, SecurityRole, AiAgent, AgentTaskLog,
} from "../types";

// ---- Auth ----
export interface AuthResponse {
  success: boolean;
  token: string;
  user: StoredUser;
}

export const authApi = {
  async register(payload: { name: string; email: string; password: string }): Promise<AuthResponse> {
    const r = await api.raw<AuthResponse>("POST", "/api/auth/register", payload);
    if (r.token && r.user) {
      session.setToken(r.token);
      session.setUser(r.user);
    }
    return r;
  },
  async login(payload: { email: string; password: string }): Promise<AuthResponse> {
    const r = await api.raw<AuthResponse>("POST", "/api/auth/login", payload);
    if (r.token && r.user) {
      session.setToken(r.token);
      session.setUser(r.user);
    }
    return r;
  },
  async me(): Promise<StoredUser> {
    const r = await api.raw<{ success: boolean; user: StoredUser }>("GET", "/api/auth/me");
    return r.user;
  },
  logout(): void {
    session.clearAll();
  },
};

// ---- Campaigns ----
export const campaignsApi = {
  list(): Promise<Campaign[]> { return api.get<Campaign[]>("/api/campaigns"); },
  create(payload: { name: string; subjectTemplate?: string; bodyTemplate?: string }): Promise<Campaign> {
    return api.raw<{ success: boolean; campaign: Campaign }>("POST", "/api/campaigns", payload).then((r) => r.campaign);
  },
  update(id: string, patch: Partial<Campaign>): Promise<Campaign> {
    return api.raw<{ success: boolean; campaign: Campaign }>("PUT", `/api/campaigns/${id}`, patch).then((r) => r.campaign);
  },
  delete(id: string): Promise<void> {
    return api.del<void>(`/api/campaigns/${id}`).then(() => undefined);
  },
  leads(id: string): Promise<Lead[]> { return api.get<Lead[]>(`/api/campaigns/${id}/leads`); },
  addLead(id: string, payload: Partial<Lead>): Promise<Lead> {
    return api.raw<{ success: boolean; lead: Lead }>("POST", `/api/campaigns/${id}/leads`, payload).then((r) => r.lead);
  },
  bulkLeads(id: string, leads: Partial<Lead>[]): Promise<{ count: number; leads: Lead[] }> {
    return api.raw<{ success: boolean; count: number; leads: Lead[] }>("POST", `/api/campaigns/${id}/leads/bulk`, { leads });
  },
  uploadCsv(id: string, csvText: string): Promise<{ successCount: number; dupCount: number; invalidCount: number }> {
    return api.raw<any>("POST", `/api/campaigns/${id}/leads/upload`, { csvText });
  },
  bulkEnrich(id: string): Promise<{ count: number; message: string }> {
    return api.raw<any>("POST", `/api/campaigns/${id}/ai-bulk-enrich-research`);
  },
  bulkPersonalize(id: string, instruction?: string): Promise<{ count: number; samplePersonalizations: Array<{ email: string; line: string }> }> {
    return api.raw<any>("POST", `/api/campaigns/${id}/ai-bulk-personalize`, { customizationInstruction: instruction });
  },
  generatePitch(topic: string, valueProp: string): Promise<{ subject: string; body: string; spamScore: number; tone: string }> {
    return api.raw<any>("POST", "/api/ai/generate-campaign-pitch", { topic, valueProp });
  },
};

// ---- Leads ----
export const leadsApi = {
  list(): Promise<Lead[]> { return api.get<Lead[]>("/api/leads"); },
  update(id: string, patch: Partial<Lead>): Promise<Lead> {
    return api.raw<{ success: boolean; lead: Lead }>("PUT", `/api/leads/${id}`, patch).then((r) => r.lead);
  },
  updateCrm(id: string, crmStage: string): Promise<Lead> {
    return api.raw<{ success: boolean; lead: Lead }>("PUT", `/api/leads/${id}/crm`, { crmStage }).then((r) => r.lead);
  },
  delete(id: string): Promise<void> { return api.del(`/api/leads/${id}`).then(() => undefined); },
  sendNow(id: string): Promise<{ lead: Lead; message: string }> {
    return api.raw<any>("POST", `/api/leads/${id}/send-now`);
  },
  enrich(id: string): Promise<{ lead: Lead }> {
    return api.raw<any>("POST", `/api/leads/${id}/enrich-research`);
  },
};

// ---- SMTP ----
export const smtpApi = {
  list(): Promise<SmtpAccount[]> { return api.get<SmtpAccount[]>("/api/smtp-accounts"); },
  create(payload: Partial<SmtpAccount> & { name?: string; smtpPassword?: string }): Promise<SmtpAccount> {
    return api.raw<{ success: boolean; smtpAccount: SmtpAccount }>("POST", "/api/smtp-accounts", payload).then((r) => r.smtpAccount);
  },
  update(id: string, patch: Partial<SmtpAccount>): Promise<SmtpAccount> {
    return api.raw<{ success: boolean; smtpAccount: SmtpAccount }>("PUT", `/api/smtp-accounts/${id}`, patch).then((r) => r.smtpAccount);
  },
  delete(id: string): Promise<void> { return api.del(`/api/smtp-accounts/${id}`).then(() => undefined); },
  test(id: string): Promise<{ message: string }> {
    return api.raw<any>("POST", `/api/smtp-accounts/${id}/test`);
  },
};

// ---- Domains ----
export const domainsApi = {
  list(): Promise<Domain[]> { return api.get<Domain[]>("/api/domains"); },
  create(domainName: string): Promise<Domain> {
    return api.raw<{ success: boolean; domain: Domain }>("POST", "/api/domains", { domainName }).then((r) => r.domain);
  },
  verify(id: string): Promise<Domain> {
    return api.raw<{ success: boolean; domain: Domain }>("POST", `/api/domains/${id}/verify`).then((r) => r.domain);
  },
  delete(id: string): Promise<void> { return api.del(`/api/domains/${id}`).then(() => undefined); },
};

// ---- Templates ----
export const templatesApi = {
  list(): Promise<EmailTemplate[]> { return api.get<EmailTemplate[]>("/api/templates"); },
  create(payload: { name: string; subject: string; body: string; category?: string }): Promise<EmailTemplate> {
    return api.raw<{ success: boolean; template: EmailTemplate }>("POST", "/api/templates", payload).then((r) => r.template);
  },
};

// ---- Replies ----
export const repliesApi = {
  list(): Promise<Reply[]> { return api.get<Reply[]>("/api/replies"); },
  markRead(id: string): Promise<Reply> {
    return api.raw<{ success: boolean; reply: Reply }>("PUT", `/api/replies/${id}/read`).then((r) => r.reply);
  },
  generateAiReply(id: string): Promise<{ sentiment: string; aiReplyDraft: string; actionPlan: string }> {
    return api.raw<any>("POST", `/api/replies/${id}/ai-reply`);
  },
  send(id: string, messageText: string): Promise<{ message: string }> {
    return api.raw<any>("POST", `/api/replies/${id}/send`, { messageText });
  },
};

// ---- Team ----
export const teamApi = {
  list(): Promise<TeamMember[]> { return api.get<TeamMember[]>("/api/team"); },
  invite(payload: { name: string; email: string; role?: SecurityRole }): Promise<{ member: TeamMember; inviteToken: string }> {
    return api.raw<{ success: boolean; member: TeamMember; inviteToken: string }>("POST", "/api/team/invite", payload).then((r) => ({
      member: r.member,
      inviteToken: r.inviteToken,
    }));
  },
};

// ---- Dashboard ----
export interface DashboardStats {
  totalSent: number;
  avgOpenRate: number;
  avgReplyRate: number;
  avgBounceRate: number;
  activeCampaignsCount: number;
  avgReputation: number;
  avgDomainHealth: number;
  recentReplies: Reply[];
  timeline: {
    sentOverTime: { date: string; sent: number; opens: number; replies: number }[];
    domainReputationTrend: { date: string; avgScore: number }[];
    warmupTrend: { date: string; sent: number; recovered: number }[];
    repliesSentimentBreakdown: { name: string; value: number; color: string }[];
  };
}

export const dashboardApi = {
  stats(): Promise<DashboardStats> { return api.raw<DashboardStats>("GET", "/api/dashboard/stats"); },
};

// ---- Agents ----
export const agentsApi = {
  list(): Promise<AiAgent[]> { return api.get<AiAgent[]>("/api/agents"); },
  logs(): Promise<AgentTaskLog[]> { return api.get<AgentTaskLog[]>("/api/agents/logs"); },
  run(id: string, inputPayload: string): Promise<{ output: string }> {
    return api.raw<any>("POST", `/api/agents/${id}/run`, { inputPayload });
  },
};

// ---- Queue ----
export const queueApi = {
  list(campaignId?: string, status?: string) {
    const qs = new URLSearchParams();
    if (campaignId) qs.set("campaignId", campaignId);
    if (status) qs.set("status", status);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return api.raw<{ success: boolean; data: any[]; meta: { page: number; limit: number; total: number } }>("GET", `/api/queue${suffix}`);
  },
  retry(id: string) { return api.raw<any>("POST", `/api/queue/${id}/retry`); },
  retryCampaign(campaignId: string) { return api.raw<any>("POST", `/api/queue/campaign/${campaignId}/retry`); },
  delete(id: string) { return api.del<void>(`/api/queue/${id}`); },
  clearFailed() { return api.del<void>("/api/queue/failed/all"); },
};

// ---- Campaign Automation (Phase 5) ----
export interface SequenceStepDto {
  id?: string;
  stepIndex: number;
  abGroup?: string;
  delayHours?: number;
  mode?: "ai" | "manual";
  subject?: string;
  bodyText?: string;
  bodyHtml?: string;
  aiInstruction?: string;
  senderPoolId?: string;
  accountId?: string;
  isActive?: boolean;
}

export interface CampaignDashboardSummary {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  buckets: Record<string, number>;
  rates: Record<string, number>;
  counts: Record<string, number>;
  prospects: Record<string, number>;
  stopReasons: Record<string, number>;
  upcoming: { prospectId: string; step: number; when: string | null } | null;
  currentStepMax: number;
  perSender: Array<{
    accountId: string; email: string; provider: string;
    sent: number; opened: number; replied: number; bounced: number;
    openRate: number; replyRate: number;
  }>;
  perProvider: Array<{
    provider: string; sent: number; replied: number; bounced: number; replyRate: number;
  }>;
}

export const campaignAutomationApi = {
  listSteps(campaignId: string) {
    return api.raw<{ success: boolean; steps: SequenceStepDto[] }>("GET", `/api/campaigns/${campaignId}/sequence`);
  },
  saveSteps(campaignId: string, steps: SequenceStepDto[]) {
    return api.raw<{ success: boolean; steps: SequenceStepDto[] }>(
      "PUT",
      `/api/campaigns/${campaignId}/sequence`,
      { steps }
    );
  },
  upsertStep(campaignId: string, step: SequenceStepDto) {
    return api.raw<{ success: boolean; step: SequenceStepDto }>(
      "POST",
      `/api/campaigns/${campaignId}/sequence/steps`,
      step
    );
  },
  deleteStep(campaignId: string, stepId: string) {
    return api.raw<{ success: boolean }>("DELETE", `/api/campaigns/${campaignId}/sequence/steps/${stepId}`);
  },
  listProspects(campaignId: string) {
    return api.raw<{ success: boolean; prospects: any[] }>("GET", `/api/campaigns/${campaignId}/prospects`);
  },
  enroll(campaignId: string, leadIds: string[] = []) {
    return api.raw<{ success: boolean; enrolled: number; skipped: number }>(
      "POST",
      `/api/campaigns/${campaignId}/prospects/enroll`,
      { leadIds }
    );
  },
  skipLead(prospectId: string) {
    return api.raw<{ success: boolean; prospect: any }>("POST", `/api/campaigns/prospects/${prospectId}/skip`);
  },
  forceNext(prospectId: string) {
    return api.raw<{ success: boolean; jobId: string }>("POST", `/api/campaigns/prospects/${prospectId}/force-next`);
  },
  previewNext(prospectId: string) {
    return api.raw<{ success: boolean; preview: any }>("GET", `/api/campaigns/prospects/${prospectId}/preview-next`);
  },
  pause(campaignId: string) { return api.raw<any>("POST", `/api/campaigns/${campaignId}/pause`); },
  resume(campaignId: string) { return api.raw<any>("POST", `/api/campaigns/${campaignId}/resume`); },
  clone(campaignId: string, name?: string) { return api.raw<any>("POST", `/api/campaigns/${campaignId}/clone`, { name }); },
  archive(campaignId: string) { return api.raw<any>("POST", `/api/campaigns/${campaignId}/archive`); },
  unarchive(campaignId: string) { return api.raw<any>("POST", `/api/campaigns/${campaignId}/unarchive`); },
  del(campaignId: string) { return api.raw<any>("POST", `/api/campaigns/${campaignId}/delete`); },
  cancelEmail(emailId: string) { return api.raw<any>("POST", `/api/emails/${emailId}/cancel`); },
  listHolidays(campaignId: string) {
    return api.raw<{ success: boolean; holidays: any[] }>("GET", `/api/campaigns/${campaignId}/holidays`);
  },
  addHoliday(campaignId: string, date: string, name?: string, scope: "global" | "campaign" = "campaign") {
    return api.raw<any>("POST", `/api/campaigns/${campaignId}/holidays`, { date, name, scope });
  },
  removeHoliday(holidayId: string) {
    return api.raw<any>("DELETE", `/api/campaigns/holidays/${holidayId}`);
  },
  dashboardWorkspace() {
    return api.raw<{ success: boolean; campaigns: CampaignDashboardSummary[]; queues: any }>(
      "GET",
      "/api/campaigns/dashboard"
    );
  },
  dashboardCampaign(campaignId: string) {
    return api.raw<{ success: boolean; dashboard: CampaignDashboardSummary }>(
      "GET",
      `/api/campaigns/${campaignId}/dashboard`
    );
  },
};

// ---- Automation / Autopilot ----
export const automationApi = {
  trigger(task: string, campaignId?: string): Promise<any> {
    return api.raw<any>("POST", "/api/automation/trigger", { task, campaignId });
  },
  autopilotDispatch(payload: { topic: string; platforms?: string; count?: number }): Promise<any> {
    return api.raw<any>("POST", "/api/autopilot/dispatch", payload);
  },
};

// ---- Lead Discovery pipeline (Places → Firecrawl → Gemini → SES) ----

export interface DiscoveredBusiness {
  id: string;
  placeId: string;
  name: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  phone?: string;
  website?: string;
  googleMapsUrl?: string;
  googleRating?: number;
  googleReviewsCount?: number;
  businessCategory?: string;
  businessTypes?: string[];
  businessStatus?: string;
}

export interface GeneratedEmail {
  id: string;
  campaignId?: string;
  businessId?: string;
  toEmail: string;
  fromEmail?: string;
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  openingLine?: string;
  painPoints?: string[];
  benefits?: string[];
  cta?: string;
  confidenceScore?: number;
  emailTone?: string;
  status: string;
  provider?: string;
  messageId?: string;
  errorMessage?: string;
  sentAt?: string;
  createdAt: string;
}

export const leadDiscoveryApi = {
  search(payload: { query: string; city?: string; count?: number; pageToken?: string }) {
    return api.raw<{
      success: boolean;
      totalFetched: number;
      cachedPages: number;
      freshPages: number;
      nextPageToken?: string;
      businesses: DiscoveredBusiness[];
    }>("POST", "/api/leads/search", payload);
  },
  analyze(businessIds: string[]) {
    return api.raw<{
      success: boolean;
      results: Array<{ businessId: string; businessName?: string; status: string; reason?: string; cache?: boolean }>;
    }>("POST", "/api/business/analyze", { businessIds });
  },
  generateEmail(payload: {
    businessId: string;
    campaignId?: string;
    toEmail?: string;
    senderName: string;
    senderCompany: string;
    targetService: string;
    valueProp?: string;
    tone?: string;
  }) {
    return api.raw<{ success: boolean; email: GeneratedEmail; business: DiscoveredBusiness }>(
      "POST",
      "/api/email/generate",
      payload
    );
  },
  createCampaign(payload: { name: string; businessIds: string[] }) {
    return api.raw<{ success: boolean; campaign: any; businessCount: number }>(
      "POST",
      "/api/campaign/create",
      payload
    );
  },
  sendCampaign(campaignId: string) {
    return api.raw<{ success: boolean; sent: number; failed: number; total: number }>(
      "POST",
      `/api/campaign/${campaignId}/send`
    );
  },
  pauseCampaign(campaignId: string) {
    return api.raw<{ success: boolean; paused: number }>("POST", `/api/campaign/${campaignId}/pause`);
  },
  resumeCampaign(campaignId: string) {
    return api.raw<{ success: boolean; resumed: number }>("POST", `/api/campaign/${campaignId}/resume`);
  },
  cancelCampaign(campaignId: string) {
    return api.raw<{ success: boolean; cancelled: number }>("POST", `/api/campaign/${campaignId}/cancel`);
  },
  getCampaign(campaignId: string) {
    return api.raw<{ success: boolean; campaign: any; emails: GeneratedEmail[] }>(
      "GET",
      `/api/campaign/${campaignId}`
    );
  },
  getCampaignStats(campaignId: string) {
    return api.raw<{ success: boolean; stats: Record<string, number> }>("GET", `/api/campaign/${campaignId}/stats`);
  },
};
