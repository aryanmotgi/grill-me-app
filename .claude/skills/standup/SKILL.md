---
name: standup
description: Generates the daily standup summary for the Grill Me team from real coordination data — ~/.grillme tasks.json, messages.json, events.jsonl, audit.jsonl plus each member's git log — and posts it to the shared standup feed in standup_append format. Use when the user says "standup", "daily standup", "post the standup", "what did everyone do today", or asks for a per-teammate done/blockers/next summary.
---

# Daily Standup from Grill Me Data

Produce a per-teammate standup (Done / In progress / Blockers / Next) grounded ONLY in
real data. Never invent activity. If a member has no signal in any source, write
"no recorded activity" for them — do not guess.

## 1. Locate the active project's data directory

Grill Me stores the default project at `~/.grillme/` and other projects at
`~/.grillme/projects/<id>/`. Determine `DATA_DIR`:

1. Read `~/.grillme/projects.json`. If it lists projects, ask the user which one
   (or pick the only non-default entry) and use `~/.grillme/projects/<id>/`.
2. Otherwise use `~/.grillme/`.

Team roster comes from `DATA_DIR/config.json` (or `~/.grillme/config.json` if absent):
`{"teammates":[{"id","name","repoPath",...}]}`. Iterate every teammate.

## 2. Gather signals per teammate

Read these files from `DATA_DIR` (each may be missing — treat missing as empty):

- **`tasks.json`** — array of `{id, title, owner, status, files, blockedBy, startedAt}`.
  Status values: `not-started | in-progress | done`.
  - Done: tasks with `status == "done"` owned by the member.
  - In progress: `status == "in-progress"`; `startedAt` (epoch ms) gives duration.
  - Blocked: tasks whose `blockedBy` points at a task that is not `done`.
- **`messages.json`** — array of `{id, from, to, text, answered, kind, context}`.
  `kind` is `question | fyi | blocking | proposal`.
  - Blockers: unanswered (`answered: false`) messages with `kind == "blocking"`
    sent BY the member (they are blocked) or TO the member (they block someone).
  - Open questions addressed to the member also belong under blockers.
- **`events.jsonl`** — one JSON object per line: `{"ts": epochSec, "id": memberId,
  "event": "prompt" | "stop" | "notification"}`. These come from Claude Code hooks.
  A recent `notification` with no later `prompt`/`stop` means the session is
  waiting on input — flag that as a blocker ("session waiting on a decision").
- **`audit.jsonl`** — `{"ts", "id", "tool", "detail"}` per executed tool call.
  Use only as color (e.g. which files a member touched), never as the main source.

Then get real shipped work from git, per member, using their `repoPath`:

```sh
git -C <repoPath> log --since="24 hours ago" --pretty='%h %s (%cr)' -n 15
git -C <repoPath> rev-parse --abbrev-ref HEAD
git -C <repoPath> status --porcelain | wc -l   # uncommitted work in flight
```

Commits in the last 24h are "Done". Uncommitted changes + in-progress tasks are
"In progress". If `git log` errors (missing worktree), note the repo path is
unavailable rather than skipping the member silently.

## 3. Compose the standup

One block per teammate, terse, no filler:

```
## <Name> (<branch>)
Done:        <commits + tasks moved to done; "no recorded activity" if empty>
In progress: <in-progress tasks with elapsed time; dirty-file count>
Blockers:    <blocking/unanswered messages, blockedBy chains, waiting-on-input>
Next:        <not-started tasks owned by the member, oldest first>
```

Show the full composed standup to the user before posting.

## 4. Post to the shared feed (standup_append format)

The app's Activity tab tails `DATA_DIR/standup.log`, where the Rust
`standup_append` command writes lines as: `<epochSeconds>\t<memberId>\t<note>`
with any tabs/newlines inside the note replaced by spaces. Append one compact
line per teammate directly to the file — same format, same effect:

```sh
NOTE=$(echo "done: fixed pty resize; doing: inbox threads; blocked: none" | tr '\n\t' '  ')
printf '%s\t%s\t%s\n' "$(date +%s)" "<memberId>" "$NOTE" >> DATA_DIR/standup.log
```

Rules:
- One line per member, under ~200 chars — the UI shows only the last 20 lines.
- The note MUST NOT contain raw tabs or newlines (they break the field split).
- Do not truncate or rewrite existing lines; the file is append-only.
- After posting, tell the user how many lines were appended and to which file.
