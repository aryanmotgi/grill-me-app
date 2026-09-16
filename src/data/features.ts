import { useApp } from "../store";

export interface Feature {
  name: string;
  what: string;
  where: string;
  go?: () => void;
}

/** Full feature catalog: every capability, where it lives, one click to open.
 *  go() callbacks read the store via useApp.getState() so they work outside
 *  React render (feature index buttons, command palette actions). */
export const FEATURE_GROUPS: [string, Feature[]][] = [
  ["Sessions & terminals", [
    { name: "Live Claude terminals", what: "A real, typable Claude Code session per teammate", where: "click any session row", go: () => useApp.getState().setView("session") },
    { name: "Shell tab", what: "Plain zsh terminal in the same worktree", where: "session pane → shell" },
    { name: "New session", what: "Creates a git worktree + branch + live session", where: "session list → + new session" },
    { name: "Pause / resume", what: "Freeze your session's process, keep all context", where: "hover your session row" },
    { name: "Record session", what: "Save raw terminal output to a replay file", where: "session pane → rec" },
    { name: "Split view", what: "Two sessions side by side, drag the divider", where: "hover a session row → split" },
    { name: "Session healing", what: "Crashed sessions auto-restart; stuck ones get flagged", where: "automatic · settings → notifications" },
  ]],
  ["Coordination", [
    { name: "Task board", what: "Shared tasks grouped by urgency, with blocking chains", where: "right rail → tasks", go: () => { const st = useApp.getState(); st.setRailTab("tasks"); st.setView("session"); } },
    { name: "Fan-out", what: "Paste a checklist → parallel sessions per independent item", where: "tasks tab → fan out", go: () => { const st = useApp.getState(); st.setRailTab("tasks"); st.setView("session"); } },
    { name: "Inbox + threads", what: "Typed messages (question/fyi/blocking/proposal), @mentions", where: "right rail → inbox", go: () => { const st = useApp.getState(); st.setRailTab("inbox"); st.setView("session"); } },
    { name: "Proposals", what: "Ask 'does this affect you?' — teammates answer in one click", where: "inbox composer → proposal" },
    { name: "File locks & conflicts", what: "Live claimed files; banner when two people touch one file", where: "tasks tab bottom · auto banner" },
    { name: "Soft heads-ups", what: "Quiet toast when someone changes a file you recently read", where: "automatic" },
    { name: "Merge rotation", what: "Whose turn to merge; run the actual merge in-app", where: "top bar chip → merge pilot" },
    { name: "Standup log", what: "Auto-stitched from finished tasks", where: "right rail → feed", go: () => { const st = useApp.getState(); st.setRailTab("activity"); st.setView("session"); } },
  ]],
  ["Shipping", [
    { name: "Review & ship", what: "Pre-merge review (commits, diff) → approve runs /ship with tests", where: "top bar amber button · ⌘S", go: () => { const st = useApp.getState(); st.shipSession(st.activeId); } },
    { name: "PR draft", what: "One-shot Claude writes the PR body from your diff", where: "session pane → changes → draft PR body" },
    { name: "Inline diffs", what: "Click any changed file for its diff, right in the app", where: "changes tab · claimed files" },
    { name: "Revert a file", what: "Per-file git checkout from the changes tab", where: "changes tab → revert" },
  ]],
  ["Safety & insight", [
    { name: "Safety blocklist", what: "Destructive commands always require explicit confirmation", where: "settings → safety", go: () => useApp.getState().setSettingsOpen(true) },
    { name: "Audit log", what: "Every command a session ran, timestamped", where: "session pane → audit", go: () => useApp.getState().setView("session") },
    { name: "Usage per session", what: "Real token counts since each session started", where: "right rail → more → team", go: () => { const st = useApp.getState(); st.setRailTab("team"); st.setView("session"); } },
    { name: "CPU / memory", what: "Live per-session resource use", where: "session rows when busy · home" },
    { name: "Project backup", what: "Export full project state as one file", where: "team panel → backup", go: () => { const st = useApp.getState(); st.setRailTab("team"); st.setView("session"); } },
  ]],
  ["Control", [
    { name: "Command palette", what: "Jump to any session or run any action by name", where: "⌘K", go: () => useApp.getState().setSwitcherOpen(true) },
    { name: "Projects", what: "Fully separate workspaces; stats on the launch screen", where: "⌘P · brand click", go: () => useApp.getState().setPickerOpen(true) },
    { name: "grillme CLI", what: "Script sessions from any terminal: send, read, spawn (~/.grillme/bin/grillme)", where: "terminal: grillme sessions" },
    { name: "Terminal themes", what: "Fonts, palettes (Dracula, Nord…), cursor, per-color overrides", where: "settings → terminal" },
    { name: "Browser windows", what: "GitHub / claude.ai in native windows", where: "top bar → ⋯" },
    { name: "Dev preview", what: "Live view of the app THIS project is building", where: "right rail → more", go: () => { const st = useApp.getState(); st.setRailTab("preview"); st.setView("session"); } },
  ]],
];
