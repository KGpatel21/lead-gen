/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AI operations facade.
 *
 * Every call routes through the pluggable provider abstraction in
 * `server/ai/`. Prompts and JSON schemas here are byte-identical to
 * the previous Gemini implementation — only the transport changed.
 *
 * To swap providers: set `AI_PROVIDER` in `.env`. Options: groq | gemini.
 */

import { getAIProvider, AIProviderNotConfiguredError } from "../ai";
import {
  agentRepository,
  leadRepository,
  campaignRepository,
  businessRepository,
  businessProfileRepository,
  Business,
  BusinessProfile,
} from "../db/repositories";
import { Lead, ReplySentiment } from "../../src/types";

// Preserve the old export name so existing controllers keep compiling.
// `GeminiNotConfiguredError` is now an alias for the vendor-neutral class.
export { AIProviderNotConfiguredError as GeminiNotConfiguredError } from "../ai";
export { AIProviderError } from "../ai";

class AiService {
  public isConfigured(): boolean {
    return getAIProvider().isConfigured();
  }

  private static parseJsonResponse<T>(rawText: string): T {
    // Providers may still return code fences even when asked for JSON.
    const clean = rawText.trim().replace(/^```json/i, "").replace(/```$/, "").trim();
    return JSON.parse(clean) as T;
  }

  /**
   * Deep lead enrichment: business context, pain points, and a 4-step sequence.
   * Uses Google Search grounding when available.
   */
  public async enrichAndResearchLead(leadId: string): Promise<Lead | null> {
    const provider = getAIProvider();
    if (!provider.isConfigured()) {
      throw new AIProviderNotConfiguredError(provider.name, `${provider.name.toUpperCase()}_API_KEY`);
    }
    const lead = await leadRepository.findById(leadId);
    if (!lead) return null;
    const campaign = lead.campaignId ? await campaignRepository.findById(lead.campaignId) : null;
    const campaignName = campaign?.name || "Outbound Sales Pitch";

    const prompt = `
You are an elite cold-outreach intelligence agent. Perform lead enrichment,
research, and generate a hyper-personalized 4-step email sequence.

Prospect: ${lead.firstName} ${lead.lastName}
Company:  ${lead.company}
Email:    ${lead.email}
Platform: ${lead.platform || "LinkedIn"}
Profile:  ${lead.profileUrl || "(unknown)"}
Campaign context: ${campaignName}

Use Google Search to look up the company's website, industry, size, public
reviews, tech stack, and recent news.

Return ONLY a raw JSON object matching this schema exactly:
{
  "website": "string",
  "businessDescription": "string",
  "googleReviews": { "rating": number, "reviewCount": number, "keyReviews": ["string"] },
  "services": ["string"],
  "socialLinks": { "linkedin": "string", "instagram": "string", "facebook": "string", "twitter": "string" },
  "businessHours": "string",
  "bookingLinks": "string",
  "latestPosts": ["string"],
  "technologies": ["string"],
  "industry": "string",
  "employees": "string",
  "companySummary": "string",
  "aiResearch": {
    "businessSummary": "string",
    "painPoints": ["string"],
    "opportunities": ["string"],
    "improvementSuggestions": ["string"],
    "aiLeadScore": number
  },
  "aiEmails": {
    "initial":    { "subject": "string", "preview": "string", "opening": "string", "body": "string", "cta": "string", "signature": "string", "spamScore": number, "readabilityScore": number, "tone": "string" },
    "followUp1":  { "subject": "string", "preview": "string", "opening": "string", "body": "string", "cta": "string", "signature": "string", "spamScore": number, "readabilityScore": number, "tone": "string" },
    "followUp2":  { "subject": "string", "preview": "string", "opening": "string", "body": "string", "cta": "string", "signature": "string", "spamScore": number, "readabilityScore": number, "tone": "string" },
    "followUp3":  { "subject": "string", "preview": "string", "opening": "string", "body": "string", "cta": "string", "signature": "string", "spamScore": number, "readabilityScore": number, "tone": "string" }
  }
}
Do not include markdown code fences.
`;

    const result = await provider.generate({
      prompt,
      responseFormat: "json",
      metadata: { operation: "enrichLead", leadId, company: lead.company },
    });

    const parsed = AiService.parseJsonResponse<any>(result.text || "");
    const enriched = await leadRepository.setEnrichment(leadId, {
      website: parsed.website,
      businessDescription: parsed.businessDescription,
      googleReviews: parsed.googleReviews,
      services: parsed.services,
      socialLinks: parsed.socialLinks,
      businessHours: parsed.businessHours,
      bookingLinks: parsed.bookingLinks,
      latestPosts: parsed.latestPosts,
      technologies: parsed.technologies,
      industry: parsed.industry,
      employees: parsed.employees,
      companySummary: parsed.companySummary,
      aiResearch: parsed.aiResearch,
      aiEmails: parsed.aiEmails,
      descriptionMeta: parsed.aiResearch?.businessSummary?.substring(0, 150),
      proposedService: parsed.services?.[0],
    });

    await agentRepository.logRun({
      agentId: "agent-lead-hunter",
      input: `Enrich lead ${lead.company} (${lead.id})`,
      output: `Enriched. score=${parsed.aiResearch?.aiLeadScore ?? "?"} industry=${parsed.industry ?? "?"}`,
      status: "SUCCESS",
    });

    return enriched;
  }

  /**
   * Produce a personalized initial email for a lead. Uses cached lead.aiEmails
   * when present, otherwise falls back to template substitution against the
   * campaign's subject/body templates. This method does NOT call the AI —
   * it composes from data the AI already produced (or from your template).
   */
  public async composeInitialEmail(
    leadId: string,
    campaignId: string
  ): Promise<{ subject: string; body: string }> {
    const lead = await leadRepository.findById(leadId);
    const campaign = await campaignRepository.findById(campaignId);
    if (!lead || !campaign) return { subject: "", body: "" };

    if (lead.aiEmails?.initial) {
      const init = lead.aiEmails.initial;
      const subject = init.subject.replace(/\{\{company\}\}/g, lead.company || "");
      const body = `${init.opening}\n\n${init.body}\n\n${init.cta}\n\n${init.signature}`;
      return { subject, body };
    }

    const substitute = (tpl: string) =>
      tpl
        .replace(/\{\{firstName\}\}/g, lead.firstName || "")
        .replace(/\{\{lastName\}\}/g, lead.lastName || "")
        .replace(/\{\{company\}\}/g, lead.company || "")
        .replace(/\{\{personalizedLine\}\}/g, lead.personalizedLine || "");

    return {
      subject: substitute(campaign.subjectTemplate || "Quick question for {{company}}"),
      body: substitute(campaign.bodyTemplate || "Hi {{firstName}},\n\n{{personalizedLine}}"),
    };
  }

  public async classifySentimentAndDraftReply(
    replyText: string
  ): Promise<{ sentiment: ReplySentiment; aiReplyDraft: string; actionPlan: string }> {
    const provider = getAIProvider();
    const prompt = `
Classify this cold-outreach reply and draft a response.

Reply:
"""${replyText.slice(0, 2000)}"""

Return ONLY raw JSON:
{
  "sentiment": "Interested" | "Not Interested" | "Meeting" | "Spam",
  "aiReplyDraft": "string",
  "actionPlan": "string (one sentence)"
}
`;
    const result = await provider.generate({
      prompt,
      responseFormat: "json",
      metadata: { operation: "classifyReply" },
    });
    const parsed = AiService.parseJsonResponse<{
      sentiment: string;
      aiReplyDraft: string;
      actionPlan: string;
    }>(result.text || "");

    const sentimentMap: Record<string, ReplySentiment> = {
      "Interested": ReplySentiment.INTERESTED,
      "Not Interested": ReplySentiment.NOT_INTERESTED,
      "Meeting": ReplySentiment.MEETING,
      "Spam": ReplySentiment.SPAM,
    };
    return {
      sentiment: sentimentMap[parsed.sentiment] ?? ReplySentiment.NOT_INTERESTED,
      aiReplyDraft: parsed.aiReplyDraft,
      actionPlan: parsed.actionPlan,
    };
  }

  public async generateCampaignPitch(
    topic: string,
    valueProp: string
  ): Promise<{ subject: string; body: string; spamScore: number; tone: string }> {
    const provider = getAIProvider();
    const prompt = `
Generate a high-converting 1-step cold-email pitch.
Niche/topic: ${topic}
Value proposition: ${valueProp}

Rules: 3-5 word subject, <120 words body, use {{firstName}}/{{company}}/{{personalizedLine}} tags,
calculate spam score 0.1-10.0.

Return ONLY raw JSON: { "subject": "string", "body": "string", "spamScore": number, "tone": "string" }
`;
    const result = await provider.generate({
      prompt,
      responseFormat: "json",
      metadata: { operation: "generateCampaignPitch", topic },
    });
    return AiService.parseJsonResponse(result.text || "");
  }

  public async personalizeLine(lead: Lead, styleGuide: string): Promise<string> {
    const provider = getAIProvider();
    const prompt = `
Draft a single, natural first line for a cold email.
Lead: ${lead.firstName} ${lead.lastName} — ${lead.company}
Style: ${styleGuide || "Reference a specific achievement or industry angle."}

Rules: 1 sentence, ≤18 words, no "hope this finds you well", no "congrats on the success".

Return ONLY the sentence.`;
    const result = await provider.generate({
      prompt,
      responseFormat: "text",
      metadata: { operation: "personalizeLine", leadId: lead.id },
    });
    return (result.text || "").replace(/["]/g, "").trim();
  }

  public async runAgent(agentId: string, input: string): Promise<string> {
    const provider = getAIProvider();
    const agent = await agentRepository.findById(agentId);
    if (!agent) throw new Error(`Agent ${agentId} not found`);
    await agentRepository.setStatus(agentId, "ACTIVE");
    await agentRepository.incrementTaskCount(agentId);
    try {
      const result = await provider.generate({
        prompt: input,
        systemPrompt: agent.systemPrompt,
        responseFormat: "text",
        metadata: { operation: "runAgent", agentId, agentName: agent.name },
      });
      const output = result.text || "";
      await agentRepository.logRun({ agentId, input, output, status: "SUCCESS" });
      return output;
    } catch (err: any) {
      await agentRepository.logRun({
        agentId,
        input,
        output: err?.message || "unknown error",
        status: "FAILED",
      });
      throw err;
    } finally {
      await agentRepository.setStatus(agentId, "IDLE");
    }
  }

  /**
   * Autopilot: compile a lead list for a topic + platform.
   * Grounding removed permanently — Places API is the source-of-truth for
   * real businesses in the primary pipeline.
   */
  public async autopilotProspect(input: {
    topic: string;
    platform: string;
    count: number;
  }): Promise<{
    strategy: string;
    prospects: Array<{
      firstName: string;
      lastName: string;
      company: string;
      email: string;
      phone: string;
      platform: string;
      profileUrl: string;
      personalizedLine: string;
      descriptionMeta: string;
      proposedService: string;
    }>;
  }> {
    const provider = getAIProvider();
    const prompt = `
You are the Boss Agent of a sales execution system. Find EXACTLY ${input.count}
verified prospect leads for the topic "${input.topic}" strictly on ${input.platform}.

Rules: every prospect's "platform" MUST equal "${input.platform}". profileUrl must
be a plausible ${input.platform} link. Never mix platforms.

For each prospect provide: firstName, lastName, company (specific business name),
email, phone, platform, profileUrl, personalizedLine, descriptionMeta, proposedService.

Return ONLY raw JSON:
{ "strategy": "string", "prospects": [ { "firstName":"...", "lastName":"...", "company":"...", "email":"...", "phone":"...", "platform":"...", "profileUrl":"...", "personalizedLine":"...", "descriptionMeta":"...", "proposedService":"..." } ] }
`;
    const result = await provider.generate({
      prompt,
      responseFormat: "json",
      metadata: { operation: "autopilotProspect", topic: input.topic, platform: input.platform, count: input.count },
    });
    return AiService.parseJsonResponse(result.text || "");
  }

  // ------------------------------------------------------------------
  // Lead-discovery pipeline: reasoning-only email generation from
  // extracted Places + Firecrawl data.
  // ------------------------------------------------------------------

  public async generateEmailForBusiness(input: {
    businessId: string;
    targetService: string;
    senderName: string;
    senderCompany: string;
    valueProp?: string;
    tone?: "Direct" | "Warm" | "Consultative" | "Playful";
  }): Promise<{
    subject: string;
    openingLine: string;
    bodyText: string;
    bodyHtml: string;
    painPoints: string[];
    benefits: string[];
    cta: string;
    confidenceScore: number;
    emailTone: string;
  }> {
    const provider = getAIProvider();
    const business = await businessRepository.findById(input.businessId);
    if (!business) throw new Error(`Business ${input.businessId} not found`);
    const profile = await businessProfileRepository.findByBusinessId(business.id);

    // Build a compact structured context from extracted data ONLY.
    // No web-search. No fabricated facts.
    const facts = this.buildFactSheet(business, profile);
    const factsCount = Object.keys(facts).length;

    const prompt = `
You are a senior B2B copywriter. Write a single cold outreach email using ONLY
the facts listed below. Never invent facts, statistics, or achievements. If a
detail is missing, omit it rather than guess.

FACTS ABOUT THE PROSPECT (verified via Google Places + their public website):
${JSON.stringify(facts, null, 2)}

WHO IS EMAILING THEM:
- Sender name: ${input.senderName}
- Sender company: ${input.senderCompany}
- Target service being offered: ${input.targetService}
${input.valueProp ? `- Value proposition: ${input.valueProp}` : ""}

STYLE:
- Tone: ${input.tone || "Consultative"}
- Length: 90–140 words body.
- One clear call-to-action.
- No generic "hope this email finds you well".
- No em-dashes.
- No emojis.
- Subject line: 4-7 words, no clickbait, no ALL CAPS.
- Opening line: reference ONE concrete detail from the facts above (business name,
  service they offer, or public rating). Under 20 words.
- confidenceScore: 0.0-1.0. Reflects how strongly the FACTS support this pitch;
  drop it below 0.5 if you had to omit key facts.

Return ONLY raw JSON matching:
{
  "subject": "string",
  "openingLine": "string",
  "bodyText": "string (plain text version, \\n newlines)",
  "bodyHtml": "string (well-formed HTML: paragraphs, no external CSS)",
  "painPoints": ["string", "..."],
  "benefits":  ["string", "..."],
  "cta": "string",
  "confidenceScore": number,
  "emailTone": "string"
}
No markdown code fences.
`;

    const result = await provider.generate({
      prompt,
      responseFormat: "json",
      metadata: {
        operation: "generateEmailForBusiness",
        businessId: input.businessId,
        businessName: business.name,
        factsCount,
      },
    });

    const parsed = AiService.parseJsonResponse<{
      subject: string;
      openingLine: string;
      bodyText: string;
      bodyHtml: string;
      painPoints: string[];
      benefits: string[];
      cta: string;
      confidenceScore: number;
      emailTone: string;
    }>(result.text || "");

    await agentRepository.logRun({
      agentId: "agent-copywriter",
      input: `Generate email for ${business.name} (${business.id}); ${factsCount} verified facts`,
      output: `subject="${parsed.subject}" tone=${parsed.emailTone} confidence=${parsed.confidenceScore}`,
      status: "SUCCESS",
    });

    return parsed;
  }

  private buildFactSheet(business: Business, profile: BusinessProfile | null): Record<string, unknown> {
    const facts: Record<string, unknown> = {
      businessName: business.name,
    };
    if (business.address) facts.address = business.address;
    if (business.businessCategory) facts.category = business.businessCategory;
    if (business.website) facts.website = business.website;
    if (business.phone) facts.phone = business.phone;
    if (business.googleRating != null) {
      facts.googleRating = business.googleRating;
      if (business.googleReviewsCount != null) facts.googleReviewsCount = business.googleReviewsCount;
    }
    if (business.googleMapsUrl) facts.googleMapsUrl = business.googleMapsUrl;

    if (profile && profile.firecrawlStatus === "SUCCESS") {
      if (profile.extractedDescription) facts.publicDescription = profile.extractedDescription.slice(0, 400);
      if (profile.extractedAboutUs) facts.aboutUs = profile.extractedAboutUs.slice(0, 500);
      if (profile.extractedServices?.length) facts.publishedServices = profile.extractedServices.slice(0, 10);
      if (profile.extractedProducts?.length) facts.publishedProducts = profile.extractedProducts.slice(0, 10);
      if (profile.extractedIndustry) facts.industry = profile.extractedIndustry;
      if (profile.extractedTechnologies?.length) facts.technologies = profile.extractedTechnologies.slice(0, 10);
      if (profile.extractedCompanySize) facts.companySize = profile.extractedCompanySize;
    }

    return facts;
  }
}

export const aiService = new AiService();
