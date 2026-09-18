import type {
  CollectionMetadata,
  FeatureCollection,
  LandcoverProps,
  LeadTime,
  RiskZoneCollection,
  RoadSegmentCollection,
  SatelliteLayer,
  SensorStationProps,
} from "../api/types";
import { LEAD_TIMES, ROAD_STATUSES } from "../api/types";
import { fmtDate, fmtTime } from "../lib/format";
import { LANDCOVER_FALLBACK_COLOR, ROAD_LEGEND_NOTE, ROAD_STATUS_COLORS, ROAD_STATUS_LABELS, landcoverColor } from "../lib/labels";
import { UNKNOWN_SEVERITY_COLOR, severityColor, severityLabel, severityLegend } from "../lib/severity";
import type { Polled } from "../lib/usePolling";
import { Disclaimer, ProvenanceBadge, VirtualSensorBadge } from "./Badges";
import type { LayerKey } from "./MapView";
import { ErrorBox } from "./ErrorBox";
import { Spinner, StaleBadge } from "./ResourceStatus";

export function LeadTimeToggle({ value, onChange }: { value: LeadTime; onChange: (lt: LeadTime) => void }) {
  return (
    <div className="seg-group" role="radiogroup" aria-label="Lead time">
      {LEAD_TIMES.map((lt) => (
        <button
          key={lt}
          role="radio"
          aria-checked={value === lt}
          className={value === lt ? "seg active" : "seg"}
          onClick={() => onChange(lt)}
          data-testid={`lead-${lt}`}
        >
          {lt === 0 ? "Current" : `+${lt} h`}
        </button>
      ))}
    </div>
  );
}

export function SeverityLegend() {
  return (
    <ul className="legend" aria-label="Severity legend">
      {severityLegend().map((e) => (
        <li key={e.key}><i className="swatch" style={{ background: e.color }} /> {e.label}</li>
      ))}
      <li><i className="swatch" style={{ background: UNKNOWN_SEVERITY_COLOR }} /> Unknown / not assessed</li>
    </ul>
  );
}

export function RoadLegend() {
  return (
    <div>
      <ul className="legend" aria-label="Road status legend">
        {ROAD_STATUSES.map((s) => (
          <li key={s}><i className="swatch line" style={{ background: ROAD_STATUS_COLORS[s] }} /> {ROAD_STATUS_LABELS[s]}</li>
        ))}
      </ul>
      <p className="small muted">{ROAD_LEGEND_NOTE}</p>
    </div>
  );
}

/** Source, issue time and validity of the risk layer currently shown. */
export function RiskLayerInfo({ metadata, leadTime }: { metadata: CollectionMetadata | undefined; leadTime: LeadTime }) {
  if (!metadata) return <p className="small muted">Risk layer metadata not loaded.</p>;
  const forecast = leadTime > 0;
  return (
    <div className={forecast ? "risk-info forecast" : "risk-info"}>
      <div className="small">
        <strong>{forecast ? `FORECAST +${leadTime} h` : "Current risk"}</strong> <ProvenanceBadge provenance={metadata.provenance} />
      </div>
      {forecast && (
        <div className="small">
          Forecast source: <strong>{metadata.forecast_source?.label ?? "not reported"}</strong>
          {metadata.forecast_source?.slug ? <> (<code>{metadata.forecast_source.slug}</code>)</> : null}
          {metadata.forecast_source?.connection_status ? <> · {metadata.forecast_source.connection_status}</> : null}
        </div>
      )}
      <div className="small">Issue time: {fmtTime(metadata.issue_time)}</div>
      {(metadata.valid_from || metadata.valid_until) && (
        <div className="small">Valid: {fmtTime(metadata.valid_from)} → {fmtTime(metadata.valid_until)}</div>
      )}
      <div className="small">Model: <code>{metadata.model_version ?? "not reported"}</code></div>
      {metadata.input_provenance && metadata.input_provenance.length > 0 && (
        <div className="small">Inputs: {metadata.input_provenance.map((p) => <ProvenanceBadge key={p} provenance={p} />)}</div>
      )}
      {forecast && metadata.forecast_skill_evaluated === false && <div className="small warn-text">Forecast skill not yet evaluated.</div>}
      <Disclaimer text={metadata.disclaimer} />
    </div>
  );
}

const LAYER_LABELS: Record<LayerKey, string> = {
  risk: "Risk zones",
  landcover: "Land cover (satellite-derived)",
  landslides: "Historical landslides",
  locations: "Villages & facilities",
  roads: "Road segments",
  stations: "Sensor stations",
  reports: "Field / citizen reports",
  satellite: "Satellite layers",
};

export interface LayerStatus {
  resource: Polled<unknown>;
  count: number | null;
}

export function LayerToggles({
  visible,
  onToggle,
  status,
}: {
  visible: Record<LayerKey, boolean>;
  onToggle: (k: LayerKey) => void;
  status: Partial<Record<LayerKey, LayerStatus>>;
}) {
  return (
    <ul className="plain layer-toggles">
      {(Object.keys(LAYER_LABELS) as LayerKey[]).map((k) => {
        const st = status[k];
        const r = st?.resource;
        return (
          <li key={k} data-testid={`layer-${k}`}>
            <label className="inline">
              <input type="checkbox" checked={visible[k]} onChange={() => onToggle(k)} /> {LAYER_LABELS[k]}
            </label>
            {r && r.data === null && r.loading && <Spinner label="loading…" />}
            {r && !r.loading && st.count !== null && <span className="muted small" data-testid={`layer-${k}-count`}>{st.count}</span>}
            {r && <StaleBadge resource={r} />}
            {r && r.data === null && r.error && <ErrorBox error={r.error} context={LAYER_LABELS[k]} onRetry={r.refresh} />}
          </li>
        );
      })}
    </ul>
  );
}

const SEVERITY_RANK: Record<string, number> = { VERY_HIGH: 3, HIGH: 2, MODERATE: 1, LOW: 0 };

/** Highest-scoring cells for the selected lead time, as a quick way to open them. */
export function TopCells({ risk, onSelect }: { risk: RiskZoneCollection | null; onSelect: (id: string) => void }) {
  if (!risk) return null;
  const top = [...risk.features]
    .filter((f) => f.id)
    .sort((a, b) => (SEVERITY_RANK[b.properties.severity] ?? -1) - (SEVERITY_RANK[a.properties.severity] ?? -1) || b.properties.score - a.properties.score)
    .slice(0, 5);
  if (top.length === 0) return <p className="small muted" data-testid="empty-top-cells">No assessed cells at this lead time.</p>;
  return (
    <ul className="plain quick-list" data-testid="top-cells">
      {top.map((f) => (
        <li key={f.id}>
          <button className="link" onClick={() => onSelect(f.id!)} data-testid="top-cell" data-cell-id={f.id}>
            <code>{f.properties.grid_code}</code>
          </button>{" "}
          <span className="severity-pill small" style={{ background: severityColor(f.properties.severity) }}>{severityLabel(f.properties.severity)}</span>{" "}
          <span className="small">{f.properties.score.toFixed(2)}</span>
        </li>
      ))}
    </ul>
  );
}

const ROAD_RANK: Record<string, number> = { BLOCKED: 3, AT_RISK: 2, UNKNOWN: 1, OPEN: 0 };

/** Road segments with the most severe status first (blocked, at risk, unknown, open). */
export function RoadStatusList({ roads, onSelect }: { roads: RoadSegmentCollection | null; onSelect: (id: string) => void }) {
  if (!roads) return null;
  const counts = roads.features.reduce<Record<string, number>>((acc, f) => ((acc[f.properties.status] = (acc[f.properties.status] ?? 0) + 1), acc), {});
  const top = [...roads.features]
    .filter((f) => f.id)
    .sort((a, b) => (ROAD_RANK[b.properties.status] ?? 0) - (ROAD_RANK[a.properties.status] ?? 0))
    .slice(0, 6);
  return (
    <div>
      <div className="small">
        {ROAD_STATUSES.map((s) => (
          <span key={s} className="chip"><i className="swatch line" style={{ background: ROAD_STATUS_COLORS[s] }} /> {s} {counts[s] ?? 0}</span>
        ))}
      </div>
      {top.length === 0 ? (
        <p className="small muted">No road segments loaded.</p>
      ) : (
        <ul className="plain quick-list" data-testid="road-list">
          {top.map((f) => (
            <li key={f.id}>
              <button className="link" onClick={() => onSelect(f.id!)} data-testid="road-item" data-road-id={f.id}>
                {f.properties.name || f.properties.road_class}
              </button>{" "}
              <span className="small"><code>{f.properties.status}</code></span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Legend for GET /layers/landcover: the classes actually present, with counts, the acquisition range
 * (CLAUDE.md §9 rule 12) and the attribution. Wording stays "derived class per cell", never imagery.
 */
export function LandcoverLegend({ landcover }: { landcover: FeatureCollection<LandcoverProps> | null }) {
  if (!landcover) return null;
  const meta = landcover.metadata ?? {};
  const labels = meta.class_labels ?? {};
  const counts = new Map<number, number>();
  landcover.features.forEach((f) => counts.set(f.properties.landcover_class, (counts.get(f.properties.landcover_class) ?? 0) + 1));
  const present = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const range =
    meta.acquisition_start || meta.acquisition_end
      ? `${fmtDate(meta.acquisition_start)} to ${fmtDate(meta.acquisition_end)}`
      : meta.acquisition_note || "acquisition range not reported";
  return (
    <div data-testid="landcover-legend">
      {present.length === 0 ? (
        <p className="small muted" data-testid="landcover-empty">No land-cover classes for this area.</p>
      ) : (
        <ul className="legend">
          {present.map(([code, n]) => (
            <li key={code} data-testid="landcover-class" data-class={code}>
              <i className="swatch" style={{ background: landcoverColor(code) }} /> {labels[String(code)] ?? `Class ${code}`} <span className="muted">{n}</span>
            </li>
          ))}
          {landcover.features.some((f) => !(String(f.properties.landcover_class) in labels)) && (
            <li><i className="swatch" style={{ background: LANDCOVER_FALLBACK_COLOR }} /> Unlisted class</li>
          )}
        </ul>
      )}
      <div className="small" data-testid="landcover-acquisition">Acquisition: {range}</div>
      <div className="small muted">
        {meta.note ?? "Majority land-cover class per analysis cell. Not an image."} <ProvenanceBadge provenance={meta.provenance} />
      </div>
      {meta.dataset && <div className="small muted">{meta.dataset}</div>}
      {meta.attribution && <div className="small muted" data-testid="landcover-attribution">{meta.attribution}</div>}
    </div>
  );
}

export function SatelliteList({ layers }: { layers: SatelliteLayer[] | null }) {
  if (!layers) return null;
  if (layers.length === 0) return <p className="small muted">No satellite layers reported.</p>;
  return (
    <ul className="plain">
      {layers.map((l) => (
        <li key={l.slug} className="small sat-item">
          <strong>{l.title}</strong> ({l.kind}) <ProvenanceBadge provenance={l.provenance} />
          <div>Acquisition: {fmtDate(l.acquisition_start)} to {fmtDate(l.acquisition_end)}</div>
          {!l.display && <div className="muted">No renderable map layer yet.</div>}
          {l.attribution_text && <div className="muted">{l.attribution_text}</div>}
        </li>
      ))}
    </ul>
  );
}

export function StationList({ stations, onSelect }: { stations: FeatureCollection<SensorStationProps> | null; onSelect: (id: string) => void }) {
  if (!stations || stations.features.length === 0) return null;
  return (
    <ul className="plain">
      {stations.features.map((f) => (
        <li key={f.properties.station_code} className="small">
          <button className="link" onClick={() => f.id && onSelect(f.id)}><code>{f.properties.station_code}</code></button>{" "}
          {f.properties.station_type === "VIRTUAL" && <VirtualSensorBadge />}{" "}
          {f.properties.latest_reading ? `${f.properties.latest_reading.value} ${f.properties.latest_reading.unit}` : "no reading"}
        </li>
      ))}
    </ul>
  );
}
