// ---------------------------------------------------------------------------
// Letting a teammate into one session — and nothing else.
//
// Plain ssh access is not "access to a session", it is a shell on the machine
// as that user: every file, every command, their keys. Asking a teammate to
// enable it so you can watch their agent work is asking for their laptop.
//
// sshd has the mechanism for this. A key in ~/.ssh/authorized_keys can carry a
// forced command, and then that key can do exactly one thing:
//
//   command="tmux attach -r -t grillme-x",no-port-forwarding,... ssh-ed25519 AAAA...
//
// The connection lands inside that tmux session. No shell, no file browsing, no
// tunnels — sshd runs the forced command whatever the client asks for. Read-only
// is `attach -r`, which tmux enforces: the viewer's keystrokes go nowhere.
//
// So the levels below are not a request Grill Me makes of a well-behaved
// client. They are what the owner's own sshd will permit, and revoking one is
// deleting one line.
//
// The two levels are not the same kind of thing, and the UI says so:
//
//   watch  attach -r. Tested against an interactive client: new-window,
//          run-shell and switch-client are all refused, so it really is one
//          session and nothing else. (Those commands DO work when passed as
//          `tmux attach -r ... \; new-window ...`, but that runs through a
//          second, non-readonly command client — which is exactly what the
//          forced command prevents, since sshd ignores what the client asks
//          to run.)
//
//   type   new -A. Not contained and cannot be: an interactive client can
//          open a window and run anything, and even without that, typing into
//          an agent started with --dangerously-skip-permissions is arbitrary
//          execution by another route. Grant it only to someone you would
//          hand the laptop to.
// ---------------------------------------------------------------------------

export const SSH_ACCESS = ["off", "watch", "type"] as const;
export type SshAccess = (typeof SSH_ACCESS)[number];

export const ACCESS_COPY: Record<SshAccess, { label: string; detail: string }> = {
  off: { label: "No access", detail: "They cannot connect. Remove the line from authorized_keys to revoke." },
  watch: {
    label: "Watch only",
    detail: "They see this session and nothing else on your Mac. tmux attaches them read-only, which blocks opening a window, running a command, and switching to another session — tested, not assumed.",
  },
  type: {
    label: "Watch and type",
    detail: "Effectively a shell on your Mac. They can run any command — through tmux directly, and by asking the agent, which runs with permissions skipped. Only for someone you would hand the laptop to.",
  },
};

/** Options that close the doors a forced command leaves open. */
const RESTRICT = ["no-port-forwarding", "no-agent-forwarding", "no-X11-forwarding", "no-user-rc"].join(",");

/** tmux session name for a Grill Me session id. Must satisfy the same rule the
 *  Rust side validates: [A-Za-z0-9._-]+ and not leading '-'. */
export function tmuxName(sessionId: string): string {
  const safe = sessionId.replace(/[^A-Za-z0-9._-]/g, "-").replace(/^-+/, "");
  return `grillme-${safe || "session"}`;
}

/** True for something that is one public key and only one.
 *
 *  The newline check is the point: authorized_keys is line-oriented, so a
 *  "key" containing one would append a second entry — and that one would carry
 *  no forced command at all. */
export function looksLikePublicKey(raw: string): boolean {
  const k = raw.trim();
  if (!k || /[\r\n]/.test(k)) return false;
  if (/^-{5}BEGIN/.test(k)) return false; // a private key, pasted by mistake
  return /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(256|384|521)|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com) [A-Za-z0-9+/=]+( .*)?$/.test(k);
}

/** The line to add to ~/.ssh/authorized_keys, or null when nothing should be
 *  granted. Returns null rather than a broken line for bad input — a malformed
 *  entry in that file is worse than no entry. */
export function authorizedKeyLine(access: SshAccess, publicKey: string, sessionId: string): string | null {
  if (access === "off" || !looksLikePublicKey(publicKey)) return null;
  const name = tmuxName(sessionId);
  const cmd = access === "watch" ? `tmux attach -r -t ${name}` : `tmux new -A -s ${name}`;
  return `command="${cmd}",${RESTRICT} ${publicKey.trim()}`;
}

/** What the teammate runs once the line is in place. */
export function connectCommand(host: string): string {
  return `ssh -t ${host}`;
}

/** Session ids the user has marked shareable. They run inside tmux, which is
 *  what makes them joinable at all — a bare pty has no handle from outside the
 *  app's own process. Takes effect when the session next starts. */
export function sharedSessions(settings: Record<string, unknown> | undefined): string[] {
  const v = settings?.sharedSessions;
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** Where a teammate's Mac can be reached, keyed by their room member id.
 *
 *  Kept out of the team config on purpose: a teammate who joined the room is
 *  not in this Mac's config at all, so there would be nothing to attach the
 *  host to. */
export function teammateHosts(settings: Record<string, unknown> | undefined): Record<string, string> {
  const v = settings?.teammateHosts;
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, string> = {};
  for (const [k, h] of Object.entries(v as Record<string, unknown>)) {
    if (typeof h === "string" && h.trim()) out[k] = h.trim();
  }
  return out;
}

/** Same rule the Rust side validates before this reaches ssh: no leading '-'
 *  (which ssh would read as an option) and nothing outside the safe set. */
export function looksLikeSshHost(host: string): boolean {
  const h = host.trim();
  return h.length > 0 && !h.startsWith("-") && /^[A-Za-z0-9@._-]+$/.test(h);
}
