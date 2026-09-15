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
import { startGitFeed, startWatchFeed, startPtyFeed, startSharedFeed, startUsageFeed, type CiRun, type WatchState } from "./data/sources/feeds";
import type { TeamMemberConfig } from "./data/sources/git";
import { isTauri } from "./data/sources/git";

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

  /** Team config as loaded from ~/.grillme/config.json. */
  members: TeamMemberConfig[];

  standupLines: string[];
  ciRuns: CiRun[];
  setCiRuns: (runs: CiRun[]) => void;
  setShared: (p: {
    tasks?: Task[];
    messages?: Message[];
    mergeQueue?: string[];
    sponsorChecklist?: typeof sponsorChecklist;
    standupLines?: string[];
  }) => void;
  advanceMergeQueue: () => void;

  /** Files to flash in the claimed list after a conflict-banner click. */
  highlightFiles: string[];
  flashFiles: (files: string[]) => void;
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

  toggleRecording: async (id) => {
    const t = get().teammates.find((t) => t.id === id);
    const on = !t?.recording;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const path = await invoke<string | null>("pty_record", { id, on });
      set((s) => ({
        teammates: s.teammates.map((t) =>
          t.id === id ? { ...t, recording: on } : t,
        ),
      }));
      get().toast(on ? `Recording → ${path}` : "Recording stopped, file saved");
    } catch (e) {
      get().toast(`Recording failed: ${e}`, "warn");
    }
  },

  toggleAnswered: (id) => {
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === id ? { ...m, answered: !m.answered } : m,
      ),
    }));
    persistShared("messages.json", get().messages);
  },

  sendMessage: (to, text) => {
    const msg: Message = {
      id: `m${Date.now()}`,
      from: get().members[0]?.id ?? "me",
      to,
      text,
      answered: false,
      ts: new Date().toTimeString().slice(0, 5),
    };
    set((s) => ({ messages: [msg, ...s.messages] }));
    persistShared("messages.json", get().messages);
    get().toast(to === "all" ? "Broadcast sent to every session" : `Queued for ${to} — delivered at next check-in`);
  },

  setTaskStatus: (id, status) => {
    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.id === id
          ? { ...t, status, startedAt: status === "in-progress" ? Date.now() : t.startedAt }
          : t,
      ),
    }));
    persistShared("tasks.json", get().tasks);
    if (status === "done") {
      const task = get().tasks.find((t) => t.id === id);
      if (task && isTauri()) {
        import("@tauri-apps/api/core").then(({ invoke }) =>
          invoke("standup_append", { id: task.owner, note: `finished: ${task.title}` }).catch(() => {}),
        );
      }
      const next = nextUnblockedTask(get().tasks, id);
      if (next) get().toast(`Task done. Next unblocked: “${next.title}”`);
    }
  },

  revertChange: async (teammateId, file) => {
    const member = get().members.find((m) => m.id === teammateId);
    if (!member || !isTauri()) return;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("git_revert_file", { repoPath: member.repoPath, file });
      set((s) => ({
        teammates: s.teammates.map((t) =>
          t.id === teammateId
            ? { ...t, changes: t.changes.filter((c) => c.file !== file) }
            : t,
        ),
      }));
      get().toast(`Reverted ${file}`, "warn");
    } catch (e) {
      get().toast(`Revert failed: ${e}`, "warn");
    }
  },

  quickCommit: async (id) => {
    const member = get().members.find((m) => m.id === id);
    const t = get().teammates.find((t) => t.id === id);
    if (!member || !isTauri()) return;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const msg = `wip: ${t?.taskLabel ?? "checkpoint"} (${new Date().toISOString().slice(0, 16)})`;
      const result = await invoke<string>("git_commit_push", {
        repoPath: member.repoPath,
        message: msg,
      });
      get().toast(`${t?.name ?? id}: ${result}`);
    } catch (e) {
      get().toast(`Commit failed: ${e}`, "warn");
    }
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
      members,
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

  setShared: (p) =>
    set(() => ({
      ...(p.tasks ? { tasks: p.tasks } : {}),
      ...(p.messages ? { messages: p.messages } : {}),
      ...(p.mergeQueue ? { mergeQueue: p.mergeQueue } : {}),
      ...(p.sponsorChecklist ? { sponsorChecklist: p.sponsorChecklist } : {}),
      ...(p.standupLines ? { standupLines: p.standupLines } : {}),
    })),

  setCiRuns: (ciRuns) => set({ ciRuns }),

  advanceMergeQueue: () => {
    const q = get().mergeQueue;
    const next = [...q.slice(1), q[0]];
    set({ mergeQueue: next });
    persistShared("team.json", { mergeQueue: next, sponsor: get().sponsorChecklist });
    const name = get().teammates.find((t) => t.id === next[0])?.name ?? next[0];
    get().toast(`Merge turn passed to ${name}`);
  },

  liveLocks: [],
  members: [],
  standupLines: [],
  ciRuns: [],

  highlightFiles: [],
  flashFiles: (files) => {
    set({ highlightFiles: files, railTab: "tasks" });
    setTimeout(() => set({ highlightFiles: [] }), 2600);
  },

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
startPtyFeed(useApp);
startSharedFeed(useApp);
startUsageFeed(useApp);

async function persistShared(name: string, data: unknown) {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("shared_write", { name, content: JSON.stringify(data, null, 2) }).catch(console.error);
}

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
