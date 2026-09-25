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
  Decision,
  Message,
  RoomState,
  Task,
  Teammate,
  Toast,
} from "./types";
import { dedupeDecisions, makeDecision } from "./lib/decisions";
import { roomTasksToAppTasks, taskBrief } from "./components/teamflow/logic";
import { startGitFeed, startWatchFeed, startPtyFeed, startSharedFeed, startUsageFeed, startRoomFeed, type CiRun, type WatchState } from "./data/sources/feeds";
import type { AgentAvailability, AgentId, ConflictPair, TeamMemberConfig } from "./data/sources/git";
import { detectAgents, isTauri } from "./data/sources/git";
import { needsAttention } from "./lib/attention";
import { tokenBudget, DEFAULT_TOKEN_BUDGET } from "./lib/dashboard";
import { budgetAlertOnCross, budgetLevel, type BudgetLevel } from "./lib/ratelimit";
import { sessionTokens } from "./lib/cap";
import { isHelpPending, isHelpRequest } from "./lib/help";
import { runCheckpoints, summarizeCheckpoints } from "./lib/checkpoint";
import { fmtClock } from "./lib/format";
import { deliverBriefWhenReady, hasIdlePrompt, isMidGeneration, tailText, type PtyStatus } from "./lib/ptyReady";
import { DEFAULT_TERM_SETTINGS, type TermSettings } from "./theme/termPalettes";
import type { AppMode } from "./lib/soloVisibility";

export type RailTab = "files" | "tasks" | "inbox" | "activity" | "team" | "preview";

/** One registered project workspace (projects.json via projects_list). */
export interface ProjectInfo {
  id: string;
  name: string;
  path: string;
  color?: string;
}

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
  /** Full-bleed "cinema" focus: the active session's terminal fills the window,
   *  every chrome surface is hidden. Distinct from focusMode (which keeps chrome). */
  cinemaOpen: boolean;
  switcherOpen: boolean;
  searchQuery: string;
  themeName: string;
  toasts: Toast[];

  setActive: (id: string) => void;
  setSplit: (id: string | null) => void;
  setRailTab: (tab: RailTab) => void;
  toggleFocus: () => void;
  toggleDemo: () => void;
  setCinemaOpen: (open: boolean) => void;
  toggleCinema: () => void;
  setSwitcherOpen: (open: boolean) => void;
  setSearch: (q: string) => void;
  setTheme: (name: string) => void;

  toggleDnd: (id: string) => void;
  toggleRecording: (id: string) => void;
  toggleAnswered: (id: string) => void;
  sendMessage: (to: string | "all", text: string, kind?: import("./types").MessageKind, threadId?: string) => void;
  /** Flag a session as "stuck, need eyes": posts a blocking help-tagged message
   *  from `memberId` to the whole team (reusing the messages transport) so the
   *  requester surfaces in everyone's Needs-you hero + attention badge. */
  requestHelp: (memberId: string, note?: string) => void;
  /** Clear a session's help flag by marking its open help request(s) answered. */
  resolveHelp: (memberId: string) => void;
  respondProposal: (id: string, response: "yes" | "no" | "unsure") => void;
  resources: Record<string, { cpu: number; memMb: number }>;
  setResources: (r: { id: string; cpu: number; memMb: number }[]) => void;
  /** member id whose work is under pre-merge review, or null */
  reviewFor: string | null;
  setReviewFor: (id: string | null) => void;
  /** member id whose session is being handed off to a teammate, or null */
  handoffFor: string | null;
  setHandoffFor: (id: string | null) => void;
  draftReply: { to: string; threadId: string; mention: string } | null;
  setDraftReply: (r: { to: string; threadId: string; mention: string } | null) => void;
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

  /** Pre-merge conflict radar: name-level file overlap between branches. */
  conflicts: ConflictPair[];
  setConflicts: (pairs: ConflictPair[]) => void;

  /** "home" = mission control overview; "session" = terminal workspace */
  view: "home" | "session";
  setView: (v: "home" | "session") => void;
  featureIndexOpen: boolean;
  /** Keyboard cheatsheet overlay (opened with "?"). Toggled via setState. */
  cheatsheetOpen: boolean;
  /** Keyboard-nav cursor in the session list (j/k). null = follow activeId.
   *  Cleared on any setActive so the cursor snaps back to the open session. */
  navSelId: string | null;
  /** Diff review board overlay — every member's branch-vs-main diff. */
  diffBoardOpen: boolean;
  /** PR dashboard overlay — open PRs with CI + review state (panel-pr-dashboard). */
  prDashboardOpen: boolean;
  /** Cross-session search overlay (panel-cross-search). Toggled via setState. */
  crossSearchOpen: boolean;
  /** Session timeline scrubber overlay — replay recent pty output by line. */
  scrubberOpen: boolean;
  setScrubberOpen: (open: boolean) => void;
  /** Presence map overlay: live file locks grouped by file & member. */
  presenceMapOpen: boolean;
  /** Kanban task-board overlay (panel-kanban). */
  kanbanOpen: boolean;
  /** Token & cost dashboard overlay. */
  tokenDashOpen: boolean;
  /** Branch graph overlay — each member's branch vs main (ahead/behind). */
  branchGraphOpen: boolean;
  /** Auto-standup summary overlay (AI Done/Doing/Blocked from git + tasks). */
  standupOpen: boolean;
  /** Release-notes overlay (AI Features/Fixes/Chores from commits + PRs). */
  releaseNotesOpen: boolean;
  /** Broadcast overlay — send one prompt/command to all sessions at once. */
  broadcastOpen: boolean;
  /** Watch overlay — open a teammate's live session read-only (view-only). */
  watchOpen: boolean;
  /** Member id to preselect when the watch overlay opens (null = first target). */
  watchFor: string | null;
  /** Open/close the watch overlay; pass a member id to preselect that session. */
  setWatchOpen: (open: boolean, memberId?: string | null) => void;
  settingsOpen: boolean;
  /** Tab to deep-link Settings to on open; null = keep default. */
  settingsTab: string | null;
  setSettingsOpen: (open: boolean, tab?: string) => void;
  activeProject: string | null;
  /** All registered projects — the layout sidebar nests sessions under the
   *  active one and lists the rest for one-click switching. */
  projects: ProjectInfo[];
  pickerOpen: boolean;
  setPickerOpen: (open: boolean) => void;
  /** Monocode-style bottom terminal panel (plain shell in the active
   *  member's worktree). Toggled with ⌘` or the pane header button. */
  bottomTermOpen: boolean;
  toggleBottomTerm: () => void;
  /** Panel widths/ratios, persisted. */
  panelSizes: { left: number; right: number; split: number };
  setPanelSize: (key: "left" | "right" | "split", value: number, persist?: boolean) => void;
  /** User's session-list row order (member ids), persisted in settings.json.
   *  Advisory — SessionList falls back to natural order for any id not here. */
  sessionOrder: string[];
  setSessionOrder: (ids: string[]) => void;
  shipSession: (id: string) => Promise<void>;
  shipApproved: (id: string) => Promise<void>;
  dense: boolean;
  toggleDense: () => void;
  mergePilotOpen: boolean;
  setMergePilotOpen: (open: boolean) => void;
  /** Guided sequential merge-queue walk overlay. */
  mergeConductorOpen: boolean;
  setMergeConductorOpen: (open: boolean) => void;
  /** Snippet library overlay — manage reusable prompts + insert into a session. */
  snippetsOpen: boolean;
  /** Write a snippet body verbatim (no newline) into the active session's pty
   *  so the user can edit before sending. Resolves true on a successful write. */
  insertSnippet: (body: string) => Promise<boolean>;
  spawnSession: (id: string, name: string, branch: string, agent?: AgentId) => Promise<void>;
  /** Agent CLIs detected on this machine (detect_agents). Session-create UIs
   *  only offer entries where installed && authed. */
  availableAgents: AgentAvailability[];
  /** "New session from template" overlay (panel-session-templates). */
  sessionTemplatesOpen: boolean;
  /** Spawn a session on `branch` (reusing spawnSession), then brief the
   *  template's starting prompt in once the pty reaches an idle claude prompt. */
  spawnFromTemplate: (id: string, name: string, branch: string, startingPrompt: string) => Promise<void>;
  appSettings: Record<string, unknown>;
  setAppSetting: (key: string, value: unknown) => void;
  /** Clear a session's cost-cap flag on a manual resume and rebaseline its cap
   *  to its current token count — so a resumed session runs until it burns
   *  another full cap's worth, then stops again (documented in lib/cap). */
  clearCap: (id: string) => void;
  /** Manual snapshot: checkpoint-commit every member repo now, always toasting. */
  checkpointNow: () => Promise<void>;
  termSettings: TermSettings;
  setTermSetting: <K extends keyof TermSettings>(key: K, value: TermSettings[K]) => void;
  setShared: (p: {
    tasks?: Task[];
    messages?: Message[];
    mergeQueue?: string[];
    sponsorChecklist?: typeof sponsorChecklist;
    standupLines?: string[];
    decisions?: Decision[];
  }) => void;
  advanceMergeQueue: () => void;

  /** Shared, append-only team decisions log (decisions.json), newest-first. */
  decisions: Decision[];
  /** Decisions-log overlay (⌘K + features.ts). */
  decisionsOpen: boolean;
  /** Append a decision: shapes it via makeDecision, prepends locally, and
   *  persists through the merge-safe id-keyed shared_upsert path. No-ops on
   *  empty text. */
  addDecision: (text: string, tag?: string) => void;

  /** Files to flash in the claimed list after a conflict-banner click. */
  highlightFiles: string[];
  flashFiles: (files: string[]) => void;

  /** true when preflight found no claude CLI on PATH — panes show an install
   *  hint and self-healing restarts are suppressed until it clears. */
  claudeMissing: boolean;
  setClaudeMissing: (missing: boolean) => void;

  /** Solo/team mode. null = not chosen yet → ModeSelect screen. Persisted. */
  appMode: AppMode;
  setAppMode: (m: AppMode) => void;
  /** Set when Team is picked this session — routes to the TeamFlow screens
   *  (create/join → lobby → setup) until the flow completes. */
  teamFlowNeeded: boolean;
  /** True once onboarding reached phase "done" — the room stays ALIVE after
   *  this (it now carries live shared state), so this flag (not room === null)
   *  is what makes finishTeamSetup idempotent. Reset by leaveRoom. */
  teamSetupDone: boolean;
  /** Live presence of remote room members, keyed by member id (from their
   *  heartbeats). Populated only in a live room; empty in solo/local mode. */
  roomPresence: Record<string, import("./types").RoomPresence>;
  /** Team-mode room state (host-owned, polled live by startRoomFeed). */
  room: RoomState | null;
  roomRole: "host" | "guest" | null;
  /** Own identity in the room; hostAddr is "127.0.0.1:4518" for the host. */
  roomSelf: { memberId: string; hostAddr: string } | null;
  setRoom: (room: RoomState | null) => void;
  /** Host's LAN IPv4 (from room_host_start) — shown so teammates can join. */
  roomHostIp: string | null;
  /** true after 3 consecutive room polls failed — Lobby shows the
   *  host-offline banner; the next successful poll clears it. */
  roomOffline: boolean;
  /** Phase "done": host persists plan + tasks, everyone leaves the flow and
   *  gets their first assigned task briefed into their own session. */
  finishTeamSetup: () => Promise<void>;
  /** Back out of a room from any team screen: host stops its listener, then
   *  everyone's room state clears → TeamFlow routes back to create/join. */
  leaveRoom: () => Promise<void>;
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
  railTab: "files",
  focusMode: false,
  demoMode: false,
  cinemaOpen: false,
  switcherOpen: false,
  searchQuery: "",
  themeName: "monocode",
  toasts: [],

  setActive: (id) => set({ activeId: id, switcherOpen: false, view: "session", navSelId: null }),
  setSplit: (id) => set({ splitId: id }),
  setRailTab: (railTab) => set({ railTab }),
  toggleFocus: () => set((s) => ({ focusMode: !s.focusMode, splitId: null })),
  toggleDemo: () => set((s) => ({ demoMode: !s.demoMode })),
  // entering cinema forces the session view — there's no terminal to full-bleed
  // from the home dashboard, so we land on the active session first.
  setCinemaOpen: (cinemaOpen) => set(cinemaOpen ? { cinemaOpen, view: "session" } : { cinemaOpen }),
  toggleCinema: () => set((s) => (s.cinemaOpen ? { cinemaOpen: false } : { cinemaOpen: true, view: "session" })),
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
      const path = await invoke<string | null>("pty_record", { id: ptyIdFor(id), on });
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

  resources: {},
  setResources: (list) =>
    set({ resources: Object.fromEntries(list.map((r) => [r.id, { cpu: r.cpu, memMb: r.memMb }])) }),
  reviewFor: null,
  setReviewFor: (reviewFor) => set({ reviewFor }),
  handoffFor: null,
  setHandoffFor: (handoffFor) => set({ handoffFor }),
  draftReply: null,
  setDraftReply: (draftReply) => set({ draftReply }),

  respondProposal: (id, response) => {
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === id ? { ...m, response, answered: true } : m,
      ),
    }));
    const changed = get().messages.find((m) => m.id === id);
    if (changed) upsertShared("messages.json", [changed]);
  },

  toggleAnswered: (id) => {
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === id ? { ...m, answered: !m.answered } : m,
      ),
    }));
    const changed = get().messages.find((m) => m.id === id);
    if (changed) upsertShared("messages.json", [changed]);
  },

  sendMessage: (to, text, kind = "question", threadId) => {
    const meId = get().members[0]?.id ?? "me";
    const me = get().teammates.find((t) => t.id === meId);
    const now = Date.now();
    const msg: Message = {
      id: `m${now}`,
      from: meId,
      to,
      text,
      answered: false,
      ts: fmtClock(now),
      epochMs: now,
      kind,
      threadId,
      // auto-context: receiver sees what the sender was doing, no need to ask
      context: me
        ? { task: me.taskLabel, file: me.currentFile, branch: me.branch }
        : undefined,
    };
    set((s) => ({ messages: [msg, ...s.messages] }));
    upsertShared("messages.json", [msg]);
    get().toast(to === "all" ? "Broadcast sent to every session" : `Queued for ${to} — delivered at next check-in`);
  },

  requestHelp: (memberId, note) => {
    // already flagged → don't stack a second identical request
    if (isHelpPending(get().messages, memberId)) return;
    const mate = get().teammates.find((t) => t.id === memberId);
    const name = mate?.name ?? memberId;
    const branch = mate?.branch && mate.branch !== "—" ? mate.branch : "their branch";
    const trimmed = (note ?? "").trim();
    const now = Date.now();
    const msg: Message = {
      id: `m${now}`,
      // from = the flagged session so the flag derives per-member (isHelpPending)
      from: memberId,
      to: "all",
      text: `${name} needs eyes on ${branch}${trimmed ? `: ${trimmed}` : ""}`,
      answered: false,
      ts: fmtClock(now),
      epochMs: now,
      kind: "blocking",
      help: true,
      context: mate
        ? { task: mate.taskLabel, file: mate.currentFile, branch: mate.branch }
        : undefined,
    };
    set((s) => ({ messages: [msg, ...s.messages] }));
    upsertShared("messages.json", [msg]);
    get().toast(`Flagged for help — the team can see ${name} needs eyes`);
  },

  resolveHelp: (memberId) => {
    const open = get().messages.filter(
      (m) => isHelpRequest(m) && !m.answered && m.from === memberId,
    );
    if (open.length === 0) return;
    const openIds = new Set(open.map((m) => m.id));
    set((s) => ({
      messages: s.messages.map((m) => (openIds.has(m.id) ? { ...m, answered: true } : m)),
    }));
    const changed = get().messages.filter((m) => openIds.has(m.id));
    upsertShared("messages.json", changed);
    get().toast("Help flag cleared");
  },

  setTaskStatus: (id, status) => {
    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.id === id
          ? { ...t, status, startedAt: status === "in-progress" ? Date.now() : t.startedAt }
          : t,
      ),
    }));
    const changedTask = get().tasks.find((t) => t.id === id);
    if (changedTask) upsertShared("tasks.json", [changedTask]);
    if (status === "done") {
      const task = get().tasks.find((t) => t.id === id);
      if (task && isTauri()) {
        import("@tauri-apps/api/core").then(({ invoke }) =>
          invoke("standup_append", { id: task.owner, note: `finished: ${task.title}` }).catch(() => {}),
        );
      }
      const next = nextUnblockedTask(get().tasks, id);
      if (next) get().toast(`Task done. Next unblocked: “${next.title}”`);
      // fan-out dependents: spawn their session now that the blocker is done
      const dependents = get().tasks.filter(
        (t) => t.blockedBy === id && t.desc === "fan-out" && t.status === "not-started",
      );
      for (const dep of dependents) {
        (async () => {
          const { invoke } = await import("@tauri-apps/api/core");
          const base = get().members[0];
          if (!base) return;
          const sid = `agent-${dep.id.slice(-8)}`;
          const parent = base.repoPath.replace(/\/[^/]+$/, "");
          const path = `${parent}/worktrees-${sid}`;
          try {
            await invoke("worktree_add", { baseRepo: base.repoPath, branch: `fan/${sid}`, path });
            const nextMembers = [...get().members, { id: sid, name: sid, repoPath: path, permission: "edit" }];
            await invoke("team_config_write", { cfg: { teammates: nextMembers } });
            get().applyTeamConfig(nextMembers);
            await invoke("pty_ensure", { id: ptyIdFor(sid), cwd: path, shell: false, remote: null, tmux: null });
            // brief goes in once the session is at an idle claude prompt
            // (poll every 1s, up to 30s) — not on a blind timer
            deliverBriefWhenReady(
              ptyIdFor(sid),
              `Work on this task: ${dep.title}. When done, tell the user and stop.\n`,
            ).then((delivered) => {
              if (!delivered) {
                get().toast(
                  `Brief NOT delivered to ${sid} — session never became ready. Paste "${dep.title}" into its pane manually.`,
                  "warn",
                );
              }
            });
            get().toast(`Dependency cleared — spawned session for “${dep.title}”`);
          } catch (e) {
            get().toast(`Auto-spawn failed: ${e}`, "warn");
          }
        })();
      }
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
      // drop queue entries for renamed/removed members, append missing ones
      mergeQueue: [
        ...s.mergeQueue.filter((id) => members.some((m) => m.id === id)),
        ...members.filter((m) => !s.mergeQueue.includes(m.id)).map((m) => m.id),
      ],
      teammates: members.map((m, i) => {
        const seed = s.teammates.find((t) => t.id === m.id);
        return {
          ...(seed ?? emptyTeammate(m.id)),
          id: m.id,
          name: m.name,
          permission: (m.permission ?? (i === 0 ? "edit" : "view")) as Teammate["permission"],
        };
      }),
      activeId: members.some((m) => m.id === s.activeId)
        ? s.activeId
        : (members[0]?.id ?? s.activeId),
    })),

  patchTeammate: (id, patch) =>
    set((s) => ({
      teammates: s.teammates.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    })),

  setActivity: (activity) => {
    // no-op guard: polling feeds call this every few seconds with mostly-identical data
    const prev = get().activity;
    if (prev.length === activity.length && JSON.stringify(prev) === JSON.stringify(activity)) return;
    set({ activity });
  },

  setShared: (p) =>
    set(() => ({
      ...(p.tasks ? { tasks: p.tasks } : {}),
      ...(p.messages ? { messages: p.messages } : {}),
      ...(p.mergeQueue
        ? {
            mergeQueue: (() => {
              const members = get().members;
              if (members.length === 0) return p.mergeQueue!;
              const valid = p.mergeQueue!.filter((id) => members.some((m) => m.id === id));
              const missing = members.filter((m) => !valid.includes(m.id)).map((m) => m.id);
              return [...valid, ...missing];
            })(),
          }
        : {}),
      ...(p.sponsorChecklist ? { sponsorChecklist: p.sponsorChecklist } : {}),
      ...(p.standupLines ? { standupLines: p.standupLines } : {}),
      ...(p.decisions ? { decisions: dedupeDecisions(p.decisions) } : {}),
    })),

  decisions: [],
  decisionsOpen: false,
  addDecision: (text, tag) => {
    const meId = get().members[0]?.id ?? "me";
    const entry = makeDecision(text, meId, tag);
    if (!entry) return;
    set((s) => ({ decisions: dedupeDecisions([entry, ...s.decisions]) }));
    upsertShared("decisions.json", [entry]);
    get().toast("Decision logged for the team");
  },

  setCiRuns: (ciRuns) => set({ ciRuns }),

  conflicts: [],
  setConflicts: (pairs) =>
    set((s) => {
      // skip no-op updates — the radar polls but rarely changes
      if (JSON.stringify(s.conflicts) === JSON.stringify(pairs)) return s;
      return { conflicts: pairs };
    }),

  advanceMergeQueue: () => {
    const q = get().mergeQueue;
    const next = [...q.slice(1), q[0]];
    set({ mergeQueue: next });
    mergeSharedTeam({ mergeQueue: next });
    const name = get().teammates.find((t) => t.id === next[0])?.name ?? next[0];
    get().toast(`Merge turn passed to ${name}`);
  },

  liveLocks: [],
  members: [],
  standupLines: [],
  ciRuns: [],
  view: "home",
  setView: (view) => set({ view }),
  featureIndexOpen: false,
  cheatsheetOpen: false,
  navSelId: null,
  diffBoardOpen: false,
  prDashboardOpen: false,
  crossSearchOpen: false,
  scrubberOpen: false,
  setScrubberOpen: (scrubberOpen) => set({ scrubberOpen }),
  presenceMapOpen: false,
  kanbanOpen: false,
  tokenDashOpen: false,
  branchGraphOpen: false,
  standupOpen: false,
  releaseNotesOpen: false,
  broadcastOpen: false,
  watchOpen: false,
  watchFor: null,
  setWatchOpen: (watchOpen, memberId) =>
    set(watchOpen ? { watchOpen, watchFor: memberId ?? null } : { watchOpen: false, watchFor: null }),
  settingsOpen: false,
  settingsTab: null,
  setSettingsOpen: (settingsOpen, tab) => set({ settingsOpen, settingsTab: settingsOpen ? tab ?? null : null }),
  activeProject: null,
  projects: [],
  pickerOpen: false,
  bottomTermOpen: false,
  toggleBottomTerm: () => set({ bottomTermOpen: !get().bottomTermOpen }),
  setPickerOpen: (pickerOpen) => set({ pickerOpen }),
  panelSizes: { left: 276, right: 338, split: 0.5 },
  setPanelSize: (key, value, persist) => {
    const panelSizes = { ...get().panelSizes, [key]: value };
    set({ panelSizes });
    if (persist) get().setAppSetting("panelSizes", panelSizes);
  },
  sessionOrder: [],
  setSessionOrder: (ids) => {
    set({ sessionOrder: ids });
    get().setAppSetting("sessionOrder", ids);
  },

  /** Opens the pre-merge review; approving there runs /ship in the session. */
  shipSession: async (id) => {
    set({ reviewFor: id });
  },

  /** Called from the review modal on approve. */
  shipApproved: async (id) => {
    if (!isTauri()) return;
    const name = get().teammates.find((t) => t.id === id)?.name ?? id;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      // readiness guard: one screen read before write — only inject /ship
      // when the session is alive and sitting at an idle claude prompt.
      const statuses = await invoke<PtyStatus[]>("pty_status");
      const mine = statuses.find((s) => s.id === ptyIdFor(id));
      if (!mine || !mine.alive) {
        get().toast(`Can't ship — ${name}'s session isn't running. Restart it first.`, "warn");
        return;
      }
      const tail = tailText(mine);
      if (isMidGeneration(tail, mine.quietMs)) {
        get().toast(`Can't ship — ${name}'s claude is mid-generation. Wait for it to finish, then approve again.`, "warn");
        return;
      }
      if (!hasIdlePrompt(tail)) {
        get().toast(`Can't ship — no claude prompt visible in ${name}'s session. Open the pane and check it's idle.`, "warn");
        return;
      }
      await invoke("pty_write", { id: ptyIdFor(id), data: "/ship\n" });
      get().toast(`Approved — ${name} is running /ship: tests, commit, push, then a PR`);
      // shipping completes this member's merge turn — rotate the queue
      if (get().mergeQueue[0] === id) get().advanceMergeQueue();
    } catch (e) {
      get().toast(`Ship failed: ${e}`, "warn");
    }
  },
  dense: false,
  toggleDense: () => set((s) => ({ dense: !s.dense })),
  mergePilotOpen: false,
  setMergePilotOpen: (mergePilotOpen) => set({ mergePilotOpen }),
  mergeConductorOpen: false,
  setMergeConductorOpen: (mergeConductorOpen) => set({ mergeConductorOpen }),

  snippetsOpen: false,
  insertSnippet: async (body) => {
    const st = get();
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      // no trailing newline: the snippet lands at the prompt for the user to
      // edit, then press Enter. pty_write enforces view-only sessions server-side.
      await invoke("pty_write", { id: ptyIdFor(st.activeId), data: body });
      if (st.view !== "session") set({ view: "session" });
      st.toast("Snippet inserted — edit, then press Enter to send");
      return true;
    } catch (e) {
      st.toast(`Insert failed: ${e}`, "warn");
      return false;
    }
  },

  spawnSession: async (id, name, branch, agent) => {
    if (!isTauri()) return;
    const base = get().members[0];
    if (!base) return;
    const path = `${base.repoPath.replace(/\/[^/]+$/, "")}/worktrees-${id}`;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("worktree_add", { baseRepo: base.repoPath, branch, path });
      const member: TeamMemberConfig = { id, name, repoPath: path, permission: "edit" };
      if (agent && agent !== "claude") member.agent = agent;
      const members = [...get().members, member];
      await invoke("team_config_write", { cfg: { teammates: members } });
      get().applyTeamConfig(members);
      // pty ids are project-namespaced — a bare id here would orphan the
      // agent process in any non-default project (feeds poll ptyIdFor ids)
      await invoke("pty_ensure", { id: ptyIdFor(id), cwd: path, shell: false, agent: agent ?? null });
      get().toast(`Spawned ${name} (${agent ?? "claude"}) on ${branch} at ${path}`);
    } catch (e) {
      get().toast(`Spawn failed: ${e}`, "warn");
    }
  },
  availableAgents: [],
  sessionTemplatesOpen: false,
  spawnFromTemplate: async (id, name, branch, startingPrompt) => {
    if (!isTauri()) { get().toast("Session templates need the native app to spawn sessions", "warn"); return; }
    // reuse the one spawn path (worktree + pty + team entry); it toasts on failure
    await get().spawnSession(id, name, branch);
    // spawn didn't get far enough to register the member → don't poll for a
    // session that will never come up (spawnSession already reported why)
    if (!get().members.some((m) => m.id === id)) return;
    const prompt = startingPrompt.endsWith("\n") ? startingPrompt : `${startingPrompt}\n`;
    // brief goes in only once the session is at an idle claude prompt — same
    // readiness gate fan-out and team setup use, never a blind timer
    deliverBriefWhenReady(ptyIdFor(id), prompt).then((delivered) => {
      if (!delivered) {
        get().toast(
          `Brief NOT delivered to ${name} — session never became ready. Paste the template prompt into its pane manually.`,
          "warn",
        );
      }
    });
  },
  appSettings: {},
  termSettings: DEFAULT_TERM_SETTINGS,
  setTermSetting: (key, value) => {
    const termSettings = { ...get().termSettings, [key]: value };
    set({ termSettings });
    get().setAppSetting("terminal", termSettings);
  },
  setAppSetting: (key, value) => {
    const appSettings = { ...get().appSettings, [key]: value };
    set({ appSettings });
    persistShared("settings.json", appSettings);
  },
  clearCap: (id) => {
    const t = get().teammates.find((x) => x.id === id);
    if (!t?.capReached) return;
    get().patchTeammate(id, { capReached: false, capBaseTokens: sessionTokens(t) });
  },
  checkpointNow: async () => {
    const members = get().members;
    if (!isTauri()) return;
    if (members.length === 0) {
      get().toast("No sessions to checkpoint", "warn");
      return;
    }
    const { invoke } = await import("@tauri-apps/api/core");
    const { text, kind } = summarizeCheckpoints(await runCheckpoints(members, invoke));
    get().toast(text, kind);
  },

  highlightFiles: [],
  flashFiles: (files) => {
    set({ highlightFiles: files, railTab: "tasks" });
    setTimeout(() => set({ highlightFiles: [] }), 2600);
  },

  claudeMissing: false,
  setClaudeMissing: (missing) => set({ claudeMissing: missing }),

  appMode: null,
  teamFlowNeeded: false,
  teamSetupDone: false,
  roomPresence: {},
  setAppMode: (m) => {
    set({ appMode: m, teamFlowNeeded: m === "team" });
    get().setAppSetting("appMode", m);
    // picking team AFTER boot: the boot IIFE only starts the room feed when
    // appMode was already persisted as "team", so start it here too (the feed
    // is idempotent — a guard flag makes the second call a no-op).
    if (m === "team") startRoomFeed(useApp);
  },
  room: null,
  roomRole: null,
  roomSelf: null,
  roomHostIp: null,
  roomOffline: false,
  setRoom: (room) =>
    set((s) => {
      // no-op guard: the room feed calls this every 1.5s with mostly-identical
      // state — skipping identical JSON avoids re-rendering every subscriber
      if (JSON.stringify(s.room) === JSON.stringify(room)) return s;
      // lift remote members' presence into a flat map for PresenceMap/Lobby
      const roomPresence: Record<string, import("./types").RoomPresence> = {};
      for (const m of room?.members ?? []) {
        if (m.presence) roomPresence[m.id] = { name: m.name, ...m.presence };
      }
      return { room, roomPresence };
    }),

  finishTeamSetup: async () => {
    // idempotent via teamSetupDone (NOT room===null): the room now stays ALIVE
    // after onboarding to carry live shared state, so a second call (direct
    // host call racing the feed-driven subscription) is guarded by the flag.
    const { room, roomRole, roomSelf, teamSetupDone } = get();
    if (!room || teamSetupDone) return;
    // Leave the flow (App routes to TeamFlow only while teamFlowNeeded), but
    // KEEP room/roomSelf/roomRole so startRoomFeed keeps polling + syncing.
    set({ teamSetupDone: true, teamFlowNeeded: false, view: "home" });

    const teamMembers = get().members;
    const boardTasks = roomTasksToAppTasks(room.tasks, room.members, teamMembers, room.code);

    // everyone: setup tasks land on the local task board (each machine owns
    // its own ~/.grillme tasks.json — no cross-writer conflict)
    set((s) => {
      const byId = new Map(s.tasks.map((t) => [t.id, t]));
      for (const t of boardTasks) byId.set(t.id, t);
      return { tasks: [...byId.values()] };
    });
    if (isTauri()) await upsertShared("tasks.json", boardTasks);

    // host: persist the plan as PROJECT_PLAN.md. plugin-fs write scope is
    // $HOME/.grillme/** — the project repo root is outside it, so the plan
    // lands next to the project's shared files instead (flagged in the PR).
    if (roomRole === "host" && isTauri() && room.plan.trim()) {
      const project = get().activeProject;
      const rel =
        project && project !== "default"
          ? `.grillme/projects/${project}/PROJECT_PLAN.md`
          : ".grillme/PROJECT_PLAN.md";
      try {
        const { writeTextFile, BaseDirectory } = await import("@tauri-apps/plugin-fs");
        await writeTextFile(rel, room.plan, { baseDir: BaseDirectory.Home });
        get().toast(`Setup done — plan saved to ~/${rel}`);
      } catch (e) {
        get().toast(`Plan write failed: ${e}`, "warn");
      }
    } else {
      get().toast("Team setup complete — your tasks are on the board");
    }

    // own first assigned task → brief into own session once it's ready
    const mine = roomSelf ? room.tasks.find((t) => t.assignee === roomSelf.memberId) : undefined;
    const ownId = teamMembers[0]?.id;
    if (mine && ownId && isTauri()) {
      deliverBriefWhenReady(ptyIdFor(ownId), taskBrief(mine)).then((delivered) => {
        if (!delivered) {
          get().toast(
            `Brief NOT delivered — session never became ready. Paste "${mine.title}" into your pane manually.`,
            "warn",
          );
        }
      });
    }
  },

  leaveRoom: async () => {
    const wasHost = get().roomRole === "host";
    set({ room: null, roomRole: null, roomSelf: null, roomOffline: false, teamSetupDone: false, roomPresence: {} });
    if (wasHost && isTauri()) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("room_host_stop");
      } catch {
        /* listener already down — nothing to stop */
      }
    }
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


// Team setup completion: fires on the room-feed transition to phase "done"
// (host AND guests). The room now STAYS alive after this (it carries live
// shared state), so this edge fires once — the phase stays "done" on later
// ticks — and finishTeamSetup is additionally guarded by teamSetupDone.
useApp.subscribe((st, prev) => {
  if (st.room?.phase === "done" && prev.room && prev.room.phase !== "done") {
    void st.finishTeamSetup();
  }
});

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
    terminal: [{ kind: "out", text: "— no output yet — this session's live terminal appears here once it starts —" }],
    changes: [],
    standupNote: "—",
  };
}

// Phase 2: live feeds replace fake data when running inside Tauri.
// In plain browser dev the fake seed stays so the UI is still browsable.
let restoreReady = false;
let persistT: ReturnType<typeof setTimeout> | undefined;
/** High-water mark for the soft token-budget warning sound (see subscribe). */
let firedBudgetLevel: BudgetLevel = 0;

(async () => {
  if (!isTauri()) {
    // browser dev: fake data, no feeds
    useApp.setState({ activeProject: "default" });
    return;
  }
  const { invoke } = await import("@tauri-apps/api/core");
  const raw = await invoke<string>("shared_read", { name: "settings.json" }).catch(() => "");
  let appSettings: Record<string, unknown> = {};
  if (raw?.trim()) {
    // a corrupt settings.json must degrade to defaults, not silently kill
    // this boot IIFE (which would leave every feed dead with no error)
    try {
      appSettings = JSON.parse(raw);
      useApp.setState({ appSettings });
      if (typeof appSettings.theme === "string") useApp.setState({ themeName: appSettings.theme });
      if (appSettings.panelSizes) useApp.setState({ panelSizes: appSettings.panelSizes as { left: number; right: number; split: number } });
      if (Array.isArray(appSettings.sessionOrder)) useApp.setState({ sessionOrder: (appSettings.sessionOrder as unknown[]).filter((x): x is string => typeof x === "string") });
      if (appSettings.terminal) useApp.setState({ termSettings: { ...DEFAULT_TERM_SETTINGS, ...(appSettings.terminal as Partial<TermSettings>) } });
      if (appSettings.appMode === "solo" || appSettings.appMode === "team") useApp.setState({ appMode: appSettings.appMode });
    } catch (e) {
      console.error("settings.json unreadable — using defaults", e);
      appSettings = {};
    }
  }
  const vs = appSettings.viewState as { activeId?: string; railTab?: RailTab; splitId?: string | null } | undefined;
  if (vs) {
    useApp.setState({
      ...(vs.activeId ? { activeId: vs.activeId } : {}),
      ...(vs.railTab ? { railTab: vs.railTab } : {}),
      splitId: vs.splitId ?? null,
    });
  }
  restoreReady = true;
  // team mode: install the room poller. It no-ops until TeamStart sets
  // roomSelf (create/join), so this is only live when a room actually exists.
  if (appSettings.appMode === "team") startRoomFeed(useApp);
  const project = typeof appSettings.activeProject === "string" ? appSettings.activeProject : null;
  if (!project) return; // ProjectPicker shows; feeds start after selection reload
  await invoke("set_active_project", { id: project }).catch(() => {});
  useApp.setState({ activeProject: project });
  // per-project accent tint — always know which workspace you're in.
  // The list also feeds the layout sidebar (projects with nested sessions).
  try {
    const projects: ProjectInfo[] = JSON.parse(await invoke<string>("projects_list"));
    useApp.setState({ projects });
    const color = projects.find((x) => x.id === project)?.color;
    if (color) {
      setTimeout(() => document.documentElement.style.setProperty("--accent", color), 300);
    }
  } catch { /* no color set */ }
  startGitFeed(useApp);

// crash/disconnect recovery: persist view state, restore on boot
useApp.subscribe((st, prev) => {
  if (!restoreReady) return;
  if (st.activeId !== prev.activeId || st.railTab !== prev.railTab || st.splitId !== prev.splitId) {
    clearTimeout(persistT);
    persistT = setTimeout(
      () => useApp.getState().setAppSetting("viewState", {
        activeId: st.activeId, railTab: st.railTab, splitId: st.splitId,
      }),
      800,
    );
  }
  // audible conflict alert on new real file conflicts
  if (st.liveLocks !== prev.liveLocks) {
    const count = (locks: typeof st.liveLocks) => {
      const byFile = new Map<string, Set<string>>();
      for (const l of locks) {
        if (!byFile.has(l.file)) byFile.set(l.file, new Set());
        byFile.get(l.file)!.add(l.owner);
      }
      return [...byFile.values()].filter((o) => o.size > 1).length;
    };
    if (count(st.liveLocks) > count(prev.liveLocks)) {
      import("./data/sounds").then(({ playAlert }) => playAlert("conflict", st.appSettings));
    }
  }
  // ready chime when the merge queue rotates to you (real multi-person queue only)
  if (st.mergeQueue[0] !== prev.mergeQueue[0]) {
    const me = st.members[0]?.id;
    if (me && st.mergeQueue.length > 1 && st.mergeQueue[0] === me && prev.mergeQueue[0] !== me) {
      import("./data/sounds").then(({ playAlert }) => playAlert("merge-turn", st.appSettings));
    }
  }
  // soft token-budget warning: a distinct sound the first time team spend
  // crosses UP into the 80% / 100% band. firedBudgetLevel is the high-water
  // mark, so each band chimes once as spend climbs; a genuine drop (project
  // switch, new day) lowers it so a later re-crossing can chime again.
  if (st.teammates !== prev.teammates) {
    const cap =
      typeof st.appSettings.tokenBudget === "number"
        ? (st.appSettings.tokenBudget as number)
        : DEFAULT_TOKEN_BUDGET;
    const level = budgetLevel(tokenBudget(st.teammates, cap).ratio);
    const kind = budgetAlertOnCross(firedBudgetLevel, level);
    if (kind) import("./data/sounds").then(({ playAlert }) => playAlert(kind, st.appSettings));
    firedBudgetLevel = level < firedBudgetLevel ? level : ((Math.max(firedBudgetLevel, level)) as BudgetLevel);
  }
});
  startWatchFeed(useApp);
  startPtyFeed(useApp);
  startSharedFeed(useApp);
  startUsageFeed(useApp);
  // one-shot probe: which agent CLIs are installed + logged in on this machine
  if (isTauri()) {
    detectAgents()
      .then((agents) => useApp.setState({ availableAgents: agents }))
      .catch(() => {});
  }
})();

/** Pty ids are namespaced per project so sessions survive project switches. */
export function ptyIdFor(memberId: string): string {
  const proj = useApp.getState().activeProject;
  return proj && proj !== "default" ? `${proj}:${memberId}` : memberId;
}

/**
 * Inverse of ptyIdFor: pty ids are "<member>" or "<project>:<member>", plus
 * a ":shell" suffix for shell tabs. Parse exactly — strip the suffix, then
 * split on the FIRST ':' — never substring-match, so "project:Bob" can never
 * resolve to a member "ob". Mirrors member_for_pty in src-tauri/src/lib.rs.
 */
export function memberIdFromPtyId(ptyId: string): string {
  const base = ptyId.endsWith(":shell") ? ptyId.slice(0, -":shell".length) : ptyId;
  const i = base.indexOf(":");
  return i === -1 ? base : base.slice(i + 1);
}

/** Whole-file write — settings.json only (single-writer UI preferences).
 *  tasks/messages/team go through the merge-safe delta paths below so two
 *  concurrent writers can never destroy each other's entries. */
async function persistShared(name: string, data: unknown) {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("shared_write", { name, content: JSON.stringify(data, null, 2) }).catch(console.error);
}

/** Delta upsert into an id-keyed shared array file: `items` overwrite/insert
 *  by id, `removedIds` delete, everything else on disk is preserved.
 *
 *  Writes local ~/.grillme first (unchanged — solo/local mode is exactly as
 *  before), THEN, if a live room exists (post-onboarding), mirrors the same
 *  delta to the host so remote teammates converge. The room push is
 *  fire-and-forget: a failed push (host down) leaves the local write intact
 *  and the room feed re-pushes the unsynced entry on reconnect. */
export async function upsertShared(
  name: "tasks.json" | "messages.json" | "decisions.json",
  items: unknown[],
  removedIds: string[] = [],
) {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("shared_upsert", { name, itemsJson: JSON.stringify(items), removedIds }).catch(console.error);
  // live room? push the delta to the team. Guard keeps solo/local a pure no-op.
  const { room, roomSelf } = useApp.getState();
  if (room && roomSelf && room.phase === "done") {
    const { roomSync } = await import("./components/teamflow/roomApi");
    void roomSync(name, items, removedIds);
  }
}

/** Field-level merge into team.json — only the fields provided overwrite. */
export async function mergeSharedTeam(patch: { mergeQueue?: string[]; sponsor?: unknown }) {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("shared_merge_team", {
    mergeQueue: patch.mergeQueue ?? null,
    sponsor: patch.sponsor ?? null,
  }).catch(console.error);
}

// ---------------------------------------------------------------------------
// Derived helpers — pure functions over store state
// ---------------------------------------------------------------------------

/**
 * THE solo check — every component asks this (usually as a zustand selector:
 * `useApp(isSolo)`) instead of comparing appMode inline. Per-surface
 * decisions live in lib/soloVisibility's `surfaceVisible`.
 */
export function isSolo(s: Pick<AppState, "appMode">): boolean {
  return s.appMode === "solo";
}

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

/**
 * Sessions needing attention: needs-input, stale, or disconnected.
 * Includes paused sessions that need input — pausing changes the process
 * state, not the attention state (predicate lives in lib/attention).
 */
export function attentionSessions(teammates: Teammate[]): Teammate[] {
  return teammates.filter(needsAttention);
}

export function attentionCount(teammates: Teammate[]): number {
  return attentionSessions(teammates).length;
}
