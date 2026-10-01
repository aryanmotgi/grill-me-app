import { useEffect } from "react";
import { upsertShared, useApp } from "../store";
import { isTauri } from "../data/sources/git";
import {
  claudeReplyMsg, claudeTranscript, joinEventId, makeChatMsg, needsClaudeReply, normalizeChat, sessionCardMsg, systemMsg,
  unreadCount,
} from "../lib/teamChat";
import type { TeamChatMsg, TeamChatSessionCard } from "../types";

// ---------------------------------------------------------------------------
// Team chat I/O. Sending = upsertShared("team-chat.json", [msg]) — local file
// first, then the room (the feed heals anything a dropped request missed).
// The pure rules (who answers @claude, ids, caps) live in lib/teamChat.
// ---------------------------------------------------------------------------

/** Who I am in the room, and is it live (past onboarding)? */
export function chatSelf(st = useApp.getState()) {
  const me = st.roomSelf?.memberId ?? "";
  const meName = st.room?.members.find((m) => m.id === me)?.name ?? (me || "you");
  return { me, meName, live: !!(me && st.room && st.room.phase === "done") };
}

/** Read mark for the open project (settings.json `teamChatRead[project]`). */
export function chatReadTs(st = useApp.getState()): number {
  const map = st.appSettings.teamChatRead as Record<string, number> | undefined;
  return Number(map?.[st.activeProject || "default"]) || 0;
}

/** Selector: unread team chat messages (0 unless the room is live). */
export function useChatUnread(): number {
  return useApp((st) => {
    const { me, live } = chatSelf(st);
    return live ? unreadCount(st.teamChat, me, chatReadTs(st)) : 0;
  });
}

export function markChatRead() {
  const st = useApp.getState();
  const last = st.teamChat[st.teamChat.length - 1]?.ts ?? 0;
  if (last <= chatReadTs(st)) return;
  const map = { ...((st.appSettings.teamChatRead as Record<string, number> | undefined) ?? {}) };
  map[st.activeProject || "default"] = last;
  st.setAppSetting("teamChatRead", map);
}

/** Show right away, then persist + sync (normalizeChat dedupes by id). */
async function postChat(msgs: TeamChatMsg[]) {
  useApp.setState((s) => ({ teamChat: normalizeChat([...s.teamChat, ...msgs]) }));
  await upsertShared("team-chat.json", msgs);
}

export async function sendTeamChat(text: string): Promise<boolean> {
  const st = useApp.getState();
  const { me, meName, live } = chatSelf(st);
  if (!live) {
    st.toast("Team chat needs a live team room", "warn");
    return false;
  }
  const members = st.room?.members.map((m) => ({ id: m.id, name: m.name })) ?? [];
  const msg = makeChatMsg({ from: me, fromName: meName, text, members, now: Date.now() });
  if (!msg) return false;
  await postChat([msg]);
  // only the sender's machine answers @claude — teammates' Grill Mes never do
  if (needsClaudeReply(msg, useApp.getState().teamChat, me)) void askClaude(msg);
  return true;
}

let asking = 0;
async function askClaude(msg: TeamChatMsg) {
  asking += 1;
  useApp.setState({ teamChatTyping: true });
  try {
    let text: string;
    if (!isTauri()) {
      await new Promise((r) => setTimeout(r, 900));
      text = "*Browser preview.* In the app, Claude answers here from the team goal, decisions, open tasks, every teammate's session digest and the last 30 messages.";
    } else {
      const { invoke } = await import("@tauri-apps/api/core");
      const transcript = claudeTranscript(useApp.getState().teamChat);
      text = await invoke<string>("team_chat_reply", { transcriptJson: JSON.stringify(transcript) });
    }
    const { me, meName } = chatSelf();
    await postChat([claudeReplyMsg({ me, meName, text, replyTo: msg.id, now: Date.now() })]);
  } catch (e) {
    useApp.getState().toast(`Claude couldn't answer in team chat: ${e}`, "warn");
  } finally {
    asking -= 1;
    if (asking === 0) useApp.setState({ teamChatTyping: false });
  }
}

/** A small system line, posted only by the machine that did the thing. */
export async function postSystemLine(text: string, id?: string) {
  const { me, live } = chatSelf();
  if (!live) return;
  await postChat([systemMsg({ from: me, text, now: Date.now(), id })]);
}

export async function postLeaveLine() {
  const { meName, live } = chatSelf();
  if (live) await postSystemLine(`${meName} left the room`);
}

export async function shareSessionToChat(card: Omit<TeamChatSessionCard, "kind" | "member" | "memberName">) {
  const st = useApp.getState();
  const { me, meName, live } = chatSelf(st);
  if (!live) {
    st.toast("Sharing to team chat needs a live team room", "warn");
    return;
  }
  await postChat([sessionCardMsg({ me, meName, card: { kind: "session", member: me, memberName: meName, ...card }, now: Date.now() })]);
  st.toast(`Shared “${card.title}” to team chat`);
}

/**
 * Mount once (App). In a live room it (a) mirrors my room identity into
 * settings.json so the MCP server can post as "Claude (via me)" and count
 * unread, and (b) posts "<me> joined the room" when this machine arrives in
 * an ALREADY-live room (a late join or rejoin) — once per member per room
 * (deterministic id), never during the setup flow everyone goes through.
 */
export function useTeamChatFeed() {
  useEffect(() => {
    const firstPhase = new Map<string, string>();
    const joinTimers = new Set<ReturnType<typeof setTimeout>>();
    const check = () => {
      const st = useApp.getState();
      const code = st.room?.code;
      const { me, meName, live } = chatSelf(st);
      if (!code || !me) return;
      if (!firstPhase.has(code)) {
        firstPhase.set(code, st.room!.phase);
        if (st.room!.phase === "done" && isTauri()) {
          // wait for the chat to load first so a rejoin never re-posts (and re-times) the line
          const t = setTimeout(() => {
            joinTimers.delete(t);
            const id = joinEventId(code, me);
            if (chatSelf().live && !useApp.getState().teamChat.some((m) => m.id === id)) void postSystemLine(`${meName} joined the room`, id);
          }, 6000);
          joinTimers.add(t);
        }
      }
      if (live && isTauri()) {
        const cur = st.appSettings.teamChatMe as { id?: string; name?: string } | undefined;
        if (cur?.id !== me || cur?.name !== meName) st.setAppSetting("teamChatMe", { id: me, name: meName });
      }
    };
    check();
    const unsub = useApp.subscribe((s, prev) => { if (s.room !== prev.room || s.roomSelf !== prev.roomSelf) check(); });
    return () => { unsub(); for (const t of joinTimers) clearTimeout(t); };
  }, []);
}
