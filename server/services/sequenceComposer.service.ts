/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AI Follow-up Writer + Personalization Enricher.
 *
 * Composes the next email for a prospect given a SequenceStep:
 *   - mode = 'manual'  → straight template substitution against the lead.
 *   - mode = 'ai'      → sends business + lead + previous-email + reply
 *                        history to Groq (via aiService) and asks for a
 *                        follow-up that BUILDS on the thread, never repeats
 *                        the same pitch.
 *
 * Every send also runs a personalization enricher: a per-recipient block
 * mentioning industry, location, USP, and (when available) a recent-activity
 * hook. Values only come from stored facts; nothing is fabricated.
 */

import { pool } from "../db/pool";
import {
  businessRepository,
  businessProfileRepository,
  leadRepository,
  campaignRepository,
  emailRepository,
  campaignResourceRepository,
  signatureRepository,
  emailTemplateV2Repository,
  promptRepository,
} from "../db/repositories";
import { Lead, Campaign } from "../../src/types";
import { SequenceStep } from "../db/repositories/sequenceStep.repository";
import { CampaignProspect } from "../db/repositories/campaignProspect.repository";
import { aiService } from "./ai.service";
import { knowledgeBaseService } from "./knowledgeBase.service";
import { log } from "../observability/logger";
import { Business } from "../db/repositories/business.repository";
import { BusinessProfile } from "../db/repositories/businessProfile.repository";

export interface ComposedMessage {
  subject: string;
  bodyText: string;
  bodyHtml: string;
  personalization: string;
  confidence: number;
  tone: string;
  usedAi: boolean;
}

function substitute(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_m, key) => vars[key] ?? "");
}

function firstOrUndef<T>(arr?: T[]): T | undefined {
  return arr && arr.length > 0 ? arr[0] : undefined;
}

interface PastEmail {
  step: number;
  subject: string;
  bodySnippet: string;
  sentAt?: string;
}

async function loadPreviousEmails(campaignId: string, leadEmailLower: string, limit = 5): Promise<PastEmail[]> {
  const r = await pool.query(
    `SELECT follow_up_step, subject, body_text, sent_at
       FROM emails
      WHERE campaign_id = $1 AND LOWER(to_email) = $2 AND status IN ('SENT','BOUNCED','COMPLAINED')
      ORDER BY sent_at DESC NULLS LAST
      LIMIT $3`,
    [campaignId, leadEmailLower, limit]
  );
  return r.rows.map((row) => ({
    step: row.follow_up_step || 0,
    subject: row.subject || "",
    bodySnippet: String(row.body_text || "").slice(0, 400),
    sentAt: row.sent_at ? new Date(row.sent_at).toISOString() : undefined,
  }));
}

async function loadReplies(campaignId: string, workspaceId: string, leadEmailLower: string): Promise<string[]> {
  const r = await pool.query(
    `SELECT body_text, category, classification_summary, received_at
       FROM replies
      WHERE campaign_id = $1 AND workspace_id = $2 AND LOWER(from_email) = $3
      ORDER BY received_at DESC
      LIMIT 5`,
    [campaignId, workspaceId, leadEmailLower]
  );
  return r.rows.map(
    (row) => `[${row.category || "reply"}] ${(row.classification_summary || row.body_text || "").slice(0, 300)}`
  );
}

function buildPersonalization(
  lead: Lead,
  business: Business | null,
  profile: BusinessProfile | null
): string {
  const bits: string[] = [];
  const industry = profile?.extractedIndustry || lead.industry;
  if (industry) bits.push(`Industry: ${industry}`);
  const category = business?.businessCategory;
  if (category && category !== industry) bits.push(`Category: ${category}`);
  const services = profile?.extractedServices || lead.services;
  const topService = firstOrUndef(services as string[] | undefined);
  if (topService) bits.push(`Top service: ${topService}`);
  const location = business?.address || undefined;
  if (location) bits.push(`Location: ${location.split(",").slice(-2).join(",").trim()}`);
  if (business?.googleRating != null && business.googleReviewsCount) {
    bits.push(`Google rating: ${business.googleRating}★ (${business.googleReviewsCount} reviews)`);
  }
  const latest = firstOrUndef((lead.latestPosts as string[] | undefined) || (profile as any)?.extractedLatestPosts);
  if (latest && typeof latest === "string") bits.push(`Recent activity: ${latest.slice(0, 140)}`);
  const usp = lead.aiResearch?.opportunities?.[0] || profile?.extractedAboutUs?.slice(0, 140);
  if (usp) bits.push(`Angle: ${usp}`);
  return bits.join(" | ");
}

export const sequenceComposerService = {
  async compose(input: {
    prospect: CampaignProspect;
    step: SequenceStep;
    campaign: Campaign;
    senderName?: string;
    senderCompany?: string;
    targetService?: string;
  }): Promise<ComposedMessage> {
    const lead = await leadRepository.findById(input.prospect.leadId);
    if (!lead) throw new Error(`Lead ${input.prospect.leadId} not found`);
    const business = input.prospect.businessId
      ? await businessRepository.findById(input.prospect.businessId)
      : null;
    const profile = business ? await businessProfileRepository.findByBusinessId(business.id) : null;
    const personalization = buildPersonalization(lead, business, profile);

    // ---- Phase 6: pull assigned resources (KBs, template, signature, prompt) ----
    const resources = await campaignResourceRepository.getSelection(
      input.campaign.id, input.prospect.workspaceId
    );

    // Resolve signature (per-campaign primary → workspace default → none).
    let signature = resources.primarySignatureId
      ? await signatureRepository.findById(resources.primarySignatureId, input.prospect.workspaceId)
      : null;
    if (!signature) {
      signature = await signatureRepository.findDefault(input.prospect.workspaceId);
    }

    // Resolve template — step-specific first, then any step-agnostic template.
    let template = null;
    const stepTplRef = resources.templateIds.find((t) => t.stepIndex === input.step.stepIndex);
    const globalTplRef = resources.templateIds.find((t) => t.stepIndex === null);
    const templateId = stepTplRef?.templateId ?? globalTplRef?.templateId;
    if (templateId) {
      template = await emailTemplateV2Repository.findById(templateId, input.prospect.workspaceId);
    }

    // Resolve prompt — step-specific first, then step-agnostic.
    let promptRef = null;
    const stepPromptRef = resources.promptIds.find((p) => p.stepIndex === input.step.stepIndex);
    const globalPromptRef = resources.promptIds.find((p) => p.stepIndex === null);
    const promptId = stepPromptRef?.promptId ?? globalPromptRef?.promptId;
    if (promptId) {
      promptRef = await promptRepository.findById(promptId, input.prospect.workspaceId);
    }

    const substitutionVars: Record<string, string> = {
      firstName: lead.firstName || "",
      lastName: lead.lastName || "",
      company: lead.company || (business?.name || ""),
      email: lead.email || "",
      industry: (lead as any).industry || profile?.extractedIndustry || "",
      website: lead.website || business?.website || "",
      city: (lead as any).city || (business?.address || "").split(",")[0] || "",
      country: (lead as any).country || "",
      personalizedLine: personalization,
      senderName: input.senderName || "",
      senderCompany: input.senderCompany || "",
      signature: signature?.textBody || "",
      unsubscribe: "", // dispatcher injects the real one on send
      custom: "",
    };

    // Manual template path — prefer the assigned V2 template over the raw step body.
    if (input.step.mode === "manual" || template) {
      const subjectSrc = template?.subject || input.step.subject || input.campaign.subjectTemplate || "Quick question for {{company}}";
      const textSrc    = template?.textBody || input.step.bodyText || input.campaign.bodyTemplate || "";
      const htmlSrc    = template?.htmlBody || input.step.bodyHtml || "";
      const subject = substitute(subjectSrc, substitutionVars);
      const bodyText = appendSignature(substitute(textSrc, substitutionVars), signature?.textBody);
      const bodyHtml = htmlSrc
        ? appendSignatureHtml(substitute(htmlSrc, substitutionVars), signature?.htmlBody)
        : appendSignatureHtml(
            bodyText.split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("\n"),
            signature?.htmlBody
          );
      return {
        subject,
        bodyText,
        bodyHtml,
        personalization,
        confidence: 1,
        tone: (input.campaign as any).defaultTone || "Consultative",
        usedAi: false,
      };
    }

    // AI path — mode is "ai" and no template was assigned to this step.
    const past = await loadPreviousEmails(input.campaign.id, (lead.email || "").toLowerCase());
    const replies = await loadReplies(input.campaign.id, input.prospect.workspaceId, (lead.email || "").toLowerCase());

    const camp = input.campaign as any;
    const tone = (camp.defaultTone || "Consultative") as
      | "Direct" | "Warm" | "Consultative" | "Playful";

    // ---- Phase 6: RAG retrieval from selected Knowledge Bases ----
    let ragContext = "";
    if (resources.knowledgeBaseIds.length > 0) {
      try {
        const ragQuery = [
          camp.goal || "",
          business?.name || lead.company || "",
          business?.businessCategory || (lead as any).industry || "",
          personalization,
        ].filter(Boolean).join(" | ").slice(0, 800);
        const hits = await knowledgeBaseService.retrieveContext({
          workspaceId: input.prospect.workspaceId,
          knowledgeBaseIds: resources.knowledgeBaseIds,
          query: ragQuery || (business?.name || lead.company || "outreach"),
          topK: 6,
        });
        ragContext = knowledgeBaseService.buildContextText(hits, 4000);
      } catch (err: any) {
        log.warn({ err: err?.message, campaignId: input.campaign.id }, "sequenceComposer: RAG retrieval failed — continuing without KB context");
      }
    }

    // If a Prompt Library entry is assigned, merge its user_prompt into
    // the instruction — the AI service still owns the JSON schema so we
    // don't blow up the response format.
    const promptSnippet = promptRef?.userPrompt ? `Follow this style guidance:\n${promptRef.userPrompt}` : "";

    // If we have a business, use the fact-grounded generator with follow-up
    // instructions + previous-thread context. Otherwise fall back to a
    // lead-based ask.
    if (business) {
      const instruction = [
        input.step.aiInstruction || "",
        promptSnippet,
        past.length > 0
          ? `This is follow-up #${input.step.stepIndex}. Prior emails in the thread (most-recent first):\n${past
              .map((p) => `- Step ${p.step} — "${p.subject}": ${p.bodySnippet}`)
              .join("\n")}\nDo NOT repeat prior arguments; add a new angle.`
          : "",
        replies.length > 0
          ? `Recent replies from this prospect:\n${replies.join("\n")}\nAcknowledge them where useful.`
          : "",
        `Personalization facts: ${personalization || "n/a"}.`,
        camp.goal ? `Overall campaign goal: ${camp.goal}` : "",
        ragContext
          ? `\n\nCOMPANY KNOWLEDGE (use these facts; never contradict them):\n${ragContext}`
          : "",
      ]
        .filter(Boolean)
        .join("\n\n");

      const composed = await aiService.generateEmailForBusiness({
        businessId: business.id,
        senderName: input.senderName || "Sales",
        senderCompany: input.senderCompany || "Outbound.AI",
        targetService: input.targetService || "the offer discussed",
        valueProp: instruction,
        tone,
      });

      const subject = input.step.subject
        ? substitute(input.step.subject, { ...substitutionVars, subject: composed.subject })
        : composed.subject;

      return {
        subject,
        bodyText: appendSignature(composed.bodyText, signature?.textBody),
        bodyHtml: appendSignatureHtml(composed.bodyHtml, signature?.htmlBody),
        personalization,
        confidence: composed.confidenceScore ?? 0.75,
        tone: composed.emailTone || tone,
        usedAi: true,
      };
    }

    // No business row — synthesize a fallback via generic pitch generator.
    try {
      const pitch = await aiService.generateCampaignPitch(
        lead.company || "the recipient",
        input.step.aiInstruction || "Short, polite follow-up. Reference prior email if any."
      );
      const subject = substitute(pitch.subject, substitutionVars);
      const body = substitute(pitch.body, substitutionVars);
      const bodyText = appendSignature(body, signature?.textBody);
      const bodyHtml = appendSignatureHtml(
        body.split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("\n"),
        signature?.htmlBody
      );
      return {
        subject,
        bodyText,
        bodyHtml,
        personalization,
        confidence: 0.6,
        tone: pitch.tone || tone,
        usedAi: true,
      };
    } catch (err: any) {
      log.warn({ err: err?.message, prospectId: input.prospect.id }, "sequenceComposer: fallback pitch failed");
      const subject = substitute(input.step.subject || input.campaign.subjectTemplate || "Following up on my note", substitutionVars);
      const bodyText = appendSignature(
        substitute(input.step.bodyText || input.campaign.bodyTemplate || "", substitutionVars),
        signature?.textBody
      );
      return {
        subject,
        bodyText,
        bodyHtml: appendSignatureHtml(
          bodyText.split(/\n{2,}/).map((p) => `<p>${p}</p>`).join(""),
          signature?.htmlBody
        ),
        personalization,
        confidence: 0.4,
        tone,
        usedAi: false,
      };
    }
  },

  buildPersonalization,
};

// ---------------- Signature helpers ----------------
function appendSignature(body: string, sig?: string): string {
  if (!sig || !sig.trim()) return body;
  const trimmed = body.trimEnd();
  return `${trimmed}\n\n${sig.trim()}`;
}
function appendSignatureHtml(bodyHtml: string, sigHtml?: string): string {
  if (!sigHtml || !sigHtml.trim()) return bodyHtml;
  return `${bodyHtml}\n<div class="email-signature">${sigHtml}</div>`;
}
