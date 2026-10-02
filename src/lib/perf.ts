// Frame-rate probe for the launch animation and the forge. Off unless the app
// was started with GRILLME_PERF=1; then each probe writes a small report to
// /tmp/grillme-perf-<name>.json (average fps, 1%-low fps, slow frames).

export interface FpsReport { name: string; frames: number; avgFps: number; low1Fps: number; slowFrames: number; worstMs: number }

export function summarize(name: string, deltas: number[]): FpsReport {
  const d = deltas.filter((x) => x > 0);
  const sorted = [...d].sort((a, b) => a - b);
  const avg = d.reduce((a, b) => a + b, 0) / Math.max(1, d.length);
  const p99 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))] ?? 0;
  const r = (x: number) => Math.round(x * 10) / 10;
  return { name, frames: d.length, avgFps: r(1000 / (avg || 1)), low1Fps: r(1000 / (p99 || 1)), slowFrames: d.filter((x) => x > 20).length, worstMs: r(sorted[sorted.length - 1] ?? 0) };
}

export async function probeFps(name: string, ms: number, extra?: () => Record<string, number>): Promise<void> {
  if (!("__TAURI_INTERNALS__" in window)) return;
  const { invoke } = await import("@tauri-apps/api/core");
  if (!(await invoke<boolean>("perf_enabled").catch(() => false))) return;
  const deltas: number[] = [];
  let last = performance.now();
  const end = last + ms;
  await new Promise<void>((done) => {
    const f = (t: number) => { deltas.push(t - last); last = t; if (t < end) requestAnimationFrame(f); else done(); };
    requestAnimationFrame(f);
  });
  deltas.shift();
  await invoke("perf_report", { name, report: JSON.stringify({ ...summarize(name, deltas), ...(extra?.() ?? {}) }) }).catch(() => {});
}
