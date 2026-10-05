# Working on Grill Me

## Pull requests
- Every feature gets its own branch. Never push directly to main.
- One PR per feature or goal. Batch related fixes together; never one PR per small fix.
- Only open a PR when the work is finished and tested. Say what was completed and how it was checked.
- No stacked PR chains.
- Every PR gets a `CHANGELOG.md` entry: what it **Added** and what it **Fixed**, one line per item. Write what changed for the person using Grill Me, not which function moved.
- `node scripts/changelog.cjs check` lists merged PRs with no entry; `skeleton <number>` prints a block to fill in.
- Don't invent entries for work you didn't do or can't verify — index the title and leave the detail out.

## CI (GitHub Actions minutes are limited)
- Keep CI cheap: Linux first, macOS only when needed (label a PR `mac`), cache builds, cancel old runs.
- CI runs on PRs only, and skips docs-only changes and drafts. See `.github/workflows/ci.yml`.
- Before opening a PR, run the checks locally: `npm run build`, `npx vitest run`, and `cargo test --manifest-path src-tauri/Cargo.toml` when Rust changed (the `ship-check` skill lists them).
