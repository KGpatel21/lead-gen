/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Signature repository — app-owned email footers appended to every
 * outbound send. Independent of Gmail/SES/SMTP — the application
 * appends the selected signature at compose time.
 */

import { pool } from "../pool";

export type SignatureStatus = "ACTIVE" | "ARCHIVED";

export interface Signature {
  id: string;
  workspaceId: string;
  name: string;
  role?: string;
  title?: string;
  company?: string;
  website?: string;
  phone?: string;
  linkedin?: string;
  address?: string;
  logoUrl?: string;
  social: Record<string, string>;
  disclaimer?: string;
  htmlBody: string;
  textBody: string;
  status: SignatureStatus;
  isDefault: boolean;
  version: number;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : v == null ? "" : String(v));

function mapRow(r: any): Signature {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    name: r.name,
    role: r.role || undefined,
    title: r.title || undefined,
    company: r.company || undefined,
    website: r.website || undefined,
    phone: r.phone || undefined,
    linkedin: r.linkedin || undefined,
    address: r.address || undefined,
    logoUrl: r.logo_url || undefined,
    social: (typeof r.social_json === "string" ? JSON.parse(r.social_json) : r.social_json) || {},
    disclaimer: r.disclaimer || undefined,
    htmlBody: r.html_body,
    textBody: r.text_body,
    status: r.status as SignatureStatus,
    isDefault: !!r.is_default,
    version: r.version || 1,
    createdBy: r.created_by || undefined,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
    deletedAt: r.deleted_at ? iso(r.deleted_at) : undefined,
  };
}

export type CreateSignatureInput = Omit<Signature, "id" | "version" | "createdAt" | "updatedAt" | "deletedAt" | "status"> & {
  status?: SignatureStatus;
};

export const signatureRepository = {
  async list(workspaceId: string): Promise<Signature[]> {
    const r = await pool.query(
      `SELECT * FROM signatures WHERE workspace_id = $1 AND deleted_at IS NULL ORDER BY is_default DESC, created_at DESC`,
      [workspaceId]
    );
    return r.rows.map(mapRow);
  },

  async findById(id: string, workspaceId?: string): Promise<Signature | null> {
    const params: unknown[] = [id];
    let where = "id = $1";
    if (workspaceId) { params.push(workspaceId); where += " AND workspace_id = $2"; }
    const r = await pool.query(`SELECT * FROM signatures WHERE ${where}`, params);
    return r.rows[0] ? mapRow(r.rows[0]) : null;
  },

  async findDefault(workspaceId: string): Promise<Signature | null> {
    const r = await pool.query(
      `SELECT * FROM signatures WHERE workspace_id = $1 AND is_default = TRUE AND deleted_at IS NULL LIMIT 1`,
      [workspaceId]
    );
    return r.rows[0] ? mapRow(r.rows[0]) : null;
  },

  async create(input: CreateSignatureInput): Promise<Signature> {
    if (input.isDefault) {
      // Only one default per workspace — enforced by partial UNIQUE index.
      await pool.query(
        `UPDATE signatures SET is_default = FALSE, updated_at = NOW()
         WHERE workspace_id = $1 AND is_default = TRUE AND deleted_at IS NULL`,
        [input.workspaceId]
      );
    }
    const r = await pool.query(
      `INSERT INTO signatures
         (workspace_id, name, role, title, company, website, phone, linkedin, address, logo_url,
          social_json, disclaimer, html_body, text_body, status, is_default, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,COALESCE($15,'ACTIVE'),$16,$17)
       RETURNING *`,
      [
        input.workspaceId,
        input.name,
        input.role || null,
        input.title || null,
        input.company || null,
        input.website || null,
        input.phone || null,
        input.linkedin || null,
        input.address || null,
        input.logoUrl || null,
        JSON.stringify(input.social || {}),
        input.disclaimer || null,
        input.htmlBody,
        input.textBody,
        input.status || null,
        !!input.isDefault,
        input.createdBy || null,
      ]
    );
    return mapRow(r.rows[0]);
  },

  async update(id: string, workspaceId: string, patch: Partial<CreateSignatureInput>): Promise<Signature | null> {
    const columnMap: Record<string, string> = {
      name: "name", role: "role", title: "title", company: "company", website: "website",
      phone: "phone", linkedin: "linkedin", address: "address", logoUrl: "logo_url",
      disclaimer: "disclaimer", htmlBody: "html_body", textBody: "text_body",
      status: "status", isDefault: "is_default",
    };
    if (patch.isDefault) {
      await pool.query(
        `UPDATE signatures SET is_default = FALSE, updated_at = NOW()
         WHERE workspace_id = $1 AND is_default = TRUE AND id <> $2 AND deleted_at IS NULL`,
        [workspaceId, id]
      );
    }
    const sets: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    for (const [k, v] of Object.entries(patch)) {
      const col = columnMap[k];
      if (!col || v === undefined) continue;
      sets.push(`${col} = $${i++}`);
      values.push(v);
    }
    if (patch.social !== undefined) {
      sets.push(`social_json = $${i++}::jsonb`);
      values.push(JSON.stringify(patch.social));
    }
    if (sets.length === 0) return this.findById(id, workspaceId);
    sets.push("version = version + 1", "updated_at = NOW()");
    values.push(id, workspaceId);
    const r = await pool.query(
      `UPDATE signatures SET ${sets.join(", ")}
       WHERE id = $${i++} AND workspace_id = $${i} AND deleted_at IS NULL RETURNING *`,
      values
    );
    if (r.rows[0]) {
      // Snapshot into signature_versions for history.
      await pool.query(
        `INSERT INTO signature_versions (signature_id, version, payload)
         VALUES ($1, $2, $3::jsonb) ON CONFLICT DO NOTHING`,
        [r.rows[0].id, r.rows[0].version, JSON.stringify(mapRow(r.rows[0]))]
      );
    }
    return r.rows[0] ? mapRow(r.rows[0]) : null;
  },

  async softDelete(id: string, workspaceId: string): Promise<boolean> {
    const r = await pool.query(
      `UPDATE signatures SET deleted_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL`,
      [id, workspaceId]
    );
    return (r.rowCount ?? 0) > 0;
  },

  async listVersions(id: string, workspaceId: string) {
    // Enforce scope via a JOIN to signatures.
    const r = await pool.query(
      `SELECT sv.* FROM signature_versions sv
         JOIN signatures s ON s.id = sv.signature_id
       WHERE sv.signature_id = $1 AND s.workspace_id = $2
       ORDER BY sv.version DESC`,
      [id, workspaceId]
    );
    return r.rows.map((r) => ({
      id: r.id,
      signatureId: r.signature_id,
      version: r.version,
      payload: typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload,
      changedBy: r.changed_by || undefined,
      createdAt: iso(r.created_at),
    }));
  },
};
