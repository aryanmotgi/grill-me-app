/**
 * Pure helpers behind drag-to-reorder of the session list. Kept
 * side-effect-free so SessionList stays thin and these can be unit-tested in
 * node. The stored order is a plain array of member ids persisted in
 * settings.json under `sessionOrder`; it is advisory — items missing from it
 * fall back to their natural position, and stale ids in it are ignored.
 */

/**
 * Reorder `items` to match `order` (an array of ids). Items whose id appears
 * in `order` sort by that index; items NOT in `order` (a freshly-spawned
 * session the user hasn't dragged yet) keep their original relative position,
 * appended after the explicitly-ordered ones. Stable and total — never drops
 * or duplicates an item regardless of how stale `order` is.
 */
export function applySessionOrder<T extends { id: string }>(
  items: T[],
  order: string[] | undefined,
): T[] {
  if (!order || order.length === 0) return items;
  const rank = new Map(order.map((id, i) => [id, i]));
  // decorate-sort-undecorate so the sort is stable on the original index for
  // ties (both unranked, or — impossible but safe — equal ranks).
  return items
    .map((item, i) => ({ item, i, r: rank.has(item.id) ? rank.get(item.id)! : Infinity }))
    .sort((a, b) => (a.r - b.r) || (a.i - b.i))
    .map((d) => d.item);
}

/**
 * Move `id` one step (`dir` -1 = up, +1 = down) within `ids`, clamped at both
 * ends. Returns a new array; returns the input unchanged (same contents) if
 * `id` is absent or already at the clamp edge. Backs the keyboard fallback.
 */
export function moveId(ids: string[], id: string, dir: 1 | -1): string[] {
  const from = ids.indexOf(id);
  if (from === -1) return ids;
  const to = from + dir;
  if (to < 0 || to >= ids.length) return ids;
  const next = ids.slice();
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}

/**
 * Produce the new id order when `dragId` is dropped onto `targetId`'s row:
 * `dragId` is removed and re-inserted at `targetId`'s current index (so it
 * lands where the target was, pushing the target down/up as expected). No-op
 * when dragging onto itself or when either id is unknown.
 */
export function reorderByDrop(ids: string[], dragId: string, targetId: string): string[] {
  if (dragId === targetId) return ids;
  const from = ids.indexOf(dragId);
  const target = ids.indexOf(targetId);
  if (from === -1 || target === -1) return ids;
  const next = ids.slice();
  next.splice(from, 1);
  // insert at the target's ORIGINAL index. When dragging downward (from <
  // target) the removal shifts the target left by one, so the original index
  // now points just past it → the row lands after the target. Dragging upward
  // leaves the target put → the row lands before it. Standard list-DnD feel.
  next.splice(Math.min(target, next.length), 0, dragId);
  return next;
}
