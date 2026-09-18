export type SyncTrigger = 'start' | 'connectivity' | 'foreground' | 'interval' | 'manual';

/**
 * Triggers that should retry immediately instead of waiting for backoff timers:
 * the user asked ("Sync now"), or the network just came back, which is the event
 * most network-failed items were waiting for. Periodic and foreground runs respect
 * backoff so a failing server is not hammered.
 */
export function ignoresBackoff(trigger: SyncTrigger): boolean {
  return trigger === 'manual' || trigger === 'connectivity';
}

export interface SyncSchedulerDeps {
  /** Runs one sync pass (queue + pending acknowledgements). Errors are swallowed by the scheduler. */
  run: (trigger: SyncTrigger) => Promise<void>;
  /** Calls back with the connectivity state on every change. Returns an unsubscribe function. */
  subscribeConnectivity: (cb: (online: boolean) => void) => () => void;
  /** Calls back when the app returns to the foreground. Returns an unsubscribe function. */
  subscribeForeground: (cb: () => void) => () => void;
  intervalMs: number;
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
}

/**
 * Wires the sync triggers from the product spec (J4): connectivity regained,
 * app foreground, periodic while open, and manual "Sync now". Background sync
 * while the app is closed is out of scope for Expo Go.
 *
 * Runs never overlap. A trigger that arrives during a run is not dropped: it
 * schedules exactly one follow-up run (so, for example, a report saved while a
 * sync was already in flight is still picked up promptly).
 */
export class SyncScheduler {
  private unsubs: (() => void)[] = [];
  private timer: unknown = null;
  private wasOnline: boolean | null = null;
  private inFlight: Promise<void> | null = null;
  private followUp: SyncTrigger | null = null;

  constructor(private readonly deps: SyncSchedulerDeps) {}

  get isRunning(): boolean {
    return this.inFlight !== null;
  }

  start(): void {
    if (this.timer !== null) return;
    // NetInfo reports the current state as soon as we subscribe. That first value
    // only primes the state: the 'start' run below already covers app start.
    let primed = false;
    this.unsubs.push(
      this.deps.subscribeConnectivity((online) => {
        const regained = primed && online && this.wasOnline !== true;
        primed = true;
        this.wasOnline = online;
        if (regained) void this.trigger('connectivity');
      }),
      this.deps.subscribeForeground(() => void this.trigger('foreground')),
    );
    this.timer = this.deps.setInterval(() => void this.trigger('interval'), this.deps.intervalMs);
    void this.trigger('start');
  }

  stop(): void {
    for (const u of this.unsubs) u();
    this.unsubs = [];
    if (this.timer !== null) this.deps.clearInterval(this.timer);
    this.timer = null;
    this.wasOnline = null;
  }

  /** Resolves when no run is in flight (including coalesced follow-ups). */
  idle(): Promise<void> {
    return this.inFlight ?? Promise.resolve();
  }

  /** Manual "Sync now". Resolves when the current run (and any follow-up) has finished. */
  syncNow(): Promise<void> {
    return this.trigger('manual');
  }

  /** Resolves when the run started by (or coalesced into) this trigger has finished. */
  trigger(trigger: SyncTrigger): Promise<void> {
    if (this.inFlight) {
      // A trigger that ignores backoff upgrades a pending follow-up that doesn't.
      if (this.followUp === null || (ignoresBackoff(trigger) && !ignoresBackoff(this.followUp))) {
        this.followUp = trigger;
      }
      return this.inFlight;
    }
    this.inFlight = (async () => {
      let next: SyncTrigger | null = trigger;
      try {
        while (next !== null) {
          this.followUp = null;
          try {
            await this.deps.run(next);
          } catch {
            // Per-item errors are recorded in the store; a trigger must never crash the app.
          }
          next = this.followUp;
        }
      } finally {
        // Cleared in the same synchronous step as the last follow-up check, so no trigger is lost in between.
        this.inFlight = null;
      }
    })();
    return this.inFlight;
  }
}
