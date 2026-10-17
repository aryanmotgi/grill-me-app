import { useApp, ptyIdFor } from "../store";
import { submitToAgent } from "./ptyReady";
import { dueNow, humanLine, planVersion, waiting, NUDGE_TEXT, type NudgeTarget, type PlanChange } from "./planNudge";

// ---------------------------------------------------------------------------
// Watches what the team agreed, and tells running agents when it moves.
//
// Decisions and the goal already sync to every teammate's Mac, and catch_up
// already reports what changed since an agent last looked. Nothing told the
// agent to look — so a session kept building against a decision the team had
// reversed, and found out when a person remembered to say so.
//
// Runs on the same tick the room already polls on. Delivery is queued: a
// session that is mid-turn is left alone and reconsidered next pass. The
// person is told straight away either way, so a long turn can be stopped by
// hand if waiting is worse than interrupting.
// ---------------------------------------------------------------------------

/** What each session has been told about, in memory. Rebuilding on restart is
 *  correct: a session that restarted re-reads the plan at launch anyway. */
const told = new Map<string, number>();

/** Plan version at startup. Everything older is history, not news — otherwise
 *  the first tick after launch nudges every session about decisions made days
 *  ago, which is noise that teaches people to ignore the nudge. */
let baseline = 0;
let started = false;

function changesFrom(decisions: { epochMs?: number; text?: string }[], goalTs: number, goal: string): PlanChange[] {
  const out: PlanChange[] = decisions
    .filter((d) => Number.isFinite(d.epochMs))
    .map((d) => ({ at: d.epochMs as number, what: (d.text ?? "").slice(0, 80) }));
  if (goalTs && goal) out.push({ at: goalTs, what: `goal is now "${goal.slice(0, 60)}"` });
  return out;
}

/** One pass. Safe to call on every tick; does nothing when nothing moved. */
export async function planWatchTick(): Promise<void> {
  const st = useApp.getState();
  if (st.appSettings.planNudge === false) return;

  const bridge = (st as unknown as { bridgeState?: { goal?: string; goalTs?: number } }).bridgeState ?? {};
  const changes = changesFrom(st.decisions ?? [], Number(bridge.goalTs) || 0, String(bridge.goal ?? ""));
  const version = planVersion(changes);

  if (!started) {
    started = true;
    baseline = version;        // treat everything up to launch as already known
    return;
  }
  if (!version || version <= baseline) return;

  const targets: NudgeTarget[] = (st.teammates ?? [])
    .filter((t) => t.status !== undefined)
    .map((t) => ({ id: t.id, status: t.status, seen: told.get(t.id) ?? baseline }));

  const due = dueNow(targets, version);
  const held = waiting(targets, version);

  // the fresh ones only — a decision from before launch is not news
  const fresh = changes.filter((c) => c.at > baseline);
  if (due.length === 0 && held.length === 0) { baseline = version; return; }

  for (const t of due) {
    try {
      await submitToAgent(ptyIdFor(t.id), NUDGE_TEXT);
      told.set(t.id, version);
    } catch {
      // a session that will not take it now is simply still due next pass
    }
  }

  st.toast(humanLine(fresh.length ? fresh : changes, due.length, held.length), held.length ? "warn" : "info");

  // only close the window once nobody is still owed it
  if (held.length === 0) baseline = version;
}

/** Test seam — the module keeps state across ticks by design. */
export function __resetPlanWatch(): void {
  told.clear();
  baseline = 0;
  started = false;
}
