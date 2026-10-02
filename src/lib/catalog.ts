// Built-in catalog of AI-coding tools. A small local model never has to
// "know" tools: the scanner matches what it finds against `detect`, and the
// recommender matches workflow gaps against `solves`.
//
// Three sources, merged by mergeCatalogs:
//   builtin  src/data/catalog.json, shipped with the app
//   remote   GET <relay>/v1/catalog, cached at ~/.grillme/catalog.json
//   local    entries the user added (e.g. drafts from catalog_lookup)

export type CatalogKind = "agent" | "mcp" | "skill" | "plugin" | "cli" | "app";
export type SolveTag =
  | "testing" | "browser" | "docs" | "planning" | "notes" | "project-management" | "design" | "deploy"
  | "review" | "debugging" | "database" | "auth" | "payments" | "search" | "memory" | "security" | "ci"
  | "analytics" | "orchestration" | "code-quality" | "voice" | "ui" | "git" | "monitoring";

export interface CatalogEntry {
  id: string;                 // kebab-case, unique
  name: string;
  kind: CatalogKind;
  what: string;               // one plain sentence: what it does
  solves: SolveTag[];         // problems it solves (1-4)
  agents: string[];           // works with: "claude","codex","cursor","gemini","copilot","windsurf","any"
  detect: {                   // how a scan recognizes it (lowercase names)
    bins?: string[];          // executables on PATH
    apps?: string[];          // macOS app bundle names, e.g. "Cursor.app"
    mcp?: string[];           // MCP server names/hosts/package names
    skills?: string[];        // skill dir names
    plugins?: string[];       // plugin names (before @marketplace)
    npm?: string[]; brew?: string[]; pip?: string[];
    deps?: string[];          // project dependency names (package.json etc.)
  };
  install?: {
    mcp?: { name: string; url?: string; command?: string; args?: string[] };
    command?: string;         // exact shell command to install (shown, copied)
    docs: string;             // install docs URL
  };
  source: string;             // homepage/repo URL
  verified: boolean;
  updated: string;            // YYYY-MM-DD it was checked
}
export interface Catalog { version: string; updated: string; entries: CatalogEntry[] }

export const CATALOG_KINDS: readonly CatalogKind[] = ["agent", "mcp", "skill", "plugin", "cli", "app"];
export const SOLVE_TAGS: readonly SolveTag[] = [
  "testing", "browser", "docs", "planning", "notes", "project-management", "design", "deploy",
  "review", "debugging", "database", "auth", "payments", "search", "memory", "security", "ci",
  "analytics", "orchestration", "code-quality", "voice", "ui", "git", "monitoring",
];
export const DETECT_KEYS = ["bins", "apps", "mcp", "skills", "plugins", "npm", "brew", "pip", "deps"] as const;
export type DetectKey = (typeof DETECT_KEYS)[number];
export type Detections = Partial<Record<DetectKey, string[]>>;

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const URL_RE = /^https?:\/\/\S+$/;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const strList = (v: unknown): string[] | null =>
  Array.isArray(v) && v.every((s) => typeof s === "string") ? (v as string[]) : null;

/** One entry, or null when it can't be trusted. Unknown solve tags are
 *  dropped (a newer remote catalog may know more tags than this app). */
export function parseEntry(raw: unknown): CatalogEntry | null {
  if (!isObj(raw)) return null;
  const { id, name, kind, what, solves, agents, detect, install, source, verified, updated } = raw;
  if (!isStr(id) || id.length > 80 || !ID_RE.test(id)) return null;
  if (!isStr(name) || !isStr(what)) return null;
  if (typeof kind !== "string" || !(CATALOG_KINDS as readonly string[]).includes(kind)) return null;
  const solveList = strList(solves);
  const agentList = strList(agents);
  if (!solveList || !agentList || agentList.length === 0) return null;
  if (!isStr(source) || !URL_RE.test(source)) return null;
  if (typeof verified !== "boolean" || typeof updated !== "string") return null;
  if (!isObj(detect)) return null;

  const det: CatalogEntry["detect"] = {};
  for (const key of DETECT_KEYS) {
    if (detect[key] === undefined) continue;
    const list = strList(detect[key]);
    if (!list) return null;
    const clean = list.map((s) => s.trim()).filter(Boolean);
    // app bundle names keep their case on disk; everything else is lowercase
    if (clean.length) det[key] = key === "apps" ? clean : clean.map((s) => s.toLowerCase());
  }

  let inst: CatalogEntry["install"];
  if (install !== undefined) {
    if (!isObj(install) || !isStr(install.docs) || !URL_RE.test(install.docs)) return null;
    inst = { docs: install.docs };
    if (install.command !== undefined) {
      if (!isStr(install.command)) return null;
      inst.command = install.command;
    }
    if (install.mcp !== undefined) {
      const m = install.mcp;
      if (!isObj(m) || !isStr(m.name)) return null;
      const url = m.url, command = m.command, args = m.args;
      if (url !== undefined && (!isStr(url) || !URL_RE.test(url))) return null;
      if (command !== undefined && !isStr(command)) return null;
      if (args !== undefined && !strList(args)) return null;
      if (url === undefined && command === undefined) return null;
      inst.mcp = { name: m.name };
      if (url !== undefined) inst.mcp.url = url as string;
      if (command !== undefined) inst.mcp.command = command as string;
      if (args !== undefined) inst.mcp.args = args as string[];
    }
  }

  const entry: CatalogEntry = {
    id,
    name: name.trim(),
    kind: kind as CatalogKind,
    what: what.trim(),
    solves: solveList.filter((t): t is SolveTag => (SOLVE_TAGS as readonly string[]).includes(t)).slice(0, 4),
    agents: agentList.map((a) => a.toLowerCase()),
    detect: det,
    source,
    verified,
    updated,
  };
  if (inst) entry.install = inst;
  return entry;
}

/** Validates a catalog document; drops bad (and duplicate-id) entries. */
export function parseCatalog(raw: unknown): Catalog | null {
  if (!isObj(raw) || !Array.isArray(raw.entries)) return null;
  const seen = new Set<string>();
  const entries: CatalogEntry[] = [];
  for (const r of raw.entries) {
    const e = parseEntry(r);
    if (!e || seen.has(e.id)) continue;
    seen.add(e.id);
    entries.push(e);
  }
  return {
    version: typeof raw.version === "string" ? raw.version : "0",
    updated: typeof raw.updated === "string" ? raw.updated : "",
    entries,
  };
}

/** Compares versions like "2026.10.01" or "1.4.0" segment by segment. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/\D+/).filter(Boolean).map(Number);
  const pb = b.split(/\D+/).filter(Boolean).map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** builtin ← remote (only when remote is newer, per id) ← local user
 *  additions (kept unverified, never allowed to shadow a known id). */
export function mergeCatalogs(builtin: Catalog, remote?: Catalog | null, local?: Catalog | null): Catalog {
  const byId = new Map<string, CatalogEntry>();
  for (const e of builtin.entries) byId.set(e.id, e);
  let version = builtin.version;
  let updated = builtin.updated;
  if (remote && compareVersions(remote.version, builtin.version) > 0) {
    for (const e of remote.entries) byId.set(e.id, e);
    version = remote.version;
    updated = remote.updated;
  }
  for (const e of local?.entries ?? []) {
    if (!byId.has(e.id)) byId.set(e.id, { ...e, verified: false });
  }
  return { version, updated, entries: [...byId.values()] };
}

const norm = (s: string) => s.trim().toLowerCase();
/** "superpowers@superpowers-marketplace" → "superpowers" */
const pluginName = (s: string) => norm(s).split("@")[0];
/** Hosts and packages ("mcp.linear.app", "@playwright/mcp") match inside a
 *  longer string (a URL, "npx -y @playwright/mcp@latest"); bare names must
 *  match exactly so "memory" doesn't claim "supermemory". */
const looksSpecific = (p: string) => /[./@]/.test(p);

/** Catalog entries the scan found evidence of. Case-insensitive. */
export function matchDetections(catalog: Catalog, found: Detections): CatalogEntry[] {
  const sets = {} as Record<DetectKey, Set<string>>;
  for (const key of DETECT_KEYS) {
    const list = found[key] ?? [];
    sets[key] = new Set(list.map(key === "plugins" ? pluginName : norm).filter(Boolean));
  }
  const mcpFound = [...sets.mcp];
  return catalog.entries.filter((e) =>
    DETECT_KEYS.some((key) =>
      (e.detect[key] ?? []).some((raw) => {
        const p = norm(raw);
        if (!p) return false;
        if (key === "mcp") return mcpFound.some((f) => f === p || (looksSpecific(p) && f.includes(p)));
        if (key === "plugins") return sets.plugins.has(pluginName(p));
        return sets[key].has(p);
      }),
    ),
  );
}

/** Entries that solve `tag` and work with at least one of `agents`
 *  (entries marked "any" always qualify; an empty `agents` means no filter).
 *  Verified entries come first. */
export function entriesSolving(catalog: Catalog, tag: SolveTag, agents: string[] = []): CatalogEntry[] {
  const want = new Set(agents.map(norm));
  const hits = catalog.entries.filter(
    (e) => e.solves.includes(tag) && (want.size === 0 || e.agents.some((a) => a === "any" || want.has(a))),
  );
  return [...hits.filter((e) => e.verified), ...hits.filter((e) => !e.verified)];
}
