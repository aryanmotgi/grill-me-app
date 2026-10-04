// ---------------------------------------------------------------------------
// Sessions are named after what you asked them ("Add seasons to the farm"),
// not their git branch. When Claude reports a prompt and the session has no
// name yet, its first real message in the transcript becomes the name. Your
// own rename always wins: a session that already has a name is left alone.
// ---------------------------------------------------------------------------

import { useApp } from "../store";
import { parseTranscript } from "./chat";
import { isNeutral } from "./goalWatch";
import { titleFromAsk } from "./sessionTitle";

const asked = new Set<string>();

/** The name for a session from its transcript lines, or "" when nothing fits. */
export function titleFromTranscript(lines: string[]): string {
  const first = parseTranscript(lines).find((i) => i.kind === "user" && !isNeutral(i.text));
  return first && first.kind === "user" ? titleFromAsk(first.text) : "";
}

/** `retry`: a new prompt just came in, so look again even if we found
 *  nothing before. Otherwise each session is looked at once per launch. */
export async function ensureTitle(memberId: string, repoPath: string, retry = false) {
  const titles = (useApp.getState().appSettings.sessionTitles ?? {}) as Record<string, string>;
  if (titles[memberId] || (asked.has(memberId) && !retry)) return;
  asked.add(memberId);
  const { invoke } = await import("@tauri-apps/api/core");
  const lines = await invoke<string[]>("transcript_recent", { repoPath }).catch(() => [] as string[]);
  const title = titleFromTranscript(lines);
  if (!title) return;
  const now = (useApp.getState().appSettings.sessionTitles ?? {}) as Record<string, string>;
  if (now[memberId]) return;
  useApp.getState().setAppSetting("sessionTitles", { ...now, [memberId]: title });
}
