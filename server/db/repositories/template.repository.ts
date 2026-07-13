/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from "crypto";
import { pool } from "../pool";
import { mapTemplate } from "../rowMappers";
import { EmailTemplate } from "../../../src/types";

export interface CreateTemplateInput {
  name: string;
  subject: string;
  body: string;
  category?: string;
}

export const templateRepository = {
  async list(): Promise<EmailTemplate[]> {
    const r = await pool.query(
      "SELECT * FROM templates WHERE deleted_at IS NULL ORDER BY created_at DESC"
    );
    return r.rows.map(mapTemplate);
  },

  async create(input: CreateTemplateInput): Promise<EmailTemplate> {
    const id = `tpl-${Date.now()}-${crypto.randomUUID().split("-")[0]}`;
    const r = await pool.query(
      `INSERT INTO templates (id, name, subject, body, category)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [id, input.name, input.subject, input.body, input.category || "Outbound"]
    );
    return mapTemplate(r.rows[0]);
  },

  async softDelete(id: string): Promise<void> {
    await pool.query("UPDATE templates SET deleted_at = NOW() WHERE id = $1", [id]);
  },
};
