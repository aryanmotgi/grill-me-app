import { invoke } from "@tauri-apps/api/core";
import type { ActivityEvent, FileChange, Teammate } from "../../types";
import { fmtClock } from "../../lib/format";

// ---------------------------------------------------------------------------
// Slice 1 real feed: git. Polls each configured worktree via the Rust
// `git_state` command and maps the result onto the exact Teammate/Activity
// shapes the components already render — no component changes.
// ---------------------------------------------------------------------------

export interface TeamMemberConfig {
  id: string;
  name: string;
  repoPath: string;
  permission?: string;
  /** SSH target (user@host) — attach remotely instead of spawning locally. */
  remote?: string;
  /** tmux session to attach (with remote: over ssh; alone: local tmux). */
  tmuxSession?: string;
  /** Which agent CLI this session runs: "claude" (default), "cursor", "codex". */
  agent?: AgentId;
}

export type AgentId = "claude" | "cursor" | "codex";

/** One row from the Rust `detect_agents` probe — installed + authed CLIs. */
export interface AgentAvailability {
  id: AgentId;
  name: string;
  installed: boolean;
  authed: boolean;
  path: string;
}

export const detectAgents = () => invoke<AgentAvailability[]>("detect_agents");

interface GitState {
  ok: boolean;
  error: string | null;
  branch: string;
  changes: { file: string; status: string }[];
  commits: { hash: string; message: string; author: string; timestamp: number }[];
}

/** True when running inside the Tauri webview (not plain browser dev). */
export const isTauri = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export const loadTeamConfig = () => invoke<{ teammates: TeamMemberConfig[] }>("team_config");

export const fetchGitState = async (repoPath: string): Promise<GitState> => {
  // reads a Rust-side cache refreshed on its own thread — no subprocess per call
  const raw = await invoke<string>("git_state_cached", { repoPath });
  if (raw) return JSON.parse(raw);
  return invoke<GitState>("git_state", { repoPath });
};

/** Name-level overlap between two members' branches — never a merge result. */
export interface ConflictPair {
  a: string;
  b: string;
  files: string[];
}

/** Pre-merge conflict radar: pairwise file-name overlap. Rust caches 30s. */
export const fetchConflictRadar = () => invoke<ConflictPair[]>("git_conflict_radar");

/** AI verdict on whether two branches will ACTUALLY conflict (same lines) vs
 *  just touch the same files, plus a recommended merge order. */
export interface ConflictPrediction {
  likelihood: "low" | "medium" | "high";
  detail: string;
  recommendedOrder: string;
}

/** Ask claude to predict whether two members' branches will really conflict.
 *  `memberA`/`memberB` are the identifiers carried on a ConflictPair (a/b). */
export const predictConflict = (memberA: string, memberB: string) =>
  invoke<ConflictPrediction>("predict_conflict", { memberA, memberB });

/** One member's branch vs main: divergence + last commit + changed-file count.
 *  Read-only sibling of the conflict radar — never runs a merge. */
export interface BranchOverview {
  ok: boolean;
  error: string | null;
  branch: string;
  onMain: boolean;
  /** Commits on the branch not yet in main. */
  ahead: number;
  /** Commits on main not yet in the branch. */
  behind: number;
  lastSubject: string;
  /** Committer time of the last commit, epoch seconds (0 if unknown). */
  lastTs: number;
  changedFiles: number;
}

/** Branch graph lane for one worktree — ahead/behind vs main. Rust, per-repo. */
export const fetchBranchOverview = (repoPath: string) =>
  invoke<BranchOverview>("branch_overview", { repoPath });

const STATUS_LABEL: Record<string, string> = {
  M: "modified",
  A: "added",
  D: "deleted",
  R: "renamed",
  "??": "untracked",
};

/** branch name → human task label ("feature/real-git-data" → "real git data") */
export function branchToLabel(branch: string): string {
  const tail = branch.split("/").pop() ?? branch;
  return tail.replace(/[-_]/g, " ");
}

export function toChanges(state: GitState): FileChange[] {
  return state.changes.map((c) => ({
    file: c.file,
    summary: STATUS_LABEL[c.status] ?? c.status,
  }));
}

/** Patch of Teammate fields this slice owns. Everything else stays untouched. */
export function toTeammatePatch(state: GitState): Partial<Teammate> {
  if (!state.ok) {
    // git says the folder itself is gone (a deleted worktree, an old setup)
    const missing = /no such file or directory|cannot change to/i.test(state.error ?? "");
    return { health: "disconnected", setup: "worktree", branch: "—", changes: [], missing };
  }
  return {
    missing: false,
    branch: state.branch,
    taskLabel: branchToLabel(state.branch),
    changes: toChanges(state),
    setup: "ready",
  };
}

export function toActivity(
  states: { member: TeamMemberConfig; state: GitState }[],
): ActivityEvent[] {
  const seen = new Set<string>();
  return states
    .flatMap(({ member, state }) =>
      state.commits.map((c) => ({
        id: `git-${c.hash}`,
        kind: (c.message.toLowerCase().startsWith("merge") ? "merge" : "commit") as ActivityEvent["kind"],
        actor: member.id,
        text: c.message,
        ts: fmtClock(c.timestamp * 1000),
        epochMs: c.timestamp * 1000,
      })),
    )
    .sort((a, b) => b.epochMs - a.epochMs)
    .filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)))
    .slice(0, 40);
}
