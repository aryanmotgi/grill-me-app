import { describe, expect, it } from "vitest";
import { familyOf, money, promptHints, ratesForModel, sessionStats, taskLines } from "./coach";

const mate = (model: string, tokens?: { input: number; output: number; cacheRead: number; turns: number }) =>
  ({ usage: { model, tokens, sessionPct: 0, weeklyPct: 0, sessionResetsIn: "", weeklyResetsAt: "", permissionMode: "" } });

describe("model rates", () => {
  it("prices by family, unknown like Sonnet", () => {
    expect(familyOf("claude-opus-4-8")).toBe("opus");
    expect(familyOf("Haiku 4.5")).toBe("haiku");
    expect(familyOf("gpt-5")).toBe("other");
    expect(ratesForModel("opus").output).toBeGreaterThan(ratesForModel("sonnet").output);
    expect(ratesForModel("gpt-5")).toEqual(ratesForModel("sonnet"));
  });
});

describe("sessionStats", () => {
  it("is null before there are real tallies", () => {
    expect(sessionStats(undefined)).toBeNull();
    expect(sessionStats(mate("opus"))).toBeNull();
    expect(sessionStats(mate("opus", { input: 0, output: 0, cacheRead: 0, turns: 0 }))).toBeNull();
  });
  it("works out spend, context per message and heaviness", () => {
    const s = sessionStats(mate("claude-opus", { input: 100_000, output: 50_000, cacheRead: 2_900_000, turns: 20 }))!;
    expect(s.perTurn).toBe(150_000);
    expect(s.heavy).toBe(true);
    expect(s.cost).toBeCloseTo(0.5 + 1.25 + 1.45, 5);
    expect(s.nextMsg).toBeGreaterThan(0);
    expect(sessionStats(mate("sonnet", { input: 10_000, output: 2_000, cacheRead: 40_000, turns: 5 }))!.heavy).toBe(false);
  });
  it("formats money plainly", () => {
    expect(money(0.004)).toBe("<$0.01");
    expect(money(0.4234)).toBe("$0.42");
    expect(money(23.6)).toBe("$24");
  });
});

describe("promptHints", () => {
  const heavyOpus = sessionStats(mate("opus", { input: 100_000, output: 50_000, cacheRead: 2_900_000, turns: 20 }));
  const lightOpus = sessionStats(mate("opus", { input: 10_000, output: 2_000, cacheRead: 40_000, turns: 5 }));

  it("stays quiet for a normal, specific prompt", () => {
    expect(promptHints("Add a loading spinner to SettingsModal.tsx while the save request runs", null)).toEqual([]);
    expect(promptHints("/compact", heavyOpus)).toEqual([]);
    expect(promptHints("", heavyOpus)).toEqual([]);
  });
  it("flags a vague ask, but not one with a file or an error", () => {
    expect(promptHints("fix it, it's broken", null).map((h) => h.id)).toEqual(["vague"]);
    expect(promptHints("fix the bug in @src/App.tsx", null)).toEqual([]);
    expect(promptHints("fix this: TypeError: x is undefined", null)).toEqual([]);
  });
  it("offers to split a checklist into parallel sessions", () => {
    const h = promptHints("- add login\n- add signup\n- add password reset", null);
    expect(h[0].id).toBe("many");
    expect(h[0].fix?.kind).toBe("split");
    expect(taskLines("1. a\n2) b\n[ ] c\nplain")).toHaveLength(3);
  });
  it("suggests a cheaper model only for small jobs on Opus", () => {
    expect(promptHints("change the button label to Save", lightOpus).map((h) => h.id)).toContain("small-on-big");
    expect(promptHints("change the button label to Save", null).map((h) => h.id)).not.toContain("small-on-big");
    expect(promptHints("refactor the label rendering pipeline", lightOpus).map((h) => h.id)).not.toContain("small-on-big");
  });
  it("warns about a heavy context with a compact fix", () => {
    const h = promptHints("Add a loading spinner to SettingsModal.tsx", heavyOpus).find((x) => x.id === "heavy");
    expect(h?.fix).toEqual({ label: "Compact first", kind: "send", value: "/compact" });
  });
  it("warns about a huge paste", () => {
    expect(promptHints("x ".repeat(4000), null).map((h) => h.id)).toContain("paste");
  });
});
