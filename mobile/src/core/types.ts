// Shared types for the mobile core. Field names that cross the wire follow
// docs/api.md (frozen contract v1) exactly, so they stay snake_case.

export type Role =
  | 'ADMIN'
  | 'STATE_AUTHORITY'
  | 'DISTRICT_AUTHORITY'
  | 'FIELD_OFFICER'
  | 'CITIZEN';

export type Provenance = 'REAL_LIVE' | 'REAL_HISTORICAL' | 'SIMULATED_DEMO' | 'MODEL_OUTPUT';

/** api.md §5.14 login `user` object and `GET /me`. */
export interface User {
  id: string;
  full_name: string;
  email: string;
  role: Role;
  preferred_language: string;
  admin_boundary_id: string | null;
  is_demo_account: boolean;
}

export interface LoginResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  user: User;
}

/** Report category, database.md §4.15. */
export const REPORT_CATEGORIES = [
  'LANDSLIDE',
  'CRACK',
  'SEEPAGE',
  'ROCKFALL',
  'ROAD_BLOCKED',
  'SUBSIDENCE',
  'OTHER',
] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

/**
 * Report severity, database.md §4.15. Deliberately different from the risk
 * severity enum (LOW..VERY_HIGH) in api.md §6.1: a report severity is the
 * observer's judgement, not a model class.
 */
export const REPORT_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type ReportSeverity = (typeof REPORT_SEVERITIES)[number];

export type MediaType = 'PHOTO' | 'VIDEO';

/** Local lifecycle of a report row. SYNCING is transient and reset on restart. */
export type LocalReportStatus = 'QUEUED' | 'SYNCING' | 'SYNCED' | 'FAILED';

/** Local lifecycle of a media row. UPLOADING is transient and reset on restart. */
export type LocalMediaStatus = 'PENDING' | 'UPLOADING' | 'UPLOADED' | 'FAILED';

export interface GeoPoint {
  type: 'Point';
  /** [lon, lat], RFC 7946. */
  coordinates: [number, number];
}

export interface LocalReport {
  client_report_id: string;
  /** User who created the report. Only that user's session syncs it (shared devices). */
  owner_user_id: string;
  alert_id: string | null;
  category: ReportCategory;
  severity: ReportSeverity;
  description: string;
  language: string;
  location: GeoPoint;
  gps_accuracy_m: number | null;
  location_adjusted_manually: boolean;
  captured_at: string;
  created_at: string;
  status: LocalReportStatus;
  server_id: string | null;
  attempts: number;
  next_attempt_at: string | null;
  last_error: string | null;
  synced_at: string | null;
}

export interface LocalMedia {
  client_media_id: string;
  client_report_id: string;
  media_type: MediaType;
  local_uri: string;
  mime_type: string;
  size_bytes: number;
  duration_s: number | null;
  captured_at: string;
  lat: number | null;
  lon: number | null;
  upload_status: LocalMediaStatus;
  server_id: string | null;
  attempts: number;
  next_attempt_at: string | null;
  last_error: string | null;
}

/** POST /reports body, api.md §5.6. */
export interface CreateReportPayload {
  client_report_id: string;
  alert_id?: string;
  category: ReportCategory;
  severity: ReportSeverity;
  description: string;
  language: string;
  location: GeoPoint;
  gps_accuracy_m: number | null;
  location_adjusted_manually: boolean;
  captured_at: string;
  media_expected: number;
  device_info: { app_version: string; platform: string };
}

export interface CreateReportResponse {
  id: string;
  client_report_id: string;
  verification_status: string;
  submitted_at: string;
  /** Present in the backend response (Report shape, api.md §5.14); not needed for sync. */
  media_summary?: { expected: number; received: number };
  provenance?: Provenance;
}

export interface UploadMediaResponse {
  id: string;
  client_media_id: string;
  media_type: MediaType;
  upload_status: string;
}

/** GET /me/inbox item, api.md §5.14. */
export interface InboxItem {
  alert_id: string;
  tier: 'WATCH' | 'WARNING' | 'UPDATE';
  severity: string;
  title: string;
  body: string;
  language: string;
  dispatched_at: string | null;
  acknowledged_at: string | null;
  risk_zone_ids: string[];
  lead_time_h: number | null;
  is_demo: boolean;
}

export interface AcknowledgeResponse {
  alert_id: string;
  acknowledged_at: string;
}

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };
