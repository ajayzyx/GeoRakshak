import type { ReplayState, SystemMode } from "../api/types";

/** Last valid step index: the backend's `step` is zero-based and must stay below `steps`. */
export const lastStep = (r: ReplayState): number => Math.max(0, r.steps - 1);

/** "Step X/Y · <date>" using the backend's zero-based step and the replay's as_of date. */
export function formatReplayStep(r: ReplayState): string {
  const date = r.as_of ? ` · ${r.as_of.slice(0, 10)}` : "";
  return `Step ${r.step}/${lastStep(r)}${date}`;
}

export function replayNotStarted(mode: SystemMode | null): boolean {
  return !!mode && mode.run_mode === "DEMO_REPLAY" && !mode.replay;
}
