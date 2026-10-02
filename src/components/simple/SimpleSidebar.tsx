import { useApp } from "../../store";
import { SessionList } from "../SessionList";
import { Icon } from "../Icon";
import { ProjectIcon } from "../ProjectIcon";
import type { TeamSession } from "../../types";

// ---------------------------------------------------------------------------
// Simple layout, left column: which project, your sessions (grouped by what
// needs you), what teammates' agents are doing, and who's here. Everything a
// first-timer needs to orient; the rest lives in ⌘K.
// ---------------------------------------------------------------------------

function TeammateSessions({ rows }: { rows: TeamSession[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="flex-none border-t border-line px-2 py-2 max-h-[34%] overflow-y-auto">
      <div className="px-2 pb-1 text-[11px] tracking-[0.12em] uppercase text-faint font-semibold">Teammates</div>
      {rows.map((d) => (
        <div key={d.id} className="flex items-start gap-2 px-2 py-1.5 rounded-md" title={d.sentence || d.title}>
          <span className={`status-dot ${d.status} flex-none mt-1.5`} style={{ width: 6, height: 6 }} aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block text-[12.5px] text-ink truncate">{d.title}</span>
            <span className="block text-[11px] text-faint truncate">{d.memberName}{d.sentence ? ` · ${d.sentence}` : ""}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

function Footer() {
  const appMode = useApp((s) => s.appMode);
  const room = useApp((s) => s.room);
  const setAppMode = useApp((s) => s.setAppMode);
  const setSettingsOpen = useApp((s) => s.setSettingsOpen);
  const members = room?.members ?? [];
  const now = Date.now();
  return (
    <div className="flex-none border-t border-line h-12 px-3 flex items-center gap-2">
      {appMode === "team" && members.length ? (
        <div className="flex -space-x-1.5" aria-label={`${members.length} in the team`}>
          {members.slice(0, 5).map((m) => {
            const online = now - m.lastSeen < 10_000;
            return (
              <span key={m.id} title={`${m.name}${online ? "" : " (away)"}`}
                className={`w-6 h-6 rounded-full border border-panel bg-raised text-[10px] font-semibold flex items-center justify-center ${online ? "text-ink" : "text-faint opacity-60"}`}>
                {m.name.slice(0, 1).toUpperCase()}
              </span>
            );
          })}
        </div>
      ) : null}
      {appMode !== "team" ? (
        <button className="btn" title="Work with teammates: create or join a team" onClick={() => setAppMode("team")}>
          <Icon name="team" size={12} /> Invite team
        </button>
      ) : null}
      <span className="flex-1" />
      <button className="w-8 h-8 rounded-lg flex items-center justify-center text-dim hover:text-ink hover:bg-raised cursor-pointer"
        title="Settings (⌘,)" aria-label="Settings" onClick={() => setSettingsOpen(true)}>
        <Icon name="gear" size={15} />
      </button>
    </div>
  );
}

export function SimpleSidebar() {
  const project = useApp((s) => s.projects.find((p) => p.id === s.activeProject));
  const setPickerOpen = useApp((s) => s.setPickerOpen);
  const setSwitcherOpen = useApp((s) => s.setSwitcherOpen);
  const setView = useApp((s) => s.setView);
  const selfId = useApp((s) => s.roomSelf?.memberId);
  const teamSessions = useApp((s) => s.teamSessions);
  const appMode = useApp((s) => s.appMode);
  const others = appMode === "team" ? teamSessions.filter((d) => d.member !== selfId) : [];

  return (
    <aside className="w-[264px] flex-none border-r border-line bg-panel flex flex-col overflow-hidden" aria-label="Sessions">
      {/* project row doubles as the drag strip; clears the macOS traffic lights */}
      <div data-tauri-drag-region className="h-12 flex-none flex items-center pl-[84px] pr-2">
        <button
          className="flex items-center gap-2 min-w-0 flex-1 h-8 px-2 rounded-lg hover:bg-raised text-left cursor-pointer"
          title="Switch project (⌘P)"
          onClick={() => setPickerOpen(true)}
        >
          {project ? <ProjectIcon id={project.id} color={project.color} size={16} /> : <Icon name="folder" size={14} />}
          <span className="text-[13.5px] font-semibold text-ink truncate flex-1">{project?.name ?? "Pick a project"}</span>
          <Icon name="chevron" size={9} className="text-faint rotate-90" />
        </button>
      </div>
      <div className="px-2 flex flex-col gap-1 flex-none">
        <div className="flex gap-1">
          <button
            className="flex-1 flex items-center gap-2 h-8 px-2.5 rounded-lg border border-line bg-raised/40 text-faint hover:text-dim cursor-pointer"
            title="Jump to anything (⌘K)"
            onClick={() => setSwitcherOpen(true)}
          >
            <Icon name="search" size={13} />
            <span className="text-[12.5px] flex-1 text-left">Search</span>
            <span className="text-[11px]">⌘K</span>
          </button>
          <button className="h-8 px-2.5 rounded-lg bg-accent text-accent-ink text-[12.5px] font-medium cursor-pointer hover:brightness-110 flex items-center gap-1"
            title="Start a new session" onClick={() => setView("new")}>
            <Icon name="plus" size={12} /> New
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0 flex flex-col mt-1">
        <SessionList bare />
      </div>
      <TeammateSessions rows={others} />
      <Footer />
    </aside>
  );
}
