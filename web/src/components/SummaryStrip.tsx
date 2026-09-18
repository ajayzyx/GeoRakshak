import type { DashboardSummary, Severity } from "../api/types";
import { SEVERITIES, ROAD_STATUSES } from "../api/types";
import { severityColor, severityLabel } from "../lib/severity";
import { ROAD_STATUS_COLORS, humanize } from "../lib/labels";
import { fmtTime } from "../lib/format";

/** Counts in the documented order, followed by any extra keys the backend reports. */
function ordered(counts: Record<string, number> | undefined, known: readonly string[]): [string, number][] {
  const all = counts ?? {};
  const extras = Object.keys(all).filter((k) => !known.includes(k));
  return [...known, ...extras].map((k) => [k, all[k] ?? 0]);
}

export function SummaryStrip({ summary }: { summary: DashboardSummary }) {
  return (
    <div className="summary-strip" aria-label="Dashboard summary" data-testid="summary-strip">
      <div className="summary-group">
        <span className="summary-title">Risk zones</span>
        {SEVERITIES.map((s) => (
          <span key={s} className="chip" style={{ borderColor: severityColor(s) }}>
            <i className="swatch" style={{ background: severityColor(s) }} /> {severityLabel(s)} {summary.risk_zone_counts?.[s as Severity] ?? 0}
          </span>
        ))}
      </div>
      <div className="summary-group">
        <span className="summary-title">Alerts</span>
        {ordered(summary.alerts, ["DRAFT", "AUTO_DISPATCHED", "DISPATCHED"]).map(([k, n]) => (
          <span key={k} className="chip">{humanize(k)} {n}</span>
        ))}
      </div>
      <div className="summary-group">
        <span className="summary-title">Reports</span>
        {ordered(summary.reports, ["UNVERIFIED", "VERIFIED", "REJECTED"]).map(([k, n]) => (
          <span key={k} className="chip">{humanize(k)} {n}</span>
        ))}
      </div>
      <div className="summary-group">
        <span className="summary-title">Roads</span>
        {ordered(summary.road_segments, ROAD_STATUSES).map(([k, n]) => (
          <span key={k} className="chip">
            <i className="swatch" style={{ background: ROAD_STATUS_COLORS[k as keyof typeof ROAD_STATUS_COLORS] ?? "#757575" }} /> {k} {n}
          </span>
        ))}
      </div>
      <span className="muted small">{summary.as_of ? `as of ${fmtTime(summary.as_of)}` : "no assessment time reported yet"}</span>
    </div>
  );
}
