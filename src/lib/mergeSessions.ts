// ---------------------------------------------------------------------------
// Merge my sessions (src-tauri/src/merge.rs): which sessions have work to
// bring into the main one, and the instructions an agent gets when their
// branches conflict. Pure.
// ---------------------------------------------------------------------------

import { create } from "zustand";

export interface FileStat { file: string; adds: number; dels: number }
export interface BranchPreview { branch: string; commits: string[]; files: FileStat[]; conflicts: string[] }

/** Open the merge screen from anywhere (Overview, the Activity bell). */
export const useMergeSessions = create<{ open: boolean; setOpen: (o: boolean) => void }>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

/** Sessions on their own branch: the ones whose work can be merged in. */
export function candidates<T extends { id: string; branch: string }>(sessions: T[], target: string): T[] {
  return sessions.filter((s) => s.branch && s.branch !== "—" && s.branch !== target);
}

/** Only branches with commits of their own are worth merging. */
export function withWork(previews: BranchPreview[]): BranchPreview[] {
  return previews.filter((p) => p.commits.length > 0);
}

export function hasConflicts(previews: BranchPreview[]): boolean {
  return previews.some((p) => p.conflicts.length > 0);
}

/** What the main session's agent is asked to do when branches conflict. */
export function mergePrompt(target: string, previews: BranchPreview[]): string {
  const order = previews.map((p) => p.branch).join(", ");
  const conflicts = previews.filter((p) => p.conflicts.length).map((p) => `- ${p.branch}: ${p.conflicts.join(", ")}`);
  return [
    `Merge these session branches into this branch (${target}), one at a time, in this order: ${order}.`,
    conflicts.length ? `These are expected to conflict:\n${conflicts.join("\n")}` : "",
    "Where files conflict, keep both sides' features working together; don't drop either one.",
    "After each merge, run the tests. When all are merged, commit, then tell me in 3 short bullets what you merged and how you resolved each conflict.",
  ].filter(Boolean).join("\n");
}

export const lines = (files: FileStat[]) => files.reduce((n, f) => ({ adds: n.adds + f.adds, dels: n.dels + f.dels }), { adds: 0, dels: 0 });
