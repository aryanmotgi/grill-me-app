// ---------------------------------------------------------------------------
// Automations: "when X happens → do Y" rules the user switches on. Pure
// definitions + scheduling helpers here (tested); the engine that watches
// sessions and fires them lives in components/Automations.tsx.
// ---------------------------------------------------------------------------

export type AutomationId =
  | "review-replies"
  | "auto-test"
  | "waiting-reminder"
  | "morning-standup"
  | "catchup-ping"
  | "commit-nudge"
  | "phone-pings"
  | "draft-answers"
  | "auto-review";

export type AutoCategory = "Code review" | "Testing" | "Alerts" | "Team";

export interface AutomationDef {
  id: AutomationId;
  title: string;
  desc: string;
  trigger: string;
  icon: string;
  category: AutoCategory;
  /** on unless the user turned it off */
  defaultOn: boolean;
}

export const AUTOMATIONS: AutomationDef[] = [
  { id: "review-replies", title: "Check every reply against the plan", desc: "Flags work that contradicts your decisions and ticks tasks on the board.", trigger: "After each session reply", icon: "eye", category: "Code review", defaultOn: true },
  { id: "auto-review", title: "Review each session when it finishes", desc: "Reads the diff, tests and last turn, then says ship, fix or wait — in Flow, and to Claude via whats_new.", trigger: "When a session goes idle with new changes (at most every 3 min)", icon: "doc", category: "Code review", defaultOn: true },
  { id: "draft-answers", title: "Draft answers to coders' questions", desc: "Claude drafts an answer from your goal, decisions and tasks. You edit it and send it with one click in Flow.", trigger: "When a session asks the brainstorm side", icon: "bulb", category: "Code review", defaultOn: true },
  { id: "auto-test", title: "Run tests after every reply", desc: "Runs the project's tests in that session's worktree and shows ✓/✗ on its tab.", trigger: "After each session reply (skips if nothing changed)", icon: "check", category: "Testing", defaultOn: false },
  { id: "waiting-reminder", title: "Remind me when a session waits", desc: "A session asked you something and it's been sitting there.", trigger: "Waiting 5+ minutes", icon: "bell", category: "Alerts", defaultOn: true },
  { id: "phone-pings", title: "Ping my phone", desc: "Needs-you, failing tests, off-plan work, and deadline alerts on your phone (ntfy app). Hand-offs, plans and drafted answers come with Approve / Dismiss buttons.", trigger: "Whenever Grill Me alerts you", icon: "broadcast", category: "Alerts", defaultOn: false },
  { id: "morning-standup", title: "Morning standup", desc: "Writes Done / Doing / Blocked from git and tasks, and posts it to the standup log.", trigger: "Weekdays at 09:00", icon: "team", category: "Team", defaultOn: false },
  { id: "catchup-ping", title: "Catch-up every 2 hours", desc: "A short “here's what changed” summary so nothing slips by.", trigger: "Every 2 hours while Grill Me is open", icon: "clock", category: "Team", defaultOn: false },
  { id: "commit-nudge", title: "Nudge sessions to commit", desc: "When a session has lots of uncommitted work for a while, ask it to commit.", trigger: "10+ changed files for 30 minutes", icon: "commit", category: "Code review", defaultOn: false },
];

export const CATEGORIES: ("All" | AutoCategory)[] = ["All", "Code review", "Testing", "Alerts", "Team"];

type Settings = Record<string, unknown>;

export function automationOn(settings: Settings, id: AutomationId): boolean {
  // the plan check predates this page and keeps its original setting
  if (id === "review-replies") return settings.brainChecks !== false;
  const map = (settings.automations ?? {}) as Record<string, boolean>;
  const def = AUTOMATIONS.find((a) => a.id === id);
  return typeof map[id] === "boolean" ? map[id] : !!def?.defaultOn;
}

export function withAutomation(settings: Settings, id: AutomationId, on: boolean): [string, unknown] {
  if (id === "review-replies") return ["brainChecks", on];
  return ["automations", { ...((settings.automations ?? {}) as Record<string, boolean>), [id]: on }];
}

/** "HH:MM" → minutes after midnight, or null. */
export function parseClock(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

/** Local YYYY-MM-DD — "already ran today" key. */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Should a daily job fire now? At/after its time, not yet today, and
 *  (optionally) only on weekdays. */
export function dueDaily(now: Date, at: string, lastRunDay: string | undefined, weekdaysOnly: boolean): boolean {
  const mins = parseClock(at);
  if (mins === null) return false;
  if (weekdaysOnly && (now.getDay() === 0 || now.getDay() === 6)) return false;
  if (lastRunDay === dayKey(now)) return false;
  return now.getHours() * 60 + now.getMinutes() >= mins;
}

/** Private ntfy topic: long + random so nobody can guess or subscribe to it. */
export function newTopic(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return `grillme-${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}
