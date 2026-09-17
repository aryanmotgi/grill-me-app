/**
 * Broadcast target classification.
 *
 * Mirrors `can_write_session_with` in src-tauri/src/lib.rs so the UI can show
 * — before sending — which sessions a broadcast will actually reach and which
 * will be skipped. pty_write still enforces this on the backend; this is a
 * pre-flight so view-only sessions surface as "skipped" instead of erroring.
 *
 *   - The local operator (first member in config) is always writable — it's
 *     their own machine.
 *   - Any other member needs permission === "edit"; "view", unset, or an
 *     unrecognized value is view-only (input blocked).
 */

export interface BroadcastMember {
  id: string;
  name: string;
  permission?: string;
}

export interface BroadcastTarget {
  id: string;
  name: string;
  /** true → pty_write will be accepted; false → view-only, must be skipped. */
  writable: boolean;
  /** Present only when !writable — why the session was skipped. */
  reason?: string;
}

/**
 * Classify every member as writable or view-only. Index 0 is the local
 * operator (always writable); every other member requires "edit".
 */
export function classifyBroadcastTargets(members: BroadcastMember[]): BroadcastTarget[] {
  return members.map((m, i) => {
    if (i === 0 || m.permission === "edit") {
      return { id: m.id, name: m.name, writable: true };
    }
    return { id: m.id, name: m.name, writable: false, reason: "view-only" };
  });
}

/**
 * Given the full member list and the subset the user selected to broadcast to,
 * return only the selected members that are actually writable. Preserves the
 * config order and ignores selected ids that aren't real members.
 */
export function writableSelectedTargets(
  members: BroadcastMember[],
  selectedIds: Iterable<string>,
): BroadcastTarget[] {
  const selected = new Set(selectedIds);
  return classifyBroadcastTargets(members).filter((t) => selected.has(t.id) && t.writable);
}
