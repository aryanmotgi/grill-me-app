import { describe, expect, it } from "vitest";
import type { RoomChatMsg, RoomMember, RoomTask } from "../../types";
import {
  newTaskId,
  ownerForAssignee,
  parseTasksJson,
  pendingReplyTs,
  roomTasksToAppTasks,
  taskBrief,
} from "./logic";

const msg = (role: "user" | "assistant", ts: number, from = "m1"): RoomChatMsg => ({
  from,
  name: from === "m1" ? "Aryan" : "Sam",
  role,
  text: "hi",
  ts,
});

describe("pendingReplyTs — host reply decision", () => {
  it("returns the ts when the newest entry is an unreplied user message", () => {
    const chat = [msg("user", 100), msg("assistant", 200), msg("user", 300)];
    expect(pendingReplyTs(chat, 0)).toBe(300);
  });

  it("returns null when the newest entry is an assistant reply", () => {
    const chat = [msg("user", 100), msg("assistant", 200)];
    expect(pendingReplyTs(chat, 100)).toBeNull();
  });

  it("returns null for an empty transcript", () => {
    expect(pendingReplyTs([], 0)).toBeNull();
  });

  it("never double-fires: already-replied ts returns null", () => {
    const chat = [msg("user", 300)];
    expect(pendingReplyTs(chat, 300)).toBeNull();
    expect(pendingReplyTs(chat, 400)).toBeNull(); // stale/older msgs too
  });

  it("fires again for a NEWER user message after a reply", () => {
    const chat = [msg("user", 300), msg("assistant", 350), msg("user", 400, "m2")];
    expect(pendingReplyTs(chat, 300)).toBe(400);
  });
});

describe("parseTasksJson — task id generation", () => {
  it("parses a plain array and generates sequential ids", () => {
    const raw = JSON.stringify([
      { title: "Build API", detail: "REST endpoints" },
      { title: "Build UI", detail: "" },
    ]);
    const tasks = parseTasksJson(raw);
    expect(tasks).toEqual([
      { id: "t1", title: "Build API", detail: "REST endpoints", assignee: null },
      { id: "t2", title: "Build UI", detail: "", assignee: null },
    ]);
  });

  it("tolerates markdown code fences and a tasks wrapper object", () => {
    expect(parseTasksJson('```json\n[{"title":"A","detail":"d"}]\n```')).toHaveLength(1);
    expect(parseTasksJson('{"tasks":[{"title":"A"},{"title":"B"}]}')).toHaveLength(2);
  });

  it("extracts the array out of surrounding prose", () => {
    const tasks = parseTasksJson('Here you go:\n[{"title":"A","detail":"d"}]\nEnjoy!');
    expect(tasks).toEqual([{ id: "t1", title: "A", detail: "d", assignee: null }]);
  });

  it("drops entries without a title and returns [] on garbage", () => {
    expect(parseTasksJson('[{"detail":"no title"},{"title":"  "},{"title":"ok"}]')).toEqual([
      { id: "t1", title: "ok", detail: "", assignee: null },
    ]);
    expect(parseTasksJson("not json at all")).toEqual([]);
    expect(parseTasksJson("")).toEqual([]);
  });

  it("newTaskId never collides with generated t1..tn ids", () => {
    expect(newTaskId(1758040000000)).toMatch(/^t-/);
    expect(newTaskId(1)).not.toBe(newTaskId(1)); // random suffix
  });
});

describe("assignee → owner mapping", () => {
  const roomMembers: RoomMember[] = [
    { id: "m1", name: "Aryan", isHost: true, lastSeen: 0 },
    { id: "m2", name: "PRIYA", isHost: false, lastSeen: 0 },
  ];
  const teamMembers = [
    { id: "aryan", name: "Aryan Motgi" },
    { id: "sam", name: "priya" }, // name match, different id
  ];

  it("maps a room member to a team config id case-insensitively (by id)", () => {
    expect(ownerForAssignee("m1", roomMembers, teamMembers)).toBe("aryan");
  });

  it("maps by team member name case-insensitively", () => {
    expect(ownerForAssignee("m2", roomMembers, teamMembers)).toBe("sam");
  });

  it("unmatched members stay by name; unassigned stays 'unassigned'", () => {
    expect(ownerForAssignee("m2", roomMembers, [{ id: "aryan", name: "Aryan" }])).toBe("PRIYA");
    expect(ownerForAssignee(null, roomMembers, teamMembers)).toBe("unassigned");
  });

  it("roomTasksToAppTasks namespaces ids with the room code and maps owners", () => {
    const roomTasks: RoomTask[] = [
      { id: "t1", title: "Build API", detail: "REST", assignee: "m1" },
      { id: "t2", title: "Docs", detail: "", assignee: null },
    ];
    const out = roomTasksToAppTasks(roomTasks, roomMembers, teamMembers, "K7M2P");
    expect(out[0]).toEqual({
      id: "room-K7M2P-t1",
      title: "Build API",
      desc: "REST",
      owner: "aryan",
      status: "not-started",
      files: [],
    });
    expect(out[1].owner).toBe("unassigned");
  });
});

describe("taskBrief", () => {
  it("includes title and detail, ends with a newline", () => {
    expect(taskBrief({ id: "t1", title: "Build API", detail: "REST", assignee: "m1" })).toBe(
      "Work on this task: Build API. REST When done, tell the user and stop.\n",
    );
    expect(taskBrief({ id: "t1", title: "Docs", detail: "", assignee: null })).toBe(
      "Work on this task: Docs. When done, tell the user and stop.\n",
    );
  });
});
