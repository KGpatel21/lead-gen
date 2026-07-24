/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Knowledge Base HTTP surface — CRUD for KBs + file upload + list files
 * + delete file + vector search. Workspace-scoped through
 * WorkspaceScopedRequest.
 *
 * File uploads use `multer` in memory mode: the file lives in a Buffer
 * only long enough to extract + chunk + embed, then the raw bytes are
 * discarded (we keep the extracted text on disk in Postgres, not the
 * original file — reduces PII surface and storage cost).
 */

import { Response } from "express";
import multer from "multer";
import { WorkspaceScopedRequest } from "../middleware/workspaceContext.middleware";
import { knowledgeBaseService } from "../services/knowledgeBase.service";
import { knowledgeBaseRepository } from "../db/repositories/knowledgeBase.repository";
import { listEmbeddingProviders } from "../ai/embedding/factory";
import { logAudit } from "../services/db.service";

const UPLOAD_LIMITS = {
  fileSize: 25 * 1024 * 1024, // 25 MB per file
  files: 20,
};
export const knowledgeUpload = multer({
  storage: multer.memoryStorage(),
  limits: UPLOAD_LIMITS,
});

function bad(res: Response, msg: string, code = 400) {
  res.status(code).json({ success: false, error: msg });
}

export class KnowledgeBaseController {
  // -------- Provider catalogue --------
  public static async providers(_req: WorkspaceScopedRequest, res: Response): Promise<void> {
    res.json({ success: true, providers: listEmbeddingProviders() });
  }

  // -------- KB CRUD --------
  public static async list(req: WorkspaceScopedRequest, res: Response): Promise<void> {
    const list = await knowledgeBaseService.list(req.workspaceId!);
    res.json({ success: true, knowledgeBases: list });
  }

  public static async get(req: WorkspaceScopedRequest, res: Response): Promise<void> {
    const kb = await knowledgeBaseService.get(req.params.id, req.workspaceId!);
    if (!kb) { bad(res, "knowledge base not found", 404); return; }
    res.json({ success: true, knowledgeBase: kb });
  }

  public static async create(req: WorkspaceScopedRequest, res: Response): Promise<void> {
    const { name, description, tags, embeddingProvider, embeddingModel, chunkSize, chunkOverlap } = req.body || {};
    if (typeof name !== "string" || name.trim().length < 1) { bad(res, "name required"); return; }
    const kb = await knowledgeBaseService.create({
      workspaceId: req.workspaceId!,
      name: name.trim(),
      description: typeof description === "string" ? description.trim() : undefined,
      tags: Array.isArray(tags) ? tags.filter((t) => typeof t === "string") : undefined,
      embeddingProvider,
      embeddingModel,
      chunkSize,
      chunkOverlap,
      createdBy: req.user?.id,
    });
    await logAudit(`KB created: ${kb.name}`, "SECURITY", {
      userId: req.user?.id, userEmail: req.user?.email, details: kb.id,
    });
    res.status(201).json({ success: true, knowledgeBase: kb });
  }

  public static async update(req: WorkspaceScopedRequest, res: Response): Promise<void> {
    const kb = await knowledgeBaseService.update(req.params.id, req.workspaceId!, req.body || {});
    if (!kb) { bad(res, "knowledge base not found", 404); return; }
    res.json({ success: true, knowledgeBase: kb });
  }

  public static async remove(req: WorkspaceScopedRequest, res: Response): Promise<void> {
    const ok = await knowledgeBaseService.delete(req.params.id, req.workspaceId!);
    if (!ok) { bad(res, "knowledge base not found", 404); return; }
    res.json({ success: true });
  }

  // -------- Files --------
  public static async listFiles(req: WorkspaceScopedRequest, res: Response): Promise<void> {
    const files = await knowledgeBaseService.listFiles(req.params.id, req.workspaceId!);
    res.json({ success: true, files });
  }

  public static async uploadFile(req: WorkspaceScopedRequest, res: Response): Promise<void> {
    const files = (req as any).files as Express.Multer.File[] | undefined;
    const single = (req as any).file as Express.Multer.File | undefined;
    const uploads = files && files.length > 0 ? files : (single ? [single] : []);
    if (uploads.length === 0) { bad(res, "no file uploaded"); return; }

    const results = [];
    for (const f of uploads) {
      try {
        const result = await knowledgeBaseService.uploadFile({
          kbId: req.params.id,
          workspaceId: req.workspaceId!,
          fileName: f.originalname,
          mimeType: f.mimetype,
          buffer: f.buffer,
          uploadedBy: req.user?.id,
        });
        results.push({ fileName: f.originalname, ...result });
      } catch (err: any) {
        results.push({ fileName: f.originalname, status: "ERROR", chunks: 0, vectors: 0, errorMessage: err?.message || "upload failed" });
      }
    }
    const kb = await knowledgeBaseRepository.findById(req.params.id, req.workspaceId!);
    res.status(201).json({ success: true, uploads: results, knowledgeBase: kb });
  }

  public static async deleteFile(req: WorkspaceScopedRequest, res: Response): Promise<void> {
    const ok = await knowledgeBaseService.deleteFile(req.params.fileId, req.workspaceId!);
    if (!ok) { bad(res, "file not found", 404); return; }
    res.json({ success: true });
  }

  // -------- Search / RAG --------
  public static async search(req: WorkspaceScopedRequest, res: Response): Promise<void> {
    const { query, knowledgeBaseIds, topK, minScore } = req.body || {};
    if (typeof query !== "string" || !query.trim()) { bad(res, "query required"); return; }
    const ids = Array.isArray(knowledgeBaseIds) && knowledgeBaseIds.length > 0
      ? knowledgeBaseIds
      : [req.params.id].filter(Boolean);
    if (ids.length === 0) { bad(res, "knowledgeBaseIds required"); return; }
    try {
      const hits = await knowledgeBaseService.retrieveContext({
        workspaceId: req.workspaceId!,
        knowledgeBaseIds: ids,
        query,
        topK: typeof topK === "number" ? topK : undefined,
        minScore: typeof minScore === "number" ? minScore : undefined,
      });
      const context = knowledgeBaseService.buildContextText(hits);
      res.json({ success: true, hits, context });
    } catch (err: any) {
      bad(res, err?.message || "search failed", 500);
    }
  }
}
