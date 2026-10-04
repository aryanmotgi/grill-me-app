// ---------------------------------------------------------------------------
// Grill Me brand mark: one flat flame with its core cut out, in ember. The only place the ember/gold brand hues appear; UI accents stay
// slate. `px` keeps the old sizing: the mark is 8px × 9px per unit.
// ---------------------------------------------------------------------------

export const EMBER = "#e0793a";
export const GOLD = "#f2c14e";

export function GrillFlame({ px = 2, dim = false }: { px?: number; dim?: boolean }) {
  // one flat shape: a flame with its core cut out, so it reads as a mark,
  // not an emoji
  return (
    <svg width={8 * px} height={9 * px} viewBox="0 0 16 18" aria-hidden className="flex-none" style={{ opacity: dim ? 0.4 : 1 }}>
      <path fill={EMBER} fillRule="evenodd"
        d="M8.4 0.5c.6 2.9 2.4 4.5 4 6.2 1.5 1.6 2.6 3.2 2.6 5.5 0 3.3-3 5.8-7 5.8s-7-2.5-7-5.8c0-2.4 1.3-4 2.7-5.4.2 1.2.8 2.1 1.6 2.6-.2-3.5 1.1-6.3 3.1-8.9z
           M8.2 9.4c-.9 1.2-2.4 2.3-2.4 4.1 0 1.4 1 2.4 2.3 2.4s2.3-1 2.3-2.4c0-1.6-1.3-2.5-2.2-4.1z" />
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
