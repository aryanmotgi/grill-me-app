---
description: Verify, commit, push the current branch, and open a PR (installed by Grill Me)
---
<!-- grillme:ship-command -->

Ship the work on the current branch. Follow these steps exactly, in order:

1. Run `git branch --show-current`. If the current branch is `main` or `master`,
   STOP immediately and report that shipping from the default branch is not
   allowed — do not commit, push, or open a PR.
2. Detect and run the project's checks:
   - If `package.json` exists and has a `test` script, run `npm test`.
   - Otherwise, if `package.json` has a `build` script, run `npm run build`.
   - If a `Cargo.toml` exists (check the repo root and `src-tauri/`), also run
     `cargo test` in that directory.
   If a check fails for a trivial reason (formatting, lint, an import or type
   error introduced by the current changes), fix it and re-run the check. If
   the failures are non-trivial, STOP and report them instead of shipping
   broken code.
3. Stage all changes (`git add -A`) and commit on the current branch with a
   conventional commit message (`feat: ...`, `fix: ...`, `chore: ...`)
   describing what was done. If there is nothing to commit but the branch has
   unpushed or un-PR'd commits, continue to the next step.
4. Push the branch: `git push -u origin <current-branch>`. Never push to
   `main` or `master`.
5. Open a pull request with `gh pr create`, with a clear title and a body
   summarizing the changes. If a PR already exists for this branch, use it
   instead of creating a new one.
6. Report the PR URL on the final line of your response.
