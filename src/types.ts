export type SessionStatus = "idle" | "working" | "needs-input";
export type SetupStage = "worktree" | "env" | "ready";
export type Health = "ok" | "stale" | "disconnected";
export type Permission = "edit" | "view";
export type TaskStatus = "not-started" | "in-progress" | "done";
export type CiStatus = "pass" | "fail" | "running";

export interface UsageInfo {
  model: string;
  /** Real token tallies from the session transcript. */
  tokens?: { input: number; output: number; cacheRead: number; turns: number };
  sessionPct: number;
  weeklyPct: number;
  sessionResetsIn: string;
  weeklyResetsAt: string;
  permissionMode: string;
}

export interface TerminalLine {
  kind: "cmd" | "out" | "claude" | "err";
  text: string;
}

export interface FileChange {
  file: string;
  summary: string;
}

export interface Teammate {
  id: string;
  name: string;
  initials: string;
  branch: string;
  taskLabel: string;
  status: SessionStatus;
  setup: SetupStage;
  currentFile: string;
  /** minutes since last output — drives health check */
  lastActiveMin: number;
  health: Health;
  permission: Permission;
  dnd: boolean;
  recording: boolean;
  paused?: boolean;
  /** Stuck-session flag derived by the pty feed: "stalled" = went silent past
   *  the configured threshold; "looping" = recent output keeps repeating.
   *  Distinct from `health` (which the 20-min stuck/disconnect check owns). */
  flag?: "stalled" | "looping";
  /** true while the pty feed sees a live rate-limit message (429 / usage limit
   *  reached / overloaded) in this session's tail. Distinct from the derived
   *  needs-input status so the team-wide rate-limit indicator can count it. */
  rateLimited?: boolean;
  /** Reset time parsed off the rate-limit banner when the screen shows one
   *  (e.g. "3pm"); undefined when none is printed. */
  rateLimitResetsAt?: string;
  /** Cost cap: true when auto-paused for blowing its token budget. Shows a
   *  distinct "cap reached" tag, blocks auto-resume-on-view, and is cleared by
   *  a manual resume (which also rebaselines capBaseTokens). */
  capReached?: boolean;
  /** Session token count at the last manual resume. The cap counts tokens
   *  ABOVE this, so each manual resume grants another full cap's worth of
   *  budget before the session is stopped again. */
  capBaseTokens?: number;
  usage: UsageInfo;
  terminal: TerminalLine[];
  changes: FileChange[];
  standupNote: string;
}

export interface Task {
  id: string;
  title: string;
  desc: string;
  owner: string; // teammate id
  status: TaskStatus;
  files: string[];
  blockedBy?: string; // task id
  /** epoch ms when moved to in-progress — drives the per-task timer */
  startedAt?: number;
}

export type MessageKind = "question" | "fyi" | "blocking" | "proposal";

export interface Message {
  id: string;
  from: string;
  to: string | "all";
  text: string;
  answered: boolean;
  ts: string;
  /** Epoch ms when sent — legacy messages carry only the "HH:MM" ts string. */
  epochMs?: number;
  /** Urgency/type. Legacy messages without one render as plain notes. */
  kind?: MessageKind;
  /** Auto-attached sender context at send time. */
  context?: { task?: string; file?: string; branch?: string };
  /** Set on replies: id of the root message — groups into a thread. */
  threadId?: string;
  /** One-click answer on proposals. */
  response?: "yes" | "no" | "unsure";
  /** Tags a blocking message as a "request help / need eyes" flag on `from`'s
   *  session. An open (unanswered) one surfaces the requester everywhere with a
   *  distinct "needs help" style; clearing it resolves the flag. */
  help?: boolean;
}

/** One entry in the shared, append-only team decisions log — what we decided
 *  and why. Stored id-keyed in decisions.json (newest-first). */
export interface Decision {
  id: string;
  /** What was decided (and, ideally, why). */
  text: string;
  /** Member id who logged it. */
  author: string;
  /** Epoch ms when logged — the newest-first sort key. */
  epochMs: number;
  /** "HH:MM" display clock, mirrored from epochMs at write time. */
  ts: string;
  /** Optional free-form category, e.g. "architecture", "product". */
  tag?: string;
}

export interface ActivityEvent {
  id: string;
  kind: "commit" | "merge" | "message" | "status";
  actor: string;
  text: string;
  ts: string;
  /** Epoch ms of the event — legacy events carry only the "HH:MM" ts string. */
  epochMs?: number;
}

export interface CiWorkflow {
  name: string;
  status: CiStatus;
  detail: string;
}

export interface SponsorItem {
  sponsor: string;
  requirement: string;
  done: boolean;
}

export interface Toast {
  id: number;
  text: string;
  kind: "info" | "warn";
}

// ---------------------------------------------------------------------------
// Team mode — room protocol types (see team-mode contract). RoomState is the
// host-owned single source of truth, polled by startRoomFeed.
// ---------------------------------------------------------------------------

export type RoomPhase = "lobby" | "brainstorm" | "plan" | "tasks" | "assign" | "done";

/** Live presence a member pushes on each heartbeat (post-onboarding). */
export interface RoomPresence {
  name?: string;
  /** derived session status: "working" | "idle" | "needs-input" | … */
  status?: string;
  /** file the member most recently touched */
  file?: string;
  /** title of the task they're on */
  task?: string;
}

export interface RoomMember {
  id: string;
  name: string;
  isHost: boolean;
  /** Epoch ms of the member's last heartbeat — status is derived client-side. */
  lastSeen: number;
  /** Live presence, absent until the member's first heartbeat carries one. */
  presence?: RoomPresence;
}

export interface RoomChatMsg {
  from: string;
  name: string;
  role: "user" | "assistant";
  text: string;
  ts: number;
}

export interface RoomTask {
  id: string;
  title: string;
  detail: string;
  /** room member id, or null while unassigned */
  assignee: string | null;
}

export interface RoomState {
  code: string;
  phase: RoomPhase;
  members: RoomMember[];
  chat: RoomChatMsg[];
  /** Markdown project plan. */
  plan: string;
  tasks: RoomTask[];
  startedAt: number;
  /**
   * Live shared docs carried over the room after onboarding (phase "done"):
   * file name → id-keyed array (tasks.json / messages.json / decisions.json).
   * Host-authoritative; empty during the lobby/setup phases.
   */
  shared?: Record<string, unknown[]>;
  /** Removed-id tombstones per file (prevents offline-peer resurrection). */
  tombstones?: Record<string, string[]>;
}
