import { useMemo, useState } from "react";
import { upsertShared, useApp } from "../store";
import { sessionTitle } from "../lib/sessionTitle";
import { buildWires, sessionMarks, sessionSentence, teamSessionsByMember, type FlowEnd, type Wire } from "../lib/flow";
import { newTeamHandoff, teamQuestionsFor } from "../lib/teamBridge";
import type { TeamSession } from "../types";
import { bridgeApply, bridgeResolve, bridgeSend, useBridge } from "./BridgePanel";
import { ackReply, bridgeAnswer, teamFlag, useReviews } from "./BridgeLoop";
import { automationOn } from "../lib/automations";
import { VERDICT_LABEL, type Review } from "../lib/bridgeLoop";
import { useRemote } from "./ClaudeConnect";
import { useTests } from "./Automations";
import { togglePanel } from "./Dock";
import { AgentLogo } from "./AgentLogo";
import { Icon } from "./Icon";
import type { Teammate } from "../types";

// ---------------------------------------------------------------------------
// Flow: the bridge drawn as a map. Left, the brainstorm side (Claude app /
// claude.ai) and the shared brain. Right, the coder sessions. Between them,
// every item in flight — each waits on one click here. Below, teammates.
// ---------------------------------------------------------------------------

function EndChip({ end, status }: { end: FlowEnd; status?: string }) {
  if (end.kind === "brainstorm") {
    return <span className="inline-flex items-center gap-1.5 text-[12px] text-ink"><AgentLogo agent="claude" size={13} /> Claude</span>;
  }
  if (end.kind === "brain") {
    return <span className="inline-flex items-center gap-1.5 text-[12px] text-ink"><Icon name="note" size={12} /> Brain</span>;
  }
  if (end.kind === "teammate") {
    return <span className="inline-flex items-center gap-1.5 text-[12px] text-ink"><Icon name="team" size={12} /> {end.name}{end.sessionTitle ? <span className="text-dim"> · {end.sessionTitle}</span> : null}</span>;
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-ink min-w-0">
      <span className={`status-dot ${status ?? "idle"} flex-none`} style={{ width: 7, height: 7 }} aria-hidden />
      <span className="truncate">{end.title}</span>
    </span>
  );
}

const KIND_LABEL: Record<Wire["kind"], string> = { task: "Task", answer: "Answer", plan: "Plan", question: "Question", reply: "Reply" };

/** Claude's drafted answer to a coder's question: edit it, send it (that
 *  click is the approval), or set it aside. */
function DraftAnswer({ w, onDismiss }: { w: Wire; onDismiss: () => void }) {
  const [text, setText] = useState(w.draft?.text ?? "");
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try { await bridgeAnswer(w.id, text); } finally { setBusy(false); }
  };
  const to = w.from.kind === "teammate" ? w.from.name : w.from.kind === "session" ? w.from.title : "the session";
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-[11px] text-faint">Claude's draft answer — edit before sending</div>
      <textarea rows={Math.min(8, Math.max(3, Math.ceil(text.length / 60)))} value={text} maxLength={4000}
        className="w-full bg-raised/60 hairline rounded-md px-2.5 py-2 text-[12px] text-ink outline-none focus:border-white/20 resize-y leading-snug"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send(); }} />
      <div className="flex flex-wrap items-center gap-2">
        <button className="composer-btn on h-7 text-[11.5px]" disabled={busy || !text.trim()} onClick={() => void send()}
          title={`Sends this answer to ${to} now`}>
          {busy ? <span className="spinner" /> : <Icon name="push" size={11} />} Send answer
        </button>
        <button className="composer-btn h-7 text-[11.5px]" onClick={onDismiss}>Dismiss</button>
        <span className="text-[10.5px] text-faint">⌘↩ sends</span>
      </div>
    </div>
  );
}

function WireRow({ w, statusOf }: { w: Wire; statusOf: (id: string) => string }) {
  const state = useBridge((b) => b.state);
  const setBridgeOpen = useBridge((b) => b.setOpen);
  const [busy, setBusy] = useState(false);
  const act = async () => {
    setBusy(true);
    try {
      if (w.action === "send") {
        const h = state.handoffs.find((x) => x.id === w.id);
        if (h) await bridgeSend(h);
      } else if (w.action === "apply") {
        const p = state.plans.find((x) => x.id === w.id);
        if (p) await bridgeApply(p);
      } else {
        // answers come from the brainstorm side — open Claude with the ask ready
        togglePanel("claude");
        setBridgeOpen(false);
      }
    } finally {
      setBusy(false);
    }
  };
  const endStatus = (e: FlowEnd) => (e.kind === "session" ? statusOf(e.id) : undefined);
  const drafting = useApp((s) => automationOn(s.appSettings, "draft-answers"));
  const dismiss = () => {
    if (w.list === "team") void teamFlag(w.id, "teamDismiss");
    else if (w.list === "replies") void ackReply(w.id);
    else if (w.list === "team-replies") void teamFlag(w.id, "teamReplyAck");
    else void bridgeResolve(w.list, w.id, "dismissed");
  };
  // a question with a draft (or one on the way) gets the draft box instead of the plain button
  const draft = w.kind === "question" && w.draft && drafting && (w.draft.status === "ready" || w.draft.status === "drafting") ? w.draft : null;
  return (
    <div className="composer-card rounded-xl px-3.5 py-3 flex flex-col gap-2">
      <div className="flex items-center gap-2 min-w-0">
        <EndChip end={w.from} status={endStatus(w.from)} />
        <span className="flex-1 flex items-center min-w-[40px]">
          <span className="flex-1 h-px bg-warn/60" />
          <Icon name="chevron" size={10} className="text-warn -ml-1" />
        </span>
        <EndChip end={w.to} status={endStatus(w.to)} />
      </div>
      <div className="text-[12.5px] text-ink leading-snug">
        <span className="text-faint">{KIND_LABEL[w.kind]}{w.kind === "reply" ? (w.done ? " · done" : " · not done yet") : ""} · </span>{w.label}
      </div>
      {w.kind === "reply" ? (
        <div className="flex items-center gap-2 pt-0.5">
          <button className="composer-btn h-7 text-[11.5px]" onClick={dismiss}><Icon name="check" size={11} /> Got it</button>
          <span className="text-[11px] text-faint">Claude sees this on its next catch-up.</span>
        </div>
      ) : draft?.status === "ready" ? (
        <DraftAnswer w={w} onDismiss={dismiss} />
      ) : draft?.status === "drafting" ? (
        <div className="flex items-center gap-2 pt-0.5 text-[11.5px] text-dim">
          <span className="spinner" /> Claude is drafting…
          <span className="flex-1" />
          <button className="composer-btn h-7 text-[11.5px]" onClick={dismiss}>Dismiss</button>
        </div>
      ) : (
        <div className="flex items-center gap-2 pt-0.5">
          <button className="composer-btn on h-7 text-[11.5px]" disabled={busy} onClick={() => void act()}>
            {busy ? <span className="spinner" /> : w.action === "answer" ? <AgentLogo agent="claude" size={11} /> : <Icon name={w.action === "apply" ? "check" : "push"} size={11} />}
            {w.action === "send" ? (w.to.kind === "teammate" ? `Send to ${w.to.name}` : "Send to session") : w.action === "apply" ? "Add to board" : "Answer in Claude"}
          </button>
          <button className="composer-btn h-7 text-[11.5px]" onClick={dismiss}>Dismiss</button>
          <span className="flex-1" />
          <button className="text-[11px] text-faint hover:text-dim cursor-pointer" onClick={() => setBridgeOpen(true)}>details</button>
        </div>
      )}
    </div>
  );
}

const VERDICT_TONE: Record<Review["verdict"], string> = { ship: "tag ok", fix: "tag danger", wait: "tag" };

/** The session's latest auto-review: verdict pill + summary, risks on expand. */
function ReviewLine({ id }: { id: string }) {
  const r = useReviews((s) => s.reviews[id]);
  const running = useReviews((s) => s.running[id]);
  const [open, setOpen] = useState(false);
  if (!r) return running ? <div className="flex items-center gap-1.5 px-3.5 pb-2.5 -mt-1 pl-[34px] text-[11px] text-faint"><span className="spinner" style={{ width: 9, height: 9 }} /> reviewing…</div> : null;
  return (
    <div className="px-3.5 pb-2.5 -mt-1 pl-[34px] flex flex-col gap-1">
      <div className="flex items-start gap-1.5 min-w-0">
        <span className={`${VERDICT_TONE[r.verdict]} flex-none`} title={r.reason}>{VERDICT_LABEL[r.verdict]}</span>
        {running ? <span className="spinner flex-none mt-1" style={{ width: 9, height: 9 }} title="Re-reviewing…" /> : null}
      </div>
      <div className="text-[11.5px] text-dim leading-snug">{r.summary}</div>
      {r.risks.length ? (
        <>
          <button className="self-start text-[11px] text-faint hover:text-dim cursor-pointer" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? "hide risks" : `${r.risks.length} risk${r.risks.length === 1 ? "" : "s"}`}
          </button>
          {open ? <ul className="list-disc pl-4 text-[11.5px] text-dim flex flex-col gap-0.5">{r.risks.map((x, i) => <li key={i}>{x}</li>)}</ul> : null}
        </>
      ) : null}
    </div>
  );
}

function SessionRow({ t, wires, onOpen }: { t: Teammate; wires: Wire[]; onOpen: () => void }) {
  const titles = useApp((s) => s.appSettings.sessionTitles);
  const test = useTests((s) => s.results[t.id]);
  const marks = sessionMarks(wires, t.id);
  return (
    <div className="overflow-hidden first:rounded-t-xl last:rounded-b-xl">
      <button className="w-full flex items-start gap-3 px-3.5 py-2.5 text-left hover:bg-raised/50 transition-colors cursor-pointer"
        onClick={onOpen}>
        <span className={`status-dot ${t.status} mt-1.5 flex-none`} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="text-[13px] font-medium text-ink truncate">{sessionTitle(t, titles)}</span>
            {test && !test.running ? <span className={`text-[11px] flex-none ${test.ok ? "text-ok" : "text-danger"}`}>{test.ok ? "tests ✓" : "tests ✗"}</span> : null}
          </span>
          <span className="block text-[11.5px] text-dim truncate">{sessionSentence(t)}</span>
          <span className="flex items-center gap-2 mt-0.5 text-[11px]">
            <span className="font-mono text-faint truncate">{t.branch}</span>
            {marks.waiting ? <span className="text-warn flex-none">{marks.waiting} waiting to go in</span> : null}
            {marks.asked ? <span className="text-warn flex-none">asked {marks.asked === 1 ? "a question" : `${marks.asked} questions`}</span> : null}
          </span>
        </span>
      </button>
      <ReviewLine id={t.id} />
    </div>
  );
}

/** One of a teammate's sessions, with "Hand a task" (routed over the room;
 *  they approve before it's typed in). */
function MateSessionRow({ d, me, meName }: { d: TeamSession; me: string; meName: string }) {
  const toast = useApp((s) => s.toast);
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    const message = (draft ?? "").trim();
    if (!message) return;
    setBusy(true);
    try {
      await upsertShared("team-bridge.json", [newTeamHandoff({ me, meName, to: d.member, toName: d.memberName, session: d.session, sessionTitle: d.title, message, now: Date.now() })]);
      toast(`Sent to ${d.memberName} — they approve it before it reaches ${d.title}`);
      setDraft(null);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-1.5 px-1 py-1.5">
      <div className="flex items-start gap-2 group/mate">
        <span className={`status-dot ${d.status} mt-1.5 flex-none`} style={{ width: 7, height: 7 }} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="text-[12.5px] text-ink truncate">{d.title}</span>
            {d.tests === null ? null : <span className={`text-[11px] flex-none ${d.tests ? "text-ok" : "text-danger"}`}>{d.tests ? "tests ✓" : "tests ✗"}</span>}
            <span className="flex-1" />
            {draft === null ? (
              <button className="text-[11px] text-faint hover:text-ink cursor-pointer opacity-0 group-hover/mate:opacity-100 focus:opacity-100 transition-opacity flex-none"
                title={`Write a task for ${d.memberName}'s ${d.title} — ${d.memberName} approves it before it's typed in`}
                onClick={() => setDraft("")}>hand a task</button>
            ) : null}
          </span>
          <span className="block text-[11px] text-dim truncate">{d.sentence} · <span className="font-mono text-faint">{d.branch}</span></span>
        </span>
      </div>
      {draft !== null ? (
        <div className="flex flex-col gap-1.5 pl-4">
          <textarea autoFocus rows={3} value={draft} maxLength={4000} placeholder={`What should ${d.memberName}'s ${d.title} do?`}
            className="w-full bg-raised/60 hairline rounded-md px-2.5 py-2 text-[12px] text-ink outline-none focus:border-white/20 resize-none"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") setDraft(null); if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send(); }} />
          <div className="flex items-center gap-2">
            <button className="composer-btn on h-7 text-[11.5px]" disabled={busy || !draft.trim()} onClick={() => void send()}><Icon name="push" size={11} /> Send to {d.memberName}</button>
            <button className="composer-btn h-7 text-[11.5px]" onClick={() => setDraft(null)}>Cancel</button>
            <span className="text-[10.5px] text-faint">⌘↩ sends · they approve it on their side</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function FlowPage() {
  const projectName = useApp((s) => s.projects.find((p) => p.id === s.activeProject)?.name ?? "this project");
  const teammates = useApp((s) => s.teammates);
  const members = useApp((s) => s.members);
  const titles = useApp((s) => s.appSettings.sessionTitles);
  const tasks = useApp((s) => s.tasks);
  const decisions = useApp((s) => s.decisions);
  const room = useApp((s) => s.room);
  const roomSelfId = useApp((s) => s.roomSelf?.memberId);
  const roomPresence = useApp((s) => s.roomPresence);
  const teamSessions = useApp((s) => s.teamSessions);
  const teamBridge = useApp((s) => s.teamBridge);
  const setView = useApp((s) => s.setView);
  const setActive = useApp((s) => s.setActive);
  const state = useBridge((b) => b.state);
  const conn = useBridge((b) => b.conn);
  const setBridgeOpen = useBridge((b) => b.setOpen);
  const remote = useRemote((r) => r.status);

  // real members once config is loaded; the sample teammates in browser dev
  const sessions = useMemo(
    () => (members.length ? members.map((m) => teammates.find((t) => t.id === m.id)).filter((t): t is Teammate => !!t) : teammates),
    [members, teammates],
  );
  const titleOf = (id: string) => {
    const t = teammates.find((x) => x.id === id);
    return t ? sessionTitle(t, titles) : id;
  };
  const statusOf = (id: string) => teammates.find((x) => x.id === id)?.status ?? "idle";
  const me = roomSelfId ?? "";
  const meName = room?.members.find((m) => m.id === me)?.name ?? me;
  const wires = useMemo(() => buildWires(state, titleOf, teamQuestionsFor(teamBridge, me), { me, teamBridge }), [state, teammates, titles, teamBridge, me]); // eslint-disable-line react-hooks/exhaustive-deps

  const mates = room ? room.members.filter((m) => m.id !== roomSelfId) : [];
  const mateSessions = useMemo(() => teamSessionsByMember(teamSessions, Date.now()), [teamSessions]);
  const openTasks = tasks.filter((t) => t.status !== "done").length;
  const anyClaude = !!(conn?.desktop || conn?.code || remote?.url);

  return (
    <div className="@container flex-1 min-h-0 overflow-y-auto">
      <div className="max-w-[1080px] mx-auto px-4 @2xl:px-6 py-6 @2xl:py-8 flex flex-col gap-6 select-text">
        <div>
          <div className="text-[11px] tracking-[0.12em] uppercase text-faint">Flow · {projectName}</div>
          <p className="text-[12.5px] text-faint mt-1">
            Claude proposes, you approve, sessions build. Questions come back the same way. Everything in flight is here.
          </p>
        </div>

        <div className="grid grid-cols-1 @4xl:grid-cols-[250px_minmax(0,1fr)_300px] gap-5 items-start">
          {/* brainstorm side + brain */}
          <div className="flex flex-col gap-3">
            <div className="panel-label">brainstorm</div>
            <div className="composer-card rounded-xl px-4 py-3 flex flex-col gap-2.5">
              <div className="flex items-center gap-2 text-[13px] font-medium text-ink"><AgentLogo agent="claude" size={15} /> Claude</div>
              <div className="flex flex-col gap-1 text-[11.5px]">
                <span className={remote?.url ? "text-ok" : "text-faint"}>● claude.ai {remote?.url ? (remote.allowWrites ? "· can propose" : "· read-only") : "not linked"}</span>
                <span className={conn?.desktop ? "text-ok" : "text-faint"}>● Claude app {conn?.desktop ? "connected" : "not connected"}</span>
                <span className={conn?.code ? "text-ok" : "text-faint"}>● Claude Code sessions {conn?.code ? "connected" : "not connected"}</span>
              </div>
              <div className="flex gap-2 pt-1">
                <button className="composer-btn h-7 text-[11.5px]" onClick={() => togglePanel("claude")}><Icon name="eye" size={11} /> Open Claude</button>
                {anyClaude ? null : <button className="composer-btn on h-7 text-[11.5px]" onClick={() => setBridgeOpen(true)}>Connect</button>}
              </div>
            </div>

            <div className="panel-label mt-2">shared brain</div>
            <button className="composer-card rounded-xl px-4 py-3 flex flex-col gap-1.5 text-left cursor-pointer hover:border-white/20" onClick={() => setView("brain")}>
              <div className="flex items-center gap-2 text-[13px] font-medium text-ink"><Icon name="note" size={13} /> Brain</div>
              <div className="text-[12.5px] text-dim leading-snug">{state.goal ? state.goal : <span className="text-faint">No goal yet — click to set one.</span>}</div>
              <div className="text-[11px] text-faint num">{openTasks} open task{openTasks === 1 ? "" : "s"} · {state.notes.length} note{state.notes.length === 1 ? "" : "s"} · {decisions.length} decision{decisions.length === 1 ? "" : "s"}</div>
            </button>
          </div>

          {/* in flight — first when the columns stack: it's what needs you */}
          <div className="flex flex-col gap-3 min-w-0 order-first @4xl:order-none">
            <div className="panel-label">in flight · {wires.length}</div>
            {wires.length === 0 ? (
              <div className="composer-card rounded-xl px-4 py-6 text-center flex flex-col gap-2">
                <span className="text-[12.5px] text-dim">Nothing waiting on you.</span>
                <span className="text-[11.5px] text-faint">Ask Claude “what are my sessions doing?” or “plan the next feature and send it to a coder” — it shows up here for your OK.</span>
                {anyClaude ? null : <button className="composer-btn on h-7 text-[11.5px] self-center mt-1" onClick={() => setBridgeOpen(true)}>Connect Claude</button>}
              </div>
            ) : wires.map((w) => <WireRow key={w.id} w={w} statusOf={statusOf} />)}
          </div>

          {/* coders */}
          <div className="flex flex-col gap-3 min-w-0">
            <div className="panel-label">sessions · {sessions.length}</div>
            <div className="composer-card rounded-xl divide-y divide-line/60">
              {sessions.map((t) => (
                <SessionRow key={t.id} t={t} wires={wires} onOpen={() => { setActive(t.id); setView("session"); }} />
              ))}
              <button className="w-full flex items-center gap-2 px-3.5 py-2.5 text-[12px] text-faint hover:text-dim cursor-pointer last:rounded-b-xl" onClick={() => setView("new")}>
                <Icon name="plus" size={11} /> new session
              </button>
            </div>
          </div>
        </div>

        {/* teammates */}
        <div className="flex flex-col gap-3">
          <div className="panel-label">teammates{room ? ` · ${mates.length}` : ""}</div>
          {!room ? (
            <div className="composer-card rounded-xl px-4 py-4 flex items-center gap-4">
              <Icon name="team" size={16} className="text-faint" />
              <span className="flex-1 text-[12.5px] text-dim">Not in a team room. Start one and teammates' sessions, questions and hand-offs appear here.</span>
              <button className="composer-btn h-7 text-[11.5px]" onClick={() => setView("team")}>Start a team room</button>
            </div>
          ) : mates.length === 0 ? (
            <div className="composer-card rounded-xl px-4 py-4 text-[12.5px] text-dim">Room <span className="font-mono text-ink">{room.code}</span> is open — waiting for teammates to join.</div>
          ) : (
            <div className="grid grid-cols-1 @xl:grid-cols-2 @4xl:grid-cols-3 gap-3">
              {mates.map((m) => {
                const p = roomPresence[m.id];
                const online = Date.now() - m.lastSeen < 20_000;
                return (
                  <div key={m.id} className="composer-card rounded-xl px-4 py-3 flex flex-col gap-1.5">
                    <div className="flex items-center gap-2">
                      <span className={`status-dot ${online ? p?.status ?? "idle" : "idle"}`} aria-hidden />
                      <span className="text-[13px] font-medium text-ink flex-1 truncate">{m.name}</span>
                      <span className="text-[11px] text-faint">{online ? p?.status ?? "online" : "offline"}</span>
                    </div>
                    {(mateSessions.get(m.id) ?? []).length ? (
                      <div className="flex flex-col divide-y divide-line/60 -mx-1">
                        {mateSessions.get(m.id)!.map((d) => <MateSessionRow key={d.id} d={d} me={me} meName={meName} />)}
                      </div>
                    ) : (
                      <>
                        <div className="text-[11.5px] text-dim truncate">{p?.task || (online ? "no sessions shared yet" : "last seen a while ago")}</div>
                        {p?.file ? <div className="font-mono text-[11px] text-faint truncate">{p.file}</div> : null}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
