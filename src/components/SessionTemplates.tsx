import { useMemo, useState } from "react";
import { useModalA11y } from "../hooks/useModalA11y";
import { useApp } from "../store";
import { Icon } from "./Icon";
import {
  loadTemplates,
  sanitizeTemplate,
  templateBranch,
  type SessionTemplate,
} from "../lib/sessionTemplates";

/**
 * "New session from template" overlay: pick a saved recipe (name + branch
 * prefix + starting prompt), name the session, and spawn it. On create the
 * store reuses spawnSession, then briefs the starting prompt in once the
 * session reaches an idle claude prompt. New templates persist to
 * settings.json via setAppSetting("sessionTemplates", …).
 */
export function SessionTemplates() {
  const open = useApp((s) => s.sessionTemplatesOpen);
  const appSettings = useApp((s) => s.appSettings);
  const spawnFromTemplate = useApp((s) => s.spawnFromTemplate);
  const setAppSetting = useApp((s) => s.setAppSetting);
  const toast = useApp((s) => s.toast);
  const modalA11y = useModalA11y("New session from template", open);

  const templates = useMemo(() => loadTemplates(appSettings), [appSettings]);
  const [selected, setSelected] = useState(0);
  const [descriptor, setDescriptor] = useState("");
  const [defining, setDefining] = useState(false);
  // draft for a user-defined template
  const [draftName, setDraftName] = useState("");
  const [draftPrefix, setDraftPrefix] = useState("");
  const [draftPrompt, setDraftPrompt] = useState("");

  if (!open) return null;
  const close = () => useApp.setState({ sessionTemplatesOpen: false });

  const template: SessionTemplate | undefined = templates[selected];
  const previewBranch = template ? templateBranch(template, descriptor || "your-work") : "";
  const canCreate = !!template && descriptor.trim() !== "";

  const create = () => {
    if (!template || !canCreate) return;
    const id = descriptor.trim();
    const branch = templateBranch(template, descriptor);
    void spawnFromTemplate(id, id, branch, template.startingPrompt);
    close();
  };

  const saveDraft = () => {
    const clean = sanitizeTemplate({ name: draftName, branchPrefix: draftPrefix, startingPrompt: draftPrompt });
    if (!clean) { toast("Template needs a name, a branch prefix, and a starting prompt", "warn"); return; }
    const next = [...templates, clean];
    setAppSetting("sessionTemplates", next);
    setSelected(next.length - 1);
    setDefining(false);
    setDraftName(""); setDraftPrefix(""); setDraftPrompt("");
    toast(`Saved template "${clean.name}"`);
  };

  return (
    <div className="fixed inset-0 z-40 scrim flex items-start justify-center pt-[8vh]" onClick={close}>
      <div {...modalA11y}
        className="w-[560px] max-h-[84vh] overflow-y-auto glass rounded-md shadow-2xl rise p-6 outline-none"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-baseline gap-3 mb-4">
          <span className="font-display font-bold text-[15px]">NEW SESSION FROM TEMPLATE</span>
          <span className="text-faint text-[10px]">spawns a branch + briefs a starting prompt</span>
          <button className="btn ml-auto" onClick={close}>close</button>
        </div>

        {/* template picker */}
        <div className="panel-label mb-2">template</div>
        <div className="flex flex-col gap-1.5">
          {templates.map((t, i) => (
            <button key={`${t.name}-${i}`}
              className={`text-left px-3 py-2 rounded-sm border-l-2 transition-colors ${
                i === selected ? "bg-raised border-l-accent" : "bg-raised/40 border-l-transparent hover:bg-raised/60"
              }`}
              aria-pressed={i === selected}
              onClick={() => setSelected(i)}>
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-semibold">{t.name}</span>
                <span className="ml-auto font-mono text-[9px] text-data" title="Branch namespace">
                  <Icon name="branch" size={10} /> {t.branchPrefix}/…
                </span>
              </div>
              <div className="text-[10px] text-dim leading-snug mt-0.5 line-clamp-2">{t.startingPrompt}</div>
            </button>
          ))}
        </div>

        {/* name → branch + create */}
        <div className="mt-4 flex flex-col gap-1.5">
          <div className="panel-label">session name</div>
          <input className="bg-raised hairline rounded-sm px-2 py-1 text-[11px] outline-none focus:border-accent"
            placeholder="short descriptor (e.g. login-crash)"
            value={descriptor} onChange={(e) => setDescriptor(e.target.value)} autoFocus
            onKeyDown={(e) => { if (e.key === "Enter" && canCreate) create(); }} />
          {template ? (
            <div className="font-mono text-[10px] text-faint">
              branch <span className="text-data">{previewBranch}</span>
            </div>
          ) : null}
          <div className="flex gap-1.5 mt-1">
            <button className="btn primary" disabled={!canCreate}
              title={canCreate ? "Create the worktree, spawn a session, then brief the prompt" : "Enter a session name first"}
              onClick={create}>
              create + brief
            </button>
            <button className="btn" onClick={() => setDefining((d) => !d)}>
              {defining ? "cancel new template" : "+ define template"}
            </button>
          </div>
        </div>

        {/* define-a-template drawer */}
        {defining ? (
          <div className="mt-4 pt-3 border-t border-line flex flex-col gap-1.5">
            <div className="panel-label">new template</div>
            <input className="bg-raised hairline rounded-sm px-2 py-1 text-[11px] outline-none focus:border-accent"
              placeholder="name (e.g. refactor: extract then test)"
              value={draftName} onChange={(e) => setDraftName(e.target.value)} />
            <input className="bg-raised hairline rounded-sm px-2 py-1 font-mono text-[10px] outline-none focus:border-accent"
              placeholder="branch prefix (e.g. refactor)"
              value={draftPrefix} onChange={(e) => setDraftPrefix(e.target.value)} />
            <textarea className="w-full h-24 bg-raised hairline rounded-sm p-2 text-[11px] resize-none outline-none focus:border-accent"
              placeholder="starting prompt — briefed into the session once it's ready"
              value={draftPrompt} onChange={(e) => setDraftPrompt(e.target.value)} />
            <div>
              <button className="btn primary" onClick={saveDraft}>save template</button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
