// ---------------------------------------------------------------------------
// Quick tips the interview can drop in when someone describes a pain. The AI
// only picks a tip id; the words are ours, vetted, so it can't give bad
// advice. Each tip has a plain version for people new to coding.
// No installs here: tools are what the suggestions are for.
// ---------------------------------------------------------------------------

import type { SolveTag } from "./catalog";

export interface Tip { id: string; pain: SolveTag; text: string; simple: string }

export const TIPS: Tip[] = [
  // testing
  { id: "flaky-loop", pain: "testing", text: "Run a flaky test 20 times in a loop before touching code. If it fails 1 in 20, it's timing or shared state, not logic.", simple: "If a test only fails sometimes, run it many times in a row. If it fails now and then, the problem is timing, not your code." },
  { id: "test-first", pain: "testing", text: "Ask the agent for a failing test first, then the fix, and tell it never to loosen an assertion or add a sleep to make it pass.", simple: "Ask your AI to write a test that fails first, then fix the code until it passes, and tell it never to make the test easier." },
  { id: "db-ready", pain: "testing", text: "For database tests, wait until a real query (SELECT 1) succeeds, not just the port or the healthcheck: the server accepts connections before it's ready.", simple: "In database tests, wait until a simple query works before starting. The database can look ready before it really is." },
  // review
  { id: "small-diffs", pain: "review", text: "Have the agent stop after each step with a diff under ~200 lines. Big diffs hide bugs; small ones get real review.", simple: "Ask your AI to do one small step at a time and show you the change. Small changes are much easier to check." },
  { id: "why-first", pain: "review", text: "Ask for a 3-line \"what changed and why\" at the top of every PR. Review the intent first, then the code.", simple: "Ask your AI to explain each change in 3 short lines before you read the code." },
  { id: "second-reviewer", pain: "review", text: "Before you review, have a fresh agent session review the diff for edge cases and read its notes first.", simple: "Before you check a change, ask a new AI chat to look for problems in it. Read what it found first." },
  // planning
  { id: "plan-file", pain: "planning", text: "Have the agent write its plan to a file and wait for your OK before coding. Fixing a plan is cheaper than fixing code.", simple: "Ask your AI to write down its plan and wait for your OK before it codes. It's easier to fix a plan than code." },
  { id: "done-when", pain: "planning", text: "Write 2–3 \"done when…\" checks before starting and give them to the agent as the finish line.", simple: "Before you start, write 2 or 3 sentences that say what \"done\" looks like, and give them to your AI." },
  // debugging
  { id: "first-error", pain: "debugging", text: "Read the first error, not the last: the rest are usually knock-on effects.", simple: "When you see a wall of red text, the first error is usually the real one. Start there." },
  { id: "repro-first", pain: "debugging", text: "Before asking for a fix, ask the agent to reproduce the bug with a tiny script or test. A fix without a repro is a guess.", simple: "Before asking your AI to fix a bug, ask it to show the bug happening first. Otherwise it's guessing." },
  { id: "bisect", pain: "debugging", text: "If it worked last week, `git bisect` finds the exact commit that broke it in a few steps.", simple: "If it used to work, git can find the exact change that broke it (ask your AI to run \"git bisect\" with you)." },
  // looking things up
  { id: "paste-docs", pain: "docs", text: "Paste the exact docs page into the chat: agents otherwise guess APIs from older versions.", simple: "Paste the real documentation page into your AI chat. Otherwise it may use old instructions." },
  { id: "say-versions", pain: "docs", text: "Tell the agent your library versions (from package.json or go.mod) so it doesn't write code for an older API.", simple: "Tell your AI which versions of your tools you use, so it doesn't write code for an older version." },
  // deploying
  { id: "env-example", pain: "deploy", text: "Keep a .env.example listing every variable and compare it with the host's settings: most \"works locally\" breaks are a missing env var.", simple: "Keep a list of every secret setting your app needs (.env.example) and check the server has all of them. That's the most common reason it works locally but not online." },
  { id: "build-locally", pain: "deploy", text: "Run the production build locally (npm run build) before pushing. It catches most deploy failures in seconds.", simple: "Before you push, run the same build the server runs (npm run build) on your computer. It catches most problems early." },
  { id: "pin-runtime", pain: "deploy", text: "Pin your runtime version (.nvmrc or an engines field) so your machine and the server build the same way.", simple: "Make sure your computer and the server use the same Node version (write it in a .nvmrc file)." },
  // UI
  { id: "show-dont-tell", pain: "ui", text: "Give the agent a screenshot or sketch of what you want: words alone get generic layouts.", simple: "Show your AI a screenshot or drawing of what you want. Words alone get you something generic." },
  { id: "reuse-components", pain: "ui", text: "Tell it to reuse your existing components and spacing instead of inventing new ones.", simple: "Ask your AI to reuse the buttons and styles you already have instead of making new ones." },
  // databases
  { id: "migration-semantics", pain: "database", text: "Ask the agent to list every nullability and default change in a migration separately: those slip past review and break code that assumed the old behaviour.", simple: "Ask your AI to point out any change that makes a database field optional or changes its default value. Those cause sneaky bugs." },
  { id: "real-data", pain: "database", text: "Try each migration on a copy of real data before production. Empty test databases hide the problems.", simple: "Test database changes on a copy of real data first. An empty test database hides problems." },
  // keeping track
  { id: "branch-per-task", pain: "project-management", text: "One task per branch per agent, with the task in the branch name: you can see who's on what at a glance.", simple: "Give each task its own branch with a clear name, so you can see what's being worked on." },
  { id: "one-list", pain: "project-management", text: "Keep one shared list of who (and which agent) is on what, updated when work starts, not when it's done.", simple: "Keep one list of what everyone is working on, and update it when work starts." },
];

const BY_ID = new Map(TIPS.map((t) => [t.id, t]));
export const tipById = (id: unknown) => (typeof id === "string" ? BY_ID.get(id) : undefined);

/** The tip menu the AI picks from, one line each. */
export const tipMenu = () => TIPS.map((t) => `${t.id} (${t.pain}): ${t.text}`).join("\n");
