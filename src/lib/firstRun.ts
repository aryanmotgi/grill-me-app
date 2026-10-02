// ---------------------------------------------------------------------------
// First-run setup, step by step. The current step lives in settings.json
// (`firstRunStep`) so quitting — or the reload that opening a project does —
// resumes exactly where the user left off. Users from before this existed
// are marked "done" on first boot and never see it.
// ---------------------------------------------------------------------------

export const FIRST_RUN_STEPS = ["welcome", "setup", "project", "tools", "workflow", "finish"] as const;
export type FirstRunStep = (typeof FIRST_RUN_STEPS)[number] | "done";

/** Steps from older builds, folded into today's six. */
const OLD_STEPS: Record<string, FirstRunStep> = { check: "setup", connect: "setup", scan: "tools", consent: "finish", team: "finish" };

export function firstRunStepOf(v: unknown): FirstRunStep {
  if (v === "done" || (FIRST_RUN_STEPS as readonly unknown[]).includes(v)) return v as FirstRunStep;
  if (typeof v === "string" && OLD_STEPS[v]) return OLD_STEPS[v];
  return "welcome";
}

/** What to pin on first boot when no step is saved yet. */
export function initialFirstRunStep(settings: Record<string, unknown>): FirstRunStep {
  const existing = settings.appMode != null || settings.activeProject != null || settings.onboarded === true;
  return existing ? "done" : "welcome";
}

export function nextStep(step: FirstRunStep): FirstRunStep {
  if (step === "done") return "done";
  const i = FIRST_RUN_STEPS.indexOf(step);
  return FIRST_RUN_STEPS[i + 1] ?? "done";
}

export function prevStep(step: FirstRunStep): FirstRunStep {
  if (step === "done") return "finish";
  const i = FIRST_RUN_STEPS.indexOf(step);
  return FIRST_RUN_STEPS[Math.max(0, i - 1)];
}

/** 1-based position for "Step N of M". */
export function stepNumber(step: FirstRunStep): number {
  return step === "done" ? FIRST_RUN_STEPS.length : FIRST_RUN_STEPS.indexOf(step) + 1;
}
