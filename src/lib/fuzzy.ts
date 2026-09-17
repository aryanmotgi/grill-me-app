/**
 * Subsequence fuzzy matching for the command palette. Pure — unit tested.
 *
 * `fuzzyMatch` returns null when the query's characters do not appear, in
 * order, somewhere in the text (case-insensitive). Otherwise it returns a
 * score (higher = better) plus the matched character positions so results can
 * highlight exactly which letters the query hit.
 *
 * Scoring rewards, in rough order of weight: consecutive runs, matches at a
 * word boundary (start, or after a space / - / _ / / / .), and matches early
 * in the string; it penalises the gaps skipped to reach each match. The
 * leftmost-greedy scan is complete — if any subsequence exists it finds one —
 * so a match is never missed, only scored.
 */
export interface FuzzyResult {
  score: number;
  /** indices into `text` that matched, ascending */
  positions: number[];
}

const BOUNDARY = new Set([" ", "-", "_", "/", ".", ":"]);

export function fuzzyMatch(text: string, query: string): FuzzyResult | null {
  const q = query.trim().toLowerCase();
  if (!q) return { score: 0, positions: [] };
  const t = text.toLowerCase();

  const positions: number[] = [];
  let score = 0;
  let from = 0; // next searchable index in text
  let prev = -2; // index of the previous match

  for (const c of q) {
    let found = -1;
    for (let j = from; j < t.length; j++) {
      if (t[j] === c) { found = j; break; }
    }
    if (found === -1) return null;

    positions.push(found);
    score += 1;
    if (found === prev + 1) score += 5; // consecutive run
    const boundary = found === 0 || BOUNDARY.has(t[found - 1]);
    if (boundary) score += 3;
    const gap = found - from; // chars skipped to reach this match
    if (gap > 0) score -= Math.min(gap, 4) * 0.5;

    prev = found;
    from = found + 1;
  }

  score -= positions[0] * 0.1; // prefer matches nearer the start
  return { score, positions };
}

/** A run of text flagged as a query match or not, for highlight rendering. */
export interface FuzzySegment {
  text: string;
  hit: boolean;
}

/**
 * Split `text` into alternating match / non-match runs given the matched
 * `positions` from `fuzzyMatch` (ascending indices). Empty positions returns
 * the whole string as one non-match segment. Pure.
 */
export function fuzzySegments(text: string, positions: number[]): FuzzySegment[] {
  if (positions.length === 0) return [{ text, hit: false }];
  const hitAt = new Set(positions);
  const segments: FuzzySegment[] = [];
  let run = "";
  let runHit = hitAt.has(0);
  for (let i = 0; i < text.length; i++) {
    const isHit = hitAt.has(i);
    if (isHit !== runHit && run) {
      segments.push({ text: run, hit: runHit });
      run = "";
    }
    runHit = isHit;
    run += text[i];
  }
  if (run) segments.push({ text: run, hit: runHit });
  return segments;
}

/**
 * Rank `items` against `query`, keeping only matches, best score first. Each
 * item is scored across one or more `fields` (e.g. a label plus a hint); the
 * best-scoring field wins, and its index + positions come back so the caller
 * can highlight the field that actually matched. Stable for equal scores
 * (preserves input order). Pure.
 */
export interface Ranked<T> {
  item: T;
  score: number;
  /** which field produced the winning match */
  fieldIndex: number;
  positions: number[];
}

export function fuzzyRank<T>(
  items: T[],
  query: string,
  fields: (item: T) => string[],
): Ranked<T>[] {
  const out: Ranked<T>[] = [];
  items.forEach((item) => {
    const fs = fields(item);
    let best: FuzzyResult | null = null;
    let bestField = 0;
    for (let i = 0; i < fs.length; i++) {
      const r = fuzzyMatch(fs[i], query);
      if (r && (!best || r.score > best.score)) { best = r; bestField = i; }
    }
    if (best) out.push({ item, score: best.score, fieldIndex: bestField, positions: best.positions });
  });
  // stable sort by score desc — forEach preserved input order for ties
  return out.map((r, i) => [r, i] as const)
    .sort((a, b) => b[0].score - a[0].score || a[1] - b[1])
    .map(([r]) => r);
}
