/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Knowledge Chunk repository — text chunks + their embeddings.
 *
 * Embeddings are stored as Postgres real[] (portable across every
 * managed PG including RDS/Neon/Supabase without the pgvector
 * extension). Cosine similarity is computed at query time in Node —
 * fine up to tens of thousands of chunks per query scope. If usage
 * grows past that, swap this repo's `similaritySearch` for a
 * pgvector-backed query without changing the calling contract.
 */

import { pool } from "../pool";

export interface KnowledgeChunk {
  id: string;
  workspaceId: string;
  knowledgeBaseId: string;
  fileId: string;
  chunkIndex: number;
  content: string;
  tokenEstimate: number;
  embedding: number[] | null;
  embeddingModel: string;
  embeddingDims: number;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface KnowledgeChunkHit extends KnowledgeChunk {
  /** Cosine similarity in [-1, 1]. Higher = more relevant. */
  score: number;
  /** File name of the chunk's parent, joined at query time for display. */
  fileName?: string;
  /** KB name for display. */
  kbName?: string;
}

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : v == null ? "" : String(v));

function mapRow(r: any): KnowledgeChunk {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    knowledgeBaseId: r.knowledge_base_id,
    fileId: r.file_id,
    chunkIndex: r.chunk_index,
    content: r.content,
    tokenEstimate: r.token_estimate,
    embedding: r.embedding as number[] | null,
    embeddingModel: r.embedding_model,
    embeddingDims: r.embedding_dims,
    metadata: (typeof r.metadata === "string" ? JSON.parse(r.metadata) : r.metadata) || {},
    createdAt: iso(r.created_at),
  };
}

function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (denom === 0) return 0;
  return dot / denom;
}

export const knowledgeChunkRepository = {
  async bulkInsert(rows: Array<Omit<KnowledgeChunk, "id" | "createdAt"> & { workspaceId: string }>): Promise<number> {
    if (rows.length === 0) return 0;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      let inserted = 0;
      for (const c of rows) {
        await client.query(
          `INSERT INTO knowledge_chunks
             (workspace_id, knowledge_base_id, file_id, chunk_index, content,
              token_estimate, embedding, embedding_model, embedding_dims, metadata)
           VALUES ($1,$2,$3,$4,$5,$6,$7::real[],$8,$9,$10::jsonb)
           ON CONFLICT (file_id, chunk_index) DO UPDATE SET
             content = EXCLUDED.content,
             embedding = EXCLUDED.embedding,
             embedding_model = EXCLUDED.embedding_model,
             embedding_dims = EXCLUDED.embedding_dims,
             metadata = EXCLUDED.metadata`,
          [
            c.workspaceId,
            c.knowledgeBaseId,
            c.fileId,
            c.chunkIndex,
            c.content,
            c.tokenEstimate,
            c.embedding,
            c.embeddingModel,
            c.embeddingDims,
            JSON.stringify(c.metadata || {}),
          ]
        );
        inserted++;
      }
      await client.query("COMMIT");
      return inserted;
    } catch (err) {
      try { await client.query("ROLLBACK"); } catch { /* ignore */ }
      throw err;
    } finally {
      client.release();
    }
  },

  async deleteByFile(fileId: string): Promise<number> {
    const r = await pool.query(`DELETE FROM knowledge_chunks WHERE file_id = $1`, [fileId]);
    return r.rowCount ?? 0;
  },

  async countByKb(kbId: string): Promise<{ chunks: number; vectors: number }> {
    const r = await pool.query(
      `SELECT COUNT(*)::int AS chunks,
              COUNT(*) FILTER (WHERE embedding IS NOT NULL)::int AS vectors
       FROM knowledge_chunks WHERE knowledge_base_id = $1`,
      [kbId]
    );
    return { chunks: r.rows[0]?.chunks || 0, vectors: r.rows[0]?.vectors || 0 };
  },

  /**
   * Similarity search — pull candidate chunks (workspace + KB filter),
   * compute cosine similarity in Node, return the top `topK` sorted.
   *
   * The workspace filter is enforced at the SQL layer so no cross-tenant
   * leak is possible. The KB filter accepts an array so callers can
   * combine multiple KBs into a single retrieval.
   */
  async similaritySearch(input: {
    workspaceId: string;
    knowledgeBaseIds: string[];
    queryEmbedding: number[];
    topK?: number;
    minScore?: number;
  }): Promise<KnowledgeChunkHit[]> {
    if (!input.knowledgeBaseIds.length || !input.queryEmbedding.length) return [];
    const topK = Math.max(1, Math.min(50, input.topK ?? 6));
    const minScore = input.minScore ?? 0;
    const r = await pool.query(
      `SELECT c.*, f.file_name AS _file_name, kb.name AS _kb_name
       FROM knowledge_chunks c
         JOIN knowledge_files  f  ON f.id  = c.file_id
         JOIN knowledge_bases  kb ON kb.id = c.knowledge_base_id
       WHERE c.workspace_id = $1
         AND c.knowledge_base_id = ANY($2::uuid[])
         AND c.embedding IS NOT NULL
         AND f.deleted_at IS NULL
         AND kb.deleted_at IS NULL`,
      [input.workspaceId, input.knowledgeBaseIds]
    );
    const scored: KnowledgeChunkHit[] = [];
    for (const row of r.rows) {
      const c = mapRow(row);
      if (!c.embedding) continue;
      const score = cosine(input.queryEmbedding, c.embedding);
      if (score < minScore) continue;
      scored.push({ ...c, score, fileName: row._file_name, kbName: row._kb_name });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  },
};
