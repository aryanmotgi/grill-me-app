import { projectSpriteColor } from "../lib/projectColor";

// ---------------------------------------------------------------------------
// Project icon: a small monogram tile, the project's first letter on a soft
// wash of its color. The color comes from the id (same project → same color)
// unless one was chosen. Pure SVG, crisp at any size.
// ---------------------------------------------------------------------------

/** One or two letters for a project: "farm-sim" → "F", "grill me" → "GM"
 *  only when the name has a second word and there's room. */
export function projectMonogram(name: string, two = false): string {
  const words = name.replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  const first = [...words[0]][0].toUpperCase();
  return two && words[1] ? first + [...words[1]][0].toUpperCase() : first;
}

export function ProjectIcon({ id, name, color, size = 16 }: { id: string; name?: string; color?: string; size?: number }) {
  const tint = color ?? projectSpriteColor(id);
  const letters = projectMonogram(name ?? id, size >= 22);
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className="flex-none">
      <rect x="0.5" y="0.5" width="23" height="23" rx="7" fill={tint} fillOpacity="0.16" stroke={tint} strokeOpacity="0.45" />
      <text x="12" y="12.5" textAnchor="middle" dominantBaseline="central" style={{ fill: `color-mix(in srgb, ${tint} 78%, var(--ink))` }}
        fontSize={letters.length > 1 ? 10.5 : size < 18 ? 15 : 14} fontWeight="600" fontFamily="inherit" letterSpacing={letters.length > 1 ? "-0.3" : "0"}>
        {letters}
      </text>
    </svg>
  );
}
