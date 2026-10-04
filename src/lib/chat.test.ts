import { describe, expect, it } from "vitest";
import { modelLabel, parseTranscript, toRows, toolSummary, userText, isTestCommand } from "./chat";

const L = (o: unknown) => JSON.stringify(o);

describe("userText", () => {
  it("renders slash commands and hides local command noise", () => {
    expect(userText("<command-name>/grillme</command-name><command-args>--orient</command-args>")).toBe("/grillme --orient");
    expect(userText("<local-command-stdout>ok</local-command-stdout>")).toBeNull();
  });
  it("strips system reminders", () => {
    expect(userText("hi<system-reminder>secret</system-reminder>")).toBe("hi");
    expect(userText("<system-reminder>x</system-reminder>")).toBeNull();
  });
});

describe("toolSummary", () => {
  it("summarizes common tools", () => {
    expect(toolSummary("Read", { file_path: "/a/b/App.tsx" })).toBe("Read App.tsx");
    expect(toolSummary("Bash", { command: "npm test\nmore" })).toBe("Ran npm test");
    expect(toolSummary("Bash", { command: "x", description: "Run tests" })).toBe("Run tests");
    expect(toolSummary("mcp__github__create_pr", {})).toBe("create_pr");
  });
});

describe("parseTranscript", () => {
  const lines = [
    L({ type: "permission-mode" }),
    L({ type: "user", uuid: "u1", message: { role: "user", content: "fix the bug" } }),
    L({ type: "assistant", uuid: "a1", message: { content: [{ type: "thinking", thinking: "hmm" }] } }),
    L({ type: "assistant", uuid: "a2", message: { content: [{ type: "text", text: "Looking." }] } }),
    L({ type: "assistant", uuid: "a3", message: { content: [{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "/x/y.ts" } }] } }),
    L({ type: "user", uuid: "u2", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "file body" }] } }),
    L({ type: "assistant", uuid: "a4", message: { content: [{ type: "text", text: "Done." }] } }),
    L({ type: "user", uuid: "m", isMeta: true, message: { content: "meta" } }),
    L({ type: "assistant", uuid: "s", isSidechain: true, message: { content: [{ type: "text", text: "sub" }] } }),
    "not json",
  ];
  const items = parseTranscript(lines);

  it("orders user, assistant, tool, assistant and skips noise", () => {
    expect(items.map((i) => i.kind)).toEqual(["user", "assistant", "tool", "assistant"]);
  });
  it("attaches tool results to their call", () => {
    const tool = items[2];
    expect(tool.kind === "tool" && tool.summary).toBe("Read y.ts");
    expect(tool.kind === "tool" && tool.result).toBe("file body");
  });
  it("merges consecutive assistant text blocks", () => {
    const merged = parseTranscript([
      L({ type: "assistant", uuid: "a", message: { content: [{ type: "text", text: "one" }] } }),
      L({ type: "assistant", uuid: "b", message: { content: [{ type: "text", text: "two" }] } }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].kind === "assistant" && merged[0].text).toBe("one\n\ntwo");
  });
  it("turns task notifications into notes", () => {
    const it = parseTranscript([L({ type: "user", uuid: "u", message: { content: "<task-notification><summary>Build done</summary></task-notification>" } })]);
    expect(it[0]).toMatchObject({ kind: "note", text: "Build done" });
  });
  it("counts pasted images on user messages", () => {
    const it = parseTranscript([L({ type: "user", uuid: "u", message: { content: [{ type: "text", text: "see" }, { type: "image" }] } })]);
    expect(it[0]).toMatchObject({ kind: "user", text: "see", images: 1 });
  });
});

describe("modelLabel", () => {
  it("prettifies model ids", () => {
    expect(modelLabel("claude-opus-4-8")).toBe("Opus 4.8");
    expect(modelLabel("claude-sonnet-5")).toBe("Sonnet 5");
    expect(modelLabel("claude-haiku-4-5-20251001")).toBe("Haiku 4.5");
    expect(modelLabel(undefined)).toBe("Claude");
  });
});

describe("toRows", () => {
  const t = (s: number) => `2026-09-28T10:00:${String(s).padStart(2, "0")}Z`;
  const lines = [
    L({ type: "user", uuid: "u1", timestamp: t(0), message: { content: "go" } }),
    L({ type: "assistant", uuid: "a1", timestamp: t(2), message: { model: "claude-opus-4-8", content: [{ type: "tool_use", id: "x", name: "Read", input: {} }] } }),
    L({ type: "assistant", uuid: "a2", timestamp: t(4), message: { model: "claude-opus-4-8", content: [{ type: "tool_use", id: "y", name: "Bash", input: { command: "ls" } }] } }),
    L({ type: "assistant", uuid: "a3", timestamp: t(17), message: { model: "claude-opus-4-8", content: [{ type: "text", text: "done" }] } }),
  ];
  it("groups tool runs and closes finished turns with worked-for", () => {
    const rows = toRows(parseTranscript(lines), false);
    expect(rows.map((r) => r.kind)).toEqual(["item", "tools", "item", "worked"]);
    const g = rows[1];
    expect(g.kind === "tools" && g.tools.length).toBe(2);
    expect(rows[3]).toMatchObject({ kind: "worked", model: "Opus 4.8", seconds: 17, ask: "go", reply: "done" });
  });
  it("leaves the live turn open while working", () => {
    expect(toRows(parseTranscript(lines), true).some((r) => r.kind === "worked")).toBe(false);
  });
});

describe("turn receipts", () => {
  const L = (o: unknown) => JSON.stringify(o);
  const t = (s: number) => new Date(1_790_000_000_000 + s * 1000).toISOString();
  const lines = [
    L({ type: "user", uuid: "u1", timestamp: t(0), message: { content: "add login" } }),
    L({ type: "assistant", uuid: "a1", timestamp: t(2), message: { id: "m1", model: "claude-opus-4-8", usage: { input_tokens: 10, output_tokens: 50, cache_read_input_tokens: 1000 }, content: [{ type: "tool_use", id: "t1", name: "Edit", input: { file_path: "/x/src/Login.tsx" } }] } }),
    L({ type: "assistant", uuid: "a1b", timestamp: t(3), message: { id: "m1", model: "claude-opus-4-8", usage: { input_tokens: 10, output_tokens: 50, cache_read_input_tokens: 1000 }, content: [{ type: "tool_use", id: "t2", name: "Write", input: { file_path: "/x/src/auth.ts" } }] } }),
    L({ type: "user", uuid: "r1", timestamp: t(4), message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }, { type: "tool_result", tool_use_id: "t2", content: "ok" }] } }),
    L({ type: "assistant", uuid: "a2", timestamp: t(6), message: { id: "m2", model: "claude-opus-4-8", usage: { input_tokens: 5, output_tokens: 20, cache_read_input_tokens: 2000 }, content: [{ type: "tool_use", id: "t3", name: "Bash", input: { command: "npm test" } }] } }),
    L({ type: "user", uuid: "r2", timestamp: t(9), message: { content: [{ type: "tool_result", tool_use_id: "t3", content: "1 failed", is_error: true }] } }),
    L({ type: "assistant", uuid: "a3", timestamp: t(12), message: { id: "m3", model: "claude-opus-4-8", usage: { input_tokens: 1, output_tokens: 30, cache_read_input_tokens: 2100 }, content: [{ type: "text", text: "Login added, one test fails." }] } }),
  ];

  it("closes a turn with the files, tests and tokens it used", () => {
    const rows = toRows(parseTranscript(lines), false);
    const r = rows.find((x) => x.kind === "worked");
    if (r?.kind !== "worked") throw new Error("no receipt");
    expect(r.ask).toBe("add login");
    expect(r.files).toEqual(["Login.tsx", "auth.ts"]);
    expect(r.tests).toBe("fail");
    expect(r.seconds).toBe(12);
    // the repeated usage of call m1 counts once
    expect(r.usage).toEqual({ input: 16, output: 100, cacheRead: 5100, cacheWrite: 0 });
    expect(r.modelId).toBe("claude-opus-4-8");
  });

  it("recognises test commands", () => {
    for (const c of ["npm test", "npm run test -- --watch=false", "npx vitest run", "cargo test", "go test ./...", "pytest -q"]) expect(isTestCommand(c)).toBe(true);
    for (const c of ["npm run build", "git status", "ls tests/"]) expect(isTestCommand(c)).toBe(false);
  });
});

describe("compact summaries", () => {
  it("show as one quiet note, not a giant message from you", () => {
    const items = parseTranscript([JSON.stringify({ type: "user", uuid: "s", isCompactSummary: true, message: { content: "This session is being continued from a previous conversation…" } })]);
    expect(items).toEqual([{ kind: "note", id: "s", text: "Conversation compacted: earlier turns summarised to save tokens" }]);
  });
});
