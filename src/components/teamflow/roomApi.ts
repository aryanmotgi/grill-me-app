/**
 * Thin client for the room HTTP protocol. Every request goes through the
 * Rust `room_client` proxy (contract) so the webview never fetches
 * cross-origin. code + memberId are filled in from the store automatically.
 */

import { useApp } from "../../store";
import type { RoomPhase } from "../../types";

/** POST a room endpoint. Returns true on success; failures toast and return false. */
export async function roomPost(path: string, body: Record<string, unknown>): Promise<boolean> {
  const { room, roomSelf, toast } = useApp.getState();
  if (!room || !roomSelf) return false;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke<string>("room_client", {
      hostAddr: roomSelf.hostAddr,
      path,
      bodyJson: JSON.stringify({ code: room.code, memberId: roomSelf.memberId, ...body }),
    });
    return true;
  } catch (e) {
    toast(`Room request failed (${path}): ${e}`, "warn");
    return false;
  }
}

/** Host-only phase advance; payload per contract (plan text / tasks array). */
export function advancePhase(phase: RoomPhase, payload?: unknown): Promise<boolean> {
  return roomPost("/room/advance", payload === undefined ? { phase } : { phase, payload });
}
