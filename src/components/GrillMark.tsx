// ---------------------------------------------------------------------------
// Grill Me brand mark: a two-tone pixel flame (ember outer, gold core). The
// only place the ember/gold brand hues appear — UI accents stay slate.
// ---------------------------------------------------------------------------

const FLAME = [
  "...o....",
  "...oo...",
  "..ooo...",
  "..oyoo..",
  ".ooyyoo.",
  ".oyyyyo.",
  "ooyyyyoo",
  "oyyyyyyo",
  ".oyyyyo.",
];

export const EMBER = "#e0793a";
export const GOLD = "#f2c14e";

export function GrillFlame({ px = 2, dim = false }: { px?: number; dim?: boolean }) {
  return (
    <svg width={8 * px} height={9 * px} aria-hidden className="flex-none" style={{ opacity: dim ? 0.55 : 1 }}>
      {FLAME.flatMap((row, j) =>
        [...row].map((c, i) =>
          c === "." ? null : (
            <rect key={`${i}-${j}`} x={i * px} y={j * px} width={px} height={px} fill={c === "o" ? EMBER : GOLD} />
          ),
        ),
      )}
    </svg>
  );
}

export function GrillWordmark() {
  return (
    <span className="flex items-center gap-2 select-none">
      <GrillFlame px={2} />
      <span className="text-[13px] font-semibold tracking-tight text-ink">
        grill<span style={{ color: EMBER }}>me</span>
      </span>
    </span>
  );
}
