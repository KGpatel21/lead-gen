/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Knowledge File repository — one row per uploaded file. Extracted text
 * is stored inline; chunks + vectors live in knowledge_chunks.
 */

import { pool } from "../pool";

export type KnowledgeFileStatus = "PENDING" | "EXTRACTING" | "CHUNKING" | "EMBEDDING" | "READY" | "ERROR";

export interface KnowledgeFile {
  id: string;
  workspaceId: string;
  knowledgeBaseId: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  contentHash: string;
  status: KnowledgeFileStatus;
  errorMessage?: string;
  extractedText?: string;
  chunkCount: number;
  vectorCount: number;
  version: number;
  uploadedBy?: string;
  createdAt: string;
  updatedAt: string;
  indexedAt?: string;
  deletedAt?: string;
}

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : v == null ? "" : String(v));

function mapRow(r: any): KnowledgeFile {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    knowledgeBaseId: r.knowledge_base_id,
    fileName: r.file_name,
    mimeType: r.mime_type,
    fileSize: Number(r.file_size || 0),
    contentHash: r.content_hash,
    status: r.status as KnowledgeFileStatus,
    errorMessage: r.error_message || undefined,
    extractedText: r.extracted_text || undefined,
    chunkCount: r.chunk_count || 0,
    vectorCount: r.vector_count || 0,
    version: r.version || 1,
    uploadedBy: r.uploaded_by || undefined,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
    indexedAt: r.indexed_at ? iso(r.indexed_at) : undefined,
    deletedAt: r.deleted_at ? iso(r.deleted_at) : undefined,
  };
}

export const knowledgeFileRepository = {
  async listByKb(kbId: string, workspaceId: string): Promise<KnowledgeFile[]> {
    const r = await pool.query(
      `SELECT * FROM knowledge_files
       WHERE knowledge_base_id = $1 AND workspace_id = $2 AND deleted_at IS NULL
       ORDER BY created_at DESC`,
      [kbId, workspaceId]
    );
    return r.rows.map(mapRow);
  },

  async findById(id: string, workspaceId?: string): Promise<KnowledgeFile | null> {
    const params: unknown[] = [id];
    let where = "id = $1";
    if (workspaceId) { params.push(workspaceId); where += " AND workspace_id = $2"; }
    const r = await pool.query(`SELECT * FROM knowledge_files WHERE ${where}`, params);
    return r.rows[0] ? mapRow(r.rows[0]) : null;
  },

  async findByHash(kbId: string, contentHash: string): Promise<KnowledgeFile | null> {
    const r = await pool.query(
      `SELECT * FROM knowledge_files WHERE knowledge_base_id = $1 AND content_hash = $2 AND deleted_at IS NULL LIMIT 1`,
      [kbId, contentHash]
    );
    return r.rows[0] ? mapRow(r.rows[0]) : null;
  },

  async create(input: {
    workspaceId: string;
    knowledgeBaseId: string;
    fileName: string;
    mimeType: string;
    fileSize: number;
    contentHash: string;
    uploadedBy?: string;
  }): Promise<KnowledgeFile> {
    const r = await pool.query(
      `INSERT INTO knowledge_files
         (workspace_id, knowledge_base_id, file_name, mime_type, file_size, content_hash,
          uploaded_by, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'PENDING')
       RETURNING *`,
      [
        input.workspaceId,
        input.knowledgeBaseId,
        input.fileName,
        input.mimeType,
        input.fileSize,
        input.contentHash,
        input.uploadedBy || null,
      ]
    );
    return mapRow(r.rows[0]);
  },

  async setStatus(id: string, status: KnowledgeFileStatus, errorMessage?: string): Promise<void> {
    await pool.query(
      `UPDATE knowledge_files
         SET status = $1, error_message = $2, updated_at = NOW()
       WHERE id = $3`,
      [status, errorMessage || null, id]
    );
  },

  async setExtracted(id: string, extractedText: string): Promise<void> {
    await pool.query(
      `UPDATE knowledge_files
         SET extracted_text = $1, status = 'CHUNKING', updated_at = NOW()
       WHERE id = $2`,
      [extractedText, id]
    );
  },

  async setIndexed(id: string, chunkCount: number, vectorCount: number): Promise<void> {
    await pool.query(
      `UPDATE knowledge_files
         SET status = 'READY', chunk_count = $1, vector_count = $2,
             indexed_at = NOW(), updated_at = NOW()
       WHERE id = $3`,
      [chunkCount, vectorCount, id]
    );
  },

  async softDelete(id: string, workspaceId: string): Promise<boolean> {
    const r = await pool.query(
      `UPDATE knowledge_files SET deleted_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL`,
      [id, workspaceId]
    );
    return (r.rowCount ?? 0) > 0;
  },
};
