# Grill Me — build plan

Written 2026-10-05. The point of this file is to survive a cleared context: it
records what is actually built, what is only half-built, and what was discussed
but never started. Status lines are facts, not intentions — update them when
something lands, and say *where* it landed (branch, PR, commit).

**Conventions that apply to everything below**
- Every PR gets a `CHANGELOG.md` entry (see `CLAUDE.md`). `node scripts/changelog.cjs check`.
- Never push to `main`; branch + PR. No stacked chains.
- Edits are made through Bash, never the Edit/Write tools — the user does not want diffs in the transcript.
- Open URLs with `open -a "Google Chrome"`, never the system default.

---

---

# THE WORK QUEUE

Everything open, in the order to do it. Work top to bottom. Tick items as they
land and say where they landed. Sections below this one are reference for *why*.

### Step 1 — Save what exists  ⟵ START HERE
Five finished, tested features live only in the working tree. Nothing else starts first.

- [ ] 1.1 Commit as four separate commits:
      a. Settings restructure (`Settings.tsx`, `DoctorTab.tsx`)
      b. Progress-bar glow (`styles.css`)
      c. Manager agent (`manager.ts`, `manager.test.ts`, `lib.rs`)
      d. Teammates fixes + preview (`TeammatesPage.tsx`) + `PLAN.md`
- [ ] 1.2 Split `feat/quiet-chrome` into reviewable PRs (it holds 5 features)
- [ ] 1.3 Merge or close **#245** (onboarding installs — CI green since this morning)

### Step 2 — Make it installable by a teammate
At a hackathon people install on the day. Aryan cannot open the app at all today.

- [ ] 2.1 Create a *Developer ID Application* certificate (user — needs Apple login)
- [ ] 2.2 Verify locally: `security find-identity -v -p codesigning`, then a signed `tauri build`
- [ ] 2.3 Add the six GitHub secrets `release.yml` already expects
- [ ] 2.4 Tag `v0.2.0`, confirm the draft release carries a notarized `.dmg`
- [ ] 2.5 Fix the `.dmg` being labelled `x64` when the contents are arm64

### Step 3 — Shared sessions, the cheap way
One room, one Wi-Fi. ssh over LAN is fair to require; a relay protocol is not.

- [ ] 3.1 Start local sessions inside tmux (`exec tmux new -A -s grillme-<id>`), opt-in per session
- [ ] 3.2 Make "Open their tmux session" actually join a teammate's running session
- [ ] 3.3 Needs tmux installed — depends on #245 landing (Step 1.3)

### Step 4 — The graded artifact
- [ ] 4.1 Fill the six blocked pitch sections (user: problem, market, model, traction, team, ask)
- [ ] 4.2 Build `SUBMISSION.md` — last of the original four documents, never written
- [ ] 4.3 Publish the Grill Me deck as an artifact (only DealGhost has live URLs)

### Step 5 — Loose ends, cheap
- [ ] 5.1 Animated sheen still sweeps the limit bars — remove? (DECISION)
- [ ] 5.2 Dormant `pill.rs` / `pillBridge.ts` — delete for real or keep? (DECISION)
- [ ] 5.3 Shortcuts tab — kept as its own tab against the earlier plan of folding it (DECISION)
- [ ] 5.4 Manager `model: inherit` — pin something cheaper for a polling agent? (DECISION)
- [ ] 5.5 CI skips the MCP tests (`--exclude src/lib/mcpServer.node.test.ts`)
- [ ] 5.6 `BLOCKS.md` — 25 blocks, used by nothing. Wire up or delete.

### Step 6 — Native footer (deprioritised: nice, wins no hackathon)
- [ ] 6.1 DECISION: chain or replace the user's `~/.claude/statusline.sh` — blocks the rest
- [ ] 6.2 Statusline shim capturing the blob per session
- [ ] 6.3 Footer strip under the chat view
- [ ] 6.4 Settings for what it shows

### Step 7 — Later / blocked
- [ ] 7.1 Manager per-action attribution (MCP `Ctx` has no caller identity)
- [ ] 7.2 Manager launcher ("start a manager session" button)
- [ ] 7.3 Live view of a teammate without ssh — protocol work, superseded by Step 3
- [ ] 7.4 "What they can do" half of the sharing setting — blocked until a control path exists
- [ ] 7.5 Homebrew cask + Tauri updater (`plugins: null` today)

### Open decisions, collected
5.1 sheen · 5.2 pill code · 5.3 Shortcuts tab · 5.4 manager model · 6.1 statusline
Plus: how to split the branch in 1.2, and merge-or-close on #245.

---

## Who this is for

**Hackathons, now. Other applications later** (decided 2026-10-05).

This is the lens for every trade-off below. A hackathon team is 2–5 people in one
room, on one Wi-Fi, for 24–48 hours, who must hand in something that demos. So:

- **Setup time is the enemy.** Minutes spent installing are minutes not building.
  Onboarding, the dependency installer and signing all matter more than they
  would for a tool people adopt over weeks.
- **Co-located beats cross-internet.** Teammates are on the same network. LAN and
  ssh are reasonable to require; a global relay protocol is not the first thing
  to build.
- **The deliverable is the demo.** Pitch, deck, README and submission are not
  nice-to-haves — they are the thing being graded.
- **Nothing can need a week to pay off.** Features that only make sense over
  months (long-horizon DNA, deep history) are correct to keep, but they are not
  what to spend the next build on.

## Where things stand right now

| | |
|---|---|
| Branch | `feat/quiet-chrome`, 1 commit ahead of `main` |
| Open PR | **#245** onboarding installs — CI green, **unmerged** |
| Uncommitted | Settings restructure, progress-bar glow, manager agent, this file |
| Risk | Three finished features are uncommitted. Commit before starting anything new. |

---

## 0. Land what is already finished  ← DO THIS FIRST

Nothing below should start until this is done. Three tested, building features
exist only in the working tree.

- [ ] **Commit the uncommitted work** as three commits, not one:
  - Settings restructure (`Settings.tsx`, `DoctorTab.tsx`)
  - Progress-bar glow removal (`styles.css`)
  - Manager agent (`manager.ts`, `manager.test.ts`, `lib.rs`)
- [ ] **Split `feat/quiet-chrome`.** It holds four features; that is too much for one PR.
      Suggested: (a) chrome + settings + glow, (b) Teammates page + share policy, (c) manager agent.
- [ ] **Decide #245.** Open since this morning, CI green. Merge or close it.

---

## 1. Manager agent — BUILT, uncommitted

A real Claude Code agent (not a skill — the skill version was removed) that
watches every session and reports who is blocked, what drifted, who collides.

**Done**
- `src/lib/manager.ts` — modes (`off` / `report` / `act`), `managerAgentFile(mode)`
  generating a real `.claude/agents/manager.md`, hourly action cap, usage roll-up. 18 tests.
- `manager_agent_write` Tauri command — writes/removes `<repo>/.claude/agents/manager.md`.
- Settings → Sessions → Manager card: mode, which session, cap, live usage.
- Report mode is **structural**: the writing tools are absent from the agent's
  `tools:` line, so Claude Code never offers them. No `Bash`/`Edit`/`Write` in either mode.

**Not done**
- [ ] **Per-action attribution.** The MCP's `Ctx` carries no caller identity, so a tool
      call cannot be traced to the manager. Only the manager *session's* tokens and cost
      are attributable today. Fix: the MCP server is spawned per session
      (`claude_panel.rs:84`), so an env var in its config would carry the caller.
- [ ] **`model: inherit` is expensive.** A polling agent on Opus costs real money.
      Decide whether to pin Haiku/Sonnet.
- [ ] **No launcher.** You pick an existing session as the manager; there is no
      "start a manager session" button.
- [ ] The hourly cap is a budget, not a sandbox — it bounds what Grill Me performs,
      not what the agent can reach. The UI says so. Revisit if it matters.

## 2. Native footer for the chat view — the WRAPPER IS ALREADY BUILT

**Correction to an earlier draft of this file, which called this "nothing built".**
That was wrong. `src/components/ChatView.tsx` (393 lines) is the wrapper: it parses
the *transcript* — `parseTranscript` in `src/lib/chat.ts` — and renders Markdown,
turn cards, per-turn cost and save points as native UI. It is not a terminal. The
Terminal tab is the raw pty sitting beside it, for when you want the real thing.

So the Chat tab already replaces how Claude Code looks. What is missing is only the
**status footer** — the strip of numbers at the bottom of the terminal.

Already native in the top bar: model family, session spend, background calls.
Missing: context %, the 5-hour and weekly bars, permission mode, effort level,
the model's display name.

**What was established (do not re-research this)**
- The statusline is a **hook**: Claude Code pipes JSON to the command in
  `~/.claude/settings.json → statusLine.command` and renders whatever it prints.
- That JSON holds everything missing above: `model.display_name`,
  `context_window.*`, `rate_limits.five_hour/seven_day` (pct + resets_at),
  `cwd`, `effortLevel`, `extra_usage.*`, `session.start_time`.
- **The path already works today**: the user's `~/.claude/statusline.sh` writes
  `/tmp/claude/statusline-usage-cache.json`, and `src-tauri/src/automations.rs:327`
  reads it. That is where the Overview's 5-hour and weekly bars come from.

**Blocked on one decision** — chain or replace the user's `statusline.sh`?
Recommendation: **chain** (call their script, capture the JSON, keep their footer
printing). Reversible, and does not touch a file they tuned by hand.

**Then build**
- [ ] A statusline shim Grill Me installs, capturing the full blob per session to
      `~/.grillme/statusline/<session>.json`.
- [ ] A footer strip under the chat view: context %, 5h/weekly bars, permission
      mode, effort. Themed, not ANSI.
- [ ] Settings for what the footer shows.

## 3. Seeing other people's sessions — PARTIAL

**Done** (committed in `196cc77`)
- Teammates page in the hub: people left, their sessions right — title, status,
  branch, files changed, tests.
- "Take over their session" for a teammate configured with an ssh host + tmux
  session: `ssh -t -- <host> tmux new -A -s <name>` attaches to the terminal they
  are already in, so one terminal is shared. The plumbing already existed in
  `pty_ensure`; nothing in the UI could reach it.

**Correction (2026-10-05, after testing against a real teammate)**
Local sessions spawn `zsh -lc 'exec <claude>'` — **not** inside tmux. So
`tmux new -A -s X` over ssh does not join a teammate's running session; `-A`
creates a new empty one and you land in a fresh shell on their Mac. The attach
path only works for a session *started* through it. A session someone started
themselves cannot be joined after the fact.

**The cheap route to this whole feature** — start local sessions inside tmux
(`exec tmux new -A -s grillme-<id> …`). Then ssh + attach joins the real
session, both typing, with no relay protocol work at all. Costs: tmux must be
installed (it is in the onboarding list now), and it changes every spawn, so it
wants to be opt-in per session. **Try this before building §3's streaming.**

**Not done**
- [ ] **Sessions inside tmux**, per above — the cheapest path to shared sessions.
- [ ] **Live view without ssh.** What syncs over the room is *metadata*
      (`TeamSession`: title, status, branch, files) — not terminal output. Watching a
      teammate's session without ssh would need output streamed over the relay.
      This is the real gap and it is a protocol change, not a UI change.
- [ ] **No remote control path.** Nothing in the room can send input to another
      Mac's session. The only way is ssh, governed by ssh keys, not by Grill Me.
      This is why the sharing setting has no "what they can do" half.

## 4. Sharing / privacy — BUILT, committed in `196cc77`

- "What teammates can see": `nothing` / `status` / `work` / `files`.
- Enforced in `digestSessions` — the one place this Mac turns sessions into
  something the room can read. A withheld field is never published.
- **Known limit, pinned by a test**: at `work` the one-line summary can still name
  a file ("editing relay.rs"). Pick `status` if no filename should leave the Mac.
- [ ] A "what they can do" half, once a control path exists (see §3).

## 5. Chrome cleanup + Settings — BUILT (chrome committed, Settings not)

- Committed: solid tab bar, Shell/Audit tabs gone, top-bar buttons gone, Peek panel
  gone, floating pill no longer launches (`pill.rs` / `pillBridge.ts` left dormant
  on purpose — a few hundred lines of objc2 that took three attempts).
- Uncommitted: Settings 9 tabs → 7, 31 rows → 27, new **Sessions** tab,
  danger zone, five rows cut. Progress-bar glow removed.
- [ ] Decide whether the dormant pill code gets deleted for real.
- [ ] Animated sheen still sweeps across the limit bars — remove if unwanted.

---

## Older threads, still open

- [ ] **Code signing.** The `.app` is adhoc-signed, so Gatekeeper refuses it on any
      other Mac. Needs an Apple Developer account — the real distribution blocker.
      The `.dmg` is also mislabelled `x64` (contents are arm64; Tauri naming quirk).
- [ ] **Pitch content.** `PITCH.grillme.md` is 7/13. Blocked on the user's answers:
      problem, market, model, traction, team, ask. `node ~/.grillme/deck-kit/catalog.cjs grillme`.
- [ ] **`SUBMISSION.md`** — the last of the original four documents, never built.
- [ ] **`BLOCKS.md`** — 25 blocks, referenced in one comment, used by nothing.
- [ ] **Publish the Grill Me deck** as an artifact. Only DealGhost has live URLs.
- [ ] **CI skips the MCP tests** (`vitest --exclude src/lib/mcpServer.node.test.ts`).
      They pass locally; nothing runs them on CI.

## Verification commands

```
npx tsc --noEmit
npx vitest run                                    # 698 tests
cargo test --lib --manifest-path src-tauri/Cargo.toml   # 304 tests
node scripts/changelog.cjs check
npx tauri build --no-bundle                       # release binary
# the bare-PATH check a bundled app actually gets:
env -i HOME="$HOME" PATH=/usr/bin:/bin:/usr/sbin:/sbin \
  cargo test --manifest-path src-tauri/Cargo.toml --lib user_bin -- --ignored --nocapture
```
