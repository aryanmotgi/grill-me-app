import { create } from "zustand";

// Last auto-test result per session — written by the Automations engine,
// read by tab badges, the Flow view and the team digest.
export interface TestResult { ok: boolean; ms: number; tail: string; cmd: string; at: number; sig: string; running?: boolean }

export const useTests = create<{ results: Record<string, TestResult> }>(() => ({ results: {} }));

/** true/false from the last finished run, null when none. */
export function lastTestOk(id: string): boolean | null {
  const r = useTests.getState().results[id];
  return r && !r.running ? r.ok : null;
}
