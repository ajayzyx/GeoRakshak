import { ApiClient } from './api';
import { ApiError, toApiError } from './http';
import { DeviceInfo, toCreateReportPayload } from './reportDraft';
import { ReportStore } from './reportStore';
import { Clock, LocalMedia, LocalReport } from './types';

export interface Connectivity {
  /** Best current knowledge. `false` only when the device is known to be offline. */
  isOnline(): Promise<boolean>;
}

export interface BackoffPolicy {
  baseMs: number;
  maxMs: number;
}

export const DEFAULT_BACKOFF: BackoffPolicy = { baseMs: 5_000, maxMs: 10 * 60_000 };

export interface SyncEngineDeps {
  store: ReportStore;
  api: ApiClient;
  clock: Clock;
  connectivity: Connectivity;
  device: DeviceInfo;
  /** Signed-in user. Only their reports are synced; nothing is synced when signed out. */
  currentUserId: () => string | null;
  backoff?: BackoffPolicy;
  /** Guards against uploading a local file that was removed (e.g. app storage cleared). */
  fileExists?: (uri: string) => Promise<boolean>;
  onAuthRequired?: () => void;
}

export interface SyncRunResult {
  skipped: 'offline' | null;
  reportsSynced: number;
  reportsDuplicate: number;
  reportsFailed: number;
  mediaUploaded: number;
  mediaFailed: number;
  retryScheduled: number;
  /** Synced reports the server no longer had (media upload got 404); queued to be sent again. */
  reportsRequeued: number;
  /** Why the run ended early, if it did. */
  stoppedBy: 'network' | 'auth' | null;
}

export interface SyncOptions {
  /** Manual "Sync now": ignore backoff timers. */
  force?: boolean;
}

export function backoffDelayMs(attempts: number, policy: BackoffPolicy = DEFAULT_BACKOFF): number {
  const exp = Math.max(0, attempts - 1);
  return Math.min(policy.maxMs, policy.baseMs * 2 ** Math.min(exp, 30));
}

/**
 * Drains the local queue: all report JSON first, then media. A slow video
 * upload therefore never delays another report's data. All state lives in the
 * ReportStore, so a run interrupted by an app kill resumes on the next start.
 */
export class SyncEngine {
  private running: Promise<SyncRunResult> | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly backoff: BackoffPolicy;

  constructor(private readonly deps: SyncEngineDeps) {
    this.backoff = deps.backoff ?? DEFAULT_BACKOFF;
  }

  /** Notified after every local state change so the UI can re-read the store. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get isRunning(): boolean {
    return this.running !== null;
  }

  /** Concurrent callers share the in-flight run instead of starting a second one. */
  syncOnce(opts: SyncOptions = {}): Promise<SyncRunResult> {
    if (!this.running) {
      this.running = this.run(opts).finally(() => {
        this.running = null;
        this.emit();
      });
    }
    return this.running;
  }

  private emit(): void {
    for (const l of this.listeners) {
      try {
        l();
      } catch {
        // A UI listener must never break the sync loop.
      }
    }
  }

  private isDue(item: { next_attempt_at: string | null }, force: boolean): boolean {
    if (force || !item.next_attempt_at) return true;
    return Date.parse(item.next_attempt_at) <= this.deps.clock.now().getTime();
  }

  private retryAt(attempts: number): string {
    return new Date(this.deps.clock.now().getTime() + backoffDelayMs(attempts, this.backoff)).toISOString();
  }

  private async run(opts: SyncOptions): Promise<SyncRunResult> {
    const force = opts.force ?? false;
    const result: SyncRunResult = {
      skipped: null,
      reportsSynced: 0,
      reportsDuplicate: 0,
      reportsFailed: 0,
      mediaUploaded: 0,
      mediaFailed: 0,
      retryScheduled: 0,
      reportsRequeued: 0,
      stoppedBy: null,
    };
    const userId = this.deps.currentUserId();
    if (!userId) {
      result.stoppedBy = 'auth';
      return result;
    }
    if (!(await this.deps.connectivity.isOnline())) {
      result.skipped = 'offline';
      return result;
    }

    // Phase 1: report data.
    for (const { report, media } of await this.deps.store.listPendingWork(userId)) {
      if (report.status !== 'QUEUED' && report.status !== 'SYNCING') continue;
      if (!this.isDue(report, force)) continue;
      const stop = await this.syncReport(report, media.length, result);
      if (stop) {
        result.stoppedBy = stop;
        return result;
      }
    }

    // Phase 2: media, for reports that now have a server id. Photos before
    // videos and small before large, so the most evidence arrives soonest.
    const mediaQueue: { report: LocalReport; media: LocalMedia }[] = [];
    for (const { report, media } of await this.deps.store.listPendingWork(userId)) {
      if (report.status !== 'SYNCED' || !report.server_id) continue;
      for (const m of media) {
        if ((m.upload_status === 'PENDING' || m.upload_status === 'UPLOADING') && this.isDue(m, force)) {
          mediaQueue.push({ report, media: m });
        }
      }
    }
    mediaQueue.sort(
      (a, b) =>
        Number(a.media.media_type === 'VIDEO') - Number(b.media.media_type === 'VIDEO') ||
        a.media.size_bytes - b.media.size_bytes,
    );
    for (const item of mediaQueue) {
      const stop = await this.uploadMedia(item.report, item.media, result);
      if (stop) {
        result.stoppedBy = stop;
        return result;
      }
    }
    return result;
  }

  private async syncReport(
    report: LocalReport,
    mediaCount: number,
    result: SyncRunResult,
  ): Promise<'network' | 'auth' | null> {
    const { store, api } = this.deps;
    // Conditional claim: skips a report discarded (or already handled) since the queue was listed.
    if (!(await store.claimReportForSync(report.client_report_id))) return null;
    this.emit();
    try {
      const res = await api.createReport(toCreateReportPayload(report, mediaCount, this.deps.device));
      // 201 (new) and 200 (duplicate client_report_id) both mean the server has it.
      await store.updateReport(report.client_report_id, {
        status: 'SYNCED',
        server_id: res.report.id,
        synced_at: this.deps.clock.now().toISOString(),
        last_error: null,
        next_attempt_at: null,
      });
      if (res.created) result.reportsSynced++;
      else result.reportsDuplicate++;
      this.emit();
      return null;
    } catch (err) {
      const e = toApiError(err);
      return this.handleFailure(e, result, async (patch) => {
        if (patch.failed) {
          await store.updateReport(report.client_report_id, { status: 'FAILED', last_error: patch.message });
          result.reportsFailed++;
        } else {
          const attempts = patch.countAttempt ? report.attempts + 1 : report.attempts;
          await store.updateReport(report.client_report_id, {
            status: 'QUEUED',
            attempts,
            next_attempt_at: patch.countAttempt ? this.retryAt(attempts) : report.next_attempt_at,
            last_error: patch.message,
          });
        }
      });
    }
  }

  private async uploadMedia(
    report: LocalReport,
    media: LocalMedia,
    result: SyncRunResult,
  ): Promise<'network' | 'auth' | null> {
    const { store, api } = this.deps;
    if (this.deps.fileExists && !(await this.deps.fileExists(media.local_uri))) {
      await store.updateMedia(media.client_media_id, {
        upload_status: 'FAILED',
        last_error: 'The file is no longer on this device.',
      });
      result.mediaFailed++;
      this.emit();
      return null;
    }
    // A sibling file may have found the report missing on the server earlier in this run.
    const current = await store.getReport(report.client_report_id);
    if (!current || current.status !== 'SYNCED' || current.server_id !== report.server_id) return null;
    await store.updateMedia(media.client_media_id, { upload_status: 'UPLOADING' });
    this.emit();
    try {
      const res = await api.uploadMedia(report.server_id as string, media);
      await store.updateMedia(media.client_media_id, {
        upload_status: 'UPLOADED',
        server_id: res.media.id,
        last_error: null,
        next_attempt_at: null,
      });
      result.mediaUploaded++;
      this.emit();
      return null;
    } catch (err) {
      const e = toApiError(err);
      if (e.kind === 'client' && e.status === 404) {
        // The server has no report with this id (e.g. its database was reset). Re-send the
        // report: POST /reports is idempotent on client_report_id, then upload the media again.
        const attempts = report.attempts + 1;
        await store.requeueLostReport(
          report.client_report_id,
          `Server no longer has this report (${e.message}); sending it again.`,
          this.retryAt(attempts),
        );
        result.reportsRequeued++;
        this.emit();
        return null;
      }
      return this.handleFailure(e, result, async (patch) => {
        if (patch.failed) {
          await store.updateMedia(media.client_media_id, { upload_status: 'FAILED', last_error: patch.message });
          result.mediaFailed++;
        } else {
          const attempts = patch.countAttempt ? media.attempts + 1 : media.attempts;
          await store.updateMedia(media.client_media_id, {
            upload_status: 'PENDING',
            attempts,
            next_attempt_at: patch.countAttempt ? this.retryAt(attempts) : media.next_attempt_at,
            last_error: patch.message,
          });
        }
      });
    }
  }

  private async handleFailure(
    e: ApiError,
    result: SyncRunResult,
    apply: (patch: { failed: boolean; countAttempt: boolean; message: string }) => Promise<void>,
  ): Promise<'network' | 'auth' | null> {
    let stop: 'network' | 'auth' | null = null;
    if (e.kind === 'unauthenticated') {
      // Not the item's fault: keep it queued, don't burn an attempt, ask the user to sign in.
      await apply({ failed: false, countAttempt: false, message: 'Sign in again to continue syncing.' });
      this.deps.onAuthRequired?.();
      stop = 'auth';
    } else if (e.retryable) {
      await apply({ failed: false, countAttempt: true, message: e.message });
      result.retryScheduled++;
      // With no connection every further request would fail too.
      if (e.kind === 'network') stop = 'network';
    } else {
      // 4xx validation / conflict / too large: retrying sends the same bytes and fails the same way.
      const prefix = e.status ? `Rejected by server (${e.status}${e.code ? ` ${e.code}` : ''}): ` : '';
      await apply({ failed: true, countAttempt: true, message: prefix + e.message });
    }
    this.emit();
    return stop;
  }
}

export type DisplaySyncStatus = 'Queued' | 'Syncing' | 'Synced' | 'Media uploading' | 'Failed';

export function displaySyncStatus(report: LocalReport, media: LocalMedia[]): {
  label: DisplaySyncStatus;
  detail: string | null;
} {
  if (report.status === 'FAILED') return { label: 'Failed', detail: report.last_error };
  if (report.status === 'SYNCING') return { label: 'Syncing', detail: null };
  if (report.status === 'QUEUED') return { label: 'Queued', detail: report.last_error };
  const pending = media.filter((m) => m.upload_status === 'PENDING' || m.upload_status === 'UPLOADING');
  if (pending.length) {
    const done = media.filter((m) => m.upload_status === 'UPLOADED').length;
    const err = pending.find((m) => m.last_error)?.last_error ?? null;
    return { label: 'Media uploading', detail: `${done}/${media.length} files uploaded${err ? ` · ${err}` : ''}` };
  }
  const failed = media.filter((m) => m.upload_status === 'FAILED');
  if (failed.length) {
    return {
      label: 'Failed',
      detail: `Report synced, but ${failed.length} file(s) failed: ${failed[0]?.last_error ?? 'unknown error'}`,
    };
  }
  return { label: 'Synced', detail: null };
}

export function mediaStatusLabel(report: LocalReport, media: LocalMedia): string {
  switch (media.upload_status) {
    case 'UPLOADED':
      return 'Uploaded';
    case 'UPLOADING':
      return 'Uploading';
    case 'FAILED':
      return 'Failed';
    default:
      return report.status === 'SYNCED' ? 'Waiting to upload' : 'Waits for the report to be sent';
  }
}

/** Only reports that never reached the server can be discarded on the device. */
export function canDiscard(report: LocalReport): boolean {
  return report.server_id === null && (report.status === 'QUEUED' || report.status === 'FAILED');
}
