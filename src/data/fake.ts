import type {
  ActivityEvent,
  CiWorkflow,
  Message,
  SponsorItem,
  Task,
  Teammate,
  TerminalLine,
} from "../types";

// ---------------------------------------------------------------------------
// All sample data for the shell phase lives here. Next phase replaces this
// module with live feeds (SSH, git, file watchers) — same shapes, real data.
// ---------------------------------------------------------------------------

const term = (lines: [TerminalLine["kind"], string][]): TerminalLine[] =>
  lines.map(([kind, text]) => ({ kind, text }));

export const teammates: Teammate[] = [
  {
    id: "aryan",
    name: "Aryan",
    initials: "AR",
    branch: "feature/app-shell",
    taskLabel: "App shell + layout",
    status: "working",
    setup: "ready",
    currentFile: "src/components/SessionList.tsx",
    lastActiveMin: 0,
    health: "ok",
    permission: "edit",
    dnd: false,
    recording: true,
    usage: {
      model: "Fable 5",
      sessionPct: 42,
      weeklyPct: 61,
      sessionResetsIn: "2h 18m",
      weeklyResetsAt: "Thu 09:00",
      permissionMode: "accept edits",
    },
    terminal: term([
      ["cmd", "> build the session list panel with 3-state status dots"],
      ["claude", "I'll create SessionList.tsx with a row per teammate…"],
      ["out", "  ⏺ Write(src/components/SessionList.tsx)"],
      ["out", "  ⏺ Edit(src/App.tsx) — mount SessionList in left panel"],
      ["claude", "Session list renders all four teammates with status dots."],
      ["out", "  ✓ vite hmr update /src/components/SessionList.tsx (34ms)"],
      ["cmd", "> now add the setup status tag under each name"],
      ["claude", "Adding a worktree/env/ready tag to each row…"],
      ["out", "  ⏺ Edit(src/components/SessionList.tsx)"],
    ]),
    changes: [
      { file: "src/components/SessionList.tsx", summary: "new component, 118 lines" },
      { file: "src/App.tsx", summary: "mount left panel" },
      { file: "src/theme/themes.ts", summary: "add idle color token" },
    ],
    standupNote: "Shipped session list w/ status dots + setup tags. Next: presence line.",
  },
  {
    id: "mei",
    name: "Mei",
    initials: "ME",
    branch: "feature/task-board",
    taskLabel: "Task board UI",
    status: "needs-input",
    setup: "ready",
    currentFile: "src/components/TaskBoard.tsx",
    lastActiveMin: 3,
    health: "ok",
    permission: "edit",
    dnd: false,
    recording: false,
    usage: {
      model: "Fable 5",
      sessionPct: 78,
      weeklyPct: 54,
      sessionResetsIn: "0h 47m",
      weeklyResetsAt: "Thu 09:00",
      permissionMode: "plan mode",
    },
    terminal: term([
      ["cmd", "> add drag-and-drop between task columns"],
      ["claude", "Two options: native HTML5 drag events (zero deps) or dnd-kit…"],
      ["claude", "dnd-kit adds 12kb but handles keyboard a11y. Which do you want?"],
      ["err", "  ? Waiting for input — session paused 3m"],
    ]),
    changes: [
      { file: "src/components/TaskBoard.tsx", summary: "columns + cards, 203 lines" },
      { file: "src/data/fake.ts", summary: "task fixtures" },
    ],
    standupNote: "Task board columns done. Blocked on drag-lib decision.",
  },
  {
    id: "dev",
    name: "Devon",
    initials: "DV",
    branch: "feature/inbox",
    taskLabel: "Message inbox",
    status: "working",
    setup: "env",
    currentFile: "src/components/Inbox.tsx",
    lastActiveMin: 1,
    health: "ok",
    permission: "view",
    dnd: true,
    recording: false,
    usage: {
      model: "Sonnet 5",
      sessionPct: 23,
      weeklyPct: 30,
      sessionResetsIn: "3h 55m",
      weeklyResetsAt: "Thu 09:00",
      permissionMode: "default",
    },
    terminal: term([
      ["cmd", "> wire the answered/unanswered toggle on inbox rows"],
      ["claude", "Adding an answered flag flip with optimistic UI…"],
      ["out", "  ⏺ Edit(src/components/Inbox.tsx)"],
      ["out", "  ✓ tsc --noEmit clean"],
      ["claude", "Toggle works. Unanswered messages sort to the top now."],
    ]),
    changes: [{ file: "src/components/Inbox.tsx", summary: "answered toggle + sort" }],
    standupNote: "Inbox list + answered toggle in. Env link still flaky on VM.",
  },
  {
    id: "sam",
    name: "Sam",
    initials: "SA",
    branch: "feature/activity-log",
    taskLabel: "Activity timeline",
    status: "idle",
    setup: "worktree",
    currentFile: "—",
    lastActiveMin: 26,
    health: "stale",
    permission: "view",
    dnd: false,
    recording: false,
    usage: {
      model: "Fable 5",
      sessionPct: 12,
      weeklyPct: 88,
      sessionResetsIn: "4h 30m",
      weeklyResetsAt: "Thu 09:00",
      permissionMode: "default",
    },
    terminal: term([
      ["cmd", "> scaffold the activity timeline component"],
      ["claude", "Created ActivityTimeline.tsx with grouped-by-hour events."],
      ["out", "  ⏺ Write(src/components/ActivityTimeline.tsx)"],
      ["out", "  — no output for 26m —"],
    ]),
    changes: [{ file: "src/components/ActivityTimeline.tsx", summary: "initial scaffold" }],
    standupNote: "Timeline scaffolded, stepped out for food. Back 21:30.",
  },
];

export const tasks: Task[] = [
  {
    id: "t1",
    title: "App shell + layout",
    desc: "Top bar, left session list, center terminal pane, right rail. Theme tokens.",
    owner: "aryan",
    status: "in-progress",
    files: ["src/App.tsx", "src/components/SessionList.tsx", "src/theme/themes.ts"],
    startedAt: Date.now() - 1000 * 60 * 47,
  },
  {
    id: "t2",
    title: "Task board UI",
    desc: "Task cards with owner, status columns, files touched per task.",
    owner: "mei",
    status: "in-progress",
    files: ["src/components/TaskBoard.tsx", "src/data/fake.ts"],
    startedAt: Date.now() - 1000 * 60 * 82,
  },
  {
    id: "t3",
    title: "Message inbox",
    desc: "Async notes between teammates, answered flag, broadcast to all sessions.",
    owner: "dev",
    status: "in-progress",
    files: ["src/components/Inbox.tsx", "src/data/fake.ts"],
    startedAt: Date.now() - 1000 * 60 * 31,
  },
  {
    id: "t4",
    title: "Activity timeline",
    desc: "Combined scrollback of commits, merges and messages across the team.",
    owner: "sam",
    status: "not-started",
    files: ["src/components/ActivityTimeline.tsx"],
    blockedBy: "t3",
  },
  {
    id: "t5",
    title: "Theme system",
    desc: "Single swappable theme object driving all colors via CSS variables.",
    owner: "aryan",
    status: "done",
    files: ["src/theme/themes.ts", "src/styles.css"],
  },
  {
    id: "t6",
    title: "Quick switcher",
    desc: "Cmd+K overlay to jump to any teammate pane. Keyboard first.",
    owner: "dev",
    status: "not-started",
    files: ["src/components/QuickSwitcher.tsx", "src/App.tsx"],
  },
];

export const messages: Message[] = [
  {
    id: "m1",
    from: "mei",
    to: "aryan",
    text: "Which drag lib for the task board — native HTML5 or dnd-kit? Claude is waiting on me.",
    answered: false,
    ts: "20:41",
  },
  {
    id: "m2",
    from: "dev",
    to: "all",
    text: "Pushed inbox fixtures to feature/inbox — pull before you touch fake.ts.",
    answered: true,
    ts: "20:22",
  },
  {
    id: "m3",
    from: "aryan",
    to: "sam",
    text: "Timeline can read from the same activity array the inbox uses — see types.ts.",
    answered: true,
    ts: "19:58",
  },
  {
    id: "m4",
    from: "sam",
    to: "aryan",
    text: "Does the theme object cover terminal colors too, or just chrome?",
    answered: false,
    ts: "19:31",
  },
];

export const activity: ActivityEvent[] = [
  { id: "a1", kind: "commit", actor: "aryan", text: "feat: session list rows with 3-state status", ts: "20:52" },
  { id: "a2", kind: "message", actor: "mei", text: "asked aryan about drag lib", ts: "20:41" },
  { id: "a3", kind: "commit", actor: "dev", text: "feat: inbox answered toggle", ts: "20:35" },
  { id: "a4", kind: "merge", actor: "aryan", text: "merged feature/theme-system → main", ts: "20:10" },
  { id: "a5", kind: "status", actor: "sam", text: "session went idle (26m)", ts: "20:04" },
  { id: "a6", kind: "commit", actor: "mei", text: "feat: task board columns + cards", ts: "19:47" },
  { id: "a7", kind: "commit", actor: "sam", text: "chore: scaffold activity timeline", ts: "19:22" },
  { id: "a8", kind: "merge", actor: "dev", text: "merged feature/fixtures → main", ts: "19:05" },
];

export const ciWorkflows: CiWorkflow[] = [
  { name: "build · tauri", status: "pass", detail: "2m 14s · main @ 20:12" },
  { name: "typecheck", status: "running", detail: "feature/task-board" },
  { name: "lint", status: "fail", detail: "feature/inbox · 2 errors" },
];

export const sponsorChecklist: SponsorItem[] = [
  { sponsor: "Anthropic", requirement: "Uses Claude Code sessions as core primitive", done: true },
  { sponsor: "Anthropic", requirement: "AI standup summarizer demo", done: false },
  { sponsor: "Tauri", requirement: "Native desktop build (dmg)", done: false },
  { sponsor: "GitHub", requirement: "Actions status surfaced in-app", done: true },
];

/** Whose turn to merge — rotates through the team. */
export const mergeQueue = ["dev", "aryan", "mei", "sam"];
