/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Request, Response, NextFunction } from "express";

function sanitizeString(str: any): string {
  if (typeof str !== "string") return "";
  return str.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
            .replace(/<[^>]*>/g, "")
            .trim();
}

function sanitizeObject(obj: any): any {
  if (!obj || typeof obj !== "object") return obj;
  const sanitized: any = Array.isArray(obj) ? [] : {};
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      if (typeof obj[key] === "string") {
        sanitized[key] = sanitizeString(obj[key]);
      } else if (typeof obj[key] === "object") {
        sanitized[key] = sanitizeObject(obj[key]);
      } else {
        sanitized[key] = obj[key];
      }
    }
  }
  return sanitized;
}

/**
 * Automatically sanitizes inputs against XSS and validates payloads matching required types.
 */
export function validatePayload(schema: Record<string, "string" | "number" | "boolean" | "array">) {
  return (req: Request, res: Response, next: NextFunction) => {
    req.body = sanitizeObject(req.body);

    for (const [key, expectedType] of Object.entries(schema)) {
      const val = req.body[key];
      if (val === undefined) {
        res.status(400).json({ success: false, error: `Validation Error: Field '${key}' is required.` });
        return;
      }
      if (expectedType === "array") {
        if (!Array.isArray(val)) {
          res.status(400).json({ success: false, error: `Validation Error: Field '${key}' must be an array.` });
          return;
        }
      } else if (typeof val !== expectedType) {
        res.status(400).json({ success: false, error: `Validation Error: Field '${key}' must be of type ${expectedType}.` });
        return;
      }
    }
    next();
  };
}
