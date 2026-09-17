import { describe, expect, it } from "vitest";
import { type AlertKind, DEFAULT_VOLUME, resolveAlert } from "./sounds";

const KINDS: AlertKind[] = ["message", "mention", "needs-input", "conflict", "merge-turn"];

describe("resolveAlert gating", () => {
  it("plays every kind at the default volume with empty settings", () => {
    for (const kind of KINDS) {
      const r = resolveAlert(kind, {});
      expect(r, kind).not.toBeNull();
      expect(r!.vol).toBe(DEFAULT_VOLUME);
      expect(r!.voice.steps.length).toBeGreaterThan(0);
    }
  });

  it("stays silent when muteAll is set", () => {
    for (const kind of KINDS) {
      expect(resolveAlert(kind, { muteAll: true })).toBeNull();
    }
  });

  it("respects a per-kind toggle off without affecting siblings", () => {
    const settings = { sounds: { conflict: false } };
    expect(resolveAlert("conflict", settings)).toBeNull();
    expect(resolveAlert("message", settings)).not.toBeNull();
  });

  it("treats volume 0 as silent and clamps out-of-range values", () => {
    expect(resolveAlert("message", { soundVolume: 0 })).toBeNull();
    expect(resolveAlert("message", { soundVolume: -1 })).toBeNull();
    expect(resolveAlert("message", { soundVolume: 5 })!.vol).toBe(1);
    expect(resolveAlert("message", { soundVolume: 0.4 })!.vol).toBe(0.4);
  });

  it("returns null for an unknown kind", () => {
    expect(resolveAlert("nope" as AlertKind, {})).toBeNull();
  });

  it("gives each kind a distinct pattern (recognizable, not identical)", () => {
    const signatures = KINDS.map((k) => {
      const v = resolveAlert(k, {})!.voice;
      return `${v.wave}:${v.steps.map(([f, d]) => `${f}/${d}`).join(",")}`;
    });
    expect(new Set(signatures).size).toBe(KINDS.length);
  });
});
