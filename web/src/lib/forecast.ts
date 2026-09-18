import type { CollectionMetadata, DataSource, LeadTime } from "../api/types";

export interface ForecastBanner {
  text: string;
  simulated: boolean;
}

/**
 * Text for the banner shown over the map whenever a forecast lead time is selected.
 * Simulated stand-ins are named as such; the forecast skill caveat is always included until evaluated.
 */
export function forecastBanner(leadTime: LeadTime, meta: CollectionMetadata | undefined, sources: DataSource[] | null): ForecastBanner | null {
  if (leadTime === 0) return null;
  const skill = meta?.forecast_skill_evaluated ? "forecast skill evaluated" : "forecast skill not evaluated";
  const src = meta?.forecast_source ?? null;
  const record = src ? sources?.find((s) => s.slug === src.slug) : undefined;
  const status = src?.connection_status ?? record?.connection_status;
  const simulated = status === "SIMULATED" || record?.provenance_default === "SIMULATED_DEMO" || /simulated|mock|replay/i.test(src?.label ?? "");
  if (!src) {
    return { text: `FORECAST +${leadTime} h — no forecast source reported for this layer · ${skill}`, simulated: false };
  }
  if (simulated) {
    return { text: `SIMULATED FORECAST +${leadTime} h — replay stand-in, not a weather forecast · ${skill}`, simulated: true };
  }
  return { text: `FORECAST +${leadTime} h — ${src.label} (${status ?? "status not reported"}) · ${skill}`, simulated: false };
}
