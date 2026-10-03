---
name: demo-drive
description: Stage-manages the Grill Me live demo — pre-flight checks via the grillme CLI, seeding demo tasks/messages through ~/.grillme JSON files, resetting state between rehearsals, and firing the fan-out / inbox / needs-input / conflict / safety beats on cue. Use when the user says "demo prep", "rehearsal", "pre-flight", "reset the demo", "seed demo data", "fire the fan-out", or is about to present Grill Me live.
---

# Demo Drive: Grill Me

You are the stage manager. Everything uses the real transport: the `grillme`
CLI, the localhost API, and JSON files under `~/.grillme` the app polls.

## Ground truth

- **CLI:** `~/.grillme/bin/grillme` (reinstalled by the app on launch). Not on
  PATH — run `export PATH="$HOME/.grillme/bin:$PATH"` first.
- **API:** `http://127.0.0.1:4517`, bearer token at `~/.grillme/api-token`
  (32 CSPRNG bytes hex, mode 0600). Server runs inside the app — no app, no API.
- **Session ids** = teammate ids: bare for the default project (`Aryan`,
  `Shreyash`, `Nandan`, `Rithik`), prefixed `<projectId>:<memberId>` for any
  other active project (`ptyIdFor` in `src/store.ts`).
- **Always global** at `~/.grillme/`: `settings.json`, `projects.json`,
  `blocklist.json`, `api-token`, `bin/`.
- **Per-project** (root for the default project, else `~/.grillme/projects/<id>/`):
  `config.json`, `tasks.json`, `messages.json`, `team.json`, `events.jsonl`,
  `audit.jsonl`, `standup.log`.
- Polling: tasks/messages/team **2 s**, git 5 s (10 s Rust cache), pty 2 s —
  seeded files appear on screen within ~2 s, no restart needed.

```sh
grillme sessions             # JSON: [{id, alive, quietMs, bell, oscNotify, tail[], recording, startedAt, paused}]
grillme send <id> <text...>  # send text + Enter (newline appended — submits the prompt)
grillme type <id> <text...>  # type WITHOUT Enter (stage it, send later)
grillme read <id> [lines]    # last N (default 40) ANSI-stripped screen lines
grillme new <id> <branch>    # git worktree add -b <branch> ../worktrees-<id> main,
                             #   registers <id> in config.json, spawns a live claude session
```

Dramatic pause: `type` stages the prompt; `send <id> ""` later fires the Enter.

## Pre-flight (T-10 minutes, in order)

```sh
export PATH="$HOME/.grillme/bin:$PATH"
grillme sessions    # silent success = FAIL; expect a JSON array (proves app + API + token)
for id in Aryan Shreyash Nandan Rithik; do echo "== $id =="; grillme read "$id" 8; done
```

Then verify by hand:

- **Lazy spawn** — teammate panes only start `claude` on first view. Click
  through every pane once so nothing cold-boots on stage.
- **Auto-pause** SIGSTOPs sessions quiet ~5 min; viewing resumes instantly,
  but pre-warm every pane right before you start.
- **Sounds** — in global `~/.grillme/settings.json`: `muteAll` absent/false,
  `notifyMessages`/`notifyNeedsInput` not false, `sounds` map (`message`,
  `mention`, `needs-input`, `conflict`) has no `false`. Settings are held in
  memory — change via the Settings UI, or edit the file before launching.
  macOS Focus/DND OFF, volume up; live-test with a blocking message (below).
- **Hooks** — each worktree's `.claude/settings.json` mentions `grillme-hook`;
  the app reinstalls on launch — restart the app if missing.
- **Demo view gotcha** — TopBar "Demo view" hides `.demo-hide` chrome,
  including the fan-out button and the ⌘S ship *button* (the ⌘S keystroke
  still works). Fire fan-out before toggling, or drive it from the CLI.

## Seeding demo state

Keep golden copies in `~/.grillme/demo-seeds/` (`tasks.json`, `messages.json`,
`team.json`). The app dedups messages by `id` per app-run — every rehearsal
needs fresh message ids (timestamp them). Real schemas:

```jsonc
// tasks.json — array of Task
{ "id": "t1", "title": "Embedded pty terminals", "owner": "Aryan",
  "status": "in-progress",         // not-started | in-progress | done
  "files": ["src-tauri/src/lib.rs"],
  "blockedBy": "t3",               // optional task id — renders the dependency chain
  "startedAt": 1789487192889 }     // optional epoch MILLISECONDS — drives the live timer

// messages.json — array of Message
{ "id": "b-1789497259",            // MUST be unique per app-run (dedup key)
  "from": "Nandan",                // != viewer ("Aryan") or no notification fires
  "to": "Aryan",                   // or "all"
  "text": "Blocked: inbox types collide with my branch, need your call",
  "answered": false,               // false => counts in the attention badge
  "ts": "11:06",                   // display string, not epoch
  "kind": "blocking",              // question | fyi | blocking | proposal
  "context": { "task": "inbox", "file": "src/components/Inbox.tsx", "branch": "feature/inbox" } }

// team.json
{ "mergeQueue": ["Aryan", "Shreyash", "Nandan", "Rithik"],
  "sponsor": [ { "sponsor": "Anthropic", "requirement": "...", "done": true } ] }
```

Notification rules (`feeds.ts`): `kind:"fyi"` goes to the silent digest
(default 15 min) — never use fyi for a live beat. `"blocking"` interrupts with
the mention tone and a `BLOCKING from …` banner. `@Aryan` in the text upgrades
any kind to a mention.

## Firing beats on cue

**Fan-out (the wow moment).** UI: SessionList → `fan out` → paste checklist →
`analyze & spawn` (hidden in demo view). A line sharing 2+ meaningful words
with an earlier line becomes its dependent and waits on the board. Rehearsed
checklist: `add login page` / `add signup page` / `style login page` (line 3
waits on line 1). CLI (works in demo view): `grillme new agent-a fan/agent-a`,
`sleep 6`, `grillme send agent-a "Work on this task: add a login page. When
done, tell the user and stop."`, `grillme read agent-a 15`. `new` fails if the
branch or worktree path already exists — reset (below) between rehearsals.

**Inbox beat** (blocking message + tone within 2 s): insert a fresh-id message
into `~/.grillme/messages.json` using the schema above (`kind: "blocking"`,
`from` ≠ `Aryan`, atomic write: tmp file + rename).

**Needs-input beat** (amber pulse + tone; hook events override heuristics for
30 min; session must be alive):

```sh
echo "{\"ts\":$(date +%s),\"id\":\"Shreyash\",\"event\":\"notification\"}" >> ~/.grillme/events.jsonl
echo "{\"ts\":$(date +%s),\"id\":\"Shreyash\",\"event\":\"stop\"}" >> ~/.grillme/events.jsonl   # clear after the beat
```

**Conflict/lock beat** (30-min lock + presence, immediate):
`touch ~/worktrees/grill-me-mei/src/store.ts`

**Safety beat**: `grillme send Aryan "run: git push --force origin main"` —
the PreToolUse hook exits 2, Claude visibly refuses and asks for confirmation.

## Reset between rehearsals

```sh
cp ~/.grillme/demo-seeds/*.json ~/.grillme/     # then refresh message ids if re-firing inbox beats
: > ~/.grillme/events.jsonl; : > ~/.grillme/audit.jsonl; : > ~/.grillme/standup.log
cd "$(git rev-parse --show-toplevel)"   # the grill-me repo && git worktree list   # spot worktrees-agent-*
git worktree remove --force ../worktrees-agent-a && git branch -D fan/agent-a
python3 -c 'import json,os; p=os.path.expanduser("~/.grillme/config.json"); c=json.load(open(p)); c["teammates"]=[m for m in c["teammates"] if not m["id"].startswith(("agent-","fan-"))]; json.dump(c,open(p,"w"),indent=2)'
```

Both the worktree AND the branch must go, or the next fan-out/`new` fails.
**Hard reset**: quit the app — ptys live in the Rust process, so quitting kills
every session. Relaunch, then re-run the full pre-flight.

## Recovery moves (rehearse each once)

- **Pane died** — the "session ended — restart" card is a button; self-heal
  auto-restarts up to 3× per 10 min. Verify with `grillme sessions`.
- **Rate limit** — the app toasts it; the session resumes on its own. Narrate.
- **Fan-out spawn fails** — leftover worktree/branch: run the reset, or pivot
  to the CLI with a fresh id (`agent-b`).
- **API 401** — retry (the CLI re-reads the token per call) or restart the app.
- **No sound** — macOS Focus first, then `muteAll`; the OS banner still lands.
