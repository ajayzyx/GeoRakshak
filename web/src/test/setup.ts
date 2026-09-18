import { afterEach, beforeEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// Tests must never reach the network: any un-stubbed fetch fails loudly.
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("Network access is not allowed in tests"))));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  try {
    window.sessionStorage.clear();
  } catch {
    /* storage unavailable */
  }
});
