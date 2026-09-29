// ---------------------------------------------------------------------------
// Claude bridge state (bridge.json, owned by Rust) + pure helpers for the
// approval panel: what's pending, what's new since the last read, and how an
// approved plan becomes task-board tasks.
// ---------------------------------------------------------------------------

import type { Task } from "../types";

export interface BridgeHandoff {
  id: string; ts: number; status: "pending" | "sent" | "dismissed";
  kind: "handoff" | "answer";
  session: string; sessionTitle?: string; message: string; userExplanation: string;
}
export interface BridgePlanTask { title: string; desc?: string; files?: string[] }
export interface BridgePlan {
  id: string; ts: number; status: "pending" | "applied" | "dismissed";
  title: string; decision?: string; tasks: BridgePlanTask[];
}
export interface BridgeQuestion {
  id: string; ts: number; answered: boolean; dismissed?: boolean;
  from: string; fromTitle?: string; question: string; context?: string; answer?: string;
}
export interface BridgeNote { id: string; ts: number; text: string; by?: string }
export interface BridgeState {
  handoffs: BridgeHandoff[]; plans: BridgePlan[]; questions: BridgeQuestion[]; notes: BridgeNote[];
  /** the project's one-line goal in the shared brain */
  goal?: string;
}

export const EMPTY_BRIDGE: BridgeState = { handoffs: [], plans: [], questions: [], notes: [] };

export function parseBridge(raw: string): BridgeState {
  try {
    const v = JSON.parse(raw);
    const arr = <T,>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : []);
    return {
      handoffs: arr(v.handoffs), plans: arr(v.plans), questions: arr(v.questions), notes: arr(v.notes),
      ...(typeof v.goal === "string" ? { goal: v.goal } : {}),
    };
  } catch {
    return EMPTY_BRIDGE;
  }
}

export function pending(b: BridgeState) {
  return {
    handoffs: b.handoffs.filter((h) => h.status === "pending"),
    plans: b.plans.filter((p) => p.status === "pending"),
    questions: b.questions.filter((q) => !q.answered),
  };
}

export function pendingCount(b: BridgeState): number {
  const p = pending(b);
  return p.handoffs.length + p.plans.length + p.questions.length;
}

/** Items that became pending since `prev` — drives the "new request" toast. */
export function newlyPending(prev: BridgeState, next: BridgeState): string[] {
  const seen = new Set([...prev.handoffs, ...prev.plans, ...prev.questions].map((x) => x.id));
  const p = pending(next);
  return [
    ...p.handoffs.filter((h) => !seen.has(h.id)).map((h) =>
      h.kind === "answer" ? `Answer ready for ${h.sessionTitle || h.session}` : `Claude app wants to send a task to ${h.sessionTitle || h.session}`),
    ...p.plans.filter((x) => !seen.has(x.id)).map((x) => `Claude app proposed a plan: ${x.title}`),
    ...p.questions.filter((q) => !seen.has(q.id)).map((q) => `${q.fromTitle || q.from} asked the brainstorm side a question`),
  ];
}

/** Approved plan → not-started tasks on the board (ids stable per plan). */
export function planToTasks(plan: BridgePlan, ownerId: string): Task[] {
  return plan.tasks.map((t, i) => ({
    id: `${plan.id}-t${i}`,
    title: t.title,
    desc: t.desc ?? "",
    owner: ownerId,
    status: "not-started",
    files: Array.isArray(t.files) ? t.files : [],
  }));
}
