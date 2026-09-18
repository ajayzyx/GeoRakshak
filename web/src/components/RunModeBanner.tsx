import type { SystemMode } from "../api/types";
import { formatReplayStep } from "../lib/replay";
import { ProvenanceBadge } from "./Badges";

export function MockBanner() {
  return (
    <div className="banner banner-mock" role="status">
      MOCK DATA — fictional fixtures (SIMULATED_DEMO), "Mock Area — not a real location". Nothing here is real or connected.
    </div>
  );
}

export function UnreachableBanner({ baseUrl }: { baseUrl: string }) {
  return (
    <div className="banner banner-down" role="alert" data-testid="backend-unreachable">
      BACKEND UNREACHABLE ({baseUrl}) — retrying automatically. Data still on screen is labelled stale.
    </div>
  );
}

export function RunModeBanner({ mode, failed }: { mode: SystemMode | null; failed: boolean }) {
  if (!mode) {
    return (
      <div className="banner banner-unknown" role="status" data-testid="run-mode-banner" data-run-mode="">
        {failed ? "RUN MODE UNKNOWN — /system/mode could not be loaded" : "Loading run mode…"}
      </div>
    );
  }
  if (mode.run_mode === "LIVE") {
    return <div className="banner banner-live" role="status" data-testid="run-mode-banner" data-run-mode="LIVE">LIVE MODE</div>;
  }
  return (
    <div className="banner banner-replay" role="status" data-testid="run-mode-banner" data-run-mode="DEMO_REPLAY">
      DEMO REPLAY MODE
      {mode.replay ? (
        <span className="replay-meta">
          {" "}· <span data-testid="replay-step">{formatReplayStep(mode.replay)}</span> · scenario {mode.replay.scenario} · replay data{" "}
          <ProvenanceBadge provenance={mode.replay.provenance} /> · past rainfall replayed through the risk model, not an event prediction
        </span>
      ) : (
        <span className="replay-meta" data-testid="replay-not-started"> · Replay not started</span>
      )}
    </div>
  );
}
