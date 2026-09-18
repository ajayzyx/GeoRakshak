import { InboxService } from '../inboxService';
import { InboxItem, Role } from '../types';
import { FakeClock, FakeHttp, USER_ID, apiFor, openStores } from './helpers';

function item(id: string, tier: InboxItem['tier'], acknowledged_at: string | null = null): InboxItem {
  return {
    alert_id: id,
    tier,
    severity: 'HIGH',
    title: `Simulated ${tier}`,
    body: 'Simulated test alert',
    language: 'en',
    dispatched_at: '2026-07-14T06:05:02Z',
    acknowledged_at,
    risk_zone_ids: ['a3b9'],
    lead_time_h: 0,
    is_demo: true,
  };
}

async function setup(role: Role = 'FIELD_OFFICER') {
  const s = await openStores();
  const http = new FakeHttp();
  const clock = new FakeClock();
  const serverAcks = new Map<string, string>();
  const items = [item('al55', 'WATCH'), item('al60', 'WARNING')];
  http.on('GET', /^\/me\/inbox$/, () => ({
    status: 200,
    body: { items: items.map((i) => ({ ...i, acknowledged_at: serverAcks.get(i.alert_id) ?? null })) },
  }));
  http.on('POST', /^\/alerts\/[^/]+\/acknowledge$/, (req) => {
    const id = req.path.split('/')[2] as string;
    if (!items.some((i) => i.alert_id === id)) {
      return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'alert not found' } } };
    }
    const at = serverAcks.get(id) ?? '2026-07-14T06:31:00Z';
    serverAcks.set(id, at);
    return { status: 200, body: { alert_id: id, acknowledged_at: at } };
  });
  const svc = new InboxService({ api: apiFor(http), cache: s.kv, acks: s.acks, clock, userId: USER_ID, role });
  return { ...s, http, clock, svc, serverAcks };
}

describe('InboxService', () => {
  test('refresh caches the inbox with a last-updated time, readable offline', async () => {
    const t = await setup();
    const snap = await t.svc.refresh();
    expect(snap.items.map((i) => i.alert_id)).toEqual(['al55', 'al60']);
    expect(snap.updated_at).toBe(t.clock.now().toISOString());

    t.http.offline = true;
    t.clock.advance(60_000);
    await expect(t.svc.refresh()).rejects.toMatchObject({ kind: 'network' });
    const cached = await t.svc.getCached();
    expect(cached.items).toHaveLength(2);
    expect(cached.updated_at).toBe(snap.updated_at); // not bumped by the failed refresh
  });

  test('acknowledge online: POST /alerts/{id}/acknowledge, server time stored', async () => {
    const t = await setup();
    await t.svc.refresh();
    expect(await t.svc.acknowledge('al55')).toBe('SENT');
    expect(t.http.count('POST', /^\/alerts\/al55\/acknowledge$/)).toBe(1);
    const entry = (await t.svc.getCached()).items.find((i) => i.alert_id === 'al55');
    expect(entry).toMatchObject({ acknowledged_at: '2026-07-14T06:31:00Z', ack_pending: false });
    expect(await t.acks.list()).toHaveLength(0);
  });

  test('acknowledge offline is queued, shown as pending, and sent when back online', async () => {
    const t = await setup();
    await t.svc.refresh();
    t.http.offline = true;

    expect(await t.svc.acknowledge('al60')).toBe('QUEUED');
    let entry = (await t.svc.getCached()).items.find((i) => i.alert_id === 'al60');
    expect(entry).toMatchObject({ ack_pending: true, acknowledged_at: t.clock.now().toISOString() });
    expect(await t.acks.list()).toHaveLength(1);

    t.http.offline = false;
    // A refresh before the flush keeps showing the local acknowledgement.
    const snap = await t.svc.refresh();
    expect(snap.items.find((i) => i.alert_id === 'al60')?.ack_pending).toBe(true);

    const outcome = await t.svc.flushAcks();
    expect(outcome.get('al60')).toBe('SENT');
    expect(t.serverAcks.has('al60')).toBe(true);
    entry = (await t.svc.getCached()).items.find((i) => i.alert_id === 'al60');
    expect(entry).toMatchObject({ ack_pending: false });
    expect(await t.acks.list()).toHaveLength(0);
  });

  test('acknowledging twice is harmless (server returns the original time)', async () => {
    const t = await setup();
    await t.svc.refresh();
    await t.svc.acknowledge('al55');
    expect(await t.svc.acknowledge('al55')).toBe('SENT');
    expect(t.serverAcks.get('al55')).toBe('2026-07-14T06:31:00Z');
  });

  test('a 4xx acknowledgement is dropped from the queue and surfaced, not retried', async () => {
    const t = await setup();
    await t.svc.refresh();
    expect(await t.svc.acknowledge('gone')).toBe('REJECTED');
    expect(await t.acks.list()).toHaveLength(0);
    await t.svc.flushAcks();
    expect(t.http.count('POST', /acknowledge$/)).toBe(1);
  });

  test('citizen mode never shows internal WATCH alerts', async () => {
    const t = await setup('CITIZEN');
    const snap = await t.svc.refresh();
    expect(snap.items.map((i) => i.tier)).toEqual(['WARNING']);
  });
});
