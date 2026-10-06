import type { SessionStats } from "./coach";

// ---------------------------------------------------------------------------
// The manager: one session whose job is everyone else's sessions.
//
// It is an ordinary Claude Code session with the Grill Me MCP attached, so it
// can already read the whole team (team_status, catch_up, open_questions) and
// act on it (send_to_coder, set_goal, answer_question). That reach is the point
// and also the risk: an agent that decides everyone needs a nudge spends real
// money on other people's plans, and nothing about a loop makes it obvious.
//
// So two things are deliberate.
//
// "Report" is the default and is *enforced*, not requested: the session is
// launched with --disallowedTools for every Grill Me tool that writes, so
// Claude Code refuses them before the MCP is reached. A prompt that says
// "don't act" is a preference; this is not.
//
// The hourly cap is the opposite, and the UI says so: it bounds what the
// manager is told it may do, and is checked when the app is what performs the
// action. An agent that finds another route is not stopped by it.
// ---------------------------------------------------------------------------

export const MANAGER_MODES = ["off", "report", "act"] as const;
export type ManagerMode = (typeof MANAGER_MODES)[number];

/** Grill Me MCP tools that change something rather than read it. */
export const MANAGER_WRITE_TOOLS = [
  "send_to_coder", "set_goal", "save_plan", "answer_question", "post_team_chat", "ask_brainstorm",
] as const;

export interface ManagerPolicy {
  mode: ManagerMode;
  /** Session id doing the managing. Empty until one is picked. */
  session: string;
  /** Ceiling on actions per rolling hour, when the mode allows any. */
  maxActionsPerHour: number;
}

export const DEFAULT_MANAGER: ManagerPolicy = { mode: "off", session: "", maxActionsPerHour: 6 };

export const MODE_COPY: Record<ManagerMode, { label: string; detail: string }> = {
  off: { label: "Off", detail: "No manager session." },
  report: {
    label: "Report only",
    detail: "Reads every session and tells you who's blocked and what's drifting. Cannot change anything — the tools that write are denied at launch.",
  },
  act: {
    label: "Can act",
    detail: "Also hands out tasks, answers questions and sets the goal. It spends your teammates' Claude usage, not just yours.",
  },
};

export function managerOf(settings: Record<string, unknown> | undefined): ManagerPolicy {
  const raw = settings?.manager as Partial<ManagerPolicy> | undefined;
  const n = Number(raw?.maxActionsPerHour);
  return {
    mode: MANAGER_MODES.includes(raw?.mode as ManagerMode) ? (raw!.mode as ManagerMode) : DEFAULT_MANAGER.mode,
    session: typeof raw?.session === "string" ? raw.session : DEFAULT_MANAGER.session,
    maxActionsPerHour: Number.isFinite(n) && n >= 0 ? Math.min(100, Math.floor(n)) : DEFAULT_MANAGER.maxActionsPerHour,
  };
}

/** Grill Me MCP tools that only read. A manager in report mode gets exactly
 *  these and nothing else. */
export const MANAGER_READ_TOOLS = [
  "team_status", "catch_up", "whats_new", "open_questions", "ship_status", "search_brain",
  "get_plan", "read_session", "get_diff", "team_chat", "notes", "past_lessons", "coding_dna",
] as const;

const mcp = (t: string) => `mcp__grill-me__${t}`;

/** The agent definition written to .claude/agents/manager.md.
 *
 *  The mode is the `tools:` line. In report mode the writing tools are not
 *  listed, so Claude Code never offers them — the manager cannot act because
 *  it has no way to, not because it was asked nicely. Changing the mode
 *  rewrites this file.
 *
 *  No Bash, Edit or Write on purpose: a manager that can edit the code stops
 *  being a manager the first time it is easier to fix something itself. */
export function managerAgentFile(mode: ManagerMode): string {
  const act = mode === "act";
  const tools = ["Read", "Glob", "Grep", ...MANAGER_READ_TOOLS.map(mcp), ...(act ? MANAGER_WRITE_TOOLS.map(mcp) : [])];
  const body = act
    ? `When you act, each action spends a teammate's Claude usage, not yours. Act when a
session is blocked on something you can settle — not to look busy. \`send_to_coder\`
needs the user's own words explaining the plan, so ask for them and wait.`
    : `You have no tools that change anything, and that is deliberate. Say what you would
do and let the user decide. Do not look for another route to the same effect — not
through a teammate, not by asking a session to do it for you.`;

  return `---
name: manager
description: Watches every Claude Code session on the project and reports who is blocked, what has drifted from the plan, and which sessions are editing the same files.${act ? " Can hand out tasks and answer questions." : " Read-only."}
model: inherit
color: orange
tools: ${tools.join(", ")}
---

You manage a team of Claude Code sessions. You do not write the code.

Each round:

1. \`team_status\` and \`whats_new\` — every session, yours and teammates', and what each
   is actually doing. \`get_plan\` for what was agreed.
2. \`open_questions\` — who is blocked, and on what.
3. \`ship_status\` — whose tests are red since their last change.

Then report, in this order and nothing else:

- **Blocked** — who, on what, and who can unblock them.
- **Drifting** — which session, and what the plan said instead.
- **Colliding** — which sessions are editing the same files.
- **Quiet** — a session with no output for a while, and when it last spoke.

Report what you can see. When you cannot see something, say so rather than
inferring it: a quiet session is quiet, not stuck, and a branch name is not a
plan. One line per item — whoever reads this is in the middle of something.

${body}
`;
}

/** Extra CLI flags the manager session is launched with.
 *
 *  In report mode every writing tool is denied by name, so the refusal comes
 *  from Claude Code rather than from the manager choosing to behave. */
export function launchFlags(p: ManagerPolicy): string[] {
  if (p.mode !== "report") return [];
  return ["--disallowedTools", MANAGER_WRITE_TOOLS.map((t) => `mcp__grill-me__${t}`).join(",")];
}

/** Is the manager allowed one more action right now? `at` is every action's
 *  timestamp, in any order. Pure so the rule is testable without a clock. */
export function canAct(p: ManagerPolicy, at: number[], now: number): { ok: boolean; reason: string } {
  if (p.mode === "off") return { ok: false, reason: "The manager is off." };
  if (p.mode === "report") return { ok: false, reason: "The manager is in report-only mode." };
  const hour = at.filter((t) => now - t < 3_600_000).length;
  if (hour >= p.maxActionsPerHour) {
    return { ok: false, reason: `Used all ${p.maxActionsPerHour} actions this hour. Raise the cap in Settings → Sessions, or wait.` };
  }
  return { ok: true, reason: `${p.maxActionsPerHour - hour} of ${p.maxActionsPerHour} left this hour.` };
}

export interface ManagerUsage {
  /** Estimated spend for the manager's own session, at list prices. */
  cost: number;
  turns: number;
  /** Actions in the last rolling hour, and the cap they are measured against. */
  actionsThisHour: number;
  cap: number;
  /** True once the hour's actions are spent. */
  capped: boolean;
}

export function managerUsage(stats: SessionStats | null, at: number[], p: ManagerPolicy, now: number): ManagerUsage {
  const actionsThisHour = at.filter((t) => now - t < 3_600_000).length;
  return {
    cost: stats?.cost ?? 0,
    turns: stats?.turns ?? 0,
    actionsThisHour,
    cap: p.maxActionsPerHour,
    capped: p.mode === "act" && actionsThisHour >= p.maxActionsPerHour,
  };
}
