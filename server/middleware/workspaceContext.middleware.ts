/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Resolves the current request's workspace_id from the JWT payload,
 * falls back to the user's default workspace, and attaches it to
 * `req.workspaceId`. Repositories rely on this. Runs AFTER `authenticateJwt`.
 */

import { Response, NextFunction } from "express";
import { AuthenticatedRequest } from "./auth.middleware";
import { workspaceRepository } from "../db/repositories/workspace.repository";
import { userRepository } from "../db/repositories";
import { log } from "../observability/logger";

export interface WorkspaceScopedRequest extends AuthenticatedRequest {
  workspaceId?: string;
}

export async function workspaceContextMiddleware(
  req: WorkspaceScopedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!req.user) {
    res.status(401).json({ success: false, error: "Authentication required." });
    return;
  }

  // Prefer explicit workspaceId in the JWT payload; otherwise resolve.
  let workspaceId: string | undefined = (req.user as any).workspaceId;

  if (!workspaceId) {
    const user = await userRepository.findById(req.user.id);
    workspaceId = (user as any)?.workspaceId;
    if (!workspaceId) {
      const ws = await workspaceRepository.findByUserId(req.user.id);
      workspaceId = ws[0]?.id;
    }
    if (!workspaceId) {
      const def = await workspaceRepository.getDefault();
      workspaceId = def?.id;
    }
  }

  if (!workspaceId) {
    log.error({ userId: req.user.id }, "user has no workspace");
    res.status(500).json({ success: false, error: "User has no workspace assigned. Contact support." });
    return;
  }

  // Optional header override — but only if the user is actually a member.
  const headerOverride = req.header("X-Workspace-Id");
  if (headerOverride && headerOverride !== workspaceId) {
    const ok = await workspaceRepository.isMember(headerOverride, req.user.id);
    if (!ok) {
      res.status(403).json({ success: false, error: "You are not a member of that workspace." });
      return;
    }
    workspaceId = headerOverride;
  }

  req.workspaceId = workspaceId;
  next();
}
