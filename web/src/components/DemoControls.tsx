import { useState } from "react";
import type { ApiClient } from "../api/client";
import type { DemoReplayResponse, SystemMode } from "../api/types";
import { formatReplayStep, lastStep } from "../lib/replay";
import { ErrorBox } from "./ErrorBox";
import { Spinner } from "./ResourceStatus";

// The backend needs about 2 s per monitoring cycle; the margin covers the first request and a busy machine.
const SECONDS_PER_STEP = 2.5;
const BASE_TIMEOUT_MS = 20_000;

interface Props {
  client: ApiClient;
  mode: SystemMode | null;
  /** Refetch everything after a replay change. */
  onChanged: () => void;
  /** Clear selection and all cached data, then refetch. */
  onReset: () => void;
  confirm?: (message: string) => boolean;
}

export function DemoControls({ client, mode, onChanged, onReset, confirm = (m) => window.confirm(m) }: Props) {
  const replay = mode?.replay ?? null;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [target, setTarget] = useState("");

  async function run(label: string, fn: () => Promise<unknown>, after: () => void = onChanged) {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      const res = await fn();
      after();
      return res;
    } catch (err) {
      setError(err);
      // A timeout or conflict may still have changed server state; refetch so the view matches it.
      onChanged();
      return undefined;
    } finally {
      setBusy(null);
    }
  }

  async function jump() {
    const to = Number(target);
    if (!replay || !Number.isInteger(to)) return;
    const timeoutMs = BASE_TIMEOUT_MS + Math.max(1, to - replay.step) * SECONDS_PER_STEP * 1000;
    const res = (await run(`Jumping to step ${to}`, () => client.demoReplayStep(to, { timeoutMs }))) as DemoReplayResponse | undefined;
    if (res?.replay && res.replay.step !== to) {
      setNotice(`Backend is at step ${res.replay.step}, not the requested step ${to} (to_step may not be supported by this backend yet).`);
    }
  }

  function reset() {
    if (!confirm("Reset the demo? This deletes demo alerts, reports and replay state on the backend.")) return;
    void run("Resetting", () => client.demoReset({ timeoutMs: 120_000 }), onReset);
  }

  const max = replay ? lastStep(replay) : 0;
  const targetNum = Number(target);
  const targetValid = !!replay && Number.isInteger(targetNum) && targetNum > replay.step && targetNum <= max;

  return (
    <section className="panel" data-testid="demo-controls">
      <h3>Demo controls (DEMO_REPLAY, admin)</h3>
      <div className="small" data-testid="demo-step">{replay ? formatReplayStep(replay) : "Replay not started"}</div>
      <div className="button-row">
        <button disabled={!!busy} onClick={() => void run("Starting replay", () => client.demoReplayStart({ timeoutMs: 60_000 }))}>
          {replay ? "Restart replay" : "Start replay"}
        </button>
        <button disabled={!!busy || !replay || replay.step >= max} onClick={() => void run("Stepping", () => client.demoReplayStep(undefined, { timeoutMs: 60_000 }))}>
          Step
        </button>
        <button disabled={!!busy} className="danger" onClick={reset}>Reset…</button>
      </div>
      <div className="jump-row">
        <label className="inline">
          Jump to step
          <input
            type="number"
            className="short"
            min={replay ? replay.step + 1 : 0}
            max={max}
            value={target}
            disabled={!!busy || !replay}
            onChange={(e) => setTarget(e.target.value)}
            data-testid="jump-input"
          />
        </label>
        <button disabled={!!busy || !targetValid} onClick={() => void jump()} data-testid="jump-button">Go</button>
      </div>
      {replay && <div className="small muted">Valid targets: {Math.min(replay.step + 1, max)}–{max}. Runs every intermediate cycle (~2 s each).</div>}
      {busy && <Spinner label={`${busy}…`} />}
      {error !== null && <ErrorBox error={error} context="Demo control" />}
      {notice && <div className="notice" role="status">{notice}</div>}
    </section>
  );
}
