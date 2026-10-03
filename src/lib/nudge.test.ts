import { describe, expect, it } from "vitest";
import { NUDGE_COOLDOWN_MS, NUDGE_STABLE_MS, nextNudgeState, shouldNudge } from "./nudge";

const T0 = 1_000_000_000;
const settled = T0 + NUDGE_STABLE_MS + 1;

describe("commit nudge", () => {
  it("asks once the pile has been big and stable and the session is idle", () => {
    expect(shouldNudge(12, true, settled, { bigSince: T0 })).toBe(true);
  });

  it("stays quiet while the pile is small, busy, or freshly grown", () => {
    expect(shouldNudge(9, true, settled, { bigSince: T0 })).toBe(false);
    expect(shouldNudge(12, false, settled, { bigSince: T0 })).toBe(false);
    expect(shouldNudge(12, true, T0 + 60_000, { bigSince: T0 })).toBe(false);
  });

  it("never asks twice about the same pile — the loop this fixes", () => {
    const asked = { bigSince: T0, nudgedAt: settled, asked: true };
    // an hour later, nothing committed: same pile, no second ask
    const later = settled + NUDGE_COOLDOWN_MS + 1;
    expect(shouldNudge(12, true, later, asked)).toBe(false);
    // and a day later, still no
    expect(shouldNudge(12, true, later + 24 * 3600_000, asked)).toBe(false);
  });

  it("earns a fresh ask once the pile actually shrinks", () => {
    const asked = { bigSince: T0, nudgedAt: settled, asked: true };
    const cleared = nextNudgeState(3, settled, asked);     // they committed
    expect(cleared.asked).toBeUndefined();
    const rebuilt = nextNudgeState(14, settled, cleared);  // a new pile builds
    expect(rebuilt.bigSince).toBe(settled);
    expect(shouldNudge(14, true, settled + NUDGE_STABLE_MS + 1, rebuilt)).toBe(true);
  });

  it("keeps counting brand-new files, not just modified ones", () => {
    // 12 untracked files is still a pile worth one ask
    expect(shouldNudge(12, true, settled, { bigSince: T0 })).toBe(true);
  });
});
