/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Lead repository — every user-facing method REQUIRES a workspaceId so
 * cross-tenant reads are impossible from the SQL layer up.
 *
 * The optional `workspaceId?: string` signature exists on a small number
 * of internal-only helpers (bulk seeding, cross-tenant admin ops) but
 * anything reachable from an authenticated HTTP request goes through
 * the workspace-scoped variant. Controllers now MUST pass
 * `req.workspaceId` — the middleware guarantees it's populated.
 */

import crypto from "crypto";
import { pool } from "../pool";
import { mapLead } from "../rowMappers";
import { Lead, LeadStatus } from "../../../src/types";

export interface CreateLeadInput {
  workspaceId: string;
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

function requireWs(v: string | undefined | null, method: string): string {
  if (!v || typeof v !== "string" || v.trim().length === 0) {
    throw new Error(`[leadRepository.${method}] workspaceId is required — tenant boundary violation prevented`);
  }
  return v;
}

export const leadRepository = {
  async list(workspaceId: string): Promise<Lead[]> {
    requireWs(workspaceId, "list");
    const r = await pool.query(
      `SELECT * FROM leads WHERE workspace_id = $1 AND deleted_at IS NULL
       ORDER BY created_at DESC LIMIT 5000`,
      [workspaceId]
    );
    return r.rows.map(mapLead);
  },

  async findById(id: string, workspaceId?: string): Promise<Lead | null> {
    // workspaceId is optional here because internal workers hydrate leads
    // by id after they've already validated the parent (email row's
    // workspace_id). External callers MUST pass it — the controller
    // layer enforces this.
    if (workspaceId) {
      const r = await pool.query(
        `SELECT * FROM leads WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL`,
        [id, workspaceId]
      );
      return r.rows[0] ? mapLead(r.rows[0]) : null;
    }
    const r = await pool.query(
      `SELECT * FROM leads WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    return r.rows[0] ? mapLead(r.rows[0]) : null;
  },

  async findByEmailInCampaign(campaignId: string, email: string, workspaceId: string): Promise<Lead | null> {
    requireWs(workspaceId, "findByEmailInCampaign");
    const r = await pool.query(
      `SELECT * FROM leads
       WHERE campaign_id = $1 AND LOWER(email) = LOWER($2)
         AND workspace_id = $3 AND deleted_at IS NULL`,
      [campaignId, email, workspaceId]
    );
    return r.rows[0] ? mapLead(r.rows[0]) : null;
  },

  async listByCampaign(campaignId: string, workspaceId: string): Promise<Lead[]> {
    requireWs(workspaceId, "listByCampaign");
    const r = await pool.query(
      `SELECT * FROM leads
       WHERE campaign_id = $1 AND workspace_id = $2 AND deleted_at IS NULL
       ORDER BY created_at DESC`,
      [campaignId, workspaceId]
    );
    return r.rows.map(mapLead);
  },

  async listPendingByCampaign(campaignId: string, workspaceId: string): Promise<Lead[]> {
    requireWs(workspaceId, "listPendingByCampaign");
    const r = await pool.query(
      `SELECT * FROM leads
       WHERE campaign_id = $1 AND status = $2 AND workspace_id = $3 AND deleted_at IS NULL`,
      [campaignId, LeadStatus.PENDING, workspaceId]
    );
    return r.rows.map(mapLead);
  },

  async create(input: CreateLeadInput): Promise<Lead> {
    requireWs(input.workspaceId, "create");
    const id = `lead-${Date.now()}-${crypto.randomUUID().split("-")[0]}`;
    const r = await pool.query(
      `INSERT INTO leads (
         id, workspace_id, campaign_id, email, first_name, last_name, company, personalized_line,
         phone, platform, profile_url, description_meta, proposed_service, status, crm_stage
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [
        id,
        input.workspaceId,
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

  async update(leadId: string, patch: Record<string, unknown>, workspaceId: string): Promise<Lead | null> {
    requireWs(workspaceId, "update");
    const sets: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    for (const [k, v] of Object.entries(patch)) {
      const col = UPDATABLE[k];
      if (!col || v === undefined) continue;
      sets.push(`${col} = $${i++}`);
      values.push(v);
    }
    if (sets.length === 0) return this.findById(leadId, workspaceId);
    sets.push("updated_at = NOW()");
    values.push(leadId, workspaceId);
    const r = await pool.query(
      `UPDATE leads SET ${sets.join(", ")}
       WHERE id = $${i} AND workspace_id = $${i + 1} AND deleted_at IS NULL
       RETURNING *`,
      values
    );
    return r.rows[0] ? mapLead(r.rows[0]) : null;
  },

  async setStatus(leadId: string, status: LeadStatus, extra?: { crmStage?: string; errorMessage?: string }): Promise<void> {
    // Internal worker path — hydrate-then-update. Kept unscoped because
    // by the time we reach this, we've verified the parent email row's
    // workspace. Not reachable from any HTTP request.
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

  async setEnrichment(leadId: string, enrichment: Partial<Lead>, workspaceId?: string): Promise<Lead | null> {
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
    if (sets.length === 0) return this.findById(leadId, workspaceId);
    sets.push("updated_at = NOW()");
    values.push(leadId);
    const wsClause = workspaceId ? ` AND workspace_id = $${i + 1}` : "";
    if (workspaceId) values.push(workspaceId);
    const r = await pool.query(
      `UPDATE leads SET ${sets.join(", ")} WHERE id = $${i} AND deleted_at IS NULL${wsClause} RETURNING *`,
      values
    );
    return r.rows[0] ? mapLead(r.rows[0]) : null;
  },

  async listPendingNeedingResearch(campaignId: string, limit: number, workspaceId: string): Promise<Lead[]> {
    requireWs(workspaceId, "listPendingNeedingResearch");
    const r = await pool.query(
      `SELECT * FROM leads
       WHERE campaign_id = $1 AND status = $2 AND ai_emails IS NULL
             AND workspace_id = $3 AND deleted_at IS NULL
       ORDER BY created_at ASC LIMIT $4`,
      [campaignId, LeadStatus.PENDING, workspaceId, limit]
    );
    return r.rows.map(mapLead);
  },

  async listPendingWithoutPersonalization(campaignId: string, limit: number, workspaceId: string): Promise<Lead[]> {
    requireWs(workspaceId, "listPendingWithoutPersonalization");
    const r = await pool.query(
      `SELECT * FROM leads
       WHERE campaign_id = $1 AND workspace_id = $2 AND deleted_at IS NULL
             AND (personalized_line IS NULL OR personalized_line = '')
       ORDER BY created_at ASC LIMIT $3`,
      [campaignId, workspaceId, limit]
    );
    return r.rows.map(mapLead);
  },

  async softDelete(id: string, workspaceId: string): Promise<boolean> {
    requireWs(workspaceId, "softDelete");
    const r = await pool.query(
      `UPDATE leads SET deleted_at = NOW()
       WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL`,
      [id, workspaceId]
    );
    return (r.rowCount ?? 0) > 0;
  },

  async softDeleteByCampaign(campaignId: string, workspaceId: string): Promise<number> {
    requireWs(workspaceId, "softDeleteByCampaign");
    const r = await pool.query(
      `UPDATE leads SET deleted_at = NOW()
       WHERE campaign_id = $1 AND workspace_id = $2 AND deleted_at IS NULL`,
      [campaignId, workspaceId]
    );
    return r.rowCount ?? 0;
  },
};
