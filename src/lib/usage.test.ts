import { describe, expect, it } from "vitest";
import { untilLabel, usageTone } from "./usage";

describe("plan usage formatting", () => {
  const now = Date.parse("2026-09-29T07:00:00Z");
  it("formats time until reset", () => {
    expect(untilLabel("2026-09-29T07:07:30Z", now)).toBe("7m");
    expect(untilLabel("2026-09-29T08:40:00Z", now)).toBe("1h 40m");
    expect(untilLabel("2026-09-30T16:00:00Z", now)).toBe("1d 9h");
    expect(untilLabel("2026-09-29T06:00:00Z", now)).toBe("");
    expect(untilLabel(null, now)).toBe("");
  });
  it("bands severity", () => {
    expect(usageTone(40)).toBe("ok");
    expect(usageTone(80)).toBe("warn");
    expect(usageTone(97)).toBe("hot");
    expect(usageTone(null)).toBe("ok");
  });
});
