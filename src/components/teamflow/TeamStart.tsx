import { useState } from "react";
import { useApp } from "../../store";
import { roomClient, startRoomFeed } from "../../data/sources/feeds";
import type { RoomState } from "../../types";

/** The host's own requests go over loopback — never its LAN address. */
const HOST_LOOPBACK = "127.0.0.1:4518";
const ROOM_PORT = "4518";

/** Seed room so the feed knows the code before its first successful poll. */
const seedRoom = (code: string): RoomState => ({
  code,
  phase: "lobby",
  members: [],
  chat: [],
  plan: "",
  tasks: [],
  startedAt: Date.now(),
});

/** "192.168.1.7" → "192.168.1.7:4518"; a typed port wins. */
const normalizeAddr = (addr: string) =>
  addr.includes(":") ? addr : `${addr}:${ROOM_PORT}`;

/**
 * Team entry: create a room (become host) or join one on the same network.
 * On success the store gets roomRole/roomSelf and the room feed starts —
 * TeamFlow then routes to the Lobby, which shows the code big for the host.
 */
export function TeamStart() {
  const toast = useApp((s) => s.toast);
  const [name, setName] = useState("");
  const [joinName, setJoinName] = useState("");
  const [code, setCode] = useState("");
  const [addr, setAddr] = useState("");
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const res = await invoke<{ code: string; memberId: string; ip: string }>(
        "room_host_start",
        { name: name.trim() },
      );
      useApp.setState({
        roomRole: "host",
        roomSelf: { memberId: res.memberId, hostAddr: HOST_LOOPBACK },
        roomHostIp: res.ip,
        room: seedRoom(res.code),
        roomOffline: false,
      });
      startRoomFeed(useApp);
    } catch (e) {
      toast(`Couldn't create the room: ${e}`, "warn");
    } finally {
      setBusy(false);
    }
  };

  const join = async () => {
    const n = joinName.trim();
    const c = code.trim().toUpperCase();
    const a = addr.trim();
    if (!n || !c || !a || busy) return;
    setBusy(true);
    try {
      const hostAddr = normalizeAddr(a);
      const raw = await roomClient(hostAddr, "/room/join", { code: c, name: n });
      const res = JSON.parse(raw) as { memberId: string };
      useApp.setState({
        roomRole: "guest",
        roomSelf: { memberId: res.memberId, hostAddr },
        room: seedRoom(c),
        roomOffline: false,
      });
      startRoomFeed(useApp);
    } catch (e) {
      toast(`Couldn't join — check the code and address: ${e}`, "warn");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-full flex items-center justify-center bg-bg">
      <div className="w-[680px] max-w-[92vw]">
        <div className="panel-label mb-3">team session — same network</div>
        <div className="grid grid-cols-2 gap-4">
          {/* create */}
          <div className="bg-panel hairline rounded-md p-4 flex flex-col gap-3">
            <div className="text-[13px] font-semibold">Create a room</div>
            <div className="text-[11px] text-dim">
              You host on this machine. Teammates on the same Wi-Fi join with
              the code and address you get next.
            </div>
            <input
              className="bg-raised hairline rounded-sm px-3 py-2 text-[12px] outline-none focus:border-accent"
              placeholder="your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && create()}
            />
            <button
              className="btn primary"
              disabled={!name.trim() || busy}
              onClick={create}
            >
              create room
            </button>
          </div>
          {/* join */}
          <div className="bg-panel hairline rounded-md p-4 flex flex-col gap-3">
            <div className="text-[13px] font-semibold">Join a room</div>
            <input
              className="bg-raised hairline rounded-sm px-3 py-2 text-[12px] outline-none focus:border-accent"
              placeholder="your name"
              value={joinName}
              onChange={(e) => setJoinName(e.target.value)}
            />
            <input
              className="bg-raised hairline rounded-sm px-3 py-2 font-mono text-[12px] uppercase tracking-[0.2em] outline-none focus:border-accent"
              placeholder="room code"
              maxLength={5}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
            <input
              className="bg-raised hairline rounded-sm px-3 py-2 font-mono text-[11px] outline-none focus:border-accent"
              placeholder="host address, e.g. 192.168.1.7:4518"
              value={addr}
              onChange={(e) => setAddr(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && join()}
            />
            <button
              className="btn"
              disabled={!joinName.trim() || !code.trim() || !addr.trim() || busy}
              onClick={join}
            >
              join
            </button>
          </div>
        </div>
        <div className="text-[10px] text-faint mt-3">
          works on the same network only — no internet relay in v1
        </div>
      </div>
    </div>
  );
}
