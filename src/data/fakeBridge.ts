import type { BridgeState } from "../lib/bridge";

// Browser-dev sample bridge state (never used in Tauri): a few items in
// flight so the Flow view and bridge panel are browsable without a backend.
const now = Date.now();
export const FAKE_BRIDGE: BridgeState = {
  goal: "A shared window into every Claude Code session on the team",
  handoffs: [
    { id: "h-demo-1", ts: now - 6 * 60_000, status: "pending", kind: "handoff", session: "mei", sessionTitle: "Diff review",
      message: "Add a 'copy diagnostics' button to the review modal; reuse the Setup check report.", userExplanation: "One button that copies versions and checks for bug reports." },
    { id: "h-demo-2", ts: now - 40 * 60_000, status: "sent", kind: "handoff", session: "devon", sessionTitle: "Task board",
      message: "Show a done count on each column header.", userExplanation: "", deliveredAt: now - 38 * 60_000,
      result: { done: true, summary: "Added a done count to every column header and a test for it; tests pass." }, resultTs: now - 20 * 60_000 },
  ],
  plans: [
    { id: "p-demo-1", ts: now - 3 * 60_000, status: "pending", title: "Ship queue v2", decision: "Merge order follows tests, not arrival",
      tasks: [{ title: "Sort ready branches by test status" }, { title: "Block red branches" }, { title: "One-click merge all green" }] },
  ],
  questions: [
    { id: "q-demo-1", ts: now - 9 * 60_000, answered: false, from: "devon", fromTitle: "Task board", question: "Should done tasks auto-archive after a day, or stay until someone clears them?",
      draftStarted: now - 9 * 60_000, draftTs: now - 8 * 60_000,
      draft: "Keep them until someone clears them. The demo shows the board filling up, and auto-archive hides progress. Add a \"Clear done\" button instead — a default you can change later." },
  ],
  notes: [{ id: "n-demo-1", ts: now - 30 * 60_000, text: "Judges care about the live demo more than the slide deck", by: "Aryan" }],
  decisionProposals: [
    { id: "dp-demo-1", ts: now - 4 * 60_000, status: "pending", source: "Task board", text: "Done tasks stay on the board until someone clears them",
      quote: "ok, no auto-archive — keep them until cleared" },
    { id: "dp-demo-2", ts: now - 2 * 60_000, status: "pending", source: "Chat: ship queue", text: "Merge order follows test status, not arrival", quote: "yes, tests first" },
  ],
  actions: [
    { id: "a-demo-1", ts: now - 2 * 60_000, status: "pending", kind: "run_tests", session: "devon", sessionTitle: "Task board", args: {},
      reason: "Devon says the column counts are done — check nothing broke before the merge." },
    { id: "a-demo-2", ts: now - 70_000, status: "pending", kind: "restart_session", session: "mei", sessionTitle: "Diff review", args: {},
      reason: "It has printed the same error for 20 minutes and stopped responding." },
    { id: "a-demo-3", ts: now - 15 * 60_000, status: "done", kind: "open_preview", args: {}, reason: "",
      outcome: { ok: true, url: "http://localhost:5173", summary: "Dev server running at http://localhost:5173 — opened in Preview." }, outcomeTs: now - 14 * 60_000 },
  ],
};

/** Browser-dev drift warning (Flow shows it as a warning wire). */
export const FAKE_DRIFT = [
  { id: "drift-demo", ts: now - 60_000, a: "Diff review", b: "Task board",
    why: "Both are adding their own copy-to-clipboard helper with different toast behaviour.",
    suggestion: "Keep Diff review's helper in lib/ and have Task board import it." },
];

/** Browser-dev brain search corpus (the real search runs in Rust). */
export const FAKE_SEARCH = [
  { kind: "decision", title: "Merge order follows tests, not arrival", snippet: "Merge order follows tests, not arrival", ts: now - 50 * 60_000, source: "plan", ref: "d-demo" },
  { kind: "note", title: "Judges care about the live demo more than the slide deck", snippet: "Judges care about the live demo more than the slide deck", ts: now - 30 * 60_000, source: "Aryan", ref: "n-demo-1" },
  { kind: "commit", title: "feat(board): done count on column headers", snippet: "feat(board): done count on column headers", ts: now - 22 * 60_000, source: "Task board", ref: "devon:a1b2c3d" },
  { kind: "turn", title: "Show a done count on each column header.", snippet: "Show a done count on each column header. — Added a done count to every column header and a test for it.", ts: now - 38 * 60_000, source: "Task board", ref: "devon:3" },
];
