// Turns GET /system/mode's `monitor` block into what the dashboard shows about the
// monitoring cycle and the weather provider. A failed or stopped cycle must never look like fresh data.
import type { DataSource, MonitorState, MonitorWeather, SystemMode } from "../api/types";

export type MonitorHealth = "UNKNOWN" | "NO_SCHEDULER" | "STOPPED" | "NEVER_RUN" | "OK" | "FAILED" | "STALE";

export interface MonitorView {
  health: MonitorHealth;
  /** Short status for the panel header, e.g. "Scheduler LIVE". */
  headline: string;
  /** One line of explanation under the headline. */
  detail: string;
  intervalLabel: string | null;
  lastRunAt: Date | null;
  /** Newest successful cycle as reported by the API (survives a later failure). */
  lastSuccessAt: Date | null;
  nextRunAt: Date | null;
  ageS: number | null;
  /** Prominent warning to show next to the risk map, or null when the cycle is healthy. */
  warning: { title: string; text: string } | null;
}

const DEFAULT_STALE_LIMIT_S = 600;
const STALE_INTERVALS = 3;

const parse = (iso: string | null | undefined): Date | null => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
};

export function fmtDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min`;
}

/** "in 2 min" / "2 min ago" / "just now". */
export function fmtRelative(when: Date | null, now: Date): string {
  if (!when) return "—";
  const diff = (when.getTime() - now.getTime()) / 1000;
  if (Math.abs(diff) < 20) return "just now";
  return diff > 0 ? `in ${fmtDuration(diff)}` : `${fmtDuration(-diff)} ago`;
}

export function monitorView(mode: SystemMode | null, now: Date): MonitorView {
  const base: MonitorView = {
    health: "UNKNOWN",
    headline: "Monitoring state unknown",
    detail: "The backend did not report monitoring state.",
    intervalLabel: null,
    lastRunAt: null,
    lastSuccessAt: null,
    nextRunAt: null,
    ageS: null,
    warning: null,
  };
  if (!mode) return { ...base, detail: "Run mode not loaded yet." };
  const m: MonitorState | null | undefined = mode.monitor;
  if (!m) return base;

  const lastRunAt = parse(m.last_run_at);
  const lastSuccessAt = parse(m.last_success_at) ?? (m.last_status === "OK" ? lastRunAt : null);
  const nextRunAt = parse(m.next_run_at);
  const ageS = lastRunAt ? (now.getTime() - lastRunAt.getTime()) / 1000 : null;
  const intervalLabel = m.interval_s ? `every ${fmtDuration(m.interval_s)}` : null;
  const lastSuccessText = lastSuccessAt
    ? `Last successful cycle ${fmtRelative(lastSuccessAt, now)} (${lastSuccessAt.toISOString().slice(11, 16)} UTC).`
    : "No successful cycle is recorded.";
  const common = { intervalLabel, lastRunAt, lastSuccessAt, nextRunAt, ageS };

  if (mode.run_mode === "DEMO_REPLAY") {
    return {
      ...base,
      ...common,
      health: "NO_SCHEDULER",
      headline: "No scheduler (DEMO_REPLAY)",
      detail: m.note || "Cycles run on replay steps, not on a timer.",
    };
  }
  if (!m.enabled) {
    return {
      ...base,
      ...common,
      health: "STOPPED",
      headline: "Scheduler STOPPED",
      detail: "No automatic monitoring cycles are running on the backend.",
      warning: {
        title: "Monitoring scheduler is stopped",
        text: `Risk shown here is only as fresh as the last cycle. ${lastSuccessText}`,
      },
    };
  }
  if (m.last_status === "FAILED") {
    return {
      ...base,
      ...common,
      health: "FAILED",
      headline: "Scheduler LIVE · last cycle FAILED",
      detail: m.last_error ? `Last error: ${m.last_error}` : "The backend reported a failure without an error message.",
      warning: {
        title: "Last monitoring cycle failed — displayed risk may be out of date",
        text: `${m.last_error ? `${m.last_error}. ` : ""}${lastSuccessText}`,
      },
    };
  }
  if (!lastRunAt) {
    return {
      ...base,
      ...common,
      health: "NEVER_RUN",
      headline: "Scheduler LIVE · no cycle yet",
      detail: `No monitoring cycle has run yet${nextRunAt ? `; first run ${fmtRelative(nextRunAt, now)}` : ""}.`,
      warning: {
        title: "No monitoring cycle has run yet",
        text: "Any risk shown comes from stored assessments, not from a completed cycle in this session.",
      },
    };
  }
  const staleLimitS = m.interval_s ? m.interval_s * STALE_INTERVALS : DEFAULT_STALE_LIMIT_S;
  if (ageS !== null && ageS > staleLimitS) {
    return {
      ...base,
      ...common,
      health: "STALE",
      headline: "Scheduler LIVE · cycles overdue",
      detail: `Last cycle ${fmtRelative(lastRunAt, now)}, more than ${STALE_INTERVALS}× the ${fmtDuration(m.interval_s ?? DEFAULT_STALE_LIMIT_S / STALE_INTERVALS)} interval.`,
      warning: {
        title: `No monitoring cycle for ${fmtDuration(ageS)} — displayed risk may be out of date`,
        text: `Expected one about ${intervalLabel ?? "on a timer"}. ${lastSuccessText}`,
      },
    };
  }
  return {
    ...base,
    ...common,
    health: "OK",
    headline: "Scheduler LIVE",
    detail: `Last cycle ${fmtRelative(lastRunAt, now)} · OK${nextRunAt ? ` · next ${fmtRelative(nextRunAt, now)}` : ""}.`,
  };
}

export interface WeatherSourceRow {
  role: "Observed" | "Forecast";
  /** null when the API did not report which source row the ingest wrote to. */
  slug: string | null;
  source: DataSource | null;
}

export interface WeatherView {
  /** No provider configured: rainfall comes from the replay or from stored history. */
  connected: boolean;
  provider: string;
  providerLabel: string;
  imdLabel: string;
  detail: string;
  counts: string | null;
  /** The last cycle reused a recent fetch rather than calling the provider. This is normal, not an error. */
  throttled: boolean;
  fetchedAt: string | null;
  rows: WeatherSourceRow[];
  error: string | null;
}

export function weatherView(monitor: MonitorState | null | undefined, sources: DataSource[] | null): WeatherView {
  const provider = (monitor?.weather_provider ?? "none") || "none";
  const w: MonitorWeather | null = monitor?.weather ?? null;
  const find = (slug: string | null | undefined) => (slug ? sources?.find((s) => s.slug === slug) ?? null : null);
  const none = provider === "none" || provider === "";
  const rows: WeatherSourceRow[] = none
    ? []
    : [
        { role: "Observed", slug: w?.observed_source ?? null, source: find(w?.observed_source) },
        { role: "Forecast", slug: w?.forecast_source ?? null, source: find(w?.forecast_source) },
      ];
  const skipped = w?.skipped ?? null;
  const lastFetch = w?.last_fetch_at ? new Date(w.last_fetch_at) : null;
  const fetchedAt = lastFetch && !Number.isNaN(lastFetch.getTime()) ? `${lastFetch.toISOString().slice(11, 16)} UTC` : null;
  // 0 observations is a real (and worrying) number; "not reported" is different and must not read as 0.
  const hasCounts = !!w && [w.points, w.observations, w.forecasts].some((v) => typeof v === "number");
  const num = (v: number | null | undefined) => (typeof v === "number" ? String(v) : "not reported");
  const historical = (sources ?? []).filter((s) => s.kind === "WEATHER_HISTORICAL" && (s.connection_status === "CONNECTED_HISTORICAL" || s.connection_status === "CONNECTED_LIVE"));
  return {
    connected: !none,
    provider,
    providerLabel: none ? "No weather provider connected" : provider,
    imdLabel: none ? "—" : w ? (w.is_imd ? "IMD source" : "Non-IMD source (H16)") : "IMD status not reported",
    detail: none
      ? `No live weather source is connected. Rainfall comes from the replay or from stored history${historical.length ? ` (${historical.map((s) => s.slug).join(", ")})` : ""}.`
      : skipped
        ? `Using data fetched at ${fetchedAt ?? "an unreported time"}; the last cycle reused it (${skipped}${w?.min_interval_s ? `, at most every ${fmtDuration(w.min_interval_s)}` : ""}).`
        : w
          ? `${w.is_imd ? "IMD" : "Non-IMD"} provider feeding rainfall observations and forecasts.`
          : "Provider configured, but no ingest has been reported yet.",
    counts:
      hasCounts && w
        ? skipped
          ? `No new rows in the last cycle (reused the fetch from ${fetchedAt ?? "an unreported time"})`
          : `${num(w.points)} provider points · ${num(w.observations)} observations · ${num(w.forecasts)} forecast rows`
        : null,
    throttled: !!skipped,
    fetchedAt,
    rows,
    error: monitor?.weather_error ?? null,
  };
}
