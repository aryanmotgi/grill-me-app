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
| `lineglow` | accent-tinted glow rim for glass panels/modals (see Ember HUD) |
| `ink` / `dim` / `faint` | text ladder; faint must clear 4.5:1 on `bg` |
| `accent` | amber. Actions and attention ONLY — never decoration |
| `data` | cyan. Metrics, counts, timestamps, links, secondary state (see Ember HUD) |
| `ok` / `warn` / `danger` / `idle` | status semantics; warn doubles as needs-input |
| `termBg` / `termInk` / `termCmd` | terminal defaults (ember palette tracks these) |

### Themes (theme pack)

Four complete `Theme` objects ship in `themes.ts`, each carrying the full token
set above (including `data` and `lineglow`) and swappable live from the overflow
menu (`TopBar.tsx`, which maps `Object.keys(themes)`). A theme's map **key must
equal its `.name`** — the key is the stored setting and menu label; `.name`
becomes `data-theme` on `<html>`, which drives the per-theme CSS overrides in
`styles.css`.

| Theme | Feel | Ground | Notes |
|---|---|---|---|
| `ember` | warm dark (default) | phosphor green-black | amber action, cyan data |
| `paperwhite` | light | warm paper | quieter glows (`--glow-a: 5%`) |
| `cyan-noir` | cool dark | deep blue-black | cyan-forward `data`; amber still reserved for action |
| `synthwave` | retro-futuristic dark | magenta/purple | purple lives in surfaces + glass rim, cyan is `data`, amber is action; hotter neon ground (`--glow-a: 9%`) |

**Invariants across every theme:** amber = action only, cyan (`data`) = readouts,
the two-accent rule holds regardless of hue. Purple/magenta in synthwave is a
*surface* hue (ground, `line`, `lineglow`), never a semantic accent. All text
tokens clear AA on their surfaces in all four themes; per-theme glow alphas are
tuned via `:root[data-theme="…"] #root { --glow-a }` so the layered ground and
glass rim read at the same intensity everywhere. The `term*` fields are each
theme's terminal colors (used when the terminal follows the app theme); the
separate ANSI palettes in `termPalettes.ts` remain a user choice.

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

## Ember HUD (Phase 1 evolution)

The Refined Ember rules above still hold — Ember HUD adds depth and a second
signal color without turning the dev tool into a game. Everything here is
subtle, GPU-cheap, and reduced-motion-safe.

**Two-accent rule.** Amber (`accent`) is for **actions & attention only** —
buttons, the needs-input state, the one thing to click. Cyan (`data`) is for
**information you read, not act on**: metric numbers, counts, timestamps,
cpu/mem, token totals, links, secondary state. If a number is a readout, it's
`text-data`; if it's a decision, it's amber. Green (`ok`) stays a success
semantic (e.g. "tasks done"). Never decorate with either accent.

**Layered ground.** The app shell (`#root`) carries one fixed, layered
background: a vertical `panel→bg` gradient, two faint radial glows (amber
top-right, cyan top-left, ~5-7% alpha), and a barely-there vertical grid, over
the existing horizontal scanlines. `background-attachment: fixed`, quieter in
paperwhite and hotter in synthwave (per-theme `--glow-a`). It lives on the
shell — never per panel. Content surfaces that
should reveal it (the home dashboard) stay transparent.

**Glass panels + glow edge.** The `.glass` class is the shared card/modal
surface: a semi-opaque `panel` fill, `backdrop-filter: blur(10px)`, and a 1px
gradient-glow rim from `lineglow` (mask-composite trick on `::before`). Pair it
with a `rounded-*` utility — the rim inherits the radius. Applied to home stat
cards, all modals, and dropdown menus. Structural chrome (top bar, session
list, right rail) stays flat over the ground — glass is for things that float.
Text must stay AA over the glass in all four themes.

**Modal primitive.** `.scrim` = dark wash + `blur(2px)` behind every overlay;
the modal panel is `.glass` + `shadow-2xl` + `rise`. All modals inherit this.

**Pulse = needs-input only.** `.status-dot.needs-input` loops an expanding
glow-ring (~2s), wrapped in `@media (prefers-reduced-motion: no-preference)`;
reduced motion collapses it to the static glow. Nothing else loops. `working`
keeps a static glow, `idle` stays hollow.

**Numbers.** Live figures animate to their new value via `<TickNumber>` (~300ms
count-up, snaps instantly under reduced motion). The `.num` utility applies
`tabular-nums` — put it on every digit cluster (stat band, cpu/mem, tokens) so
columns don't jitter. Sparklines carry a soft `data`-tinted area fill and a lit
dot on the latest point.

**Motion stays minimal.** The only additions are the needs-input ring and the
number tick, both behind `prefers-reduced-motion`. Everything else still
respects the 140-160ms transition budget from Motion above.
