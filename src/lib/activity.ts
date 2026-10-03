// ---------------------------------------------------------------------------
// The Activity bell: where background events go instead of popping up.
// Pop-ups (toasts) are for what you just did and what truly needs you
// (a session waiting on you, a crash, a rate limit). Everything Grill Me
// notices on its own (a check's finding, a board update, a spotted decision,
// a teammate's reply) lands here, quietly, with a count on the bell. The
// same line within half an hour is merged, so a check that keeps firing
// can't flood you.
// ---------------------------------------------------------------------------

import { create } from "zustand";

export interface ActivityItem { id: number; at: number; text: string; tone: "info" | "warn"; count: number; read: boolean }

const MERGE_MS = 30 * 60_000;
const KEEP = 60;
let seq = 0;

/** Add a line, merging a repeat of a recent one. Pure. */
export function addItem(items: ActivityItem[], text: string, tone: "info" | "warn", now = Date.now()): ActivityItem[] {
  const i = items.findIndex((x) => x.text === text && now - x.at < MERGE_MS);
  if (i >= 0) {
    const merged = { ...items[i], at: now, count: items[i].count + 1, read: false };
    return [merged, ...items.slice(0, i), ...items.slice(i + 1)];
  }
  return [{ id: ++seq, at: now, text, tone, count: 1, read: false }, ...items].slice(0, KEEP);
}

export const useActivity = create<{
  items: ActivityItem[];
  note: (text: string, tone?: "info" | "warn") => void;
  readAll: () => void;
  clear: () => void;
}>((set) => ({
  items: [],
  note: (text, tone = "info") => set((s) => ({ items: addItem(s.items, text, tone) })),
  readAll: () => set((s) => ({ items: s.items.map((x) => (x.read ? x : { ...x, read: true })) })),
  clear: () => set({ items: [] }),
}));

/** Log something Grill Me noticed on its own. Never pops up. */
export const note = (text: string, tone: "info" | "warn" = "info") => useActivity.getState().note(text, tone);
