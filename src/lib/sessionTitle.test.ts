import { describe, expect, it } from "vitest";
import { sessionTitle, titleFromAsk, withTitle } from "./sessionTitle";

const mate = { id: "a", name: "Aryan", taskLabel: "App shell" };

describe("sessionTitle", () => {
  it("prefers a custom title, then task label, then name", () => {
    expect(sessionTitle(mate, { a: "Landing page" })).toBe("Landing page");
    expect(sessionTitle(mate, {})).toBe("App shell");
    expect(sessionTitle({ id: "a", name: "Aryan" }, undefined)).toBe("Aryan");
  });
  it("ignores blank or malformed titles", () => {
    expect(sessionTitle(mate, { a: "   " })).toBe("App shell");
    expect(sessionTitle(mate, "junk")).toBe("App shell");
  });
});

describe("withTitle", () => {
  it("sets, trims, and clears", () => {
    expect(withTitle({}, "a", "  New  ", "App shell")).toEqual({ a: "New" });
    expect(withTitle({ a: "X", b: "Y" }, "a", "", "App shell")).toEqual({ b: "Y" });
    expect(withTitle({ a: "X" }, "a", "App shell", "App shell")).toEqual({});
  });
});

describe("sessionTitle placeholders", () => {
  it("never titles a session with the no-task dash", () => {
    expect(sessionTitle({ id: "me", name: "Me", taskLabel: "—" }, {})).toBe("Me");
    expect(sessionTitle({ id: "me", name: "Me", taskLabel: " - " }, {})).toBe("Me");
  });
});

describe("titleFromAsk", () => {
  it("makes a short title from what you asked", () => {
    expect(titleFromAsk("can you please add seasons to the farm, cycling every 60 seconds")).toBe("Add seasons to the farm");
    expect(titleFromAsk("Fix the login bug. It crashes on submit")).toBe("Fix the login bug");
    expect(titleFromAsk("Small polish, two things:\n1. Show a tooltip on each plot\n2. coin pulse")).toBe("Show a tooltip on each plot");
    expect(titleFromAsk("Go ahead with it, but stay on this branch (feature/farm-sim):\n1. Show a tooltip on each plot with the crop name\n2. pulse")).toBe("Show a tooltip on each plot with the crop…");
    expect(titleFromAsk("ok, add a mute button")).toBe("Add a mute button");
    expect(titleFromAsk("Build a tiny browser farm simulator in plain HTML/CSS/JS with a shop")).toBe("Build a tiny browser farm simulator in…");
    expect(titleFromAsk("")).toBe("");
  });
});
