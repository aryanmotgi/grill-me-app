import { useState } from "react";
import { useApp } from "../store";
import { Icon } from "./Icon";
import { teamSessionsByMember } from "../lib/flow";
import { ACCESS_COPY, SSH_ACCESS, authorizedKeyLine, looksLikePublicKey, looksLikeSshHost, sharedSessions, teammateHosts, tmuxName, type SshAccess } from "../lib/sshShare";
import { sessionTitle } from "../lib/sessionTitle";
import { sessionSentence } from "../lib/sessionSentence";
import type { TeamSession } from "../types";

// ---------------------------------------------------------------------------
// Teammates: who is on this project, and what each of them is running.
//
// Deliberately plain — a list on the left, that person's sessions on the right.
// Everything here except your own sessions arrives over the room as published
// state (title, status, branch, files), so it is a window, not a terminal.
//
// Taking over someone's session is a different thing and needs ssh: with a
// remote host and a tmux session configured, `tmux new -A` attaches to the one
// they are already in, so you share a terminal rather than watch a copy.
// ---------------------------------------------------------------------------

function Dot({ status }: { status: string }) {
  return <span className={`status-dot ${status} flex-none`} style={{ width: 7, height: 7 }} aria-hidden />;
}

function SessionRow({ d, on, onPick, onOpen }: {
  d: TeamSession; on?: boolean; onPick?: () => void; onOpen?: () => void;
}) {
  return (
    <div className={`hairline rounded-lg px-3 py-2.5 flex items-start gap-2.5 ${onPick ? "cursor-pointer" : ""} ${on ? "bg-raised" : ""}`}
      onClick={onPick}>
      <Dot status={d.status} />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] text-ink truncate">{d.title}</div>
        {d.sentence ? <div className="text-[12px] text-dim mt-0.5">{d.sentence}</div> : null}
        <div className="flex items-center gap-2.5 mt-1 text-[11px] text-faint">
          {d.branch ? <span className="truncate max-w-[180px]"><Icon name="branch" size={9} /> {d.branch}</span> : null}
          {d.files?.length ? <span>{d.files.length} file{d.files.length === 1 ? "" : "s"}</span> : null}
          {d.tests === true ? <span className="text-ok">tests pass</span> : d.tests === false ? <span className="text-danger">tests fail</span> : null}
        </div>
      </div>
      {onOpen ? (
        <button className="btn flex-none" title="Leave this page and work in the session"
          onClick={(e) => { e.stopPropagation(); onOpen(); }}>Open in workspace</button>
      ) : null}
    </div>
  );
}

/** Letting one teammate into one session.
 *
 *  Grill Me does not touch their machine or yours: it composes the line and you
 *  send it. Granting is them pasting it into ~/.ssh/authorized_keys; revoking
 *  is them deleting it. The forced command in that line is what limits the
 *  access — sshd runs it whatever the client asks for, so "watch only" is
 *  tmux's read-only attach rather than a promise. */
function ShareAccess({ sessionId }: { sessionId: string }) {
  const toast = useApp((s) => s.toast);
  const appSettings = useApp((s) => s.appSettings);
  const setAppSetting = useApp((s) => s.setAppSetting);
  const [access, setAccess] = useState<SshAccess>("off");
  const [key, setKey] = useState("");
  const shared = sharedSessions(appSettings);
  const inTmux = shared.includes(sessionId);
  const line = authorizedKeyLine(access, key, sessionId);
  const bad = access !== "off" && key.trim().length > 0 && !looksLikePublicKey(key);

  return (
    <div className="hairline rounded-lg p-3 flex flex-col gap-2.5">
      <div className="text-[12px] text-ink">Let a teammate into this session</div>
      <div className="text-[11.5px] text-faint leading-snug">
        Plain ssh access is a shell on your Mac — every file, every command. This grants one
        tmux session and nothing else, and they revoke it by deleting one line.
      </div>
      <label className="flex items-start gap-2 text-[12px] text-dim cursor-pointer">
        <input type="checkbox" className="mt-0.5" checked={inTmux}
          onChange={(e) => setAppSetting("sharedSessions",
            e.target.checked ? [...shared, sessionId] : shared.filter((x) => x !== sessionId))} />
        <span>
          Run this session inside tmux
          <span className="block text-[11.5px] text-faint leading-snug">
            Required before anyone can join it, and it keeps the session alive if Grill Me quits.
            Takes effect the next time the session starts. tmux brings its own key bindings into the pane.
          </span>
        </span>
      </label>
      <div className="flex flex-col gap-1">
        {SSH_ACCESS.map((a) => (
          <button key={a} type="button"
            className={`flex items-start gap-2 text-left rounded-md px-2 py-1.5 cursor-pointer transition-colors ${
              access === a ? "bg-raised text-ink" : "text-dim hover:text-ink hover:bg-raised/60"}`}
            onClick={() => setAccess(a)}>
            <span className={`status-dot mt-1 flex-none ${access === a ? "working" : "idle"}`} style={{ width: 6, height: 6 }} />
            <span className="min-w-0">
              <span className="block text-[12.5px]">{ACCESS_COPY[a].label}</span>
              <span className="block text-[11.5px] text-faint leading-snug">{ACCESS_COPY[a].detail}</span>
            </span>
          </button>
        ))}
      </div>
      {access !== "off" ? (
        <>
          <input className="input" spellCheck={false} placeholder="Paste their public key — ssh-ed25519 AAAA…"
            value={key} onChange={(e) => setKey(e.target.value)} />
          {bad ? (
            <div className="text-[11.5px] text-warn">
              That isn't one public key. A key with a line break in it would add a second
              authorized_keys entry carrying no restriction at all, so it is refused.
            </div>
          ) : null}
          {line ? (
            <>
              <pre className="text-[10.5px] font-mono text-dim bg-raised hairline rounded-md p-2 whitespace-pre-wrap break-all">{line}</pre>
              <div className="flex items-center gap-2">
                <button className="btn" onClick={() => void navigator.clipboard.writeText(line)
                  .then(() => toast("Copied — they add it to ~/.ssh/authorized_keys"))}>Copy the line</button>
                <span className="text-[11px] text-faint">
                  They also need Remote Login on, in System Settings → General → Sharing.
                  {inTmux ? "" : " And this session is not in tmux yet — tick the box above."}
                </span>
              </div>
            </>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export function TeammatesPage() {
  const members = useApp((s) => s.members);
  const teamSessions = useApp((s) => s.teamSessions);
  const setView = useApp((s) => s.setView);
  const setActive = useApp((s) => s.setActive);
  const toast = useApp((s) => s.toast);
  const appSettings = useApp((s) => s.appSettings);
  const setAppSetting = useApp((s) => s.setAppSetting);
  // Two ids for the same person: the local config calls you "me", the room
  // publishes your sessions under roomSelf.memberId. Mixing them up listed you
  // twice, once with your sessions and once without.
  const roomSelf = useApp((s) => s.roomSelf?.memberId);
  const titles = useApp((s) => s.appSettings.sessionTitles);
  const local = useApp((s) => s.teammates);
  const selfId = members[0]?.id ?? "me";
  const [pick, setPick] = useState<string>(selfId);
  const [busy, setBusy] = useState(false);

  const byMember = teamSessionsByMember(teamSessions, Date.now());
  // anyone who published a session and is neither you nor in this Mac's config —
  // a teammate who joined the room would otherwise be invisible
  const extra = [...byMember.keys()]
    .filter((m) => m !== roomSelf && !members.some((x) => x.id === m))
    .map((m) => ({ id: m, name: byMember.get(m)?.[0]?.memberName ?? m, repoPath: "" }));
  const people = [...members, ...extra];
  const chosen = people.find((p) => p.id === pick) ?? people[0];
  const cfg = members.find((m) => m.id === chosen?.id);
  const mine = chosen?.id === selfId;
  // your own sessions come from this Mac, not from the round trip through the
  // room: they are live, they are right in solo mode, and they can be opened
  const rows: TeamSession[] = mine
    ? local.map((t) => ({
        id: t.id, member: selfId, memberName: chosen?.name ?? "You", session: t.id,
        title: sessionTitle(t, titles), status: t.status, sentence: sessionSentence(t).text,
        branch: t.branch, tests: null, files: (t.changes ?? []).map((c) => c.file),
      } as TeamSession))
    : byMember.get(chosen?.id ?? "") ?? [];
  const open = (d: TeamSession) => { setActive(d.session); setView("session"); };
  // clicking a session previews it here; going to the workspace is the explicit
  // button, so looking at a teammate never throws you out of this page
  const [peek, setPeek] = useState("");
  const peeked = rows.find((r) => r.session === peek) ?? rows[0];
  const peekedLocal = mine ? local.find((t) => t.id === peeked?.session) : undefined;
  // Where their Mac is. Kept in settings rather than the team config, because a
  // teammate who joined the room is not in this Mac's config at all.
  const hosts = teammateHosts(appSettings);
  const host = hosts[chosen?.id ?? ""] ?? cfg?.remote ?? "";
  const canAttach = !mine && !!peeked && looksLikeSshHost(host);
  const tail = (peekedLocal?.terminal ?? []).slice(-24);

  // shares the terminal they are in, rather than showing a copy of it
  // The tmux name is derived from the session they published, never typed:
  // a mistyped name attaches to a session that does not exist and shows an
  // empty terminal with no error, which is the worst possible failure here.
  // It is also harmless when they set up a forced command — sshd runs that
  // instead of whatever we ask for — so this works with or without one.
  const attach = async () => {
    if (!peeked || !looksLikeSshHost(host)) return;
    setBusy(true);
    const paneId = `attach:${chosen?.id ?? "x"}:${peeked.session}`;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("pty_ensure", {
        id: paneId, cwd: ".", shell: false,
        remote: host, tmux: tmuxName(peeked.session), agent: null,
      });
      setActive(paneId);
      setView("session");
      toast(`Connected to ${chosen?.name} over ssh. What you can do there is set by them, not by Grill Me.`);
    } catch (e) {
      toast(`Couldn't attach: ${e}`, "warn");
    } finally { setBusy(false); }
  };

  return (
    <div className="flex-1 min-h-0 flex">
      <div className="w-[230px] flex-none border-r border-line overflow-y-auto py-2">
        <div className="px-4 pb-1.5 text-[11px] tracking-[0.12em] uppercase text-faint font-semibold">Teammates</div>
        {people.map((p) => {
          const n = (byMember.get(p.id) ?? []).length;
          return (
            <button key={p.id}
              className={`w-full text-left flex items-center gap-2.5 px-4 h-9 cursor-pointer transition-colors ${
                p.id === chosen?.id ? "bg-raised text-ink" : "text-dim hover:text-ink hover:bg-raised/60"}`}
              onClick={() => setPick(p.id)}>
              <span className="min-w-0 flex-1 truncate text-[13px]">{p.name}{p.id === selfId ? " (you)" : ""}</span>
              {n ? <span className="text-[11px] text-faint num">{n}</span> : null}
            </button>
          );
        })}
        {people.length === 0 ? <div className="px-4 py-2 text-[12px] text-faint">Nobody yet.</div> : null}
      </div>

      <div className="flex-1 min-w-0 overflow-y-auto">
        <div className="max-w-[720px] mx-auto px-6 py-5 flex flex-col gap-3">
          <div className="flex items-center gap-2.5">
            <h2 className="text-[16px] font-semibold text-ink">{chosen?.name ?? "Teammates"}</h2>
            <span className="flex-1" />
            {canAttach ? (
              <button className="btn" disabled={busy} title={`Start or rejoin tmux session "${cfg?.tmuxSession}" on ${cfg?.remote} over ssh. Joins it only if it is already running there.`}
                onClick={() => void attach()}>
                {busy ? "Attaching…" : "Open their tmux session"}
              </button>
            ) : null}
          </div>

          {rows.length === 0 ? (
            <div className="text-[12.5px] text-faint">
              {mine ? "You have no sessions running." : `${chosen?.name ?? "They"} hasn't published a session yet.`}
            </div>
          ) : rows.map((d) => (
            <SessionRow key={d.id} d={d} on={d.session === peeked?.session}
              onPick={() => setPeek(d.session)} onOpen={mine ? () => open(d) : undefined} />
          ))}

          {peeked && mine ? <ShareAccess sessionId={peeked.session} /> : null}
          {peeked && mine ? (
            <div className="hairline rounded-lg overflow-hidden">
              <div className="px-3 py-1.5 border-b border-line text-[11px] tracking-[0.12em] uppercase text-faint">
                {peeked.title} — last output
              </div>
              {tail.length ? (
                <pre className="px-3 py-2 text-[11.5px] leading-[1.45] font-mono text-dim whitespace-pre-wrap break-words max-h-[320px] overflow-y-auto">
                  {tail.map((l) => l.text).join("\n")}
                </pre>
              ) : (
                <div className="px-3 py-2 text-[12px] text-faint">Nothing on screen yet.</div>
              )}
            </div>
          ) : null}

          {!mine && rows.length > 0 ? (
            <div className="hairline rounded-lg p-3 flex flex-col gap-2">
              <div className="text-[12px] text-ink">Connect to {chosen?.name}'s Mac</div>
              <div className="text-[11.5px] text-faint leading-snug">
                Their Tailscale name or <span className="font-mono">user@host</span> on your Wi-Fi.
                They decide what you can do once you are there — Grill Me only makes the connection.
              </div>
              <input className="input" spellCheck={false} placeholder="aryan@macbook.local"
                value={host}
                onChange={(e) => setAppSetting("teammateHosts", { ...hosts, [chosen?.id ?? ""]: e.target.value })} />
              {host && !looksLikeSshHost(host) ? (
                <div className="text-[11.5px] text-warn">
                  That isn't a plain ssh destination. Letters, digits and <span className="font-mono">@ . _ -</span> only,
                  and it can't start with a dash — ssh would read that as an option.
                </div>
              ) : null}
              {canAttach ? (
                <div className="text-[11.5px] text-faint">
                  Opens <span className="font-mono">{tmuxName(peeked!.session)}</span> on their Mac.
                  If you land at a shell prompt instead of their session, they haven't added the
                  key line yet. If you see an empty terminal, their session isn't running in tmux.
                </div>
              ) : null}
            </div>
          ) : null}
          {!mine && !canAttach && rows.length > 0 ? (
            <div className="hairline rounded-lg px-3 py-2.5 text-[12px] text-dim">
              You're seeing what {chosen?.name} publishes — title, branch, status, files — not their
              terminal. Nothing of their output crosses the room.
              {" "}Joining the session they're in needs it to have been started inside tmux on their
              Mac, plus ssh access. A session they started themselves cannot be joined after the
              fact: there is no tmux session to attach to.
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
