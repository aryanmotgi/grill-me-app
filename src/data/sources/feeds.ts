import type { StoreApi, UseBoundStore } from "zustand";
import type { Teammate } from "../../types";
import { ptyIdFor } from "../../store";
import {
  fetchGitState,
  isTauri,
  loadTeamConfig,
  toActivity,
  toTeammatePatch,
  type TeamMemberConfig,
} from "./git";

// ---------------------------------------------------------------------------
// Feed bootstrap. Started by the store module when running inside Tauri;
// in plain browser dev (vite only) the fake seed data stays as-is.
// Each slice of Phase 2 adds a feed here; components never know.
// ---------------------------------------------------------------------------

interface FeedStore {
  teammates: Teammate[];
  members: TeamMemberConfig[];
  appSettings: Record<string, unknown>;
  tasks: import("../../types").Task[];
  sponsorChecklist: { sponsor: string; requirement: string; done: boolean }[];
  setShared: (p: {
    tasks?: import("../../types").Task[];
    messages?: import("../../types").Message[];
    mergeQueue?: string[];
    sponsorChecklist?: { sponsor: string; requirement: string; done: boolean }[];
    standupLines?: string[];
  }) => void;
  applyTeamConfig: (members: TeamMemberConfig[]) => void;
  patchTeammate: (id: string, patch: Partial<Teammate>) => void;
  setActivity: (events: import("../../types").ActivityEvent[]) => void;
  applyWatchState: (state: WatchState) => void;
}

const GIT_POLL_MS = 5000;

export function startGitFeed(store: UseBoundStore<StoreApi<FeedStore>>) {
  if (!isTauri()) return;

  let members: TeamMemberConfig[] = [];

  const tick = async () => {
    try {
      const states = await Promise.all(
        members.map(async (member) => ({
          member,
          state: await fetchGitState(member.repoPath),
        })),
      );
      for (const { member, state } of states) {
        store.getState().patchTeammate(member.id, toTeammatePatch(state));
      }
      store.getState().setActivity(toActivity(states));
    } catch (e) {
      console.error("[git feed]", e);
    }
  };

  loadTeamConfig()
    .then((cfg) => {
      members = cfg.teammates;
      store.getState().applyTeamConfig(members);
      tick();
      setInterval(tick, GIT_POLL_MS);
    })
    .catch((e) => console.error("[git feed] config load failed", e));
}

// ---------------------------------------------------------------------------
// Slice 2 real feed: file watching. Rust notify watchers maintain an
// activity registry in-process; the frontend polls it. State survives
// webview reloads because Rust owns it, not the page.
// ---------------------------------------------------------------------------

const WATCH_POLL_MS = 3000;

export interface WatchState {
  locks: { owner: string; file: string; ts: number }[];
  lastSeen: Record<string, number>;
}

export async function startWatchFeed(store: UseBoundStore<StoreApi<FeedStore>>) {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");

  await invoke("start_watching");
  const tick = async () => {
    try {
      const state = await invoke<WatchState>("watch_state");
      store.getState().applyWatchState(state);
    } catch (e) {
      console.error("[watch feed]", e);
    }
  };
  tick();
  setInterval(tick, WATCH_POLL_MS);
}

// ---------------------------------------------------------------------------
// Embedded terminal feed. pty_ensure spawns a real Claude Code process per
// configured worktree; pty_status drives live status from process state:
// exited -> idle, BEL pending -> needs-input, output flowing -> working.
// The stripped tail feeds cross-session search.
// ---------------------------------------------------------------------------

const PTY_POLL_MS = 2000;

interface PtyStatus {
  id: string;
  alive: boolean;
  quietMs: number;
  bell: boolean;
  tail: string[];
  recording: string | null;
}

export async function startPtyFeed(store: UseBoundStore<StoreApi<FeedStore>>) {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");

  const ensureAll = async () => {
    for (const m of store.getState().members) {
      await invoke("pty_ensure", { id: ptyIdFor(m.id), cwd: m.repoPath, shell: false }).catch(() => {});
      // exact-status hooks: sessions report notification/stop/prompt events
      await invoke("install_hooks", { repoPath: m.repoPath, memberId: m.id }).catch(() => {});
    }
  };
  // config may not be loaded yet — retry until members appear
  const waitCfg = setInterval(() => {
    if (store.getState().members.length > 0) {
      clearInterval(waitCfg);
      ensureAll();
    }
  }, 500);

  const tick = async () => {
    try {
      const statuses = await invoke<PtyStatus[]>("pty_status");
      // exact status via Claude Code hooks when available
      const events = await invoke<string[]>("events_tail").catch(() => [] as string[]);
      const latest: Record<string, { event: string; ts: number }> = {};
      for (const line of events) {
        try {
          const e = JSON.parse(line);
          if (!latest[e.id] || e.ts >= latest[e.id].ts) latest[e.id] = e;
        } catch { /* partial line */ }
      }
      const nowS = Date.now() / 1000;
      for (const st of statuses) {
        const memberId = st.id.includes(":") ? st.id.split(":").slice(1).join(":") : st.id;
        if (ptyIdFor(memberId) !== st.id) continue; // other project's session
        const hook = latest[memberId];
        const hookFresh = hook && nowS - hook.ts < 30 * 60;
        let status: "idle" | "working" | "needs-input" = !st.alive
          ? "idle"
          : st.bell
            ? "needs-input"
            : st.quietMs < 4000
              ? "working"
              : "idle";
        if (st.alive && hookFresh) {
          if (hook.event === "notification") status = "needs-input";
          else if (hook.event === "prompt") status = st.quietMs < 120_000 ? "working" : status;
          else if (hook.event === "stop") status = st.bell ? "needs-input" : "idle";
        }
        store.getState().patchTeammate(memberId, {
          status,
          recording: st.recording !== null,
          terminal: st.tail.map((text) => ({ kind: "out" as const, text })),
        });
      }
    } catch (e) {
      console.error("[pty feed]", e);
    }
  };
  setInterval(tick, PTY_POLL_MS);
}

// ---------------------------------------------------------------------------
// Shared team state feed — polls ~/.grillme JSON files (the real transport
// on a shared VM) and fires OS notifications on new messages + sessions
// flipping to needs-input.
// ---------------------------------------------------------------------------

const SHARED_POLL_MS = 2000;

export async function startSharedFeed(store: UseBoundStore<StoreApi<FeedStore>>) {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  const notif = await import("@tauri-apps/plugin-notification");
  // never block the feed on the macOS permission dialog
  let canNotify = false;
  notif.isPermissionGranted().then((g) => {
    canNotify = g;
    if (!g) notif.requestPermission().then((r) => { canNotify = r === "granted"; }).catch(() => {});
  }).catch(() => {});
  const ping = (title: string, body: string, kind: "msg" | "input") => {
    const st = store.getState().appSettings;
    if (st.muteAll) return;
    if (kind === "msg" && st.notifyMessages === false) return;
    if (kind === "input" && st.notifyNeedsInput === false) return;
    if (canNotify) notif.sendNotification({ title, body });
  };

  const read = async (name: string) => {
    const raw = await invoke<string>("shared_read", { name });
    return raw.trim() ? JSON.parse(raw) : null;
  };
  const write = (name: string, data: unknown) =>
    invoke("shared_write", { name, content: JSON.stringify(data, null, 2) });

  // wait for team config, then seed missing files
  while (store.getState().members.length === 0) {
    await new Promise((r) => setTimeout(r, 400));
  }
  const st = store.getState();
  if ((await read("tasks.json")) === null) await write("tasks.json", st.tasks);
  if ((await read("messages.json")) === null) await write("messages.json", []);
  if ((await read("team.json")) === null) {
    await write("team.json", {
      mergeQueue: st.members.map((m) => m.id),
      sponsor: st.sponsorChecklist,
    });
  }

  const seenMsgs = new Set<string>();
  let first = true;
  const prevStatus: Record<string, string> = {};

  const tick = async () => {
    try {
      const me = store.getState().members[0]?.id;
      const [tasks, messages, team, standupLines] = await Promise.all([
        read("tasks.json"),
        read("messages.json"),
        read("team.json"),
        invoke<string[]>("standup_tail"),
      ]);
      store.getState().setShared({
        tasks: tasks ?? undefined,
        messages: messages ?? undefined,
        mergeQueue: team?.mergeQueue,
        sponsorChecklist: team?.sponsor,
        standupLines,
      });

      for (const m of (messages ?? []) as import("../../types").Message[]) {
        if (seenMsgs.has(m.id)) continue;
        seenMsgs.add(m.id);
        if (!first && m.from !== me && (m.to === me || m.to === "all")) {
          ping(`Message from ${m.from}`, m.text.slice(0, 120), "msg");
        }
      }

      for (const t of store.getState().teammates) {
        const prev = prevStatus[t.id];
        prevStatus[t.id] = t.status;
        if (!first && !t.dnd && t.id !== me && prev && prev !== "needs-input" && t.status === "needs-input") {
          ping(`${t.name} needs input`, "Session is waiting on a decision.", "input");
        }
      }
      first = false;
    } catch (e) {
      console.error("[shared feed]", e);
    }
  };
  tick();
  setInterval(tick, SHARED_POLL_MS);
}

// ---------------------------------------------------------------------------
// Usage + CI feed. Usage = real token tallies from Claude Code's own
// transcripts (plan-limit %s are not locally knowable — never faked).
// CI = real GitHub Actions runs via gh.
// ---------------------------------------------------------------------------

const USAGE_POLL_MS = 30_000;

interface UsageStats {
  ok: boolean;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  turns: number;
}

export interface CiRun {
  name: string;
  displayTitle: string;
  status: string;
  conclusion: string | null;
  headBranch: string;
}

export async function startUsageFeed(
  store: UseBoundStore<StoreApi<FeedStore & {
    patchTeammate: (id: string, patch: Partial<Teammate>) => void;
    setCiRuns: (runs: CiRun[]) => void;
  }>>,
) {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  while (store.getState().members.length === 0) {
    await new Promise((r) => setTimeout(r, 400));
  }
  const tick = async () => {
    for (const m of store.getState().members) {
      try {
        const u = await invoke<UsageStats>("usage_stats", { repoPath: m.repoPath });
        if (u.ok) {
          const mate = store.getState().teammates.find((t) => t.id === m.id);
          store.getState().patchTeammate(m.id, {
            usage: {
              ...(mate?.usage ?? {
                sessionPct: 0, weeklyPct: 0, sessionResetsIn: "—",
                weeklyResetsAt: "—", permissionMode: "—", model: "—",
              }),
              model: u.model || mate?.usage.model || "—",
              tokens: {
                input: u.inputTokens,
                output: u.outputTokens,
                cacheRead: u.cacheReadTokens,
                turns: u.turns,
              },
            },
          });
        }
      } catch { /* member without transcript */ }
    }
    try {
      const first = store.getState().members[0];
      if (first) {
        const raw = await invoke<string>("ci_state", { repoPath: first.repoPath });
        store.getState().setCiRuns(JSON.parse(raw));
      }
    } catch { /* gh missing or no remote — panel shows empty state */ }
  };
  tick();
  setInterval(tick, USAGE_POLL_MS);
}
