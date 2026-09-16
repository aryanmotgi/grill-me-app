import { useEffect, useState } from "react";
import { useApp } from "../store";

const MODES = [
  {
    mode: "solo" as const,
    key: "1",
    title: "Solo",
    desc: "Just you and your sessions. Team chrome stays out of the way.",
  },
  {
    mode: "team" as const,
    key: "2",
    title: "Team",
    desc: "Create or join a room on your network and plan the build together.",
  },
];

/**
 * First screen when no mode is chosen yet (appMode === null) — before the
 * project picker. Two cards, quiet chrome, one primary decision at a time.
 * Keys: 1 solo, 2 team, arrows move, Enter confirms the highlighted card.
 */
export function ModeSelect() {
  const setAppMode = useApp((s) => s.setAppMode);
  const [sel, setSel] = useState(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const hit = MODES.find((m) => m.key === e.key);
      if (hit) {
        e.preventDefault();
        setAppMode(hit.mode);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "Tab") {
        e.preventDefault();
        setSel((s) => (s + 1) % MODES.length);
      } else if (e.key === "Enter") {
        e.preventDefault();
        setAppMode(MODES[sel].mode);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sel, setAppMode]);

  return (
    <div className="h-full flex flex-col items-center justify-center gap-8 bg-bg">
      <div className="flex flex-col items-center gap-1.5">
        <span className="font-display font-bold text-[15px] tracking-[0.08em] text-accent">
          GRILL&nbsp;ME
        </span>
        <span className="panel-label">how are you working today?</span>
      </div>

      <div className="flex gap-4">
        {MODES.map((m, i) => (
          <button
            key={m.mode}
            className={`w-60 flex flex-col items-start gap-2 p-5 text-left bg-panel rounded-md border transition-colors cursor-pointer rise ${
              sel === i ? "border-accent" : "border-line hover:border-dim"
            }`}
            onMouseEnter={() => setSel(i)}
            onFocus={() => setSel(i)}
            onClick={() => setAppMode(m.mode)}
          >
            <span className="flex items-baseline gap-2 w-full">
              <span className="font-display font-semibold text-[15px]">{m.title}</span>
              <span className="ml-auto font-mono text-[10px] text-faint">{m.key}</span>
            </span>
            <span className="text-[11px] text-dim leading-relaxed">{m.desc}</span>
          </button>
        ))}
      </div>

      <span className="text-faint text-[10px]">
        1 solo · 2 team · enter opens the highlighted mode — switch later in settings
      </span>
    </div>
  );
}
