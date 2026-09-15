# Grill Me

One shared window into every teammate's Claude Code session. See who's working on what, avoid stepping on each other's files, and ask questions without interrupting active work. General-purpose team coordination for any multi-person project (and it holds up fine at a hackathon).

## Status: Phase 1 — app shell

Layout and every panel built as self-contained components over fake sample data. No real SSH, git, file-watching, or API connections yet — that's phase 2, wired into the same component props/stores without restructuring.

## Stack

- **Tauri 2** — native desktop shell (Rust backend, OS webview)
- **React 19 + TypeScript + Vite**
- **Tailwind CSS 4** + CSS-variable theme tokens
- **Zustand** — app state; fake data lives in store slices for later swap-out

## Layout

- **Top bar** — project status, attention badge, merge-turn indicator, quick commit, focus/demo toggles, theme switcher
- **Left** — session list: per-teammate status (idle/working/needs-input), branch, task, setup stage, live open-file presence, health, DND, split/view controls
- **Center** — active session terminal with scrollback/replay slider, recording toggle, per-session rollback log, global cross-session search
- **Right rail** — tabs: Tasks (board, timers, dependency blocks, file locks, conflict prediction), Inbox (async messages, broadcast), Activity (timeline + auto-stitched standup), Team (Claude usage, health, permissions, CI, sponsor checklist, exports), Preview (embedded browser placeholder)

## Theme system

Every color comes from one `Theme` object (`src/theme/themes.ts`) written to CSS custom properties and mapped into Tailwind tokens in `src/styles.css`. Swap the object, the whole app reskins — two themes (`ember`, `paperwhite`) ship as proof.

## Run

```sh
npm install
npm run tauri dev   # native window
npm run dev         # browser-only UI dev at localhost:1420
```

## Keyboard

- `⌘K` — quick switcher
- `⌘S` — quick commit (stubbed)
- `⌘.` — focus mode
