import type { Decision } from "../types";
import { fmtClock } from "./format";

/**
 * Pure helpers for the shared team decisions log. No React, no store, no
 * Tauri — just entry shaping and dedup, so they're trivially unit-testable
 * and safe to reuse from the store, the overlay, and the home feed.
 */

/**
 * Build a well-formed Decision from raw composer input, or null when there is
 * nothing to log. Text is trimmed; an empty (or whitespace-only) text yields
 * null so callers can no-op instead of persisting a blank entry. The tag is
 * trimmed and lowercased, dropped entirely when empty. The id embeds the
 * author + timestamp so concurrent teammates never collide on the id-keyed
 * shared_upsert merge.
 */
export function makeDecision(
  text: string,
  author: string,
  tag?: string,
  now: number = Date.now(),
): Decision | null {
  const t = text.trim();
  if (!t) return null;
  const cleanTag = tag?.trim().toLowerCase();
  return {
    id: `d-${author}-${now}`,
    text: t,
    author,
    epochMs: now,
    ts: fmtClock(now),
    ...(cleanTag ? { tag: cleanTag } : {}),
  };
}

/**
 * Dedupe an id-keyed decision list (later duplicates win, matching the Rust
 * merge which overwrites in place by id) and return it sorted newest-first.
 * The sort is stable on epochMs then id so two entries logged in the same
 * millisecond keep a deterministic order.
 */
export function dedupeDecisions(list: Decision[]): Decision[] {
  const byId = new Map<string, Decision>();
  for (const d of list) byId.set(d.id, d);
  return [...byId.values()].sort(
    (a, b) => b.epochMs - a.epochMs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}
