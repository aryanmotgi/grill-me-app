// ---------------------------------------------------------------------------
// Presence map: fold the file watcher's live locks into "who is touching what
// RIGHT NOW". Pure — no store access, no clock — so it unit-tests cleanly and
// the overlay just renders the result. Fed from store.liveLocks (owner/file/ts
// straight off the Rust watcher); a member's *current* file is their most
// recent lock, and a file is a conflict when >1 distinct owner holds it.
// ---------------------------------------------------------------------------

export interface LiveLock {
  owner: string;
  file: string;
  ts: number;
}

/** A file and everyone currently in it. `conflict` when >1 distinct owner. */
export interface FilePresence {
  file: string;
  owners: string[];
  /** newest touch across all owners of this file (unix seconds) */
  latestTs: number;
  conflict: boolean;
}

/** A member and the single file they are most recently touching. */
export interface MemberPresence {
  owner: string;
  file: string;
  ts: number;
}

export interface PresenceMap {
  /** conflicts first, then by most-recent touch; files with no owners dropped */
  byFile: FilePresence[];
  /** one row per active member, most-recently-active first */
  byMember: MemberPresence[];
  fileCount: number;
  memberCount: number;
  conflictCount: number;
}

/**
 * Fold raw live locks into per-file and per-member views. A member may appear
 * under several files (they touched more than one), but their `byMember` row is
 * only their latest file so the column reads as "where they are now".
 */
export function buildPresenceMap(locks: LiveLock[]): PresenceMap {
  // file -> owner -> newest ts for that pair (dedupe repeat touches)
  const files = new Map<string, Map<string, number>>();
  // owner -> their newest lock overall
  const members = new Map<string, MemberPresence>();

  for (const l of locks) {
    let owners = files.get(l.file);
    if (!owners) {
      owners = new Map();
      files.set(l.file, owners);
    }
    const prev = owners.get(l.owner);
    if (prev === undefined || l.ts > prev) owners.set(l.owner, l.ts);

    const cur = members.get(l.owner);
    if (!cur || l.ts > cur.ts) members.set(l.owner, { owner: l.owner, file: l.file, ts: l.ts });
  }

  const byFile: FilePresence[] = [...files.entries()].map(([file, owners]) => ({
    file,
    owners: [...owners.keys()].sort(),
    latestTs: Math.max(...owners.values()),
    conflict: owners.size > 1,
  }));
  // conflicts float to the top, then most-recently-touched, then stable by name
  byFile.sort(
    (a, b) =>
      Number(b.conflict) - Number(a.conflict) ||
      b.latestTs - a.latestTs ||
      a.file.localeCompare(b.file),
  );

  const byMember = [...members.values()].sort(
    (a, b) => b.ts - a.ts || a.owner.localeCompare(b.owner),
  );

  return {
    byFile,
    byMember,
    fileCount: byFile.length,
    memberCount: byMember.length,
    conflictCount: byFile.filter((f) => f.conflict).length,
  };
}
