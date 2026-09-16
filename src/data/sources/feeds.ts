import type { StoreApi, UseBoundStore } from "zustand";
import type { Teammate } from "../../types";
import { ptyIdFor } from "../../store";
import { playAlert } from "../sounds";
import {
  fetchConflictRadar,
  fetchGitState,
  isTauri,
  loadTeamConfig,
  toActivity,
  toTeammatePatch,
  type ConflictPair,
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
  activeId: string;
  view: "home" | "session";
  toast: (text: string, kind?: "info" | "warn") => void;
  tasks: import("../../types").Task[];
  sponsorChecklist: { sponsor: string; requirement: string; done: boolean }[];
  setShared: (p: {
    tasks?: import("../../types").Task[];
    messages?: import("../../types").Message[];
    mergeQueue?: string[];
    sponsorChecklist?: { sponsor: string; requirement: string; done: boolean }[];
    standupLines?: string[];
  }) => void;
  claudeMissing: boolean;
  setClaudeMissing: (missing: boolean) => void;
  applyTeamConfig: (members: TeamMemberConfig[]) => void;
  patchTeammate: (id: string, patch: Partial<Teammate>) => void;
  setActivity: (events: import("../../types").ActivityEvent[]) => void;
  applyWatchState: (state: WatchState) => void;
  setConflicts: (pairs: ConflictPair[]) => void;
}

const GIT_POLL_MS = 5000;

export function startGitFeed(store: UseBoundStore<StoreApi<FeedStore>>) {
  if (!isTauri()) return;

  let cfgLoaded = false;
  let busy = false;

  const tick = async () => {
    if (busy) return; // previous tick still awaiting — don't pile up
    busy = true;
    try {
      if (!cfgLoaded) {
        const cfg = await loadTeamConfig();
        store.getState().applyTeamConfig(cfg.teammates);
        cfgLoaded = true;
      }
      // re-read members every tick — sessions added after startup get git state
      const members = store.getState().members;
      const states = await Promise.all(
        members.map(async (member) => ({
          member,
          state: await fetchGitState(member.repoPath),
        })),
      );
      for (const { member, state } of states) {
        const patch = toTeammatePatch(state);
        const cur = store.getState().teammates.find((t) => t.id === member.id);
        if (
          cur &&
          cur.branch === (patch.branch ?? cur.branch) &&
          cur.changes.length === (patch.changes?.length ?? cur.changes.length) &&
          cur.setup === (patch.setup ?? cur.setup) &&
          cur.health === (patch.health ?? cur.health)
        ) {
          continue;
        }
        store.getState().patchTeammate(member.id, patch);
      }
      store.getState().setActivity(toActivity(states));
      // conflict radar piggybacks the git tick — Rust caches results 30s,
      // so most polls are a cheap cache read, never a subprocess storm
      try {
        store.getState().setConflicts(await fetchConflictRadar());
      } catch { /* command unavailable — radar stays empty */ }
    } catch (e) {
      console.error("[git feed]", e);
    } finally {
      busy = false;
    }
  };

  // interval installs unconditionally: a failed config load retries next tick
  // instead of killing the feed for the rest of the session
  tick();
  setInterval(tick, GIT_POLL_MS);
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

  // soft heads-ups: session B changed a file session A recently read.
  // Keyed owner:file with a notify timestamp so week-long sessions don't
  // accumulate entries forever — a repeat heads-up after an hour is fine.
  const NOTIFIED_TTL_MS = 60 * 60_000;
  const notified = new Map<string, number>();
  const softCheck = async (state: WatchState) => {
    const me = store.getState().members[0]?.id;
    if (!me) return;
    const nowS = Date.now() / 1000;
    const fresh = state.locks.filter((l) => nowS - l.ts < 60 && l.owner !== me);
    if (fresh.length === 0) return;
    const audit = await invoke<string[]>("audit_tail", { member: me }).catch(() => [] as string[]);
    for (const lock of fresh) {
      const key = `${lock.owner}:${lock.file}`;
      if (notified.has(key)) continue;
      const readIt = audit.some((line) => {
        try {
          const e = JSON.parse(line);
          return (
            (e.tool === "Read" || e.tool === "Edit") &&
            typeof e.detail === "string" &&
            e.detail.endsWith(lock.file) &&
            nowS - e.ts < 30 * 60
          );
        } catch { return false; }
      });
      if (readIt) {
        notified.set(key, Date.now());
        store.getState().toast(
          `Heads-up: ${lock.owner} just changed ${lock.file} — you read it recently`,
          "warn",
        );
      }
    }
  };

  // start_watching is idempotent and diffs against already-watched repos in
  // Rust — re-invoke whenever the member count changes so teammates added
  // after startup (Spawner, HTTP /new, fan-out) get presence/lock tracking.
  // Count guard keeps it off the every-3s hot path; a failed invoke leaves
  // the count stale so the next tick retries instead of killing the feed.
  let watchedCount = -1;
  let busy = false;
  const tick = async () => {
    if (busy) return; // previous tick still awaiting — don't pile up
    busy = true;
    try {
      const memberCount = store.getState().members.length;
      if (memberCount !== watchedCount) {
        await invoke("start_watching");
        watchedCount = memberCount;
      }
      const state = await invoke<WatchState>("watch_state");
      store.getState().applyWatchState(state);
      await softCheck(state);
      const now = Date.now();
      for (const [key, ts] of notified) {
        if (now - ts > NOTIFIED_TTL_MS) notified.delete(key);
      }
    } catch (e) {
      console.error("[watch feed]", e);
    } finally {
      busy = false;
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
  oscNotify: boolean;
  tail: string[];
  recording: string | null;
  startedAt: number;
  paused: boolean;
}

export async function startPtyFeed(store: UseBoundStore<StoreApi<FeedStore>>) {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");

  const ensureAll = async () => {
    // preflight once before any claude spawn: a missing CLI would otherwise
    // die instantly and put self-healing into a spawn/die/respawn loop
    let claudeOk = true;
    try {
      await invoke("preflight_claude");
    } catch {
      claudeOk = false;
    }
    store.getState().setClaudeMissing(!claudeOk);
    // lazy spawn: only YOUR session starts eagerly — teammates' claude
    // processes spawn on first view of their pane (calmer start, less churn)
    const members = store.getState().members;
    const me = members[0];
    // remote/tmux sessions attach over ssh — they don't need a local claude
    if (me && (claudeOk || me.remote)) {
      await invoke("pty_ensure", {
        id: ptyIdFor(me.id), cwd: me.repoPath, shell: false,
        remote: me.remote ?? null, tmux: me.tmuxSession ?? null,
      }).catch(() => {});
    }
    for (const m of members) {
      // hooks install is cheap and spawn-independent
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

  // self-healing: crash restarts (bounded), stuck + rate-limit detection
  const restarts: Record<string, number[]> = {};
  const wasAlive: Record<string, boolean> = {};
  const autoPaused = new Set<string>();

  let busy = false;
  const tick = async () => {
    if (busy) return; // previous tick still awaiting — don't pile up
    busy = true;
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
        // OSC 9/99/777 is an explicit signal from the agent — trust it first
        let status: "idle" | "working" | "needs-input" = !st.alive
          ? "idle"
          : st.oscNotify || st.bell
            ? "needs-input"
            : st.quietMs < 4000
              ? "working"
              : "idle";
        if (st.alive && hookFresh) {
          if (hook.event === "notification") status = "needs-input";
          else if (hook.event === "prompt") status = st.quietMs < 120_000 ? "working" : status;
          else if (hook.event === "stop") status = st.oscNotify || st.bell ? "needs-input" : "idle";
        }
        const stg = store.getState();
        const member = stg.members.find((m) => m.id === memberId);
        const selfHealOn = stg.appSettings.selfHeal !== false;
        const tailText = st.tail.slice(-8).join(" ").toLowerCase();
        const rateLimited = /rate.?limit|usage limit reached|429|overloaded/.test(tailText);

        // crashed: was alive, now dead -> bounded auto-restart. Suppressed
        // while the claude CLI is missing (local spawns can only die again;
        // remote sessions still restart since they don't need a local CLI).
        const healable = !stg.claudeMissing || !!member?.remote;
        if (selfHealOn && healable && wasAlive[st.id] && !st.alive && member) {
          const now = Date.now();
          restarts[st.id] = (restarts[st.id] ?? []).filter((t) => now - t < 10 * 60_000);
          if (restarts[st.id].length < 3) {
            restarts[st.id].push(now);
            stg.toast(`${member.name}'s session crashed — restarting (${restarts[st.id].length}/3)`, "warn");
            invoke("pty_ensure", {
              id: st.id, cwd: member.repoPath, shell: false,
              remote: member.remote ?? null, tmux: member.tmuxSession ?? null,
            }).catch(() => {});
          } else {
            stg.toast(`${member.name}'s session keeps crashing — auto-restart paused, restart manually`, "warn");
          }
        }
        wasAlive[st.id] = st.alive;

        // stuck: no output for 20+ min while alive and not rate-limited -> flag loudly
        const stuck = st.alive && !rateLimited && st.quietMs > 20 * 60_000 && !st.paused;

        // auto-pause: idle claude TUIs burn 10-25% CPU each just repainting.
        // SIGSTOP after quiet threshold; typing/viewing resumes instantly.
        const idleMin = Number(stg.appSettings.autoPauseIdleMin ?? 5);
        const isViewed = stg.activeId === memberId && stg.view === "session";
        if (
          stg.appSettings.autoPauseIdle !== false &&
          st.alive && !st.paused && !rateLimited && !isViewed &&
          st.quietMs > idleMin * 60_000
        ) {
          autoPaused.add(st.id);
          invoke("pty_pause", { id: st.id, pause: true }).catch(() => {});
        }
        if (st.paused && isViewed) {
          autoPaused.delete(st.id);
          invoke("pty_pause", { id: st.id, pause: false }).catch(() => {});
        }

        const cur = store.getState().teammates.find((t) => t.id === memberId);
        const recording = st.recording !== null;
        const lastNew = st.tail[st.tail.length - 1];
        const lastCur = cur?.terminal[cur.terminal.length - 1]?.text;
        // skip no-op patches — every patch re-renders panes and the list
        if (cur && cur.status === status && cur.recording === recording &&
            cur.terminal.length === st.tail.length && lastCur === lastNew) {
          continue;
        }
        store.getState().patchTeammate(memberId, {
          status: st.paused ? "idle" : rateLimited ? "needs-input" : status,
          paused: st.paused,
          recording,
          health: stuck ? "stale" : cur?.health === "disconnected" ? "disconnected" : "ok",
          terminal: st.tail.map((text) => ({ kind: "out" as const, text })),
        });
        if (rateLimited && cur?.status !== "needs-input") {
          store.getState().toast(`${cur?.name ?? memberId}: rate limit hit — session waits and resumes on its own`, "warn");
        }
      }
    } catch (e) {
      console.error("[pty feed]", e);
    } finally {
      busy = false;
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
  const ping = (title: string, body: string, kind: "msg" | "input" | "mention") => {
    const st = store.getState().appSettings;
    if (st.muteAll) return;
    if ((kind === "msg" || kind === "mention") && st.notifyMessages === false) return;
    if (kind === "input" && st.notifyNeedsInput === false) return;
    playAlert(kind === "msg" ? "message" : kind === "mention" ? "mention" : "needs-input", st);
    if (canNotify) notif.sendNotification({ title, body });
  };

  const rawCache: Record<string, string> = {};
  const read = async (name: string) => {
    const raw = await invoke<string>("shared_read", { name });
    if (!raw.trim()) return null;
    if (rawCache[name] === raw) return "__unchanged__" as const;
    // parse BEFORE caching — a torn/partial write must not wedge the file
    // as "unchanged" forever; next tick re-reads the completed write
    const parsed = JSON.parse(raw);
    rawCache[name] = raw;
    return parsed;
  };
  const write = (name: string, data: unknown) =>
    invoke("shared_write", { name, content: JSON.stringify(data, null, 2) });

  // seed missing files once team config is loaded — retried from the tick so
  // one startup error (or slow config) never kills the feed
  let seeded = false;
  const seed = async () => {
    const st = store.getState();
    if (st.members.length === 0) return; // config not loaded yet
    // a fresh project starts EMPTY — the fake.ts fixtures are a browser-dev
    // seam only and must never be written into a real project's shared state
    if ((await read("tasks.json")) === null) await write("tasks.json", []);
    if ((await read("messages.json")) === null) await write("messages.json", []);
    if ((await read("team.json")) === null) {
      await write("team.json", {
        mergeQueue: st.members.map((m) => m.id),
        sponsor: [],
      });
    }
    // the existence probes above populated rawCache, which would make the
    // first real tick see "__unchanged__" and leave the fake seed data on
    // screen until the next disk write (and skip seenMsgs hydration, causing
    // a notification burst later). Forget those reads so tick 1 parses fresh.
    delete rawCache["tasks.json"];
    delete rawCache["messages.json"];
    delete rawCache["team.json"];
    seeded = true;
  };

  const seenMsgs = new Set<string>();
  const SEEN_MSGS_MAX = 5000;
  let first = true;
  // FYI digest: batch quiet messages; interval user-adjustable (default 15m,
  // clamped to >=1m). One cancellable handle, rescheduled after each fire, so
  // setting changes apply without a restart and timers never stack.
  const fyiQueue: import("../../types").Message[] = [];
  let digestTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleDigest = () => {
    if (digestTimer !== null) clearTimeout(digestTimer);
    const min = Math.max(1, Number(store.getState().appSettings.fyiDigestMin) || 15);
    digestTimer = setTimeout(digestTick, min * 60 * 1000);
  };
  const digestTick = () => {
    if (fyiQueue.length > 0) {
      ping(
        `${fyiQueue.length} FYI${fyiQueue.length > 1 ? "s" : ""} waiting`,
        fyiQueue.map((m) => `${m.from}: ${m.text.slice(0, 40)}`).join(" · ").slice(0, 140),
        "msg",
      );
      fyiQueue.length = 0;
    }
    scheduleDigest();
  };
  scheduleDigest();
  const prevStatus: Record<string, string> = {};

  let busy = false;
  const tick = async () => {
    if (busy) return; // previous tick still awaiting — don't pile up
    busy = true;
    try {
      if (!seeded) {
        await seed();
        if (!seeded) return; // members not loaded yet — retry next tick
      }
      const me = store.getState().members[0]?.id;
      const [tasks, messages, team, standupLines] = await Promise.all([
        read("tasks.json"),
        read("messages.json"),
        read("team.json"),
        invoke<string[]>("standup_tail"),
      ]);
      store.getState().setShared({
        tasks: tasks === "__unchanged__" ? undefined : tasks ?? undefined,
        messages: messages === "__unchanged__" ? undefined : messages ?? undefined,
        mergeQueue: team === "__unchanged__" ? undefined : team?.mergeQueue,
        sponsorChecklist: team === "__unchanged__" ? undefined : team?.sponsor,
        standupLines,
      });

      const msgList = messages === "__unchanged__" ? [] : ((messages ?? []) as import("../../types").Message[]);
      for (const m of msgList) {
        if (seenMsgs.has(m.id)) continue;
        seenMsgs.add(m.id);
        if (!first && m.from !== me && (m.to === me || m.to === "all")) {
          const mentioned = me && m.text.includes(`@${me}`);
          if (m.kind === "fyi" && !mentioned) {
            fyiQueue.push(m); // digest — no interrupt for FYIs
          } else {
            const urgent = m.kind === "blocking";
            ping(
              urgent ? `BLOCKING from ${m.from}` : mentioned ? `@you from ${m.from}` : `${m.kind ?? "Message"} from ${m.from}`,
              m.text.slice(0, 120),
              mentioned || urgent ? "mention" : "msg",
            );
          }
        }
      }
      // bound seenMsgs for week-long sessions: drop ids no longer in the file
      // (pruned/rotated messages), then hard-cap oldest-first as a backstop
      if (messages !== "__unchanged__" && seenMsgs.size > msgList.length) {
        const live = new Set(msgList.map((m) => m.id));
        for (const id of seenMsgs) {
          if (!live.has(id)) seenMsgs.delete(id);
        }
      }
      if (seenMsgs.size > SEEN_MSGS_MAX) {
        for (const id of seenMsgs) {
          if (seenMsgs.size <= SEEN_MSGS_MAX) break;
          seenMsgs.delete(id);
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
    } finally {
      busy = false;
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

export interface SessionRes { id: string; cpu: number; memMb: number }

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
  let busy = false;
  const tick = async () => {
    if (busy) return; // previous tick still awaiting — don't pile up
    busy = true;
    try {
      // per-session resource monitor
      try {
        const res = await invoke<SessionRes[]>("pty_resources");
        (store.getState() as unknown as { setResources: (r: SessionRes[]) => void }).setResources(res);
      } catch { /* ps unavailable */ }
      // session start times scope token attribution
      const ptys = await invoke<PtyStatus[]>("pty_status").catch(() => [] as PtyStatus[]);
      for (const m of store.getState().members) {
        try {
          const mine = ptys.find((p) => p.id === ptyIdFor(m.id));
          const u = await invoke<UsageStats>("usage_stats", {
            repoPath: m.repoPath,
            since: mine?.startedAt ?? null,
          });
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
    } finally {
      busy = false;
    }
  };
  tick();
  setInterval(tick, USAGE_POLL_MS);
}
