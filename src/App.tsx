import { useEffect, useRef, useState } from "react";
import { useApp } from "./store";
import { BottomTerminal } from "./components/BottomTerminal";
import { DragHandle } from "./components/DragHandle";
import { SimpleShell } from "./components/simple/SimpleShell";
import { CenterStage, Overlays } from "./components/ShellParts";
import { uiLayoutOf } from "./lib/uiLayout";
import { FinishSetupPill, ForgeOnboarding, useFirstRunActive } from "./components/ForgeOnboarding";
import { applyTheme, themes } from "./theme/themes";
import { NavRail } from "./components/NavRail";
import { WorkspacePanel } from "./components/WorkspacePanel";
import { EditorPane } from "./components/EditorPane";
import { SessionTabs } from "./components/SessionTabs";
import { XtermPane } from "./components/XtermPane";
import { ConflictBanner, Toasts } from "./components/Chrome";
import { ModeSelect } from "./components/ModeSelect";
import { CinemaMode } from "./components/CinemaMode";
import { TeamFlow } from "./components/teamflow/TeamFlow";
import { ClaudeDock } from "./components/ClaudePanel";
import { togglePanel, useLayout } from "./components/Dock";
import { useRemoteAutostart } from "./components/ClaudeConnect";
import { useDoctorOnLaunch } from "./components/DoctorTab";
import { leftEdgePanel, panelsOn } from "./lib/layout";
import { useWelcomeBack } from "./components/BrainPage";
import { useAutomations } from "./components/Automations";
import { StatusBar } from "./components/StatusBar";
import { useBridgeFeed } from "./components/BridgePanel";
import { useTeamChatFeed } from "./components/teamChatActions";
import { visibleRailTabs } from "./lib/soloVisibility";
import { isTypingTarget, stepSelection, visibleSessions } from "./lib/sessionNav";

/** Overlays that own the screen — bare-key session nav is suspended while any
 *  is open so a "?" or "j" behind a modal can't move the list underneath. */
function blockingOverlayOpen(s: ReturnType<typeof useApp.getState>): boolean {
  return (
    s.switcherOpen || s.crossSearchOpen || s.scrubberOpen || s.presenceMapOpen ||
    s.kanbanOpen || s.tokenDashOpen || s.featureIndexOpen || s.diffBoardOpen || s.prDashboardOpen ||
    s.branchGraphOpen || s.settingsOpen || s.pickerOpen || s.reviewFor !== null || s.cheatsheetOpen ||
    s.cinemaOpen || s.handoffFor !== null || s.sessionTemplatesOpen ||
    s.broadcastOpen || s.snippetsOpen || s.decisionsOpen || s.watchOpen
  );
}





export default function App() {
  const {
    teammates, activeId, splitId, focusMode, demoMode, themeName,
    setSwitcherOpen, toggleFocus, shipSession, setRailTab, setPickerOpen,
    dense, mergePilotOpen, setMergePilotOpen, members, setActive,
    panelSizes, setPanelSize, view, setView, appMode, teamFlowNeeded,
    cinemaOpen, toggleCinema, setCinemaOpen,
  } = useApp();

  useEffect(() => {
    applyTheme(themes[themeName] ?? themes.forge);
  }, [themeName]);

  // Background style (monocode theme): "gradient" (default) paints a soft
  // graphite ground with blurred warm/cool color pools; "translucent" uses
  // the native under-window vibrancy (lib.rs) so the desktop wallpaper shows
  // through; "solid" is flat opaque chrome. Translucent needs native macOS —
  // browser dev falls back to the gradient.
  const bgStyle = useApp((s) => (s.appSettings.background as string | undefined) ?? "gradient");
  useEffect(() => {
    const native = "__TAURI_INTERNALS__" in window && navigator.platform.startsWith("Mac");
    const vibrant = native && bgStyle === "translucent";
    document.documentElement.classList.toggle("vibrant", vibrant);
    document.documentElement.classList.toggle("bg-gradient", !vibrant && bgStyle !== "solid");
  }, [bgStyle]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // ModeSelect owns the keyboard until a mode is chosen
      if (useApp.getState().appMode === null) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === "/") {
        e.preventDefault();
        useApp.setState({ featureIndexOpen: !useApp.getState().featureIndexOpen });
      }
      // dock toggles: ⌘B sessions, ⌘⇧B sidebar, ⌘J Claude chat
      if (mod && (e.key === "b" || e.key === "B")) {
        e.preventDefault();
        togglePanel(e.shiftKey ? "nav" : "workspace");
      }
      if (mod && e.key === "j") {
        e.preventDefault();
        togglePanel("claude");
      }
      if (mod && e.key === ",") {
        e.preventDefault();
        useApp.getState().setSettingsOpen(true);
      }
      if (mod && e.key === "h") {
        e.preventDefault();
        setView("home");
      }
      if (mod && e.key === "p") {
        e.preventDefault();
        setPickerOpen(true);
      }
      if (mod && e.key === "k") {
        e.preventDefault();
        setSwitcherOpen(!useApp.getState().switcherOpen);
      }
      if (mod && e.key === "s") {
        e.preventDefault();
        shipSession(useApp.getState().activeId);
      }
      if (mod && e.key === ".") {
        e.preventDefault();
        toggleFocus();
      }
      // ⌘` toggles the bottom terminal panel (VS Code muscle memory)
      if (mod && e.key === "`") {
        e.preventDefault();
        useApp.getState().toggleBottomTerm();
      }
      if (mod && e.key >= "1" && e.key <= "5") {
        // ⌘1-N jump between center views (solo strips inbox/team)
        const mode = useApp.getState().appMode;
        const views = (["tasks", "inbox", "feed", "team", "preview"] as const).filter(
          (v) =>
            (v !== "inbox" || visibleRailTabs(mode).includes("inbox")) &&
            (v !== "team" || visibleRailTabs(mode).includes("team")),
        );
        const v = views[Number(e.key) - 1];
        if (v) {
          e.preventDefault();
          setView(v);
        }
      }

      // ---- keyboard-first navigation (bare keys; never while typing) ----
      const typing = isTypingTarget(e.target);
      // "?" toggles the cheatsheet — the single source of truth for shortcuts
      if (!mod && !typing && e.key === "?") {
        const s = useApp.getState();
        if (s.cheatsheetOpen) {
          e.preventDefault();
          useApp.setState({ cheatsheetOpen: false });
        } else if (s.activeProject && !blockingOverlayOpen(s)) {
          e.preventDefault();
          useApp.setState({ cheatsheetOpen: true });
        }
      }
      // "/" jumps to the search-across-sessions box
      if (!mod && !typing && e.key === "/") {
        const s = useApp.getState();
        if (s.activeProject && !blockingOverlayOpen(s)) {
          e.preventDefault();
          useApp.setState({ crossSearchOpen: true });
        }
      }
      // Shift+C toggles full-bleed cinema mode. Guarded by !typing so it never
      // fires from inside a terminal/input — enter it from the chrome, exit with
      // Esc (which is unguarded, so it works from within the focused terminal).
      if (!mod && !typing && e.shiftKey && (e.key === "C" || e.key === "c")) {
        const s = useApp.getState();
        if (s.cinemaOpen) {
          e.preventDefault();
          setCinemaOpen(false);
        } else if (s.activeProject && !blockingOverlayOpen(s)) {
          e.preventDefault();
          toggleCinema();
        }
      }
      // j/k + ↑/↓ move the list cursor, 1-9 jump, Enter opens — only in the
      // normal workspace (a project loaded, no modal up)
      if (!mod && !typing && useApp.getState().activeProject !== null && !blockingOverlayOpen(useApp.getState())) {
        const s = useApp.getState();
        const ids = visibleSessions(s.teammates, s.appMode, s.members.map((m) => m.id)).map((t) => t.id);
        const cur = s.navSelId ?? s.activeId;
        if (e.key === "j" || e.key === "ArrowDown") {
          e.preventDefault();
          useApp.setState({ navSelId: stepSelection(ids, cur, 1) });
        } else if (e.key === "k" || e.key === "ArrowUp") {
          e.preventDefault();
          useApp.setState({ navSelId: stepSelection(ids, cur, -1) });
        } else if (e.key === "Enter") {
          // don't steal Enter from a focused button/row/link — only act when
          // focus is loose (on <body>), where keyboard-only nav leaves it
          const ae = document.activeElement as HTMLElement | null;
          const onControl = !!ae && typeof ae.matches === "function" &&
            ae.matches('button, a[href], summary, [role="button"], [tabindex]');
          if (!onControl && ids.includes(cur)) {
            e.preventDefault();
            setActive(cur);
          }
        } else if (e.key >= "1" && e.key <= "9") {
          const id = ids[Number(e.key) - 1];
          if (id) {
            e.preventDefault();
            setActive(id);
          }
        }
      }

      if (e.key === "Escape") {
        // close exactly one overlay, topmost first
        const s = useApp.getState();
        if (s.pickerOpen && s.activeProject) {
          // picker renders z-50 above everything; Esc inside its inputs is a no-op
          if ((e.target as HTMLElement)?.tagName !== "INPUT") setPickerOpen(false);
        }
        else if (s.cheatsheetOpen) useApp.setState({ cheatsheetOpen: false });
        else if (s.switcherOpen) setSwitcherOpen(false);
        else if (s.crossSearchOpen) useApp.setState({ crossSearchOpen: false });
        else if (s.scrubberOpen) s.setScrubberOpen(false);
        else if (s.presenceMapOpen) useApp.setState({ presenceMapOpen: false });
        else if (s.kanbanOpen) useApp.setState({ kanbanOpen: false });
        else if (s.tokenDashOpen) useApp.setState({ tokenDashOpen: false });
        else if (s.branchGraphOpen) useApp.setState({ branchGraphOpen: false });
        else if (s.standupOpen) useApp.setState({ standupOpen: false });
        else if (s.mergeConductorOpen) useApp.setState({ mergeConductorOpen: false });
        else if (s.releaseNotesOpen) useApp.setState({ releaseNotesOpen: false });
        else if (s.sessionTemplatesOpen) useApp.setState({ sessionTemplatesOpen: false });
        else if (s.broadcastOpen) useApp.setState({ broadcastOpen: false });
        else if (s.watchOpen) s.setWatchOpen(false);
        else if (s.snippetsOpen) useApp.setState({ snippetsOpen: false });
        else if (s.decisionsOpen) useApp.setState({ decisionsOpen: false });
        else if (s.featureIndexOpen) useApp.setState({ featureIndexOpen: false });
        else if (s.diffBoardOpen) useApp.setState({ diffBoardOpen: false });
        else if (s.prDashboardOpen) useApp.setState({ prDashboardOpen: false });
        else if (s.settingsOpen) s.setSettingsOpen(false);
        else if (s.reviewFor) s.setReviewFor(null);
        else if (s.handoffFor) s.setHandoffFor(null);
        else if (s.mergePilotOpen) setMergePilotOpen(false);
        else if (s.cinemaOpen) setCinemaOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setSwitcherOpen, toggleFocus, shipSession, setRailTab, setPickerOpen, setView, setMergePilotOpen, setActive, toggleCinema, setCinemaOpen]);

  const active = teammates.find((t) => t.id === activeId) ?? teammates[0];
  const split = splitId ? teammates.find((t) => t.id === splitId) : undefined;
  // dockable side panels (rail, sessions, Claude chat): open/closed + side
  const [layout, setLayout] = useLayout();
  const [claudeW, setClaudeW] = useState(layout.claudeWidth);
  const claudeWRef = useRef(claudeW);
  claudeWRef.current = claudeW;
  useEffect(() => { setClaudeW(layout.claudeWidth); }, [layout.claudeWidth]);
  const edgePanel = leftEdgePanel(layout);
  const dockSide = (side: "left" | "right") =>
    panelsOn(layout, side).map((id) => {
      const edge = edgePanel === id;
      // resize handles sit on each panel's inner edge; dragging outward grows it
      const sign = side === "left" ? 1 : -1;
      if (id === "nav") return <NavRail key={id} side={side} />;
      if (id === "workspace") {
        const handle = (
          <DragHandle key={`${id}-h`} onDrag={(dx) => setPanelSize("left", Math.min(480, Math.max(180, panelSizes.left + sign * dx)))}
            onDone={() => setPanelSize("left", panelSizes.left, true)} />
        );
        const panel = <WorkspacePanel key={id} edge={edge} side={side} />;
        return side === "left" ? [panel, handle] : [handle, panel];
      }
      const handle = (
        <DragHandle key={`${id}-h`} onDrag={(dx) => setClaudeW((w) => Math.min(760, Math.max(300, w + sign * dx)))}
          onDone={() => setLayout({ ...layout, claudeWidth: claudeWRef.current })} />
      );
      const panel = <ClaudeDock key={id} edge={edge} side={side} width={claudeW} />;
      return side === "left" ? [panel, handle] : [handle, panel];
    });

  // right file pane only when a file is actually open (Monocode keeps it hidden)
  const openFileCount = useApp((s) => s.openFiles.length);
  // Claude bridge: live pending requests + "coder finished" pings
  useBridgeFeed();
  useTeamChatFeed();
  useWelcomeBack();
  useAutomations();
  useRemoteAutostart();
  useDoctorOnLaunch();
  const uiLayout = useApp((s) => uiLayoutOf(s.appSettings));
  const settingsLoaded = useApp((s) => s.settingsLoaded);
  const firstRun = useFirstRunActive();
  const showEditor = !focusMode && view === "session" && !!active && openFileCount > 0;

  // mode routing: no mode chosen → ModeSelect (before ProjectPicker);
  // team just picked → TeamFlow screens until the setup flow completes
  if (!settingsLoaded) return <div className="h-full ground" />;
  if (firstRun) return <ForgeOnboarding />;
  if (appMode === null) return <ModeSelect />;
  if (appMode === "team" && teamFlowNeeded) return <TeamFlow />;

  // Cinema mode owns the whole window: render only the active terminal, full
  // bleed, and unmount the entire normal shell (so no second XtermPane fights
  // this one over the same pty). Esc / the exit pill / ⇧C leave it.
  if (cinemaOpen && view === "session" && active) {
    return (
      <div className={`h-full ${dense ? "dense" : ""}`}>
        <CinemaMode mate={active} themeName={themeName} />
        <Toasts />
      </div>
    );
  }

  if (uiLayout === "simple") return <><SimpleShell active={active} split={split} /><FinishSetupPill /></>;

  return (
    <div className={`h-full flex flex-col ${demoMode ? "demo-mode" : ""} ${dense ? "dense" : ""}`}>
      <ConflictBanner />
      <div className="flex-1 min-h-0 flex">
        {focusMode ? null : dockSide("left")}
        <main className="flex-1 min-w-0 flex flex-col">
          {focusMode ? null : <SessionTabs padLeft={edgePanel === null} />}
          <CenterStage active={active} split={split} />
          <BottomTerminal active={active} />
          {mergePilotOpen && members[0] ? (
            <div className="h-[38%] flex-none border-t border-line flex flex-col">
              <div className="flex items-center px-3 h-7 bg-panel border-b border-line">
                <span className="panel-label">merge pilot — {members[0].repoPath}</span>
                <span className="flex-1" />
                <button className="btn" onClick={() => setMergePilotOpen(false)}>close</button>
              </div>
              <div className="flex-1 min-h-0">
                <XtermPane id="merge-pilot" cwd={members[0].repoPath} themeName={themeName} shell
                  autorun={'git fetch origin && git merge "$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD || echo origin/main)" --no-edit && npm run build'} />
              </div>
            </div>
          ) : null}
          {focusMode ? null : <StatusBar />}
        </main>
        {/* the new-session screen is full-width like Monocode's — no editor */}
        {!showEditor ? null : (
          <DragHandle onDrag={(dx) => setPanelSize("right", Math.min(680, Math.max(240, panelSizes.right - dx)))}
            onDone={() => setPanelSize("right", panelSizes.right, true)} />
        )}
        {showEditor ? <EditorPane /> : null}
        {focusMode ? null : dockSide("right")}
      </div>
      <Overlays />
      <FinishSetupPill />
    </div>
  );
}
