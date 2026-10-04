import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PillAction, PillPrefs, PillSession, PillState } from "../lib/pill";
import { focusLeft } from "../lib/pill";
import { fuzzyRank } from "../lib/fuzzy";

// ---------------------------------------------------------------------------
// The floating pill: a slim vertical rail docked to a screen edge (left by
// default), with everything else opening beside it.
//   rail       status glow; one chip per session (its letters, a turning
//              arc while it works, a badge when it needs you), sessions
//              outside Grill Me, MVP ring, plan-limit ring, quiet inbox
//              count, search, focus hour, and the ••• menu. Nothing going
//              on: it shrinks to a faint ember dot.
//   peek       hover a chip: what it's doing or asking, its context fill,
//              and Yes-trust-it / Answer / Open / Message / Pin
//   beside it  sessions panel (click the glow): pin, open, context fill,
//              teammates, limits, today's spend, running apps, undo, a
//              message box. Command bar (⌃⌥K from any app). Settings menu
//              with a Look & sound submenu (theme, pill size, text size,
//              edge or floating). Cards: away recap, next step, file drop.
// State comes from the main window (lib/pillBridge.ts); actions go back.
// ---------------------------------------------------------------------------

type Panel = null | "sessions" | "command" | "settings";
type Edge = "right" | "left" | "free";

const native = () => "__TAURI_INTERNALS__" in window;

async function send(action: PillAction) {
  if (!native()) { console.log("pill action", action); return; }
  const { emitTo } = await import("@tauri-apps/api/event");
  await emitTo("main", "pill-action", action);
}

async function invoke(cmd: string, args?: Record<string, unknown>) {
  if (!native()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke(cmd, args).catch(() => {});
}

/** A soft two-note chime, made on the spot (no sound files). */
function chime() {
  const ctx = new AudioContext();
  const now = ctx.currentTime;
  [659.25, 987.77].forEach((f, i) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = f;
    g.gain.setValueAtTime(0, now + i * 0.12);
    g.gain.linearRampToValueAtTime(0.06, now + i * 0.12 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.12 + 0.9);
    o.connect(g).connect(ctx.destination);
    o.start(now + i * 0.12);
    o.stop(now + i * 0.12 + 1);
  });
  setTimeout(() => void ctx.close(), 1500);
}

const money = (usd: number) => (usd < 0.01 ? "<$0.01" : usd < 10 ? `$${usd.toFixed(2)}` : `$${Math.round(usd)}`);

function Ring({ value, size = 18, stroke = 2, tone = "ember", title }: { value: number; size?: number; stroke?: number; tone?: string; title?: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} className={`ring ${tone}`} aria-label={title}>
      <title>{title}</title>
      <circle cx={size / 2} cy={size / 2} r={r} className="ring-track" strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} className="ring-fill" strokeWidth={stroke}
        strokeDasharray={`${c * Math.max(0, Math.min(1, value))} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
    </svg>
  );
}

const ICONS: Record<string, string> = {
  pin: "M9.5 2.5 13.5 6.5 11 7.5 8.5 10l.5 3-6-6 3 .5L8.5 5Z M5.5 10.5 2.5 13.5",
  open: "M6 3H3v10h10v-3 M9 3h4v4 M13 3 7.5 8.5",
  undo: "M5 4 2.5 6.5 5 9 M2.5 6.5H10a3.5 3.5 0 0 1 0 7H7",
  moon: "M13 9.5A5.5 5.5 0 1 1 6.5 3a4.5 4.5 0 0 0 6.5 6.5Z",
  close: "M4 4l8 8M12 4l-8 8",
  send: "M3 8h9 M8.5 4.5 12 8l-3.5 3.5",
  mic: "M8 2.5a2 2 0 0 1 2 2V8a2 2 0 0 1-4 0V4.5a2 2 0 0 1 2-2Z M4.5 7.5a3.5 3.5 0 0 0 7 0 M8 11v2.5",
  sound: "M3 6.5h2L8 4v8L5 9.5H3Z M10.5 6a2.5 2.5 0 0 1 0 4",
  voice: "M2.5 8h1 M5 6v4 M7.5 4v8 M10 5.5v5 M12.5 7v2",
  app: "M2.5 3.5h11v9h-11Z M2.5 6h11",
  search: "M7 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z M10.5 10.5 14 14",
  more: "M4 8h.01 M8 8h.01 M12 8h.01",
  palette: "M8 2.5a5.5 5.5 0 1 0 0 11c.8 0 1.2-.6 1-1.3-.3-1 .3-1.7 1.3-1.7H12a1.5 1.5 0 0 0 1.5-1.5A5.5 5.5 0 0 0 8 2.5Z M5 7.5h.01 M7 5h.01 M10 5.5h.01",
  keys: "M2 4.5h12v7H2Z M4.5 7h.01 M7 7h.01 M9.5 7h.01 M5 9.5h6",
  hide: "M2 2l12 12 M6.5 6.6a2 2 0 0 0 2.9 2.8 M4 4.5C2.5 5.7 1.5 8 1.5 8S4 12.5 8 12.5c1.3 0 2.4-.4 3.4-1 M7 3.6c.3 0 .7-.1 1-.1 4 0 6.5 4.5 6.5 4.5s-.6 1.1-1.7 2.3",
  chevron: "M6 3.5 10.5 8 6 12.5",
};

function Ico({ name, size = 14 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={ICONS[name]} />
    </svg>
  );
}

function headline(s: PillState): string {
  const needs = s.sessions.find((x) => x.status === "needs-input");
  if (needs) return `${needs.title} needs you`;
  const outsideNeeds = s.outside.find((x) => x.status === "needs");
  if (outsideNeeds) return `${outsideNeeds.folder} needs you`;
  if (s.glow === "stuck") return `${s.sessions.find((x) => x.stuck)?.title ?? "A session"} looks stuck`;
  const working = s.sessions.filter((x) => x.status === "working").length + s.outside.filter((x) => x.status === "working").length;
  if (working) return `${working} working`;
  if (s.glow === "done") return "All done";
  return s.project;
}

const toneOf = (x: PillSession) => (x.status === "needs-input" ? "needs" : x.stuck ? "stuck" : x.status === "working" ? "working" : "idle");

export function Pill() {
  const [st, setSt] = useState<PillState | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [sub, setSub] = useState<"look" | null>(null);
  const [edge, setEdge] = useState<Edge>("left");
  const [hover, setHover] = useState(false);
  const [near, setNear] = useState(false);
  const [peek, setPeek] = useState<PillSession | null>(null);
  const [peekAt, setPeekAt] = useState(0);
  const peekTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showPeek = (x: PillSession, el: HTMLElement) => {
    if (peekTimer.current) clearTimeout(peekTimer.current);
    setPeekAt(el.getBoundingClientRect().top + el.offsetHeight / 2);
    setPeek(x);
  };
  const hidePeek = () => {
    if (peekTimer.current) clearTimeout(peekTimer.current);
    peekTimer.current = setTimeout(() => setPeek(null), 220);
  };
  const keepPeek = () => { if (peekTimer.current) clearTimeout(peekTimer.current); };
  const [drop, setDrop] = useState<string[] | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [sure, setSure] = useState(false);
  const [query, setQuery] = useState("");
  const [pick, setPick] = useState(0);
  const [msg, setMsg] = useState("");
  const [target, setTarget] = useState<string | null>(null);
  const [railH, setRailH] = useState<number | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const railInner = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const open = useCallback((p: Panel) => {
    setPanel(p);
    setSub(null);
    setQuery("");
    setPick(0);
    setSure(false);
    void invoke("pill_focus", { on: p === "command" });
    if (p === "command") setTimeout(() => input.current?.focus(), 60);
  }, []);
  const close = useCallback(() => open(null), [open]);
  const toggle = (p: Panel) => (panel === p ? close() : open(p));

  // state from the main window, and native events. In a plain browser (the
  // design preview) the state comes from a "pill-demo" event instead.
  useEffect(() => {
    if (!native()) {
      type Demo = { state: PillState; panel?: Panel; sub?: "look"; edge?: Edge; peek?: number };
      const demo = (e: Event) => {
        const d = (e as CustomEvent<Demo>).detail;
        setSt(d.state); if (d.panel) setPanel(d.panel); if (d.sub) setSub(d.sub); if (d.edge) setEdge(d.edge);
        if (d.peek !== undefined) { setPeek(d.state.sessions[d.peek]); setPeekAt(64 + d.peek * 34); }
      };
      window.addEventListener("pill-demo", demo);
      const early = (window as unknown as { __PILL_DEMO__?: Demo }).__PILL_DEMO__;
      if (early) demo(new CustomEvent("pill-demo", { detail: early }));
      return () => window.removeEventListener("pill-demo", demo);
    }
    const offs: (() => void)[] = [];
    void (async () => {
      const { listen, emitTo } = await import("@tauri-apps/api/event");
      offs.push(await listen<PillState>("pill-state", (e) => setSt(e.payload)));
      offs.push(await listen<{ edge: Edge }>("pill-place", (e) => setEdge(e.payload.edge)));
      offs.push(await listen<boolean>("pill-near", (e) => setNear(e.payload)));
      offs.push(await listen("pill-chime", () => chime()));
      offs.push(await listen<string>("pill-key", (e) => {
        if (e.payload === "command") open("command");
        else onKey.current(e.payload);
      }));
      const { getCurrentWebview } = await import("@tauri-apps/api/webview");
      offs.push(await getCurrentWebview().onDragDropEvent((e) => {
        if (e.payload.type === "over" || e.payload.type === "enter") setDragOver(true);
        else if (e.payload.type === "leave") setDragOver(false);
        else if (e.payload.type === "drop") { setDragOver(false); if (e.payload.paths.length) setDrop(e.payload.paths.slice(0, 12)); }
      }));
      await emitTo("main", "pill-ready", null);
    })();
    return () => offs.forEach((f) => f());
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  // theme, pill size and text size
  const prefs = st?.prefs;
  useEffect(() => {
    if (!prefs) return;
    const root = document.documentElement;
    if (prefs.theme === "auto") delete root.dataset.theme; else root.dataset.theme = prefs.theme;
    // text size: everything is sized in rem off this
    root.style.fontSize = `${16 * prefs.text}px`;
    // pill size: the page's own zoom, so clicks still land where things are drawn
    if (native()) void import("@tauri-apps/api/webview").then(({ getCurrentWebview }) => getCurrentWebview().setZoom(prefs.size)).catch(() => {});
    else root.style.zoom = String(prefs.size);
  }, [prefs]);

  // ⌃⌥Y / ⌃⌥O from any app: answer or open what's waiting on you
  const onKey = useRef<(k: string) => void>(() => {});
  onKey.current = (k) => {
    const waiting = st?.sessions.find((x) => x.status === "needs-input");
    if (!waiting) return;
    if (k === "yes" && waiting.trust) void send({ kind: "trust", sessionId: waiting.id });
    else void send({ kind: "open", sessionId: waiting.id });
  };

  const s = st;
  const cards = !!(s?.recap || s?.next || drop || peek);
  const quiet = !!s && s.glow === "idle" && !hover && !panel && !cards && !dragOver && !s.inbox;
  const fade = near && !hover && !panel && !dragOver;

  // the rail grows and shrinks on a spring: measure it, animate to it
  useLayoutEffect(() => {
    const el = railInner.current;
    if (!el) return;
    const measure = () => setRailH(el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [quiet, s?.sessions.length]);

  // tell the window where we draw, so clicks elsewhere reach the app behind
  useEffect(() => {
    if (!native()) return;
    let stop = false;
    const z = prefs?.size ?? 1;
    const report = () => {
      // page pixels × the page zoom = window points
      const rects = [...(stage.current?.querySelectorAll<HTMLElement>("[data-hit]") ?? [])].map((n) => {
        const r = n.getBoundingClientRect();
        return [(r.left - 4) * z, (r.top - 4) * z, (r.width + 8) * z, (r.height + 8) * z];
      });
      void invoke("pill_hit_rects", { rects });
    };
    // follow the spring for a moment after anything changes
    const t0 = performance.now();
    const loop = () => { if (stop) return; report(); if (performance.now() - t0 < 900) setTimeout(loop, 50); };
    loop();
    return () => { stop = true; };
  }, [railH, panel, sub, cards, quiet, edge, s?.sessions.length, prefs?.size, prefs?.text, peekAt]);

  const ranked = useMemo(() => {
    const list = s?.commands ?? [];
    return query.trim() ? fuzzyRank(list, query, (c) => [c.label, c.hint ?? ""]).map((r) => r.item) : list;
  }, [s?.commands, query]);

  if (!s) return <div ref={stage} className="stage" />;

  const setPrefs = (p: Partial<PillPrefs>) => {
    void send({ kind: "prefs", prefs: p });
    if (p.placement) void invoke("pill_placement", { floating: p.placement === "floating" });
  };
  const sessions = [...s.sessions].sort((a, b) => Number(b.pinned) - Number(a.pinned));
  const five = s.limits.find((l) => /5/.test(l.label)) ?? s.limits[0];
  const focusMin = focusLeft(s.focusUntil);
  const to = target ?? sessions.find((x) => x.status !== "working")?.id ?? sessions[0]?.id ?? null;

  /** drag the rail by its body; a click (no movement) does what was clicked */
  const dragStart = (e: React.MouseEvent) => {
    const x0 = e.screenX, y0 = e.screenY;
    const move = (m: MouseEvent) => {
      if (Math.abs(m.screenX - x0) + Math.abs(m.screenY - y0) > 4) {
        window.removeEventListener("mousemove", move);
        if (native()) void import("@tauri-apps/api/window").then(({ getCurrentWindow }) => getCurrentWindow().startDragging());
      }
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", () => window.removeEventListener("mousemove", move), { once: true });
  };

  const rail = (
    <div data-hit className={`rail ${quiet ? "quiet" : ""} ${fade ? "fade" : ""} ${dragOver ? "drop" : ""} glow-${s.glow}`}
      style={railH ? { height: railH } : undefined} onMouseDown={dragStart}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => { setHover(false); hidePeek(); }}>
      <div ref={railInner} className="rail-inner">
        <button className={`orb-btn ${panel === "sessions" ? "on" : ""}`} title={headline(s)} aria-label={headline(s)} onClick={() => toggle("sessions")}>
          <span className={`orb ${s.glow}`} />
        </button>
        {quiet ? null : (
          <>
            <div className="chips">
              {sessions.slice(0, 7).map((x) => (
                <button key={x.id} className={`chip-s ${toneOf(x)} ${x.pinned ? "pinned" : ""} ${peek?.id === x.id ? "on" : ""}`} aria-label={`${x.title}: ${x.peek}`}
                  onMouseEnter={(e) => showPeek(x, e.currentTarget)} onMouseLeave={hidePeek}
                  onClick={() => void send({ kind: "open", sessionId: x.id })}>
                  <span>{x.initials}</span>
                </button>
              ))}
              {sessions.length > 7 ? <button className="more-s" title={`${sessions.length - 7} more`} onClick={() => toggle("sessions")}>+{sessions.length - 7}</button> : null}
              {s.outside.slice(0, 3).map((o) => (
                <span key={o.id} className={`chip-s outside ${o.status}`} title={`${o.folder} (outside Grill Me) · ${o.status === "needs" ? "waiting on you" : o.status}${o.ask ? ` · ${o.ask}` : ""}`}>
                  <span>{o.folder.slice(0, 1).toUpperCase()}</span>
                </span>
              ))}
            </div>
            <span className="sep" />
            {s.mvp ? <Ring value={s.mvp.done / s.mvp.total} title={`MVP: ${s.mvp.done} of ${s.mvp.total} done`} /> : null}
            {five ? <Ring value={five.pct / 100} tone={five.pct >= 90 ? "hot" : five.pct >= 70 ? "warn" : "calm"} title={`${five.label} limit: ${Math.round(five.pct)}% used`} /> : null}
            {s.inbox ? <span className="inbox" title={`${s.inbox} quiet update${s.inbox === 1 ? "" : "s"} in Grill Me`}>{s.inbox}</span> : null}
            <span className="sep" />
            <button className={`rb ${panel === "command" ? "on" : ""}`} title="Search Grill Me (⌃⌥K)" onClick={() => toggle("command")}><Ico name="search" /></button>
            <button className={`rb ${focusMin ? "on" : ""}`} title={focusMin ? `Focus: ${focusMin} min left. Click to end` : "Focus for an hour"}
              onClick={() => void send({ kind: "focus", minutes: focusMin ? 0 : 60 })}><Ico name="moon" /></button>
            <button className={`rb ${panel === "settings" ? "on" : ""}`} title="Settings" onClick={() => toggle("settings")}><Ico name="more" /></button>
          </>
        )}
      </div>
    </div>
  );

  const sessionsPanel = (
    <div data-hit className="panel">
      <div className="panel-head"><span className={`orb ${s.glow}`} /><span className="title">{headline(s)}</span>{s.spend !== null ? <span className="num dim small" title="Today's Claude Code use, at API prices">{money(s.spend)} today</span> : null}</div>
      <section>
        {sessions.length ? sessions.map((x) => (
          <div key={x.id} className="row">
            <span className={`sdot ${toneOf(x)}`} />
            <span className="grow">
              <span className="title">{x.title}</span>
              <span className="sub">{x.peek}</span>
              {x.context !== null ? <span className={`bar ${x.context > 0.8 ? "hot" : x.context > 0.6 ? "warn" : ""}`} title={`Context ${Math.round(x.context * 100)}% full`}><i style={{ width: `${x.context * 100}%` }} /></span> : null}
            </span>
            <button className={`ib ${x.pinned ? "on" : ""}`} title={x.pinned ? "Unpin" : "Pin: always show its status"} onClick={() => void send({ kind: "pin", sessionId: x.id })}><Ico name="pin" size={13} /></button>
            <button className="ib" title="Open in Grill Me" onClick={() => void send({ kind: "open", sessionId: x.id })}><Ico name="open" size={13} /></button>
          </div>
        )) : <div className="sub">No sessions yet.</div>}
      </section>
      {s.outside.length ? (
        <section>
          <div className="label">Outside Grill Me</div>
          {s.outside.map((o) => (
            <div key={o.id} className="row">
              <span className={`sdot outside ${o.status}`} />
              <span className="grow"><span className="title">{o.folder}</span><span className="sub">{o.status === "needs" ? "Waiting on you · " : o.status === "working" ? "Working · " : ""}{o.ask || "Claude Code session"}</span></span>
            </div>
          ))}
        </section>
      ) : null}
      {s.team.length ? (
        <section>
          <div className="label">Team</div>
          <div className="team">{s.team.map((m) => <span key={m.name} className={`av ${m.status}`} title={`${m.name}: ${m.doing}`}>{m.initials}</span>)}</div>
        </section>
      ) : null}
      {s.limits.length ? (
        <section className="limits">
          {s.limits.map((l) => (
            <div key={l.label} className="lim"><span className="sub">{l.label}</span><span className={`bar ${l.pct >= 90 ? "hot" : l.pct >= 70 ? "warn" : ""}`}><i style={{ width: `${l.pct}%` }} /></span><span className="num">{Math.round(l.pct)}%</span></div>
          ))}
        </section>
      ) : null}
      <section className="actions">
        {s.apps.slice(0, 2).map((a) => (
          <button key={a.port} className="chip" onClick={() => void send({ kind: "next", sessionId: "", step: "open-app" })} title={a.url}><Ico name="app" size={12} /> Open {a.name} :{a.port}</button>
        ))}
        {s.undo ? (sure ? (
          <button className="chip warn" onClick={() => { setSure(false); void send({ kind: "undo", sessionId: s.undo!.sessionId }); }}>Sure? Undo {s.undo.title}</button>
        ) : (
          <button className="chip" onClick={() => setSure(true)} title={`Put ${s.undo.title}'s files back as they were before its last message`}><Ico name="undo" size={12} /> Undo last turn</button>
        )) : null}
      </section>
      {to ? (
        <section className="say">
          <div className="targets">
            {sessions.slice(0, 5).map((x) => <button key={x.id} className={`tchip ${x.id === to ? "on" : ""}`} onClick={() => setTarget(x.id)}>{x.title}</button>)}
          </div>
          <div className="msg">
            <input value={msg} placeholder="Message this session…" onFocus={() => void invoke("pill_focus", { on: true })} onBlur={() => void invoke("pill_focus", { on: false })} onChange={(e) => setMsg(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && msg.trim()) { void send({ kind: "send", sessionId: to, text: msg }); setMsg(""); } }} />
            <button className="ib" disabled={!msg.trim()} title="Send" onClick={() => { void send({ kind: "send", sessionId: to, text: msg }); setMsg(""); }}><Ico name="send" size={13} /></button>
          </div>
        </section>
      ) : null}
    </div>
  );

  const command = (
    <div data-hit className="panel command">
      <div className="msg">
        <Ico name="search" size={13} />
        <input ref={input} value={query} placeholder="Search Grill Me…" onChange={(e) => { setQuery(e.target.value); setPick(0); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setPick((p) => Math.min(p + 1, ranked.length - 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setPick((p) => Math.max(p - 1, 0)); }
            if (e.key === "Enter" && ranked[pick]) { void send({ kind: "command", id: ranked[pick].id }); close(); }
          }} />
      </div>
      <div className="results">
        {ranked.slice(0, 8).map((c, i) => (
          <button key={c.id} className={`res ${i === pick ? "on" : ""}`} onMouseEnter={() => setPick(i)} onClick={() => { void send({ kind: "command", id: c.id }); close(); }}>
            <span className="title">{c.label}</span>{c.hint ? <span className="sub">{c.hint}</span> : null}
          </button>
        ))}
        {!ranked.length ? <div className="sub pad">Nothing matches.</div> : null}
      </div>
    </div>
  );

  const settings = (
    <div data-hit className="panel menu">
      <div className="panel-head"><span className="title">Grill Me pill</span><span className="dim small">{s.project}</span></div>
      <button className={`item ${sub === "look" ? "on" : ""}`} onClick={() => setSub(sub === "look" ? null : "look")}>
        <Ico name="palette" /> <span className="grow">Look &amp; sound</span><span className="dim small">{s.prefs.theme === "auto" ? "Auto" : s.prefs.theme === "light" ? "Light" : "Dark"}</span><Ico name="chevron" size={11} />
      </button>
      <div className="item static" title="From any app: ⌃⌥P shows or hides the pill · ⌃⌥K search · ⌃⌥Y yes to “trust this folder?” · ⌃⌥O open what's waiting on you"><Ico name="keys" /> <span className="grow">Shortcuts</span><span className="dim small">⌃⌥ P K Y O</span></div>
      <span className="msep" />
      <button className="item" onClick={() => void send({ kind: "focus", minutes: focusMin ? 0 : 60 })}><Ico name="moon" /> <span className="grow">{focusMin ? `End focus (${focusMin} min left)` : "Focus for an hour"}</span></button>
      <button className="item" onClick={() => void send({ kind: "open", view: "home" })}><Ico name="open" /> <span className="grow">Open Grill Me</span></button>
      <button className="item" onClick={() => void send({ kind: "hide" })}><Ico name="hide" /> <span className="grow">Hide the pill</span><span className="dim small">⌃⌥P</span></button>
    </div>
  );

  const look = (
    <div data-hit className="panel menu look">
      <div className="panel-head"><span className="title">Look &amp; sound</span></div>
      <div className="label">Theme</div>
      <div className="seg">
        {(["auto", "light", "dark"] as const).map((t) => (
          <button key={t} className={`swatch ${t} ${s.prefs.theme === t ? "on" : ""}`} onClick={() => setPrefs({ theme: t })}><i />{t === "auto" ? "Auto" : t === "light" ? "Light" : "Dark"}</button>
        ))}
      </div>
      <div className="label">Pill</div>
      <label className="slider"><span>Pill size</span><input type="range" min={0.8} max={1.4} step={0.05} value={s.prefs.size} onChange={(e) => setPrefs({ size: Number(e.target.value) })} /><span className="num dim">{Math.round(s.prefs.size * 100)}%</span></label>
      <label className="slider"><span>Text size</span><input type="range" min={0.85} max={1.3} step={0.05} value={s.prefs.text} onChange={(e) => setPrefs({ text: Number(e.target.value) })} /><span className="num dim">{Math.round(s.prefs.text * 100)}%</span></label>
      <div className="slider"><span>Placement</span>
        <div className="seg small">
          <button className={s.prefs.placement === "edge" ? "on" : ""} onClick={() => setPrefs({ placement: "edge" })}>Edge</button>
          <button className={s.prefs.placement === "floating" ? "on" : ""} onClick={() => setPrefs({ placement: "floating" })}>Floating</button>
        </div>
      </div>
      <div className="label">Sound</div>
      <button className={`item toggle ${s.prefs.sound ? "on" : ""}`} onClick={() => setPrefs({ sound: !s.prefs.sound })}><Ico name="sound" /> <span className="grow">Sound when done</span><span className="sw" /></button>
      <button className={`item toggle ${s.prefs.voice ? "on" : ""}`} onClick={() => setPrefs({ voice: !s.prefs.voice })}><Ico name="voice" /> <span className="grow">Spoken updates</span><span className="sw" /></button>
      <button className="item toggle" disabled title="Hold a key and talk to your agent. Coming next; it asks for the microphone only when you turn it on."><Ico name="mic" /> <span className="grow">Hold to talk</span><span className="dim small">soon</span></button>
    </div>
  );

  return (
    <div ref={stage} className={`stage ${edge === "right" ? "right" : "left"}`}>
      {rail}
      <div className="side">
        {peek ? (
          <div data-hit className="card peek" style={{ top: Math.max(6, peekAt - 34) }} onMouseEnter={keepPeek} onMouseLeave={hidePeek}>
            <div className="peek-head"><span className={`sdot ${toneOf(peek)}`} /><span className="title">{peek.title}</span></div>
            <span className="sub wrap">{peek.trust ? "Asking whether to trust its folder" : peek.question ? <>Asks: <b className="q">{peek.question}</b></> : peek.peek}</span>
            {peek.context !== null ? <span className={`bar ${peek.context > 0.8 ? "hot" : peek.context > 0.6 ? "warn" : ""}`} title={`Context ${Math.round(peek.context * 100)}% full`}><i style={{ width: `${peek.context * 100}%` }} /></span> : null}
            <div className="targets">
              {peek.trust ? <button className="tchip go" title="⌃⌥Y from any app" onClick={() => { void send({ kind: "trust", sessionId: peek.id }); setPeek(null); }}>Yes, trust it</button> : null}
              {peek.status === "needs-input" && !peek.trust ? <button className="tchip go" title="⌃⌥O from any app" onClick={() => void send({ kind: "open", sessionId: peek.id })}>Answer</button> : null}
              {peek.status === "needs-input" && !peek.trust ? null : <button className="tchip" onClick={() => void send({ kind: "open", sessionId: peek.id })}>Open</button>}
              <button className="tchip" onClick={() => { setTarget(peek.id); setPeek(null); open("sessions"); }}>Message</button>
              <button className="tchip ghost" onClick={() => void send({ kind: "pin", sessionId: peek.id })}>{peek.pinned ? "Unpin" : "Pin"}</button>
            </div>
          </div>
        ) : null}
        {panel === "sessions" ? sessionsPanel : null}
        {panel === "command" ? command : null}
        {panel === "settings" ? <div className="menus">{settings}{sub === "look" ? look : null}</div> : null}

        {drop ? (
          <div data-hit className="card">
            <span className="title">Send {drop.length === 1 ? drop[0].split("/").pop() : `${drop.length} files`} to</span>
            <div className="targets">
              {sessions.slice(0, 6).map((x) => (
                <button key={x.id} className="tchip" onClick={() => { void send({ kind: "drop", sessionId: x.id, paths: drop }); setDrop(null); }}>{x.title}</button>
              ))}
              <button className="tchip ghost" onClick={() => setDrop(null)}>Cancel</button>
            </div>
          </div>
        ) : null}
        {s.recap && !panel ? (
          <div data-hit className="card">
            <span className="sub strong">{s.recap}</span>
            <div className="targets">
              <button className="tchip" onClick={() => { void send({ kind: "open", view: "home" }); void send({ kind: "dismiss", what: "recap" }); }}>See it</button>
              <button className="tchip ghost" onClick={() => void send({ kind: "dismiss", what: "recap" })}>Got it</button>
            </div>
          </div>
        ) : null}
        {s.next && !panel ? (
          <div data-hit className="card">
            <span className="sub strong">{s.next.title} is done. Next?</span>
            <div className="targets">
              {s.next.options.map((o) => (
                <button key={o.id} className="tchip" onClick={() => void send({ kind: "next", sessionId: s.next!.sessionId, step: o.id })}>{o.label}</button>
              ))}
              <button className="tchip ghost" aria-label="Dismiss" onClick={() => void send({ kind: "dismiss", what: "next" })}><Ico name="close" size={10} /></button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
