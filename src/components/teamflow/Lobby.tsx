import { useEffect, useState } from "react";
import { useApp } from "../../store";
import { roomClient } from "../../data/sources/feeds";
import { memberStatus, statusDotClass, statusLabel } from "../../lib/roomStatus";

const MAX_MEMBERS = 4;

/**
 * Waiting room: live member list (status derived client-side from lastSeen —
 * members are never removed on disconnect), the room code big enough to read
 * aloud, and the host-only start button. Guests wait; if polls fail 3× the
 * feed raises roomOffline and a banner shows instead of anything crashing.
 */
export function Lobby() {
  const room = useApp((s) => s.room);
  const roomRole = useApp((s) => s.roomRole);
  const roomSelf = useApp((s) => s.roomSelf);
  const roomHostIp = useApp((s) => s.roomHostIp);
  const roomOffline = useApp((s) => s.roomOffline);
  const toast = useApp((s) => s.toast);
  const leaveRoom = useApp((s) => s.leaveRoom);
  const [busy, setBusy] = useState(false);

  // re-derive statuses once a second — lastSeen ages even between polls
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  if (!room || !roomSelf) return null;
  const isHost = roomRole === "host";
  const host = room.members.find((m) => m.isHost);
  const joinAddr = roomHostIp ? `${roomHostIp}:4518` : null;
  const openSlots = Math.max(0, MAX_MEMBERS - room.members.length);

  const copy = (text: string) => {
    navigator.clipboard
      ?.writeText(text)
      .then(() => toast("copied"))
      .catch(() => toast("copy failed — select it manually", "warn"));
  };

  const start = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await roomClient(roomSelf.hostAddr, "/room/advance", {
        code: room.code,
        memberId: roomSelf.memberId,
        phase: "brainstorm",
      });
      // no local phase flip — the next poll returns phase "brainstorm" for
      // everyone at once, so all members advance from the same source of truth
    } catch (e) {
      toast(`Couldn't start: ${e}`, "warn");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-full flex items-center justify-center bg-bg">
      <div className="w-[520px] max-w-[92vw] flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className="panel-label">lobby</div>
          <button className="btn" onClick={() => leaveRoom()}
            title={roomRole === "host" ? "Close this room and go back" : "Leave this room and go back"}>
            ← leave
          </button>
        </div>

        {/* room code — big, copyable, read it aloud */}
        <div className="bg-panel hairline rounded-md p-4 flex items-center gap-4">
          <div className="flex-1 min-w-0">
            <div
              className="font-display text-[28px] font-semibold tracking-[0.3em] cursor-pointer"
              title="click to copy"
              onClick={() => copy(room.code)}
            >
              {room.code}
            </div>
            {isHost ? (
              <div className="text-[11px] text-dim mt-1">
                teammates join with this code
                {joinAddr ? (
                  <>
                    {" at "}
                    <span
                      className="font-mono text-ink cursor-pointer"
                      title="click to copy"
                      onClick={() => copy(joinAddr)}
                    >
                      {joinAddr}
                    </span>
                  </>
                ) : null}
                {" — read it aloud"}
              </div>
            ) : (
              <div className="text-[11px] text-dim mt-1">room code</div>
            )}
          </div>
          <button className="btn" onClick={() => copy(joinAddr ? `${room.code} @ ${joinAddr}` : room.code)}>
            copy
          </button>
        </div>

        {/* host offline — guests only; the list stays up, nothing crashes */}
        {!isHost && roomOffline ? (
          <div className="tag warn self-start">
            host offline — waiting for {host?.name ?? "the host"} to come back
          </div>
        ) : null}

        {/* members 1-4 */}
        <div className="bg-panel hairline rounded-md p-3 flex flex-col">
          <div className="panel-label mb-2">
            members — {room.members.length}/{MAX_MEMBERS}
          </div>
          {room.members.map((m) => {
            const st =
              m.id === roomSelf.memberId
                ? "joined" // own row never flickers on our own poll jitter
                : memberStatus(m.lastSeen, now);
            return (
              <div key={m.id} className="flex items-center gap-2.5 px-1 py-2">
                <span className={`status-dot ${statusDotClass(st)}`} />
                <span className="text-[12px] font-semibold">{m.name}</span>
                {m.isHost ? <span className="tag">host</span> : null}
                {m.id === roomSelf.memberId ? (
                  <span className="text-[10px] text-faint">you</span>
                ) : null}
                <span className="flex-1" />
                <span className="text-[11px] text-dim">{statusLabel(st)}</span>
              </div>
            );
          })}
          {Array.from({ length: openSlots }, (_, i) => (
            <div key={`open-${i}`} className="flex items-center gap-2.5 px-1 py-2">
              <span className="status-dot idle" />
              <span className="text-[11px] text-faint">open slot</span>
            </div>
          ))}
        </div>

        {/* one primary action per surface: the host's start button */}
        {isHost ? (
          <button
            className="btn primary self-end"
            disabled={busy || room.members.length === 0}
            onClick={start}
          >
            everyone's in — start
          </button>
        ) : (
          <div className="text-[11px] text-dim self-end">
            waiting for {host?.name ?? "the host"} to start
          </div>
        )}
      </div>
    </div>
  );
}
