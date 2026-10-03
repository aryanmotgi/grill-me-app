import { useEffect } from "react";

// ---------------------------------------------------------------------------
// Drag the window from any bar marked data-drag-zone, not just from the exact
// element tagged data-tauri-drag-region (Tauri ignores presses on its
// children, which made the top of the app nearly impossible to grab). A
// press on bare bar, text or icons drags; a press on anything you can click
// or type in does its normal thing. Double-click zooms, like any Mac window.
// ---------------------------------------------------------------------------

const INTERACTIVE = "button, a[href], input, textarea, select, label, summary, [role='button'], [role='tab'], [contenteditable='true'], [data-no-drag]";

/** Should a press on this element drag the window? */
export function dragsWindow(target: Element | null): boolean {
  if (!target?.closest("[data-drag-zone]")) return false;
  return !target.closest(INTERACTIVE);
}

export function useWindowDrag() {
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    const onDown = (e: MouseEvent) => {
      if (e.button !== 0 || !dragsWindow(e.target as Element)) return;
      e.preventDefault();
      void import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
        const w = getCurrentWindow();
        return e.detail === 2 ? w.toggleMaximize() : w.startDragging();
      }).catch(() => {});
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, []);
}
