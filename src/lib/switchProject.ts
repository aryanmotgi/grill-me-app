// Switch the open project. Agents keep running in the background (their
// terminals live in the Rust side, which a switch doesn't touch); the window
// reloads into the other project's sessions.
import { useApp } from "../store";

export async function switchProject(id: string) {
  const st = useApp.getState();
  if (!id || id === st.activeProject) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("set_active_project", { id }).catch(() => {});
  st.setAppSetting("activeProject", id);
  setTimeout(() => location.reload(), 120);
}
