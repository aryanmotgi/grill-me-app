# Grill Me Design System — "Refined Ember"

Approved direction (2026-09-15 design review): keep and tighten the phosphor-amber
terminal identity. Flat surfaces, hairline separation, signal-color discipline.
The terminal is the hero — chrome recedes.

## Tokens (single source of truth)

All colors come from `Theme` objects in `src/theme/themes.ts` → CSS custom
properties → Tailwind tokens in `src/styles.css`. **Never hardcode a color in a
component.** Terminal ANSI palettes live in `src/theme/termPalettes.ts` and may
diverge from the app theme by user choice.

| Token | Role |
|---|---|
| `bg` / `panel` / `raised` / `overlay` | surface ladder, darkest → lightest |
| `line` | hairline borders — the only border color |
| `ink` / `dim` / `faint` | text ladder; faint must clear 4.5:1 on `bg` |
| `accent` | amber. Actions and attention ONLY — never decoration |
| `ok` / `warn` / `danger` / `idle` | status semantics; warn doubles as needs-input |
| `termBg` / `termInk` / `termCmd` | terminal defaults (ember palette tracks these) |

## Type scale (4 steps — do not invent sizes)

| Step | Size | Face | Use |
|---|---|---|---|
| display | 15px / 600 | Chakra Petch | brand, modal titles |
| body | 12px / 400-600 | IBM Plex Sans | names, labels, buttons, messages |
| meta | 10-11px / 400 | IBM Plex Sans | hints, secondary text, tags |
| code | 10-12px / 400 | IBM Plex Mono | paths, branches, terminal, diffs |

Mono is reserved for things that are literally code/paths/terminal. UI text is Sans.
`panel-label` (10px caps, 0.16em tracking, faint) is the only section-header style.

## Spacing & shape

- Spacing rhythm: 4 / 8 / 12 / 16. Panel padding 12px; row padding 8-12px.
- Radius: 5-6px on interactive elements, 8px on overlays/modals. Nothing rounder.
- Borders: hairline `line` only. No double borders, no boxes inside boxes —
  group with whitespace and `panel-label` headers instead.
- One modal primitive: `overlay` bg, hairline, rounded-md, `rise` entrance.

## Buttons (three tiers, one primary per surface)

1. `.btn` (ghost) — default. Transparent, dim text, raised bg on hover.
2. `.btn.primary` — amber. **At most one visible per surface.**
3. `.tag warn|danger` — bordered pills reserved for attention states.

Routine metadata is quiet text (`.tag`), never bordered. If everything shouts,
nothing is heard.

## Status language

- Dot = the one primary status signal per session: green working, amber pulsing
  needs-input, hollow idle.
- Health/pause/permission are secondary: muted text or hover-revealed.
- Conflict banner (amber wash) is the only full-width alert; it is a button.

## States (every async surface)

Loading, empty, error, success are features. Empty states say what goes here and
offer the next action. Terminal panes: "starting claude…" overlay until first
output; "session ended — restart" card on death. Never a silent blank pane.

## Motion

140-160ms ease transitions; `rise` (6px translate + fade) for overlays; `tab-fade`
for rail tab switches; `flashbg` for jump-to highlights. Nothing bounces, nothing
loops except the needs-input pulse. `prefers-reduced-motion` collapses all of it.

## Icons

`src/components/Icon.tsx` stroke set only — 16-grid, 1.5px stroke, currentColor.
No emojis in UI. New glyphs join the set; no one-off SVGs in components.

## Voice

Utility language: orientation, status, action. Buttons say what they do
("review & ship", "mark answered"). No mood copy, no exclamation points.

## Do / Don't

- DO let the terminal dominate; chrome is furniture.
- DO use amber only where a click or a decision lives.
- DON'T add a border where whitespace can separate.
- DON'T introduce new font sizes, radii, or colors outside tokens.
- DON'T use `text-[9px]`-style one-offs — use the scale.
