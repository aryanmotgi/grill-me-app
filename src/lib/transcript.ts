// ---------------------------------------------------------------------------
// Export session transcript: turn a raw pty scrollback (ANSI-laden terminal
// bytes, already base64-decoded to a string) into a clean Markdown document.
// Pure + tested — the SessionPane just reads pty_scrollback, decodes base64,
// and pipes the text through here before handing the result to the save dialog.
// ---------------------------------------------------------------------------

/**
 * Strip ANSI/VT control sequences and bare control chars from terminal output,
 * leaving readable text. Mirrors the Rust `strip_ansi_stateless` intent (CSI,
 * OSC, and lone escapes) but for the already-decoded JS string, plus it drops
 * carriage returns so spinner repaints don't leave `\r` artifacts.
 */
export function stripAnsi(input: string): string {
  return input
    // cursor-forward ("ESC[3C") stands in for spaces in TUIs: keep the gap
    .replace(/\x1b\[(\d*)C/g, (_, n: string) => " ".repeat(Math.min(400, Number(n) || 1)))
    // CSI sequences: ESC [ ... final-byte  (colors, cursor moves, erase, …)
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    // OSC sequences: ESC ] ... (BEL | ESC \)  (window titles, hyperlinks, …)
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    // any other two-char escape (ESC + single byte)
    .replace(/\x1b[@-Z\\-_]/g, "")
    // collapse CR (keep LF); drop remaining C0 controls except tab/newline
    .replace(/\r/g, "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
}

export interface TranscriptMeta {
  /** session / member display name */
  name: string;
  /** git branch, or "—" when unknown */
  branch?: string;
  /** epoch ms the export was taken */
  at: number;
}

/** Format epoch ms as a stable, human ISO-ish stamp (UTC) for the header. */
function stamp(at: number): string {
  return new Date(at).toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

/**
 * Build the Markdown document: a titled header with the session name, branch,
 * and export time, then the stripped scrollback inside a fenced code block so
 * paths and output render verbatim. Trailing blank lines are trimmed.
 */
export function buildTranscript(rawScrollback: string, meta: TranscriptMeta): string {
  const body = stripAnsi(rawScrollback).replace(/\n{3,}/g, "\n\n").trimEnd();
  const branch = meta.branch && meta.branch !== "—" ? meta.branch : null;
  const header = [
    `# Session transcript — ${meta.name}`,
    "",
    branch ? `- **Branch:** \`${branch}\`` : null,
    `- **Exported:** ${stamp(meta.at)}`,
    "",
    "---",
    "",
  ].filter((l) => l !== null);
  const content = body.length > 0 ? body : "_(no terminal output captured)_";
  const fenced = body.length > 0 ? "```text\n" + content + "\n```" : content;
  return header.join("\n") + fenced + "\n";
}

/** A safe default filename for the save dialog, e.g. transcript-mei-20260915.md */
export function transcriptFilename(name: string, at: number): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "session";
  const d = new Date(at);
  const date = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  return `transcript-${slug}-${date}.md`;
}
