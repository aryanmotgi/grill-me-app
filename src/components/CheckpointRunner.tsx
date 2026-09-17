import { useEffect } from "react";
import { useApp } from "../store";
import { isTauri } from "../data/sources/git";
import {
  checkpointEnabled,
  checkpointIntervalMinutes,
  runCheckpoints,
  summarizeCheckpoints,
} from "../lib/checkpoint";

/**
 * Headless driver for periodic auto-checkpoints. Renders nothing. When enabled
 * in Settings > Checkpoints, it fires `checkpoint_commit` for every member repo
 * on the configured interval — a local, unpushed snapshot so an agent's work is
 * never lost. Stays silent on routine clean sweeps; speaks only when something
 * was committed or a repo failed. The interval resets only when the toggle or
 * cadence changes (state is read fresh inside each tick), so unrelated store
 * churn never restarts the timer.
 */
export function CheckpointRunner() {
  const enabled = useApp((s) => checkpointEnabled(s.appSettings));
  const minutes = useApp((s) => checkpointIntervalMinutes(s.appSettings));

  useEffect(() => {
    if (!enabled || !isTauri()) return;
    let running = false;
    const tick = async () => {
      if (running) return; // never overlap two sweeps
      running = true;
      try {
        const members = useApp.getState().members;
        if (members.length === 0) return;
        const { invoke } = await import("@tauri-apps/api/core");
        const outcomes = await runCheckpoints(members, invoke);
        const noteworthy = outcomes.some((o) => o.status === "committed" || o.status === "error");
        if (noteworthy) {
          const { text, kind } = summarizeCheckpoints(outcomes);
          useApp.getState().toast(text, kind);
        }
      } finally {
        running = false;
      }
    };
    const id = setInterval(tick, minutes * 60_000);
    return () => clearInterval(id);
  }, [enabled, minutes]);

  return null;
}
