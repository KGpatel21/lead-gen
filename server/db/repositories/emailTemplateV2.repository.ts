/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Email Template repository (Phase 6 enterprise edition).
 *
 * Sits alongside the existing `templates` table (legacy quick-templates).
 * Use this one when the template needs subject + full HTML + text
 * fallback + declared variables + preview + version history.
 */

import { pool } from "../pool";

export type EmailTemplateStatus = "ACTIVE" | "ARCHIVED";

export interface EmailTemplateV2 {
  id: string;
  workspaceId: string;
  name: string;
  description?: string;
  category: string;
  tags: string[];
  subject: string;
  htmlBody: string;
  textBody: string;
  mjmlSource?: string;
  variables: string[];
  status: EmailTemplateStatus;
  version: number;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : v == null ? "" : String(v));

function mapRow(r: any): EmailTemplateV2 {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    name: r.name,
    description: r.description || undefined,
    category: r.category,
    tags: (typeof r.tags === "string" ? JSON.parse(r.tags) : r.tags) || [],
    subject: r.subject,
    htmlBody: r.html_body,
    textBody: r.text_body,
    mjmlSource: r.mjml_source || undefined,
    variables: (typeof r.variables === "string" ? JSON.parse(r.variables) : r.variables) || [],
    status: r.status as EmailTemplateStatus,
    version: r.version,
    createdBy: r.created_by || undefined,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
    deletedAt: r.deleted_at ? iso(r.deleted_at) : undefined,
  };
}

export type CreateEmailTemplateInput = Omit<EmailTemplateV2, "id" | "version" | "createdAt" | "updatedAt" | "deletedAt" | "status"> & {
  status?: EmailTemplateStatus;
};

export const emailTemplateV2Repository = {
  async list(workspaceId: string, category?: string, tag?: string): Promise<EmailTemplateV2[]> {
    const params: unknown[] = [workspaceId];
    let where = "workspace_id = $1 AND deleted_at IS NULL";
    if (category) { params.push(category); where += ` AND category = $${params.length}`; }
    if (tag) { params.push(JSON.stringify([tag])); where += ` AND tags @> $${params.length}::jsonb`; }
    const r = await pool.query(
      `SELECT * FROM email_templates WHERE ${where} ORDER BY created_at DESC`,
      params
    );
    return r.rows.map(mapRow);
  },

  async findById(id: string, workspaceId?: string): Promise<EmailTemplateV2 | null> {
    const params: unknown[] = [id];
    let where = "id = $1";
    if (workspaceId) { params.push(workspaceId); where += " AND workspace_id = $2"; }
    const r = await pool.query(`SELECT * FROM email_templates WHERE ${where}`, params);
    return r.rows[0] ? mapRow(r.rows[0]) : null;
  },

  async create(input: CreateEmailTemplateInput): Promise<EmailTemplateV2> {
    const r = await pool.query(
      `INSERT INTO email_templates
         (workspace_id, name, description, category, tags, subject, html_body, text_body,
          mjml_source, variables, status, created_by)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10::jsonb,COALESCE($11,'ACTIVE'),$12)
       RETURNING *`,
      [
        input.workspaceId, input.name, input.description || null, input.category || "General",
        JSON.stringify(input.tags || []), input.subject, input.htmlBody, input.textBody,
        input.mjmlSource || null, JSON.stringify(input.variables || []), input.status || null,
        input.createdBy || null,
      ]
    );
    return mapRow(r.rows[0]);
  },

  async update(id: string, workspaceId: string, patch: Partial<CreateEmailTemplateInput>): Promise<EmailTemplateV2 | null> {
    const columnMap: Record<string, string> = {
      name: "name", description: "description", category: "category", subject: "subject",
      htmlBody: "html_body", textBody: "text_body", mjmlSource: "mjml_source", status: "status",
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
    if (patch.tags !== undefined)      { sets.push(`tags = $${i++}::jsonb`);      values.push(JSON.stringify(patch.tags)); }
    if (patch.variables !== undefined) { sets.push(`variables = $${i++}::jsonb`); values.push(JSON.stringify(patch.variables)); }
    if (sets.length === 0) return this.findById(id, workspaceId);
    sets.push("version = version + 1", "updated_at = NOW()");
    values.push(id, workspaceId);
    const r = await pool.query(
      `UPDATE email_templates SET ${sets.join(", ")}
       WHERE id = $${i++} AND workspace_id = $${i} AND deleted_at IS NULL RETURNING *`,
      values
    );
    if (r.rows[0]) {
      await pool.query(
        `INSERT INTO email_template_versions (template_id, version, payload)
         VALUES ($1, $2, $3::jsonb) ON CONFLICT DO NOTHING`,
        [r.rows[0].id, r.rows[0].version, JSON.stringify(mapRow(r.rows[0]))]
      );
    }
    return r.rows[0] ? mapRow(r.rows[0]) : null;
  },

  async duplicate(id: string, workspaceId: string, nameOverride?: string): Promise<EmailTemplateV2 | null> {
    const src = await this.findById(id, workspaceId);
    if (!src) return null;
    return this.create({
      workspaceId,
      name: nameOverride?.trim() || `${src.name} (Copy)`,
      description: src.description,
      category: src.category,
      tags: src.tags,
      subject: src.subject,
      htmlBody: src.htmlBody,
      textBody: src.textBody,
      mjmlSource: src.mjmlSource,
      variables: src.variables,
      createdBy: src.createdBy,
    });
  },

  async softDelete(id: string, workspaceId: string): Promise<boolean> {
    const r = await pool.query(
      `UPDATE email_templates SET deleted_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL`,
      [id, workspaceId]
    );
    return (r.rowCount ?? 0) > 0;
  },
};
