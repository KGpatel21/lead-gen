/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Request, Response, NextFunction } from "express";

/**
 * Validates request origin headers to protect against cross-site request forgery.
 */
export function csrfProtection(req: Request, res: Response, next: NextFunction) {
  const method = req.method;
  if (["POST", "PUT", "DELETE"].includes(method)) {
    if (req.path.endsWith("/webhook") || req.path.includes("/billing/webhook")) {
      next();
      return;
    }
    const origin = req.headers.origin;
    const host = req.headers.host;
    if (origin && host && !origin.includes(host) && !host.includes("localhost") && !host.includes("127.0.0.1") && !host.includes("run.app")) {
      res.status(403).json({ success: false, error: "CSRF verification failed: Invalid origin headers." });
      return;
    }
  }
  next();
}
