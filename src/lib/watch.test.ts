import { describe, expect, it } from "vitest";
import { defaultWatchTarget, watchTargets } from "./watch";

const members = [
  { id: "aryan", name: "Aryan", repoPath: "/r/aryan" },
  { id: "mei", name: "Mei", repoPath: "/r/mei" },
  { id: "bob", name: "Bob", repoPath: "/r/bob" },
];

describe("watchTargets", () => {
  it("excludes your own session (ownId)", () => {
    expect(watchTargets(members, "aryan").map((m) => m.id)).toEqual(["mei", "bob"]);
  });

  it("returns everyone when ownId is absent", () => {
    expect(watchTargets(members, undefined).map((m) => m.id)).toEqual(["aryan", "mei", "bob"]);
  });

  it("is empty when the only member is yourself", () => {
    expect(watchTargets([members[0]], "aryan")).toEqual([]);
  });
});

describe("defaultWatchTarget", () => {
  it("prefers a valid preferred target", () => {
    expect(defaultWatchTarget(members, "aryan", "bob")).toBe("bob");
  });

  it("falls back to the first target when preferred is your own session", () => {
    expect(defaultWatchTarget(members, "aryan", "aryan")).toBe("mei");
  });

  it("falls back to the first target when preferred is unknown", () => {
    expect(defaultWatchTarget(members, "aryan", "ghost")).toBe("mei");
  });

  it("falls back to the first target when preferred is null", () => {
    expect(defaultWatchTarget(members, "aryan", null)).toBe("mei");
  });

  it("returns null when there is no one to watch", () => {
    expect(defaultWatchTarget([members[0]], "aryan", null)).toBeNull();
  });
});
