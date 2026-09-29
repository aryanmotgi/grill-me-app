import { describe, expect, it } from "vitest";
import { grillPrefix } from "../components/NewSession";
import { clockLabel } from "../components/StatusBar";

describe("grillPrefix", () => {
  it("leads with the /grillme slash command", () => {
    expect(grillPrefix("grill", null)).toBe("/grillme ");
    expect(grillPrefix("", 5)).toBe("");
  });
  it("hackathon mode uses hours left, rounded up, min 1, default 24", () => {
    expect(grillPrefix("hack", 5.2)).toBe("/grillme --hackathon 6 ");
    expect(grillPrefix("hack", -1)).toBe("/grillme --hackathon 1 ");
    expect(grillPrefix("hack", null)).toBe("/grillme --hackathon 24 ");
  });
});

describe("clockLabel", () => {
  it("formats hours and minutes", () => {
    expect(clockLabel((5 * 60 + 7) * 60_000)).toBe("5h 07m");
    expect(clockLabel(42 * 60_000)).toBe("42m");
    expect(clockLabel(0)).toBe("time's up");
  });
});
