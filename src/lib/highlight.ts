// ---------------------------------------------------------------------------
// Syntax highlighting for the editor pane. We register only the languages a
// coding workspace actually hits (keeps the bundle small vs the full auto
// build) and map a filename to one of them. highlight.js is synchronous and
// has no WASM, so it never blocks a frame or trips the app CSP.
// ---------------------------------------------------------------------------
import hljs from "highlight.js/lib/core";
import typescript from "highlight.js/lib/languages/typescript";
import javascript from "highlight.js/lib/languages/javascript";
import rust from "highlight.js/lib/languages/rust";
import python from "highlight.js/lib/languages/python";
import json from "highlight.js/lib/languages/json";
import css from "highlight.js/lib/languages/css";
import xml from "highlight.js/lib/languages/xml";
import bash from "highlight.js/lib/languages/bash";
import markdown from "highlight.js/lib/languages/markdown";
import go from "highlight.js/lib/languages/go";
import ruby from "highlight.js/lib/languages/ruby";
import yaml from "highlight.js/lib/languages/yaml";
import sql from "highlight.js/lib/languages/sql";
import toml from "highlight.js/lib/languages/ini";

hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("python", python);
hljs.registerLanguage("json", json);
hljs.registerLanguage("css", css);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("go", go);
hljs.registerLanguage("ruby", ruby);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("ini", toml);

const EXT_TO_LANG: Record<string, string> = {
  ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript",
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  rs: "rust", py: "python", json: "json", css: "css", scss: "css",
  html: "xml", xml: "xml", svg: "xml", vue: "xml",
  sh: "bash", bash: "bash", zsh: "bash",
  md: "markdown", markdown: "markdown",
  go: "go", rb: "ruby", yml: "yaml", yaml: "yaml",
  sql: "sql", toml: "ini", ini: "ini", conf: "ini",
};

/** Language id for a filename, or null when we have no highlighter for it. */
export function langForFile(filename: string): string | null {
  const base = filename.split("/").pop() ?? filename;
  if (base === "Dockerfile") return "bash";
  const ext = base.includes(".") ? base.split(".").pop()!.toLowerCase() : "";
  return EXT_TO_LANG[ext] ?? null;
}

/**
 * Highlight one line of code to an HTML string, given the file's language.
 * Highlighting per-line (rather than the whole file) keeps the line-number
 * gutter aligned and lets a huge file render row-by-row without a giant DOM
 * node. Falls back to escaped plain text when there's no language or on error.
 * NOTE: per-line highlighting can't carry multi-line constructs (block
 * comments, template strings) across rows — an acceptable trade for gutter
 * alignment and virtualization-friendliness in a viewer.
 */
export function highlightLine(line: string, lang: string | null): string {
  if (!lang) return escapeHtml(line);
  try {
    return hljs.highlight(line, { language: lang, ignoreIllegals: true }).value;
  } catch {
    return escapeHtml(line);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
