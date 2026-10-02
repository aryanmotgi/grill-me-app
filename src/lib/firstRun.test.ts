import { describe, expect, it } from "vitest";
import { firstRunStepOf, initialFirstRunStep, nextStep, prevStep, stepNumber } from "./firstRun";

describe("first run", () => {
  it("new users start at welcome; existing users skip it", () => {
    expect(initialFirstRunStep({})).toBe("welcome");
    expect(initialFirstRunStep({ appMode: "solo" })).toBe("done");
    expect(initialFirstRunStep({ activeProject: "p" })).toBe("done");
    expect(initialFirstRunStep({ onboarded: true })).toBe("done");
  });
  it("walks forward and back in order", () => {
    expect(nextStep("welcome")).toBe("check");
    expect(nextStep("consent")).toBe("team");
    expect(nextStep("team")).toBe("done");
    expect(prevStep("check")).toBe("welcome");
    expect(prevStep("welcome")).toBe("welcome");
  });
  it("reads saved steps defensively", () => {
    expect(firstRunStepOf("project")).toBe("project");
    expect(firstRunStepOf("done")).toBe("done");
    expect(firstRunStepOf("bogus")).toBe("welcome");
    expect(firstRunStepOf(undefined)).toBe("welcome");
  });
  it("numbers steps for the progress label", () => {
    expect(stepNumber("welcome")).toBe(1);
    expect(stepNumber("team")).toBe(5);
  });
});
