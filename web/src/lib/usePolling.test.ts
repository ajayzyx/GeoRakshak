import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { usePolling } from "./usePolling";
import { ApiError } from "../api/errors";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("usePolling identity guard", () => {
  it("clears data when the identity changes and ignores a late response for the previous identity", async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const load = vi.fn((_signal: AbortSignal) => (load.mock.calls.length === 1 ? first.promise : second.promise));
    const { result, rerender } = renderHook(({ id }) => usePolling(load, null, [id]), { initialProps: { id: "a" } });

    await act(async () => first.resolve("data-a"));
    expect(result.current.data).toBe("data-a");

    rerender({ id: "b" });
    // The previous identity's data must not stay on screen.
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(true);

    // A late response for identity "a" is dropped, and "b" wins.
    await act(async () => first.resolve("data-a-late"));
    expect(result.current.data).toBeNull();
    await act(async () => second.resolve("data-b"));
    expect(result.current.data).toBe("data-b");
  });

  it("aborts the in-flight request when the identity changes", async () => {
    const signals: AbortSignal[] = [];
    const load = vi.fn((signal: AbortSignal) => {
      signals.push(signal);
      return new Promise<string>(() => {});
    });
    const { rerender } = renderHook(({ id }) => usePolling(load, null, [id]), { initialProps: { id: "a" } });
    rerender({ id: "b" });
    expect(signals[0].aborted).toBe(true);
    expect(signals[signals.length - 1].aborted).toBe(false);
  });

  it("keeps data and marks it stale when a refresh fails, then clears the error on success", async () => {
    let attempt = 0;
    const load = vi.fn(() => {
      attempt += 1;
      if (attempt === 2) return Promise.reject(new ApiError(0, "NETWORK_ERROR", "down"));
      return Promise.resolve(`v${attempt}`);
    });
    const { result, rerender } = renderHook(({ key }) => usePolling(load, null, [], key), { initialProps: { key: 1 } });
    await waitFor(() => expect(result.current.data).toBe("v1"));
    expect(result.current.stale).toBe(false);
    const firstUpdate = result.current.updatedAt;

    rerender({ key: 2 });
    await waitFor(() => expect(result.current.stale).toBe(true));
    expect(result.current.data).toBe("v1");
    expect(result.current.updatedAt).toBe(firstUpdate);

    rerender({ key: 3 });
    await waitFor(() => expect(result.current.data).toBe("v3"));
    expect(result.current.stale).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("refresh() reloads in place and does not run on mount twice", async () => {
    const load = vi.fn(() => Promise.resolve("x"));
    const { result } = renderHook(() => usePolling(load, null, [], 7));
    await waitFor(() => expect(result.current.data).toBe("x"));
    expect(load).toHaveBeenCalledTimes(1);
    await act(async () => result.current.refresh());
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("ignores ABORTED rejections instead of showing them as errors", async () => {
    const load = vi.fn(() => Promise.reject(new ApiError(0, "ABORTED", "Request superseded")));
    const { result } = renderHook(() => usePolling(load, null, []));
    await waitFor(() => expect(load).toHaveBeenCalled());
    expect(result.current.error).toBeNull();
  });
});
