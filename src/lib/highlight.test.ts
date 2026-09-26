import { describe, expect, it } from "vitest";
import { highlightLine, langForFile } from "./highlight";

describe("langForFile", () => {
  it("maps common extensions to languages", () => {
    expect(langForFile("src/App.tsx")).toBe("typescript");
    expect(langForFile("lib.rs")).toBe("rust");
    expect(langForFile("main.py")).toBe("python");
    expect(langForFile("data.json")).toBe("json");
    expect(langForFile("run.sh")).toBe("bash");
    expect(langForFile("Dockerfile")).toBe("bash");
  });
  it("returns null for unknown / extensionless files", () => {
    expect(langForFile("LICENSE")).toBeNull();
    expect(langForFile("notes.xyz")).toBeNull();
  });
});

describe("highlightLine", () => {
  it("wraps recognized tokens in hljs spans", () => {
    const html = highlightLine("const x = 1;", "typescript");
    expect(html).toContain("hljs-keyword");
    expect(html).toContain("const");
  });
  it("escapes HTML so file contents can't inject markup", () => {
    const html = highlightLine("<script>alert(1)</script>", null);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
  it("falls back to escaped plain text when no language", () => {
    expect(highlightLine("a & b < c", null)).toBe("a &amp; b &lt; c");
  });
});
