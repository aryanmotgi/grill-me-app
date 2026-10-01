import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../store";
import { groupResults, isWhyQuery, jumpFor, parseResults, type SearchResult } from "../lib/brainSearch";
import { pendingProposals } from "../lib/decisionSpot";
import { automationOn } from "../lib/automations";
import { usePaneJump } from "../lib/paneJump";
import { useBridge } from "./BridgePanel";
import { dismissProposal, saveProposal } from "./BrainWatch";
import { Icon } from "./Icon";

// ---------------------------------------------------------------------------
// Brain page, round 4: one search over everything the brain remembers (ranked
// in Rust), an on-demand "why…?" answer with cited results, and the decisions
// Claude spotted waiting on Save / Dismiss.
// ---------------------------------------------------------------------------

const native = () => "__TAURI_INTERNALS__" in window;

async function call<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

function ago(ms: number): string {
  if (!ms) return "";
  const m = Math.round((Date.now() - ms) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  if (m < 60 * 24) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
}

/** Browser dev: filter the sample corpus the same AND-of-words way. */
async function fakeSearch(q: string): Promise<SearchResult[]> {
  const { FAKE_SEARCH } = await import("../data/fakeBridge");
  const words = q.toLowerCase().split(/\s+/).filter((w) => w.length > 2 && !["why", "what", "when", "did", "the"].includes(w));
  return parseResults(FAKE_SEARCH.filter((r) => words.every((w) => `${r.title} ${r.snippet}`.toLowerCase().includes(w))));
}

/** "[3]" citations in Claude's answer → small highlighted refs. */
function Cited({ text }: { text: string }) {
  const parts = text.split(/(\[\d+(?:,\s*\d+)*\])/g);
  return <>{parts.map((p, i) => (/^\[\d/.test(p) ? <span key={i} className="text-data num">{p}</span> : p))}</>;
}

export function BrainSearch() {
  const toast = useApp((s) => s.toast);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<{ q: string; text: string } | null>(null);
  const [answering, setAnswering] = useState(false);
  const seq = useRef(0);

  // search as you type (debounced); stale replies are dropped
  useEffect(() => {
    const query = q.trim();
    if (!query) { setResults(null); return; }
    const mine = ++seq.current;
    const t = setTimeout(() => {
      setBusy(true);
      const run = native()
        ? call<unknown>("brain_search", { query, limit: 40 }).then(parseResults)
        : fakeSearch(query);
      void run
        .catch((e) => { toast(`Search failed: ${e}`, "warn"); return [] as SearchResult[]; })
        .then((r) => { if (mine === seq.current) setResults(r); })
        .finally(() => { if (mine === seq.current) setBusy(false); });
    }, 280);
    return () => clearTimeout(t);
  }, [q, toast]);

  const groups = useMemo(() => groupResults(results ?? []), [results]);

  const ask = async () => {
    if (!native()) { toast("Answer with Claude needs the native app", "warn"); return; }
    setAnswering(true);
    try {
      setAnswer({ q: q.trim(), text: await call<string>("brain_search_answer", { query: q.trim() }) });
    } catch (e) {
      toast(`Couldn't answer: ${e}`, "warn");
    } finally {
      setAnswering(false);
    }
  };

  const open = (r: SearchResult) => {
    const j = jumpFor(r);
    if (!j) return;
    if (j.to === "decisions") { useApp.setState({ decisionsOpen: true }); return; }
    const st = useApp.getState();
    if (!st.teammates.some((t) => t.id === j.id)) { toast("That session isn't in this project anymore", "warn"); return; }
    usePaneJump.getState().jump(j.id, j.tab);
    st.setActive(j.id);
    st.setView("session");
  };

  return (
    <div className="flex flex-col gap-3">
      <label className="composer-card rounded-xl px-3.5 h-11 flex items-center gap-2.5 focus-within:border-white/20">
        <Icon name="search" size={14} className="text-faint flex-none" />
        <input value={q} onChange={(e) => { setQ(e.target.value); setAnswer(null); }}
          onKeyDown={(e) => { if (e.key === "Escape") { setQ(""); setAnswer(null); } }}
          className="flex-1 min-w-0 bg-transparent outline-none text-[13.5px] text-ink placeholder:text-faint"
          placeholder="Search decisions, notes, commits, conversations… or ask “why did we…?”"
          aria-label="Search the brain" spellCheck={false} />
        {busy ? <span className="spinner flex-none" /> : q ? (
          <button className="text-faint hover:text-ink cursor-pointer flex-none" aria-label="Clear search" onClick={() => { setQ(""); setAnswer(null); }}>
            <Icon name="cross" size={11} />
          </button>
        ) : null}
      </label>

      {results !== null && q.trim() ? (
        <div className="flex flex-col gap-3">
          {isWhyQuery(q) && results.length ? (
            <div className="composer-card rounded-xl px-4 py-3 flex flex-col gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[12.5px] text-dim flex-1 min-w-[160px]">A question? Claude can answer it from these results.</span>
                <button className="composer-btn on" disabled={answering} onClick={() => void ask()}>
                  {answering ? <span className="spinner" /> : <Icon name="spark" size={11} />} Answer with Claude
                </button>
              </div>
              {answer && answer.q === q.trim() ? (
                <div className="text-[13px] leading-[1.6] text-ink select-text"><Cited text={answer.text} /></div>
              ) : null}
            </div>
          ) : null}
          {results.length === 0 ? (
            <div className="text-[12.5px] text-faint px-1">Nothing in the brain matches. Every word has to match — try fewer words, or "quote a phrase".</div>
          ) : groups.map((g) => (
            <div key={g.kind} className="flex flex-col gap-1">
              <div className="panel-label px-1">{g.label} · <span className="num">{g.items.length}</span></div>
              <div className="composer-card rounded-xl divide-y divide-line/60">
                {g.items.map((r) => {
                  const j = jumpFor(r);
                  const meta = [ago(r.ts), r.source].filter(Boolean).join(" · ");
                  return (
                    <button key={`${r.kind}-${r.n}`} disabled={!j}
                      className="w-full text-left px-3.5 py-2.5 flex flex-col @xl:flex-row @xl:items-baseline gap-0.5 @xl:gap-3 hover:enabled:bg-raised/50 cursor-pointer disabled:cursor-default first:rounded-t-xl last:rounded-b-xl"
                      onClick={() => open(r)}>
                      <span className="min-w-0 flex-1 flex flex-col gap-0.5">
                        <span className="text-[12.5px] text-ink leading-snug"><span className="text-faint num mr-1.5">#{r.n}</span>{r.title}</span>
                        {r.snippet && r.snippet !== r.title ? <span className="text-[11.5px] text-dim leading-snug line-clamp-2">{r.snippet}</span> : null}
                      </span>
                      {meta ? <span className="text-[11px] text-faint flex-none truncate @xl:max-w-[220px]">{meta}</span> : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Decisions Claude spotted in session turns and chats, waiting on Save / Dismiss. */
export function SpottedDecisions() {
  const state = useBridge((b) => b.state);
  const decisions = useApp((s) => s.decisions);
  const spotting = useApp((s) => automationOn(s.appSettings, "spot-decisions"));
  const pending = useMemo(() => pendingProposals(state, decisions), [state, decisions]);
  const [busy, setBusy] = useState("");
  if (!pending.length) return null;
  return (
    <div className="composer-card rounded-xl px-4 py-3 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Icon name="note" size={13} />
        <span className="text-[13px] font-semibold text-ink flex-1">Decision? <span className="font-normal text-faint num">· {pending.length} spotted</span></span>
        {!spotting ? <span className="text-[11px] text-faint">spotting is off</span> : null}
      </div>
      <ul className="flex flex-col divide-y divide-line/60">
        {pending.map((p) => (
          <li key={p.id} className="py-2 flex flex-col gap-1">
            <span className="text-[12.5px] text-ink leading-snug">{p.text}</span>
            <span className="text-[11px] text-faint">from {p.source}{p.quote ? <> · “{p.quote}”</> : null}</span>
            <span className="flex gap-2 pt-0.5">
              <button className="composer-btn on h-7 text-[11.5px]" disabled={busy === p.id}
                onClick={() => { setBusy(p.id); void saveProposal(p).finally(() => setBusy("")); }}>
                {busy === p.id ? <span className="spinner" /> : <Icon name="check" size={11} />} Save
              </button>
              <button className="composer-btn h-7 text-[11.5px]" onClick={() => void dismissProposal(p.id)}>Dismiss</button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
