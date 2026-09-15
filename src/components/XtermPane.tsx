import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";
import { isTauri } from "../data/sources/git";
import { useApp } from "../store";
import { TERM_PALETTES, hexWithOpacity } from "../theme/termPalettes";

function b64ToU8(b64: string) {
  const bin = atob(b64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

/**
 * A real embedded terminal: xterm.js in front, a pty-backed Claude Code
 * process behind it (Rust side). Typing goes straight to the process;
 * output streams back live. Scrollback replays from the Rust ring buffer
 * so remounts and reloads lose nothing.
 */
export function XtermPane({ id, cwd, themeName, shell = false, autorun }: { id: string; cwd: string; themeName: string; shell?: boolean; autorun?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const latRef = useRef<HTMLSpanElement>(null);
  const ts = useApp((s) => s.termSettings);
  /** starting → live on first output; dead on pty-exit */
  const [phase, setPhase] = useState<"starting" | "live" | "dead">("starting");
  const [respawnTick, setRespawnTick] = useState(0);

  useEffect(() => {
    if (!isTauri() || !ref.current) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    let ro: ResizeObserver | undefined;

    const css = getComputedStyle(document.documentElement);
    const v = (name: string) => css.getPropertyValue(name).trim();
    const pal = TERM_PALETTES[ts.palette] ?? TERM_PALETTES.ember;
    const useAppTheme = ts.palette === "ember" && !ts.bgOverride && !ts.customAnsi && !ts.fgOverride;
    const ansi = ts.customAnsi ?? pal.ansi;
    const bg = hexWithOpacity(ts.bgOverride ?? (useAppTheme ? v("--termBg") : pal.background), ts.bgOpacity);
    const term = new Terminal({
      fontFamily: `"${ts.font}", "IBM Plex Mono", monospace`,
      fontSize: ts.fontSize,
      lineHeight: ts.lineHeight,
      scrollback: 8000,
      cursorBlink: ts.cursorBlink,
      cursorStyle: ts.cursorStyle,
      theme: {
        background: bg,
        foreground: ts.fgOverride ?? (useAppTheme ? v("--termInk") : pal.foreground),
        cursor: useAppTheme ? v("--termCmd") : pal.cursor,
        selectionBackground: v("--selection"),
        black: ansi[0], red: ansi[1], green: ansi[2], yellow: ansi[3],
        blue: ansi[4], magenta: ansi[5], cyan: ansi[6], white: ansi[7],
        brightBlack: ansi[8], brightRed: ansi[9], brightGreen: ansi[10], brightYellow: ansi[11],
        brightBlue: ansi[12], brightMagenta: ansi[13], brightCyan: ansi[14], brightWhite: ansi[15],
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(ref.current);
    // GPU rendering — DOM renderer chokes on full-screen TUI repaints
    try {
      term.loadAddon(new WebglAddon());
    } catch { /* WebGL unavailable — DOM fallback */ }
    fit.fit();
    term.focus();

    (async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      const { listen } = await import("@tauri-apps/api/event");
      try {
        await invoke("pty_ensure", { id, cwd, shell });
        if (autorun) {
          const sb0 = await invoke<string>("pty_scrollback", { id });
          if (!sb0) await invoke("pty_write", { id, data: autorun + "\n" });
        }
      } catch (e) {
        term.writeln(`\x1b[31mCould not start claude here: ${e}\x1b[0m`);
        return;
      }
      const sb = await invoke<string>("pty_scrollback", { id });
      if (sb && !disposed) term.write(b64ToU8(sb));
      if (ts.skipBanner && !shell) {
        // collapse the Claude Code intro banner once rendered
        let cleared = false;
        const t0 = setInterval(() => {
          if (cleared || disposed) return clearInterval(t0);
          const buf = term.buffer.active;
          for (let i = 0; i < Math.min(buf.length, 40); i++) {
            if (buf.getLine(i)?.translateToString().includes("Welcome back")) {
              term.clear();
              cleared = true;
              clearInterval(t0);
              break;
            }
          }
        }, 800);
        setTimeout(() => clearInterval(t0), 8000);
      }
      // keystroke → echo round-trip latency, rolling average of last 20
      const lat = { sentAt: 0, samples: [] as number[] };
      const unlistenExit = await listen<string>("pty-exit", (e) => {
        if (!disposed && e.payload === id) setPhase("dead");
      });
      const prevUnlisten = unlisten;
      unlisten = () => { prevUnlisten?.(); unlistenExit(); };
      const unlistenOut = await listen<string>(`pty-output/${id}`, (e) => {
        if (disposed) return;
        setPhase((p) => (p === "starting" ? "live" : p));
        if (lat.sentAt) {
          const dt = performance.now() - lat.sentAt;
          lat.sentAt = 0;
          lat.samples.push(dt);
          if (lat.samples.length > 20) lat.samples.shift();
          if (latRef.current) {
            const avg = lat.samples.reduce((a, b) => a + b, 0) / lat.samples.length;
            latRef.current.textContent = `${avg.toFixed(0)}ms`;
          }
        }
        term.write(b64ToU8(e.payload));
      });
      const prevU2 = unlisten;
      unlisten = () => { prevU2?.(); unlistenOut(); };
      const sb2 = await invoke<string>("pty_scrollback", { id });
      if (sb2) setPhase("live");
      term.onData((data) => {
        const st = useApp.getState();
        const memberId = id.split(":")[id.includes(":") && st.activeProject && st.activeProject !== "default" ? 1 : 0] ?? id;
        const mate = st.teammates.find((t) => t.id === memberId || id.startsWith(t.id));
        const isOwn = st.members[0] && (id === st.members[0].id || id.includes(`${st.members[0].id}`));
        if (!isOwn && mate && mate.permission !== "edit") {
          st.toast(`${mate.name} is view-only — change it in settings`, "warn");
          return;
        }
        lat.sentAt = performance.now();
        invoke("pty_write", { id, data }).catch(() => {});
      });
      const doResize = () => {
        fit.fit();
        invoke("pty_resize", { id, rows: term.rows, cols: term.cols }).catch(() => {});
      };
      ro = new ResizeObserver(doResize);
      ro.observe(ref.current!);
      doResize();
    })();

    return () => {
      disposed = true;
      unlisten?.();
      ro?.disconnect();
      term.dispose();
    };
  }, [id, cwd, themeName, shell, autorun, ts, respawnTick]);

  if (!isTauri()) {
    return (
      <div className="h-full w-full flex items-center justify-center text-faint text-[11px] bg-term-bg">
        embedded terminal needs the native app — run npm run tauri dev
      </div>
    );
  }
  return (
    <div className="relative h-full w-full">
      <div ref={ref} className="h-full w-full bg-term-bg pl-2 pt-1 pb-3" />
      <span ref={latRef} title="Keystroke to echo round-trip, rolling average"
        className="absolute bottom-1 right-2 font-mono text-[8px] text-faint opacity-60 pointer-events-none" />
      {phase === "starting" ? (
        <div className="absolute inset-0 flex items-center justify-center bg-term-bg/80 pointer-events-none">
          <div className="text-center rise">
            <div className="status-dot working mx-auto mb-2" style={{ width: 10, height: 10 }} />
            <div className="text-dim text-[11px]">starting {shell ? "shell" : "claude"}…</div>
          </div>
        </div>
      ) : null}
      {phase === "dead" ? (
        <div className="absolute inset-0 flex items-center justify-center bg-term-bg/85">
          <div className="text-center rise">
            <div className="text-dim text-[12px] mb-1">session ended</div>
            <div className="text-faint text-[10px] mb-3">scrollback preserved above</div>
            <button className="btn primary" onClick={() => { setPhase("starting"); setRespawnTick((t) => t + 1); }}>
              restart session
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
