/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * JWT Bearer authentication.
 *
 * Previously this middleware had a silent fallback: if no valid token was
 * present, it logged the caller in as the first admin (or a hardcoded default).
 * That made every "protected" endpoint public. That fallback is deleted.
 * Missing or invalid tokens now return HTTP 401.
 */

import { Request, Response, NextFunction } from "express";
import { SecurityService } from "../services/security.service";
import { SecurityRole } from "../../src/types";

export interface AuthenticatedRequest extends Request {
  user?: { id: string; email: string; role: SecurityRole; workspaceId?: string };
  /**
   * Populated by `authenticateJwt` when the JWT payload includes it.
   * Repositories use this for workspace-scoped queries.
   */
  workspaceId?: string;
}

export function authenticateJwt(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    res.status(401).json({ success: false, error: "Missing bearer token." });
    return;
  }
  const token = header.slice(7).trim();
  const decoded = SecurityService.verifyJwt<{ id: string; email: string; role: SecurityRole; workspaceId?: string }>(token);
  if (!decoded || !decoded.id || !decoded.email || !decoded.role) {
    res.status(401).json({ success: false, error: "Invalid or expired session token." });
    return;
  }
  req.user = { id: decoded.id, email: decoded.email, role: decoded.role, workspaceId: decoded.workspaceId };
  // Multi-tenancy: propagate workspaceId to the request scope so repos can
  // filter without needing a separate middleware on every route.
  if (decoded.workspaceId) req.workspaceId = decoded.workspaceId;
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
