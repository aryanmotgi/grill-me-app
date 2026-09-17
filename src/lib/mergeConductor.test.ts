import { describe, expect, it } from "vitest";
import { conductorStep } from "./mergeConductor";

describe("conductorStep", () => {
  it("empty queue → done:false, no head, nothing to merge", () => {
    const s = conductorStep([], {});
    expect(s.head).toBeNull();
    expect(s.next).toBeNull();
    expect(s.done).toBe(false);
    expect(s.total).toBe(0);
    expect(s.remaining).toBe(0);
  });

  it("single-member queue exposes a head but no next branch to predict", () => {
    const s = conductorStep(["a"], {});
    expect(s.head).toBe("a");
    expect(s.next).toBeNull();
    expect(s.done).toBe(false);
    expect(s.remaining).toBe(1);
  });

  it("fresh multi-member walk points at head + next", () => {
    const s = conductorStep(["a", "b", "c"], {});
    expect(s.head).toBe("a");
    expect(s.next).toBe("b");
    expect(s.done).toBe(false);
    expect(s.total).toBe(3);
    expect(s.remaining).toBe(3);
  });

  it("after the head rotates to the tail, the new head is surfaced", () => {
    // merged "a" → store rotated queue to [b, c, a]; a recorded as merged
    const s = conductorStep(["b", "c", "a"], { a: "merged" });
    expect(s.head).toBe("b");
    expect(s.next).toBe("c");
    expect(s.done).toBe(false);
    expect(s.mergedCount).toBe(1);
    expect(s.remaining).toBe(2);
  });

  it("counts merged vs skipped independently", () => {
    const s = conductorStep(["c", "a", "b"], { a: "merged", b: "skipped" });
    expect(s.mergedCount).toBe(1);
    expect(s.skippedCount).toBe(1);
    expect(s.head).toBe("c");
    expect(s.remaining).toBe(1);
  });

  it("done once every queue member has been visited once", () => {
    const s = conductorStep(["a", "b", "c"], { a: "merged", b: "merged", c: "skipped" });
    expect(s.done).toBe(true);
    expect(s.head).toBeNull();
    expect(s.next).toBeNull();
    expect(s.remaining).toBe(0);
    expect(s.mergedCount).toBe(2);
    expect(s.skippedCount).toBe(1);
  });

  it("ignores stale visited ids no longer in the queue", () => {
    // "z" left the team mid-walk; it must not count toward completion
    const s = conductorStep(["a", "b"], { z: "merged" });
    expect(s.done).toBe(false);
    expect(s.head).toBe("a");
    expect(s.remaining).toBe(2);
  });
});
