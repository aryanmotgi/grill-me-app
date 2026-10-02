// The app window opens on this tiny page and waits. The launch animation
// says when to start loading the real app (src-tauri/src/boot.rs), so the
// heavy load never competes with the animation's busiest moment. Without a
// launch animation it starts straight away; it never waits more than a few
// seconds either way.
async function go() {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("boot_wait");
  } catch { /* not in the app, or the wait failed: load now */ }
  location.replace("index.html");
}
void go();
