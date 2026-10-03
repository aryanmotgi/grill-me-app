import { useEffect, useMemo, useState } from "react";
import { useApp } from "../../store";
import { Icon } from "../Icon";
import { useBridge } from "../BridgePanel";
import { summarize, type WatchEntry } from "../../lib/goalWatch";
import { watchKey, watchLog } from "../../lib/goalWatchStore";
import { span } from "../../lib/limits";

// ---------------------------------------------------------------------------
// Two Overview sections:
//   GoalWatch    your goal, and the Spark checking every prompt against it:
//                an on-track meter, the last ten prompts as dots, a nudge
//                when you drift
//   ProjectMap   everything you've built as one interactive map, drawn by
//                Archify on request and shown right here
// ---------------------------------------------------------------------------

const native = () => "__TAURI_INTERNALS__" in window;
async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

function Label({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-center mb-2">
      <span className="text-[11px] tracking-[0.12em] uppercase text-faint font-semibold flex-1">{children}</span>
      {right}
    </div>
  );
}

// -- goal watch ----------------------------------------------------------------

export function GoalWatch() {
  const goal = useBridge((b) => b.state.goal ?? "");
  const toast = useApp((s) => s.toast);
  const tasks = useApp((s) => s.tasks);
  const raw = useApp((s) => s.appSettings[watchKey()]);
  const log = useMemo(() => watchLog({ k: raw }, "k"), [raw]);
  const [draft, setDraft] = useState<string | null>(null);
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 60_000); return () => clearInterval(t); }, []);
  const save = async () => {
    const g = (draft ?? "").trim();
    setDraft(null);
    if (g === goal) return;
    if (native()) {
      try { await call("bridge_set_goal", { goal: g }); } catch (e) { toast(`Couldn't save the goal: ${e}`, "warn"); return; }
    }
    useBridge.setState((b) => ({ state: { ...b.state, goal: g } }));
    if (g) toast("Goal set. The Spark checks each prompt you send against it.");
  };

  if (!goal || draft !== null) {
    return (
      <section aria-label="Goal">
        <Label>Goal</Label>
        <div className="rounded-xl border border-accent/30 bg-accent/5 px-4 py-3.5 flex flex-col gap-2">
          <div className="flex gap-2">
            <input autoFocus={draft !== null} value={draft ?? ""} onChange={(e) => setDraft(e.target.value)} maxLength={300}
              onKeyDown={(e) => { if (e.key === "Enter") void save(); if (e.key === "Escape") setDraft(null); }}
              placeholder="What are you trying to get done? e.g. Ship login and signup tonight"
              className="flex-1 min-w-0 bg-raised/60 hairline rounded-lg px-3 h-9 text-[13px] outline-none focus:border-accent placeholder:text-faint" />
            <button className="composer-btn h-9" disabled={!(draft ?? "").trim()} onClick={() => void save()}>Set goal</button>
          </div>
          <p className="text-[12px] text-faint">The Spark checks every prompt you send against it, and tells you when you drift into side quests.</p>
        </div>
      </section>
    );
  }

  const s = summarize(log, goal);
  const recent = log.slice(-10);
  const done = tasks.filter((t) => t.status === "done").length;
  const pct = s.total ? s.on / s.total : 0;
  const drifting = !!s.nudge;
  return (
    <section aria-label="Goal">
      <Label right={<button className="text-[11.5px] text-dim hover:text-ink cursor-pointer" onClick={() => setDraft(goal)}>Change</button>}>Goal</Label>
      <div className={`rounded-xl border px-4 py-3.5 flex flex-col gap-2.5 ${drifting ? "border-warn/40 bg-warn/5" : "border-line bg-raised/20"}`}>
        <div className="flex items-start gap-3">
          <span className="text-[14px] text-ink flex-1 leading-snug">{goal}</span>
          {tasks.length ? <span className="num text-[12px] text-dim flex-none" title="Tasks done">{done} of {tasks.length} tasks</span> : null}
        </div>
        {s.total ? (
          <>
            <div className="flex items-center gap-3">
              <div className={`limit-bar ${drifting ? "warn" : "ok"} flex-1`}><div className="limit-fill" style={{ width: `${pct * 100}%` }} /></div>
              <span className={`text-[12px] num flex-none ${drifting ? "text-warn" : "text-ok"}`}>{drifting ? "Drifting" : "On track"} · {s.on} of last {s.total} prompts</span>
            </div>
            <div className="flex items-center gap-1.5" aria-label="Your last prompts">
              {recent.map((e: WatchEntry) => (
                <span key={e.at} title={`${e.verdict === "on" ? "On goal" : e.verdict === "side" ? "Side quest" : "Checking…"}: “${e.text}”${e.why ? `\n${e.why}` : ""}\n${span((Date.now() - e.at) / 60_000)} ago`}
                  className={`w-2.5 h-2.5 rounded-full ${e.verdict === "on" ? "bg-ok" : e.verdict === "side" ? "bg-warn" : "bg-line animate-pulse"}`} />
              ))}
              <span className="text-[11px] text-faint ml-1">last prompts · green on goal, amber side quest</span>
            </div>
          </>
        ) : (
          <p className="text-[12px] text-faint">Send a prompt and the Spark tells you if it moves you toward this.</p>
        )}
        {s.nudge ? (
          <div className="flex items-center gap-2 text-[12.5px] text-warn">
            <span className="w-2 h-2 rounded-full bg-accent shadow-[0_0_8px_var(--accent)] flex-none" aria-hidden />
            <span className="flex-1">Spark: {s.nudge}</span>
          </div>
        ) : null}
      </div>
    </section>
  );
}

// -- project map ------------------------------------------------------------------

interface MapStatus { installed: boolean; running: boolean; runSecs: number; html: string | null; at: number | null; changedSince: number; error: string | null }

export function ProjectMap({ repo }: { repo: string | undefined }) {
  const toast = useApp((s) => s.toast);
  const [st, setSt] = useState<MapStatus | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState<"" | "install" | "start">("");
  const [big, setBig] = useState(false);
  const running = !!st?.running;
  useEffect(() => {
    if (!native() || !repo) return;
    let alive = true;
    const load = () => void call<MapStatus>("map_status", { repoPath: repo }).then((s) => { if (alive) setSt(s); }).catch(() => {});
    load();
    const t = setInterval(load, running || busy ? 4000 : 60_000);
    return () => { alive = false; clearInterval(t); };
  }, [repo, running, busy]);
  if (!native() || !repo || !st) return null;

  const start = async () => {
    setConfirm(false);
    try {
      if (!st.installed) {
        setBusy("install");
        await call<string>("archify_install");
      }
      setBusy("start");
      await call("map_generate", { repoPath: repo });
      setSt({ ...st, installed: true, running: true, runSecs: 0, error: null });
      toast("Drawing your project map. It takes a minute or two.");
    } catch (e) { toast(`Couldn't map the project: ${e}`, "warn"); }
    finally { setBusy(""); }
  };

  const age = st.at ? span((Date.now() / 1000 - st.at) / 60) : "";
  const header = (
    <Label right={st.html ? (
      <span className="flex items-center gap-3">
        <button className="text-[11.5px] text-dim hover:text-ink cursor-pointer" onClick={() => setBig(true)}>Full screen</button>
        <button className="text-[11.5px] text-dim hover:text-ink cursor-pointer disabled:opacity-40" disabled={running || !!busy} onClick={() => setConfirm(true)}>Update</button>
      </span>
    ) : undefined}>Your project</Label>
  );

  const confirmBox = confirm ? (
    <div className="rounded-xl border border-accent/30 bg-accent/5 px-4 py-3 flex flex-col gap-2 text-[12.5px] text-dim">
      <p>
        {st.installed ? "" : <>First Grill Me installs <span className="text-ink">Archify</span> (free, open source) with <span className="font-mono text-[11.5px]">npx skills add tt-a1i/archify -g</span>. </>}
        Then Claude Code reads your project and draws the map. It takes 1 to 3 minutes and uses some of your Claude plan. It only writes in <span className="font-mono text-[11.5px]">.archify/</span>, which git ignores.
      </p>
      <div className="flex gap-2">
        <button className="composer-btn h-8" onClick={() => void start()}>{st.installed ? "Draw the map" : "Install and draw"}</button>
        <button className="composer-btn h-8" onClick={() => setConfirm(false)}>Cancel</button>
      </div>
    </div>
  ) : null;

  const progress = running || busy ? (
    <div className="flex items-center gap-2 text-[12.5px] text-dim px-1">
      <span className="spinner" style={{ width: 12, height: 12 }} />
      {busy === "install" ? "Installing Archify…" : `Drawing your map… ${span((st.runSecs ?? 0) / 60) === "0m" ? `${st.runSecs}s` : span(st.runSecs / 60)}`}
    </div>
  ) : null;

  if (!st.html) {
    return (
      <section aria-label="Project map">
        {header}
        {confirmBox ?? (
          <div className="rounded-xl border border-line bg-raised/20 px-4 py-4 flex items-center gap-4">
            <Icon name="layout" size={20} className="text-accent flex-none" />
            <div className="flex-1 min-w-0">
              <div className="text-[13.5px] text-ink">See everything you've built as one map</div>
              <div className="text-[12px] text-faint">Screens, APIs, data and how they connect. Click any part to explore it.</div>
            </div>
            {progress ?? <button className="composer-btn h-9 flex-none" onClick={() => setConfirm(true)}>Map my project</button>}
          </div>
        )}
        {st.error && !running ? <pre className="mt-2 text-[11px] text-danger whitespace-pre-wrap font-mono">{st.error}</pre> : null}
      </section>
    );
  }

  const frame = (h: string) => (
    <iframe title="Project map" sandbox="allow-scripts" srcDoc={st.html ?? ""} className="w-full border-0 rounded-xl bg-[#0b0b0d]" style={{ height: h }} />
  );
  return (
    <section aria-label="Project map">
      {header}
      {confirmBox}
      <div className="flex items-center gap-2 text-[11.5px] text-faint mb-2 px-1">
        <span>Mapped {age} ago</span>
        {st.changedSince ? <span className="text-warn">· {st.changedSince} file{st.changedSince === 1 ? "" : "s"} changed since</span> : null}
        <span className="flex-1" />
        {progress}
      </div>
      {frame("520px")}
      {st.error && !running ? <pre className="mt-2 text-[11px] text-danger whitespace-pre-wrap font-mono">{st.error}</pre> : null}
      {big ? (
        <div className="fixed inset-0 z-50 scrim flex flex-col p-6 gap-3" onClick={() => setBig(false)}>
          <div className="flex items-center"><span className="text-[13px] text-ink flex-1">Your project</span><button className="composer-btn h-8" onClick={() => setBig(false)}>Close</button></div>
          <div className="flex-1 min-h-0" onClick={(e) => e.stopPropagation()}>{frame("100%")}</div>
        </div>
      ) : null}
    </section>
  );
}
