import { useEffect, useState } from "react";
import { useApp } from "../store";
import { Icon } from "./Icon";
import { GrillFlame } from "./GrillMark";

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
    <div className="h-full flex flex-col ground">
      <div data-tauri-drag-region className="h-12 flex-none" />
      <div className="flex-1 flex flex-col items-center justify-center gap-8 pb-16 px-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <GrillFlame px={4} />
          <div>
            <div className="text-[22px] font-semibold text-ink tracking-tight">How are you working today?</div>
            <div className="text-[13px] text-dim mt-1">You can switch any time in Settings.</div>
          </div>
        </div>

        <div className="flex gap-3 flex-wrap justify-center">
          {MODES.map((m, i) => (
            <button
              key={m.mode}
              className={`composer-card w-64 flex flex-col items-start gap-2 px-5 py-4 text-left rounded-xl transition-colors cursor-pointer rise ${
                sel === i ? "border-white/25" : "hover:border-white/15"
              }`}
              onMouseEnter={() => setSel(i)}
              onFocus={() => setSel(i)}
              onClick={() => setAppMode(m.mode)}
            >
              <span className="flex items-center gap-2 w-full">
                <Icon name={m.mode === "team" ? "team" : "terminal"} size={15} className={sel === i ? "text-ink" : "text-dim"} />
                <span className="text-[14px] font-medium text-ink">{m.title}</span>
                <span className="ml-auto font-mono text-[11px] text-faint">{m.key}</span>
              </span>
              <span className="text-[12px] text-dim leading-relaxed">{m.desc}</span>
            </button>
          ))}
        </div>

        <span className="text-faint text-[11px]">Press 1 or 2, or Enter for the highlighted one</span>
      </div>
    </div>
  );
}
