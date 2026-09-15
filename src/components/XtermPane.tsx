import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { isTauri } from "../data/sources/git";

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
export function XtermPane({ id, cwd, themeName }: { id: string; cwd: string; themeName: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isTauri() || !ref.current) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    let ro: ResizeObserver | undefined;

    const css = getComputedStyle(document.documentElement);
    const v = (name: string) => css.getPropertyValue(name).trim();
    const term = new Terminal({
      fontFamily: '"IBM Plex Mono", monospace',
      fontSize: 12,
      scrollback: 8000,
      cursorBlink: true,
      theme: {
        background: v("--termBg"),
        foreground: v("--termInk"),
        cursor: v("--termCmd"),
        selectionBackground: v("--selection"),
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
        await invoke("pty_ensure", { id, cwd });
      } catch (e) {
        term.writeln(`\x1b[31mCould not start claude here: ${e}\x1b[0m`);
        return;
      }
      const sb = await invoke<string>("pty_scrollback", { id });
      if (sb && !disposed) term.write(b64ToU8(sb));
      unlisten = await listen<{ id: string; data: string }>("pty-output", (e) => {
        if (e.payload.id === id && !disposed) term.write(b64ToU8(e.payload.data));
      });
      term.onData((data) => {
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
  }, [id, cwd, themeName]);

  if (!isTauri()) {
    return (
      <div className="h-full w-full flex items-center justify-center text-faint text-[11px] bg-term-bg">
        embedded terminal needs the native app — run npm run tauri dev
      </div>
    );
  }
  return <div ref={ref} className="h-full w-full bg-term-bg pl-2 pt-1" />;
}
