import { useEffect, useState } from "react";
import { useApp } from "../store";
import { Icon } from "./Icon";

// Settings → Setup check: what this Mac has, what it's missing, and the one
// command that fixes each. Required items break sessions; the rest unlock
// features (Claude app bridge, PRs, team rooms).

export interface DoctorCheck { id: string; label: string; required: boolean; ok: boolean; detail: string; why: string; fix: string }

const native = () => "__TAURI_INTERNALS__" in window;

export async function runDoctor(): Promise<DoctorCheck[]> {
  if (!native()) return [];
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<DoctorCheck[]>("system_doctor").catch(() => []);
}

/** Mount once: if anything REQUIRED is missing, say so at launch. */
export function useDoctorOnLaunch() {
  useEffect(() => {
    void runDoctor().then((checks) => {
      const missing = checks.filter((c) => c.required && !c.ok).map((c) => c.label);
      if (missing.length) {
        useApp.getState().toast(`Missing: ${missing.join(", ")} — Settings → Setup check`, "warn");
      }
    });
  }, []);
}

export function DoctorTab() {
  const toast = useApp((s) => s.toast);
  const [checks, setChecks] = useState<DoctorCheck[] | null>(null);
  const refresh = () => { setChecks(null); void runDoctor().then(setChecks); };
  useEffect(refresh, []);
  const uninstall = async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const r = await invoke<{ checked: number; cleaned: number }>("uninstall_all").catch(() => null);
    toast(r ? `Cleaned ${r.cleaned} of ${r.checked} repos — quit Grill Me now or it re-adds them on the next session` : "Couldn't clean up", r ? "info" : "warn");
  };
  const copyDiagnostics = async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const text = await invoke<string>("diagnostics").catch((e) => `diagnostics failed: ${e}`);
    await navigator.clipboard.writeText(text);
    toast("Diagnostics copied — paste it into your bug report");
  };

  if (!native()) return <div className="text-faint text-[11px]">Setup check runs in the desktop app.</div>;
  if (!checks) return <div className="text-faint text-[11px] flex items-center gap-2"><span className="spinner" /> Checking this Mac…</div>;

  const bad = checks.filter((c) => !c.ok);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-[11.5px]">
        <span className={bad.some((c) => c.required) ? "text-warn" : "text-ok"}>
          {bad.length === 0 ? "All set." : bad.some((c) => c.required) ? "Something required is missing." : "Ready — a few extras are off."}
        </span>
        <span className="flex-1" />
        <button className="btn" title="Versions and what's installed — no chats, paths or secrets" onClick={() => void copyDiagnostics()}>Copy diagnostics</button>
        <button className="btn" onClick={refresh}>Re-check</button>
      </div>
      {checks.map((c) => (
        <div key={c.id} className="hairline rounded-md px-3 py-2 flex items-start gap-2.5">
          <span className={`status-dot mt-1 ${c.ok ? "working" : c.required ? "needs-input" : "idle"}`} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 text-[12px]">
              <span className="font-semibold">{c.label}</span>
              {c.required ? null : <span className="tag">optional</span>}
              <span className="flex-1" />
              <span className="text-faint text-[10.5px] truncate">{c.ok ? c.detail : "not found"}</span>
            </div>
            <div className="text-dim text-[11px] mt-0.5">{c.why}</div>
            {c.ok ? null : (
              <button className="mt-1.5 font-mono text-[10.5px] text-ink bg-raised hairline rounded-sm px-2 py-1 flex items-center gap-1.5 max-w-full"
                title="Copy — paste in Terminal"
                onClick={() => void navigator.clipboard.writeText(c.fix).then(() => toast("Copied — paste it in Terminal, then Re-check"))}>
                <Icon name="doc" size={10} /><span className="truncate">{c.fix}</span>
              </button>
            )}
          </div>
        </div>
      ))}
      <div className="hairline rounded-md px-3 py-2 mt-2 flex items-center gap-2.5 text-[11px]">
        <span className="flex-1 text-dim">Uninstalling? First remove Grill Me's hooks and <span className="font-mono">/ship</span> command from your repos. Your own settings stay.</span>
        <button className="btn" onClick={() => void uninstall()}>Remove from my repos</button>
      </div>
    </div>
  );
}
