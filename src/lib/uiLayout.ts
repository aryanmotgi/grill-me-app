// ---------------------------------------------------------------------------
// Which app shell to render: "simple" (sessions · chat · Changes/Plan/Team) or
// "classic" (nav rail + docks). The user owns this choice (Settings →
// Appearance, or ⌘K). Brand-new users start on simple; anyone who already
// used Grill Me before the toggle existed stays on classic until they switch.
// ---------------------------------------------------------------------------

export type UiLayout = "simple" | "classic";

/** The layout to render for these settings. Unset = decide by history. */
export function uiLayoutOf(settings: Record<string, unknown>): UiLayout {
  const v = settings.uiLayout;
  if (v === "simple" || v === "classic") return v;
  return isExistingUser(settings) ? "classic" : "simple";
}

/** Someone who picked a mode, a project, or finished the tour already knows
 *  the classic shell — don't move their furniture without asking. */
function isExistingUser(settings: Record<string, unknown>): boolean {
  return settings.appMode != null || settings.activeProject != null || settings.onboarded === true;
}

/** Right-panel tabs in the simple layout. */
export type RightTab = "changes" | "plan" | "team";

export function rightTabOf(v: unknown): RightTab {
  return v === "plan" || v === "team" ? v : "changes";
}
