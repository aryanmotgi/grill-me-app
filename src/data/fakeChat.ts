// Browser-dev only: a tiny transcript so the chat view renders without the
// native app (mirrors fake.ts). Never used when running under Tauri.
const L = (o: unknown) => JSON.stringify(o);

export const FAKE_CHAT_LINES: string[] = [
  L({ type: "user", uuid: "d1", timestamp: "2026-09-28T10:00:02Z", message: { content: "the session list feels cramped — can you tighten the rows?" } }),
  L({ type: "assistant", uuid: "d2", timestamp: "2026-09-28T10:00:04Z", message: { model: "claude-opus-4-8", content: [{ type: "text", text: "Looking at the row layout first." }] } }),
  L({ type: "assistant", uuid: "d3", timestamp: "2026-09-28T10:00:06Z", message: { model: "claude-opus-4-8", content: [{ type: "tool_use", id: "dt1", name: "Read", input: { file_path: "/repo/src/components/SessionList.tsx" } }] } }),
  L({ type: "user", uuid: "d4", timestamp: "2026-09-28T10:00:08Z", message: { content: [{ type: "tool_result", tool_use_id: "dt1", content: "export function SessionList() { … }" }] } }),
  L({ type: "assistant", uuid: "d5", timestamp: "2026-09-28T10:00:10Z", message: { model: "claude-opus-4-8", content: [{ type: "tool_use", id: "dt2", name: "Edit", input: { file_path: "/repo/src/components/SessionList.tsx" } }] } }),
  L({ type: "user", uuid: "d6", timestamp: "2026-09-28T10:00:12Z", message: { content: [{ type: "tool_result", tool_use_id: "dt2", content: "ok" }] } }),
  L({ type: "assistant", uuid: "d7", timestamp: "2026-09-28T10:00:14Z", message: { model: "claude-opus-4-8", content: [{ type: "tool_use", id: "dt3", name: "Bash", input: { command: "npm test", description: "Run the test suite" } }] } }),
  L({ type: "user", uuid: "d8", timestamp: "2026-09-28T10:00:16Z", message: { content: [{ type: "tool_result", tool_use_id: "dt3", content: "Tests  358 passed (358)" }] } }),
  L({ type: "assistant", uuid: "d9", timestamp: "2026-09-28T10:00:18Z", message: { model: "claude-opus-4-8", content: [{ type: "text", text: "Done. Rows are tighter:\n\n- padding `py-2.5` → `py-1.5`\n- branch + file on **one line**\n\n| Before | After |\n|---|---|\n| 72px | 56px |\n\nTests pass." }] } }),
];
