/**
 * Pure helpers for the team setup flow (brainstorm → plan → tasks → assign).
 * No React, no Tauri — everything here is unit-tested in logic.test.ts.
 */

import type { RoomChatMsg, RoomMember, RoomTask, Task } from "../../types";

/** Minimal slice of TeamMemberConfig needed for assignee mapping. */
export interface TeamMemberLike {
  id: string;
  name: string;
}

/**
 * Host reply decision: returns the ts of the newest chat entry when it is a
 * user message that has not been replied to yet, else null. `lastRepliedTs`
 * is the ts of the user message the host last generated a reply for — the
 * caller keeps it in a ref so effect re-runs can never double-fire.
 */
export function pendingReplyTs(chat: RoomChatMsg[], lastRepliedTs: number): number | null {
  if (chat.length === 0) return null;
  const newest = chat[chat.length - 1];
  if (newest.role !== "user") return null;
  if (newest.ts <= lastRepliedTs) return null;
  return newest.ts;
}

/**
 * Parse the JSON that room_make_tasks returns into RoomTasks with generated
 * ids. Tolerant of model formatting: code fences, a {"tasks": [...]} wrapper,
 * or leading prose before the array. Invalid input → [] (caller toasts).
 */
export function parseTasksJson(raw: string): RoomTask[] {
  const stripped = raw.replace(/```(?:json)?/gi, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    // model sometimes wraps the array in prose — take the outermost [...]
    const start = stripped.indexOf("[");
    const end = stripped.lastIndexOf("]");
    if (start === -1 || end <= start) return [];
    try {
      parsed = JSON.parse(stripped.slice(start, end + 1));
    } catch {
      return [];
    }
  }
  if (parsed && !Array.isArray(parsed) && typeof parsed === "object") {
    parsed = (parsed as { tasks?: unknown }).tasks;
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((t): t is { title?: unknown; detail?: unknown } => !!t && typeof t === "object")
    .map((t) => ({
      title: typeof t.title === "string" ? t.title.trim() : "",
      detail: typeof t.detail === "string" ? t.detail.trim() : "",
    }))
    .filter((t) => t.title.length > 0)
    .map((t, i) => ({ id: `t${i + 1}`, title: t.title, detail: t.detail, assignee: null }));
}

/** Id for a task added by hand in TasksStep — never collides with t1..tn. */
export function newTaskId(now: number = Date.now()): string {
  return `t-${now.toString(36)}-${Math.floor(Math.random() * 1296).toString(36)}`;
}

/**
 * Map a room task assignee (room member id) to a task-board owner: the room
 * member's name is matched case-insensitively against team config member ids
 * and names; unmatched assignees stay by name in task.owner. Unassigned tasks
 * get "unassigned" so the board shows them honestly.
 */
export function ownerForAssignee(
  assignee: string | null,
  roomMembers: RoomMember[],
  teamMembers: TeamMemberLike[],
): string {
  if (!assignee) return "unassigned";
  const roomName = roomMembers.find((m) => m.id === assignee)?.name ?? assignee;
  const needle = roomName.toLowerCase();
  const match = teamMembers.find(
    (m) => m.id.toLowerCase() === needle || m.name.toLowerCase() === needle,
  );
  return match ? match.id : roomName;
}

/**
 * Room tasks → app task-board tasks. Ids are namespaced with the room code so
 * an upsert into tasks.json can never clobber pre-existing board tasks.
 */
export function roomTasksToAppTasks(
  roomTasks: RoomTask[],
  roomMembers: RoomMember[],
  teamMembers: TeamMemberLike[],
  roomCode: string,
): Task[] {
  return roomTasks.map((t) => ({
    id: `room-${roomCode}-${t.id}`,
    title: t.title,
    desc: t.detail,
    owner: ownerForAssignee(t.assignee, roomMembers, teamMembers),
    status: "not-started" as const,
    files: [],
  }));
}

/** Brief injected into the member's own claude session after setup finishes. */
export function taskBrief(task: RoomTask): string {
  const detail = task.detail ? ` ${task.detail}` : "";
  return `Work on this task: ${task.title}.${detail} When done, tell the user and stop.\n`;
}
