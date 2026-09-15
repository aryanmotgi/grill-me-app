import { create } from "zustand";
import {
  activity,
  ciWorkflows,
  mergeQueue,
  messages,
  sponsorChecklist,
  tasks,
  teammates,
} from "./data/fake";
import type {
  ActivityEvent,
  Message,
  Task,
  Teammate,
  Toast,
} from "./types";
import { startGitFeed, startWatchFeed, type WatchState } from "./data/sources/feeds";
import type { TeamMemberConfig } from "./data/sources/git";

export type RailTab = "tasks" | "inbox" | "activity" | "team" | "preview";

interface AppState {
  teammates: Teammate[];
  tasks: Task[];
  messages: Message[];
  activity: ActivityEvent[];
  ciWorkflows: typeof ciWorkflows;
  sponsorChecklist: typeof sponsorChecklist;
  mergeQueue: string[];

  activeId: string;
  splitId: string | null;
  railTab: RailTab;
  focusMode: boolean;
  demoMode: boolean;
  switcherOpen: boolean;
  searchQuery: string;
  themeName: string;
  toasts: Toast[];

  setActive: (id: string) => void;
  setSplit: (id: string | null) => void;
  setRailTab: (tab: RailTab) => void;
  toggleFocus: () => void;
  toggleDemo: () => void;
  setSwitcherOpen: (open: boolean) => void;
  setSearch: (q: string) => void;
  setTheme: (name: string) => void;

  toggleDnd: (id: string) => void;
  toggleRecording: (id: string) => void;
  toggleAnswered: (id: string) => void;
  sendMessage: (to: string | "all", text: string) => void;
  setTaskStatus: (id: string, status: Task["status"]) => void;
  revertChange: (teammateId: string, file: string) => void;
  quickCommit: (id: string) => void;
  toast: (text: string, kind?: Toast["kind"]) => void;
  dismissToast: (id: number) => void;

  /** Real-feed hydration (Phase 2) — components never call these. */
  applyTeamConfig: (members: TeamMemberConfig[]) => void;
  patchTeammate: (id: string, patch: Partial<Teammate>) => void;
  setActivity: (events: ActivityEvent[]) => void;
  applyWatchState: (state: WatchState) => void;

  /** Live lock claims from the Rust file watcher (survives page reloads). */
  liveLocks: WatchState["locks"];
}

let toastSeq = 0;

export const useApp = create<AppState>((set, get) => ({
  teammates,
  tasks,
  messages,
  activity,
  ciWorkflows,
  sponsorChecklist,
  mergeQueue,

  activeId: "aryan",
  splitId: null,
  railTab: "tasks",
  focusMode: false,
  demoMode: false,
  switcherOpen: false,
  searchQuery: "",
  themeName: "ember",
  toasts: [],

  setActive: (id) => set({ activeId: id, switcherOpen: false }),
  setSplit: (id) => set({ splitId: id }),
  setRailTab: (railTab) => set({ railTab }),
  toggleFocus: () => set((s) => ({ focusMode: !s.focusMode, splitId: null })),
  toggleDemo: () => set((s) => ({ demoMode: !s.demoMode })),
  setSwitcherOpen: (switcherOpen) => set({ switcherOpen }),
  setSearch: (searchQuery) => set({ searchQuery }),
  setTheme: (themeName) => set({ themeName }),

  toggleDnd: (id) =>
    set((s) => ({
      teammates: s.teammates.map((t) =>
        t.id === id ? { ...t, dnd: !t.dnd } : t,
      ),
    })),

  toggleRecording: (id) => {
    const t = get().teammates.find((t) => t.id === id);
    set((s) => ({
      teammates: s.teammates.map((t) =>
        t.id === id ? { ...t, recording: !t.recording } : t,
      ),
    }));
    get().toast(
      t?.recording
        ? `Recording saved → sessions/${id}-${Date.now() % 100000}.log`
        : `Recording ${id}'s session output`,
    );
  },

  toggleAnswered: (id) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === id ? { ...m, answered: !m.answered } : m,
      ),
    })),

  sendMessage: (to, text) => {
    const msg: Message = {
      id: `m${Date.now()}`,
      from: "aryan",
      to,
      text,
      answered: false,
      ts: new Date().toTimeString().slice(0, 5),
    };
    set((s) => ({ messages: [msg, ...s.messages] }));
    get().toast(to === "all" ? "Broadcast sent to all 4 sessions" : `Queued for ${to} — delivered at next check-in`);
  },

  setTaskStatus: (id, status) => {
    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.id === id
          ? { ...t, status, startedAt: status === "in-progress" ? Date.now() : t.startedAt }
          : t,
      ),
    }));
    if (status === "done") {
      const next = nextUnblockedTask(get().tasks, id);
      if (next) get().toast(`Task done. Next unblocked: “${next.title}”`);
    }
  },

  revertChange: (teammateId, file) => {
    set((s) => ({
      teammates: s.teammates.map((t) =>
        t.id === teammateId
          ? { ...t, changes: t.changes.filter((c) => c.file !== file) }
          : t,
      ),
    }));
    get().toast(`Reverted ${file} (git checkout — stubbed)`, "warn");
  },

  quickCommit: (id) => {
    const t = get().teammates.find((t) => t.id === id);
    get().toast(`Committed + pushed ${t?.changes.length ?? 0} files on ${t?.branch} (stubbed)`);
  },

  toast: (text, kind = "info") => {
    const id = ++toastSeq;
    set((s) => ({ toasts: [...s.toasts, { id, text, kind }] }));
    setTimeout(
      () => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
      3800,
    );
  },
  dismissToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  applyTeamConfig: (members) =>
    set((s) => ({
      teammates: members.map((m) => {
        const seed = s.teammates.find((t) => t.id === m.id);
        return { ...(seed ?? emptyTeammate(m.id)), id: m.id, name: m.name };
      }),
      activeId: members.some((m) => m.id === s.activeId)
        ? s.activeId
        : (members[0]?.id ?? s.activeId),
    })),

  patchTeammate: (id, patch) =>
    set((s) => ({
      teammates: s.teammates.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    })),

  setActivity: (activity) => set({ activity }),

  liveLocks: [],

  applyWatchState: (ws) =>
    set((s) => {
      const now = Math.floor(Date.now() / 1000);
      const latest: Record<string, { file: string; ts: number }> = {};
      for (const l of ws.locks) {
        if (!latest[l.owner] || l.ts > latest[l.owner].ts) {
          latest[l.owner] = { file: l.file, ts: l.ts };
        }
      }
      return {
        liveLocks: ws.locks,
        teammates: s.teammates.map((t) => {
          const seen = ws.lastSeen[t.id];
          if (seen === undefined || t.health === "disconnected") return t;
          const min = Math.floor(Math.max(0, now - seen) / 60);
          return {
            ...t,
            currentFile: latest[t.id]?.file ?? t.currentFile,
            lastActiveMin: min,
            health: min >= 15 ? "stale" : "ok",
          };
        }),
      };
    }),
}));


/** Base for config members with no fake seed — unwired fields stay visibly empty. */
function emptyTeammate(id: string): Teammate {
  return {
    id,
    name: id,
    initials: id.slice(0, 2).toUpperCase(),
    branch: "—",
    taskLabel: "—",
    status: "idle",
    setup: "worktree",
    currentFile: "—",
    lastActiveMin: 0,
    health: "ok",
    permission: "view",
    dnd: false,
    recording: false,
    usage: {
      model: "—",
      sessionPct: 0,
      weeklyPct: 0,
      sessionResetsIn: "—",
      weeklyResetsAt: "—",
      permissionMode: "—",
    },
    terminal: [{ kind: "out", text: "— session feed not wired yet (slice 3) —" }],
    changes: [],
    standupNote: "—",
  };
}

// Phase 2: live feeds replace fake data when running inside Tauri.
// In plain browser dev the fake seed stays so the UI is still browsable.
startGitFeed(useApp);
startWatchFeed(useApp);

// ---------------------------------------------------------------------------
// Derived helpers — pure functions over store state
// ---------------------------------------------------------------------------

/**
 * Files currently claimed. When the file watcher is live (Tauri), claims are
 * real recently-touched files per teammate; in browser dev it falls back to
 * the fake task-derived locks. Signature unchanged — components untouched.
 */
export function fileLocks(tasks: Task[]): { file: string; owner: string }[] {
  const live = useApp.getState().liveLocks;
  if (live.length > 0) {
    return live.map((l) => ({ owner: l.owner, file: l.file }));
  }
  return tasks
    .filter((t) => t.status === "in-progress")
    .flatMap((t) => t.files.map((file) => ({ file, owner: t.owner })));
}

/** Actual overlap: same file claimed by two different owners. */
export function fileConflicts(tasks: Task[]): { file: string; owners: string[] }[] {
  const byFile = new Map<string, Set<string>>();
  for (const lock of fileLocks(tasks)) {
    if (!byFile.has(lock.file)) byFile.set(lock.file, new Set());
    byFile.get(lock.file)!.add(lock.owner);
  }
  return [...byFile.entries()]
    .filter(([, owners]) => owners.size > 1)
    .map(([file, owners]) => ({ file, owners: [...owners] }));
}

const STOPWORDS = new Set(["the", "a", "an", "and", "with", "for", "per", "to", "of", "all", "ui"]);

/** Predicted overlap: shared keywords across two not-done task descriptions. */
export function predictedConflicts(
  tasks: Task[],
): { a: Task; b: Task; words: string[] }[] {
  const open = tasks.filter((t) => t.status !== "done");
  const words = (t: Task) =>
    new Set(
      `${t.title} ${t.desc}`
        .toLowerCase()
        .split(/[^a-z]+/)
        .filter((w) => w.length > 3 && !STOPWORDS.has(w)),
    );
  const out: { a: Task; b: Task; words: string[] }[] = [];
  for (let i = 0; i < open.length; i++) {
    for (let j = i + 1; j < open.length; j++) {
      if (open[i].owner === open[j].owner) continue;
      const shared = [...words(open[i])].filter((w) => words(open[j]).has(w));
      if (shared.length >= 2) out.push({ a: open[i], b: open[j], words: shared });
    }
  }
  return out;
}

export function nextUnblockedTask(tasks: Task[], justDoneId: string): Task | undefined {
  const done = new Set(tasks.filter((t) => t.status === "done" || t.id === justDoneId).map((t) => t.id));
  return tasks.find(
    (t) => t.status === "not-started" && (!t.blockedBy || done.has(t.blockedBy)),
  );
}

/** Sessions needing attention: needs-input, stale, or disconnected. */
export function attentionCount(teammates: Teammate[]): number {
  return teammates.filter(
    (t) => t.status === "needs-input" || t.health !== "ok",
  ).length;
}
