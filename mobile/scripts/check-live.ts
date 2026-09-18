/**
 * Opt-in contract check against a running GeoRakshak backend. NOT part of jest
 * (jest never touches the network): run it with `npm run check:live`.
 *
 * It drives the real core modules (queue store, sync engine, inbox service) over
 * a Node HTTP client, so the whole field-reporting chain is exercised without a
 * device:
 *
 *   field officer → GPS position on a mapped road → category → photo + video
 *   → saved with no network → network returns → sync → backend
 *   → authority verification → road BLOCKED → village access recomputed
 *
 * The authority calls (`POST /reports/{id}/verify`) are not part of the mobile
 * app; they are made here the way the web dashboard would make them, so the
 * chain can be shown end to end. Citizen mode and the server-side 30 s video
 * limit are covered too, then the inbox, acknowledgement and cached area risk.
 *
 * Environment (all optional):
 *   API_BASE_URL          default http://localhost:8002/api/v1
 *   DEMO_USER_PASSWORD    default georakshak-local-demo (local-development seed password)
 *   LIVE_OFFICER_EMAIL    default officer.demo@example.org
 *   LIVE_CITIZEN_EMAIL    default citizen.demo@example.org
 *   LIVE_AUTHORITY_EMAIL  default authority.demo@example.org
 *   LIVE_ADMIN_EMAIL      default admin.demo@example.org
 *   LIVE_REPLAY_STEPS     default 0. When > 0, signs in as admin and steps the demo
 *                         replay that many times first, so alerts reach the inbox.
 */

import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ApiClient } from '../src/core/api';
import { migrate } from '../src/core/db';
import { HttpRequest, toApiError } from '../src/core/http';
import { InboxService } from '../src/core/inboxService';
import { SqliteAckQueue, SqliteKeyValueStore } from '../src/core/localCache';
import { DraftMedia, ReportDraft, emptyDraft, queueReport } from '../src/core/reportDraft';
import { SqliteReportStore } from '../src/core/reportStore';
import { RISK_DISCLAIMER, parseRiskAt } from '../src/core/riskService';
import { SyncEngine } from '../src/core/syncEngine';
import { toIsoWithOffset } from '../src/core/time';
import { Clock, User, systemClock } from '../src/core/types';
import { NodeHttpClient } from './lib/nodeHttpClient';
import { openNodeSqlite } from './lib/nodeSqlite';

const BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:8002/api/v1';
const PASSWORD = process.env.DEMO_USER_PASSWORD ?? 'georakshak-local-demo';
const OFFICER = process.env.LIVE_OFFICER_EMAIL ?? 'officer.demo@example.org';
const CITIZEN = process.env.LIVE_CITIZEN_EMAIL ?? 'citizen.demo@example.org';
const AUTHORITY = process.env.LIVE_AUTHORITY_EMAIL ?? 'authority.demo@example.org';
const ADMIN = process.env.LIVE_ADMIN_EMAIL ?? 'admin.demo@example.org';
const REPLAY_STEPS = Number(process.env.LIVE_REPLAY_STEPS ?? '0');

// 1×1 pixel PNG, generated here so no binary fixture is committed.
const PNG_BYTES = Buffer.from(
  '89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c4944415478da63f8ffff3f0005fe02fea7' +
    'd6a4b40000000049454e44ae426082',
  'hex',
);
// A 24-byte MP4 `ftyp` box: a placeholder for the video part, not a real recording.
const MP4_BYTES = Buffer.from('000000186674797069736f6d0000020069736f6d69736f32', 'hex');

const failures: string[] = [];
const warnings: string[] = [];
const notes: string[] = [];

async function step<T>(name: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    const value = await fn();
    console.log(`  ok   ${name}`);
    return value;
  } catch (e) {
    const err = toApiError(e);
    const detail = err.kind === 'network' ? `${err.message} (is the backend running at ${BASE_URL}?)` : err.message;
    console.log(`  FAIL ${name}: ${detail}`);
    failures.push(name);
    return null;
  }
}

function assert(cond: unknown, message: string): void {
  if (!cond) throw new Error(message);
}

const info = (line: string) => console.log(`       ${line}`);

interface Session {
  user: User;
  api: ApiClient;
  token: string;
  /** For endpoints the mobile app does not use (authority actions, demo control). */
  call: (method: HttpRequest['method'], path: string, json?: unknown) => Promise<{ status: number; body: unknown }>;
}

const http = new NodeHttpClient(BASE_URL);
const clock: Clock = systemClock;

async function signIn(email: string): Promise<Session> {
  let token = '';
  const api = new ApiClient(http, async () => token);
  const res = await api.login(email, PASSWORD);
  token = res.access_token;
  return {
    user: res.user,
    api,
    token,
    call: (method, path, json) =>
      http.send({ method, path, json, headers: { Authorization: `Bearer ${token}` } }),
  };
}

type Feature = { id?: string; geometry: { type: string; coordinates: unknown }; properties: Record<string, unknown> };

const features = (body: unknown): Feature[] => ((body as { features?: Feature[] })?.features ?? []) as Feature[];

function lineMidpoint(geometry: Feature['geometry']): [number, number] {
  const coords = (geometry.type === 'LineString'
    ? geometry.coordinates
    : (geometry.coordinates as unknown[])[0]) as [number, number][];
  assert(coords?.length >= 2, 'road segment geometry has no coordinates');
  return coords[Math.floor(coords.length / 2)] as [number, number];
}

/** Great-circle distance in metres (WGS84 sphere), used only to pick a nearby test segment. */
function distanceM([lon1, lat1]: [number, number], [lon2, lat2]: [number, number]): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

const villageName = (v: Feature) => `"${String(v.properties.name ?? '(unnamed)')}" (${String(v.id).slice(0, 8)})`;

const bboxAround = ([lon, lat]: [number, number], pad: number) =>
  `${(lon - pad).toFixed(6)},${(lat - pad).toFixed(6)},${(lon + pad).toFixed(6)},${(lat + pad).toFixed(6)}`;

/** "3 of 156 road segments within 1000 m blocked or at risk" → 3 */
function blockedCount(reason: unknown): number | null {
  const m = /^(\d+) of (\d+) road segments/.exec(String(reason ?? ''));
  return m ? Number(m[1]) : null;
}

function draftAt(
  [lon, lat]: [number, number],
  over: Partial<ReportDraft> & { media?: DraftMedia[] },
): ReportDraft {
  return {
    ...emptyDraft(),
    category: 'ROAD_BLOCKED',
    severity: 'HIGH',
    description: 'Automated contract check (simulated) — not a real observation.',
    lat,
    lon,
    gps_accuracy_m: 12,
    ...over,
  };
}

function mediaFile(dir: string, name: string, bytes: Buffer, mime: string, durationS: number | null): DraftMedia {
  const path = join(dir, name);
  writeFileSync(path, bytes);
  return {
    media_type: durationS === null ? 'PHOTO' : 'VIDEO',
    local_uri: pathToFileURL(path).href,
    mime_type: mime,
    size_bytes: bytes.length,
    duration_s: durationS,
    captured_at: toIsoWithOffset(new Date()),
  };
}

async function main(): Promise<void> {
  console.log(`GeoRakshak mobile → full-chain contract check against ${BASE_URL}`);
  const dir = mkdtempSync(join(tmpdir(), 'georakshak-live-'));

  try {
    const officer = await step(`sign in as the field officer (${OFFICER})`, async () => {
      const s = await signIn(OFFICER);
      assert(s.user.role === 'FIELD_OFFICER', `expected FIELD_OFFICER, got ${s.user.role}`);
      assert((await s.api.me()).id === s.user.id, 'GET /me returned a different user');
      return s;
    });
    if (!officer) return;

    await step('PATCH /me sets preferred_language (hi, then back to en)', async () => {
      assert((await officer.api.updatePreferredLanguage('hi')).preferred_language === 'hi', 'language not set to hi');
      assert((await officer.api.updatePreferredLanguage('en')).preferred_language === 'en', 'language not reset to en');
    });

    if (REPLAY_STEPS > 0) {
      await step(`seed alerts: admin demo replay, ${REPLAY_STEPS} steps`, async () => {
        const admin = await signIn(ADMIN);
        const post = async (path: string) => {
          const res = await admin.call('POST', path);
          // 409 means the replay is already running or finished, which is fine for seeding.
          assert(res.status < 300 || res.status === 409, `POST ${path} → ${res.status}`);
        };
        await post('/demo/replay/start');
        for (let i = 0; i < REPLAY_STEPS; i++) await post('/demo/replay/step');
      });
    }

    // --- Pick a mapped road segment next to a village, so verification has something to block. ---
    const target = await step('choose a mapped road segment beside a pilot village', async () => {
      const villages = features((await officer.call('GET', '/layers/locations?type=VILLAGE')).body);
      assert(villages.length > 0, 'the pilot has no village locations loaded');
      // The village with the fewest roads around it is the one whose access status
      // can actually change: ACCESS_AT_RISK needs every road within 1 km blocked.
      // The reported point must itself be well inside that 1 km, or the verified
      // block would not count towards this village at all.
      let best: { village: Feature; nearby: Feature[]; segment: Feature; point: [number, number]; distanceM: number } | null =
        null;
      for (const village of villages) {
        const centre = village.geometry.coordinates as [number, number];
        const nearby = features((await officer.call('GET', `/road-segments?bbox=${bboxAround(centre, 0.01)}`)).body);
        const candidates = nearby
          .filter((s) => s.properties.status === 'OPEN')
          .map((s) => {
            const point = lineMidpoint(s.geometry);
            return { segment: s, point, distanceM: distanceM(centre, point) };
          })
          .filter((c) => c.distanceM < 800)
          .sort((a, b) => a.distanceM - b.distanceM);
        const closest = candidates[0];
        if (closest && (!best || nearby.length < best.nearby.length)) best = { village, nearby, ...closest };
      }
      assert(best, 'no village with an OPEN road segment whose midpoint is within 800 m');
      const { village, nearby, segment, point } = best!;
      info(
        `village ${villageName(village)} (${village.properties.access_status}) · ${nearby.length} segment(s) ` +
          `within ~1 km · reporting on "${segment.properties.name ?? 'unnamed'}" (${segment.properties.road_class}) ` +
          `at ${point[1].toFixed(5)}, ${point[0].toFixed(5)}, ${Math.round(best!.distanceM)} m from the village`,
      );
      return { village, segment, point, nearby };
    });
    if (!target) return;

    // --- Field officer: queue a ROAD_BLOCKED report with a photo and a video, with no network. ---
    let online = false;
    const first = openNodeSqlite(join(dir, 'georakshak.db'));
    await migrate(first.db);
    const firstStore = new SqliteReportStore(first.db);
    const queued = await step('queue a ROAD_BLOCKED report with a photo and a ≤30 s video while offline', async () => {
      const res = await queueReport(
        draftAt(target.point, {
          media: [
            mediaFile(dir, 'simulated_1x1.png', PNG_BYTES, 'image/png', null),
            mediaFile(dir, 'simulated_placeholder.mp4', MP4_BYTES, 'video/mp4', 12.5),
          ],
        }),
        { store: firstStore, clock, newId: randomUUID, language: 'en', ownerUserId: officer.user.id },
      );
      assert(res.ok, `the draft was rejected: ${res.ok ? '' : res.issues.map((i) => i.message).join(' ')}`);
      const offlineEngine = new SyncEngine({
        store: firstStore,
        api: officer.api,
        clock,
        connectivity: { isOnline: async () => online },
        device: { app_version: 'check-live', platform: 'node' },
        currentUserId: () => officer.user.id,
      });
      const before = http.log.length;
      assert((await offlineEngine.syncOnce()).skipped === 'offline', 'the engine tried to sync while offline');
      assert(http.log.length === before, 'a request was sent while offline');
      if (!res.ok) throw new Error('unreachable');
      return res;
    });
    first.close();
    if (!queued) return;

    // --- Restart the app (reopen the same database file) and sync. ---
    const second = openNodeSqlite(join(dir, 'georakshak.db'));
    await migrate(second.db);
    const store = new SqliteReportStore(second.db);
    await store.recoverInterrupted();
    const kv = new SqliteKeyValueStore(second.db);
    const acks = new SqliteAckQueue(second.db);
    online = true;
    const engine = new SyncEngine({
      store,
      api: officer.api,
      clock,
      connectivity: { isOnline: async () => true },
      device: { app_version: 'check-live', platform: 'node' },
      currentUserId: () => officer.user.id,
    });
    const clientReportId = queued.report.client_report_id;
    const clientMediaId = queued.media[0]!.client_media_id;

    await step('after restart the queue still holds the report and both files', async () => {
      const pending = await store.listPendingWork(officer.user.id);
      assert(pending.length === 1, `expected 1 pending report, got ${pending.length}`);
      assert(pending[0]?.media.length === 2, `expected 2 media rows, got ${pending[0]?.media.length}`);
    });

    const serverId = await step('sync: POST /reports (201) then POST /reports/{id}/media per file', async () => {
      const run = await engine.syncOnce();
      assert(run.reportsSynced === 1, `reportsSynced=${run.reportsSynced}: ${JSON.stringify(run)}`);
      assert(run.mediaUploaded === 2, `mediaUploaded=${run.mediaUploaded}: ${JSON.stringify(run)}`);
      const stored = await store.getReport(clientReportId);
      assert(stored?.status === 'SYNCED', `local status is ${stored?.status}`);
      assert(stored?.server_id, 'no server id was stored');
      const media = await store.listMedia(clientReportId);
      assert(media.every((m) => m.upload_status === 'UPLOADED' && m.server_id), 'a file did not upload');
      return stored!.server_id as string;
    });
    if (!serverId) return;

    await step('the backend snapped the report to the road segment', async () => {
      const res = await officer.call('GET', `/reports/${serverId}`);
      const body = res.body as { road_segment_id: string | null; verification_status: string; provenance: string };
      assert(
        body.road_segment_id === target.segment.id,
        `road_segment_id=${body.road_segment_id}, expected ${target.segment.id}`,
      );
      assert(body.verification_status === 'UNVERIFIED', `verification_status=${body.verification_status}`);
      info(`report ${serverId} · road_segment_id=${body.road_segment_id} · provenance=${body.provenance}`);
    });

    await step('re-sending the same client_report_id and client_media_id is a duplicate (200)', async () => {
      await store.updateReport(clientReportId, { status: 'QUEUED', server_id: null });
      await store.updateMedia(clientMediaId, { upload_status: 'PENDING', server_id: null });
      const run = await engine.syncOnce({ force: true });
      assert(run.reportsDuplicate === 1 && run.reportsSynced === 0, `report was not a duplicate: ${JSON.stringify(run)}`);
      assert(run.mediaUploaded === 1, `media re-upload failed: ${JSON.stringify(run)}`);
      assert((await store.getReport(clientReportId))?.server_id === serverId, 'the server id changed');
    });

    await step('the server enforces the 30 s video limit (422 → media FAILED, no retry loop)', async () => {
      const res = await queueReport(
        draftAt(target.point, {
          category: 'LANDSLIDE',
          severity: 'LOW',
          description: 'Automated contract check (simulated): over-long video, expected to be rejected.',
          media: [mediaFile(dir, 'simulated_too_long.mp4', MP4_BYTES, 'video/mp4', 31)],
        }),
        { store, clock, newId: randomUUID, language: 'en', ownerUserId: officer.user.id },
      );
      assert(res.ok, 'the over-long-video draft could not be queued');
      if (!res.ok) throw new Error('unreachable');
      const run = await engine.syncOnce({ force: true });
      assert(run.mediaFailed === 1, `mediaFailed=${run.mediaFailed}: ${JSON.stringify(run)}`);
      const media = (await store.listMedia(res.report.client_report_id))[0]!;
      assert(media.upload_status === 'FAILED', `media status is ${media.upload_status}`);
      assert(/422/.test(media.last_error ?? ''), `unexpected error: ${media.last_error}`);
      const before = http.log.length;
      await engine.syncOnce({ force: true });
      assert(http.log.length === before, 'a rejected file was retried');
      info(`rejected as expected: ${media.last_error}`);
    });

    // --- Citizen mode: a simplified report that lands as UNVERIFIED (moderated). ---
    await step('citizen mode: a simplified report syncs and lands as UNVERIFIED (moderated)', async () => {
      const citizen = await signIn(CITIZEN);
      assert(citizen.user.role === 'CITIZEN', `expected CITIZEN, got ${citizen.user.role}`);
      const citizenDb = openNodeSqlite(join(dir, 'citizen.db'));
      await migrate(citizenDb.db);
      const citizenStore = new SqliteReportStore(citizenDb.db);
      const res = await queueReport(
        draftAt(target.point, {
          category: 'CRACK',
          severity: 'MEDIUM',
          description: 'Automated contract check (simulated) — citizen observation.',
          media: [],
        }),
        { store: citizenStore, clock, newId: randomUUID, language: 'en', ownerUserId: citizen.user.id },
      );
      assert(res.ok, 'the citizen draft was rejected');
      if (!res.ok) throw new Error('unreachable');
      const citizenEngine = new SyncEngine({
        store: citizenStore,
        api: citizen.api,
        clock,
        connectivity: { isOnline: async () => true },
        device: { app_version: 'check-live', platform: 'node' },
        currentUserId: () => citizen.user.id,
      });
      assert((await citizenEngine.syncOnce()).reportsSynced === 1, 'the citizen report did not sync');
      const id = (await citizenStore.getReport(res.report.client_report_id))?.server_id;
      const body = (await citizen.call('GET', `/reports/${id}`)).body as {
        reporter_role: string;
        verification_status: string;
        provenance: string;
      };
      assert(body.reporter_role === 'CITIZEN', `reporter_role=${body.reporter_role}`);
      assert(body.verification_status === 'UNVERIFIED', `verification_status=${body.verification_status}`);
      info(`citizen report ${id} · ${body.reporter_role} · ${body.verification_status} · ${body.provenance}`);
      citizenDb.close();
    });

    // --- Authority verification → road BLOCKED → village access recomputed. ---
    const authority = await step(`sign in as the authority (${AUTHORITY})`, async () => {
      const s = await signIn(AUTHORITY);
      assert(s.user.role.endsWith('AUTHORITY'), `expected an authority role, got ${s.user.role}`);
      return s;
    });

    if (authority) {
      const villageBbox = bboxAround(target.village.geometry.coordinates as [number, number], 0.002);
      const fetchVillage = async (): Promise<Feature | undefined> =>
        features((await officer.call('GET', `/layers/locations?type=VILLAGE&bbox=${villageBbox}`)).body).find(
          (v) => v.id === target.village.id,
        );
      const villageBefore = await fetchVillage();

      await step('POST /reports/{id}/verify → effects.road_segment.status == BLOCKED', async () => {
        const res = await authority.call('POST', `/reports/${serverId}/verify`, {
          decision: 'VERIFIED',
          note: 'Automated contract check (simulated): photo and video show the road blocked.',
        });
        assert(res.status === 200, `status ${res.status}: ${JSON.stringify(res.body).slice(0, 200)}`);
        const body = res.body as {
          verification_status: string;
          effects: {
            road_segment: { id: string; status: string } | null;
            villages_access_at_risk: number | null;
            priority_recomputed: boolean;
          };
        };
        assert(body.verification_status === 'VERIFIED', `verification_status=${body.verification_status}`);
        assert(body.effects.road_segment, 'the verification produced no road-segment effect');
        assert(
          body.effects.road_segment?.status === 'BLOCKED',
          `road segment status is ${body.effects.road_segment?.status}, expected BLOCKED`,
        );
        assert(body.effects.road_segment?.id === target.segment.id, 'a different road segment was blocked');
        info(
          `effects: road_segment=${body.effects.road_segment?.id} → ${body.effects.road_segment?.status} · ` +
            `villages_access_at_risk=${body.effects.villages_access_at_risk} · ` +
            `priority_recomputed=${body.effects.priority_recomputed}`,
        );
        notes.push(`villages_access_at_risk after verification: ${body.effects.villages_access_at_risk}`);
      });

      await step('the field officer now sees the segment as BLOCKED by a verified report', async () => {
        const blocked = features((await officer.call('GET', '/road-segments?status=BLOCKED')).body).find(
          (s) => s.id === target.segment.id,
        );
        assert(blocked, 'the blocked segment is not in GET /road-segments?status=BLOCKED');
        assert(
          blocked?.properties.status_source === 'VERIFIED_REPORT',
          `status_source=${blocked?.properties.status_source}`,
        );
        assert(blocked?.properties.status_report_id === serverId, `status_report_id=${blocked?.properties.status_report_id}`);
        info(
          `segment ${target.segment.id} · ${blocked?.properties.status} · ${blocked?.properties.status_source} · ` +
            `"${blocked?.properties.status_reason}" · villages_access_at_risk=${blocked?.properties.villages_access_at_risk}`,
        );
      });

      const afterVerify = await step('village access is recomputed for the village beside that road', async () => {
        const after = await fetchVillage();
        assert(after, 'the village disappeared from the locations layer');
        const before = blockedCount(villageBefore?.properties.access_status_reason);
        const now = blockedCount(after?.properties.access_status_reason);
        info(
          `village ${villageName(target.village)}: ${villageBefore?.properties.access_status} → ` +
            `${after?.properties.access_status} · "${after?.properties.access_status_reason}"`,
        );
        assert(
          before !== null && now !== null,
          `could not read the access reason: "${after?.properties.access_status_reason}"`,
        );
        assert(
          (now as number) > (before as number) || after?.properties.access_status === 'ACCESS_AT_RISK',
          `blocked/at-risk segment count did not rise (${before} → ${now})`,
        );
        return after as Feature;
      });

      // The village flips only when every road within 1 km is blocked or at risk
      // (backend/app/services/roads.py). One verified report is rarely enough in
      // this pilot, so the authority blocks the remaining roads — as it would on the
      // dashboard — to show the last link of the chain.
      if (afterVerify && afterVerify.properties.access_status !== 'ACCESS_AT_RISK') {
        await step('village ACCESS_AT_RISK once every road within 1 km is blocked (authority overrides)', async () => {
          const nearby = features(
            (await officer.call(
              'GET',
              `/road-segments?bbox=${bboxAround(target.village.geometry.coordinates as [number, number], 0.01)}`,
            )).body,
          );
          const remaining = nearby.filter((s) => s.properties.status !== 'BLOCKED' && s.properties.status !== 'AT_RISK');
          if (nearby.length > 40) {
            warnings.push(
              `skipped the ACCESS_AT_RISK demonstration: ${nearby.length} road segments near the village would ` +
                'have to be overridden. Village access stays OK, which is the correct rule outcome.',
            );
            return;
          }
          for (const s of remaining) {
            const res = await authority.call('POST', `/road-segments/${s.id}/status-override`, {
              status: 'BLOCKED',
              reason: 'Automated contract check (simulated): blocking every road within 1 km of the village.',
            });
            assert(res.status === 200, `override ${s.id} → ${res.status}`);
          }
          const after = await fetchVillage();
          info(
            `overrode ${remaining.length} of ${nearby.length} nearby segment(s) · village ` +
              `${villageName(target.village)}: ${after?.properties.access_status} · ` +
              `"${after?.properties.access_status_reason}"`,
          );
          assert(
            after?.properties.access_status === 'ACCESS_AT_RISK',
            `village access_status is ${after?.properties.access_status}, expected ACCESS_AT_RISK`,
          );
          notes.push(
            `ACCESS_AT_RISK reached after the verified report plus ${remaining.length} authority override(s); ` +
              'the verified report alone accounts for one blocked road.',
          );
        });
      }

      await step('the report reads back as VERIFIED for the reporter', async () => {
        const body = (await officer.call('GET', `/reports/${serverId}`)).body as {
          verification_status: string;
          verified_at: string | null;
          verification_note: string | null;
        };
        assert(body.verification_status === 'VERIFIED', `verification_status=${body.verification_status}`);
        assert(body.verified_at, 'verified_at is empty');
        info(`report ${serverId} · VERIFIED at ${body.verified_at}`);
      });
    }

    // --- Inbox, acknowledgement and cached area risk (mobile endpoints). ---
    const inbox = new InboxService({
      api: officer.api,
      cache: kv,
      acks,
      clock,
      userId: officer.user.id,
      role: officer.user.role,
    });
    const items = await step('GET /me/inbox', async () => {
      const snap = await inbox.refresh();
      assert(snap.updated_at !== null, 'the inbox was not cached with a last-updated time');
      info(
        `${snap.items.length} item(s)` +
          snap.items.map((i) => ` [${i.tier}/${i.severity}${i.is_demo ? '/DEMO' : ''}]`).join(''),
      );
      return snap.items;
    });

    if (items && items.length > 0) {
      await step('POST /alerts/{id}/acknowledge on the first inbox item', async () => {
        const outcome = await inbox.acknowledge(items[0]!.alert_id);
        assert(outcome === 'SENT', `acknowledgement outcome was ${outcome}`);
        const again = await inbox.refresh();
        assert(
          again.items.find((i) => i.alert_id === items[0]!.alert_id)?.acknowledged_at,
          'the server did not report acknowledged_at',
        );
        assert((await acks.list()).length === 0, 'the acknowledgement queue was not drained');
      });
    } else {
      warnings.push(
        'inbox was empty, so the acknowledgement path was not exercised. Re-run with LIVE_REPLAY_STEPS=20.',
      );
    }

    await step('GET /risk/at for the reported position', async () => {
      let body: unknown;
      try {
        body = await officer.api.riskAt(target.point[1], target.point[0], 0);
      } catch (e) {
        const err = toApiError(e);
        // A backend that has not run a monitoring cycle yet has no assessment to serve.
        if (err.status === 404 && /no assessment/i.test(err.message)) {
          warnings.push(
            'GET /risk/at has no assessment for this point yet, so risk parsing was not exercised. ' +
              'Re-run with LIVE_REPLAY_STEPS=20, or after a monitoring cycle.',
          );
          return;
        }
        throw e;
      }
      const risk = parseRiskAt(body, target.point[1], target.point[0], new Date().toISOString());
      assert(risk.severity !== null, `no severity in the response: ${JSON.stringify(body).slice(0, 200)}`);
      assert(risk.provenance !== null, 'no provenance in the response');
      info(
        `severity=${risk.severity} score=${risk.score ?? 'n/a'} confidence=${risk.confidence ?? 'n/a'} ` +
          `provenance=${risk.provenance} run_mode=${risk.run_mode ?? 'n/a'} grid_code=${risk.grid_code ?? 'n/a'}`,
      );
      info(`factors: ${risk.factors.length ? risk.factors.join(' | ') : 'none returned'}`);
      assert(
        risk.server_disclaimer === null || risk.server_disclaimer === RISK_DISCLAIMER,
        `unexpected disclaimer: ${risk.server_disclaimer}`,
      );
    });

    second.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
    for (const n of notes) console.log(`  note ${n}`);
    for (const w of warnings) console.log(`  warn ${w}`);
    if (failures.length) {
      console.log(`\nFAILED: ${failures.length} step(s): ${failures.join(', ')}`);
      process.exitCode = 1;
    } else {
      console.log('\nFull chain passed: offline report → sync → verification → road BLOCKED → village access.');
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
