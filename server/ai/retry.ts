/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 3-attempt exponential-backoff retry with 429 `Retry-After` support.
 * Used by every AI provider. No provider owns its own retry logic.
 */

export interface RetryOptions {
  maxAttempts?: number;             // default 3
  baseDelayMs?: number;             // default 500
  maxDelayMs?: number;              // default 8000
  onRetry?: (attempt: number, err: Error, waitMs: number) => void;
}

export function isRetriableStatus(status: number | undefined): boolean {
  if (status == null) return false;
  return status === 408 || status === 425 || status === 429 || (status >= 500 && status < 600);
}

/**
 * If the caller threw a value that carries `status`, `retryAfterMs`, or an
 * `Error` chain, extract them. Providers should throw errors shaped like this.
 */
export interface RetryHintedError extends Error {
  status?: number;
  retryAfterMs?: number;
}

function extractHints(err: unknown): { status?: number; retryAfterMs?: number } {
  if (err && typeof err === "object") {
    const e = err as RetryHintedError;
    return { status: e.status, retryAfterMs: e.retryAfterMs };
  }
  return {};
}

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: RetryOptions = {}
): Promise<{ result: T; attempts: number }> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 500;
  const maxDelayMs = opts.maxDelayMs ?? 8_000;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await fn(attempt);
      return { result, attempts: attempt };
    } catch (err) {
      lastErr = err;
      const { status, retryAfterMs } = extractHints(err);
      const retriable = isRetriableStatus(status);
      const isLastAttempt = attempt >= maxAttempts;
      if (!retriable || isLastAttempt) throw err;

      const backoff = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
      // Full jitter to spread coordinated retries.
      const jittered = Math.floor(Math.random() * backoff) + Math.floor(backoff / 2);
      const wait = retryAfterMs && retryAfterMs > 0 ? Math.min(retryAfterMs, maxDelayMs) : jittered;

      opts.onRetry?.(attempt, err as Error, wait);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr; // unreachable, keeps ts happy
}
