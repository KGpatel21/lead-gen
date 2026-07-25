/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from "crypto";
import { pool } from "../pool";
import { mapTemplate } from "../rowMappers";
import { EmailTemplate } from "../../../src/types";

export interface CreateTemplateInput {
  workspaceId: string;
  name: string;
  subject: string;
  body: string;
  category?: string;
}

export const templateRepository = {
  async list(workspaceId?: string): Promise<EmailTemplate[]> {
    if (workspaceId) {
      const r = await pool.query(
        `SELECT * FROM templates WHERE workspace_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC`,
        [workspaceId]
      );
      return r.rows.map(mapTemplate);
    }
    const r = await pool.query(
      `SELECT * FROM templates WHERE deleted_at IS NULL ORDER BY created_at DESC`
    );
    return r.rows.map(mapTemplate);
  },

  async create(input: CreateTemplateInput): Promise<EmailTemplate> {
    if (!input.workspaceId) throw new Error("[templateRepository.create] workspaceId required");
    const id = `tpl-${Date.now()}-${crypto.randomUUID().split("-")[0]}`;
    const r = await pool.query(
      `INSERT INTO templates (id, workspace_id, name, subject, body, category)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [id, input.workspaceId, input.name, input.subject, input.body, input.category || "Outbound"]
    );
    return mapTemplate(r.rows[0]);
  },

  async softDelete(id: string, workspaceId?: string): Promise<boolean> {
    if (workspaceId) {
      const r = await pool.query(
        `UPDATE templates SET deleted_at = NOW()
         WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL`,
        [id, workspaceId]
      );
      return (r.rowCount ?? 0) > 0;
    }
    const r = await pool.query(
      `UPDATE templates SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    return (r.rowCount ?? 0) > 0;
  },
};
