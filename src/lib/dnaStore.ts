// The app's copy of your Coding DNA: loads the file, saves changes (a moment
// after the last edit), and keeps learning while you work: on launch and
// every 15 minutes it folds new session counts and the latest scan in.
// Nothing here leaves this Mac.

import { create } from "zustand";
import { useEffect } from "react";
import { useApp } from "../store";
import { loadCatalog } from "./catalogLoad";
import { addItem, dnaOf, emptyDNA, fromProfile, fromScan, fromSessions, toMarkdown, type Batch, type CodingDNA } from "./dna";
import { toolsYouHave } from "./profile";
import type { ScanResult } from "./scan";

const native = () => "__TAURI_INTERNALS__" in window;
async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

interface DNAState {
  dna: CodingDNA | null;
  loaded: boolean;
  learning: boolean;
  lastLearned: number;
  load: () => Promise<CodingDNA>;
  update: (fn: (d: CodingDNA) => CodingDNA) => void;
  replace: (d: CodingDNA) => void;
  learnNow: () => Promise<void>;
  forget: () => Promise<void>;
}

/** The last scan saved by the Tools step (or a later rescan). */
const loadScan = () => invoke<ScanResult | null>("workflow_scan_read").catch(() => null);

let saveT = 0;
let loading: Promise<CodingDNA> | null = null;
function save(d: CodingDNA) {
  if (!native()) return;
  clearTimeout(saveT);
  saveT = window.setTimeout(() => { void invoke("dna_save", { json: JSON.stringify(d), markdown: toMarkdown(d) }).catch(() => {}); }, 500);
}

export const useDNA = create<DNAState>((set, get) => ({
  dna: null,
  loaded: false,
  learning: false,
  lastLearned: 0,
  load: async () => {
    const have = get().dna;
    if (have) return have;
    loading ??= (async () => {
      const raw = native() ? await invoke<unknown>("dna_load").catch(() => null) : null;
      const dna = dnaOf(raw) ?? (!native() && location.search.includes("dna-demo") ? demoDNA() : emptyDNA());
      set({ dna, loaded: true });
      return dna;
    })();
    return loading;
  },
  update: (fn) => {
    // never start from empty while the saved file is still loading
    if (!get().loaded) { void get().load().then(() => get().update(fn)); return; }
    const cur = get().dna ?? emptyDNA();
    const next = fn(cur);
    if (next === cur) return;
    set({ dna: next });
    save(next);
  },
  replace: (d) => { set({ dna: d }); save(d); },
  learnNow: async () => {
    if (!native() || get().learning) return;
    const dna = await get().load();
    if (dna.paused) return;
    set({ learning: true });
    try {
      const repos = useApp.getState().projects.map((p) => p.path).filter((p) => p.startsWith("/"));
      const [batch, scan, catalog] = await Promise.all([
        repos.length ? invoke<Batch>("learn_sessions", { repos }).catch(() => null) : Promise.resolve(null),
        loadScan().catch(() => null),
        loadCatalog().catch(() => null),
      ]);
      get().update((d) => {
        let next = d;
        if (scan && catalog) next = fromScan(next, scan, toolsYouHave(catalog, scan));
        if (batch) next = fromSessions(next, batch);
        return next;
      });
      set({ lastLearned: Date.now() });
    } finally { set({ learning: false }); }
  },
  forget: async () => {
    clearTimeout(saveT);
    if (native()) await invoke("dna_forget");
    set({ dna: emptyDNA(), loaded: true });
  },
}));

/** Keep learning while Grill Me is open (not during first-run setup). */
export function useDNALearning(active: boolean) {
  useEffect(() => {
    if (!active || !native()) return;
    const first = window.setTimeout(() => void useDNA.getState().learnNow(), 8000);
    const every = window.setInterval(() => void useDNA.getState().learnNow(), 15 * 60_000);
    return () => { clearTimeout(first); clearInterval(every); };
  }, [active]);
}

/** Browser preview only (?dna-demo): a believable DNA to look at. */
function demoDNA(): CodingDNA {
  const now = Date.now();
  let d = fromProfile(emptyDNA(now), {
    team: "solo", level: "senior", style: "plan-first", pains: ["testing", "review"], agents: ["claude"], source: "interview", updated: now,
    notes: [{ text: "Testcontainers Postgres tests flake about 1 in 10 runs", about: "testing" }, { text: "300-line diffs: I skim by line 150 and miss bugs", about: "review" }],
    summary: "You plan in a doc, let Claude Code build in small steps, and lose time to flaky Postgres tests and long reviews.",
  }, now);
  d = fromSessions(d, {
    sessions: 9, prompts: 120, promptWords: 1100, shortPrompts: 40, planPrompts: 3, questionPrompts: 10, fileRefPrompts: 4, frustratedPrompts: 12,
    testRuns: 40, testFails: 17, retries: 8, undos: 7, models: { "claude-opus-4-8": 900, "claude-haiku-4-5": 40 }, skills: { "superpowers:brainstorming": 9 },
    mcp: { context7: 6 }, slash: { review: 4 }, subagents: { Explore: 6 }, tools: {}, from: 0, to: 0,
    moments: [{ kind: "test-loop", detail: "`go test` failed 5 times in one session", at: Math.floor(now / 1000) - 86400, project: "api" }],
  }, now);
  d = addItem(d, "rules", "Never push directly to main.");
  d = addItem(d, "rules", "Use pnpm, not npm.", { scope: "project", project: "web" });
  d = addItem(d, "flow", "Sketch screens in Figma before building", { stage: "idea" });
  return d;
}
