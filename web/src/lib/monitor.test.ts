import { describe, expect, it } from "vitest";
import { fmtRelative, monitorView, weatherView } from "./monitor";
import type { DataSource, MonitorState, SystemMode } from "../api/types";

const NOW = new Date("2026-09-18T06:01:00Z");

// Shape copied from the local LIVE backend's GET /system/mode `monitor` block.
const LIVE_MONITOR: MonitorState = {
  enabled: true,
  interval_s: 180,
  weather_provider: "open-meteo",
  last_run_at: "2026-09-18T06:00:00Z",
  last_success_at: "2026-09-18T06:00:00Z",
  last_status: "OK",
  last_error: null,
  next_run_at: "2026-09-18T06:03:00Z",
  result: { scored: 2798, model_version: "b0-rules-0.1.0", roads_at_risk: 4, villages_access_at_risk: 1, watch_created: "al-1", watches_auto_closed: 2 },
  weather: { provider: "open-meteo", points: 9, observations: 27980, forecasts: 8394, observed_source: "open-meteo-recent", forecast_source: "open-meteo-forecast", is_imd: false },
  weather_error: null,
};

const live = (over: Partial<MonitorState> = {}): SystemMode => ({ run_mode: "LIVE", replay: null, monitor: { ...LIVE_MONITOR, ...over } });

describe("monitorView", () => {
  it("reports a healthy scheduler with interval, last run and next run", () => {
    const v = monitorView(live(), NOW);
    expect(v.health).toBe("OK");
    expect(v.headline).toBe("Scheduler LIVE");
    expect(v.intervalLabel).toBe("every 3 min");
    expect(v.detail).toContain("Last cycle 1 min ago");
    expect(v.detail).toContain("next in 2 min");
    expect(v.warning).toBeNull();
  });

  it("warns when the scheduler is stopped", () => {
    const v = monitorView(live({ enabled: false }), NOW);
    expect(v.health).toBe("STOPPED");
    expect(v.headline).toBe("Scheduler STOPPED");
    expect(v.warning?.title).toContain("scheduler is stopped");
    expect(v.warning?.text).toContain("only as fresh as the last cycle");
  });

  it("warns with the error text and the last successful run when a cycle failed", () => {
    const failed = live({ last_status: "FAILED", last_error: "open-meteo request timed out", last_run_at: "2026-09-18T06:00:30Z", last_success_at: "2026-09-18T05:45:00Z" });
    const v = monitorView(failed, NOW);
    expect(v.health).toBe("FAILED");
    expect(v.headline).toContain("last cycle FAILED");
    expect(v.detail).toContain("open-meteo request timed out");
    expect(v.warning?.title).toBe("Last monitoring cycle failed — displayed risk may be out of date");
    expect(v.warning?.text).toContain("open-meteo request timed out");
    expect(v.warning?.text).toContain("Last successful cycle 16 min ago (05:45 UTC)");
    expect(v.lastSuccessAt?.toISOString()).toBe("2026-09-18T05:45:00.000Z");
  });

  it("says so honestly when the API records no successful cycle", () => {
    const v = monitorView(live({ last_status: "FAILED", last_error: "boom", last_success_at: null }), NOW);
    expect(v.warning?.text).toContain("No successful cycle is recorded");
  });

  it("flags a stale cycle after about three intervals", () => {
    const fresh = monitorView(live({ last_run_at: "2026-09-18T05:53:00Z" }), NOW); // 8 min, < 9 min limit
    expect(fresh.health).toBe("OK");
    const stale = monitorView(live({ last_run_at: "2026-09-18T05:45:00Z" }), NOW); // 16 min
    expect(stale.health).toBe("STALE");
    expect(stale.warning?.title).toBe("No monitoring cycle for 16 min — displayed risk may be out of date");
    expect(stale.warning?.text).toContain("every 3 min");
  });

  it("flags a scheduler that has never run", () => {
    const v = monitorView(live({ last_run_at: null, last_status: null }), NOW);
    expect(v.health).toBe("NEVER_RUN");
    expect(v.warning?.title).toContain("No monitoring cycle has run yet");
  });

  it("shows the DEMO_REPLAY note instead of pretending a scheduler exists", () => {
    const mode: SystemMode = {
      run_mode: "DEMO_REPLAY",
      replay: null,
      monitor: { ...LIVE_MONITOR, enabled: false, interval_s: null, weather_provider: "none", last_run_at: null, last_status: null, result: null, weather: null, note: "DEMO_REPLAY: cycles run on replay steps, not on a timer" },
    };
    const v = monitorView(mode, NOW);
    expect(v.health).toBe("NO_SCHEDULER");
    expect(v.headline).toBe("No scheduler (DEMO_REPLAY)");
    expect(v.detail).toBe("DEMO_REPLAY: cycles run on replay steps, not on a timer");
    expect(v.warning).toBeNull();
  });

  it("does not invent state when the backend reports none", () => {
    expect(monitorView(null, NOW).health).toBe("UNKNOWN");
    expect(monitorView({ run_mode: "LIVE" }, NOW).detail).toBe("The backend did not report monitoring state.");
  });
});

describe("fmtRelative", () => {
  it("formats past, future and near-now times", () => {
    expect(fmtRelative(new Date("2026-09-18T06:03:00Z"), NOW)).toBe("in 2 min");
    expect(fmtRelative(new Date("2026-09-18T05:31:00Z"), NOW)).toBe("30 min ago");
    expect(fmtRelative(new Date("2026-09-18T06:01:05Z"), NOW)).toBe("just now");
    expect(fmtRelative(null, NOW)).toBe("—");
  });
});

const WEATHER_SOURCES: DataSource[] = [
  { slug: "open-meteo-recent", kind: "WEATHER_HISTORICAL", provider: "Open-Meteo", connection_status: "CONNECTED_LIVE", provenance_default: "REAL_LIVE", status_note: "Model-derived daily precipitation, not gauge observations. Non-IMD source (H16)." },
  { slug: "open-meteo-forecast", kind: "WEATHER_FORECAST", provider: "Open-Meteo", connection_status: "CONNECTED_LIVE", provenance_default: "REAL_LIVE" },
  { slug: "imd-gridded-rainfall", kind: "WEATHER_HISTORICAL", provider: "IMD", connection_status: "CONNECTED_HISTORICAL", provenance_default: "REAL_HISTORICAL" },
  { slug: "imd-weather-api", kind: "WEATHER_LIVE", provider: "IMD", connection_status: "AWAITING_ACCESS" },
];

describe("weatherView", () => {
  it("shows the active provider, its IMD status, counts and both source rows", () => {
    const w = weatherView(LIVE_MONITOR, WEATHER_SOURCES);
    expect(w.connected).toBe(true);
    expect(w.providerLabel).toBe("open-meteo");
    expect(w.imdLabel).toBe("Non-IMD source (H16)");
    expect(w.counts).toBe("9 provider points · 27980 observations · 8394 forecast rows");
    expect(w.rows.map((r) => [r.role, r.slug, r.source?.connection_status])).toEqual([
      ["Observed", "open-meteo-recent", "CONNECTED_LIVE"],
      ["Forecast", "open-meteo-forecast", "CONNECTED_LIVE"],
    ]);
    expect(w.rows[0].source?.status_note).toContain("not gauge observations");
  });

  it("says plainly that nothing is connected when the provider is none", () => {
    const w = weatherView({ ...LIVE_MONITOR, weather_provider: "none", weather: null }, WEATHER_SOURCES);
    expect(w.connected).toBe(false);
    expect(w.providerLabel).toBe("No weather provider connected");
    expect(w.detail).toContain("Rainfall comes from the replay or from stored history");
    expect(w.detail).toContain("imd-gridded-rainfall");
    expect(w.rows).toEqual([]);
  });

  it("does not turn missing counts or source slugs into zeros", () => {
    const w = weatherView({ ...LIVE_MONITOR, weather: { provider: "open-meteo", is_imd: false } }, WEATHER_SOURCES);
    expect(w.counts).toBeNull();
    expect(w.rows.map((r) => [r.slug, r.source])).toEqual([
      [null, null],
      [null, null],
    ]);
    const partial = weatherView({ ...LIVE_MONITOR, weather: { provider: "open-meteo", is_imd: false, observations: 0 } }, WEATHER_SOURCES);
    expect(partial.counts).toBe("not reported provider points · 0 observations · not reported forecast rows");
  });

  it("shows a throttled fetch as reused data, not as an error", () => {
    const w = weatherView(
      { ...LIVE_MONITOR, weather: { provider: "open-meteo", is_imd: false, skipped: "fetched recently", min_interval_s: 3600, observations: 0, forecasts: 0, last_fetch_at: "2026-09-18T05:04:00Z", observed_source: "open-meteo-recent", forecast_source: "open-meteo-forecast" } },
      WEATHER_SOURCES,
    );
    expect(w.throttled).toBe(true);
    expect(w.fetchedAt).toBe("05:04 UTC");
    expect(w.detail).toContain("Using data fetched at 05:04 UTC");
    expect(w.detail).toContain("at most every 1 h 0 min");
    expect(w.counts).toContain("No new rows in the last cycle");
    expect(w.error).toBeNull();
  });

  it("surfaces a weather ingest error", () => {
    expect(weatherView({ ...LIVE_MONITOR, weather_error: "HTTP 429 from provider" }, WEATHER_SOURCES).error).toBe("HTTP 429 from provider");
  });
});
