import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./Icon";
import { TickNumber } from "./TickNumber";
import { Sparkline } from "./SessionList";
import { attentionSessions, isSolo, ptyIdFor, useApp } from "../store";
import { surfaceVisible } from "../lib/soloVisibility";
import { isTauri } from "../data/sources/git";
import { fmtTokens } from "../lib/format";
import {
  activityLine,
  DEFAULT_TOKEN_BUDGET,
  tokenBudget,
} from "../lib/dashboard";
import type { Teammate } from "../types";

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

const prefersReduced = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function activitySentence(t: Teammate): string {
  if (t.health === "disconnected") return "worktree not connected";
  if (t.status === "needs-input") return "needs a decision";
  if (t.status === "working")
    return t.currentFile !== "—" && t.currentFile
      ? `working in ${t.currentFile.split("/").pop()}`
      : "working";
  if (t.lastActiveMin > 0) return `quiet ${t.lastActiveMin}m`;
  return "idle";
}

// ---------------------------------------------------------------------------
// 1. HERO — the one queue that matters. Amber emphasis + pulse when non-empty;
// calm cyan "all clear" otherwise (also kills the solo merge-turn nag).
// ---------------------------------------------------------------------------
function NeedsYouHero() {
  const teammates = useApp((s) => s.teammates);
  const messages = useApp((s) => s.messages);
  const members = useApp((s) => s.members);
  const mergeQueue = useApp((s) => s.mergeQueue);
  const solo = useApp(isSolo);
  const setActive = useApp((s) => s.setActive);
  const setRailTab = useApp((s) => s.setRailTab);
  const setView = useApp((s) => s.setView);
  const setMergePilotOpen = useApp((s) => s.setMergePilotOpen);
  const respondProposal = useApp((s) => s.respondProposal);
  const toast = useApp((s) => s.toast);

  const me = members[0]?.id;
  const nameOf = (id: string) => teammates.find((t) => t.id === id)?.name ?? id;

  const attn = attentionSessions(teammates);
  const blocking = messages.filter((m) => !m.answered && m.kind === "blocking" && (m.to === me || m.to === "all"));
  const questions = messages.filter((m) => !m.answered && m.kind === "question" && (m.to === me || m.to === "all"));
  const proposals = messages.filter((m) => !m.answered && m.kind === "proposal" && m.from !== me);
  // merge turn only counts with a real multi-person queue — a solo user (or a
  // queue of one) is never nagged that it's their turn.
  const myTurn = !solo && mergeQueue.length > 1 && mergeQueue[0] === me;

  const count = attn.length + blocking.length + questions.length + proposals.length + (myTurn ? 1 : 0);

  return (
    <section
      className={`glass rounded-lg p-5 border-l-2 ${count > 0 ? "border-l-accent" : "border-l-ok"}`}
    >
      <div className="flex items-baseline gap-3 mb-3">
        {count > 0 ? (
          <span className="status-dot needs-input" aria-hidden />
        ) : (
          <Icon name="check" size={14} className="text-ok" />
        )}
        <span className="font-display font-semibold text-[15px]">
          {count === 0 ? "All clear" : `Needs you · ${count}`}
        </span>
        <span className="text-faint text-[11px]">
          {count === 0 ? "nothing is waiting on a decision from you" : "resolve these to unblock the team"}
        </span>
      </div>

      {count === 0 ? (
        <div className="text-dim text-[12px] leading-relaxed">
          When a session needs input, a teammate is blocked, or it's your merge turn,
          it lands here first.
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {myTurn ? (
            <button
              className="flex items-center gap-3 px-4 py-2.5 bg-raised rounded-md text-left hover:brightness-110 transition-all cursor-pointer border-l-2 border-l-ok"
              onClick={() => setMergePilotOpen(true)}
            >
              <Icon name="merge" size={13} className="text-ok" />
              <span className="text-[12px]">Your merge turn — run the merge when ready</span>
              <span className="ml-auto text-faint text-[10px]">opens merge terminal</span>
            </button>
          ) : null}
          {attn.map((t) => (
            <button
              key={t.id}
              className="flex items-center gap-3 px-4 py-2.5 bg-raised rounded-md text-left hover:brightness-110 transition-all cursor-pointer border-l-2 border-l-warn"
              onClick={() => setActive(t.id)}
            >
              <span className={`status-dot ${t.status}`} aria-hidden />
              <span className="text-[12px]">
                <b>{t.name}</b>
                {t.status === "needs-input"
                  ? "'s session is waiting on a decision"
                  : t.health === "disconnected"
                    ? "'s session disconnected — restart it"
                    : "'s session has gone quiet"}
              </span>
              <span className="ml-auto text-faint text-[10px]">open session</span>
            </button>
          ))}
          {blocking.map((m) => (
            <button
              key={m.id}
              className="flex items-center gap-3 px-4 py-2.5 bg-raised rounded-md text-left hover:brightness-110 transition-all cursor-pointer border-l-2 border-l-danger"
              title={m.text}
              onClick={() => { setRailTab("inbox"); setView("session"); }}
            >
              <Icon name="warn" size={12} className="text-danger" />
              <span className="text-[12px]"><b>{nameOf(m.from)}</b> is blocked: {clip(m.text, 70)}</span>
              <span className="ml-auto text-faint text-[10px]">reply</span>
            </button>
          ))}
          {proposals.map((m) => (
            <div key={m.id} className="flex items-center gap-3 px-4 py-2.5 bg-raised rounded-md border-l-2 border-l-accent" title={m.text}>
              <Icon name="mail" size={12} className="text-accent" />
              <span className="text-[12px] flex-1"><b>{nameOf(m.from)}</b> proposes: {clip(m.text, 56)}</span>
              <button className="btn" onClick={() => { respondProposal(m.id, "yes"); toast("Answered yes"); }}>yes</button>
              <button className="btn" onClick={() => { respondProposal(m.id, "no"); toast("Answered no"); }}>no</button>
              <button className="btn" onClick={() => respondProposal(m.id, "unsure")}>unsure</button>
            </div>
          ))}
          {questions.map((m) => (
            <button
              key={m.id}
              className="flex items-center gap-3 px-4 py-2.5 bg-raised rounded-md text-left hover:brightness-110 transition-all cursor-pointer border-l-2 border-l-warn"
              title={m.text}
              onClick={() => { setRailTab("inbox"); setView("session"); }}
            >
              <Icon name="mail" size={12} className="text-warn" />
              <span className="text-[12px]"><b>{nameOf(m.from)}</b> asks: {clip(m.text, 70)}</span>
              <span className="ml-auto text-faint text-[10px]">reply</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// 2. TEAM PULSE — a live strip per real member: dot, name, current file,
// last-hour sparkline, and live cpu/tokens.
// ---------------------------------------------------------------------------
function TeamPulse() {
  const teammates = useApp((s) => s.teammates);
  const members = useApp((s) => s.members);
  const resources = useApp((s) => s.resources);
  const setActive = useApp((s) => s.setActive);

  // real members only when config is loaded; fall back to the fake seed in
  // browser dev so the strip is still browsable without a backend.
  const rows: Teammate[] =
    members.length > 0
      ? members.map((m) => teammates.find((t) => t.id === m.id)).filter((t): t is Teammate => !!t)
      : teammates;

  return (
    <section>
      <div className="panel-label mb-2">team pulse</div>
      <div className="glass rounded-lg divide-y divide-line/60">
        {rows.map((t) => {
          const res = resources[ptyIdFor(t.id)] ?? resources[t.id];
          const active = t.status === "working" || (res && res.cpu >= 3);
          return (
            <button
              key={t.id}
              className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-raised/50 transition-colors cursor-pointer first:rounded-t-lg last:rounded-b-lg"
              onClick={() => setActive(t.id)}
            >
              <span className={`status-dot ${t.status}`} aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-[12px] font-semibold">{t.name}</span>
                  {t.currentFile && t.currentFile !== "—" ? (
                    <span className="font-mono text-[10px] text-faint truncate" title={t.currentFile}>
                      {t.currentFile.split("/").pop()}
                    </span>
                  ) : null}
                </div>
                <div className="text-[10px] text-dim truncate">{activitySentence(t)}</div>
              </div>
              <div className="flex-none"><Sparkline id={t.id} /></div>
              <div className="flex-none text-right min-w-[52px]">
                {active && res && res.cpu >= 3 ? (
                  <div className="font-mono text-[10px] text-data num">{res.cpu.toFixed(0)}% cpu</div>
                ) : null}
                {active && t.usage.tokens ? (
                  <div className="font-mono text-[10px] text-data num">{fmtTokens(t.usage.tokens.output)} out</div>
                ) : null}
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 3. TODAY — hero stat band. Big tabular numbers; cyan for data, green done.
// No fabricated trends: there is no historical baseline, so numbers stand alone.
// ---------------------------------------------------------------------------
function TodayBand() {
  const commitsToday = useApp((s) => s.activity.filter((a) => a.kind === "commit").length);
  const doneTasks = useApp((s) => s.tasks.filter((t) => t.status === "done").length);
  const spent = useApp((s) => tokenBudget(s.teammates).spent);
  const [audit, setAudit] = useState(0);

  useEffect(() => {
    if (!isTauri()) return;
    let live = true;
    const load = async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      const lines = await invoke<string[]>("audit_tail", { member: null }).catch(() => [] as string[]);
      if (live) setAudit(lines.length);
    };
    load();
    const t = setInterval(load, 30_000);
    return () => { live = false; clearInterval(t); };
  }, []);

  return (
    <section>
      <div className="panel-label mb-2">today</div>
      <div className="grid grid-cols-2 gap-2">
        <div className="glass rounded-md px-3 py-3">
          <TickNumber value={commitsToday} className="block text-[22px] font-display font-bold text-data" />
          <div className="text-faint text-[10px] mt-0.5">commits in feed</div>
        </div>
        <div className="glass rounded-md px-3 py-3">
          <TickNumber value={doneTasks} className="block text-[22px] font-display font-bold text-ok" />
          <div className="text-faint text-[10px] mt-0.5">tasks done</div>
        </div>
        <div className="glass rounded-md px-3 py-3">
          <span className="block text-[22px] font-display font-bold text-data num">{fmtTokens(spent)}</span>
          <div className="text-faint text-[10px] mt-0.5">tokens spent</div>
        </div>
        <div className="glass rounded-md px-3 py-3">
          <TickNumber value={audit} className="block text-[22px] font-display font-bold text-data" />
          <div className="text-faint text-[10px] mt-0.5">tool calls audited</div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 4. TOKEN BUDGET METER — team-wide spend vs a soft cap. Cyan until it nears
// the cap, then amber. Calls out the biggest spender. Hidden with no real data.
// ---------------------------------------------------------------------------
function TokenMeter() {
  const teammates = useApp((s) => s.teammates);
  const showTop = useApp((s) => surfaceVisible(s.appMode, "team-pulse"));
  const cap = useApp((s) =>
    typeof s.appSettings.tokenBudget === "number" ? (s.appSettings.tokenBudget as number) : DEFAULT_TOKEN_BUDGET,
  );

  const budget = useMemo(() => tokenBudget(teammates, cap), [teammates, cap]);
  if (budget.spent === 0) return null; // no real token data yet — don't fake a meter

  const width = Math.min(100, budget.ratio * 100);
  return (
    <section>
      <div className="flex items-baseline justify-between mb-2">
        <span className="panel-label">token budget · soft</span>
        <span className="font-mono text-[10px] num text-dim">
          <span className={budget.near ? "text-accent" : "text-data"}>{fmtTokens(budget.spent)}</span>
          {" / "}{fmtTokens(budget.cap)}
        </span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden bg-line/50">
        <div
          className={`h-full rounded-full transition-all ${budget.near ? "bg-accent" : "bg-data"}`}
          style={{ width: `${width}%` }}
        />
      </div>
      {showTop && budget.top ? (
        <div className="text-faint text-[10px] mt-1.5">
          biggest spender: <span className="text-dim">{budget.top.name}</span>{" "}
          <span className="text-data num">{fmtTokens(budget.top.tokens)}</span>
        </div>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// 5. CONFLICT RADAR CHIPS — name-level branch overlap from git_conflict_radar.
// Only rendered when non-empty.
// ---------------------------------------------------------------------------
function ConflictChips() {
  const conflicts = useApp((s) => s.conflicts);
  const teammates = useApp((s) => s.teammates);
  const toast = useApp((s) => s.toast);
  if (conflicts.length === 0) return null;
  const nameOf = (id: string) => teammates.find((t) => t.id === id)?.name ?? id;

  return (
    <section>
      <div className="panel-label mb-2">conflict radar</div>
      <div className="flex flex-wrap gap-1.5">
        {conflicts.map((c) => (
          <button
            key={`${c.a}∧${c.b}`}
            className="tag warn cursor-pointer hover:brightness-110 transition-all"
            title={c.files.join("\n")}
            onClick={() => toast(`${nameOf(c.a)} ∧ ${nameOf(c.b)} both touch: ${c.files.join(", ")}`, "warn")}
          >
            {nameOf(c.a)} ∧ {nameOf(c.b)} · {c.files.length} file{c.files.length === 1 ? "" : "s"}
          </button>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 6. MERGE PIPELINE — the queue order as initials; head highlighted, you marked.
// Hidden solo / for a queue of one.
// ---------------------------------------------------------------------------
function MergePipeline() {
  const mergeQueue = useApp((s) => s.mergeQueue);
  const teammates = useApp((s) => s.teammates);
  const me = useApp((s) => s.members[0]?.id);
  const solo = useApp(isSolo);
  if (solo || mergeQueue.length <= 1) return null;

  const initialsOf = (id: string) =>
    teammates.find((t) => t.id === id)?.initials ?? id.slice(0, 2).toUpperCase();
  const nameOf = (id: string) => teammates.find((t) => t.id === id)?.name ?? id;

  return (
    <section>
      <div className="panel-label mb-2">merge queue</div>
      <div className="flex items-center gap-1.5 flex-wrap">
        {mergeQueue.map((id, i) => (
          <div key={id} className="flex items-center gap-1.5">
            {i > 0 ? <Icon name="chevron" size={11} className="text-faint" /> : null}
            <div className="flex flex-col items-center gap-0.5" title={`${nameOf(id)}${i === 0 ? " — merging now" : ` — position ${i + 1}`}`}>
              <span
                className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-semibold num border ${
                  i === 0 ? "border-accent text-accent bg-accent/10" : "border-line text-dim"
                }`}
              >
                {initialsOf(id)}
              </span>
              {id === me ? <span className="text-data text-[9px]">you</span> : null}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 7. LIVE ACTIVITY TICKER — one subtle line cycling the latest events.
// Pauses on hover; reduced-motion shows the single latest line, static.
// ---------------------------------------------------------------------------
function ActivityTicker() {
  const activity = useApp((s) => s.activity);
  const teammates = useApp((s) => s.teammates);
  const setRailTab = useApp((s) => s.setRailTab);
  const setView = useApp((s) => s.setView);
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const reduced = useRef(prefersReduced()).current;

  const lines = useMemo(() => {
    const nameOf = (id: string) => teammates.find((t) => t.id === id)?.name ?? id;
    return activity.slice(0, 8).map((e) => activityLine(e, nameOf));
  }, [activity, teammates]);

  useEffect(() => {
    if (reduced || paused || lines.length <= 1) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % lines.length), 4000);
    return () => clearInterval(t);
  }, [reduced, paused, lines.length]);

  if (lines.length === 0) return null;
  const line = reduced ? lines[0] : lines[idx % lines.length];

  return (
    <button
      className="flex items-center gap-2 text-[11px] text-dim overflow-hidden text-left w-full hover:text-ink transition-colors cursor-pointer"
      title="Open the full activity feed"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onClick={() => { setRailTab("activity"); setView("session"); }}
    >
      <Icon name="broadcast" size={12} className="text-faint flex-none" />
      <span className="truncate">{clip(line, 96)}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// 8. QUICK ACTIONS — icon tiles. One primary (ship) per the design law.
// ---------------------------------------------------------------------------
function QuickActions() {
  const appMode = useApp((s) => s.appMode);
  const setRailTab = useApp((s) => s.setRailTab);
  const setView = useApp((s) => s.setView);
  const shipSession = useApp((s) => s.shipSession);
  const setPickerOpen = useApp((s) => s.setPickerOpen);
  const showInbox = surfaceVisible(appMode, "rail-inbox-tab");

  const tile = "glass rounded-md px-3 py-3 flex flex-col items-start gap-1.5 cursor-pointer hover:brightness-110 transition-all text-left";

  return (
    <section>
      <div className="panel-label mb-2">do something</div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <button
          className={`${tile} bg-accent! text-accent-ink`}
          onClick={() => shipSession(useApp.getState().activeId)}
        >
          <Icon name="push" size={16} />
          <span className="text-[12px] font-semibold">review &amp; ship</span>
        </button>
        <button className={tile} onClick={() => { setRailTab("tasks"); setView("session"); }}>
          <Icon name="branch" size={16} className="text-data" />
          <span className="text-[12px]">task board</span>
        </button>
        {showInbox ? (
          <button className={tile} onClick={() => { setRailTab("inbox"); setView("session"); }}>
            <Icon name="mail" size={16} className="text-data" />
            <span className="text-[12px]">inbox</span>
          </button>
        ) : null}
        <button className={tile} onClick={() => setPickerOpen(true)}>
          <Icon name="folder" size={16} className="text-data" />
          <span className="text-[12px]">switch project</span>
        </button>
        <button className={tile} onClick={() => useApp.setState({ featureIndexOpen: true } as never)}>
          <Icon name="search" size={16} className="text-data" />
          <span className="text-[12px]">everything <span className="font-mono text-[10px] text-faint">⌘/</span></span>
        </button>
      </div>
    </section>
  );
}

/** Mission control: everything that needs you + team pulse, one screen. */
export function HomeDashboard() {
  const showPulse = useApp((s) => surfaceVisible(s.appMode, "team-pulse"));

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-[1080px] mx-auto flex flex-col gap-5">
        <NeedsYouHero />

        {showPulse ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
            <div className="flex flex-col gap-5">
              <TeamPulse />
              <ConflictChips />
              <MergePipeline />
            </div>
            <div className="flex flex-col gap-5">
              <TodayBand />
              <TokenMeter />
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            <TodayBand />
            <TokenMeter />
          </div>
        )}

        <ActivityTicker />
        <QuickActions />
      </div>
    </div>
  );
}
