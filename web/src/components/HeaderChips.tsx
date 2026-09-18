import type { Pilot } from "../api/types";
import type { ModelInfo } from "../lib/dataStrip";
import { isBaselineWithoutAccuracy } from "../lib/dataStrip";

export function PilotName({ pilot }: { pilot: Pilot }) {
  return (
    <span className="pilot-name" data-testid="pilot-name">
      {pilot.name}
      {pilot.status === "PROVISIONAL" && <span className="badge provisional" data-testid="pilot-provisional">PROVISIONAL</span>}
    </span>
  );
}

export function ModelChip({ model }: { model: ModelInfo | null }) {
  if (model === null) return null;
  if (model === "none") return <span className="badge model-chip" data-testid="model-chip">no model registered</span>;
  if (model === "unavailable") return <span className="badge model-chip" data-testid="model-chip">model info unavailable</span>;
  return (
    <span className="badge model-chip" data-testid="model-chip" title={model.validation_scheme ?? undefined}>
      Model <code>{model.version}</code>
      {isBaselineWithoutAccuracy(model) ? " · baseline, no validated accuracy" : ` · ${model.stage}`}
    </span>
  );
}
