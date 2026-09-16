import { useEffect, useRef, useState } from "react";
import { useApp } from "../../store";
import { pendingReplyTs } from "./logic";
import { advancePhase, roomPost } from "./roomApi";
import { StepShell } from "./TeamFlow";

export function Brainstorm() {
  const room = useApp((s) => s.room);
  const roomRole = useApp((s) => s.roomRole);
  const roomSelf = useApp((s) => s.roomSelf);
  const toast = useApp((s) => s.toast);
  const [draft, setDraft] = useState("");
  const [wrapping, setWrapping] = useState(false);
  const isHost = roomRole === "host";
  const chat = room?.chat ?? [];

  // autoscroll to newest message
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [chat.length]);

  // HOST ONLY: when the newest chat entry is a user msg with no reply pending,
  // generate the facilitator reply and post it as assistant. lastReplied/pending
  // refs guard against double-fires from feed-driven re-renders.
  const lastReplied = useRef(0);
  const replyPending = useRef(false);
  useEffect(() => {
    if (!isHost || !room || !roomSelf || replyPending.current) return;
    const ts = pendingReplyTs(room.chat, lastReplied.current);
    if (ts === null) return;
    replyPending.current = true;
    lastReplied.current = ts;
    (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const reply = await invoke<string>("room_brainstorm_reply", {
          transcriptJson: JSON.stringify(room.chat),
        });
        if (reply.trim()) {
          await roomPost("/room/chat", { text: reply.trim(), role: "assistant" });
        }
      } catch (e) {
        toast(`Brainstorm reply failed: ${e}`, "warn");
        lastReplied.current = 0; // let the next poll retry this message
      } finally {
        replyPending.current = false;
      }
    })();
  }, [isHost, room, roomSelf, toast]);

  const send = async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    const ok = await roomPost("/room/chat", { text });
    if (!ok) setDraft(text); // keep the message on failure
  };

  const wrapUp = async () => {
    if (!room || wrapping) return;
    setWrapping(true);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const plan = await invoke<string>("room_make_plan", {
        transcriptJson: JSON.stringify(room.chat),
      });
      if (!plan.trim()) {
        toast("Plan came back empty — keep brainstorming and try again", "warn");
        return;
      }
      await advancePhase("plan", plan.trim());
    } catch (e) {
      toast(`Plan draft failed: ${e}`, "warn");
    } finally {
      setWrapping(false);
    }
  };

  return (
    <StepShell
      title="brainstorm"
      hint="everyone types; claude facilitates"
      actions={
        isHost ? (
          <button className="btn primary" onClick={wrapUp} disabled={wrapping || chat.length === 0}>
            {wrapping ? "drafting the plan…" : "wrap up → draft the plan"}
          </button>
        ) : (
          <span className="text-[10px] text-faint">the host wraps up when everyone's ready</span>
        )
      }
    >
      <div className="flex-1 min-h-0 overflow-y-auto rounded-md border border-line bg-panel p-3">
        {chat.length === 0 ? (
          <div className="text-[11px] text-faint leading-relaxed">
            What are we building? Throw out ideas — claude joins in and keeps the
            thread moving. The host wraps up when the shape is clear.
          </div>
        ) : (
          chat.map((m, i) => (
            <div key={`${m.ts}-${i}`} className={`mb-2 rounded-sm p-2 ${m.role === "assistant" ? "bg-raised" : ""}`}>
              <div className="flex items-center gap-2 text-[10px]">
                <span className={`font-semibold ${m.role === "assistant" ? "text-dim" : "text-accent"}`}>
                  {m.role === "assistant" ? "claude" : m.name}
                </span>
                <span className="text-faint tabular-nums">
                  {new Date(m.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
              <div className="mt-0.5 text-[11px] leading-relaxed whitespace-pre-wrap select-text">{m.text}</div>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
      <div className="flex gap-2 pt-2 flex-none">
        <input
          className="flex-1 bg-raised border border-line rounded-[5px] px-2.5 py-1.5 text-[12px] outline-none focus:border-accent"
          placeholder="add an idea…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void send();
          }}
        />
        <button className="btn" onClick={() => void send()} disabled={!draft.trim()}>
          send
        </button>
      </div>
    </StepShell>
  );
}
