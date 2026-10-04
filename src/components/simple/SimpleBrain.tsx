import { useMemo, useState } from "react";
import { upsertShared, useApp } from "../../store";
import { Icon } from "../Icon";
import { BrainPage } from "../BrainPage";
import { GoalWatch } from "./OverviewExtras";
import { blockedBy, columns, mvpOf, whoIsOnWhat } from "../../lib/brainPlan";
import { sessionTitle } from "../../lib/sessionTitle";
import { sessionSentence } from "../../lib/sessionSentence";
import { visibleSessions } from "../../lib/sessionNav";
import type { Task } from "../../types";

// ---------------------------------------------------------------------------
// The simple layout's Brain: the four things a project needs to be clear on.
//   Goal   what you're trying to get done (the Spark checks prompts against it)
//   MVP    the must-haves for the first version, with progress
//   Plan   every task by stage: to do, doing, done (what it waits on)
//   Who    who (and which session) is working on what right now
// Recent decisions sit underneath. The full notebook (notes, "where was I?",
// search) is one click away. Tasks are the shared tasks every agent and
// teammate reads; the MVP is a "must-have" mark on them.
// ---------------------------------------------------------------------------

function Label({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-center mb-2">
      <span className="text-[11px] tracking-[0.12em] uppercase text-faint font-semibold flex-1">{children}</span>
      {right}
    </div>
  );
}

function save(task: Task) {
  useApp.setState((s) => ({ tasks: s.tasks.some((t) => t.id === task.id) ? s.tasks.map((t) => (t.id === task.id ? task : t)) : [...s.tasks, task] }));
  void upsertShared("tasks.json", [task]);
}

function AddTask({ mvp, owner, placeholder }: { mvp: boolean; owner: string; placeholder: string }) {
  const [text, setText] = useState("");
  const add = () => {
    const title = text.trim();
    if (!title) return;
    save({ id: `t${Date.now()}`, title, desc: "", owner, status: "not-started", files: [], mvp });
    setText("");
  };
  return (
    <div className="flex gap-2 mt-2">
      <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }}
        placeholder={placeholder} className="flex-1 min-w-0 bg-raised/50 hairline rounded-lg px-3 h-8 text-[12.5px] outline-none focus:border-accent placeholder:text-faint" />
      <button className="composer-btn h-8" disabled={!text.trim()} onClick={add}>Add</button>
    </div>
  );
}

function Mvp({ tasks, owner }: { tasks: Task[]; owner: string }) {
  const setTaskStatus = useApp((s) => s.setTaskStatus);
  const m = mvpOf(tasks);
  return (
    <section aria-label="MVP">
      <Label right={m.total ? <span className="text-[12px] text-dim num">{m.done} of {m.total} done</span> : undefined}>MVP · must-haves for v1</Label>
      <div className="rounded-xl border border-line bg-raised/20 px-4 py-3">
        {m.total ? (
          <>
            <div className="limit-bar ok mb-3"><div className="limit-fill" style={{ width: `${(m.done / m.total) * 100}%` }} /></div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              {m.items.map((t) => (
                <label key={t.id} className="flex items-center gap-2 text-[13px] cursor-pointer min-w-0">
                  <input type="checkbox" className="accent-[var(--ok)] flex-none" checked={t.status === "done"}
                    onChange={() => setTaskStatus(t.id, t.status === "done" ? "in-progress" : "done")} />
                  <span className={`truncate ${t.status === "done" ? "text-faint line-through" : "text-ink"}`}>{t.title}</span>
                </label>
              ))}
            </div>
          </>
        ) : (
          <p className="text-[12.5px] text-faint">What has to work before the first version is done? Add the must-haves; everything else can wait.</p>
        )}
        <AddTask mvp owner={owner} placeholder="Add a must-have, e.g. Sign up with email" />
      </div>
    </section>
  );
}

function Plan({ tasks, nameOf }: { tasks: Task[]; nameOf: (id: string) => string }) {
  const c = columns(tasks);
  const col = (title: string, list: Task[], tone: string) => (
    <div className="flex-1 min-w-0 rounded-xl border border-line bg-raised/20 px-3 py-2.5">
      <div className={`text-[11.5px] font-semibold mb-1.5 ${tone}`}>{title} <span className="text-faint font-normal num">{list.length}</span></div>
      {list.length ? (
        <ul className="flex flex-col gap-1.5">
          {list.slice(0, 12).map((t) => {
            const waits = blockedBy(t, tasks);
            return (
              <li key={t.id} className="text-[12.5px] leading-snug min-w-0">
                <span className={`block truncate ${t.status === "done" ? "text-faint" : "text-ink"}`} title={t.title}>
                  {t.mvp ? <span className="text-accent mr-1" title="Must-have">★</span> : null}{t.title}
                </span>
                <span className="block text-[11px] text-faint truncate">
                  {nameOf(t.owner)}{waits ? <span className="text-warn"> · waits on {waits.title}</span> : null}
                </span>
              </li>
            );
          })}
          {list.length > 12 ? <li className="text-[11px] text-faint">+{list.length - 12} more</li> : null}
        </ul>
      ) : <p className="text-[11.5px] text-faint">Nothing here.</p>}
    </div>
  );
  return (
    <section aria-label="Plan">
      <Label>Plan</Label>
      <div className="flex gap-2">
        {col("To do", c.todo, "text-dim")}
        {col("Doing", c.doing, "text-data")}
        {col("Done", c.done, "text-ok")}
      </div>
    </section>
  );
}

export function SimpleBrain() {
  const [full, setFull] = useState(false);
  const tasks = useApp((s) => s.tasks);
  const all = useApp((s) => s.teammates);
  const appMode = useApp((s) => s.appMode);
  const members = useApp((s) => s.members);
  const titles = useApp((s) => s.appSettings.sessionTitles);
  const teamSessions = useApp((s) => s.teamSessions);
  const decisions = useApp((s) => s.decisions);
  const room = useApp((s) => s.room);
  const setActive = useApp((s) => s.setActive);
  const memberKey = members.map((m) => m.id).join(",");
  const mine = useMemo(() => visibleSessions(all, appMode, memberKey ? memberKey.split(",") : []).filter((t) => !t.missing), [all, appMode, memberKey]);
  const owner = members[0]?.id ?? "me";
  // a task's owner: your session's title, a teammate's name, or the raw id
  const nameOf = (id: string) => {
    // the main session is you; other sessions by a short name; teammates by name
    if (id === owner || id === "me") return "You";
    const s = all.find((t) => t.id === id);
    if (s) { const n = sessionTitle(s, titles); return n.length > 22 ? `${n.slice(0, 21)}…` : n; }
    return room?.members.find((m) => m.id === id)?.name ?? id;
  };
  const people = [
    ...mine.map((t) => ({ id: t.id, name: sessionTitle(t, titles) })),
    ...(room?.members ?? []).filter((m) => !mine.some((t) => t.id === m.id)).map((m) => ({ id: m.id, name: m.name })),
  ];
  const who = whoIsOnWhat(tasks, people);
  const recent = [...decisions].sort((a, b) => b.epochMs - a.epochMs).slice(0, 5);

  if (full) {
    return (
      <div className="flex-1 min-h-0 flex flex-col">
        <button className="flex-none flex items-center gap-1.5 h-8 px-4 text-[12px] text-dim hover:text-ink border-b border-line cursor-pointer" onClick={() => setFull(false)}>
          ← Goal, MVP and plan
        </button>
        <BrainPage />
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="max-w-[860px] mx-auto px-6 py-8 flex flex-col gap-7">
        <GoalWatch />
        <Mvp tasks={tasks} owner={owner} />
        <Plan tasks={tasks} nameOf={nameOf} />

        <section aria-label="Who's working on what">
          <Label>Who's on what</Label>
          <div className="flex flex-col gap-1.5">
            {mine.map((t) => {
              const said = sessionSentence(t);
              const doing = who.find((p) => p.id === t.id)?.doing ?? [];
              return (
                <button key={t.id} className="flex items-center gap-3 rounded-xl border border-line bg-raised/20 hover:bg-raised/40 px-4 py-2.5 text-left cursor-pointer" onClick={() => setActive(t.id)}>
                  <span className={`status-dot ${t.status} flex-none`} aria-hidden />
                  <span className="text-[13px] text-ink truncate">{sessionTitle(t, titles)}</span>
                  <span className="text-[12px] text-faint truncate flex-1">{doing.length ? `on ${doing.map((x) => x.title).join(", ")}` : said.text}</span>
                  <Icon name="chevron" size={10} className="text-faint" />
                </button>
              );
            })}
            {teamSessions.map((d) => (
              <div key={d.id} className="flex items-center gap-3 rounded-xl border border-line px-4 py-2.5">
                <span className={`status-dot ${d.status} flex-none`} aria-hidden />
                <span className="text-[13px] text-ink">{d.memberName}</span>
                <span className="text-[12px] text-faint truncate flex-1">{d.sentence || d.title}</span>
              </div>
            ))}
            {!mine.length && !teamSessions.length ? <p className="text-[12.5px] text-faint">No sessions yet.</p> : null}
          </div>
        </section>

        <section aria-label="Recent decisions">
          <Label>Decisions</Label>
          {recent.length ? (
            <ul className="flex flex-col gap-1.5">
              {recent.map((d) => <li key={d.id} className="text-[12.5px] text-dim leading-snug select-text">• {d.text}</li>)}
            </ul>
          ) : <p className="text-[12.5px] text-faint">Nothing decided yet. Decisions you or your agents log show up here, and every agent reads them.</p>}
        </section>

        <button className="self-start text-[12px] text-faint hover:text-ink cursor-pointer" onClick={() => setFull(true)}>
          Open the full Brain (notes, where was I, search) →
        </button>
      </div>
    </div>
  );
}
