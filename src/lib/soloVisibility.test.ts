import { describe, expect, it } from "vitest";
import {
  surfaceVisible,
  visibleRailTabs,
  type AppMode,
  type SoloSurface,
} from "./soloVisibility";

const STRIPPED: SoloSurface[] = [
  "session-count",
  "other-session-rows",
  "merge-chip",
  "working-counter",
  "team-waiting",
  "rail-inbox-tab",
  "rail-team-tab",
  "team-pulse",
];

describe("surfaceVisible", () => {
  it("hides every team surface in solo mode", () => {
    for (const s of STRIPPED) {
      expect(surfaceVisible("solo", s), `${s} must be hidden in solo`).toBe(false);
    }
  });

  it("NEVER hides needs-you — a session waiting on the human is sacred", () => {
    const modes: AppMode[] = ["solo", "team", null];
    for (const m of modes) {
      expect(surfaceVisible(m, "needs-you"), `needs-you in ${m}`).toBe(true);
    }
  });

  it("shows everything in team mode", () => {
    for (const s of [...STRIPPED, "needs-you" as const]) {
      expect(surfaceVisible("team", s), `${s} must be visible in team`).toBe(true);
    }
  });

  it("shows everything before a mode is chosen (null) — stripping is opt-in", () => {
    for (const s of [...STRIPPED, "needs-you" as const]) {
      expect(surfaceVisible(null, s), `${s} must be visible pre-selection`).toBe(true);
    }
  });
});

describe("visibleRailTabs", () => {
  it("team mode keeps the full ⌘1-N order (files first)", () => {
    expect(visibleRailTabs("team")).toEqual(["files", "tasks", "inbox", "activity", "team", "preview"]);
  });

  it("null mode keeps the full order too", () => {
    expect(visibleRailTabs(null)).toEqual(["files", "tasks", "inbox", "activity", "team", "preview"]);
  });

  it("solo drops inbox and team, remapping ⌘1-4 to files/tasks/activity/preview", () => {
    expect(visibleRailTabs("solo")).toEqual(["files", "tasks", "activity", "preview"]);
  });

  it("stays consistent with surfaceVisible — a hidden tab never appears", () => {
    const modes: AppMode[] = ["solo", "team", null];
    for (const m of modes) {
      const tabs = visibleRailTabs(m);
      expect(tabs.includes("inbox")).toBe(surfaceVisible(m, "rail-inbox-tab"));
      expect(tabs.includes("team")).toBe(surfaceVisible(m, "rail-team-tab"));
      // stripping never reorders what's left
      const full = visibleRailTabs(null);
      expect(tabs).toEqual(full.filter((t) => tabs.includes(t)));
    }
  });
});
