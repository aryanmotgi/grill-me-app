import { useState } from "react";
import { useApp, ptyIdFor } from "../store";
import { Icon } from "./Icon";
import { teamSessionsByMember } from "../lib/flow";
import type { TeamSession } from "../types";

// ---------------------------------------------------------------------------
// Teammates: who is on this project, and what each of them is running.
//
// Deliberately plain — a list on the left, that person's sessions on the right.
// Everything here except your own sessions arrives over the room as published
// state (title, status, branch, files), so it is a window, not a terminal.
//
// Taking over someone's session is a different thing and needs ssh: with a
// remote host and a tmux session configured, `tmux new -A` attaches to the one
// they are already in, so you share a terminal rather than watch a copy.
// ---------------------------------------------------------------------------

function Dot({ status }: { status: string }) {
  return <span className={`status-dot ${status} flex-none`} style={{ width: 7, height: 7 }} aria-hidden />;
}

function SessionRow({ d, onOpen }: { d: TeamSession; onOpen?: () => void }) {
  return (
    <div className="hairline rounded-lg px-3 py-2.5 flex items-start gap-2.5">
      <Dot status={d.status} />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] text-ink truncate">{d.title}</div>
        {d.sentence ? <div className="text-[12px] text-dim mt-0.5">{d.sentence}</div> : null}
        <div className="flex items-center gap-2.5 mt-1 text-[11px] text-faint">
          {d.branch ? <span className="truncate max-w-[180px]"><Icon name="branch" size={9} /> {d.branch}</span> : null}
          {d.files?.length ? <span>{d.files.length} file{d.files.length === 1 ? "" : "s"}</span> : null}
          {d.tests === true ? <span className="text-ok">tests pass</span> : d.tests === false ? <span className="text-danger">tests fail</span> : null}
        </div>
      </div>
      {onOpen ? <button className="btn flex-none" onClick={onOpen}>Open</button> : null}
    </div>
  );
}

export function TeammatesPage() {
  const members = useApp((s) => s.members);
  const teamSessions = useApp((s) => s.teamSessions);
  const setView = useApp((s) => s.setView);
  const setActive = useApp((s) => s.setActive);
  const toast = useApp((s) => s.toast);
  const selfId = members[0]?.id ?? "me";
  const [pick, setPick] = useState<string>(selfId);
  const [busy, setBusy] = useState(false);

  const byMember = teamSessionsByMember(teamSessions, Date.now());
  // everyone config knows about, plus anyone who published a session but isn't
  // in this Mac's config — otherwise a teammate who joined the room is invisible
  const extra = [...byMember.keys()]
    .filter((m) => !members.some((x) => x.id === m))
    .map((m) => ({ id: m, name: byMember.get(m)?.[0]?.memberName ?? m, repoPath: "" }));
  const people = [...members, ...extra];
  const chosen = people.find((p) => p.id === pick) ?? people[0];
  const cfg = members.find((m) => m.id === chosen?.id);
  const mine = chosen?.id === selfId;
  const rows = byMember.get(chosen?.id ?? "") ?? [];
  const canAttach = !!cfg?.remote && !!cfg?.tmuxSession;

  const open = (d: TeamSession) => { setActive(d.member); setView("session"); };

  // shares the terminal they are in, rather than showing a copy of it
  const attach = async () => {
    if (!cfg?.remote || !cfg.tmuxSession) return;
    setBusy(true);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("pty_ensure", {
        id: ptyIdFor(cfg.id), cwd: cfg.repoPath || ".", shell: false,
        remote: cfg.remote, tmux: cfg.tmuxSession, agent: cfg.agent ?? null,
      });
      setActive(cfg.id);
      setView("session");
      toast(`Attached to ${chosen?.name}'s tmux session over ssh — you are both typing into the same terminal`);
    } catch (e) {
      toast(`Couldn't attach: ${e}`, "warn");
    } finally { setBusy(false); }
  };

  return (
    <div className="flex-1 min-h-0 flex">
      <div className="w-[230px] flex-none border-r border-line overflow-y-auto py-2">
        <div className="px-4 pb-1.5 text-[11px] tracking-[0.12em] uppercase text-faint font-semibold">Teammates</div>
        {people.map((p) => {
          const n = (byMember.get(p.id) ?? []).length;
          return (
            <button key={p.id}
              className={`w-full text-left flex items-center gap-2.5 px-4 h-9 cursor-pointer transition-colors ${
                p.id === chosen?.id ? "bg-raised text-ink" : "text-dim hover:text-ink hover:bg-raised/60"}`}
              onClick={() => setPick(p.id)}>
              <span className="min-w-0 flex-1 truncate text-[13px]">{p.name}{p.id === selfId ? " (you)" : ""}</span>
              {n ? <span className="text-[11px] text-faint num">{n}</span> : null}
            </button>
          );
        })}
        {people.length === 0 ? <div className="px-4 py-2 text-[12px] text-faint">Nobody yet.</div> : null}
      </div>

      <div className="flex-1 min-w-0 overflow-y-auto">
        <div className="max-w-[720px] mx-auto px-6 py-5 flex flex-col gap-3">
          <div className="flex items-center gap-2.5">
            <h2 className="text-[16px] font-semibold text-ink">{chosen?.name ?? "Teammates"}</h2>
            <span className="flex-1" />
            {canAttach ? (
              <button className="btn" disabled={busy} title={`Attach to ${cfg?.tmuxSession} on ${cfg?.remote} over ssh`}
                onClick={() => void attach()}>
                {busy ? "Attaching…" : "Take over their session"}
              </button>
            ) : null}
          </div>

          {rows.length === 0 ? (
            <div className="text-[12.5px] text-faint">
              {mine ? "You have no sessions running." : `${chosen?.name ?? "They"} hasn't published a session yet.`}
            </div>
          ) : rows.map((d) => <SessionRow key={d.id} d={d} onOpen={mine ? () => open(d) : undefined} />)}

          {!mine && !canAttach && rows.length > 0 ? (
            <div className="hairline rounded-lg px-3 py-2.5 text-[12px] text-dim">
              You're seeing what {chosen?.name} publishes, not their terminal. To type into the session
              they're actually in, their teammate entry needs an ssh host and a tmux session name —
              then "Take over their session" shares one terminal between you.
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
