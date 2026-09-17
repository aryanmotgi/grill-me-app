import { useModalA11y } from "../hooks/useModalA11y";
import { useApp } from "../store";
import { buildPresenceMap } from "../lib/presence";
import { fmtRelTime } from "../lib/format";
import { TickNumber } from "./TickNumber";

/**
 * Presence map: who is touching what RIGHT NOW. Reads the file watcher's live
 * locks (store.liveLocks — owner/file/ts straight off the Rust watcher, already
 * polled by the watch feed) and folds them two ways: by file (members currently
 * in it; >1 member = conflict, amber) and by member (their current file). No new
 * polling — it re-renders whenever the watch feed pushes a new lock set.
 */
export function PresenceMap() {
  const open = useApp((s) => s.presenceMapOpen);
  const locks = useApp((s) => s.liveLocks);
  const teammates = useApp((s) => s.teammates);
  const me = useApp((s) => s.members[0]?.id);
  const modalA11y = useModalA11y("Presence map", open);
  if (!open) return null;

  const close = () => useApp.setState({ presenceMapOpen: false });
  const map = buildPresenceMap(locks);
  const now = Date.now();
  const nameOf = (id: string) => teammates.find((t) => t.id === id)?.name ?? id;
  const initialsOf = (id: string) =>
    teammates.find((t) => t.id === id)?.initials ?? id.slice(0, 2).toUpperCase();
  const statusOf = (id: string) => teammates.find((t) => t.id === id)?.status ?? "idle";

  const Avatar = ({ id, conflict = false }: { id: string; conflict?: boolean }) => (
    <span
      title={nameOf(id) + (id === me ? " (you)" : "")}
      className={`w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-semibold num border ${
        conflict ? "border-accent text-accent bg-accent/10" : "border-line text-dim"
      }`}
    >
      {initialsOf(id)}
    </span>
  );

  return (
    <div
      className="fixed inset-0 z-40 scrim flex items-start justify-center pt-[5vh]"
      onClick={close}
    >
      <div
        {...modalA11y}
        className="w-[720px] max-h-[86vh] overflow-y-auto glass rounded-md shadow-2xl rise p-6 outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-baseline gap-3 mb-1">
          <span className="font-display font-bold text-[15px]">PRESENCE MAP</span>
          <span className="text-faint text-[10px]">who is touching what right now</span>
          <button className="btn ml-auto" onClick={close}>
            close
          </button>
        </div>

        {/* live counts — readouts, so cyan */}
        <div className="flex items-center gap-5 mb-5 text-[10px] text-dim">
          <span>
            <TickNumber value={map.fileCount} className="text-data text-[12px]" />{" "}
            {map.fileCount === 1 ? "file" : "files"} active
          </span>
          <span>
            <TickNumber value={map.memberCount} className="text-data text-[12px]" />{" "}
            {map.memberCount === 1 ? "member" : "members"}
          </span>
          <span className={map.conflictCount > 0 ? "text-accent" : undefined}>
            <TickNumber
              value={map.conflictCount}
              className={`text-[12px] ${map.conflictCount > 0 ? "text-accent" : "text-data"}`}
            />{" "}
            {map.conflictCount === 1 ? "conflict" : "conflicts"}
          </span>
        </div>

        {map.fileCount === 0 ? (
          <div className="text-faint text-[11px] leading-relaxed py-10 text-center">
            No active file locks — sessions idle or unwatched.
            <br />
            Live locks appear here the moment a session touches a file.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-x-8">
            {/* ---- by file ---- */}
            <section>
              <div className="panel-label mb-2">by file · {map.fileCount}</div>
              <div className="flex flex-col gap-1.5">
                {map.byFile.map((f) => (
                  <div
                    key={f.file}
                    className={`rounded-md p-2 border ${
                      f.conflict ? "border-accent/50 bg-accent/[0.06]" : "border-line/60"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[11px] truncate" title={f.file}>
                        {f.file}
                      </span>
                      {f.conflict ? (
                        <span className="tag warn ml-auto flex-none">conflict</span>
                      ) : (
                        <span className="text-faint text-[9px] ml-auto flex-none num">
                          {fmtRelTime(f.latestTs * 1000, now)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 mt-1.5">
                      {f.owners.map((o) => (
                        <div key={o} className="flex items-center gap-1">
                          <Avatar id={o} conflict={f.conflict} />
                          <span className="text-[10px] text-dim">{nameOf(o)}</span>
                        </div>
                      ))}
                      {f.conflict ? (
                        <span className="text-faint text-[9px] ml-auto num">
                          {fmtRelTime(f.latestTs * 1000, now)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* ---- by member ---- */}
            <section>
              <div className="panel-label mb-2">by member · {map.memberCount}</div>
              <div className="flex flex-col gap-1.5">
                {map.byMember.map((m) => (
                  <div key={m.owner} className="rounded-md p-2 border border-line/60">
                    <div className="flex items-center gap-2">
                      <span className={`status-dot ${statusOf(m.owner)}`} role="img" aria-hidden />
                      <span className="text-[12px] font-semibold">{nameOf(m.owner)}</span>
                      {m.owner === me ? <span className="text-data text-[9px]">you</span> : null}
                      <span className="text-faint text-[9px] ml-auto num">
                        {fmtRelTime(m.ts * 1000, now)}
                      </span>
                    </div>
                    <div className="font-mono text-[10px] text-dim truncate mt-1" title={m.file}>
                      {m.file}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
