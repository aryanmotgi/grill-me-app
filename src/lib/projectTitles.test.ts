import { describe, expect, it, vi } from "vitest";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
import { projectTitles } from "../store";

describe("session names per project", () => {
  it("reads the open project's names", () => {
    const s = projectTitles({ activeProject: "demo", titlesPerProject: true, sessionTitles: { me: "Farm thing" }, "sessionTitles:demo": { me: "Demo thing" } });
    expect(s.sessionTitles).toEqual({ me: "Demo thing" });
  });
  it("a project with no names yet starts empty, not with another project's", () => {
    const s = projectTitles({ activeProject: "demo", titlesPerProject: true, sessionTitles: { me: "Farm thing" }, "sessionTitles:farm": { me: "Farm thing" } });
    expect(s.sessionTitles).toEqual({});
  });
  it("names saved before go to the project open at the first load", () => {
    const s = projectTitles({ activeProject: "farm", sessionTitles: { me: "Farm thing" } });
    expect(s["sessionTitles:farm"]).toEqual({ me: "Farm thing" });
    expect(s.titlesPerProject).toBe(true);
  });
});
