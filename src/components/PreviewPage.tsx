import { useCallback, useEffect, useState } from "react";
import { useApp, ptyIdFor } from "../store";
import { XtermPane } from "./XtermPane";
import { Icon } from "./Icon";

// ---------------------------------------------------------------------------
// Live preview (nav → Preview): the app your sessions are building, inside
// Grill Me. Finds running dev servers (labelled by project/session folder),
// shows the chosen one in a frame, and can start the project's dev script in
// a terminal strip at the bottom when nothing's running.
// ---------------------------------------------------------------------------

interface Server { port: number; pid: number; command: string; cwd: string }

const native = () => "__TAURI_INTERNALS__" in window;

export function PreviewPage() {
  const members = useApp((s) => s.members);
  const themeName = useApp((s) => s.themeName);
  const saved = useApp((s) => (typeof s.appSettings.previewUrl === "string" ? s.appSettings.previewUrl : ""));
  const setAppSetting = useApp((s) => s.setAppSetting);
  const [servers, setServers] = useState<Server[]>([]);
  const [url, setUrl] = useState(saved);
  const [draft, setDraft] = useState(saved);
  const [frameKey, setFrameKey] = useState(0);
  const [devCmd, setDevCmd] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const scan = useCallback(async () => {
    if (!native()) return;
    const { invoke } = await import("@tauri-apps/api/core");
    const found = await invoke<Server[]>("dev_servers").catch(() => []);
    setServers(found);
    if (!url && found[0]) go(`http://localhost:${found[0].port}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  useEffect(() => {
    void scan();
    const t = setInterval(() => void scan(), 8000);
    return () => clearInterval(t);
  }, [scan]);

  useEffect(() => {
    if (!native() || !members[0]) return;
    void import("@tauri-apps/api/core").then(({ invoke }) =>
      invoke<string | null>("detect_dev_cmd", { repoPath: members[0].repoPath }).then(setDevCmd).catch(() => setDevCmd(null)));
  }, [members]);

  const go = (u: string) => {
    const clean = /^https?:\/\//.test(u) ? u : `http://${u}`;
    setUrl(clean);
    setDraft(clean);
    setAppSetting("previewUrl", clean);
    setFrameKey((k) => k + 1);
  };

  const labelFor = (s: Server) => {
    const m = members.find((x) => s.cwd && (s.cwd === x.repoPath || s.cwd.startsWith(`${x.repoPath}/`)));
    const folder = s.cwd.split("/").filter(Boolean).pop() ?? s.command;
    return `${m ? m.name : folder} · :${s.port}`;
  };

  const openExternal = async () => {
    if (!url) return;
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url).catch(() => {});
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex items-center gap-2 px-3 h-11 flex-none border-b border-line">
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar max-w-[50%]">
          {servers.map((s) => (
            <button key={s.port}
              className={`px-2.5 h-7 rounded-lg text-[12px] whitespace-nowrap cursor-pointer ${url.endsWith(`:${s.port}`) || url.includes(`:${s.port}/`) ? "bg-raised text-ink" : "text-dim hover:text-ink"}`}
              title={`${s.command} (pid ${s.pid}) in ${s.cwd}`}
              onClick={() => go(`http://localhost:${s.port}`)}>
              {labelFor(s)}
            </button>
          ))}
        </div>
        <input className="flex-1 min-w-0 bg-raised/50 rounded-lg px-3 h-7 text-[12px] font-mono outline-none focus:ring-1 focus:ring-accent"
          value={draft} placeholder="http://localhost:5173"
          onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && draft.trim()) go(draft.trim()); }} />
        <button className="w-7 h-7 rounded-md flex items-center justify-center text-dim hover:text-ink hover:bg-raised cursor-pointer" title="Reload" onClick={() => setFrameKey((k) => k + 1)}>
          <Icon name="swap" size={13} />
        </button>
        <button className="composer-btn h-7 text-[11.5px]" title="Open in your browser" onClick={() => void openExternal()}>Open</button>
        {devCmd && members[0] ? (
          <button className={`composer-btn h-7 text-[11.5px] ${running ? "on" : ""}`} title={`Run \`${devCmd}\` in ${members[0].repoPath}`}
            onClick={() => setRunning(!running)}>
            <Icon name="terminal" size={11} /> {running ? "Hide dev server" : devCmd}
          </button>
        ) : null}
      </div>

      <div className="flex-1 min-h-0 bg-white/[0.02]">
        {url ? (
          <iframe key={frameKey} src={url} title="App preview" className="w-full h-full border-0 bg-white" />
        ) : (
          <div className="h-full flex flex-col items-center justify-center gap-2 text-center text-faint text-[12.5px]">
            <Icon name="layout" size={22} />
            <span>No dev server running.</span>
            <span>{devCmd ? `Start one with “${devCmd}” above, or ask a session to run it.` : "Start your app's dev server, then it shows up here."}</span>
          </div>
        )}
      </div>

      {running && devCmd && members[0] ? (
        <div className="h-[28%] flex-none border-t border-line">
          <XtermPane id={`${ptyIdFor(members[0].id)}:devserver`} cwd={members[0].repoPath} themeName={themeName} shell autorun={devCmd} />
        </div>
      ) : null}
    </div>
  );
}
