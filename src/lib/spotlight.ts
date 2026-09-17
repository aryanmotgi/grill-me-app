/**
 * Spotlight-tour geometry — the ONE place that knows how to turn a target
 * element's rect into (a) the padded highlight cut-out and (b) a coachmark
 * position that stays on-screen. Kept DOM-free so it's unit-testable: the
 * Onboarding component feeds it plain getBoundingClientRect numbers.
 */

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export type Placement = "below" | "right" | "above" | "left";

export interface Placed {
  /** Highlight rect, padded out from the target. */
  spot: Box;
  /** Top-left for the coachmark, clamped inside the viewport. */
  tip: { left: number; top: number };
  placement: Placement;
}

export interface PlaceOpts {
  /** Breathing room between the highlight ring and the target. */
  pad?: number;
  /** Gap between the highlight and the coachmark. */
  gap?: number;
  /** Minimum distance the coachmark keeps from the viewport edge. */
  margin?: number;
}

const clamp = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, v));

/** Grow a box outward by `pad` on every side. */
export function padBox(target: Box, pad: number): Box {
  return {
    left: target.left - pad,
    top: target.top - pad,
    width: target.width + pad * 2,
    height: target.height + pad * 2,
  };
}

/**
 * Choose where the coachmark sits relative to the (already padded) highlight.
 * Prefers below, then to the right (handles the tall left session rail), then
 * above, then left — falling back to below when nothing fits. The chosen
 * corner is always clamped so the whole card stays within the viewport.
 */
export function placeCoachmark(
  target: Box,
  tip: Size,
  viewport: Size,
  opts: PlaceOpts = {},
): Placed {
  const pad = opts.pad ?? 6;
  const gap = opts.gap ?? 14;
  const margin = opts.margin ?? 12;

  const spot = padBox(target, pad);
  const spotRight = spot.left + spot.width;
  const spotBottom = spot.top + spot.height;

  const roomBelow = viewport.height - spotBottom;
  const roomAbove = spot.top;
  const roomRight = viewport.width - spotRight;
  const roomLeft = spot.left;

  const fitsV = tip.height + gap;
  const fitsH = tip.width + gap;

  let placement: Placement;
  if (roomBelow >= fitsV) placement = "below";
  else if (roomRight >= fitsH) placement = "right";
  else if (roomAbove >= fitsV) placement = "above";
  else if (roomLeft >= fitsH) placement = "left";
  else placement = "below";

  let left: number;
  let top: number;
  switch (placement) {
    case "below":
      left = spot.left;
      top = spotBottom + gap;
      break;
    case "above":
      left = spot.left;
      top = spot.top - gap - tip.height;
      break;
    case "right":
      left = spotRight + gap;
      top = spot.top;
      break;
    case "left":
      left = spot.left - gap - tip.width;
      top = spot.top;
      break;
  }

  return {
    spot,
    placement,
    tip: {
      left: clamp(left, margin, Math.max(margin, viewport.width - tip.width - margin)),
      top: clamp(top, margin, Math.max(margin, viewport.height - tip.height - margin)),
    },
  };
}
