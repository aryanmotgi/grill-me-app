# deck-kit

Builds a pitch deck from three inputs: **project content**, **theme**, and a
**visual map** that decides which diagram belongs on which slide.

```
node build.cjs dealghost           # all themes -> out/<theme>/project
node build.cjs dealghost carbon    # one theme
```

| File | What it is |
|---|---|
| `projects/<slug>.cjs` | The only file that changes per project. Content + the data each diagram needs. |
| `themes.cjs` | Palette and type tokens. Three themes: `carbon`, `press`, `signal`. |
| `visuals.cjs` | Seven diagram recipes: `timeline` `split` `flow` `stack` `bars` `quadrant` `rings`. |
| `visual-map.json` | Slide → recipe → required data → fallback. The reusable judgement. |
| `capture.sh` | Headless-Chrome screenshot of the running app. |

**Diagrams live inside the slide file.** Every recipe emits plain
`div` / `p` / `x-shape` markup styled from the theme tokens, so a theme swap
recolors every diagram and no slide can ever reference a broken image.

**Nothing is invented.** A slide whose data the project has not measured
renders em dashes plus a red verify footer (`market`) or falls back to an
honest sentence (`traction`). `build.cjs` prints which happened on each run.

Screenshots and photos are the exception — they cannot be generated, so
`capture.sh` produces a PNG you upload to the deck as an asset.
