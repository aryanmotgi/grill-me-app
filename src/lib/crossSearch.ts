import type { Teammate } from "../types";

/** One matching terminal line plus a line of context on either side. */
export interface SearchHit {
  /** index of the matching line within the session's terminal buffer */
  index: number;
  text: string;
  before?: string;
  after?: string;
}

/** A session with at least one match. */
export interface SessionMatches {
  mate: Teammate;
  hits: SearchHit[];
}

/**
 * Case-insensitive substring search across every session's live terminal
 * tail (the same stripped output the pty feed keeps in `teammate.terminal`).
 * Returns only sessions with >=1 match, each hit carrying the matching line
 * and one line of context above and below. Pure — unit tested.
 */
export function searchSessions(teammates: Teammate[], query: string): SessionMatches[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: SessionMatches[] = [];
  for (const mate of teammates) {
    const lines = mate.terminal;
    const hits: SearchHit[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].text.toLowerCase().includes(q)) {
        hits.push({
          index: i,
          text: lines[i].text,
          before: i > 0 ? lines[i - 1].text : undefined,
          after: i < lines.length - 1 ? lines[i + 1].text : undefined,
        });
      }
    }
    if (hits.length > 0) out.push({ mate, hits });
  }
  return out;
}

/** Total matches across all sessions — drives the cyan count readout. */
export function totalMatches(groups: SessionMatches[]): number {
  return groups.reduce((n, g) => n + g.hits.length, 0);
}

/** A run of text flagged as a query match or not, for highlight rendering. */
export interface Segment {
  text: string;
  hit: boolean;
}

/**
 * Split a line into alternating non-match / match segments for the given
 * query (case-insensitive), preserving the original casing of each run.
 * Empty query returns the whole line as a single non-match segment. Pure.
 */
export function splitMatch(text: string, query: string): Segment[] {
  const q = query.trim().toLowerCase();
  if (!q) return [{ text, hit: false }];
  const lower = text.toLowerCase();
  const segments: Segment[] = [];
  let from = 0;
  let at = lower.indexOf(q, from);
  while (at !== -1) {
    if (at > from) segments.push({ text: text.slice(from, at), hit: false });
    segments.push({ text: text.slice(at, at + q.length), hit: true });
    from = at + q.length;
    at = lower.indexOf(q, from);
  }
  if (from < text.length) segments.push({ text: text.slice(from), hit: false });
  return segments;
}
