import { useEffect, useState } from "react";
import { create } from "zustand";
import { useApp } from "../store";
import { Icon } from "./Icon";

// ---------------------------------------------------------------------------
// "Let claude.ai see your sessions": the switch for the remote grill-me
// connection (Tailscale Funnel → loopback MCP), shown above the claude.ai
// view. Off by default. When on, the panel is just "Claude" — your real
// chats, projects, and your sessions in one place.
// ---------------------------------------------------------------------------

export interface RemoteStatus { server: boolean; allowWrites: boolean; funnel: boolean; url: string | null }

export const useRemote = create<{ status: RemoteStatus | null }>(() => ({ status: null }));

const native = () => "__TAURI_INTERNALS__" in window;

export async function refreshRemote() {
  if (!native()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  const status = await invoke<RemoteStatus>("remote_status").catch(() => null);
  useRemote.setState({ status });
}

/** Mount once (App): re-open the connection at launch if it was on. */
export function useRemoteAutostart() {
  useEffect(() => {
    if (!native()) return;
    const st = useApp.getState();
    void (async () => {
      await refreshRemote();
      if (st.appSettings.remoteOn === true && !useRemote.getState().status?.url) {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("remote_start", { allowWrites: st.appSettings.remoteWrites === true }).catch(() => {});
        await refreshRemote();
      }
    })();
  }, []);
}

async function openExternal(url: string) {
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  await openUrl(url).catch(() => {});
}

export function ClaudeConnect() {
  const status = useRemote((r) => r.status);
  const toast = useApp((s) => s.toast);
  const setAppSetting = useApp((s) => s.setAppSetting);
  const writes = useApp((s) => s.appSettings.remoteWrites === true);
  const [busy, setBusy] = useState(false);
  const [enableLink, setEnableLink] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [log, setLog] = useState<{ ts: number; who: string; status: number; tool?: string; method?: string }[]>([]);

  useEffect(() => { void refreshRemote(); }, []);

  const call = async <T,>(cmd: string, args: Record<string, unknown> = {}) => {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<T>(cmd, args);
  };

  const connect = async () => {
    setBusy(true);
    setEnableLink(null);
    try {
      const r = await call<RemoteStatus & { needsEnable?: boolean; link?: string; message?: string }>("remote_start", { allowWrites: writes });
      if (r.needsEnable) {
        setEnableLink(r.link ?? "https://login.tailscale.com/admin/acls");
      } else {
        setAppSetting("remoteOn", true);
        useRemote.setState({ status: r });
        toast("claude.ai can now see your sessions (read-only)");
      }
    } catch (e) {
      toast(`${e}`, "warn");
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    await call("remote_stop").catch(() => {});
    setAppSetting("remoteOn", false);
    await refreshRemote();
    setBusy(false);
    toast("claude.ai connection is off");
  };

  const rotate = async () => {
    const r = await call<RemoteStatus>("remote_rotate").catch((e) => { toast(`${e}`, "warn"); return null; });
    if (r) {
      useRemote.setState({ status: r });
      toast("New secret — update the connector link in claude.ai");
    }
  };

  const setWrites = async (on: boolean) => {
    setAppSetting("remoteWrites", on);
    if (status?.server) {
      const r = await call<RemoteStatus>("remote_start", { allowWrites: on }).catch(() => null);
      if (r) useRemote.setState({ status: r });
    }
  };

  const openConnectors = () => void call("claudeai_navigate", { url: "https://claude.ai/settings/connectors" }).catch(() => {});
  const loadLog = async () => setLog(await call<typeof log>("remote_log", { limit: 30 }).catch(() => []));

  if (!native()) return null;

  if (!status?.url) {
    return (
      <div className="flex-none border-b border-line px-3 py-2.5 flex flex-col gap-2 text-[12px]">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-idle flex-none" />
          <span className="flex-1 text-dim">Let this Claude see your sessions</span>
          <button className="composer-btn h-7 text-[12px] on" disabled={busy} onClick={() => void connect()}>
            {busy ? <span className="spinner" /> : null} Connect
          </button>
        </div>
        {enableLink ? (
          <div className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-dim flex flex-col gap-1.5">
            <span>One-time step: allow Tailscale Funnel for this Mac (you're the owner, it's one click).</span>
            <span className="flex gap-2">
              <button className="composer-btn h-7 text-[11.5px]" onClick={() => void openExternal(enableLink)}>Open Tailscale</button>
              <button className="composer-btn h-7 text-[11.5px]" onClick={() => void connect()}>I did it — try again</button>
            </span>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex-none border-b border-line px-3 py-2 flex flex-col gap-2 text-[12px]">
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-ok flex-none" />
        <span className="flex-1 text-dim truncate">Sees your sessions{status.allowWrites ? " · can propose" : " · read-only"}</span>
        <button className="composer-btn h-7 text-[11.5px]" onClick={() => setOpen(!open)}>{open ? "Done" : "Setup"}</button>
      </div>
      {open ? (
        <div className="flex flex-col gap-2 text-dim">
          <span>1. Copy your private link. 2. In claude.ai → Settings → Connectors → <b>Add custom connector</b>, paste it (name it “Grill Me”). 3. Turn it on in a chat’s tools menu.</span>
          <span className="flex flex-wrap gap-1.5">
            <button className="composer-btn h-7 text-[11.5px]" onClick={() => void navigator.clipboard.writeText(status.url!).then(() => toast("Private link copied — keep it secret"))}>
              <Icon name="doc" size={11} /> Copy private link
            </button>
            <button className="composer-btn h-7 text-[11.5px]" onClick={openConnectors}>Open Connectors</button>
            <button className="composer-btn h-7 text-[11.5px]" title="Old link stops working immediately" onClick={() => void rotate()}>New secret</button>
            <button className="composer-btn h-7 text-[11.5px]" onClick={() => void loadLog()}>Access log</button>
            <button className="composer-btn h-7 text-[11.5px]" disabled={busy} onClick={() => void disconnect()}>Turn off</button>
          </span>
          <label className="flex items-center gap-2 cursor-pointer w-fit">
            <input type="checkbox" className="accent-(--accent)" checked={writes} onChange={(e) => void setWrites(e.target.checked)} />
            Allow proposals (plans, tasks for sessions) — each still needs your OK in Grill Me
          </label>
          {log.length ? (
            <div className="max-h-32 overflow-y-auto font-mono text-[10.5px] text-faint border border-line rounded-lg p-2">
              {log.map((l, i) => (
                <div key={i}>{new Date(l.ts).toLocaleTimeString()} · {l.who} · {l.status} · {l.tool ?? l.method ?? ""}</div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
