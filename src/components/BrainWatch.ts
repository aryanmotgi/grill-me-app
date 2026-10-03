import { create } from "zustand";
import { note } from "../lib/activity";
import { useApp } from "../store";
import { automationOn, type AutomationId } from "../lib/automations";
import type { DecisionProposal } from "../lib/bridge";
import { driftDue, driftId, isDismissed, pairKey, parseDismissed, pruneDismissed, type DriftConflict } from "../lib/drift";
import { refreshBridge, useBridge } from "./BridgePanel";

// ---------------------------------------------------------------------------
// The brain watching on its own (pure rules in lib/decisionSpot.ts + drift.ts):
//   auto decisions — Rust stores spotted decisions as proposals; Save logs one
//                    (addDecision → decisions.json, synced to teammates)
//   chat decisions — a Grill Me Chat reply lands → spot decisions in it
//   drift alarm    — 2+ sessions finished recently → are they contradicting?
// Driven by BridgePanel's feed. Every native call is guarded.
// ---------------------------------------------------------------------------

const native = () => "__TAURI_INTERNALS__" in window;

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const core = await import("@tauri-apps/api/core");
  return core.invoke<T>(cmd, args);
}

const on = (id: AutomationId) => automationOn(useApp.getState().appSettings, id);

// ---- auto decisions -----------------------------------------------------------------

/** In browser dev the sample proposals live only in the bridge store. */
function setLocalStatus(id: string, status: DecisionProposal["status"]) {
  useBridge.setState((b) => ({
    state: { ...b.state, decisionProposals: (b.state.decisionProposals ?? []).map((p) => (p.id === id ? { ...p, status } : p)) },
  }));
}

/** Save: log it for the team (that click is the approval), then close the proposal. */
export async function saveProposal(p: DecisionProposal) {
  useApp.getState().addDecision(p.text, "auto");
  setLocalStatus(p.id, "saved");
  if (!native()) return;
  await invoke("decision_proposal_resolve", { id: p.id, status: "saved" }).catch((e) => useApp.getState().toast(`Couldn't update the proposal: ${e}`, "warn"));
  await refreshBridge(false);
}

export async function dismissProposal(id: string) {
  setLocalStatus(id, "dismissed");
  if (!native()) return;
  await invoke("decision_proposal_resolve", { id, status: "dismissed" }).catch(() => {});
  await refreshBridge(false);
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** A Grill Me Chat reply landed: did it agree on anything? */
export async function onChatDone(chatId: string, isError: boolean) {
  if (!native() || isError || !on("spot-decisions")) return;
  const n = await invoke<number>("brain_spot_chat", { chatId }).catch(() => 0);
  if (n > 0) note(`Grill Me Chat agreed on ${plural(n, "decision")}. Save or dismiss it in Flow.`);
}

/** brain_check found decisions in a session's turn. */
export function announceProposed(session: string, n: number) {
  if (n > 0) note(`${session} agreed on ${plural(n, "decision")}. Save or dismiss it in Flow.`);
}

// ---- drift alarm ------------------------------------------------------------------------

export type LiveDrift = DriftConflict & { id: string; ts: number };

export const useDrift = create<{ conflicts: LiveDrift[]; running: boolean; lastRun?: number }>(() => ({ conflicts: [], running: false }));

const finishedAt: Record<string, number> = {};

/** A session went working → idle. */
export function onSessionFinished(memberId: string) {
  finishedAt[memberId] = Date.now();
  void maybeDrift();
}

/** Teammates' sessions on other Macs seen in the last 90 s. */
function activeTeammates(now: number): number {
  const app = useApp.getState();
  const machine = app.appSettings.installId;
  const self = app.roomSelf?.memberId;
  return app.teamSessions.filter((d) => now - d.ts < 90_000 && d.machine !== machine && d.member !== self).length;
}

async function maybeDrift() {
  if (!native() || !on("drift-alarm")) return;
  const now = Date.now();
  const st = useDrift.getState();
  if (st.running || !driftDue(finishedAt, now, st.lastRun, activeTeammates(now))) return;
  useDrift.setState({ running: true, lastRun: now });
  try {
    const r = await invoke<{ conflicts: DriftConflict[] }>("brain_drift");
    const dismissed = parseDismissed(useApp.getState().appSettings.driftDismissed);
    const live = (r?.conflicts ?? []).filter((c) => !isDismissed(c, dismissed, now)).map((c) => ({ ...c, id: driftId(c), ts: now }));
    const shown = new Set(useDrift.getState().conflicts.map(pairKey));
    useDrift.setState({ conflicts: live });
    for (const c of live.filter((x) => !shown.has(pairKey(x)))) {
      note(`Sessions drifting apart: ${c.a} and ${c.b}. ${c.why}`, "warn");
    }
  } catch (e) {
    console.warn("drift check failed", e);
  } finally {
    useDrift.setState({ running: false });
  }
}

/** Wave a warning off: the same pair + reason stays quiet for 2 h. */
export function dismissDrift(c: LiveDrift) {
  const st = useApp.getState();
  const now = Date.now();
  st.setAppSetting("driftDismissed", pruneDismissed([...parseDismissed(st.appSettings.driftDismissed), { pair: pairKey(c), why: c.why, ts: now }], now));
  useDrift.setState((s) => ({ conflicts: s.conflicts.filter((x) => x.id !== c.id) }));
}
