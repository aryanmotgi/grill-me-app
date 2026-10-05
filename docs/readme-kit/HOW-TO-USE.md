# Hackathon docs kit

One source document, two README layouts, a block library, three worked examples. Built for shipping project docs under hackathon time pressure without them looking like it.

## The shape of it

```
PITCH.md  ──┬──►  README.md      (showcase or dev-tool)
            ├──►  SUBMISSION.md  (the field bank)
            └──►  demo script    (3 minutes, spoken)
```

**[`PITCH.template.md`](PITCH.template.md) is the source.** Problem, insight, why-now, market, competition, moat, model, demo path — none of it is derivable from a codebase, all of it is needed by every artefact downstream. Fill it once during brainstorm, before you build, and everything else reads from it.

Answer once. Reuse three times.

## Use it in five steps

**0 · Fill [`PITCH.template.md`](PITCH.template.md)** — copy it to the repo root as `PITCH.md`. Every section carries a status marker (🟢 solid / 🟡 draft / 🔴 empty-or-unsourced) and a *done when* test. **Nothing goes to a judge while a 🔴 remains in sections 1-5.**

Do §12, the demo path, early — the exact clicks a judge will see, timed. It tells you what must work, which means everything not on that path is negotiable scope. It's also the brief for your `hero.gif`.

**1 · Pick a layout.**

| | [`layouts/showcase.md`](layouts/showcase.md) | [`layouts/dev-tool.md`](layouts/dev-tool.md) |
|---|---|---|
| Reader | Judge, investor, press | Developer with the problem already |
| Their question | *Should this exist?* | *Will this work for me, today?* |
| Quickstart sits at | ~70% down | ~25% down |
| Has | Market band, insight, why now, moat, business model, traction | Config, CLI, troubleshooting, dev setup |

**The deciding question: does the reader need convincing the problem is real?** Yes → showcase. No → dev-tool. Someone searching for your tool already has the problem; explaining it to them delays the install command and costs you the user.

Hackathon submissions are usually **showcase**, with the quickstart promoted up under the feature grid so a curious judge can still run it.

**2 · Copy it to the repo root as `README.md`** and fill the `{{PLACEHOLDERS}}`. Every instruction is in HTML comments — strip them all before committing.

**3 · Swap blocks.** Each section names the block it uses. [`BLOCKS.md`](BLOCKS.md) holds every alternate — `before-after-table`, `matrix-3state`, `flywheel`, `xychart`, `journey`, `positioning-statement` and the rest — with the one rule that makes each work. Any block fits any section.

**4 · Shoot the assets.** Four files into `docs/assets/`, about 30 minutes, and do it *before* the deadline panic:

| File | What | Spec |
|---|---|---|
| `hero.gif` | The one wow moment | 10s, **under 2MB**, starts mid-action |
| `shot-01..04.png` | Feature grid | **Same window size for all four** |
| `architecture.png` | How it fits together | Only if Mermaid won't do it |
| `logo.png` | Mark | 512×512, transparent |

## Every file in the kit

| File | What it is |
|---|---|
| [`PITCH.template.md`](PITCH.template.md) | **The source.** 14 sections, status markers, field map. Fill this first. |
| [`layouts/showcase.md`](layouts/showcase.md) | README for someone deciding *should this exist* |
| [`layouts/dev-tool.md`](layouts/dev-tool.md) | README for someone deciding *will this work for me* |
| [`BLOCKS.md`](BLOCKS.md) | 25 swappable visuals, each with the rule that makes it work |
| [`examples/`](examples/) | Three worked fills — see below |

## Examples

- [`examples/dealghost-pitch.md`](examples/dealghost-pitch.md) — **PITCH.md**, real project. The source the README below was generated from.
- [`examples/dealghost.md`](examples/dealghost.md) — **showcase**, real project. Revenue intelligence.
- [`examples/skillet.md`](examples/skillet.md) — **showcase**, fictional consumer app. Same skeleton, different domain, so you can see the layout rather than the content.
- [`examples/grill-me.md`](examples/grill-me.md) — **dev-tool**, real project.

## Things that will bite you

**Mermaid doesn't render in local previewers.** It works on github.com but not in grip, VS Code preview, or Quick Look — GitHub renders it client-side with JavaScript the markdown API never runs. Check diagrams at [mermaid.live](https://mermaid.live) before shipping. Same for `> [!NOTE]` alerts, footnotes and task lists.

**Never publish an unsourced number.** Anyone who has raised money spots an invented TAM instantly, and one fake figure discredits the whole page. Three sourced numbers beat five made-up ones. Prefer bottom-up (`2.1M teams × $40/mo`) over a top-down analyst headline — bottom-up survives the follow-up question.

**Empty sections are worse than absent ones.** They read as an abandoned project. Both layouts are designed to be deleted from, not filled in, and each ends with a cut order for when it runs long.

**Test the quickstart on a clean machine.** Single highest-value item in this kit.

## Previewing locally

```sh
brew install grip
grip . 6419     # from the repo root
```

Then open `localhost:6419/docs/readme-kit/layouts/showcase.md`. It renders through GitHub's own API, so HTML blocks and badges look exactly as they will on the repo page. Refresh to pick up edits; unauthenticated it allows ~60 renders/hour.

## Sourcing

The skeletons are drawn from READMEs that work: [Ghostty](https://github.com/ghostty-org/ghostty) (the problem paragraph — name the tradeoff, refuse it), [Cap](https://github.com/CapSoftware/Cap) (hero composition), [uv](https://github.com/astral-sh/uv) (proof-as-hero, dark/light `<picture>`), [Zed](https://github.com/zed-industries/zed) (restraint — ~400 words total), [Hoppscotch](https://github.com/hoppscotch/hoppscotch) (`<details>` for depth).

The 2×2 feature grid, the market band and the hackathon blocks are this kit's own — not lifted from a studied project, so treat them as the parts most worth disagreeing with.
