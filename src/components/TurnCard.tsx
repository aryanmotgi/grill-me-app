import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import { Markdown } from "./Markdown";

// ---------------------------------------------------------------------------
// "What just happened": opened from a turn's receipt. Claude Code reads the
// turn's real diff (save point to save point) and says what changed, why,
// what each file got, what could break, and how to check it. "Teach me"
// explains the one idea behind the change. Answers are cached on disk, so
// opening a card again is instant and free.
// ---------------------------------------------------------------------------

export interface TurnSpan { from: string; until?: string }

interface Card { what: string; why: string; files: { file: string; change: string }[]; risks: string[]; check: string }
interface Explained { card?: Card; lesson?: string }

const memo = new Map<string, Explained>();

async function explain(repoPath: string, span: TurnSpan, ask: string, reply: string, mode: "card" | "teach", fresh = false): Promise<Explained> {
  const key = `${repoPath}|${span.from}|${span.until ?? "now"}|${mode}`;
  // the latest turn ("now") can still change: only memo bounded turns
  const hit = !fresh && span.until ? memo.get(key) : undefined;
  if (hit) return hit;
  const { invoke } = await import("@tauri-apps/api/core");
  const out = await invoke<Explained>("turn_explain", { repoPath, from: span.from, until: span.until ?? null, ask, reply, mode, fresh });
  memo.set(key, out);
  return out;
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10.5px] tracking-[0.12em] uppercase text-faint font-semibold">{label}</span>
      {children}
    </div>
  );
}

export function TurnCard({ repoPath, span, ask, reply, onClose }: { repoPath: string; span: TurnSpan; ask: string; reply: string; onClose: () => void }) {
  const [card, setCard] = useState<Card | null>(null);
  const [lesson, setLesson] = useState<string | null>(null);
  const [busy, setBusy] = useState<"card" | "teach" | null>("card");
  const [error, setError] = useState<string | null>(null);

  const run = (mode: "card" | "teach", fresh = false) => {
    setBusy(mode);
    setError(null);
    explain(repoPath, span, ask, reply, mode, fresh).then(
      (r) => { if (mode === "card") setCard(r.card ?? null); else setLesson(r.lesson ?? null); },
      (e) => setError(/not found|command -v/i.test(String(e)) ? "Claude Code isn't installed, so this can't be explained." : String(e)),
    ).finally(() => setBusy(null));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { run("card"); }, [repoPath, span.from, span.until]);

  return (
    <div className="turn-card rounded-xl border border-line bg-raised/30 px-4 py-3.5 mb-3 flex flex-col gap-3 text-[13px] select-text" role="region" aria-label="What just happened">
      <div className="flex items-center gap-2">
        <Icon name="spark" size={12} className="text-accent" />
        <span className="text-[12px] font-semibold text-ink flex-1">What just happened</span>
        {card && !busy ? (
          <button className="text-[11.5px] text-faint hover:text-ink cursor-pointer" title="Read the changes again" onClick={() => run("card", true)}>Redo</button>
        ) : null}
        <button className="text-faint hover:text-ink cursor-pointer px-1" aria-label="Close" onClick={onClose}>×</button>
      </div>

      {busy === "card" ? <p className="text-faint text-[12.5px] chat-pulse">Reading what changed…</p> : null}
      {error ? <p className="text-danger text-[12.5px]">{error}</p> : null}

      {card ? (
        <>
          <p className="text-ink leading-relaxed">{card.what}</p>
          {card.why ? <p className="text-dim leading-relaxed">{card.why}</p> : null}
          {card.files.length ? (
            <Section label="Files">
              <ul className="flex flex-col gap-1">
                {card.files.map((f) => (
                  <li key={f.file} className="flex gap-3 min-w-0 text-[12.5px]">
                    <span className="font-mono text-dim truncate max-w-[45%] flex-none" title={f.file}>{f.file}</span>
                    <span className="text-faint min-w-0">{f.change}</span>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
          {card.risks.length ? (
            <Section label="Watch out">
              <ul className="flex flex-col gap-1">
                {card.risks.map((r) => <li key={r} className="text-warn text-[12.5px] leading-snug">{r}</li>)}
              </ul>
            </Section>
          ) : null}
          {card.check ? <Section label="Check it"><p className="text-dim text-[12.5px] leading-snug">{card.check}</p></Section> : null}

          {lesson ? (
            <div className="border-t border-line pt-3 text-[13px] leading-[1.65] text-dim"><Markdown text={lesson} /></div>
          ) : (
            <button className="self-start composer-btn h-8 flex items-center gap-1.5" disabled={busy === "teach"} onClick={() => run("teach")}
              title="The one idea behind this change, explained from the start">
              <Icon name="bulb" size={12} /> {busy === "teach" ? "Writing your lesson…" : "Teach me"}
            </button>
          )}
        </>
      ) : null}
    </div>
  );
}
