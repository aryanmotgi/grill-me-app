/**
 * ANSI palettes for the embedded terminals. "ember" tracks the app theme;
 * the rest let the terminal diverge from the app look independently.
 */
export interface TermPalette {
  name: string;
  background: string;
  foreground: string;
  cursor: string;
  ansi: string[]; // 16 colors: black..white, brightBlack..brightWhite
}

export const TERM_PALETTES: Record<string, TermPalette> = {
  ember: {
    name: "ember (app theme)",
    background: "#0a0c0b",
    foreground: "#cfd6cf",
    cursor: "#ffd580",
    ansi: ["#0a0c0b","#f07178","#7fd962","#ffb454","#73b8ff","#d2a6ff","#95e6cb","#cfd6cf",
           "#5c6773","#f28779","#a6cc70","#ffd580","#95c7ff","#dfbfff","#95e6cb","#e8e6df"],
  },
  dracula: {
    name: "Dracula",
    background: "#282a36",
    foreground: "#f8f8f2",
    cursor: "#f8f8f2",
    ansi: ["#21222c","#ff5555","#50fa7b","#f1fa8c","#bd93f9","#ff79c6","#8be9fd","#f8f8f2",
           "#6272a4","#ff6e6e","#69ff94","#ffffa5","#d6acff","#ff92df","#a4ffff","#ffffff"],
  },
  solarized: {
    name: "Solarized Dark",
    background: "#002b36",
    foreground: "#839496",
    cursor: "#93a1a1",
    ansi: ["#073642","#dc322f","#859900","#b58900","#268bd2","#d33682","#2aa198","#eee8d5",
           "#002b36","#cb4b16","#586e75","#657b83","#839496","#6c71c4","#93a1a1","#fdf6e3"],
  },
  nord: {
    name: "Nord",
    background: "#2e3440",
    foreground: "#d8dee9",
    cursor: "#d8dee9",
    ansi: ["#3b4252","#bf616a","#a3be8c","#ebcb8b","#81a1c1","#b48ead","#88c0d0","#e5e9f0",
           "#4c566a","#bf616a","#a3be8c","#ebcb8b","#81a1c1","#b48ead","#8fbcbb","#eceff4"],
  },
  onedark: {
    name: "One Dark",
    background: "#282c34",
    foreground: "#abb2bf",
    cursor: "#528bff",
    ansi: ["#282c34","#e06c75","#98c379","#e5c07b","#61afef","#c678dd","#56b6c2","#abb2bf",
           "#545862","#e06c75","#98c379","#e5c07b","#61afef","#c678dd","#56b6c2","#c8ccd4"],
  },
};

export const TERM_FONTS = [
  "IBM Plex Mono",
  "JetBrains Mono",
  "Fira Code",
  "Cascadia Code",
  "SF Mono",
  "Menlo",
];

export interface TermSettings {
  font: string;
  fontSize: number;
  lineHeight: number;
  palette: string;
  bgOverride: string | null;
  bgOpacity: number;
  cursorStyle: "block" | "underline" | "bar";
  cursorBlink: boolean;
  skipBanner: boolean;
  customAnsi: string[] | null;
}

export const DEFAULT_TERM_SETTINGS: TermSettings = {
  font: "IBM Plex Mono",
  fontSize: 12,
  lineHeight: 1.2,
  palette: "ember",
  bgOverride: null,
  bgOpacity: 1,
  cursorStyle: "block",
  cursorBlink: true,
  skipBanner: false,
  customAnsi: null,
};

export function hexWithOpacity(hex: string, opacity: number): string {
  if (opacity >= 1) return hex;
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return `rgba(${r},${g},${b},${opacity})`;
}
