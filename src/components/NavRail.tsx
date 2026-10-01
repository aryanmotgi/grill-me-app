import { useApp, type MainView } from "../store";
import { surfaceVisible } from "../lib/soloVisibility";
import { Icon } from "./Icon";
import { AgentLogo } from "./AgentLogo";
import { ProjectIcon } from "./ProjectIcon";
import { GrillWordmark } from "./GrillMark";
import { PanelControls, togglePanel, useLayout } from "./Dock";
import { addProjectFromFinder } from "../lib/addProject";
import { useChatUnread } from "./teamChatActions";

// ---------------------------------------------------------------------------
// Monocode-style far-left nav rail: Search / Inbox / team surfaces up top,
// a Projects list in the middle, Settings + version pinned at the bottom.
// Clicking a team surface swaps the CENTER view (they are full screens now,
// not a right-rail sidebar). The rail top doubles as window-drag chrome
// under the overlay titlebar.
// ---------------------------------------------------------------------------

function NavItem({ icon, label, badge, active, onClick, title, kbd, tour }: {
  icon: string;
  label: string;
  badge?: number;
  active?: boolean;
  onClick: () => void;
  title?: string;
  kbd?: string;
  tour?: string;
}) {
  return (
    <button
      className={`flex items-center gap-3 w-full text-left px-2.5 h-8 rounded-lg cursor-pointer transition-colors ${
        active ? "bg-raised text-ink" : "text-dim hover:text-ink hover:bg-raised/60"
      }`}
      title={title ?? label}
      onClick={onClick}
      data-tour={tour}
    >
      {icon === "claude" ? <AgentLogo agent="claude" size={15} /> : <Icon name={icon} size={15} />}
      <span className="text-[13px] flex-1">{label}</span>
      {badge ? <span className="text-warn text-[10.5px] num">{badge}</span> : null}
      {kbd ? <span className="text-faint text-[11px]">{kbd}</span> : null}
    </button>
  );
}

export function NavRail({ side = "left" }: { side?: "left" | "right" }) {
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
  const chatUnread = useChatUnread();
  const claudeOpen = useLayout()[0].claude.open;
  const moreSetting = useApp((s) => s.appSettings.navMoreOpen === true);
  const moreOpen = moreSetting || ["automations", "tasks", "inbox", "feed", "team"].includes(view);

  const go = (v: MainView) => setView(view === v ? "session" : v);

  const switchProject = async (id: string) => {
    if (id === activeProject) return;
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("set_active_project", { id }).catch(() => {});
    setAppSetting("activeProject", id);
    setTimeout(() => location.reload(), 150);
  };

  return (
    <nav className={`w-[220px] flex-none bg-panel border-line flex flex-col overflow-hidden ${side === "left" ? "border-r" : "border-l"}`}>
      {/* drag strip clears the overlay traffic lights */}
      <div data-tauri-drag-region className="group/rail h-12 flex-none flex items-center justify-end gap-1 pr-2">
        {/* brand sits right of the traffic lights; clicks pass through to drag */}
        <span className="pointer-events-none"><GrillWordmark /></span>
        <span className="hidden group-hover/rail:flex"><PanelControls id="nav" /></span>
      </div>
      <div className="px-2 flex flex-col gap-0.5">
        <button
          className="flex items-center gap-2.5 w-full h-9 px-2.5 mb-1.5 rounded-lg border border-line bg-raised/40 text-faint hover:text-dim cursor-pointer transition-colors"
          title="Jump to a session or action (⌘K)"
          data-tour="command"
          onClick={() => setSwitcherOpen(true)}
        >
          <Icon name="search" size={15} />
          <span className="text-[13px] flex-1 text-left">Search</span>
          <span className="text-[11px]">⌘K</span>
        </button>
        <NavItem icon="layout" label="Home" active={view === "home"} title="Mission control (⌘H)"
          onClick={() => go("home")} />
        <NavItem icon="swap" label="Flow" tour="flow" active={view === "flow"} title="Who's talking to whom: Claude ⇄ brain ⇄ sessions ⇄ teammates"
          onClick={() => go("flow")} />
        <NavItem icon="note" label="Brain" tour="brain" active={view === "brain"} title="Shared project brain: goal, where was I, what's happening"
          onClick={() => go("brain")} />
        <NavItem icon="claude" label="Claude" active={claudeOpen} title="Claude chat panel — sees your sessions (⌘J)"
          onClick={() => togglePanel("claude")} />
        <NavItem icon="eye" label="Preview" active={view === "preview"} title="Live preview of the app you're building"
          onClick={() => go("preview")} />

        {/* the rest folds away so the rail stays calm; opens itself when one is active */}
        <button className="flex items-center gap-2 px-2.5 h-7 mt-1 text-[12px] text-faint hover:text-dim cursor-pointer"
          aria-expanded={moreOpen} onClick={() => setAppSetting("navMoreOpen", !moreOpen)}>
          <Icon name="chevron" size={9} className={`transition-transform ${moreOpen ? "rotate-90" : ""}`} />
          More{!moreOpen && unanswered + chatUnread ? <span className="text-warn num ml-1">{unanswered + chatUnread}</span> : null}
        </button>
        {moreOpen ? (
          <>
            <NavItem icon="bolt" label="Automations" active={view === "automations"} title="Things Grill Me does for you: tests, checks, reminders, phone pings"
              onClick={() => go("automations")} />
            <NavItem icon="check" label="Tasks" active={view === "tasks"} onClick={() => go("tasks")} />
            {surfaceVisible(appMode, "rail-inbox-tab") ? (
              <NavItem icon="inbox" label="Inbox" badge={unanswered} active={view === "inbox"}
                onClick={() => go("inbox")} />
            ) : null}
            <NavItem icon="clock" label="Feed" active={view === "feed"} onClick={() => go("feed")} />
            {surfaceVisible(appMode, "rail-team-tab") ? (
              <NavItem icon="team" label="Team" badge={chatUnread} title={chatUnread ? `Team chat · ${chatUnread} unread` : "Team"} active={view === "team"} onClick={() => go("team")} />
            ) : null}
          </>
        ) : null}
      </div>

      <div className="px-4 pt-5 pb-1.5 flex items-center justify-between">
        <button className="text-[12.5px] text-faint hover:text-dim cursor-pointer" title="Manage projects (⌘P)" onClick={() => setPickerOpen(true)}>Projects</button>
        <button className="text-faint hover:text-ink cursor-pointer" title="Add a project — pick or create its folder in Finder (⌘P to manage)"
          onClick={() => void addProjectFromFinder((m) => useApp.getState().toast(m, "warn"))}><Icon name="plus" size={13} /></button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-2 flex flex-col gap-0.5">
        {projects.map((p) => (
          <button
            key={p.id}
            className={`flex items-center gap-3 w-full text-left px-2.5 h-8 rounded-lg cursor-pointer transition-colors ${
              p.id === activeProject ? "bg-raised text-ink" : "text-dim hover:text-ink hover:bg-raised/60"
            }`}
            title={p.id === activeProject ? `${p.path} — active` : `Switch to ${p.name}`}
            onClick={() => switchProject(p.id)}
          >
            <ProjectIcon id={p.id} color={p.color} size={16} />
            <span className="text-[13px] truncate">{p.name}</span>
          </button>
        ))}
        {projects.length === 0 ? (
          <span className="px-2 py-1 text-[12px] text-faint">No projects yet</span>
        ) : null}
      </div>

      <div className="flex-none px-2 py-2 flex flex-col gap-0.5">
        <NavItem icon="gear" label="Settings" tour="settings" kbd="⌘," title="Settings (⌘,)" onClick={() => setSettingsOpen(true)} />
      </div>
    </nav>
  );
}
