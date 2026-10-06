import { describe, it, expect } from "vitest";
import { canAct, launchFlags, managerAgentFile, managerOf, managerUsage, DEFAULT_MANAGER, MANAGER_WRITE_TOOLS, MANAGER_READ_TOOLS } from "./manager";

const P = (over = {}) => ({ ...DEFAULT_MANAGER, ...over });
const NOW = 1_700_000_000_000;
const minsAgo = (m: number) => NOW - m * 60_000;

describe("report mode is enforced, not requested", () => {
  it("denies every writing tool by name at launch", () => {
    const flags = launchFlags(P({ mode: "report" }));
    expect(flags[0]).toBe("--disallowedTools");
    for (const t of MANAGER_WRITE_TOOLS) {
      expect(flags[1]).toContain(`mcp__grill-me__${t}`);
    }
  });

  it("names send_to_coder in particular — the one that spends a teammate's plan", () => {
    expect(launchFlags(P({ mode: "report" }))[1]).toContain("mcp__grill-me__send_to_coder");
  });

  it("adds no flags when the manager may act, so nothing is denied by accident", () => {
    expect(launchFlags(P({ mode: "act" }))).toEqual([]);
    expect(launchFlags(P({ mode: "off" }))).toEqual([]);
  });
});

describe("the hourly cap", () => {
  it("refuses once the hour's actions are spent", () => {
    const at = [minsAgo(5), minsAgo(10), minsAgo(20)];
    expect(canAct(P({ mode: "act", maxActionsPerHour: 3 }), at, NOW).ok).toBe(false);
    expect(canAct(P({ mode: "act", maxActionsPerHour: 4 }), at, NOW).ok).toBe(true);
  });

  it("forgets actions older than an hour — it is a rolling window, not a quota", () => {
    const at = [minsAgo(61), minsAgo(90), minsAgo(5)];
    const r = canAct(P({ mode: "act", maxActionsPerHour: 2 }), at, NOW);
    expect(r.ok).toBe(true);
    expect(r.reason).toContain("1 of 2 left");
  });

  it("never allows an action in report or off mode, whatever the cap says", () => {
    for (const mode of ["report", "off"] as const) {
      expect(canAct(P({ mode, maxActionsPerHour: 99 }), [], NOW).ok).toBe(false);
    }
  });

  it("a cap of zero means it may read but never act", () => {
    expect(canAct(P({ mode: "act", maxActionsPerHour: 0 }), [], NOW).ok).toBe(false);
  });
});

describe("reading the setting back", () => {
  it("defaults to off — a manager is opt-in, never inherited by an upgrade", () => {
    expect(managerOf(undefined)).toEqual(DEFAULT_MANAGER);
    expect(managerOf({}).mode).toBe("off");
  });

  it("rejects a mode it does not know rather than guessing", () => {
    expect(managerOf({ manager: { mode: "boss" } }).mode).toBe("off");
  });

  it("clamps a silly cap instead of trusting it", () => {
    expect(managerOf({ manager: { maxActionsPerHour: 1e9 } }).maxActionsPerHour).toBe(100);
    expect(managerOf({ manager: { maxActionsPerHour: -4 } }).maxActionsPerHour).toBe(DEFAULT_MANAGER.maxActionsPerHour);
    expect(managerOf({ manager: { maxActionsPerHour: 2.7 } }).maxActionsPerHour).toBe(2);
  });
});

describe("what the usage panel shows", () => {
  const stats = { cost: 1.25, turns: 9, perTurn: 100, nextMsg: 0.01, family: "opus", heavy: false } as const;

  it("reports the manager's own spend and its actions this hour", () => {
    const u = managerUsage(stats, [minsAgo(5), minsAgo(70)], P({ mode: "act", maxActionsPerHour: 6 }), NOW);
    expect(u.cost).toBe(1.25);
    expect(u.turns).toBe(9);
    expect(u.actionsThisHour).toBe(1);
    expect(u.capped).toBe(false);
  });

  it("flags being capped only when it could have acted", () => {
    const at = [minsAgo(1), minsAgo(2)];
    expect(managerUsage(stats, at, P({ mode: "act", maxActionsPerHour: 2 }), NOW).capped).toBe(true);
    expect(managerUsage(stats, at, P({ mode: "report", maxActionsPerHour: 2 }), NOW).capped).toBe(false);
  });

  it("shows zero rather than nothing before the first reply", () => {
    const u = managerUsage(null, [], P(), NOW);
    expect(u.cost).toBe(0);
    expect(u.turns).toBe(0);
  });
});

describe("the agent definition is the enforcement", () => {
  it("report mode lists no writing tool at all, so none is ever offered", () => {
    const f = managerAgentFile("report");
    for (const t of MANAGER_WRITE_TOOLS) expect(f).not.toContain(`mcp__grill-me__${t}`);
    for (const t of MANAGER_READ_TOOLS) expect(f).toContain(`mcp__grill-me__${t}`);
  });

  it("act mode lists the writing tools", () => {
    const f = managerAgentFile("act");
    for (const t of MANAGER_WRITE_TOOLS) expect(f).toContain(`mcp__grill-me__${t}`);
  });

  it("never gets Bash, Edit or Write — a manager that can edit stops managing", () => {
    for (const mode of ["report", "act"] as const) {
      const tools = managerAgentFile(mode).match(/^tools: (.*)$/m)![1].split(", ");
      expect(tools).not.toContain("Bash");
      expect(tools).not.toContain("Edit");
      expect(tools).not.toContain("Write");
      expect(tools).toContain("Read");
    }
  });

  it("is a valid agent file: frontmatter first, name and description present", () => {
    const f = managerAgentFile("report");
    expect(f.startsWith("---\n")).toBe(true);
    expect(f).toMatch(/^name: manager$/m);
    expect(f).toMatch(/^description: .{40,}$/m);
    expect(f.indexOf("---", 3)).toBeGreaterThan(0);
  });

  it("tells a read-only manager not to route around its own limits", () => {
    expect(managerAgentFile("report")).toContain("Do not look for another route");
  });
});
