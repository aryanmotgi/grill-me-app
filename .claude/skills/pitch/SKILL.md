---
name: pitch
description: Generates and refines the Grill Me pitch — one-liners, 3-minute timed demo scripts, submission blurbs, and hook→problem→demo→ask narratives grounded in the app's real features. Use when the user says "pitch", "elevator pitch", "demo script", "one-liner", "submission blurb", "tighten what I'll say", or wants to rehearse the presentation for judges.
---

# Pitch Authoring: Grill Me

Write pitches from what the app actually does — verify every claimed beat
against the code before scripting it (components in `src/components/`,
backend commands in `src-tauri/src/lib.rs`). Never script a beat you have
not seen work today.

## Structure (always this order)

1. **Hook** (0:00–0:15) — one sentence + the wow visual already on screen.
2. **Problem** (0:15–0:40) — 4 people, 4 Claude Code sessions, zero
   visibility: merge conflicts, duplicated work, "what is everyone doing?"
3. **Demo beats** (0:40–2:30) — 3 to 4 beats max, each: *say the claim →
   show it → name the takeaway*. Never talk over a loading state.
4. **Ask** (2:30–3:00) — what you want (prize category, users, follow-up)
   plus the depth flex: real ptys, git worktrees, Claude Code hooks, a
   localhost API agents can call.

## One-liner formulas (generate 3, pick 1)

- **Category:** "Mission control for teams of Claude Code agents."
- **Before/after:** "Four terminals in four dark rooms → one shared window
  where sessions coordinate themselves."
- **X for Y:** "An air-traffic-control tower for AI pair programmers."

Test: a judge can repeat it to another judge an hour later.

## 3-minute script format

Write scripts exactly like this — timed, with stage directions in brackets,
spoken lines in quotes, max ~420 spoken words total:

```
0:00  [App open in demo view, HomeDashboard visible]
      "This is Grill Me — mission control for teams of Claude Code agents."
0:15  "Four people, four AI sessions, and nobody knows who's editing what.
       We lost our first hackathon to a merge conflict. Never again."
0:40  BEAT 1 — FanOut. [Paste checklist, hit spawn — note: the fan-out
       button is hidden in demo view; fire it before toggling, or via CLI]
      "Paste a plan. Independent tasks each get a worktree and a live
       Claude session; dependent ones wait their turn." → takeaway line.
1:20  BEAT 2 — Conflict radar. [Two sessions touch the same file]
      "The file watcher sees both claims and flags the collision before
       git ever could." [Click banner → jump to file]
1:50  BEAT 3 — Review & ship. [⌘S → diff → commit → PR draft. The ⌘S
       keystroke works even in demo view; only the button is hidden.]
      "Human reviews, one keystroke ships."
2:20  BEAT 4 (optional) — auto-stitched standup / `grillme` CLI.
2:30  ASK. "It's a real Tauri app — real terminals, real git. We want X."
```

## Refinement loop

1. Draft with the format above.
2. Cut until under 420 words — remove adjectives before removing beats.
3. Read aloud with a timer; anything over 3:00 loses a beat, not pace.
4. Adversarial pass: for each claim ask "could a judge call this fake?"
   If yes, add the on-screen proof or soften the claim.
5. After any demo-path code change, re-verify the affected beat and update
   the script in the same commit.

## Voice rules

- Match the product's voice (DESIGN.md): utility language, no exclamation
  points, no "revolutionary/seamless/game-changing".
- Numbers over adjectives: "4 sessions, 1 window, 0 merge surprises".
- Present tense, active: "it spawns", never "it would spawn".
- The demo carries the pitch; the script only frames what is on screen.

## Deliverables

When asked for "the pitch", produce all three in one response:
one-liner, 3-minute timed script, and a 2-sentence submission blurb.
Save iterations to `PITCH.md` at the repo root only if the user asks.
