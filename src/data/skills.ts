// ---------------------------------------------------------------------------
// Hackathon skill playbooks for the new-session composer's "+" menu. Each
// attaches ~/.grillme/skills/<id>.md to the session's first message. Grill Me
// seeds starter playbooks there (never overwriting edits), and the grill-me
// MCP server serves the same files as prompts in the Claude app.
// ---------------------------------------------------------------------------

export interface SkillLoader {
  id: string;
  label: string;
  detail: string;
  /** playbook file, relative to ~/.grillme */
  path: string;
}

const P = (id: string) => `skills/${id}.md`;

export const SKILL_LOADERS: SkillLoader[] = [
  { id: "prep", label: "Prep hack", detail: "Before the event: stack, repo, rules", path: P("prep") },
  { id: "intra", label: "Intra-hack", detail: "Keep the team on track mid-build", path: P("intra") },
  { id: "brainstorm", label: "Brainstorm", detail: "Generate and pick an idea", path: P("brainstorm") },
  { id: "breakdown", label: "Breakdown", detail: "Split the idea into tasks", path: P("breakdown") },
  { id: "finalize", label: "Finalize", detail: "Polish, fix, cut scope", path: P("finalize") },
  { id: "pitch", label: "Pitch", detail: "Demo script and slides", path: P("pitch") },
];

/** Read a playbook's markdown (native app only). */
export async function loadSkill(s: SkillLoader): Promise<string> {
  const { homeDir, join } = await import("@tauri-apps/api/path");
  const { readTextFile } = await import("@tauri-apps/plugin-fs");
  return readTextFile(await join(await homeDir(), ".grillme", s.path));
}
