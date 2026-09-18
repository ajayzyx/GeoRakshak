// Derives the judge-facing "System status" panel from GET /system/status.
// Everything shown comes from the API's own vocabulary (`effective_label`); nothing is upgraded.
import type { AdapterGroupKey, StatusAdapter, SystemStatus } from "../api/types";
import { EFFECTIVE_LABELS } from "../api/types";
import { LABEL_TEXT } from "./dataStrip";
import { fmtDuration } from "./monitor";

export { LABEL_TONES, LABEL_TEXT, isEffectiveLabel, labelTone } from "./dataStrip";

/** "4 real live · 9 real historical · …" in the vocabulary order; zero counts are left out. */
export function countsSummary(counts: SystemStatus["label_counts"] | null | undefined): string {
  if (!counts) return "";
  return EFFECTIVE_LABELS.filter((l) => (counts[l] ?? 0) > 0)
    .map((l) => `${counts[l]} ${LABEL_TEXT[l]}`)
    .join(" · ");
}

export interface StatusGroup {
  key: string;
  title: string;
  items: StatusAdapter[];
}

/**
 * The judge-facing grouping. Weather is split so "IMD weather" never contains a non-IMD provider:
 * a fallback such as Open-Meteo sits in its own clearly named section right after it.
 */
export function groupAdapters(adapters: SystemStatus["adapters"] | null | undefined): StatusGroup[] {
  const get = (k: AdapterGroupKey) => adapters?.[k] ?? [];
  const weather = get("weather");
  const byLabel = (a: StatusAdapter, b: StatusAdapter) => EFFECTIVE_LABELS.indexOf(a.effective_label) - EFFECTIVE_LABELS.indexOf(b.effective_label) || a.slug.localeCompare(b.slug);
  const groups: StatusGroup[] = [
    { key: "imd-weather", title: "IMD weather", items: weather.filter((a) => a.is_imd) },
    { key: "weather-fallback", title: "Weather fallback (non-IMD)", items: weather.filter((a) => !a.is_imd) },
    { key: "satellite", title: "Satellite", items: get("satellite") },
    { key: "sensor", title: "Soil / sensors", items: get("sensor") },
    { key: "inventory", title: "Historical landslides", items: get("inventory") },
    { key: "terrain", title: "Terrain", items: get("terrain") },
    { key: "exposure", title: "Exposure (roads, villages)", items: get("exposure") },
    { key: "notification", title: "Notifications", items: get("notification") },
  ];
  const other = get("other");
  if (other.length) groups.push({ key: "other", title: "Other", items: other });
  return groups.map((g) => ({ ...g, items: [...g.items].sort(byLabel) }));
}

/** "updated 4 min ago" from `age_s`, or "never". */
export function freshness(adapter: Pick<StatusAdapter, "age_s" | "last_success_at">): string {
  if (typeof adapter.age_s === "number" && adapter.age_s >= 0) {
    return adapter.age_s < 20 ? "updated just now" : `updated ${fmtDuration(adapter.age_s)} ago`;
  }
  if (adapter.last_success_at) return `updated ${adapter.last_success_at.slice(0, 16).replace("T", " ")} UTC`;
  return "never";
}

export type LicenceMarker = "permission-required" | "not-checked" | "unclear" | null;

/** Caveats read from the recorded licence text. Open licences (CC-BY, ODbL, free) get no marker. */
export function licenceMarker(licence: string | null | undefined): LicenceMarker {
  if (!licence) return null;
  if (/no open licence|prior permission|permission is required|proper permission|permission needed|permission required/i.test(licence)) return "permission-required";
  if (/not checked/i.test(licence)) return "not-checked";
  if (/not specified|unclear/i.test(licence)) return "unclear";
  return null;
}

export const LICENCE_MARKER_TEXT: Record<Exclude<LicenceMarker, null>, string> = {
  "permission-required": "permission required for publication",
  "not-checked": "licence not checked",
  unclear: "licence unclear",
};

export interface WeatherSummary {
  headline: string;
  detail: string;
  imdStatus: string | null;
}

/** "Open-Meteo — non-IMD fallback; IMD API awaiting access", or the replay / none cases. */
export function weatherSummary(status: SystemStatus | null): WeatherSummary {
  if (!status) return { headline: "Weather state not loaded", detail: "", imdStatus: null };
  const weather = status.adapters.weather ?? [];
  const imdApi = weather.find((a) => a.is_imd && a.kind === "WEATHER_LIVE");
  const imdStatus = imdApi ? `IMD API ${LABEL_TEXT[imdApi.effective_label]}` : "IMD API not in the registry";
  const provider = status.monitor?.weather_provider ?? null;
  const live = weather.filter((a) => a.effective_label === "REAL_LIVE");
  if (provider && provider !== "none") {
    const w = status.monitor?.weather ?? null;
    const name = live[0]?.provider?.split("(")[0].trim() || provider;
    const isImd = w?.is_imd ?? live.some((a) => a.is_imd);
    return {
      headline: isImd ? `${name} — IMD source` : `${name} — non-IMD fallback; ${imdStatus}`,
      detail: live.length ? `${live.length} live source row(s): ${live.map((a) => a.slug).join(", ")}` : `Provider configured, no live source row yet`,
      imdStatus,
    };
  }
  const replay = weather.find((a) => a.effective_label === "REAL_REPLAY");
  if (replay) {
    const year = status.replay?.as_of ? ` (${status.replay.as_of.slice(0, 4)})` : "";
    return { headline: `Replay of real ${replay.is_imd ? "IMD" : replay.provider ?? ""} rainfall${year} — no live weather provider; ${imdStatus}`, detail: replay.dataset ?? replay.slug, imdStatus };
  }
  const stored = weather.filter((a) => a.effective_label === "REAL_HISTORICAL");
  return {
    headline: `No weather provider connected — ${stored.length ? "stored history only" : "no rainfall input"}; ${imdStatus}`,
    detail: stored.map((a) => a.slug).join(", "),
    imdStatus,
  };
}

/** Flattened adapter list, usable wherever a `DataSource[]` was expected. */
export function flattenAdapters(status: SystemStatus | null): StatusAdapter[] {
  if (!status) return [];
  return Object.values(status.adapters).flatMap((list) => list ?? []);
}
