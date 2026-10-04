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

/** A one-click follow-up on an Activity line (kept as data, run by the bell). */
export type ActivityAction = "merge-sessions";
export interface ActivityItem { id: number; at: number; text: string; tone: "info" | "warn"; count: number; read: boolean; action?: ActivityAction }

const MERGE_MS = 30 * 60_000;
const KEEP = 60;
let seq = 0;

/** Add a line, merging a repeat of a recent one. Pure. */
export function addItem(items: ActivityItem[], text: string, tone: "info" | "warn", now = Date.now(), action?: ActivityAction): ActivityItem[] {
  const i = items.findIndex((x) => x.text === text && now - x.at < MERGE_MS);
  if (i >= 0) {
    const merged = { ...items[i], at: now, count: items[i].count + 1, read: false };
    return [merged, ...items.slice(0, i), ...items.slice(i + 1)];
  }
  return [{ id: ++seq, at: now, text, tone, count: 1, read: false, action }, ...items].slice(0, KEEP);
}

export const useActivity = create<{
  items: ActivityItem[];
  note: (text: string, tone?: "info" | "warn", action?: ActivityAction) => void;
  readAll: () => void;
  clear: () => void;
}>((set) => ({
  items: [],
  note: (text, tone = "info", action) => set((s) => ({ items: addItem(s.items, text, tone, Date.now(), action) })),
  readAll: () => set((s) => ({ items: s.items.map((x) => (x.read ? x : { ...x, read: true })) })),
  clear: () => set({ items: [] }),
}));

/** Log something Grill Me noticed on its own. Never pops up. */
export const note = (text: string, tone: "info" | "warn" = "info", action?: ActivityAction) => useActivity.getState().note(text, tone, action);

/** Files two or more of your sessions are changing at once. */
export function localOverlaps(sessions: { title: string; files: string[] }[]): { file: string; who: string[] }[] {
  const by = new Map<string, string[]>();
  for (const s of sessions) for (const f of new Set(s.files)) by.set(f, [...(by.get(f) ?? []), s.title]);
  return [...by].filter(([, who]) => who.length > 1).map(([file, who]) => ({ file, who }));
}

/** One calm line for an overlap: "Barn and Market are both changing game.js". */
export function overlapLine(file: string, who: string[]): string {
  const names = who.length > 2 ? `${who.slice(0, -1).join(", ")} and ${who[who.length - 1]}` : who.join(" and ");
  return `${names} are both changing ${file.split("/").pop()}`;
}
