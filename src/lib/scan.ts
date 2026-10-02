// ---------------------------------------------------------------------------
// Workflow scan, frontend half: the sources the user can switch on, the shape
// the Rust scanner returns (src-tauri/src/scan.rs), and a plain-words summary
// for the onboarding step. Pure; the UI is in FirstRun.tsx.
// ---------------------------------------------------------------------------

export type ScanSourceId = "agents" | "extensions" | "instructions" | "stack" | "git" | "packages" | "history";

export interface ScanSource {
  id: ScanSourceId;
  label: string;
  /** what it reads, in plain words — and what it never reads */
  detail: string;
  defaultOn: boolean;
}

export const SCAN_SOURCES: ScanSource[] = [
  { id: "agents", label: "AI coding tools", detail: "Which agents and apps are installed (Claude Code, Codex, Cursor…).", defaultOn: true },
  { id: "extensions", label: "Skills, plugins and MCP servers", detail: "Their names only, from your agents' settings. Never keys, tokens or passwords.", defaultOn: true },
  { id: "instructions", label: "Instruction files", detail: "CLAUDE.md, AGENTS.md and rules files: size and headings, never what's inside.", defaultOn: true },
  { id: "stack", label: "Your project's tech stack", detail: "Framework and library names from package.json, Cargo.toml and similar.", defaultOn: true },
  { id: "git", label: "Git habits", detail: "How often you commit and how you name branches. No code or commit messages.", defaultOn: true },
  { id: "packages", label: "Installed packages", detail: "Names of Homebrew, global npm and editor extension installs.", defaultOn: false },
  { id: "history", label: "Terminal history", detail: "Only the program name at the start of each command (like “bun” or “vercel”). The rest of the line, where passwords can hide, is never kept.", defaultOn: false },
];

export interface ScanMcp { name: string; agent: string; scope: string; transport?: "http" | "stdio"; host?: string; command?: string; packages?: string[] }
export interface ScanResult {
  ts: number;
  sources: ScanSourceId[];
  project?: string;
  agents?: { bins: string[]; apps: string[] };
  extensions?: {
    mcp: ScanMcp[];
    plugins: { name: string; marketplace: string; agent: string }[];
    skills: { name: string; description: string; agent: string }[];
  };
  instructions?: { file: string; scope: string; bytes: number; headings: string[] }[];
  stack?: { languages?: string[]; frameworks?: string[]; dependencies?: string[] };
  git?: { commits30d?: number; conventionalCommits?: number; usesPullRequests?: boolean; branchPrefixes?: string[] };
  packages?: { brew: string[]; brewCasks: string[]; npmGlobal: string[]; editorExtensions: string[] };
  history?: { cmd: string; count: number }[];
  checked: { source: ScanSourceId; item: string }[];
}

const AGENT_NAMES: Record<string, string> = {
  claude: "Claude Code", codex: "Codex", "cursor-agent": "Cursor", agent: "Cursor", gemini: "Gemini CLI", copilot: "Copilot CLI",
  aider: "Aider", opencode: "OpenCode", amp: "Amp", goose: "Goose", ollama: "Ollama",
};

const list = (xs: string[], max = 4) => (xs.length <= max ? xs.join(", ") : `${xs.slice(0, max).join(", ")} +${xs.length - max} more`);
const uniq = (xs: string[]) => [...new Set(xs)];

/** "AI coding tools: Claude Code, Codex" — one line per thing found. */
export function scanSummary(s: ScanResult): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  const agents = uniq((s.agents?.bins ?? []).map((b) => AGENT_NAMES[b] ?? b));
  const apps = (s.agents?.apps ?? []).map((a) => a.replace(/\.app$/, ""));
  if (agents.length) out.push({ label: "AI coding tools", value: list(agents) });
  if (apps.length) out.push({ label: "Apps", value: list(apps) });
  const ext = s.extensions;
  if (ext?.mcp.length) out.push({ label: "MCP servers", value: list(uniq(ext.mcp.map((m) => m.name))) });
  if (ext?.plugins.length) out.push({ label: "Plugins", value: list(uniq(ext.plugins.map((p) => p.name))) });
  if (ext?.skills.length) out.push({ label: "Skills", value: `${ext.skills.length} installed` });
  if (s.instructions?.length) out.push({ label: "Instruction files", value: list(s.instructions.filter((i) => i.bytes > 0).map((i) => i.file.split("/").pop() ?? i.file)) || "empty" });
  const stack = [...(s.stack?.languages ?? []), ...(s.stack?.frameworks ?? [])];
  if (stack.length) out.push({ label: "Stack", value: list(stack, 6) });
  const g = s.git;
  if (g && g.commits30d != null) {
    const bits = [`${g.commits30d} commits in 30 days`];
    if (g.usesPullRequests) bits.push("uses pull requests");
    if (g.branchPrefixes?.length) bits.push(`branches like ${g.branchPrefixes.slice(0, 2).map((p) => `${p}/…`).join(", ")}`);
    out.push({ label: "Git", value: bits.join(" · ") });
  }
  if (s.history?.length) out.push({ label: "You run most", value: list(s.history.map((h) => h.cmd), 6) });
  return out;
}
