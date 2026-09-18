// SyncEngine behaviour against a fake of our backend's report endpoints.
// The four required offline-queue areas (offline save, restart, reconnect,
// duplicate safety) live in offlineQueue.test.ts.

import { SyncEngine, SyncEngineDeps, backoffDelayMs, canDiscard, displaySyncStatus, mediaStatusLabel } from '../syncEngine';
import {
  ContractServer,
  FakeClock,
  FakeHttp,
  USER_ID,
  apiFor,
  buildReport,
  openStores,
  photo,
  sampleDraft,
  video,
} from './helpers';

const device = { app_version: '0.1.0-test', platform: 'android' };

async function setup(opts: { online?: boolean } = {}) {
  const stores = await openStores();
  const clock = new FakeClock();
  const http = new FakeHttp();
  const server = new ContractServer(http);
  const online = { value: opts.online ?? true };
  const onAuthRequired = jest.fn();
  const deps: SyncEngineDeps = {
    store: stores.store,
    api: apiFor(http),
    clock,
    connectivity: { isOnline: async () => online.value },
    device,
    currentUserId: () => USER_ID,
    backoff: { baseMs: 1_000, maxMs: 60_000 },
    onAuthRequired,
  };
  return { ...stores, clock, http, server, online, engine: new SyncEngine(deps), deps, onAuthRequired };
}

describe('SyncEngine', () => {
  test('sends the api.md §5.6 payload, then media; stores server ids', async () => {
    const t = await setup();
    const { report, media } = buildReport(
      t.clock,
      sampleDraft({ media: [photo(), video()], alert_id: 'al55', location_adjusted_manually: true, manual_uncertainty_m: 25 }),
    );
    await t.store.addReport(report, media);

    const res = await t.engine.syncOnce();

    expect(res).toMatchObject({ reportsSynced: 1, mediaUploaded: 2, stoppedBy: null });
    expect(t.http.requests[0]?.json).toMatchObject({
      client_report_id: report.client_report_id,
      alert_id: 'al55',
      category: 'ROAD_BLOCKED',
      severity: 'HIGH',
      language: 'en',
      location: { type: 'Point', coordinates: [91.8043, 25.6011] },
      gps_accuracy_m: 25,
      location_adjusted_manually: true,
      media_expected: 2,
      device_info: device,
    });
    expect(t.http.requests[0]?.headers?.Authorization).toBe('Bearer test-token');
    const upload = t.http.requests[1];
    expect(Object.keys(upload?.multipart?.fields ?? {})).toEqual(
      expect.arrayContaining(['client_media_id', 'media_type', 'captured_at']),
    );
    const stored = await t.store.getReport(report.client_report_id);
    expect(stored).toMatchObject({ status: 'SYNCED', server_id: t.server.reports.get(report.client_report_id)?.id });
    const storedMedia = await t.store.listMedia(report.client_report_id);
    expect(storedMedia.every((m) => m.upload_status === 'UPLOADED' && m.server_id?.startsWith('ev-'))).toBe(true);
    expect(displaySyncStatus(stored!, storedMedia).label).toBe('Synced');
  });

  test('video upload sends duration_s so the server can enforce the 30 s limit', async () => {
    const t = await setup();
    const { report, media } = buildReport(t.clock, sampleDraft({ media: [photo(), video(7_000_000, 12.5)] }));
    await t.store.addReport(report, media);

    await t.engine.syncOnce();

    const uploads = t.http.requests.filter((r) => r.multipart);
    expect(uploads.find((r) => r.multipart?.fields.media_type === 'VIDEO')?.multipart?.fields.duration_s).toBe('12.5');
    expect(uploads.find((r) => r.multipart?.fields.media_type === 'PHOTO')?.multipart?.fields).not.toHaveProperty('duration_s');
  });

  test('server rejects a video over 30 s (422): media FAILED with the message, report stays synced', async () => {
    const t = await setup();
    const { report, media } = buildReport(t.clock, sampleDraft({ media: [video(7_000_000, 30.04)] }));
    await t.store.addReport(report, media);

    const res = await t.engine.syncOnce();

    expect(res).toMatchObject({ reportsSynced: 1, mediaFailed: 1 });
    const m = (await t.store.listMedia(report.client_report_id))[0]!;
    expect(m.upload_status).toBe('FAILED');
    expect(m.last_error).toContain('422 VALIDATION_ERROR');
    expect(m.last_error).toContain('Video must be 30 s or shorter');
  });

  test('request failure while "online": stays QUEUED with backoff and the run stops early', async () => {
    const t = await setup();
    const a = buildReport(t.clock);
    const b = buildReport(t.clock);
    await t.store.addReport(a.report, a.media);
    await t.store.addReport(b.report, b.media);
    t.http.offline = true;

    const res = await t.engine.syncOnce();

    expect(res.stoppedBy).toBe('network');
    expect(t.http.requests).toHaveLength(1); // did not hammer the second report
    const stored = await t.store.getReport(a.report.client_report_id);
    expect(stored).toMatchObject({ status: 'QUEUED', attempts: 1 });
    expect(stored?.next_attempt_at).toBe(new Date(t.clock.now().getTime() + 1_000).toISOString());
    expect(displaySyncStatus(stored!, []).label).toBe('Queued');
  });

  test('partial sync: report syncs, media gets 5xx, retried only after the backoff delay', async () => {
    const t = await setup();
    const { report, media } = buildReport(t.clock, sampleDraft({ media: [video()] }));
    await t.store.addReport(report, media);
    let failNext = true;
    t.http.on('POST', /\/media$/, (req) => {
      if (failNext) {
        failNext = false;
        return { status: 503, body: { error: { code: 'UPSTREAM_UNAVAILABLE', message: 'storage down' } } };
      }
      return { status: 201, body: { id: 'ev-1', client_media_id: req.multipart?.fields.client_media_id, media_type: 'VIDEO', upload_status: 'UPLOADED' } };
    });

    const first = await t.engine.syncOnce();
    expect(first).toMatchObject({ reportsSynced: 1, mediaUploaded: 0, retryScheduled: 1 });
    const stored = await t.store.getReport(report.client_report_id);
    let m = (await t.store.listMedia(report.client_report_id))[0]!;
    expect(stored?.status).toBe('SYNCED');
    expect(m).toMatchObject({ upload_status: 'PENDING', attempts: 1, last_error: 'storage down' });
    expect(displaySyncStatus(stored!, [m]).label).toBe('Media uploading');
    expect(mediaStatusLabel(stored!, m)).toBe('Waiting to upload');

    await t.engine.syncOnce(); // not due yet
    expect(t.http.count('POST', /\/media$/)).toBe(1);

    t.clock.advance(1_000);
    expect((await t.engine.syncOnce()).mediaUploaded).toBe(1);
    expect(t.http.count('POST', /^\/reports$/)).toBe(1); // report was not resent
    m = (await t.store.listMedia(report.client_report_id))[0]!;
    expect(m).toMatchObject({ upload_status: 'UPLOADED', server_id: 'ev-1' });
  });

  test('report data goes first for every queued report, before any media; photos before videos', async () => {
    const t = await setup();
    const a = buildReport(t.clock, sampleDraft({ media: [video(20_000_000)] }));
    t.clock.advance(1);
    const b = buildReport(t.clock, sampleDraft({ media: [photo()] }));
    await t.store.addReport(a.report, a.media);
    await t.store.addReport(b.report, b.media);

    await t.engine.syncOnce();

    const kinds = t.http.requests.map((r) => (r.multipart ? `media:${r.multipart.fields.media_type}` : 'report'));
    expect(kinds).toEqual(['report', 'report', 'media:PHOTO', 'media:VIDEO']);
  });

  test('4xx validation error (server rejects gps_accuracy_m) marks FAILED with details; no automatic retry', async () => {
    const t = await setup();
    const { report, media } = buildReport(t.clock, sampleDraft({ media: [photo()] }));
    // A row written before accuracy became mandatory on the device.
    await t.store.addReport({ ...report, gps_accuracy_m: null }, media);

    const res = await t.engine.syncOnce();

    expect(res.reportsFailed).toBe(1);
    const stored = await t.store.getReport(report.client_report_id);
    expect(stored?.status).toBe('FAILED');
    expect(stored?.last_error).toContain('422 VALIDATION_ERROR');
    expect(stored?.last_error).toContain('gps_accuracy_m: Input should be greater than 0');
    expect(displaySyncStatus(stored!, []).label).toBe('Failed');

    t.clock.advance(3_600_000);
    await t.engine.syncOnce({ force: true });
    expect(t.http.count('POST', /^\/reports$/)).toBe(1);
    expect(t.http.count('POST', /\/media$/)).toBe(0);

    // Explicit user retry puts it back in the queue.
    await t.store.retryFailed(report.client_report_id);
    expect((await t.store.getReport(report.client_report_id))?.status).toBe('QUEUED');
  });

  test('media rejected as too large (413) is FAILED; the synced report is unaffected', async () => {
    const t = await setup();
    t.http.on('POST', /\/media$/, () => ({
      status: 413,
      body: { error: { code: 'PAYLOAD_TOO_LARGE', message: 'VIDEO exceeds the size limit' } },
    }));
    const { report, media } = buildReport(t.clock, sampleDraft({ media: [video()] }));
    await t.store.addReport(report, media);
    expect((await t.engine.syncOnce()).mediaFailed).toBe(1);
    const stored = await t.store.getReport(report.client_report_id);
    const m = await t.store.listMedia(report.client_report_id);
    expect(stored?.status).toBe('SYNCED');
    expect(m[0]?.upload_status).toBe('FAILED');
    const status = displaySyncStatus(stored!, m);
    expect(status.label).toBe('Failed');
    expect(status.detail).toContain('VIDEO exceeds the size limit');
    await t.engine.syncOnce({ force: true });
    expect(t.http.count('POST', /\/media$/)).toBe(1);
  });

  test('401 keeps the item queued without using an attempt and asks the user to sign in', async () => {
    const t = await setup();
    t.http.on('POST', /^\/reports$/, () => ({ status: 401, body: { error: { code: 'UNAUTHENTICATED', message: 'expired' } } }));
    const { report } = buildReport(t.clock);
    await t.store.addReport(report, []);
    const res = await t.engine.syncOnce();
    expect(res.stoppedBy).toBe('auth');
    expect(t.onAuthRequired).toHaveBeenCalled();
    expect(await t.store.getReport(report.client_report_id)).toMatchObject({ status: 'QUEUED', attempts: 0 });
  });

  test('server lost a synced report (media upload 404): report is re-sent, then its media', async () => {
    const t = await setup();
    const { report, media } = buildReport(t.clock, sampleDraft({ media: [photo(), photo()] }));
    await t.store.addReport(report, media);
    t.http.on('POST', /\/media$/, () => ({ status: 503, body: { error: { code: 'UPSTREAM_UNAVAILABLE', message: 'later' } } }));
    await t.engine.syncOnce();
    const firstServerId = (await t.store.getReport(report.client_report_id))?.server_id;
    expect(firstServerId).toBeTruthy();

    // Server database reset (a fresh server with no records); storage is back.
    const server = new ContractServer(t.http);
    t.clock.advance(60_000);
    const res = await t.engine.syncOnce();

    expect(res.reportsRequeued).toBe(1);
    // The sibling photo did not hit the stale id a second time in the same run.
    expect(t.http.requests.filter((r) => r.path === `/reports/${firstServerId}/media`)).toHaveLength(3);
    const requeued = await t.store.getReport(report.client_report_id);
    expect(requeued).toMatchObject({ status: 'QUEUED', server_id: null });
    expect((await t.store.listMedia(report.client_report_id)).map((m) => m.upload_status)).toEqual(['PENDING', 'PENDING']);

    t.clock.advance(60_000);
    const again = await t.engine.syncOnce();
    expect(again).toMatchObject({ reportsSynced: 1, mediaUploaded: 2 });
    expect(server.reports.size).toBe(1);
    expect(server.media.size).toBe(2);
  });

  test('a report discarded while a run is in progress is not sent', async () => {
    const t = await setup();
    const a = buildReport(t.clock);
    t.clock.advance(1);
    const b = buildReport(t.clock);
    await t.store.addReport(a.report, a.media);
    await t.store.addReport(b.report, b.media);
    // The user discards B while A is on the wire.
    t.server.afterReportStored = async () => {
      expect(await t.store.discardUnsynced(b.report.client_report_id)).toEqual([]);
    };

    await t.engine.syncOnce();

    expect(t.http.count('POST', /^\/reports$/)).toBe(1);
    expect(await t.store.getReport(b.report.client_report_id)).toBeNull();
  });

  test('discard: only reports that never reached the server; media file URIs are returned for deletion', async () => {
    const t = await setup();
    const queued = buildReport(t.clock, sampleDraft({ media: [photo(), video()] }));
    const sent = buildReport(t.clock);
    await t.store.addReport(queued.report, queued.media);
    await t.store.addReport(sent.report, sent.media);
    await t.store.updateReport(sent.report.client_report_id, { status: 'SYNCED', server_id: 'rp-x' });

    expect(canDiscard((await t.store.getReport(queued.report.client_report_id))!)).toBe(true);
    expect(canDiscard((await t.store.getReport(sent.report.client_report_id))!)).toBe(false);
    expect(await t.store.discardUnsynced(sent.report.client_report_id)).toBeNull();

    const uris = await t.store.discardUnsynced(queued.report.client_report_id);
    expect(uris?.sort()).toEqual(queued.media.map((m) => m.local_uri).sort());
    expect(await t.store.getReport(queued.report.client_report_id)).toBeNull();
    expect(await t.store.listMedia(queued.report.client_report_id)).toEqual([]);
    expect(await t.store.discardUnsynced(queued.report.client_report_id)).toBeNull();
  });

  test('only the signed-in user’s reports are synced; nothing when signed out', async () => {
    const t = await setup();
    const mine = buildReport(t.clock);
    const other = buildReport(t.clock, sampleDraft(), '22222222-2222-4222-8222-222222222222');
    await t.store.addReport(mine.report, []);
    await t.store.addReport(other.report, []);
    await t.engine.syncOnce();
    expect(t.http.count('POST', /^\/reports$/)).toBe(1);
    expect((await t.store.getReport(other.report.client_report_id))?.status).toBe('QUEUED');

    const signedOut = new SyncEngine({ ...t.deps, currentUserId: () => null });
    expect((await signedOut.syncOnce()).stoppedBy).toBe('auth');
  });

  test('media whose local file vanished is FAILED without an upload attempt', async () => {
    const t = await setup();
    const engine = new SyncEngine({ ...t.deps, fileExists: async () => false });
    const { report, media } = buildReport(t.clock, sampleDraft({ media: [photo()] }));
    await t.store.addReport(report, media);
    expect((await engine.syncOnce()).mediaFailed).toBe(1);
    expect(t.http.count('POST', /\/media$/)).toBe(0);
  });

  test('backoff grows exponentially and is capped', () => {
    const p = { baseMs: 5_000, maxMs: 600_000 };
    expect([1, 2, 3, 4].map((n) => backoffDelayMs(n, p))).toEqual([5_000, 10_000, 20_000, 40_000]);
    expect(backoffDelayMs(50, p)).toBe(600_000);
  });
});
