import { describe, expect, it } from "vitest";
import type { Message } from "../types";
import { helpRequestedIds, isHelpPending, isHelpRequest, openHelpRequests } from "./help";

const msg = (over: Partial<Message>): Message => ({
  id: "m1",
  from: "aryan",
  to: "all",
  text: "aryan needs eyes on feat/x",
  answered: false,
  ts: "10:00",
  kind: "blocking",
  help: true,
  ...over,
});

describe("isHelpRequest", () => {
  it("is true only for a blocking message tagged help", () => {
    expect(isHelpRequest(msg({}))).toBe(true);
  });

  it("is false for a plain blocking message (no help tag)", () => {
    expect(isHelpRequest(msg({ help: false }))).toBe(false);
    expect(isHelpRequest(msg({ help: undefined }))).toBe(false);
  });

  it("is false for a help-tagged message of another kind", () => {
    // only blocking-kind counts — a stray tag on a question/fyi is not a flag
    expect(isHelpRequest(msg({ kind: "question" }))).toBe(false);
    expect(isHelpRequest(msg({ kind: "fyi" }))).toBe(false);
  });
});

describe("isHelpPending", () => {
  it("is true when the member has an open help request", () => {
    expect(isHelpPending([msg({ from: "mei" })], "mei")).toBe(true);
  });

  it("is false once the help request is answered/resolved", () => {
    expect(isHelpPending([msg({ from: "mei", answered: true })], "mei")).toBe(false);
  });

  it("is scoped to the requesting member", () => {
    const msgs = [msg({ from: "mei" })];
    expect(isHelpPending(msgs, "mei")).toBe(true);
    expect(isHelpPending(msgs, "sam")).toBe(false);
  });

  it("ignores non-help blocking messages", () => {
    expect(isHelpPending([msg({ from: "mei", help: false })], "mei")).toBe(false);
  });
});

describe("helpRequestedIds", () => {
  it("collects every member with an open request, deduped", () => {
    const ids = helpRequestedIds([
      msg({ id: "a", from: "mei" }),
      msg({ id: "b", from: "mei" }), // duplicate member — deduped
      msg({ id: "c", from: "sam" }),
      msg({ id: "d", from: "dev", answered: true }), // resolved — excluded
      msg({ id: "e", from: "kim", help: false }), // not a flag — excluded
    ]);
    expect(ids).toEqual(new Set(["mei", "sam"]));
  });

  it("is empty when nothing is pending", () => {
    expect(helpRequestedIds([msg({ answered: true })]).size).toBe(0);
  });
});

describe("openHelpRequests", () => {
  it("returns only open help flags, input order preserved", () => {
    const open = openHelpRequests([
      msg({ id: "a", from: "mei" }),
      msg({ id: "b", from: "sam", answered: true }),
      msg({ id: "c", from: "dev" }),
    ]);
    expect(open.map((m) => m.id)).toEqual(["a", "c"]);
  });
});
