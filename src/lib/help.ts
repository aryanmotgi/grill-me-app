import type { Message } from "../types";

// ---------------------------------------------------------------------------
// "Request help" flag. A stuck session flags itself by posting a blocking-kind
// message tagged `help` (from = the flagged member). The flag is DERIVED, never
// stored on the teammate: an OPEN (unanswered) help message means that member
// needs eyes; answering/resolving it clears the flag. Pure so every attention
// surface (home Needs-you hero, TopBar badge, session pane) shares one
// definition and it's unit-testable without a backend.
// ---------------------------------------------------------------------------

/** Is this message a help-request flag (blocking-kind, tagged help)? */
export function isHelpRequest(m: Message): boolean {
  return m.kind === "blocking" && m.help === true;
}

/** Does `memberId` currently have an open (unanswered) help request? */
export function isHelpPending(messages: Message[], memberId: string): boolean {
  return messages.some((m) => isHelpRequest(m) && !m.answered && m.from === memberId);
}

/** Every member id with an open help request (deduped). */
export function helpRequestedIds(messages: Message[]): Set<string> {
  const ids = new Set<string>();
  for (const m of messages) {
    if (isHelpRequest(m) && !m.answered) ids.add(m.from);
  }
  return ids;
}

/** Open help requests, newest-first order preserved from the input. */
export function openHelpRequests(messages: Message[]): Message[] {
  return messages.filter((m) => isHelpRequest(m) && !m.answered);
}
