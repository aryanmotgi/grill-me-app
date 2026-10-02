/**
 * Single source of truth for every color in the app. Components never
 * hardcode colors — they read the CSS custom properties written by
 * applyTheme(). Swapping the active theme object reskins the whole app.
 */
export interface Theme {
  name: string;
  /** window + panel surfaces */
  bg: string; // app background
  panel: string; // panel background
  raised: string; // cards, rows, inputs
  overlay: string; // modals, quick switcher
  line: string; // hairline borders
  lineglow: string; // accent-tinted glow edge for glass panels
  /** text */
  ink: string; // primary text
  dim: string; // secondary text
  faint: string; // tertiary / metadata
  /** brand + semantics */
  accent: string; // phosphor amber — primary action / attention
  accentInk: string; // text on accent
  data: string; // cyan — metrics, counts, timestamps, links, secondary state
  ok: string; // working / pass / done
  warn: string; // needs-input / conflict
  danger: string; // fail / disconnected
  idle: string; // idle status
  /** terminal pane */
  termBg: string;
  termInk: string;
  termClaude: string; // claude output lines
  termCmd: string; // command lines
  selection: string;
}

export const ember: Theme = {
  name: "ember",
  bg: "#0b0e0c",
  panel: "#101412",
  raised: "#161b18",
  overlay: "#131816",
  line: "#242b27",
  lineglow: "#4a5a52",
  ink: "#e8e6df",
  dim: "#9aa39c",
  faint: "#7d877f",
  accent: "#ffb454",
  accentInk: "#1a1205",
  data: "#5fd3d0",
  ok: "#7fd962",
  warn: "#ffb454",
  danger: "#f07178",
  idle: "#5c6773",
  termBg: "#0a0c0b",
  termInk: "#cfd6cf",
  termClaude: "#95e6cb",
  termCmd: "#ffd580",
  selection: "#2b3a33",
};

export const paperwhite: Theme = {
  name: "paperwhite",
  bg: "#f2efe9",
  panel: "#faf8f3",
  raised: "#ffffff",
  overlay: "#fffdf8",
  line: "#ddd7cb",
  lineglow: "#c7bda6",
  ink: "#1f231f",
  dim: "#5d655d",
  faint: "#6b7263",
  accent: "#c25e00",
  accentInk: "#fff7ec",
  data: "#187370",
  ok: "#3d8b37",
  warn: "#c25e00",
  danger: "#c33c3c",
  idle: "#8a948e",
  termBg: "#1d211e",
  termInk: "#d8ddd4",
  termClaude: "#8fd4bb",
  termCmd: "#f0c674",
  selection: "#e5ddc8",
};

/** Cool dark — cyan-forward over a deep blue-black ground; amber stays
 *  reserved for action. Full token set, AA text over every surface. */
export const cyanNoir: Theme = {
  name: "cyan-noir",
  bg: "#070b11",
  panel: "#0c121b",
  raised: "#131c28",
  overlay: "#0f1722",
  line: "#20303f",
  lineglow: "#3f6475",
  ink: "#e6edf4",
  dim: "#9aabbb",
  faint: "#788b9c",
  accent: "#ffb454",
  accentInk: "#06121a",
  data: "#4fd8e6",
  ok: "#5ad19a",
  warn: "#ffb454",
  danger: "#f0717a",
  idle: "#56697a",
  termBg: "#05090e",
  termInk: "#cdd8e2",
  termClaude: "#8fe3e0",
  termCmd: "#ffd580",
  selection: "#1c3a46",
};

/** Retro-futuristic dark magenta/purple + cyan. Purple lives in the ground,
 *  surfaces and glass rim; cyan carries data, amber stays action. AA legible. */
export const synthwave: Theme = {
  name: "synthwave",
  bg: "#0e0818",
  panel: "#181024",
  raised: "#221733",
  overlay: "#1b1229",
  line: "#352748",
  lineglow: "#7a4b8f",
  ink: "#f1e9f6",
  dim: "#b6a2c6",
  faint: "#93809f",
  accent: "#ffb454",
  accentInk: "#1a1005",
  data: "#48dcef",
  ok: "#5ad99a",
  warn: "#ffb454",
  danger: "#ff6b81",
  idle: "#7a698f",
  termBg: "#0a0513",
  termInk: "#e7ddef",
  termClaude: "#7fe6e0",
  termCmd: "#ffd580",
  selection: "#382250",
};

/** Monocode look — mostly-monochrome graphite with ONE quiet accent. The
 *  accent is a muted slate-blue used only on the active tab + primary button;
 *  everything else is neutral gray. The old bright cyan/blue "data" token is
 *  desaturated to near-gray so readouts read as chrome, not color. */
/** Forge (default): the launch animation's warm ember → gold glow. One bright
 *  accent (ember orange); gold only in gradients and numbers; green, amber
 *  and red kept for status. Gradients live in styles.css ([data-theme="forge"]). */
export const forge: Theme = {
  name: "forge",
  bg: "#141015",
  panel: "#1b161a",
  raised: "#251e22",
  overlay: "#201a1e",
  line: "#352a2b",
  lineglow: "#5a4038",
  ink: "#f3ece8",
  dim: "#b3a49d",
  faint: "#85776f",
  accent: "#ff7a2e",
  accentInk: "#1d0f06",
  data: "#e8c37a",
  ok: "#4fcf86",
  warn: "#ffa63d",
  danger: "#f2503f",
  idle: "#6b5d58",
  termBg: "#110d10",
  termInk: "#e6ddd8",
  termClaude: "#ffb27a",
  termCmd: "#f2c14e",
  selection: "#4a2a1c",
};

export const monocode: Theme = {
  name: "monocode",
  bg: "#16171a",
  panel: "#1c1d21",
  raised: "#26282d",
  overlay: "#202226",
  line: "#2e3036",
  lineglow: "#42454c",
  ink: "#e8e9eb",
  dim: "#a0a3a9",
  faint: "#7c8087",
  // one quiet accent — muted slate-blue, not a saturated brand blue
  accent: "#5f7aa0",
  accentInk: "#f2f5f9",
  // readouts: near-neutral gray with only a hair of cool, so numbers stay chrome
  data: "#9aa1ab",
  ok: "#57b56a",
  warn: "#d1943f",
  danger: "#d1615a",
  idle: "#5c6067",
  termBg: "#131417",
  termInk: "#d6d8dc",
  termClaude: "#8ea6c7",
  termCmd: "#c3c7cd",
  selection: "#2b3646",
};

export const themes: Record<string, Theme> = {
  forge,
  monocode,
  ember,
  paperwhite,
  "cyan-noir": cyanNoir,
  synthwave,
};

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  for (const [key, value] of Object.entries(theme)) {
    if (key === "name") continue;
    root.style.setProperty(`--${key}`, value);
  }
  root.dataset.theme = theme.name;
}
