import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import { useApp } from "../store";
import { isTauri } from "../data/sources/git";

function download(filename: string, text: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

const fmtTokens = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;

const prettyModel = (id: string) =>
  id.replace("claude-", "").replace(/-\d{8}$/, "").replace(/-/g, " ");

export function TeamPanel() {
  const { teammates, tasks, activity, ciRuns, standupLines, toast } = useApp();

  const snapshot = () => {
    const md = [
      `# Grill Me — team snapshot`,
      "",
      ...teammates.map(
        (t) => `- **${t.name}** · ${t.status} · ${t.branch} · ${t.taskLabel} · editing ${t.currentFile}`,
      ),
      "",
      `## Tasks`,
      ...tasks.map((t) => `- [${t.status === "done" ? "x" : " "}] ${t.title} (${t.owner})`),
    ].join("\n");
    download("grill-me-snapshot.md", md);
    toast("Snapshot exported");
  };

  const retro = () => {
    const md = [
      `# Grill Me — team retro`,
      "",
      `## What shipped`,
      ...tasks.filter((t) => t.status === "done").map((t) => `- ${t.title} — ${t.owner}`),
      "",
      `## Timeline`,
      ...activity.map((e) => `- ${e.ts} · ${e.actor} · ${e.text}`),
      "",
      `## Standup log`,
      ...standupLines,
    ].join("\n");
    download("grill-me-retro.md", md);
    toast("Retro compiled");
  };

  return (
    <div className="p-3 overflow-y-auto flex flex-col gap-5">
      {/* Claude usage — real token tallies from transcripts */}
      <details open>
        <summary className="panel-label mb-1 cursor-pointer">claude usage</summary>
        <div className="text-faint text-[10px] mb-2 leading-relaxed">
          Real token counts from each session's transcript. Plan-limit % isn't
          exposed locally — check the statusline inside a session for that.
        </div>
        {teammates.map((t) => (
          <div key={t.id} className="py-1.5 border-b border-line/60 last:border-0">
            <div className="flex items-center gap-2 text-[11px]">
              <span className="font-semibold">{t.name}</span>
              <span className="tag">{t.usage.tokens ? prettyModel(t.usage.model) : "no session transcript"}</span>
              <span className="flex-1" />
              {t.usage.tokens ? (
                <span className="text-faint text-[10px]">{t.usage.tokens.turns} turns</span>
              ) : null}
            </div>
            {t.usage.tokens ? (
              <div className="mt-1 flex gap-4 font-mono text-[10px] text-dim tabular-nums">
                <span>in {fmtTokens(t.usage.tokens.input)}</span>
                <span>out {fmtTokens(t.usage.tokens.output)}</span>
                <span>cache {fmtTokens(t.usage.tokens.cacheRead)}</span>
              </div>
            ) : null}
          </div>
        ))}
      </details>

      {/* session health + permissions */}
      <details open>
        <summary className="panel-label mb-2 cursor-pointer">health · access</summary>
        {teammates.map((t) => (
          <div key={t.id} className="flex items-center gap-2 py-1 text-[11px]">
            <span className={`status-dot ${t.status}`} />
            <span>{t.name}</span>
            <span className="flex-1" />
            {t.health !== "ok" ? (
              <span className="tag danger">{t.health} {t.lastActiveMin}m</span>
            ) : (
              <span className="tag ok">healthy</span>
            )}
            <span className="tag">{t.permission === "edit" ? "can jump in" : "view-only"}</span>
          </div>
        ))}
      </details>

      {/* CI — real GitHub Actions runs */}
      <details open>
        <summary className="panel-label mb-2 cursor-pointer">ci — github actions</summary>
        {ciRuns.length === 0 ? (
          <div className="text-faint text-[10px]">
            No runs found — repo has no Actions yet, or gh isn't authenticated.
          </div>
        ) : (
          ciRuns.map((w, i) => (
            <div key={i} className="flex items-center gap-2 py-1 text-[11px]">
              <span className={
                w.conclusion === "success" ? "text-ok"
                : w.conclusion === "failure" ? "text-danger"
                : "text-dim"
              }>
                <Icon name={w.conclusion === "success" ? "check" : w.conclusion === "failure" ? "cross" : "clock"} size={11} />
              </span>
              <span className="truncate">{w.displayTitle || w.name}</span>
              <span className="flex-1" />
              <span className="font-mono text-faint text-[10px]">{w.headBranch}</span>
            </div>
          ))
        )}
      </details>

      <SponsorList />

      <div className="flex gap-2 demo-hide">
        <button className="btn" onClick={snapshot}><Icon name="download" size={10} /> snapshot</button>
        <button className="btn" onClick={retro}><Icon name="download" size={10} /> retro doc</button>
        <button className="btn" title="Full project state bundle — tasks, messages, config, logs"
          onClick={async () => {
            const { invoke } = await import("@tauri-apps/api/core");
            const bundle = await invoke<string>("project_export").catch((e) => `{"error":"${e}"}`);
            download(`grillme-project-backup-${Date.now()}.json`, bundle);
            toast("Project state exported");
          }}>
          <Icon name="download" size={10} /> backup
        </button>
      </div>
    </div>
  );
}

function SponsorList() {
  const { sponsorChecklist, setShared, mergeQueue } = useApp();
  const toggle = async (i: number) => {
    const next = sponsorChecklist.map((s, j) => (j === i ? { ...s, done: !s.done } : s));
    setShared({ sponsorChecklist: next });
    if (isTauri()) {
      const { invoke } = await import("@tauri-apps/api/core");
      invoke("shared_write", {
        name: "team.json",
        content: JSON.stringify({ mergeQueue, sponsor: next }, null, 2),
      }).catch(console.error);
    }
  };
  return (
    <div>
      <div className="panel-label mb-2">requirements checklist</div>
      {sponsorChecklist.map((s, i) => (
        <button key={s.sponsor + s.requirement} className="flex items-start gap-2 py-1 text-[11px] cursor-pointer text-left w-full"
          onClick={() => toggle(i)}>
          <span className={s.done ? "text-ok" : "text-faint"}>
            <Icon name={s.done ? "check" : "plus"} size={10} />
          </span>
          <span className="text-dim leading-snug">
            <span className="text-accent">{s.sponsor}</span> — {s.requirement}
          </span>
        </button>
      ))}
    </div>
  );
}

/** Live preview of the PROJECT UNDER DEVELOPMENT (its dev server), not Grill Me — URL persisted in settings.json. */
export function PreviewPane() {
  const [url, setUrl] = useState("");
  const [draft, setDraft] = useState("");

  useEffect(() => {
    (async () => {
      if (!isTauri()) return;
      const { invoke } = await import("@tauri-apps/api/core");
      const raw = await invoke<string>("shared_read", { name: "settings.json" }).catch(() => "");
      const settings = raw?.trim() ? JSON.parse(raw) : {};
      const u = settings.previewUrl ?? "http://localhost:1420";
      setUrl(u);
      setDraft(u);
    })();
  }, []);

  const save = async () => {
    setUrl(draft);
    if (!isTauri()) return;
    const { invoke } = await import("@tauri-apps/api/core");
    const raw = await invoke<string>("shared_read", { name: "settings.json" }).catch(() => "");
    const settings = raw?.trim() ? JSON.parse(raw) : {};
    invoke("shared_write", {
      name: "settings.json",
      content: JSON.stringify({ ...settings, previewUrl: draft }, null, 2),
    }).catch(console.error);
  };

  return (
    <div className="p-3 h-full flex flex-col gap-2">
      <div className="text-faint text-[10px] leading-relaxed">
        Live preview of the app THIS PROJECT is building (its dev server) — so you can
        watch the product change while sessions work. Not Grill Me data. Hide it in
        settings if this project has no web UI.
      </div>
      <div className="flex items-center gap-1.5">
        <input
          className="flex-1 bg-raised hairline rounded-sm px-2 py-1 font-mono text-[10px] outline-none focus:border-accent"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
        />
        <button className="btn" onClick={save}>load</button>
      </div>
      {url ? (
        <iframe src={url} className="flex-1 hairline rounded-sm bg-white" title="preview" />
      ) : (
        <div className="flex-1 hairline rounded-sm bg-raised flex items-center justify-center text-faint text-[11px]">
          set a URL above
        </div>
      )}
    </div>
  );
}
