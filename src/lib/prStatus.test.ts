import { describe, it, expect } from "vitest";
import { ciStatus, reviewState, parsePrList } from "./prStatus";

describe("ciStatus", () => {
  it("returns none for empty or missing rollups", () => {
    expect(ciStatus(null)).toBe("none");
    expect(ciStatus(undefined)).toBe("none");
    expect(ciStatus([])).toBe("none");
  });

  it("passes when every completed check succeeded", () => {
    expect(
      ciStatus([
        { status: "COMPLETED", conclusion: "SUCCESS" },
        { status: "COMPLETED", conclusion: "SKIPPED" },
      ]),
    ).toBe("pass");
  });

  it("fails outright if any check failed, even amid pending ones", () => {
    expect(
      ciStatus([
        { status: "IN_PROGRESS", conclusion: null },
        { status: "COMPLETED", conclusion: "FAILURE" },
      ]),
    ).toBe("fail");
  });

  it("is pending when a check is still running and none failed", () => {
    expect(
      ciStatus([
        { status: "COMPLETED", conclusion: "SUCCESS" },
        { status: "QUEUED", conclusion: null },
      ]),
    ).toBe("pending");
  });

  it("reads StatusContext state entries too", () => {
    expect(ciStatus([{ state: "SUCCESS" }])).toBe("pass");
    expect(ciStatus([{ state: "ERROR" }])).toBe("fail");
    expect(ciStatus([{ state: "PENDING" }])).toBe("pending");
  });
});

describe("reviewState", () => {
  it("maps gh enums and treats empty/null as none", () => {
    expect(reviewState("APPROVED")).toBe("approved");
    expect(reviewState("CHANGES_REQUESTED")).toBe("changes_requested");
    expect(reviewState("REVIEW_REQUIRED")).toBe("review_required");
    expect(reviewState("")).toBe("none");
    expect(reviewState(null)).toBe("none");
  });
});

describe("parsePrList", () => {
  it("returns [] for empty input", () => {
    expect(parsePrList("")).toEqual([]);
    expect(parsePrList("   ")).toEqual([]);
  });

  it("shapes rows and derives ci + review + author fallback", () => {
    const json = JSON.stringify([
      {
        number: 42,
        title: "Add thing",
        headRefName: "feat/thing",
        isDraft: false,
        reviewDecision: "APPROVED",
        author: { login: "ada" },
        statusCheckRollup: [{ status: "COMPLETED", conclusion: "SUCCESS" }],
      },
      {
        number: 43,
        title: "WIP",
        headRefName: "wip",
        isDraft: true,
        reviewDecision: "",
        author: null,
        statusCheckRollup: [],
      },
    ]);
    const rows = parsePrList(json);
    expect(rows).toEqual([
      { number: 42, title: "Add thing", branch: "feat/thing", author: "ada", isDraft: false, ci: "pass", review: "approved" },
      { number: 43, title: "WIP", branch: "wip", author: "unknown", isDraft: true, ci: "none", review: "none" },
    ]);
  });

  it("throws on malformed JSON so callers can show an error state", () => {
    expect(() => parsePrList("{not json")).toThrow();
  });
});
