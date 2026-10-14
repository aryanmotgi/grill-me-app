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
// ---------------------------------------------------------------------------

export const SSH_ACCESS = ["off", "watch", "type"] as const;
export type SshAccess = (typeof SSH_ACCESS)[number];

export const ACCESS_COPY: Record<SshAccess, { label: string; detail: string }> = {
  off: { label: "No access", detail: "They cannot connect. Remove the line from authorized_keys to revoke." },
  watch: { label: "Watch only", detail: "They see the session live. tmux attaches them read-only, so their keystrokes go nowhere." },
  type: { label: "Watch and type", detail: "You share one terminal. Anything they type reaches the agent, as if they were sitting here." },
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
