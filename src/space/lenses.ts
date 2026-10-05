// ---------------------------------------------------------------------------
// What Code Space shows on top of a project's files, worked out here so it's
// tested without the 3D scene.
//
//   Live           each session as a marker over the file it's on, the files
//                  it changed in its own color, and places two sessions both
//                  touched (where their work could collide)
//   Understanding  the files your agents changed this week: which ones you've
//                  read (explained or marked), which changed since you read
//                  them, which you haven't looked at; and what to read next
// ---------------------------------------------------------------------------

/** Session colors: calm and distinct; ember and gold stay for status. */
export const SESSION_COLORS = ["#7aa2f7", "#9ece6a", "#bb9af7", "#2ac3de", "#ff9e64", "#f7768e", "#73daca", "#e0af68"];

export interface LiveSession {
  id: string;
  title: string;
  status: "idle" | "working" | "needs-input";
  /** the session's own folder (a worktree or the project) */
  folder: string;
  /** what it's on now and what it changed, relative to its folder */
  current?: string;
  changed: string[];
}

export interface Live {
  /** project-relative file → the sessions that changed it */
  touched: Map<string, string[]>;
  /** files more than one session changed */
  overlaps: string[];
  colors: Map<string, string>;
  /** project-relative file each session is on now */
  on: Map<string, string>;
}

const clean = (p: string) => p.replace(/^\.\//, "").replace(/^\/+/, "");

export function live(sessions: LiveSession[]): Live {
  const touched = new Map<string, string[]>();
  const colors = new Map<string, string>();
  const on = new Map<string, string>();
  sessions.forEach((s, i) => {
    colors.set(s.id, SESSION_COLORS[i % SESSION_COLORS.length]);
    for (const f of s.changed) {
      const k = clean(f);
      if (!k) continue;
      const who = touched.get(k) ?? [];
      if (!who.includes(s.id)) who.push(s.id);
      touched.set(k, who);
    }
    if (s.current && s.current !== "—") {
      const cur = s.current.startsWith("/") ? (s.current.startsWith(`${s.folder.replace(/\/+$/, "")}/`) ? s.current.slice(s.folder.replace(/\/+$/, "").length + 1) : "") : clean(s.current);
      if (cur) on.set(s.id, cur);
    }
  });
  const overlaps = [...touched.entries()].filter(([, who]) => who.length > 1).map(([f]) => f).sort();
  return { touched, overlaps, colors, on };
}

export type Read = "read" | "stale" | "unread";

/** Have you read this file since it last changed? `readAt` is when you
 *  explained or marked it (unix ms); `mtime` when the file last changed. */
export function readState(readAt: number | undefined, mtime: number | undefined): Read {
  if (!readAt) return "unread";
  return mtime && mtime > readAt + 1000 ? "stale" : "read";
}

export interface Meter { total: number; read: number; stale: number; unread: string[] }

/** How much of what your agents changed you've read, and what's left
 *  (most recently changed first). */
export function meter(changed: { rel: string; mtime?: number }[], understood: Record<string, number>): Meter {
  let read = 0, stale = 0;
  const unread: { rel: string; mtime: number }[] = [];
  for (const f of changed) {
    const s = readState(understood[f.rel], f.mtime);
    if (s === "read") read++;
    else {
      if (s === "stale") stale++;
      unread.push({ rel: f.rel, mtime: f.mtime ?? 0 });
    }
  }
  unread.sort((a, b) => b.mtime - a.mtime);
  return { total: changed.length, read, stale, unread: unread.map((u) => u.rel) };
}

/** "12 of 40 files your agents changed this week" style line. */
export function meterLine(m: Meter): string {
  if (!m.total) return "Nothing changed this week";
  if (m.read === m.total) return `You've read all ${m.total} files your agents changed this week`;
  return `You've read ${m.read} of ${m.total} files your agents changed this week${m.stale ? ` · ${m.stale} changed since` : ""}`;
}
