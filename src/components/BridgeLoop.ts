import { create } from "zustand";
import { note } from "../lib/activity";
import { upsertShared, useApp } from "../store";
import { sessionTitle } from "../lib/sessionTitle";
import { automationOn, type AutomationId } from "../lib/automations";
import { teamQuestionsFor } from "../lib/teamBridge";
import {
  approvalPings, parseReviews, phoneStep, questionsToDraft, repliesOwed, reviewDue,
  type PhoneAction, type Review,
} from "../lib/bridgeLoop";
import type { BridgeHandoff, BridgeState } from "../lib/bridge";
import { useTests } from "../lib/testsStore";
import { bridgeApply, bridgeResolve, bridgeSend, refreshBridge, useBridge } from "./BridgePanel";
import { alertEverywhere } from "./Automations";

// ---------------------------------------------------------------------------
// The bridge loop engine (pure rules in lib/bridgeLoop.ts):
//   live answers   — a coder's question → Claude drafts an answer → one click sends it
//   auto review    — a session goes idle with new work → ship / fix / wait verdict
//   hand-off reply — a delivered hand-off's session goes idle → result report
//   phone approve  — ntfy buttons → verified one-time token → the same action as Flow
// Driven by BridgePanel's feed (bridge refresh + working→idle). Every native
// call is guarded so browser dev never touches Tauri.
// ---------------------------------------------------------------------------

const native = () => "__TAURI_INTERNALS__" in window;

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const core = await import("@tauri-apps/api/core");
  return core.invoke<T>(cmd, args);
}

const on = (id: AutomationId) => automationOn(useApp.getState().appSettings, id);

function titleOf(id: string): string {
  const s = useApp.getState();
  const t = s.teammates.find((x) => x.id === id);
  return t ? sessionTitle(t, s.appSettings.sessionTitles) : id;
}

const myRoomId = () => useApp.getState().roomSelf?.memberId ?? "";
const clip = (s: string, n: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/** Called on every bridge refresh: draft new questions; on announced
 *  refreshes, ping the phone (with approve buttons) for new hand-offs/plans. */
export function onBridgeState(prev: BridgeState, next: BridgeState, announce: boolean) {
  if (!native()) return;
  void draftNewQuestions(next);
  if (!announce) return;
  for (const p of approvalPings(prev, next)) {
    // the in-app toast already covers the desktop; this is the phone's copy
    void alertEverywhere(p.title, p.body, { os: false, approve: { list: p.list, id: p.id, label: p.label } });
  }
}

// ---- live answers -----------------------------------------------------------------

const asked = new Set<string>();

async function draftNewQuestions(b: BridgeState) {
  if (!on("draft-answers")) return;
  const jobs = questionsToDraft(b, teamQuestionsFor(useApp.getState().teamBridge, myRoomId()), titleOf, asked, Date.now() - 24 * 3_600_000);
  for (const j of jobs) {
    asked.add(j.id);
    void (async () => {
      let ok = false;
      try {
        // null = another refresh already claimed it (one draft per question, ever)
        ok = !!(await invoke<{ draft: string } | null>("bridge_draft_answer", { id: j.id }));
        if (!ok) return;
        note(`Question from ${j.asker}. Claude drafted an answer; review it in Flow.`);
      } catch (e) {
        useApp.getState().toast(`Couldn't draft an answer for ${j.asker}: ${e}`, "warn");
      }
      await alertEverywhere(`Question from ${j.asker}`, clip(j.question, 200),
        ok ? { approve: { list: j.team ? "team" : "questions", id: j.id, label: "Send answer" } } : {});
    })();
  }
}

/** "Send answer": the (edited) draft becomes the answer hand-off and is
 *  delivered right away — this click is the approval. */
export async function bridgeAnswer(questionId: string, text: string): Promise<boolean> {
  const answer = text.trim();
  if (!answer || !native()) return false;
  const h = await invoke<BridgeHandoff>("bridge_answer", { id: questionId, answer }).catch((e) => {
    useApp.getState().toast(`Couldn't send the answer: ${e}`, "warn");
    return null;
  });
  return h ? bridgeSend(h) : false;
}

/** A teammate's question or reply, set aside on this Mac only. */
export async function teamFlag(id: string, flag: "teamDismiss" | "teamReplyAck") {
  if (!native()) return;
  await invoke("bridge_flag", { id, flag }).catch((e) => useApp.getState().toast(`Bridge: ${e}`, "warn"));
  await refreshBridge(false);
}

/** The user read a session's reply in Flow. */
export async function ackReply(id: string) {
  if (!native()) return;
  await invoke("bridge_flag", { id, flag: "resultAck" }).catch(() => {});
  await refreshBridge(false);
}

// ---- working → idle: review + hand-off replies ------------------------------------

export function onSessionIdle(memberId: string) {
  if (!native()) return;
  void runReview(memberId);
  void checkReplies(memberId);
}

export const useReviews = create<{ reviews: Record<string, Review>; running: Record<string, boolean> }>(() => ({ reviews: {}, running: {} }));

export async function loadReviews() {
  if (!native()) return;
  const raw = await invoke<unknown>("reviews_read").catch(() => ({}));
  useReviews.setState({ reviews: parseReviews(raw) });
}

// Throttles live in appSettings, not memory: a restart used to re-arm every
// "at most every N minutes" guard, so six restarts in an afternoon meant six
// extra reviews per session. Persisted, the guard means what it says.
const THROTTLE_KEY = "automationThrottles";
function throttles(): Record<string, number> {
  const v = useApp.getState().appSettings?.[THROTTLE_KEY];
  return v && typeof v === "object" ? (v as Record<string, number>) : {};
}
function markRun(key: string, at: number) {
  useApp.getState().setAppSetting(THROTTLE_KEY, { ...throttles(), [key]: at });
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function runReview(memberId: string) {
  const st = useApp.getState();
  const m = st.members.find((x) => x.id === memberId);
  if (!on("auto-review") || !m || m.remote) return;
  const now = Date.now();
  if (!reviewDue(throttles()[`review:${memberId}`], now)) return;
  markRun(`review:${memberId}`, now);
  // auto-test fires on the same transition — let it land so the review sees fresh results
  await sleep(2000);
  for (let i = 0; i < 60 && useTests.getState().results[memberId]?.running; i++) await sleep(5000);
  useReviews.setState((s) => ({ running: { ...s.running, [memberId]: true } }));
  try {
    const r = await invoke<(Review & { skipped?: boolean }) | null>("brain_review", { memberId, repoPath: m.repoPath });
    if (!r) return;
    const parsed = parseReviews({ [memberId]: r })[memberId];
    if (!parsed) return;
    useReviews.setState((s) => ({ reviews: { ...s.reviews, [memberId]: parsed } }));
    if (!r.skipped && parsed.verdict === "fix") note(`${titleOf(memberId)} needs a fix: ${parsed.reason || parsed.summary}`, "warn");
  } catch (e) {
    console.warn("review failed", e);
  } finally {
    useReviews.setState((s) => ({ running: { ...s.running, [memberId]: false } }));
  }
}

async function checkReplies(memberId: string) {
  const owed = repliesOwed(useBridge.getState().state, memberId);
  for (const h of owed) {
    const r = await invoke<BridgeHandoff | null>("bridge_handoff_result", { id: h.id }).catch(() => null);
    if (!r?.result) continue;
    const st = useApp.getState();
    note(`${h.sessionTitle || titleOf(memberId)} replied: ${clip(r.result.summary, 140)}`);
    // a teammate's hand-off: send the result back on its room entry so their Claude sees it
    const e = h.from ? st.teamBridge.find((x) => x.id === h.id) : undefined;
    if (e) await upsertShared("team-bridge.json", [{ ...e, result: r.result, resultTs: r.resultTs ?? Date.now() }]);
  }
  if (owed.length) await refreshBridge(false);
}

// ---- phone approvals ---------------------------------------------------------------

let polling = false;

/** Every 10 s while phone pings are on: fetch button presses from the reply
 *  topic (Rust verifies + burns each token), then do what Flow would do. */
export async function pollPhone() {
  const st = useApp.getState();
  const reply = st.appSettings.ntfyReplyTopic;
  if (!native() || polling || !on("phone-pings") || typeof reply !== "string") return;
  polling = true;
  try {
    const since = typeof st.appSettings.ntfyReplySince === "string" ? st.appSettings.ntfyReplySince : "24h";
    const r = await invoke<{ lastId: string; actions: PhoneAction[]; rejected: number }>("phone_poll", { replyTopic: reply, since }).catch(() => null);
    if (!r) return;
    if (r.lastId !== since) st.setAppSetting("ntfyReplySince", r.lastId);
    if (r.rejected) st.toast(`Ignored ${r.rejected} phone approval${r.rejected === 1 ? "" : "s"} — expired, already used, or unknown`, "warn");
    for (const a of r.actions) await performPhone(a);
  } finally {
    polling = false;
  }
}

async function performPhone(a: PhoneAction) {
  await refreshBridge(false);
  const st = useApp.getState();
  const b = useBridge.getState().state;
  const step = phoneStep(a, b, teamQuestionsFor(st.teamBridge, myRoomId()));
  if (!step) {
    st.toast("From your phone: that item was already handled");
    return;
  }
  if (step.do === "send") {
    const h = b.handoffs.find((x) => x.id === step.id);
    if (h && (await bridgeSend(h))) st.toast(`From your phone: sent to ${h.toName || h.sessionTitle || h.session}`);
  } else if (step.do === "apply") {
    const p = b.plans.find((x) => x.id === step.id);
    if (p) {
      await bridgeApply(p);
      st.toast(`From your phone: plan “${p.title}” added to the board`);
    }
  } else if (step.do === "answer") {
    if (await bridgeAnswer(step.id, step.text)) st.toast("From your phone: answer sent");
  } else {
    if (step.list === "team") await teamFlag(step.id, "teamDismiss");
    else await bridgeResolve(step.list, step.id, "dismissed");
    st.toast("From your phone: dismissed");
  }
}
