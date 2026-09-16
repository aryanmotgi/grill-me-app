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
    panelSizes, setPanelSize, view, setView,
  } = useApp();

  useEffect(() => {
    applyTheme(themes[themeName] ?? themes.ember);
  }, [themeName]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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
        e.preventDefault();
        setRailTab((["tasks", "inbox", "activity", "team", "preview"] as const)[Number(e.key) - 1]);
      }
      if (e.key === "Escape") {
        // close exactly one overlay, topmost first
        const s = useApp.getState();
        if (s.switcherOpen) setSwitcherOpen(false);
        else if (s.featureIndexOpen) useApp.setState({ featureIndexOpen: false });
        else if (s.settingsOpen) s.setSettingsOpen(false);
        else if (s.reviewFor) s.setReviewFor(null);
        else if (s.mergePilotOpen) setMergePilotOpen(false);
        else if (s.pickerOpen && s.activeProject) setPickerOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setSwitcherOpen, toggleFocus, shipSession, setRailTab, setPickerOpen, setView, setMergePilotOpen]);

  const active = teammates.find((t) => t.id === activeId) ?? teammates[0];
  const split = splitId ? teammates.find((t) => t.id === splitId) : undefined;

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
      <Toasts />
    </div>
  );
}
