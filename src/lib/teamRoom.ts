// ---------------------------------------------------------------------------
// The team room this Mac belongs to, saved in settings.json so a restart
// rejoins it. Only relay rooms are saved: a same-Wi-Fi room lives in the
// host's running app and is gone once that app quits.
// ---------------------------------------------------------------------------

import type { RoomState } from "../types";

export interface SavedRoom {
  role: "host" | "guest";
  memberId: string;
  /** "relay:<room>:<secret>" */
  hostAddr: string;
  code: string;
  invite: string;
  /** team setup (lobby → assign) finished; restarts go straight to work */
  setupDone?: boolean;
}

export const isRelayAddr = (addr: string | null | undefined) => !!addr && addr.startsWith("relay:");

export function savedRoomOf(v: unknown): SavedRoom | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  const ok =
    (r.role === "host" || r.role === "guest") &&
    typeof r.memberId === "string" && r.memberId !== "" &&
    typeof r.hostAddr === "string" && isRelayAddr(r.hostAddr) &&
    typeof r.code === "string" && typeof r.invite === "string";
  return ok ? (r as unknown as SavedRoom) : null;
}

/** A placeholder so the feed knows the code before its first poll lands. */
export const seedRoom = (code: string): RoomState => ({
  code,
  phase: "lobby",
  members: [],
  chat: [],
  plan: "",
  tasks: [],
  startedAt: Date.now(),
});
