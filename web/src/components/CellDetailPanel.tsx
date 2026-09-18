import type { ApiClient } from "../api/client";
import type { CollectionMetadata, Factor, LandcoverProps, LeadTime, RiskZoneDetail } from "../api/types";
import { usePolling } from "../lib/usePolling";
import { severityColor, severityLabel } from "../lib/severity";
import { fmtDate, fmtTime, fmtValue } from "../lib/format";
import { landcoverColor } from "../lib/labels";
import { humanize } from "../lib/labels";
import { Disclaimer, ProvenanceBadge, VirtualSensorBadge } from "./Badges";
import { ResourceStatus } from "./ResourceStatus";
import { RainfallStrip } from "./RainfallStrip";

interface Props {
  client: ApiClient;
  cellId: string;
  leadTime: LeadTime;
  refreshKey: unknown;
  /** Land-cover class for this cell, from the landcover layer (satellite-derived, not imagery). */
  landcover?: LandcoverProps | null;
  landcoverMeta?: CollectionMetadata;
  /** The rainfall series endpoint is authority-only. */
  canSeeRainfall?: boolean;
  onOpenAlert?: (id: string) => void;
}

export function CellDetailPanel({ client, cellId, leadTime, refreshKey, landcover, landcoverMeta, canSeeRainfall, onOpenAlert }: Props) {
  // Identity = cell + lead time: switching either clears the panel, so a late response for the
  // previous cell or lead can never be shown here.
  const detail = usePolling((signal) => client.riskZone(cellId, leadTime, { signal }), null, [cellId, leadTime], refreshKey);
  if (!detail.data) return <ResourceStatus resource={detail} label="cell detail" />;
  return (
    <>
      <ResourceStatus resource={detail} label="cell detail" />
      <CellDetail detail={detail.data} leadTime={leadTime} landcover={landcover} landcoverMeta={landcoverMeta} onOpenAlert={onOpenAlert} />
      {canSeeRainfall && <RainfallStrip client={client} cellId={cellId} refreshKey={refreshKey} />}
    </>
  );
}

export function CellDetail({
  detail,
  leadTime,
  landcover,
  landcoverMeta,
  onOpenAlert,
}: {
  detail: RiskZoneDetail;
  leadTime?: LeadTime;
  landcover?: LandcoverProps | null;
  landcoverMeta?: CollectionMetadata;
  onOpenAlert?: (id: string) => void;
}) {
  const a = detail.assessment;
  const lead = a?.lead_time_h ?? leadTime ?? 0;
  return (
    <div className="cell-detail" aria-label="Risk zone detail" data-testid="cell-detail" data-cell-id={detail.id} data-lead-time={lead}>
      <h2>Cell <code data-testid="cell-grid-code">{detail.grid_code}</code></h2>
      {detail.admin_boundary && <div className="muted">{detail.admin_boundary.name}</div>}
      {!a ? (
        <p className="notice" data-testid="no-assessment">
          No assessment for this cell at this lead time yet ({lead === 0 ? "current" : `+${lead} h`}).
        </p>
      ) : (
        <>
          <div className="severity-row">
            <span className="severity-pill" style={{ background: severityColor(a.severity) }} data-testid="cell-severity">{severityLabel(a.severity)}</span>
            <span>Score <strong>{a.score.toFixed(2)}</strong></span>
            <span>Confidence <strong>{humanize(a.confidence)}</strong></span>
            <ProvenanceBadge provenance={a.provenance} />
          </div>
          <dl className="kv">
            <dt>Lead time</dt><dd>{a.lead_time_h === 0 ? "Current" : `Forecast +${a.lead_time_h} h`}</dd>
            <dt>Model version</dt><dd><code>{a.model_version}</code></dd>
            <dt>Issue time</dt><dd>{fmtTime(a.issue_time)}</dd>
            {(a.valid_from || a.valid_until) && (<><dt>Valid</dt><dd>{fmtTime(a.valid_from)} → {fmtTime(a.valid_until)}</dd></>)}
            <dt>Run mode</dt><dd>{a.run_mode}</dd>
          </dl>
          <h3>Why: contributing factors</h3>
          <FactorList factors={a.factors} />
        </>
      )}
      {landcover && (
        <div className="small landcover-line" data-testid="cell-landcover">
          <i className="swatch" style={{ background: landcoverColor(landcover.landcover_class) }} /> Land cover: <strong>{landcover.landcover_label}</strong>
          {landcover.landcover_tree_share != null ? ` · tree cover ${Math.round(landcover.landcover_tree_share * 100)}%` : ""} ·{" "}
          satellite-derived class, not imagery ({fmtDate(landcoverMeta?.acquisition_start)} to {fmtDate(landcoverMeta?.acquisition_end)}){" "}
          <ProvenanceBadge provenance={landcover.provenance} />
        </div>
      )}
      <h3>Exposure</h3>
      <ul className="exposure">
        <li>Villages: <strong>{detail.exposure.villages}</strong></li>
        <li>Schools: <strong>{detail.exposure.schools}</strong></li>
        <li>Health facilities: <strong>{detail.exposure.health_facilities}</strong></li>
        <li>Road segments at risk: <strong>{detail.exposure.road_segments_at_risk}</strong></li>
        {detail.exposure.road_segments_blocked !== undefined && <li>Road segments blocked: <strong>{detail.exposure.road_segments_blocked}</strong></li>}
        {detail.exposure.villages_access_at_risk !== undefined && <li>Villages with access at risk: <strong>{detail.exposure.villages_access_at_risk}</strong></li>}
      </ul>
      <h3>Open alerts</h3>
      {detail.open_alerts.length === 0 ? (
        <p className="muted">None</p>
      ) : (
        <ul className="plain">
          {detail.open_alerts.map((al) => (
            <li key={al.id}>
              <span className={`badge tier tier-${al.tier.toLowerCase()}`}>{al.tier}</span> {humanize(al.status)}{" "}
              {onOpenAlert && <button className="link" onClick={() => onOpenAlert(al.id)}>open</button>}
            </li>
          ))}
        </ul>
      )}
      <Disclaimer text={detail.disclaimer} />
    </div>
  );
}

export function FactorList({ factors }: { factors: Factor[] }) {
  if (factors.length === 0) return <p className="muted">No factors reported.</p>;
  // Zero contributions still render (with an empty bar): they state that an input had no effect.
  const max = Math.max(...factors.map((f) => Math.abs(f.contribution)), 1e-9);
  return (
    <ul className="factors" data-testid="factors">
      {factors.map((f) => {
        const up = f.direction === "increases_risk";
        // A zero contribution (e.g. no rainfall or sensor input) has no effect, whatever direction the model reports.
        const none = f.contribution === 0;
        return (
          <li key={`${f.feature}-${f.station_code ?? ""}`} className="factor" data-testid="factor">
            <div className="factor-head">
              <strong>{f.label}</strong>
              <span className="factor-value">{fmtValue(f.value, f.unit)}</span>
              <span className={`direction ${none ? "none" : up ? "up" : "down"}`}>{none ? "no effect" : up ? "▲ increases risk" : "▼ decreases risk"}</span>
            </div>
            <div className="bar" aria-label={`contribution ${f.contribution}`}>
              <div className={`bar-fill ${up ? "up" : "down"}`} style={{ width: `${(Math.abs(f.contribution) / max) * 100}%` }} />
              <span className="bar-label">{f.contribution.toFixed(2)}</span>
            </div>
            <div className="factor-text">{f.text}</div>
            <div className="factor-meta">
              <span className="badge component">{humanize(f.component)}</span>
              <ProvenanceBadge provenance={f.provenance} />
              {f.station_code && (
                <>
                  <span className="small">station <code>{f.station_code}</code></span>
                  {f.component === "SENSOR_ADJUSTMENT" && f.provenance === "SIMULATED_DEMO" && <VirtualSensorBadge />}
                </>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
