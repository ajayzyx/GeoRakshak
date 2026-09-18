import { SqlDatabase, SqlValue } from './db';
import {
  LocalMedia,
  LocalMediaStatus,
  LocalReport,
  LocalReportStatus,
  ReportCategory,
  ReportSeverity,
  MediaType,
} from './types';

export type ReportPatch = Partial<
  Pick<LocalReport, 'status' | 'server_id' | 'attempts' | 'next_attempt_at' | 'last_error' | 'synced_at'>
>;
export type MediaPatch = Partial<
  Pick<LocalMedia, 'upload_status' | 'server_id' | 'attempts' | 'next_attempt_at' | 'last_error'>
>;

/** Local-first store for reports and their media. The device copy is the source of truth until synced. */
export interface ReportStore {
  /** Inserts the report and its media atomically. Returns false if the client_report_id already exists. */
  addReport(report: LocalReport, media: LocalMedia[]): Promise<boolean>;
  listReports(ownerUserId: string): Promise<LocalReport[]>;
  getReport(clientReportId: string): Promise<LocalReport | null>;
  listMedia(clientReportId: string): Promise<LocalMedia[]>;
  /** Reports still needing work: QUEUED, or SYNCED with media not yet uploaded. */
  listPendingWork(ownerUserId: string): Promise<{ report: LocalReport; media: LocalMedia[] }[]>;
  updateReport(clientReportId: string, patch: ReportPatch): Promise<void>;
  updateMedia(clientMediaId: string, patch: MediaPatch): Promise<void>;
  /**
   * Atomically moves a QUEUED (or interrupted SYNCING) report to SYNCING.
   * Returns false if the row is gone or in another state (e.g. discarded meanwhile).
   */
  claimReportForSync(clientReportId: string): Promise<boolean>;
  /**
   * The server no longer knows this report (media upload answered 404): forget the
   * server id and queue the report and all its media to be sent again.
   */
  requeueLostReport(clientReportId: string, message: string, nextAttemptAt: string | null): Promise<void>;
  /** Called on start: work interrupted by an app kill (SYNCING / UPLOADING) goes back to the queue. */
  recoverInterrupted(): Promise<void>;
  /** User-initiated retry of a FAILED report or FAILED media. */
  retryFailed(clientReportId: string): Promise<void>;
  /**
   * Deletes a report that never reached the server (QUEUED or FAILED, no server id)
   * with its media rows. Returns the local media file URIs so the caller can delete
   * the files, or null if the report cannot be discarded (already sent or syncing).
   */
  discardUnsynced(clientReportId: string): Promise<string[] | null>;
}

interface ReportRow {
  client_report_id: string;
  owner_user_id: string;
  alert_id: string | null;
  category: string;
  severity: string;
  description: string;
  language: string;
  lon: number;
  lat: number;
  gps_accuracy_m: number | null;
  location_adjusted_manually: number;
  captured_at: string;
  created_at: string;
  status: string;
  server_id: string | null;
  attempts: number;
  next_attempt_at: string | null;
  last_error: string | null;
  synced_at: string | null;
}

interface MediaRow {
  client_media_id: string;
  client_report_id: string;
  media_type: string;
  local_uri: string;
  mime_type: string;
  size_bytes: number;
  duration_s: number | null;
  captured_at: string;
  lat: number | null;
  lon: number | null;
  upload_status: string;
  server_id: string | null;
  attempts: number;
  next_attempt_at: string | null;
  last_error: string | null;
}

function toReport(r: ReportRow): LocalReport {
  return {
    client_report_id: r.client_report_id,
    owner_user_id: r.owner_user_id,
    alert_id: r.alert_id,
    category: r.category as ReportCategory,
    severity: r.severity as ReportSeverity,
    description: r.description,
    language: r.language,
    location: { type: 'Point', coordinates: [r.lon, r.lat] },
    gps_accuracy_m: r.gps_accuracy_m,
    location_adjusted_manually: r.location_adjusted_manually === 1,
    captured_at: r.captured_at,
    created_at: r.created_at,
    status: r.status as LocalReportStatus,
    server_id: r.server_id,
    attempts: r.attempts,
    next_attempt_at: r.next_attempt_at,
    last_error: r.last_error,
    synced_at: r.synced_at,
  };
}

function toMedia(m: MediaRow): LocalMedia {
  return { ...m, media_type: m.media_type as MediaType, upload_status: m.upload_status as LocalMediaStatus };
}

const REPORT_PATCH_COLUMNS = ['status', 'server_id', 'attempts', 'next_attempt_at', 'last_error', 'synced_at'];
const MEDIA_PATCH_COLUMNS = ['upload_status', 'server_id', 'attempts', 'next_attempt_at', 'last_error'];

function buildSet(patch: Record<string, unknown>, allowed: string[]): { sql: string; params: SqlValue[] } {
  const cols = Object.keys(patch).filter((k) => allowed.includes(k));
  return {
    sql: cols.map((c) => `${c} = ?`).join(', '),
    params: cols.map((c) => (patch[c] ?? null) as SqlValue),
  };
}

export class SqliteReportStore implements ReportStore {
  constructor(private readonly db: SqlDatabase) {}

  async addReport(report: LocalReport, media: LocalMedia[]): Promise<boolean> {
    let inserted = false;
    await this.db.transaction(async () => {
      const res = await this.db.run(
        `INSERT OR IGNORE INTO reports (client_report_id, owner_user_id, alert_id, category, severity, description, language,
          lon, lat, gps_accuracy_m, location_adjusted_manually, captured_at, created_at, status, server_id,
          attempts, next_attempt_at, last_error, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          report.client_report_id,
          report.owner_user_id,
          report.alert_id,
          report.category,
          report.severity,
          report.description,
          report.language,
          report.location.coordinates[0],
          report.location.coordinates[1],
          report.gps_accuracy_m,
          report.location_adjusted_manually ? 1 : 0,
          report.captured_at,
          report.created_at,
          report.status,
          report.server_id,
          report.attempts,
          report.next_attempt_at,
          report.last_error,
          report.synced_at,
        ],
      );
      inserted = res.changes > 0;
      if (!inserted) return;
      for (const m of media) {
        await this.db.run(
          `INSERT INTO media (client_media_id, client_report_id, media_type, local_uri, mime_type, size_bytes,
            duration_s, captured_at, lat, lon, upload_status, server_id, attempts, next_attempt_at, last_error)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            m.client_media_id,
            report.client_report_id,
            m.media_type,
            m.local_uri,
            m.mime_type,
            m.size_bytes,
            m.duration_s,
            m.captured_at,
            m.lat,
            m.lon,
            m.upload_status,
            m.server_id,
            m.attempts,
            m.next_attempt_at,
            m.last_error,
          ],
        );
      }
    });
    return inserted;
  }

  async listReports(ownerUserId: string): Promise<LocalReport[]> {
    const rows = await this.db.all<ReportRow>(
      'SELECT * FROM reports WHERE owner_user_id = ? ORDER BY created_at DESC',
      [ownerUserId],
    );
    return rows.map(toReport);
  }

  async getReport(clientReportId: string): Promise<LocalReport | null> {
    const rows = await this.db.all<ReportRow>('SELECT * FROM reports WHERE client_report_id = ?', [
      clientReportId,
    ]);
    return rows[0] ? toReport(rows[0]) : null;
  }

  async listMedia(clientReportId: string): Promise<LocalMedia[]> {
    const rows = await this.db.all<MediaRow>(
      'SELECT * FROM media WHERE client_report_id = ? ORDER BY captured_at ASC, client_media_id ASC',
      [clientReportId],
    );
    return rows.map(toMedia);
  }

  async listPendingWork(ownerUserId: string): Promise<{ report: LocalReport; media: LocalMedia[] }[]> {
    // Oldest first, so the queue drains in capture order.
    const rows = await this.db.all<ReportRow>(
      `SELECT * FROM reports r
       WHERE r.owner_user_id = ?
         AND (r.status IN ('QUEUED', 'SYNCING')
              OR (r.status = 'SYNCED' AND EXISTS (
                    SELECT 1 FROM media m WHERE m.client_report_id = r.client_report_id
                      AND m.upload_status IN ('PENDING', 'UPLOADING'))))
       ORDER BY r.created_at ASC`,
      [ownerUserId],
    );
    const out: { report: LocalReport; media: LocalMedia[] }[] = [];
    for (const row of rows) {
      out.push({ report: toReport(row), media: await this.listMedia(row.client_report_id) });
    }
    return out;
  }

  async updateReport(clientReportId: string, patch: ReportPatch): Promise<void> {
    const { sql, params } = buildSet(patch, REPORT_PATCH_COLUMNS);
    if (!sql) return;
    await this.db.run(`UPDATE reports SET ${sql} WHERE client_report_id = ?`, [...params, clientReportId]);
  }

  async updateMedia(clientMediaId: string, patch: MediaPatch): Promise<void> {
    const { sql, params } = buildSet(patch, MEDIA_PATCH_COLUMNS);
    if (!sql) return;
    await this.db.run(`UPDATE media SET ${sql} WHERE client_media_id = ?`, [...params, clientMediaId]);
  }

  async claimReportForSync(clientReportId: string): Promise<boolean> {
    const res = await this.db.run(
      `UPDATE reports SET status = 'SYNCING' WHERE client_report_id = ? AND status IN ('QUEUED', 'SYNCING')`,
      [clientReportId],
    );
    return res.changes > 0;
  }

  async requeueLostReport(clientReportId: string, message: string, nextAttemptAt: string | null): Promise<void> {
    await this.db.transaction(async () => {
      await this.db.run(
        `UPDATE reports SET status = 'QUEUED', server_id = NULL, synced_at = NULL, attempts = attempts + 1,
           next_attempt_at = ?, last_error = ?
         WHERE client_report_id = ?`,
        [nextAttemptAt, message, clientReportId],
      );
      await this.db.run(
        `UPDATE media SET upload_status = 'PENDING', server_id = NULL, next_attempt_at = NULL, last_error = NULL
         WHERE client_report_id = ?`,
        [clientReportId],
      );
    });
  }

  async discardUnsynced(clientReportId: string): Promise<string[] | null> {
    let uris: string[] | null = null;
    await this.db.transaction(async () => {
      const rows = await this.db.all<{ status: string; server_id: string | null }>(
        'SELECT status, server_id FROM reports WHERE client_report_id = ?',
        [clientReportId],
      );
      const row = rows[0];
      if (!row || row.server_id !== null || (row.status !== 'QUEUED' && row.status !== 'FAILED')) return;
      const media = await this.db.all<{ local_uri: string }>(
        'SELECT local_uri FROM media WHERE client_report_id = ?',
        [clientReportId],
      );
      await this.db.run('DELETE FROM media WHERE client_report_id = ?', [clientReportId]);
      await this.db.run('DELETE FROM reports WHERE client_report_id = ?', [clientReportId]);
      uris = media.map((m) => m.local_uri);
    });
    return uris;
  }

  async recoverInterrupted(): Promise<void> {
    await this.db.run(`UPDATE reports SET status = 'QUEUED' WHERE status = 'SYNCING'`);
    await this.db.run(`UPDATE media SET upload_status = 'PENDING' WHERE upload_status = 'UPLOADING'`);
  }

  async retryFailed(clientReportId: string): Promise<void> {
    await this.db.transaction(async () => {
      await this.db.run(
        `UPDATE reports SET status = 'QUEUED', attempts = 0, next_attempt_at = NULL, last_error = NULL
         WHERE client_report_id = ? AND status = 'FAILED'`,
        [clientReportId],
      );
      await this.db.run(
        `UPDATE media SET upload_status = 'PENDING', attempts = 0, next_attempt_at = NULL, last_error = NULL
         WHERE client_report_id = ? AND upload_status = 'FAILED'`,
        [clientReportId],
      );
    });
  }
}
