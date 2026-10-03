---
name: ship-check
description: Pre-merge release checklist for the Grill Me repo — TypeScript gate (tsc via npm run build), Rust cargo check, a demo-path smoke test of the beats that matter on stage, and PR hygiene (feature branch, descriptive PR, never push main). Use when the user says "ship check", "ready to merge", "pre-merge", "can I merge this", "is this safe to land", "release checklist", or before opening or merging any PR.
---

# Ship Check: Grill Me

Run before every merge. Ordered cheap-to-expensive: stop at the first red
step, fix, and restart from step 1. Never merge with a red step.

## 1. Branch hygiene (fail fast)

```sh
cd "$(git rev-parse --show-toplevel)"   # the grill-me repo
git branch --show-current           # MUST be a feature branch, never main
git fetch origin && git merge origin/main   # resolve conflicts now, not in the PR
git status --porcelain              # no stray files riding along
```

Non-negotiable rules: every feature gets its own branch, every branch gets a
PR describing what was completed, and nothing is ever pushed directly to main.

## 2. TypeScript gate + production bundle

```sh
npm run build      # runs `tsc && vite build` — the same gate `tauri build` uses
```

`npm run dev` does NOT typecheck (vite only transpiles), so a clean dev
session proves nothing. A tsc failure here is the most common trap.

## 3. Rust gate

```sh
cargo check --manifest-path src-tauri/Cargo.toml
cargo test  --manifest-path src-tauri/Cargo.toml   # 35 unit tests over the pure core
```

The test suite pins the safety blocklist regexes (including fail-closed on
corrupt config), the ANSI/OSC stripper, token format, log rotation, and the
project-id/ssh/tmux validators — a red test there is a real regression, not
flake. `lib.rs` is a single ~2400-line file; a regression there kills every
feature at once. If the diff touches it, also confirm any new `#[tauri::command]` is
registered in the `generate_handler![...]` list near the bottom — an
unregistered command compiles fine and fails only at runtime.

## 4. Demo smoke test (when the diff touches `src/` or `src-tauri/`)

Launch `npm run tauri dev` and click through the demo path — these beats are
the product; a merge that breaks one is a rollback:

- [ ] App boots to HomeDashboard; opening the project shows no blank pane.
- [ ] The active session pane renders a live terminal and accepts a keystroke.
- [ ] ⌘K switcher opens; Esc closes it (overlays close one at a time,
      topmost first — verify Esc doesn't nuke everything).
- [ ] ⌘S opens the review modal for the active session; Esc closes it.
- [ ] TopBar "Demo view" toggles clean chrome on and back off.
- [ ] `~/.grillme/bin/grillme sessions` returns a JSON array (proves the
      localhost API on :4517 and the bearer token still work).
- [ ] Only if the diff touched FanOut/worktree code: run one fan-out spawn,
      confirm the session boots, then tear down the worktree + branch and
      the spawned `agent-*` entries in config.json (see the demo-drive
      skill's reset) before committing.

## 5. PR hygiene

- Title states the change; body states what was completed, how it was
  verified (paste the results of steps 2-4), and any demo-path impact.
- Skim the diff one last time: no leftover debug logging, no commented-out
  code, no hardcoded local paths beyond the existing `~/.grillme` layout.
- If the demo path changed, update `DEMO.md`/`PITCH.md` in the same PR and
  re-run the `pitch` skill; consider the `judge-qa` skill if a claim moved.
- Merge only when every step above is green; delete the branch after merge.
