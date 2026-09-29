import { describe, expect, it } from "vitest";
import { DEFAULT_LAYOUT, leftEdgePanel, moved, panelsOn, readLayout, toggled } from "./layout";

describe("dock layout", () => {
  it("fills defaults and clamps width", () => {
    expect(readLayout(undefined)).toEqual(DEFAULT_LAYOUT);
    expect(readLayout({ claude: { open: true }, claudeWidth: 9999 })).toMatchObject({ claude: { open: true, side: "right" }, claudeWidth: 760 });
    expect(readLayout({ nav: { side: "up" } }).nav.side).toBe("left");
  });
  it("toggles and moves panels", () => {
    const l = toggled(DEFAULT_LAYOUT, "claude");
    expect(l.claude.open).toBe(true);
    expect(moved(l, "claude").claude.side).toBe("left");
    expect(toggled(l, "nav", false).nav.open).toBe(false);
  });
  it("orders panels from the outer edge in", () => {
    const all = { ...DEFAULT_LAYOUT, claude: { open: true, side: "left" as const } };
    expect(panelsOn(all, "left")).toEqual(["nav", "workspace", "claude"]);
    const right = { ...DEFAULT_LAYOUT, nav: { open: true, side: "right" as const }, claude: { open: true, side: "right" as const } };
    expect(panelsOn(right, "right")).toEqual(["claude", "nav"]);
  });
  it("knows who touches the left window edge", () => {
    expect(leftEdgePanel(DEFAULT_LAYOUT)).toBe("nav");
    expect(leftEdgePanel(toggled(DEFAULT_LAYOUT, "nav", false))).toBe("workspace");
    expect(leftEdgePanel({ ...DEFAULT_LAYOUT, nav: { open: false, side: "left" }, workspace: { open: false, side: "left" } })).toBeNull();
  });
});
