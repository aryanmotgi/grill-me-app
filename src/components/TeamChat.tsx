import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { upsertShared, useApp } from "../store";
import { useAutoGrow } from "../hooks/useAutoGrow";
import { useModalA11y } from "../hooks/useModalA11y";
import { isTauri } from "../data/sources/git";
import { chatTaskTitle, chatTime, isOnline } from "../lib/teamChat";
import { teamSessionsByMember } from "../lib/flow";
import { newTeamHandoff } from "../lib/teamBridge";
import { sessionTitle } from "../lib/sessionTitle";
import { ownerForAssignee } from "./teamflow/logic";
import { bridgeSend, useBridge } from "./BridgePanel";
import { chatSelf, markChatRead, postSystemLine, sendTeamChat } from "./teamChatActions";
import { Markdown } from "./Markdown";
import { AgentLogo } from "./AgentLogo";
import { Icon } from "./Icon";
import type { Task, TeamChatMsg, TeamChatSessionCard, Teammate } from "../types";

// ---------------------------------------------------------------------------
// Team Chat: one persistent conversation per live room, for teammates and
// their Claudes. @claude gets an answer from Claude on the SENDER's Mac.
// Every message can become a task, a decision, or a hand-off to a session.
// Narrow-safe: sized by container queries, never the viewport.
// ---------------------------------------------------------------------------

function Presence() {
  const members = useApp((s) => s.room?.members ?? []);
  const me = useApp((s) => s.roomSelf?.memberId);
  const now = Date.now();
  return (
    <div className="flex items-center gap-2.5 min-w-0 overflow-hidden">
      {members.map((m) => {
        const online = isOnline(m.lastSeen, now);
        const status = online ? m.presence?.status ?? "idle" : "idle";
        return (
          <span key={m.id} className="inline-flex items-center gap-1.5 min-w-0 flex-none" title={`${m.name}${m.id === me ? " (you)" : ""} · ${online ? m.presence?.status ?? "online" : "offline"}`}>
            <span className={`status-dot ${status} ${online ? "" : "opacity-40"}`} style={{ width: 7, height: 7 }} aria-hidden />
            <span className={`hidden @md:inline text-[11px] truncate max-w-[90px] ${online ? "text-dim" : "text-faint"}`}>{m.name}</span>
          </span>
        );
      })}
    </div>
  );
}

function SessionCard({ c }: { c: TeamChatSessionCard }) {
  return (
    <div className="composer-card rounded-lg px-3 py-2 flex flex-col gap-0.5 max-w-[460px]">
      <div className="flex items-center gap-2 min-w-0">
        <span className={`status-dot ${c.status} flex-none`} style={{ width: 7, height: 7 }} aria-hidden />
        <span className="text-[12px] font-medium text-ink truncate">{c.title}</span>
        <span className="text-[11px] text-faint flex-none">{c.memberName}</span>
        <span className="flex-1" />
        {c.tests === null ? null : <span className={`text-[11px] flex-none ${c.tests ? "text-ok" : "text-danger"}`}>{c.tests ? "tests ✓" : "tests ✗"}</span>}
      </div>
      {c.summary ? <div className="text-[11.5px] text-dim leading-snug">{c.summary}</div> : null}
      {c.branch && c.branch !== "—" ? <div className="font-mono text-[11px] text-faint truncate">{c.branch}</div> : null}
    </div>
  );
}

/** Owner picker for "Make a task". */
function OwnerMenu({ onPick, onClose }: { onPick: (memberId: string) => void; onClose: () => void }) {
  const members = useApp((s) => s.room?.members ?? []);
  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div data-overlay className="composer-menu absolute right-0 top-7 z-40 w-[200px] rounded-lg p-1 rise" role="menu">
        <div className="panel-label px-2 pt-1 pb-1.5">task owner</div>
        {members.map((m) => (
          <button key={m.id} role="menuitem" className="w-full text-left px-2 py-1.5 rounded-md text-[12px] text-dim hover:text-ink hover:bg-raised cursor-pointer truncate"
            onClick={() => onPick(m.id)}>{m.name}</button>
        ))}
      </div>
    </>
  );
}

type Target =
  | { kind: "own"; id: string; title: string }
  | { kind: "mate"; member: string; memberName: string; session: string; title: string };

/** "Hand to a session": your own sessions, or a teammate's (they approve). */
function HandoffDialog({ text, onClose }: { text: string; onClose: () => void }) {
  const a11y = useModalA11y("Hand a chat message to a session", true);
  const teammates = useApp((s) => s.teammates);
  const members = useApp((s) => s.members);
  const titles = useApp((s) => s.appSettings.sessionTitles);
  const teamSessions = useApp((s) => s.teamSessions);
  const toast = useApp((s) => s.toast);
  const { me, meName } = chatSelf();
  const [message, setMessage] = useState(text);
  const [target, setTarget] = useState<Target | null>(null);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  useAutoGrow(box, message);

  // real members once config is loaded; the sample teammates in browser dev (as Flow does)
  const own: Teammate[] = members.length ? members.map((m) => teammates.find((t) => t.id === m.id)).filter((t): t is Teammate => !!t) : teammates;
  const mates = useMemo(() => [...teamSessionsByMember(teamSessions, Date.now()).entries()].filter(([id]) => id !== me), [teamSessions, me]);

  const send = async () => {
    const body = message.trim();
    if (!target || !body) return;
    setBusy(true);
    try {
      if (target.kind === "mate") {
        await upsertShared("team-bridge.json", [newTeamHandoff({ me, meName, to: target.member, toName: target.memberName, session: target.session, sessionTitle: target.title, message: body, now: Date.now() })]);
        await postSystemLine(`${meName} handed a task to ${target.memberName}'s “${target.title}”`);
        toast(`Sent to ${target.memberName} — they approve it before it reaches ${target.title}`);
      } else {
        if (!isTauri()) { toast("Handing to a session needs the native app", "warn"); return; }
        const { invoke } = await import("@tauri-apps/api/core");
        const id = `h-chat-${Date.now().toString(36)}`;
        // lands as a pending local hand-off (shows in Flow), then goes straight in — this dialog was the OK
        await invoke("bridge_import", { item: { id, kind: "handoff", session: target.id, sessionTitle: target.title, message: body, fromName: "Team chat" } });
        await bridgeSend({ id, ts: Date.now(), status: "pending", kind: "handoff", session: target.id, sessionTitle: target.title, message: body, userExplanation: "" });
      }
      onClose();
    } catch (e) {
      toast(`Hand-off failed: ${e}`, "warn");
    } finally {
      setBusy(false);
    }
  };

  const row = (t: Target, label: string, sub: string, status: string) => {
    const on = target && JSON.stringify(target) === JSON.stringify(t);
    return (
      <button key={label + sub} className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left cursor-pointer ${on ? "bg-raised text-ink" : "text-dim hover:text-ink hover:bg-raised/60"}`}
        onClick={() => setTarget(t)}>
        <span className={`status-dot ${status} flex-none`} style={{ width: 7, height: 7 }} aria-hidden />
        <span className="text-[12px] truncate flex-1">{label}</span>
        <span className="text-[11px] text-faint truncate">{sub}</span>
      </button>
    );
  };

  return (
    <div className="fixed inset-0 z-40 scrim flex items-start justify-center pt-[10vh] px-4" onClick={onClose}>
      <div {...a11y} className="w-[520px] max-w-full max-h-[80vh] flex flex-col glass rounded-md shadow-2xl rise p-5 outline-none gap-3"
        onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}>
        <div className="flex items-baseline gap-3">
          <span className="font-display font-semibold text-[15px]">Hand to a session</span>
          <button className="btn ml-auto" onClick={onClose}>close</button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2">
          <div className="panel-label">your sessions</div>
          {own.length ? own.map((t) => row({ kind: "own", id: t.id, title: sessionTitle(t, titles) }, sessionTitle(t, titles), t.branch, t.status))
            : <span className="text-[11.5px] text-faint px-2.5">No sessions in this project.</span>}
          {mates.map(([id, list]) => (
            <div key={id} className="flex flex-col gap-0.5">
              <div className="panel-label mt-2">{list[0]?.memberName ?? id} · approves on their side</div>
              {list.map((d) => row({ kind: "mate", member: d.member, memberName: d.memberName, session: d.session, title: d.title }, d.title, d.branch, d.status))}
            </div>
          ))}
        </div>
        <textarea ref={box} rows={3} value={message} maxLength={4000} onChange={(e) => setMessage(e.target.value)}
          className="w-full bg-raised/60 hairline rounded-md px-2.5 py-2 text-[12px] text-ink outline-none resize-none max-h-[180px] overflow-y-auto" />
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-faint flex-1 min-w-0 truncate">
            {target?.kind === "mate" ? `${target.memberName} approves it before it's typed in` : target ? "Typed in when the session is at a prompt" : "Pick a session"}
          </span>
          <button className="btn primary" disabled={!target || !message.trim() || busy} onClick={() => void send()}>
            {busy ? <span className="spinner" /> : null} Send{target ? ` to ${target.title}` : ""}
          </button>
        </div>
      </div>
    </div>
  );
}

function MessageRow({ m, head, onHandoff }: { m: TeamChatMsg; head: boolean; onHandoff: (text: string) => void }) {
  const me = useApp((s) => s.roomSelf?.memberId);
  const addDecision = useApp((s) => s.addDecision);
  const toast = useApp((s) => s.toast);
  const [ownerOpen, setOwnerOpen] = useState(false);
  const now = Date.now();
  const text = m.text;

  const makeTask = async (assignee: string) => {
    setOwnerOpen(false);
    const st = useApp.getState();
    const owner = ownerForAssignee(assignee, st.room?.members ?? [], st.members);
    const task: Task = { id: `chat-${m.id}`, title: chatTaskTitle(text), desc: text, owner, status: "not-started", files: [] };
    useApp.setState((s) => ({ tasks: [...s.tasks.filter((t) => t.id !== task.id), task] }));
    await upsertShared("tasks.json", [task]);
    toast(`Task added for ${st.room?.members.find((x) => x.id === assignee)?.name ?? owner}: “${task.title}”`);
  };

  if (m.role === "system" && !m.attach) {
    return (
      <div className="flex items-center gap-2 py-1 text-[11px] text-faint">
        <span className="flex-1 h-px bg-line/60" />
        <span className="truncate max-w-[80%]">{m.text}</span>
        <span className="text-data num flex-none">{chatTime(m.ts, now)}</span>
        <span className="flex-1 h-px bg-line/60" />
      </div>
    );
  }

  const claude = m.role === "assistant";
  const mine = m.from === me && m.role === "user";
  return (
    <div className={`group/msg relative flex gap-2.5 rounded-md px-2 -mx-2 ${head ? "pt-2" : "pt-0.5"} pb-0.5 hover:bg-raised/30`}>
      <span className="w-5 flex-none flex justify-center pt-0.5">
        {head ? (claude ? <AgentLogo agent="claude" size={14} /> : <span className={`text-[10px] font-semibold uppercase ${mine ? "text-ink" : "text-dim"}`}>{(m.fromName || "?").slice(0, 2)}</span>) : null}
      </span>
      <div className="min-w-0 flex-1">
        {head ? (
          <div className="flex items-baseline gap-2">
            <span className={`text-[12px] font-semibold truncate ${claude ? "text-ink" : mine ? "text-ink" : "text-dim"}`}>{m.fromName || m.from}</span>
            <span className="text-[10.5px] text-data num flex-none">{chatTime(m.ts, now)}</span>
          </div>
        ) : null}
        {m.attach ? (
          <div className="mt-1 flex flex-col gap-1">
            <span className="text-[11px] text-faint">shared a session</span>
            <SessionCard c={m.attach} />
          </div>
        ) : (
          <div className="text-[12.5px] text-ink leading-relaxed select-text break-words [&_p]:my-0.5"><Markdown text={m.text} /></div>
        )}
      </div>
      {/* hover actions */}
      <div className="absolute right-1 -top-2 hidden group-hover/msg:flex group-focus-within/msg:flex items-center gap-0.5 composer-menu rounded-md p-0.5 z-10">
        <div className="relative">
          <button className="w-6 h-6 rounded flex items-center justify-center text-dim hover:text-ink hover:bg-raised cursor-pointer" title="Make a task"
            aria-label="Make a task" onClick={() => setOwnerOpen(true)}><Icon name="check" size={12} /></button>
          {ownerOpen ? <OwnerMenu onPick={(id) => void makeTask(id)} onClose={() => setOwnerOpen(false)} /> : null}
        </div>
        <button className="w-6 h-6 rounded flex items-center justify-center text-dim hover:text-ink hover:bg-raised cursor-pointer" title="Save as decision"
          aria-label="Save as decision" onClick={() => addDecision(text.slice(0, 500), "chat")}><Icon name="note" size={12} /></button>
        <button className="w-6 h-6 rounded flex items-center justify-center text-dim hover:text-ink hover:bg-raised cursor-pointer" title="Hand to a session"
          aria-label="Hand to a session" onClick={() => onHandoff(text)}><Icon name="push" size={12} /></button>
      </div>
    </div>
  );
}

/** The chat itself. `variant="page"` fills the Team view; "embed" sits in Flow. */
export function TeamChat({ variant = "page" }: { variant?: "page" | "embed" }) {
  const room = useApp((s) => s.room);
  const msgs = useApp((s) => s.teamChat);
  const typing = useApp((s) => s.teamChatTyping);
  const setView = useApp((s) => s.setView);
  const goal = useBridge((b) => b.state.goal);
  const { live } = chatSelf(useApp.getState());
  const [draft, setDraft] = useState("");
  const [handoff, setHandoff] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useAutoGrow(box, draft);

  // follow new messages while the reader is at the bottom (or just sent one)
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [msgs.length, typing]);
  // seeing it is reading it
  useEffect(() => { if (live) markChatRead(); }, [msgs, live]);

  const send = async () => {
    const text = draft;
    if (!text.trim()) return;
    stick.current = true;
    setDraft("");
    const ok = await sendTeamChat(text);
    if (!ok) setDraft(text);
  };

  if (!room || room.phase !== "done") {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 p-6 text-center">
        <Icon name="team" size={18} className="text-faint" />
        <p className="text-[12.5px] text-dim">Team chat opens once a team room is set up.</p>
        <button className="btn" onClick={() => setView("flow")}>Open Flow</button>
      </div>
    );
  }

  return (
    <div className={`@container flex flex-col min-h-0 ${variant === "page" ? "flex-1" : "h-[460px] composer-card rounded-xl"}`}>
      {/* header: pinned goal + presence */}
      <div className="flex items-center gap-3 px-3 py-2 border-b border-line flex-none min-w-0">
        <Icon name="note" size={12} className="text-faint flex-none" />
        <span className={`text-[12px] truncate flex-1 min-w-0 ${goal ? "text-ink" : "text-faint"}`} title={goal || undefined}>
          {goal || "No team goal yet — set one on the Brain page"}
        </span>
        <Presence />
      </div>

      <div ref={scroller} className="flex-1 min-h-0 overflow-y-auto"
        onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }}>
        <div className="px-3 @lg:px-4 py-3 flex flex-col">
          {msgs.length === 0 ? (
            <div className="py-10 flex flex-col items-center gap-2 text-center">
              <span className="text-[12.5px] text-dim">No messages yet.</span>
              <span className="text-[11.5px] text-faint max-w-[360px]">Say what you're on, @name a teammate, or ask @claude — it sees the goal, open tasks and everyone's sessions.</span>
            </div>
          ) : msgs.map((m, i) => {
            const prev = msgs[i - 1];
            const head = !prev || prev.from !== m.from || prev.role !== m.role || prev.role === "system" || m.ts - prev.ts > 5 * 60_000;
            return <MessageRow key={m.id} m={m} head={head} onHandoff={setHandoff} />;
          })}
          {typing ? (
            <div className="flex items-center gap-2 pt-2 text-[11.5px] text-faint">
              <AgentLogo agent="claude" size={13} /> <span className="spinner" /> Claude is thinking…
            </div>
          ) : null}
        </div>
      </div>

      <div className="px-3 pb-3 pt-1 flex-none">
        <div className="composer-card rounded-xl flex items-end gap-2 pr-2">
          <textarea
            ref={box}
            rows={1}
            value={draft}
            maxLength={4000}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }}
            placeholder="Message the team — @claude asks Claude, @name pings someone"
            aria-label="Team chat message"
            className="block flex-1 min-w-0 resize-none bg-transparent outline-none px-3 py-2.5 text-[12.5px] text-ink placeholder:text-faint max-h-[160px] overflow-y-auto"
          />
          <button className="w-7 h-7 mb-1.5 rounded-lg flex items-center justify-center cursor-pointer bg-raised text-dim disabled:opacity-40 data-[ready=true]:bg-ink data-[ready=true]:text-bg flex-none"
            data-ready={!!draft.trim()} disabled={!draft.trim()} title="Send (↵) · ⇧↵ new line" aria-label="Send" onClick={() => void send()}>
            <Icon name="up" size={13} />
          </button>
        </div>
      </div>
      {handoff !== null ? <HandoffDialog text={handoff} onClose={() => setHandoff(null)} /> : null}
    </div>
  );
}
