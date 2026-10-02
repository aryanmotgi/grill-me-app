import { describe, expect, it } from "vitest";
import { MAX_ANSWERS, REPLY_SCHEMA, buildPrompt, complete, filled, knownFromScan, mergeReply } from "./interview";
import type { WorkflowProfile } from "./profile";

const empty = (): WorkflowProfile => ({ pains: [], agents: ["claude"], source: "form", updated: 0 });

describe("interview", () => {
  it("schema requires every field (Codex needs that) and allows nulls", () => {
    expect([...REPLY_SCHEMA.required].sort()).toEqual(Object.keys(REPLY_SCHEMA.properties).sort());
    expect(REPLY_SCHEMA.properties.building.enum).toContain(null);
  });
  it("keeps only allowed values from the AI", () => {
    const r = mergeReply(empty(), { say: "Cool. Solo?", building: "web", team: "galaxy", style: null, pains: ["testing", "vibes", "review"], agents: ["codex", "skynet"], done: false });
    expect(r.say).toBe("Cool. Solo?");
    expect(r.profile.building).toBe("web");
    expect(r.profile.team).toBeUndefined();
    expect(r.profile.pains).toEqual(["testing", "review"]);
    expect(r.profile.agents).toEqual(["claude", "codex"]);
    expect(r.profile.source).toBe("interview");
  });
  it("empty fields keep what we already had", () => {
    const before = { ...empty(), building: "web" as const, pains: ["testing" as const] };
    const r = mergeReply(before, { say: "", building: null, team: "small", pains: [], agents: [], done: true });
    expect(r.profile.building).toBe("web");
    expect(r.profile.team).toBe("small");
    expect(r.profile.pains).toEqual(["testing"]);
    expect(r.done).toBe(true);
    expect(r.say.length).toBeGreaterThan(0);
  });
  it("survives garbage", () => {
    expect(mergeReply(empty(), null).profile.pains).toEqual([]);
    expect(mergeReply(empty(), "lol").done).toBe(false);
  });
  it("tells the AI what the scan knows and when to wrap up", () => {
    const scan = { ts: 1, sources: [], checked: [], agents: { bins: ["claude"], apps: [] }, stack: { languages: ["TypeScript"], frameworks: ["React"] } };
    expect(knownFromScan(scan as never)).toEqual(["AI tools installed: claude", "Project stack: TypeScript, React"]);
    const turns = Array.from({ length: MAX_ANSWERS - 1 }, () => [{ who: "ai" as const, text: "q" }, { who: "you" as const, text: "a" }]).flat();
    const p = buildPrompt(turns, empty(), scan as never);
    expect(p).toContain("don't ask");
    expect(p).toContain("last turn");
    expect(buildPrompt(turns.slice(0, 2), empty())).not.toContain("last turn");
  });
  it("caps very long answers in the prompt", () => {
    const p = buildPrompt([{ who: "you", text: "x".repeat(5000) }], empty());
    expect(p.length).toBeLessThan(1400);
  });
  it("tracks which fields are filled", () => {
    const p = { ...empty(), building: "web" as const, team: "solo" as const, style: "agents" as const };
    expect(filled(p).filter((f) => f.done).length).toBe(3);
    expect(complete(p)).toBe(false);
    expect(complete({ ...p, pains: ["testing"] })).toBe(true);
  });
});
