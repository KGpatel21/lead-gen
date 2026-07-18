/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Central retry policy for transient send failures.
 *
 * Classifies errors as retriable or terminal, computes exponential
 * backoff delays, and enforces per-campaign max retries. The email
 * dispatcher and sequence engine both consult this instead of hard-coding
 * "how long should I wait" everywhere.
 *
 * Retriable:
 *   - HTTP 408, 425, 429, 500, 502, 503, 504
 *   - Network errors: ECONNRESET, ETIMEDOUT, EHOSTUNREACH, ECONNREFUSED,
 *     EPIPE, EAGAIN, ENOTFOUND (DNS blip)
 *   - SMTP 4xx codes (transient)
 *   - EmailProviderError.retriable === true
 *
 * Terminal:
 *   - HTTP 400, 401, 403, 404, 422
 *   - Suppression, EmailProviderNotConfigured, EmailProviderError.retriable === false
 *   - SMTP 5xx codes
 */

import { EmailProviderError, EmailProviderNotConfiguredError } from "../providers/email";

export interface RetryDecision {
  retriable: boolean;
  reason: string;
  suggestedDelayMs?: number;
}

const NET_CODES = new Set([
  "ECONNRESET", "ETIMEDOUT", "EHOSTUNREACH", "ECONNREFUSED",
  "EPIPE", "EAGAIN", "ENOTFOUND", "EAI_AGAIN",
]);
const RETRIABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const TERMINAL_STATUSES = new Set([400, 401, 403, 404, 422]);

export const retryPolicyService = {
  classify(err: unknown): RetryDecision {
    if (err instanceof EmailProviderNotConfiguredError) {
      return { retriable: false, reason: "provider not configured" };
    }
    if (err instanceof EmailProviderError) {
      if (err.retriable) return { retriable: true, reason: err.message };
      if (typeof err.upstreamStatus === "number") {
        if (RETRIABLE_STATUSES.has(err.upstreamStatus)) return { retriable: true, reason: `upstream ${err.upstreamStatus}` };
        if (TERMINAL_STATUSES.has(err.upstreamStatus)) return { retriable: false, reason: `upstream ${err.upstreamStatus}` };
      }
      return { retriable: false, reason: err.message };
    }
    const e = err as any;
    if (e?.code && NET_CODES.has(String(e.code))) {
      return { retriable: true, reason: `network ${e.code}` };
    }
    if (typeof e?.status === "number") {
      if (RETRIABLE_STATUSES.has(e.status)) return { retriable: true, reason: `HTTP ${e.status}` };
      if (TERMINAL_STATUSES.has(e.status)) return { retriable: false, reason: `HTTP ${e.status}` };
    }
    // SMTP-style response code sniffing (e.g. "421 4.7.0 try again later").
    const message = String(e?.message || "").trim();
    const m = /\b(4|5)\d{2}\b/.exec(message);
    if (m) {
      const first = message.match(/\b(\d{3})\b/);
      const code = first ? Number(first[1]) : null;
      if (code && code >= 400 && code < 500) return { retriable: true, reason: `SMTP ${code}` };
      if (code && code >= 500) return { retriable: false, reason: `SMTP ${code}` };
    }
    // Timeout heuristic — retriable.
    if (/timeout|timed out|network|reset|econn/i.test(message)) {
      return { retriable: true, reason: message.slice(0, 200) };
    }
    // Default: unknown error → terminal so we don't spin forever.
    return { retriable: false, reason: message.slice(0, 200) || "unknown" };
  },

  /**
   * Full-jitter exponential backoff, capped at 15 minutes.
   * retryCount=1 → ~30s, 2 → ~1m, 3 → ~2m, 4 → ~4m … capped at 900s.
   */
  backoffMs(retryCount: number): number {
    const base = 15_000;
    const factor = Math.pow(2, Math.min(retryCount, 6));
    const upperBound = Math.min(base * factor, 15 * 60_000);
    // full jitter
    const jitter = Math.floor(Math.random() * upperBound);
    return Math.max(15_000, jitter);
  },

  shouldRetry(retryCount: number, maxRetries: number, err: unknown): { retry: boolean; delayMs: number; reason: string } {
    const decision = this.classify(err);
    if (!decision.retriable) return { retry: false, delayMs: 0, reason: decision.reason };
    if (retryCount >= maxRetries) return { retry: false, delayMs: 0, reason: `max retries reached (${maxRetries})` };
    return {
      retry: true,
      delayMs: decision.suggestedDelayMs ?? this.backoffMs(retryCount + 1),
      reason: decision.reason,
    };
  },
};
