// The four offline-queue areas required for the mobile track (CLAUDE.md §8.4,
// docs/development.md §8): (a) offline save, (b) restart persistence,
// (c) reconnect sync through SyncScheduler, (d) duplicate-safe sync.
// Everything runs the app's real SQL on Node's SQLite against an in-memory fake
// of our backend's report endpoints. No test touches the network.

import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { queueReport, ReportDraft } from '../reportDraft';
import { displaySyncStatus, mediaStatusLabel, SyncEngine } from '../syncEngine';
import { ignoresBackoff, SyncScheduler, SyncTrigger } from '../syncScheduler';
import { ContractServer, FakeClock, FakeHttp, USER_ID, apiFor, openStores, photo, sampleDraft, video } from './helpers';

const device = { app_version: '0.1.0-test', platform: 'android' };

/** Connectivity source that tests flip by hand; emits to subscribers like NetInfo. */
class FakeConnectivity {
  private listeners = new Set<(online: boolean) => void>();
  constructor(public online: boolean) {}
  isOnline = async () => this.online;
  subscribe = (cb: (online: boolean) => void) => {
    this.listeners.add(cb);
    cb(this.online); // NetInfo reports the current state on subscribe
    return () => this.listeners.delete(cb);
  };
  set(online: boolean): void {
    this.online = online;
    this.listeners.forEach((l) => l(online));
  }
}

class FakeForeground {
  private listeners = new Set<() => void>();
  subscribe = (cb: () => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };
  emit(): void {
    this.listeners.forEach((l) => l());
  }
}

let tempDir: string;
beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'georakshak-queue-'));
});
afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

/** One "app process": a database file opened with the app schema, an engine and a fake server connection. */
async function openApp(opts: { path?: string; http?: FakeHttp; online?: boolean; clock?: FakeClock } = {}) {
  const stores = await openStores(opts.path ?? ':memory:');
  // As on app start (createAppServices): interrupted work goes back to the queue.
  await stores.store.recoverInterrupted();
  const http = opts.http ?? new FakeHttp();
  const clock = opts.clock ?? new FakeClock();
  const connectivity = new FakeConnectivity(opts.online ?? true);
  const engine = new SyncEngine({
    store: stores.store,
    api: apiFor(http),
    clock,
    connectivity,
    device,
    currentUserId: () => USER_ID,
    backoff: { baseMs: 1_000, maxMs: 60_000 },
  });
  const save = (draft: ReportDraft) =>
    queueReport(draft, { store: stores.store, clock, newId: randomUUID, language: 'en', ownerUserId: USER_ID });
  return { ...stores, http, clock, connectivity, engine, save };
}

async function saved(app: Awaited<ReturnType<typeof openApp>>, draft: ReportDraft) {
  const res = await app.save(draft);
  if (!res.ok) throw new Error(res.issues.map((i) => i.message).join(' '));
  return res;
}

describe('(a) offline save', () => {
  test('(a1) report, photo and video are persisted locally while offline, with no network call', async () => {
    const app = await openApp({ online: false });
    new ContractServer(app.http);

    const res = await saved(app, sampleDraft({ media: [photo(1_500_000), video(9_000_000, 28.9)] }));
    const run = await app.engine.syncOnce();

    expect(run.skipped).toBe('offline');
    expect(app.http.requests).toHaveLength(0);
    const report = await app.store.getReport(res.report.client_report_id);
    expect(report).toMatchObject({ status: 'QUEUED', server_id: null, attempts: 0, gps_accuracy_m: 8 });
    const media = await app.store.listMedia(res.report.client_report_id);
    expect(media.map((m) => [m.media_type, m.mime_type, m.size_bytes, m.duration_s, m.upload_status])).toEqual([
      ['PHOTO', 'image/jpeg', 1_500_000, null, 'PENDING'],
      ['VIDEO', 'video/mp4', 9_000_000, 28.9, 'PENDING'],
    ]);
    expect(media.every((m) => m.local_uri.startsWith('file://'))).toBe(true);
    expect(displaySyncStatus(report!, media).label).toBe('Queued');
    expect(mediaStatusLabel(report!, media[0]!)).toBe('Waits for the report to be sent');
  });

  test('(a2) an invalid draft is not saved and every problem is reported by field', async () => {
    const app = await openApp({ online: false });
    const res = await app.save(
      sampleDraft({ category: null, description: '  ', gps_accuracy_m: null, location_adjusted_manually: false }),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.issues.map((i) => i.field).sort()).toEqual(['accuracy', 'category', 'description']);
    expect(await app.store.listReports(USER_ID)).toHaveLength(0);
    expect(app.http.requests).toHaveLength(0);
  });

  test('(a3) an unsynced report can be discarded offline; its file URIs are returned for deletion', async () => {
    const app = await openApp({ online: false });
    const res = await saved(app, sampleDraft({ media: [photo()] }));
    const uris = await app.store.discardUnsynced(res.report.client_report_id);
    expect(uris).toEqual([res.media[0]!.local_uri]);
    expect(await app.store.listReports(USER_ID)).toHaveLength(0);
    expect(app.http.requests).toHaveLength(0);
  });
});

describe('(b) restart persistence', () => {
  test('(b1) queued reports and media survive closing and reopening the database file, then sync', async () => {
    const path = join(tempDir, 'georakshak.db');
    const first = await openApp({ path, online: false });
    const a = await saved(first, sampleDraft({ media: [photo(), video()] }));
    const b = await saved(first, sampleDraft({ category: 'CRACK', media: [] }));
    first.close();

    const http = new FakeHttp();
    const server = new ContractServer(http);
    const second = await openApp({ path, http });
    const pending = await second.store.listPendingWork(USER_ID);
    expect(pending.map((p) => [p.report.client_report_id, p.media.length]).sort()).toEqual(
      [
        [a.report.client_report_id, 2],
        [b.report.client_report_id, 0],
      ].sort(),
    );

    const run = await second.engine.syncOnce();

    expect(run).toMatchObject({ reportsSynced: 2, mediaUploaded: 2 });
    expect(server.reports.size).toBe(2);
    expect(await second.store.listPendingWork(USER_ID)).toHaveLength(0);
    second.close();
  });

  test('(b2) an upload interrupted mid-way (app killed) resumes after restart and is not duplicated', async () => {
    const path = join(tempDir, 'georakshak.db');
    const http = new FakeHttp();
    const server = new ContractServer(http);
    const first = await openApp({ path, http });
    const res = await saved(first, sampleDraft({ media: [photo(), video()] }));
    // The server stores the first file, then the app process dies before the response is handled.
    let killed = false;
    server.afterMediaStored = () => {
      if (killed) return;
      killed = true;
      first.close();
      throw new Error('app process killed');
    };

    await expect(first.engine.syncOnce()).rejects.toThrow();
    expect(server.reports.size).toBe(1);
    expect(server.media.size).toBe(1);

    server.afterMediaStored = null;
    const second = await openApp({ path, http });
    const afterRestart = await second.store.listMedia(res.report.client_report_id);
    // UPLOADING was reset to PENDING on start; the report kept its server id.
    expect(afterRestart.map((m) => m.upload_status)).toEqual(['PENDING', 'PENDING']);
    expect((await second.store.getReport(res.report.client_report_id))?.status).toBe('SYNCED');

    const run = await second.engine.syncOnce();

    expect(run).toMatchObject({ reportsSynced: 0, mediaUploaded: 2 });
    expect(http.count('POST', /^\/reports$/)).toBe(1); // report not re-sent
    expect(server.media.size).toBe(2); // the interrupted file was not stored twice
    expect(server.statuses('media')).toEqual([200, 201]); // resumed file answered as duplicate
    const final = await second.store.listMedia(res.report.client_report_id);
    expect(final.every((m) => m.upload_status === 'UPLOADED')).toBe(true);
    expect(new Set(final.map((m) => m.server_id)).size).toBe(2);
    second.close();
  });
});

describe('(c) reconnect sync via SyncScheduler', () => {
  const INTERVAL_MS = 30_000;

  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  function schedulerFor(app: Awaited<ReturnType<typeof openApp>>, foreground = new FakeForeground()) {
    const runs: SyncTrigger[] = [];
    let active = 0;
    let maxActive = 0;
    const scheduler = new SyncScheduler({
      run: async (trigger) => {
        runs.push(trigger);
        active++;
        maxActive = Math.max(maxActive, active);
        try {
          await app.engine.syncOnce({ force: ignoresBackoff(trigger) });
        } finally {
          active--;
        }
      },
      subscribeConnectivity: app.connectivity.subscribe,
      subscribeForeground: foreground.subscribe,
      intervalMs: INTERVAL_MS,
      setInterval: (fn, ms) => setInterval(fn, ms),
      clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
    });
    return { scheduler, runs, foreground, maxActive: () => maxActive };
  }

  test('(c1) offline → online transition triggers a sync that sends the queued report', async () => {
    const app = await openApp({ online: false });
    const server = new ContractServer(app.http);
    const { scheduler, runs } = schedulerFor(app);
    scheduler.start();
    await scheduler.idle();
    const res = await saved(app, sampleDraft({ media: [photo()] }));

    app.connectivity.set(false); // still offline: no trigger
    await scheduler.idle();
    expect(runs).toEqual(['start']);
    expect(app.http.requests).toHaveLength(0);

    app.connectivity.set(true);
    await scheduler.idle();

    expect(runs).toEqual(['start', 'connectivity']);
    expect(server.reports.size).toBe(1);
    expect((await app.store.getReport(res.report.client_report_id))?.status).toBe('SYNCED');

    app.connectivity.set(true); // already online: not a transition
    await scheduler.idle();
    expect(runs).toEqual(['start', 'connectivity']);
    scheduler.stop();
  });

  test('(c2) reconnect retries at once, even when a network failure set a backoff timer', async () => {
    const app = await openApp();
    const server = new ContractServer(app.http);
    const { scheduler, runs } = schedulerFor(app);
    const res = await saved(app, sampleDraft());
    app.http.offline = true; // radio says online, but requests fail (weak signal)
    scheduler.start();
    await scheduler.idle();
    const failed = await app.store.getReport(res.report.client_report_id);
    expect(failed).toMatchObject({ status: 'QUEUED', attempts: 1 });
    expect(Date.parse(failed!.next_attempt_at!)).toBeGreaterThan(app.clock.now().getTime());

    app.http.offline = false;
    app.connectivity.set(false);
    app.connectivity.set(true);
    await scheduler.idle();

    expect(runs).toEqual(['start', 'connectivity']);
    expect(server.reports.size).toBe(1);
    scheduler.stop();
  });

  test('(c3) app foreground and the periodic interval trigger sync; stop() ends the interval', async () => {
    const app = await openApp();
    const server = new ContractServer(app.http);
    const { scheduler, runs, foreground } = schedulerFor(app);
    scheduler.start();
    await scheduler.idle();

    await saved(app, sampleDraft());
    foreground.emit();
    await scheduler.idle();
    expect(server.reports.size).toBe(1);

    await saved(app, sampleDraft());
    await jest.advanceTimersByTimeAsync(INTERVAL_MS);
    await scheduler.idle();
    expect(server.reports.size).toBe(2);
    expect(runs).toEqual(['start', 'foreground', 'interval']);

    scheduler.stop();
    await jest.advanceTimersByTimeAsync(INTERVAL_MS * 3);
    expect(runs).toHaveLength(3);
  });

  test('(c4) runs never overlap: triggers during a run coalesce into one follow-up run', async () => {
    const app = await openApp({ online: false });
    const server = new ContractServer(app.http);
    const { scheduler, runs, foreground, maxActive } = schedulerFor(app);
    scheduler.start();
    await scheduler.idle();
    const first = await saved(app, sampleDraft());

    // Hold the first POST on the wire.
    let release!: () => void;
    const onWire = new Promise<void>((resolve) => {
      server.afterReportStored = async () => {
        server.afterReportStored = null;
        resolve();
        await new Promise<void>((r) => (release = r));
      };
    });
    app.connectivity.set(true);
    await onWire;
    expect(scheduler.isRunning).toBe(true);

    // Everything that happens while the request is in flight:
    const second = await saved(app, sampleDraft({ category: 'SEEPAGE' }));
    foreground.emit();
    jest.advanceTimersByTime(INTERVAL_MS);
    app.connectivity.set(false);
    app.connectivity.set(true);
    void scheduler.syncNow();

    release();
    await scheduler.idle();

    expect(maxActive()).toBe(1);
    // One held run plus exactly one follow-up for everything that happened during it.
    expect(runs).toEqual(['start', 'connectivity', 'connectivity']);
    expect(app.http.count('POST', /^\/reports$/)).toBe(2);
    expect(server.statuses('report')).toEqual([201, 201]);
    for (const id of [first.report.client_report_id, second.report.client_report_id]) {
      expect((await app.store.getReport(id))?.status).toBe('SYNCED');
    }
    scheduler.stop();
  });
});

describe('(d) duplicate-safe sync', () => {
  test('(d1) the same client_report_id sent twice: 200, no second server record', async () => {
    const app = await openApp();
    const server = new ContractServer(app.http);
    const res = await saved(app, sampleDraft());
    expect(await app.store.addReport(res.report, res.media)).toBe(false); // double tap on Save
    await app.engine.syncOnce();
    const serverId = (await app.store.getReport(res.report.client_report_id))?.server_id;

    // The device sends it again (e.g. local state was rolled back).
    await app.store.updateReport(res.report.client_report_id, { status: 'QUEUED', server_id: null });
    const run = await app.engine.syncOnce();

    expect(run).toMatchObject({ reportsSynced: 0, reportsDuplicate: 1 });
    expect(server.statuses('report')).toEqual([201, 200]);
    expect(server.reports.size).toBe(1);
    expect(await app.store.getReport(res.report.client_report_id)).toMatchObject({ status: 'SYNCED', server_id: serverId });
    expect(await app.store.listReports(USER_ID)).toHaveLength(1);
  });

  test('(d2) the same client_media_id sent twice: 200, no second file on the server', async () => {
    const app = await openApp();
    const server = new ContractServer(app.http);
    const res = await saved(app, sampleDraft({ media: [photo()] }));
    await app.engine.syncOnce();
    const mediaId = res.media[0]!.client_media_id;
    const serverMediaId = (await app.store.listMedia(res.report.client_report_id))[0]?.server_id;

    await app.store.updateMedia(mediaId, { upload_status: 'PENDING', server_id: null });
    const run = await app.engine.syncOnce();

    expect(run.mediaUploaded).toBe(1);
    expect(server.statuses('media')).toEqual([201, 200]);
    expect(server.media.size).toBe(1);
    expect((await app.store.listMedia(res.report.client_report_id))[0]).toMatchObject({
      upload_status: 'UPLOADED',
      server_id: serverMediaId,
    });
  });

  test('(d3) crash after the server accepted the report but before local state was saved: re-sent, 200, SYNCED', async () => {
    const path = join(tempDir, 'georakshak.db');
    const http = new FakeHttp();
    const server = new ContractServer(http);
    const first = await openApp({ path, http });
    const res = await saved(first, sampleDraft({ media: [photo()] }));
    server.afterReportStored = () => {
      server.afterReportStored = null;
      first.close(); // app process dies with the response on the wire
      throw new Error('app process killed');
    };

    await expect(first.engine.syncOnce()).rejects.toThrow();
    expect(server.reports.size).toBe(1);

    const second = await openApp({ path, http });
    expect(await second.store.getReport(res.report.client_report_id)).toMatchObject({ status: 'QUEUED', server_id: null });
    const run = await second.engine.syncOnce();

    expect(run).toMatchObject({ reportsSynced: 0, reportsDuplicate: 1, mediaUploaded: 1 });
    expect(server.statuses('report')).toEqual([200]);
    expect(server.reports.size).toBe(1);
    expect(await second.store.getReport(res.report.client_report_id)).toMatchObject({
      status: 'SYNCED',
      server_id: server.reports.get(res.report.client_report_id)?.id,
    });
    second.close();
  });

  test('(d3b) response lost on a weak network (no crash): retried later, 200, SYNCED', async () => {
    const app = await openApp();
    const server = new ContractServer(app.http);
    const res = await saved(app, sampleDraft());
    server.afterReportStored = () => {
      server.afterReportStored = null;
      throw new Error('socket closed before response');
    };
    await app.engine.syncOnce();
    expect(await app.store.getReport(res.report.client_report_id)).toMatchObject({ status: 'QUEUED', attempts: 1 });

    app.clock.advance(1_000);
    await app.engine.syncOnce();

    expect(server.statuses('report')).toEqual([200]);
    expect(server.reports.size).toBe(1);
    expect((await app.store.getReport(res.report.client_report_id))?.status).toBe('SYNCED');
  });

  test('(d4) 409: client_report_id already used by another reporter → FAILED, never retried', async () => {
    const app = await openApp();
    const server = new ContractServer(app.http);
    const res = await saved(app, sampleDraft({ media: [photo()] }));
    server.reports.set(res.report.client_report_id, {
      id: 'rp-someone-else',
      reporter: 'another-reporter-token',
      payload: {} as never,
    });

    const run = await app.engine.syncOnce();

    expect(run.reportsFailed).toBe(1);
    const stored = await app.store.getReport(res.report.client_report_id);
    expect(stored?.status).toBe('FAILED');
    expect(stored?.last_error).toBe(
      'Rejected by server (409 CONFLICT): client_report_id already used by another reporter',
    );
    app.clock.advance(24 * 3_600_000);
    await app.engine.syncOnce();
    await app.engine.syncOnce({ force: true });
    expect(app.http.count('POST', /^\/reports$/)).toBe(1);
    expect(app.http.count('POST', /\/media$/)).toBe(0);
    expect(displaySyncStatus(stored!, await app.store.listMedia(res.report.client_report_id)).label).toBe('Failed');
  });

  test('(d5) 409: client_media_id already used for another report → media FAILED, never retried', async () => {
    const app = await openApp();
    const server = new ContractServer(app.http);
    const res = await saved(app, sampleDraft({ media: [photo()] }));
    server.media.set(res.media[0]!.client_media_id, { id: 'ev-elsewhere', reportId: 'rp-other' });

    const run = await app.engine.syncOnce();

    expect(run).toMatchObject({ reportsSynced: 1, mediaFailed: 1 });
    const m = (await app.store.listMedia(res.report.client_report_id))[0]!;
    expect(m.upload_status).toBe('FAILED');
    expect(m.last_error).toContain('409 CONFLICT');
    await app.engine.syncOnce({ force: true });
    expect(app.http.count('POST', /\/media$/)).toBe(1);
  });
});
