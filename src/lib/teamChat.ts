// ---------------------------------------------------------------------------
// Team chat: pure helpers. Messages live in team-chat.json (id-keyed,
// append-only) which the room syncs once it's live (phase "done"). The I/O
// (sending, @claude replies, system lines) is in components/teamChatActions.
//
// Duplicate-free by construction:
//   - every message has a unique id, so the id merge never doubles one;
//   - @claude is answered ONLY by the sender's Grill Me (needsClaudeReply);
//   - system lines are posted only by the machine that did the thing, and
//     join lines use a deterministic id so a re-post merges into the first.
// ---------------------------------------------------------------------------

import type { SessionStatus, TeamChatMsg, TeamChatSessionCard } from "../types";

/** Messages kept on read (the host also caps at this, by tombstoning). */
export const CHAT_CAP = 500;
export const CHAT_TEXT_CAP = 4000;
/** How many recent messages Claude sees when answering. */
export const CLAUDE_CONTEXT = 30;
/** A member whose heartbeat is older than this reads as offline. */
export const ONLINE_MS = 20_000;

export interface ChatMember {
  id: string;
  name: string;
}

export function newChatId(now = Date.now(), rand = Math.random()): string {
  return `tc-${now.toString(36)}-${Math.floor(rand * 36 ** 4).toString(36).padStart(4, "0")}`;
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** `@claude` anywhere as its own word (not an email, not `@claudette`). */
export function mentionsClaude(text: string): boolean {
  return /(^|[^\w@.])@claude(?![\w-])/i.test(text);
}

/**
 * Who a message mentions: room member ids (by full name with spaces dropped,
 * first name, or id — any case), "claude", and everyone for @all / @team.
 * Unknown handles are ignored. Order of first appearance, no duplicates.
 */
export function parseMentions(text: string, members: ChatMember[]): string[] {
  const out: string[] = [];
  const add = (id: string) => { if (!out.includes(id)) out.push(id); };
  const re = /(^|[^\w@.])@([\w][\w.-]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const handle = squash(m[2].replace(/[.-]+$/, ""));
    if (!handle) continue;
    if (handle === "claude") { add("claude"); continue; }
    if (handle === "all" || handle === "team" || handle === "everyone") {
      for (const mem of members) add(mem.id);
      continue;
    }
    const hit =
      members.find((mem) => squash(mem.name) === handle) ??
      members.find((mem) => squash(mem.id) === handle) ??
      members.find((mem) => squash(mem.name.split(/\s+/)[0] ?? "") === handle);
    if (hit) add(hit.id);
  }
  return out;
}

/** A person's message. Null when there's nothing to send. */
export function makeChatMsg(args: {
  from: string;
  fromName: string;
  text: string;
  members: ChatMember[];
  now: number;
  rand?: number;
  replyTo?: string;
}): TeamChatMsg | null {
  const text = args.text.trim().slice(0, CHAT_TEXT_CAP);
  if (!text) return null;
  const mentions = parseMentions(text, args.members);
  return {
    id: newChatId(args.now, args.rand),
    from: args.from,
    fromName: args.fromName,
    role: "user",
    text,
    ts: args.now,
    ...(args.replyTo ? { replyTo: args.replyTo } : {}),
    ...(mentions.length ? { mentions } : {}),
  };
}

/** A small system line ("Sam joined the room"). `id` makes it idempotent. */
export function systemMsg(args: { from: string; text: string; now: number; id?: string; rand?: number }): TeamChatMsg {
  return { id: args.id ?? newChatId(args.now, args.rand), from: args.from, fromName: "", role: "system", text: args.text.slice(0, 500), ts: args.now };
}

/** Claude's answer, posted by the machine that asked. */
export function claudeReplyMsg(args: { me: string; meName: string; text: string; replyTo: string; now: number; rand?: number }): TeamChatMsg {
  return {
    id: newChatId(args.now, args.rand),
    from: args.me,
    fromName: `Claude (via ${args.meName})`,
    role: "assistant",
    text: args.text.trim().slice(0, CHAT_TEXT_CAP),
    ts: args.now,
    replyTo: args.replyTo,
  };
}

/** Join lines are once per member per room — a re-post merges by id. */
export const joinEventId = (roomCode: string, member: string) => `tc-join-${roomCode}-${member}`;

const ROLES = new Set(["user", "assistant", "system"]);
const STATUSES = new Set<SessionStatus>(["idle", "working", "needs-input"]);

function card(v: unknown): TeamChatSessionCard | undefined {
  if (!v || typeof v !== "object") return undefined;
  const c = v as Record<string, unknown>;
  if (c.kind !== "session" || typeof c.title !== "string") return undefined;
  return {
    kind: "session",
    member: String(c.member ?? ""),
    memberName: String(c.memberName ?? ""),
    session: String(c.session ?? ""),
    title: c.title,
    status: STATUSES.has(c.status as SessionStatus) ? (c.status as SessionStatus) : "idle",
    branch: String(c.branch ?? ""),
    tests: typeof c.tests === "boolean" ? c.tests : null,
    summary: String(c.summary ?? "").slice(0, 300),
  };
}

/**
 * team-chat.json as read from disk → clean messages: malformed entries
 * dropped, duplicates collapsed (last write wins), oldest first, newest
 * CHAT_CAP kept.
 */
export function normalizeChat(raw: unknown): TeamChatMsg[] {
  if (!Array.isArray(raw)) return [];
  const byId = new Map<string, TeamChatMsg>();
  for (const v of raw) {
    if (!v || typeof v !== "object") continue;
    const m = v as Record<string, unknown>;
    if (typeof m.id !== "string" || typeof m.text !== "string" || typeof m.ts !== "number") continue;
    const role = ROLES.has(m.role as string) ? (m.role as TeamChatMsg["role"]) : "user";
    const att = card(m.attach);
    byId.set(m.id, {
      id: m.id,
      from: typeof m.from === "string" ? m.from : "",
      fromName: typeof m.fromName === "string" ? m.fromName : "",
      role,
      text: m.text.slice(0, CHAT_TEXT_CAP),
      ts: m.ts,
      ...(typeof m.replyTo === "string" ? { replyTo: m.replyTo } : {}),
      ...(Array.isArray(m.mentions) ? { mentions: m.mentions.filter((x): x is string => typeof x === "string") } : {}),
      ...(att ? { attach: att } : {}),
    });
  }
  const all = [...byId.values()].sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id));
  return all.length > CHAT_CAP ? all.slice(-CHAT_CAP) : all;
}

/** Messages from anyone but me (people, Claudes, system lines) after `readTs`. */
export function unreadCount(msgs: TeamChatMsg[], me: string, readTs: number): number {
  let n = 0;
  for (const m of msgs) if (m.ts > readTs && (!me || m.from !== me)) n += 1;
  return n;
}

/** Does this message mention me? (@me, @all — never my own message.) */
export function mentionsMe(m: TeamChatMsg, me: string): boolean {
  return !!me && m.from !== me && m.role !== "system" && !!m.mentions?.includes(me);
}

/**
 * Should THIS machine ask Claude about `msg`? Only the sender's Grill Me
 * answers (so a room of five never gets five replies), only for a person's
 * message that says @claude, and only once (no reply to it exists yet).
 */
export function needsClaudeReply(msg: TeamChatMsg, all: TeamChatMsg[], me: string): boolean {
  if (!me || msg.from !== me || msg.role !== "user") return false;
  if (!(msg.mentions?.includes("claude") || mentionsClaude(msg.text))) return false;
  return !all.some((m) => m.role === "assistant" && m.replyTo === msg.id);
}

/** What Claude reads: the last CLAUDE_CONTEXT messages, names + text only. */
export function claudeTranscript(msgs: TeamChatMsg[], n = CLAUDE_CONTEXT): { name: string; role: string; text: string }[] {
  return msgs.slice(-n).map((m) => ({
    name: m.role === "system" ? "(system)" : m.fromName || m.from,
    role: m.role,
    text: m.attach ? `${m.text}\n[shared session] ${cardText(m.attach)}` : m.text,
  }));
}

/** One-line rendering of a session card (also what MCP readers see). */
export function cardText(c: TeamChatSessionCard): string {
  const tests = c.tests === null ? "" : c.tests ? " · tests passing" : " · tests failing";
  const branch = c.branch && c.branch !== "—" ? ` on ${c.branch}` : "";
  return `${c.memberName}'s “${c.title}” — ${c.status}${branch}${tests}${c.summary ? ` — ${c.summary}` : ""}`;
}

/** "Share to team chat": a digest card, never the conversation. */
export function sessionCardMsg(args: { me: string; meName: string; card: TeamChatSessionCard; now: number; rand?: number }): TeamChatMsg {
  return {
    id: newChatId(args.now, args.rand),
    from: args.me,
    fromName: args.meName,
    role: "system",
    text: `${args.meName} shared a session: ${cardText(args.card)}`,
    ts: args.now,
    attach: args.card,
  };
}

/** A task-board title from a chat message: its first line, trimmed. */
export function chatTaskTitle(text: string): string {
  const first = text.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  const clean = first.replace(/(^|\s)@[\w.-]+/g, " ").replace(/\s+/g, " ").trim() || first;
  return clean.length > 120 ? `${clean.slice(0, 117)}…` : clean;
}

export const isOnline = (lastSeen: number, now: number) => now - lastSeen < ONLINE_MS;

/** "now" / "4m" / "2h" / clock — compact time for a message row. */
export function chatTime(ts: number, now: number): string {
  const d = now - ts;
  if (d < 60_000) return "now";
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m`;
  const t = new Date(ts);
  const hm = `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
  return d < 86_400_000 ? hm : `${t.getMonth() + 1}/${t.getDate()} ${hm}`;
}
