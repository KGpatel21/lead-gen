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
};
