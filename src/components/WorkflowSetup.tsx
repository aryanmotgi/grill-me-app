import { useEffect, useMemo, useState } from "react";
import { useApp } from "../store";
import { Icon } from "./Icon";
import type { Catalog } from "../lib/catalog";
import { builtinCatalog, loadCatalog } from "../lib/catalogLoad";
import type { ScanResult } from "../lib/scan";
import {
  AGENTS, BUILDING, MAX_PAINS, PAINS, STYLE, TEAM,
  emptyProfile, profileFacts, profileOf, suggestUpgrades, toolsYouHave, workflowStages,
  type Upgrade, type WorkflowProfile,
} from "../lib/profile";

// ---------------------------------------------------------------------------
// "Your workflow": a one-minute form (no AI), then what we know, your
// workflow as five stages, and up to three upgrades with reasons. Every
// result comes from fixed rules over the scan and the catalog (lib/profile).
// Nothing installs from here: each upgrade shows its command to copy.
// ---------------------------------------------------------------------------

const native = () => "__TAURI_INTERNALS__" in window;

async function openExternal(url: string) {
  if (!native()) { window.open(url, "_blank"); return; }
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  await openUrl(url).catch(() => {});
}

function Chips<T extends string>({ options, value, onPick, multi, ranked }: {
  options: { id: T; label: string }[];
  value: T[];
  onPick: (id: T) => void;
  multi?: boolean;
  /** show 1, 2, 3 on picks (order matters) */
  ranked?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role={multi ? "group" : "radiogroup"}>
      {options.map((o) => {
        const on = value.includes(o.id);
        return (
          <button key={o.id} type="button" role={multi ? "checkbox" : "radio"} aria-checked={on}
            className={`px-3 py-1.5 rounded-full text-[12.5px] cursor-pointer border transition-colors inline-flex items-center gap-1.5 ${on ? "bg-accent border-accent text-accent-ink font-medium" : "bg-panel/60 border-line text-dim hover:text-ink hover:border-accent/40"}`}
            onClick={() => onPick(o.id)}>
            {on ? (ranked
              ? <span className="text-[10.5px] w-4 h-4 rounded-full bg-accent-ink/20 inline-flex items-center justify-center">{value.indexOf(o.id) + 1}</span>
              : <Icon name="check" size={10} />) : null}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Question({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="text-[13.5px] text-ink font-medium">{title}{hint ? <span className="ml-2 text-[11.5px] text-faint font-normal">{hint}</span> : null}</div>
      {children}
    </div>
  );
}

/** The quick form. Every question is optional. */
export function QuickForm({ value, onChange, scanned }: { value: WorkflowProfile; onChange: (p: WorkflowProfile) => void; scanned?: boolean }) {
  const set = (patch: Partial<WorkflowProfile>) => onChange({ ...value, ...patch });
  const toggle = <T,>(list: T[], x: T, max = Infinity) =>
    list.includes(x) ? list.filter((y) => y !== x) : list.length >= max ? list : [...list, x];
  return (
    <div className="flex flex-col gap-5">
      <Question title="What are you building?">
        <Chips options={BUILDING} value={value.building ? [value.building] : []} onPick={(id) => set({ building: value.building === id ? undefined : id })} />
      </Question>
      <Question title="Who's working on it?">
        <Chips options={TEAM} value={value.team ? [value.team] : []} onPick={(id) => set({ team: value.team === id ? undefined : id })} />
      </Question>
      <Question title="Which AI tools do you use?" hint={scanned ? "ticked from your scan" : undefined}>
        <Chips multi options={AGENTS} value={value.agents} onPick={(id) => set({ agents: toggle(value.agents, id) })} />
      </Question>
      <Question title="How do you use AI to code?">
        <Chips options={STYLE} value={value.style ? [value.style] : []} onPick={(id) => set({ style: value.style === id ? undefined : id })} />
      </Question>
      <Question title="What slows you down most?" hint={`pick up to ${MAX_PAINS}, most important first`}>
        <Chips multi ranked options={PAINS} value={value.pains} onPick={(id) => set({ pains: toggle(value.pains, id, MAX_PAINS) })} />
      </Question>
    </div>
  );
}

function UpgradeCard({ u }: { u: Upgrade }) {
  const toast = useApp((s) => s.toast);
  // "/plugin install …" runs inside Claude Code; everything else in Terminal
  const where = u.command?.startsWith("/") ? "Paste it into Claude Code" : "Run it in Terminal";
  const copy = () => void navigator.clipboard.writeText(u.command ?? "").then(() => toast(`Copied. ${where}`));
  return (
    <div className="hairline rounded-lg px-4 py-3 bg-panel/60 flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <Icon name="spark" size={13} className="text-accent flex-none" />
        <span className="text-[13.5px] font-medium text-ink">{u.name}</span>
      </div>
      <div className="text-[12.5px] text-ink">{u.why}</div>
      <div className="text-[12px] text-dim leading-relaxed">{u.what}</div>
      <div className="flex flex-wrap items-center gap-2 mt-1">
        {u.command ? (
          <button className="font-mono text-[11px] text-dim hover:text-ink bg-raised hairline rounded px-2 py-1 cursor-pointer max-w-full truncate"
            title={`Copy. ${where}`} onClick={copy}>
            {u.command}
          </button>
        ) : null}
        {u.docs ? <button className="text-[12px] text-dim hover:text-ink cursor-pointer" onClick={() => void openExternal(u.docs!)}>How to set it up ↗</button> : null}
      </div>
    </div>
  );
}

/** What we know + your workflow + up to three upgrades. */
export function WorkflowResult({ profile, scan, catalog, onEdit }: {
  profile: WorkflowProfile;
  scan: ScanResult | null;
  catalog: Catalog;
  onEdit?: () => void;
}) {
  const have = useMemo(() => toolsYouHave(catalog, scan), [catalog, scan]);
  const facts = profileFacts(profile, scan, have);
  const stages = workflowStages(have, scan, profile);
  const upgrades = suggestUpgrades(profile, catalog, have, scan);
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <div className="flex items-center">
          <h2 className="text-[13px] font-semibold text-ink">What we know</h2>
          <span className="flex-1" />
          {onEdit ? <button className="text-[12px] text-dim hover:text-ink cursor-pointer" onClick={onEdit}>Edit answers</button> : null}
        </div>
        <div className="hairline rounded-lg bg-panel/60 divide-y divide-line">
          {facts.length === 0 ? <p className="px-4 py-3 text-[13px] text-faint">Nothing yet. Answer a question or two for better suggestions.</p> : null}
          {facts.map((f) => (
            <div key={f.label} className="px-4 py-2.5 flex gap-3 text-[13px]">
              <span className="w-[130px] flex-none text-dim">{f.label}</span>
              <span className="text-ink min-w-0 flex-1">{f.value}</span>
              <span className="text-[11px] text-faint flex-none">{f.from === "scan" ? "from scan" : "you said"}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-[13px] font-semibold text-ink">Here's your workflow</h2>
        <ol className="grid grid-cols-5 gap-1.5 max-[620px]:grid-cols-1">
          {stages.map((st) => (
            <li key={st.id} className={`hairline rounded-lg px-3 py-2.5 bg-panel/60 flex flex-col gap-1 min-w-0 ${st.covered ? "" : "border-dashed"}`}>
              <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-ink">
                <Icon name={st.covered ? "check" : "cross"} size={10} className={st.covered ? "text-ok" : "text-faint"} />
                {st.name}
              </span>
              <span className={`text-[11.5px] leading-snug ${st.covered ? "text-dim" : "text-faint"}`}>
                {st.covered ? st.tools.slice(0, 3).join(", ") + (st.tools.length > 3 ? ` +${st.tools.length - 3}` : "") : "Nothing yet"}
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-[13px] font-semibold text-ink">{upgrades.length ? `${upgrades.length === 1 ? "One upgrade" : `${upgrades.length} upgrades`} worth trying` : "Upgrades"}</h2>
        {upgrades.length === 0 ? <p className="text-[13px] text-faint">Your setup already covers everything we'd suggest.</p> : null}
        {upgrades.map((u) => <UpgradeCard key={u.id} u={u} />)}
        {upgrades.length ? <p className="text-[12px] text-faint">Nothing installs on its own. Copy a command when you want one.</p> : null}
      </section>
    </div>
  );
}

/** Loads the saved scan + catalog once. */
export function useWorkflowInputs(): { scan: ScanResult | null; catalog: Catalog; ready: boolean } {
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [catalog, setCatalog] = useState<Catalog>(builtinCatalog);
  const [ready, setReady] = useState(!native());
  useEffect(() => {
    if (!native()) return;
    void (async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      const [s, c] = await Promise.all([
        invoke<ScanResult | null>("workflow_scan_read").catch(() => null),
        loadCatalog().catch(() => builtinCatalog()),
      ]);
      setScan(s);
      setCatalog(c);
      setReady(true);
    })();
  }, []);
  return { scan, catalog, ready };
}

/** The saved profile, or a fresh one pre-filled from the scan. */
export function useProfileDraft(scan: ScanResult | null, ready: boolean): [WorkflowProfile, (p: WorkflowProfile) => void, boolean] {
  const raw = useApp((s) => s.appSettings.workflowProfile);
  const saved = useMemo(() => profileOf(raw), [raw]);
  const [draft, setDraft] = useState<WorkflowProfile | null>(saved);
  useEffect(() => {
    if (ready && !draft) setDraft(emptyProfile(scan));
  }, [ready]);
  return [draft ?? emptyProfile(scan), setDraft, saved !== null];
}
