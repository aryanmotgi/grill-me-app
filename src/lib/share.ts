import type { TeamSession } from "../types";

// ---------------------------------------------------------------------------
// What teammates are allowed to see of your sessions, and whether they may
// type into them.
//
// Enforced where the data is built, not where it is displayed: digestSessions
// is the one place this Mac turns its sessions into something the room can
// read, so anything the policy withholds is never published at all. Hiding it
// in the UI of whoever receives it would not be privacy — it would be a
// request.
//
// Only "what they can see" is here. A matching "what they can do" would be
// theatre today: nothing in the room can send input to another Mac's session,
// so the only way someone types into yours is ssh, which your ssh keys govern
// and Grill Me does not. When a control path exists, it gets a setting here.
// ---------------------------------------------------------------------------

/** Rising order: each level publishes everything the one before it does. */
export const SEE_LEVELS = ["nothing", "status", "work", "files"] as const;
export type SeeLevel = (typeof SEE_LEVELS)[number];

export interface SharePolicy {
  see: SeeLevel;
}

/** What Grill Me has always done, so nobody's setup changes under them. */
export const DEFAULT_POLICY: SharePolicy = { see: "files" };

export const SEE_COPY: Record<SeeLevel, { label: string; detail: string }> = {
  nothing: { label: "Nothing", detail: "You don't appear in the team at all." },
  status: { label: "That I'm working", detail: "A dot next to your name. Not what you're working on." },
  work: { label: "What I'm working on", detail: "Session titles, branch, and the one-line summary — which can name a file it is editing." },
  files: { label: "And the list of files I changed", detail: "Lets teammates spot overlap before it becomes a conflict." },
};

export function policyOf(settings: Record<string, unknown> | undefined): SharePolicy {
  const raw = settings?.sharePolicy as Partial<SharePolicy> | undefined;
  return { see: SEE_LEVELS.includes(raw?.see as SeeLevel) ? (raw!.see as SeeLevel) : DEFAULT_POLICY.see };
}

const RANK: Record<SeeLevel, number> = { nothing: 0, status: 1, work: 2, files: 3 };

/** True when `level` is published under this policy. */
export function shows(policy: SharePolicy, level: Exclude<SeeLevel, "nothing">): boolean {
  return RANK[policy.see] >= RANK[level];
}

/** Strip a published session down to what the policy allows.
 *
 *  One honest limit: at "work" the summary is kept, and a summary like
 *  "editing relay.rs" names a file. Dropping it would leave "work" saying
 *  almost nothing that "status" doesn't, so the level is about the file *list*
 *  — the part teammates query for overlap — and the label says so. Choose
 *  "status" if no filename should ever leave this Mac. */
export function applyPolicy(policy: SharePolicy, rows: TeamSession[]): TeamSession[] {
  if (policy.see === "nothing") return [];
  if (policy.see === "files") return rows;
  return rows.map((d) => ({
    ...d,
    ...(shows(policy, "work") ? {} : { title: "Working", sentence: "", branch: "", tests: null }),
    files: [],
  }));
}
