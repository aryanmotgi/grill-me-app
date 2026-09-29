import { useApp } from "../store";
import { moved, readLayout, toggled, type Layout, type PanelId } from "../lib/layout";
import { Icon } from "./Icon";

// ---------------------------------------------------------------------------
// Dockable-panel plumbing: read/write the layout, and the small ⇄ / × control
// every panel header carries.
// ---------------------------------------------------------------------------

export function useLayout(): [Layout, (l: Layout) => void] {
  const raw = useApp((s) => s.appSettings.layout);
  const setAppSetting = useApp((s) => s.setAppSetting);
  return [readLayout(raw), (l) => setAppSetting("layout", l)];
}

export function togglePanel(id: PanelId, open?: boolean) {
  const st = useApp.getState();
  st.setAppSetting("layout", toggled(readLayout(st.appSettings.layout), id, open));
}

const NAMES: Record<PanelId, string> = { nav: "sidebar", workspace: "sessions panel", claude: "Claude panel" };

export function PanelControls({ id }: { id: PanelId }) {
  const [layout, setLayout] = useLayout();
  const side = layout[id].side;
  const btn = "w-6 h-6 rounded-md flex items-center justify-center text-faint hover:text-ink hover:bg-raised cursor-pointer";
  return (
    <span className="flex items-center gap-0.5 flex-none">
      <button className={btn} title={`Move the ${NAMES[id]} to the ${side === "left" ? "right" : "left"}`}
        onClick={() => setLayout(moved(layout, id))}>
        <Icon name="swap" size={11} />
      </button>
      <button className={btn} title={`Close the ${NAMES[id]}`} onClick={() => setLayout(toggled(layout, id, false))}>
        <Icon name="cross" size={10} />
      </button>
    </span>
  );
}

/** Top-bar toggles for panels that are closed or docked on this side. */
export function DockToggles({ side }: { side: "left" | "right" }) {
  const [layout, setLayout] = useLayout();
  const items: { id: PanelId; icon: string; label: string; key: string }[] = [
    { id: "nav", icon: "panelLeft", label: "sidebar", key: "⌘⇧B" },
    { id: "workspace", icon: "panelRight", label: "sessions", key: "⌘B" },
    { id: "claude", icon: "claude", label: "Claude chat", key: "⌘J" },
  ];
  // left cluster: rail + sessions; right cluster: Claude — wherever they're docked
  const shown = items.filter((i) => (side === "left" ? i.id !== "claude" : i.id === "claude"));
  return (
    <span className="flex items-center gap-0.5 flex-none">
      {shown.map((i) => (
        <button key={i.id}
          className={`w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer transition-colors ${layout[i.id].open ? "text-ink bg-raised/60" : "text-faint hover:text-ink hover:bg-raised/50"}`}
          title={`${layout[i.id].open ? "Hide" : "Show"} ${i.label} (${i.key})`}
          onClick={() => setLayout(toggled(layout, i.id))}>
          {i.icon === "claude" ? <span className="text-[14px] leading-none" style={{ color: "#c88a6a" }}>✳</span> : <Icon name={i.icon} size={15} />}
        </button>
      ))}
    </span>
  );
}
