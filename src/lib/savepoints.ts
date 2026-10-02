// ---------------------------------------------------------------------------
// Save points (src-tauri/src/savepoint.rs): snapshots of a session's folder,
// kept as private git refs. One is taken before every message you send, so
// any turn can be undone. Never touches the branch, commits or index.
// ---------------------------------------------------------------------------

import { create } from "zustand";

export interface SavePoint { id: string; label: string; at: number }

const native = () => "__TAURI_INTERNALS__" in window;
const BEFORE = "Before: ";

async function call<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

/** Bumped whenever save points change, so open lists refresh. */
export const useSavePoints = create<{ rev: number; bump: () => void }>((set) => ({ rev: 0, bump: () => set((s) => ({ rev: s.rev + 1 })) }));

/** The label a save point taken before a message gets. */
export function beforeLabel(message: string): string {
  const one = message.replace(/\s+/g, " ").trim();
  return `${BEFORE}“${one.length > 60 ? `${one.slice(0, 59)}…` : one}”`;
}

/** The save point "Undo last turn" goes back to: the newest one taken before a message. */
export function lastTurn(points: SavePoint[]): SavePoint | undefined {
  return points.find((p) => p.label.startsWith(BEFORE));
}

/** "just now", "4 min ago", "2 h ago", "3 d ago" */
export function ago(atSecs: number, nowMs = Date.now()): string {
  const s = Math.max(0, Math.round(nowMs / 1000 - atSecs));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

export async function savePoint(repoPath: string, label: string): Promise<SavePoint | null> {
  if (!native() || !repoPath) return null;
  const sp = await call<SavePoint>("savepoint_create", { repoPath, label });
  useSavePoints.getState().bump();
  return sp;
}

/** Before a message goes to the agent. Never blocks or fails the send. */
export function saveBeforeSend(repoPath: string | undefined, message: string) {
  if (!repoPath || message.trim().startsWith("/")) return;
  void savePoint(repoPath, beforeLabel(message)).catch(() => {});
}

export async function listSavePoints(repoPath: string): Promise<SavePoint[]> {
  if (!native() || !repoPath) return [];
  return call<SavePoint[]>("savepoint_list", { repoPath }).catch(() => []);
}

export async function goBack(repoPath: string, id: string): Promise<string> {
  const msg = await call<string>("savepoint_restore", { repoPath, id });
  useSavePoints.getState().bump();
  return msg;
}
