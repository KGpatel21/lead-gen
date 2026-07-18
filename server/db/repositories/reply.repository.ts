/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from "crypto";
import { pool } from "../pool";
import { mapReply } from "../rowMappers";
import { Reply, ReplySentiment } from "../../../src/types";

export interface CreateReplyInput {
  campaignId?: string;
  leadId?: string;
  fromEmail: string;
  subject: string;
  body: string;
  sentiment: ReplySentiment;
  aiSuggestedReply?: string;
}

const JOIN_FIELDS = `
  r.*,
  c.name AS campaign_name,
  l.first_name AS first_name,
  l.last_name AS last_name,
  l.company AS company
`;

export const replyRepository = {
  async list(): Promise<Reply[]> {
    const r = await pool.query(
      `SELECT ${JOIN_FIELDS} FROM replies r
       LEFT JOIN campaigns c ON c.id = r.campaign_id
       LEFT JOIN leads l     ON l.id = r.lead_id
       WHERE r.deleted_at IS NULL
       ORDER BY r.received_at DESC LIMIT 500`
    );
    return r.rows.map(mapReply);
  },

  async findById(id: string): Promise<Reply | null> {
    const r = await pool.query(
      `SELECT ${JOIN_FIELDS} FROM replies r
       LEFT JOIN campaigns c ON c.id = r.campaign_id
       LEFT JOIN leads l     ON l.id = r.lead_id
       WHERE r.id = $1 AND r.deleted_at IS NULL`,
      [id]
    );
    return r.rows[0] ? mapReply(r.rows[0]) : null;
  },

  async create(input: CreateReplyInput): Promise<Reply> {
    const id = `rep-${Date.now()}-${crypto.randomUUID().split("-")[0]}`;
    await pool.query(
      `INSERT INTO replies (id, campaign_id, lead_id, from_email, subject, body_text, sentiment, ai_suggested_reply)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        id,
        input.campaignId || null,
        input.leadId || null,
        input.fromEmail,
        input.subject,
        input.body,
        input.sentiment,
        input.aiSuggestedReply || null,
      ]
    );
    const out = await this.findById(id);
    if (!out) throw new Error("Reply create returned null");
    return out;
  },

  async markRead(id: string): Promise<void> {
    await pool.query("UPDATE replies SET is_read = TRUE WHERE id = $1", [id]);
  },

  async setSentiment(id: string, sentiment: ReplySentiment): Promise<void> {
    await pool.query("UPDATE replies SET sentiment = $1 WHERE id = $2", [sentiment, id]);
  },

  async recentSentimentCounts(): Promise<Record<string, number>> {
    const r = await pool.query(
      "SELECT sentiment, COUNT(*)::int AS n FROM replies WHERE deleted_at IS NULL GROUP BY sentiment"
    );
    const out: Record<string, number> = {};
    for (const row of r.rows) out[row.sentiment] = row.n;
    return out;
  },

  // ---------- Phase 4.5: universal reply sync ----------

  /**
   * Idempotent upsert of an incoming reply. Returns { row, isNew } — isNew
   * is false when the (workspace_id, provider_message_id) unique index caught
   * a repeat.
   */
  async upsertFromProvider(input: {
    workspaceId: string;
    accountId: string;
    campaignId?: string;
    leadId?: string;
    providerMessageId: string;
    internetMessageId?: string;
    inReplyTo?: string;
    references?: string;
    threadId?: string;
    folder?: string;
    providerKind: string;
    fromEmail: string;
    fromName?: string;
    subject: string;
    bodyText: string;
    bodyHtml?: string;
    receivedAt: Date;
    rawHeaders?: Record<string, unknown>;
  }): Promise<{ id: string; isNew: boolean }> {
    const id = `rep-${Date.now()}-${crypto.randomUUID().split("-")[0]}`;
    const r = await pool.query(
      `INSERT INTO replies
        (id, workspace_id, email_account_id, campaign_id, lead_id, from_email, subject, body_text, body_html,
         sentiment, provider_message_id, internet_message_id, in_reply_to, references_header,
         thread_id, folder, provider_kind, raw_headers, received_at, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19,$20)
       ON CONFLICT (workspace_id, provider_message_id) WHERE provider_message_id IS NOT NULL DO NOTHING
       RETURNING id`,
      [
        id,
        input.workspaceId,
        input.accountId,
        input.campaignId || null,
        input.leadId || null,
        input.fromEmail,
        input.subject,
        input.bodyText,
        input.bodyHtml || null,
        "Interested",                       // placeholder; classifier updates
        input.providerMessageId,
        input.internetMessageId || null,
        input.inReplyTo || null,
        input.references || null,
        input.threadId || null,
        input.folder || null,
        input.providerKind,
        JSON.stringify(input.rawHeaders || null),
        input.receivedAt.toISOString(),
        new Date().toISOString(),
      ]
    );
    if (r.rowCount && r.rowCount > 0) return { id: r.rows[0].id, isNew: true };
    const existing = await pool.query(
      "SELECT id FROM replies WHERE workspace_id = $1 AND provider_message_id = $2",
      [input.workspaceId, input.providerMessageId]
    );
    return { id: existing.rows[0]?.id || id, isNew: false };
  },

  async applyClassification(id: string, patch: {
    category: string;
    sentiment: string;
    summary: string;
    confidence: number;
  }): Promise<void> {
    await pool.query(
      `UPDATE replies SET category = $1, sentiment = $2,
              classification_summary = $3, sentiment_confidence = $4
       WHERE id = $5`,
      [patch.category, patch.sentiment, patch.summary, patch.confidence, id]
    );
  },

  async findLinkedEmailByInReplyTo(workspaceId: string, inReplyTo: string): Promise<{ id: string; campaignId?: string; toEmail: string } | null> {
    // Match against `emails` where the sent message's internet message id is
    // encoded in the tracking id (X-Email-Id). SES/Gmail/Outlook return
    // provider ids — we correlate via header. For now, match by subject or
    // by a heuristic search: parent's Message-ID equals in_reply_to.
    // Fallback: match by recipient's fromEmail => emails.toEmail.
    const r = await pool.query(
      `SELECT id, campaign_id, to_email FROM emails
       WHERE workspace_id = $1 AND (message_id = $2 OR id = $2)
       ORDER BY sent_at DESC NULLS LAST LIMIT 1`,
      [workspaceId, inReplyTo]
    );
    if (!r.rows[0]) return null;
    return { id: r.rows[0].id, campaignId: r.rows[0].campaign_id || undefined, toEmail: r.rows[0].to_email };
  },
};
