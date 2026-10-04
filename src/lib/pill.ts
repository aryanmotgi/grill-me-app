// ---------------------------------------------------------------------------
// The pill's model: what the floating pill shows, worked out in the main
// window (which has every session, test result, limit and task) and sent to
// the pill window as one small snapshot. The pill sends actions back.
// Everything here is pure, so it's tested without either window.
// ---------------------------------------------------------------------------

export type Glow = "idle" | "working" | "needs" | "stuck" | "done";

export interface PillSession {
  id: string;
  title: string;
  status: "idle" | "working" | "needs-input";
  /** one plain line: "Editing login.tsx · 2 tests passing" */
  peek: string;
  stuck: boolean;
  pinned: boolean;
  /** how full its context is, 0–1, when known */
  context: number | null;
  /** Claude is asking whether to trust its folder: one click answers it */
  trust: boolean;
  /** one or two letters for its chip on the rail */
  initials: string;
  /** what it's asking you, read off its screen, when it's waiting */
  question?: string;
}

export interface PillOutside { id: string; folder: string; ask: string; status: "working" | "needs" | "done" }
export interface PillMate { name: string; initials: string; status: "idle" | "working" | "needs-input"; doing: string }
export interface PillApp { port: number; url: string; name: string }
export interface PillLimit { label: string; pct: number }
export interface NextStep { sessionId: string; title: string; options: { id: NextId; label: string }[] }
export type NextId = "tests" | "commit" | "open-app" | "merge";

export interface PillState {
  project: string;
  glow: Glow;
  sessions: PillSession[];
  outside: PillOutside[];
  team: PillMate[];
  mvp: { done: number; total: number } | null;
  /** today's Claude Code spend at API prices, all sessions */
  spend: number | null;
  limits: PillLimit[];
  inbox: number;
  /** unix ms; quiet until then */
  focusUntil: number | null;
  apps: PillApp[];
  next: NextStep | null;
  recap: string | null;
  /** the last turn that can be undone */
  undo: { sessionId: string; title: string } | null;
  prefs: PillPrefs;
  commands: PillCommand[];
}

export interface PillPrefs {
  sound: boolean;
  voice: boolean;
  talk: boolean;
  theme: "auto" | "light" | "dark";
  /** pill size and text size, as a fraction (1 = 100%) */
  size: number;
  text: number;
  placement: "edge" | "floating";
}

export const DEFAULT_PREFS: PillPrefs = { sound: false, voice: false, talk: false, theme: "auto", size: 1, text: 1, placement: "edge" };
export interface PillCommand { id: string; label: string; hint?: string }

export type PillAction =
  | { kind: "open"; sessionId?: string; view?: string }
  | { kind: "next"; sessionId: string; step: NextId }
  | { kind: "undo"; sessionId: string }
  | { kind: "focus"; minutes: number }
  | { kind: "pin"; sessionId: string }
  | { kind: "trust"; sessionId: string }
  | { kind: "send"; sessionId: string; text: string }
  | { kind: "drop"; sessionId: string; paths: string[] }
  | { kind: "command"; id: string }
  | { kind: "prefs"; prefs: Partial<PillPrefs> }
  | { kind: "dismiss"; what: "recap" | "next" }
  | { kind: "hide" };

/** The one color the pill glows, most urgent first. Quiet during focus,
 *  except for something that's truly waiting on you. */
export function glowOf(
  s: { sessions: PillSession[]; outside: PillOutside[]; justDone: boolean; focus: boolean },
): Glow {
  if (s.sessions.some((x) => x.status === "needs-input") || s.outside.some((x) => x.status === "needs")) return "needs";
  if (s.focus) return "idle";
  if (s.sessions.some((x) => x.stuck)) return "stuck";
  if (s.sessions.some((x) => x.status === "working") || s.outside.some((x) => x.status === "working")) return "working";
  return s.justDone ? "done" : "idle";
}

/** "Editing login.tsx · 2 tests passing" style peek line. */
export function peekLine(p: { sentence: string; file?: string; working: boolean; tests: boolean | null }): string {
  const parts: string[] = [];
  const file = p.file && p.file !== "—" ? p.file.split("/").pop() : "";
  parts.push(p.working && file ? `Editing ${file}` : p.sentence);
  if (p.tests !== null) parts.push(p.tests ? "tests pass" : "tests failing");
  return parts.filter(Boolean).join(" · ");
}

/** What to offer when a turn finishes: the obvious next moves, at most three. */
export function nextSteps(p: { tests: boolean | null; changed: number; app: boolean; onBranch: boolean }): { id: NextId; label: string }[] {
  const out: { id: NextId; label: string }[] = [];
  if (p.changed > 0 && p.tests === null) out.push({ id: "tests", label: "Run tests" });
  if (p.changed > 0 && p.tests !== false) out.push({ id: "commit", label: "Commit" });
  if (p.tests === false) out.push({ id: "tests", label: "Fix tests" });
  if (p.app) out.push({ id: "open-app", label: "Open app" });
  if (p.onBranch && p.changed === 0) out.push({ id: "merge", label: "Merge" });
  return out.slice(0, 3);
}

/** What each next step asks the session to do (sent as a normal message). */
export const NEXT_PROMPTS: Record<Exclude<NextId, "open-app">, string> = {
  tests: "Run the project's tests and tell me in one line whether they pass. If any fail, fix them.",
  commit: "Commit your current work with a clear, short commit message.",
  merge: "Merge this branch into the main branch if it merges cleanly; if there are conflicts, tell me which files.",
};

/** "While you were away" in one sentence, from what happened since. */
export function recapLine(awaySecs: number, events: { kind: "done" | "needs" | "stuck"; title: string }[]): string | null {
  if (!events.length) return null;
  const n = (k: string) => new Set(events.filter((e) => e.kind === k).map((e) => e.title)).size;
  const parts = [
    n("done") ? `${n("done")} done` : "",
    n("needs") ? `${n("needs")} need${n("needs") === 1 ? "s" : ""} you` : "",
    n("stuck") ? `${n("stuck")} stuck` : "",
  ].filter(Boolean);
  const mins = Math.round(awaySecs / 60);
  const gone = mins >= 90 ? `${Math.round(mins / 60)} h` : `${mins} min`;
  return `While you were away (${gone}): ${parts.join(", ")}.`;
}

/** Spoken update when a session finishes: short, no jargon. */
export function spokenDone(title: string, changed: number, tests: boolean | null): string {
  const files = changed ? `${changed} file${changed === 1 ? "" : "s"} changed` : "no files changed";
  const t = tests === null ? "" : tests ? ", tests pass" : ", tests failing";
  return `${title} is done. ${files}${t}.`;
}

/** Cost of today's tokens per model, at list prices. */
export function spendOf(
  byModel: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }>,
  price: (t: { input: number; output: number; cacheRead: number; cacheWrite: number }, model: string) => number,
): number {
  return Object.entries(byModel).reduce((sum, [model, t]) => sum + price(t, model), 0);
}

export function focusLeft(until: number | null, now = Date.now()): number {
  return until && until > now ? Math.ceil((until - now) / 60_000) : 0;
}

/** "Market prices" → "MP", "barn" → "B", "add-a-tooltip" → "AT". */
export function initialsOf(title: string): string {
  const words = title.replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  const first = [...words[0]][0].toUpperCase();
  return words[1] ? first + [...words[1]][0].toUpperCase() : first;
}

/** What a waiting agent is asking, from the last lines of its screen: the
 *  last line that reads like a question, without box-drawing and menu marks. */
export function questionOf(lines: string[]): string | undefined {
  const clean = lines
    .map((l) => l.replace(/[│┃╭╮╰╯─━┌┐└┘├┤┬┴┼╌╎⎿❯›>]/g, " ").replace(/^\s*\d+\.\s+/, "").replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 3);
  for (let i = clean.length - 1; i >= 0; i--) {
    const l = clean[i];
    if (/\?\s*$/.test(l) && !/^(Esc|Enter|Tab|press)/i.test(l)) return l.length > 140 ? `${l.slice(0, 139)}…` : l;
  }
  return undefined;
}
