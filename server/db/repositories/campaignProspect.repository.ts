/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Per-prospect campaign state — one row per (campaign, lead).
 * Drives the sequence engine: current_step, next_send_at, status, stop_reason.
 */

import crypto from "crypto";
import { pool } from "../pool";

export type ProspectStatus = "active" | "paused" | "stopped" | "completed";

export type StopReason =
  | "replied"
  | "meeting_booked"
  | "unsubscribed"
  | "bounced"
  | "complained"
  | "manual"
  | "campaign_paused"
  | "campaign_completed"
  | "closed"
  | "no_more_steps";

export interface CampaignProspect {
  id: string;
  workspaceId: string;
  campaignId: string;
  leadId: string;
  businessId?: string;
  currentStep: number;
  status: ProspectStatus;
  stopReason?: StopReason;
  abGroup: string;
  timezone?: string;
  nextSendAt?: string;
  lastSentAt?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

const iso = (v: unknown): string =>
  v instanceof Date ? v.toISOString() : v == null ? "" : String(v);

function mapRow(r: any): CampaignProspect {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    campaignId: r.campaign_id,
    leadId: r.lead_id,
    businessId: r.business_id || undefined,
    currentStep: r.current_step ?? 0,
    status: r.status as ProspectStatus,
    stopReason: (r.stop_reason || undefined) as StopReason | undefined,
    abGroup: r.ab_group || "A",
    timezone: r.timezone || undefined,
    nextSendAt: r.next_send_at ? iso(r.next_send_at) : undefined,
    lastSentAt: r.last_sent_at ? iso(r.last_sent_at) : undefined,
    lastError: r.last_error || undefined,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

export interface EnrollInput {
  workspaceId: string;
  campaignId: string;
  leadId: string;
  businessId?: string;
  abGroup?: string;
  timezone?: string;
  nextSendAt?: Date;
}

export const campaignProspectRepository = {
  async findByPair(
    campaignId: string,
    leadId: string,
    workspaceId?: string
  ): Promise<CampaignProspect | null> {
    const params: unknown[] = [campaignId, leadId];
    let where = "campaign_id = $1 AND lead_id = $2";
    if (workspaceId) { params.push(workspaceId); where += " AND workspace_id = $3"; }
    const r = await pool.query(`SELECT * FROM campaign_prospects WHERE ${where}`, params);
    return r.rows[0] ? mapRow(r.rows[0]) : null;
  },

  async findById(id: string, workspaceId?: string): Promise<CampaignProspect | null> {
    const params: unknown[] = [id];
    let where = "id = $1";
    if (workspaceId) { params.push(workspaceId); where += " AND workspace_id = $2"; }
    const r = await pool.query(`SELECT * FROM campaign_prospects WHERE ${where}`, params);
    return r.rows[0] ? mapRow(r.rows[0]) : null;
  },

  async listByCampaign(campaignId: string, workspaceId?: string): Promise<CampaignProspect[]> {
    const params: unknown[] = [campaignId];
    let where = "campaign_id = $1";
    if (workspaceId) { params.push(workspaceId); where += " AND workspace_id = $2"; }
    const r = await pool.query(
      `SELECT * FROM campaign_prospects WHERE ${where} ORDER BY created_at DESC`,
      params
    );
    return r.rows.map(mapRow);
  },

  async listDueForSend(
    limit: number = 500,
    now: Date = new Date()
  ): Promise<CampaignProspect[]> {
    const r = await pool.query(
      `SELECT * FROM campaign_prospects
       WHERE status = 'active' AND next_send_at IS NOT NULL AND next_send_at <= $1
       ORDER BY next_send_at ASC
       LIMIT $2`,
      [now.toISOString(), limit]
    );
    return r.rows.map(mapRow);
  },

  async enroll(input: EnrollInput): Promise<CampaignProspect> {
    const id = `cp-${Date.now()}-${crypto.randomUUID().split("-")[0]}`;
    const r = await pool.query(
      `INSERT INTO campaign_prospects (
         id, workspace_id, campaign_id, lead_id, business_id,
         current_step, status, ab_group, timezone, next_send_at
       ) VALUES ($1,$2,$3,$4,$5,$6,'active',$7,$8,$9)
       ON CONFLICT (campaign_id, lead_id) DO UPDATE SET
         business_id = COALESCE(EXCLUDED.business_id, campaign_prospects.business_id),
         timezone = COALESCE(EXCLUDED.timezone, campaign_prospects.timezone),
         next_send_at = COALESCE(EXCLUDED.next_send_at, campaign_prospects.next_send_at),
         updated_at = NOW()
       RETURNING *`,
      [
        id,
        input.workspaceId,
        input.campaignId,
        input.leadId,
        input.businessId || null,
        0,
        input.abGroup || "A",
        input.timezone || null,
        input.nextSendAt ? input.nextSendAt.toISOString() : null,
      ]
    );
    return mapRow(r.rows[0]);
  },

  async setStatus(
    id: string,
    status: ProspectStatus,
    reason?: StopReason,
    workspaceId?: string
  ): Promise<CampaignProspect | null> {
    const params: unknown[] = [status, reason || null, id];
    let where = "id = $3";
    if (workspaceId) { params.push(workspaceId); where += " AND workspace_id = $4"; }
    const r = await pool.query(
      `UPDATE campaign_prospects
         SET status = $1, stop_reason = COALESCE($2, stop_reason), updated_at = NOW()
       WHERE ${where}
       RETURNING *`,
      params
    );
    return r.rows[0] ? mapRow(r.rows[0]) : null;
  },

  async markSent(
    id: string,
    nextStep: number,
    nextSendAt: Date | null
  ): Promise<CampaignProspect | null> {
    const r = await pool.query(
      `UPDATE campaign_prospects
         SET current_step = $1,
             next_send_at = $2,
             last_sent_at = NOW(),
             last_error = NULL,
             status = CASE WHEN $2::timestamptz IS NULL THEN 'completed' ELSE 'active' END,
             stop_reason = CASE WHEN $2::timestamptz IS NULL THEN 'no_more_steps' ELSE stop_reason END,
             updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [nextStep, nextSendAt ? nextSendAt.toISOString() : null, id]
    );
    return r.rows[0] ? mapRow(r.rows[0]) : null;
  },

  async recordError(id: string, error: string): Promise<void> {
    await pool.query(
      "UPDATE campaign_prospects SET last_error = $1, updated_at = NOW() WHERE id = $2",
      [error.slice(0, 500), id]
    );
  },

  async stopByLeadInCampaign(
    campaignId: string,
    leadEmailLower: string,
    reason: StopReason
  ): Promise<number> {
    const r = await pool.query(
      `UPDATE campaign_prospects cp
         SET status = 'stopped', stop_reason = $1, updated_at = NOW()
        FROM leads l
       WHERE cp.campaign_id = $2
         AND cp.lead_id = l.id
         AND LOWER(l.email) = $3
         AND cp.status IN ('active','paused')`,
      [reason, campaignId, leadEmailLower]
    );
    return r.rowCount ?? 0;
  },

  async stopByEmailAcrossWorkspace(
    workspaceId: string,
    leadEmailLower: string,
    reason: StopReason
  ): Promise<number> {
    const r = await pool.query(
      `UPDATE campaign_prospects cp
         SET status = 'stopped', stop_reason = $1, updated_at = NOW()
        FROM leads l
       WHERE cp.workspace_id = $2
         AND cp.lead_id = l.id
         AND LOWER(l.email) = $3
         AND cp.status IN ('active','paused')`,
      [reason, workspaceId, leadEmailLower]
    );
    return r.rowCount ?? 0;
  },

  async pauseCampaign(campaignId: string): Promise<number> {
    const r = await pool.query(
      `UPDATE campaign_prospects
         SET status = 'paused', stop_reason = COALESCE(stop_reason, 'campaign_paused'), updated_at = NOW()
       WHERE campaign_id = $1 AND status = 'active'`,
      [campaignId]
    );
    return r.rowCount ?? 0;
  },

  async resumeCampaign(campaignId: string): Promise<number> {
    const r = await pool.query(
      `UPDATE campaign_prospects
         SET status = 'active',
             stop_reason = NULL,
             updated_at = NOW()
       WHERE campaign_id = $1 AND status = 'paused' AND stop_reason IN ('campaign_paused', NULL)`,
      [campaignId]
    );
    return r.rowCount ?? 0;
  },

  async skipLead(prospectId: string, workspaceId?: string): Promise<CampaignProspect | null> {
    // Advance one step without sending (useful for "skip this send").
    const params: unknown[] = [prospectId];
    let where = "id = $1";
    if (workspaceId) { params.push(workspaceId); where += " AND workspace_id = $2"; }
    const r = await pool.query(
      `UPDATE campaign_prospects
         SET current_step = current_step + 1, next_send_at = NULL, updated_at = NOW()
       WHERE ${where}
       RETURNING *`,
      params
    );
    return r.rows[0] ? mapRow(r.rows[0]) : null;
  },

  async setNextSend(id: string, when: Date): Promise<void> {
    await pool.query(
      "UPDATE campaign_prospects SET next_send_at = $1, updated_at = NOW() WHERE id = $2",
      [when.toISOString(), id]
    );
  },

  async statsByCampaign(campaignId: string): Promise<Record<ProspectStatus | "total", number>> {
    const r = await pool.query(
      "SELECT status, COUNT(*)::int AS n FROM campaign_prospects WHERE campaign_id = $1 GROUP BY status",
      [campaignId]
    );
    const out: Record<string, number> = { active: 0, paused: 0, stopped: 0, completed: 0, total: 0 };
    for (const row of r.rows) { out[row.status] = row.n; out.total += row.n; }
    return out as Record<ProspectStatus | "total", number>;
  },
};
