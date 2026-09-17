import { useState } from "react";
import { useApp } from "../store";
import type { Message, MessageKind } from "../types";
import { fmtFullTime, fmtRelTime } from "../lib/format";
import { EmptyState } from "./EmptyState";

const KIND_STYLE: Record<MessageKind, { label: string; cls: string; card: string }> = {
  blocking: { label: "BLOCKING", cls: "tag danger", card: "border-l-2 border-l-danger bg-raised" },
  question: { label: "question", cls: "tag warn", card: "border-l-2 border-l-warn bg-raised" },
  proposal: { label: "proposal", cls: "tag ok", card: "border-l-2 border-l-accent bg-raised" },
  fyi: { label: "fyi", cls: "tag", card: "border-l-2 border-l-transparent" },
};

function MessageCard({ m, isRoot }: { m: Message; isRoot: boolean }) {
  const { teammates, members, toggleAnswered, respondProposal, setDraftReply } = useApp();
  const me = members[0]?.id;
  const name = (id: string) =>
    id === "all" ? "everyone" : teammates.find((t) => t.id === id)?.name ?? id;
  const style = KIND_STYLE[m.kind ?? "fyi"];

  return (
    <div className={`rounded-sm p-2.5 ${isRoot ? "" : "ml-5 mt-1"} ${m.answered ? "opacity-45" : style.card}`}>
      <div className="flex items-center gap-2 text-[10px]">
        {m.kind && !m.answered ? <span className={style.cls}>{style.label}</span> : null}
        <span className="text-accent font-semibold">{name(m.from)}</span>
        <span className="text-faint">→ {name(m.to)}</span>
        <span className="flex-1" />
        <span className="text-faint tabular-nums" title={m.epochMs ? fmtFullTime(m.epochMs) : undefined}>
          {m.epochMs ? fmtRelTime(m.epochMs) : m.ts}
        </span>
      </div>
      <div className="mt-1 text-[11px] leading-relaxed">
        {m.text.split(/(@[a-z0-9-]+)/gi).map((part, i) =>
          part.startsWith("@") ? (
            <span key={i} className="text-accent font-semibold">{part}</span>
          ) : (
            part
          ),
        )}
      </div>
      {m.context ? (
        <div className="mt-1 font-mono text-[9px] text-faint truncate" title="Sender's context at send time">
          {m.context.branch} · {m.context.task} · {m.context.file}
        </div>
      ) : null}
      {m.response ? (
        <div className={`mt-1 text-[10px] font-semibold ${m.response === "yes" ? "text-ok" : m.response === "no" ? "text-danger" : "text-warn"}`}>
          responded: {m.response}
        </div>
      ) : null}

      <div className="flex gap-1.5 mt-1.5 demo-hide">
        {m.kind === "proposal" && !m.answered && m.from !== me ? (
          <>
            <button className="btn" onClick={() => respondProposal(m.id, "yes")}>yes</button>
            <button className="btn" onClick={() => respondProposal(m.id, "no")}>no</button>
            <button className="btn" onClick={() => respondProposal(m.id, "unsure")}>unsure</button>
          </>
        ) : (
          <>
            <button className={`btn ${m.answered ? "" : "active"}`} onClick={() => toggleAnswered(m.id)}>
              {m.answered ? "answered" : "mark answered"}
            </button>
            {!m.answered && m.from !== me ? (
              <button className="btn" title="Reply in thread"
                onClick={() => setDraftReply({ to: m.from, threadId: m.threadId ?? m.id, mention: m.from })}>
                reply
              </button>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

export function Inbox() {
  const { messages, teammates, sendMessage, draftReply, setDraftReply } = useApp();
  const [draft, setDraft] = useState("");
  const [to, setTo] = useState<string>("all");
  const [kind, setKind] = useState<MessageKind>("question");

  const name = (id: string) =>
    id === "all" ? "everyone" : teammates.find((t) => t.id === id)?.name ?? id;

  // threads: roots (no threadId) with replies nested beneath
  const roots = messages.filter((m) => !m.threadId);
  const replies = (rootId: string) =>
    messages.filter((m) => m.threadId === rootId).slice().reverse();
  const urgency = (m: Message) =>
    m.answered ? 3 : m.kind === "blocking" ? 0 : m.kind === "question" || m.kind === "proposal" ? 1 : 2;
  const sorted = roots.slice().sort((a, b) => urgency(a) - urgency(b));
  const waiting = messages.filter((m) => !m.answered && (m.kind === "blocking" || m.kind === "question"));

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    const mention = text.match(/@([a-z0-9-]+)/i);
    const target = draftReply
      ? draftReply.to
      : mention && teammates.some((t) => t.id === mention[1]) ? mention[1] : to;
    sendMessage(target, text, kind, draftReply?.threadId);
    setDraft("");
    setDraftReply(null);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-3">
        <div className="text-[10px] text-faint mb-2 leading-relaxed">
          Notes wait here until the receiving session checks in. Blocking and questions
          notify immediately; FYIs batch into a digest.
        </div>
        {waiting.length > 0 ? (
          <div className="panel-label mb-1.5">waiting on reply · {waiting.length}</div>
        ) : null}
        {sorted.length === 0 ? (
          <EmptyState
            icon="mail"
            title="Inbox is empty"
            hint="Questions, proposals, and heads-up notes between sessions land here. Send one below — questions wait for a reply, FYIs digest quietly."
          />
        ) : (
          sorted.map((m) => (
            <div key={m.id} className="mb-2">
              <MessageCard m={m} isRoot />
              {replies(m.id).map((r) => (
                <MessageCard key={r.id} m={r} isRoot={false} />
              ))}
            </div>
          ))
        )}
      </div>

      <div className="border-t border-line p-2.5 flex-none demo-hide">
        {draftReply ? (
          <div className="flex items-center gap-2 mb-1.5 text-[10px] text-dim">
            replying in thread to {name(draftReply.to)}
            <button className="btn" onClick={() => setDraftReply(null)}>cancel</button>
          </div>
        ) : (
          <div className="flex gap-1.5 mb-1.5">
            <select className="btn" value={kind} onChange={(e) => setKind(e.target.value as MessageKind)}
              title="Question: needs a reply · FYI: no reply needed, digested · Blocking: sender is stuck · Proposal: one-click yes/no">
              <option value="question">question</option>
              <option value="fyi">fyi</option>
              <option value="blocking">blocking</option>
              <option value="proposal">proposal</option>
            </select>
            <select className="btn" value={to} onChange={(e) => setTo(e.target.value)}>
              <option value="all">everyone</option>
              {teammates.slice(1).map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            <button className="btn primary ml-auto" onClick={send}>send</button>
          </div>
        )}
        <textarea
          className="w-full h-14 bg-raised hairline rounded-sm p-2 text-[11px] resize-none outline-none focus:border-accent"
          placeholder={
            draftReply ? "Write your reply…"
            : kind === "proposal" ? "Propose a specific action — receiver answers yes/no/unsure with one click…"
            : kind === "blocking" ? "What are you blocked on? Delivers + pings immediately…"
            : kind === "fyi" ? "No reply needed — batches into the receiver's digest…"
            : "Ask a question — lands at their next check-in…"
          }
          value={draftReply ? draft || `@${draftReply.mention} ` : draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
          }}
        />
        {draftReply ? (
          <button className="btn primary mt-1" onClick={send}>send reply</button>
        ) : null}
      </div>
    </div>
  );
}
