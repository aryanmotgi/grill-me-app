import type { BridgeState } from "../lib/bridge";

// Browser-dev sample bridge state (never used in Tauri): a few items in
// flight so the Flow view and bridge panel are browsable without a backend.
const now = Date.now();
export const FAKE_BRIDGE: BridgeState = {
  goal: "A shared window into every Claude Code session on the team",
  handoffs: [
    { id: "h-demo-1", ts: now - 6 * 60_000, status: "pending", kind: "handoff", session: "mei", sessionTitle: "Diff review",
      message: "Add a 'copy diagnostics' button to the review modal; reuse the Setup check report.", userExplanation: "One button that copies versions and checks for bug reports." },
  ],
  plans: [
    { id: "p-demo-1", ts: now - 3 * 60_000, status: "pending", title: "Ship queue v2", decision: "Merge order follows tests, not arrival",
      tasks: [{ title: "Sort ready branches by test status" }, { title: "Block red branches" }, { title: "One-click merge all green" }] },
  ],
  questions: [
    { id: "q-demo-1", ts: now - 9 * 60_000, answered: false, from: "devon", fromTitle: "Task board", question: "Should done tasks auto-archive after a day, or stay until someone clears them?" },
  ],
  notes: [{ id: "n-demo-1", ts: now - 30 * 60_000, text: "Judges care about the live demo more than the slide deck", by: "Aryan" }],
};
