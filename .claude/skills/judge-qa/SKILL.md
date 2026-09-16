---
name: judge-qa
description: Prepares hackathon judge Q&A for Grill Me — generates the questions judges are most likely to ask (why Tauri, real ptys vs log tailing, safety under skip-permissions, versus cmux/Conductor) with strong answers grounded in this repo's actual implementation, cited by file and line. Use when the user says "judge prep", "judge Q&A", "grill me for the demo", "what will judges ask", or is about to present.
---

# Judge Q&A Prep

Build a briefing of likely judge questions with answers a presenter can deliver in
under 30 seconds each. Every technical claim MUST be verified in the code first and
cited as `file:line`. Honest limitations beat bluffing — judges probe weak spots.

## 1. Verify claims before writing answers

Read (at minimum) before generating: `src-tauri/src/lib.rs` (pty spawn, hooks,
blocklist, HTTP API), `src/data/sources/feeds.ts` (status derivation, self-healing),
`DESIGN.md`, `README.md`. If an answer below no longer matches the code, fix the
answer, not the code.

## 2. Question bank — cover every category, then add 2-3 fresh ones per category

### Technical depth

- **"Why Tauri and not Electron / a web app?"** — Rust backend owns the processes:
  ptys, file watchers, activity registry, and the 400KB output ring all live in Rust
  statics (`lib.rs` PTYS/ACTIVITY), so webview reloads and HMR replay scrollback
  instead of losing sessions. Native webview keeps the binary small; threads +
  an in-process localhost HTTP server need no Node sidecar.
- **"Are those real terminals or are you tailing logs?"** — Real ptys.
  `pty_ensure` spawns `claude --dangerously-skip-permissions` (or ssh/tmux attach)
  via portable-pty; panes are typable xterm.js bound to per-session event channels
  (`pty-output/<id>`). Log tailing can't type, resize, or attach remote tmux.
- **"How do you know a session needs input?"** — Layered signals, not heuristics
  alone: OSC 9/99/777 notifications and BEL parsed in the stateful ANSI stripper
  (`append_stripped`), quiet-time thresholds, and exact Claude Code hook events
  (`Notification`/`Stop`/`UserPromptSubmit` → events.jsonl) reconciled in
  `feeds.ts startPtyFeed`. Hooks win when fresh; OSC beats guessing.
- **"What breaks under load / long sessions?"** — Prepared answer: idle Claude TUIs
  repaint constantly, so the app SIGSTOPs quiet sessions (`pty_pause`, auto-pause in
  feeds.ts) and resumes on view/keystroke; usage parsing reads transcripts
  incrementally with a byte-offset cache (`usage_stats`) instead of re-parsing tens
  of MB every 30s.

### Safety (expect the hardest follow-ups here)

- **"You run --dangerously-skip-permissions. How is that safe?"** — A PreToolUse
  hook (`grillme-hook`, installed by `install_hooks`) regex-matches every Bash
  command against `~/.grillme/blocklist.json` (rm -rf /, force-push to main,
  hard reset, DROP TABLE, mkfs…) and exits 2 — Claude Code treats that as a deny
  and must ask the human. PostToolUse appends every tool call to `audit.jsonl`,
  which also powers "teammate changed a file you just read" warnings.
- **Follow-up: "Can the agent just edit the hook config?"** — Be honest: hooks live
  in the repo's `.claude/settings.json`, so a determined agent could remove them;
  the blocklist is a seatbelt plus audit trail, not a sandbox. Roadmap answer:
  protect settings.json via the blocklist itself and verify hook integrity on poll.
- **"The localhost API — who can call it?"** — Loopback-only on :4517, bearer token
  at `~/.grillme/api-token`, so any caller must already have local file access.
  Know the weak spot: the token is generated with a time-seeded LCG, not a CSPRNG —
  acceptable for same-user localhost, and say so if pressed.

### Business / competition

- **"How is this different from cmux or Conductor?"** — Those are one person
  fanning out many agents. Grill Me is the missing layer for a TEAM of humans each
  running their own agent: live presence and file-lock warnings from real watchers,
  async inbox with blocking/FYI semantics, merge queue, auto-stitched standup, and
  shared state that is just JSON under `~/.grillme` — on a shared VM the filesystem
  IS the transport, no server to deploy. And it still includes the cmux-style
  scriptable surface (`grillme` CLI + HTTP API: sessions/send/read/new) so agents
  can orchestrate each other on top.
- **"Who pays / why desktop?"** — Teams already paying for Claude Code seats; the
  spend visibility (real token tallies parsed from Claude's own transcripts — never
  faked plan percentages) is itself the wedge. Desktop because the product's value
  is attaching to local processes, worktrees, and ptys — a web app can't.
- **"What did you NOT build?"** — Show judgment: no invented plan-limit %s
  (unknowable locally), no CRDT sync (files + atomic rename suffice at team scale),
  no auth service (loopback + token).

### Demo resilience

- "What happens if a session crashes mid-demo?" → bounded auto-restart, 3 per
  10 min, with toasts (`feeds.ts` restarts logic). Rate-limit detection flags the
  session instead of looking frozen.

## 3. Output

Produce a briefing the presenter can skim in 5 minutes: for each question, a
**one-line answer**, a 2-3 sentence expansion, and the `file:line` evidence. End
with a "weak spots — concede gracefully" list (hook editability, token RNG,
single-machine trust model). If the user asks, switch to drill mode: ask them the
questions one at a time and grade their answers against the briefing.
