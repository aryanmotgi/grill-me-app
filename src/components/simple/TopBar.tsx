import { useEffect, useState } from "react";
import { ptyIdFor, useApp } from "../../store";
import { useBridge } from "../BridgePanel";
import { pendingCount } from "../../lib/bridge";
import { Icon } from "../Icon";
import { sessionTitle } from "../../lib/sessionTitle";
import { sessionSentence } from "../../lib/sessionSentence";
import { kTokens, money, sessionStats } from "../../lib/coach";
import { submitToAgent } from "../../lib/ptyReady";
import { useTests } from "../../lib/testsStore";
import type { Teammate } from "../../types";
import { useActivity } from "../../lib/activity";
import { useMergeSessions } from "../../lib/mergeSessions";
import { span } from "../../lib/limits";

// ---------------------------------------------------------------------------
// Simple layout, top of the middle column. The left half is the session's
// name and one plain sentence of where it is, and it's all window-drag
// space (data-drag-zone; see hooks/useWindowDrag). The right holds the few
// things worth one click: what it cost, whether the tests pass, undo, the
// Peek panel, and Review & ship. The team goal shows only when there is one
// or you're in a team.
// ---------------------------------------------------------------------------

const native = () => "__TAURI_INTERNALS__" in window;

function Chip({ children, title, onClick, tone, on }: {
  children: React.ReactNode; title: string; onClick?: () => void; tone?: "ok" | "warn" | "danger"; on?: boolean;
}) {
  const color = tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : tone === "danger" ? "text-danger" : on ? "text-ink" : "text-dim";
  const cls = `topbar-chip ${color} ${on ? "on" : ""}`;
  return onClick
    ? <button className={cls} title={title} onClick={onClick}>{children}</button>
    : <span className={cls} title={title}>{children}</span>;
}


function CostChip({ mate }: { mate: Teammate }) {
  const st = sessionStats(mate);
  const toast = useApp((s) => s.toast);
  if (!st) return null;
  if (st.heavy) {
    return (
      <Chip tone="warn" title={`Spent about ${money(st.cost)}. Each message now re-reads ~${kTokens(st.perTurn)} tokens (${money(st.nextMsg)}). Click to compact: it keeps the gist and every message gets cheaper.`}
        onClick={() => void submitToAgent(ptyIdFor(mate.id), "/compact").then(() => toast("Compacting this session"), (e) => toast(`Couldn't compact: ${e}`, "warn"))}>
        {money(st.cost)} · compact
      </Chip>
    );
  }
  return <Chip title={`Spent about ${money(st.cost)} over ${st.turns} messages (estimate at list prices). Each message re-reads ~${kTokens(st.perTurn)} tokens.`}>{money(st.cost)}</Chip>;
}

/** Background Claude calls Grill Me made on your behalf (checks, reviews,
 *  drafts). They run on Haiku with no tools and never appear in the session's
 *  own token counts, so without this they are spend you cannot see. It sits
 *  next to the cost chip because that is the number it is missing from. */
function useBgCalls(): number | null {
  const [n, setN] = useState<number | null>(null);
  useEffect(() => {
    if (!native()) return;
    let live = true;
    const read = async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      const v = await invoke<number>("bg_call_count").catch(() => null);
      if (live && typeof v === "number") setN(v);
    };
    void read();
    const t = setInterval(() => void read(), 10_000);
    return () => { live = false; clearInterval(t); };
  }, []);
  return n;
}

function BgChip() {
  const bg = useBgCalls();
  if (bg === null || bg === 0) return null;
  return (
    <Chip title={`Grill Me made ${bg} background Claude ${bg === 1 ? "call" : "calls"} for you since launch — checks, reviews and drafts. They run on Haiku with no tools, and are not counted in the session spend to the left.`}>
      <Icon name="bolt" size={11} /> {bg}
    </Chip>
  );
}



/** The quiet list: what Grill Me noticed on its own, with a count. Never pops up. */
function ActivityBell() {
  const items = useActivity((a) => a.items);
  const readAll = useActivity((a) => a.readAll);
  const clear = useActivity((a) => a.clear);
  const [open, setOpen] = useState(false);
  const unread = items.filter((x) => !x.read).length;
  const toggle = () => { if (!open) readAll(); setOpen(!open); };
  return (
    <span className="relative" data-no-drag>
      <button className={`topbar-chip ${unread ? "text-ink" : "text-dim"} ${open ? "on" : ""}`} onClick={toggle}
        title="Activity: what Grill Me noticed in the background" aria-label={`Activity${unread ? `, ${unread} new` : ""}`}>
        <Icon name="bell" size={12} />{unread ? <span className="num text-accent">{unread}</span> : null}
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="composer-menu absolute right-0 top-full mt-1.5 z-40 w-[360px] max-h-[420px] overflow-y-auto rounded-xl p-1.5 rise">
            <div className="flex items-center px-2.5 pt-1.5 pb-1">
              <span className="text-[10.5px] tracking-[0.12em] text-faint uppercase flex-1">Activity</span>
              {items.length ? <button className="text-[11.5px] text-dim hover:text-ink cursor-pointer" onClick={clear}>Clear</button> : null}
            </div>
            {items.length === 0 ? <div className="px-2.5 py-3 text-[12px] text-faint">Nothing yet. Things Grill Me notices in the background show up here instead of popping up.</div> : null}
            {items.map((x) => (
              <div key={x.id} className="flex items-start gap-2 px-2.5 py-2 rounded-lg hover:bg-raised">
                <span className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-none ${x.tone === "warn" ? "bg-warn" : "bg-line"}`} aria-hidden />
                <span className="flex-1 min-w-0 text-[12px] text-dim leading-snug select-text">
                  {x.text}{x.count > 1 ? <span className="text-faint"> ×{x.count}</span> : null}
                  {x.action === "merge-sessions" ? (
                    <button className="block mt-1 text-[11.5px] text-accent hover:underline cursor-pointer"
                      onClick={() => { setOpen(false); useMergeSessions.getState().setOpen(true); }}>
                      Merge now →
                    </button>
                  ) : null}
                </span>
                <span className="text-[10.5px] text-faint flex-none num">{span((Date.now() - x.at) / 60_000)}</span>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </span>
  );
}

export function TopBar({ active }: { active: Teammate | undefined }) {
  const view = useApp((s) => s.view);
  const titles = useApp((s) => s.appSettings.sessionTitles);
  const testsOk = useTests((t) => (active && t.results[active.id] && !t.results[active.id].running ? t.results[active.id].ok : null));
  const waiting = useBridge((b) => pendingCount(b.state));
  const bridgeOpen = useBridge((b) => b.open);
  const setBridgeOpen = useBridge((b) => b.setOpen);
  const onSession = view === "session" && !!active;
  const sentence = active ? sessionSentence(active, testsOk) : null;
  const PAGE: Record<string, string> = { home: "Overview", brain: "Brain", flow: "Flow", dna: "Coding DNA", automations: "Automations", new: "New session", preview: "Preview", tasks: "Tasks", inbox: "Inbox", feed: "Activity", team: "Team" };

  return (
    <div data-drag-zone data-tauri-drag-region className="h-12 flex-none border-b border-line flex items-center gap-2 pl-4 pr-2 select-none">
      <div className="flex-1 min-w-0 flex items-baseline gap-2.5">
        <span className="text-[13.5px] font-semibold text-ink truncate max-w-[45%]">
          {onSession ? sessionTitle(active!, titles) : PAGE[view] ?? "Grill Me"}
        </span>
        {onSession && sentence ? (
          <span className={`text-[12px] truncate ${sentence.tone === "needs" ? "text-warn" : sentence.tone === "working" ? "text-dim" : sentence.tone === "done" ? "text-ok" : "text-faint"}`}>
            {sentence.text}
          </span>
        ) : null}
      </div>
      {onSession ? (
        <>
          <CostChip mate={active!} />
          <BgChip />
        </>
      ) : null}
      {waiting ? (
        <Chip tone="warn" on={bridgeOpen} title="The Bridge: plans, hand-offs and questions waiting for your OK" onClick={() => setBridgeOpen(!bridgeOpen)}>
          <Icon name="swap" size={11} /> {waiting} waiting
        </Chip>
      ) : null}
      <ActivityBell />
    </div>
  );
}
