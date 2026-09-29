// ---------------------------------------------------------------------------
// Dockable panels: the nav rail, the workspace (sessions/explorer/changes),
// and the Claude chat can each be closed and moved to the left or right.
// Stored in appSettings.layout; pure helpers so the rules are tested.
// ---------------------------------------------------------------------------

export type PanelId = "nav" | "workspace" | "claude";
export type Side = "left" | "right";

export interface PanelState { open: boolean; side: Side }
export interface Layout { nav: PanelState; workspace: PanelState; claude: PanelState; claudeWidth: number }

export const DEFAULT_LAYOUT: Layout = {
  nav: { open: true, side: "left" },
  workspace: { open: true, side: "left" },
  claude: { open: false, side: "right" },
  claudeWidth: 420,
};

/** Order panels appear in, from the outer window edge inward. */
const ORDER: PanelId[] = ["nav", "workspace", "claude"];

export function readLayout(raw: unknown): Layout {
  const v = (raw && typeof raw === "object" ? raw : {}) as Partial<Layout>;
  const panel = (id: PanelId): PanelState => {
    const p = (v[id] ?? {}) as Partial<PanelState>;
    return {
      open: typeof p.open === "boolean" ? p.open : DEFAULT_LAYOUT[id].open,
      side: p.side === "left" || p.side === "right" ? p.side : DEFAULT_LAYOUT[id].side,
    };
  };
  const w = typeof v.claudeWidth === "number" ? v.claudeWidth : DEFAULT_LAYOUT.claudeWidth;
  return { nav: panel("nav"), workspace: panel("workspace"), claude: panel("claude"), claudeWidth: Math.min(760, Math.max(300, w)) };
}

export function toggled(l: Layout, id: PanelId, open?: boolean): Layout {
  return { ...l, [id]: { ...l[id], open: open ?? !l[id].open } };
}

export function moved(l: Layout, id: PanelId): Layout {
  return { ...l, [id]: { ...l[id], side: l[id].side === "left" ? "right" : "left" } };
}

/** Open panels on one side, in on-screen (left-to-right) order — the rail
 *  always hugs the window edge on whichever side it's docked. */
export function panelsOn(l: Layout, side: Side): PanelId[] {
  const ids = ORDER.filter((id) => l[id].open && l[id].side === side);
  return side === "left" ? ids : [...ids].reverse();
}

/** The panel touching the window's left edge gets room for the macOS
 *  traffic lights; null when the center content touches it. */
export function leftEdgePanel(l: Layout): PanelId | null {
  return panelsOn(l, "left")[0] ?? null;
}
