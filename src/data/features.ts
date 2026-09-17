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
    { name: "Session templates", what: "Spawn from a recipe: branch prefix + a starting prompt briefed in once the session is ready", where: "session list → template · ⌘/", go: () => useApp.setState({ sessionTemplatesOpen: true }) },
    { name: "Pause / resume", what: "Freeze your session's process, keep all context", where: "hover your session row" },
    { name: "Record session", what: "Save raw terminal output to a replay file", where: "session pane → rec" },
    { name: "Timeline scrubber", what: "Scroll through a session's recent output with a slider", where: "⌘K → timeline scrubber", go: () => useApp.getState().setScrubberOpen(true) },
    { name: "Split view", what: "Two sessions side by side, drag the divider", where: "hover a session row → split" },
    { name: "Cinema mode", what: "Full-bleed the active session — hides all chrome, ambient glow rim, just the terminal", where: "⇧C · Esc exits", go: () => useApp.getState().setCinemaOpen(true) },
    { name: "Session healing", what: "Crashed sessions auto-restart; stuck ones get flagged", where: "automatic · settings → notifications", go: () => useApp.getState().setSettingsOpen(true, "notifications") },
  ]],
  ["Coordination", [
    { name: "Task board", what: "Shared tasks grouped by urgency, with blocking chains", where: "right rail → tasks", go: () => { const st = useApp.getState(); st.setRailTab("tasks"); st.setView("session"); } },
    { name: "Kanban board", what: "Tasks as draggable cards across blocked / not-started / in-progress / done", where: "⌘K → kanban board", go: () => useApp.setState({ kanbanOpen: true }) },
    { name: "Fan-out", what: "Paste a checklist → parallel sessions per independent item", where: "tasks tab → fan out", go: () => { const st = useApp.getState(); st.setRailTab("tasks"); st.setView("session"); } },
    { name: "Broadcast", what: "Send one prompt or command to all sessions at once — pick which, skip view-only, optionally wait for each to be at a prompt", where: "⌘K → broadcast", go: () => useApp.setState({ broadcastOpen: true }) },
    { name: "Inbox + threads", what: "Typed messages (question/fyi/blocking/proposal), @mentions", where: "right rail → inbox", go: () => { const st = useApp.getState(); st.setRailTab("inbox"); st.setView("session"); } },
    { name: "Proposals", what: "Ask 'does this affect you?' — teammates answer in one click", where: "inbox composer → proposal" },
    { name: "File locks & conflicts", what: "Live claimed files; banner when two people touch one file", where: "tasks tab bottom · auto banner" },
    { name: "Branch graph", what: "Every teammate's branch as a lane — ahead/behind vs main, last commit, divergence", where: "⌘K → branch graph", go: () => useApp.setState({ branchGraphOpen: true }) },
    { name: "Presence map", what: "Who is touching what right now — files → members in them, conflicts flagged", where: "⌘/ → presence map", go: () => useApp.setState({ presenceMapOpen: true }) },
    { name: "Soft heads-ups", what: "Quiet toast when someone changes a file you recently read", where: "automatic" },
    { name: "Merge rotation", what: "Whose turn to merge; run the actual merge in-app", where: "top bar chip → merge pilot" },
    { name: "Merge conductor", what: "Guided walk of the merge queue: predicts each branch's conflict with the next, then merges one at a time on your confirm", where: "⌘/ → merge conductor · home", go: () => useApp.setState({ mergeConductorOpen: true }) },
    { name: "Standup log", what: "Auto-stitched from finished tasks", where: "right rail → feed", go: () => { const st = useApp.getState(); st.setRailTab("activity"); st.setView("session"); } },
    { name: "Standup", what: "AI per-teammate Done / Doing / Blocked from git log + tasks; post to the standup log", where: "⌘K → standup", go: () => useApp.setState({ standupOpen: true }) },
    { name: "Session handoff", what: "Claude summarizes where you are + what's next, then sends it to a teammate", where: "session pane → hand off · ⌘K", go: () => { const st = useApp.getState(); st.setHandoffFor(st.activeId); } },
    { name: "Decisions log", what: "Shared, append-only record of what the team decided and why — newest-first, with an optional tag", where: "⌘K → decisions log", go: () => useApp.setState({ decisionsOpen: true }) },
    { name: "Request help", what: "Flag a stuck session — pings the team with a blocking note and shows on everyone's home until you clear it", where: "session pane → request help · ⌘K session row", go: () => { const st = useApp.getState(); st.requestHelp(st.activeId); } },
  ]],
  ["Shipping", [
    { name: "Review & ship", what: "Pre-merge review (commits, diff) → approve runs /ship with tests", where: "top bar amber button · ⌘S", go: () => { const st = useApp.getState(); st.shipSession(st.activeId); } },
    { name: "Diff review board", what: "Every session's branch-vs-main diff in one scrollable, collapsible column", where: "⌘K → diff review board", go: () => useApp.setState({ diffBoardOpen: true }) },
    { name: "PR dashboard", what: "Open PRs with CI status, review state, and one-click squash-merge (via gh)", where: "⌘K → PR dashboard", go: () => useApp.setState({ prDashboardOpen: true }) },
    { name: "PR draft", what: "One-shot Claude writes the PR body from your diff", where: "session pane → changes → draft PR body" },
    { name: "Release notes", what: "AI groups commits + merged PRs since the last tag into Features / Fixes / Chores markdown", where: "⌘K → release notes", go: () => useApp.setState({ releaseNotesOpen: true }) },
    { name: "Inline diffs", what: "Click any changed file for its diff, right in the app", where: "changes tab · claimed files" },
    { name: "Revert a file", what: "Per-file git checkout from the changes tab", where: "changes tab → revert" },
  ]],
  ["Safety & insight", [
    { name: "Safety blocklist", what: "Destructive commands always require explicit confirmation", where: "settings → safety", go: () => useApp.getState().setSettingsOpen(true, "safety") },
    { name: "Auto-checkpoint", what: "Periodic local snapshot commits per session (current branch, never pushed) so work is never lost", where: "settings → checkpoints", go: () => useApp.getState().setSettingsOpen(true, "checkpoints") },
    { name: "Checkpoint now", what: "Snapshot-commit every session's uncommitted work right now — local only", where: "⌘K · settings → checkpoints", go: () => { void useApp.getState().checkpointNow(); } },
    { name: "Audit log", what: "Every command a session ran, timestamped", where: "session pane → audit", go: () => useApp.getState().setView("session") },
    { name: "Usage per session", what: "Real token counts since each session started", where: "right rail → more → team", go: () => { const st = useApp.getState(); st.setRailTab("team"); st.setView("session"); } },
    { name: "Token & cost dashboard", what: "Per-session token totals, burn chart, biggest spender, and an estimated $", where: "⌘/ → token & cost", go: () => useApp.setState({ tokenDashOpen: true }) },
    { name: "CPU / memory", what: "Live per-session resource use", where: "session rows when busy · home" },
    { name: "Project backup", what: "Export full project state as one file", where: "team panel → backup", go: () => { const st = useApp.getState(); st.setRailTab("team"); st.setView("session"); } },
  ]],
  ["Control", [
    { name: "Command palette", what: "Jump to any session or run any action by name", where: "⌘K", go: () => useApp.getState().setSwitcherOpen(true) },
    { name: "Snippet library", what: "Save reusable prompts, insert one into the active session to edit before sending", where: "⌘K → snippet library", go: () => useApp.setState({ snippetsOpen: true }) },
    { name: "Keyboard-first nav", what: "j/k to move the session list, Enter to open, 1-9 to jump, / to search", where: "press ? for the cheatsheet", go: () => useApp.setState({ cheatsheetOpen: true }) },
    { name: "Cross-session search", what: "Search every session's terminal output at once; jump to any hit", where: "⌘K → cross-session search", go: () => useApp.setState({ crossSearchOpen: true }) },
    { name: "Projects", what: "Fully separate workspaces; stats on the launch screen", where: "⌘P · brand click", go: () => useApp.getState().setPickerOpen(true) },
    { name: "grillme CLI", what: "Script sessions from any terminal: send, read, spawn (~/.grillme/bin/grillme)", where: "terminal: grillme sessions" },
    { name: "Terminal themes", what: "Fonts, palettes (Dracula, Nord…), cursor, per-color overrides", where: "settings → terminal", go: () => useApp.getState().setSettingsOpen(true, "terminal") },
    { name: "Browser windows", what: "GitHub / claude.ai in native windows", where: "top bar → ⋯" },
    { name: "Dev preview", what: "Live view of the app THIS project is building", where: "right rail → more", go: () => { const st = useApp.getState(); st.setRailTab("preview"); st.setView("session"); } },
  ]],
];
