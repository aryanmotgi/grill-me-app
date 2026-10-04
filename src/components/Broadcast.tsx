import { useMemo, useState } from "react";
import { useModalA11y } from "../hooks/useModalA11y";
import { ptyIdFor, useApp } from "../store";
import { Icon } from "./Icon";
import { isTauri } from "../data/sources/git";
import { classifyBroadcastTargets } from "../lib/broadcast";
import { submitToAgent, deliverBriefWhenReady } from "../lib/ptyReady";

type Outcome = "delivered" | "failed" | "skipped";
interface Result {
  id: string;
  name: string;
  outcome: Outcome;
  detail?: string;
}

/**
 * Command fan-out: type one prompt/command and send it — plus a trailing
 * newline, so it lands at the prompt — into every selected session at once via
 * pty_write. View-only sessions are skipped (pty_write enforces this on the
 * backend; we pre-flight with classifyBroadcastTargets so they show as
 * "skipped" rather than erroring). An optional "wait for ready" toggle reuses
 * deliverBriefWhenReady so the text arrives at an idle claude prompt instead of
 * mid-generation. Per-session delivered / failed / skipped is shown after send.
 */
export function Broadcast() {
  const open = useApp((s) => s.broadcastOpen);
  const members = useApp((s) => s.members);
  const toast = useApp((s) => s.toast);
  const sendMessage = useApp((s) => s.sendMessage);
  // live room? terminal fan-out only reaches LOCAL sessions — offer to also
  // post to the team inbox, which syncs to remote teammates' machines.
  const liveRoom = useApp((s) => s.room?.phase === "done");
  const modalA11y = useModalA11y("Broadcast to all sessions", open);

  const [text, setText] = useState("");
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [waitReady, setWaitReady] = useState(false);
  const [toInbox, setToInbox] = useState(true);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Result[] | null>(null);

  // classify once per member list; default selection = every member
  const targets = useMemo(() => classifyBroadcastTargets(members), [members]);
  const sel = selected ?? new Set(targets.map((t) => t.id));

  if (!open) return null;
  const close = () => useApp.setState({ broadcastOpen: false });

  const toggle = (id: string) => {
    const next = new Set(sel);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };
  const setAll = (on: boolean) => setSelected(on ? new Set(targets.map((t) => t.id)) : new Set());

  const selectedWritable = targets.filter((t) => sel.has(t.id) && t.writable);
  const selectedSkipped = targets.filter((t) => sel.has(t.id) && !t.writable);
  // sendable if there's at least one local target OR we're posting to the
  // team inbox (so a broadcast still works with no local writable sessions)
  const canSend =
    text.trim().length > 0 && !busy && (selectedWritable.length > 0 || (liveRoom && toInbox));

  const send = async () => {
    if (!isTauri()) {
      toast("Broadcast needs the native app to write into sessions", "warn");
      return;
    }
    setBusy(true);
    setResults(null);
    // submitToAgent presses a real Enter after the text
    const data = text;
    const out: Result[] = selectedSkipped.map((t) => ({
      id: t.id,
      name: t.name,
      outcome: "skipped" as const,
      detail: "view-only — input blocked",
    }));

    for (const t of selectedWritable) {
      const ptyId = ptyIdFor(t.id);
      try {
        if (waitReady) {
          const delivered = await deliverBriefWhenReady(ptyId, data);
          out.push(
            delivered
              ? { id: t.id, name: t.name, outcome: "delivered" }
              : { id: t.id, name: t.name, outcome: "failed", detail: "never became ready" },
          );
        } else {
          await submitToAgent(ptyId, data);
          out.push({ id: t.id, name: t.name, outcome: "delivered" });
        }
      } catch (e) {
        out.push({ id: t.id, name: t.name, outcome: "failed", detail: String(e) });
      }
    }

    // cross-machine reach: also drop it in the team inbox (syncs to remote
    // teammates) so a broadcast isn't limited to locally-spawned sessions.
    if (liveRoom && toInbox) {
      sendMessage("all", text.trim(), "fyi");
    }

    setResults(out);
    const delivered = out.filter((r) => r.outcome === "delivered").length;
    const failed = out.filter((r) => r.outcome === "failed").length;
    const skipped = out.filter((r) => r.outcome === "skipped").length;
    toast(
      `Broadcast: ${delivered} delivered${failed ? `, ${failed} failed` : ""}${skipped ? `, ${skipped} skipped` : ""}${liveRoom && toInbox ? " · posted to team inbox" : ""}`,
      failed ? "warn" : "info",
    );
    setBusy(false);
  };

  const dot = (o: Outcome) =>
    o === "delivered" ? "bg-data" : o === "failed" ? "bg-warn" : "bg-line";

  return (
    <div className="fixed inset-0 z-40 scrim flex items-start justify-center pt-[8vh]" onClick={close}>
      <div {...modalA11y}
        className="w-[560px] max-w-[94vw] max-h-[84vh] flex flex-col glass rounded-md shadow-2xl rise p-6 outline-none"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-baseline gap-3 mb-4">
          <span className="font-display font-bold text-[15px]">BROADCAST</span>
          <span className="text-faint text-[10px]">one prompt or command → every selected session</span>
          <button className="btn ml-auto" onClick={close}>close</button>
        </div>

        <textarea
          className="w-full h-24 bg-raised hairline rounded-sm p-2 text-[12px] font-mono resize-none outline-none focus:border-accent mb-3"
          placeholder="broadcast to all sessions — e.g. run the tests and report back, or /clear"
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoFocus
        />

        {/* member multiselect */}
        <div className="flex items-center gap-2 mb-1.5">
          <span className="panel-label">sessions</span>
          <span className="flex-1" />
          <button className="btn" onClick={() => setAll(true)}>all</button>
          <button className="btn" onClick={() => setAll(false)}>none</button>
        </div>
        <div className="flex flex-col gap-1 mb-3 max-h-40 overflow-y-auto">
          {targets.length === 0 ? (
            <div className="text-faint text-[11px] py-2">No sessions configured.</div>
          ) : targets.map((t) => (
            <label key={t.id}
              className={`flex items-center gap-2 px-2 py-1 rounded-sm cursor-pointer hover:bg-raised ${sel.has(t.id) ? "" : "opacity-60"}`}>
              <input type="checkbox" checked={sel.has(t.id)} onChange={() => toggle(t.id)} className="accent-[var(--data)]" />
              <span className="text-[12px] font-semibold">{t.name}</span>
              {t.writable ? null : (
                <span className="ml-auto text-faint text-[9px] font-mono flex items-center gap-1">
                  <Icon name="lock" size={9} /> view-only
                </span>
              )}
            </label>
          ))}
        </div>

        <label className="flex items-center gap-2 mb-2 text-[11px] text-dim cursor-pointer">
          <input type="checkbox" checked={waitReady} onChange={(e) => setWaitReady(e.target.checked)} className="accent-[var(--data)]" />
          wait for each session to reach an idle prompt (up to 30s), then deliver
        </label>
        {liveRoom ? (
          <label className="flex items-center gap-2 mb-4 text-[11px] text-dim cursor-pointer">
            <input type="checkbox" checked={toInbox} onChange={(e) => setToInbox(e.target.checked)} className="accent-[var(--data)]" />
            also post to the team inbox — reaches remote teammates (terminal fan-out is local only)
          </label>
        ) : null}

        <div className="flex items-center gap-2">
          <button className="btn primary" disabled={!canSend} onClick={send}>
            {busy ? "sending…" : `send to ${selectedWritable.length} session${selectedWritable.length === 1 ? "" : "s"}`}
          </button>
          {busy ? <span className="spinner" aria-label="sending" /> : null}
          {selectedSkipped.length > 0 && !busy ? (
            <span className="text-faint text-[10px]">
              {selectedSkipped.length} view-only session{selectedSkipped.length === 1 ? "" : "s"} will be skipped
            </span>
          ) : null}
        </div>

        {/* per-session results */}
        {results ? (
          <div className="mt-4 flex flex-col gap-1 overflow-y-auto">
            <div className="panel-label mb-1">result</div>
            {results.map((r) => (
              <div key={r.id} className="flex items-center gap-2 text-[11px] py-0.5">
                <span className={`inline-block w-1.5 h-1.5 rounded-full ${dot(r.outcome)}`} />
                <span className="font-semibold">{r.name}</span>
                <span className={`font-mono text-[10px] ${r.outcome === "failed" ? "text-warn" : r.outcome === "delivered" ? "text-data" : "text-faint"}`}>
                  {r.outcome}
                </span>
                {r.detail ? <span className="text-faint text-[10px] truncate">— {r.detail}</span> : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
