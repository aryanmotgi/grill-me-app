import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { useApp } from "../store";

export function QuickSwitcher() {
  const { teammates, switcherOpen, setSwitcherOpen, setActive } = useApp();
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const hits = teammates.filter((t) =>
    `${t.name} ${t.branch} ${t.taskLabel}`.toLowerCase().includes(query.toLowerCase()),
  );

  useEffect(() => {
    if (switcherOpen) {
      setQuery("");
      setCursor(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [switcherOpen]);

  if (!switcherOpen) return null;

  return (
    <div
      className="fixed inset-0 z-40 bg-black/50 flex items-start justify-center pt-[18vh]"
      onClick={() => setSwitcherOpen(false)}
    >
      <div
        className="w-[420px] bg-overlay hairline rounded-md shadow-2xl overflow-hidden rise"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          className="w-full bg-transparent px-4 py-3 text-[13px] outline-none border-b border-line"
          placeholder="Jump to teammate…"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setCursor(0); }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setSwitcherOpen(false);
            if (e.key === "ArrowDown") setCursor((c) => Math.min(c + 1, hits.length - 1));
            if (e.key === "ArrowUp") setCursor((c) => Math.max(c - 1, 0));
            if (e.key === "Enter" && hits[cursor]) setActive(hits[cursor].id);
          }}
        />
        {hits.map((t, i) => (
          <div
            key={t.id}
            className={`px-4 py-2.5 flex items-center gap-2.5 cursor-pointer text-[12px] ${
              i === cursor ? "bg-raised border-l-2 border-l-accent" : "border-l-2 border-l-transparent"
            }`}
            onMouseEnter={() => setCursor(i)}
            onClick={() => setActive(t.id)}
          >
            <span className={`status-dot ${t.status}`} />
            <span className="font-display font-semibold">{t.name}</span>
            <span className="font-mono text-faint text-[10px]"><Icon name="branch" size={10} /> {t.branch}</span>
            <span className="flex-1" />
            <span className="text-dim text-[11px] truncate">{t.taskLabel}</span>
          </div>
        ))}
        {hits.length === 0 ? (
          <div className="px-4 py-3 text-faint text-[12px]">No matches.</div>
        ) : null}
      </div>
    </div>
  );
}
