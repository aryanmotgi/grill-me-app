import { describe, expect, it } from "vitest";
import { parsePitch } from "./ShipPage";

const MD = `# X — pitch

## 1 · One-liner 🟢

**Name:** DealGhost
**Ten words:** [ ]

---

## 6 · Market 🔴

**Head:** Sized bottom-up, not borrowed.
**Verified:** no
**Terms:**
- — | Revenue teams already recording calls
- 12 | Seats per team

---

## 14 · Demo path 🔴

> guidance that must be ignored
**Must work:** the alert lands on a real phone
**Steps:**
- 0–15 | open the deal | the timeline renders
**Fallback:** [ the sentence you say if it breaks live ]

_Done when:_ you have run it twice.
`;

describe("parsePitch", () => {
  const secs = parsePitch(MD);

  it("reads every section with its status marker", () => {
    expect(secs.map((s) => s.n)).toEqual(["1", "6", "14"]);
    expect(secs[0].status).toBe("green");
    expect(secs[1].status).toBe("red");
    expect(secs[0].title).toBe("One-liner");
  });

  it("splits list rows on the pipe", () => {
    expect(secs[1].rows["Terms"]).toEqual([
      ["—", "Revenue teams already recording calls"],
      ["12", "Seats per team"],
    ]);
    expect(secs[2].rows["Steps"][0]).toEqual(["0–15", "open the deal", "the timeline renders"]);
  });

  it("reports bracketed and em-dash fields as unfilled, and nothing else", () => {
    expect(secs[0].blanks).toContain("Ten words");
    expect(secs[0].blanks).not.toContain("Name");
    expect(secs[1].blanks).toContain("Terms row 1");   // the em dash
    expect(secs[1].blanks).not.toContain("Terms row 2");
    expect(secs[2].blanks).toContain("Fallback");
  });

  it("ignores guidance lines and the done-when test", () => {
    expect(secs[2].fields["Must work"]).toBe("the alert lands on a real phone");
    expect(Object.keys(secs[2].fields)).not.toContain("_Done when:_");
  });
});
