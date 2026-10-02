// ---------------------------------------------------------------------------
// Which app shell to render: "simple" (sessions · chat · Changes/Plan/Team) or
// "classic" (nav rail + docks). The user owns this choice (Settings →
// Appearance, or ⌘K). Everyone starts on classic.
// ---------------------------------------------------------------------------

export type UiLayout = "simple" | "classic";

/** The layout to render for these settings. Unset = decide by history. */
export function uiLayoutOf(settings: Record<string, unknown>): UiLayout {
  const v = settings.uiLayout;
  if (v === "simple" || v === "classic") return v;
  // everyone starts on classic: the rail (Flow, Brain, Bridge…) is the app;
  // simple stays one switch away (Settings → Appearance, or ⌘K)
  return "classic";
}

/** Right-panel tabs in the simple layout. */
export type RightTab = "changes" | "plan" | "team";

export function rightTabOf(v: unknown): RightTab {
  return v === "plan" || v === "team" ? v : "changes";
}
