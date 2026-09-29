import { describe, expect, it } from "vitest";
import { parseTranscript, toolSummary, userText } from "./chat";

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
    expect(toolSummary("Bash", { command: "x", description: "Run tests" })).toBe("Ran Run tests");
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
