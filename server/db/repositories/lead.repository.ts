/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from "crypto";
import { pool } from "../pool";
import { mapLead } from "../rowMappers";
import { Lead, LeadStatus } from "../../../src/types";

export interface CreateLeadInput {
  campaignId: string;
  email: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  personalizedLine?: string;
  phone?: string;
  platform?: string;
  profileUrl?: string;
  descriptionMeta?: string;
  proposedService?: string;
  status?: LeadStatus;
  crmStage?: string;
}

const UPDATABLE: Record<string, string> = {
  firstName: "first_name",
  lastName: "last_name",
  company: "company",
  email: "email",
  personalizedLine: "personalized_line",
  status: "status",
  crmStage: "crm_stage",
  phone: "phone",
  platform: "platform",
  profileUrl: "profile_url",
  descriptionMeta: "description_meta",
  proposedService: "proposed_service",
  errorMessage: "error_message",
};

export const leadRepository = {
  async list(): Promise<Lead[]> {
    const r = await pool.query(
      "SELECT * FROM leads WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 5000"
    );
    return r.rows.map(mapLead);
  },

  async findById(id: string): Promise<Lead | null> {
    const r = await pool.query(
      "SELECT * FROM leads WHERE id = $1 AND deleted_at IS NULL",
      [id]
    );
    return r.rows[0] ? mapLead(r.rows[0]) : null;
  },

  async findByEmailInCampaign(campaignId: string, email: string): Promise<Lead | null> {
    const r = await pool.query(
      "SELECT * FROM leads WHERE campaign_id = $1 AND LOWER(email) = LOWER($2) AND deleted_at IS NULL",
      [campaignId, email]
    );
    return r.rows[0] ? mapLead(r.rows[0]) : null;
  },

  async listByCampaign(campaignId: string): Promise<Lead[]> {
    const r = await pool.query(
      "SELECT * FROM leads WHERE campaign_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC",
      [campaignId]
    );
    return r.rows.map(mapLead);
  },

  async listPendingByCampaign(campaignId: string): Promise<Lead[]> {
    const r = await pool.query(
      "SELECT * FROM leads WHERE campaign_id = $1 AND status = $2 AND deleted_at IS NULL",
      [campaignId, LeadStatus.PENDING]
    );
    return r.rows.map(mapLead);
  },

  async create(input: CreateLeadInput): Promise<Lead> {
    const id = `lead-${Date.now()}-${crypto.randomUUID().split("-")[0]}`;
    const r = await pool.query(
      `INSERT INTO leads (
         id, campaign_id, email, first_name, last_name, company, personalized_line,
         phone, platform, profile_url, description_meta, proposed_service, status, crm_stage
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [
        id,
        input.campaignId,
        input.email,
        input.firstName || null,
        input.lastName || null,
        input.company || null,
        input.personalizedLine || null,
        input.phone || null,
        input.platform || null,
        input.profileUrl || null,
        input.descriptionMeta || null,
        input.proposedService || null,
        input.status || LeadStatus.PENDING,
        input.crmStage || null,
      ]
    );
    return mapLead(r.rows[0]);
  },

  async bulkCreate(inputs: CreateLeadInput[]): Promise<Lead[]> {
    if (inputs.length === 0) return [];
    const created: Lead[] = [];
    for (const inp of inputs) {
      try {
        const l = await this.create(inp);
        created.push(l);
      } catch {
        /* skip dupes; unique index enforces */
      }
    }
    return created;
  },

  async update(leadId: string, patch: Record<string, unknown>): Promise<Lead | null> {
    const sets: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    for (const [k, v] of Object.entries(patch)) {
      const col = UPDATABLE[k];
      if (!col || v === undefined) continue;
      sets.push(`${col} = $${i++}`);
      values.push(v);
    }
    if (sets.length === 0) return this.findById(leadId);
    sets.push("updated_at = NOW()");
    values.push(leadId);
    const r = await pool.query(
      `UPDATE leads SET ${sets.join(", ")} WHERE id = $${i} AND deleted_at IS NULL RETURNING *`,
      values
    );
    return r.rows[0] ? mapLead(r.rows[0]) : null;
  },

  async setStatus(leadId: string, status: LeadStatus, extra?: { crmStage?: string; errorMessage?: string }): Promise<void> {
    const parts = ["status = $1", "updated_at = NOW()"];
    const values: unknown[] = [status];
    let i = 2;
    if (extra?.crmStage) { parts.push(`crm_stage = $${i++}`); values.push(extra.crmStage); }
    if (extra?.errorMessage != null) { parts.push(`error_message = $${i++}`); values.push(extra.errorMessage); }
    values.push(leadId);
    await pool.query(
      `UPDATE leads SET ${parts.join(", ")} WHERE id = $${i}`,
      values
    );
  },

  async setEnrichment(leadId: string, enrichment: Partial<Lead>): Promise<Lead | null> {
    const map: Record<string, string> = {
      website: "website",
      businessDescription: "business_description",
      googleReviews: "google_reviews",
      services: "services",
      socialLinks: "social_links",
      businessHours: "business_hours",
      bookingLinks: "booking_links",
      latestPosts: "latest_posts",
      technologies: "technologies",
      industry: "industry",
      employees: "employees",
      companySummary: "company_summary",
      aiResearch: "ai_research",
      aiEmails: "ai_emails",
      descriptionMeta: "description_meta",
      proposedService: "proposed_service",
    };
    const jsonFields = new Set([
      "google_reviews", "services", "social_links", "latest_posts",
      "technologies", "ai_research", "ai_emails",
    ]);
    const sets: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    for (const [k, v] of Object.entries(enrichment)) {
      const col = map[k];
      if (!col || v === undefined) continue;
      if (jsonFields.has(col)) {
        sets.push(`${col} = $${i++}::jsonb`);
        values.push(v == null ? null : JSON.stringify(v));
      } else {
        sets.push(`${col} = $${i++}`);
        values.push(v);
      }
    }
    if (sets.length === 0) return this.findById(leadId);
    sets.push("updated_at = NOW()");
    values.push(leadId);
    const r = await pool.query(
      `UPDATE leads SET ${sets.join(", ")} WHERE id = $${i} AND deleted_at IS NULL RETURNING *`,
      values
    );
    return r.rows[0] ? mapLead(r.rows[0]) : null;
  },

  async listPendingNeedingResearch(campaignId: string, limit: number): Promise<Lead[]> {
    const r = await pool.query(
      `SELECT * FROM leads
       WHERE campaign_id = $1 AND status = $2 AND ai_emails IS NULL AND deleted_at IS NULL
       ORDER BY created_at ASC LIMIT $3`,
      [campaignId, LeadStatus.PENDING, limit]
    );
    return r.rows.map(mapLead);
  },

  async listPendingWithoutPersonalization(campaignId: string, limit: number): Promise<Lead[]> {
    const r = await pool.query(
      `SELECT * FROM leads
       WHERE campaign_id = $1 AND deleted_at IS NULL
             AND (personalized_line IS NULL OR personalized_line = '')
       ORDER BY created_at ASC LIMIT $2`,
      [campaignId, limit]
    );
    return r.rows.map(mapLead);
  },

  async softDelete(id: string): Promise<void> {
    await pool.query("UPDATE leads SET deleted_at = NOW() WHERE id = $1", [id]);
  },

  async softDeleteByCampaign(campaignId: string): Promise<void> {
    await pool.query("UPDATE leads SET deleted_at = NOW() WHERE campaign_id = $1", [campaignId]);
  },
};
