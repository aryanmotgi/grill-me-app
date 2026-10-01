import { useEffect, useMemo, useState } from "react";
import { Icon } from "./Icon";
import { TickNumber } from "./TickNumber";
import { Sparkline } from "./SessionList";
import { attentionSessions, isSolo, ptyIdFor, useApp } from "../store";
import { openHelpRequests } from "../lib/help";
import { surfaceVisible } from "../lib/soloVisibility";
import { isTauri, predictConflict } from "../data/sources/git";
import type { ConflictPair, ConflictPrediction } from "../data/sources/git";
import { fmtTokens, fmtFullTime, fmtRelTime } from "../lib/format";
import { DEFAULT_TOKEN_BUDGET, tokenBudget, tokenBurn } from "../lib/dashboard";
import type { TokenBurn } from "../lib/dashboard";
import { budgetLevel, budgetPct, budgetWarning, rateLimitedSessions } from "../lib/ratelimit";
import type { ActivityEvent, Teammate } from "../types";
import { sessionSentence as activitySentence } from "../lib/flow";

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

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
  const resolveHelp = useApp((s) => s.resolveHelp);
  const toast = useApp((s) => s.toast);

  const me = members[0]?.id;
  const nameOf = (id: string) => teammates.find((t) => t.id === id)?.name ?? id;

  const attn = attentionSessions(teammates);
  // help requests get their own distinct surface — keep them out of the generic
  // blocking list so a flagged session shows once, with the "needs help" style.
  const helpReqs = openHelpRequests(messages);
  const blocking = messages.filter((m) => !m.answered && m.kind === "blocking" && !m.help && (m.to === me || m.to === "all"));
  const questions = messages.filter((m) => !m.answered && m.kind === "question" && (m.to === me || m.to === "all"));
  const proposals = messages.filter((m) => !m.answered && m.kind === "proposal" && m.from !== me);
  // merge turn only counts with a real multi-person queue — a solo user (or a
  // queue of one) is never nagged that it's their turn.
  const myTurn = !solo && mergeQueue.length > 1 && mergeQueue[0] === me;

  const count = attn.length + helpReqs.length + blocking.length + questions.length + proposals.length + (myTurn ? 1 : 0);

  return (
    <section
      data-tour="needs-you"
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
        <div className="flex flex-col gap-3">
          <div className="text-dim text-[12px] leading-relaxed">
            {solo
              ? "All quiet — nothing is waiting on you. Spin up a session or open the task board to line up the next thing."
              : "When a session needs input, a teammate is blocked, or it's your merge turn, it lands here first."}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              className="btn"
              onClick={() => useApp.setState({ sessionTemplatesOpen: true })}
            >
              <Icon name="plus" size={11} /> new session
            </button>
            <button
              className="btn"
              onClick={() => { setRailTab("tasks"); setView("session"); }}
            >
              <Icon name="branch" size={11} /> task board
            </button>
          </div>
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
          {helpReqs.map((m) => (
            <div
              key={m.id}
              className="flex items-center gap-3 px-4 py-2.5 bg-raised rounded-md border-l-2 border-l-warn"
              title={m.text}
            >
              <span className="status-dot needs-input" aria-hidden />
              <Icon name="help" size={12} className="text-warn flex-none" />
              <button
                className="text-[12px] text-left flex-1 min-w-0 truncate cursor-pointer hover:brightness-110"
                onClick={() => setActive(m.from)}
              >
                {clip(m.text, 72)}
              </button>
              <button className="btn" title="Clear the flag — a teammate has eyes on it now"
                onClick={() => resolveHelp(m.from)}>
                got help
              </button>
            </div>
          ))}
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
                  : t.flag === "looping"
                    ? "'s session looks stuck in a loop"
                    : t.flag === "stalled"
                      ? "'s session has stalled — no output for a while"
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
// 1b. RATE-LIMIT STRIP — team-wide callout when any session is currently
// rate-limited (429 / usage limit / overloaded). Danger-toned, names each
// session and its reset time when the screen shows one. Only rendered when a
// session is actually limited — reuses the pty feed's per-session flag, no new
// polling. Sessions ride out the limit on their own; this just surfaces it.
// ---------------------------------------------------------------------------
function RateLimitStrip() {
  const teammates = useApp((s) => s.teammates);
  const setActive = useApp((s) => s.setActive);
  const limited = useMemo(() => rateLimitedSessions(teammates), [teammates]);
  if (limited.length === 0) return null;

  return (
    <section className="glass rounded-lg p-4 border-l-2 border-l-danger">
      <div className="flex items-baseline gap-3 mb-2.5">
        <Icon name="warn" size={14} className="text-danger" />
        <span className="font-display font-semibold text-[13px]">
          {limited.length === 1 ? "1 session rate-limited" : `${limited.length} sessions rate-limited`}
        </span>
        <span className="text-faint text-[11px]">each waits and resumes on its own — no action needed</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {limited.map((r) => (
          <button
            key={r.id}
            className="tag danger cursor-pointer hover:brightness-110 transition-all"
            title={`Open ${r.name}'s session`}
            onClick={() => setActive(r.id)}
          >
            {r.name}
            {r.resetsAt ? <span className="text-dim"> · resets {r.resetsAt}</span> : null}
          </button>
        ))}
      </div>
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

// A compact bar chart of today's token burn — one bar per session, biggest
// first, heights scaled to the top spender. Cyan data color, no motion (heights
// are static). Purely decorative, so it's hidden from the a11y tree; the total
// TickNumber above it carries the number.
function BurnBars({ burn }: { burn: TokenBurn }) {
  const max = burn.max || 1;
  return (
    <div className="mt-2 flex items-end gap-0.5 h-6" aria-hidden>
      {burn.bars.map((b) => (
        <div
          key={b.id}
          className="flex-1 min-w-[3px] rounded-sm bg-data/80"
          style={{ height: `${Math.max(8, Math.round((b.tokens / max) * 100))}%` }}
          title={`${b.name} · ${fmtTokens(b.tokens)}`}
        />
      ))}
    </div>
  );
}

// The token-burn tile: total input+output across today's sessions as a live
// TickNumber, with the per-session breakdown charted below. Honest empty state
// when nothing has real token tallies yet — never a fabricated curve.
function TokenBurnTile() {
  const teammates = useApp((s) => s.teammates);
  const burn = useMemo(() => tokenBurn(teammates), [teammates]);

  if (burn.total === 0) {
    return (
      <div className="glass rounded-md px-3 py-3">
        <span className="block text-[22px] font-display font-bold text-faint num">—</span>
        <div className="text-faint text-[10px] mt-0.5">no token usage yet</div>
      </div>
    );
  }

  const label = burn.bars.length === 1 ? "1 session" : `${burn.bars.length} sessions`;
  return (
    <div className="glass rounded-md px-3 py-3">
      <TickNumber
        value={burn.total}
        format={fmtTokens}
        className="block text-[22px] font-display font-bold text-data"
      />
      <div className="text-faint text-[10px] mt-0.5">tokens spent · {label}</div>
      <BurnBars burn={burn} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3. TODAY — hero stat band. Big tabular numbers; cyan for data, green done.
// No fabricated trends: there is no historical baseline, so numbers stand alone.
// ---------------------------------------------------------------------------
function TodayBand() {
  const commitsToday = useApp((s) => s.activity.filter((a) => a.kind === "commit").length);
  const doneTasks = useApp((s) => s.tasks.filter((t) => t.status === "done").length);
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
        <TokenBurnTile />
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
  // 50/80/100 bands: cyan (calm/50), amber (80), danger (100+). The 50% band
  // is a visual-only nudge — it tints nothing, just names the level.
  const level = budgetLevel(budget.ratio);
  const warn = budgetWarning(level);
  const barColor = level >= 100 ? "bg-danger" : level >= 80 ? "bg-accent" : "bg-data";
  const amountColor = level >= 100 ? "text-danger" : level >= 80 ? "text-accent" : "text-data";
  return (
    <section>
      <div className="flex items-baseline justify-between mb-2">
        <span className="panel-label">token budget · soft</span>
        <span className="font-mono text-[10px] num text-dim">
          <span className={amountColor}>{fmtTokens(budget.spent)}</span>
          {" / "}{fmtTokens(budget.cap)}
          {" · "}<span className={amountColor}>{budgetPct(budget.ratio)}%</span>
        </span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden bg-line/50">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${width}%` }}
        />
      </div>
      {warn ? (
        <div className={`text-[10px] mt-1.5 flex items-center gap-1 ${level >= 80 ? amountColor : "text-dim"}`}>
          {level >= 80 ? <Icon name="warn" size={10} className="flex-none" /> : null}
          {warn}
        </div>
      ) : null}
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
  if (conflicts.length === 0) return null;
  const nameOf = (id: string) => teammates.find((t) => t.id === id)?.name ?? id;

  return (
    <section>
      <div className="panel-label mb-2">conflict radar</div>
      <div className="flex flex-wrap gap-1.5">
        {conflicts.map((c) => (
          <ConflictChip key={`${c.a}∧${c.b}`} pair={c} nameOf={nameOf} />
        ))}
      </div>
    </section>
  );
}

// One radar chip + its AI "predict" popover. Local state so each pair fetches
// independently; loading / error / claude-missing are all surfaced honestly.
type PredictState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "error"; message: string; missing: boolean }
  | { phase: "done"; prediction: ConflictPrediction };

// Likelihood → the two-accent palette. low is a success readout (ok/green),
// high is danger, medium reads as neutral cyan data. Never amber (not an action).
const LIKELIHOOD_STYLE: Record<ConflictPrediction["likelihood"], string> = {
  low: "text-ok border-ok/40",
  medium: "text-data border-data/40",
  high: "text-danger border-danger/50",
};

function ConflictChip({
  pair,
  nameOf,
}: {
  pair: ConflictPair;
  nameOf: (id: string) => string;
}) {
  const toast = useApp((s) => s.toast);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<PredictState>({ phase: "idle" });
  const label = `${nameOf(pair.a)} ∧ ${nameOf(pair.b)}`;

  const runPredict = async () => {
    setOpen(true);
    setState({ phase: "loading" });
    try {
      const prediction = await predictConflict(pair.a, pair.b);
      setState({ phase: "done", prediction });
    } catch (e) {
      const message = typeof e === "string" ? e : String(e);
      setState({ phase: "error", missing: /claude cli not found/i.test(message), message });
    }
  };

  return (
    <div className="relative">
      <div className="flex items-center gap-1">
        <button
          className="tag warn cursor-pointer hover:brightness-110 transition-all"
          title={pair.files.join("\n")}
          onClick={() =>
            toast(`${label} both touch: ${pair.files.join(", ")}`, "warn")
          }
        >
          {label} · {pair.files.length} file{pair.files.length === 1 ? "" : "s"}
        </button>
        <button
          className="tag cursor-pointer hover:text-data transition-colors"
          title="Ask claude whether these branches will actually conflict"
          onClick={() => (open ? setOpen(false) : runPredict())}
        >
          <Icon name="search" size={9} className="mr-0.5" />
          predict
        </button>
      </div>

      {open ? (
        <div className="glass rounded-md p-3 mt-1.5 w-72 max-w-[80vw] absolute z-30 rise shadow-2xl">
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className="panel-label">conflict prediction</span>
            <button
              className="ml-auto text-faint hover:text-dim transition-colors"
              onClick={() => setOpen(false)}
              title="Close"
            >
              <Icon name="cross" size={9} />
            </button>
          </div>
          <div className="text-[11px] text-dim mb-2">{label}</div>

          {state.phase === "loading" ? (
            <div className="text-[12px] text-data flex items-center gap-1.5">
              <span className="status-dot working" />
              asking claude…
            </div>
          ) : null}

          {state.phase === "error" ? (
            <div className="text-[12px]">
              {state.missing ? (
                <p className="text-dim">
                  claude CLI isn&apos;t installed. Install it and it&apos;ll work
                  here — no restart needed.
                </p>
              ) : (
                <p className="text-danger break-words">{state.message}</p>
              )}
              {!state.missing ? (
                <button
                  className="tag mt-2 cursor-pointer hover:text-data"
                  onClick={runPredict}
                >
                  retry
                </button>
              ) : null}
            </div>
          ) : null}

          {state.phase === "done" ? (
            <div className="flex flex-col gap-2">
              <span
                className={`tag self-start uppercase ${LIKELIHOOD_STYLE[state.prediction.likelihood]}`}
              >
                {state.prediction.likelihood} likelihood
              </span>
              {state.prediction.detail ? (
                <p className="text-[12px] text-dim leading-snug">
                  {state.prediction.detail}
                </p>
              ) : null}
              {state.prediction.recommendedOrder ? (
                <div className="text-[12px] leading-snug flex items-start gap-1.5">
                  <Icon
                    name="merge"
                    size={11}
                    className="text-data mt-0.5 flex-none"
                  />
                  <span className="text-dim">
                    {state.prediction.recommendedOrder}
                  </span>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
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
      <div className="flex items-center gap-2 mb-2">
        <div className="panel-label">merge queue</div>
        <button className="tag ml-auto cursor-pointer hover:text-data transition-colors"
          title="Walk the queue one branch at a time — predict conflicts, then merge each in turn"
          onClick={() => useApp.setState({ mergeConductorOpen: true })}>
          <Icon name="merge" size={9} className="mr-0.5" /> conduct
        </button>
      </div>
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
// 7. ACTIVITY FEED — a scrolling list of recent events (commits, merges,
// hand-offs, status) filling the empty lower-middle. Newest first, capped,
// icon + actor + relative time. Reuses store.activity (no extra polling) and
// works solo — it's just your own feed then. Honest empty state when quiet.
// ---------------------------------------------------------------------------
const FEED_LIMIT = 12;

const FEED_ICON: Record<ActivityEvent["kind"], string> = {
  commit: "commit",
  merge: "merge",
  message: "mail",
  status: "bellOff",
};

// Tone mirrors the timeline: merge reads as a win (ok), status as a nudge
// (warn), everything else stays a quiet cyan/faint metric — never amber.
const FEED_TONE: Record<ActivityEvent["kind"], string> = {
  commit: "text-faint",
  merge: "text-ok",
  message: "text-data",
  status: "text-warn",
};

function ActivityFeed() {
  const activity = useApp((s) => s.activity);
  const teammates = useApp((s) => s.teammates);
  const setRailTab = useApp((s) => s.setRailTab);
  const setView = useApp((s) => s.setView);

  const nameOf = (id: string) => teammates.find((t) => t.id === id)?.name ?? id;
  const recent = activity.slice(0, FEED_LIMIT);

  return (
    <section>
      <div className="flex items-baseline justify-between mb-2">
        <span className="panel-label">activity</span>
        {activity.length > FEED_LIMIT ? (
          <button
            className="text-faint text-[10px] hover:text-data transition-colors cursor-pointer"
            onClick={() => { setRailTab("activity"); setView("session"); }}
          >
            view all <span className="num">{activity.length}</span>
          </button>
        ) : null}
      </div>
      <div className="glass rounded-lg">
        {recent.length === 0 ? (
          <div className="px-3 py-4 text-dim text-[12px] leading-relaxed">
            Quiet for now. Commits, merges, and hand-offs land here as work happens.
          </div>
        ) : (
          <div className="max-h-64 overflow-y-auto divide-y divide-line/50">
            {recent.map((e) => (
              <div key={e.id} className="flex items-center gap-2.5 px-3 py-2">
                <span className={`flex-none ${FEED_TONE[e.kind]}`} aria-hidden>
                  <Icon name={FEED_ICON[e.kind]} size={11} />
                </span>
                <span className="text-accent text-[12px] font-semibold flex-none">{nameOf(e.actor)}</span>
                <span className="text-dim text-[12px] truncate flex-1" title={e.text}>{e.text}</span>
                <span
                  className="text-faint text-[10px] tabular-nums flex-none"
                  title={e.epochMs ? fmtFullTime(e.epochMs) : undefined}
                >
                  {e.epochMs ? fmtRelTime(e.epochMs) : e.ts}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 7b. RECENT DECISIONS — a subtle peek at the shared decisions log (what we
// decided and why), newest-first. Only rendered when non-empty, mirroring the
// conflict-radar / merge-pipeline pattern; the header opens the full overlay.
// ---------------------------------------------------------------------------
const DECISIONS_PEEK = 3;

function RecentDecisions() {
  const decisions = useApp((s) => s.decisions);
  const teammates = useApp((s) => s.teammates);
  if (decisions.length === 0) return null;

  const nameOf = (id: string) => teammates.find((t) => t.id === id)?.name ?? id;
  // decisions arrive already deduped + newest-first from setShared/addDecision.
  const recent = decisions.slice(0, DECISIONS_PEEK);

  return (
    <section>
      <div className="flex items-baseline justify-between mb-2">
        <span className="panel-label">decisions</span>
        <button
          className="text-faint text-[10px] hover:text-data transition-colors cursor-pointer"
          onClick={() => useApp.setState({ decisionsOpen: true })}
        >
          {decisions.length > DECISIONS_PEEK ? <>view all <span className="num">{decisions.length}</span></> : "open log"}
        </button>
      </div>
      <div className="glass rounded-lg divide-y divide-line/50">
        {recent.map((d) => (
          <button
            key={d.id}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-raised/50 transition-colors cursor-pointer first:rounded-t-lg last:rounded-b-lg"
            onClick={() => useApp.setState({ decisionsOpen: true })}
            title={d.text}
          >
            <Icon name="check" size={11} className="text-data flex-none" aria-hidden />
            <span className="text-dim text-[12px] truncate flex-1">{d.text}</span>
            {d.tag ? <span className="tag flex-none">{d.tag}</span> : null}
            <span className="text-accent text-[11px] font-semibold flex-none">{nameOf(d.author)}</span>
            <span className="text-faint text-[10px] tabular-nums flex-none" title={fmtFullTime(d.epochMs)}>
              {fmtRelTime(d.epochMs)}
            </span>
          </button>
        ))}
      </div>
    </section>
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
      <div className="grid grid-cols-2 @xl:grid-cols-4 gap-2">
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
    <div className="@container flex-1 overflow-y-auto p-6">
      <div className="max-w-[1080px] mx-auto flex flex-col gap-5">
        <NeedsYouHero />
        <RateLimitStrip />

        {showPulse ? (
          <div className="grid grid-cols-1 @4xl:grid-cols-2 gap-5 items-start">
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

        <ActivityFeed />
        <RecentDecisions />
        <QuickActions />
      </div>
    </div>
  );
}
