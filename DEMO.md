# Grill Me — 3-Minute Demo Runbook

One rule from every winning hackathon demo: the product is doing the thing within
30 seconds, and every beat shows exactly one idea. This script is timed to a hard
3:00. Practice it twice with a timer before judging. Never overrun.

The story arc: **chaos → visibility → safety → scale → ship.**

---

## Cast and stage

- **Driver** runs the app and mouse. **Narrator** speaks. (Can be one person; two is smoother.)
- Grill Me open full-screen in the **session view**, 4 live claude-code sessions in the
  left rail: `aryan`, `maya`, `dev`, `sam` (or your real 4 names from `~/.grillme/config.json`).
- Second display or phone timer visible to the driver only.

---

## Beat-by-beat script

### 0:00 – 0:20 — Cold open: the chaos, then the answer

**On screen:** Home dashboard (mission-control view). Four session cards, each with a live
status dot — two green (working), one hollow (idle), one about to go amber. Task board,
merge-turn indicator, and activity timeline visible in one glance.

> "Four of us. Four Claude Code agents. Last hackathon that meant forty terminal tabs,
> one person silently blocked for twenty minutes, and somebody force-pushing over main.
> This is Grill Me — one window where the whole team's agents live. These are four **real**
> Claude Code sessions on real ptys, running right now."

**Driver:** hover a session card so the live branch + open-file presence shows.

### 0:20 – 0:50 — Needs-input alert: nobody blocks silently

**On screen:** `maya`'s dot flips to pulsing amber, the attention badge in the top bar
increments, and a distinct alert tone plays. Driver clicks the badge — jump straight
into her terminal, where Claude is asking a question.

> "Maya's agent just hit a question. We didn't find out by walking over — the app heard it.
> Our Rust backend parses the raw pty stream, catches the OSC 9 terminal notification
> Claude emits, cross-checks it against Claude Code's own hook events, and fires an alert.
> Anyone on the team can jump in and unblock her in five seconds."

**Driver:** type the answer into Maya's pane, press Enter, dot goes green. Back to overview.

**Trigger:** pre-seed Maya's session with a prompt that must ask a clarifying question, e.g.
`Ask me whether we should use REST or GraphQL before writing any code.` Backstop trigger if
it answers itself: run `printf '\e]9;needs input\a'` in her pane's shell — same OSC path fires.

### 0:50 – 1:20 — Safety: the blocklist catches the disaster

**On screen:** Driver switches to the sacrifice session (`dev`) and asks Claude to run the
seeded destructive command (e.g. "run `git push --force origin main`"). The PreToolUse hook
rejects it: **"BLOCKED by Grill Me safety blocklist"** appears in the terminal and Claude
turns to ask for explicit confirmation instead of executing.

> "Here's the part that saves your hackathon. Everyone runs agents with permissions skipped —
> it's fast, and it's how main gets destroyed. Grill Me installs a PreToolUse hook into every
> session: a regex blocklist that exit-2 denies force-pushes to main, `rm -rf /`, `DROP TABLE` —
> **even under `--dangerously-skip-permissions`**. The agent has to come back and ask a human.
> And every tool call every agent makes lands in a shared audit log."

**Driver:** flash the audit trail in the Team tab (one second — don't dwell).

### 1:20 – 1:55 — Conflict prediction: don't step on each other

**On screen:** Two sessions touch the same file; the amber conflict banner appears full-width.
Driver clicks it — the claimed-files list flashes the overlapping file. Show the live lock
with its owner.

> "A native file watcher tracks what every agent is editing across all four repos. The moment
> two people's agents touch the same file, this banner fires — before the merge conflict
> exists, not after. File claims live for thirty minutes and survive restarts."

### 1:55 – 2:25 — Fan-out: one checklist becomes a fleet

**On screen:** Driver clicks **fan out**, pastes a 3-line checklist
(two independent items + one that shares wording with the first), clicks **analyze & spawn**.
Two new sessions appear in the rail within seconds — each in its own fresh git worktree, each
a real Claude session already typing — and one task sits on the board as "waiting on dependency".

> "Paste a checklist. Grill Me infers which items depend on each other, creates a git worktree
> per independent task, spawns a live Claude session in each, and briefs it. The dependent task
> auto-starts when its blocker is marked done. There's also a localhost API and a `grillme` CLI —
> so an agent can spawn and drive other agents."

### 2:25 – 2:50 — Review & ship: nothing hits main unreviewed

**On screen:** Driver clicks **review & ship** on `sam`'s finished session. The pre-merge review
modal opens: commits ahead of main, diffstat, full diff. Driver clicks **approve & ship** —
a toast confirms `/ship` is now running inside Sam's own session. Merge-turn indicator advances
to the next teammate.

> "When an agent says it's done, a human looks at the actual diff — right here. Approve, and
> Grill Me types `/ship` straight into that agent's terminal: tests, then push. Request changes,
> and it opens a blocking thread in their inbox instead. The merge queue in the top bar means
> four people never race for main."

### 2:50 – 3:00 — Close

**On screen:** Back to the home dashboard: all four dots green, token usage per teammate
(parsed from real Claude transcripts) visible in the Team tab.

> "Real ptys, Rust state, terminal-protocol parsing, and Claude Code hooks — wrapped in one
> team-first mission control. Every agent tool built this year is solo-first. Teams are where
> the chaos actually is. Grill Me. Try it — we're shipping it to our own next hackathon."

Stop talking at 3:00. Hard stop mid-sentence if needed — judges score discipline.

---

## 60-second fallback path

Use this when the slot gets cut, you start late, or the full run breaks mid-demo.
Two beats only — **visibility** and **safety** — they carry the product. Cue both
triggers *before* you start talking; in sixty seconds there is no time to wait for
anything organic.

### 0:00 – 0:10 — Open on the dashboard

> "Four real Claude Code sessions — real ptys — one window. Status comes from
> parsing the terminal protocol and Claude Code's own hooks, not polling."

### 0:10 – 0:35 — Needs-input

Fire the trigger immediately: seeded prompt if it's already pending, otherwise
`printf '\e]9;x\a'` in Maya's pane — don't wait for a natural one. Amber dot, tone,
click the badge, type the answer, dot green.

> "An agent asked a question; the app heard it in the byte stream. Anyone on the
> team can unblock anyone. Nobody sits blocked for twenty minutes."

### 0:35 – 0:55 — Blocklist

Ask the sacrifice session to force-push main. Show the **BLOCKED** line.

> "Everyone skips permissions. Grill Me's PreToolUse hook exit-2 denies destructive
> commands anyway — even under `--dangerously-skip-permissions` — and audits every
> tool call from every agent."

### 0:55 – 1:00 — Close

> "Fan-out, pre-merge review, merge queue, conflict radar — all live in this build.
> Grill Me: the team layer for Claude Code."

**Rules for the short path:** skip fan-out and review entirely — spawning and diff
loading eat too much of a minute. Never switch views more than three times. If even
the needs-input trigger misfires, go straight to the blocklist beat and give it the
full thirty seconds — it is the single most memorable moment.

---

## Pre-demo setup checklist (start 20 minutes before slot)

**Sessions (T-20):**
- [ ] `npm run tauri dev` (or the built app). Confirm window renders in the ember theme.
- [ ] All 4 teammates in `~/.grillme/config.json` with valid `repoPath`s; hooks installed for each
      (Team tab shows hooks OK — this also refreshes `~/.grillme/bin/grillme-hook` and the blocklist).
- [ ] All 4 ptys warmed: click into each session so `claude` is past its startup screen
      (never demo the "starting claude…" overlay). Give each a small real task so dots are green.
- [ ] Maya's session seeded with the question-forcing prompt (see beat 2). Do this LAST so the
      needs-input fires on cue, not early. If it fires early, mark answered and re-seed.
- [ ] Sam's session has 2-3 real commits ahead of main so the review diff is non-empty.

**Data (T-15):**
- [ ] Task board seeded (`tasks.json`): ~5 tasks, mixed statuses, believable titles.
- [ ] One inbox message thread visible; standup log has a few lines.
- [ ] Fan-out checklist text staged in a notes app, ready to paste (don't type live).
- [ ] Blocklist confirmed at `~/.grillme/blocklist.json`; dry-run the blocked command once
      the night before, never on demo day.

**Environment (T-10):**
- [ ] Sounds ON: Settings → mute off, needs-input + conflict tones enabled. Mac volume ~70%.
      Tones are WebAudio-generated — no assets, works offline.
- [ ] macOS Do Not Disturb ON (system, not app — no iMessage over the demo).
- [ ] Close everything else. Dock hidden. Display sleep off. Power connected.
- [ ] Quick-switcher check: ⌘K opens the palette (it carries the full feature catalog —
      any feature is reachable by name if you need to jump somewhere unplanned);
      ⌘. focus mode off; dense mode set to taste.
- [ ] Esc reflex: Esc closes any overlay, topmost first. If a modal is up that you don't
      want, mash Esc and keep talking — never mouse-hunt for a close button on stage.
- [ ] Timer visible to driver.

**If wifi dies (decide at T-5, not live):**
Nearly everything is local — ptys, git, worktrees, file watcher, locks, sounds, review diffs
all work offline. Only the Claude API (agents responding) and CI status need network.
1. **Plan A:** phone hotspot. Test the hotspot at T-15.
2. **Plan B:** Demo-mode toggle in the top bar — the full UI runs on believable sample data;
   demo every surface (alerts, board, review modal) and narrate: "the agents are live over the
   network; here's the recording of this exact flow" → Plan C.
3. **Plan C:** screen recording of a full successful run, on the desktop, filename `demo.mp4`.
   Record it the night before. This is non-negotiable — every winning-demo guide says so.

---

## Failure recovery lines (say these, don't freeze)

| Failure | Line | Action |
|---|---|---|
| Needs-input doesn't fire | "Claude's feeling confident today — here's the same signal by hand." | `printf '\e]9;x\a'` backstop in Maya's pane |
| A session pane dies | "Sessions crash — that's why restart is one click." | Click the restart card; move to next beat while it boots |
| Fan-out spawn errors | "Worktree race — the two that made it are already working." | Point at spawned sessions; skip the failed one |
| Blocklist doesn't trigger | "It pattern-matched safe — let me show you the list it enforces." | Open Settings → safety, show blocklist JSON |
| Claude API slow/rate-limited | "Rate limits are real — notice the app *detected* that and flagged the session." | The rate-limit detection IS a feature; sell it |
| Review diff empty | "Clean tree — Sam already shipped. Here's the audit trail proving it." | Show audit tail / activity timeline |
| App hard-crashes | "Native apps, live demos. While it relaunches — 30 seconds of how it works." | Relaunch (state persists in ~/.grillme); narrate architecture |
| Running out of time | Switch to the 60-second fallback path from wherever you are | Jump to the blocklist beat; close from there |
| Total loss | "Murphy wins the demo, not the product — here's this exact flow recorded an hour ago." | Play `demo.mp4`, keep narrating live |

Golden rule: never apologize twice, never debug on stage, never stop talking.
