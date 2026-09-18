import { MAX_MEDIA_PER_REPORT } from './media';
import { ReportStore } from './reportStore';
import { toIsoWithOffset } from './time';
import {
  Clock,
  CreateReportPayload,
  LocalMedia,
  LocalReport,
  MediaType,
  REPORT_CATEGORIES,
  REPORT_SEVERITIES,
  ReportCategory,
  ReportSeverity,
} from './types';

export const DESCRIPTION_MAX_CHARS = 2000;

/** A media file already copied into app storage and checked against api.md §5.7 limits. */
export interface DraftMedia {
  media_type: MediaType;
  local_uri: string;
  mime_type: string;
  size_bytes: number;
  duration_s: number | null;
  captured_at: string;
}

export interface ReportDraft {
  category: ReportCategory | null;
  severity: ReportSeverity | null;
  description: string;
  lat: number | null;
  lon: number | null;
  /** Accuracy reported by the last GPS fix, if any. */
  gps_accuracy_m: number | null;
  /** Disclosed to the server as `location_adjusted_manually`. */
  location_adjusted_manually: boolean;
  /**
   * For a manually placed pin: the reporter's estimate of how far off it may be.
   * The server requires `gps_accuracy_m > 0` on every report, so a manual pin
   * sends this estimate instead of a GPS value (the flag above discloses that).
   */
  manual_uncertainty_m: number | null;
  alert_id: string | null;
  media: DraftMedia[];
}

export function emptyDraft(alertId: string | null = null): ReportDraft {
  return {
    category: null,
    severity: null,
    description: '',
    lat: null,
    lon: null,
    gps_accuracy_m: null,
    location_adjusted_manually: false,
    manual_uncertainty_m: null,
    alert_id: alertId,
    media: [],
  };
}

export type DraftField = 'category' | 'severity' | 'description' | 'location' | 'accuracy' | 'media';

export interface DraftIssue {
  field: DraftField;
  message: string;
}

const validNumber = (n: number | null): n is number => n !== null && Number.isFinite(n);

/** The accuracy value that will be sent as `gps_accuracy_m`. */
export function effectiveAccuracy(d: ReportDraft): number | null {
  return d.location_adjusted_manually ? d.manual_uncertainty_m : d.gps_accuracy_m;
}

export function validateDraft(d: ReportDraft): DraftIssue[] {
  const issues: DraftIssue[] = [];
  const add = (field: DraftField, message: string) => issues.push({ field, message });
  if (!d.category || !REPORT_CATEGORIES.includes(d.category)) add('category', 'Choose what you observed.');
  if (!d.severity || !REPORT_SEVERITIES.includes(d.severity)) add('severity', 'Choose a severity.');
  const desc = d.description.trim();
  if (!desc) add('description', 'Add a short description.');
  if (desc.length > DESCRIPTION_MAX_CHARS) {
    add('description', `Description is ${desc.length} characters; the limit is ${DESCRIPTION_MAX_CHARS}.`);
  }
  if (!validNumber(d.lat) || !validNumber(d.lon)) {
    add(
      'location',
      d.location_adjusted_manually
        ? 'Enter both latitude and longitude for the pin.'
        : 'Location is required. Wait for a GPS fix, or switch on "Adjust pin manually".',
    );
  } else if (d.lat < -90 || d.lat > 90 || d.lon < -180 || d.lon > 180) {
    add('location', 'Latitude must be between -90 and 90 and longitude between -180 and 180.');
  }
  const accuracy = effectiveAccuracy(d);
  if (!validNumber(accuracy) || accuracy <= 0) {
    add(
      'accuracy',
      d.location_adjusted_manually
        ? 'Enter how far off the pin may be, in metres (more than 0).'
        : 'The GPS fix has no accuracy value. Refresh GPS, or adjust the pin manually and estimate the uncertainty.',
    );
  }
  if (d.media.length > MAX_MEDIA_PER_REPORT) {
    add('media', `At most ${MAX_MEDIA_PER_REPORT} photos/videos per report.`);
  }
  return issues;
}

export interface BuildDeps {
  clock: Clock;
  newId: () => string;
  language: string;
  ownerUserId: string;
}

/**
 * Turns a valid draft into rows for the local store. `captured_at` is the device
 * time when the report is saved; it is kept even if the device is offline.
 */
export function buildLocalReport(d: ReportDraft, deps: BuildDeps): { report: LocalReport; media: LocalMedia[] } {
  const issues = validateDraft(d);
  if (issues.length) throw new Error(issues.map((i) => i.message).join(' '));
  const now = deps.clock.now();
  const clientReportId = deps.newId();
  const report: LocalReport = {
    client_report_id: clientReportId,
    owner_user_id: deps.ownerUserId,
    alert_id: d.alert_id,
    category: d.category as ReportCategory,
    severity: d.severity as ReportSeverity,
    description: d.description.trim(),
    language: deps.language,
    location: { type: 'Point', coordinates: [d.lon as number, d.lat as number] },
    gps_accuracy_m: effectiveAccuracy(d),
    location_adjusted_manually: d.location_adjusted_manually,
    captured_at: toIsoWithOffset(now),
    created_at: now.toISOString(),
    status: 'QUEUED',
    server_id: null,
    attempts: 0,
    next_attempt_at: null,
    last_error: null,
    synced_at: null,
  };
  const media: LocalMedia[] = d.media.map((m) => ({
    client_media_id: deps.newId(),
    client_report_id: clientReportId,
    media_type: m.media_type,
    local_uri: m.local_uri,
    mime_type: m.mime_type,
    size_bytes: m.size_bytes,
    duration_s: m.duration_s,
    captured_at: m.captured_at,
    // Media geotag is device GPS only; a manually adjusted pin is not attributed to the file.
    lat: d.location_adjusted_manually ? null : d.lat,
    lon: d.location_adjusted_manually ? null : d.lon,
    upload_status: 'PENDING',
    server_id: null,
    attempts: 0,
    next_attempt_at: null,
    last_error: null,
  }));
  return { report, media };
}

export type QueueResult =
  | { ok: true; report: LocalReport; media: LocalMedia[] }
  | { ok: false; issues: DraftIssue[] };

/**
 * Save step of the report form: validate, build and write to the local store.
 * Makes no network call, so it behaves the same online and offline; the sync
 * engine sends the report later.
 */
export async function queueReport(d: ReportDraft, deps: BuildDeps & { store: ReportStore }): Promise<QueueResult> {
  const issues = validateDraft(d);
  if (issues.length) return { ok: false, issues };
  const { report, media } = buildLocalReport(d, deps);
  await deps.store.addReport(report, media);
  return { ok: true, report, media };
}

export interface DeviceInfo {
  app_version: string;
  platform: string;
}

export function toCreateReportPayload(
  r: LocalReport,
  mediaExpected: number,
  device: DeviceInfo,
): CreateReportPayload {
  const payload: CreateReportPayload = {
    client_report_id: r.client_report_id,
    category: r.category,
    severity: r.severity,
    description: r.description,
    language: r.language,
    location: r.location,
    gps_accuracy_m: r.gps_accuracy_m,
    location_adjusted_manually: r.location_adjusted_manually,
    captured_at: r.captured_at,
    media_expected: mediaExpected,
    device_info: device,
  };
  if (r.alert_id) payload.alert_id = r.alert_id;
  return payload;
}
