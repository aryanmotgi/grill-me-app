<!--
═══════════════════════════════════════════════════════════════════════════
LAYOUT: DEV-TOOL
For a reader who already HAS the problem and is deciding whether to install
this in the next ten minutes. They will not read a market section. The
argument is the tool working.

Copy to the repo root as README.md, fill {{PLACEHOLDERS}}, strip every HTML
comment, delete every section you can't fill honestly.

THE RULE: the install command must appear within the first ~25% of the page,
and it must work on a clean machine.

Use layouts/showcase.md instead when the reader needs convincing the problem is
real (judges, investors, press). Swap any block below for an alternate in
BLOCKS.md.

ASSETS (docs/assets/): logo.png · hero.gif · shot-01..04.png · architecture.png
═══════════════════════════════════════════════════════════════════════════
-->

<div align="center">

<img src="docs/assets/logo.png" alt="{{PROJECT}}" width="128">

# {{PROJECT}}

### {{ONE_SENTENCE}}

<!-- Tagline: name the capability, precisely. A dev-tool reader is scanning
     for a match against a problem they already have, so accuracy beats
     persuasion. "Fast, native, feature-rich terminal emulator" — that shape.
     No metaphors. If it could describe a competitor, rewrite it. -->

<img src="{{BADGE_BUILD}}" alt="Build">
<img src="{{BADGE_VERSION}}" alt="Version">
<img src="{{BADGE_LICENSE}}" alt="License">

<a href="#quickstart">Quickstart</a> ·
<a href="#how-it-works">How it works</a> ·
<a href="#configuration">Config</a> ·
<a href="CONTRIBUTING.md">Contributing</a>

<br>

<img src="docs/assets/hero.gif" alt="{{PROJECT}} in action" width="100%">

<sub><i>{{ONE_LINE_CAPTION}}</i></sub>

</div>

---

## What is this

<!--
Two or three sentences, maximum. Name the tradeoff the reader has accepted,
then refuse it — Ghostty's shape: "they all force you to choose between
speed, features, or native UIs. Ghostty provides all three."

Do NOT explain why the problem matters. This reader lives it. Explaining it
to them costs you the install.
-->

{{WHAT_IT_IS}}

<!-- BLOCK: before-after-table — good here when the delta is a workflow
     change rather than a capability. See BLOCKS.md. -->

## Quickstart

<!-- The most important section in this layout. Copy-pasteable, no decoding,
     tested on a clean machine. Prerequisites only if not auto-installed. -->

**Requirements:** {{PREREQS}}

```sh
{{INSTALL_COMMAND}}
{{RUN_COMMAND}}
```

{{WHAT_YOU_SHOULD_SEE}}

<!-- One sentence describing success. Almost every README omits this, and
     it's how a stranger knows whether it worked. -->

> [!IMPORTANT]
> {{THE_ONE_GOTCHA_THAT_WOULD_OTHERWISE_EAT_AN_HOUR}}

<!-- Max two alert boxes in the whole file. A third makes all of them
     invisible. This is the best place to spend one. -->

---

## How it works

<!-- Capabilities, stated precisely. This reader wants to know what it does,
     not how it will make them feel. "Per-worktree file watcher, 3s poll"
     beats "never lose track of your work again."
     Every bullet must WORK TODAY — roadmap goes under What's next. -->

<table>
<tr>
<td width="50%" valign="top">
<img src="docs/assets/shot-01.png" width="100%"><br>
<b>{{FEATURE_1}}</b><br>
<sub>{{precise one-liner}}</sub>
</td>
<td width="50%" valign="top">
<img src="docs/assets/shot-02.png" width="100%"><br>
<b>{{FEATURE_2}}</b><br>
<sub>{{precise one-liner}}</sub>
</td>
</tr>
<tr>
<td width="50%" valign="top">
<img src="docs/assets/shot-03.png" width="100%"><br>
<b>{{FEATURE_3}}</b><br>
<sub>{{precise one-liner}}</sub>
</td>
<td width="50%" valign="top">
<img src="docs/assets/shot-04.png" width="100%"><br>
<b>{{FEATURE_4}}</b><br>
<sub>{{precise one-liner}}</sub>
</td>
</tr>
</table>

- **{{CAPABILITY}}** — {{one clause}}
- **{{CAPABILITY}}** — {{one clause}}

## Architecture

<!-- Draw the non-obvious decision, not the obvious flow. Mermaid over a
     screenshot: stays correct as the code changes, renders in dark mode,
     costs no asset. Use a real image only when the visual shape matters. -->

```mermaid
flowchart LR
    A[{{input}}] --> B[{{the interesting part}}]
    B --> C[(( {{state} }))]
    B --> D[{{output}}]
```

{{TWO_SENTENCES_NAMING_THE_TRADEOFF_YOU_MADE_AND_WHAT_IT_BOUGHT}}

<!-- That tradeoff sentence is what a technical reader is actually here for. -->

<details>
<summary><b>Repo map</b></summary>

| Path | What lives there |
|------|------------------|
| `{{PATH}}` | {{PURPOSE}} |

</details>

## Configuration

<!-- Only the options people actually change. Link to full reference docs
     rather than reproducing every flag. -->

| Option | Default | What it does |
|---|---|---|
| `{{OPTION}}` | `{{DEFAULT}}` | {{effect}} |

## CLI

<!-- Delete if there isn't one. Show real output, not just input — it lets
     people diagnose their own failures. -->

```console
$ {{COMMAND}}
{{REAL_OUTPUT}}
```

## Troubleshooting

<!-- The three most likely failures, folded away. This is the section that
     saves you the most GitHub issues per line written. -->

<details>
<summary><b>{{SYMPTOM}}</b></summary>

{{CAUSE_AND_FIX}}

</details>

<details>
<summary><b>{{SYMPTOM}}</b></summary>

{{CAUSE_AND_FIX}}

</details>

## Development

```sh
{{DEV_SETUP}}
{{TEST_COMMAND}}
```

{{ONE_LINE_ON_PROJECT_LAYOUT_OR_TEST_PHILOSOPHY}}

## Built with

<p align="center">
<img src="https://img.shields.io/badge/{{TECH}}-{{HEX}}?style=for-the-badge&logo={{SLUG}}&logoColor=white">
</p>

<!-- Order by what's interesting, not alphabetically. The unusual choice
     goes first — it's the thing worth asking about. Slugs: simpleicons.org -->

## What's next

<!-- Where unshipped things live. Being explicit here is what lets the
     capability list above stay honest. Link items to issues so the roadmap
     is verifiable rather than decorative. -->

- [ ] {{NEXT}}

## Contributing

{{CONTRIBUTING_LINE}}

## License

{{LICENSE}} — see [LICENSE](LICENSE).

<!--
═══════════════════════════════════════════════════════════════════════════
BEFORE YOU COMMIT

□ Quickstart tested on a CLEAN machine — the one thing that matters most
□ Install command appears within the first ~25% of the page
□ Every {{PLACEHOLDER}} filled or its block deleted
□ Every HTML comment stripped
□ Capability list contains zero unshipped things
□ hero.gif under 2MB, starts mid-action
□ All four grid screenshots at the same window size
□ Max two alert boxes
□ Mermaid checked at mermaid.live (grip and most previewers won't render it)
□ Every link resolves
□ Read once at phone width

CUT ORDER when it runs long: CLI → Configuration → Troubleshooting →
repo map → Architecture. Hero, What is this, Quickstart and How it works
always stay.
═══════════════════════════════════════════════════════════════════════════
-->
