/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Multi-step campaign sequences. Unlimited steps per campaign.
 * Step 0 is the initial email; step N is the Nth follow-up.
 *
 * A/B variants live on the same (campaign_id, step_index) row set,
 * discriminated by ab_group ('A' | 'B' | ...). Prospects stick to the
 * variant they were assigned at enrollment.
 */

import crypto from "crypto";
import { pool } from "../pool";

export type SequenceStepMode = "ai" | "manual";

export interface SequenceStep {
  id: string;
  workspaceId: string;
  campaignId: string;
  stepIndex: number;
  abGroup: string;
  delayHours: number;
  mode: SequenceStepMode;
  subject?: string;
  bodyText?: string;
  bodyHtml?: string;
  aiInstruction?: string;
  senderPoolId?: string;
  accountId?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

const iso = (v: unknown): string =>
  v instanceof Date ? v.toISOString() : v == null ? "" : String(v);

function mapRow(r: any): SequenceStep {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    campaignId: r.campaign_id,
    stepIndex: r.step_index,
    abGroup: r.ab_group || "A",
    delayHours: r.delay_hours,
    mode: (r.mode || "ai") as SequenceStepMode,
    subject: r.subject || undefined,
    bodyText: r.body_text || undefined,
    bodyHtml: r.body_html || undefined,
    aiInstruction: r.ai_instruction || undefined,
    senderPoolId: r.sender_pool_id || undefined,
    accountId: r.account_id || undefined,
    isActive: r.is_active,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

export interface CreateSequenceStepInput {
  workspaceId: string;
  campaignId: string;
  stepIndex: number;
  abGroup?: string;
  delayHours?: number;
  mode?: SequenceStepMode;
  subject?: string;
  bodyText?: string;
  bodyHtml?: string;
  aiInstruction?: string;
  senderPoolId?: string;
  accountId?: string;
  isActive?: boolean;
}

export type SequenceStepPatch = Partial<Omit<CreateSequenceStepInput, "workspaceId" | "campaignId" | "stepIndex">>;

export const sequenceStepRepository = {
  async listByCampaign(campaignId: string, workspaceId?: string): Promise<SequenceStep[]> {
    const params: unknown[] = [campaignId];
    let where = "campaign_id = $1";
    if (workspaceId) { params.push(workspaceId); where += " AND workspace_id = $2"; }
    const r = await pool.query(
      `SELECT * FROM sequence_steps WHERE ${where} ORDER BY step_index ASC, ab_group ASC`,
      params
    );
    return r.rows.map(mapRow);
  },

  async findById(id: string, workspaceId?: string): Promise<SequenceStep | null> {
    const params: unknown[] = [id];
    let where = "id = $1";
    if (workspaceId) { params.push(workspaceId); where += " AND workspace_id = $2"; }
    const r = await pool.query(`SELECT * FROM sequence_steps WHERE ${where}`, params);
    return r.rows[0] ? mapRow(r.rows[0]) : null;
  },

  async findAt(campaignId: string, stepIndex: number, abGroup: string = "A"): Promise<SequenceStep | null> {
    const r = await pool.query(
      "SELECT * FROM sequence_steps WHERE campaign_id = $1 AND step_index = $2 AND ab_group = $3 AND is_active = TRUE",
      [campaignId, stepIndex, abGroup]
    );
    return r.rows[0] ? mapRow(r.rows[0]) : null;
  },

  async create(input: CreateSequenceStepInput): Promise<SequenceStep> {
    const id = `seq-${Date.now()}-${crypto.randomUUID().split("-")[0]}`;
    const r = await pool.query(
      `INSERT INTO sequence_steps (
         id, workspace_id, campaign_id, step_index, ab_group, delay_hours,
         mode, subject, body_text, body_html, ai_instruction,
         sender_pool_id, account_id, is_active
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (campaign_id, step_index, ab_group) DO UPDATE SET
         delay_hours = EXCLUDED.delay_hours,
         mode = EXCLUDED.mode,
         subject = EXCLUDED.subject,
         body_text = EXCLUDED.body_text,
         body_html = EXCLUDED.body_html,
         ai_instruction = EXCLUDED.ai_instruction,
         sender_pool_id = EXCLUDED.sender_pool_id,
         account_id = EXCLUDED.account_id,
         is_active = EXCLUDED.is_active,
         updated_at = NOW()
       RETURNING *`,
      [
        id,
        input.workspaceId,
        input.campaignId,
        input.stepIndex,
        input.abGroup || "A",
        input.delayHours ?? 0,
        input.mode || "ai",
        input.subject || null,
        input.bodyText || null,
        input.bodyHtml || null,
        input.aiInstruction || null,
        input.senderPoolId || null,
        input.accountId || null,
        input.isActive ?? true,
      ]
    );
    return mapRow(r.rows[0]);
  },

  async update(id: string, patch: SequenceStepPatch, workspaceId?: string): Promise<SequenceStep | null> {
    const columnMap: Record<string, string> = {
      abGroup: "ab_group",
      delayHours: "delay_hours",
      mode: "mode",
      subject: "subject",
      bodyText: "body_text",
      bodyHtml: "body_html",
      aiInstruction: "ai_instruction",
      senderPoolId: "sender_pool_id",
      accountId: "account_id",
      isActive: "is_active",
    };
    const sets: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    for (const [k, v] of Object.entries(patch)) {
      const col = columnMap[k];
      if (!col || v === undefined) continue;
      sets.push(`${col} = $${i++}`);
      values.push(v);
    }
    if (sets.length === 0) return this.findById(id, workspaceId);
    sets.push("updated_at = NOW()");
    values.push(id);
    const scope = workspaceId ? ` AND workspace_id = $${i + 1}` : "";
    if (workspaceId) values.push(workspaceId);
    const r = await pool.query(
      `UPDATE sequence_steps SET ${sets.join(", ")} WHERE id = $${i}${scope} RETURNING *`,
      values
    );
    return r.rows[0] ? mapRow(r.rows[0]) : null;
  },

  async delete(id: string, workspaceId?: string): Promise<boolean> {
    const params: unknown[] = [id];
    let where = "id = $1";
    if (workspaceId) { params.push(workspaceId); where += " AND workspace_id = $2"; }
    const r = await pool.query(`DELETE FROM sequence_steps WHERE ${where}`, params);
    return (r.rowCount ?? 0) > 0;
  },

  async countActive(campaignId: string): Promise<number> {
    const r = await pool.query(
      "SELECT COUNT(DISTINCT step_index)::int AS n FROM sequence_steps WHERE campaign_id = $1 AND is_active = TRUE",
      [campaignId]
    );
    return r.rows[0]?.n ?? 0;
  },

  async replaceAll(
    campaignId: string,
    workspaceId: string,
    steps: Omit<CreateSequenceStepInput, "workspaceId" | "campaignId">[]
  ): Promise<SequenceStep[]> {
    await pool.query("DELETE FROM sequence_steps WHERE campaign_id = $1 AND workspace_id = $2", [
      campaignId,
      workspaceId,
    ]);
    const out: SequenceStep[] = [];
    for (const s of steps) {
      const created = await this.create({ ...s, workspaceId, campaignId });
      out.push(created);
    }
    return out;
  },
};
