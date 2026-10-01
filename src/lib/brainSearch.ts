// ---------------------------------------------------------------------------
// Brain search, pure half: result shapes from `brain_search` (ranked in Rust),
// grouping for the Brain page, "why…?" detection, and where a click jumps.
// ---------------------------------------------------------------------------

export type SearchKind = "decision" | "note" | "plan" | "goal" | "lesson" | "handoff" | "question" | "review" | "commit" | "turn";

export interface SearchResult {
  kind: SearchKind; title: string; snippet: string; ts: number; source: string; ref: string;
  /** 1-based rank — what "Answer with Claude" cites as [n] */
  n: number;
}

export const KIND_LABEL: Record<SearchKind, string> = {
  decision: "Decisions", goal: "Goal history", note: "Notes", plan: "Plans", question: "Questions", handoff: "Hand-offs",
  review: "Reviews", lesson: "Past lessons", commit: "Commits", turn: "Session conversations",
};

const ORDER: SearchKind[] = ["decision", "goal", "note", "plan", "question", "handoff", "review", "commit", "turn", "lesson"];

export function parseResults(raw: unknown): SearchResult[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r) => r && typeof r === "object" && typeof r.kind === "string" && r.kind in KIND_LABEL)
    .map((r, i) => ({
      kind: r.kind as SearchKind,
      title: String(r.title ?? ""), snippet: String(r.snippet ?? ""),
      ts: typeof r.ts === "number" ? r.ts : 0, source: String(r.source ?? ""), ref: String(r.ref ?? ""), n: i + 1,
    }));
}

/** Results grouped by kind (fixed order), each group in rank order; empty groups dropped. */
export function groupResults(results: SearchResult[]): { kind: SearchKind; label: string; items: SearchResult[] }[] {
  return ORDER.map((kind) => ({ kind, label: KIND_LABEL[kind], items: results.filter((r) => r.kind === kind) })).filter((g) => g.items.length);
}

/** "why / what / when …" — offer "Answer with Claude". */
export function isWhyQuery(q: string): boolean {
  return /^\s*(why|what|when)\b/i.test(q);
}

export type Jump =
  | { to: "decisions" }
  | { to: "session"; id: string; tab: "chat" | "changes" }
  | null;

/** Where clicking a result goes: decision → decisions log, turn → that session, commit → its Changes. */
export function jumpFor(r: Pick<SearchResult, "kind" | "ref">): Jump {
  if (r.kind === "decision") return { to: "decisions" };
  const member = r.ref.split(":")[0];
  if (!member) return null;
  if (r.kind === "turn") return { to: "session", id: member, tab: "chat" };
  if (r.kind === "commit") return { to: "session", id: member, tab: "changes" };
  if (r.kind === "handoff" || r.kind === "review") return { to: "session", id: member, tab: "chat" };
  return null;
}
