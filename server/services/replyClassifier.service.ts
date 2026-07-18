/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Reply classification via the shared AI provider (Groq by default).
 * Nine buckets + a short summary + confidence. Prompt kept deterministic
 * with a strict JSON response format.
 */

import { getAIProvider, AIProviderNotConfiguredError } from "../ai";
import { ReplySentiment } from "../../src/types";
import { log } from "../observability/logger";

export type ReplyCategory =
  | "Interested"
  | "Meeting Requested"
  | "Need More Information"
  | "Price Objection"
  | "Not Interested"
  | "Out of Office"
  | "Auto Reply"
  | "Spam Complaint"
  | "Bounce";

export interface ClassifiedReply {
  category: ReplyCategory;
  sentiment: ReplySentiment;
  summary: string;
  confidence: number;
}

/**
 * Map the 9-way category down to the legacy 5-way ReplySentiment column so
 * everything that already reads `replies.sentiment` keeps working.
 */
function categoryToSentiment(cat: ReplyCategory): ReplySentiment {
  switch (cat) {
    case "Interested":            return ReplySentiment.INTERESTED;
    case "Meeting Requested":     return ReplySentiment.MEETING;
    case "Need More Information": return ReplySentiment.PRICING;    // information/pricing is closest existing enum
    case "Price Objection":       return ReplySentiment.PRICING;
    case "Not Interested":        return ReplySentiment.NOT_INTERESTED;
    case "Out of Office":         return ReplySentiment.NOT_INTERESTED;
    case "Auto Reply":            return ReplySentiment.NOT_INTERESTED;
    case "Spam Complaint":        return ReplySentiment.SPAM;
    case "Bounce":                return ReplySentiment.SPAM;
    default:                      return ReplySentiment.NOT_INTERESTED;
  }
}

const CATEGORIES: ReplyCategory[] = [
  "Interested",
  "Meeting Requested",
  "Need More Information",
  "Price Objection",
  "Not Interested",
  "Out of Office",
  "Auto Reply",
  "Spam Complaint",
  "Bounce",
];

function parseJsonSafe<T>(raw: string): T | null {
  try {
    return JSON.parse(raw.trim().replace(/^```json/i, "").replace(/```$/, "").trim()) as T;
  } catch {
    return null;
  }
}

export const replyClassifierService = {
  async classify(replyText: string, subject?: string): Promise<ClassifiedReply> {
    const provider = getAIProvider();
    if (!provider.isConfigured()) {
      throw new AIProviderNotConfiguredError(provider.name, `${provider.name.toUpperCase()}_API_KEY`);
    }

    // Truncate — replies past 4kb are almost always signatures + quoted history.
    const trimmed = replyText.slice(0, 4_000);

    const prompt = `
Classify this incoming cold-outreach reply.

${subject ? `Subject: ${subject}\n` : ""}Reply:
"""${trimmed}"""

Choose EXACTLY one category from this list (verbatim):
${CATEGORIES.map((c) => `- ${c}`).join("\n")}

Rules:
- "Out of Office" if the reply is an auto-response with an OOO indicator.
- "Auto Reply" if it is a machine-generated acknowledgement not from a human.
- "Bounce" if it is a mail server bounce (Undelivered, Delivery Status Notification, MAILER-DAEMON).
- "Spam Complaint" only when the sender explicitly complains about receiving unsolicited email.
- Prefer "Meeting Requested" over "Interested" when the reply proposes a time.
- If they mention pricing objection or too expensive, use "Price Objection".
- If they ask questions to learn more, use "Need More Information".
- "Not Interested" when politely or firmly declining.

Also produce:
- summary: one sentence, ≤30 words.
- confidence: 0.0–1.0, how sure you are.

Return ONLY raw JSON:
{ "category": "...", "summary": "...", "confidence": number }
`;

    const result = await provider.generate({
      prompt,
      responseFormat: "json",
      metadata: { operation: "classifyReply", subjectPreview: subject?.slice(0, 60) },
    });
    const parsed = parseJsonSafe<{ category: string; summary: string; confidence: number }>(result.text || "");
    if (!parsed) {
      log.warn({ preview: (result.text || "").slice(0, 200) }, "reply classifier returned unparseable JSON");
      return {
        category: "Need More Information",
        sentiment: ReplySentiment.NOT_INTERESTED,
        summary: "Could not classify — parser failure.",
        confidence: 0,
      };
    }
    const category = CATEGORIES.includes(parsed.category as ReplyCategory)
      ? (parsed.category as ReplyCategory)
      : "Need More Information";
    return {
      category,
      sentiment: categoryToSentiment(category),
      summary: typeof parsed.summary === "string" ? parsed.summary.slice(0, 400) : "",
      confidence: Number.isFinite(parsed.confidence) ? Math.max(0, Math.min(1, parsed.confidence)) : 0.6,
    };
  },
};
