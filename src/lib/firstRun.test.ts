import { describe, expect, it } from "vitest";
import { firstRunStepOf, initialFirstRunStep, nextStep, prevStep, stepNumber } from "./firstRun";

describe("first run", () => {
  it("new users start at welcome; existing users skip it", () => {
    expect(initialFirstRunStep({})).toBe("welcome");
    expect(initialFirstRunStep({ appMode: "solo" })).toBe("done");
    expect(initialFirstRunStep({ activeProject: "p" })).toBe("done");
    expect(initialFirstRunStep({ onboarded: true })).toBe("done");
  });
  it("walks forward and back through six steps", () => {
    expect(nextStep("welcome")).toBe("setup");
    expect(nextStep("setup")).toBe("project");
    expect(nextStep("project")).toBe("tools");
    expect(nextStep("tools")).toBe("workflow");
    expect(nextStep("workflow")).toBe("finish");
    expect(nextStep("finish")).toBe("done");
    expect(prevStep("setup")).toBe("welcome");
    expect(prevStep("welcome")).toBe("welcome");
  });
  it("reads saved steps defensively, including older step names", () => {
    expect(firstRunStepOf("project")).toBe("project");
    expect(firstRunStepOf("done")).toBe("done");
    expect(firstRunStepOf("connect")).toBe("setup");
    expect(firstRunStepOf("scan")).toBe("tools");
    expect(firstRunStepOf("team")).toBe("finish");
    expect(firstRunStepOf("bogus")).toBe("welcome");
    expect(firstRunStepOf(undefined)).toBe("welcome");
  });
  it("numbers steps for the progress label", () => {
    expect(stepNumber("welcome")).toBe(1);
    expect(stepNumber("finish")).toBe(6);
  });
});
