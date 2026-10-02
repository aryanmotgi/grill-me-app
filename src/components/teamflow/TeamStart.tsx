import { useState } from "react";
import { useApp } from "../../store";
import { roomClient, startRoomFeed } from "../../data/sources/feeds";
import { seedRoom } from "../../lib/teamRoom";
import { TailscaleCard, useTailscale } from "./TailscaleCard";

/** The host's own requests go over loopback — never its LAN address. */
const HOST_LOOPBACK = "127.0.0.1:4518";
const ROOM_PORT = "4518";


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
  const setAppMode = useApp((s) => s.setAppMode);
  const [name, setName] = useState("");
  const [joinName, setJoinName] = useState("");
  const [code, setCode] = useState("");
  const [addr, setAddr] = useState("");
  const [invite, setInvite] = useState("");
  const enterRoom = useApp((s) => s.enterRoom);
  const joining = useApp((s) => s.appSettings.firstRunJoining === true);
  const [ts, reloadTs] = useTailscale();
  const tsPeers = ts?.running ? (ts.peers ?? []).filter((p) => p.online && p.dnsName) : [];
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

  // -- hosted relay (default): works on any network, no host machine needed --
  const relayCreate = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const r = await invoke<{ code: string; memberId: string; hostAddr: string; invite: string }>("room_relay_create", { name: name.trim() });
      enterRoom({ role: "host", memberId: r.memberId, hostAddr: r.hostAddr, code: r.code, invite: r.invite });
    } catch (e) {
      toast(`Couldn't create the team: ${e}`, "warn");
    } finally {
      setBusy(false);
    }
  };

  const relayJoin = async () => {
    const n = joinName.trim();
    if (!n || !invite.trim() || busy) return;
    setBusy(true);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const r = await invoke<{ code: string; memberId: string; hostAddr: string; invite: string }>("room_relay_join", { invite: invite.trim(), name: n });
      enterRoom({ role: "guest", memberId: r.memberId, hostAddr: r.hostAddr, code: r.code, invite: r.invite });
    } catch (e) {
      toast(`Couldn't join: ${e}`, "warn");
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
    <div className="h-full flex items-start justify-center ground overflow-y-auto">
      <div data-tauri-drag-region className="fixed top-0 inset-x-0 h-12" />
      <div className="w-[720px] max-w-[92vw] pt-[10vh] pb-12 flex flex-col gap-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[22px] font-semibold text-ink tracking-tight">Work as a team</h1>
            <p className="text-[13.5px] text-dim mt-1">Everyone's agents share one goal, one plan and one chat. Works on any network.</p>
          </div>
          <button className="btn" onClick={() => setAppMode(null)} title="Back to Solo / Team">← back</button>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className={`bg-panel hairline rounded-lg p-4 flex flex-col gap-3 ${joining ? "" : "border-accent/50"}`}>
            <div className="text-[14px] font-semibold text-ink">Create a team</div>
            <div className="text-[12px] text-dim">You'll get an invite link to send your teammates.</div>
            <input className="bg-raised hairline rounded-md px-3 py-2 text-[13px] outline-none focus:border-accent placeholder:text-faint" placeholder="Your name" value={name} autoFocus={!joining}
              onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && relayCreate()} />
            <button className="btn primary" disabled={!name.trim() || busy} onClick={relayCreate}>
              {busy ? <span className="spinner" /> : null} Create team
            </button>
          </div>
          <div className={`bg-panel hairline rounded-lg p-4 flex flex-col gap-3 ${joining ? "border-accent/50" : ""}`}>
            <div className="text-[14px] font-semibold text-ink">Join a team</div>
            <div className="text-[12px] text-dim">Paste the invite link a teammate sent you.</div>
            <input className="bg-raised hairline rounded-md px-3 py-2 text-[13px] outline-none focus:border-accent placeholder:text-faint" placeholder="Your name" value={joinName} autoFocus={joining}
              onChange={(e) => setJoinName(e.target.value)} />
            <input className="bg-raised hairline rounded-md px-3 py-2 text-[12px] font-mono outline-none focus:border-accent placeholder:text-faint" placeholder="https://grillme-relay.wasmer.app/join/…"
              value={invite} onChange={(e) => setInvite(e.target.value)} onKeyDown={(e) => e.key === "Enter" && relayJoin()} />
            <button className="btn primary" disabled={!joinName.trim() || !invite.trim() || busy} onClick={relayJoin}>
              {busy ? <span className="spinner" /> : null} Join team
            </button>
          </div>
        </div>
        <details className="text-[12px] text-dim">
          <summary className="cursor-pointer select-none">Same Wi-Fi without internet? Use a local room instead</summary>
          <div className="mt-3 flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-4">
            {/* create */}
            <div className="bg-panel hairline rounded-md p-4 flex flex-col gap-3">
              <div className="text-[13px] font-semibold">Create a room</div>
              <div className="text-[11px] text-dim">
                You host on this machine. Teammates join with the code and address
                you get next — same Wi-Fi, or anywhere over Tailscale.
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
              {tsPeers.length ? (
                <div className="flex flex-col gap-1">
                  <span className="text-[10.5px] text-faint">Teammates on Tailscale — click the host:</span>
                  <div className="flex flex-wrap gap-1">
                    {tsPeers.map((p) => (
                      <button key={p.dnsName} className={`btn ${addr.startsWith(p.dnsName) ? "active" : ""}`}
                        title={`${p.dnsName} (${p.os})`} onClick={() => setAddr(`${p.dnsName}:${ROOM_PORT}`)}>
                        {p.name}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              <input
                className="bg-raised hairline rounded-sm px-3 py-2 font-mono text-[11px] outline-none focus:border-accent"
                placeholder="host address, e.g. 192.168.1.7 or a Tailscale name"
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
          <TailscaleCard st={ts} reload={reloadTs} />
          </div>
        </details>
      </div>
    </div>
  );
}
