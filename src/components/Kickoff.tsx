import { useState } from "react";
import { create } from "zustand";
import { useApp, upsertShared } from "../store";
import { promptSlug } from "./NewSession";
import { useBridge } from "./BridgePanel";
import type { Task } from "../types";
import { Icon } from "./Icon";

// ---------------------------------------------------------------------------
// One-click hackathon start. Idea + hours → Claude drafts a goal, the key
// decision, and parallel task briefs (each owning different files) → you edit
// → Start: sets the goal + hack clock, logs the decision, puts the tasks on
// the board, and spins up one worktree session per task with its brief.
// ---------------------------------------------------------------------------

interface DraftTask { title: string; files: string[]; brief: string; keep: boolean }
interface Plan { goal: string; decision: string; tasks: DraftTask[] }

export const useKickoff = create<{ open: boolean; setOpen: (o: boolean) => void }>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

const native = () => "__TAURI_INTERNALS__" in window;

export function Kickoff() {
  const open = useKickoff((k) => k.open);
  const setOpen = useKickoff((k) => k.setOpen);
  const toast = useApp((s) => s.toast);
  const [idea, setIdea] = useState("");
  const [hours, setHours] = useState(24);
  const [max, setMax] = useState(4);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState<"" | "plan" | "start">("");
  const [progress, setProgress] = useState("");

  if (!open) return null;
  const close = () => { if (!busy) setOpen(false); };

  const draft = async () => {
    if (!native()) { toast("Kickoff needs the native app", "warn"); return; }
    setBusy("plan");
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const r = await invoke<{ goal: string; decision: string; tasks: { title: string; files: string[]; brief: string }[] }>(
        "brain_kickoff", { idea, hours, maxSessions: max },
      );
      setPlan({ goal: r.goal, decision: r.decision, tasks: r.tasks.map((t) => ({ ...t, keep: true })) });
    } catch (e) {
      toast(`Couldn't plan: ${e}`, "warn");
    } finally {
      setBusy("");
    }
  };

  const start = async () => {
    if (!plan) return;
    const chosen = plan.tasks.filter((t) => t.keep && t.title.trim());
    if (!chosen.length) { toast("Keep at least one task", "warn"); return; }
    setBusy("start");
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const st = useApp.getState();
      // 1. brain: goal, clock, decision, board
      if (plan.goal.trim()) {
        await invoke("bridge_set_goal", { goal: plan.goal.trim() });
        useBridge.setState((b) => ({ state: { ...b.state, goal: plan.goal.trim() } }));
      }
      st.setAppSetting("hackathonEndsAt", Date.now() + hours * 3_600_000);
      if (plan.decision.trim()) st.addDecision(plan.decision.trim(), "kickoff");
      const taken = st.members.map((m) => m.id);
      const ids = chosen.map((t) => {
        const id = promptSlug(t.title, taken);
        taken.push(id);
        return id;
      });
      const now = Date.now();
      const tasks: Task[] = chosen.map((t, i) => ({
        id: `kick-${now}-${i}`, title: t.title, desc: t.brief, owner: ids[i], status: "not-started", files: t.files,
      }));
      useApp.setState((s) => ({ tasks: [...s.tasks, ...tasks] }));
      await upsertShared("tasks.json", tasks);
      // 2. one session per task, sequentially (each writes the team config)
      for (let i = 0; i < chosen.length; i++) {
        const t = chosen[i];
        setProgress(`Starting session ${i + 1} of ${chosen.length}: ${t.title}`);
        const brief = [
          `You're one of ${chosen.length} parallel sessions in a ${hours}-hour hackathon.`,
          plan.goal ? `Goal: ${plan.goal}` : "",
          `Your task: ${t.title}`,
          t.files.length ? `Files you own: ${t.files.join(", ")} — don't edit other sessions' files.` : "",
          "",
          t.brief,
          "",
          "Read get_plan first if the grill-me tools are available. Commit as you go.",
        ].filter((l) => l !== "").join("\n");
        await useApp.getState().spawnFromTemplate(ids[i], ids[i], `feat/${ids[i]}`, brief);
        useApp.getState().setAppSetting("sessionTitles", {
          ...((useApp.getState().appSettings.sessionTitles ?? {}) as Record<string, string>), [ids[i]]: t.title,
        });
      }
      toast(`Kicked off: ${chosen.length} sessions, ${hours}h on the clock`);
      setPlan(null);
      setIdea("");
      setOpen(false);
      useApp.getState().setView("brain");
    } catch (e) {
      toast(`Kickoff stopped: ${e}`, "warn");
    } finally {
      setBusy("");
      setProgress("");
    }
  };

  const edit = (i: number, patch: Partial<DraftTask>) =>
    setPlan((p) => p && { ...p, tasks: p.tasks.map((t, j) => (j === i ? { ...t, ...patch } : t)) });

  return (
    <div className="fixed inset-0 z-50 scrim flex items-center justify-center p-6" onClick={close}>
      <div className="composer-menu w-[720px] max-h-[86vh] rounded-2xl flex flex-col overflow-hidden rise" onClick={(e) => e.stopPropagation()}
        role="dialog" aria-label="Start a hackathon">
        <div className="flex items-center gap-2 px-5 h-14 border-b border-line flex-none">
          <Icon name="bolt" size={15} />
          <span className="text-[15px] font-semibold text-ink flex-1">Start a hackathon</span>
          <button className="w-7 h-7 rounded-md flex items-center justify-center text-faint hover:text-ink hover:bg-raised cursor-pointer" onClick={close}>
            <Icon name="cross" size={12} />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-5 flex flex-col gap-4">
          {!plan ? (
            <>
              <label className="flex flex-col gap-1.5">
                <span className="text-[12.5px] text-dim">What are we building? A rough idea is fine — track, sponsor, whatever you have.</span>
                <textarea autoFocus rows={4} value={idea} onChange={(e) => setIdea(e.target.value)}
                  className="composer-card rounded-xl px-3.5 py-3 text-[13.5px] text-ink outline-none resize-none placeholder:text-faint"
                  placeholder="e.g. An AI that watches agent fleets for prompt-injection cascades — security track, demo needs a live attack" />
              </label>
              <div className="flex gap-6 text-[12.5px] text-dim">
                <label className="flex items-center gap-2">Hours
                  <select className="composer-btn" value={hours} onChange={(e) => setHours(Number(e.target.value))}>
                    {[6, 12, 24, 36, 48].map((h) => <option key={h} value={h}>{h}h</option>)}
                  </select>
                </label>
                <label className="flex items-center gap-2">Parallel sessions
                  <select className="composer-btn" value={max} onChange={(e) => setMax(Number(e.target.value))}>
                    {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
              </div>
              <p className="text-[11.5px] text-faint">Claude drafts a goal and tasks that can run side by side (using your playbooks and past lessons). You review before anything starts.</p>
            </>
          ) : (
            <>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] tracking-[0.1em] uppercase text-faint">Goal</span>
                <input className="composer-card rounded-lg px-3 py-2 text-[13.5px] text-ink outline-none" value={plan.goal}
                  onChange={(e) => setPlan({ ...plan, goal: e.target.value })} />
              </label>
              {plan.decision ? (
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] tracking-[0.1em] uppercase text-faint">Approach</span>
                  <textarea rows={2} className="composer-card rounded-lg px-3 py-2 text-[12.5px] text-dim outline-none resize-none" value={plan.decision}
                    onChange={(e) => setPlan({ ...plan, decision: e.target.value })} />
                </label>
              ) : null}
              <div className="text-[11px] tracking-[0.1em] uppercase text-faint">Sessions to start</div>
              {plan.tasks.map((t, i) => (
                <div key={i} className={`rounded-xl border border-line p-3 flex flex-col gap-1.5 ${t.keep ? "" : "opacity-50"}`}>
                  <div className="flex items-center gap-2">
                    <input type="checkbox" className="accent-(--accent)" checked={t.keep} onChange={(e) => edit(i, { keep: e.target.checked })} />
                    <input className="flex-1 bg-transparent outline-none text-[13.5px] text-ink font-medium" value={t.title}
                      onChange={(e) => edit(i, { title: e.target.value })} />
                  </div>
                  {t.files.length ? <div className="text-[11px] text-faint font-mono truncate">{t.files.join("  ")}</div> : null}
                  <textarea rows={3} className="bg-transparent outline-none text-[12px] text-dim resize-y" value={t.brief}
                    onChange={(e) => edit(i, { brief: e.target.value })} />
                </div>
              ))}
            </>
          )}
        </div>

        <div className="flex items-center gap-2 px-5 h-14 border-t border-line flex-none">
          <span className="text-[12px] text-faint flex-1 truncate">{progress}</span>
          {plan ? <button className="composer-btn" disabled={!!busy} onClick={() => setPlan(null)}>Back</button> : null}
          {!plan ? (
            <button className="composer-btn on" disabled={!idea.trim() || !!busy} onClick={() => void draft()}>
              {busy === "plan" ? <span className="spinner" /> : <Icon name="spark" size={12} />} Draft the plan
            </button>
          ) : (
            <button className="composer-btn on" disabled={!!busy} onClick={() => void start()}>
              {busy === "start" ? <span className="spinner" /> : <Icon name="bolt" size={12} />}
              Start {plan.tasks.filter((t) => t.keep).length} sessions
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
