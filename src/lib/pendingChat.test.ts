import { describe, expect, it } from "vitest";
import { unseen } from "./pendingChat";

describe("messages you just sent", () => {
  const now = 1_790_000_000_000;
  it("stays until the transcript shows it, then goes", () => {
    const p = [{ text: "Fix the login bug please", at: now - 2000 }];
    expect(unseen(p, [], now)).toHaveLength(1);
    expect(unseen(p, [{ text: "an older message", ts: now - 600_000 }], now)).toHaveLength(1);
    expect(unseen(p, [{ text: "fix the login  bug please", ts: now - 1500 }], now)).toHaveLength(0);
  });
  it("gives up after a minute", () => {
    expect(unseen([{ text: "hi", at: now - 61_000 }], [], now)).toHaveLength(0);
  });
});
