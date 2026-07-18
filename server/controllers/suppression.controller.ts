/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Response } from "express";
import { suppressionRepository } from "../db/repositories";
import { suppressionCacheService } from "../services/suppressionCache.service";
import { WorkspaceScopedRequest } from "../middleware/workspaceContext.middleware";
import { logAudit } from "../services/db.service";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class SuppressionController {
  public static async list(req: WorkspaceScopedRequest, res: Response): Promise<void> {
    const limit = Math.min(1000, parseInt((req.query.limit as string) || "500", 10));
    const data = await suppressionRepository.list(req.workspaceId!, limit);
    res.json({ success: true, data });
  }

  public static async add(req: WorkspaceScopedRequest, res: Response): Promise<void> {
    const { email, reason, notes } = req.body || {};
    if (!EMAIL_REGEX.test(email || "")) {
      res.status(400).json({ success: false, error: "valid email required." });
      return;
    }
    const finalReason = reason && ["bounce", "complaint", "unsubscribe", "manual"].includes(reason) ? reason : "manual";
    const s = await suppressionRepository.add({
      workspaceId: req.workspaceId!,
      email,
      reason: finalReason as any,
      source: `admin:${req.user?.email || "unknown"}`,
      notes,
    });
    // Invalidate the Redis cache immediately.
    await suppressionCacheService.invalidateAdd(email, req.workspaceId!);
    await logAudit(`Suppressed ${email} (${finalReason})`, "SECURITY", {
      userId: req.user?.id, userEmail: req.user?.email, ipAddress: req.ip,
    });
    res.status(201).json({ success: true, suppression: s });
  }

  public static async remove(req: WorkspaceScopedRequest, res: Response): Promise<void> {
    const { email } = req.params;
    const ok = await suppressionRepository.remove(email, req.workspaceId!);
    if (!ok) { res.status(404).json({ success: false, error: "not on list" }); return; }
    await suppressionCacheService.invalidateRemove(email, req.workspaceId!);
    await logAudit(`Unsuppressed ${email}`, "SECURITY", {
      userId: req.user?.id, userEmail: req.user?.email, ipAddress: req.ip,
    });
    res.json({ success: true });
  }
}
