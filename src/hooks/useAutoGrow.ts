import { useLayoutEffect, type RefObject } from "react";

/** Grow a textarea with its content (up to its CSS max-height). CSS
 *  `field-sizing: content` would do this, but the macOS WebKit webview the
 *  app runs in doesn't support it — the box stayed one line and clipped. */
export function useAutoGrow(ref: RefObject<HTMLTextAreaElement | null>, value: string) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [ref, value]);
}
