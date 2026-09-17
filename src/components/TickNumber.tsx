import { useEffect, useRef, useState } from "react";

const prefersReduced = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * A single live number that count-ups to its new value on change (~300ms,
 * ease-out). Renders tabular figures so it never reflows mid-tick. When the
 * user prefers reduced motion, it snaps straight to the value — no animation.
 */
export function TickNumber({
  value,
  className,
  duration = 300,
}: {
  value: number;
  className?: string;
  duration?: number;
}) {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const to = value;
    if (prefersReduced()) {
      fromRef.current = to;
      setDisplay(to);
      return;
    }
    const from = fromRef.current;
    if (from === to) return;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const cur = Math.round(from + (to - from) * eased);
      fromRef.current = cur;
      setDisplay(cur);
      if (t < 1) rafRef.current = requestAnimationFrame(step);
      else fromRef.current = to;
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [value, duration]);

  return <span className={`num${className ? ` ${className}` : ""}`}>{display}</span>;
}
