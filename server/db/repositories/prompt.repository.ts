/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Prompt Library — reusable prompt templates the AI composer can pull
 * in per campaign / per step. Variables are simple {{name}} slots
 * substituted at compose time.
 */

import { pool } from "../pool";

export type PromptStatus = "ACTIVE" | "ARCHIVED";

export interface PromptEntry {
  id: string;
  workspaceId: string;
  name: string;
  description?: string;
  category: string;
  tags: string[];
  systemPrompt?: string;
  userPrompt: string;
  aiModel?: string;
  temperature: number;
  variables: string[];
  status: PromptStatus;
  version: number;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : v == null ? "" : String(v));

function mapRow(r: any): PromptEntry {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    name: r.name,
    description: r.description || undefined,
    category: r.category,
    tags: (typeof r.tags === "string" ? JSON.parse(r.tags) : r.tags) || [],
    systemPrompt: r.system_prompt || undefined,
    userPrompt: r.user_prompt,
    aiModel: r.ai_model || undefined,
    temperature: Number(r.temperature ?? 0.7),
    variables: (typeof r.variables === "string" ? JSON.parse(r.variables) : r.variables) || [],
    status: r.status as PromptStatus,
    version: r.version,
    createdBy: r.created_by || undefined,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
    deletedAt: r.deleted_at ? iso(r.deleted_at) : undefined,
  };
}

export type CreatePromptInput = Omit<PromptEntry, "id" | "version" | "createdAt" | "updatedAt" | "deletedAt" | "status"> & {
  status?: PromptStatus;
};

export const promptRepository = {
  async list(workspaceId: string, category?: string): Promise<PromptEntry[]> {
    const params: unknown[] = [workspaceId];
    let where = "workspace_id = $1 AND deleted_at IS NULL";
    if (category) { params.push(category); where += ` AND category = $${params.length}`; }
    const r = await pool.query(
      `SELECT * FROM prompt_library WHERE ${where} ORDER BY created_at DESC`,
      params
    );
    return r.rows.map(mapRow);
  },

  async findById(id: string, workspaceId?: string): Promise<PromptEntry | null> {
    const params: unknown[] = [id];
    let where = "id = $1";
    if (workspaceId) { params.push(workspaceId); where += " AND workspace_id = $2"; }
    const r = await pool.query(`SELECT * FROM prompt_library WHERE ${where}`, params);
    return r.rows[0] ? mapRow(r.rows[0]) : null;
  },

  async create(input: CreatePromptInput): Promise<PromptEntry> {
    const r = await pool.query(
      `INSERT INTO prompt_library
         (workspace_id, name, description, category, tags, system_prompt, user_prompt,
          ai_model, temperature, variables, status, created_by)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10::jsonb,COALESCE($11,'ACTIVE'),$12)
       RETURNING *`,
      [
        input.workspaceId, input.name, input.description || null, input.category || "General",
        JSON.stringify(input.tags || []), input.systemPrompt || null, input.userPrompt,
        input.aiModel || null, input.temperature ?? 0.7,
        JSON.stringify(input.variables || []), input.status || null, input.createdBy || null,
      ]
    );
    return mapRow(r.rows[0]);
  },

  async update(id: string, workspaceId: string, patch: Partial<CreatePromptInput>): Promise<PromptEntry | null> {
    const columnMap: Record<string, string> = {
      name: "name", description: "description", category: "category",
      systemPrompt: "system_prompt", userPrompt: "user_prompt",
      aiModel: "ai_model", temperature: "temperature", status: "status",
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
      `UPDATE prompt_library SET ${sets.join(", ")}
       WHERE id = $${i++} AND workspace_id = $${i} AND deleted_at IS NULL RETURNING *`,
      values
    );
    return r.rows[0] ? mapRow(r.rows[0]) : null;
  },

  async duplicate(id: string, workspaceId: string, nameOverride?: string): Promise<PromptEntry | null> {
    const src = await this.findById(id, workspaceId);
    if (!src) return null;
    return this.create({
      workspaceId, name: nameOverride?.trim() || `${src.name} (Copy)`,
      description: src.description, category: src.category, tags: src.tags,
      systemPrompt: src.systemPrompt, userPrompt: src.userPrompt,
      aiModel: src.aiModel, temperature: src.temperature, variables: src.variables,
      createdBy: src.createdBy,
    });
  },

  async softDelete(id: string, workspaceId: string): Promise<boolean> {
    const r = await pool.query(
      `UPDATE prompt_library SET deleted_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL`,
      [id, workspaceId]
    );
    return (r.rowCount ?? 0) > 0;
  },
};
