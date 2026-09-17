/**
 * Distinct WebAudio alert tones per event type — no assets, offline-safe.
 * Each can be muted independently in settings (appSettings.sounds) and the
 * whole set scales by appSettings.soundVolume (0..1). Tones are short and
 * deliberately recognizable by shape, not just pitch:
 *   message     — soft rising blip (gentle, easy to ignore)
 *   mention     — insistent three-tone (someone named you)
 *   needs-input — ascending attention rise (a session is waiting)
 *   conflict    — low dissonant buzz (urgent, two people on one file)
 *   merge-turn  — bright ascending chime (the queue rotated to you)
 *   budget-warn — two-tone falling warning (team at 80% of the token budget)
 *   budget-max  — urgent falling triple (team over the token budget)
 */
export type AlertKind =
  | "message"
  | "mention"
  | "needs-input"
  | "conflict"
  | "merge-turn"
  | "budget-warn"
  | "budget-max";

type Step = [freq: number, dur: number];
type Voice = {
  steps: Step[];
  wave: OscillatorType;
  /** per-kind loudness trim so soft events don't shout and urgent ones cut through */
  gain: number;
};

const VOICES: Record<AlertKind, Voice> = {
  // soft two-tone blip, minor third up — quiet by design
  message: { steps: [[784, 0.07], [988, 0.1]], wave: "sine", gain: 0.09 },
  // named you: brisk high-low-high, more present triangle
  mention: { steps: [[988, 0.07], [740, 0.07], [988, 0.15]], wave: "triangle", gain: 0.12 },
  // attention rise: three ascending tones landing on a held note
  "needs-input": { steps: [[587, 0.09], [740, 0.09], [988, 0.2]], wave: "sine", gain: 0.12 },
  // urgent dissonance: two clashing low tones (minor second beating)
  conflict: { steps: [[220, 0.22], [233, 0.3]], wave: "sawtooth", gain: 0.14 },
  // ready chime: C-E-G-C major arpeggio, resolves upward
  "merge-turn": { steps: [[523, 0.09], [659, 0.09], [784, 0.15], [1047, 0.22]], wave: "triangle", gain: 0.12 },
  // budget warning: two descending tones — a heads-up, not an alarm (80%)
  "budget-warn": { steps: [[698, 0.1], [523, 0.16]], wave: "triangle", gain: 0.11 },
  // budget hit: urgent descending triple, lands low (100%+)
  "budget-max": { steps: [[784, 0.09], [587, 0.09], [415, 0.24]], wave: "sawtooth", gain: 0.13 },
};

export const DEFAULT_VOLUME = 0.7;

/**
 * Pure gating decision, split out so it is testable without WebAudio: returns
 * the voice + resolved master volume to play, or null when the alert should be
 * silent (master mute, this kind toggled off, unknown kind, or volume 0).
 */
export function resolveAlert(
  kind: AlertKind,
  settings: Record<string, unknown>,
): { voice: Voice; vol: number } | null {
  const sounds = (settings.sounds ?? {}) as Record<string, boolean>;
  if (settings.muteAll || sounds[kind] === false) return null;
  const voice = VOICES[kind];
  if (!voice) return null;
  // master volume: 0..1, default DEFAULT_VOLUME (undefined = matches prior loudness)
  const raw = settings.soundVolume;
  const vol = typeof raw === "number" ? Math.max(0, Math.min(1, raw)) : DEFAULT_VOLUME;
  if (vol <= 0) return null;
  return { voice, vol };
}

let ctx: AudioContext | null = null;

export function playAlert(kind: AlertKind, settings: Record<string, unknown>) {
  const resolved = resolveAlert(kind, settings);
  if (!resolved) return;
  const { voice, vol } = resolved;
  try {
    ctx ??= new AudioContext();
    let t = ctx.currentTime;
    for (const [freq, dur] of voice.steps) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.type = voice.wave;
      gain.gain.setValueAtTime(voice.gain * vol, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + dur);
      t += dur + 0.04;
    }
  } catch { /* audio unavailable */ }
}
