/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * A well-behaved polling hook.
 *
 * Fixes for the request-storm the app used to produce:
 *   • Visibility-aware  — skips ticks while document.hidden.
 *   • In-flight guard   — one tick can't stack on top of another still
 *                         running; overlapping intervals turn into a no-op.
 *   • Error backoff     — after a failure the next tick is delayed
 *                         exponentially (interval × 2, ×4, …) up to a cap.
 *   • Silent transients — transient network errors do not surface to the
 *                         toast layer. Only 3+ consecutive failures
 *                         escalate via onError.
 *   • Mount serialise   — pass `initialDelayMs` to avoid a cold-boot spike
 *                         when several usePolling calls mount at once.
 *
 * The hook does NOT own the fetching function's identity — callers just
 * pass a stable `fn`. That's the caller's responsibility (via useCallback).
 */

import { useEffect, useRef } from "react";

export interface UsePollingOptions {
  /** Base interval in ms between ticks. */
  intervalMs: number;
  /** If true (default), skip ticks while the tab is hidden. */
  respectVisibility?: boolean;
  /** Fire once immediately on mount. Default true. */
  fireOnMount?: boolean;
  /** ms to wait before the first tick when fireOnMount is true. */
  initialDelayMs?: number;
  /** Called after the Nth consecutive failure (default N = 3). */
  onError?: (err: unknown, consecutiveFailures: number) => void;
  /** How many failures to swallow before invoking onError. Default 3. */
  errorThreshold?: number;
  /** Upper bound on the backoff multiplier (default 8×). */
  maxBackoffMultiplier?: number;
  /** Disable the loop entirely (e.g. no user is logged in). */
  enabled?: boolean;
}

export function usePolling(
  fn: () => Promise<unknown>,
  opts: UsePollingOptions
): void {
  const {
    intervalMs,
    respectVisibility = true,
    fireOnMount = true,
    initialDelayMs = 0,
    onError,
    errorThreshold = 3,
    maxBackoffMultiplier = 8,
    enabled = true,
  } = opts;

  const fnRef = useRef(fn);
  fnRef.current = fn;

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);
  const failsRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;

    let disposed = false;

    const runOnce = async (): Promise<void> => {
      if (disposed) return;
      if (respectVisibility && typeof document !== "undefined" && document.hidden) {
        // Skip this tick — reschedule at the base interval.
        schedule(intervalMs);
        return;
      }
      if (inFlightRef.current) {
        // Previous fetch still running — skip this tick, reschedule.
        schedule(intervalMs);
        return;
      }

      inFlightRef.current = true;
      try {
        await fnRef.current();
        failsRef.current = 0;
        schedule(intervalMs);
      } catch (err) {
        failsRef.current += 1;
        const mult = Math.min(2 ** failsRef.current, maxBackoffMultiplier);
        if (failsRef.current >= errorThreshold && onError) {
          try { onError(err, failsRef.current); } catch { /* ignore */ }
        }
        schedule(intervalMs * mult);
      } finally {
        inFlightRef.current = false;
      }
    };

    const schedule = (delayMs: number): void => {
      if (disposed) return;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(runOnce, Math.max(1_000, delayMs));
    };

    if (fireOnMount) {
      timerRef.current = setTimeout(runOnce, Math.max(0, initialDelayMs));
    } else {
      schedule(intervalMs);
    }

    // Reset backoff when the tab becomes visible again so the user sees
    // fresh data on the next tick without waiting through the backoff.
    const onVisibility = () => {
      if (typeof document !== "undefined" && !document.hidden) {
        failsRef.current = 0;
        schedule(500); // small delay lets network/backoff settle
      }
    };
    if (respectVisibility && typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibility);
    }

    return () => {
      disposed = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      if (respectVisibility && typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility);
      }
    };
  }, [
    enabled,
    intervalMs,
    respectVisibility,
    fireOnMount,
    initialDelayMs,
    onError,
    errorThreshold,
    maxBackoffMultiplier,
  ]);
}
