/**
 * THE keyboard shortcut catalog — single source of truth. Both the Cheatsheet
 * overlay (opened with "?") and the Settings → Shortcuts tab render from this
 * list, so a shortcut is documented in exactly one place. When you wire a new
 * key in App.tsx's keydown handler, add its row here.
 */
export interface Shortcut {
  /** Human-readable key(s), e.g. "⌘K" or "j / ↓". */
  keys: string;
  /** What it does, sentence-case, no trailing period. */
  what: string;
}

export const SHORTCUT_GROUPS: [string, Shortcut[]][] = [
  ["Navigate sessions", [
    { keys: "j / ↓", what: "Move the selection down the session list" },
    { keys: "k / ↑", what: "Move the selection up the session list" },
    { keys: "Enter", what: "Open the selected session" },
    { keys: "1–9", what: "Jump straight to the Nth session" },
    { keys: "/", what: "Focus the search-across-sessions box" },
  ]],
  ["Overlays", [
    { keys: "⌘K", what: "Command palette — jump to a session or run an action" },
    { keys: "⌘/", what: "Feature index — everything Grill Me can do" },
    { keys: "?", what: "This shortcut cheatsheet" },
    { keys: "Esc", what: "Close the topmost overlay" },
  ]],
  ["Workspace", [
    { keys: "⌘H", what: "Home — mission control dashboard" },
    { keys: "⌘P", what: "Switch project workspace" },
    { keys: "⌘S", what: "Ship the active session (runs /ship — tests before push)" },
    { keys: "⌘.", what: "Focus mode — collapse to just your pane" },
    { keys: "⇧C", what: "Cinema mode — full-bleed the active session (Esc exits)" },
    { keys: "⌘1–5", what: "Views: tasks / inbox / feed / team / preview" },
    { keys: "⌘,", what: "Settings" },
  ]],
  ["Panels", [
    { keys: "⌘B", what: "Show or hide the sessions panel" },
    { keys: "⌘⇧B", what: "Show or hide the nav rail" },
    { keys: "⌘J", what: "Show or hide the Claude panel" },
    { keys: "⌘`", what: "Show or hide the bottom terminal" },
  ]],
  ["Project screen", [
    { keys: "1–9 / Enter", what: "Quick-open a project from the launch screen" },
  ]],
];

/** Flat list — handy for search filtering in the Settings tab. */
export const ALL_SHORTCUTS: Shortcut[] = SHORTCUT_GROUPS.flatMap(([, s]) => s);
