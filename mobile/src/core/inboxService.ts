import { ApiClient } from './api';
import { toApiError } from './http';
import { AckQueue, KeyValueStore } from './localCache';
import { Clock, InboxItem, Role } from './types';

export interface InboxEntry extends InboxItem {
  /** Acknowledged on this device but not yet confirmed by the server. */
  ack_pending: boolean;
  ack_error: string | null;
}

export interface InboxSnapshot {
  items: InboxEntry[];
  /** When the server list was last fetched successfully. null = never. */
  updated_at: string | null;
}

export interface InboxServiceDeps {
  api: ApiClient;
  cache: KeyValueStore;
  acks: AckQueue;
  clock: Clock;
  userId: string;
  role: Role;
}

/** Tiers a citizen may see. WATCH is internal (CLAUDE.md §4a). */
const CITIZEN_TIERS: InboxItem['tier'][] = ['WARNING', 'UPDATE'];

/**
 * Alert inbox by polling `GET /me/inbox` (push is not connected, H8). The last
 * successful list is cached so it stays readable offline. Acknowledgements
 * are written to a local queue first and sent when the network allows.
 */
export class InboxService {
  constructor(private readonly deps: InboxServiceDeps) {}

  private get cacheKey(): string {
    return `inbox:${this.deps.userId}`;
  }

  private visible(items: InboxItem[]): InboxItem[] {
    // Defence in depth: the server already scopes the inbox by role.
    if (this.deps.role === 'CITIZEN') return items.filter((i) => CITIZEN_TIERS.includes(i.tier));
    return items;
  }

  async getCached(): Promise<InboxSnapshot> {
    const cached = await this.deps.cache.get<{ items: InboxEntry[]; fetched_at: string | null }>(this.cacheKey);
    if (!cached) return { items: [], updated_at: null };
    return { items: cached.value.items, updated_at: cached.value.fetched_at };
  }

  private async save(items: InboxEntry[], fetchedAt: string | null): Promise<void> {
    await this.deps.cache.set(
      this.cacheKey,
      { items, fetched_at: fetchedAt },
      this.deps.clock.now().toISOString(),
    );
  }

  /** Fetches the inbox. Rejects with ApiError; callers keep showing the cached snapshot. */
  async refresh(): Promise<InboxSnapshot> {
    const serverItems = this.visible(await this.deps.api.inbox());
    const pending = new Map((await this.deps.acks.list()).map((a) => [a.alert_id, a]));
    const previous = new Map((await this.getCached()).items.map((i) => [i.alert_id, i]));
    const items: InboxEntry[] = serverItems.map((i) => {
      const p = pending.get(i.alert_id);
      if (!i.acknowledged_at && p) {
        return { ...i, acknowledged_at: p.acknowledged_at, ack_pending: true, ack_error: null };
      }
      return { ...i, ack_pending: false, ack_error: i.acknowledged_at ? null : (previous.get(i.alert_id)?.ack_error ?? null) };
    });
    const fetchedAt = this.deps.clock.now().toISOString();
    await this.save(items, fetchedAt);
    return { items, updated_at: fetchedAt };
  }

  /**
   * Records the acknowledgement locally, then tries to send it.
   * Returns `SENT` when the server confirmed, `QUEUED` when it will be retried.
   */
  async acknowledge(alertId: string): Promise<'SENT' | 'QUEUED' | 'REJECTED'> {
    const now = this.deps.clock.now().toISOString();
    await this.deps.acks.add(alertId, now);
    await this.patchCached(alertId, { acknowledged_at: now, ack_pending: true, ack_error: null });
    const outcome = await this.flushAcks(alertId);
    return outcome.get(alertId) ?? 'QUEUED';
  }

  /** Sends queued acknowledgements. Stops at the first network failure. */
  async flushAcks(only?: string): Promise<Map<string, 'SENT' | 'QUEUED' | 'REJECTED'>> {
    const outcome = new Map<string, 'SENT' | 'QUEUED' | 'REJECTED'>();
    const queue = (await this.deps.acks.list()).filter((a) => !only || a.alert_id === only);
    for (const ack of queue) {
      try {
        const res = await this.deps.api.acknowledge(ack.alert_id);
        await this.deps.acks.remove(ack.alert_id);
        await this.patchCached(ack.alert_id, {
          acknowledged_at: res.acknowledged_at ?? ack.acknowledged_at,
          ack_pending: false,
          ack_error: null,
        });
        outcome.set(ack.alert_id, 'SENT');
      } catch (err) {
        const e = toApiError(err);
        if (e.retryable || e.kind === 'unauthenticated') {
          await this.deps.acks.markAttempt(ack.alert_id, e.message);
          outcome.set(ack.alert_id, 'QUEUED');
          if (e.kind === 'network' || e.kind === 'unauthenticated') break;
        } else {
          // e.g. 404 alert gone / 403 not a recipient: retrying cannot succeed.
          await this.deps.acks.remove(ack.alert_id);
          await this.patchCached(ack.alert_id, {
            acknowledged_at: null,
            ack_pending: false,
            ack_error: `Acknowledgement rejected: ${e.message}`,
          });
          outcome.set(ack.alert_id, 'REJECTED');
        }
      }
    }
    return outcome;
  }

  private async patchCached(alertId: string, patch: Partial<InboxEntry>): Promise<void> {
    const snap = await this.getCached();
    const items = snap.items.map((i) => (i.alert_id === alertId ? { ...i, ...patch } : i));
    await this.save(items, snap.updated_at);
  }
}
