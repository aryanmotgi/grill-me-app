import { describe, expect, it } from "vitest";
import { buildTranscript, stripAnsi, transcriptFilename } from "./transcript";

describe("stripAnsi", () => {
  it("removes CSI colour/cursor sequences but keeps the text", () => {
    expect(stripAnsi("\x1b[31mred\x1b[0m text")).toBe("red text");
    expect(stripAnsi("\x1b[2J\x1b[Hhello")).toBe("hello");
  });
  it("removes OSC sequences (titles / hyperlinks)", () => {
    expect(stripAnsi("\x1b]0;my title\x07done")).toBe("done");
    expect(stripAnsi("\x1b]8;;http://x\x1b\\link\x1b]8;;\x1b\\")).toBe("link");
  });
  it("drops carriage returns and stray control bytes, keeps newlines and tabs", () => {
    expect(stripAnsi("a\rb\nc\td")).toBe("ab\nc\td");
    expect(stripAnsi("x\x00\x07y")).toBe("xy");
  });
});

describe("buildTranscript", () => {
  const meta = { name: "mei", branch: "feature/inbox", at: Date.UTC(2026, 8, 15, 13, 45, 30) };

  it("renders a header with name, branch, timestamp and a fenced body", () => {
    const md = buildTranscript("\x1b[32m$ ls\x1b[0m\nfile.ts", meta);
    expect(md).toContain("# Session transcript — mei");
    expect(md).toContain("**Branch:** `feature/inbox`");
    expect(md).toContain("2026-09-15 13:45:30 UTC");
    expect(md).toContain("```text\n$ ls\nfile.ts\n```");
  });

  it("omits the branch line when branch is missing or a placeholder", () => {
    expect(buildTranscript("out", { name: "x", branch: "—", at: 0 })).not.toContain("Branch");
    expect(buildTranscript("out", { name: "x", at: 0 })).not.toContain("Branch");
  });

  it("collapses excess blank lines and trims trailing whitespace", () => {
    const md = buildTranscript("a\n\n\n\nb\n\n\n", meta);
    expect(md).toContain("a\n\nb");
    expect(md.endsWith("```\n")).toBe(true);
  });

  it("gives an honest placeholder when there is no output", () => {
    const md = buildTranscript("\x1b[0m\r\n", meta);
    expect(md).toContain("_(no terminal output captured)_");
    expect(md).not.toContain("```");
  });
});

describe("transcriptFilename", () => {
  it("slugifies the name and stamps the local date", () => {
    const at = new Date(2026, 8, 5, 9, 0, 0).getTime();
    expect(transcriptFilename("Mei Chen", at)).toBe("transcript-mei-chen-20260905.md");
  });
  it("falls back to 'session' for an empty slug", () => {
    expect(transcriptFilename("!!!", 0)).toMatch(/^transcript-session-\d{8}\.md$/);
  });
});
