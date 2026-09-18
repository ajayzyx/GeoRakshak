// Derives the always-visible "Data in this view" strip from the honesty endpoints.
// Only states what the API reports; anything missing is shown as not reported, never assumed.
// Tags use the seven-value display vocabulary of GET /system/status (`effective_label`), so this
// strip and the System status panel never disagree.
import type { ActiveModel, CollectionMetadata, DataSource, EffectiveLabel, LeadTime, StatusAdapter, SystemMode } from "../api/types";
import { EFFECTIVE_LABELS } from "../api/types";

// Visual families: connected now (live), real but replayed, real historical, simulated, sandbox,
// unavailable (awaiting access or not connected), model output, and unknown.
export type StripTone = "live" | "replay" | "real" | "simulated" | "sandbox" | "not-connected" | "model" | "unknown";

/** Tone per display label; shared with the System status panel. */
export const LABEL_TONES: Record<EffectiveLabel, StripTone> = {
  REAL_LIVE: "live",
  REAL_REPLAY: "replay",
  REAL_HISTORICAL: "real",
  SIMULATED: "simulated",
  SANDBOX: "sandbox",
  AWAITING_ACCESS: "not-connected",
  NOT_CONNECTED: "not-connected",
};

export const LABEL_TEXT: Record<EffectiveLabel, string> = {
  REAL_LIVE: "real live",
  REAL_REPLAY: "real replay",
  REAL_HISTORICAL: "real historical",
  SIMULATED: "simulated",
  SANDBOX: "sandbox",
  AWAITING_ACCESS: "awaiting access",
  NOT_CONNECTED: "not connected",
};

export function isEffectiveLabel(v: unknown): v is EffectiveLabel {
  return typeof v === "string" && (EFFECTIVE_LABELS as readonly string[]).includes(v);
}

export function labelTone(label: string | null | undefined): StripTone {
  return isEffectiveLabel(label) ? LABEL_TONES[label] : "unknown";
}

/**
 * Display label of a source. Uses the API's `effective_label` when the source came from
 * GET /system/status; otherwise derives it from the connection status and default provenance.
 */
export function effectiveLabelOf(s: DataSource | StatusAdapter, mode: SystemMode | null = null): EffectiveLabel {
  const given = (s as StatusAdapter).effective_label;
  if (isEffectiveLabel(given)) return given;
  switch (s.connection_status) {
    case "CONNECTED_LIVE":
      return s.provenance_default === "SIMULATED_DEMO" ? "SIMULATED" : "REAL_LIVE";
    case "CONNECTED_HISTORICAL":
      if (s.provenance_default === "SIMULATED_DEMO") return "SIMULATED";
      return mode?.run_mode === "DEMO_REPLAY" && s.kind === "WEATHER_HISTORICAL" && mode.replay?.provenance === "REAL_HISTORICAL" ? "REAL_REPLAY" : "REAL_HISTORICAL";
    case "SIMULATED":
      return "SIMULATED";
    case "SANDBOX":
      return "SANDBOX";
    case "AWAITING_ACCESS":
      return "AWAITING_ACCESS";
    default:
      return "NOT_CONNECTED";
  }
}

export interface StripEntry {
  key: "terrain" | "landslides" | "roads" | "facilities" | "landcover" | "rainfall" | "forecast" | "soil" | "sms" | "push" | "model";
  label: string;
  /** One of the seven display labels, or UNKNOWN / NOT STARTED / NONE / MODEL_OUTPUT. */
  tag: string;
  tone: StripTone;
  text: string;
  note?: string;
  /** The source row that decided the tag, when one did. */
  slug?: string;
}

/** `none` = the API answered 404 (no model registered); `unavailable` = not loaded or not permitted. */
export type ModelInfo = ActiveModel | "none" | "unavailable";

export interface StripInput {
  sources: DataSource[] | null;
  mode: SystemMode | null;
  model: ModelInfo;
  riskMeta: CollectionMetadata | undefined;
  leadTime: LeadTime;
}

const CONNECTED_LABELS: EffectiveLabel[] = ["REAL_LIVE", "REAL_REPLAY", "REAL_HISTORICAL", "SIMULATED"];

function sourceName(s: DataSource): string {
  return s.provider?.trim() || s.dataset?.trim() || s.slug;
}

function names(list: DataSource[]): string {
  return Array.from(new Set(list.map(sourceName))).join("; ");
}

const tagged = (key: StripEntry["key"], label: string, lab: EffectiveLabel, text: string, extra: Partial<StripEntry> = {}): StripEntry => ({
  key,
  label,
  tag: lab,
  tone: LABEL_TONES[lab],
  text,
  ...extra,
});

/** Entry for a set of sources of one kind: the connected ones decide the label. */
function staticEntry(key: StripEntry["key"], label: string, list: DataSource[] | undefined, sourcesLoaded: boolean, mode: SystemMode | null): StripEntry {
  if (!sourcesLoaded) return { key, label, tag: "UNKNOWN", tone: "unknown", text: "Source status not loaded" };
  const all = list ?? [];
  const labelled = all.map((s) => ({ s, lab: effectiveLabelOf(s, mode) }));
  const connected = labelled.filter((x) => CONNECTED_LABELS.includes(x.lab));
  if (connected.length === 0) {
    const first = labelled.sort((a, b) => EFFECTIVE_LABELS.indexOf(a.lab) - EFFECTIVE_LABELS.indexOf(b.lab))[0];
    if (!first) return { key, label, tag: "NOT_CONNECTED", tone: "not-connected", text: "No source reported" };
    return tagged(key, label, first.lab, `${names(all)} — ${LABEL_TEXT[first.lab]}`, { slug: first.s.slug });
  }
  if (connected.some((x) => x.lab === "SIMULATED")) {
    const sim = connected.filter((x) => x.lab === "SIMULATED");
    return tagged(key, label, "SIMULATED", names(sim.map((x) => x.s)), { slug: sim[0].s.slug });
  }
  const best = connected.every((x) => x.lab === "REAL_LIVE") ? "REAL_LIVE" : connected.some((x) => x.lab === "REAL_REPLAY") ? "REAL_REPLAY" : "REAL_HISTORICAL";
  return tagged(key, label, best, names(connected.map((x) => x.s)), { slug: connected[0].s.slug });
}

const isImd = (s: DataSource) => (s as StatusAdapter).is_imd === true || /(^|[^a-z])imd([^a-z]|$)|india meteorological/i.test(`${s.slug} ${s.provider ?? ""}`);

/** Short note about the IMD live API, so "IMD" is never implied when it is only awaiting access. */
function imdApiNote(sources: DataSource[] | null, mode: SystemMode | null): string | null {
  const api = (sources ?? []).find((s) => s.kind === "WEATHER_LIVE" && isImd(s));
  if (!api) return null;
  const lab = effectiveLabelOf(api, mode);
  return lab === "REAL_LIVE" ? null : `IMD live API: ${lab}${api.status_note ? ` — ${api.status_note}` : ""}`;
}

const joinNotes = (...parts: (string | null | undefined)[]) => {
  const kept = parts.filter(Boolean) as string[];
  return kept.length ? kept.join(" · ") : undefined;
};

function rainfallEntry(sources: DataSource[] | null, mode: SystemMode | null): StripEntry {
  const label = "Rainfall";
  if (!mode) return { key: "rainfall", label, tag: "UNKNOWN", tone: "unknown", text: "Run mode not loaded" };
  const historical = (sources ?? []).filter((s) => s.kind === "WEATHER_HISTORICAL");
  const imd = historical.find(isImd);
  const licenceNote = imd?.licence ? `${imd.slug} licence: ${imd.licence}` : undefined;
  const apiNote = imdApiNote(sources, mode);
  if (mode.run_mode === "DEMO_REPLAY") {
    const replay = mode.replay;
    if (!replay) return { key: "rainfall", label, tag: "NOT STARTED", tone: "unknown", text: "Replay not started — no rainfall input yet", note: joinNotes(apiNote, licenceNote) };
    const year = replay.as_of ? replay.as_of.slice(0, 4) : null;
    if (replay.provenance === "REAL_HISTORICAL") {
      const row = imd ?? historical[0];
      const who = imd ? "IMD" : historical.length ? names(historical) : "unnamed source";
      return tagged("rainfall", label, "REAL_REPLAY", `Replay of real historical ${who} rainfall${year ? ` (${year})` : ""}`, { note: joinNotes(apiNote, licenceNote), slug: row?.slug });
    }
    return tagged("rainfall", label, "SIMULATED", "Simulated rainfall replay scenario", { note: joinNotes(apiNote, licenceNote) });
  }
  // LIVE run mode: what the monitoring cycle actually ingested decides the label.
  const monitor = mode.monitor ?? null;
  const provider = monitor?.weather_provider ?? null;
  const weather = monitor?.weather ?? null;
  const observed = weather?.observed_source ? (sources ?? []).find((s) => s.slug === weather.observed_source) : undefined;
  if (provider && provider !== "none" && weather) {
    const who = weather.is_imd ? "IMD" : `${weather.provider} (non-IMD)`;
    const lab = observed ? effectiveLabelOf(observed, mode) : "NOT_CONNECTED";
    return tagged("rainfall", label, lab, `${who}${weather.observations ? ` · ${weather.observations} observations` : ""}${observed ? ` · ${observed.slug}` : " · source row not reported"}`, {
      note: joinNotes(observed?.status_note, apiNote, licenceNote),
      slug: observed?.slug,
    });
  }
  const liveSources = (sources ?? []).filter((s) => s.kind === "WEATHER_LIVE");
  const connectedLive = liveSources.filter((s) => effectiveLabelOf(s, mode) === "REAL_LIVE");
  if (connectedLive.length) return tagged("rainfall", label, "REAL_LIVE", names(connectedLive), { note: joinNotes(apiNote, licenceNote), slug: connectedLive[0].slug });
  const stored = historical.filter((s) => ["REAL_HISTORICAL", "REAL_REPLAY", "REAL_LIVE"].includes(effectiveLabelOf(s, mode)));
  if (provider === "none" || provider === null) {
    if (stored.length) {
      return tagged("rainfall", label, "REAL_HISTORICAL", `No weather provider connected — stored history only (${stored.map((s) => s.slug).join(", ")})`, { note: joinNotes(apiNote, licenceNote), slug: stored[0].slug });
    }
    return tagged("rainfall", label, "NOT_CONNECTED", "No weather provider connected and no stored rainfall history", { note: joinNotes(apiNote, licenceNote) });
  }
  const first = liveSources[0];
  return tagged("rainfall", label, first ? effectiveLabelOf(first, mode) : "NOT_CONNECTED", liveSources.length ? liveSources.map((s) => `${sourceName(s)}: ${effectiveLabelOf(s, mode)}`).join("; ") : "No live rainfall source reported", {
    note: joinNotes(apiNote, licenceNote),
    slug: first?.slug,
  });
}

function forecastEntry(sources: DataSource[] | null, meta: CollectionMetadata | undefined, leadTime: LeadTime, mode: SystemMode | null): StripEntry {
  const label = "Forecast";
  const fromMeta = leadTime > 0 ? meta?.forecast_source : null;
  const registry = (sources ?? []).filter((s) => s.kind === "WEATHER_FORECAST");
  const fromMonitor = mode?.monitor?.weather?.forecast_source ?? null;
  const record = fromMeta ? registry.find((s) => s.slug === fromMeta.slug) : (fromMonitor ? registry.find((s) => s.slug === fromMonitor) : undefined) ?? registry[0];
  const skill = meta?.forecast_skill_evaluated ? "" : " · skill not evaluated";
  if (!fromMeta && !record) return { key: "forecast", label, tag: "NONE", tone: "not-connected", text: "No forecast source reported" };
  const name = fromMeta?.label ?? (record ? sourceName(record) : "forecast");
  const lab: EffectiveLabel = record
    ? effectiveLabelOf(record, mode)
    : fromMeta?.connection_status === "CONNECTED_LIVE"
      ? "REAL_LIVE"
      : fromMeta?.connection_status === "SIMULATED"
        ? "SIMULATED"
        : "NOT_CONNECTED";
  if (lab === "SIMULATED") {
    return tagged("forecast", label, lab, `Simulated stand-in (${name}) — not a weather forecast${skill}`, { note: record?.status_note ?? undefined, slug: record?.slug });
  }
  if (lab === "REAL_LIVE") {
    const nonImd = record && !isImd(record) ? " (non-IMD)" : "";
    return tagged("forecast", label, lab, `${name}${nonImd}${skill}`, { note: record?.status_note ?? undefined, slug: record?.slug });
  }
  return tagged("forecast", label, lab, `${name}${skill}`, { note: record?.status_note ?? undefined, slug: record?.slug });
}

function soilEntry(sources: DataSource[] | null, mode: SystemMode | null): StripEntry {
  const label = "Soil moisture";
  if (!sources) return { key: "soil", label, tag: "UNKNOWN", tone: "unknown", text: "Source status not loaded" };
  const sensors = sources.filter((s) => s.kind === "SENSOR").map((s) => ({ s, lab: effectiveLabelOf(s, mode) }));
  const live = sensors.filter((x) => x.lab === "REAL_LIVE");
  const virtual = sensors.filter((x) => x.lab === "SIMULATED");
  if (live.length) return tagged("soil", label, "REAL_LIVE", names(live.map((x) => x.s)), { slug: live[0].s.slug });
  if (virtual.length) return tagged("soil", label, "SIMULATED", "Virtual sensors (simulated) — no physical sensors connected", { slug: virtual[0].s.slug });
  const first = sensors[0];
  return tagged("soil", label, first?.lab ?? "NOT_CONNECTED", "No sensor source connected", { slug: first?.s.slug });
}

function channelEntry(key: "sms" | "push", label: string, sources: DataSource[] | null, match: RegExp, mode: SystemMode | null): StripEntry {
  if (!sources) return { key, label, tag: "UNKNOWN", tone: "unknown", text: "Channel status not loaded" };
  const channel = sources.find((s) => s.kind === "NOTIFICATION_CHANNEL" && match.test(s.slug));
  if (!channel) return { key, label, tag: "NOT REPORTED", tone: "unknown", text: "Channel not in the status registry" };
  const lab = effectiveLabelOf(channel, mode);
  const text: Record<EffectiveLabel, string> = {
    SANDBOX: "Sandbox — not sent",
    REAL_LIVE: "Connected",
    SIMULATED: "Simulated — not sent",
    REAL_REPLAY: "Replayed — not sent",
    REAL_HISTORICAL: "Historical record only",
    AWAITING_ACCESS: "Awaiting access",
    NOT_CONNECTED: "Not connected",
  };
  return tagged(key, label, lab, text[lab], { slug: channel.slug, note: channel.status_note ?? undefined });
}

export function isBaselineWithoutAccuracy(m: ActiveModel): boolean {
  return m.metrics === null || m.metrics === undefined || m.thresholds?.calibrated === false || m.validated === false;
}

function headlineMetric(metrics: Record<string, unknown>): string | null {
  const preferred = ["headline", "auc_roc", "roc_auc", "auc", "pr_auc"];
  const key = preferred.find((k) => metrics[k] !== undefined) ?? Object.keys(metrics).find((k) => typeof metrics[k] === "number");
  if (!key) return null;
  const v = metrics[key];
  return `${key} ${typeof v === "number" ? v.toFixed(3) : String(v)}`;
}

export function modelEntry(model: ModelInfo): StripEntry {
  const label = "Model";
  if (model === "none") return { key: "model", label, tag: "NONE", tone: "unknown", text: "No model registered" };
  if (model === "unavailable") return { key: "model", label, tag: "UNKNOWN", tone: "unknown", text: "Model info not loaded" };
  const id = `${model.version} · ${model.stage}`;
  if (isBaselineWithoutAccuracy(model)) {
    const kind = /rule/i.test(model.model_type) ? "rule-based baseline" : "baseline";
    return { key: "model", label, tag: "MODEL_OUTPUT", tone: "model", text: `${id} — ${kind} — no validated accuracy`, note: model.thresholds?.note };
  }
  const metric = model.metrics ? headlineMetric(model.metrics) : null;
  return {
    key: "model",
    label,
    tag: "MODEL_OUTPUT",
    tone: "model",
    text: `${id}${metric ? ` — ${metric}` : ""}${model.validation_scheme ? ` (${model.validation_scheme})` : ""}`,
  };
}

export function buildDataStrip(input: StripInput): StripEntry[] {
  const { sources, mode, model, riskMeta, leadTime } = input;
  const loaded = sources !== null;
  const byKind = (kind: string) => sources?.filter((s) => s.kind === kind);
  const exposure = byKind("EXPOSURE") ?? [];
  // Exposure sources share one kind; roads are told apart by slug only (dataset text can mention highways).
  const roadLike = (s: DataSource) => /road|highway/i.test(s.slug);
  return [
    staticEntry("terrain", "Terrain", byKind("TERRAIN"), loaded, mode),
    staticEntry("landslides", "Landslide records", byKind("INVENTORY"), loaded, mode),
    staticEntry("roads", "Roads", exposure.filter(roadLike), loaded, mode),
    staticEntry("facilities", "Villages & facilities", exposure.filter((s) => !roadLike(s)), loaded, mode),
    staticEntry("landcover", "Satellite layers", byKind("SATELLITE_LAYER"), loaded, mode),
    rainfallEntry(sources, mode),
    forecastEntry(sources, riskMeta, leadTime, mode),
    soilEntry(sources, mode),
    channelEntry("sms", "SMS", sources, /sms/i, mode),
    channelEntry("push", "Push", sources, /push/i, mode),
    modelEntry(model),
  ];
}
