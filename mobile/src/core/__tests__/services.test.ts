import { ApiClient } from '../api';
import { AuthService, SecretStore, modeForRole } from '../authService';
import { FetchHttpClient } from '../fetchHttpClient';
import { ApiError } from '../http';
import { InboxService } from '../inboxService';
import { RISK_DISCLAIMER, RiskService, parseRiskAt } from '../riskService';
import { SyncEngine } from '../syncEngine';
import { ignoresBackoff, SyncScheduler, SyncTrigger } from '../syncScheduler';
import { pushRegistrationStatus, registerForPush, PUSH_REGISTRATION_ENABLED } from '../pushRegistration';
import { MockHttpClient } from '../../mock/mockHttpClient';
import { User } from '../types';
import { FakeClock, FakeHttp, USER_ID, apiFor, buildReport, openStores, photo, sampleDraft } from './helpers';

class MemorySecrets implements SecretStore {
  readonly data = new Map<string, string>();
  async get(k: string) {
    return this.data.get(k) ?? null;
  }
  async set(k: string, v: string) {
    this.data.set(k, v);
  }
  async remove(k: string) {
    this.data.delete(k);
  }
}

const fieldUser: User = {
  id: USER_ID,
  full_name: 'Test Field Officer (simulated)',
  email: 'field.test@example.org',
  role: 'FIELD_OFFICER',
  preferred_language: 'en',
  admin_boundary_id: null,
  is_demo_account: true,
};

describe('AuthService', () => {
  async function setup() {
    const s = await openStores();
    const http = new FakeHttp();
    const secrets = new MemorySecrets();
    let auth!: AuthService;
    const api = new ApiClient(http, () => auth.getToken());
    auth = new AuthService({ api, secrets, cache: s.kv, clock: new FakeClock() });
    http.on('POST', /^\/auth\/login$/, (req) => {
      const { password } = req.json as { password: string };
      if (password !== 'right') return { status: 401, body: { error: { code: 'UNAUTHENTICATED', message: 'Invalid credentials' } } };
      return { status: 200, body: { access_token: 'jwt-1', token_type: 'bearer', expires_in: 3600, user: fieldUser } };
    });
    http.on('GET', /^\/me$/, () => ({ status: 200, body: fieldUser }));
    http.on('PATCH', /^\/me$/, (req) => ({ status: 200, body: { ...fieldUser, ...(req.json as object) } }));
    return { ...s, http, secrets, auth };
  }

  test('login stores the token securely and sends it as Bearer', async () => {
    const t = await setup();
    await expect(t.auth.login('field.test@example.org', 'wrong')).rejects.toMatchObject({ kind: 'unauthenticated' });
    const user = await t.auth.login(' field.test@example.org ', 'right');
    expect(user.role).toBe('FIELD_OFFICER');
    expect(t.secrets.data.get('georakshak_access_token')).toBe('jwt-1');
    await t.auth.restore();
    expect(t.http.requests.at(-1)?.headers?.Authorization).toBe('Bearer jwt-1');
  });

  test('restore works offline from the cached profile; 401 clears the session', async () => {
    const t = await setup();
    await t.auth.login('field.test@example.org', 'right');
    t.http.offline = true;
    expect(await t.auth.restore()).toEqual({ user: fieldUser, offline: true });

    t.http.offline = false;
    t.http.on('GET', /^\/me$/, () => ({ status: 401, body: { error: { code: 'UNAUTHENTICATED', message: 'expired' } } }));
    expect(await t.auth.restore()).toBeNull();
    expect(t.secrets.data.size).toBe(0);
  });

  test('language preference: PATCH /me with preferred_language; pilot placeholder is not sendable', async () => {
    const t = await setup();
    await t.auth.login('field.test@example.org', 'right');
    const user = await t.auth.updateLanguage('hi');
    expect(user.preferred_language).toBe('hi');
    expect(t.http.requests.at(-1)).toMatchObject({ method: 'PATCH', path: '/me', json: { preferred_language: 'hi' } });
    await expect(t.auth.updateLanguage('pilot')).rejects.toThrow(/not available/);
  });

  test('logout clears the token', async () => {
    const t = await setup();
    await t.auth.login('field.test@example.org', 'right');
    await t.auth.logout();
    expect(t.auth.currentUser).toBeNull();
    expect(await t.auth.getToken()).toBeNull();
  });

  test('role → app mode', () => {
    expect(modeForRole('FIELD_OFFICER')).toBe('FIELD');
    expect(modeForRole('CITIZEN')).toBe('CITIZEN');
    expect(modeForRole('DISTRICT_AUTHORITY')).toBe('UNSUPPORTED');
  });
});

describe('ApiError classification', () => {
  const res = (status: number) => ApiError.fromResponse({ status, body: { error: { code: 'X', message: 'm' } } });
  test.each([
    [400, 'client', false],
    [401, 'unauthenticated', false],
    [403, 'client', false],
    [404, 'client', false],
    [408, 'server', true],
    [409, 'client', false],
    [413, 'client', false],
    [422, 'client', false],
    [429, 'server', true],
    [500, 'server', true],
    [503, 'server', true],
  ])('%i → %s (retryable %s)', (status, kind, retryable) => {
    expect(res(status).kind).toBe(kind);
    expect(res(status).retryable).toBe(retryable);
  });
});

describe('FetchHttpClient (with an injected fetch, no network)', () => {
  test('builds URL, JSON body and parses the response; transport errors become NetworkError', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const client = new FetchHttpClient({
      baseUrl: 'http://192.0.2.10:8000/api/v1/',
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ ok: true }), { status: 201 });
      },
    });
    const r = await client.send({ method: 'GET', path: '/risk/at', query: { lat: 25.6, lon: 91.8, lead_time_h: 0 } });
    expect(r).toEqual({ status: 201, body: { ok: true } });
    expect(calls[0]?.url).toBe('http://192.0.2.10:8000/api/v1/risk/at?lat=25.6&lon=91.8&lead_time_h=0');

    const failing = new FetchHttpClient({
      baseUrl: 'http://192.0.2.10:8000/api/v1',
      fetchImpl: async () => {
        throw new TypeError('Network request failed');
      },
    });
    await expect(failing.send({ method: 'POST', path: '/reports', json: {} })).rejects.toMatchObject({
      name: 'NetworkError',
    });
  });
});

describe('RiskService', () => {
  test('parses the risk-zone detail shape and caches with fetch time', async () => {
    const s = await openStores();
    const http = new FakeHttp().on('GET', /^\/risk\/at$/, () => ({
      status: 200,
      body: {
        grid_code: 'PILOT-TEST',
        assessment: {
          score: 0.71,
          severity: 'HIGH',
          confidence: 'LOW',
          provenance: 'MODEL_OUTPUT',
          run_mode: 'DEMO_REPLAY',
          factors: [{ text: 'Simulated factor A' }, { label: 'Simulated factor B' }, {}],
        },
      },
    }));
    const clock = new FakeClock();
    const svc = new RiskService({ api: apiFor(http), cache: s.kv, clock, userId: USER_ID });
    expect(await svc.getCached()).toBeNull();
    const risk = await svc.refresh(25.6, 91.8);
    expect(risk).toMatchObject({ severity: 'HIGH', score: 0.71, factors: ['Simulated factor A', 'Simulated factor B'] });
    expect(http.requests[0]?.query).toEqual({ lat: 25.6, lon: 91.8, lead_time_h: 0 });
    http.offline = true;
    await expect(svc.refresh(25.6, 91.8)).rejects.toBeInstanceOf(ApiError);
    expect((await svc.getCached())?.fetched_at).toBe(clock.now().toISOString());
    expect(RISK_DISCLAIMER).toBe('Decision-support risk estimate. Not an official warning.');
  });

  test('unknown fields stay null instead of being guessed', () => {
    expect(parseRiskAt({}, 1, 2, 't')).toMatchObject({ severity: null, score: null, provenance: null, factors: [] });
  });
});

describe('SyncScheduler', () => {
  test('runs on start, on connectivity regained (not on every online event), on foreground and interval', async () => {
    const runs: string[] = [];
    let netCb: (online: boolean) => void = () => {};
    let fgCb: () => void = () => {};
    let tick: () => void = () => {};
    const cleared: unknown[] = [];
    const sched = new SyncScheduler({
      run: async (t) => {
        runs.push(t);
      },
      subscribeConnectivity: (cb) => {
        netCb = cb;
        cb(true); // NetInfo's initial state; must not count as "regained"
        return () => {};
      },
      subscribeForeground: (cb) => {
        fgCb = cb;
        return () => {};
      },
      intervalMs: 30_000,
      setInterval: (fn) => {
        tick = fn;
        return 'h';
      },
      clearInterval: (h) => cleared.push(h),
    });
    sched.start();
    await sched.idle();
    netCb(false);
    netCb(true);
    await sched.idle();
    netCb(true); // already online
    await sched.idle();
    fgCb();
    await sched.idle();
    tick();
    await sched.idle();
    await sched.syncNow();
    sched.stop();
    expect(runs).toEqual(['start', 'connectivity', 'foreground', 'interval', 'manual']);
    expect(cleared).toEqual(['h']);
  });

  test('manual and reconnect runs ignore backoff timers; periodic and foreground runs respect them', () => {
    expect((['manual', 'connectivity'] as SyncTrigger[]).map(ignoresBackoff)).toEqual([true, true]);
    expect((['start', 'interval', 'foreground'] as SyncTrigger[]).map(ignoresBackoff)).toEqual([false, false, false]);
  });
});

describe('push registration placeholder', () => {
  test('is disabled and never reports a connection', async () => {
    expect(PUSH_REGISTRATION_ENABLED).toBe(false);
    expect(pushRegistrationStatus()).toBe('NOT_CONNECTED');
    expect((await registerForPush()).registered).toBe(false);
  });
});

describe('mock mode end to end (in-memory mock backend, SIMULATED_DEMO)', () => {
  test('login → queue report offline → sync → duplicate-safe → inbox acknowledge', async () => {
    const s = await openStores();
    const clock = new FakeClock();
    const mock = new MockHttpClient(clock, 0);
    const secrets = new MemorySecrets();
    let auth!: AuthService;
    const api = new ApiClient(mock, () => auth.getToken());
    auth = new AuthService({ api, secrets, cache: s.kv, clock });
    const user = await auth.login('field.mock@example.org', 'anything');
    expect(user.is_demo_account).toBe(true);

    let online = false;
    const engine = new SyncEngine({
      store: s.store,
      api,
      clock,
      connectivity: { isOnline: async () => online },
      device: { app_version: 'test', platform: 'android' },
      currentUserId: () => auth.currentUser?.id ?? null,
    });
    const { report, media } = buildReport(clock, sampleDraft({ media: [photo()] }), user.id);
    await s.store.addReport(report, media);
    expect((await engine.syncOnce()).skipped).toBe('offline');

    online = true;
    expect(await engine.syncOnce()).toMatchObject({ reportsSynced: 1, mediaUploaded: 1 });
    // Resending the same report to the mock is a duplicate, not a new record.
    await s.store.updateReport(report.client_report_id, { status: 'QUEUED' });
    expect(await engine.syncOnce()).toMatchObject({ reportsDuplicate: 1, reportsSynced: 0 });

    const inbox = new InboxService({ api, cache: s.kv, acks: s.acks, clock, userId: user.id, role: user.role });
    const snap = await inbox.refresh();
    expect(snap.items.every((i) => i.is_demo)).toBe(true);
    const first = snap.items[0]!;
    expect(await inbox.acknowledge(first.alert_id)).toBe('SENT');
    expect((await inbox.refresh()).items[0]?.acknowledged_at).not.toBeNull();
  });
});
