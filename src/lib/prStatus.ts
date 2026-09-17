// ---------------------------------------------------------------------------
// Pure helpers for the PR dashboard: parse the raw JSON `gh pr list` emits
// (served by the pr_list Rust command) and roll each PR's status checks up to
// one traffic-light state. Side-effect free so it's unit-testable without gh
// or Tauri — no fabricated fields, missing data reads as "none".
// ---------------------------------------------------------------------------

/** One entry in a PR's statusCheckRollup: either a CheckRun (status+conclusion)
 *  or a StatusContext (state). We read whichever fields are present. */
export interface RollupEntry {
  status?: string | null;
  conclusion?: string | null;
  state?: string | null;
}

/** Shape of a PR row as emitted by `gh pr list --json …`. */
export interface RawPr {
  number: number;
  title: string;
  headRefName: string;
  isDraft: boolean;
  reviewDecision: string | null;
  author: { login: string } | null;
  statusCheckRollup: RollupEntry[] | null;
}

export type CiStatus = "pass" | "fail" | "pending" | "none";
export type ReviewState = "approved" | "changes_requested" | "review_required" | "none";

/** A dashboard-ready PR: raw fields plus derived, display-safe status. */
export interface PrRow {
  number: number;
  title: string;
  branch: string;
  author: string;
  isDraft: boolean;
  ci: CiStatus;
  review: ReviewState;
}

/** Classify a single rollup entry as pass / fail / pending. */
function classifyEntry(e: RollupEntry): "pass" | "fail" | "pending" {
  // StatusContext (commit statuses): state carries the outcome.
  if (e.state) {
    const s = e.state.toUpperCase();
    if (s === "SUCCESS") return "pass";
    if (s === "FAILURE" || s === "ERROR") return "fail";
    return "pending"; // PENDING / EXPECTED
  }
  // CheckRun (GitHub Actions etc.): pending until COMPLETED, then conclusion.
  const status = (e.status ?? "").toUpperCase();
  if (status !== "COMPLETED") return "pending"; // QUEUED / IN_PROGRESS / WAITING …
  const c = (e.conclusion ?? "").toUpperCase();
  if (c === "SUCCESS" || c === "NEUTRAL" || c === "SKIPPED") return "pass";
  return "fail"; // FAILURE / CANCELLED / TIMED_OUT / ACTION_REQUIRED / STARTUP_FAILURE
}

/** Roll a PR's status checks up to one state. No checks configured → "none". */
export function ciStatus(rollup: RollupEntry[] | null | undefined): CiStatus {
  if (!rollup || rollup.length === 0) return "none";
  let pending = false;
  for (const e of rollup) {
    const r = classifyEntry(e);
    if (r === "fail") return "fail"; // any red wins outright
    if (r === "pending") pending = true;
  }
  return pending ? "pending" : "pass";
}

/** Normalize gh's reviewDecision enum (or empty/null) to our union. */
export function reviewState(decision: string | null | undefined): ReviewState {
  switch ((decision ?? "").toUpperCase()) {
    case "APPROVED":
      return "approved";
    case "CHANGES_REQUESTED":
      return "changes_requested";
    case "REVIEW_REQUIRED":
      return "review_required";
    default:
      return "none";
  }
}

/** Parse the raw JSON string from pr_list into display-ready rows. Throws on
 *  malformed JSON so the caller can show an honest error state. */
export function parsePrList(json: string): PrRow[] {
  const trimmed = json.trim();
  if (!trimmed) return [];
  const raw = JSON.parse(trimmed) as RawPr[];
  if (!Array.isArray(raw)) return [];
  return raw.map((p) => ({
    number: p.number,
    title: p.title,
    branch: p.headRefName,
    author: p.author?.login ?? "unknown",
    isDraft: Boolean(p.isDraft),
    ci: ciStatus(p.statusCheckRollup),
    review: reviewState(p.reviewDecision),
  }));
}

/** Human label + dot class for a CI status. dotClass mirrors .status-dot
 *  variants so the pulsing HUD dot reads the same as everywhere else. */
export function ciLabel(ci: CiStatus): string {
  switch (ci) {
    case "pass":
      return "checks passing";
    case "fail":
      return "checks failing";
    case "pending":
      return "checks running";
    default:
      return "no checks";
  }
}

/** Human label for a review state. */
export function reviewLabel(r: ReviewState): string {
  switch (r) {
    case "approved":
      return "approved";
    case "changes_requested":
      return "changes requested";
    case "review_required":
      return "review required";
    default:
      return "no review";
  }
}
