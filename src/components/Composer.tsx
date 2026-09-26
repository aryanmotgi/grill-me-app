import { useRef, useState } from "react";
import { useApp, ptyIdFor } from "../store";
import { isTauri } from "../data/sources/git";
import { Icon } from "./Icon";

// ---------------------------------------------------------------------------
// Monocode-style composer under the terminal: type a prompt in a clean input
// and Enter (or the send button) writes it into the agent session's pty. The
// chip row grounds you: workspace ⎇ branch, which agent CLI is running, and
// the permission mode. The terminal above stays the live output surface.
// ---------------------------------------------------------------------------

const AGENT_LABEL: Record<string, string> = { claude: "Claude Code", cursor: "Cursor", codex: "Codex" };

export function Composer({ mateId }: { mateId: string }) {
  const members = useApp((s) => s.members);
  const teammates = useApp((s) => s.teammates);
  const toast = useApp((s) => s.toast);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const member = members.find((m) => m.id === mateId);
  const mate = teammates.find((t) => t.id === mateId);
  if (!member || !isTauri()) return null;
  const viewOnly = mate?.permission === "view";

  const send = async () => {
    const text = draft.trim();
    if (!text || sending || viewOnly) return;
    setSending(true);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("pty_write", { id: ptyIdFor(mateId), data: text + "\n" });
      setDraft("");
    } catch (e) {
      toast(`Send failed: ${e}`, "warn");
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  return (
    <div className="flex-none border-t border-line bg-panel px-3 py-2 flex flex-col gap-1.5">
      <input
        ref={inputRef}
        className="w-full bg-raised hairline rounded-md px-3 py-2 text-[12px] outline-none focus:border-accent placeholder:text-faint"
        placeholder={viewOnly ? "view-only session" : "Ask, build, or paste an error — Enter sends to the agent…"}
        value={draft}
        disabled={viewOnly || sending}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); send(); } }}
      />
      <div className="flex items-center gap-1.5">
        <span className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-raised text-[10px] text-dim font-mono"
          title={member.repoPath}>
          <Icon name="folder" size={10} /> {member.repoPath.split("/").pop()}
          <Icon name="branch" size={10} /> {mate?.branch ?? "main"}
        </span>
        <span className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-raised text-[10px] text-dim"
          title="Which agent CLI runs in this session (chosen at session creation)">
          <Icon name="spark" size={10} /> {AGENT_LABEL[member.agent ?? "claude"]}
        </span>
        <span className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-raised text-[10px] text-dim"
          title="Sessions run with permission prompts bypassed; the audit blocklist still applies">
          <Icon name="lock" size={10} /> bypass on
        </span>
        <span className="flex-1" />
        <button
          className="flex items-center gap-1 px-3 py-1 rounded-md bg-accent text-accent-ink text-[11px] font-semibold cursor-pointer hover:brightness-110 disabled:opacity-40"
          disabled={!draft.trim() || viewOnly || sending}
          title="Send to the agent (Enter)"
          onClick={send}
        >
          send ↵
        </button>
      </div>
    </div>
  );
}
