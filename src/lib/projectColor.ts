// ---------------------------------------------------------------------------
// Stable per-project accent color, derived from the project id so each project
// reads distinctly in the rail (like Monocode's colored project list) without
// anyone having to pick a color. Muted saturation + mid lightness so the dots
// sit inside the graphite/mono palette instead of shouting.
// ---------------------------------------------------------------------------

/** Deterministic hue (0–359) from a string id via a small FNV-ish hash. */
function hueFromId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % 360;
}

/** A quiet HSL color for a project id — same id always yields the same color. */
export function projectColor(id: string): string {
  return `hsl(${hueFromId(id)} 34% 62%)`;
}

/** Brighter variant for the project monogram tile — needs more punch than
 *  a dot to read at 16px, still desaturated enough for the graphite chrome. */
export function projectSpriteColor(id: string): string {
  return `hsl(${hueFromId(id)} 62% 64%)`;
}

/** Stable small integer from an id (sprite picker). */
export function projectHash(id: string): number {
  return hueFromId(id + "#sprite");
}
