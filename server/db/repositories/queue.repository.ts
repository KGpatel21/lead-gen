/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from "crypto";
import { pool } from "../pool";
import { mapQueueItem } from "../rowMappers";
import { QueueItem, QueueItemStatus } from "../../services/db.service.types";

export interface CreateQueueInput {
  campaignId: string;
  leadId: string;
  to: string;
  subject: string;
  body: string;
  scheduledAt: Date;
  priority?: number;
}

export const queueRepository = {
  async create(input: CreateQueueInput): Promise<QueueItem> {
    const id = `q-${Date.now()}-${crypto.randomUUID().split("-")[0]}`;
    const r = await pool.query(
      `INSERT INTO queue (id, campaign_id, lead_id, to_email, subject, body, scheduled_at, status, priority)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'QUEUED',$8) RETURNING *`,
      [
        id,
        input.campaignId,
        input.leadId,
        input.to,
        input.subject,
        input.body,
        input.scheduledAt.toISOString(),
        input.priority ?? 2,
      ]
    );
    return mapQueueItem(r.rows[0]);
  },

  async listPage(filter: { campaignId?: string; status?: QueueItemStatus }, page: number, limit: number): Promise<{ items: QueueItem[]; total: number }> {
    const conds: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    if (filter.campaignId) { conds.push(`campaign_id = $${i++}`); values.push(filter.campaignId); }
    if (filter.status) { conds.push(`status = $${i++}`); values.push(filter.status); }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const totalR = await pool.query(`SELECT COUNT(*)::int AS n FROM queue ${where}`, values);
    const total = totalR.rows[0].n;
    values.push(limit, (page - 1) * limit);
    const r = await pool.query(
      `SELECT * FROM queue ${where} ORDER BY scheduled_at ASC LIMIT $${i++} OFFSET $${i}`,
      values
    );
    return { items: r.rows.map(mapQueueItem), total };
  },

  async pickEligibleForDispatch(limit: number): Promise<QueueItem[]> {
    const r = await pool.query(
      `SELECT q.* FROM queue q
       JOIN campaigns c ON c.id = q.campaign_id
       WHERE q.status IN ('QUEUED','FAILED')
         AND q.attempts < 3
         AND q.scheduled_at <= NOW()
         AND c.status = 'RUNNING'
         AND c.deleted_at IS NULL
       ORDER BY q.priority ASC, q.scheduled_at ASC
       LIMIT $1`,
      [limit]
    );
    return r.rows.map(mapQueueItem);
  },

  async findByLead(leadId: string): Promise<QueueItem | null> {
    const r = await pool.query(
      "SELECT * FROM queue WHERE lead_id = $1 AND status IN ('QUEUED','PENDING','SENT') LIMIT 1",
      [leadId]
    );
    return r.rows[0] ? mapQueueItem(r.rows[0]) : null;
  },

  async markPending(id: string, smtpAccountId?: string): Promise<void> {
    await pool.query(
      "UPDATE queue SET status = 'PENDING', last_attempt = NOW(), smtp_account_id = COALESCE($2, smtp_account_id) WHERE id = $1",
      [id, smtpAccountId || null]
    );
  },

  async markSent(id: string): Promise<void> {
    await pool.query("UPDATE queue SET status = 'SENT' WHERE id = $1", [id]);
  },

  async markFailedOrRetry(id: string, errorMessage: string, nextRetryAt: Date): Promise<void> {
    await pool.query(
      `UPDATE queue
         SET attempts = attempts + 1,
             error_message = $2,
             last_attempt = NOW(),
             scheduled_at = $3,
             status = CASE WHEN attempts + 1 >= 3 THEN 'FAILED' ELSE 'QUEUED' END
       WHERE id = $1`,
      [id, errorMessage, nextRetryAt.toISOString()]
    );
  },

  async retry(id: string): Promise<boolean> {
    const r = await pool.query(
      `UPDATE queue SET status = 'QUEUED', attempts = 0, error_message = NULL, scheduled_at = NOW() WHERE id = $1`,
      [id]
    );
    return (r.rowCount ?? 0) > 0;
  },

  async retryCampaignFailed(campaignId: string): Promise<number> {
    const r = await pool.query(
      `UPDATE queue SET status = 'QUEUED', attempts = 0, error_message = NULL, scheduled_at = NOW()
       WHERE campaign_id = $1 AND status = 'FAILED'`,
      [campaignId]
    );
    return r.rowCount ?? 0;
  },

  async remove(id: string): Promise<boolean> {
    const r = await pool.query("DELETE FROM queue WHERE id = $1", [id]);
    return (r.rowCount ?? 0) > 0;
  },

  async clearFailed(): Promise<number> {
    const r = await pool.query("DELETE FROM queue WHERE status = 'FAILED'");
    return r.rowCount ?? 0;
  },

  async stats(): Promise<{ queued: number; pending: number; sent: number; failed: number; total: number }> {
    const r = await pool.query(
      `SELECT
         SUM(CASE WHEN status = 'QUEUED'  THEN 1 ELSE 0 END)::int AS queued,
         SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END)::int AS pending,
         SUM(CASE WHEN status = 'SENT'    THEN 1 ELSE 0 END)::int AS sent,
         SUM(CASE WHEN status = 'FAILED'  THEN 1 ELSE 0 END)::int AS failed,
         COUNT(*)::int AS total
       FROM queue`
    );
    const row = r.rows[0] || {};
    return {
      queued: row.queued || 0,
      pending: row.pending || 0,
      sent: row.sent || 0,
      failed: row.failed || 0,
      total: row.total || 0,
    };
  },
};
