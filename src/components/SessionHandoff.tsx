import { useCallback, useEffect, useState } from "react";
import { useModalA11y } from "../hooks/useModalA11y";
import { ptyIdFor, useApp } from "../store";
import { isTauri } from "../data/sources/git";
import { deliverBriefWhenReady } from "../lib/ptyReady";
import { Icon } from "./Icon";

type Status = "loading" | "ready" | "error";

/**
 * One-click session handoff: summarize the source session's recent output into
 * a "here's where I am / what's next" note (Rust `summarize_session` → claude
 * -p), pick a teammate, preview/edit, then deliver it as a structured inbox
 * message (sendMessage → messages.json) and, optionally, straight into the
 * teammate's live session brief (deliverBriefWhenReady).
 */
export function SessionHandoff() {
  const handoffFor = useApp((s) => s.handoffFor);
  const setHandoffFor = useApp((s) => s.setHandoffFor);
  const teammates = useApp((s) => s.teammates);
  const sendMessage = useApp((s) => s.sendMessage);
  const claudeMissing = useApp((s) => s.claudeMissing);
  const toast = useApp((s) => s.toast);

  const source = teammates.find((t) => t.id === handoffFor);
  const targets = teammates.filter((t) => t.id !== handoffFor);
  const modalA11y = useModalA11y("Session handoff", Boolean(handoffFor));

  const [status, setStatus] = useState<Status>("loading");
  const [summary, setSummary] = useState("");
  const [error, setError] = useState("");
  const [target, setTarget] = useState<string>("");
  const [alsoBrief, setAlsoBrief] = useState(true);
  const [sending, setSending] = useState(false);

  const branch = source?.branch ?? "—";
  const task = source?.taskLabel ?? "";

  const generate = useCallback(async () => {
    if (!handoffFor) return;
    if (!isTauri()) {
      setStatus("error");
      setError("handoff needs the native app — run npm run tauri dev");
      return;
    }
    setStatus("loading");
    setError("");
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const text = await invoke<string>("summarize_session", {
        ptyId: ptyIdFor(handoffFor),
        branch,
        task,
      });
      setSummary(text);
      setStatus("ready");
    } catch (e) {
      setStatus("error");
      setError(String(e));
    }
  }, [handoffFor, branch, task]);

  // (Re)generate + reset the picker each time the modal opens for a session.
  useEffect(() => {
    if (!handoffFor) return;
    setSummary("");
    setAlsoBrief(true);
    setTarget(teammates.find((t) => t.id !== handoffFor)?.id ?? "");
    void generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handoffFor]);

  if (!handoffFor || !source) return null;

  const close = () => setHandoffFor(null);

  const send = async () => {
    if (!target || !summary.trim() || sending) return;
    setSending(true);
    try {
      const targetMate = teammates.find((t) => t.id === target);
      // Structured inbox message — reuses sendMessage → shared_upsert(messages.json).
      const body = `Session handoff — ${source.name}'s work on \`${branch}\`\n\n${summary.trim()}`;
      sendMessage(target, body, "fyi");

      // Optional: drop a single-line pickup brief into their live session so
      // claude sees it at its next idle prompt. Collapse the markdown to one
      // submittable line (embedded newlines would submit line-by-line).
      let brief = false;
      if (alsoBrief && isTauri()) {
        const oneLine = summary
          .replace(/\s*\n+\s*/g, " · ")
          .replace(/#+\s*/g, "")
          .trim();
        const line = `You're picking up ${source.name}'s handoff on ${branch}. Context: ${oneLine}\n`;
        brief = await deliverBriefWhenReady(ptyIdFor(target), line);
      }

      toast(
        brief
          ? `Handoff sent to ${targetMate?.name ?? target} — also dropped into their session`
          : `Handoff queued for ${targetMate?.name ?? target} — delivered at next check-in`,
      );
      close();
    } catch (e) {
      toast(`Handoff failed: ${e}`, "warn");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 scrim flex items-start justify-center pt-[6vh]" onClick={close}>
      <div
        {...modalA11y}
        className="w-[620px] max-h-[86vh] glass rounded-md shadow-2xl rise flex flex-col overflow-hidden outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-line">
          <span className="font-display font-bold text-[14px]">SESSION HANDOFF</span>
          <span className="text-dim text-[11px]">{source.name}</span>
          <span className="font-mono text-faint text-[10px]">
            <Icon name="branch" size={10} /> {branch}
          </span>
          <span className="flex-1" />
          <button className="btn" onClick={close}>
            cancel
          </button>
          <button
            className="btn primary"
            disabled={sending || status !== "ready" || !target || !summary.trim()}
            onClick={send}
            title={
              status !== "ready"
                ? "wait for the summary"
                : !target
                  ? "pick a teammate"
                  : "Send as an inbox message (and optionally into their session)"
            }
          >
            {sending ? "sending…" : "send handoff"}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
          {/* ---- teammate picker ---- */}
          <div>
            <div className="panel-label mb-2">hand off to</div>
            {targets.length === 0 ? (
              <div className="text-faint text-[11px]">
                No other sessions to hand off to — add a teammate first.
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                {targets.map((t) => (
                  <label
                    key={t.id}
                    className={`flex items-center gap-2.5 px-2.5 py-2 rounded-sm cursor-pointer text-[12px] border ${
                      target === t.id
                        ? "border-accent/60 bg-accent/[0.06]"
                        : "border-line/50 hover:bg-raised"
                    }`}
                  >
                    <input
                      type="radio"
                      name="handoff-target"
                      className="accent-accent"
                      checked={target === t.id}
                      onChange={() => setTarget(t.id)}
                    />
                    <span className={`status-dot ${t.status}`} />
                    <span className="font-display font-semibold">{t.name}</span>
                    <span className="font-mono text-faint text-[10px]">
                      <Icon name="branch" size={10} /> {t.branch}
                    </span>
                    <span className="flex-1" />
                    <span className="text-dim text-[11px] truncate max-w-[180px]">{t.taskLabel}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* ---- generated summary ---- */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="panel-label">handoff summary</span>
              {status === "ready" ? (
                <span className="text-faint text-[10px]">Claude · editable before send</span>
              ) : null}
              <span className="flex-1" />
              <button
                className="btn"
                disabled={status === "loading"}
                onClick={() => void generate()}
                title="Re-summarize from the latest session output"
              >
                {status === "loading" ? "generating…" : "regenerate"}
              </button>
            </div>

            {status === "loading" ? (
              <div className="text-faint text-[11px] py-8 text-center">
                Reading the session and summarizing…
              </div>
            ) : status === "error" ? (
              <div className="rounded-sm border border-accent/40 bg-accent/[0.06] p-3 text-[11px] leading-relaxed">
                <div className="text-accent font-semibold mb-1">couldn't generate the handoff</div>
                <div className="text-dim font-mono text-[10px] whitespace-pre-wrap">{error}</div>
                {claudeMissing ? (
                  <div className="text-faint mt-2">
                    claude CLI wasn't found on PATH — install it, then hit regenerate.
                  </div>
                ) : null}
              </div>
            ) : (
              <textarea
                className="w-full h-56 bg-term-bg text-term-ink hairline rounded-sm p-3 font-mono text-[11px] leading-relaxed outline-none resize-none"
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
              />
            )}
          </div>

          {/* ---- delivery option ---- */}
          <label className="flex items-center gap-2 text-[11px] text-dim cursor-pointer">
            <input
              type="checkbox"
              className="accent-accent"
              checked={alsoBrief}
              onChange={(e) => setAlsoBrief(e.target.checked)}
            />
            Also drop a one-line pickup brief into their live session when it's ready
          </label>
        </div>
      </div>
    </div>
  );
}
