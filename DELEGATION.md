<!-- grillme:delegation-playbook -->
# Agent Delegation Playbook

You (Claude Code) are the primary agent in this session. Codex CLI and Cursor
CLI are available as subprocess tools you may delegate sub-tasks to. Run them
like any shell command, read their stdout as the result, then verify and
continue.

## PRIORITY: conserve Codex/Cursor credits

This user has far fewer credits on Codex and Cursor than on Claude Code.
Delegate ONLY on a clear, strong fit. Borderline or could-go-either-way
tasks: handle them yourself. This priority overrides everything below and
should survive any future edits to this file.

## Before any delegation

1. Check the CLI is actually available — never assume:
   - Codex: `command -v codex` (auth: `codex login status` exits 0 when logged in)
   - Cursor: `command -v cursor-agent || command -v agent` (auth: `cursor-agent status`)
2. If unavailable or not logged in, handle the task yourself. Do not retry.
3. Delegate one sub-task at a time; wait for it, verify, then continue.

## Delegate to Codex — ONLY these strong fits

- Large mechanical refactors: rename/restructure across many files where
  tests or a typecheck verify the result.
- Genuine bulk repetitive work: dozens of similar small fixes (lint sweeps,
  API-migration call sites).
- Test-suite generation for existing, well-specified code.

```bash
timeout 600 codex exec "<task, precise and self-contained>" \
  --cd "$PWD" -s workspace-write < /dev/null
```

- `< /dev/null` is MANDATORY — codex exec hangs forever on a pipe stdin.
- Sandbox stays `workspace-write` (not full bypass) — a delegated subprocess
  gets no more power than it needs.
- stdout is the final answer; progress streams on stderr; non-zero exit =
  failure. Always wrap in `timeout`.

## Delegate to Cursor — ONLY these strong fits

- Real speed-critical UI iteration: many quick visual passes over one
  component where a fast loop genuinely beats doing it yourself.
- A truly isolated small edit you can specify in one sentence and verify at
  a glance.

```bash
# writes require --force; without it cursor "succeeds" but changes nothing
timeout 300 cursor-agent -p "<task>" --force --output-format text
```

Read-only codebase Q&A via cursor is possible (`-p` without `--force`) but
spends Cursor credits — prefer your own Grep/Read tools instead.

## Handle directly (never delegate)

- Architecture, cross-cutting design, root-cause debugging.
- Anything security-sensitive: auth, secrets, permissions, payments.
- Anything spanning multiple subsystems where first-pass correctness matters.
- All verification: after ANY delegation, review the diff (`git diff`) and
  run the project's tests yourself before continuing. Delegated output is
  never trusted unreviewed.
- Anything when the needed CLI is missing, not logged in, or the task is
  borderline — see PRIORITY above.

---
*Managed by Grill Me. To customize per-project: edit this file and DELETE the
grillme marker comment at the top — Grill Me will never touch it again. A
template at `~/.grillme/delegation.md` (keeping the marker) overrides the
default for all projects.*
