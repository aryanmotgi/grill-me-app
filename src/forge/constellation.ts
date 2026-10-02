// Scan → constellation stars, and tool → workflow stage. Pure.

import type { Catalog } from "../lib/catalog";
import { matchDetections } from "../lib/catalog";
import type { ScanResult } from "../lib/scan";
import { STAGES } from "../lib/profile";
import type { StarSpec } from "./engine";

/** Agents in the order we show them (coding agents first). */
const AGENTS: [string, string][] = [
  ["claude", "Claude Code"], ["codex", "Codex"], ["cursor", "Cursor"], ["gemini", "Gemini CLI"],
  ["copilot", "Copilot"], ["windsurf", "Windsurf"], ["aider", "Aider"], ["opencode", "OpenCode"], ["amp", "Amp"], ["goose", "Goose"],
];
const BIN_TO_AGENT: Record<string, string> = { "cursor-agent": "cursor", agent: "cursor" };
const APP_TO_AGENT: Record<string, string> = { "Cursor.app": "cursor", "Windsurf.app": "windsurf", "Codex.app": "codex", "Claude.app": "claude" };
export const MAX_AGENTS = 3;
/** named tools per agent; the rest show as small unnamed dots */
export const MAX_KIDS = 5;
export const MAX_DUST = 14;

/**
 * Up to three agents, each with its top five tools named (MCP servers
 * first, then plugins, then skills) and a few more as unnamed dots, so the
 * picture shows "a lot" without a wall of labels. A tool used by several
 * agents appears once, linked to each of them.
 */
/** How many tools were found in total (for the caption). */
export function toolCount(scan: ScanResult | null | undefined): number {
  const e = scan?.extensions;
  return new Set([...(e?.mcp ?? []), ...(e?.plugins ?? []), ...(e?.skills ?? [])].map((x) => x.name.toLowerCase())).size;
}

export function constellationFromScan(scan: ScanResult | null | undefined): { stars: StarSpec[]; links: [string, string][] } {
  const found = new Set<string>();
  for (const b of scan?.agents?.bins ?? []) found.add(BIN_TO_AGENT[b] ?? b);
  for (const a of scan?.agents?.apps ?? []) if (APP_TO_AGENT[a]) found.add(APP_TO_AGENT[a]);
  const ext = scan?.extensions;
  for (const x of [...(ext?.mcp ?? []), ...(ext?.plugins ?? [])]) if (AGENTS.some(([id]) => id === x.agent)) found.add(x.agent);
  const agents = AGENTS.filter(([id]) => found.has(id)).slice(0, MAX_AGENTS);
  if (!agents.length) return { stars: [{ id: "agent:you", label: "Your AI", kind: "agent" }], links: [] };

  const stars: StarSpec[] = agents.map(([id, label]) => ({ id: `agent:${id}`, label, kind: "agent" }));
  const links: [string, string][] = [];
  const seen = new Map<string, string>(); // tool name → star id
  for (const [agentId] of agents) {
    const tools = [
      ...(ext?.mcp ?? []).filter((m) => m.agent === agentId).map((m) => ({ n: m.name, k: "MCP" })),
      ...(ext?.plugins ?? []).filter((p) => p.agent === agentId).map((p) => ({ n: p.name, k: "plugin" })),
      ...(ext?.skills ?? []).filter((s) => s.agent === agentId).map((s) => ({ n: s.name, k: "skill" })),
    ];
    let shown = 0, dust = 0;
    for (const t of tools) {
      const key = t.n.toLowerCase();
      const existing = seen.get(key);
      if (existing) { if (shown < MAX_KIDS || existing.startsWith("tool:")) links.push([existing, `agent:${agentId}`]); continue; }
      const id = `tool:${key}`;
      seen.set(key, id);
      if (shown < MAX_KIDS) { stars.push({ id, label: t.n, kind: "kid", sub: t.k, parent: `agent:${agentId}` }); shown++; }
      else if (dust < MAX_DUST) { stars.push({ id, label: t.n, kind: "dust", parent: `agent:${agentId}` }); dust++; }
    }
  }
  return { stars, links };
}

/** Which of the five stages a tool belongs to (index into STAGES), or null. */
export function stageIndexOf(label: string, catalog: Catalog): number | null {
  const name = label.toLowerCase();
  const [hit] = matchDetections(catalog, { mcp: [name], plugins: [name], skills: [name], bins: [name] });
  if (!hit) return null;
  const i = STAGES.findIndex((st) => hit.solves.some((t) => st.tags.includes(t)));
  return i >= 0 ? i : null;
}
