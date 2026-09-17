import { describe, expect, it } from "vitest";
import {
  budgetAlertOnCross,
  budgetLevel,
  budgetPct,
  budgetWarning,
  parseResetHint,
  rateLimitedSessions,
} from "./ratelimit";
import type { Teammate } from "../types";

const mate = (id: string, patch: Partial<Teammate> = {}): Teammate =>
  ({
    id,
    name: id[0].toUpperCase() + id.slice(1),
    initials: id.slice(0, 2).toUpperCase(),
    branch: "—",
    taskLabel: "—",
    status: "idle",
    setup: "ready",
    currentFile: "—",
    lastActiveMin: 0,
    health: "ok",
    permission: "edit",
    dnd: false,
    recording: false,
    usage: {
      model: "—",
      sessionPct: 0,
      weeklyPct: 0,
      sessionResetsIn: "—",
      weeklyResetsAt: "—",
      permissionMode: "—",
    },
    terminal: [],
    changes: [],
    standupNote: "—",
    ...patch,
  }) as Teammate;

describe("rateLimitedSessions", () => {
  it("is empty when no session is rate-limited", () => {
    expect(rateLimitedSessions([mate("aryan"), mate("mei")])).toEqual([]);
  });

  it("rolls up only flagged sessions, in list order, with reset times", () => {
    const out = rateLimitedSessions([
      mate("aryan", { rateLimited: true, rateLimitResetsAt: "3pm" }),
      mate("mei"),
      mate("dev", { rateLimited: true }),
    ]);
    expect(out).toEqual([
      { id: "aryan", name: "Aryan", resetsAt: "3pm" },
      { id: "dev", name: "Dev", resetsAt: null },
    ]);
  });
});

describe("parseResetHint", () => {
  it("reads 'resets 3pm'", () => {
    expect(parseResetHint("5-hour limit reached ∙ resets 3pm")).toBe("3pm");
  });

  it("reads 'resets at 6:00am' with the 'at' filler", () => {
    expect(parseResetHint("usage limit reached, resets at 6:00am")).toBe("6:00am");
  });

  it("reads a bare 24h clock time", () => {
    expect(parseResetHint("approaching limit · resets 23:00")).toBe("23:00");
  });

  it("normalizes internal spaces", () => {
    expect(parseResetHint("resets at 11 pm")).toBe("11pm");
  });

  it("returns null when no reset time is shown", () => {
    expect(parseResetHint("usage limit reached")).toBeNull();
    expect(parseResetHint("")).toBeNull();
  });
});

describe("budgetLevel", () => {
  it("maps the spend ratio to a threshold band", () => {
    expect(budgetLevel(0)).toBe(0);
    expect(budgetLevel(0.49)).toBe(0);
    expect(budgetLevel(0.5)).toBe(50);
    expect(budgetLevel(0.79)).toBe(50);
    expect(budgetLevel(0.8)).toBe(80);
    expect(budgetLevel(0.99)).toBe(80);
    expect(budgetLevel(1)).toBe(100);
    expect(budgetLevel(2.4)).toBe(100);
  });
});

describe("budgetAlertOnCross", () => {
  it("sounds budget-warn crossing up into 80%", () => {
    expect(budgetAlertOnCross(50, 80)).toBe("budget-warn");
    expect(budgetAlertOnCross(0, 80)).toBe("budget-warn");
  });

  it("sounds budget-max crossing up into 100%", () => {
    expect(budgetAlertOnCross(80, 100)).toBe("budget-max");
    expect(budgetAlertOnCross(50, 100)).toBe("budget-max"); // jump past 80 still lands on max
  });

  it("is silent at the 50% band (visual-only nudge)", () => {
    expect(budgetAlertOnCross(0, 50)).toBeNull();
  });

  it("is silent on a flat or downward move (the fires-once guard)", () => {
    expect(budgetAlertOnCross(80, 80)).toBeNull();
    expect(budgetAlertOnCross(100, 80)).toBeNull();
    expect(budgetAlertOnCross(100, 0)).toBeNull();
  });
});

describe("budgetPct", () => {
  it("rounds to whole percent and never goes negative", () => {
    expect(budgetPct(0.804)).toBe(80);
    expect(budgetPct(1.239)).toBe(124);
    expect(budgetPct(-0.1)).toBe(0);
  });
});

describe("budgetWarning", () => {
  it("phrases each band and stays quiet when calm", () => {
    expect(budgetWarning(0)).toBeNull();
    expect(budgetWarning(50)).toMatch(/50%/);
    expect(budgetWarning(80)).toMatch(/80%/);
    expect(budgetWarning(100)).toMatch(/over/);
  });
});
