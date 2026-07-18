/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Assigns a `requestId` to every incoming HTTP request, sets it on
 * `res.setHeader("X-Request-Id", ...)`, and runs the rest of the request
 * inside an AsyncLocalStorage so every log line downstream carries it.
 */

import crypto from "crypto";
import { Request, Response, NextFunction } from "express";
import { runWithContext } from "../observability/logger";
import { AuthenticatedRequest } from "./auth.middleware";

const REQUEST_ID_HEADER = "x-request-id";

export function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const inbound = req.headers[REQUEST_ID_HEADER];
  const requestId =
    typeof inbound === "string" && inbound.length > 0 && inbound.length < 100
      ? inbound
      : "req-" + crypto.randomUUID().split("-").slice(0, 3).join("");

  res.setHeader("X-Request-Id", requestId);
  (req as any).requestId = requestId;

  runWithContext(
    {
      requestId,
      userId: (req as AuthenticatedRequest).user?.id,
      workspaceId: (req as any).workspaceId,
      path: req.path,
      method: req.method,
    },
    () => next()
  );
}
