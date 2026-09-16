# Grill Me — Hackathon Submission

One shared window into every teammate's Claude Code session. Four people, one
native app: live pty-backed terminals, file-lock conflict radar, a task board
that spawns agents, and a localhost API so agents can drive the hub themselves.

- **Repo:** https://github.com/aryanmotgi/grill-me-app
- **Team:** Aryan, Shreyash, Nandan, Rithik
- **Stack:** Tauri 2 (Rust) · React 19 + TypeScript + Vite · Tailwind CSS 4 · Zustand 5 · xterm.js 6 (WebGL) · portable-pty · claude-code hooks

---

## Submission checklist

### Must-do before the deadline

- [ ] **Repo public** — flip `aryanmotgi/grill-me-app` to public; verify an incognito window can see it
- [ ] **README verified** — `npm install && npm run tauri dev` works on a clean machine (Rust toolchain + Node noted)
- [ ] **Demo video recorded** — ≤ 3:00, follows the rehearsed demo path (see `.claude/skills/demo-drive/SKILL.md`); uploaded (YouTube unlisted or Devpost upload); link pasted into the form: `________________`
- [ ] **Screenshots captured** (in demo view — TopBar → "Demo view"):
  - [ ] Mission-control home (project cards with live stats)
  - [ ] Fan-out: checklist pasted → parallel sessions spawning
  - [ ] Conflict banner + file locks in the session list
  - [ ] Embedded terminal with scrollback slider
  - [ ] Review & ship modal (commits ahead → diff → approve & ship)
  - [ ] Inbox with a BLOCKING message + OS notification
- [ ] **Team listed** on Devpost — all four members added as collaborators
- [ ] **Built-with tags** — tauri, rust, react, typescript, claude, anthropic, xterm, zustand, tailwindcss
- [ ] **Tagline** (≤ 60 chars): `Mission control for a team of Claude Code sessions`

### Sponsor requirements (tracked live in the app's Team panel — dogfood it)

- [x] **Anthropic** — Claude Code sessions as the core primitive (real `claude` processes per pane, hooks, transcript-based usage tallies)
- [ ] **Anthropic** — AI standup summarizer demo (Activity tab auto-stitched standup)
- [ ] **Tauri** — native desktop build (`npm run tauri build` → .dmg attached to a release)
- [x] **GitHub** — Actions status surfaced in-app (`gh run list` feed in the Team panel)

---

## Devpost writeup

### Inspiration

Four of us at a hackathon, each with a Claude Code session running in a
terminal nobody else could see. We kept editing the same files, asking "are
you done with the store yet?" out loud, and discovering merge conflicts at the
worst moment. Claude Code is a phenomenal solo tool — but a team of four
sessions is an unmanaged distributed system. Grill Me is the missing control
plane: one window that shows every session, every claimed file, every blocked
question, and lets you act on all of it without alt-tabbing into someone
else's terminal.

### What it does

- **Embedded real terminals** — one pty-backed `claude` process per teammate
  worktree, rendered with xterm.js (WebGL). Scrollback survives webview
  reloads because the byte ring lives in Rust, not the page.
- **Honest live status** — green working / amber needs-input / hollow idle,
  derived from real signals: process liveness, output flow, terminal BEL,
  OSC 9/99/777 notifications parsed out of the byte stream, and exact
  claude-code hook events (`Notification`, `Stop`, `UserPromptSubmit`).
- **Conflict radar** — Rust `notify` watchers on every worktree maintain
  (teammate, file) → last-touch locks; the UI warns you when someone changes a
  file you recently read (cross-referenced against the hook audit log).
- **Task board with dependencies** — shared `tasks.json`, per-task timers,
  `blockedBy` chains, file claims.
- **Fan-out** — paste a checklist; independent items each get a `git worktree`,
  a branch, a live Claude session, and a briefing prompt. Dependent items wait
  and auto-start when their blocker is marked done.
- **Inbox that respects flow** — messages are typed (`question` / `fyi` /
  `blocking` / `proposal`); FYIs batch into a digest, blocking messages
  interrupt with a distinct WebAudio tone + OS notification.
- **Review & ship** — ⌘S opens the pre-merge review: commits ahead of main,
  diffstat, full diff. Approve types `/ship` into that agent's own terminal
  (after reading its screen — a dead or mid-generation session warns instead
  of typing blind) and advances the merge queue; request changes opens a
  blocking inbox thread to the owner. The session's changes tab handles
  direct commit+push and drafts PR bodies by piping the diff through
  `claude -p`.
- **Safety rails** — a PreToolUse hook enforces a regex blocklist
  (`rm -rf /`, force-push to main, `DROP TABLE`, …) with exit code 2, which
  denies the tool call *even under `--dangerously-skip-permissions`*; every
  executed tool call lands in an audit trail.
- **Agents can drive the hub** — a token-protected localhost HTTP API
  (`127.0.0.1:4517`) plus a `grillme` CLI: list sessions, read any screen,
  send prompts, spawn new worktree sessions. One agent can orchestrate the
  other three. The token is 32 CSPRNG bytes stored `0600`, matched with an
  exact `Bearer`-scheme parse.
- **Everything discoverable** — the full feature catalog feeds the ⌘K command
  palette and deep-links into the right Settings tab; Esc unwinds overlays
  topmost-first.
- **Real usage + CI** — token tallies parsed incrementally from Claude Code's
  own transcripts (never faked), per-session CPU/RAM, GitHub Actions status.

### How we built it

- **Tauri 2** native shell: React 19 frontend in the OS webview, all real work
  in a single-file Rust backend (`src-tauri/src/lib.rs`, ~2,400 lines, 41
  `#[tauri::command]`s, 35 unit tests over the pure core).
- **Rust pty layer**: `portable-pty` spawns `zsh -lc 'exec claude
  --dangerously-skip-permissions'` per worktree (or `ssh -t` / `tmux new -A`
  for remote members). Each session keeps a 400 KB byte ring, a stripped
  plain-text line tail for search, and a stateful ANSI/OSC parser. Output is
  base64-emitted on per-session Tauri event channels so panes only subscribe
  to their own stream.
- **claude-code hooks**: the app writes `.claude/settings.json` into every
  worktree — shell one-liners append `Notification`/`Stop`/`UserPromptSubmit`
  events to `events.jsonl`, and a Python helper runs on `PreToolUse` (blocklist
  enforcement) and `PostToolUse` (audit trail). Status logic trusts hooks
  first, OSC/BEL second, output-quiet heuristics last.
- **OSC parsing**: the byte-stream state machine tracks ESC/CSI/OSC states and
  flags OSC `9;` / `99;` / `777;notify` sequences — the terminal-native
  "I need input" signal — without ever regexing rendered text.
- **Shared state = files**: `~/.grillme/{tasks,messages,team}.json` with
  atomic tmp+rename writes and 2 s polling. On a shared VM the filesystem *is*
  the transport — no server, offline-safe, trivially seedable for demos.
- **Frontend**: Zustand store with polling feeds (`src/data/sources/feeds.ts`)
  layered over the phase-1 fake-data slices, so components never knew when the
  data got real. Every color flows from one `Theme` object → CSS variables →
  Tailwind tokens (see `DESIGN.md`).
- **A final-night hardening pass** on our own attack surface: the localhost API
  token moved to the OS CSPRNG (32 bytes, hex) written `0600` with exact
  `Bearer`-scheme matching instead of substring checks; remote ssh/tmux
  sessions now spawn via argv with hosts and session names validated against a
  strict charset and a `--` separator — no shell interpolation, no
  `-oProxyCommand=` smuggling from a config file; and project ids are
  validated as safe path components (no `.`/`..`, filename charset only) at
  every entry point including the HTTP API, so nothing traverses out of
  `~/.grillme`.

### Challenges we ran into (real war stories)

**1. Reload storms.** Our hooks installer rewrote `.claude/settings.json` in
every worktree on every startup — and our own `notify` watchers watch those
worktrees, and Vite watches ours. Identical content still bumps mtime, so the
app triggered its own file-activity events, which triggered HMR, which re-ran
startup, which rewrote settings… We broke the loop three ways: the installer
diffs content and skips no-op writes, an `AtomicBool` guard stops hot reloads
from stacking duplicate watcher threads, and the ignore list learned about
Vite's atomic-write tmp files (`store.ts.tmp.86597.<hash>`), vim swaps, and
backup tildes.

**2. Screen-scraping a TUI.** We wanted "what is this session doing?" as
text, but Claude Code is a full-screen TUI that repaints with cursor moves —
it almost never prints `\n`. Our newline-committed line history was
permanently empty while the screen was full. The fix: keep the raw byte ring
and run a stateless ANSI stripper over the *tail of the ring* on demand —
read what's actually on screen, not what scrolled past. That same tail powers
cross-session search, rate-limit detection, and the `grillme read` API.

**3. Zustand v5 traps.** Polling feeds that naively `patchTeammate` every
tick re-rendered every terminal pane 30× a minute, and v5's stricter
`useSyncExternalStore` semantics turn any selector that builds a fresh
object/array per call into an update loop. We ended up with a rule: feeds
compare before they write (skip no-op patches — branch, change count, tail
identity), components select narrow primitives, and anything that must
survive a webview reload (pty rings, file-activity registry) lives in Rust,
not the store.

**4. The subprocess storm.** Early on, every UI tick ran `git status` +
`git log` per worktree — dozens of processes per second, fans audible.
Now one background thread polls git every 10 s into a cache the frontend
reads. Same story for idle sessions: a parked Claude TUI burns 10–25% CPU
just repainting, so the app SIGSTOPs quiet sessions (full state preserved)
and SIGCONTs them the instant you view or type. Four sessions on one laptop
went from jet engine to silent.

**5. Auditing our own attack surface.** A tool that types into other people's
terminals is a juicy target, so we red-teamed it: the original API token used
a time-seeded generator and a sloppy header check, the ssh spawn path
interpolated config values into a shell string, and project ids became path
components unvalidated. All three are fixed (CSPRNG + `0600` + exact Bearer
parse; argv-only spawn with validated hosts; traversal-proof ids) — each one
a small PR the same night we found it. The same pass made the blocklist fail
closed (a corrupt safety config denies instead of allowing) and left behind
35 unit tests pinning the blocklist regexes, the ANSI/OSC stripper, and every
validator.

### Accomplishments we're proud of

- Real terminals, real git, real hooks — the demo has no smoke: every status
  dot traces back to a process signal.
- The safety blocklist denies destructive commands even in
  skip-permissions mode, fails closed on bad config, and leaves an audit
  trail per teammate — all pinned by unit tests.
- We hardened the app against the same class of agent accidents it exists to
  prevent: CSPRNG-tokened API, injection-proof remote spawning,
  traversal-proof project storage.
- The app dogfoods itself: we coordinated building Grill Me *in* Grill Me —
  its own merge queue, tasks, and inbox (44 PRs, feature branch each, 23 of
  them in one overnight hardening-and-polish push).
- An agent-orchestration API in ~180 lines of dependency-free Rust HTTP.

### What we learned

- Hooks beat heuristics: exact events from claude-code's hook system made
  status honest; everything inferred from output timing was eventually wrong.
- Files are a great transport for co-located teams — atomic rename + 2 s
  polling gets you multiplayer without a server.
- In a Tauri app, put durable state in Rust. The webview is disposable.
- Treat your own coordination layer as hostile input: config files, project
  ids, and HTTP headers all needed the same validation discipline as user data.

### What's next

- Finish remote sessions (the `ssh -t` / tmux attach path already exists in
  the pty layer) so the four worktrees can live on a shared VM.
- Event-driven updates (Tauri events end-to-end) to replace the last polls.
- AI standup summarizer over `standup.log` + the activity timeline.
- Signed `.dmg` builds and a first-run team-setup wizard.

---

## Video shot list (keep ≤ 3:00)

| Beat | Time | What's on screen |
|---|---|---|
| Problem | 0:00–0:20 | Four terminals, chaos framing |
| Fan-out wow | 0:20–1:00 | Paste checklist → worktrees + live sessions spawn |
| Coordination | 1:00–1:40 | File locks, conflict banner, blocking message + tone |
| It's real | 1:40–2:20 | Terminal typing, ⌘S review → approve & ship (`/ship` runs in-session, merge queue advances) |
| Closer | 2:20–3:00 | `grillme` CLI driving a session from outside; standup |
