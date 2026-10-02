// Launch animation timing, kept pure so it's testable. The scene (main.ts)
// asks "where are we?" every frame; the answers come from here.

export type LaunchMode = "first" | "back";

/** Seconds. Later launches skip the particles and most of the spin. */
export const TIMELINE = {
  first: { inEnd: 1.1, spin: [1.0, 1.95] as const, fold: [1.95, 2.4] as const, minReady: 2.55, expand: 0.55 },
  back: { inEnd: 0.3, spin: [0.0, 0.5] as const, fold: [0.4, 0.68] as const, minReady: 0.72, expand: 0.5 },
};
export type Timeline = (typeof TIMELINE)[LaunchMode];

/** If the app never reports "ready", open anyway after this long. */
export const GIVE_UP_S = 10;
/** The app is shown under the opening box at this point of the expand
 *  (early: it can only start drawing once it's shown). */
export const REVEAL_AT = 0.02;
/** "Welcome back" stays this long after the app is fully shown. */
export const WELCOME_HOLD_S = 1.3;

export function modeOf(v: string | null): LaunchMode {
  return v === "back" ? "back" : "first";
}

export const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const span = (t: number, a: number, b: number) => clamp((t - a) / (b - a));

/** Clicking skips straight to the box: returns the new time offset. */
export function skipOffset(t: number, offset: number, tl: Timeline): number {
  return t < tl.fold[1] ? offset + (tl.fold[1] - t) : offset;
}

/** Fill shown in the box: eases toward real progress once the box exists. */
export function nextFill(fill: number, target: number, t: number, dt: number, tl: Timeline): number {
  if (t < tl.fold[1]) return fill;
  const f = fill + (target - fill) * clamp(dt * 7);
  return target >= 1 && f > 0.985 ? 1 : f;
}

/** The expand starts once the animation has reached the box AND loading is done. */
export function shouldExpand(t: number, fill: number, tl: Timeline): boolean {
  return t >= tl.minReady && fill >= 1;
}

export function welcomeLine(name: string, mates: number | null): { hello: string; online: string | null } {
  const first = name.trim().split(/\s+/)[0] || "";
  const hello = first ? `Welcome back, ${first}` : "Welcome back";
  if (mates === null) return { hello, online: null };
  return { hello, online: mates > 0 ? `${mates} teammate${mates === 1 ? "" : "s"} online` : "No teammates online yet" };
}

/** No animation frame for this long means macOS isn't drawing the splash
 *  (another Space, covered, screen asleep): skip it and open the app. */
export const STALL_MS = 600;

export function stalled(lastFrameMs: number, nowMs: number, hidden: boolean): boolean {
  return hidden || nowMs - lastFrameMs > STALL_MS;
}
