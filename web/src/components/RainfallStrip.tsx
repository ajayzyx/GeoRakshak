import type { ApiClient } from "../api/client";
import type { Provenance, RainfallForecastPoint, RainfallObservation, RainfallSeries } from "../api/types";
import { fmtTime } from "../lib/format";
import { usePolling } from "../lib/usePolling";
import { ProvenanceBadge } from "./Badges";
import { ResourceStatus } from "./ResourceStatus";

const OBSERVED_DAYS = 15;
const BAR_W = 9;
const GAP = 2;
const H = 46;

interface Bar {
  kind: "observed" | "forecast";
  mm: number;
  label: string;
}

/** Every provenance present is shown: a series can mix stored history with a live provider. */
function provenances(items: { provenance: Provenance }[]): Provenance[] {
  return Array.from(new Set(items.map((i) => i.provenance)));
}

const sources = (items: { source: string }[]) => Array.from(new Set(items.map((i) => i.source)));

export function RainfallBars({ observed, forecast }: { observed: RainfallObservation[]; forecast: RainfallForecastPoint[] }) {
  const obs = observed.slice(-OBSERVED_DAYS);
  const bars: Bar[] = [
    ...obs.map<Bar>((o) => ({ kind: "observed", mm: o.rainfall_mm, label: `${o.period_start.slice(0, 10)}: ${o.rainfall_mm} mm observed` })),
    ...forecast.map<Bar>((f) => ({ kind: "forecast", mm: f.rainfall_mm, label: `+${f.lead_time_h} h (${f.valid_start.slice(0, 10)}): ${f.rainfall_mm} mm forecast` })),
  ];
  if (bars.length === 0) return null;
  const max = Math.max(...bars.map((b) => b.mm), 1);
  const width = bars.length * (BAR_W + GAP);
  const summary = `Daily rainfall: ${obs.length} observed days up to ${obs.at(-1)?.period_start.slice(0, 10) ?? "?"}, then ${forecast.length} forecast days. Peak ${max} mm.`;
  return (
    <div className="rainfall-chart">
      <svg width={width} height={H} viewBox={`0 0 ${width} ${H}`} role="img" aria-label={summary} data-testid="rainfall-bars" data-bars={bars.length}>
        <defs>
          <pattern id="fc-hatch" width="4" height="4" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
            <rect width="4" height="4" fill="#ffe0b2" />
            <line x1="0" y1="0" x2="0" y2="4" stroke="#e65100" strokeWidth="2" />
          </pattern>
        </defs>
        {bars.map((b, i) => {
          const h = Math.max(1, (b.mm / max) * (H - 6));
          return (
            <rect
              key={i}
              x={i * (BAR_W + GAP)}
              y={H - h}
              width={BAR_W}
              height={h}
              fill={b.kind === "observed" ? "#1565c0" : "url(#fc-hatch)"}
              stroke={b.kind === "forecast" ? "#e65100" : "none"}
              strokeWidth={b.kind === "forecast" ? 0.5 : 0}
              data-kind={b.kind}
            >
              <title>{b.label}</title>
            </rect>
          );
        })}
      </svg>
      <div className="small muted">Peak {max} mm/day · bars left to right: oldest observed → forecast</div>
    </div>
  );
}

interface Props {
  client: ApiClient;
  cellId: string;
  refreshKey?: unknown;
}

/** Observed and forecast rainfall for one cell: the evidence behind the rainfall trigger factor. */
export function RainfallStrip({ client, cellId, refreshKey }: Props) {
  const series = usePolling((signal) => client.zoneRainfall(cellId, { signal }), null, [cellId], refreshKey ?? 0);
  return (
    <div data-testid="rainfall-strip">
      <h3>Rainfall behind this score</h3>
      <ResourceStatus resource={series} label="rainfall series" />
      {series.data && <RainfallSeriesView series={series.data} />}
    </div>
  );
}

export function RainfallSeriesView({ series }: { series: RainfallSeries }) {
  const { observed, forecast } = series;
  if (observed.length === 0 && forecast.length === 0) {
    return <p className="muted small" data-testid="rainfall-empty">No rainfall series recorded for this cell yet</p>;
  }
  const obsProv = provenances(observed);
  const fcProv = provenances(forecast);
  return (
    <div>
      <RainfallBars observed={observed} forecast={forecast} />
      <ul className="plain small">
        <li data-testid="rainfall-observed">
          <i className="swatch" style={{ background: "#1565c0" }} /> Observed ({observed.length} days){observed.length ? <> · {sources(observed).join(", ")}</> : null}{" "}
          {obsProv.map((p) => (
            <ProvenanceBadge key={p} provenance={p} />
          ))}
          {series.run_mode === "DEMO_REPLAY" && <span className="badge">replayed</span>}
        </li>
        <li data-testid="rainfall-forecast">
          <i className="swatch hatched" /> Forecast ({forecast.length} days){forecast.length ? <> · {sources(forecast).join(", ")}</> : null}{" "}
          {fcProv.map((p) => (
            <ProvenanceBadge key={p} provenance={p} />
          ))}
          {forecast.length > 0 && <span className="small muted">issued {fmtTime(forecast[0].issue_time)}</span>}
        </li>
      </ul>
      <div className="small muted">As of {fmtTime(series.as_of)} · {series.run_mode}</div>
    </div>
  );
}
