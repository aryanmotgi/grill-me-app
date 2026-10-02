// ---------------------------------------------------------------------------
// Coding DNA (nav rail → DNA): everything Grill Me knows about how you build,
// by strand. Every item can be edited or deleted; deleted patterns stay
// muted. Pause learning, export / import one file, open it, or forget it all.
// "Build from my past" reads opt-in sources on this Mac and lets you review
// what it found before anything is kept.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from "react";
import { useApp } from "../store";
import { Icon } from "./Icon";
import { useDNA } from "../lib/dnaStore";
import {
  FLOW_STAGES, STRANDS, addItem, applyPast, dnaOf, editItem, mergeDNA, muteCandidates, pastCandidates, removeItem, setPainStatus, setRule, strandView,
  type Candidate, type CodingDNA, type FlowStage, type PastResults, type PastSource, type Strand, type View,
} from "../lib/dna";

const native = () => "__TAURI_INTERNALS__" in window;
async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}
const STAGE: Record<FlowStage, string> = { idea: "Idea", plan: "Plan", build: "Build", test: "Test", review: "Review", ship: "Ship" };
const SOURCE: Record<string, string> = { you: "You", scan: "Scan", sessions: "Sessions", spark: "Spark", past: "Your past" };
const ago = (ms: number) => {
  if (!ms) return "";
  const m = Math.round((Date.now() - ms) / 60_000);
  return m < 1 ? "just now" : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
};

export function DNAPage() {
  const { dna, load, update, replace, learnNow, forget, learning, lastLearned } = useDNA();
  const toast = useApp((s) => s.toast);
  const [strand, setStrand] = useState<Strand>("flow");
  const [pastOpen, setPastOpen] = useState(false);
  const [confirmForget, setConfirmForget] = useState(false);
  const [importing, setImporting] = useState<CodingDNA | null>(null);
  useEffect(() => { void load(); }, [load]);
  if (!dna) return <div className="flex-1" />;

  const counts = Object.fromEntries(STRANDS.map((s) => [s.id, strandView(dna, s.id).length])) as Record<Strand, number>;
  const empty = STRANDS.every((s) => counts[s.id] === 0);

  const exportDNA = async () => {
    if (!native()) return;
    const { save } = await import("@tauri-apps/plugin-dialog");
    const path = await save({ defaultPath: `coding-dna-${new Date().toISOString().slice(0, 10)}.json`, filters: [{ name: "Coding DNA", extensions: ["json"] }] });
    if (!path) return;
    await invoke("dna_export", { path, json: JSON.stringify(dna, null, 2) }).then(() => toast("Exported your Coding DNA")).catch((e) => toast(`${e}`, "warn"));
  };
  const importDNA = async () => {
    if (!native()) return;
    const { open } = await import("@tauri-apps/plugin-dialog");
    const path = await open({ multiple: false, filters: [{ name: "Coding DNA", extensions: ["json"] }] });
    if (typeof path !== "string") return;
    const raw = await invoke<unknown>("dna_import_read", { path }).catch((e) => { toast(`${e}`, "warn"); return null; });
    const d = dnaOf(raw);
    if (!d) { if (raw) toast("That file isn't a Coding DNA export", "warn"); return; }
    setImporting(d);
  };

  return (
    <div className="@container flex-1 min-h-0 overflow-y-auto">
      <div className="max-w-[860px] mx-auto px-4 @2xl:px-6 py-6 @2xl:py-8 flex flex-col gap-5 select-text">
        <div className="flex items-start gap-3 flex-wrap">
          <div className="flex-1 min-w-[260px]">
            <div className="text-[11px] tracking-[0.12em] uppercase text-faint">Coding DNA</div>
            <h1 className="text-[22px] font-semibold text-ink mt-1">How you build</h1>
            <p className="text-[12.5px] text-faint mt-1">
              What Grill Me knows about how you work. It keeps learning from your sessions (counts and patterns, never your prompts or code) and stays on this Mac.
            </p>
            <p className="text-[12px] text-faint mt-1">
              {dna.paused ? "Learning is paused." : learning ? "Learning…" : lastLearned ? `Last learned ${ago(lastLearned)}.` : dna.updated ? `Updated ${ago(dna.updated)}.` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button className="composer-btn" onClick={() => setPastOpen(true)}><Icon name="spark" size={11} /> Build from my past</button>
            <button className="composer-btn" disabled={learning || dna.paused} onClick={() => void learnNow()}>{learning ? <span className="spinner" /> : null} Learn now</button>
            <label className="composer-btn cursor-pointer" title="While paused, nothing is learned from your sessions or your past">
              <input type="checkbox" className="accent-(--accent)" checked={!!dna.paused} onChange={(e) => update((d) => ({ ...d, paused: e.target.checked || undefined, updated: Date.now() }))} />
              Pause learning
            </label>
          </div>
        </div>

        {empty ? (
          <div className="composer-card rounded-xl px-4 py-4 text-[13px] text-dim">
            Nothing yet. Finish setup's questions, or <button className="text-accent underline" onClick={() => setPastOpen(true)}>build it from your past</button>, and it fills in as you work.
          </div>
        ) : null}

        <div className="flex gap-1.5 flex-wrap" role="tablist">
          {STRANDS.map((s) => (
            <button key={s.id} role="tab" aria-selected={strand === s.id}
              className={`px-3 h-8 rounded-full text-[12.5px] border ${strand === s.id ? "border-accent/70 text-ink bg-accent/10" : "border-line text-dim hover:text-ink"}`}
              onClick={() => setStrand(s.id)}>
              {s.name} <span className="num text-faint">{counts[s.id] || ""}</span>
            </button>
          ))}
        </div>
        <StrandList dna={dna} strand={strand} update={update} />

        <div className="flex items-center gap-2 flex-wrap border-t border-line pt-4 text-[12px]">
          <button className="composer-btn" onClick={() => void exportDNA()}><Icon name="download" size={11} /> Export</button>
          <button className="composer-btn" onClick={() => void importDNA()}><Icon name="upload" size={11} /> Import</button>
          <button className="composer-btn" onClick={() => void invoke("dna_reveal").catch(() => {})}><Icon name="folder" size={11} /> Show the file</button>
          <span className="flex-1" />
          {confirmForget ? (
            <span className="flex items-center gap-2">
              <span className="text-warn">Delete all of it, including what it learned?</span>
              <button className="composer-btn" onClick={() => setConfirmForget(false)}>Keep it</button>
              <button className="composer-btn text-warn" onClick={() => { void forget().then(() => toast("Forgot your Coding DNA")); setConfirmForget(false); }}>Forget everything</button>
            </span>
          ) : (
            <button className="text-faint hover:text-warn" onClick={() => setConfirmForget(true)}>Forget everything…</button>
          )}
        </div>

        {importing ? (
          <div className="composer-card rounded-xl px-4 py-3 flex items-center gap-3 flex-wrap">
            <span className="flex-1 text-[13px]">Import this Coding DNA? <span className="text-faint">Merge adds what you don't have; Replace swaps yours for it.</span></span>
            <button className="composer-btn" onClick={() => setImporting(null)}>Cancel</button>
            <button className="composer-btn" onClick={() => { replace(mergeDNA(dna, importing)); setImporting(null); toast("Merged"); }}>Merge</button>
            <button className="composer-btn" onClick={() => { replace(importing); setImporting(null); toast("Replaced"); }}>Replace</button>
          </div>
        ) : null}
      </div>
      {pastOpen ? <PastPanel onClose={() => setPastOpen(false)} /> : null}
    </div>
  );
}

// -- one strand ----------------------------------------------------------------------

function StrandList({ dna, strand, update }: { dna: CodingDNA; strand: Strand; update: (fn: (d: CodingDNA) => CodingDNA) => void }) {
  const info = STRANDS.find((s) => s.id === strand)!;
  const views = strandView(dna, strand);
  const [adding, setAdding] = useState("");
  const [stage, setStage] = useState<FlowStage>("build");
  const projects = useApp((s) => s.projects);
  const canAdd = strand !== "toolkit";
  const add = () => {
    if (!adding.trim() || !canAdd) return;
    update((d) => addItem(d, strand as "flow" | "habits" | "pains" | "rules" | "wins", adding, { stage }));
    setAdding("");
  };
  const groups: [string, View[]][] = strand === "flow"
    ? [...FLOW_STAGES.map((s): [string, View[]] => [STAGE[s], views.filter((v) => v.stage === s)]), ["Noticed", views.filter((v) => !v.stage)]]
    : strand === "rules"
      ? [["Proposed: approve or dismiss", views.filter((v) => v.rule?.status === "proposed")], ["Your rules", views.filter((v) => v.rule?.status === "active")], ["Noticed", views.filter((v) => !v.rule)]]
      : [["", views]];
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12.5px] text-faint -mt-2">{info.what}.{strand === "rules" ? " Personal rules apply everywhere; project rules only in that project." : ""}</p>
      {groups.filter(([, xs]) => xs.length).map(([title, xs]) => (
        <div key={title} className="composer-card rounded-xl px-2 py-2 flex flex-col">
          {title ? <div className="text-[11px] tracking-[0.1em] uppercase text-faint px-2 pt-1 pb-1.5">{title}</div> : null}
          {xs.map((v) => <Row key={`${v.kind}:${v.id}`} v={v} strand={strand} update={update} projects={projects.map((p) => p.name)} />)}
        </div>
      ))}
      {!views.length ? <div className="text-[13px] text-faint px-1">Nothing here yet.</div> : null}
      {canAdd ? (
        <div className="flex items-center gap-2">
          {strand === "flow" ? (
            <select className="composer-btn" value={stage} onChange={(e) => setStage(e.target.value as FlowStage)} aria-label="Stage">
              {FLOW_STAGES.map((s) => <option key={s} value={s}>{STAGE[s]}</option>)}
            </select>
          ) : null}
          <input value={adding} onChange={(e) => setAdding(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} maxLength={300}
            placeholder={strand === "rules" ? "Add a rule, e.g. “Use pnpm, never npm”" : strand === "pains" ? "Add something that slows you down" : strand === "wins" ? "Add something that got better" : "Add something about how you work"}
            className="flex-1 bg-transparent border border-line rounded-lg px-3 h-9 text-[13px] outline-none focus:border-accent/70" />
          <button className="composer-btn" disabled={!adding.trim()} onClick={add}>Add</button>
        </div>
      ) : null}
    </div>
  );
}

function Row({ v, strand, update, projects }: { v: View; strand: Strand; update: (fn: (d: CodingDNA) => CodingDNA) => void; projects: string[] }) {
  const [editing, setEditing] = useState<string | null>(null);
  const where = { strand, id: v.id, stage: v.stage, kind: v.kind };
  const save = () => { if (editing !== null) update((d) => editItem(d, where, editing)); setEditing(null); };
  const editable = v.kind !== "moment" && strand !== "toolkit";
  return (
    <div className="group flex items-start gap-2 px-2 py-1.5 rounded-lg hover:bg-white/[0.03]">
      <div className="flex-1 min-w-0">
        {editing !== null ? (
          <input autoFocus value={editing} maxLength={300} onChange={(e) => setEditing(e.target.value)} onBlur={save}
            onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(null); }}
            className="w-full bg-transparent border border-accent/60 rounded px-2 py-0.5 text-[13.5px] outline-none" />
        ) : (
          <button className={`text-left text-[13.5px] ${v.tool?.removed ? "text-faint line-through" : "text-ink"} ${editable ? "cursor-text" : "cursor-default"}`}
            onClick={() => editable && setEditing(v.text)}>{v.text}</button>
        )}
        <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-faint flex-wrap">
          <span className="px-1.5 rounded border border-line">{v.kind === "learned" ? "Noticed" : v.kind === "moment" ? "Struggle" : SOURCE[v.source] ?? v.source}</span>
          {v.detail ? <span className="truncate max-w-[420px]">{v.detail}</span> : null}
          {v.rule ? (
            <select className="bg-transparent text-faint hover:text-ink" value={v.rule.scope === "project" ? v.rule.project ?? "" : ""} aria-label="Applies to"
              onChange={(e) => update((d) => setRule(d, v.id, e.target.value ? { scope: "project", project: e.target.value } : { scope: "personal", project: undefined }))}>
              <option value="">Personal · every project</option>
              {[...new Set([...projects, ...(v.rule.project ? [v.rule.project] : [])])].map((p) => <option key={p} value={p}>Project · {p}</option>)}
            </select>
          ) : null}
          {v.rule?.inFile ? <span>already in {v.rule.inFile}</span> : null}
          {v.pain ? (
            <select className="bg-transparent text-faint hover:text-ink" value={v.pain.status} aria-label="Status"
              onChange={(e) => update((d) => setPainStatus(d, v.id, e.target.value as "open" | "better" | "solved"))}>
              <option value="open">Still a problem</option><option value="better">Getting better</option><option value="solved">Solved</option>
            </select>
          ) : null}
        </div>
      </div>
      {v.rule?.status === "proposed" ? (
        <button className="composer-btn" onClick={() => update((d) => setRule(d, v.id, { status: "active" }))}>Approve</button>
      ) : null}
      <button className="opacity-40 group-hover:opacity-100 text-faint hover:text-warn px-1" aria-label={v.rule?.status === "proposed" ? "Dismiss" : "Delete"}
        title={v.kind === "learned" ? "Delete (it won't come back)" : "Delete"} onClick={() => update((d) => removeItem(d, { strand, id: v.id, stage: v.stage, kind: v.kind }))}>✕</button>
    </div>
  );
}

// -- build from your past ------------------------------------------------------------

const PAST: { id: PastSource; name: string; what: string }[] = [
  { id: "claude", name: "Past Claude Code sessions", what: "How you prompt, which skills, MCPs and models you use, where tests fail. Counts only, never your prompts." },
  { id: "codex", name: "Past Codex sessions", what: "The same, from Codex's saved sessions." },
  { id: "git", name: "Git history", what: "How often and how big you commit, commit style, AI co-authors, reverts, tests, branch names. No commit messages kept." },
  { id: "rules", name: "Rules you already wrote", what: "Short rule lines from CLAUDE.md, AGENTS.md, GEMINI.md, Cursor rules and Copilot instructions." },
  { id: "tools", name: "Tools you installed and removed", what: "brew / npm / pipx / MCP / plugin installs in your shell history: tool names only." },
  { id: "terminal", name: "Terminal commands", what: "Which commands you run most: first word only (git, npm, claude…)." },
];

function PastPanel({ onClose }: { onClose: () => void }) {
  const { dna, update } = useDNA();
  const projects = useApp((s) => s.projects);
  const toast = useApp((s) => s.toast);
  const [on, setOn] = useState<Record<PastSource, boolean>>({ claude: false, codex: false, git: false, rules: false, tools: false, terminal: false });
  const [repos, setRepos] = useState<string[]>([]);
  const [pickRepos, setPickRepos] = useState<Record<string, boolean>>({});
  const [phase, setPhase] = useState<"choose" | "reading" | "review">("choose");
  const [results, setResults] = useState<PastResults>({});
  const [cands, setCands] = useState<Candidate[]>([]);
  const [keep, setKeep] = useState<Record<string, boolean>>({});
  useEffect(() => {
    const mine = projects.map((p) => p.path).filter((p) => p.startsWith("/"));
    const set = (found: string[]) => {
      const all = [...new Set([...mine, ...found])];
      setRepos(all);
      setPickRepos(Object.fromEntries(all.map((r) => [r, mine.includes(r)])));
    };
    if (native()) void invoke<string[]>("past_find_repos").then(set).catch(() => set([])); else set([]);
  }, [projects]);
  const chosen = PAST.filter((p) => on[p.id]).map((p) => p.id);
  const chosenRepos = repos.filter((r) => pickRepos[r]);

  const read = async () => {
    if (!dna || !native()) return;
    setPhase("reading");
    const r: PastResults = {};
    const jobs: Promise<void>[] = [];
    if (on.claude) jobs.push(invoke<PastResults["claude"]>("past_claude", { months: 6 }).then((x) => { r.claude = x; }));
    if (on.codex) jobs.push(invoke<PastResults["codex"]>("past_codex", { months: 6 }).then((x) => { r.codex = x; }));
    if (on.git) jobs.push(invoke<PastResults["git"]>("past_git", { repos: chosenRepos }).then((x) => { r.git = x; }));
    if (on.rules) jobs.push(invoke<PastResults["rules"]>("past_rules", { repos: chosenRepos }).then((x) => { r.rules = x; }));
    if (on.tools) jobs.push(invoke<PastResults["tools"]>("past_tools").then((x) => { r.tools = x; }));
    if (on.terminal) jobs.push(invoke<PastResults["terminal"]>("past_terminal").then((x) => { r.terminal = x; }));
    await Promise.all(jobs.map((j) => j.catch((e) => toast(`${e}`, "warn"))));
    const cs = pastCandidates(r, dna);
    setResults(r); setCands(cs); setKeep(Object.fromEntries(cs.map((c) => [c.id, true]))); setPhase("review");
  };
  const apply = () => {
    const picked = cands.filter((c) => keep[c.id]);
    const dropped = cands.filter((c) => !keep[c.id]).map((c) => c.id);
    update((d) => muteCandidates(applyPast(d, picked, results, chosen), dropped));
    toast(`Added ${picked.length} to your Coding DNA`);
    onClose();
  };
  const byStrand = useMemo(() => STRANDS.map((s) => [s, cands.filter((c) => c.strand === s.id)] as const).filter(([, xs]) => xs.length), [cands]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={onClose}>
      <div className="composer-card rounded-2xl w-full max-w-[680px] max-h-[86vh] overflow-y-auto p-5 flex flex-col gap-4" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Build from my past">
        <div>
          <h2 className="text-[17px] font-semibold text-ink">Build your Coding DNA from your past</h2>
          <p className="text-[12.5px] text-faint mt-1">Pick what Grill Me may read. It reads on this Mac, keeps patterns (never code or full prompts), and shows you everything before saving.</p>
        </div>
        {phase === "choose" ? (
          <>
            <div className="flex flex-col gap-2">
              {PAST.map((p) => (
                <label key={p.id} className="flex items-start gap-3 cursor-pointer">
                  <input type="checkbox" className="accent-(--accent) mt-1" checked={on[p.id]} onChange={(e) => setOn({ ...on, [p.id]: e.target.checked })} />
                  <span><span className="block text-[13.5px] text-ink">{p.name}{dna?.past[p.id] ? <span className="text-faint text-[11.5px]"> · read {ago(dna.past[p.id]!)}</span> : null}</span><span className="block text-[12px] text-faint">{p.what}</span></span>
                </label>
              ))}
            </div>
            {(on.git || on.rules) && repos.length ? (
              <div className="border border-line rounded-lg p-3">
                <div className="text-[11px] tracking-[0.1em] uppercase text-faint mb-2">Which projects</div>
                <div className="flex flex-col gap-1 max-h-[160px] overflow-y-auto">
                  {repos.map((r) => (
                    <label key={r} className="flex items-center gap-2 text-[12.5px] cursor-pointer">
                      <input type="checkbox" className="accent-(--accent)" checked={!!pickRepos[r]} onChange={(e) => setPickRepos({ ...pickRepos, [r]: e.target.checked })} />
                      <span className="truncate">{r.replace(/^\/Users\/[^/]+/, "~")}</span>
                    </label>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="flex justify-end gap-2">
              <button className="composer-btn" onClick={onClose}>Cancel</button>
              <button className="composer-btn" disabled={!chosen.length || !native() || dna?.paused} onClick={() => void read()}>{dna?.paused ? "Learning is paused" : `Read ${chosen.length || ""} source${chosen.length === 1 ? "" : "s"}`}</button>
            </div>
          </>
        ) : phase === "reading" ? (
          <div className="flex items-center gap-3 text-[13px] text-dim py-6"><span className="spinner" /> Reading your past on this Mac…</div>
        ) : (
          <>
            {!cands.length ? <div className="text-[13px] text-faint">Nothing new found.</div> : null}
            {byStrand.map(([s, xs]) => (
              <div key={s.id}>
                <div className="text-[11px] tracking-[0.1em] uppercase text-faint mb-1.5">{s.name}</div>
                <div className="flex flex-col gap-1">
                  {xs.map((c) => (
                    <label key={c.id} className="flex items-start gap-2 cursor-pointer">
                      <input type="checkbox" className="accent-(--accent) mt-1" checked={!!keep[c.id]} onChange={(e) => setKeep({ ...keep, [c.id]: e.target.checked })} />
                      <span><span className="block text-[13px] text-ink">{c.text}</span>{c.detail ? <span className="block text-[11.5px] text-faint">{c.detail}</span> : null}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
            <div className="flex justify-end gap-2 sticky bottom-0 pt-2">
              <button className="composer-btn" onClick={onClose}>Cancel</button>
              <button className="composer-btn" disabled={!cands.some((c) => keep[c.id])} onClick={apply}>Keep {cands.filter((c) => keep[c.id]).length}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
