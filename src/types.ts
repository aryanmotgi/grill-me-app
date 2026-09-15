export type SessionStatus = "idle" | "working" | "needs-input";
export type SetupStage = "worktree" | "env" | "ready";
export type Health = "ok" | "stale" | "disconnected";
export type Permission = "edit" | "view";
export type TaskStatus = "not-started" | "in-progress" | "done";
export type CiStatus = "pass" | "fail" | "running";

export interface UsageInfo {
  model: string;
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

export interface Message {
  id: string;
  from: string;
  to: string | "all";
  text: string;
  answered: boolean;
  ts: string;
}

export interface ActivityEvent {
  id: string;
  kind: "commit" | "merge" | "message" | "status";
  actor: string;
  text: string;
  ts: string;
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
