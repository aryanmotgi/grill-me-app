/**
 * Auto-checkpoint — the ONE place that knows the checkpoint cadence rules and
 * how per-repo results roll up into an honest toast. The Rust `checkpoint_commit`
 * command does the actual staging/commit (current branch only, never main/master,
 * never pushes); this module only decides *when* and *what to say*. Kept pure
 * (results in → strings out; invoke passed in) so it is unit-testable.
 */

export const CHECKPOINT_MIN_MINUTES = 5;
export const CHECKPOINT_DEFAULT_MINUTES = 10;

/** Clamp a user-entered interval to a sane floor; fall back to the default for
 *  anything non-numeric. Never below CHECKPOINT_MIN_MINUTES — a tighter loop
 *  would thrash git for no benefit. */
export function clampCheckpointInterval(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return CHECKPOINT_DEFAULT_MINUTES;
  return Math.max(CHECKPOINT_MIN_MINUTES, Math.floor(n));
}

/** Auto-checkpoint is opt-in per project — off unless explicitly enabled. */
export function checkpointEnabled(settings: Record<string, unknown>): boolean {
  return settings.autoCheckpoint === true;
}

/** The clamped interval this project is configured for. */
export function checkpointIntervalMinutes(settings: Record<string, unknown>): number {
  return clampCheckpointInterval(settings.autoCheckpointMinutes);
}

export type CheckpointStatus = "committed" | "clean" | "error";

export interface CheckpointOutcome {
  name: string;
  status: CheckpointStatus;
  detail: string;
}

/** Map one `checkpoint_commit` result onto a status. The command returns Ok
 *  with a "clean — …" message when there was nothing to commit, otherwise a
 *  "checkpoint · N files" message; an Err (guard hit, git failure) is an error. */
export function classifyCheckpoint(ok: boolean, message: string): CheckpointStatus {
  if (!ok) return "error";
  return message.trim().toLowerCase().startsWith("clean") ? "clean" : "committed";
}

/** Roll per-repo outcomes into a single honest toast line + kind.
 *  - any error → warn, naming the count and the first failure
 *  - all clean → info, "nothing to checkpoint"
 *  - otherwise → info, naming what was committed */
export function summarizeCheckpoints(
  outcomes: CheckpointOutcome[],
): { text: string; kind: "info" | "warn" } {
  const committed = outcomes.filter((o) => o.status === "committed");
  const errors = outcomes.filter((o) => o.status === "error");

  if (errors.length > 0) {
    const first = errors[0];
    const prefix = committed.length > 0 ? `Checkpointed ${committed.length} · ` : "";
    return {
      text: `${prefix}${errors.length} failed — ${first.name}: ${first.detail}`,
      kind: "warn",
    };
  }
  if (committed.length === 0) {
    return { text: "Nothing to checkpoint — all sessions clean", kind: "info" };
  }
  const label =
    committed.length === 1
      ? `${committed[0].name} (${committed[0].detail})`
      : `${committed.length} sessions`;
  return { text: `Checkpointed ${label}`, kind: "info" };
}

type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

/** Run `checkpoint_commit` for every member's repo (deduped by path so a shared
 *  worktree is committed once), swallowing per-repo failures into outcomes so
 *  one bad repo never aborts the sweep. Invoke is injected for testability. */
export async function runCheckpoints(
  members: { name: string; repoPath: string }[],
  invoke: Invoke,
): Promise<CheckpointOutcome[]> {
  const seen = new Set<string>();
  const targets = members.filter((m) => {
    if (!m.repoPath || seen.has(m.repoPath)) return false;
    seen.add(m.repoPath);
    return true;
  });
  return Promise.all(
    targets.map(async (m): Promise<CheckpointOutcome> => {
      try {
        const message = await invoke<string>("checkpoint_commit", { repoPath: m.repoPath });
        return { name: m.name, status: classifyCheckpoint(true, message), detail: message };
      } catch (e) {
        return { name: m.name, status: "error", detail: String(e) };
      }
    }),
  );
}
