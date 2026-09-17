// ---------------------------------------------------------------------------
// Merge conductor — pure walk state over the merge queue.
//
// The store's mergeQueue is a rotation (advanceMergeQueue moves the head to the
// tail; shipApproved does the same on a successful /ship), so it never empties.
// A guided one-pass walk therefore tracks which members it has already actioned
// this session and stops once every queue member has been visited exactly once.
// This helper is the single source of truth for "where are we in the walk" and
// is kept free of React/store so it can be unit-tested directly.
// ---------------------------------------------------------------------------

/** How each already-actioned member was resolved during this walk. */
export type VisitOutcome = "merged" | "skipped";

/** member id → the outcome we recorded when we stepped past them. */
export type VisitedMap = Record<string, VisitOutcome>;

export interface ConductorStep {
  /** The member to act on now — queue head — or null when done / empty. */
  head: string | null;
  /** The next branch in line, to predict conflicts against; null if none. */
  next: string | null;
  /** True once every member in the queue has been visited once. */
  done: boolean;
  /** Total members in the rotation. */
  total: number;
  /** How many members remain unvisited (head included). */
  remaining: number;
  mergedCount: number;
  skippedCount: number;
}

/**
 * Given the live (rotating) queue and the set of members already actioned this
 * session, compute the current step. `head` is the member to merge/skip next;
 * `next` is the branch to run predict_conflict against. When every member has
 * been visited, `done` is true and both head/next are null.
 */
export function conductorStep(queue: string[], visited: VisitedMap): ConductorStep {
  const total = queue.length;
  const outcomes = Object.values(visited);
  const mergedCount = outcomes.filter((v) => v === "merged").length;
  const skippedCount = outcomes.filter((v) => v === "skipped").length;
  // only count visits for members still in the queue — guards against stale
  // ids left over from a team-config change while the overlay was open
  const visitedCount = Object.keys(visited).filter((id) => queue.includes(id)).length;
  const done = total > 0 && visitedCount >= total;
  const head = total === 0 || done ? null : queue[0];
  const next = total > 1 && !done ? queue[1] : null;
  return {
    head,
    next,
    done,
    total,
    remaining: Math.max(0, total - visitedCount),
    mergedCount,
    skippedCount,
  };
}
