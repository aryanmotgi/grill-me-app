/**
 * Watch-overlay target selection.
 *
 * "Watching" is shoulder-surfing a teammate's live session read-only, so the
 * pickable set is every configured member EXCEPT your own (index-0 operator) —
 * you already have your own session open and typable.
 */

export interface WatchMember {
  id: string;
  name: string;
  repoPath: string;
}

/** Members you can watch: everyone except your own session (`ownId`). */
export function watchTargets<T extends { id: string }>(members: T[], ownId?: string): T[] {
  return members.filter((m) => m.id !== ownId);
}

/**
 * Which member to select when the overlay opens. Prefer `preferred` when it is
 * a real, watchable target (e.g. launched from a specific teammate row);
 * otherwise fall back to the first target, or null when there's no one to watch.
 */
export function defaultWatchTarget<T extends { id: string }>(
  members: T[],
  ownId: string | undefined,
  preferred: string | null,
): string | null {
  const targets = watchTargets(members, ownId);
  if (preferred && targets.some((m) => m.id === preferred)) return preferred;
  return targets[0]?.id ?? null;
}
