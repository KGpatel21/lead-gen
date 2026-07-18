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
  // Phase 5: automation engine columns.
  maxPerHour: "max_per_hour",
  maxPerDay: "max_per_day",
  minGapSeconds: "min_gap_seconds",
  maxGapSeconds: "max_gap_seconds",
  respectProspectTz: "respect_prospect_tz",
  defaultTone: "default_tone",
  goal: "goal",
  maxRetries: "max_retries",
  senderPoolId: "sender_pool_id",
  archivedAt: "archived_at",
};

export interface CreateCampaignInput {
  workspaceId: string;
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
  async list(workspaceId?: string): Promise<Campaign[]> {
    if (workspaceId) {
      const r = await pool.query(
        "SELECT * FROM campaigns WHERE workspace_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC",
        [workspaceId]
      );
      return r.rows.map(mapCampaign);
    }
    const r = await pool.query(
      "SELECT * FROM campaigns WHERE deleted_at IS NULL ORDER BY created_at DESC"
    );
    return r.rows.map(mapCampaign);
  },

  async findById(id: string, workspaceId?: string): Promise<Campaign | null> {
    if (workspaceId) {
      const r = await pool.query(
        "SELECT * FROM campaigns WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL",
        [id, workspaceId]
      );
      return r.rows[0] ? mapCampaign(r.rows[0]) : null;
    }
    const r = await pool.query(
      "SELECT * FROM campaigns WHERE id = $1 AND deleted_at IS NULL",
      [id]
    );
    return r.rows[0] ? mapCampaign(r.rows[0]) : null;
  },

  async findByNameActive(name: string, workspaceId?: string): Promise<Campaign | null> {
    if (workspaceId) {
      const r = await pool.query(
        "SELECT * FROM campaigns WHERE LOWER(name) = LOWER($1) AND workspace_id = $2 AND deleted_at IS NULL",
        [name, workspaceId]
      );
      return r.rows[0] ? mapCampaign(r.rows[0]) : null;
    }
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
    if (!input.workspaceId) throw new Error("campaignRepository.create requires workspaceId");
    const id = `camp-${Date.now()}-${crypto.randomUUID().split("-")[0]}`;
    const r = await pool.query(
      `INSERT INTO campaigns
         (id, workspace_id, name, status, schedule_days, schedule_time_start, schedule_time_end, timezone, subject_template, body_template)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10)
       RETURNING *`,
      [
        id,
        input.workspaceId,
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

  async archive(id: string): Promise<void> {
    await pool.query(
      "UPDATE campaigns SET archived_at = COALESCE(archived_at, NOW()), updated_at = NOW() WHERE id = $1",
      [id]
    );
  },

  async unarchive(id: string): Promise<void> {
    await pool.query(
      "UPDATE campaigns SET archived_at = NULL, updated_at = NOW() WHERE id = $1",
      [id]
    );
  },

  /**
   * Duplicate a campaign into a new draft. Copies all campaign columns
   * plus every sequence step. Returns the new row.
   * The caller is responsible for enrolling leads separately.
   */
  async clone(sourceId: string, workspaceId: string, newName: string): Promise<Campaign | null> {
    const src = await this.findById(sourceId, workspaceId);
    if (!src) return null;
    const cloneName = newName?.trim() || `${src.name} (Copy)`;
    const created = await this.create({
      workspaceId,
      name: cloneName,
      subjectTemplate: src.subjectTemplate,
      bodyTemplate: src.bodyTemplate,
      scheduleDays: src.scheduleDays,
      scheduleTimeStart: src.scheduleTimeStart,
      scheduleTimeEnd: src.scheduleTimeEnd,
      timezone: src.timezone,
      status: CampaignStatus.DRAFT,
    });
    // Copy the automation columns that createCampaign doesn't take.
    const carry = await pool.query(
      `SELECT max_per_hour, max_per_day, min_gap_seconds, max_gap_seconds,
              respect_prospect_tz, default_tone, goal, max_retries, sender_pool_id
         FROM campaigns WHERE id = $1`,
      [sourceId]
    );
    if (carry.rows[0]) {
      const c = carry.rows[0];
      await pool.query(
        `UPDATE campaigns
           SET max_per_hour = $1, max_per_day = $2, min_gap_seconds = $3,
               max_gap_seconds = $4, respect_prospect_tz = $5, default_tone = $6,
               goal = $7, max_retries = $8, sender_pool_id = $9,
               updated_at = NOW()
         WHERE id = $10`,
        [
          c.max_per_hour, c.max_per_day, c.min_gap_seconds, c.max_gap_seconds,
          c.respect_prospect_tz, c.default_tone, c.goal, c.max_retries, c.sender_pool_id,
          created.id,
        ]
      );
    }
    return this.findById(created.id, workspaceId);
  },
};
