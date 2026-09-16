import { useEffect, useRef } from "react";

// ---------------------------------------------------------------------------
// Shared modal semantics: role="dialog" + aria-modal, focus moved into the
// container on open and restored on close, Tab/Shift+Tab trapped inside.
// Esc-to-close is handled globally in App.tsx — not duplicated here.
// ---------------------------------------------------------------------------

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

/**
 * Returns props to spread onto a modal's container element:
 * `<div {...useModalA11y("Settings", open)} className="…">`.
 * Call before any early `return null` (hooks must be unconditional);
 * `open` should be true exactly while the container is rendered.
 */
export function useModalA11y(label: string, open: boolean) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const container = ref.current;
    if (!container) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    container.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const nodes = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE))
        .filter((el) => el.offsetParent !== null);
      if (nodes.length === 0) {
        e.preventDefault();
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || active === container) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    container.addEventListener("keydown", onKeyDown);
    return () => {
      container.removeEventListener("keydown", onKeyDown);
      previous?.focus();
    };
  }, [open]);

  return {
    ref,
    role: "dialog" as const,
    "aria-modal": true,
    "aria-label": label,
    tabIndex: -1,
  };
}
