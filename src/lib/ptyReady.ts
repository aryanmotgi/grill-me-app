/**
 * Shared session-readiness detection for claude PTYs.
 *
 * A session is "ready" when it is alive and sitting at an idle claude
 * prompt — not mid-generation. The same screen-read heuristics gate both
 * shipping (store.shipApproved) and fan-out brief delivery (FanOut,
 * store.setTaskStatus).
 */

export type PtyStatus = { id: string; alive: boolean; tail: string[] };

const TAIL_LINES = 15;

/** Last few screen lines joined for pattern matching. */
export function tailText(status: Pick<PtyStatus, "tail"> | undefined): string {
  return (status?.tail ?? []).slice(-TAIL_LINES).join("\n");
}

/** claude is actively generating ("esc to interrupt" on screen). */
export function isMidGeneration(tail: string): boolean {
  return /esc to interrupt/i.test(tail);
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

/** Alive + idle prompt + not mid-generation. */
export function isReady(status: PtyStatus | undefined): boolean {
  if (!status?.alive) return false;
  const tail = tailText(status);
  return !isMidGeneration(tail) && hasIdlePrompt(tail);
}

/**
 * Poll pty_status until the session with `ptyId` is ready.
 * Resolves true on first ready read, false after `timeoutMs`.
 */
export async function waitForPtyReady(
  ptyId: string,
  { intervalMs = 1000, timeoutMs = 30000 }: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<boolean> {
  const { invoke } = await import("@tauri-apps/api/core");
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const statuses = await invoke<PtyStatus[]>("pty_status");
      if (isReady(statuses.find((s) => s.id === ptyId))) return true;
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
