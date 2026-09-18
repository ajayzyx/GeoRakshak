import { SEVERITIES, type Severity } from "../api/types";

// Colour ramp for severity classes (low → very high). Thresholds are not decided here:
// the API returns the class; the dashboard only colours it.
export const SEVERITY_COLORS: Record<Severity, string> = {
  LOW: "#9ccc65",
  MODERATE: "#fdd835",
  HIGH: "#fb8c00",
  VERY_HIGH: "#c62828",
};

export const SEVERITY_LABELS: Record<Severity, string> = {
  LOW: "Low",
  MODERATE: "Moderate",
  HIGH: "High",
  VERY_HIGH: "Very High",
};

/** Colour used when a value is missing or outside the contract enum. Never guessed into a class. */
export const UNKNOWN_SEVERITY_COLOR = "#9e9e9e";

export function severityColor(severity: string | null | undefined): string {
  return severity && severity in SEVERITY_COLORS ? SEVERITY_COLORS[severity as Severity] : UNKNOWN_SEVERITY_COLOR;
}

export function severityLabel(severity: string | null | undefined): string {
  return severity && severity in SEVERITY_LABELS ? SEVERITY_LABELS[severity as Severity] : "Unknown";
}

export interface LegendEntry {
  key: string;
  label: string;
  color: string;
}

export function severityLegend(): LegendEntry[] {
  return SEVERITIES.map((s) => ({ key: s, label: SEVERITY_LABELS[s], color: SEVERITY_COLORS[s] }));
}

/** MapLibre `match` expression for fill-color by `severity` property. */
export function severityColorExpression(): unknown[] {
  return ["match", ["get", "severity"], ...SEVERITIES.flatMap((s) => [s, SEVERITY_COLORS[s]]), UNKNOWN_SEVERITY_COLOR];
}
