// The Spark, inside the app (top of the DNA page, and a small pill anywhere):
// notices from your Coding DNA, and "Ask the Spark" answered by your AI with
// your DNA as context. Anything it offers to remember is saved only if you
// click Save.

import { useState } from "react";
import { useApp } from "../store";
import { Icon } from "./Icon";
import { useDNA } from "../lib/dnaStore";
import { addItem, setHelped, type CodingDNA } from "../lib/dna";
import { SPARK_SCHEMA, SPARK_SYSTEM, notices, parseSpark, quietNotice, sparkPrompt, type Notice, type SparkAnswer } from "../lib/spark";
import { interviewBrainOf } from "../lib/aiConnect";
import { BRAIN_NAMES } from "../lib/interview";

const native = () => "__TAURI_INTERNALS__" in window;
async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export function SparkPanel({ dna, go }: { dna: CodingDNA; go: (to: "rules" | "evolutions" | "toolkit") => void }) {
  const update = useDNA((s) => s.update);
  const brain = useApp((s) => interviewBrainOf(s.appSettings.interviewBrain));
  const name = BRAIN_NAMES[brain] ?? "your AI";
  const list = notices(dna);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [a, setA] = useState<SparkAnswer | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<string[]>([]);
  const canAsk = native() && brain !== "form";

  const act = (n: Notice, x: Notice["actions"][number]) => {
    if (x === "dismiss") return update((d) => quietNotice(d, n.id));
    if (x.startsWith("helped-") && n.ref) return update((d) => setHelped(d, n.ref!, x.slice(7) as "yes" | "no" | "unsure"));
    if (x === "open-rules") return go("rules");
    if (x === "open-evolutions") return go("evolutions");
    if (x === "open-toolkit") return go("toolkit");
  };
  const ask = async () => {
    const question = q.trim();
    if (!question || !canAsk) return;
    setBusy(true); setError(""); setA(null); setSaved([]);
    try {
      const raw = await invoke<unknown>("interview_turn", { brain, system: SPARK_SYSTEM, prompt: sparkPrompt(dna, question), schema: JSON.stringify(SPARK_SCHEMA) });
      const r = parseSpark(raw);
      if (!r) throw new Error("The answer came back empty");
      setA(r);
    } catch (e) { setError(`${name} couldn't answer: ${`${e}`.replace(/^UPDATE: /, "")}`); } finally { setBusy(false); }
  };
  const LABEL: Record<string, string> = { "helped-yes": "Yes", "helped-no": "No", "helped-unsure": "Not sure", "open-rules": "Review rules", "open-evolutions": "See Evolutions", "open-toolkit": "See toolkit", dismiss: "Dismiss" };

  return (
    <div className="composer-card rounded-xl px-4 py-3.5 flex flex-col gap-3 border-accent/30">
      <div className="flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-full bg-accent shadow-[0_0_10px_var(--accent)]" aria-hidden />
        <span className="text-[13.5px] font-semibold text-ink flex-1">Spark</span>
        {list.length ? <span className="text-[11.5px] text-faint num">{list.length} thing{list.length === 1 ? "" : "s"} to look at</span> : null}
      </div>
      {list.length ? (
        <div className="flex flex-col gap-2">
          {list.map((n) => (
            <div key={n.id} className="flex items-start gap-3">
              <span className={`text-[10.5px] tracking-[0.08em] uppercase pt-0.5 w-16 flex-none ${n.kind === "win" ? "text-ok" : n.kind === "struggle" ? "text-warn" : "text-faint"}`}>{n.kind === "checkin" ? "Check-in" : n.kind === "rules" ? "Rules" : n.kind === "struggle" ? "Noticed" : n.kind === "idle" ? "Unused" : "Win"}</span>
              <span className="flex-1 text-[13px] text-dim">{n.text}</span>
              <span className="flex items-center gap-1.5 flex-wrap justify-end">
                {n.actions.map((x) => <button key={x} className={x === "dismiss" ? "text-[12px] text-faint hover:text-ink" : "composer-btn"} onClick={() => act(n, x)}>{LABEL[x]}</button>)}
              </span>
            </div>
          ))}
        </div>
      ) : <div className="text-[12.5px] text-faint">Nothing needs you right now. The Spark keeps watching your sessions for patterns.</div>}
      <div className="flex items-center gap-2 border-t border-line pt-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void ask(); }} maxLength={1000} disabled={!canAsk}
          placeholder={canAsk ? "Ask the Spark about your setup, e.g. “How do I stop flaky tests eating my afternoons?”" : native() ? "Connect an AI in setup to ask the Spark" : "Asking runs in the desktop app"}
          className="flex-1 bg-transparent border border-line rounded-lg px-3 h-9 text-[13px] outline-none focus:border-accent/70 disabled:opacity-60" />
        <button className="composer-btn" disabled={!canAsk || busy || !q.trim()} onClick={() => void ask()}>{busy ? <span className="spinner" /> : <Icon name="spark" size={11} />} Ask</button>
      </div>
      {error ? <div className="text-[12.5px] text-warn">{error}</div> : null}
      {a ? (
        <div className="flex flex-col gap-2">
          <div className="text-[13.5px] text-ink whitespace-pre-wrap">{a.answer}</div>
          {a.remember.map((m) => (
            <div key={m.text} className="flex items-center gap-2 text-[12.5px]">
              <span className="text-faint flex-1">Worth remembering ({m.strand}): <span className="text-dim">{m.text}</span></span>
              {saved.includes(m.text) ? <span className="text-ok">Saved</span> : (
                <button className="composer-btn" onClick={() => { update((d) => addItem(d, m.strand, m.text, { source: "spark" })); setSaved([...saved, m.text]); }}>Save to DNA</button>
              )}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** A small "Spark · 3" pill anywhere in the app when there's something to look at. */
export function SparkPill() {
  const dna = useDNA((s) => s.dna);
  const view = useApp((s) => s.view);
  if (!dna || view === "dna") return null;
  const n = notices(dna).length;
  if (!n) return null;
  return (
    <button className="fixed left-4 bottom-12 z-50 flex items-center gap-2 h-8 px-3 rounded-full text-[12.5px] border border-accent/50 bg-[rgba(30,18,14,.9)] text-ink shadow-lg hover:border-accent cursor-pointer"
      onClick={() => useApp.getState().setView("dna")} title="The Spark noticed something in your Coding DNA">
      <span className="w-2 h-2 rounded-full bg-accent shadow-[0_0_8px_var(--accent)]" aria-hidden /> Spark <span className="num text-faint">{n}</span>
    </button>
  );
}
