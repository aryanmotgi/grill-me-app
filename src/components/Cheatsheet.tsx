import { useModalA11y } from "../hooks/useModalA11y";
import { useApp } from "../store";
import { SHORTCUT_GROUPS } from "../data/shortcuts";

/**
 * Keyboard cheatsheet — the single visible source of truth for every
 * shortcut, opened with "?" (and linked from Settings → Shortcuts). Same
 * glass-over-scrim modal primitive as the other overlays; Esc closes it via
 * App's central Esc chain.
 */
export function Cheatsheet() {
  const open = useApp((s) => s.cheatsheetOpen);
  const modalA11y = useModalA11y("Keyboard shortcuts", open);
  if (!open) return null;
  const close = () => useApp.setState({ cheatsheetOpen: false });

  return (
    <div className="fixed inset-0 z-40 scrim flex items-start justify-center pt-[8vh]" onClick={close}>
      <div
        {...modalA11y}
        className="w-[640px] max-w-[92vw] max-h-[84vh] overflow-y-auto glass rounded-md shadow-2xl rise p-6 outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-baseline gap-3 mb-4">
          <span className="font-display font-bold text-[15px]">KEYBOARD SHORTCUTS</span>
          <span className="text-faint text-[10px]">press ? anytime</span>
          <button className="btn ml-auto" onClick={close}>close</button>
        </div>
        <div className="grid grid-cols-2 gap-x-8 gap-y-5">
          {SHORTCUT_GROUPS.map(([group, shortcuts]) => (
            <section key={group}>
              <div className="panel-label mb-2">{group}</div>
              {shortcuts.map((s) => (
                <div key={s.keys} className="flex gap-3 py-1.5 border-b border-line/40 last:border-0">
                  <span className="font-mono text-data text-[11px] w-16 flex-none">{s.keys}</span>
                  <span className="text-dim text-[11px] leading-snug">{s.what}</span>
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
