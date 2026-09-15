/**
 * Distinct WebAudio alert tones per event type — no assets, offline-safe.
 * Each can be muted independently in settings (appSettings.sounds).
 */
export type AlertKind = "message" | "mention" | "needs-input" | "conflict";

const PATTERNS: Record<AlertKind, [number, number][]> = {
  message: [[660, 0.09], [880, 0.12]],
  mention: [[880, 0.08], [660, 0.08], [880, 0.16]],
  "needs-input": [[523, 0.1], [523, 0.1], [784, 0.2]],
  conflict: [[196, 0.25], [185, 0.3]],
};

let ctx: AudioContext | null = null;

export function playAlert(kind: AlertKind, settings: Record<string, unknown>) {
  const sounds = (settings.sounds ?? {}) as Record<string, boolean>;
  if (settings.muteAll || sounds[kind] === false) return;
  try {
    ctx ??= new AudioContext();
    let t = ctx.currentTime;
    for (const [freq, dur] of PATTERNS[kind]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.type = kind === "conflict" ? "sawtooth" : "sine";
      gain.gain.setValueAtTime(0.12, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + dur);
      t += dur + 0.04;
    }
  } catch { /* audio unavailable */ }
}
