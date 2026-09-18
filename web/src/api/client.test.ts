import { describe, expect, it, vi } from "vitest";
import { ApiError, createApiClient, resolveConfig, DEFAULT_BASE_URL } from "./client";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("resolveConfig", () => {
  it("defaults to live mode and the local backend", () => {
    expect(resolveConfig({})).toEqual({ mode: "live", baseUrl: DEFAULT_BASE_URL, basemapStyleUrl: null });
  });
  it("selects mock mode only when VITE_API_MODE=mock", () => {
    expect(resolveConfig({ VITE_API_MODE: "mock" }).mode).toBe("mock");
    expect(resolveConfig({ VITE_API_MODE: "MOCK " }).mode).toBe("mock");
    expect(resolveConfig({ VITE_API_MODE: "live" }).mode).toBe("live");
    expect(resolveConfig({ VITE_API_MODE: "something-else" }).mode).toBe("live");
  });
  it("trims trailing slashes from the base URL and reads the basemap override", () => {
    const c = resolveConfig({ VITE_API_BASE_URL: "https://api.example.org/api/v1/", VITE_BASEMAP_STYLE_URL: "https://styles.example.org/s.json" });
    expect(c.baseUrl).toBe("https://api.example.org/api/v1");
    expect(c.basemapStyleUrl).toBe("https://styles.example.org/s.json");
  });
});

describe("createApiClient switching", () => {
  it("mock mode never calls fetch", async () => {
    const fetchImpl = vi.fn();
    let token: string | null = null;
    const client = createApiClient({ mode: "mock", baseUrl: DEFAULT_BASE_URL, getToken: () => token, onUnauthenticated: vi.fn(), fetchImpl });
    expect(client.mode).toBe("mock");
    const res = await client.login("authority.mock@example.org", "mock");
    token = res.access_token;
    const pilot = await client.pilot();
    expect(pilot.name).toBe("Mock Area — not a real location");
    const zones = await client.riskZones(pilot.bbox, 48);
    expect(zones.metadata?.provenance).toBe("SIMULATED_DEMO");
    const sources = await client.dataSources();
    // Only the in-app inbox may be live in mock mode: it is the app itself, not an external source.
    expect(sources.items.filter((s) => s.connection_status === "CONNECTED_LIVE").map((s) => s.slug)).toEqual(["app-inbox-channel"]);
    const status = await client.systemStatus();
    const live = Object.values(status.adapters).flat().filter((a) => a?.effective_label === "REAL_LIVE").map((a) => a!.slug);
    expect(live).toEqual(["app-inbox-channel"]);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("live mode calls the configured base URL with the bearer token", async () => {
    const fetchImpl = vi.fn(async () => json(200, { type: "FeatureCollection", features: [] }));
    const client = createApiClient({ mode: "live", baseUrl: "http://api.test/api/v1", getToken: () => "tok-123", onUnauthenticated: vi.fn(), fetchImpl });
    expect(client.mode).toBe("live");
    await client.riskZones([91.7, 25.5, 91.95, 25.7], 24);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://api.test/api/v1/risk-zones?bbox=91.7,25.5,91.95,25.7&lead_time_h=24");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok-123");
  });

  it("live mode parses the error envelope and signals 401 for authenticated calls", async () => {
    const onUnauthenticated = vi.fn();
    const fetchImpl = vi.fn(async () => json(401, { error: { code: "UNAUTHENTICATED", message: "Token expired", request_id: "r1" } }));
    const client = createApiClient({ mode: "live", baseUrl: "http://api.test/api/v1", getToken: () => "old", onUnauthenticated, fetchImpl });
    const err = await client.alerts().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("UNAUTHENTICATED");
    expect((err as ApiError).requestId).toBe("r1");
    expect(onUnauthenticated).toHaveBeenCalledTimes(1);
  });

  it("a 401 from login itself does not trigger the session-expired handler", async () => {
    const onUnauthenticated = vi.fn();
    const fetchImpl = vi.fn(async () => json(401, { error: { code: "UNAUTHENTICATED", message: "Invalid credentials" } }));
    const client = createApiClient({ mode: "live", baseUrl: "http://api.test/api/v1", getToken: () => null, onUnauthenticated, fetchImpl });
    await expect(client.login("a@example.org", "x")).rejects.toMatchObject({ status: 401 });
    expect(onUnauthenticated).not.toHaveBeenCalled();
  });

  it("maps non-envelope errors and network failures to ApiError", async () => {
    const client = createApiClient({ mode: "live", baseUrl: "http://api.test/api/v1", getToken: () => "t", onUnauthenticated: vi.fn(), fetchImpl: vi.fn(async () => new Response("boom", { status: 503 })) });
    await expect(client.pilot()).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE", status: 503 });
    const down = createApiClient({ mode: "live", baseUrl: "http://api.test/api/v1", getToken: () => "t", onUnauthenticated: vi.fn(), fetchImpl: vi.fn(async () => { throw new TypeError("Failed to fetch"); }) });
    await expect(down.pilot()).rejects.toMatchObject({ code: "NETWORK_ERROR" });
  });
});
