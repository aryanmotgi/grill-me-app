import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
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
  const ts = useApp((s) => s.termSettings);

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
      unlisten = await listen<{ id: string; data: string }>("pty-output", (e) => {
        if (e.payload.id === id && !disposed) term.write(b64ToU8(e.payload.data));
      });
      term.onData((data) => {
        const st = useApp.getState();
        const mate = st.teammates.find((t) => t.id === id);
        const isOwn = st.members[0]?.id === id;
        if (!isOwn && mate?.permission !== "edit") {
          st.toast(`${mate?.name ?? id} is view-only — change it in settings`, "warn");
          return;
        }
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
  }, [id, cwd, themeName, shell, autorun, ts]);

  if (!isTauri()) {
    return (
      <div className="h-full w-full flex items-center justify-center text-faint text-[11px] bg-term-bg">
        embedded terminal needs the native app — run npm run tauri dev
      </div>
    );
  }
  return <div ref={ref} className="h-full w-full bg-term-bg pl-2 pt-1 pb-3" />;
}
