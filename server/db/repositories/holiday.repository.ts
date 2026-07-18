/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Business-holiday calendar. Scheduler skips sends on any date that appears
 * either as a campaign-scoped holiday or a workspace-scoped ("global")
 * holiday.
 */

import crypto from "crypto";
import { pool } from "../pool";

export type HolidayScope = "global" | "campaign";

export interface Holiday {
  id: string;
  workspaceId: string;
  campaignId?: string;
  scope: HolidayScope;
  date: string;
  name?: string;
  createdAt: string;
}

const iso = (v: unknown): string =>
  v instanceof Date ? v.toISOString() : v == null ? "" : String(v);

function mapRow(r: any): Holiday {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    campaignId: r.campaign_id || undefined,
    scope: (r.scope || "campaign") as HolidayScope,
    date: r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date).slice(0, 10),
    name: r.name || undefined,
    createdAt: iso(r.created_at),
  };
}

export const holidayRepository = {
  async list(workspaceId: string, campaignId?: string): Promise<Holiday[]> {
    if (campaignId) {
      const r = await pool.query(
        `SELECT * FROM campaign_holidays
         WHERE workspace_id = $1 AND (scope = 'global' OR campaign_id = $2)
         ORDER BY date ASC`,
        [workspaceId, campaignId]
      );
      return r.rows.map(mapRow);
    }
    const r = await pool.query(
      `SELECT * FROM campaign_holidays WHERE workspace_id = $1 ORDER BY date ASC`,
      [workspaceId]
    );
    return r.rows.map(mapRow);
  },

  async add(input: {
    workspaceId: string;
    scope: HolidayScope;
    date: string; // yyyy-mm-dd
    campaignId?: string;
    name?: string;
  }): Promise<Holiday> {
    const id = `hol-${Date.now()}-${crypto.randomUUID().split("-")[0]}`;
    const r = await pool.query(
      `INSERT INTO campaign_holidays (id, workspace_id, campaign_id, scope, date, name)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT DO NOTHING
       RETURNING *`,
      [
        id,
        input.workspaceId,
        input.campaignId || null,
        input.scope,
        input.date,
        input.name || null,
      ]
    );
    if (r.rows[0]) return mapRow(r.rows[0]);
    const existing = await pool.query(
      input.scope === "global"
        ? "SELECT * FROM campaign_holidays WHERE workspace_id = $1 AND scope = 'global' AND date = $2"
        : "SELECT * FROM campaign_holidays WHERE campaign_id = $1 AND date = $2",
      input.scope === "global" ? [input.workspaceId, input.date] : [input.campaignId, input.date]
    );
    return mapRow(existing.rows[0]);
  },

  async remove(id: string, workspaceId: string): Promise<boolean> {
    const r = await pool.query(
      "DELETE FROM campaign_holidays WHERE id = $1 AND workspace_id = $2",
      [id, workspaceId]
    );
    return (r.rowCount ?? 0) > 0;
  },

  async isHoliday(workspaceId: string, campaignId: string | undefined, date: string): Promise<boolean> {
    const r = await pool.query(
      `SELECT 1 FROM campaign_holidays
       WHERE workspace_id = $1
         AND date = $2
         AND (scope = 'global' OR campaign_id = $3)
       LIMIT 1`,
      [workspaceId, date, campaignId || null]
    );
    return (r.rowCount ?? 0) > 0;
  },
};
