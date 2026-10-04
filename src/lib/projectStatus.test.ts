import { describe, expect, it } from "vitest";
import { projectOf, projectStates, stateLabel, type PtyLite } from "./projectStatus";

const p = (id: string, over: Partial<PtyLite> = {}): PtyLite => ({ id, alive: true, quietMs: 60_000, bell: false, oscNotify: false, tail: [], ...over });

describe("project status", () => {
  it("knows which project a terminal belongs to", () => {
    expect(projectOf("me")).toBe("default");
    expect(projectOf("farm:me")).toBe("farm");
    expect(projectOf("farm:me:shell")).toBeNull();
  });
  it("counts what's working and what needs you, per project", () => {
    const s = projectStates([
      p("farm:me", { quietMs: 500 }), p("farm:barn", { bell: true }), p("farm:x", { alive: false }),
      p("rouge:me"), p("me", { quietMs: 100 }), p("farm:me:shell", { quietMs: 1 }),
    ]);
    expect(s.farm).toEqual({ running: 2, working: 1, needs: 1 });
    expect(s.rouge).toEqual({ running: 1, working: 0, needs: 0 });
    expect(s.default).toEqual({ running: 1, working: 1, needs: 0 });
    expect(stateLabel(s.farm)).toEqual({ text: "Needs you", tone: "needs" });
    expect(stateLabel(s.default).text).toBe("1 working");
    expect(stateLabel(s.rouge).text).toBe("1 open");
    expect(stateLabel(undefined).text).toBe("");
  });
});
