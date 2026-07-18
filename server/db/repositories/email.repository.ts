/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from "crypto";
import { pool } from "../pool";

export type EmailStatus =
  | "PENDING"
  | "GENERATING"
  | "READY"
  | "SENDING"
  | "SENT"
  | "FAILED"
  | "RETRY"
  | "BOUNCED"
  | "COMPLAINED"
  | "PAUSED"
  | "CANCELLED";

export interface Email {
  id: string;
  campaignId?: string;
  businessId?: string;
  leadId?: string;
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
  status: EmailStatus;
  provider?: string;
  messageId?: string;
  errorMessage?: string;
  attempts: number;
  scheduledAt?: string;
  sentAt?: string;
  createdAt: string;
  updatedAt: string;
  // Phase 3
  senderIdentityId?: string;
  followUpOf?: string;
  followUpStep: number;
  openedAt?: string;
  clickedAt?: string;
  deliveredAt?: string;
  bouncedAt?: string;
  complainedAt?: string;
  replyReceivedAt?: string;
  unsubscribeToken?: string;
}

export interface CreateEmailInput {
  campaignId?: string;
  businessId?: string;
  leadId?: string;
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
  status?: EmailStatus;
  scheduledAt?: Date;
}

const iso = (v: unknown): string =>
  v instanceof Date ? v.toISOString() : v == null ? "" : String(v);

function mapEmail(r: any): Email {
  return {
    id: r.id,
    campaignId: r.campaign_id || undefined,
    businessId: r.business_id || undefined,
    leadId: r.lead_id || undefined,
    toEmail: r.to_email,
    fromEmail: r.from_email || undefined,
    subject: r.subject,
    bodyText: r.body_text,
    bodyHtml: r.body_html || undefined,
    openingLine: r.opening_line || undefined,
    painPoints: r.pain_points || undefined,
    benefits: r.benefits || undefined,
    cta: r.cta || undefined,
    confidenceScore: r.confidence_score == null ? undefined : Number(r.confidence_score),
    emailTone: r.email_tone || undefined,
    status: r.status as EmailStatus,
    provider: r.provider || undefined,
    messageId: r.message_id || undefined,
    errorMessage: r.error_message || undefined,
    attempts: r.attempts || 0,
    scheduledAt: r.scheduled_at ? iso(r.scheduled_at) : undefined,
    sentAt: r.sent_at ? iso(r.sent_at) : undefined,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
    senderIdentityId: r.sender_identity_id || undefined,
    followUpOf: r.follow_up_of || undefined,
    followUpStep: r.follow_up_step ?? 0,
    openedAt: r.opened_at ? iso(r.opened_at) : undefined,
    clickedAt: r.clicked_at ? iso(r.clicked_at) : undefined,
    deliveredAt: r.delivered_at ? iso(r.delivered_at) : undefined,
    bouncedAt: r.bounced_at ? iso(r.bounced_at) : undefined,
    complainedAt: r.complained_at ? iso(r.complained_at) : undefined,
    replyReceivedAt: r.reply_received_at ? iso(r.reply_received_at) : undefined,
    unsubscribeToken: r.unsubscribe_token || undefined,
  };
}

export const emailRepository = {
  async findById(id: string): Promise<Email | null> {
    const r = await pool.query("SELECT * FROM emails WHERE id = $1", [id]);
    return r.rows[0] ? mapEmail(r.rows[0]) : null;
  },

  async listByCampaign(campaignId: string): Promise<Email[]> {
    const r = await pool.query(
      "SELECT * FROM emails WHERE campaign_id = $1 ORDER BY created_at DESC",
      [campaignId]
    );
    return r.rows.map(mapEmail);
  },

  async create(input: CreateEmailInput): Promise<Email> {
    const id = `em-${Date.now()}-${crypto.randomUUID().split("-")[0]}`;
    const r = await pool.query(
      `INSERT INTO emails (
         id, campaign_id, business_id, lead_id, to_email, from_email,
         subject, body_text, body_html, opening_line, pain_points, benefits, cta,
         confidence_score, email_tone, status, scheduled_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13,$14,$15,$16,$17)
       RETURNING *`,
      [
        id,
        input.campaignId || null,
        input.businessId || null,
        input.leadId || null,
        input.toEmail,
        input.fromEmail || null,
        input.subject,
        input.bodyText,
        input.bodyHtml || null,
        input.openingLine || null,
        input.painPoints ? JSON.stringify(input.painPoints) : null,
        input.benefits ? JSON.stringify(input.benefits) : null,
        input.cta || null,
        input.confidenceScore ?? null,
        input.emailTone || null,
        input.status || "READY",
        input.scheduledAt ? input.scheduledAt.toISOString() : null,
      ]
    );
    return mapEmail(r.rows[0]);
  },

  async setStatus(id: string, status: EmailStatus, extra?: { provider?: string; messageId?: string; errorMessage?: string; sentAt?: Date }): Promise<Email | null> {
    const sets: string[] = ["status = $1", "updated_at = NOW()"];
    const values: unknown[] = [status];
    let i = 2;
    if (extra?.provider !== undefined) { sets.push(`provider = $${i++}`); values.push(extra.provider); }
    if (extra?.messageId !== undefined) { sets.push(`message_id = $${i++}`); values.push(extra.messageId); }
    if (extra?.errorMessage !== undefined) { sets.push(`error_message = $${i++}`); values.push(extra.errorMessage); }
    if (extra?.sentAt !== undefined) { sets.push(`sent_at = $${i++}`); values.push(extra.sentAt.toISOString()); }
    if (status === "SENDING" || status === "SENT" || status === "FAILED") {
      sets.push(`attempts = attempts + 1`);
    }
    values.push(id);
    const r = await pool.query(
      `UPDATE emails SET ${sets.join(", ")} WHERE id = $${i} RETURNING *`,
      values
    );
    return r.rows[0] ? mapEmail(r.rows[0]) : null;
  },

  async listReadyForCampaign(campaignId: string): Promise<Email[]> {
    const r = await pool.query(
      "SELECT * FROM emails WHERE campaign_id = $1 AND status IN ('READY','RETRY') ORDER BY created_at ASC",
      [campaignId]
    );
    return r.rows.map(mapEmail);
  },

  async statsByCampaign(campaignId: string): Promise<Record<EmailStatus | "total", number>> {
    const r = await pool.query(
      "SELECT status, COUNT(*)::int AS n FROM emails WHERE campaign_id = $1 GROUP BY status",
      [campaignId]
    );
    const out: Record<string, number> = { total: 0 };
    for (const row of r.rows) {
      out[row.status] = row.n;
      out.total += row.n;
    }
    return out as Record<EmailStatus | "total", number>;
  },

  async pauseAllForCampaign(campaignId: string): Promise<number> {
    const r = await pool.query(
      "UPDATE emails SET status = 'PAUSED', updated_at = NOW() WHERE campaign_id = $1 AND status IN ('READY','RETRY')",
      [campaignId]
    );
    return r.rowCount ?? 0;
  },

  async resumeAllForCampaign(campaignId: string): Promise<number> {
    const r = await pool.query(
      "UPDATE emails SET status = 'READY', updated_at = NOW() WHERE campaign_id = $1 AND status = 'PAUSED'",
      [campaignId]
    );
    return r.rowCount ?? 0;
  },

  async cancelAllForCampaign(campaignId: string): Promise<number> {
    const r = await pool.query(
      "UPDATE emails SET status = 'CANCELLED', updated_at = NOW() WHERE campaign_id = $1 AND status IN ('READY','RETRY','PAUSED')",
      [campaignId]
    );
    return r.rowCount ?? 0;
  },

  // ---------- Phase 3 helpers ----------

  async linkSender(emailId: string, senderIdentityId: string): Promise<void> {
    await pool.query(
      "UPDATE emails SET sender_identity_id = $1, updated_at = NOW() WHERE id = $2",
      [senderIdentityId, emailId]
    );
  },

  async linkFollowUp(emailId: string, initialEmailId: string, step: number): Promise<void> {
    await pool.query(
      "UPDATE emails SET follow_up_of = $1, follow_up_step = $2, updated_at = NOW() WHERE id = $3",
      [initialEmailId, step, emailId]
    );
  },

  async findByMessageId(messageId: string): Promise<Email | null> {
    const r = await pool.query("SELECT * FROM emails WHERE message_id = $1 LIMIT 1", [messageId]);
    return r.rows[0] ? mapEmail(r.rows[0]) : null;
  },

  async findLatestSentToRecipient(recipient: string, campaignId?: string): Promise<Email | null> {
    if (campaignId) {
      const r = await pool.query(
        `SELECT * FROM emails
         WHERE LOWER(to_email) = LOWER($1) AND campaign_id = $2 AND status IN ('SENT','BOUNCED','COMPLAINED')
         ORDER BY sent_at DESC NULLS LAST LIMIT 1`,
        [recipient, campaignId]
      );
      return r.rows[0] ? mapEmail(r.rows[0]) : null;
    }
    const r = await pool.query(
      `SELECT * FROM emails
       WHERE LOWER(to_email) = LOWER($1) AND status IN ('SENT','BOUNCED','COMPLAINED')
       ORDER BY sent_at DESC NULLS LAST LIMIT 1`,
      [recipient]
    );
    return r.rows[0] ? mapEmail(r.rows[0]) : null;
  },

  async recordOpen(emailId: string): Promise<void> {
    await pool.query(
      "UPDATE emails SET opened_at = COALESCE(opened_at, NOW()), updated_at = NOW() WHERE id = $1",
      [emailId]
    );
  },

  async recordClick(emailId: string): Promise<void> {
    await pool.query(
      `UPDATE emails
         SET clicked_at = COALESCE(clicked_at, NOW()),
             opened_at  = COALESCE(opened_at, NOW()),
             updated_at = NOW()
       WHERE id = $1`,
      [emailId]
    );
  },

  async recordDelivered(emailId: string): Promise<void> {
    await pool.query(
      "UPDATE emails SET delivered_at = COALESCE(delivered_at, NOW()), updated_at = NOW() WHERE id = $1",
      [emailId]
    );
  },

  async recordBounced(emailId: string, permanent: boolean): Promise<void> {
    await pool.query(
      `UPDATE emails
         SET bounced_at = NOW(),
             status = CASE WHEN $2 THEN 'BOUNCED' ELSE status END,
             updated_at = NOW()
       WHERE id = $1`,
      [emailId, permanent]
    );
  },

  async recordComplained(emailId: string): Promise<void> {
    await pool.query(
      `UPDATE emails
         SET complained_at = NOW(),
             status = 'COMPLAINED',
             updated_at = NOW()
       WHERE id = $1`,
      [emailId]
    );
  },

  async recordReplyReceived(emailId: string): Promise<void> {
    await pool.query(
      "UPDATE emails SET reply_received_at = COALESCE(reply_received_at, NOW()), updated_at = NOW() WHERE id = $1",
      [emailId]
    );
  },

  async markUnsubscribeToken(emailId: string, token: string): Promise<void> {
    await pool.query(
      "UPDATE emails SET unsubscribe_token = $1, updated_at = NOW() WHERE id = $2",
      [token, emailId]
    );
  },

  async listPastRecipientForFollowUp(
    campaignId: string,
    recipient: string
  ): Promise<{ hasReply: boolean; latestStep: number }> {
    const r = await pool.query(
      `SELECT reply_received_at, follow_up_step FROM emails
       WHERE LOWER(to_email) = LOWER($1) AND campaign_id = $2
       ORDER BY created_at DESC LIMIT 1`,
      [recipient, campaignId]
    );
    if (!r.rows[0]) return { hasReply: false, latestStep: 0 };
    return {
      hasReply: !!r.rows[0].reply_received_at,
      latestStep: r.rows[0].follow_up_step || 0,
    };
  },
};

export const emailEventRepository = {
  async log(input: { emailId: string; eventType: string; rawPayload?: any }): Promise<void> {
    const id = `ee-${Date.now()}-${crypto.randomUUID().split("-")[0]}`;
    await pool.query(
      `INSERT INTO email_events (id, email_id, event_type, raw_payload)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [id, input.emailId, input.eventType, JSON.stringify(input.rawPayload ?? null)]
    );
  },
};
