import { describe, expect, it } from "vitest";
import { readiness } from "../components/ShipQueue";

const row = { id: "a", branch: "feat/a", base: "main", ahead: 2, dirty: 0, onDefault: false };

describe("ship readiness", () => {
  it("ships branches with work and passing/unknown tests", () => {
    expect(readiness(row, undefined)).toBe("ready");
    expect(readiness(row, true)).toBe("ready");
    expect(readiness({ ...row, ahead: 0, dirty: 3 }, undefined)).toBe("ready");
  });
  it("holds back failing, empty, and default-branch sessions", () => {
    expect(readiness(row, false)).toBe("tests-failing");
    expect(readiness({ ...row, ahead: 0, dirty: 0 }, true)).toBe("nothing");
    expect(readiness({ ...row, onDefault: true }, true)).toBe("default-branch");
  });
});
