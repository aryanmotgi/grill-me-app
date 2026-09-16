---
name: demo-drive
description: Drives the Grill Me live demo — pre-flight checks via the grillme CLI (sessions alive, API responding, sounds on), seeding demo tasks/messages through ~/.grillme JSON files, resetting state between rehearsals, and firing the fan-out and inbox beats on cue. Use when the user says "demo prep", "rehearsal", "pre-flight", "reset the demo", "fire the fan-out", or is about to present Grill Me.
---

# Demo Drive: Grill Me

You are the stage manager. The app is the show. Everything here uses the real
transport: the `grillme` CLI, the localhost API on `127.0.0.1:4517`, and the
shared JSON files under `~/.grillme` that the app polls every 2 seconds.

## Ground truth (paths, IDs, formats)

- **CLI:** `~/.grillme/bin/grillme` (installed/refreshed by the app on every
  launch). Not on PATH by default — use the full path or
  `export PATH="$HOME/.grillme/bin:$PATH"` first.
- **API:** `http://127.0.0.1:4517`, bearer token in `~/.grillme/api-token`.
  The server runs *inside* the app — no app, no API.
- **Session IDs** = teammate IDs from `~/.grillme/config.json`. For the
  default project they are bare (`Aryan`, `Shreyash`, `Nandan`, `Rithik`);
  for any other active project they are prefixed `<projectId>:<memberId>`.
- **Shared state** (default project) lives at `~/.grillme/` root:
  `tasks.json`, `messages.json`, `team.json`, `events.jsonl`, `audit.jsonl`,
  `standup.log`. Other projects: `~/.grillme/projects/<id>/`.
  `settings.json` and `config.json` are always global at the root.
- The app polls tasks/messages/team every **2 s**, git every **5 s** (cached
  10 s in Rust), pty status every **2 s** — seeded files appear on screen
  within ~2 s, no restart needed.

### CLI reference (real behavior, from the script itself)

```sh
grillme sessions              # JSON: [{id, alive, quietMs, bell, oscNotify, tail[], recording, startedAt, paused}]
grillme send <id> <text...>   # send text + Enter (newline appended — submits the prompt)
grillme type <id> <text...>   # type text WITHOUT Enter (stage it, hit send later)
grillme read <id> [lines]     # last N (default 40) ANSI-stripped screen lines
grillme new <id> <branch>     # git worktree add -b <branch> ../worktrees-<id> main,
                              #   registers <id> in config.json, spawns a live claude session
```

Dramatic-pause trick: `grillme type Aryan "fix the flaky test"` puts the text
in the prompt on screen; `grillme send Aryan ""` later sends just the Enter.

---

## Pre-flight (run T-10 minutes, in order)

```sh
export PATH="$HOME/.grillme/bin:$PATH"

# 1. App + API up, token valid (silent success = fail; expect a JSON array)
grillme sessions
# equivalent raw check:
curl -sf -H "Authorization: Bearer $(cat ~/.grillme/api-token)" http://127.0.0.1:4517/sessions

# 2. Every demo session alive
grillme sessions | python3 -c 'import json,sys; [print(s["id"], "alive" if s["alive"] else "DEAD", "paused" if s["paused"] else "") for s in json.load(sys.stdin)]'

# 3. Screens sane (no error walls, no rate-limit banners)
for id in Aryan Shreyash Nandan Rithik; do echo "== $id =="; grillme read "$id" 8; done
```

Then verify by hand:

- **Sessions spawn lazily** — teammate panes only start `claude` on first
  view. Click through every pane once so nothing cold-boots on stage.
- **Paused sessions**: auto-pause SIGSTOPs quiet sessions after ~5 idle
  minutes. Viewing or typing resumes instantly, but pre-warm anyway: view
  each pane right before you start.
- **Sounds on** — check `~/.grillme/settings.json` (global): `muteAll` must
  be absent/false; `notifyMessages` / `notifyNeedsInput` not false; the
  `sounds` map (keys `message`, `mention`, `needs-input`, `conflict`) has no
  `false` entries. The app holds settings in memory — change them in the
  Settings UI, or edit the file **before** launching the app. Also confirm
  macOS Focus/DND is OFF and volume is up.
- **Sound + notification live test** — fire a real blocking message (below,
  "Inbox beat") and confirm you hear the tone and see the OS banner.
- **Hooks installed** — each worktree's `.claude/settings.json` mentions
  `grillme-hook`. The app reinstalls on launch; if missing, restart the app.
- **Demo view gotcha**: TopBar → "Demo view" hides everything tagged
  `.demo-hide` — **including the fan-out button and the ⌘S ship button**.
  Either fire fan-out *before* toggling demo view, or drive it from the CLI
  (works regardless).

---

## Seeding demo state

Keep golden copies in `~/.grillme/demo-seeds/` (`tasks.json`,
`messages.json`, `team.json`) and copy them in. The app dedups messages by
`id` per app-run, so **every rehearsal needs fresh message ids** — generate
them with a timestamp.

Real schemas (copy these shapes exactly):

```jsonc
// tasks.json — array of Task
{
  "id": "t1",
  "title": "Embedded pty terminals",
  "desc": "Real Claude Code process per pane",
  "owner": "Aryan",                 // teammate id
  "status": "in-progress",          // not-started | in-progress | done
  "files": ["src-tauri/src/lib.rs"],
  "blockedBy": "t3",                // optional: task id — renders the dependency chain
  "startedAt": 1789487192889        // optional: epoch MILLISECONDS — drives the live timer
}

// messages.json — array of Message
{
  "id": "b-1789497259",             // MUST be unique per app-run (dedup key)
  "from": "Nandan",                 // != viewer ("Aryan") or no notification fires
  "to": "Aryan",                    // or "all"
  "text": "Blocked: inbox types collide with my branch, need your call",
  "answered": false,                // false => counts in the attention badge
  "ts": "11:06",                    // display string, not epoch
  "kind": "blocking",               // question | fyi | blocking | proposal
  "context": { "task": "inbox", "file": "src/components/Inbox.tsx", "branch": "feature/inbox" },
  "threadId": "q-..."               // optional: id of root message (replies)
}

// team.json
{ "mergeQueue": ["Aryan", "Shreyash", "Nandan", "Rithik"],
  "sponsor": [ { "sponsor": "Anthropic", "requirement": "...", "done": true } ] }
```

Notification rules the seeds must respect (from `feeds.ts`): `kind: "fyi"`
goes to the silent digest (default 15 min) — never use fyi for a live beat;
`kind: "blocking"` interrupts with the mention tone and a `BLOCKING from …`
banner; text containing `@Aryan` upgrades any kind to a mention.

---

## Firing beats on cue

### Fan-out (the wow moment)

**Option A — UI (preferred visual):** SessionList → `fan out` → paste the
checklist → `analyze & spawn`. Remember it's hidden in demo view. Lines
sharing 2+ meaningful words with an earlier line become dependents that wait
on the board. Rehearsed checklist:

```
- add login page
- add signup page
- style login page
```

(line 3 shares "login page" with line 1 → spawns only when task 1 is marked done)

**Option B — CLI (works in demo view, scriptable):**

```sh
grillme new agent-a fan/agent-a          # worktree + branch + live session
sleep 6                                  # let claude boot before the briefing
grillme send agent-a "Work on this task: add a login page. When done, tell the user and stop."
grillme read agent-a 15                  # prove it's really working
```

`new` creates `<repo-parent>/worktrees-agent-a` branched off `main` — it
**fails if the branch or path already exists**, so the reset step below is
mandatory between rehearsals.

### Inbox beat (blocking message + tone, lands within 2 s)

```sh
python3 - <<'EOF'
import json, time, os
p = os.path.expanduser("~/.grillme/messages.json")
msgs = json.load(open(p)) if os.path.exists(p) and open(p).read().strip() else []
msgs.insert(0, {
  "id": f"b-{int(time.time())}", "from": "Nandan", "to": "Aryan",
  "text": "Blocked: need your call on the store types before I merge",
  "answered": False, "ts": time.strftime("%H:%M"), "kind": "blocking",
  "context": {"task": "inbox", "file": "src/store.ts", "branch": "feature/inbox"}})
tmp = p + ".tmp-write"; json.dump(msgs, open(tmp, "w"), indent=2); os.replace(tmp, p)
EOF
```

### Needs-input beat (amber pulse + needs-input tone)

Hook events in `events.jsonl` override heuristics for 30 minutes — inject one:

```sh
echo "{\"ts\":$(date +%s),\"id\":\"Shreyash\",\"event\":\"notification\"}" >> ~/.grillme/events.jsonl
# clear it after the beat:
echo "{\"ts\":$(date +%s),\"id\":\"Shreyash\",\"event\":\"stop\"}" >> ~/.grillme/events.jsonl
```

(The session must be alive for the status to show; the tone fires on the
idle→needs-input transition.)

### Conflict/lock beat

Touch a real file in a teammate's worktree — the notify watcher registers a
30-minute lock and the UI shows presence immediately:

```sh
touch /Users/aryanmotgi/worktrees/grill-me-mei/src/store.ts
```

### Safety beat (blocklist deny, on screen)

```sh
grillme send Aryan "run: git push --force origin main"
# PreToolUse hook exits 2 -> Claude visibly refuses and asks for confirmation
```

---

## Reset between rehearsals

```sh
# 1. Restore seeds (fresh message ids if you re-fire inbox beats)
cp ~/.grillme/demo-seeds/tasks.json ~/.grillme/demo-seeds/messages.json \
   ~/.grillme/demo-seeds/team.json  ~/.grillme/

# 2. Clear runtime logs (stale hook events < 30 min old override live status)
: > ~/.grillme/events.jsonl
: > ~/.grillme/audit.jsonl
: > ~/.grillme/standup.log

# 3. Tear down fan-out spawns (BOTH paths, or the next `new`/fan-out fails)
cd /Users/aryanmotgi/Terminal/grill-me
git worktree list                              # spot worktrees-agent-* / worktrees-fan-*
git worktree remove --force ../worktrees-agent-a
git branch -D fan/agent-a

# 4. Remove spawned teammates from config.json (fan-out and `new` append them)
python3 - <<'EOF'
import json, os
p = os.path.expanduser("~/.grillme/config.json")
cfg = json.load(open(p))
cfg["teammates"] = [m for m in cfg["teammates"]
                    if not m["id"].startswith(("agent-", "fan-"))]
json.dump(cfg, open(p, "w"), indent=2)
EOF
```

**Hard reset** (terminals messy): quit the app. Pty state lives in the Rust
process, so quitting kills every session; relaunch respawns yours eagerly and
teammates' on first view — re-run the full pre-flight, including clicking
through every pane.

## Recovery moves (rehearse each once)

- **Pane died mid-demo** — the "session ended — restart" card is a button;
  self-heal also auto-restarts up to 3× per 10 min. Verify: `grillme sessions`.
- **Rate limit banner** — the app toasts it and the session resumes on its
  own; narrate it ("it waits and picks back up") and move to the next beat.
- **Fan-out spawn fails** — it's a leftover worktree/branch: run reset step 3,
  fire again, or pivot to Option B with a fresh id (`agent-b`).
- **API 401** — token file was regenerated; re-read it (the CLI does this per
  call, so just retry) or restart the app.
- **No sound** — check macOS Focus, then `muteAll` in `~/.grillme/settings.json`;
  the OS banner still lands even if audio fails.
