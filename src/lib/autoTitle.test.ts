import { describe, expect, it, vi } from "vitest";
vi.mock("../store", () => ({ useApp: { getState: () => ({ appSettings: {} }) } }));
import { titleFromTranscript } from "./autoTitle";

const L = (o: unknown) => JSON.stringify(o);
describe("titleFromTranscript", () => {
  it("names the session after its first real ask, skipping 'yes' and slash commands", () => {
    const lines = [
      L({ type: "user", uuid: "u0", message: { content: "/compact" } }),
      L({ type: "user", uuid: "u1", message: { content: "Add seasons to the farm, cycling every 60 seconds" } }),
      L({ type: "user", uuid: "u2", message: { content: "yes" } }),
    ];
    expect(titleFromTranscript(lines)).toBe("Add seasons to the farm");
    expect(titleFromTranscript([])).toBe("");
  });
});
