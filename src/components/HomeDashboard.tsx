import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import { ptyIdFor, useApp } from "../store";
import { isTauri } from "../data/sources/git";
import { fmtTokens } from "../lib/format";

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

function activitySentence(t: ReturnType<typeof useApp.getState>["teammates"][number]) {
  if (t.health === "disconnected") return "worktree not connected";
  if (t.status === "needs-input") return "waiting on a decision";
  if (t.status === "working") return t.currentFile !== "—" && t.currentFile ? `working in ${t.currentFile.split("/").pop()}` : "working";
  if (t.lastActiveMin > 0) return `quiet for ${t.lastActiveMin}m`;
  return "idle";
}

/** Mission control: everything that needs you + team pulse, one screen. */
export function HomeDashboard() {
  const {
    teammates, messages, tasks, mergeQueue, members, activity, standupLines,
    setActive, setRailTab, setView, shipSession, setMergePilotOpen, resources,
    respondProposal, toast,
  } = useApp();
  const [audit, setAudit] = useState<{ blocked: number; total: number }>({ blocked: 0, total: 0 });

  useEffect(() => {
    if (!isTauri()) return;
    const load = async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      const lines = await invoke<string[]>("audit_tail", { member: null }).catch(() => [] as string[]);
      setAudit({ total: lines.length, blocked: 0 });
    };
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  const me = members[0]?.id;
  const needsInput = teammates.filter((t) => t.status === "needs-input");
  const blocking = messages.filter((m) => !m.answered && m.kind === "blocking" && (m.to === me || m.to === "all"));
  const questions = messages.filter((m) => !m.answered && m.kind === "question" && (m.to === me || m.to === "all"));
  const proposals = messages.filter((m) => !m.answered && m.kind === "proposal" && m.from !== me);
  const myTurn = mergeQueue[0] === me;
  const needsYou = needsInput.length + blocking.length + questions.length + proposals.length + (myTurn ? 1 : 0);

  const commitsToday = activity.filter((a) => a.kind === "commit").length;
  const doneTasks = tasks.filter((t) => t.status === "done").length;

  return (
    <div className="flex-1 overflow-y-auto p-6 bg-bg">
      <div className="max-w-[980px] mx-auto grid grid-cols-2 gap-5">

        {/* NEEDS YOU — the one queue that matters */}
        <section className="col-span-2">
          <div className="flex items-baseline gap-3 mb-2">
            <span className="font-display font-semibold text-[15px]">
              {needsYou === 0 ? "All clear" : `Needs you · ${needsYou}`}
            </span>
            <span className="text-faint text-[11px]">
              {needsYou === 0 ? "nothing is waiting on a decision from you" : "resolve these to unblock the team"}
            </span>
          </div>
          <div className="flex flex-col gap-1.5">
            {myTurn ? (
              <button className="flex items-center gap-3 px-4 py-2.5 bg-raised rounded-md text-left hover:brightness-110 transition-all cursor-pointer border-l-2 border-l-ok"
                onClick={() => setMergePilotOpen(true)}>
                <Icon name="merge" size={13} className="text-ok" />
                <span className="text-[12px]">Your merge turn — run the merge when ready</span>
                <span className="ml-auto text-faint text-[10px]">opens merge terminal</span>
              </button>
            ) : null}
            {needsInput.map((t) => (
              <button key={t.id} className="flex items-center gap-3 px-4 py-2.5 bg-raised rounded-md text-left hover:brightness-110 transition-all cursor-pointer border-l-2 border-l-warn"
                onClick={() => setActive(t.id)}>
                <span className="status-dot needs-input" />
                <span className="text-[12px]"><b>{t.name}</b>'s session is waiting on a decision</span>
                <span className="ml-auto text-faint text-[10px]">open session</span>
              </button>
            ))}
            {blocking.map((m) => (
              <button key={m.id} className="flex items-center gap-3 px-4 py-2.5 bg-raised rounded-md text-left hover:brightness-110 transition-all cursor-pointer border-l-2 border-l-danger"
                title={m.text} onClick={() => { setRailTab("inbox"); setView("session"); }}>
                <Icon name="warn" size={12} className="text-danger" />
                <span className="text-[12px]"><b>{teammates.find((t) => t.id === m.from)?.name ?? m.from}</b> is blocked: {clip(m.text, 70)}</span>
                <span className="ml-auto text-faint text-[10px]">reply</span>
              </button>
            ))}
            {proposals.map((m) => (
              <div key={m.id} className="flex items-center gap-3 px-4 py-2.5 bg-raised rounded-md border-l-2 border-l-accent" title={m.text}>
                <Icon name="mail" size={12} className="text-accent" />
                <span className="text-[12px] flex-1"><b>{teammates.find((t) => t.id === m.from)?.name ?? m.from}</b> proposes: {clip(m.text, 60)}</span>
                <button className="btn" onClick={() => { respondProposal(m.id, "yes"); toast("Answered yes"); }}>yes</button>
                <button className="btn" onClick={() => { respondProposal(m.id, "no"); toast("Answered no"); }}>no</button>
                <button className="btn" onClick={() => { respondProposal(m.id, "unsure"); }}>unsure</button>
              </div>
            ))}
            {questions.map((m) => (
              <button key={m.id} className="flex items-center gap-3 px-4 py-2.5 bg-raised rounded-md text-left hover:brightness-110 transition-all cursor-pointer border-l-2 border-l-warn"
                title={m.text} onClick={() => { setRailTab("inbox"); setView("session"); }}>
                <Icon name="mail" size={12} className="text-warn" />
                <span className="text-[12px]"><b>{teammates.find((t) => t.id === m.from)?.name ?? m.from}</b> asks: {clip(m.text, 70)}</span>
                <span className="ml-auto text-faint text-[10px]">reply</span>
              </button>
            ))}
            {needsYou === 0 ? (
              <div className="px-4 py-3 text-faint text-[11px] bg-panel rounded-md">
                When a session needs input, a teammate is blocked, or it's your merge turn — it shows up here first.
              </div>
            ) : null}
          </div>
        </section>

        {/* TEAM PULSE */}
        <section>
          <div className="panel-label mb-2">team right now</div>
          <div className="flex flex-col gap-1">
            {teammates.map((t) => {
              const res = resources[ptyIdFor(t.id)] ?? resources[t.id];
              return (
                <button key={t.id} className="flex items-center gap-3 px-3 py-2.5 rounded-md text-left hover:bg-raised transition-colors cursor-pointer"
                  onClick={() => setActive(t.id)}>
                  <span className={`status-dot ${t.status}`} />
                  <div className="min-w-0">
                    <div className="text-[12px] font-semibold">{t.name}</div>
                    <div className="text-[10px] text-dim truncate">{activitySentence(t)}</div>
                  </div>
                  <div className="ml-auto text-right">
                    <div className="font-mono text-[9px] text-faint">{t.branch !== "—" ? t.branch.split("/").pop() : ""}</div>
                    {t.usage.tokens ? (
                      <div className="font-mono text-[9px] text-faint">{fmtTokens(t.usage.tokens.output)} out</div>
                    ) : null}
                    {res && res.cpu >= 3 ? (
                      <div className="font-mono text-[9px] text-warn">{res.cpu.toFixed(0)}% cpu</div>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {/* TODAY */}
        <section>
          <div className="panel-label mb-2">today</div>
          <div className="grid grid-cols-3 gap-2 mb-3">
            <div className="bg-panel rounded-md px-3 py-2.5">
              <div className="text-[18px] font-display font-bold text-accent">{commitsToday}</div>
              <div className="text-[9px] text-faint">commits in feed</div>
            </div>
            <div className="bg-panel rounded-md px-3 py-2.5">
              <div className="text-[18px] font-display font-bold text-ok">{doneTasks}</div>
              <div className="text-[9px] text-faint">tasks done</div>
            </div>
            <div className="bg-panel rounded-md px-3 py-2.5">
              <div className="text-[18px] font-display font-bold text-ink">{audit.total}</div>
              <div className="text-[9px] text-faint">tool calls audited</div>
            </div>
          </div>
          {standupLines.length > 0 ? (
            <div className="text-[10px] text-dim leading-relaxed">
              <span className="panel-label">latest standup · </span>
              {standupLines[standupLines.length - 1]?.split("\t").slice(2).join(" ")}
            </div>
          ) : null}
          <button className="btn mt-2" onClick={() => { setRailTab("activity"); setView("session"); }}>
            full feed
          </button>
        </section>

        {/* QUICK ACTIONS */}
        <section className="col-span-2">
          <div className="panel-label mb-2">do something</div>
          <div className="flex gap-2 flex-wrap">
            <button className="btn primary" onClick={() => shipSession(useApp.getState().activeId)}>
              <Icon name="push" size={11} /> review &amp; ship my work
            </button>
            <button className="btn" onClick={() => { setRailTab("tasks"); setView("session"); }}>
              <Icon name="branch" size={11} /> task board
            </button>
            <button className="btn" onClick={() => { setRailTab("inbox"); setView("session"); }}>
              <Icon name="mail" size={11} /> inbox
            </button>
            <button className="btn" onClick={() => useApp.getState().setPickerOpen(true)}>
              switch project
            </button>
            <button className="btn" onClick={() => useApp.setState({ featureIndexOpen: true } as never)}>
              <Icon name="search" size={11} /> everything Grill Me can do <span className="font-mono text-[9px]">⌘/</span>
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
