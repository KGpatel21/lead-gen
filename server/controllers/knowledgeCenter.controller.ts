/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Knowledge Center HTTP surface — signatures, email templates,
 * prompt library, campaign resource assignment, and admin usage
 * statistics.
 *
 * The KnowledgeBase (KB + files) surface lives in
 * knowledgeBase.controller.ts because it needs multer for uploads.
 * Everything else is regular JSON.
 */

import { Response } from "express";
import { WorkspaceScopedRequest } from "../middleware/workspaceContext.middleware";
import { signatureRepository } from "../db/repositories/signature.repository";
import { emailTemplateV2Repository } from "../db/repositories/emailTemplateV2.repository";
import { promptRepository } from "../db/repositories/prompt.repository";
import { campaignResourceRepository } from "../db/repositories/campaignResource.repository";
import { campaignRepository } from "../db/repositories";
import { pool } from "../db/pool";
import { logAudit } from "../services/db.service";

function bad(res: Response, msg: string, code = 400) {
  res.status(code).json({ success: false, error: msg });
}

// =============================================================================
// Signatures
// =============================================================================
export class SignatureController {
  public static async list(req: WorkspaceScopedRequest, res: Response): Promise<void> {
    res.json({ success: true, signatures: await signatureRepository.list(req.workspaceId!) });
  }
  public static async get(req: WorkspaceScopedRequest, res: Response): Promise<void> {
    const sig = await signatureRepository.findById(req.params.id, req.workspaceId!);
    if (!sig) { bad(res, "signature not found", 404); return; }
    res.json({ success: true, signature: sig });
  }
  public static async create(req: WorkspaceScopedRequest, res: Response): Promise<void> {
    const b = req.body || {};
    if (!b.name || !b.htmlBody || !b.textBody) { bad(res, "name, htmlBody, textBody required"); return; }
    const sig = await signatureRepository.create({
      workspaceId: req.workspaceId!,
      name: b.name.trim(),
      role: b.role, title: b.title, company: b.company, website: b.website,
      phone: b.phone, linkedin: b.linkedin, address: b.address, logoUrl: b.logoUrl,
      social: b.social || {}, disclaimer: b.disclaimer,
      htmlBody: b.htmlBody, textBody: b.textBody,
      isDefault: !!b.isDefault,
      createdBy: req.user?.id,
    });
    await logAudit(`Signature created: ${sig.name}`, "SECURITY", { userId: req.user?.id });
    res.status(201).json({ success: true, signature: sig });
  }
  public static async update(req: WorkspaceScopedRequest, res: Response): Promise<void> {
    const sig = await signatureRepository.update(req.params.id, req.workspaceId!, req.body || {});
    if (!sig) { bad(res, "signature not found", 404); return; }
    res.json({ success: true, signature: sig });
  }
  public static async remove(req: WorkspaceScopedRequest, res: Response): Promise<void> {
    const ok = await signatureRepository.softDelete(req.params.id, req.workspaceId!);
    if (!ok) { bad(res, "signature not found", 404); return; }
    res.json({ success: true });
  }
  public static async versions(req: WorkspaceScopedRequest, res: Response): Promise<void> {
    res.json({ success: true, versions: await signatureRepository.listVersions(req.params.id, req.workspaceId!) });
  }
  public static async preview(req: WorkspaceScopedRequest, res: Response): Promise<void> {
    const sig = await signatureRepository.findById(req.params.id, req.workspaceId!);
    if (!sig) { bad(res, "signature not found", 404); return; }
    res.json({ success: true, html: sig.htmlBody, text: sig.textBody });
  }
}

// =============================================================================
// Email Templates (V2 — enterprise)
// =============================================================================
export class EmailTemplateV2Controller {
  public static async list(req: WorkspaceScopedRequest, res: Response): Promise<void> {
    const { category, tag } = req.query as Record<string, string | undefined>;
    res.json({
      success: true,
      templates: await emailTemplateV2Repository.list(req.workspaceId!, category, tag),
    });
  }
  public static async get(req: WorkspaceScopedRequest, res: Response): Promise<void> {
    const t = await emailTemplateV2Repository.findById(req.params.id, req.workspaceId!);
    if (!t) { bad(res, "template not found", 404); return; }
    res.json({ success: true, template: t });
  }
  public static async create(req: WorkspaceScopedRequest, res: Response): Promise<void> {
    const b = req.body || {};
    if (!b.name || !b.subject || !b.htmlBody || !b.textBody) {
      bad(res, "name, subject, htmlBody, textBody required"); return;
    }
    const t = await emailTemplateV2Repository.create({
      workspaceId: req.workspaceId!,
      name: b.name.trim(),
      description: b.description,
      category: b.category || "General",
      tags: Array.isArray(b.tags) ? b.tags : [],
      subject: b.subject,
      htmlBody: b.htmlBody,
      textBody: b.textBody,
      mjmlSource: b.mjmlSource,
      variables: Array.isArray(b.variables) ? b.variables : [],
      createdBy: req.user?.id,
    });
    res.status(201).json({ success: true, template: t });
  }
  public static async update(req: WorkspaceScopedRequest, res: Response): Promise<void> {
    const t = await emailTemplateV2Repository.update(req.params.id, req.workspaceId!, req.body || {});
    if (!t) { bad(res, "template not found", 404); return; }
    res.json({ success: true, template: t });
  }
  public static async duplicate(req: WorkspaceScopedRequest, res: Response): Promise<void> {
    const t = await emailTemplateV2Repository.duplicate(req.params.id, req.workspaceId!, (req.body || {}).name);
    if (!t) { bad(res, "template not found", 404); return; }
    res.status(201).json({ success: true, template: t });
  }
  public static async remove(req: WorkspaceScopedRequest, res: Response): Promise<void> {
    const ok = await emailTemplateV2Repository.softDelete(req.params.id, req.workspaceId!);
    if (!ok) { bad(res, "template not found", 404); return; }
    res.json({ success: true });
  }
  public static async preview(req: WorkspaceScopedRequest, res: Response): Promise<void> {
    const t = await emailTemplateV2Repository.findById(req.params.id, req.workspaceId!);
    if (!t) { bad(res, "template not found", 404); return; }
    const vars = (req.body?.vars || {}) as Record<string, string>;
    const substitute = (s: string) => s.replace(/\{\{(\w+)\}\}/g, (_m, k) => (vars[k] ?? ""));
    res.json({
      success: true,
      preview: {
        subject: substitute(t.subject),
        html: substitute(t.htmlBody),
        text: substitute(t.textBody),
      },
    });
  }
}

// =============================================================================
// Prompt Library
// =============================================================================
export class PromptController {
  public static async list(req: WorkspaceScopedRequest, res: Response): Promise<void> {
    const { category } = req.query as Record<string, string | undefined>;
    res.json({ success: true, prompts: await promptRepository.list(req.workspaceId!, category) });
  }
  public static async get(req: WorkspaceScopedRequest, res: Response): Promise<void> {
    const p = await promptRepository.findById(req.params.id, req.workspaceId!);
    if (!p) { bad(res, "prompt not found", 404); return; }
    res.json({ success: true, prompt: p });
  }
  public static async create(req: WorkspaceScopedRequest, res: Response): Promise<void> {
    const b = req.body || {};
    if (!b.name || !b.userPrompt) { bad(res, "name and userPrompt required"); return; }
    const p = await promptRepository.create({
      workspaceId: req.workspaceId!,
      name: b.name.trim(),
      description: b.description,
      category: b.category || "General",
      tags: Array.isArray(b.tags) ? b.tags : [],
      systemPrompt: b.systemPrompt,
      userPrompt: b.userPrompt,
      aiModel: b.aiModel,
      temperature: typeof b.temperature === "number" ? b.temperature : 0.7,
      variables: Array.isArray(b.variables) ? b.variables : [],
      createdBy: req.user?.id,
    });
    res.status(201).json({ success: true, prompt: p });
  }
  public static async update(req: WorkspaceScopedRequest, res: Response): Promise<void> {
    const p = await promptRepository.update(req.params.id, req.workspaceId!, req.body || {});
    if (!p) { bad(res, "prompt not found", 404); return; }
    res.json({ success: true, prompt: p });
  }
  public static async duplicate(req: WorkspaceScopedRequest, res: Response): Promise<void> {
    const p = await promptRepository.duplicate(req.params.id, req.workspaceId!, (req.body || {}).name);
    if (!p) { bad(res, "prompt not found", 404); return; }
    res.status(201).json({ success: true, prompt: p });
  }
  public static async remove(req: WorkspaceScopedRequest, res: Response): Promise<void> {
    const ok = await promptRepository.softDelete(req.params.id, req.workspaceId!);
    if (!ok) { bad(res, "prompt not found", 404); return; }
    res.json({ success: true });
  }
}

// =============================================================================
// Campaign Resource Selector
// =============================================================================
export class CampaignResourceController {
  public static async get(req: WorkspaceScopedRequest, res: Response): Promise<void> {
    const camp = await campaignRepository.findById(req.params.id, req.workspaceId!);
    if (!camp) { bad(res, "campaign not found", 404); return; }
    const selection = await campaignResourceRepository.getSelection(camp.id, req.workspaceId!);
    res.json({ success: true, selection });
  }
  public static async setKbs(req: WorkspaceScopedRequest, res: Response): Promise<void> {
    const ids = Array.isArray(req.body?.knowledgeBaseIds) ? req.body.knowledgeBaseIds : [];
    await campaignResourceRepository.setKbs(req.params.id, req.workspaceId!, ids);
    res.json({ success: true, knowledgeBaseIds: ids });
  }
  public static async setTemplates(req: WorkspaceScopedRequest, res: Response): Promise<void> {
    const entries = Array.isArray(req.body?.templates)
      ? req.body.templates
          .filter((e: any) => e && typeof e.templateId === "string")
          .map((e: any) => ({ templateId: e.templateId, stepIndex: typeof e.stepIndex === "number" ? e.stepIndex : null }))
      : [];
    await campaignResourceRepository.setTemplates(req.params.id, req.workspaceId!, entries);
    res.json({ success: true, templates: entries });
  }
  public static async setSignatures(req: WorkspaceScopedRequest, res: Response): Promise<void> {
    const ids: string[] = Array.isArray(req.body?.signatureIds) ? req.body.signatureIds : [];
    const primary: string | null = req.body?.primarySignatureId || (ids[0] ?? null);
    await campaignResourceRepository.setSignatures(req.params.id, req.workspaceId!, ids, primary);
    res.json({ success: true, signatureIds: ids, primarySignatureId: primary });
  }
  public static async setPrompts(req: WorkspaceScopedRequest, res: Response): Promise<void> {
    const entries = Array.isArray(req.body?.prompts)
      ? req.body.prompts
          .filter((e: any) => e && typeof e.promptId === "string")
          .map((e: any) => ({ promptId: e.promptId, stepIndex: typeof e.stepIndex === "number" ? e.stepIndex : null }))
      : [];
    await campaignResourceRepository.setPrompts(req.params.id, req.workspaceId!, entries);
    res.json({ success: true, prompts: entries });
  }
}

// =============================================================================
// Admin — Knowledge Center usage stats (workspace-scoped)
// =============================================================================
export class KnowledgeAdminController {
  public static async dashboard(req: WorkspaceScopedRequest, res: Response): Promise<void> {
    const ws = req.workspaceId!;
    const [kb, files, chunks, tpls, sigs, prompts, campaigns] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int AS n, COALESCE(SUM(storage_bytes),0)::bigint AS bytes
         FROM knowledge_bases WHERE workspace_id = $1 AND deleted_at IS NULL`, [ws]),
      pool.query(
        `SELECT status, COUNT(*)::int AS n FROM knowledge_files
         WHERE workspace_id = $1 AND deleted_at IS NULL GROUP BY status`, [ws]),
      pool.query(
        `SELECT COUNT(*)::int AS chunks,
                COUNT(*) FILTER (WHERE embedding IS NOT NULL)::int AS vectors,
                COALESCE(SUM(token_estimate),0)::int AS tokens
         FROM knowledge_chunks WHERE workspace_id = $1`, [ws]),
      pool.query(`SELECT COUNT(*)::int AS n FROM email_templates  WHERE workspace_id = $1 AND deleted_at IS NULL`, [ws]),
      pool.query(`SELECT COUNT(*)::int AS n FROM signatures       WHERE workspace_id = $1 AND deleted_at IS NULL`, [ws]),
      pool.query(`SELECT COUNT(*)::int AS n FROM prompt_library    WHERE workspace_id = $1 AND deleted_at IS NULL`, [ws]),
      pool.query(
        `SELECT
           (SELECT COUNT(*)::int FROM campaign_knowledge_bases WHERE workspace_id = $1) AS kb_assigns,
           (SELECT COUNT(*)::int FROM campaign_email_templates WHERE workspace_id = $1) AS tpl_assigns,
           (SELECT COUNT(*)::int FROM campaign_signatures      WHERE workspace_id = $1) AS sig_assigns,
           (SELECT COUNT(*)::int FROM campaign_prompts         WHERE workspace_id = $1) AS prompt_assigns`,
        [ws]),
    ]);
    const filesByStatus: Record<string, number> = {};
    for (const row of files.rows) filesByStatus[row.status] = row.n;
    res.json({
      success: true,
      stats: {
        knowledgeBases: kb.rows[0]?.n || 0,
        storageBytes: Number(kb.rows[0]?.bytes || 0),
        files: filesByStatus,
        chunks: chunks.rows[0]?.chunks || 0,
        vectors: chunks.rows[0]?.vectors || 0,
        tokenEstimate: chunks.rows[0]?.tokens || 0,
        emailTemplates: tpls.rows[0]?.n || 0,
        signatures: sigs.rows[0]?.n || 0,
        prompts: prompts.rows[0]?.n || 0,
        campaignAssignments: campaigns.rows[0] || {},
      },
    });
  }
}
