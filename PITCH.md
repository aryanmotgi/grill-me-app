# Grill Me — Pitch

## One-liner

**Mission control for teams running Claude Code.** One native window where four
developers see, unblock, guard, and ship every agent on the team — real terminals,
not dashboards.

## The problem

Four developers, each running Claude Code, is the default hackathon and startup
team shape in 2026. It is also chaos:

- **Who's blocked?** An agent asks a clarifying question and sits idle for twenty
  minutes because its human went to get coffee. Nobody else can see it.
- **Who's burning tokens?** One teammate's agent is quietly looping through the
  team's Claude budget. Nobody notices until the rate limit hits everyone.
- **Who broke main?** Everyone runs `--dangerously-skip-permissions` because
  approving every tool call is unbearable — until an agent force-pushes over main
  or `rm -rf`'s a directory, and there's no record of which agent did what.
- **Who's stepping on whom?** Two agents edit the same file for an hour. The team
  finds out at merge time.

The tooling wave solved *one developer, many agents*. Nothing solves
*many developers, many agents* — and that's where the actual damage happens.

## The solution

Grill Me is a Tauri desktop app that embeds every teammate's **real** Claude Code
session — genuine pty-backed terminals, not log viewers — inside one shared
coordination hub:

- **Live status without asking.** Rust parses each session's raw terminal stream
  and Claude Code's own hook events. Working / idle / needs-input is derived from
  the protocol, not from polling vibes. When an agent needs a human, a dot pulses
  amber, a tone fires, and *anyone* on the team can jump in and answer.
- **A safety net that works even with permissions skipped.** A PreToolUse hook
  regex-checks every shell command against a team blocklist (force-push to main,
  `rm -rf /`, `DROP TABLE`, `git reset --hard origin`, ...) and denies with exit 2 —
  which forces Claude to ask a human explicitly, **even under
  `--dangerously-skip-permissions`**. Every executed tool call from every agent is
  appended to a shared `audit.jsonl`.
- **Conflict prediction, not conflict resolution.** A native file watcher tracks
  what every agent touches across all four worktrees. Overlap triggers a banner
  and a live file-lock *before* the merge conflict exists.
- **Fan-out.** Paste a checklist; Grill Me infers dependencies between items,
  creates a git worktree per independent task, spawns a live briefed Claude
  session in each, and auto-starts dependents when their blocker is done.
- **Review & ship.** A pre-merge modal shows commits-ahead, diffstat, and full
  diff. Approve types `/ship` directly into that agent's own terminal (tests,
  then push); request-changes opens a blocking inbox thread. A merge queue in the
  top bar means four people never race for main.
- **Team telemetry.** Per-teammate token usage parsed from real Claude transcript
  files, activity sparklines, auto-stitched standup notes, exportable project state.

## Why not cmux or Conductor?

| | cmux / Conductor | **Grill Me** |
|---|---|---|
| Unit of design | One developer fanning out agents | **A team of humans, each with agents** |
| Visibility | Your own sessions | Everyone's sessions, one window |
| Terminals | Varies (some wrap logs/APIs) | **Real ptys** — full TUI, scrollback, replay, recording, pause/resume |
| Safety | Trust the agent | **Hook-enforced blocklist** that overrides skipped permissions + shared audit trail |
| Shipping | You merge your own work | **Human pre-merge review + merge queue** across the team |
| Coordination | None — you are alone | File locks, conflict banners, inbox threads, broadcast, standup |

Solo-first tools multiply one person. Grill Me is **team-first**: shared state,
shared guardrails, shared visibility. That is a different product, not a feature flag.

## Technically impressive (all real, all in the repo)

- **Real ptys in Rust.** Every session is a genuine pseudo-terminal spawning
  `claude`, streamed to xterm.js panes — with scrollback replay, session recording,
  and pause/resume via SIGSTOP/SIGCONT on the whole process group (in-memory agent
  state preserved exactly).
- **A hand-rolled terminal-protocol parser.** A byte-level ANSI state machine in
  Rust strips escape sequences and detects OSC 9 / 99 / 777 notification codes in
  the raw stream — that's how needs-input fires the instant Claude asks, with
  Claude Code hook events (Notification/Stop) as a cross-check, plus rate-limit
  detection on top.
- **Claude Code hooks as an enforcement layer.** Grill Me writes PreToolUse /
  PostToolUse hooks into each worktree: a Python helper whose exit-2 denial is the
  only mechanism that can stop a command when permissions are skipped, plus a
  per-tool-call audit log.
- **Agents orchestrating agents.** A token-protected localhost HTTP API and a
  `grillme` CLI (`sessions` / `send` / `read` / `new`) let any agent spawn,
  prompt, and read other sessions — the fan-out engine is built on it, on git
  worktrees created per task.
- **~1,800 lines of dependency-light Rust** — pty management, git plumbing, file
  watching with TTL'd locks, transcript token accounting with a hand-written
  ISO8601 parser, and the HTTP server, in one auditable file.
- **A disciplined design system** ("Refined Ember"): one theme object drives every
  color via CSS variables; swap the object and the entire app — terminals
  included — reskins.

## The ask

We built Grill Me in the open across 21 PRs and we use it to build itself.

- **Judges:** score us on the live demo — four real agents, a real blocked
  command, a real diff shipped to main, in three minutes.
- **Teams:** every multi-dev team running Claude Code has this chaos today.
  We want 10 hackathon teams and 3 startup teams running Grill Me this month —
  their merge-queue fights and blocklist hits will define v2.
- **The bet:** agent tooling's next platform isn't a better solo cockpit — it's
  the team layer. Grill Me is that layer, and it already runs.
