import { useState } from "react";
import { useApp } from "../store";
import { TeamChat } from "./TeamChat";
import { TeamPanel } from "./TeamPanel";

// ---------------------------------------------------------------------------
// The Team center view. In a live room the team chat is the main body; the
// usage / snapshot / retro tools (TeamPanel) stay one tab away. Solo or
// pre-setup it's just TeamPanel, as before.
// ---------------------------------------------------------------------------

export function TeamView() {
  const live = useApp((s) => !!(s.room && s.roomSelf && s.room.phase === "done"));
  const [tab, setTab] = useState<"chat" | "tools">("chat");
  if (!live) return <TeamPanel />;
  const tabBtn = (id: "chat" | "tools", label: string) => (
    <button className={`btn ${tab === id ? "active" : ""}`} aria-pressed={tab === id} onClick={() => setTab(id)}>{label}</button>
  );
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex items-center gap-1 px-2 h-9 border-b border-line flex-none">
        {tabBtn("chat", "chat")}
        {tabBtn("tools", "usage & exports")}
      </div>
      {tab === "chat" ? <TeamChat variant="page" /> : <div className="flex-1 min-h-0 flex flex-col overflow-y-auto"><TeamPanel /></div>}
    </div>
  );
}
