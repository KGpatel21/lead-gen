/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../api/client";

export interface AsyncState<T> {
  data: T | null;
  error: string | null;
  isLoading: boolean;
}

function normalizeError(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Wrap a promise-returning function so you get { data, error, isLoading, run }.
 * `run` triggers the request; subsequent calls replace state.
 * If autoRun=true, kicks off on mount.
 */
export function useAsync<T>(
  fn: () => Promise<T>,
  autoRun = false
): AsyncState<T> & { run: () => Promise<T | null>; reset: () => void } {
  const [state, setState] = useState<AsyncState<T>>({
    data: null,
    error: null,
    isLoading: autoRun,
  });
  const cancelled = useRef(false);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const run = useCallback(async (): Promise<T | null> => {
    setState((s) => ({ ...s, isLoading: true, error: null }));
    try {
      const value = await fnRef.current();
      if (cancelled.current) return null;
      setState({ data: value, error: null, isLoading: false });
      return value;
    } catch (err) {
      if (cancelled.current) return null;
      setState({ data: null, error: normalizeError(err), isLoading: false });
      return null;
    }
  }, []);

  const reset = useCallback(() => {
    setState({ data: null, error: null, isLoading: false });
  }, []);

  useEffect(() => {
    cancelled.current = false;
    if (autoRun) void run();
    return () => { cancelled.current = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { ...state, run, reset };
}
