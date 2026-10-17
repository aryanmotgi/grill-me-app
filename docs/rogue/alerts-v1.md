# Rogue alerts v1: behavior and recipients

Status: decided 2026-10-05. The detector (task t5), the event model (t4) and the
UI work (t6) all build against this page. If one of them needs to change it,
update this page first.

## 1. v1 warns. It never pauses on its own.

A rogue detector **only raises a warning**. It does not stop, pause or kill a
session. The warning shown to the person carries a **Pause** button. The person
decides whether to press it.

Why:

- **Hard stops already exist.** The blocklist `PreToolUse` hook
  (`src-tauri/src/lib.rs`, "Safety: blocklist enforcement") refuses
  known-dangerous commands before they run. Anything that must never run
  belongs in the blocklist, not in a detector.
- **New detectors will misfire.** Rules nobody has tuned yet produce false
  positives. Task t8 ("Demo and tune against real agent sessions") is where we
  learn the false-positive rate. Auto-pausing before then would freeze good
  work.
- **A pause freezes the agent in the middle of what it's doing.** `pty_pause`
  sends SIGSTOP to the whole process group. That's safe to resume, but it can
  stop an agent halfway through a multi-step edit. A human should choose that.
- **We follow the cost cap.** The cost cap (`src/lib/cap.ts`) is the only
  automatic pause, and it guards money with a hard number. Rogue rules are
  guesses, so they get a softer response.

The Pause button reuses `invoke("pty_pause", { id, pause: true })`, the same
call the session list and the cost cap use. It inherits the existing rule:
**never pause a session that's waiting for human input or rate-limited.** In
those cases, show the warning without the button.

Auto-pause is deferred to v2. Revisit it once t8 shows a detector rarely
misfires. If added, it should be per detector, opt-in, and off by default.

## 2. Who gets each alert

| Recipient | Gets | How |
|---|---|---|
| **Person running the session** (owner) | Every rogue event | Toast + badge on that session's row, with the evidence and a Pause button. `high` also plays the alert sound (`playAlert`). |
| **The agent itself** | Every rogue event about **its own** session, and only those | Injected into that agent's context (see §3). |
| **Whole team** | `high` severity only | One line in the shared activity feed. **Passive:** no toast, no sound, no chat ping. |

Why:

- **The owner is the only person who can act.** The session runs on their
  machine, so only they can pause it or redirect it.
- **The agent should know so it can correct itself.** Often it can't, so the
  warning goes to the owner as well.
- **Teammates only see the serious events.** They can't act on someone else's
  agent, so they only see `high` events. They need to know when a shared branch
  or shared data was touched, not every warning.

## 3. What the build needs to change

These follow from the decision. They describe today's code, so they're
instructions for t4 and t6, not decisions to reopen.

- **Agent alerts must be targeted.** Today `alerts.json` is read by every
  agent in the project: `mcp/brain.rs` filters by time only, not by member.
  That's correct for drift warnings, which involve two people. A rogue warning
  must reach only the offending agent, so the event needs a `memberId` and the
  reader must filter on it. Rogue events must never leak into other agents'
  `grill-me-sync` blocks.
- **Agent delivery should be immediate where possible.** `grill-me-sync` only
  injects on the next prompt (`UserPromptSubmit`) or at session start. An agent
  working on its own may not get a new prompt for a long time. Prefer replying
  on the detector's own `PostToolUse` hook call, so the agent sees the warning
  right after the tool call that triggered it. Fall back to `grill-me-sync` on
  the next prompt.
- **Repeats are throttled per detector and session.** Match the drift alerts:
  the same detector firing on the same session is not re-announced within a
  window (drift uses 2h; t4 picks the rogue value). Every event is still
  written to `audit.jsonl`.

## 4. Fields this delivery depends on

t4 owns the full data model. Delivery needs at least these fields:

- `id`, `ts`
- `detector`: which rule fired
- `memberId` and the pty/session id: who gets it, and what the Pause button pauses
- `severity`: `"warn"` | `"high"`; decides team visibility and the sound
- `evidence`: the command, file path or network target, shown verbatim (trimmed)
- `text`: one-line, human-readable summary

The detector (t5) assigns severity per rule, in the rules config file, so it
can be tuned without a code change.
