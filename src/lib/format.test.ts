import { describe, expect, it } from "vitest";
import { fmtUsd } from "./format";

describe("fmtUsd", () => {
  it("renders zero as an exact dollar amount, not free", () => {
    expect(fmtUsd(0)).toBe("$0.00");
  });

  it("floors a real-but-tiny spend to <$0.01 so it never reads as free", () => {
    expect(fmtUsd(0.004)).toBe("<$0.01");
  });

  it("shows two decimals with thousands separators", () => {
    expect(fmtUsd(18)).toBe("$18.00");
    expect(fmtUsd(1234.5)).toBe("$1,234.50");
  });
});
