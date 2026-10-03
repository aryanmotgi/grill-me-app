import { describe, expect, it } from "vitest";
import { needsRewrite, parseRecap, recapFacts, sig, startOfDay } from "./recap";

describe("recap", () => {
  it("lists only what happened", () => {
    const f = recapFacts([
      { title: "Login", asks: ["add login with email"], files: ["Login.tsx", "auth.ts"], tests: "pass" },
      { title: "Idle", asks: [], files: [] },
    ], [{ message: "feat: login\n\nbody", at: 1 }]);
    expect(f).toBe('Session "Login": asked "add login with email"; changed Login.tsx, auth.ts; tests pass.\nCommit: feat: login');
    expect(recapFacts([], [])).toBe("");
  });
  it("rewrites only when the facts change, at most every 20 minutes", () => {
    const now = Date.parse("2026-10-03T15:00:00");
    const day = startOfDay(now);
    expect(needsRewrite(undefined, "a", now)).toBe(true);
    expect(needsRewrite({ day, sig: "a", at: now - 60_000 }, "a", now)).toBe(false);
    expect(needsRewrite({ day, sig: "a", at: now - 60_000 }, "b", now)).toBe(false);
    expect(needsRewrite({ day, sig: "a", at: now - 30 * 60_000 }, "b", now)).toBe(true);
    expect(needsRewrite({ day: day - 86_400_000, sig: "a", at: now }, "a", now)).toBe(true);
  });
  it("keeps a sane answer only", () => {
    expect(parseRecap({ recap: "You added login and fixed the navbar." })).toBe("You added login and fixed the navbar.");
    expect(parseRecap({ recap: "ok" })).toBeNull();
    expect(parseRecap("junk")).toBeNull();
    expect(sig("x")).toBe(sig("x"));
    expect(sig("x")).not.toBe(sig("y"));
  });
});
