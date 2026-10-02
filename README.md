# Grill Me

One shared window into every Claude Code session on your team — human teammates or spawned agents. Each session is a real `claude` process running on a pty inside the app: you watch it, type into it, review its diff, and ship it, all without leaving one screen. Around the terminals sits the coordination layer — a shared task board with file claims and conflict detection, a structured inbox, a merge queue, and per-session resource/usage meters — so several sessions can work the same repo without stepping on each other.

## What it actually does

- **Pty-backed Claude sessions** — every session is a live `claude` process behind an xterm.js pane. Scrollback lives in a Rust ring buffer, so webview reloads and pane remounts replay everything. Each session also gets a `shell` tab (plain zsh in the same worktree), a `changes` tab (working tree + inline diffs), and an `audit` tab.
- **Safety blocklist under `--dangerously-skip-permissions`** — sessions run with permissions skipped for speed, but a PreToolUse hook checks every Bash command against a regex blocklist (`~/.grillme/blocklist.json`: `rm -rf /`, force-push to main, `git reset --hard origin`, `DROP TABLE`, …). Matches are denied and Claude is told to ask the human first. Invalid or unparseable blocklists fail closed. A PostToolUse hook appends every executed tool call to a per-project `audit.jsonl` — that's the audit tab.
- **Merge queue** — a shared per-project queue (whose turn it is lives in the top bar) plus a "merge pilot" pane that runs the fetch/merge/build cycle in an embedded shell.
- **Fan-out** — paste a checklist; independent items each get their own git worktree, branch, and live Claude session in parallel. Items that look dependent (shared wording with an earlier item) wait on the board and auto-start when their dependency is done.
- **Review & ship** — `⌘S` opens a pre-merge review (commits ahead of main, diffstat, full diff). Approve types `/ship` into that session; request changes opens a blocking inbox thread to its owner instead.
- **Structured inbox** — messages are typed: *blocking* and *questions* notify immediately, *proposals* get one-click yes/no/unsure answers, *FYIs* batch into a digest. Threads, @mentions, and sender context at send time.
- **Per-session tokens + CPU** — token tallies parsed incrementally from each session's Claude transcript (scoped to the session's lifetime), and CPU% + memory summed over each session's process tree.
- **Coordination** — one file watcher per worktree feeds live "who's editing what" presence and file claims; a full-width banner appears only when two sessions claim the same file.
- **Scriptable control API** — a token-protected, loopback-only HTTP endpoint (`127.0.0.1:4517`) and a `grillme` CLI so one agent can orchestrate others: list sessions, send prompts, read screens, spawn worktree sessions.
- **Multi-project workspaces** — `⌘P` opens the project picker; every project has its own team config, board, inbox, and sessions, with live stats on each card.

## Quickstart

Prerequisites:

- **Node.js** (18+)
- **Rust** toolchain (for the Tauri backend) — `rustup` is the easiest route
- **Claude Code CLI** — `claude` must work in a fresh login shell

```sh
npm install
npm run tauri dev   # the real app: native window, live terminals
npm run dev         # browser-only UI at localhost:1420 — sample data, no terminals
```

First launch: the project picker appears. Pick a repo (browse, paste a path, or clone a URL) — the app registers it, seeds a one-member team config, and reloads into the workspace. Sessions then spawn as real Claude Code processes in that repo (or in per-session worktrees via **+ new session** / fan-out). A short five-step tour runs once after your first project opens.

## Architecture

Rust owns the state; React renders it.

- **`src-tauri/src/lib.rs`** (one file, on purpose) holds everything long-lived: pty sessions with output ring buffers and ANSI-stripped line tails, a git state cache (one background thread polls every worktree every 10s so the UI never spawns subprocess storms), the file-watch registry (one `notify` watcher thread per worktree emitting edit events and file claims), transcript-based usage parsing, hook/blocklist installation, and the localhost control API. Shared project files (tasks, messages, team, settings) live under `~/.grillme`.
- **React side** (`src/store.ts` + `src/data/sources/`) is a Zustand store fed by polling feeds — git, watchers, ptys, shared files, usage. Components read the store and never talk to the backend directly. Because scrollback and state live in Rust, a webview reload loses nothing.
- In plain-browser dev (`npm run dev`) the feeds never start and sample data keeps the UI browsable.

## Troubleshooting

- **`claude` not found / session dies instantly** — sessions spawn via `/bin/zsh -lc`, so the login-shell PATH is what matters. If `zsh -lc "claude --version"` fails in a terminal, fix your PATH (e.g. re-run the Claude Code installer or add its bin dir to `~/.zprofile`).
- **Hooks and blocklist** — Grill Me installs its hook helper and `blocklist.json` under `~/.grillme`, and wires PreToolUse/PostToolUse hooks into each member repo's `.claude/settings.local.json` (git-ignored via `.git/info/exclude`, so nothing lands in commits). If commands are being blocked unexpectedly, check Settings → Safety (a malformed blocklist fails closed by design). If the audit tab stays empty, confirm the hooks block exists in that repo's `.claude/settings.local.json`.
- **Port 4517 in use** — the control API binds `127.0.0.1:4517`. If something else holds the port, sessions still work but the `grillme` CLI and agent orchestration won't; free the port and relaunch. The API token lives at `~/.grillme/api-token`.
- **macOS privacy (TCC) prompts** — spawned sessions inherit the app's file access, so the first touch of Desktop/Documents/Downloads triggers a macOS permission prompt; deny it and git/watchers in those folders go quiet until you re-grant access under System Settings → Privacy & Security (Files and Folders, or Full Disk Access). Screen Recording / Accessibility permissions are only relevant if your own workflows use screen capture or automation tooling from inside a session — Grill Me itself doesn't request them.

## More docs

- [PITCH.md](PITCH.md) — why this exists and the one-minute story
- [DEMO.md](DEMO.md) — a scripted walkthrough of the features above
- [SUBMISSION.md](SUBMISSION.md) — hackathon submission notes
- [DESIGN.md](DESIGN.md) — the UI constitution; every visual decision defers to it
- `.claude/skills/` — project skills for Claude Code sessions working on this repo (demo-drive, hackathon, judge-qa, pitch, ship-check, standup)

## Stack

Tauri 2 (Rust backend, OS webview) · React 19 + TypeScript + Vite · Tailwind CSS 4 with CSS-variable theme tokens · Zustand · xterm.js (WebGL renderer) · portable-pty + notify on the Rust side.

## Keyboard

`⌘K` switcher/actions · `⌘P` projects · `⌘H` home dashboard · `⌘S` review & ship · `⌘.` focus mode · `⌘1-5` rail tabs · `⌘/` feature index
