// ---------------------------------------------------------------------------
// Claude Code transcript (JSONL) → chat items for the Monocode-style chat
// view. The session itself still runs in its pty; this only READS the
// transcript Claude Code writes under ~/.claude/projects and turns it into
// user bubbles, assistant text, and compact tool rows (with their results).
// Pure + tested; the ChatView polls `transcript_tail` and feeds lines here.
// ---------------------------------------------------------------------------

export type ChatItem =
  | { kind: "user"; id: string; text: string; images: number }
  | { kind: "assistant"; id: string; text: string }
  | { kind: "tool"; id: string; name: string; summary: string; detail: string; result?: string; isError?: boolean }
  | { kind: "note"; id: string; text: string };

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
    case "Bash": return `Ran ${s("description") || s("command").split("\n")[0]}`.slice(0, 120);
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
  let n = 0;

  for (const line of lines) {
    let o: { type?: string; isMeta?: boolean; isSidechain?: boolean; uuid?: string; message?: { content?: unknown } };
    try { o = JSON.parse(line); } catch { continue; }
    if (!o || o.isSidechain || o.isMeta) continue;
    if (o.type !== "user" && o.type !== "assistant") continue;
    const content = o.message?.content;
    const baseId = o.uuid ?? `l${n}`;
    n++;

    if (o.type === "user") {
      if (typeof content === "string") {
        if (content.startsWith("[Request interrupted")) { items.push({ kind: "note", id: baseId, text: "Interrupted" }); continue; }
        const note = harnessNote(content);
        if (note) { items.push({ kind: "note", id: baseId, text: note }); continue; }
        const t = userText(content);
        if (t) items.push({ kind: "user", id: baseId, text: t, images: 0 });
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
          if (note) { items.push({ kind: "note", id: `${baseId}:n`, text: note }); continue; }
          const t = userText(b.text);
          if (t) texts.push(t);
        } else if (b.type === "image") {
          images++;
        }
      }
      if (texts.length || images) items.push({ kind: "user", id: baseId, text: texts.join("\n\n"), images });
      continue;
    }

    // assistant: Claude Code writes one content block per line
    if (!Array.isArray(content)) continue;
    (content as Block[]).forEach((b, i) => {
      const id = `${baseId}:${i}`;
      if (b.type === "text" && b.text?.trim()) {
        const prev = items[items.length - 1];
        // consecutive text blocks read as one reply
        if (prev?.kind === "assistant") prev.text += `\n\n${b.text}`;
        else items.push({ kind: "assistant", id, text: b.text });
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
        };
        if (b.id) tools.set(b.id, item);
        items.push(item);
      }
      // thinking blocks are intentionally not shown
    });
  }
  return items;
}
