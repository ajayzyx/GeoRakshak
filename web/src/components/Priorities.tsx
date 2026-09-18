import type { PrioritiesResponse } from "../api/types";
import { fmtTime } from "../lib/format";
import type { Polled } from "../lib/usePolling";
import { ProvenanceBadge } from "./Badges";
import { ResourceStatus } from "./ResourceStatus";

interface Props {
  resource: Polled<PrioritiesResponse | null>;
  onShowCell: (id: string) => void;
}

export function PrioritiesPanel({ resource, onShowCell }: Props) {
  const data = resource.data;
  if (!data) return <ResourceStatus resource={resource} label="response priorities" />;
  return (
    <div data-testid="priorities">
      <ResourceStatus resource={resource} label="response priorities" />
      <p className="small muted">
        Rule version <code>{data.rule_version}</code> · computed {fmtTime(data.computed_at)} · {data.run_mode}. Only VERIFIED reports count.
      </p>
      {data.items.length === 0 ? (
        <p className="muted" data-testid="empty-priorities">No priority items yet</p>
      ) : (
        <ol className="priorities">
          {data.items.map((p) => (
            <li key={`${p.rank}-${p.risk_zone_id}`} className="card">
              <div className="item-head">
                <span className={`badge prio prio-${p.priority_level.toLowerCase()}`}>{p.priority_level}</span>
                <strong>#{p.rank}</strong>
                <span>score {p.priority_score.toFixed(2)}</span>
                <ProvenanceBadge provenance={p.provenance} />
              </div>
              <ul className="reasons">{p.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
              <button className="link" onClick={() => onShowCell(p.risk_zone_id)}>show cell</button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
