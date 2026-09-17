import { useEffect } from "react";
import { useApp } from "./store";
import { applyTheme, themes } from "./theme/themes";
import { TopBar } from "./components/TopBar";
import { SessionList } from "./components/SessionList";
import { SessionPane } from "./components/SessionPane";
import { XtermPane } from "./components/XtermPane";
import { RightRail } from "./components/RightRail";
import { QuickSwitcher } from "./components/QuickSwitcher";
import { GlobalSearch } from "./components/GlobalSearch";
import { ConflictBanner, Toasts } from "./components/Chrome";
import { SettingsModal } from "./components/Settings";
import { ProjectPicker } from "./components/ProjectPicker";
import { Onboarding } from "./components/Onboarding";
import { ReviewModal } from "./components/ReviewModal";
import { HomeDashboard } from "./components/HomeDashboard";
import { FeatureIndex } from "./components/FeatureIndex";
import { DiffBoard } from "./components/DiffBoard";
import { CrossSessionSearch } from "./components/CrossSessionSearch";
import { SessionScrubber } from "./components/SessionScrubber";
import { PresenceMap } from "./components/PresenceMap";
import { KanbanBoard } from "./components/KanbanBoard";
import { TokenDashboard } from "./components/TokenDashboard";
import { Cheatsheet } from "./components/Cheatsheet";
import { ModeSelect } from "./components/ModeSelect";
import { CinemaMode } from "./components/CinemaMode";
import { TeamFlow } from "./components/teamflow/TeamFlow";
import { visibleRailTabs } from "./lib/soloVisibility";
import { isTypingTarget, stepSelection, visibleSessions } from "./lib/sessionNav";
import type { RailTab } from "./store";

/** Overlays that own the screen — bare-key session nav is suspended while any
 *  is open so a "?" or "j" behind a modal can't move the list underneath. */
function blockingOverlayOpen(s: ReturnType<typeof useApp.getState>): boolean {
  return (
    s.switcherOpen || s.crossSearchOpen || s.scrubberOpen || s.presenceMapOpen ||
    s.kanbanOpen || s.tokenDashOpen || s.featureIndexOpen || s.diffBoardOpen ||
    s.settingsOpen || s.pickerOpen || s.reviewFor !== null || s.cheatsheetOpen ||
    s.cinemaOpen
  );
}

function DragHandle({ onDrag, onDone }: { onDrag: (dx: number) => void; onDone: () => void }) {
  return (
    <div
      className="w-[5px] flex-none cursor-col-resize bg-line/40 hover:bg-accent/60 transition-colors"
      onMouseDown={(e) => {
        e.preventDefault();
        let last = e.clientX;
        const move = (ev: MouseEvent) => { onDrag(ev.clientX - last); last = ev.clientX; };
        const up = () => {
          window.removeEventListener("mousemove", move);
          window.removeEventListener("mouseup", up);
          onDone();
        };
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
      }}
    />
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
    applyTheme(themes[themeName] ?? themes.ember);
  }, [themeName]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // ModeSelect owns the keyboard until a mode is chosen
      if (useApp.getState().appMode === null) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === "/") {
        e.preventDefault();
        useApp.setState({ featureIndexOpen: !useApp.getState().featureIndexOpen });
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
      if (mod && e.key >= "1" && e.key <= "5") {
        // solo strips inbox/team tabs — ⌘1-N follows the visible order
        const tab = visibleRailTabs(useApp.getState().appMode)[Number(e.key) - 1];
        if (tab) {
          e.preventDefault();
          setRailTab(tab as RailTab);
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
          if (s.view === "home") setView("session");
          requestAnimationFrame(() => document.getElementById("global-search")?.focus());
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
        const ids = visibleSessions(s.teammates, s.appMode, s.members[0]?.id).map((t) => t.id);
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
        else if (s.featureIndexOpen) useApp.setState({ featureIndexOpen: false });
        else if (s.diffBoardOpen) useApp.setState({ diffBoardOpen: false });
        else if (s.settingsOpen) s.setSettingsOpen(false);
        else if (s.reviewFor) s.setReviewFor(null);
        else if (s.mergePilotOpen) setMergePilotOpen(false);
        else if (s.cinemaOpen) setCinemaOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setSwitcherOpen, toggleFocus, shipSession, setRailTab, setPickerOpen, setView, setMergePilotOpen, setActive, toggleCinema, setCinemaOpen]);

  const active = teammates.find((t) => t.id === activeId) ?? teammates[0];
  const split = splitId ? teammates.find((t) => t.id === splitId) : undefined;

  // mode routing: no mode chosen → ModeSelect (before ProjectPicker);
  // team just picked → TeamFlow screens until the setup flow completes
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

  return (
    <div className={`h-full flex flex-col ${demoMode ? "demo-mode" : ""} ${dense ? "dense" : ""}`}>
      <TopBar />
      <ConflictBanner />
      <div className="flex-1 min-h-0 flex">
        {/* attention rail — one tick per session needing input */}
        <div className="w-[22px] flex-none bg-bg border-r border-line flex flex-col items-center gap-2 pt-3 demo-hide">
          {teammates.filter((t) => t.status === "needs-input").map((t) => (
            <button key={t.id} className="status-dot needs-input cursor-pointer" title={`${t.name} needs input`}
              onClick={() => setActive(t.id)} />
          ))}
        </div>
        {focusMode ? null : <SessionList />}
        {focusMode ? null : (
          <DragHandle onDrag={(dx) => setPanelSize("left", Math.min(480, Math.max(180, panelSizes.left + dx)))}
            onDone={() => setPanelSize("left", panelSizes.left, true)} />
        )}
        <main className="flex-1 min-w-0 flex flex-col">
          {view === "home" ? (
            <HomeDashboard />
          ) : (
          <>
          <GlobalSearch />
          <div className="flex-1 min-h-0 flex">
            <div className="min-w-0 flex" style={{ flexBasis: split && !focusMode ? `${panelSizes.split * 100}%` : "100%" }}>
              <SessionPane mate={active} />
            </div>
            {split && split.id !== active.id && !focusMode ? (
              <>
                <DragHandle onDrag={(dx) => {
                  const el = document.querySelector("main");
                  if (el) setPanelSize("split", Math.min(0.8, Math.max(0.2, panelSizes.split + dx / el.clientWidth)));
                }} onDone={() => setPanelSize("split", panelSizes.split, true)} />
                <div className="min-w-0 flex flex-1">
                  <SessionPane mate={split} />
                </div>
              </>
            ) : null}
          </div>
          </>
          )}
          {mergePilotOpen && members[0] ? (
            <div className="h-[38%] flex-none border-t border-line flex flex-col">
              <div className="flex items-center px-3 h-7 bg-panel border-b border-line">
                <span className="panel-label">merge pilot — {members[0].repoPath}</span>
                <span className="flex-1" />
                <button className="btn" onClick={() => setMergePilotOpen(false)}>close</button>
              </div>
              <div className="flex-1 min-h-0">
                <XtermPane id="merge-pilot" cwd={members[0].repoPath} themeName={themeName} shell
                  autorun="git fetch origin && git merge origin/main --no-edit && npm run build" />
              </div>
            </div>
          ) : null}
        </main>
        {focusMode ? null : (
          <DragHandle onDrag={(dx) => setPanelSize("right", Math.min(560, Math.max(240, panelSizes.right - dx)))}
            onDone={() => setPanelSize("right", panelSizes.right, true)} />
        )}
        {focusMode ? null : <RightRail />}
      </div>
      <QuickSwitcher />
      <SettingsModal />
      <ProjectPicker />
      <Onboarding />
      <ReviewModal />
      <FeatureIndex />
      <DiffBoard />
      <CrossSessionSearch />
      <SessionScrubber />
      <PresenceMap />
      <KanbanBoard />
      <TokenDashboard />
      <Cheatsheet />
      <Toasts />
    </div>
  );
}
