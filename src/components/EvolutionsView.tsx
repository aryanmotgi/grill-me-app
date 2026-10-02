// ---------------------------------------------------------------------------
// Evolutions (DNA page → Evolutions): the top 3 upgrades for how you work,
// each with why (your words), how it fits, and your workflow before/after;
// bundles that work together; Explore more by kind; and what you tried.
// Your AI rewrites the three "why" lines once (grounded in your DNA), when
// one is connected; otherwise the built-in reasons stand.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from "react";
import { useApp } from "../store";
import { Icon } from "./Icon";
import { useDNA } from "../lib/dnaStore";
import { dismissEvolution, dnaBrief, logEvolutions, setHelped, type CodingDNA } from "../lib/dna";
import { CATEGORY_NAMES, POLISH_SCHEMA, applyPolish, evolve, pathWith, polishPrompt, type EvolutionPick } from "../lib/evolutions";
import { profileOf, toolsYouHave, emptyProfile, type WorkflowProfile } from "../lib/profile";
import { builtinCatalog, loadCatalog } from "../lib/catalogLoad";
import type { Catalog, CatalogEntry } from "../lib/catalog";
import type { ScanResult } from "../lib/scan";
import { interviewBrainOf } from "../lib/aiConnect";

const native = () => "__TAURI_INTERNALS__" in window;
async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}
async function openUrl(url: string) {
  if (!native()) { window.open(url, "_blank"); return; }
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  await openUrl(url).catch(() => {});
}
/** One polish per set of picks per app run. */
const polished = new Map<string, EvolutionPick[]>();

export function EvolutionsView({ dna }: { dna: CodingDNA }) {
  const update = useDNA((s) => s.update);
  const toast = useApp((s) => s.toast);
  const saved = useApp((s) => s.appSettings.workflowProfile);
  const brain = useApp((s) => interviewBrainOf(s.appSettings.interviewBrain));
  const [catalog, setCatalog] = useState<Catalog>(builtinCatalog);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [cat, setCat] = useState<string>("");
  const [freeOnly, setFreeOnly] = useState(false);
  const [quick, setQuick] = useState(false);
  const [top, setTop] = useState<EvolutionPick[] | null>(null);
  useEffect(() => {
    void loadCatalog().then(setCatalog).catch(() => {});
    if (native()) void invoke<ScanResult | null>("workflow_scan_read").then(setScan).catch(() => {});
  }, []);
  const profile: WorkflowProfile = useMemo(() => profileOf(saved) ?? emptyProfile(scan), [saved, scan]);
  const have: CatalogEntry[] = useMemo(() => toolsYouHave(catalog, scan), [catalog, scan]);
  const ev = useMemo(() => evolve(profile, catalog, have, scan, dna), [profile, catalog, have, scan, dna.evolutions, dna.pains, dna.learned]);

  // remember what was suggested; let your AI word the three reasons once
  useEffect(() => {
    setTop(ev.top);
    update((d) => logEvolutions(d, ev.top));
    const key = ev.top.map((t) => t.id).join(",");
    if (polished.has(key)) { setTop(polished.get(key)!); return; }
    if (!native() || brain === "form" || !ev.top.length) return;
    void invoke<unknown>("interview_turn", { brain, system: "You write short, grounded reasons for developer tool suggestions. Facts only.", prompt: polishPrompt(ev.top, dnaBrief(dna, 1800)), schema: JSON.stringify(POLISH_SCHEMA) })
      .then((raw) => { const p = applyPolish(ev.top, raw); polished.set(key, p); setTop(p); })
      .catch(() => {});
  }, [ev.top.map((t) => t.id).join(",")]);

  const cats = [...new Set(ev.explore.map((x) => x.category ?? "other"))];
  const shown = ev.explore.filter((x) => (!cat || (x.category ?? "other") === cat) && (!freeOnly || x.cost === "free") && (!quick || (x.setupMin ?? 99) <= 10));
  const tried = dna.evolutions.filter((e) => e.installedAt || e.dismissed || e.helped);
  const copy = (cmd: string) => void navigator.clipboard.writeText(cmd).then(() => toast(cmd.startsWith("/") ? "Copied: paste it into Claude Code" : "Copied: run it in Terminal"));

  return (
    <div className="flex flex-col gap-5">
      <p className="text-[12.5px] text-faint -mt-2">Upgrades picked for how you work. Nothing installs by itself: copy the command when you're ready. Grill Me notices when you add one, and asks later if it helped.</p>
      <div className="grid gap-3">
        {(top ?? ev.top).map((t, i) => <TopCard key={t.id} t={t} n={i + 1} have={have} scan={scan} profile={profile}
          onCopy={copy} onDocs={() => t.docs && void openUrl(t.docs)} onDismiss={() => update((d) => dismissEvolution(d, t.id, t.name))} />)}
        {!ev.top.length ? <div className="text-[13px] text-faint">Nothing to suggest right now: your setup covers what you said you need.</div> : null}
      </div>

      {ev.bundles.length ? (
        <div>
          <div className="text-[11px] tracking-[0.1em] uppercase text-faint mb-2">Works better together</div>
          <div className="grid gap-2 @2xl:grid-cols-2">
            {ev.bundles.map((b) => (
              <div key={b.id} className="composer-card rounded-xl px-4 py-3 border-dashed">
                <div className="text-[13.5px] font-semibold text-ink">{b.name}</div>
                <div className="text-[12px] text-accent mt-0.5">{b.members.map((m) => m.name + (m.have ? " ✓" : "")).join(" + ")}</div>
                <div className="text-[12px] text-faint mt-1">{b.why}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div>
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <div className="text-[11px] tracking-[0.1em] uppercase text-faint flex-1">Explore more · {shown.length}</div>
          <label className="text-[12px] text-dim flex items-center gap-1.5"><input type="checkbox" className="accent-(--accent)" checked={freeOnly} onChange={(e) => setFreeOnly(e.target.checked)} /> Free only</label>
          <label className="text-[12px] text-dim flex items-center gap-1.5"><input type="checkbox" className="accent-(--accent)" checked={quick} onChange={(e) => setQuick(e.target.checked)} /> 10 min or less</label>
        </div>
        <div className="flex gap-1.5 flex-wrap mb-2">
          <Chip on={!cat} onClick={() => setCat("")}>All</Chip>
          {cats.map((c) => <Chip key={c} on={cat === c} onClick={() => setCat(c)}>{CATEGORY_NAMES[c as keyof typeof CATEGORY_NAMES] ?? c}</Chip>)}
        </div>
        <div className="composer-card rounded-xl divide-y divide-line">
          {shown.slice(0, 40).map((x, i, xs) => (
            <div key={x.id} className="px-4 py-2.5 flex items-start gap-3 group">
              <div className="flex-1 min-w-0">
                <div className="text-[13.5px] text-ink">{x.name} <span className="text-[11.5px] text-faint">· {x.fits}</span></div>
                {/* the same reason as the row above isn't repeated */}
                {i === 0 || xs[i - 1].why !== x.why ? <div className="text-[12.5px] text-dim">{x.why}</div> : null}
                <div className="text-[12px] text-faint">{x.change.stageName}: {x.change.after}</div>
              </div>
              {x.command ? <button className="composer-btn" onClick={() => copy(x.command!)}>Copy</button> : null}
              {x.docs ? <button className="composer-btn" onClick={() => void openUrl(x.docs!)}>Docs</button> : null}
              <button className="opacity-40 group-hover:opacity-100 text-faint hover:text-warn px-1" title="Not for me" aria-label={`Not for me: ${x.name}`} onClick={() => update((d) => dismissEvolution(d, x.id, x.name))}>✕</button>
            </div>
          ))}
          {!shown.length ? <div className="px-4 py-3 text-[13px] text-faint">Nothing matches those filters.</div> : null}
        </div>
      </div>

      {tried.length ? (
        <div>
          <div className="text-[11px] tracking-[0.1em] uppercase text-faint mb-2">What you tried</div>
          <div className="composer-card rounded-xl divide-y divide-line">
            {tried.map((e) => (
              <div key={e.id} className="px-4 py-2.5 flex items-center gap-3 flex-wrap">
                <div className="flex-1 min-w-[200px]">
                  <div className="text-[13.5px] text-ink">{e.name}</div>
                  <div className="text-[12px] text-faint">{e.dismissed ? "Not for you" : e.installedAt ? `Added${e.uses ? `, used ${e.uses}× in 4 weeks` : ", not used yet"}` : ""}</div>
                </div>
                {e.dismissed ? (
                  <button className="composer-btn" onClick={() => update((d) => dismissEvolution(d, e.id, e.name, false))}>Suggest it again</button>
                ) : (
                  <span className="flex items-center gap-1.5 text-[12px] text-dim">Did it help?
                    {(["yes", "no", "unsure"] as const).map((h) => (
                      <button key={h} className={`composer-btn ${e.helped === h ? "border-accent/70 text-ink" : ""}`} onClick={() => update((d) => setHelped(d, e.id, h))}>{h === "yes" ? "Yes" : h === "no" ? "No" : "Not sure"}</button>
                    ))}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button className={`px-2.5 h-7 rounded-full text-[12px] border ${on ? "border-accent/70 text-ink bg-accent/10" : "border-line text-dim hover:text-ink"}`} onClick={onClick}>{children}</button>;
}

function TopCard({ t, n, have, scan, profile, onCopy, onDocs, onDismiss }: { t: EvolutionPick; n: number; have: CatalogEntry[]; scan: ScanResult | null; profile: WorkflowProfile; onCopy: (c: string) => void; onDocs: () => void; onDismiss: () => void }) {
  const { before, after } = pathWith(have, scan, profile, t);
  return (
    <div className="composer-card rounded-xl px-4 py-3.5 flex flex-col gap-2">
      <div className="flex items-start gap-3">
        <span className="num text-[12px] text-faint pt-0.5">{n}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-[15px] font-semibold text-ink">{t.name}</span>
            <span className="text-[11px] tracking-[0.06em] uppercase text-accent">{t.category ? CATEGORY_NAMES[t.category] : t.kind}</span>
          </div>
          <div className="text-[13px] text-dim mt-1">{t.why}</div>
          <div className="text-[12px] text-faint mt-1">{t.fits}</div>
        </div>
      </div>
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 items-center text-[12px] pl-6">
        <span className="text-faint">Now</span>
        <Path stages={before} />
        <span className="text-accent">With it</span>
        <Path stages={after} />
      </div>
      <div className="pl-6 text-[12.5px]"><span className="text-faint">{t.change.stageName}: </span><span className="text-dim line-through decoration-white/20">{t.change.before}</span> <span className="text-faint">→</span> <span className="text-ink">{t.change.after}</span></div>
      <div className="pl-6 flex items-center gap-2 flex-wrap">
        {t.command ? <button className="composer-btn" onClick={() => onCopy(t.command!)}><Icon name="terminal" size={11} /> Copy command</button> : null}
        {t.docs ? <button className="composer-btn" onClick={onDocs}>How to set it up</button> : null}
        <span className="flex-1" />
        <button className="text-[12px] text-faint hover:text-warn" onClick={onDismiss}>Not for me</button>
      </div>
    </div>
  );
}

function Path({ stages }: { stages: { id: string; name: string; lit: boolean; added?: boolean }[] }) {
  return (
    <div className="flex items-center gap-1">
      {stages.map((s, i) => (
        <span key={s.id} className="flex items-center gap-1">
          <span className={`px-2 h-6 inline-flex items-center rounded-full border text-[11.5px] ${s.added ? "border-accent bg-accent/20 text-ink" : s.lit ? "border-line text-dim" : "border-dashed border-line text-faint"}`}>{s.name}</span>
          {i < stages.length - 1 ? <span className="text-faint">→</span> : null}
        </span>
      ))}
    </div>
  );
}
