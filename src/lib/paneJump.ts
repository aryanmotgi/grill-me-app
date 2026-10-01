import { create } from "zustand";

/** "Open this session on that tab" — set by a jump (brain search → a commit
 *  opens its session's Changes), consumed once by the SessionPane it targets. */
export type JumpTab = "chat" | "changes";

export const usePaneJump = create<{ req: { session: string; tab: JumpTab } | null; jump: (session: string, tab: JumpTab) => void }>((set) => ({
  req: null,
  jump: (session, tab) => set({ req: { session, tab } }),
}));
