import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../api/errors";

export interface Polled<T> {
  /** Data for the current identity (never data loaded for a previous identity). */
  data: T | null;
  /** Error of the most recent attempt (null after a success). */
  error: ApiError | null;
  /** True until the first attempt for the current identity settles. */
  loading: boolean;
  /** Time of the last successful load for the current identity. */
  updatedAt: Date | null;
  /** True when `data` is shown but the latest refresh failed. */
  stale: boolean;
  refresh: () => void;
}

const toApiError = (e: unknown): ApiError =>
  e instanceof ApiError ? e : new ApiError(0, "CLIENT_ERROR", e instanceof Error ? e.message : String(e));

/**
 * Loads data for an identity (`identity` deps: e.g. cell id + lead time) and keeps it fresh.
 *
 * - When the identity changes, the old data is cleared immediately and in-flight requests are aborted,
 *   so a slow response for a previous cell or lead time can never be shown for the new one.
 * - `refreshKey` changes and the optional interval reload in place, keeping the current data visible
 *   (marked `stale` if the reload fails).
 */
export function usePolling<T>(
  load: (signal: AbortSignal) => Promise<T>,
  intervalMs: number | null,
  identity: unknown[],
  refreshKey: unknown = 0,
): Polled<T> {
  const [state, setState] = useState<{ data: T | null; error: ApiError | null; loading: boolean; updatedAt: Date | null }>({
    data: null,
    error: null,
    loading: true,
    updatedAt: null,
  });
  const loadRef = useRef(load);
  loadRef.current = load;
  const seq = useRef(0);
  const controller = useRef<AbortController | null>(null);

  const run = useCallback(() => {
    controller.current?.abort();
    const ctrl = new AbortController();
    controller.current = ctrl;
    const mine = ++seq.current;
    let promise: Promise<T>;
    try {
      promise = loadRef.current(ctrl.signal);
    } catch (e) {
      promise = Promise.reject(e);
    }
    promise.then(
      (data) => {
        if (mine !== seq.current) return;
        setState({ data, error: null, loading: false, updatedAt: new Date() });
      },
      (e: unknown) => {
        if (mine !== seq.current) return;
        const err = toApiError(e);
        if (err.code === "ABORTED") return;
        setState((s) => ({ ...s, error: err, loading: false }));
      },
    );
  }, []);

  const identityKey = JSON.stringify(identity);
  useEffect(() => {
    setState({ data: null, error: null, loading: true, updatedAt: null });
    run();
    return () => {
      seq.current++;
      controller.current?.abort();
    };
  }, [identityKey, run]);

  const lastRefreshKey = useRef(refreshKey);
  useEffect(() => {
    if (Object.is(lastRefreshKey.current, refreshKey)) return;
    lastRefreshKey.current = refreshKey;
    run();
  }, [refreshKey, run]);

  useEffect(() => {
    if (!intervalMs) return;
    const t = setInterval(run, intervalMs);
    return () => clearInterval(t);
  }, [intervalMs, run, identityKey]);

  return { ...state, stale: state.data !== null && state.error !== null, refresh: run };
}
