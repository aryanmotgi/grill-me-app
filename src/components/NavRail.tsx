import { useApp, type MainView } from "../store";
import { surfaceVisible } from "../lib/soloVisibility";
import { Icon } from "./Icon";
import { projectColor } from "../lib/projectColor";

// ---------------------------------------------------------------------------
// Monocode-style far-left nav rail: Search / Inbox / team surfaces up top,
// a Projects list in the middle, Settings + version pinned at the bottom.
// Clicking a team surface swaps the CENTER view (they are full screens now,
// not a right-rail sidebar). The rail top doubles as window-drag chrome
// under the overlay titlebar.
// ---------------------------------------------------------------------------

function NavItem({ icon, label, badge, active, onClick, title }: {
  icon: string;
  label: string;
  badge?: number;
  active?: boolean;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      className={`flex items-center gap-2.5 w-full text-left px-3 py-1.5 rounded-md cursor-pointer transition-colors ${
        active ? "bg-raised text-ink" : "text-dim hover:text-ink hover:bg-raised/60"
      }`}
      title={title ?? label}
      onClick={onClick}
    >
      <Icon name={icon} size={13} />
      <span className="text-[12px] flex-1">{label}</span>
      {badge ? <span className="text-warn text-[10px] num">{badge}</span> : null}
    </button>
  );
}

export function NavRail() {
  const view = useApp((s) => s.view);
  const setView = useApp((s) => s.setView);
  const appMode = useApp((s) => s.appMode);
  const messages = useApp((s) => s.messages);
  const projects = useApp((s) => s.projects);
  const activeProject = useApp((s) => s.activeProject);
  const setAppSetting = useApp((s) => s.setAppSetting);
  const setPickerOpen = useApp((s) => s.setPickerOpen);
  const setSettingsOpen = useApp((s) => s.setSettingsOpen);
  const setSwitcherOpen = useApp((s) => s.setSwitcherOpen);
  const unanswered = messages.filter((m) => !m.answered).length;

  const go = (v: MainView) => setView(view === v ? "session" : v);

  const switchProject = async (id: string) => {
    if (id === activeProject) return;
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("set_active_project", { id }).catch(() => {});
    setAppSetting("activeProject", id);
    setTimeout(() => location.reload(), 150);
  };

  return (
    <nav className="w-[200px] flex-none bg-panel border-r border-line flex flex-col overflow-hidden">
      {/* drag strip clears the overlay traffic lights */}
      <div data-tauri-drag-region className="h-9 flex-none" />
      <div className="px-2 flex flex-col gap-0.5">
        <NavItem icon="search" label="Search" title="Jump to a session or action (⌘K)"
          onClick={() => setSwitcherOpen(true)} />
        <NavItem icon="layout" label="Home" active={view === "home"} title="Mission control (⌘H)"
          onClick={() => go("home")} />
        {surfaceVisible(appMode, "rail-inbox-tab") ? (
          <NavItem icon="mail" label="Inbox" badge={unanswered} active={view === "inbox"}
            onClick={() => go("inbox")} />
        ) : null}
        <NavItem icon="check" label="Tasks" active={view === "tasks"} onClick={() => go("tasks")} />
        <NavItem icon="clock" label="Feed" active={view === "feed"} onClick={() => go("feed")} />
        {surfaceVisible(appMode, "rail-team-tab") ? (
          <NavItem icon="team" label="Team" active={view === "team"} onClick={() => go("team")} />
        ) : null}
      </div>

      <div className="px-3 pt-4 pb-1 flex items-center justify-between">
        <span className="panel-label">Projects</span>
        <button className="text-faint hover:text-accent cursor-pointer text-[13px]" title="Add / manage projects (⌘P)"
          onClick={() => setPickerOpen(true)}>+</button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-2 flex flex-col gap-0.5">
        {projects.map((p) => (
          <button
            key={p.id}
            className={`flex items-center gap-2 w-full text-left px-2 py-1.5 rounded-md cursor-pointer transition-colors ${
              p.id === activeProject ? "bg-raised text-ink" : "text-dim hover:text-ink hover:bg-raised/60"
            }`}
            title={p.id === activeProject ? `${p.path} — active` : `Switch to ${p.name}`}
            onClick={() => switchProject(p.id)}
          >
            <span className="w-2 h-2 rounded-full flex-none" style={{ background: p.color ?? projectColor(p.id) }} />
            <span className="text-[12px] truncate">{p.name}</span>
          </button>
        ))}
        {projects.length === 0 ? (
          <span className="px-2 py-1 text-[11px] text-faint">no projects yet</span>
        ) : null}
      </div>

      <div className="flex-none border-t border-line px-2 py-2 flex flex-col gap-0.5">
        <NavItem icon="gear" label="Settings" title="Settings (⌘,)" onClick={() => setSettingsOpen(true)} />
        <span className="px-3 text-[10px] text-faint num">grill me v0.1.0</span>
      </div>
    </nav>
  );
}
