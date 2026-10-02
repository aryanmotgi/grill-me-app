/**
 * Keyboard-first session navigation — the pure helpers behind j/k, the
 * number-jump, and the "am I typing?" guard. Kept side-effect-free so the
 * App keydown handler stays thin and these can be unit-tested in node.
 */
import { surfaceVisible, type AppMode } from "./soloVisibility";

/**
 * The session rows actually shown in the list, in render order. Mirrors
 * SessionList's own filter EXACTLY (same source of truth) so keyboard
 * selection can never point at a row that isn't on screen. Solo mode shows
 * every session that runs on this Mac (`ownIds` = members) — they're all
 * yours, including parallel ones from "New" — and falls back to the first row
 * when there are none (browser dev's sample rows).
 */
export function visibleSessions<T extends { id: string }>(
  teammates: T[],
  mode: AppMode,
  ownIds: string[],
): T[] {
  if (surfaceVisible(mode, "other-session-rows")) return teammates;
  return ownIds.length ? teammates.filter((t) => ownIds.includes(t.id)) : teammates.slice(0, 1);
}

/**
 * Move the selection cursor one step through an ordered id list. Clamps at
 * both ends (no wrap — j at the bottom stays put). A null/unknown current id
 * lands on the first row going down, the last going up.
 */
export function stepSelection(
  ids: string[],
  current: string | null,
  dir: 1 | -1,
): string | null {
  if (ids.length === 0) return null;
  const idx = current ? ids.indexOf(current) : -1;
  if (idx === -1) return dir === 1 ? ids[0] : ids[ids.length - 1];
  const next = Math.min(ids.length - 1, Math.max(0, idx + dir));
  return ids[next];
}

/**
 * True when a keyboard event target is a text-entry surface we must never
 * hijack: inputs, textareas, selects, contentEditable regions, or anywhere
 * inside an xterm terminal (its hidden helper textarea already matches, but
 * the .xterm closest() check covers focus on the viewport too).
 */
export function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  if (el.closest(".xterm")) return true;
  return false;
}
