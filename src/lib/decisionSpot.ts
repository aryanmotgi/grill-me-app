// ---------------------------------------------------------------------------
// Auto decisions, pure half. Rust stores proposals (bridge.json
// `decisionProposals`) already deduped against the log at write time; this
// mirrors its similarity rule so the UI also hides a pending proposal once
// an equivalent decision lands some other way (a teammate logged it, a plan).
// ---------------------------------------------------------------------------

import type { BridgeState, DecisionProposal } from "./bridge";

const STOP = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in", "is", "it", "its", "of", "on", "or", "our", "so", "that", "the",
  "this", "to", "use", "using", "we", "well", "will", "with", "lets", "let", "go", "just", "should", "ll", "ve", "re", "s", "d",
]);

/** Content words: lowercase, punctuation out, filler out, trailing plural "s" trimmed. */
export function decisionWords(s: string): string[] {
  const out: string[] = [];
  for (const raw of s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").split(/\s+/)) {
    if (!raw || STOP.has(raw)) continue;
    const w = raw.length > 3 && raw.endsWith("s") && !raw.endsWith("ss") ? raw.slice(0, -1) : raw;
    if (!out.includes(w)) out.push(w);
  }
  return out;
}

/** Same decision in other words? Jaccard ≥ 0.6, or one side's words (≥ 2) all in the other. */
export function similarDecision(a: string, b: string): boolean {
  const x = decisionWords(a);
  const y = decisionWords(b);
  if (!x.length || !y.length) return a.trim().toLowerCase() === b.trim().toLowerCase();
  const inter = x.filter((w) => y.includes(w)).length;
  const union = x.length + y.length - inter;
  const [small, big] = x.length <= y.length ? [x, y] : [y, x];
  return inter / union >= 0.6 || (small.length >= 2 && small.every((w) => big.includes(w)));
}

/** Proposals still waiting on Save / Dismiss, oldest first — minus any the log already covers. */
export function pendingProposals(b: BridgeState, logged: { text: string }[]): DecisionProposal[] {
  return (b.decisionProposals ?? [])
    .filter((p) => p.status === "pending" && p.text && !logged.some((d) => similarDecision(d.text, p.text)))
    .sort((x, y) => x.ts - y.ts);
}
