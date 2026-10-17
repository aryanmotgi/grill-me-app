import type { SessionStatus } from "../types";

// ---------------------------------------------------------------------------
// Telling running agents that the plan moved.
//
// The plan — goal, decisions, tasks — already syncs to every teammate's Mac,
// and catch_up already reports what changed since an agent last looked. The
// gap was never the information. It was that nothing tells an agent to look:
// a session mid-task keeps building against a decision the team reversed an
// hour ago, and finds out when someone remembers to say so by hand.
//
// Queued, not interrupting. A nudge waits until the session is between turns.
// Pushing text into an agent mid-edit risks landing in the middle of a tool
// call, and the cost of waiting is one turn of work against a stale plan —
// much cheaper than a half-applied change. The human is told immediately
// either way, so somebody can stop a session by hand if a turn is too long
// to wait.
//
// Deliberately not a summary of the change. The nudge says "something moved,
// run catch_up" and lets the agent read the real thing, because catch_up knows
// what that agent has already seen and this does not.
// ---------------------------------------------------------------------------

/** A change to what the team agreed. `at` is epoch ms. */
export interface PlanChange {
  at: number;
  /** what moved, for the line shown to the human — never sent to the agent */
  what: string;
}

export interface NudgeTarget {
  id: string;
  status: SessionStatus;
  /** plan timestamp this session has already been told about */
  seen: number;
}

export type NudgeVerdict =
  | { send: true }
  | { send: false; why: "up-to-date" | "mid-turn" | "no-change" };

/** Only "working" is mid-turn. "idle" and "needs-input" are both moments the
 *  agent is not producing, which is exactly when a queued message lands
 *  cleanly — needs-input especially, since someone is about to type anyway. */
export function deliverable(status: SessionStatus): boolean {
  return status !== "working";
}

export function verdict(target: NudgeTarget, planAt: number): NudgeVerdict {
  if (!planAt) return { send: false, why: "no-change" };
  if (target.seen >= planAt) return { send: false, why: "up-to-date" };
  if (!deliverable(target.status)) return { send: false, why: "mid-turn" };
  return { send: true };
}

/** Sessions to nudge now. The rest stay queued — a session still working is
 *  reconsidered on the next pass, so nothing is dropped, only deferred. */
export function dueNow(targets: NudgeTarget[], planAt: number): NudgeTarget[] {
  return targets.filter((t) => verdict(t, planAt).send);
}

/** Sessions that need the nudge but cannot take it yet. Shown to the human,
 *  because this is the set where work is still going against the old plan. */
export function waiting(targets: NudgeTarget[], planAt: number): NudgeTarget[] {
  return targets.filter((t) => {
    const v = verdict(t, planAt);
    return !v.send && v.why === "mid-turn";
  });
}

/** The newest change, or 0. Decisions arrive from several machines and are not
 *  ordered, so take the max rather than the last. */
export function planVersion(changes: PlanChange[]): number {
  return changes.reduce((a, c) => (Number.isFinite(c.at) && c.at > a ? c.at : a), 0);
}

/** What the agent is told. Short on purpose: it is read mid-conversation, and
 *  the point is to send it to catch_up, not to restate the plan here. */
export const NUDGE_TEXT =
  "The team's plan changed since you last checked. Run catch_up before your next step, " +
  "and say so if it contradicts what you are doing.";

/** What the human sees, immediately, whether or not any session took it. */
export function humanLine(changes: PlanChange[], due: number, held: number): string {
  const what = changes.length === 1 ? changes[0].what : `${changes.length} changes`;
  const parts = [`Plan changed: ${what}.`];
  if (due) parts.push(`Told ${due} session${due === 1 ? "" : "s"}.`);
  if (held) parts.push(`${held} still working — ${held === 1 ? "it finds" : "they find"} out at the next turn.`);
  if (!due && !held) parts.push("Every session is already up to date.");
  return parts.join(" ");
}
