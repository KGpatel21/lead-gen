/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Knowledge Base service — orchestrator that stitches every layer
 * together:
 *
 *   file upload   → textExtractionService
 *   text          → chunkingService
 *   chunks        → embedding provider (via factory)
 *   chunks+vecs   → knowledgeChunkRepository.bulkInsert
 *   query         → embed the query → knowledgeChunkRepository.similaritySearch
 *
 * Every method is workspace-scoped. Errors are non-fatal per file —
 * one bad upload never poisons the KB; the failing file's status is set
 * to ERROR with the message, and the rest continue.
 */

import crypto from "crypto";
import {
  knowledgeBaseRepository,
  KnowledgeBase,
} from "../db/repositories/knowledgeBase.repository";
import { knowledgeFileRepository } from "../db/repositories/knowledgeFile.repository";
import { knowledgeChunkRepository, KnowledgeChunkHit } from "../db/repositories/knowledgeChunk.repository";
import { textExtractionService, ExtractionError, normaliseMime, SUPPORTED_EXTENSIONS } from "./textExtraction.service";
import { chunkingService } from "./chunking.service";
import { getEmbeddingProvider } from "../ai/embedding/factory";
import { log } from "../observability/logger";

export interface UploadFileInput {
  kbId: string;
  workspaceId: string;
  fileName: string;
  mimeType: string | undefined;
  buffer: Buffer;
  uploadedBy?: string;
}

export interface UploadResult {
  fileId: string;
  status: "READY" | "ERROR" | "DUPLICATE";
  chunks: number;
  vectors: number;
  errorMessage?: string;
}

async function embedInBatches(
  provider: ReturnType<typeof getEmbeddingProvider>,
  chunks: string[],
  model: string | undefined,
  batchSize = 32
): Promise<{ vectors: number[][]; dims: number; model: string }> {
  const out: number[][] = [];
  let effectiveModel = model || provider.defaultModel;
  let dims = 0;
  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const result = await provider.embed({ inputs: batch, model });
    out.push(...result.vectors);
    effectiveModel = result.model;
    dims = result.dims;
  }
  return { vectors: out, dims, model: effectiveModel };
}

export const knowledgeBaseService = {
  /** List every KB in the workspace. */
  list(workspaceId: string) {
    return knowledgeBaseRepository.list(workspaceId);
  },

  get(id: string, workspaceId: string) {
    return knowledgeBaseRepository.findById(id, workspaceId);
  },

  create(input: {
    workspaceId: string;
    name: string;
    description?: string;
    tags?: string[];
    embeddingProvider?: string;
    embeddingModel?: string;
    chunkSize?: number;
    chunkOverlap?: number;
    createdBy?: string;
  }) {
    // If the caller picks a provider but doesn't name a model, use that
    // provider's default. Prevents the classic "openai default model on a
    // gemini KB → embedContent 404" bug.
    let embeddingModel = input.embeddingModel;
    if (input.embeddingProvider && !embeddingModel) {
      try {
        embeddingModel = getEmbeddingProvider(input.embeddingProvider).defaultModel;
      } catch { /* unknown provider — the repo default will be used */ }
    }
    return knowledgeBaseRepository.create({ ...input, embeddingModel });
  },

  update(id: string, workspaceId: string, patch: Parameters<typeof knowledgeBaseRepository.update>[1]) {
    return knowledgeBaseRepository.update(id, patch, workspaceId);
  },

  async delete(id: string, workspaceId: string): Promise<boolean> {
    const ok = await knowledgeBaseRepository.softDelete(id, workspaceId);
    return ok;
  },

  listFiles(kbId: string, workspaceId: string) {
    return knowledgeFileRepository.listByKb(kbId, workspaceId);
  },

  async deleteFile(fileId: string, workspaceId: string): Promise<boolean> {
    const file = await knowledgeFileRepository.findById(fileId, workspaceId);
    if (!file) return false;
    const ok = await knowledgeFileRepository.softDelete(fileId, workspaceId);
    if (ok) {
      await knowledgeChunkRepository.deleteByFile(fileId);
      await knowledgeBaseRepository.recomputeStats(file.knowledgeBaseId);
    }
    return ok;
  },

  /**
   * Upload → extract → chunk → embed → persist. Idempotent on the
   * (kb, content_hash) pair — re-uploading the same bytes returns
   * `DUPLICATE` and does not re-embed.
   */
  async uploadFile(input: UploadFileInput): Promise<UploadResult> {
    const kb = await knowledgeBaseRepository.findById(input.kbId, input.workspaceId);
    if (!kb) throw new Error(`Knowledge base ${input.kbId} not found`);
    if (kb.deletedAt) throw new Error(`Knowledge base ${input.kbId} is deleted`);

    const contentHash = crypto.createHash("sha256").update(input.buffer).digest("hex");
    const existing = await knowledgeFileRepository.findByHash(kb.id, contentHash);
    if (existing) {
      return {
        fileId: existing.id,
        status: "DUPLICATE",
        chunks: existing.chunkCount,
        vectors: existing.vectorCount,
      };
    }

    const mime = normaliseMime(input.fileName, input.mimeType);
    const file = await knowledgeFileRepository.create({
      workspaceId: input.workspaceId,
      knowledgeBaseId: kb.id,
      fileName: input.fileName,
      mimeType: mime,
      fileSize: input.buffer.length,
      contentHash,
      uploadedBy: input.uploadedBy,
    });

    await knowledgeBaseRepository.setStatus(kb.id, "INDEXING");

    try {
      // ---- extract ----
      await knowledgeFileRepository.setStatus(file.id, "EXTRACTING");
      const extracted = await textExtractionService.extract(input.buffer, input.fileName, mime);
      await knowledgeFileRepository.setExtracted(file.id, extracted.text);

      // ---- chunk ----
      const chunks = chunkingService.chunk(extracted.text, {
        size: kb.chunkSize,
        overlap: kb.chunkOverlap,
      });

      if (chunks.length === 0) {
        await knowledgeFileRepository.setIndexed(file.id, 0, 0);
        await knowledgeBaseRepository.recomputeStats(kb.id);
        await knowledgeBaseRepository.setStatus(kb.id, "READY");
        return { fileId: file.id, status: "READY", chunks: 0, vectors: 0 };
      }

      // ---- embed ----
      await knowledgeFileRepository.setStatus(file.id, "EMBEDDING");
      const provider = getEmbeddingProvider(kb.embeddingProvider);
      const { vectors, dims, model } = await embedInBatches(
        provider,
        chunks.map((c) => c.content),
        kb.embeddingModel
      );

      // ---- persist ----
      await knowledgeChunkRepository.bulkInsert(
        chunks.map((c, i) => ({
          workspaceId: input.workspaceId,
          knowledgeBaseId: kb.id,
          fileId: file.id,
          chunkIndex: c.index,
          content: c.content,
          tokenEstimate: c.tokenEstimate,
          embedding: vectors[i],
          embeddingModel: model,
          embeddingDims: dims,
          metadata: { ...(extracted.meta || {}), fileName: input.fileName },
        }))
      );

      await knowledgeFileRepository.setIndexed(file.id, chunks.length, vectors.length);
      await knowledgeBaseRepository.recomputeStats(kb.id);
      await knowledgeBaseRepository.setStatus(kb.id, "READY");
      log.info(
        { fileId: file.id, kbId: kb.id, chunks: chunks.length, model, dims },
        "kb: file indexed"
      );
      return { fileId: file.id, status: "READY", chunks: chunks.length, vectors: vectors.length };
    } catch (err: any) {
      const message = err instanceof ExtractionError
        ? err.message
        : err?.message || "indexing failed";
      log.warn({ fileId: file.id, kbId: kb.id, err: message }, "kb: file indexing failed");
      await knowledgeFileRepository.setStatus(file.id, "ERROR", message);
      await knowledgeBaseRepository.recomputeStats(kb.id);
      // Leave KB status as INDEXING or set to ERROR only if every file is bad;
      // rest of upload flow is unaffected.
      return { fileId: file.id, status: "ERROR", chunks: 0, vectors: 0, errorMessage: message };
    }
  },

  /**
   * RAG retrieval — embed the query with the (first) KB's configured
   * provider, then similarity-search across every requested KB. Returns
   * the top-K chunks sorted by cosine similarity.
   */
  async retrieveContext(input: {
    workspaceId: string;
    knowledgeBaseIds: string[];
    query: string;
    topK?: number;
    minScore?: number;
  }): Promise<KnowledgeChunkHit[]> {
    if (!input.knowledgeBaseIds.length || !input.query?.trim()) return [];
    const kbs: KnowledgeBase[] = [];
    for (const id of input.knowledgeBaseIds) {
      const kb = await knowledgeBaseRepository.findById(id, input.workspaceId);
      if (kb && !kb.deletedAt) kbs.push(kb);
    }
    if (kbs.length === 0) return [];

    // Use the FIRST KB's embedding provider to embed the query. All KBs in
    // a single retrieval SHOULD share the same provider — if they don't,
    // the vector spaces are incompatible and results will be poor. The UI
    // warns about this at selection time.
    const provider = getEmbeddingProvider(kbs[0].embeddingProvider);
    const { vectors } = await provider.embed({
      inputs: [input.query.trim().slice(0, 8000)],
      model: kbs[0].embeddingModel,
    });
    if (!vectors[0]?.length) return [];
    return knowledgeChunkRepository.similaritySearch({
      workspaceId: input.workspaceId,
      knowledgeBaseIds: kbs.map((k) => k.id),
      queryEmbedding: vectors[0],
      topK: input.topK,
      minScore: input.minScore,
    });
  },

  /** Compact human-readable snippet joined for LLM injection. */
  buildContextText(hits: KnowledgeChunkHit[], maxChars = 6000): string {
    if (hits.length === 0) return "";
    const parts: string[] = [];
    let total = 0;
    for (const h of hits) {
      const tag = h.kbName || "kb";
      const src = h.fileName ? ` (source: ${h.fileName})` : "";
      const block = `[${tag}${src}]\n${h.content.trim()}`;
      if (total + block.length > maxChars) break;
      parts.push(block);
      total += block.length;
    }
    return parts.join("\n\n---\n\n");
  },

  /** Static reference — used by the UI to show supported extensions. */
  supportedExtensions(): string[] {
    return SUPPORTED_EXTENSIONS;
  },
};
