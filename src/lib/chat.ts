// ---------------------------------------------------------------------------
// Claude Code transcript (JSONL) → chat items for the Monocode-style chat
// view. The session itself still runs in its pty; this only READS the
// transcript Claude Code writes under ~/.claude/projects and turns it into
// user bubbles, assistant text, and compact tool rows (with their results).
// Pure + tested; the ChatView polls `transcript_tail` and feeds lines here.
// ---------------------------------------------------------------------------

/** Tokens one assistant API call used (from the transcript's message.usage). */
export type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number };
/** `ts` = epoch ms from the transcript line; `model` = the model that wrote it;
 *  `usage` = that API call's tokens, on the first item it produced */
type Stamp = { ts?: number; model?: string; usage?: Usage };
export type ChatItem =
  | ({ kind: "user"; id: string; text: string; images: number } & Stamp)
  | ({ kind: "assistant"; id: string; text: string } & Stamp)
  | ({ kind: "tool"; id: string; name: string; summary: string; detail: string; result?: string; isError?: boolean } & Stamp)
  | ({ kind: "note"; id: string; text: string } & Stamp);

type Block = { type?: string; text?: string; name?: string; id?: string; input?: Record<string, unknown>; tool_use_id?: string; content?: unknown; is_error?: boolean };

const RESULT_CAP = 4000;

function basename(p: unknown): string {
  return typeof p === "string" ? p.split("/").pop() || p : "";
}

/** One-line human summary of a tool call ("Read App.tsx", "Ran npm test"). */
export function toolSummary(name: string, input: Record<string, unknown> = {}): string {
  const s = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : "");
  switch (name) {
    case "Read": return `Read ${basename(input.file_path)}`;
    case "Edit":
    case "MultiEdit": return `Edited ${basename(input.file_path)}`;
    case "Write": return `Wrote ${basename(input.file_path)}`;
    case "NotebookEdit": return `Edited ${basename(input.notebook_path)}`;
    case "Bash": return (s("description") || `Ran ${s("command").split("\n")[0]}`).slice(0, 120);
    case "Grep": return `Searched for "${s("pattern")}"`;
    case "Glob": return `Found files ${s("pattern")}`;
    case "Task":
    case "Agent": return `Agent: ${s("description") || s("subagent_type") || "subtask"}`;
    case "TodoWrite": return "Updated the todo list";
    case "WebFetch": return `Fetched ${s("url")}`;
    case "WebSearch": return `Searched the web: ${s("query")}`;
    case "AskUserQuestion": return "Asked you a question";
    case "Skill": return `Used skill ${s("skill")}`;
    default: return name.replace(/^mcp__[^_]+__/, "");
  }
}

function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => (c && typeof c === "object" && (c as Block).type === "text" ? (c as Block).text ?? "" : ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function stripReminders(t: string): string {
  return t.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").trim();
}

/** User string content: slash commands arrive as XML-ish tags. Returns the
 *  display text, or null for local-command noise that shouldn't render. */
export function userText(raw: string): string | null {
  if (/<local-command-(stdout|stderr|caveat)>/.test(raw)) return null;
  const cmd = raw.match(/<command-name>([\s\S]*?)<\/command-name>/);
  if (cmd) {
    const args = raw.match(/<command-args>([\s\S]*?)<\/command-args>/)?.[1]?.trim();
    const name = cmd[1].trim();
    return `${name.startsWith("/") ? name : `/${name}`}${args ? ` ${args}` : ""}`;
  }
  const t = stripReminders(raw);
  return t || null;
}

/** Harness notifications (background task finished, etc.) injected as user
 *  turns — shown as a quiet note, never as something the user typed. */
export function harnessNote(raw: string): string | null {
  if (!raw.trimStart().startsWith("<task-notification>")) return null;
  const summary = raw.match(/<summary>([\s\S]*?)<\/summary>/)?.[1]?.trim();
  return summary || "Background task update";
}

/** Parse JSONL lines (oldest first) into chat items. Tool results attach to
 *  their tool call by id; sidechain (subagent) and meta lines are skipped. */
export function parseTranscript(lines: string[]): ChatItem[] {
  const items: ChatItem[] = [];
  const tools = new Map<string, Extract<ChatItem, { kind: "tool" }>>();
  const countedCalls = new Set<string>();
  let n = 0;

  for (const line of lines) {
    let o: { type?: string; isMeta?: boolean; isSidechain?: boolean; uuid?: string; timestamp?: string; message?: { id?: string; content?: unknown; model?: string; usage?: Record<string, unknown> } };
    try { o = JSON.parse(line); } catch { continue; }
    if (!o || o.isSidechain || o.isMeta) continue;
    if (o.type !== "user" && o.type !== "assistant") continue;
    const content = o.message?.content;
    const baseId = o.uuid ?? `l${n}`;
    n++;
    const parsedTs = o.timestamp ? Date.parse(o.timestamp) : NaN;
    const ts = Number.isFinite(parsedTs) ? parsedTs : undefined;
    const model = o.message?.model;
    // one API call is split over several lines that repeat its usage: count it once
    let usage: Usage | undefined;
    if (o.type === "assistant" && o.message?.usage && !(o.message.id && countedCalls.has(o.message.id))) {
      const u = o.message.usage;
      const num = (k: string) => (typeof u[k] === "number" ? (u[k] as number) : 0);
      usage = { input: num("input_tokens"), output: num("output_tokens"), cacheRead: num("cache_read_input_tokens"), cacheWrite: num("cache_creation_input_tokens") };
      if (o.message.id) countedCalls.add(o.message.id);
    }

    if (o.type === "user") {
      if (typeof content === "string") {
        if (content.startsWith("[Request interrupted")) { items.push({ kind: "note", id: baseId, text: "Interrupted", ts }); continue; }
        const note = harnessNote(content);
        if (note) { items.push({ kind: "note", id: baseId, text: note, ts }); continue; }
        const t = userText(content);
        if (t) items.push({ kind: "user", id: baseId, text: t, images: 0, ts });
        continue;
      }
      if (!Array.isArray(content)) continue;
      const texts: string[] = [];
      let images = 0;
      for (const b of content as Block[]) {
        if (b.type === "tool_result" && b.tool_use_id) {
          const tool = tools.get(b.tool_use_id);
          if (tool) {
            const r = resultText(b.content);
            tool.result = r.length > RESULT_CAP ? `${r.slice(0, RESULT_CAP)}\n…` : r;
            tool.isError = !!b.is_error;
          }
        } else if (b.type === "text" && b.text) {
          const note = harnessNote(b.text);
          if (note) { items.push({ kind: "note", id: `${baseId}:n`, text: note, ts }); continue; }
          const t = userText(b.text);
          if (t) texts.push(t);
        } else if (b.type === "image") {
          images++;
        }
      }
      if (texts.length || images) items.push({ kind: "user", id: baseId, text: texts.join("\n\n"), images, ts });
      continue;
    }

    // assistant: Claude Code writes one content block per line
    if (!Array.isArray(content)) continue;
    const before = items.length;
    (content as Block[]).forEach((b, i) => {
      const id = `${baseId}:${i}`;
      if (b.type === "text" && b.text?.trim()) {
        const prev = items[items.length - 1];
        // consecutive text blocks read as one reply
        if (prev?.kind === "assistant") { prev.text += `\n\n${b.text}`; prev.ts = ts ?? prev.ts; }
        else items.push({ kind: "assistant", id, text: b.text, ts, model });
      } else if (b.type === "tool_use" && b.name) {
        const input = b.input ?? {};
        const item: Extract<ChatItem, { kind: "tool" }> = {
          kind: "tool",
          id: b.id ?? id,
          name: b.name,
          summary: toolSummary(b.name, input),
          detail: b.name === "Bash" && typeof input.command === "string"
            ? input.command
            : JSON.stringify(input, null, 2).slice(0, RESULT_CAP),
          ts,
          model,
        };
        if (b.id) tools.set(b.id, item);
        items.push(item);
      }
      // thinking blocks are intentionally not shown
    });
    if (usage) {
      // a thinking-only line produced nothing: carry its usage on a hidden note
      const host = items[before] ?? items[items.length - 1];
      if (host && items.length > before) host.usage = usage;
      else if (host) host.usage = addUsage(host.usage, usage);
    }
  }
  return items;
}

export function addUsage(a: Usage | undefined, b: Usage | undefined): Usage | undefined {
  if (!a) return b;
  if (!b) return a;
  return { input: a.input + b.input, output: a.output + b.output, cacheRead: a.cacheRead + b.cacheRead, cacheWrite: a.cacheWrite + b.cacheWrite };
}

// ---- render grouping -------------------------------------------------------

/** "claude-opus-4-8" → "Opus 4.8", "claude-sonnet-5" → "Sonnet 5" */
export function modelLabel(model?: string): string {
  if (!model) return "Claude";
  const m = model.match(/claude-(opus|sonnet|haiku|fable)-(\d+)(?:-(\d{1,2}))?(?:-|$)/i);
  if (!m) return "Claude";
  const fam = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
  return m[3] ? `${fam} ${m[2]}.${m[3]}` : `${fam} ${m[2]}`;
}

export type ChatRow =
  | { kind: "item"; item: ChatItem }
  | { kind: "tools"; id: string; tools: Extract<ChatItem, { kind: "tool" }>[] }
  | ({ kind: "worked"; id: string; model: string; seconds: number } & TurnReceipt);

/** What one turn did, for the receipt under it. */
export interface TurnReceipt {
  /** the message that started the turn */
  ask?: string;
  /** files it wrote or edited, in order, no repeats */
  files: string[];
  /** the last test run in the turn: passed, failed, or none */
  tests?: "pass" | "fail";
  usage?: Usage;
  /** raw model id, for pricing */
  modelId?: string;
}

const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const TEST_CMD = /\b(npm|pnpm|yarn|bun)\s+(run\s+)?test\b|\b(vitest|jest|pytest|mocha|playwright test|rspec|phpunit)\b|\b(cargo|go|deno|dotnet|mix)\s+test\b|\bmake\s+test\b/;

/** Is this shell command a test run? */
export function isTestCommand(cmd: string): boolean {
  return TEST_CMD.test(cmd);
}

/** Group runs of tool calls, and close each finished turn (user → reply)
 *  with a receipt: how long it took, which files it touched, whether the
 *  tests passed, and its tokens. The last turn stays open while the
 *  session is still working. */
export function toRows(items: ChatItem[], working: boolean): ChatRow[] {
  const rows: ChatRow[] = [];
  let turnStart: number | undefined;
  let lastTs: number | undefined;
  let model: string | undefined;
  let hasReply = false;
  let ask: string | undefined;
  let files: string[] = [];
  let tests: "pass" | "fail" | undefined;
  let usage: Usage | undefined;

  const closeTurn = (id: string) => {
    if (hasReply && turnStart !== undefined && lastTs !== undefined && lastTs >= turnStart) {
      rows.push({ kind: "worked", id: `w-${id}`, model: modelLabel(model), seconds: Math.round((lastTs - turnStart) / 1000), ask, files, tests, usage, modelId: model });
    }
    hasReply = false;
    model = undefined;
    files = [];
    tests = undefined;
    usage = undefined;
  };

  for (const it of items) {
    if (it.kind === "user") {
      closeTurn(it.id);
      turnStart = it.ts;
      lastTs = it.ts;
      ask = it.text;
      rows.push({ kind: "item", item: it });
      continue;
    }
    usage = addUsage(usage, it.usage);
    if (it.kind === "assistant" || it.kind === "tool") {
      hasReply = true;
      model = it.model ?? model;
      if (it.ts !== undefined) lastTs = it.ts;
    }
    if (it.kind === "tool") {
      if (EDIT_TOOLS.has(it.name)) {
        const f = it.summary.replace(/^\S+\s+/, "");
        if (f && !files.includes(f)) files.push(f);
      }
      if (it.name === "Bash" && isTestCommand(it.detail) && it.result !== undefined) tests = it.isError ? "fail" : "pass";
      const prev = rows[rows.length - 1];
      if (prev?.kind === "tools") prev.tools.push(it);
      else rows.push({ kind: "tools", id: `g-${it.id}`, tools: [it] });
      continue;
    }
    rows.push({ kind: "item", item: it });
  }
  if (!working) closeTurn("end");
  return rows;
}
