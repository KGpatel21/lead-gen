/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from "crypto";
import { pool } from "../pool";
import { mapCampaign } from "../rowMappers";
import { Campaign, CampaignStatus } from "../../../src/types";

const ALLOWED_UPDATE_FIELDS: Record<string, string> = {
  name: "name",
  status: "status",
  scheduleDays: "schedule_days",
  scheduleTimeStart: "schedule_time_start",
  scheduleTimeEnd: "schedule_time_end",
  timezone: "timezone",
  subjectTemplate: "subject_template",
  bodyTemplate: "body_template",
};

export interface CreateCampaignInput {
  name: string;
  subjectTemplate?: string;
  bodyTemplate?: string;
  scheduleDays?: string[];
  scheduleTimeStart?: string;
  scheduleTimeEnd?: string;
  timezone?: string;
  status?: CampaignStatus;
}

export const campaignRepository = {
  async list(): Promise<Campaign[]> {
    const r = await pool.query(
      "SELECT * FROM campaigns WHERE deleted_at IS NULL ORDER BY created_at DESC"
    );
    return r.rows.map(mapCampaign);
  },

  async findById(id: string): Promise<Campaign | null> {
    const r = await pool.query(
      "SELECT * FROM campaigns WHERE id = $1 AND deleted_at IS NULL",
      [id]
    );
    return r.rows[0] ? mapCampaign(r.rows[0]) : null;
  },

  async findByNameActive(name: string): Promise<Campaign | null> {
    const r = await pool.query(
      "SELECT * FROM campaigns WHERE LOWER(name) = LOWER($1) AND deleted_at IS NULL",
      [name]
    );
    return r.rows[0] ? mapCampaign(r.rows[0]) : null;
  },

  async listRunning(): Promise<Campaign[]> {
    const r = await pool.query(
      "SELECT * FROM campaigns WHERE status = $1 AND deleted_at IS NULL",
      [CampaignStatus.RUNNING]
    );
    return r.rows.map(mapCampaign);
  },

  async create(input: CreateCampaignInput): Promise<Campaign> {
    const id = `camp-${Date.now()}-${crypto.randomUUID().split("-")[0]}`;
    const r = await pool.query(
      `INSERT INTO campaigns
         (id, name, status, schedule_days, schedule_time_start, schedule_time_end, timezone, subject_template, body_template)
       VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9)
       RETURNING *`,
      [
        id,
        input.name,
        input.status || CampaignStatus.DRAFT,
        JSON.stringify(input.scheduleDays || ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]),
        input.scheduleTimeStart || "09:00",
        input.scheduleTimeEnd || "17:00",
        input.timezone || "America/New_York",
        input.subjectTemplate || "",
        input.bodyTemplate || "",
      ]
    );
    return mapCampaign(r.rows[0]);
  },

  async update(id: string, patch: Partial<Record<keyof typeof ALLOWED_UPDATE_FIELDS, unknown>>): Promise<Campaign | null> {
    const sets: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    for (const [k, v] of Object.entries(patch)) {
      const col = ALLOWED_UPDATE_FIELDS[k];
      if (!col || v === undefined) continue;
      if (k === "scheduleDays") {
        sets.push(`${col} = $${i}::jsonb`);
        values.push(JSON.stringify(v));
      } else {
        sets.push(`${col} = $${i}`);
        values.push(v);
      }
      i++;
    }
    if (sets.length === 0) return this.findById(id);
    sets.push(`updated_at = NOW()`);
    values.push(id);
    const r = await pool.query(
      `UPDATE campaigns SET ${sets.join(", ")} WHERE id = $${i} AND deleted_at IS NULL RETURNING *`,
      values
    );
    return r.rows[0] ? mapCampaign(r.rows[0]) : null;
  },

  async incrementCounters(
    id: string,
    delta: Partial<Pick<Campaign, "sentCount" | "openCount" | "replyCount" | "bounceCount" | "unsubCount">>
  ): Promise<void> {
    const parts: string[] = [];
    if (delta.sentCount)   parts.push(`sent_count   = sent_count   + ${Number(delta.sentCount)}`);
    if (delta.openCount)   parts.push(`open_count   = open_count   + ${Number(delta.openCount)}`);
    if (delta.replyCount)  parts.push(`reply_count  = reply_count  + ${Number(delta.replyCount)}`);
    if (delta.bounceCount) parts.push(`bounce_count = bounce_count + ${Number(delta.bounceCount)}`);
    if (delta.unsubCount)  parts.push(`unsub_count  = unsub_count  + ${Number(delta.unsubCount)}`);
    if (parts.length === 0) return;
    await pool.query(
      `UPDATE campaigns SET ${parts.join(", ")}, updated_at = NOW() WHERE id = $1`,
      [id]
    );
  },

  async setStatus(id: string, status: CampaignStatus): Promise<void> {
    await pool.query(
      "UPDATE campaigns SET status = $1, updated_at = NOW() WHERE id = $2",
      [status, id]
    );
  },

  async softDelete(id: string): Promise<void> {
    await pool.query("UPDATE campaigns SET deleted_at = NOW() WHERE id = $1", [id]);
  },
};
