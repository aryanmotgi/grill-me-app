import { describe, expect, it } from "vitest";
import { reconcileShared } from "./roomSync";

const t = (id: string, extra: Record<string, unknown> = {}) => ({ id, ...extra });

describe("reconcileShared", () => {
  it("pushes up local entries the host has never seen (offline-created)", () => {
    const authority = [t("a")];
    const local = [t("a"), t("b"), t("c")]; // b,c made while disconnected
    const r = reconcileShared(authority, local, []);
    expect(r.pushUp.map((x) => x.id)).toEqual(["b", "c"]);
    expect(r.removeDown).toEqual([]);
  });

  it("deletes locally what the host tombstoned (a peer's delete propagates)", () => {
    const authority = [t("a")];
    const local = [t("a"), t("x")]; // x was deleted elsewhere
    const r = reconcileShared(authority, local, ["x"]);
    expect(r.removeDown).toEqual(["x"]);
    expect(r.pushUp).toEqual([]);
  });

  it("does NOT resurrect a tombstoned entry via push-up", () => {
    // reconnecting peer still holds x, which is BOTH absent from authority and
    // tombstoned — must be deleted, never re-pushed.
    const authority: Array<{ id: string }> = [];
    const local = [t("x")];
    const r = reconcileShared(authority, local, ["x"]);
    expect(r.removeDown).toEqual(["x"]);
    expect(r.pushUp).toEqual([]);
  });

  it("is a no-op when local already matches authority", () => {
    const authority = [t("a"), t("b")];
    const local = [t("a"), t("b")];
    const r = reconcileShared(authority, local, []);
    expect(r.removeDown).toEqual([]);
    expect(r.pushUp).toEqual([]);
  });

  it("leaves id-less legacy entries untouched (never pushed or removed)", () => {
    const authority = [t("a")];
    const local = [t("a"), { text: "no id" } as { id?: string }];
    const r = reconcileShared(authority, local, []);
    expect(r.pushUp).toEqual([]);
    expect(r.removeDown).toEqual([]);
  });

  it("handles the combined case: pull down a delete AND push up a new entry", () => {
    const authority = [t("a")];
    const local = [t("a"), t("gone"), t("mine")];
    const r = reconcileShared(authority, local, ["gone"]);
    expect(r.removeDown).toEqual(["gone"]);
    expect(r.pushUp.map((x) => x.id)).toEqual(["mine"]);
  });
});
