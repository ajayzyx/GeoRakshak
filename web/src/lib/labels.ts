import { ROAD_STATUSES, type ConnectionStatus, type Provenance, type Role, type RoadStatus } from "../api/types";

export const PROVENANCE_LABELS: Record<Provenance, string> = {
  REAL_LIVE: "Real · live",
  REAL_HISTORICAL: "Real · historical",
  SIMULATED_DEMO: "Simulated",
  MODEL_OUTPUT: "Model output",
};

export const CONNECTION_LABELS: Record<ConnectionStatus, string> = {
  CONNECTED_LIVE: "Connected (live)",
  CONNECTED_HISTORICAL: "Connected (historical data)",
  SIMULATED: "Simulated",
  SANDBOX: "Sandbox — not sent",
  AWAITING_ACCESS: "Awaiting access",
  NOT_CONNECTED: "Not connected",
};

export const ROAD_STATUS_COLORS: Record<RoadStatus, string> = {
  OPEN: "#2e7d32",
  AT_RISK: "#f9a825",
  BLOCKED: "#c62828",
  UNKNOWN: "#757575",
};

export const ROAD_STATUS_LABELS: Record<RoadStatus, string> = {
  OPEN: "Open (no evidence of blockage)",
  AT_RISK: "At risk",
  BLOCKED: "Blocked",
  UNKNOWN: "Unknown",
};

export const ROAD_LEGEND_NOTE = "OPEN = no evidence of blockage, not confirmed passable";

const ROAD_SOURCE_LABELS: Record<string, string> = {
  MODEL_RISK: "Model risk (MODEL_RISK) — segment in a High/Very High cell",
  VERIFIED_REPORT: "Verified field report (VERIFIED_REPORT)",
  AUTHORITY_OVERRIDE: "Authority override (AUTHORITY_OVERRIDE)",
  NONE: "None — no evidence recorded (NONE)",
};

export function roadStatusSourceLabel(source: string | null | undefined): string {
  if (!source) return "Not reported";
  return ROAD_SOURCE_LABELS[source] ?? source;
}

export function roadColorExpression(): unknown[] {
  return ["match", ["get", "status"], ...ROAD_STATUSES.flatMap((s) => [s, ROAD_STATUS_COLORS[s]]), "#757575"];
}

/** ESA WorldCover class colours, keyed by class code. Unknown codes fall back to grey. */
export const LANDCOVER_COLORS: Record<number, string> = {
  10: "#246a24",
  20: "#ffbb22",
  30: "#f096ff",
  40: "#f0f0a0",
  50: "#c4281b",
  60: "#b4b4b4",
  70: "#f0f0f0",
  80: "#0064c8",
  90: "#0096a0",
  95: "#00cf75",
  100: "#fae6a0",
};
export const LANDCOVER_FALLBACK_COLOR = "#9e9e9e";

export function landcoverColor(code: number | null | undefined): string {
  return (code != null && LANDCOVER_COLORS[code]) || LANDCOVER_FALLBACK_COLOR;
}

/** MapLibre `match` expression for fill-color by `landcover_class`. */
export function landcoverColorExpression(): unknown[] {
  return ["match", ["get", "landcover_class"], ...Object.entries(LANDCOVER_COLORS).flatMap(([code, color]) => [Number(code), color]), LANDCOVER_FALLBACK_COLOR];
}

export const AUTHORITY_ROLES: readonly Role[] = ["ADMIN", "STATE_AUTHORITY", "DISTRICT_AUTHORITY"];
export const isAuthority = (role: Role | undefined): boolean => !!role && AUTHORITY_ROLES.includes(role);

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Admin",
  STATE_AUTHORITY: "State authority",
  DISTRICT_AUTHORITY: "District authority",
  FIELD_OFFICER: "Field officer",
  CITIZEN: "Citizen",
};

export function deliveryStatusLabel(status: string, channelMode: string): { text: string; tone: "ok" | "warn" | "bad" | "neutral" } {
  // Sandbox deliveries are never shown as sent (CLAUDE.md §4a).
  if (status === "SANDBOXED") return { text: "Sandbox — not sent", tone: "warn" };
  if (channelMode === "SANDBOX" && (status === "SENT" || status === "ACKNOWLEDGED")) {
    return { text: `Inconsistent: sandbox channel reported ${status} (treat as not sent)`, tone: "bad" };
  }
  switch (status) {
    case "SENT": return { text: "Sent", tone: "ok" };
    case "ACKNOWLEDGED": return { text: "Acknowledged", tone: "ok" };
    case "QUEUED": return { text: "Queued", tone: "neutral" };
    case "FAILED": return { text: "Failed", tone: "bad" };
    default: return { text: status, tone: "neutral" };
  }
}

export function humanize(v: string | null | undefined): string {
  if (!v) return "—";
  return v.charAt(0) + v.slice(1).toLowerCase().replace(/_/g, " ");
}
