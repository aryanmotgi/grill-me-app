import { useCallback, useEffect, useState } from "react";
import { useApp } from "../store";
import { useBridge } from "./BridgePanel";
import { Markdown } from "./Markdown";
import { Icon } from "./Icon";
import { LessonsCard, PitchCard, QuizCard } from "./BrainTools";

// ---------------------------------------------------------------------------
// The project's shared brain (nav rail → Brain). One notebook that the Claude
// app, Grill Me Chat, and every Claude Code session read automatically:
//   Goal            — one line, editable here or by Claude (set_goal)
//   Where was I?    — everything new since you last looked
//   Right now       — decisions, notes, plans, open tasks, each session's latest
// Digests come from the same catch-up engine the sessions' hooks use.
// ---------------------------------------------------------------------------

const native = () => "__TAURI_INTERNALS__" in window;
const AWAY_MS = 30 * 60_000;

function ago(ms: number): string {
  const m = Math.round((Date.now() - ms) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  if (m < 60 * 24) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
}

async function digest(since: number): Promise<string> {
  if (!native()) return "*The brain reads your sessions — open the native app.*";
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string>("brain_digest", { since }).catch((e) => `*Couldn't read the brain: ${e}*`);
}

/** "Welcome back" nudge when the app regains focus after a long break. */
export function useWelcomeBack() {
  useEffect(() => {
    let blurredAt = 0;
    const onBlur = () => { blurredAt = Date.now(); };
    const onFocus = () => {
      if (blurredAt && Date.now() - blurredAt > AWAY_MS) {
        useApp.getState().toast("Welcome back — open Brain for a “where was I?” catch-up");
      }
      blurredAt = 0;
    };
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    return () => { window.removeEventListener("blur", onBlur); window.removeEventListener("focus", onFocus); };
  }, []);
}

function DeadlineCard() {
  const endsAt = useApp((s) => s.appSettings.hackathonEndsAt as number | undefined);
  const openTasks = useApp((s) => s.tasks.filter((t) => t.status !== "done").length);
  const toast = useApp((s) => s.toast);
  const [plan, setPlan] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!endsAt) return null;
  const left = endsAt - Date.now();
  const mins = Math.max(0, Math.floor(left / 60_000));
  const label = left <= 0 ? "time's up" : mins >= 60 ? `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m left` : `${mins}m left`;

  const ask = async () => {
    if (!native()) { toast("Needs the native app", "warn"); return; }
    setBusy(true);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      setPlan(await invoke<string>("brain_cut"));
    } catch (e) {
      toast(`Couldn't plan: ${e}`, "warn");
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!plan) return;
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("bridge_add_note", { text: `✂ Deadline plan (${label}):\n${plan}`, by: "Deadline coach" })
      .then(() => toast("Saved to the brain — every session sees it on its next message"))
      .catch((e) => toast(`${e}`, "warn"));
  };

  return (
    <div className={`composer-card rounded-xl px-4 py-3 flex flex-col gap-2 ${left < 3_600_000 ? "border-warn/50" : ""}`}>
      <div className="flex items-center gap-2">
        <Icon name="clock" size={13} />
        <span className={`text-[13px] font-semibold flex-1 ${left < 3_600_000 ? "text-warn" : "text-ink"}`}>
          Deadline · <span className="num">{label}</span>
          <span className="font-normal text-faint"> · {openTasks} open task{openTasks === 1 ? "" : "s"}</span>
        </span>
        <button className="composer-btn" disabled={busy} onClick={() => void ask()}>
          {busy ? <span className="spinner" /> : <Icon name="spark" size={11} />} What should we cut?
        </button>
      </div>
      {plan ? (
        <div className="text-[13px] leading-[1.6] text-dim">
          <Markdown text={plan} />
          <div className="flex gap-2 mt-2">
            <button className="composer-btn on" onClick={() => void save()}><Icon name="check" size={11} /> Save to brain</button>
            <button className="composer-btn" onClick={() => setPlan(null)}>Dismiss</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function BrainPage() {
  const project = useApp((s) => s.activeProject) ?? "default";
  const projectName = useApp((s) => s.projects.find((p) => p.id === s.activeProject)?.name ?? "this project");
  const seenKey = `brainSeen:${project}`;
  const lastSeen = useApp((s) => (typeof s.appSettings[seenKey] === "number" ? (s.appSettings[seenKey] as number) : 0));
  const setAppSetting = useApp((s) => s.setAppSetting);
  const goal = useBridge((b) => b.state.goal ?? "");
  // re-digest only when the notebook actually changes (the bridge poll swaps
  // the state object every few seconds even when nothing moved)
  const bridgeSig = useBridge((b) => JSON.stringify([b.state.goal, b.state.notes.length, b.state.plans.length, b.state.questions.length]));
  const toast = useApp((s) => s.toast);

  const checksOn = useApp((s) => s.appSettings.brainChecks !== false);
  const [since, setSince] = useState<string | null>(null);
  const [now, setNow] = useState<string | null>(null);
  const [draftGoal, setDraftGoal] = useState<string | null>(null);

  const load = useCallback(async () => {
    setNow(await digest(0));
    if (lastSeen) setSince(await digest(lastSeen));
  }, [lastSeen]);

  // refresh on open, when the bridge changes, and every 20s while open
  useEffect(() => { void load(); }, [load, bridgeSig]);
  useEffect(() => {
    const t = setInterval(() => void load(), 20_000);
    return () => clearInterval(t);
  }, [load]);

  const saveGoal = async () => {
    const g = (draftGoal ?? "").trim();
    setDraftGoal(null);
    if (!native() || g === goal) return;
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("bridge_set_goal", { goal: g }).catch((e) => toast(`${e}`, "warn"));
    useBridge.setState((b) => ({ state: { ...b.state, goal: g } }));
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="max-w-[820px] mx-auto px-6 py-8 flex flex-col gap-5 select-text">
        <div>
          <div className="text-[11px] tracking-[0.12em] uppercase text-faint">Brain · {projectName}</div>
          <p className="text-[12.5px] text-faint mt-1">
            One shared notebook. The Claude app, Grill Me Chat, and every Claude Code session read it automatically.
          </p>
          <label className="mt-2 flex items-center gap-2 text-[12px] text-dim cursor-pointer w-fit"
            title="After each session reply, a quick Claude check flags work that contradicts the plan and ticks tasks on the board. Uses a little of your Claude plan.">
            <input type="checkbox" className="accent-(--accent)" checked={checksOn}
              onChange={(e) => setAppSetting("brainChecks", e.target.checked)} />
            Smart checks — flag off-plan work and update the board automatically
          </label>
        </div>

        {/* goal */}
        <div className="composer-card rounded-xl px-4 py-3">
          <div className="text-[11px] tracking-[0.1em] uppercase text-faint mb-1">Goal</div>
          {draftGoal !== null ? (
            <input autoFocus value={draftGoal} maxLength={500}
              className="w-full bg-transparent outline-none text-[15px] text-ink"
              onChange={(e) => setDraftGoal(e.target.value)}
              onBlur={() => void saveGoal()}
              onKeyDown={(e) => { if (e.key === "Enter") void saveGoal(); if (e.key === "Escape") setDraftGoal(null); }} />
          ) : (
            <button className="text-left w-full text-[15px] cursor-text" onClick={() => setDraftGoal(goal)}>
              {goal ? <span className="text-ink">{goal}</span> : <span className="text-faint">What are we building, and for whom? Click to set.</span>}
            </button>
          )}
        </div>

        <DeadlineCard />

        {/* where was I */}
        <div className="composer-card rounded-xl px-4 py-3 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Icon name="clock" size={13} />
            <span className="text-[13px] font-semibold text-ink flex-1">
              Where was I? <span className="font-normal text-faint">{lastSeen ? `since ${ago(lastSeen)}` : "first visit"}</span>
            </span>
            <button className="composer-btn" onClick={() => { setAppSetting(seenKey, Date.now()); setSince(null); }}>
              <Icon name="check" size={11} /> Got it
            </button>
          </div>
          <div className="text-[13px] leading-[1.6] text-dim">
            {!lastSeen ? (
              <span className="text-faint">Everything below is new to you. Press “Got it” and next time this shows only what changed.</span>
            ) : since === null ? (
              <span className="text-faint">Loading…</span>
            ) : (
              <Markdown text={since} />
            )}
          </div>
        </div>

        <PitchCard />
        <QuizCard />

        {/* right now */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-ink flex-1">Right now</span>
            <button className="composer-btn" onClick={() => void load()}><Icon name="swap" size={11} /> Refresh</button>
          </div>
          <div className="text-[13px] leading-[1.6] text-dim">
            {now === null ? <span className="text-faint">Loading…</span> : <Markdown text={now} />}
          </div>
        </div>
        <LessonsCard />
      </div>
    </div>
  );
}
