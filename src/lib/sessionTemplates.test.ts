import { describe, expect, it } from "vitest";
import {
  isSessionTemplate,
  loadTemplates,
  sanitizeTemplate,
  slugify,
  STARTER_TEMPLATES,
  templateBranch,
  type SessionTemplate,
} from "./sessionTemplates";

const tpl = (over: Partial<SessionTemplate> = {}): SessionTemplate => ({
  name: "bugfix",
  branchPrefix: "fix",
  startingPrompt: "reproduce then fix",
  ...over,
});

describe("slugify", () => {
  it("lowercases, replaces runs of non-alphanumerics with a single dash", () => {
    expect(slugify("Add Login Page")).toBe("add-login-page");
    expect(slugify("foo___bar!!!baz")).toBe("foo-bar-baz");
  });
  it("trims leading/trailing dashes", () => {
    expect(slugify("  /hello/  ")).toBe("hello");
  });
  it("falls back to 'session' for empty/symbol-only input", () => {
    expect(slugify("")).toBe("session");
    expect(slugify("///")).toBe("session");
  });
});

describe("templateBranch", () => {
  it("joins slugified prefix and descriptor with a slash", () => {
    expect(templateBranch(tpl(), "Fix the navbar")).toBe("fix/fix-the-navbar");
  });
  it("strips slashes from a hand-typed prefix so the ref stays well-formed", () => {
    expect(templateBranch(tpl({ branchPrefix: "feat/" }), "inbox")).toBe("feat/inbox");
  });
  it("never leaves a dangling prefix for a blank descriptor", () => {
    expect(templateBranch(tpl(), "")).toBe("fix/session");
  });
});

describe("isSessionTemplate", () => {
  it("accepts a fully-populated template", () => {
    expect(isSessionTemplate(tpl())).toBe(true);
  });
  it("rejects missing, blank, or wrong-typed fields", () => {
    expect(isSessionTemplate(null)).toBe(false);
    expect(isSessionTemplate({})).toBe(false);
    expect(isSessionTemplate(tpl({ name: "   " }))).toBe(false);
    expect(isSessionTemplate({ ...tpl(), startingPrompt: 42 })).toBe(false);
  });
});

describe("sanitizeTemplate", () => {
  it("trims each field and returns the template", () => {
    expect(sanitizeTemplate({ name: " a ", branchPrefix: " b ", startingPrompt: " c " }))
      .toEqual({ name: "a", branchPrefix: "b", startingPrompt: "c" });
  });
  it("returns null when any required field is blank or absent", () => {
    expect(sanitizeTemplate({ name: "a", branchPrefix: "b", startingPrompt: "  " })).toBeNull();
    expect(sanitizeTemplate({ name: "a" })).toBeNull();
  });
});

describe("loadTemplates", () => {
  it("returns starters when nothing is stored", () => {
    expect(loadTemplates({})).toEqual(STARTER_TEMPLATES);
  });
  it("returns starters when the stored value is not an array of valid templates", () => {
    expect(loadTemplates({ sessionTemplates: "nope" })).toEqual(STARTER_TEMPLATES);
    expect(loadTemplates({ sessionTemplates: [] })).toEqual(STARTER_TEMPLATES);
    expect(loadTemplates({ sessionTemplates: [{ name: "x" }] })).toEqual(STARTER_TEMPLATES);
  });
  it("returns only the well-shaped stored templates, dropping malformed ones", () => {
    const good = tpl({ name: "custom" });
    expect(loadTemplates({ sessionTemplates: [good, { name: "bad" }] })).toEqual([good]);
  });
});
