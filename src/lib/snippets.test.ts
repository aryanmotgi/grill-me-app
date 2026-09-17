import { describe, expect, it } from "vitest";
import {
  STARTER_SNIPPETS,
  deleteSnippet,
  isValidSnippet,
  loadSnippets,
  newSnippetId,
  upsertSnippet,
  type Snippet,
} from "./snippets";

const snip = (over: Partial<Snippet> & Pick<Snippet, "id">): Snippet => ({
  title: over.id,
  body: "body",
  ...over,
});

describe("loadSnippets", () => {
  it("seeds the starter set when nothing has ever been stored", () => {
    expect(loadSnippets(undefined)).toEqual(STARTER_SNIPPETS);
  });

  it("seeds starters for non-array garbage", () => {
    expect(loadSnippets("nope")).toEqual(STARTER_SNIPPETS);
    expect(loadSnippets({ a: 1 })).toEqual(STARTER_SNIPPETS);
  });

  it("returns an empty array as-is — a cleared library is not re-seeded", () => {
    expect(loadSnippets([])).toEqual([]);
  });

  it("keeps valid entries in order and drops malformed ones", () => {
    const raw = [
      { id: "a", title: "A", body: "x" },
      { id: "b", title: 42, body: "y" }, // bad title type
      { nope: true },
      { id: "c", title: "C", body: "z" },
    ];
    expect(loadSnippets(raw)).toEqual([
      { id: "a", title: "A", body: "x" },
      { id: "c", title: "C", body: "z" },
    ]);
  });
});

describe("isValidSnippet", () => {
  it("requires a non-blank title and body", () => {
    expect(isValidSnippet({ title: "t", body: "b" })).toBe(true);
    expect(isValidSnippet({ title: "  ", body: "b" })).toBe(false);
    expect(isValidSnippet({ title: "t", body: "   " })).toBe(false);
  });
});

describe("upsertSnippet", () => {
  it("appends a new snippet, trimming the title but preserving body formatting", () => {
    const out = upsertSnippet([], { id: "1", title: "  Hello  ", body: "line1\n  line2" });
    expect(out).toEqual([{ id: "1", title: "Hello", body: "line1\n  line2" }]);
  });

  it("replaces an existing snippet by id, in place", () => {
    const list = [snip({ id: "a" }), snip({ id: "b" }), snip({ id: "c" })];
    const out = upsertSnippet(list, { id: "b", title: "B2", body: "new" });
    expect(out.map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(out[1]).toEqual({ id: "b", title: "B2", body: "new" });
  });

  it("returns the list unchanged for a blank title or body", () => {
    const list = [snip({ id: "a" })];
    expect(upsertSnippet(list, { id: "z", title: "  ", body: "b" })).toBe(list);
    expect(upsertSnippet(list, { id: "z", title: "t", body: " " })).toBe(list);
  });

  it("does not mutate the input array", () => {
    const list = [snip({ id: "a" })];
    upsertSnippet(list, { id: "b", title: "B", body: "b" });
    expect(list).toHaveLength(1);
  });
});

describe("deleteSnippet", () => {
  it("removes the matching id and leaves the rest", () => {
    const list = [snip({ id: "a" }), snip({ id: "b" })];
    expect(deleteSnippet(list, "a")).toEqual([snip({ id: "b" })]);
  });

  it("is a no-op when the id is absent", () => {
    const list = [snip({ id: "a" })];
    expect(deleteSnippet(list, "zzz")).toEqual(list);
  });
});

describe("newSnippetId", () => {
  it("produces distinct, prefixed ids", () => {
    const a = newSnippetId();
    const b = newSnippetId();
    expect(a).toMatch(/^snip-/);
    expect(a).not.toEqual(b);
  });
});
