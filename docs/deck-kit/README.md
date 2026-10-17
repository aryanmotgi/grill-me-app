# deck-kit

One source document — `PITCH.<slug>.md` — becomes the deck, the README and the
submission. Nothing is written twice, so nothing can drift.

That is the whole point. Before this, the submission was hand-written and sat
248 commits stale: describing renamed features, missing six months of work, with
a "native desktop build" checkbox unticked three weeks after the build started
shipping. Documents do not go stale because people are careless. They go stale
because something has to be updated by hand.

```
PITCH.<slug>.md
      │
      ├── pitch-to-project.cjs  →  projects/<slug>.cjs   (parsed content)
      │         └── build.cjs   →  out/<theme>/project/  13 slides × 3 themes
      ├── readme.cjs            →  README.md             3 layouts
      ├── submission.cjs        →  SUBMISSION.md         platform-neutral
      └── catalog.cjs           →  what is still blank
```

## Use it

```bash
cp ~/.grillme/deck-kit/PITCH.template.md PITCH.myproject.md
# fill it in — the template's "How to fill it" explains the grammar

node ~/.grillme/deck-kit/catalog.cjs myproject            # what is still blank
node ~/.grillme/deck-kit/readme.cjs PITCH.myproject.md > README.md
node ~/.grillme/deck-kit/submission.cjs PITCH.myproject.md > SUBMISSION.md
node ~/.grillme/deck-kit/pitch-to-project.cjs PITCH.myproject.md myproject --write
node ~/.grillme/deck-kit/build.cjs myproject              # or: build.cjs myproject press
```

The Ship page in Grill Me runs all of these as buttons.

## The rules it follows

**An unanswered section is left out, never printed as a placeholder.** A README
containing `{{TAM}}` or a submission containing `[ action ]` is worse than a
shorter one, and worse than an obvious gap. Every generator deletes rather than
fills.

**A number nobody measured stays an em dash.** The pitch template marks sections
`Verified: no` and the audit flags them. Unsourced figures are the fastest way
to lose a room.

**What only a person can answer is asked, not generated.** The submission leaves
"challenges we ran into" and "what we learned" as questions. A generated war
story is the first thing a judge punctures.

## Every file

| file | what it does |
|---|---|
| `PITCH.template.md` | the source document you copy and fill |
| `pitch-to-project.cjs` | pitch → parsed project data |
| `build.cjs` | project + theme + visual map → slides |
| `themes.cjs` | carbon / press / signal — fonts, colours, card styling |
| `visuals.cjs` | 7 diagram recipes, drawn in the slide markup itself |
| `visual-map.json` | which diagram belongs on which slide |
| `readme.cjs` | pitch → README, in `showcase` / `dev-tool` / `plain` |
| `submission.cjs` | pitch → SUBMISSION.md, platform-neutral |
| `catalog.cjs` | audit: what is filled, what is blocked, what changed |
| `layouts/` | the README layouts `readme.cjs` fills |
| `BLOCKS.md` | swappable visual blocks for those layouts, with the rule for each |
| `examples/` | four worked examples, including a filled pitch |
| `SECTIONS.md` | every deck section and its diagram |
| `capture.sh` | screenshots of the built slides |

## Things that will bite you

**Mermaid, `> [!NOTE]` boxes, footnotes and task lists render on github.com
only** — not in grip, VS Code preview or Quick Look. Check diagrams at
[mermaid.live](https://mermaid.live) before shipping.

**The deck's diagrams are markup, not images.** That is why a theme swap
recolours them and why nothing can 404. Do not replace them with screenshots.

**`projects/` and `out/` are generated.** They are gitignored; never edit them
by hand, the next build overwrites them.

**Keep the pitch's grammar exact.** `**Field:** value` and `- a | b | c` for
list rows. The parsers are deliberately strict — a silently mis-parsed field
produces a confident, wrong slide.
