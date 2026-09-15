import { useState } from "react";
import { useApp } from "../store";

export function Inbox() {
  const { messages, teammates, toggleAnswered, sendMessage } = useApp();
  const [draft, setDraft] = useState("");
  const [to, setTo] = useState<string>("all");

  const name = (id: string) =>
    id === "all" ? "everyone" : teammates.find((t) => t.id === id)?.name ?? id;

  const sorted = [...messages].sort((a, b) => Number(a.answered) - Number(b.answered));

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    // @mention routing: "@mei ..." targets mei regardless of the dropdown
    const mention = text.match(/@([a-z0-9-]+)/i);
    const target = mention && teammates.some((t) => t.id === mention[1]) ? mention[1] : to;
    sendMessage(target, text);
    setDraft("");
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-3">
        <div className="text-[10px] text-faint mb-2 leading-relaxed">
          Notes wait here until the receiving session checks in — nothing interrupts active work.
        </div>
        {sorted.filter((m) => !m.answered).length > 0 ? (
          <div className="panel-label mb-1.5">
            needs reply · {sorted.filter((m) => !m.answered).length}
          </div>
        ) : null}
        {sorted.map((m) => (
          <div key={m.id} className={`rounded-sm p-2.5 mb-1 ${m.answered ? "opacity-45" : "bg-raised"}`}>
            <div className="flex items-center gap-2 text-[10px]">
              <span className="text-accent font-semibold">{name(m.from)}</span>
              <span className="text-faint">→ {name(m.to)}</span>
              <span className="flex-1" />
              <span className="text-faint tabular-nums">{m.ts}</span>
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
            <div className="flex gap-1.5 mt-1.5 demo-hide">
              <button
                className={`btn ${m.answered ? "" : "active"}`}
                onClick={() => toggleAnswered(m.id)}
              >
                {m.answered ? "answered" : "mark answered"}
              </button>
              {!m.answered ? (
                <button className="btn" title="Reply — prefills an @mention"
                  onClick={() => { setTo(m.from === "all" ? "all" : m.from); setDraft(`@${m.from} `); }}>
                  reply
                </button>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      {/* composer + broadcast */}
      <div className="border-t border-line p-2.5 flex-none demo-hide">
        <div className="flex gap-1.5 mb-1.5">
          <select className="btn" value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="all">everyone</option>
            {teammates.filter((t) => t.id !== "aryan").map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          <button className="btn primary ml-auto" onClick={send}>send</button>
        </div>
        <textarea
          className="w-full h-14 bg-raised hairline rounded-sm p-2 text-[11px] resize-none outline-none focus:border-accent"
          placeholder={to === "all" ? "Broadcast to every session's inbox…" : `Ask ${name(to)} — lands at their next check-in…`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
          }}
        />
      </div>
    </div>
  );
}
