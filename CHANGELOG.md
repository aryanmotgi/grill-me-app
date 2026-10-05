# Changelog

What each merged PR added and fixed — one line per item, newest first.

Every PR gets an entry. `node scripts/changelog.cjs check` lists merged PRs that
are missing one; `node scripts/changelog.cjs skeleton <number>` prints a block to
fill in.

One rule for writing entries: say what changed for the person using Grill Me, not
which function moved. "Sessions died at `command not found` in a bundled app" is
an entry. "Refactored agent spawn" is not.

---

## Unreleased

**Added**
- Teammates is a page in the hub now, next to Overview and Brain: people on the left, their sessions on the right, open one of your own from there.
- "Take over their session" on that page for a teammate with an ssh host and tmux session configured — `tmux new -A` attaches to the terminal they are already in, so you share one rather than watching a copy.
- A "What teammates can see" setting with four levels: nothing, that you're working, what you're working on, and the list of files you changed.

**Fixed**
- The Chat/Terminal switcher floated at 60% opacity over the transcript, so the text underneath showed through it. It is solid.

**Removed**
- Shell and Audit tabs from the session switcher.
- The team goal, tests, undo, Peek and Ship buttons from the top bar, and the Peek side panel with them.
- The floating pill no longer launches, and its setting goes with it. `pill.rs` and `pillBridge.ts` stay in the tree, dormant, so the window can come back without being written again.
- The inline teammates list in the sidebar, replaced by the page.

**Privacy note**
- The share setting is applied in `digestSessions`, the one place this Mac turns its sessions into something the room can read. A level that withholds a field never publishes it, so there is nothing on a teammate's machine to hide.
- One stated limit, pinned by a test: at "what I'm working on" the one-line summary can still name a file it is editing. Pick the level below if no filename should leave this Mac.
- There is no matching "what they can do" setting, because nothing in the room can send input to another Mac's session. The only way someone types into yours is ssh, which your ssh keys govern and Grill Me does not. It gets a setting when it gets a control path.

## #245 — install the dependencies this Mac is missing

`feat(onboarding)` · merged 2026-10-05

**Added**
- Onboarding offers every dependency you're missing, not just the three that block startup: an "Also useful" group for `gh`, `node`, `tmux`, Tailscale and Homebrew, which never blocks Continue.
- `node` and `tmux` are checked at all now. Neither was, so the Ship page's README and deck buttons and the tmux session mode could fail with nothing on the setup screen to explain why.
- Homebrew is checked, because it is how `gh`, `node` and `tmux` get installed for you.
- Settings → Setup check can install too, instead of only copying the command to your clipboard.
- Each check carries the exact command its Install button would run, so the screen shows a button for what can be installed unattended and the instructions for what can't.
- An ignored test that prints this Mac's doctor table: `cargo test --lib doctor -- --ignored --nocapture`.

**Fixed**
- The doctor's own header claimed "Node is no longer needed" — untrue since the deck kit landed in #241.
- `gh` advertised `brew install gh` as its fix with no check that Homebrew existed. Brew-based installs are now offered only when brew is actually present; without it the screen gives instructions instead of a button that fails.
- Missing entries for #243 and #244 (below) — the check in #243 caught both, including its own.

## #244 — fixes from a full click-through of the app

merged 2026-10-05 · authored and merged by @aryanmotgi

**Fixed**
- Touches `BridgePanel.tsx`, `NavRail.tsx`, `Settings.tsx` and `SpacePage.tsx`. (Not my change; described from its title and file list only.)

## #243 — a per-PR record of what was added and fixed

`docs(changelog)` · merged 2026-10-05

**Added**
- This file: an Added/Fixed list per PR, one line per item.
- `scripts/changelog.cjs check` reports merged PRs with no entry, taking the list from git rather than from memory; `skeleton <n>` prints a block with the title and tag pre-filled.
- The convention in `CLAUDE.md`, including that entries say what changed for the person using Grill Me, not which function moved.

**Known gap**
- A PR cannot contain its own entry: the number doesn't exist until the PR is opened. So entries land in `## Unreleased` and get their number on the next pass — which is how #243's own entry came to be written here rather than in #243.

## #242 — a double-clicked app couldn't find claude

`fix(launch)` · merged 2026-10-05

**Fixed**
- Sessions never started in a bundled app: `zsh -lc 'exec claude …'` answered `command not found: claude`, because Claude Code installs to `~/.local/bin` and that is added by `.zshrc`, which only interactive shells read.
- The Ship page's README and deck buttons, the CI panel, the PR list and PR merge failed the same way — `node` and `gh` were looked up by name too.
- Those four `gh` failures were silent: the frontend has 129 `.catch(() => {})` against 463 `invoke` calls, so a click did nothing rather than reporting an error.
- A missing tool now says what to install instead of surfacing `No such file or directory`.
- The tmux session name is no longer pasted into a shell command string — it travels as an argument, so there is nothing left to escape.

**Added**
- `user_bin(name)` resolves a CLI once per launch and caches it: `zsh -lc`, then `zsh -ilc` (interactive, so a version manager's PATH is visible), then the standard bin directories, then nvm's versions directory for node.
- The binary is spawned by absolute path afterwards, so no command ever runs through a shell — a chatty `.zshrc` cannot corrupt a `gh --json` payload.
- The interactive probe is bounded at 5s via `kill_after`, so an rc file that waits on something cannot hang the app on first click.
- An `#[ignore]`d test that runs the resolver under the PATH a double-clicked app gets, with its `env -i` command in the doc comment.

**Notes**
- Sessions deliberately keep their login shell: the agent shells out for its own tool calls and needs that environment. Only the lookup of the agent moved out.
- Warnings 7 → 5; `agent_exec_line` is gone, replaced by `agent_flags` + `agent_bin_names`.

## #208 — stop unattended work spending Claude usage nobody asked for

`fix(usage)` · merged 2026-10-05

**Fixed**
- `claude -p` one-shots had no timeout, so a stuck call could run forever. All three paths now get a 120s watchdog.
- `ONE_SHOT_TIMEOUT_SECS` was declared but wired to nothing — the compiler said `never used`. It is now used at three call sites.
- A `commit-nudge` could repeat every hour indefinitely; it now asks once per pile.
- In-memory throttles re-armed on every restart, so quitting and reopening could re-trigger work that had already run.

**Added**
- A background-call counter in the top bar, next to the cost chip, because those calls are missing from the number beside it. Hidden at zero.
- `src/lib/nudge.ts` with tests for the nudge-once-per-pile policy.

## #207 — a session split against itself no longer eats half the window

`fix(layout)` · merged 2026-10-05

**Fixed**
- Splitting a session against itself reserved half the width for a pane that was never rendered, leaving dead space with no drag handle to reclaim it. One derived condition now drives both the width and the pane.

## #241 — one screen for the last two hours

`feat(ship)` · merged 2026-10-05

**Added**
- A Ship page: demo path, live preview, pitch readiness, deck, README and audit in one screen.
- `docs/deck-kit/` — one source document (`PITCH.<slug>.md`) renders the deck, the README and the audit, so they cannot drift apart.
- Three deck themes (carbon, press, signal) with seven diagram recipes drawn in the slide markup, so a theme swap recolours the diagrams too and nothing can 404.
- A README generator with showcase, dev-tool and plain layouts; any line with an unanswered token is dropped whole, then empty tables and headings are swept.
- `deck_kit_run`: a fixed list of four scripts, validated arguments, argv straight to node, no shell.
- `PITCH.template.md` realigned so its 14 sections feed the 13 slides.

**Fixed**
- The audit read a stale generated snapshot instead of the pitch, so edits to the pitch changed nothing it reported.
- The audit compared only section state, so progress inside a still-blocked section read as "nothing changed".
- The template had no `Notes:` field, so 11 slides silently lost their speaker notes on round-trip.
- `quadrant` took axis labels it could not place; `rings` drew smallest-first and vanished on the accent slide.

## #240 — don't abort at launch when the window is already KVO-subclassed

`fix(pill)` · merged 2026-10-05

**Fixed**
- The pill crashed at launch when AppKit had already swapped the window's class for `NSKVONotifying_TaoWindow`. The class sizes are compared first, and the NSPanel-only selectors now run only when the reclass actually succeeded.

## #239 — Code Space: a living map of what your agents are doing

merged 2026-10-05 · authored and merged by @aryanmotgi

**Added**
- `src/space/` — Code Space page, scene and lenses, with `src-tauri/src/space.rs` behind it. (Not my change; described from its title and file list only.)

---

## Earlier

Before this file existed. Titles are taken from git history as-is, with no
detail added that was not in the commit subject — see `git log` for the diffs.

- #238 — Code Space: fly through your folders in 3D
- #237 — Make the pill fast
- #236 — Pill: never steals focus, session chips, peek with actions, one-key answers
- #235 — Grill Me pill, phase 1
- #234 — Project icons: calm line glyphs
- #233 — Replace pixel art with professional marks
- #232 — What just happened card and Teach me
- #231 — Fast project switching
- #192 — feat(theme): Forge — warm ember/gold theme with gradient accent, done and problem colours; new default
- #191 — feat(launch): 3D launch animation (Ember swarm)
- #190 — feat(onboarding): interview with your own AI fills the workflow profile
- #189 — feat(onboarding): your workflow — quick form, what we know, five stages, up to 3 upgrades
- #188 — feat(onboarding): Connect your AI step — status, sign in, auto-detect, quick form fallback
- #187 — fix(sessions): new sessions no longer stall on Claude's trust question or vanish from the sidebar
- #185 — feat(catalog): built-in catalog of AI-coding tools, lookup, relay endpoint
- #184 — feat(onboarding): scan your setup, with permission, and show exactly what was read
- #186 — fix(team): room state polls failed — room_client rejected a null body
- #183 — feat(team): warn people and agents about shared files and contradictions
- #181 — feat(team): every agent hears what teammates' agents are doing
- #180 — feat(team): rooms over a hosted relay with invite links (Wasmer Edge)
- #179 — feat(onboarding): guided first-run setup in five steps
- #178 — feat(layout): simple layout behind a toggle
- #177 — fix: quick fixes for first-time users
- #176 — feat(mcp): push updates (resources + notifications) and actions with your OK
- #175 — feat(brain): auto decisions, brain search, drift alarm, starter kits
- #174 — feat(team): team chat with Claude in it
- #173 — feat(bridge): close the loop — live answers, auto review, hand-off replies, approve from phone
- #172 — fix: claude.ai steps aside for every overlay, not a hand-kept list; toasts bottom-centre
- #171 — fix(layout): every view adapts to a narrow center column; WebKit-safe auto-grow; opaque modals; readable Settings
- #170 — perf(build): parallel codegen, no LTO, desktop-only crate type
- #169 — perf: MCP server in Rust — `grill-me --mcp` replaces the Node script
- #168 — feat: redesigned first screens — mode chooser and project picker
- #167 — fix: opaque project picker in translucent mode; real app never shows sample data
- #166 — docs+tour: Flow gets a tour stop; roadmap rows for #162–#165
- #165 — feat(team): route hand-offs, questions and answers between teammates' Grill Mes
- #164 — feat(team): teammates' sessions in Flow — each Grill Me shares a session digest over the room
- #163 — feat: Flow view — the bridge drawn as a map
- #162 — fix: opaque consent dialog in plain words; own files never count as claims; banner clears traffic lights
- #161 — docs: roadmap progress (#153–#160) + security notes
- #160 — feat: first-run consent — say what Grill Me adds before touching any repo
- #159 — fix(listeners): thread per connection + timeouts on the API and room servers
- #158 — feat(mcp): per-project scoping — project arg on every tool, list_projects, writes land in the right project
- #157 — feat: Remove from my repos — clean uninstall of hooks and /ship
- #156 — feat(mcp): ship_status tool + test results in whats_new
- #155 — feat(team): share the brain's goal and notes across the room
- #154 — feat(doctor): Copy diagnostics — versions + setup check for bug reports, no chats or secrets
- #153 — fix(hooks): recognize our hooks by the ~/.grillme root, not the active project dir
- #152 — docs: production roadmap — what's done, decisions, phased plan
- #151 — fix(hooks): per-machine hooks go in settings.local.json; stop editing repo CLAUDE.md
- #150 — ci: cut macOS minutes (private repo bills 10x)
- #149 — ci: release workflow (universal macOS dmg on tag)
- #148 — feat(mcp): tool annotations
- #147 — feat(doctor): Setup check tab — what this Mac is missing and the command to fix it
- #146 — ci: typecheck, vitest, MCP parse check and cargo test on every PR
- #145 — fix(room): throttle wrong room codes; only the host Mac can create a room
- #144 — fix: find apps in subfolders; switched-off buttons look switched off
- #143 — chore: remove dead views; rebuild the welcome tour for today's layout
- #142 — fix(stall): only flag a loop when output changes and comes back
- #141 — fix(remote): queue restarts so the server always matches the settings
- #140 — fix(ui): status bar never wraps; icon-only labels when narrow
- #139 — claude.ai sees your sessions: remote grill-me MCP over Tailscale Funnel (audited)
- #138 — feat(team): team mode from anywhere over Tailscale
- #137 — feat(layout): dockable, closable side panels + Claude chat as a side panel
- #136 — feat(ui): Claude plan usage meter + declutter
- #135 — feat(ship, preview): ship queue + live app preview
- #134 — feat(kickoff): one-click hackathon start
- #133 — feat(automations): Automations page, auto-test, phone pings, reminders
- #132 — fix(bridge): see brand-new files; ignore Grill Me's own installs
- #131 — feat(brain): pitch writer, code quiz, past-hackathon lessons, team brain (round 3)
- #130 — feat(brain): mismatch alerts, self-updating board, deadline coach (round 2)
- #129 — feat(brain): shared project brain with automatic two-way sync
- #128 — feat(claude): Claude view — Grill Me Chat + embedded claude.ai
- #127 — fix(window): let the app be dragged by its top bar
- #126 — feat(bridge): connect the Claude app and Claude Code through Grill Me
- #125 — feat(ui): closer to Monocode — pill tabs, Workspace header, grouped chat
- #124 — feat(sessions): Monocode-style chat view for Claude sessions
- #123 — feat(ui): pixel-art project icons
- #122 — feat(ui): cleaner Monocode-style session view
- #121 — feat(sessions): rename a session by double-clicking its title
- #120 — feat(projects): add a project by picking its folder in Finder
- #119 — feat(ui): Grill Me touch — brand mark, /grillme built in, hack clock
- #118 — fix(ui): project picker shows app through it in gradient mode
- #117 — feat(ui): Monocode-style shell — gradient ground, new-session screen, status bar
- #116 — feat(ui): agent model logos on session cards + top tabs
- #115 — feat(ui): SF Mono code font + auto project colors
- #114 — feat(composer): multiline + / commands + @ file references
- #113 — feat(editor): syntax highlighting + line-number gutter
- #112 — feat(ui): restore translucent Monocode background (toggleable)
- #111 — fix(ui): opaque window + solid panels (kill drag lag) + quiet-mono polish
- #110 — fix(pty): reap claude child processes on app exit
- #109 — feat(room): carry live shared team state over the LAN room transport
- #108 — fix(diff-review): add real AI review to the pre-merge modal
- #107 — fix(quiet-hours): gate OS notifications on quiet hours, not just sound
- #106 — feat(dnd-export-presence): quiet hours, transcript export, self presence
- #105 — Richer empty states + drag-to-reorder sessions
- #104 — feat(cost-cap): auto-pause sessions that blow their token budget
- #103 — feat(ratelimit-tracker): team rate-limit indicator + soft token-budget warnings
- #102 — feat(stall-detector): flag stalled + looping sessions
- #99 — feat(watch-session): read-only live view of a teammate's terminal
- #100 — feat(request-help): flag a stuck session so the team gets eyes on it
- #101 — Add shared team decisions log (decisions-log)
- #98 — fix: dedupe blockingOverlayOpen after Wave B union merges
- #96 — snippet-library: save reusable prompts, insert into a session
- #95 — Add broadcast command fan-out to all sessions
- #94 — Add "new session from template" flow
- #97 — Add auto-checkpoint: periodic local snapshot commits
- #91 — Add AI release-notes generator
- #88 — feat(home): token burn chart replaces the dead "0 tokens spent" stat
- #90 — feat: inline activity feed panel on home dashboard
- #89 — feat: merge conductor — guided sequential merge-queue walk
- #92 — Add branch graph overlay: every branch vs main
- #93 — feat: PR dashboard overlay with CI status + one-click squash-merge
- #87 — fix: cinema mode Esc + clearer exit button
- #86 — Add AI smart task-assignment suggestions
- #85 — feat: AI "explain what this session is doing" affordance
- #84 — Add one-click session handoff (ai-session-handoff)
- #83 — feat: AI pre-merge conflict prediction (predict_conflict)
- #82 — feat: AI auto-standup summary
- #80 — feat: full-bleed session cinema focus mode
- #79 — feat: keyboard-first session nav + shortcut cheatsheet
- #77 — Spotlight onboarding tour: highlight the real UI
- #78 — feat: upgrade ⌘K palette — recents, fuzzy match + highlight, inline teammate actions
- #75 — distinct-sounds: distinct per-event notification tones + volume
- #76 — Add cyan-noir and synthwave themes to the theme pack
- #74 — feat: Token & cost dashboard overlay
- #73 — feat: Kanban task board overlay (panel-kanban)
- #72 — feat: presence map overlay — who is touching what right now
- #71 — feat: session timeline scrubber overlay
- #70 — Add cross-session search overlay (panel-cross-search)
- #69 — Diff review board: every session's branch-vs-main diff in one overlay
- #68 — Phase 3: Home dashboard redesign — hero Needs-you, live team pulse, budget meter
- #67 — Phase 2: Settings redesign — centered glass modal, icon rail, aligned team table
- #66 — feat: Ember HUD visual design system — depth, glass, second accent
- #65 — feat: leave/back buttons on every team-mode screen — no more dead ends
- #64 — feat: 'Switch mode' in the overflow menu to return to ModeSelect
- #63 — fix: start the room feed when team mode is picked at runtime
- #61 — feat: team setup flow — brainstorm → plan → tasks → assign → workspace
- #59 — feat: team mode TeamStart + Lobby screens with live room feed
- #60 — feat: ModeSelect screen + solo mode strips
- #62 — feat: team-mode room protocol backend — LAN room server, state persistence, claude helpers
- #58 — chore: regenerate tracked hook config with quoted commands
- #57 — fix: merge-safe shared-state writes — concurrent updates no longer destroy data
- #55 — fix: git_review UTF-8 panic — truncate diffs at char boundaries
- #54 — fix: enforce view-only permission in the backend, not just the UI
- #53 — fix: auto-pause never hides a session that needs a human
- #56 — feat: make /ship real — install the slash command into member repos
- #52 — fix: four fresh-eyes bugs at the pty-id and fake-data seams
- #51 — fix: final-audit defects — seed cache poisoning, stale spinner guard, focus rings
- #50 — docs: final judge-ready polish pass
- #49 — fix: ring buffer truncation and tail slices respect UTF-8 boundaries
- #48 — feat: file watcher picks up teammates added after startup
- #47 — feat: conflict radar — pre-merge file overlap between members' branches
- #46 — feat: actionable failure when the claude CLI is missing
- #45 — fix: deliver fan-out briefs on session readiness, not a blind timer
- #44 — fix: three demo-critical flow fixes
- #38 — refactor: unify token/mem/time formatting into src/lib/format
- #39 — fix: Esc double-close regressions and weak-token migration
- #41 — fix: four IO robustness fixes — log rotation, zombie reap, torn tails, offset stall
- #40 — fix: OSC parsing — BEL terminator false bells, ST terminators, UTF-8 line history
- #37 — fix: eight UI paper cuts from the detail audit
- #42 — fix: reliability pass on frontend feeds — no more dead-on-arrival or piled-up pollers
- #43 — docs: rewrite README for the real app; polish first-run experience
- #36 — docs: round-2 upgrade pass — fact-checked against code, ship-check skill added
- #35 — fix: stale pty reader thread can no longer kill a respawned session
- #31 — test: add first unit test suite for src-tauri pure functions
- #32 — Harden PreToolUse safety blocklist and fail closed on bad config
- #34 — fix: quote and validate interpolations in install_hooks commands
- #33 — fix: tolerate mutex poisoning and block interactive git prompts
- #30 — Accessibility foundations: modal semantics, keyboard rows, status labels
- #29 — fix: eliminate shell-string injection in remote/tmux pty spawn
- #28 — Block path traversal via project ids
- #27 — Deep-link Settings tabs from the feature catalog
- #26 — Harden localhost API token: CSPRNG generation, 0600 perms, exact Bearer match
- #25 — Feed the full feature catalog into the ⌘K palette
- #24 — Make Esc close every overlay, topmost first
- #23 — feat: discoverability quick wins from audit round 1
- #22 — Hackathon docs: pitch, demo runbook, and 4 Claude Code skills
