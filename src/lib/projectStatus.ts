// ---------------------------------------------------------------------------
// What's happening in each project, from the live terminals (pty_status
// lists every project's sessions: "<project>:<member>", or just "<member>"
// in the default project). For the sidebar's project list, so you can see
// another project needs you without switching to it. Pure.
// ---------------------------------------------------------------------------

export interface PtyLite { id: string; alive: boolean; quietMs: number; bell: boolean; oscNotify: boolean; tail: string[] }
export interface ProjectState { running: number; working: number; needs: number }

const TRUST = /yes, i trust this folder|do you trust the files in this folder/i;

/** The project a terminal belongs to, or null for helper terminals (":shell", dev servers). */
export function projectOf(ptyId: string): string | null {
  const parts = ptyId.split(":");
  if (parts.length === 1) return "default";
  if (parts.length === 2) return parts[0];
  return null;
}

export function projectStates(ptys: PtyLite[]): Record<string, ProjectState> {
  const out: Record<string, ProjectState> = {};
  for (const p of ptys) {
    const proj = projectOf(p.id);
    if (!proj || !p.alive) continue;
    const s = (out[proj] ??= { running: 0, working: 0, needs: 0 });
    s.running++;
    if (p.bell || p.oscNotify || TRUST.test(p.tail.slice(-20).join("\n"))) s.needs++;
    else if (p.quietMs < 4000) s.working++;
  }
  return out;
}

/** "Needs you", "2 working", "1 running", or "". */
export function stateLabel(s: ProjectState | undefined): { text: string; tone: "needs" | "working" | "quiet" } {
  if (!s) return { text: "", tone: "quiet" };
  if (s.needs) return { text: s.needs === 1 ? "Needs you" : `${s.needs} need you`, tone: "needs" };
  if (s.working) return { text: `${s.working} working`, tone: "working" };
  return { text: `${s.running} open`, tone: "quiet" };
}
