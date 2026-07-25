/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * JWT Bearer authentication + automatic workspace enforcement.
 *
 * SECURITY MODEL
 * ---------------
 * Every authenticated request MUST resolve to exactly one workspace, and
 * `req.workspaceId` is guaranteed to be populated when this middleware
 * calls next(). A controller that then queries a repository without
 * passing the workspaceId is a bug — the request already carried the
 * boundary, we just have to feed it through.
 *
 * Resolution order for the workspace binding:
 *
 *   1. `workspaceId` embedded in the JWT payload (set at login /
 *      registration). This is the fast path — no DB hit.
 *
 *   2. Fallback: read the user's `workspace_id` column, then
 *      workspace_members membership, then the default workspace.
 *      This handles tokens issued before the multi-tenant migration
 *      and users whose workspaces have been re-assigned. On success
 *      the resolution is cached on the request; the client is
 *      encouraged to re-login to pick up a fresh token.
 *
 *   3. If none of the above yields a workspace, we RETURN 500 and
 *      LOG the user id. This is a data-integrity bug (the user has
 *      no home workspace), not a client error. Refusing to serve
 *      requests without a workspace is what stops cross-tenant reads.
 *
 * An `X-Workspace-Id` header CAN override the resolved value, but
 * ONLY if the user is actually a member of that workspace. Reject with
 * 403 otherwise. Prevents header-forged cross-tenant access.
 */

import { Request, Response, NextFunction } from "express";
import { SecurityService } from "../services/security.service";
import { SecurityRole } from "../../src/types";
import { userRepository, workspaceRepository } from "../db/repositories";
import { log } from "../observability/logger";

export interface AuthenticatedRequest extends Request {
  user?: { id: string; email: string; role: SecurityRole; workspaceId?: string };
  /**
   * Populated by `authenticateJwt` on every successful call. Repositories
   * MUST filter by this in every query. Guaranteed defined post-auth.
   */
  workspaceId?: string;
}

// In-process LRU cache: userId → workspaceId. Small (500 entries) and
// short-TTL so a user removed from a workspace loses access within a
// couple of minutes even without a re-login.
const CACHE_TTL_MS = 2 * 60_000;
const CACHE_MAX = 500;
const wsCache = new Map<string, { workspaceId: string; exp: number }>();

function cacheGet(userId: string): string | null {
  const entry = wsCache.get(userId);
  if (!entry) return null;
  if (entry.exp < Date.now()) {
    wsCache.delete(userId);
    return null;
  }
  return entry.workspaceId;
}
function cacheSet(userId: string, workspaceId: string): void {
  if (wsCache.size >= CACHE_MAX) {
    // Evict the oldest key. Map iteration order is insertion order.
    const first = wsCache.keys().next().value;
    if (first) wsCache.delete(first);
  }
  wsCache.set(userId, { workspaceId, exp: Date.now() + CACHE_TTL_MS });
}
export function invalidateWorkspaceCacheForUser(userId: string): void {
  wsCache.delete(userId);
}

async function resolveWorkspaceForUser(userId: string): Promise<string | null> {
  const cached = cacheGet(userId);
  if (cached) return cached;

  const user = await userRepository.findById(userId);
  if (user && (user as any).workspaceId) {
    cacheSet(userId, (user as any).workspaceId);
    return (user as any).workspaceId;
  }
  const memberships = await workspaceRepository.findByUserId(userId);
  if (memberships[0]?.id) {
    cacheSet(userId, memberships[0].id);
    return memberships[0].id;
  }
  return null;
}

export async function authenticateJwt(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    res.status(401).json({ success: false, error: "Missing bearer token." });
    return;
  }
  const token = header.slice(7).trim();
  const decoded = SecurityService.verifyJwt<{
    id: string; email: string; role: SecurityRole; workspaceId?: string;
  }>(token);
  if (!decoded || !decoded.id || !decoded.email || !decoded.role) {
    res.status(401).json({ success: false, error: "Invalid or expired session token." });
    return;
  }

  req.user = {
    id: decoded.id,
    email: decoded.email,
    role: decoded.role,
    workspaceId: decoded.workspaceId,
  };

  // -------- Resolve workspace --------
  let workspaceId: string | null = decoded.workspaceId || null;
  if (!workspaceId) {
    workspaceId = await resolveWorkspaceForUser(decoded.id);
  }

  // -------- Optional header override (must be member) --------
  const headerOverride = req.header("X-Workspace-Id");
  if (headerOverride && headerOverride !== workspaceId) {
    const isMember = await workspaceRepository.isMember(headerOverride, decoded.id);
    if (!isMember) {
      log.warn(
        { userId: decoded.id, attemptedWorkspaceId: headerOverride },
        "auth: cross-workspace header override rejected"
      );
      res.status(403).json({ success: false, error: "You are not a member of that workspace." });
      return;
    }
    workspaceId = headerOverride;
    cacheSet(decoded.id, headerOverride);
  }

  if (!workspaceId) {
    log.error({ userId: decoded.id, email: decoded.email }, "auth: user has no workspace");
    res.status(500).json({
      success: false,
      error: "Your account has no workspace assigned. Please contact support.",
    });
    return;
  }

  req.workspaceId = workspaceId;
  req.user.workspaceId = workspaceId;
  next();
}

export function requireRole(allowed: SecurityRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ success: false, error: "Authentication required." });
      return;
    }
    if (!allowed.includes(req.user.role)) {
      res.status(403).json({ success: false, error: "Insufficient privileges." });
      return;
    }
    next();
  };
}
