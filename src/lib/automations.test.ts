import { describe, expect, it } from "vitest";
import { automationOn, dayKey, dueDaily, newTopic, parseClock, withAutomation } from "./automations";

describe("automations settings", () => {
  it("uses defaults, overrides, and the legacy plan-check key", () => {
    expect(automationOn({}, "waiting-reminder")).toBe(true);
    expect(automationOn({}, "auto-test")).toBe(false);
    expect(automationOn({ automations: { "auto-test": true } }, "auto-test")).toBe(true);
    expect(automationOn({ brainChecks: false }, "review-replies")).toBe(false);
    expect(withAutomation({}, "review-replies", false)).toEqual(["brainChecks", false]);
    expect(withAutomation({ automations: { a: true } }, "auto-test", true)).toEqual(["automations", { a: true, "auto-test": true }]);
  });
});

describe("scheduling", () => {
  it("parses clock times", () => {
    expect(parseClock("09:00")).toBe(540);
    expect(parseClock("25:00")).toBeNull();
    expect(parseClock("nope")).toBeNull();
  });
  it("fires daily jobs once, after their time, weekdays only", () => {
    const mon930 = new Date(2026, 8, 28, 9, 30); // Monday
    const mon830 = new Date(2026, 8, 28, 8, 30);
    const sat930 = new Date(2026, 8, 26, 9, 30);
    expect(dueDaily(mon930, "09:00", undefined, true)).toBe(true);
    expect(dueDaily(mon830, "09:00", undefined, true)).toBe(false);
    expect(dueDaily(mon930, "09:00", dayKey(mon930), true)).toBe(false);
    expect(dueDaily(sat930, "09:00", undefined, true)).toBe(false);
  });
  it("makes long random topics", () => {
    const t = newTopic();
    expect(t).toMatch(/^grillme-[0-9a-f]{24}$/);
    expect(newTopic()).not.toBe(t);
  });
});
