// ---------------------------------------------------------------------------
// Hackathon skill loaders for the new-session composer's "+" menu. Each one
// will attach a SKILL.md brief (stage-specific instructions) to the first
// message of a session. The .md files aren't written yet — `path: null`
// marks a placeholder, which the menu shows as "soon" and never sends.
// ---------------------------------------------------------------------------

export interface SkillLoader {
  id: string;
  label: string;
  detail: string;
  /** repo-relative SKILL.md this loader attaches; null = placeholder */
  path: string | null;
}

export const SKILL_LOADERS: SkillLoader[] = [
  { id: "prep", label: "Prep hack", detail: "Before the event: stack, repo, rules", path: null },
  { id: "intra", label: "Intra-hack", detail: "Keep the team on track mid-build", path: null },
  { id: "brainstorm", label: "Brainstorm", detail: "Generate and pick an idea", path: null },
  { id: "breakdown", label: "Breakdown", detail: "Split the idea into tasks", path: null },
  { id: "finalize", label: "Finalize", detail: "Polish, fix, cut scope", path: null },
  { id: "pitch", label: "Pitch", detail: "Demo script and slides", path: null },
];
