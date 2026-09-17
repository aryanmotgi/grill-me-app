// ---------------------------------------------------------------------------
// Self presence: the user's own "am I reachable" state, distinct from a
// session's derived working/idle status. Persisted in appSettings.presence and
// shown on the user's own session row. Pure so the picker + indicator stay
// dumb and this stays testable.
// ---------------------------------------------------------------------------

export type Presence = "available" | "heads-down" | "away";

/** Cycle order for the click-to-toggle control. */
export const PRESENCE_ORDER: Presence[] = ["available", "heads-down", "away"];

export const PRESENCE_LABEL: Record<Presence, string> = {
  available: "available",
  "heads-down": "heads-down",
  away: "away",
};

/** One-line explanation surfaced as the control's tooltip. */
export const PRESENCE_HINT: Record<Presence, string> = {
  available: "Available — open to pings and interruptions",
  "heads-down": "Heads-down — focused; ping only if it's blocking",
  away: "Away — not at the keyboard",
};

/**
 * Which text token colours the indicator. Amber stays action-only, so presence
 * (a readout) never uses accent: available reads as success, heads-down as data
 * (cyan), away as faint.
 */
export const PRESENCE_TONE: Record<Presence, string> = {
  available: "text-ok",
  "heads-down": "text-data",
  away: "text-faint",
};

/** Coerce an arbitrary stored value into a valid Presence (defaults available). */
export function normalizePresence(v: unknown): Presence {
  return v === "heads-down" || v === "away" ? v : "available";
}

/** Next presence in the cycle — used by the click-to-toggle control. */
export function nextPresence(p: Presence): Presence {
  const i = PRESENCE_ORDER.indexOf(p);
  return PRESENCE_ORDER[(i + 1) % PRESENCE_ORDER.length];
}
