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
    await submitToAgent(ptyId, brief);
    return true;
  } catch {
    return false;
  }
}

/** What to write so an agent's prompt gets `text` and submits it. A real
 *  Enter is "\r": Claude Code treats "\n" as a new line inside the message,
 *  so a trailing "\n" left messages sitting unsent in its input box.
 *  Multi-line text goes in as one bracketed paste, so its line breaks stay
 *  line breaks instead of submitting early. */
export function submitParts(text: string): [string, string] {
  // typed lines ("\n"), never a bracketed paste: Claude treats pasted text as
  // material you shared rather than your instruction (mirrors pty_submit)
  const body = text.replace(/\r\n?/g, "\n").replace(/\n+$/, "");
  return [body, "\r"];
}

/** Type `text` into an agent session and press Enter (after a beat, so the
 *  TUI has taken the text in first). */
export async function submitToAgent(ptyId: string, text: string): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  // one backend path for every sender: paste, Enter, and a second Enter if
  // the agent is still holding the message ("press Enter to send")
  await invoke("pty_submit", { id: ptyId, text });
}

/** Send a message to a session even if its agent isn't running yet (after a
 *  restart, agents start when you open them): start it, wait until it's at
 *  its prompt, then send. */
export async function sendToSession(member: { id: string; repoPath: string; remote?: string | null; tmuxSession?: string | null; agent?: string | null }, ptyId: string, text: string): Promise<boolean> {
  const { invoke } = await import("@tauri-apps/api/core");
  // Grill Me's own request: it mustn't become the session's name
  void import("./autoTitle").then((m) => m.markSent(text));
  await invoke("pty_ensure", {
    id: ptyId, cwd: member.repoPath, shell: false,
    remote: member.remote ?? null, tmux: member.tmuxSession ?? null, agent: member.agent ?? null,
  }).catch(() => {});
  return deliverBriefWhenReady(ptyId, text);
}
