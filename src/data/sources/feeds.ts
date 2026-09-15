import type { StoreApi, UseBoundStore } from "zustand";
import type { Teammate } from "../../types";
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
