// ---------------------------------------------------------------------------
// Add a project by picking its folder in Finder. The native dialog allows
// "New Folder", so the same flow covers existing repos and brand-new
// projects. The folder name becomes the project name, the project is pinned
// to that path, and it opens right away. A folder that isn't a git repo yet
// gets an offer to `git init` it — sessions run in git worktrees, so a
// project needs a repo with at least one commit.
// ---------------------------------------------------------------------------

export interface ProjectEntry {
  id: string;
  name: string;
  path: string;
  lastOpened?: number;
  color?: string;
}

/** kebab id from the folder name, suffixed if another project already has it */
export function projectIdFor(name: string, taken: string[]): string {
  const base = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "project";
  let id = base;
  for (let n = 2; taken.includes(id) || id === "default"; n++) id = `${base}-${n}`;
  return id;
}

async function git(args: string[]): Promise<{ ok: boolean; out: string }> {
  const { Command } = await import("@tauri-apps/plugin-shell");
  const r = await Command.create("git", args).execute();
  return { ok: r.code === 0, out: (r.stdout || r.stderr).trim() };
}

/** Make sure `path` is a git repo with a commit. Returns false if the user
 *  declined or init failed (the reason is passed to `warn`). */
async function ensureGitRepo(path: string, warn: (msg: string) => void): Promise<boolean> {
  const inside = await git(["-C", path, "rev-parse", "--is-inside-work-tree"]);
  if (inside.ok) {
    // a fresh `git init` with no commits can't host worktrees yet
    const head = await git(["-C", path, "rev-parse", "--verify", "HEAD"]);
    if (head.ok) return true;
    const c = await git(["-C", path, "commit", "--allow-empty", "-m", "Initial commit"]);
    if (!c.ok) warn(`Repo has no commits and the first commit failed: ${c.out}`);
    return c.ok;
  }
  const { ask } = await import("@tauri-apps/plugin-dialog");
  const yes = await ask(
    `"${path.split("/").pop()}" isn't a git repo yet. Sessions run in git worktrees, so it needs one.\n\nInitialize a git repo here?`,
    { title: "Set up git?", kind: "info", okLabel: "Initialize", cancelLabel: "Cancel" },
  );
  if (!yes) return false;
  const init = await git(["-C", path, "init"]);
  if (!init.ok) { warn(`git init failed: ${init.out}`); return false; }
  const c = await git(["-C", path, "commit", "--allow-empty", "-m", "Initial commit"]);
  if (!c.ok) { warn(`git init worked, but the first commit failed: ${c.out}`); return false; }
  return true;
}

/** Open (or switch to) a project at `path`: register it if new, make it
 *  active, and reload into it. */
export async function openProjectAt(path: string, warn: (msg: string) => void): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  const raw = await invoke<string>("projects_list").catch(() => "[]");
  let list: ProjectEntry[] = [];
  try { list = JSON.parse(raw); } catch { /* fresh */ }

  const clean = path.replace(/\/+$/, "");
  let project = list.find((p) => p.path.replace(/\/+$/, "") === clean);
  const isNew = !project;
  if (!project) {
    const name = clean.split("/").pop() || "project";
    project = { id: projectIdFor(name, list.map((p) => p.id)), name, path: clean };
    list = [...list, project];
  }
  const id = project.id;
  list = list.map((p) => (p.id === id ? { ...p, lastOpened: Date.now() } : p));

  await invoke("projects_write", { content: JSON.stringify(list, null, 2) });
  await invoke("set_active_project", { id });
  if (isNew) {
    await invoke("team_config_write", {
      cfg: { teammates: [{ id: "me", name: "Me", repoPath: clean, permission: "edit" }] },
    }).catch((e) => warn(`Couldn't write the project's session config: ${e}`));
  }
  const { useApp } = await import("../store");
  useApp.getState().setAppSetting("activeProject", id);
  setTimeout(() => location.reload(), 150);
}

/** Finder → pick or create a folder → ensure git → open it as a project. */
export async function addProjectFromFinder(warn: (msg: string) => void): Promise<void> {
  if (!("__TAURI_INTERNALS__" in window)) { warn("Adding a project needs the native app"); return; }
  const { open } = await import("@tauri-apps/plugin-dialog");
  const dir = await open({
    directory: true,
    multiple: false,
    canCreateDirectories: true,
    title: "Choose a project folder — or make a new one",
  });
  if (typeof dir !== "string") return; // cancelled
  if (!(await ensureGitRepo(dir, warn))) return;
  await openProjectAt(dir, warn);
}
