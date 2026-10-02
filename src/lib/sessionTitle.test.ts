import { describe, expect, it } from "vitest";
import { sessionTitle, withTitle } from "./sessionTitle";

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
