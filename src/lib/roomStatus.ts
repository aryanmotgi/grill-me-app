// Pure derivation of a room member's connection status from their lastSeen
// heartbeat timestamp. Members are never removed on disconnect — the contract
// says status is DERIVED client-side: <6s joined, 6-15s connecting, >15s
// disconnected. Kept pure (no Date.now() inside) so it is trivially testable.

export type RoomMemberStatus = "joined" | "connecting" | "disconnected";

/** A heartbeat younger than this means the member is joined/online. */
export const JOINED_MAX_MS = 6_000;
/** Between JOINED_MAX_MS and this (inclusive) the member is "connecting". */
export const CONNECTING_MAX_MS = 15_000;

export function memberStatus(lastSeenMs: number, nowMs: number): RoomMemberStatus {
  const age = nowMs - lastSeenMs;
  // negative age = minor clock skew between host and client — treat as fresh
  if (age < JOINED_MAX_MS) return "joined";
  if (age <= CONNECTING_MAX_MS) return "connecting";
  return "disconnected";
}

/**
 * Map a room member status onto the app's status-dot language (DESIGN.md):
 * green working = online, amber pulsing = in-between/attention, hollow = gone.
 */
export function statusDotClass(status: RoomMemberStatus): "working" | "needs-input" | "idle" {
  switch (status) {
    case "joined":
      return "working";
    case "connecting":
      return "needs-input";
    case "disconnected":
      return "idle";
  }
}

/** Human label shown next to the dot. */
export function statusLabel(status: RoomMemberStatus): string {
  switch (status) {
    case "joined":
      return "joined";
    case "connecting":
      return "connecting…";
    case "disconnected":
      return "disconnected";
  }
}
