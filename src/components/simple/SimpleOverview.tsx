import { useEffect, useMemo, useRef, useState } from "react";
import { ptyIdFor, useApp } from "../../store";
import { Icon } from "../Icon";
import { AgentLogo } from "../AgentLogo";
import { HomeDashboard } from "../HomeDashboard";
import { sessionTitle } from "../../lib/sessionTitle";
import { headline, sessionSentence, type Sentence } from "../../lib/sessionSentence";
import { kTokens, money, sessionStats } from "../../lib/coach";
import { useTests } from "../../lib/testsStore";
import { visibleSessions } from "../../lib/sessionNav";
import { submitToAgent } from "../../lib/ptyReady";
import { parseTranscript, toRows, type ChatRow } from "../../lib/chat";
import { AGENT_NAMES, forecast, paceFrac, span, toneOf, type AgentUsage } from "../../lib/limits";
import { RECAP_SCHEMA, RECAP_SYSTEM, needsRewrite, parseRecap, recapFacts, sig, startOfDay, type SessionDay } from "../../lib/recap";
import { interviewBrainOf } from "../../lib/aiConnect";
import { useDNA } from "../../lib/dnaStore";
import { notices } from "../../lib/spark";
import type { Teammate } from "../../types";
import { GoalWatch, ProjectMap } from "./OverviewExtras";
import { useMergeSessions } from "../../lib/mergeSessions";

// ---------------------------------------------------------------------------
// The simple layout's Overview, top to bottom:
//   headline      what needs you, in one line
//   limits        a bar per agent: used, an even-pace marker, a forecast
//   sessions      your last ask and what came of it; Compact when heavy
//   running apps  dev servers you can open
//   today         a short recap your AI writes once and reuses
//   goal          progress through the tasks, when there's a goal
//   spark         one tip from your Coding DNA
// The full dashboard (activity, merges, budget) is one click away.
// ---------------------------------------------------------------------------

const native = () => "__TAURI_INTERNALS__" in window;
async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

const RANK: Record<Sentence["tone"], number> = { needs: 0, stopped: 1, working: 2, done: 3, quiet: 4 };
const TONE: Record<Sentence["tone"], string> = { needs: "text-warn", stopped: "text-danger", working: "text-dim", done: "text-ok", quiet: "text-faint" };
type Receipt = Extract<ChatRow, { kind: "worked" }>;
interface LastTurn { ask?: string; receipt?: Receipt; asksToday: string[] }

function Label({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-center mb-2">
      <span className="text-[11px] tracking-[0.12em] uppercase text-faint font-semibold flex-1">{children}</span>
      {right}
    </div>
  );
}

// -- limits --------------------------------------------------------------------

function Limits() {
  const live = useApp((s) => s.appSettings.claudeUsageLive === true);
  const setAppSetting = useApp((s) => s.setAppSetting);
  const [data, setData] = useState<AgentUsage[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!native()) {
      // browser dev: sample bars (the real app only shows real numbers)
      const at = (m: number) => new Date(Date.now() + m * 60_000).toISOString();
      setData([
        { agent: "claude", source: "live", ageSecs: 0, windows: [{ label: "5-hour", pct: 62, resetsAt: at(170), windowMins: 300 }, { label: "Week", pct: 28, resetsAt: at(4 * 1440), windowMins: 10080 }] },
        { agent: "codex", source: "cache", ageSecs: 60, windows: [{ label: "Month", pct: 24, resetsAt: at(15 * 1440), windowMins: 43200 }] },
      ]);
      return;
    }
    let alive = true;
    const load = () => void call<[AgentUsage[], string | null]>("agent_usage", { claudeLiveOk: live })
      .then(([u, n]) => { if (alive) { setData(u); setNote(n); } }).catch(() => { if (alive) setData([]); });
    load();
    const t = setInterval(load, 60_000);
    const r = setInterval(() => tick((x) => x + 1), 30_000); // keep the forecasts current
    return () => { alive = false; clearInterval(t); clearInterval(r); };
  }, [live]);
  if (data === null) return null;
  const hasClaude = data.some((d) => d.agent === "claude");
  if (!data.length && live && !note) return null;
  return (
    <section aria-label="Plan limits">
      <Label>Limits</Label>
      <div className="limits-card rounded-2xl border border-line px-4 py-3.5 flex flex-col gap-4">
        {data.map((u) => u.source === "cache" && u.ageSecs > 3 * 86_400 ? (
          // not used in days: one quiet line, no bars that look current
          <div key={u.agent} className="flex items-center gap-2 text-[12px] text-faint" title="These numbers are from the last time you used it">
            <AgentLogo agent={u.agent} size={13} /> {AGENT_NAMES[u.agent] ?? u.agent}
            <span>· {u.windows.map((w) => `${Math.round(w.pct)}% of ${w.label.toLowerCase()}`).join(", ")}, as of {span(u.ageSecs / 60)} ago</span>
          </div>
        ) : (
          <div key={u.agent} className="flex flex-col gap-2.5">
            <div className="flex items-center gap-2 text-[12.5px] text-ink">
              <AgentLogo agent={u.agent} size={14} /> {AGENT_NAMES[u.agent] ?? u.agent}
              {u.source === "cache" && u.ageSecs > 1800 ? <span className="text-[11px] text-faint" title="These numbers come from the last time this agent ran">· as of {span(u.ageSecs / 60)} ago</span> : null}
            </div>
            {u.windows.map((w) => {
              const pace = paceFrac(w);
              const f = forecast(w);
              // the bar warns as soon as the forecast does, not only once it's mostly full
              const order = ["ok", "warn", "hot"] as const;
              const tone = order[Math.max(order.indexOf(toneOf(w.pct)), order.indexOf(f.tone))];
              return (
                <div key={w.label} className="flex flex-col gap-1">
                  <div className="flex items-baseline gap-2 text-[11.5px]">
                    <span className="text-dim">{w.label}</span>
                    <span className="flex-1" />
                    <span className={`num text-[13px] ${tone === "hot" ? "text-danger" : tone === "warn" ? "text-warn" : "text-ink"}`}>{Math.round(w.pct)}%</span>
                  </div>
                  <div className={`limit-bar ${tone}`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(w.pct)} aria-label={`${AGENT_NAMES[u.agent] ?? u.agent} ${w.label}`}>
                    <div className="limit-fill" style={{ width: `${Math.min(100, w.pct)}%` }} />
                    {pace !== null ? <div className="limit-pace" style={{ left: `${pace * 100}%` }} title="Where an even pace would put you right now" /> : null}
                  </div>
                  <div className={`text-[11.5px] ${f.tone === "hot" ? "text-danger" : f.tone === "warn" ? "text-warn" : "text-faint"}`}>{f.text}</div>
                </div>
              );
            })}
          </div>
        ))}
        {!hasClaude && !live ? (
          <div className="flex items-center gap-3 text-[12px]">
            <AgentLogo agent="claude" size={14} />
            <span className="flex-1 text-dim">See your Claude Code limits: the same numbers <span className="font-mono">/usage</span> shows. Grill Me asks Anthropic using the sign-in Claude Code already saved on this Mac, and sends it nowhere else.</span>
            <button className="composer-btn h-8 flex-none" onClick={() => setAppSetting("claudeUsageLive", true)}>Show my limits</button>
          </div>
        ) : null}
        {note && live && !hasClaude ? <div className="text-[11.5px] text-faint">Claude Code: {note}</div> : null}
      </div>
    </section>
  );
}

// -- sessions --------------------------------------------------------------------

/** Each session's latest ask and finished turn, read from its transcript. */
function useLastTurns(mates: { id: string; repo?: string }[]): Record<string, LastTurn> {
  const [turns, setTurns] = useState<Record<string, LastTurn>>({});
  const key = mates.map((m) => `${m.id}:${m.repo}`).join("|");
  useEffect(() => {
    if (!native()) return;
    let alive = true;
    const load = async () => {
      const today = startOfDay();
      const out: Record<string, LastTurn> = {};
      for (const m of mates) {
        if (!m.repo) continue;
        const lines = await call<string[]>("transcript_recent", { repoPath: m.repo }).catch(() => [] as string[]);
        const items = parseTranscript(lines);
        const asks = items.flatMap((i) => (i.kind === "user" ? [{ text: i.text, ts: i.ts }] : []));
        const receipt = [...toRows(items, false)].reverse().find((r): r is Receipt => r.kind === "worked");
        out[m.id] = { ask: asks[asks.length - 1]?.text, receipt, asksToday: asks.filter((a) => (a.ts ?? 0) >= today).map((a) => a.text) };
      }
      if (alive) setTurns(out);
    };
    void load();
    const t = setInterval(() => void load(), 30_000);
    return () => { alive = false; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return turns;
}

function SessionCard({ t, said, last }: { t: Teammate; said: Sentence; last?: LastTurn }) {
  const titles = useApp((s) => s.appSettings.sessionTitles);
  const setActive = useApp((s) => s.setActive);
  const toast = useApp((s) => s.toast);
  const [compacting, setCompacting] = useState(false);
  const st = sessionStats(t);
  const r = last?.receipt;
  const compact = async () => {
    setCompacting(true);
    try {
      await submitToAgent(ptyIdFor(t.id), "/compact");
      toast(`Compacting ${sessionTitle(t, titles)}: it keeps the gist and every message gets cheaper`);
    } catch (e) { toast(`Couldn't compact: ${e}`, "warn"); }
    finally { setCompacting(false); }
  };
  return (
    <div className="rounded-xl border border-line bg-raised/20 hover:bg-raised/40 transition-colors">
      <button className="w-full flex items-start gap-3 px-4 py-3 text-left cursor-pointer" onClick={() => setActive(t.id)}>
        <span className={`status-dot ${t.status} flex-none mt-1.5`} aria-hidden />
        <span className="flex-1 min-w-0">
          <span className="flex items-baseline gap-2 min-w-0">
            <span className="text-[13.5px] text-ink truncate">{sessionTitle(t, titles)}</span>
            <span className={`text-[12px] truncate ${TONE[said.tone]}`}>{said.text}</span>
          </span>
          {last?.ask ? (
            <span className="block text-[12px] text-dim truncate mt-0.5">
              You asked “{last.ask.replace(/\s+/g, " ")}”
              {r && r.ask === last.ask ? (
                <span className="text-faint"> → {r.files.length ? `${r.files.length} file${r.files.length === 1 ? "" : "s"} changed` : "no file changes"}
                  {r.tests ? <span className={r.tests === "pass" ? "text-ok" : "text-danger"}>{r.tests === "pass" ? ", tests pass" : ", tests fail"}</span> : null}</span>
              ) : null}
            </span>
          ) : null}
        </span>
        {st ? <span className="num text-[12px] text-faint flex-none mt-0.5" title="Estimated spend">{money(st.cost)}</span> : null}
        <Icon name="chevron" size={10} className="text-faint flex-none mt-1.5" />
      </button>
      {st?.heavy ? (
        <div className="flex items-center gap-2 pb-3 -mt-1 pl-[34px] pr-4 text-[12px]">
          <span className="text-warn flex-1">Heavy: every message re-reads ~{kTokens(st.perTurn)} tokens ({money(st.nextMsg)}).</span>
          <button className="composer-btn h-7 text-[12px]" disabled={compacting} onClick={() => void compact()}>
            {compacting ? "Compacting…" : "Compact"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

// -- running apps ------------------------------------------------------------------

interface Server { port: number; pid: number; command: string; cwd: string }
/** Is this server running from one of the project's folders? */
const inFolders = (cwd: string, folders: string[]) => folders.some((f) => { const r = f.replace(/\/+$/, ""); return cwd === r || cwd.startsWith(`${r}/`); });

function RunningApps({ folders }: { folders: string[] }) {
  const members = useApp((s) => s.members);
  const [servers, setServers] = useState<Server[]>([]);
  useEffect(() => {
    if (!native()) return;
    let alive = true;
    const load = () => void call<Server[]>("dev_servers").then((s) => { if (alive) setServers(s); }).catch(() => {});
    load();
    const t = setInterval(load, 15_000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  // only this project's apps: not other projects, not Grill Me's own tools
  const mine = servers.filter((s) => s.cwd && inFolders(s.cwd, folders));
  if (!mine.length) return null;
  const open = (port: number) => void import("@tauri-apps/plugin-opener").then(({ openUrl }) => openUrl(`http://localhost:${port}`)).catch(() => {});
  return (
    <section aria-label="Running apps">
      <Label>Running apps</Label>
      <div className="flex flex-col gap-1.5">
        {mine.map((s) => {
          const m = members.find((x) => s.cwd && (s.cwd === x.repoPath || s.cwd.startsWith(`${x.repoPath}/`)));
          const name = m?.name ?? s.cwd.split("/").filter(Boolean).pop() ?? s.command;
          return (
            <div key={s.port} className="flex items-center gap-3 rounded-xl border border-line bg-raised/20 px-4 py-2.5">
              <span className="w-2 h-2 rounded-full bg-ok shadow-[0_0_8px_var(--ok)] flex-none" aria-hidden />
              <span className="font-mono text-[12.5px] text-ink">localhost:{s.port}</span>
              <span className="text-[12px] text-faint truncate flex-1" title={`${s.command} in ${s.cwd}`}>{name} · {s.command}</span>
              <button className="composer-btn h-7 text-[12px]" onClick={() => open(s.port)}>Open</button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// -- today ---------------------------------------------------------------------------

function Today({ days, repos }: { days: SessionDay[]; repos: string[] }) {
  const project = useApp((s) => s.activeProject ?? "default");
  const brain = useApp((s) => interviewBrainOf(s.appSettings.interviewBrain));
  const cacheKey = `recap:${project}`;
  const cached = useApp((s) => s.appSettings[cacheKey] as { day: number; sig: string; at: number; text: string } | undefined);
  const setAppSetting = useApp((s) => s.setAppSetting);
  const toast = useApp((s) => s.toast);
  const [commits, setCommits] = useState<{ message: string; at: number }[]>([]);
  const busy = useRef(false);
  const [failed, setFailed] = useState(false);
  const repoKey = repos.join("|");
  useEffect(() => {
    if (!native() || !repos.length) return;
    const today = startOfDay() / 1000;
    void Promise.all(repos.map((r) => call<{ commits: { message: string; timestamp: number }[] }>("git_state", { repoPath: r }).catch(() => ({ commits: [] }))))
      .then((all) => setCommits(all.flatMap((g) => g.commits)
        .filter((c) => c.timestamp >= today && !/^checkpoint:/.test(c.message))
        .map((c) => ({ message: c.message, at: c.timestamp }))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoKey]);
  const facts = recapFacts(days, commits);
  const factsSig = sig(facts);
  const fresh = cached && cached.day === startOfDay() ? cached.text : "";
  useEffect(() => {
    if (!native() || !facts || brain === "form" || busy.current || !needsRewrite(cached, factsSig)) return;
    busy.current = true;
    void call<unknown>("interview_turn", { brain, system: RECAP_SYSTEM, prompt: `Today's facts:\n${facts}`, schema: JSON.stringify(RECAP_SCHEMA) })
      .then((raw) => {
        const text = parseRecap(raw);
        if (text) setAppSetting(cacheKey, { day: startOfDay(), sig: factsSig, at: Date.now(), text });
      })
      .catch(() => setFailed(true))
      .finally(() => { busy.current = false; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [factsSig, brain]);
  if (!facts && !fresh) {
    return (
      <section aria-label="Today">
        <Label>Today</Label>
        <p className="text-[12.5px] text-faint px-1">A short recap of what you built today shows up here after your first message.</p>
      </section>
    );
  }
  const copy = () => void navigator.clipboard.writeText(fresh || facts).then(() => toast("Recap copied"));
  return (
    <section aria-label="Today">
      <Label right={<button className="text-[11.5px] text-dim hover:text-ink cursor-pointer flex items-center gap-1" onClick={copy}><Icon name="doc" size={11} /> Copy</button>}>Today</Label>
      <div className="rounded-xl border border-line bg-raised/20 px-4 py-3 text-[13px] leading-relaxed text-dim select-text">
        {fresh || (brain === "form" || failed || !native()
          ? <span className="whitespace-pre-line">{facts}</span>
          : <span className="text-faint">Writing today's recap…</span>)}
      </div>
    </section>
  );
}

// -- goal + spark -----------------------------------------------------------------------

function SparkTip() {
  // select the DNA itself (a stable reference), then derive: a selector that
  // builds a new object each call makes React re-render forever
  const dna = useDNA((s) => s.dna);
  const tip = useMemo(() => (dna ? notices(dna)[0] : undefined), [dna]);
  const setView = useApp((s) => s.setView);
  if (!tip) return null;
  return (
    <button className="w-full text-left flex items-start gap-3 rounded-xl border border-accent/30 bg-accent/5 hover:bg-accent/10 px-4 py-3 cursor-pointer" onClick={() => setView("dna")}>
      <span className="w-2 h-2 rounded-full bg-accent shadow-[0_0_8px_var(--accent)] mt-1.5 flex-none" aria-hidden />
      <span className="flex-1 text-[12.5px] text-dim leading-relaxed"><span className="text-ink">Spark · </span>{tip.text}</span>
      <Icon name="chevron" size={10} className="text-faint mt-1.5" />
    </button>
  );
}

// -- page ----------------------------------------------------------------------------------

export function SimpleOverview() {
  const [full, setFull] = useState(false);
  const all = useApp((s) => s.teammates);
  const appMode = useApp((s) => s.appMode);
  const members = useApp((s) => s.members);
  const titles = useApp((s) => s.appSettings.sessionTitles);
  const setView = useApp((s) => s.setView);
  const tests = useTests((t) => t.results);
  const memberKey = members.map((m) => m.id).join(",");
  // the same sessions the sidebar lists (solo: only yours)
  const teammates = useMemo(() => visibleSessions(all, appMode, memberKey ? memberKey.split(",") : []), [all, appMode, memberKey]);
  const rows = useMemo(() => teammates
    .map((t) => ({ t, said: sessionSentence(t, tests[t.id] && !tests[t.id].running ? tests[t.id].ok : null) }))
    .sort((a, b) => RANK[a.said.tone] - RANK[b.said.tone]), [teammates, tests]);
  const mates = useMemo(() => teammates.map((t) => ({ id: t.id, repo: members.find((m) => m.id === t.id)?.repoPath })), [teammates, members]);
  const last = useLastTurns(mates);
  const days: SessionDay[] = teammates.map((t) => ({
    title: sessionTitle(t, titles),
    asks: last[t.id]?.asksToday ?? [],
    files: t.changes.map((c) => c.file.split("/").pop() ?? c.file),
    tests: tests[t.id] && !tests[t.id].running ? (tests[t.id].ok ? "pass" : "fail") : undefined,
  }));
  const repos = [...new Set(mates.map((m) => m.repo).filter((r): r is string => !!r))];
  const projectPath = useApp((s) => s.projects.find((p) => p.id === s.activeProject)?.path);

  if (full) {
    return (
      <div className="flex-1 min-h-0 flex flex-col">
        <button className="flex-none flex items-center gap-1.5 h-8 px-4 text-[12px] text-dim hover:text-ink border-b border-line cursor-pointer" onClick={() => setFull(false)}>
          ← Simple overview
        </button>
        <HomeDashboard />
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="max-w-[760px] mx-auto px-6 py-8 flex flex-col gap-7">
        <div className="flex items-center gap-3">
          <h1 className="text-[19px] font-medium text-ink flex-1">{headline(rows)}</h1>
          <button className="composer-btn" onClick={() => setView("new")}><Icon name="plus" size={12} /> New session</button>
        </div>
        <GoalWatch />
        <Limits />
        {rows.length ? (
          <section aria-label="Your sessions">
            <Label right={rows.length > 1 ? (
              <button className="text-[11.5px] text-dim hover:text-ink cursor-pointer flex items-center gap-1" onClick={() => useMergeSessions.getState().setOpen(true)}>
                <Icon name="merge" size={11} /> Merge my sessions
              </button>
            ) : undefined}>Sessions</Label>
            <div className="flex flex-col gap-1.5">
              {rows.map(({ t, said }) => <SessionCard key={t.id} t={t} said={said} last={last[t.id]} />)}
            </div>
          </section>
        ) : null}
        <ProjectMap repo={projectPath ?? repos[0]} />
        <RunningApps folders={projectPath ? [projectPath, ...repos] : repos} />
        <Today days={days} repos={repos} />
        <SparkTip />
        <button className="self-start text-[12px] text-faint hover:text-ink cursor-pointer" onClick={() => setFull(true)}>
          Show the full dashboard (activity, merges, budget) →
        </button>
      </div>
    </div>
  );
}
