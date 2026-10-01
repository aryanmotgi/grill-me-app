import type { RoomState, TeamChatMsg, TeamSession } from "../types";

// Browser-dev only (never used under Tauri): a live team room with a few
// teammates, their session digests and some team chat, so the Team Chat
// panel, the Flow teammates section and the Team view are browsable
// without a backend. Loaded by the store's browser-dev branch.

const now = Date.now();
// presence reads "online" while now - lastSeen < 20s; the sample never ages
const ALWAYS = now + 10 * 365 * 86_400_000;

export const FAKE_ROOM: RoomState = {
  code: "K7M2P",
  phase: "done",
  members: [
    { id: "m1", name: "Aryan", isHost: true, lastSeen: ALWAYS, presence: { status: "working", task: "Team chat" } },
    { id: "m2", name: "Mei", isHost: false, lastSeen: ALWAYS, presence: { status: "needs-input", task: "Diff review" } },
    { id: "m3", name: "Devon", isHost: false, lastSeen: now - 5 * 60_000, presence: { status: "idle" } },
  ],
  chat: [],
  plan: "",
  tasks: [],
  startedAt: now - 3 * 3_600_000,
  shared: {},
  tombstones: {},
};

export const FAKE_ROOM_SELF = { memberId: "m1", hostAddr: "127.0.0.1:4518" };

export const FAKE_TEAM_SESSIONS: TeamSession[] = [
  { id: "m2:review", member: "m2", memberName: "Mei", session: "review", title: "Diff review", status: "needs-input", sentence: "needs a decision", branch: "feat/review-modal", tests: true, ts: ALWAYS },
  { id: "m2:docs", member: "m2", memberName: "Mei", session: "docs", title: "Docs site", status: "idle", sentence: "quiet 12m", branch: "docs/site", tests: null, ts: ALWAYS },
  { id: "m3:board", member: "m3", memberName: "Devon", session: "board", title: "Task board", status: "working", sentence: "working in KanbanBoard.tsx", branch: "feat/kanban", tests: false, ts: ALWAYS },
];

const m = (min: number) => now - min * 60_000;

export const FAKE_TEAM_CHAT: TeamChatMsg[] = [
  { id: "tc-demo-join", from: "m3", fromName: "", role: "system", text: "Devon joined the room", ts: m(95) },
  { id: "tc-demo-1", from: "m2", fromName: "Mei", role: "user", text: "Review modal is close — I'm stuck on whether **copy diagnostics** goes in the footer or the header.", ts: m(42) },
  { id: "tc-demo-2", from: "m3", fromName: "Devon", role: "user", text: "Footer. Header is already crowded. @aryan can you confirm?", ts: m(40), mentions: ["m1"] },
  { id: "tc-demo-3", from: "m1", fromName: "Aryan", role: "user", text: "Footer works. @claude what's still open before the demo?", ts: m(38), mentions: ["claude"] },
  { id: "tc-demo-4", from: "m1", fromName: "Claude (via Aryan)", role: "assistant", replyTo: "tc-demo-3", ts: m(37),
    text: "Three things stand between you and the demo:\n\n1. **Task board** — Devon's tests are failing on `feat/kanban`.\n2. **Diff review** — Mei's session is waiting on the footer decision (now made).\n3. Nobody owns *the pitch* yet.\n\nI'd unblock Devon first." },
  { id: "tc-demo-5", from: "m3", fromName: "Devon", role: "system", text: "Devon shared a session", ts: m(20),
    attach: { kind: "session", member: "m3", memberName: "Devon", session: "board", title: "Task board", status: "working", branch: "feat/kanban", tests: false, summary: "Drag between columns; fixing the reorder test" } },
  { id: "tc-demo-6", from: "m1", fromName: "", role: "system", text: "Aryan handed a task to Mei's “Diff review”", ts: m(12) },
  { id: "tc-demo-7", from: "m2", fromName: "Mei", role: "user", text: "Got it, approved on my side. Shipping the footer button now.", ts: m(4) },
];
