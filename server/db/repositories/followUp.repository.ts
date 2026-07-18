/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Per-campaign follow-up rules. Default rule set is Day 3, 7, 14 and is
 * seeded when a follow-up is enabled on a campaign.
 */

import crypto from "crypto";
import { pool } from "../pool";

export interface FollowUpRule {
  id: string;
  campaignId: string;
  step: number;
  delayDays: number;
  subjectPrefix?: string;
  bodyInstruction?: string;
  isActive: boolean;
  createdAt: string;
}

const iso = (v: unknown): string =>
  v instanceof Date ? v.toISOString() : v == null ? "" : String(v);

function mapRow(r: any): FollowUpRule {
  return {
    id: r.id,
    campaignId: r.campaign_id,
    step: r.step,
    delayDays: r.delay_days,
    subjectPrefix: r.subject_prefix || undefined,
    bodyInstruction: r.body_instruction || undefined,
    isActive: r.is_active,
    createdAt: iso(r.created_at),
  };
}

export const followUpRuleRepository = {
  async listByCampaign(campaignId: string): Promise<FollowUpRule[]> {
    const r = await pool.query(
      "SELECT * FROM follow_up_rules WHERE campaign_id = $1 AND is_active = TRUE ORDER BY step ASC",
      [campaignId]
    );
    return r.rows.map(mapRow);
  },

  async findAt(campaignId: string, step: number): Promise<FollowUpRule | null> {
    const r = await pool.query(
      "SELECT * FROM follow_up_rules WHERE campaign_id = $1 AND step = $2 AND is_active = TRUE",
      [campaignId, step]
    );
    return r.rows[0] ? mapRow(r.rows[0]) : null;
  },

  async ensureDefaults(campaignId: string): Promise<FollowUpRule[]> {
    const existing = await this.listByCampaign(campaignId);
    if (existing.length > 0) return existing;
    const defaults = [
      { step: 1, delayDays: 3, subjectPrefix: "Re: ", bodyInstruction: "Short bump. Reference the first email; add one new angle." },
      { step: 2, delayDays: 7, subjectPrefix: "Re: ", bodyInstruction: "Case-study or example-first. Keep it tight; single CTA." },
      { step: 3, delayDays: 14, subjectPrefix: "Re: ", bodyInstruction: "Polite break-up email. Ask if it's the wrong time or wrong contact." },
    ];
    for (const d of defaults) {
      const id = `fur-${Date.now()}-${crypto.randomUUID().split("-")[0]}`;
      await pool.query(
        `INSERT INTO follow_up_rules (id, campaign_id, step, delay_days, subject_prefix, body_instruction)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (campaign_id, step) DO NOTHING`,
        [id, campaignId, d.step, d.delayDays, d.subjectPrefix, d.bodyInstruction]
      );
    }
    return this.listByCampaign(campaignId);
  },

  async setRule(input: {
    campaignId: string;
    step: number;
    delayDays: number;
    subjectPrefix?: string;
    bodyInstruction?: string;
    isActive?: boolean;
  }): Promise<FollowUpRule> {
    const id = `fur-${Date.now()}-${crypto.randomUUID().split("-")[0]}`;
    const r = await pool.query(
      `INSERT INTO follow_up_rules (id, campaign_id, step, delay_days, subject_prefix, body_instruction, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,TRUE))
       ON CONFLICT (campaign_id, step) DO UPDATE SET
         delay_days = EXCLUDED.delay_days,
         subject_prefix = EXCLUDED.subject_prefix,
         body_instruction = EXCLUDED.body_instruction,
         is_active = EXCLUDED.is_active
       RETURNING *`,
      [
        id,
        input.campaignId,
        input.step,
        input.delayDays,
        input.subjectPrefix || null,
        input.bodyInstruction || null,
        input.isActive ?? true,
      ]
    );
    return mapRow(r.rows[0]);
  },
};
