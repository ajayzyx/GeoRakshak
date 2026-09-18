import { describe, expect, it } from "vitest";
import { buildDataStrip, modelEntry, type StripEntry } from "./dataStrip";
import { forecastBanner } from "./forecast";
import { formatReplayStep, lastStep, replayNotStarted } from "./replay";
import type { ActiveModel, CollectionMetadata, DataSource, MonitorState, SystemMode } from "../api/types";

// Source-registry records, trimmed from the local backend's GET /data-sources response.
// These are connection-status records, not environmental data, and none is CONNECTED_LIVE.
const SOURCES: DataSource[] = [
  { slug: "copernicus-dem-glo30", kind: "TERRAIN", provider: "ESA / Copernicus (via AWS Open Data, Sinergise)", connection_status: "CONNECTED_HISTORICAL", provenance_default: "REAL_HISTORICAL" },
  { slug: "nasa-glc", kind: "INVENTORY", provider: "NASA Goddard Space Flight Center", connection_status: "CONNECTED_HISTORICAL", provenance_default: "REAL_HISTORICAL" },
  { slug: "gsi-bhukosh-landslide-inventory", kind: "INVENTORY", provider: "Geological Survey of India (Bhukosh)", connection_status: "NOT_CONNECTED", provenance_default: "REAL_HISTORICAL" },
  { slug: "osm-roads", kind: "EXPOSURE", provider: "OpenStreetMap contributors", dataset: "OSM highway ways", connection_status: "CONNECTED_HISTORICAL", provenance_default: "REAL_HISTORICAL" },
  { slug: "osm-locations", kind: "EXPOSURE", provider: "OpenStreetMap contributors", dataset: "OSM places, schools, health facilities, highway bridges", connection_status: "CONNECTED_HISTORICAL", provenance_default: "REAL_HISTORICAL" },
  { slug: "esa-worldcover-2021", kind: "SATELLITE_LAYER", provider: "ESA WorldCover consortium (via AWS Open Data)", connection_status: "CONNECTED_HISTORICAL", provenance_default: "REAL_HISTORICAL" },
  {
    slug: "imd-gridded-rainfall",
    kind: "WEATHER_HISTORICAL",
    provider: "India Meteorological Department (IMD), Pune",
    connection_status: "CONNECTED_HISTORICAL",
    provenance_default: "REAL_HISTORICAL",
    licence: "No open licence found. Team decision/permission needed before redistribution or public display.",
  },
  { slug: "imd-weather-api", kind: "WEATHER_LIVE", provider: "India Meteorological Department", connection_status: "AWAITING_ACCESS", provenance_default: "REAL_LIVE" },
  { slug: "replay-forecast", kind: "WEATHER_FORECAST", provider: "GeoRakshak replay", connection_status: "SIMULATED", provenance_default: "SIMULATED_DEMO", status_note: "Uses later days of the replay period as a stand-in forecast. Not a real forecast." },
  { slug: "virtual-soil-moisture", kind: "SENSOR", provider: "GeoRakshak virtual sensor emulator", connection_status: "SIMULATED", provenance_default: "SIMULATED_DEMO" },
  { slug: "sensor-gateway", kind: "SENSOR", provider: "—", connection_status: "NOT_CONNECTED" },
  { slug: "sms-channel", kind: "NOTIFICATION_CHANNEL", connection_status: "SANDBOX", status_note: "Messages rendered and logged, not sent" },
  { slug: "app-push-channel", kind: "NOTIFICATION_CHANNEL", connection_status: "NOT_CONNECTED", status_note: "No FCM project configured." },
];

const REPLAY_MODE: SystemMode = {
  run_mode: "DEMO_REPLAY",
  replay: { scenario: "pilot-rainfall-replay", provenance: "REAL_HISTORICAL", step: 29, steps: 47, as_of: "2017-06-14T00:00:00+00:00" },
};

const BASELINE: ActiveModel = {
  version: "b0-rules-0.1.0",
  model_type: "RULE_BASED_INDEX",
  stage: "B0_BASELINE",
  thresholds: { calibrated: false, note: "Uncalibrated literature-informed heuristics; not validated thresholds." },
  validation_scheme: "NONE - rule-based heuristic, not trained or validated",
  metrics: null,
  forecast_skill_evaluated: false,
  model_card_uri: "ml/georakshak_ml/README.md",
};

const RISK_META: CollectionMetadata = {
  run_mode: "DEMO_REPLAY",
  lead_time_h: 48,
  model_version: "b0-rules-0.1.0",
  forecast_source: { slug: "replay-forecast", label: "Replay scenario forecast", connection_status: "SIMULATED" },
  provenance: "MODEL_OUTPUT",
  forecast_skill_evaluated: false,
};

const MONITOR_OK: MonitorState = {
  enabled: true,
  interval_s: 180,
  weather_provider: "open-meteo",
  last_run_at: "2026-09-18T06:00:00Z",
  last_status: "OK",
  last_error: null,
  next_run_at: "2026-09-18T06:03:00Z",
  result: { scored: 2798, model_version: "b0-rules-0.1.0", roads_at_risk: 0, villages_access_at_risk: 0, watches_auto_closed: 0 },
  weather: { provider: "open-meteo", points: 9, observations: 27980, forecasts: 8394, observed_source: "open-meteo-recent", forecast_source: "open-meteo-forecast", is_imd: false },
  weather_error: null,
};

// The LIVE backend adds the connected open-meteo rows next to the historical and replay ones.
const LIVE_SOURCES: DataSource[] = [
  ...SOURCES,
  {
    slug: "open-meteo-recent",
    kind: "WEATHER_HISTORICAL",
    provider: "Open-Meteo",
    connection_status: "CONNECTED_LIVE",
    provenance_default: "REAL_LIVE",
    status_note: "Model-derived daily precipitation for the last 10 days, not gauge observations. Non-IMD source (H16).",
  },
  {
    slug: "open-meteo-forecast",
    kind: "WEATHER_FORECAST",
    provider: "Open-Meteo",
    connection_status: "CONNECTED_LIVE",
    provenance_default: "REAL_LIVE",
    status_note: "Daily precipitation forecast, leads 24/48/72 h. Non-IMD source (H16). Forecast skill has not been evaluated.",
  },
];

const byKey = (entries: StripEntry[]) => Object.fromEntries(entries.map((e) => [e.key, e])) as Record<StripEntry["key"], StripEntry>;

describe("buildDataStrip", () => {
  // Regression: a configured provider whose fetch did not refresh must not make the rainfall row name the
  // IMD adapter (AWAITING_ACCESS) — that implies IMD supplied the rainfall that the risk was computed from.
  it("names stored rainfall, never the awaiting-access IMD adapter, when a live fetch does not refresh", () => {
    const liveSources = [
      ...SOURCES,
      { slug: "open-meteo-recent", kind: "WEATHER_HISTORICAL", provider: "Open-Meteo (non-IMD model forecast)",
        connection_status: "CONNECTED_LIVE", provenance_default: "REAL_LIVE",
        status_note: "Model-derived recent precipitation, NOT gauge observations and NOT IMD." },
    ] as typeof SOURCES;
    const noFreshFetch: SystemMode = {
      run_mode: "LIVE", replay: null,
      monitor: { ...MONITOR_OK, weather: null, weather_error: "Open-Meteo request failed: DNS" },
    };
    const e = byKey(buildDataStrip({ sources: liveSources, mode: noFreshFetch, model: BASELINE, riskMeta: undefined, leadTime: 0 }));
    expect(e.rainfall.tag).toBe("REAL_LIVE");
    expect(e.rainfall.text).toContain("open-meteo-recent");
    expect(e.rainfall.text).not.toContain("AWAITING_ACCESS");
    expect(e.rainfall.text.toLowerCase()).toContain("no fresh fetch");
  });

  // Regression: on the Current view there is no forecast_source, and picking the first registry row showed
  // "Open-Meteo NOT_CONNECTED" while the replay was actually producing the forecast layer.
  it("names the forecast source in use when no lead time is selected", () => {
    const withUnconnectedFallback = [
      ...SOURCES,
      { slug: "open-meteo-forecast", kind: "WEATHER_FORECAST", provider: "Open-Meteo (non-IMD model forecast)",
        connection_status: "NOT_CONNECTED", provenance_default: "REAL_LIVE" },
    ] as typeof SOURCES;
    const replay = byKey(buildDataStrip({ sources: withUnconnectedFallback, mode: REPLAY_MODE, model: BASELINE, riskMeta: undefined, leadTime: 0 }));
    expect(replay.forecast.tag).toBe("SIMULATED");
    expect(replay.forecast.text.toLowerCase()).toContain("replay");
    expect(replay.forecast.text).not.toContain("Open-Meteo");

    const live = [
      ...SOURCES.filter((s) => s.slug !== "replay-forecast"),
      { slug: "open-meteo-forecast", kind: "WEATHER_FORECAST", provider: "Open-Meteo (non-IMD model forecast)",
        connection_status: "CONNECTED_LIVE", provenance_default: "REAL_LIVE" },
    ] as typeof SOURCES;
    const liveStrip = byKey(buildDataStrip({
      sources: live, mode: { run_mode: "LIVE", replay: null, monitor: MONITOR_OK }, model: BASELINE,
      riskMeta: undefined, leadTime: 0,
    }));
    expect(liveStrip.forecast.tag).toBe("REAL_LIVE");
    expect(liveStrip.forecast.text).toContain("non-IMD");
  });

  const entries = byKey(buildDataStrip({ sources: SOURCES, mode: REPLAY_MODE, model: BASELINE, riskMeta: RISK_META, leadTime: 48 }));

  it("marks terrain, landslides, roads, facilities and satellite layers as real historical with their source names", () => {
    expect(entries.terrain.tag).toBe("REAL_HISTORICAL");
    expect(entries.terrain.text).toContain("Copernicus");
    expect(entries.landslides.tag).toBe("REAL_HISTORICAL");
    expect(entries.landslides.text).toContain("NASA");
    expect(entries.roads.text).toContain("OpenStreetMap");
    expect(entries.facilities.text).toContain("OpenStreetMap");
    expect(entries.facilities.key).toBe("facilities");
    expect(entries.landcover.tag).toBe("REAL_HISTORICAL");
  });

  it("describes the rainfall replay as real historical IMD rainfall with its year and licence note", () => {
    expect(entries.rainfall.text).toBe("Replay of real historical IMD rainfall (2017)");
    expect(entries.rainfall.tag).toBe("REAL_REPLAY");
    expect(entries.rainfall.tone).toBe("replay");
    expect(entries.rainfall.note).toContain("No open licence found");
  });

  it("says the forecast is a simulated stand-in and not a weather forecast", () => {
    expect(entries.forecast.tag).toBe("SIMULATED");
    expect(entries.forecast.text).toContain("not a weather forecast");
    expect(entries.forecast.text).toContain("skill not evaluated");
  });

  it("labels soil moisture as virtual sensors, SMS as sandbox and push as not connected", () => {
    expect(entries.soil.text).toContain("Virtual sensors (simulated)");
    expect(entries.sms.text).toBe("Sandbox — not sent");
    expect(entries.push.text).toBe("Not connected");
  });

  it("reports a rule-based baseline as having no validated accuracy", () => {
    expect(entries.model.text).toContain("b0-rules-0.1.0");
    expect(entries.model.text).toContain("rule-based baseline — no validated accuracy");
  });

  it("says the replay has not started instead of implying rainfall input", () => {
    const e = byKey(buildDataStrip({ sources: SOURCES, mode: { run_mode: "DEMO_REPLAY", replay: null }, model: "none", riskMeta: undefined, leadTime: 0 }));
    expect(e.rainfall.text).toContain("Replay not started");
    expect(e.model.text).toBe("No model registered");
  });

  it("marks a simulated rainfall scenario as simulated", () => {
    const e = byKey(buildDataStrip({ sources: SOURCES, mode: { run_mode: "DEMO_REPLAY", replay: { ...REPLAY_MODE.replay!, provenance: "SIMULATED_DEMO" } }, model: BASELINE, riskMeta: undefined, leadTime: 0 }));
    expect(e.rainfall.tag).toBe("SIMULATED");
  });

  it("does not claim anything when the source registry could not be loaded", () => {
    const e = byKey(buildDataStrip({ sources: null, mode: null, model: "unavailable", riskMeta: undefined, leadTime: 0 }));
    for (const key of ["terrain", "landslides", "roads", "facilities", "landcover", "soil", "sms", "push"] as const) {
      expect(e[key].tone).toBe("unknown");
    }
    expect(e.rainfall.text).toBe("Run mode not loaded");
    expect(e.model.text).toBe("Model info not loaded");
  });

  it("shows the headline metric and validation scheme once a model reports metrics", () => {
    const trained: ActiveModel = { ...BASELINE, version: "susc-gbm-0.2.0", stage: "CANDIDATE", thresholds: { calibrated: true }, metrics: { auc_roc: 0.8123 }, validation_scheme: "spatial block CV" };
    expect(modelEntry(trained).text).toBe("susc-gbm-0.2.0 · CANDIDATE — auc_roc 0.812 (spatial block CV)");
  });

  it("in LIVE mode with no weather provider, says stored history only and names the IMD API status", () => {
    const e = byKey(buildDataStrip({ sources: SOURCES, mode: { run_mode: "LIVE", monitor: { ...MONITOR_OK, weather_provider: "none", weather: null } }, model: BASELINE, riskMeta: undefined, leadTime: 0 }));
    expect(e.rainfall.tone).toBe("real");
    expect(e.rainfall.text).toContain("No weather provider connected — stored history only");
    expect(e.rainfall.note).toContain("IMD live API: AWAITING_ACCESS");
  });

  it("in LIVE mode with a connected provider, marks rainfall REAL live, names non-IMD and keeps the model-output note", () => {
    const e = byKey(buildDataStrip({ sources: LIVE_SOURCES, mode: { run_mode: "LIVE", monitor: MONITOR_OK }, model: BASELINE, riskMeta: undefined, leadTime: 0 }));
    expect(e.rainfall.tag).toBe("REAL_LIVE");
    expect(e.rainfall.tone).toBe("live");
    expect(e.rainfall.text).toContain("open-meteo (non-IMD)");
    expect(e.rainfall.text).toContain("27980 observations");
    expect(e.rainfall.note).toContain("not gauge observations");
    expect(e.rainfall.note).toContain("IMD live API: AWAITING_ACCESS");
    // The forecast follows the provider the cycle actually used, not the replay stand-in.
    expect(e.forecast.tone).toBe("live");
    expect(e.forecast.text).toContain("Open-Meteo");
    expect(e.forecast.text).toContain("non-IMD");
    expect(e.forecast.note).toContain("Forecast skill has not been evaluated");
  });

  it("keeps live, historical/replayed and unavailable in three distinct tones", () => {
    const e = byKey(buildDataStrip({ sources: LIVE_SOURCES, mode: { run_mode: "LIVE", monitor: MONITOR_OK }, model: BASELINE, riskMeta: undefined, leadTime: 0 }));
    expect(e.rainfall.tone).toBe("live");
    expect(e.terrain.tone).toBe("real");
    expect(e.soil.tone).toBe("simulated");
    expect(e.push.tone).toBe("not-connected");
    expect(new Set([e.rainfall.tone, e.terrain.tone, e.soil.tone, e.push.tone]).size).toBe(4);
  });
});

describe("forecastBanner", () => {
  it("returns nothing for the current lead time", () => {
    expect(forecastBanner(0, RISK_META, SOURCES)).toBeNull();
  });

  it("names a simulated stand-in and the missing skill evaluation", () => {
    const b = forecastBanner(48, RISK_META, SOURCES)!;
    expect(b.simulated).toBe(true);
    expect(b.text).toBe("SIMULATED FORECAST +48 h — replay stand-in, not a weather forecast · forecast skill not evaluated");
  });

  it("names a real forecast source without calling it simulated", () => {
    const meta: CollectionMetadata = { ...RISK_META, forecast_source: { slug: "imd-forecast", label: "IMD district forecast", connection_status: "CONNECTED_LIVE" } };
    const b = forecastBanner(24, meta, SOURCES)!;
    expect(b.simulated).toBe(false);
    expect(b.text).toContain("FORECAST +24 h — IMD district forecast (CONNECTED_LIVE)");
  });

  it("says so when no forecast source is reported", () => {
    const b = forecastBanner(72, { ...RISK_META, forecast_source: null }, SOURCES)!;
    expect(b.text).toContain("no forecast source reported");
  });
});

describe("replay helpers", () => {
  it("formats the zero-based step with the replay date", () => {
    expect(formatReplayStep(REPLAY_MODE.replay!)).toBe("Step 29/46 · 2017-06-14");
    expect(lastStep(REPLAY_MODE.replay!)).toBe(46);
  });

  it("detects a replay that has not been started", () => {
    expect(replayNotStarted({ run_mode: "DEMO_REPLAY", replay: null })).toBe(true);
    expect(replayNotStarted(REPLAY_MODE)).toBe(false);
    expect(replayNotStarted({ run_mode: "LIVE" })).toBe(false);
    expect(replayNotStarted(null)).toBe(false);
  });
});
