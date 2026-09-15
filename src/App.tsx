import { useEffect } from "react";
import { useApp } from "./store";
import { applyTheme, themes } from "./theme/themes";
import { TopBar } from "./components/TopBar";
import { SessionList } from "./components/SessionList";
import { SessionPane } from "./components/SessionPane";
import { RightRail } from "./components/RightRail";
import { QuickSwitcher } from "./components/QuickSwitcher";
import { GlobalSearch } from "./components/GlobalSearch";
import { ConflictBanner, Toasts } from "./components/Chrome";

export default function App() {
  const {
    teammates, activeId, splitId, focusMode, demoMode, themeName,
    setSwitcherOpen, toggleFocus, quickCommit,
  } = useApp();

  useEffect(() => {
    applyTheme(themes[themeName] ?? themes.ember);
  }, [themeName]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === "k") {
        e.preventDefault();
        setSwitcherOpen(!useApp.getState().switcherOpen);
      }
      if (mod && e.key === "s") {
        e.preventDefault();
        quickCommit(useApp.getState().activeId);
      }
      if (mod && e.key === ".") {
        e.preventDefault();
        toggleFocus();
      }
      if (e.key === "Escape") setSwitcherOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setSwitcherOpen, toggleFocus, quickCommit]);

  const active = teammates.find((t) => t.id === activeId) ?? teammates[0];
  const split = splitId ? teammates.find((t) => t.id === splitId) : undefined;

  return (
    <div className={`h-full flex flex-col ${demoMode ? "demo-mode" : ""}`}>
      <TopBar />
      <ConflictBanner />
      <div className="flex-1 min-h-0 flex">
        {focusMode ? null : <SessionList />}
        <main className="flex-1 min-w-0 flex flex-col">
          <GlobalSearch />
          <div className="flex-1 min-h-0 flex divide-x divide-line">
            <SessionPane mate={active} />
            {split && split.id !== active.id && !focusMode ? (
              <SessionPane mate={split} />
            ) : null}
          </div>
        </main>
        {focusMode ? null : <RightRail />}
      </div>
      <QuickSwitcher />
      <Toasts />
    </div>
  );
}
