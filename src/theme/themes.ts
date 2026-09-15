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
  /** text */
  ink: string; // primary text
  dim: string; // secondary text
  faint: string; // tertiary / metadata
  /** brand + semantics */
  accent: string; // phosphor amber — primary action / attention
  accentInk: string; // text on accent
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
  ink: "#e8e6df",
  dim: "#9aa39c",
  faint: "#5c665f",
  accent: "#ffb454",
  accentInk: "#1a1205",
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
  ink: "#1f231f",
  dim: "#5d655d",
  faint: "#9aa094",
  accent: "#c25e00",
  accentInk: "#fff7ec",
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

export const themes: Record<string, Theme> = { ember, paperwhite };

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  for (const [key, value] of Object.entries(theme)) {
    if (key === "name") continue;
    root.style.setProperty(`--${key}`, value);
  }
  root.dataset.theme = theme.name;
}
