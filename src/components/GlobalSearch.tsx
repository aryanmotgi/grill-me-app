import { useApp } from "../store";
import { Icon } from "./Icon";

/** One search bar across every session's output; results grouped by teammate. */
export function GlobalSearch() {
  const { teammates, searchQuery, setSearch, setActive } = useApp();

  const groups = searchQuery
    ? teammates
        .map((t) => ({
          mate: t,
          hits: t.terminal.filter((l) =>
            l.text.toLowerCase().includes(searchQuery.toLowerCase()),
          ),
        }))
        .filter((g) => g.hits.length > 0)
    : [];

  return (
    <div className="relative flex-none border-b border-line bg-panel demo-hide">
      <div className="flex items-center gap-2 px-3 h-8">
        <span className="text-faint"><Icon name="search" size={11} /></span>
        <input
          className="flex-1 bg-transparent text-[11px] outline-none placeholder:text-faint"
          placeholder="Search across all sessions…"
          value={searchQuery}
          onChange={(e) => setSearch(e.target.value)}
        />
        {searchQuery ? (
          <button className="btn" onClick={() => setSearch("")}>clear</button>
        ) : null}
      </div>

      {groups.length > 0 ? (
        <div className="absolute left-0 right-0 top-full z-30 bg-overlay border-b border-line shadow-xl max-h-64 overflow-y-auto">
          {groups.map(({ mate, hits }) => (
            <div key={mate.id} className="px-3 py-2 border-b border-line">
              <button
                className="panel-label cursor-pointer hover:text-accent"
                onClick={() => setActive(mate.id)}
              >
                {mate.name} · {hits.length} hit{hits.length > 1 ? "s" : ""}
              </button>
              {hits.slice(0, 3).map((l, i) => (
                <div key={i} title={l.text} className="text-[11px] text-dim truncate mt-0.5 font-mono">
                  {l.text}
                </div>
              ))}
              {hits.length > 3 ? (
                <button className="text-faint text-[10px] mt-0.5 cursor-pointer hover:text-accent"
                  onClick={() => setActive(mate.id)}>
                  +{hits.length - 3} more — open session
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
