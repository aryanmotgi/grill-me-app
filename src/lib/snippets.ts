// ---------------------------------------------------------------------------
// Snippet library model — reusable prompts saved in settings and inserted into
// a live session verbatim (no trailing newline, so the user edits before send).
// Kept pure + framework-free so CRUD is unit-testable without a Tauri backend.
// Snippets persist under appSettings.snippets via setAppSetting("snippets", …).
// ---------------------------------------------------------------------------

export interface Snippet {
  id: string;
  title: string;
  body: string;
}

/** Sensible starters shown until the user first edits their library. Once any
 *  CRUD op persists an array (even an empty one), these are no longer injected —
 *  loadSnippets only seeds them when nothing has ever been stored. */
export const STARTER_SNIPPETS: Snippet[] = [
  {
    id: "starter-tests",
    title: "Write tests for this",
    body: "Write tests for this. Cover the happy path and the edge cases, and follow the existing test style in the repo.",
  },
  {
    id: "starter-error",
    title: "Explain this error",
    body: "Explain this error: what is the root cause, and what is the smallest safe fix?",
  },
  {
    id: "starter-refactor",
    title: "Refactor for readability",
    body: "Refactor this for readability without changing behavior. Keep the public API stable and note anything risky.",
  },
];

/** A fresh, reasonably-unique id for a new snippet (non-pure; component-only). */
export function newSnippetId(): string {
  return `snip-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** True only for a well-formed snippet object read back from settings JSON. */
function isSnippet(v: unknown): v is Snippet {
  if (!v || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  return typeof s.id === "string" && typeof s.title === "string" && typeof s.body === "string";
}

/**
 * Normalize whatever is stored under appSettings.snippets into a Snippet[].
 * - never stored (undefined) or garbage → the starter set (first-run seed)
 * - a valid array (including []) → its valid entries, in order
 * The undefined-vs-[] distinction is deliberate: once the user clears their
 * library we must NOT resurrect the starters.
 */
export function loadSnippets(raw: unknown): Snippet[] {
  if (raw === undefined) return STARTER_SNIPPETS;
  if (!Array.isArray(raw)) return STARTER_SNIPPETS;
  return raw.filter(isSnippet);
}

/** True when a snippet has both a non-blank title and a non-blank body. */
export function isValidSnippet(s: { title: string; body: string }): boolean {
  return s.title.trim().length > 0 && s.body.trim().length > 0;
}

/**
 * Add a new snippet or replace an existing one (matched by id). Title is
 * trimmed; body is kept as typed so multi-line prompts preserve formatting.
 * Invalid input (blank title or body) returns the list unchanged.
 */
export function upsertSnippet(list: Snippet[], snippet: Snippet): Snippet[] {
  if (!isValidSnippet(snippet)) return list;
  const clean: Snippet = { ...snippet, title: snippet.title.trim() };
  const i = list.findIndex((s) => s.id === clean.id);
  if (i === -1) return [...list, clean];
  const next = list.slice();
  next[i] = clean;
  return next;
}

/** Remove the snippet with the given id (no-op if absent). */
export function deleteSnippet(list: Snippet[], id: string): Snippet[] {
  return list.filter((s) => s.id !== id);
}
