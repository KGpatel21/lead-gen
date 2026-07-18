/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from "crypto";
import { pool } from "../pool";

export interface TemplateVersion {
  id: string;
  templateId: string;
  version: number;
  name: string;
  subject: string;
  body: string;
  variables: string[];
  changedBy?: string;
  createdAt: string;
}

const iso = (v: unknown): string =>
  v instanceof Date ? v.toISOString() : v == null ? "" : String(v);

function mapRow(r: any): TemplateVersion {
  return {
    id: r.id,
    templateId: r.template_id,
    version: r.version,
    name: r.name,
    subject: r.subject,
    body: r.body,
    variables: r.variables || [],
    changedBy: r.changed_by || undefined,
    createdAt: iso(r.created_at),
  };
}

export const templateVersionRepository = {
  async listByTemplate(templateId: string): Promise<TemplateVersion[]> {
    const r = await pool.query(
      "SELECT * FROM template_versions WHERE template_id = $1 ORDER BY version DESC",
      [templateId]
    );
    return r.rows.map(mapRow);
  },

  async record(input: {
    templateId: string;
    version: number;
    name: string;
    subject: string;
    body: string;
    variables: string[];
    changedBy?: string;
  }): Promise<TemplateVersion> {
    const id = `tv-${Date.now()}-${crypto.randomUUID().split("-")[0]}`;
    const r = await pool.query(
      `INSERT INTO template_versions (id, template_id, version, name, subject, body, variables, changed_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
       ON CONFLICT (template_id, version) DO NOTHING
       RETURNING *`,
      [
        id,
        input.templateId,
        input.version,
        input.name,
        input.subject,
        input.body,
        JSON.stringify(input.variables),
        input.changedBy || null,
      ]
    );
    if (r.rows[0]) return mapRow(r.rows[0]);
    const existing = await pool.query(
      "SELECT * FROM template_versions WHERE template_id = $1 AND version = $2",
      [input.templateId, input.version]
    );
    return mapRow(existing.rows[0]);
  },
};
