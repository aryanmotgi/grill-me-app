// ---------------------------------------------------------------------------
// Pure helpers for the diff review board: derive +/- line counts from a raw
// unified diff (as produced by `git diff main`, served by the git_review Rust
// command). Kept side-effect free so it's unit-testable without Tauri.
// ---------------------------------------------------------------------------

export interface DiffLineStats {
  added: number;
  removed: number;
}

/**
 * Count added/removed lines in a unified diff. Body lines starting with a
 * single "+" / "-" count; file headers ("+++"/"---") and hunk headers ("@@")
 * are ignored. Robust to the 120KB-truncation footer git_review appends.
 */
export function diffLineStats(diff: string): DiffLineStats {
  let added = 0;
  let removed = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) added++;
    else if (line.startsWith("-") && !line.startsWith("---")) removed++;
  }
  return { added, removed };
}
