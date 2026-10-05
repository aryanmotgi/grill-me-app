// ---------------------------------------------------------------------------
// Ship (nav rail → Ship): the screen for the last two hours. The build is
// done; this is everything you need to present it.
//
// Nothing here is new data — it composes what Grill Me already has: the
// PITCH.<slug>.md the pitchdoc playbook writes, the live preview URL, the
// session's branch and diff, and the deck kit under ~/.grillme/deck-kit.
// Figures the project has not measured stay blank on purpose; this screen
// reports them as unfilled rather than inventing anything.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState } from "react";
import { useApp } from "../store";
import { Icon } from "./Icon";

const native = () => "__TAURI_INTERNALS__" in window;
async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

/** One section of a PITCH.<slug>.md, in the grammar the deck kit parses. */
type Section = {
  n: string;
  title: string;
  status: "green" | "amber" | "red" | "none";
  fields: Record<string, string>;
  rows: Record<string, string[][]>;
  /** Fields still holding [ brackets ] or a bare em dash. */
  blanks: string[];
};

const STATUS_CH: Record<string, Section["status"]> = { "🟢": "green", "🟡": "amber", "🔴": "red" };
const isBlank = (v: string) => /^\[.*\]$/.test(v.trim()) || v.trim() === "—";

export function parsePitch(md: string): Section[] {
  const out: Section[] = [];
  const parts = md.split(/^## (\d+) · (.*)$/m).slice(1);
  for (let i = 0; i < parts.length; i += 3) {
    const n = parts[i], head = parts[i + 1] ?? "", body = parts[i + 2] ?? "";
    const mark = Object.keys(STATUS_CH).find((c) => head.includes(c));
    const sec: Section = {
      n,
      title: head.replace(/[🟢🟡🔴]/g, "").trim(),
      status: mark ? STATUS_CH[mark] : "none",
      fields: {},
      rows: {},
      blanks: [],
    };
    let key: string | null = null;
    for (const raw of body.split("\n")) {
      const line = raw.trimEnd();
      if (/^>/.test(line) || /^_Done when:_/.test(line) || /^---/.test(line)) { key = null; continue; }
      const f = line.match(/^\*\*([^*]+):\*\*[ \t]*(.*)$/);
      if (f) {
        const name = f[1].trim(), val = f[2].trim();
        if (val) { sec.fields[name] = val; if (isBlank(val)) sec.blanks.push(name); key = null; }
        else { sec.rows[name] = []; key = name; }
        continue;
      }
      const li = line.match(/^-[ \t]+(.*)$/);
      if (li && key) {
        const cells = li[1].split("|").map((s) => s.trim());
        sec.rows[key].push(cells);
        if (cells.some(isBlank)) sec.blanks.push(`${key} row ${sec.rows[key].length}`);
      }
    }
    out.push(sec);
  }
  return out;
}

function Card({ title, hint, children, tone }: {
  title: string; hint?: string; children: React.ReactNode; tone?: "warn";
}) {
  return (
    <div className={`flex flex-col gap-3 rounded-lg p-4 bg-panel border ${tone === "warn" ? "border-warn" : "border-line"}`}>
      <div className="flex items-baseline gap-2">
        <span className="panel-label">{title}</span>
        {hint ? <span className="text-[11px] text-faint">{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}

function Cmd({ children }: { children: string }) {
  const toast = useApp((s) => s.toast);
  return (
    <button
      className="text-left font-mono text-[11px] leading-relaxed text-dim hover:text-ink bg-raised rounded px-2 py-1.5 cursor-pointer break-all"
      title="Copy"
      onClick={() => { navigator.clipboard?.writeText(children); toast("copied"); }}>
      {children}
    </button>
  );
}

export function ShipPage() {
  const members = useApp((s) => s.members);
  const activeId = useApp((s) => s.activeId);
  const setView = useApp((s) => s.setView);
  const openFile = useApp((s) => s.openFile);
  const previewUrl = useApp((s) => s.appSettings?.previewUrl as string | undefined);
  const member = members.find((m) => m.id === activeId) ?? members[0];
  const root = member?.repoPath ?? null;

  const [pitchFile, setPitchFile] = useState<string | null>(null);
  const [sections, setSections] = useState<Section[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [output, setOutput] = useState<{ script: string; text: string; ok: boolean } | null>(null);

  // Find a PITCH.<slug>.md at the repo root and parse it.
  const load = useCallback(async () => {
    if (!root || !native()) return;
    setErr(null);
    try {
      const entries = await invoke<{ name: string; dir: boolean }[]>("fs_list_dir", { root, rel: "" });
      const hit = entries.find((e) => !e.dir && /^PITCH\..+\.md$/i.test(e.name))
        ?? entries.find((e) => !e.dir && /^PITCH\.md$/i.test(e.name));
      if (!hit) { setPitchFile(null); setSections(null); return; }
      const text = await invoke<string>("fs_read_file", { root, rel: hit.name });
      setPitchFile(hit.name);
      setSections(parsePitch(text));
    } catch (e) {
      setErr(String(e));
    }
  }, [root]);

  useEffect(() => { void load(); }, [load]);

  const slug = useMemo(() => pitchFile?.replace(/^PITCH\.?/i, "").replace(/\.md$/i, "") || "project", [pitchFile]);

  const run = useCallback(async (script: string, layout?: string) => {
    if (!root || !pitchFile || !native()) return;
    setRunning(script);
    setOutput(null);
    try {
      const text = await invoke<string>("deck_kit_run", { script, repoPath: root, pitchFile, slug, layout: layout ?? null });
      setOutput({ script, text: text.trim() || "done", ok: true });
      if (script !== "readme.cjs") void load();
    } catch (e) {
      setOutput({ script, text: String(e), ok: false });
    } finally {
      setRunning(null);
    }
  }, [root, pitchFile, slug, load]);

  const writeReadme = useCallback(async (text: string) => {
    if (!root || !native()) return;
    try {
      await invoke("fs_write_file", { root, rel: "README.generated.md", content: text });
      setOutput({ script: "readme.cjs", text: `Wrote README.generated.md (${text.length.toLocaleString()} bytes).\n\nYour existing README.md is untouched. Compare them, then rename if you want it.`, ok: true });
    } catch (e) {
      setOutput({ script: "readme.cjs", text: String(e), ok: false });
    }
  }, [root]);

  const RunBtn = ({ script, label, layout }: { script: string; label: string; layout?: string }) => (
    <button className="btn primary" disabled={!pitchFile || running !== null}
      onClick={() => void run(script, layout)}>
      {running === script ? "running…" : label}
    </button>
  );

  const demo = sections?.find((s) => /demo path/i.test(s.title));
  const blanks = useMemo(() => (sections ?? []).filter((s) => s.blanks.length || s.status === "red"), [sections]);
  const ready = (sections?.length ?? 0) - blanks.length;

  if (!root) return <p className="p-4 text-[12px] text-faint">Start a session to see its ship screen.</p>;

  return (
    <div className="flex-1 min-h-0 overflow-auto">
      <div className="max-w-[1100px] w-full mx-auto p-6 flex flex-col gap-5">
        <div className="flex items-baseline gap-3">
          <h1 className="text-[18px] font-semibold text-ink">Ship</h1>
          <span className="text-[12px] text-faint">
            {pitchFile ? `from ${pitchFile}` : "no PITCH file yet"}
          </span>
          <span className="flex-1" />
          {pitchFile ? (
            <button className="btn" title="Open it in the editor"
              onClick={() => { setView("session"); openFile(pitchFile); }}>Open {pitchFile}</button>
          ) : null}
          <button className="btn" onClick={() => void load()}>refresh</button>
        </div>

        {err ? <p className="text-[11px] text-warn">{err}</p> : null}

        {!pitchFile ? (
          <Card title="Start here" hint="the source every other artefact is rendered from" tone="warn">
            <p className="text-[12px] text-dim leading-relaxed">
              There is no <span className="font-mono">PITCH.&lt;slug&gt;.md</span> in this repo yet. Open a session,
              pick the <b>Pitch doc</b> playbook from the <span className="font-mono">+</span> menu, and let it
              interview you. The deck, the README and the submission are all rendered from that one file.
            </p>
            <Cmd>{`cp ~/.grillme/deck-kit/PITCH.template.md PITCH.${slug}.md`}</Cmd>
          </Card>
        ) : null}

        <div className="grid grid-cols-2 gap-4">
          <Card title="Demo path" hint="the 90 seconds the judges see">
            {demo ? (
              <div className="flex flex-col gap-2">
                {demo.fields["Must work"] ? (
                  <p className="text-[13px] text-ink leading-relaxed">
                    <span className="text-faint">must work · </span>{demo.fields["Must work"]}
                  </p>
                ) : null}
                {(demo.rows["Steps"] ?? []).map((r, i) => (
                  <div key={i} className="flex gap-2 text-[12px]">
                    <span className="font-mono text-faint flex-none w-16">{r[0]}</span>
                    <span className="text-dim flex-1">{r[1]}</span>
                    <span className="text-faint flex-1">{r[2]}</span>
                  </div>
                ))}
                {demo.fields["Fallback"] ? (
                  <p className="text-[12px] text-warn leading-relaxed">
                    <span className="text-faint">if it breaks · </span>{demo.fields["Fallback"]}
                  </p>
                ) : null}
                {demo.blanks.length ? (
                  <p className="text-[11px] text-warn">{demo.blanks.length} field(s) still unwritten — decide these before you present.</p>
                ) : null}
              </div>
            ) : (
              <p className="text-[12px] text-faint">§14 of the pitch holds the demo path. Not written yet.</p>
            )}
          </Card>

          <Card title="Live preview" hint="what you will actually show">
            <p className="font-mono text-[12px] text-dim">{previewUrl || "no preview URL set"}</p>
            <div className="flex gap-2">
              <button className="btn primary" onClick={() => setView("preview")}>Open preview</button>
            </div>
            <p className="text-[11px] text-faint leading-relaxed">
              Shoot the screenshots before the panic, not after:
            </p>
            <Cmd>{`~/.grillme/deck-kit/capture.sh ${previewUrl || "http://localhost:5432"} shots/app.png`}</Cmd>
          </Card>
        </div>

        <Card
          title="Pitch readiness"
          hint={sections ? `${ready}/${sections.length} sections ready` : undefined}
          tone={blanks.length ? "warn" : undefined}>
          {!sections ? (
            <p className="text-[12px] text-faint">Nothing to check yet.</p>
          ) : blanks.length === 0 ? (
            <p className="text-[12px] text-ok">Every section is filled. Build the deck.</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {blanks.map((s) => (
                <div key={s.n} className="flex gap-2 text-[12px]">
                  <span className="text-faint flex-none w-7">§{s.n}</span>
                  <span className="text-ink flex-none w-44 truncate">{s.title}</span>
                  <span className="text-warn flex-1">
                    {s.blanks.length ? s.blanks.join(", ") : "marked not yet solid"}
                  </span>
                </div>
              ))}
              <p className="text-[11px] text-faint mt-1">
                Never fill one of these with a guess — an empty section beats an invented number.
              </p>
            </div>
          )}
        </Card>

        <div className="grid grid-cols-3 gap-4">
          <Card title="Deck" hint="13 slides, 3 themes, diagrams inlined">
            <div className="flex gap-2">
              <RunBtn script="pitch-to-project.cjs" label="1 · Read the pitch" />
              <RunBtn script="build.cjs" label="2 · Build slides" />
            </div>
            <Cmd>{`node ~/.grillme/deck-kit/pitch-to-project.cjs ${pitchFile ?? "PITCH.<slug>.md"} ${slug} --write`}</Cmd>
            <Cmd>{`node ~/.grillme/deck-kit/build.cjs ${slug}`}</Cmd>
            <p className="text-[11px] text-faint leading-relaxed">
              Writes carbon / press / signal to ~/.grillme/deck-kit/out — publish one as a slide deck.
            </p>
          </Card>

          <Card title="README" hint="same source as the deck, so they cannot drift">
            <div className="flex gap-2 flex-wrap">
              <RunBtn script="readme.cjs" label="Showcase" layout="showcase" />
              <RunBtn script="readme.cjs" label="Dev tool" layout="dev-tool" />
              <RunBtn script="readme.cjs" label="Plain" layout="plain" />
            </div>
            <Cmd>{`node ~/.grillme/deck-kit/readme.cjs ${pitchFile ?? "PITCH.<slug>.md"} > README.md`}</Cmd>
            <p className="text-[11px] text-faint leading-relaxed">
              Three layouts from the readme kit. Showcase has the logo, badges, hero image and
              feature grid; dev tool is leaner; plain is prose only. Blocks the pitch has not
              answered are deleted, not printed as placeholders.
            </p>
          </Card>

          <Card title="Check before you call it done">
            <RunBtn script="catalog.cjs" label="Run the audit" />
            <Cmd>{`node ~/.grillme/deck-kit/catalog.cjs ${slug}`}</Cmd>
            <div className="flex flex-col gap-1 text-[12px] text-dim">
              <span>· the demo path runs twice, on this machine</span>
              <span>· every number on a slide can be reproduced live</span>
              <span>· the why-us line is written</span>
            </div>
          </Card>
        </div>

        {output ? (
          <Card title={output.ok ? `${output.script} — output` : `${output.script} — failed`}
            tone={output.ok ? undefined : "warn"}>
            <pre className="font-mono text-[11px] leading-relaxed text-dim whitespace-pre-wrap max-h-[320px] overflow-auto">{output.text}</pre>
            {output.ok && output.script === "readme.cjs" ? (
              <div className="flex gap-2 items-center flex-wrap">
                <button className="btn" onClick={() => { navigator.clipboard?.writeText(output.text); }}>
                  Copy
                </button>
                <button className="btn primary" onClick={() => void writeReadme(output.text)}>
                  Write README.generated.md
                </button>
                <span className="text-[11px] text-faint">
                  Written beside your existing README so nothing is overwritten — diff it, then rename.
                </span>
              </div>
            ) : null}
          </Card>
        ) : null}

        <div className="flex items-center gap-2 text-[11px] text-faint">
          <Icon name="note" size={12} />
          <span>Everything here reads {pitchFile ?? "your pitch file"} and ~/.grillme/deck-kit. Edit the pitch, press refresh.</span>
        </div>
      </div>
    </div>
  );
}
