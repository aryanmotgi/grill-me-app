---
name: hackathon
description: Runs the winning-hackathon loop for the Grill Me repo — demo-first prioritization, build-vs-skip triage under time pressure, 30-minute timeboxes, and judge-criteria checks. Use when the user mentions a hackathon, a demo or submission deadline, "what should we build next", "we have N hours left", "is this worth building", or preparing Grill Me for judging.
---

# Hackathon Mode: Grill Me

Optimize for what judges see in 3 minutes, not what the codebase deserves.
Every decision passes one filter: **does this change what appears on screen
during the demo?** If no, cut it or defer it.

## The loop (repeat until freeze)

1. **State the demo path** — the exact click-by-click sequence you will show.
   Write it down before touching code.
2. **Pick the weakest beat** in that path (blank pane, fake data, crash risk).
3. **Timebox the fix: 30 minutes.** If not visibly better in 30, revert or
   fake it (demo mode exists for this — TopBar toggle, `demoMode` in
   `src/store.ts`, `.demo-hide` class strips builder chrome; ⌘S still works).
4. **Re-run the full demo path end to end.** Never stack unverified changes.
5. **T-minus 60 min: hard freeze.** Only demo-path bug fixes after that.

## Demo path (current strongest beats, in order)

1. HomeDashboard mission control → open a project (`ProjectPicker`).
2. **FanOut** (`src/components/FanOut.tsx`): paste a checklist → independent
   tasks spawn parallel worktrees + real Claude sessions; dependents (lines
   sharing 2+ meaningful words with an earlier line) auto-wait. This is the
   wow moment — put it in the first 45 seconds.
3. Live coordination: file-watcher locks → conflict banner → click jumps to
   the claimed file (`liveLocks`, `highlightFiles` in store).
4. Real pty terminal (`XtermPane`) with scrollback slider + recording.
5. **Review & ship** (⌘S): diff review modal → commit → PR draft
   (`git_commit_push`, `pr_draft` in `src-tauri/src/lib.rs`).
6. Closer: auto-stitched standup (Activity tab) + `grillme` CLI hitting the
   localhost HTTP API on port 4517 — "your agents can drive the hub too."

## Build vs skip

**Build (cheap, visible):**
- New panels/beats that reuse the Zustand store + existing polling feeds
  (`src/data/sources/feeds.ts`). Wire fake data first, real feed second.
- Anything that makes the terminal or FanOut look more alive.
- Empty/loading states on demo-path surfaces (DESIGN.md: never a blank pane).
- Seed data: realistic teammate names, branches, and task titles.

**Skip (expensive, invisible):**
- New Rust commands in `lib.rs` unless a demo beat is impossible without one
  — it is a ~1900-line single file; regressions there kill the whole demo.
- Refactors, tests, websockets (polling already works), auth, settings depth,
  cross-platform fixes, README polish.
- New themes. `ember` + `paperwhite` already prove the token system.

**Fake it honestly:** if a live integration is flaky, drive it from seeded
shared-state files (`~/.grillme/`) and say so if asked. A smooth simulated
beat beats a broken real one.

## Judge-criteria checklist (verify before submitting)

- [ ] Working demo > slides. The app runs from `npm run tauri dev` on the
      demo machine, offline-safe, with 4 seeded teammates visible.
- [ ] Wow moment lands in the first 45 seconds (FanOut spawn).
- [ ] Story arc: problem (4 people stepping on each other) → live proof →
      "and it's real" (terminals, git, hooks) → ask.
- [ ] Demo mode ON, focus mode (⌘.) ready; ⌘K switcher and ⌘/ feature index
      rehearsed; Esc closes one overlay at a time, topmost first.
- [ ] One rehearsed recovery per beat: know what to click if a pty dies
      ("session ended — restart" card) or a feed stalls.
- [ ] Pitch script current — run the `pitch` skill after any demo-path change.
- [ ] Pre-merge gates green — run the `ship-check` skill before the freeze.
- [ ] Timer test: full run-through under 3:00, twice, by the actual presenter.

## Team rules (4 people)

- One person owns the demo path and merge order; others feed PRs (per-feature
  branches, PR each, never push to main).
- Merge-freeze order follows the app's own merge queue — dogfood it on screen.
- Last hour: presenter rehearses; others fix only what the presenter reports.
