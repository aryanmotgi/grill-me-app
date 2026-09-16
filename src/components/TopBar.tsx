import { useState } from "react";
import { Icon } from "./Icon";
import { attentionSessions, useApp } from "../store";
import { themes } from "../theme/themes";
import { isTauri } from "../data/sources/git";

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

async function openBrowserPanel(label: string, url: string) {
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const existing = await WebviewWindow.getByLabel(label);
  if (existing) {
    existing.setFocus();
    return;
  }
  new WebviewWindow(label, { url, title: label, width: 1100, height: 850 });
}

/** Everything secondary lives here — prime space stays calm. */
function OverflowMenu() {
  const {
    focusMode, toggleFocus, demoMode, toggleDemo, dense, toggleDense,
    themeName, setTheme, setAppSetting, setMergePilotOpen, toast,
  } = useApp();
  const [open, setOpen] = useState(false);
  const openPanel = (label: string, url: string) => {
    if (!isTauri()) { toast("Opening windows needs the native app", "warn"); return; }
    openBrowserPanel(label, url);
  };
  const item = "flex items-center gap-2 w-full px-3 py-1.5 text-left text-[11px] text-dim hover:text-ink hover:bg-raised cursor-pointer transition-colors";
  return (
    <div className="relative">
      <button className="btn" title="More" onClick={() => setOpen(!open)}>⋯</button>
      {open ? (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-40 w-52 bg-overlay hairline rounded-md shadow-2xl py-1 rise">
            <div className="panel-label px-3 pt-1.5 pb-0.5">open</div>
            <button className={item} onClick={() => { openPanel("github", "https://github.com"); setOpen(false); }}>
              GitHub window
            </button>
            <button className={item} onClick={() => { openPanel("claude", "https://claude.ai"); setOpen(false); }}>
              claude.ai window <span className="text-faint text-[9px]">(shortcut only)</span>
            </button>
            <button className={item} onClick={() => { setMergePilotOpen(true); setOpen(false); }}>
              Merge pilot terminal
            </button>
            <button className={item} onClick={() => { useApp.setState({ featureIndexOpen: true }); setOpen(false); }}>
              Everything Grill Me can do <span className="text-faint text-[9px] ml-auto">⌘/</span>
            </button>
            <div className="panel-label px-3 pt-2 pb-0.5">view</div>
            <button className={item} onClick={() => { toggleFocus(); setOpen(false); }}>
              {focusMode ? "Exit focus mode" : "Focus mode"} <span className="text-faint text-[9px] ml-auto">⌘.</span>
            </button>
            <button className={item} onClick={() => { toggleDense(); setOpen(false); }}>
              {dense ? "Comfortable density" : "Compact density"}
            </button>
            <button className={item} onClick={() => { toggleDemo(); setOpen(false); }}>
              {demoMode ? "Exit demo view" : "Demo view (clean, for showing off)"}
            </button>
            <div className="panel-label px-3 pt-2 pb-0.5">theme</div>
            {Object.keys(themes).map((n) => (
              <button key={n} className={item}
                onClick={() => { setTheme(n); setAppSetting("theme", n); setOpen(false); }}>
                {n} {n === themeName ? <Icon name="check" size={10} className="ml-auto text-ok" /> : null}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

export function TopBar() {
  const {
    teammates, mergeQueue, advanceMergeQueue, members, setMergePilotOpen,
    activeId, shipSession, setSwitcherOpen, setSettingsOpen, setPickerOpen,
    activeProject, setRailTab, messages,
  } = useApp();

  const attention = attentionSessions(teammates);
  const working = teammates.filter((t) => t.status === "working").length;
  const waiting = messages.filter((m) => !m.answered && (m.kind === "blocking" || m.kind === "question"));
  const blocking = waiting.filter((m) => m.kind === "blocking").length;
  const myTurn = mergeQueue[0] === members[0]?.id;
  const mergerName = teammates.find((t) => t.id === mergeQueue[0])?.name ?? mergeQueue[0] ?? "—";

  return (
    <header className="flex items-center gap-3 px-4 h-11 border-b border-line bg-panel flex-none">
      {/* identity + project */}
      <div className="flex items-baseline gap-2">
        <button className="font-display font-bold text-[15px] tracking-[0.08em] text-accent cursor-pointer hover:brightness-110"
          title="Home — mission control (⌘H)" onClick={() => useApp.getState().setView("home")}>
          GRILL&nbsp;ME
        </button>
        <button className="panel-label hover:text-accent transition-colors cursor-pointer" title="Switch project (⌘P)"
          onClick={() => setPickerOpen(true)}>
          {activeProject ?? "pick project"} ▾
        </button>
      </div>

      {/* one calm status cluster: who's working, who needs you */}
      <div className="flex items-center gap-2.5 text-[11px] text-dim">
        <span className="flex items-center gap-1.5"><span className="status-dot working" aria-hidden />{working} working</span>
        {attention.length > 0 ? (
          <button className="flex items-center gap-1.5 text-warn cursor-pointer hover:brightness-110"
            title={attention.length === 1
              ? `${attention[0].name} needs you — click to jump into their session`
              : "Sessions needing attention — click to see"}
            onClick={() => {
              const st = useApp.getState();
              if (attention.length === 1) st.setActive(attention[0].id);
              else st.setView("home");
            }}>
            <span className="status-dot needs-input" aria-hidden />{attention.length} need you
          </button>
        ) : null}
        {waiting.length > 0 ? (
          <button className={`cursor-pointer ${blocking ? "text-danger" : "text-warn"} hover:brightness-110`}
            title={waiting.map((m) => `${m.from} → ${m.to}: ${clip(m.text, 50)}`).join("\n")}
            onClick={() => setRailTab("inbox")}>
            {blocking ? `${blocking} blocked · ` : ""}{waiting.length} unanswered
          </button>
        ) : null}
        {myTurn ? (
          <button className="tag ok cursor-pointer" title="It's your merge turn — click to run the merge; right-click to pass"
            onClick={() => setMergePilotOpen(true)}
            onContextMenu={(e) => { e.preventDefault(); advanceMergeQueue(); }}>
            <Icon name="merge" size={11} /> your merge turn
          </button>
        ) : (
          <span className="text-faint text-[10px]" title="Merge rotation — shows in Team panel">
            merge: {mergerName}
          </span>
        )}
      </div>

      <span className="flex-1" />

      {/* search-or-act pill — the front door to everything */}
      <button
        className="flex items-center gap-2 w-64 px-3 py-1.5 bg-raised hairline rounded-md text-[11px] text-faint cursor-text hover:border-accent transition-colors"
        onClick={() => setSwitcherOpen(true)}>
        <Icon name="search" size={11} />
        <span>Jump to session or run action…</span>
        <span className="ml-auto font-mono text-[9px]">⌘K</span>
      </button>

      <button className="btn primary demo-hide"
        title={`Review & ship ${teammates.find((t) => t.id === activeId)?.name ?? "the active session"}'s work (⌘S)`}
        onClick={() => shipSession(activeId)}>
        <Icon name="push" size={11} /> review & ship{(() => { const n = teammates.find((t) => t.id === activeId)?.name; return n ? ` — ${n}` : ""; })()}
      </button>
      <OverflowMenu />
      <button className="btn demo-hide" title="Settings" onClick={() => setSettingsOpen(true)}>
        <Icon name="gear" size={11} />
      </button>
    </header>
  );
}
