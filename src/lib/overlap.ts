// ---------------------------------------------------------------------------
// Same files as a teammate: my sessions' changed files against the session
// digests teammates' Grill Mes share over the room. Pure; ConflictBanner
// renders it. (Agents get the same warning through catch_up in Rust.)
// ---------------------------------------------------------------------------

import type { TeamSession } from "../types";

export interface TeamOverlap {
  file: string;
  /** my session titles touching it */
  mine: string[];
  /** "Maya's Login" for each teammate session touching it */
  theirs: string[];
}

export function teamOverlaps(
  mine: { title: string; files: string[] }[],
  digests: TeamSession[],
  self: { machine?: string; member?: string },
): TeamOverlap[] {
  const others = digests.filter(
    (d) => !(self.machine && d.machine === self.machine) && !(self.member && d.member === self.member),
  );
  const byFile = new Map<string, TeamOverlap>();
  for (const s of mine) {
    for (const file of s.files) {
      const theirs = others.filter((d) => d.files?.includes(file)).map((d) => `${d.memberName}'s ${d.title}`);
      if (theirs.length === 0) continue;
      const o = byFile.get(file) ?? { file, mine: [], theirs: [] };
      if (!o.mine.includes(s.title)) o.mine.push(s.title);
      for (const t of theirs) if (!o.theirs.includes(t)) o.theirs.push(t);
      byFile.set(file, o);
    }
  }
  return [...byFile.values()];
}
