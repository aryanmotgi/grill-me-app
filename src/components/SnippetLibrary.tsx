import { useEffect, useMemo, useState } from "react";
import { useModalA11y } from "../hooks/useModalA11y";
import { useApp } from "../store";
import {
  deleteSnippet,
  isValidSnippet,
  loadSnippets,
  newSnippetId,
  upsertSnippet,
  type Snippet,
} from "../lib/snippets";

const INPUT = "w-full bg-raised hairline rounded-sm px-2 py-1.5 text-[12px] outline-none focus:border-accent";

/** Draft in the editor: id === null means a brand-new snippet. */
type Draft = { id: string | null; title: string; body: string };

/**
 * Snippet library overlay — save reusable prompts and insert one into the
 * active session verbatim (no newline) so the user edits before sending.
 * Snippets persist in settings via setAppSetting("snippets", …). Amber lives on
 * exactly one control per state: Insert while browsing, Save while editing.
 */
export function SnippetLibrary() {
  const { snippetsOpen, appSettings, setAppSetting, insertSnippet, teammates, activeId } = useApp();
  const modalA11y = useModalA11y("Snippet library", snippetsOpen);

  const snippets = useMemo(() => loadSnippets(appSettings.snippets), [appSettings.snippets]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  // On open: select the first snippet, close any stale editor.
  useEffect(() => {
    if (snippetsOpen) {
      setSelectedId((cur) => (cur && snippets.some((s) => s.id === cur) ? cur : snippets[0]?.id ?? null));
      setDraft(null);
      setBusy(false);
    }
  }, [snippetsOpen]);

  if (!snippetsOpen) return null;

  const close = () => useApp.setState({ snippetsOpen: false });
  const persist = (next: Snippet[]) => setAppSetting("snippets", next);
  const selected = snippets.find((s) => s.id === selectedId) ?? null;
  const activeName = teammates.find((t) => t.id === activeId)?.name ?? "active session";

  const startNew = () => setDraft({ id: null, title: "", body: "" });
  const startEdit = (s: Snippet) => setDraft({ id: s.id, title: s.title, body: s.body });

  const save = () => {
    if (!draft || !isValidSnippet(draft)) return;
    const snippet: Snippet = { id: draft.id ?? newSnippetId(), title: draft.title, body: draft.body };
    persist(upsertSnippet(snippets, snippet));
    setSelectedId(snippet.id);
    setDraft(null);
  };

  const remove = (id: string) => {
    const next = deleteSnippet(snippets, id);
    persist(next);
    if (selectedId === id) setSelectedId(next[0]?.id ?? null);
    if (draft?.id === id) setDraft(null);
  };

  const insert = async () => {
    if (!selected || busy) return;
    setBusy(true);
    const ok = await insertSnippet(selected.body);
    setBusy(false);
    if (ok) close();
  };

  const empty = snippets.length === 0;
  const draftValid = draft !== null && isValidSnippet(draft);

  return (
    <div className="fixed inset-0 z-40 scrim flex items-start justify-center pt-[8vh]" onClick={close}>
      <div {...modalA11y}
        className="w-[720px] max-h-[80vh] flex flex-col glass rounded-md shadow-2xl rise outline-none"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-baseline gap-3 px-5 py-4 border-b border-line">
          <span className="font-display font-bold text-[15px]">SNIPPET LIBRARY</span>
          <span className="text-faint text-[10px]">reusable prompts · ⌘K → snippet library</span>
          <button className="btn ml-auto" onClick={close}>close</button>
        </div>

        {empty && draft === null ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
            <div className="text-[12px] text-dim max-w-[360px] leading-snug">
              No snippets yet. Save a reusable prompt — like "write tests for this" — and
              insert it into any session with one click.
            </div>
            <button className="btn primary" onClick={startNew}>＋ new snippet</button>
          </div>
        ) : (
          <div className="flex-1 min-h-0 flex">
            {/* left: snippet list + add */}
            <div className="w-[236px] flex-none border-r border-line flex flex-col">
              <div className="flex-1 overflow-y-auto py-1">
                {snippets.map((s) => (
                  <button key={s.id}
                    className={`w-full text-left px-4 py-2 text-[12px] border-l-2 ${
                      s.id === selectedId && draft === null
                        ? "bg-raised border-l-accent"
                        : "border-l-transparent hover:bg-raised/60"
                    }`}
                    onClick={() => { setSelectedId(s.id); setDraft(null); }}>
                    <div className="font-semibold truncate">{s.title}</div>
                    <div className="text-[10px] text-faint truncate">{s.body}</div>
                  </button>
                ))}
              </div>
              <div className="px-3 py-2 border-t border-line">
                <button className="btn w-full justify-center" onClick={startNew}>＋ new snippet</button>
              </div>
            </div>

            {/* right: editor or preview */}
            <div className="flex-1 min-w-0 flex flex-col p-5 gap-3">
              {draft !== null ? (
                <>
                  <div className="panel-label">{draft.id === null ? "new snippet" : "edit snippet"}</div>
                  <input
                    className={INPUT}
                    placeholder="Title — e.g. Explain this error"
                    value={draft.title}
                    autoFocus
                    onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  />
                  <textarea
                    className={`${INPUT} flex-1 min-h-[160px] font-mono text-[11px] resize-none leading-relaxed`}
                    placeholder="Prompt body — inserted verbatim into the session so you can edit before sending."
                    value={draft.body}
                    onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                  />
                  <div className="flex items-center gap-2">
                    <button className="btn primary" disabled={!draftValid} onClick={save}>
                      {draft.id === null ? "save snippet" : "save changes"}
                    </button>
                    <button className="btn" onClick={() => setDraft(null)}>cancel</button>
                  </div>
                </>
              ) : selected ? (
                <>
                  <div className="flex items-center gap-2">
                    <span className="font-display font-semibold text-[13px] truncate">{selected.title}</span>
                    <span className="flex-1" />
                    <button className="btn" onClick={() => startEdit(selected)}>edit</button>
                    <button className="btn" onClick={() => remove(selected.id)}>delete</button>
                  </div>
                  <pre className="flex-1 min-h-0 overflow-y-auto bg-raised hairline rounded-sm p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-ink">
                    {selected.body}
                  </pre>
                  <div className="flex items-center gap-2">
                    <button className="btn primary" disabled={busy} onClick={insert}>
                      insert into {activeName} →
                    </button>
                    <span className="text-faint text-[10px]">lands at the prompt — edit, then Enter to send</span>
                  </div>
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center text-faint text-[12px]">
                  Select a snippet to preview and insert.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
