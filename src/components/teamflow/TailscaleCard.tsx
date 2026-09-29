import { useEffect, useState } from "react";
import { useApp } from "../../store";

// ---------------------------------------------------------------------------
// Team mode over Tailscale: status + one-click connect, and the teammate
// machines on your tailnet so joining is a click instead of typing an IP.
// ---------------------------------------------------------------------------

export interface TsPeer { name: string; dnsName: string; ip: string; online: boolean; os: string }
export interface TsStatus {
  installed: boolean; running?: boolean; dnsName?: string; ip?: string; tailnet?: string;
  funnelAllowed?: boolean; peers?: TsPeer[];
}

export function useTailscale(): [TsStatus | null, () => void] {
  const [st, setSt] = useState<TsStatus | null>(null);
  const load = () => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    void import("@tauri-apps/api/core").then(({ invoke }) => invoke<TsStatus>("tailscale_status").then(setSt).catch(() => setSt(null)));
  };
  useEffect(() => {
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, []);
  return [st, load];
}

export function TailscaleCard({ st, reload }: { st: TsStatus | null; reload: () => void }) {
  const toast = useApp((s) => s.toast);
  const [busy, setBusy] = useState(false);
  if (!st) return null;

  const connect = async () => {
    setBusy(true);
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("tailscale_up").then(() => toast("Tailscale connected")).catch((e) => toast(`Tailscale: ${e}`, "warn"));
    setBusy(false);
    reload();
  };

  return (
    <div className="bg-panel hairline rounded-md px-4 py-3 flex items-center gap-3 text-[12px]">
      <span className={`w-2 h-2 rounded-full flex-none ${st.running ? "bg-ok" : "bg-idle"}`} />
      <span className="flex-1 min-w-0">
        {!st.installed ? (
          <>Work with teammates on <b>any</b> Wi-Fi: install Tailscale (free), then invite them to your network.</>
        ) : st.running ? (
          <>Tailscale on — teammates on your Tailscale network can join from anywhere. You're <span className="font-mono text-[11px]">{st.dnsName}</span></>
        ) : (
          <>Tailscale is off. Turn it on so teammates can join from any Wi-Fi.</>
        )}
      </span>
      {!st.installed ? (
        <a className="btn" href="https://tailscale.com/download/mac" target="_blank" rel="noreferrer">Get Tailscale</a>
      ) : !st.running ? (
        <button className="btn primary" disabled={busy} onClick={() => void connect()}>{busy ? "…" : "Turn on"}</button>
      ) : (
        <a className="btn" href="https://login.tailscale.com/admin/users" target="_blank" rel="noreferrer"
          title="Invite teammates to your Tailscale network (they install Tailscale and accept)">Invite teammates</a>
      )}
    </div>
  );
}
