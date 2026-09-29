import { projectHash, projectSpriteColor } from "../lib/projectColor";

// ---------------------------------------------------------------------------
// Pixel-art project icon: every project gets a little 8-bit critter, picked
// and tinted deterministically from its id (same project → same critter).
// A chosen project color overrides the tint. Pure SVG, crisp at any size.
// ---------------------------------------------------------------------------

// 8x8 sprites, "x" = lit
export const PROJECT_SPRITES: string[][] = [
  // invader
  ["..x..x..", "...xx...", "..xxxx..", ".xx..xx.", "xxxxxxxx", "x.xxxx.x", "x.x..x.x", "...xx..."],
  // ghost
  ["..xxxx..", ".xxxxxx.", "xx.xx.xx", "xxxxxxxx", "xxxxxxxx", "xxxxxxxx", "xx.xx.xx", "x...x..x"],
  // cat
  ["x......x", "xx....xx", "xxxxxxxx", "x.xxxx.x", "xxxxxxxx", "xxx..xxx", ".xxxxxx.", "..x..x.."],
  // bot
  ["...xx...", "..xxxx..", "xxxxxxxx", "x.xxxx.x", "xxxxxxxx", "..x..x..", ".xx..xx.", "........"],
  // mushroom
  ["..xxxx..", ".xx.xxx.", "xxxxx.xx", "x.xxxxxx", "xxxxxxxx", "..x..x..", "..xxxx..", "........"],
  // flame
  ["....x...", "...xx...", "..xxx.x.", ".xxxxxx.", ".xxx.xxx", "xxx..xxx", "xxx..xxx", ".xxxxxx."],
  // frog
  [".xx..xx.", "x.xxxx.x", "xxxxxxxx", "xx....xx", "xxxxxxxx", ".xxxxxx.", "xx....xx", "........"],
  // skull
  [".xxxxxx.", "xxxxxxxx", "x..xx..x", "x..xx..x", "xxxxxxxx", ".xx..xx.", ".x.xx.x.", "........"],
  // crab
  ["x......x", "x.x..x.x", ".xxxxxx.", "xx.xx.xx", "xxxxxxxx", ".xxxxxx.", "x.x..x.x", "........"],
  // heart-bug
  [".xx..xx.", "xxxxxxxx", "xx.xx.xx", "xxxxxxxx", ".xxxxxx.", "..xxxx..", "...xx...", "........"],
];

export function projectSpriteIndex(id: string): number {
  return projectHash(id) % PROJECT_SPRITES.length;
}

export function ProjectIcon({ id, color, size = 16 }: { id: string; color?: string; size?: number }) {
  const rows = PROJECT_SPRITES[projectSpriteIndex(id)];
  const fill = color ?? projectSpriteColor(id);
  return (
    <svg width={size} height={size} viewBox="0 0 8 8" shapeRendering="crispEdges" aria-hidden className="flex-none">
      {rows.flatMap((r, j) =>
        [...r].map((c, i) => (c === "x" ? <rect key={`${i}-${j}`} x={i} y={j} width={1} height={1} fill={fill} /> : null)),
      )}
    </svg>
  );
}
