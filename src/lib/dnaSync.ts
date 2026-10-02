// ---------------------------------------------------------------------------
// DNA Sync, the pure part: which files each AI reads, what goes in Grill Me's
// block in each, and how the block is placed. The Rust side
// (src-tauri/src/dnasync.rs) re-checks that nothing outside the block
// changes, backs up, writes, and can undo.
//
//   personal  ~/.claude/CLAUDE.md, ~/.codex/AGENTS.md, ~/.gemini/GEMINI.md:
//             your personal rules + a short "how I work"
//   project   <repo>/AGENTS.md (+ CLAUDE.md / GEMINI.md / a Cursor rule):
//             that project's rules
// A rule that's already written in a file (anywhere outside our block) is
// never repeated there.
// ---------------------------------------------------------------------------

import type { CodingDNA, Rule } from "./dna";

export const START = "<!-- Coding DNA: managed by Grill Me. Edit it in Grill Me → DNA. -->";
export const END = "<!-- /Coding DNA -->";

export type Agent = "claude" | "codex" | "gemini" | "cursor";
export interface Target {
  path: string;
  /** shown in the list: "~/.claude/CLAUDE.md", "shop/AGENTS.md" */
  label: string;
  scope: "personal" | "project";
  project?: string;
  /** which AI reads it */
  reads: string;
  /** a whole file of ours (Cursor rules), not a block in yours */
  whole?: boolean;
}

/** Which AIs you use, from the DNA's toolkit and habits. */
export function agentsOf(dna: CodingDNA): Set<Agent> {
  const ids = dna.toolkit.filter((t) => !t.removed).map((t) => `${t.id} ${t.name}`.toLowerCase()).join(" ");
  const habits = dna.habits.map((h) => h.text.toLowerCase()).join(" ");
  const out = new Set<Agent>();
  if (/claude-code|claude code/.test(ids) || habits.includes("claude")) out.add("claude");
  if (/codex/.test(ids) || habits.includes("codex")) out.add("codex");
  if (/gemini/.test(ids) || habits.includes("gemini")) out.add("gemini");
  if (/cursor/.test(ids) || habits.includes("cursor")) out.add("cursor");
  return out;
}

/** Every file DNA Sync could write, for these projects. */
export function targetsFor(home: string, projects: { name: string; path: string }[], agents: Set<Agent>): Target[] {
  const out: Target[] = [];
  if (agents.has("claude") || agents.size === 0) out.push({ path: `${home}/.claude/CLAUDE.md`, label: "~/.claude/CLAUDE.md", scope: "personal", reads: "Claude Code, everywhere" });
  if (agents.has("codex")) out.push({ path: `${home}/.codex/AGENTS.md`, label: "~/.codex/AGENTS.md", scope: "personal", reads: "Codex, everywhere" });
  if (agents.has("gemini")) out.push({ path: `${home}/.gemini/GEMINI.md`, label: "~/.gemini/GEMINI.md", scope: "personal", reads: "Gemini CLI, everywhere" });
  for (const p of projects) {
    out.push({ path: `${p.path}/AGENTS.md`, label: `${p.name}/AGENTS.md`, scope: "project", project: p.name, reads: "Codex, Cursor, most agents, in this project" });
    if (agents.has("claude") || agents.size === 0) out.push({ path: `${p.path}/CLAUDE.md`, label: `${p.name}/CLAUDE.md`, scope: "project", project: p.name, reads: "Claude Code, in this project" });
    if (agents.has("gemini")) out.push({ path: `${p.path}/GEMINI.md`, label: `${p.name}/GEMINI.md`, scope: "project", project: p.name, reads: "Gemini CLI, in this project" });
    if (agents.has("cursor")) out.push({ path: `${p.path}/.cursor/rules/coding-dna.mdc`, label: `${p.name}/.cursor/rules/coding-dna.mdc`, scope: "project", project: p.name, reads: "Cursor, in this project", whole: true });
  }
  return out;
}

/** The file with Grill Me's block taken out (mirrors dnasync.rs `strip`). */
export function strip(text: string): string {
  const s = text.indexOf("<!-- Coding DNA");
  if (s < 0) return text;
  const eRel = text.slice(s).indexOf(END);
  if (eRel < 0) return text;
  let e = s + eRel + END.length;
  if (text[e] === "\n") e++;
  const s2 = text.slice(0, s).endsWith("\n\n") ? s - 1 : s;
  return text.slice(0, s2) + text.slice(e);
}

/** The block currently in a file (without markers), or "". */
export function currentBlock(text: string): string {
  const s = text.indexOf("<!-- Coding DNA");
  if (s < 0) return "";
  const body = text.slice(text.indexOf("\n", s) + 1);
  const e = body.indexOf(END);
  return e < 0 ? "" : body.slice(0, e).trimEnd();
}

const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
/** A rule already written in your part of the file. */
const alreadyThere = (r: Rule, yours: string) => clean(yours).includes(clean(r.text));

/** What goes inside Grill Me's block in this file ("" = nothing to say). */
export function blockFor(dna: CodingDNA, t: Target, fileText: string): string {
  const yours = strip(fileText);
  const rules = dna.rules.filter((r) => r.status === "active" && !alreadyThere(r, yours) &&
    (t.scope === "personal" ? r.scope === "personal" : r.scope === "project" && r.project === t.project));
  const lines: string[] = [];
  if (t.scope === "personal") {
    const how = dna.habits.filter((h) => /^habit:(team|level|style)$/.test(h.id) || h.edited).map((h) => h.text).slice(0, 4);
    if (how.length || rules.length) lines.push("## My Coding DNA");
    if (how.length) lines.push(`How I work: ${how.join("; ")}.`.replace(/\.\.$/, "."));
    if (rules.length) lines.push("", "Always follow these:", ...rules.map((r) => `- ${r.text}`));
  } else if (rules.length) {
    lines.push("## Project rules (from my Coding DNA)", ...rules.map((r) => `- ${r.text}`));
  }
  return lines.join("\n").trim();
}

/** The file with this block in place: replaced where it was, else added at
 *  the end. An empty block removes ours. Your content is never touched. */
export function withBlock(fileText: string, block: string, whole = false): string {
  const yours = strip(fileText);
  if (whole) {
    // a Cursor rule file of our own: only if it's new or already ours
    if (fileText.trim() && !fileText.includes("<!-- Coding DNA")) return fileText;
    return block ? `---\ndescription: My Coding DNA (managed by Grill Me)\nalwaysApply: true\n---\n${START}\n${block}\n${END}\n` : "";
  }
  if (!block) return yours === fileText ? fileText : yours;
  const wrapped = `${START}\n${block}\n${END}\n`;
  const s = fileText.indexOf("<!-- Coding DNA");
  if (s >= 0 && fileText.indexOf(END, s) > 0) {
    const e = fileText.indexOf(END, s) + END.length + (fileText[fileText.indexOf(END, s) + END.length] === "\n" ? 1 : 0);
    return fileText.slice(0, s) + wrapped + fileText.slice(e);
  }
  if (!fileText) return wrapped;
  return `${fileText}${fileText.endsWith("\n") ? "" : "\n"}\n${wrapped}`;
}

export type Change = "new" | "update" | "remove" | "same" | "blocked";
/** How a file would change. */
export function changeOf(t: Target, fileText: string, exists: boolean, after: string): Change {
  if (t.whole && fileText.trim() && !fileText.includes("<!-- Coding DNA")) return "blocked";
  if (after === fileText) return "same";
  if (!exists || !fileText) return "new";
  return currentBlock(after) ? "update" : "remove";
}
