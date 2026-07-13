/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Request, Response, NextFunction } from "express";

const ipLimits: Record<string, { count: number; resetTime: number }> = {};

/**
 * Enforces rate limiting (max 150 operations per minute per IP address).
 */
export function rateLimiter(req: Request, res: Response, next: NextFunction) {
  const ip = req.ip || "127.0.0.1";
  const now = Date.now();
  if (!ipLimits[ip] || now > ipLimits[ip].resetTime) {
    ipLimits[ip] = { count: 1, resetTime: now + 60 * 1000 };
  } else {
    ipLimits[ip].count++;
  }
  if (ipLimits[ip].count > 150) {
    res.status(429).json({ success: false, error: "Too many requests. Please wait and try again." });
    return;
  }
  next();
}
