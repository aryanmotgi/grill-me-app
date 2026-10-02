// Messages you just sent, shown in the chat right away. Claude Code writes
// your message to its transcript a moment later; until the chat sees it
// there, this keeps the bubble on screen (and the chat polls faster).

import { create } from "zustand";

export interface Pending { text: string; at: number }

interface PendingState {
  byMate: Record<string, Pending[]>;
  add: (mateId: string, text: string) => void;
  /** drop what the transcript now shows (or anything older than a minute) */
  settle: (mateId: string, seen: { text: string; ts?: number }[]) => void;
}

const key = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 60);

/** Pending messages the transcript hasn't caught up with yet. */
export function unseen(pending: Pending[], seen: { text: string; ts?: number }[], now = Date.now()): Pending[] {
  return pending.filter((p) => now - p.at < 60_000 && !seen.some((s) => (s.ts === undefined || s.ts >= p.at - 10_000) && key(s.text).includes(key(p.text).slice(0, 40))));
}

export const usePendingChat = create<PendingState>((set) => ({
  byMate: {},
  add: (mateId, text) => set((s) => ({ byMate: { ...s.byMate, [mateId]: [...(s.byMate[mateId] ?? []), { text, at: Date.now() }] } })),
  settle: (mateId, seen) => set((s) => {
    const cur = s.byMate[mateId];
    if (!cur?.length) return s;
    const next = unseen(cur, seen);
    return next.length === cur.length ? s : { byMate: { ...s.byMate, [mateId]: next } };
  }),
}));
