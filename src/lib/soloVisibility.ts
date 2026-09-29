/**
 * Solo-mode visibility — the ONE place that knows which team surfaces
 * disappear when the app runs in solo mode. Components ask
 * `surfaceVisible(appMode, surface)` instead of scattering
 * `appMode === "solo"` checks (contract: Solo mode strips).
 */

export type AppMode = "solo" | "team" | null;

/** Every strippable surface, named after where it lives. */
export type SoloSurface =
  /** SessionList header "N on vm" copy */
  | "session-count"
  /** SessionList rows for anyone who isn't members[0] */
  | "other-session-rows"
  /** Merge chip + "merge: name" queue text */
  | "merge-chip"
  /** "N working" counter */
  | "working-counter"
  /** Team waiting indicator (unanswered/blocked messages) */
  | "team-waiting"
  /** Attention "needs you" for the own session — NEVER stripped */
  | "needs-you"
  /** Nav rail Inbox item */
  | "rail-inbox-tab"
  /** Nav rail Team item */
  | "rail-team-tab"
  /** HomeDashboard team pulse section */
  | "team-pulse";

/** Surfaces that only make sense with teammates; hidden in solo. */
const SOLO_HIDDEN: ReadonlySet<SoloSurface> = new Set<SoloSurface>([
  "session-count",
  "other-session-rows",
  "merge-chip",
  "working-counter",
  "team-waiting",
  "rail-inbox-tab",
  "rail-team-tab",
  "team-pulse",
]);

/**
 * Is this surface visible under the given app mode?
 * Team mode and pre-selection (null) show everything — only an explicit
 * solo choice strips, and "needs-you" survives even then.
 */
export function surfaceVisible(mode: AppMode, surface: SoloSurface): boolean {
  return mode === "solo" ? !SOLO_HIDDEN.has(surface) : true;
}

/** Rail tab ids, structurally identical to the store's RailTab. */
export type RailSurfaceTab = "files" | "tasks" | "inbox" | "activity" | "team" | "preview";

const ALL_RAIL_TABS: readonly RailSurfaceTab[] = ["files", "tasks", "inbox", "activity", "team", "preview"];

/**
 * Rail tabs available in this mode, in ⌘1-⌘N order — the keyboard mapping
 * and the nav rail both derive from this so they can never
 * disagree. Solo drops inbox + team; ⌘1-3 become tasks/activity/preview.
 */
export function visibleRailTabs(mode: AppMode): RailSurfaceTab[] {
  return ALL_RAIL_TABS.filter((t) =>
    t === "inbox" ? surfaceVisible(mode, "rail-inbox-tab")
      : t === "team" ? surfaceVisible(mode, "rail-team-tab")
      : true,
  );
}
