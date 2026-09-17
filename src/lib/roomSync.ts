// ---------------------------------------------------------------------------
// Pure reconciliation between the host's authoritative shared doc and this
// machine's local copy, for one file. The room feed applies the result:
//   - removeDown: ids present locally but tombstoned by the host → delete
//     locally (a delete made by a peer propagates to everyone online);
//   - pushUp: entries present locally that the host has never seen and that
//     are NOT tombstoned → re-push to the host (heals a peer that created or
//     edited entries while its connection was down).
// Tombstones are what let a delete win against a reconnecting peer that still
// holds the deleted entry: the entry is in `tombs`, so it is neither kept
// (removeDown deletes it) nor re-pushed (pushUp excludes it).
// Additive by design otherwise: a local entry the host merely hasn't merged
// yet is pushed up, never dropped — so no in-flight write is ever lost.
// ---------------------------------------------------------------------------

interface Ided {
  id?: unknown;
}

function idOf(v: unknown): string | undefined {
  if (v && typeof v === "object") {
    const id = (v as Ided).id;
    if (typeof id === "string") return id;
  }
  return undefined;
}

export interface Reconciliation<T> {
  /** ids to delete from local disk (host tombstoned them) */
  removeDown: string[];
  /** local entries to re-push to the host (unknown there, not tombstoned) */
  pushUp: T[];
}

export function reconcileShared<T>(
  authority: T[],
  local: T[],
  tombstones: string[],
): Reconciliation<T> {
  const tombs = new Set(tombstones);
  const authIds = new Set<string>();
  for (const a of authority) {
    const id = idOf(a);
    if (id) authIds.add(id);
  }
  const removeDown: string[] = [];
  const pushUp: T[] = [];
  for (const item of local) {
    const id = idOf(item);
    if (!id) continue; // id-less legacy entries are left untouched
    if (tombs.has(id)) {
      removeDown.push(id);
    } else if (!authIds.has(id)) {
      pushUp.push(item);
    }
  }
  return { removeDown, pushUp };
}
