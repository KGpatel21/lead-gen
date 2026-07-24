/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Knowledge Base repository — the top-level "folder" that groups
 * uploaded files, chunks, and vectors. Every KB belongs to exactly one
 * workspace; queries are workspace-scoped.
 */

import { pool } from "../pool";

export type KbStatus = "DRAFT" | "INDEXING" | "READY" | "ERROR" | "ARCHIVED";

export interface KnowledgeBase {
  id: string;
  workspaceId: string;
  name: string;
  description?: string;
  tags: string[];
  status: KbStatus;
  embeddingProvider: string;
  embeddingModel: string;
  chunkSize: number;
  chunkOverlap: number;
  fileCount: number;
  chunkCount: number;
  vectorCount: number;
  storageBytes: number;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : v == null ? "" : String(v));

function mapRow(r: any): KnowledgeBase {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    name: r.name,
    description: r.description || undefined,
    tags: Array.isArray(r.tags) ? r.tags : (typeof r.tags === "string" ? JSON.parse(r.tags) : []),
    status: r.status as KbStatus,
    embeddingProvider: r.embedding_provider,
    embeddingModel: r.embedding_model,
    chunkSize: r.chunk_size,
    chunkOverlap: r.chunk_overlap,
    fileCount: r.file_count || 0,
    chunkCount: r.chunk_count || 0,
    vectorCount: r.vector_count || 0,
    storageBytes: Number(r.storage_bytes || 0),
    createdBy: r.created_by || undefined,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
    deletedAt: r.deleted_at ? iso(r.deleted_at) : undefined,
  };
}

export interface CreateKnowledgeBaseInput {
  workspaceId: string;
  name: string;
  description?: string;
  tags?: string[];
  embeddingProvider?: string;
  embeddingModel?: string;
  chunkSize?: number;
  chunkOverlap?: number;
  createdBy?: string;
}

export type KnowledgeBasePatch = Partial<Omit<CreateKnowledgeBaseInput, "workspaceId">> & {
  status?: KbStatus;
};

export const knowledgeBaseRepository = {
  async list(workspaceId: string): Promise<KnowledgeBase[]> {
    const r = await pool.query(
      `SELECT * FROM knowledge_bases WHERE workspace_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC`,
      [workspaceId]
    );
    return r.rows.map(mapRow);
  },

  async findById(id: string, workspaceId?: string): Promise<KnowledgeBase | null> {
    const params: unknown[] = [id];
    let where = "id = $1";
    if (workspaceId) { params.push(workspaceId); where += " AND workspace_id = $2"; }
    const r = await pool.query(`SELECT * FROM knowledge_bases WHERE ${where}`, params);
    return r.rows[0] ? mapRow(r.rows[0]) : null;
  },

  async create(input: CreateKnowledgeBaseInput): Promise<KnowledgeBase> {
    const r = await pool.query(
      `INSERT INTO knowledge_bases
         (workspace_id, name, description, tags, embedding_provider, embedding_model,
          chunk_size, chunk_overlap, created_by, status)
       VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,'DRAFT')
       RETURNING *`,
      [
        input.workspaceId,
        input.name,
        input.description || null,
        JSON.stringify(input.tags || []),
        input.embeddingProvider || "openai",
        input.embeddingModel || "text-embedding-3-small",
        input.chunkSize ?? 1200,
        input.chunkOverlap ?? 150,
        input.createdBy || null,
      ]
    );
    return mapRow(r.rows[0]);
  },

  async update(id: string, patch: KnowledgeBasePatch, workspaceId?: string): Promise<KnowledgeBase | null> {
    const columnMap: Record<string, string> = {
      name: "name",
      description: "description",
      tags: "tags",
      embeddingProvider: "embedding_provider",
      embeddingModel: "embedding_model",
      chunkSize: "chunk_size",
      chunkOverlap: "chunk_overlap",
      status: "status",
    };
    const sets: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    for (const [k, v] of Object.entries(patch)) {
      const col = columnMap[k];
      if (!col || v === undefined) continue;
      if (k === "tags") { sets.push(`${col} = $${i++}::jsonb`); values.push(JSON.stringify(v)); }
      else { sets.push(`${col} = $${i++}`); values.push(v); }
    }
    if (sets.length === 0) return this.findById(id, workspaceId);
    sets.push("updated_at = NOW()");
    values.push(id);
    const scope = workspaceId ? ` AND workspace_id = $${i + 1}` : "";
    if (workspaceId) values.push(workspaceId);
    const r = await pool.query(
      `UPDATE knowledge_bases SET ${sets.join(", ")} WHERE id = $${i} AND deleted_at IS NULL${scope} RETURNING *`,
      values
    );
    return r.rows[0] ? mapRow(r.rows[0]) : null;
  },

  async softDelete(id: string, workspaceId: string): Promise<boolean> {
    const r = await pool.query(
      `UPDATE knowledge_bases SET deleted_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL`,
      [id, workspaceId]
    );
    return (r.rowCount ?? 0) > 0;
  },

  async setStatus(id: string, status: KbStatus): Promise<void> {
    await pool.query(`UPDATE knowledge_bases SET status = $1, updated_at = NOW() WHERE id = $2`, [status, id]);
  },

  /**
   * Roll up file / chunk / vector counts and storage from the child tables.
   * Called after every file upload / delete.
   */
  async recomputeStats(id: string): Promise<void> {
    await pool.query(
      `UPDATE knowledge_bases kb SET
         file_count   = (SELECT COUNT(*)::int FROM knowledge_files  WHERE knowledge_base_id = kb.id AND deleted_at IS NULL),
         chunk_count  = (SELECT COUNT(*)::int FROM knowledge_chunks WHERE knowledge_base_id = kb.id),
         vector_count = (SELECT COUNT(*)::int FROM knowledge_chunks WHERE knowledge_base_id = kb.id AND embedding IS NOT NULL),
         storage_bytes = COALESCE((SELECT SUM(file_size) FROM knowledge_files WHERE knowledge_base_id = kb.id AND deleted_at IS NULL), 0),
         updated_at   = NOW()
       WHERE kb.id = $1`,
      [id]
    );
  },
};
