// ---------------------------------------------------------------------------
// Which app shell to render: "simple" (sessions · chat · Changes/Plan/Team) or
// "classic" (nav rail + docks). The user owns this choice (Settings →
// Appearance, or ⌘K). Everyone starts on simple: one sidebar, the agent in
// the middle, what it did on the right.
// ---------------------------------------------------------------------------

export type UiLayout = "simple" | "classic";

/** The layout to render for these settings. Unset = decide by history. */
export function uiLayoutOf(settings: Record<string, unknown>): UiLayout {
  const v = settings.uiLayout;
  if (v === "simple" || v === "classic") return v;
  // everyone starts on simple; Brain, Flow, DNA and the Bridge live in its
  // sidebar, and classic stays one switch away (Settings → Appearance, or ⌘K)
  return "simple";
}

/** Right-panel tabs in the simple layout. */
export type RightTab = "changes" | "preview" | "plan" | "team";

export function rightTabOf(v: unknown): RightTab {
  return v === "preview" || v === "plan" || v === "team" ? v : "changes";
}
