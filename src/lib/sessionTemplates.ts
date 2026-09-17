// ---------------------------------------------------------------------------
// Session templates — a saved recipe for spawning a session: a display name, a
// branch prefix, and a starting prompt briefed into the fresh session once it
// reaches an idle claude prompt. Pure + framework-free so the template shape,
// branch derivation, and settings (de)serialization are unit-testable without a
// Tauri backend or a rendered overlay. The store owns the actual spawn (reusing
// spawnSession) + brief delivery; this module only shapes the data.
// ---------------------------------------------------------------------------

export interface SessionTemplate {
  /** Human label shown in the picker, e.g. "bugfix: reproduce then fix". */
  name: string;
  /** Branch namespace, e.g. "fix" → branch "fix/<descriptor>". No slashes. */
  branchPrefix: string;
  /** Prompt written into the session once it's at an idle claude prompt. */
  startingPrompt: string;
}

/** Starter templates shipped for a first-run empty settings.json. */
export const STARTER_TEMPLATES: SessionTemplate[] = [
  {
    name: "bugfix: reproduce then fix",
    branchPrefix: "fix",
    startingPrompt:
      "There is a bug to fix. First write a failing test that reproduces it, confirm it fails, then make the minimal change to make it pass. Do not touch unrelated code. When the test is green, tell me what the root cause was.",
  },
  {
    name: "feature: plan then build",
    branchPrefix: "feat",
    startingPrompt:
      "We're building a new feature. Before writing any code, lay out a short plan: the files you'll touch and the approach. Wait for my go-ahead, then implement it in small, reviewable steps with tests.",
  },
];

/**
 * Slugify a free-text descriptor into a branch-safe segment: lowercase,
 * non-alphanumerics → "-", collapsed, trimmed. Empty input → "session" so a
 * branch is never left dangling on a bare prefix.
 */
export function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  return slug || "session";
}

/**
 * Branch name for a template + descriptor: "<prefix>/<slug>". The prefix is
 * itself slugified (minus any slashes) so a hand-typed "fix/" or "My Feature"
 * can't produce a malformed ref.
 */
export function templateBranch(template: SessionTemplate, descriptor: string): string {
  const prefix = slugify(template.branchPrefix);
  return `${prefix}/${slugify(descriptor)}`;
}

/** Shape guard: a value is a usable template with all three non-empty strings. */
export function isSessionTemplate(v: unknown): v is SessionTemplate {
  if (!v || typeof v !== "object") return false;
  const t = v as Record<string, unknown>;
  return (
    typeof t.name === "string" && t.name.trim() !== "" &&
    typeof t.branchPrefix === "string" && t.branchPrefix.trim() !== "" &&
    typeof t.startingPrompt === "string" && t.startingPrompt.trim() !== ""
  );
}

/**
 * Trim + validate a draft into a storable template, or null if any required
 * field is blank. Used before saving a user-defined template to settings.
 */
export function sanitizeTemplate(draft: {
  name?: string;
  branchPrefix?: string;
  startingPrompt?: string;
}): SessionTemplate | null {
  const candidate = {
    name: (draft.name ?? "").trim(),
    branchPrefix: (draft.branchPrefix ?? "").trim(),
    startingPrompt: (draft.startingPrompt ?? "").trim(),
  };
  return isSessionTemplate(candidate) ? candidate : null;
}

/**
 * Read saved templates out of appSettings, keeping only well-shaped entries.
 * Falls back to the starters when nothing valid is stored, so the picker is
 * never empty on first run or after a corrupt/missing setting.
 */
export function loadTemplates(appSettings: Record<string, unknown>): SessionTemplate[] {
  const raw = appSettings.sessionTemplates;
  if (Array.isArray(raw)) {
    const valid = raw.filter(isSessionTemplate);
    if (valid.length > 0) return valid;
  }
  return STARTER_TEMPLATES;
}
