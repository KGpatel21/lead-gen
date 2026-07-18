/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Structured JSON logging (pino) + request-scoped IDs via AsyncLocalStorage.
 *
 * Use `getLogger()` for anything outside a request handler.
 * Use `req.log` (populated by `requestContextMiddleware`) inside routes so
 * every log line automatically carries `requestId`, `userId`, `workspaceId`.
 *
 * Sensitive fields are auto-redacted (`authorization`, `cookie`, api keys).
 */

import { AsyncLocalStorage } from "async_hooks";
import pino, { Logger } from "pino";
import { config } from "../config";

const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  '*.password',
  '*.smtpPassword',
  '*.smtpPasswordEncrypted',
  '*.oauthAccessToken',
  '*.oauthAccessTokenEncrypted',
  '*.oauthRefreshToken',
  '*.oauthRefreshTokenEncrypted',
  '*.apiKey',
  '*.accessKeyId',
  '*.secretAccessKey',
  'headers.authorization',
  'headers.cookie',
];

/**
 * The root logger. Uses pretty-print in dev, plain JSON in prod.
 * Only one root logger per process.
 */
export const rootLogger: Logger = pino({
  level: config.logLevel,
  redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
  base: { service: "outbound-ai", env: config.nodeEnv },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => ({ level: label }),
  },
  ...(config.isProduction
    ? {}
    : {
        transport: {
          target: "pino/file",
          options: { destination: 1 }, // stdout without pretty transport (no extra dep)
        },
      }),
});

// ---- request-scoped context ----

export interface LogContext {
  requestId: string;
  userId?: string;
  workspaceId?: string;
  path?: string;
  method?: string;
}

const contextStorage = new AsyncLocalStorage<LogContext>();

export function runWithContext<T>(ctx: LogContext, fn: () => T): T {
  return contextStorage.run(ctx, fn);
}

export function getRequestContext(): LogContext | undefined {
  return contextStorage.getStore();
}

/**
 * Returns a logger enriched with the current async-local request context.
 * Fall back to the root logger when called outside a request.
 */
export function getLogger(): Logger {
  const ctx = contextStorage.getStore();
  return ctx ? rootLogger.child(ctx) : rootLogger;
}

/**
 * Convenience helpers so we don't have to type `getLogger().info(...)` everywhere.
 */
export const log = {
  trace: (...args: Parameters<Logger["trace"]>) => getLogger().trace(...args),
  debug: (...args: Parameters<Logger["debug"]>) => getLogger().debug(...args),
  info: (...args: Parameters<Logger["info"]>) => getLogger().info(...args),
  warn: (...args: Parameters<Logger["warn"]>) => getLogger().warn(...args),
  error: (...args: Parameters<Logger["error"]>) => getLogger().error(...args),
  fatal: (...args: Parameters<Logger["fatal"]>) => getLogger().fatal(...args),
};
