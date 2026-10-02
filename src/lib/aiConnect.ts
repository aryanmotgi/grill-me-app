// ---------------------------------------------------------------------------
// "Connect your AI" (onboarding), frontend half: the status rows the Rust side
// returns (src-tauri/src/ai_connect.rs) and which AI runs the interview.
// Pure; the UI is in FirstRun.tsx.
// ---------------------------------------------------------------------------

export type AiId = "claude" | "codex" | "cursor" | "gemini";

export interface AiStatus {
  id: AiId;
  name: string;
  installed: boolean;
  /** null = installed but we can't tell */
  signedIn: boolean | null;
  detail: string;
}

/** What runs the interview: one of the AIs, or the no-AI quick form. */
export type InterviewBrain = AiId | "form";

/** Preferred order when several AIs are ready. */
export const AI_ORDER: readonly AiId[] = ["claude", "codex", "cursor", "gemini"];

export function readyAis(rows: AiStatus[]): AiStatus[] {
  return AI_ORDER.map((id) => rows.find((r) => r.id === id)).filter((r): r is AiStatus => !!r && r.installed && r.signedIn === true);
}

/** Keep the user's pick while it's still ready; else the first ready AI; else the form. */
export function pickBrain(rows: AiStatus[], current?: unknown): InterviewBrain {
  const ready = readyAis(rows);
  if (typeof current === "string" && ready.some((r) => r.id === current)) return current as AiId;
  return ready[0]?.id ?? "form";
}

export function interviewBrainOf(v: unknown): InterviewBrain {
  return v === "form" || (AI_ORDER as readonly unknown[]).includes(v) ? (v as InterviewBrain) : "form";
}

/** One short line under each row. */
export function statusLabel(r: AiStatus): string {
  if (!r.installed) return "Not installed";
  if (r.signedIn === true) return "Signed in";
  if (r.signedIn === null) return "Can't tell if you're signed in";
  return "Not signed in";
}
