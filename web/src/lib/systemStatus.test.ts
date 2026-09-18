import { describe, expect, it } from "vitest";
import { countsSummary, freshness, groupAdapters, labelTone, licenceMarker, weatherSummary } from "./systemStatus";
import { effectiveLabelOf } from "./dataStrip";
import { EFFECTIVE_LABELS, type StatusAdapter, type SystemStatus } from "../api/types";

// Adapter rows trimmed from the local backends' GET /system/status (status records, not environmental data).
const row = (over: Partial<StatusAdapter> & Pick<StatusAdapter, "slug" | "kind" | "connection_status" | "effective_label">): StatusAdapter => ({
  age_s: null,
  is_imd: false,
  ...over,
});

const IMD_GRIDDED = row({ slug: "imd-gridded-rainfall", kind: "WEATHER_HISTORICAL", provider: "India Meteorological Department (IMD), Pune", dataset: "IMD 0.25° daily gridded rainfall", connection_status: "CONNECTED_HISTORICAL", effective_label: "REAL_REPLAY", is_imd: true, age_s: 8945, verification_status: "VERIFIED", licence: "No open licence found. IMD Pune website disclaimer: data 'should not be reproduced anywhere without prior permission'." });
const IMD_API = row({ slug: "imd-weather-api", kind: "WEATHER_LIVE", provider: "India Meteorological Department", connection_status: "AWAITING_ACCESS", effective_label: "AWAITING_ACCESS", is_imd: true });
const OPEN_METEO = row({ slug: "open-meteo-recent", kind: "WEATHER_HISTORICAL", provider: "Open-Meteo (free API)", connection_status: "CONNECTED_LIVE", effective_label: "REAL_LIVE", age_s: 2301, licence: "CC-BY 4.0 (Open-Meteo free API, non-commercial use)" });
const OPEN_METEO_FC = row({ slug: "open-meteo-forecast", kind: "WEATHER_FORECAST", provider: "Open-Meteo (free API)", connection_status: "CONNECTED_LIVE", effective_label: "REAL_LIVE", age_s: 2301 });
const REPLAY_FC = row({ slug: "replay-forecast", kind: "WEATHER_FORECAST", connection_status: "SIMULATED", effective_label: "SIMULATED" });
const GSI = row({ slug: "gsi-bhusanket", kind: "INVENTORY", connection_status: "CONNECTED_HISTORICAL", effective_label: "REAL_HISTORICAL", age_s: 3432, licence: "GSI Bhusanket Terms of Use … PERMISSION IS REQUIRED before any redistribution or public display." });
const NASA = row({ slug: "nasa-glc", kind: "INVENTORY", connection_status: "CONNECTED_HISTORICAL", effective_label: "REAL_HISTORICAL", age_s: 3432, licence: "NASA 'Permission to Use, Reproduce, and Distribute' text; data.nasa.gov legacy export lists 'License not specified'." });
const S2 = row({ slug: "sentinel2-composite", kind: "SATELLITE_LAYER", connection_status: "NOT_CONNECTED", effective_label: "NOT_CONNECTED", licence: "Not checked" });
const OSM = row({ slug: "osm-roads", kind: "EXPOSURE", connection_status: "CONNECTED_HISTORICAL", effective_label: "REAL_HISTORICAL", age_s: 60, licence: "Open Data Commons Open Database License (ODbL) 1.0" });
const SMS = row({ slug: "sms-channel", kind: "NOTIFICATION_CHANNEL", connection_status: "SANDBOX", effective_label: "SANDBOX" });

const base = (over: Partial<SystemStatus> = {}): SystemStatus => ({
  run_mode: "LIVE",
  replay: null,
  monitor: null,
  pilot: { slug: "aizawl-mizoram", name: "Aizawl, Mizoram (provisional pilot)", status: "PROVISIONAL" },
  model: null,
  adapters: {},
  label_counts: {},
  labels: {},
  disclaimer: "Decision-support risk estimate. Not an official warning.",
  as_of: "2026-09-18T06:00:00Z",
  ...over,
});

describe("label vocabulary", () => {
  it("maps each of the seven labels to a tone and distinguishes live, replay, historical and unavailable", () => {
    const tones = Object.fromEntries(EFFECTIVE_LABELS.map((l) => [l, labelTone(l)]));
    expect(tones).toEqual({
      REAL_LIVE: "live",
      REAL_REPLAY: "replay",
      REAL_HISTORICAL: "real",
      SIMULATED: "simulated",
      SANDBOX: "sandbox",
      AWAITING_ACCESS: "not-connected",
      NOT_CONNECTED: "not-connected",
    });
    expect(labelTone("CONNECTED_LIVE")).toBe("unknown");
  });

  it("prefers the API's effective_label and only derives one for plain data-source rows", () => {
    expect(effectiveLabelOf(IMD_GRIDDED)).toBe("REAL_REPLAY");
    const plain = { slug: "x", kind: "WEATHER_HISTORICAL", connection_status: "CONNECTED_HISTORICAL" as const };
    expect(effectiveLabelOf(plain)).toBe("REAL_HISTORICAL");
    expect(effectiveLabelOf(plain, { run_mode: "DEMO_REPLAY", replay: { scenario: "s", provenance: "REAL_HISTORICAL", step: 1, steps: 2 } })).toBe("REAL_REPLAY");
    expect(effectiveLabelOf({ slug: "v", kind: "SENSOR", connection_status: "CONNECTED_LIVE" as const, provenance_default: "SIMULATED_DEMO" as const })).toBe("SIMULATED");
  });

  it("summarises label counts in vocabulary order and skips zeros", () => {
    expect(countsSummary({ NOT_CONNECTED: 4, REAL_LIVE: 4, SANDBOX: 1, REAL_HISTORICAL: 9, SIMULATED: 2, AWAITING_ACCESS: 1, REAL_REPLAY: 0 })).toBe(
      "4 real live · 9 real historical · 2 simulated · 1 sandbox · 1 awaiting access · 4 not connected",
    );
    expect(countsSummary(null)).toBe("");
  });
});

describe("groupAdapters", () => {
  it("keeps the judge-facing order and never files a non-IMD provider under IMD weather", () => {
    const groups = groupAdapters({ weather: [OPEN_METEO, IMD_API, IMD_GRIDDED, REPLAY_FC, OPEN_METEO_FC], inventory: [NASA, GSI], satellite: [S2], exposure: [OSM], notification: [SMS] });
    expect(groups.map((g) => g.title)).toEqual([
      "IMD weather",
      "Weather fallback (non-IMD)",
      "Satellite",
      "Soil / sensors",
      "Historical landslides",
      "Terrain",
      "Exposure (roads, villages)",
      "Notifications",
    ]);
    expect(groups[0].items.map((a) => a.slug)).toEqual(["imd-gridded-rainfall", "imd-weather-api"]);
    expect(groups[1].items.map((a) => a.slug)).toEqual(["open-meteo-forecast", "open-meteo-recent", "replay-forecast"]);
    expect(groups.find((g) => g.title === "Terrain")?.items).toEqual([]);
    expect(groups.some((g) => g.title === "Other")).toBe(false);
  });

  it("sorts rows within a group by label order, then slug", () => {
    const [imd] = groupAdapters({ weather: [IMD_API, IMD_GRIDDED] });
    expect(imd.items.map((a) => a.effective_label)).toEqual(["REAL_REPLAY", "AWAITING_ACCESS"]);
  });
});

describe("freshness and licence markers", () => {
  it("formats age_s, falls back to the timestamp, and says never", () => {
    expect(freshness({ age_s: 240, last_success_at: "2026-09-18T05:56:00Z" })).toBe("updated 4 min ago");
    expect(freshness({ age_s: 5, last_success_at: null })).toBe("updated just now");
    expect(freshness({ age_s: 8945, last_success_at: null })).toBe("updated 2 h 29 min ago");
    expect(freshness({ age_s: null, last_success_at: "2026-09-18T05:56:00Z" })).toBe("updated 2026-09-18 05:56 UTC");
    expect(freshness({ age_s: null, last_success_at: null })).toBe("never");
  });

  it("marks permission-required, not-checked and unclear licences, and leaves open licences alone", () => {
    expect(licenceMarker(IMD_GRIDDED.licence)).toBe("permission-required");
    expect(licenceMarker(GSI.licence)).toBe("permission-required");
    expect(licenceMarker(NASA.licence)).toBe("unclear");
    expect(licenceMarker(S2.licence)).toBe("not-checked");
    expect(licenceMarker(OSM.licence)).toBeNull();
    expect(licenceMarker(OPEN_METEO.licence)).toBeNull();
    expect(licenceMarker(null)).toBeNull();
  });
});

describe("weatherSummary", () => {
  it("names a non-IMD fallback and the IMD API state explicitly", () => {
    const s = base({
      monitor: { enabled: true, interval_s: 180, weather_provider: "open-meteo", last_run_at: null, last_status: null, last_error: null, next_run_at: null, result: null, weather: { provider: "open-meteo", is_imd: false }, weather_error: null },
      adapters: { weather: [OPEN_METEO, OPEN_METEO_FC, IMD_API, IMD_GRIDDED] },
    });
    expect(weatherSummary(s).headline).toBe("Open-Meteo — non-IMD fallback; IMD API awaiting access");
    expect(weatherSummary(s).detail).toContain("open-meteo-recent");
  });

  it("describes a replay of real IMD rainfall when no provider is configured", () => {
    const s = base({
      run_mode: "DEMO_REPLAY",
      replay: { scenario: "pilot-rainfall-replay", provenance: "REAL_HISTORICAL", step: 29, steps: 47, as_of: "2017-06-14T00:00:00+00:00" },
      monitor: { enabled: false, interval_s: null, weather_provider: "none", last_run_at: null, last_status: null, last_error: null, next_run_at: null, result: null, weather: null, weather_error: null },
      adapters: { weather: [IMD_GRIDDED, IMD_API, REPLAY_FC] },
    });
    expect(weatherSummary(s).headline).toBe("Replay of real IMD rainfall (2017) — no live weather provider; IMD API awaiting access");
  });

  it("says plainly when nothing is connected", () => {
    const s = base({ adapters: { weather: [IMD_API] } });
    expect(weatherSummary(s).headline).toBe("No weather provider connected — no rainfall input; IMD API awaiting access");
    expect(weatherSummary(null).headline).toBe("Weather state not loaded");
  });
});
