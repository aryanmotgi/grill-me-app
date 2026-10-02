/**
 * Shared session-readiness detection for claude PTYs.
 *
 * A session is "ready" when it is alive and sitting at an idle claude
 * prompt — not mid-generation. The same screen-read heuristics gate both
 * shipping (store.shipApproved) and fan-out brief delivery (FanOut,
 * store.setTaskStatus).
 */

export type PtyStatus = { id: string; alive: boolean; quietMs: number; tail: string[] };

const TAIL_LINES = 15;

/**
 * Spinner frames repaint via \r, so the stripped tail keeps stale
 * "esc to interrupt" lines after generation ends. Only trust the marker
 * while output is actually still flowing (quiet for less than this).
 */
const GENERATING_QUIET_MS = 4000;

/** Last few screen lines joined for pattern matching. */
export function tailText(status: Pick<PtyStatus, "tail"> | undefined): string {
  return (status?.tail ?? []).slice(-TAIL_LINES).join("\n");
}

/** claude is actively generating ("esc to interrupt" on screen AND output recent). */
export function isMidGeneration(tail: string, quietMs?: number): boolean {
  if (!/esc to interrupt/i.test(tail)) return false;
  return quietMs === undefined || quietMs < GENERATING_QUIET_MS;
}

/** An idle claude (or shell) prompt is visible. */
export function hasIdlePrompt(tail: string): boolean {
  return (
    tail.includes("❯") ||
    /│\s*>/.test(tail) ||
    /\? for shortcuts/i.test(tail) ||
    /^>\s/m.test(tail)
  );
}

/**
 * Claude Code's first-run "do you trust this folder?" screen. Every new
 * worktree gets it. Its menu has a ❯ cursor too, so without this check the
 * screen passed for an idle prompt and a brief got typed into the menu.
 */
export function isTrustPrompt(tail: string): boolean {
  return /yes, i trust this folder|is this a project you created or one you trust|do you trust the files in this folder/i.test(tail);
}

/** Keys that pick "Yes, I trust this folder": the menu opens on "No, exit". */
export const TRUST_ACCEPT_KEYS = ["\x1b[B", "\r"] as const;

/** Alive + idle prompt + not mid-generation (and not the trust screen). */
export function isReady(status: PtyStatus | undefined): boolean {
  if (!status?.alive) return false;
  const tail = tailText(status);
  return !isTrustPrompt(tail) && !isMidGeneration(tail, status.quietMs) && hasIdlePrompt(tail);
}

/** A brief waits this long for someone to answer the trust screen. */
const TRUST_WAIT_MS = 10 * 60_000;

/**
 * Poll pty_status until the session with `ptyId` is ready.
 * Resolves true on first ready read, false after `timeoutMs`.
 */
export async function waitForPtyReady(
  ptyId: string,
  { intervalMs = 1000, timeoutMs = 30000 }: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<boolean> {
  const { invoke } = await import("@tauri-apps/api/core");
  const start = Date.now();
  let deadline = start + timeoutMs;
  for (;;) {
    try {
      const statuses = await invoke<PtyStatus[]>("pty_status");
      const st = statuses.find((s) => s.id === ptyId);
      if (isReady(st)) return true;
      // waiting on a human to trust the folder: keep the brief, don't drop it
      if (st?.alive && isTrustPrompt(tailText(st))) deadline = Math.max(deadline, start + TRUST_WAIT_MS);
    } catch {
      // transient read failure — keep polling until the deadline
    }
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/**
 * Wait for readiness, then write `brief` into the session.
 * Returns true only if the session became ready and the write succeeded.
 */
export async function deliverBriefWhenReady(ptyId: string, brief: string): Promise<boolean> {
  if (!(await waitForPtyReady(ptyId))) return false;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("pty_write", { id: ptyId, data: brief });
    return true;
  } catch {
    return false;
  }
}
