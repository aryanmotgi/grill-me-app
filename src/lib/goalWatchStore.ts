// ---------------------------------------------------------------------------
// Goal watch, wired up: every message you send (chat box, quick asks, the
// new-session box) is logged against the project's goal and judged in the
// background. The log lives in settings, per project, last 60 prompts.
// ---------------------------------------------------------------------------

import { useApp } from "../store";
import { useBridge } from "../components/BridgePanel";
import { interviewBrainOf } from "./aiConnect";
import { isNeutral, parseWatch, record, settle, WATCH_SCHEMA, WATCH_SYSTEM, watchPrompt, wordMatch, type WatchEntry } from "./goalWatch";

export const watchKey = () => `goalWatch:${useApp.getState().activeProject ?? "default"}`;

export function watchLog(settings: Record<string, unknown>, key: string): WatchEntry[] {
  const v = settings[key];
  return Array.isArray(v) ? (v as WatchEntry[]) : [];
}

function save(log: WatchEntry[]) {
  useApp.getState().setAppSetting(watchKey(), log);
}

/** Log a sent message and judge it against the goal. Never blocks the send. */
export function watchSend(session: string, text: string) {
  const goal = (useBridge.getState().state.goal ?? "").trim();
  if (!goal || isNeutral(text)) return;
  const key = watchKey();
  const at = Date.now();
  save(record(watchLog(useApp.getState().appSettings, key), { at, text, session }));
  const brain = interviewBrainOf(useApp.getState().appSettings.interviewBrain);
  const done = (verdict: "on" | "side", why?: string) => {
    // the project may have changed meanwhile: write to the log it came from
    useApp.getState().setAppSetting(key, settle(watchLog(useApp.getState().appSettings, key), at, verdict, why));
  };
  if (!("__TAURI_INTERNALS__" in window) || brain === "form") { done(wordMatch(goal, text)); return; }
  void import("@tauri-apps/api/core")
    .then(({ invoke }) => invoke<unknown>("interview_turn", { brain, system: WATCH_SYSTEM, prompt: watchPrompt(goal, text), schema: JSON.stringify(WATCH_SCHEMA) }))
    .then((raw) => { const r = parseWatch(raw); if (r) done(r.verdict, r.why); else done(wordMatch(goal, text)); })
    .catch(() => done(wordMatch(goal, text)));
}
