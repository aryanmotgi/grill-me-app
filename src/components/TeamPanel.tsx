import { useApp } from "../store";
import type { CiStatus } from "../types";

const CI_TAG: Record<CiStatus, { icon: string; cls: string }> = {
  pass: { icon: "✓", cls: "ok" },
  fail: { icon: "✗", cls: "danger" },
  running: { icon: "◌", cls: "" },
};

function download(filename: string, text: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function TeamPanel() {
  const { teammates, tasks, activity, ciWorkflows, sponsorChecklist, toast } = useApp();

  const snapshot = () => {
    const md = [
      `# Grill Me — team snapshot`,
      "",
      ...teammates.map(
        (t) => `- **${t.name}** · ${t.status} · ⎇ ${t.branch} · ${t.taskLabel} · editing ${t.currentFile}`,
      ),
      "",
      `## Tasks`,
      ...tasks.map((t) => `- [${t.status === "done" ? "x" : " "}] ${t.title} (${t.owner})`),
    ].join("\n");
    download("grill-me-snapshot.md", md);
    toast("Snapshot exported → grill-me-snapshot.md");
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
      `## Standup notes`,
      ...teammates.map((t) => `- **${t.name}**: ${t.standupNote}`),
    ].join("\n");
    download("grill-me-retro.md", md);
    toast("Retro compiled → grill-me-retro.md");
  };

  return (
    <div className="p-3 overflow-y-auto flex flex-col gap-4">
      {/* Claude usage per session */}
      <div>
        <div className="panel-label mb-2">claude usage</div>
        {teammates.map((t) => (
          <div key={t.id} className="py-2 border-b border-line/60 last:border-0">
            <div className="flex items-center gap-2 text-[11px]">
              <span className="font-semibold">{t.name}</span>
              <span className="tag">{t.usage.model}</span>
              <span className="tag">{t.usage.permissionMode}</span>
              <span className="flex-1" />
              <span className="text-faint text-[10px]">resets {t.usage.sessionResetsIn}</span>
            </div>
            <div className="mt-1.5 grid grid-cols-[52px_1fr_34px] items-center gap-2 text-[10px] text-faint">
              <span>session</span>
              <div className="meter"><div className={t.usage.sessionPct > 70 ? "hot" : ""} style={{ width: `${t.usage.sessionPct}%` }} /></div>
              <span className="tabular-nums text-right">{t.usage.sessionPct}%</span>
              <span>week</span>
              <div className="meter"><div className={t.usage.weeklyPct > 70 ? "hot" : ""} style={{ width: `${t.usage.weeklyPct}%` }} /></div>
              <span className="tabular-nums text-right">{t.usage.weeklyPct}%</span>
            </div>
          </div>
        ))}
      </div>

      {/* session health + permissions */}
      <div>
        <div className="panel-label mb-2">health · access</div>
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
      </div>

      {/* CI */}
      <div>
        <div className="panel-label mb-2">ci — github actions</div>
        {ciWorkflows.map((w) => (
          <div key={w.name} className="flex items-center gap-2 py-1 text-[11px]">
            <span className={`tag ${CI_TAG[w.status].cls}`}>{CI_TAG[w.status].icon}</span>
            <span>{w.name}</span>
            <span className="flex-1" />
            <span className="font-mono text-faint text-[10px]">{w.detail}</span>
          </div>
        ))}
      </div>

      {/* sponsor checklist */}
      <div>
        <div className="panel-label mb-2">sponsor checklist</div>
        {sponsorChecklist.map((s) => (
          <div key={s.sponsor + s.requirement} className="flex items-start gap-2 py-1 text-[11px]">
            <span className={s.done ? "text-ok" : "text-faint"}>{s.done ? "▣" : "▢"}</span>
            <span className="text-dim leading-snug">
              <span className="text-accent">{s.sponsor}</span> — {s.requirement}
            </span>
          </div>
        ))}
      </div>

      {/* exports */}
      <div className="flex gap-2 demo-hide">
        <button className="btn" onClick={snapshot}>⇩ snapshot</button>
        <button className="btn" onClick={retro}>⇩ retro doc</button>
      </div>
    </div>
  );
}

/** Embedded browser preview — real webview mount lands next phase. */
export function PreviewPane() {
  return (
    <div className="p-3 h-full flex flex-col">
      <div className="flex items-center gap-2 mb-2">
        <span className="tag">http://localhost:1420</span>
        <button className="btn">↻</button>
      </div>
      <div className="flex-1 hairline rounded-sm bg-raised flex items-center justify-center">
        <div className="text-center text-faint text-[11px] leading-relaxed">
          <div className="text-[24px] mb-2">⌁</div>
          live app preview mounts here<br />
          (Tauri webview — next phase)
        </div>
      </div>
    </div>
  );
}
