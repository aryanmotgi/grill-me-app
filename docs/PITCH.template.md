# Pitch — template

The source document. The deck, the submission form and the demo script are all
renderings of this file. Fill this first; never edit a rendering directly.

**14 sections, 13 slides.** Three sections don't become slides: §7's moat sharpens
the competition axes, §13's risk lands on the ask slide, and §14 becomes `DEMO.md`.
The mapping block at the bottom is the authority.

## How to fill it

| Marker | Means |
|---|---|
| 🔴 | empty, or a number with no source |
| 🟡 | drafted, not argued out |
| 🟢 | solid — survives a hostile question |

**Grammar.** A parser reads this file into `deck-kit/projects/<slug>.cjs`, so the
shape matters:

- `**Field:** value` — one value.
- `**Field:**` then `- ` lines — a list. `|` splits the columns, in the order the
  field's guidance names them.
- `> ` lines are guidance. `_Done when:_` is a test for you. Both ignored by the parser.
- Anything still in `[ square brackets ]` or left as `—` is reported unfilled by
  `node deck-kit/catalog.cjs <slug>`. **Never replace a bracket with a guess.**

---

## 1 · One-liner 🔴

> The line you want repeated back to you in the hallway. Write the ten-word version last.

**Name:** [ Project ]
**Kicker:** Pitch · [ year ]
**Byline:** [ Name · Name ]
**Cover line:** [ First line. ] | [ Second line, the one that lands. ]
**Ten words:** [ ]
**Twenty-five words:** [ ]

**Notes:** [ what you say out loud — never what is on the slide ]

_Done when:_ someone who missed the title can still say what you do.

---

## 2 · The problem 🔴

> Dated and specific, not a category. The timeline's `hot` mark is the moment the
> existing system finally notices — that gap is the whole problem.

**Head:** [ Short declarative sentence. ]
**Lead:** [ One line of consequence. ]
**Timeline:** `label | sub | hot`
- [ Week 1 ] | [ what happened ]
- [ Week 6 ] | [ when the system noticed ] | hot

**Notes:** [ what you say out loud — never what is on the slide ]

_Done when:_ a listener has personally felt it.

---

## 3 · The insight 🔴

> Almost always "X is handled, Y is not". The right panel is the gap.

**Head:** [ Two short lines, split with <br>. ]
**Left:** [ Solved ] | [ Noun ] | [ Why this half is genuinely handled. ]
**Right:** [ Nobody's problem ] | [ Noun ] | [ Why nobody has done this half. ]

**Notes:** [ what you say out loud — never what is on the slide ]

_Done when:_ it is not a feature, and a competitor would argue with it.

---

## 4 · Why now 🔴

> Real shifts with dates. Not "AI is getting better".

**Head:** [ Two short lines, split with <br>. ]
**Timeline:** `label | sub`
- [ 20XX ] | [ the shift ]
- [ 20XX ] | [ the shift ]
- Now | [ what is newly possible ]

**Notes:** [ what you say out loud — never what is on the slide ]

_Done when:_ every mark is a real shift, not a trend word.

---

## 5 · What we built 🔴

> Two slides. The solution is three verbs; the product is the pipeline.

**Solution head:** [ What it is, in one line. ]
**Steps:** `verb | one sentence` — three of them
- [ Verb ] | [ What it does. ]
- [ Verb ] | [ What it does. ]
- [ Verb ] | [ What it does. ]

**Product head:** [ How it works, in one line. ]
**Pipeline:** `stage | one sentence` — two to four
- [ Stage ] | [ What arrives here. ]
- [ Stage ] | [ What happens to it. ]

**Solution notes:** [ what you say over the solution slide ]
**Product notes:** [ what you say over the product slide ]

_Done when:_ no adjectives survive, and it asks the user to change no habits.

---

## 6 · Market 🔴

> Bottom-up only. Count the population, multiply by seats, multiply by price, cite
> each. A borrowed top-down TAM is the fastest way to lose the room.

**Head:** [ One line. ]
**Verified:** no
**Terms:** `value | label` — the multiplicands
- — | [ Population you can actually count ]
- — | [ Seats per unit ]
- — | [ Price per seat per month ]
**Total:** — | [ Serviceable market, bottom-up ]
**Footer:** Unsourced — count the population before you present this
**Sources:** [ one line per term, with a link ]

**Notes:** [ what you say out loud — never what is on the slide ]

_Done when:_ every term is counted and cited, and `Verified:` says yes.

---

## 7 · Competition & moat 🔴

> The axes *are* the argument. Pick the two that leave you alone in one corner and
> are still true if a rival drew them. x and y are 0–1 fractions. Mark yourself `hot`.
> The moat below does not get its own slide — it is how you justify the axes.

**Head:** [ One line. ]
**Axis top:** [ high end of the y axis ]
**Axis bottom:** [ low end of the y axis ]
**Axis left:** [ low end of the x axis ]
**Axis right:** [ high end of the x axis ]
**Players:** `x | y | name | what it does | hot`
- [ 0.20 ] | [ 0.18 ] | [ Incumbent ] | [ What it actually does ]
- [ 0.70 ] | [ 0.84 ] | [ You ] | [ The different question ] | hot

**Moat:** [ What gets *harder* for a rival each month you operate. If the honest
answer is "nothing yet", write that — it belongs in §13, not here. ]

**Notes:** [ what you say out loud — never what is on the slide ]

_Done when:_ the axes are true even if a rival drew them.

---

## 8 · Business model 🔴

> Name the buyer, not the user. They are rarely the same person.

**Head:** [ Per what, how often. ]
**Lead:** [ Who signs, and how it spreads after the first team. ]

**Notes:** [ what you say out loud — never what is on the slide ]

_Done when:_ it names the buyer, not the user.

---

## 9 · Traction 🔴

> Only what you measured. `Verified: no` renders an honest sentence instead of a
> chart — which is the correct slide until there is a real number.

**Verified:** no
**Head:** What's actually true.
**Big:** [ the one real number ]
**Big sub:** [ what it measures ]
**Honest:** Nothing else is true yet. | [ No users, no pilots, no revenue. ]
**Bars:** `label | pct | value | hot` — only once Verified says yes
- [ ] | [ ] | [ ] | hot

**Notes:** [ what you say out loud — never what is on the slide ]

_Done when:_ every number can be reproduced live.

---

## 10 · Team 🔴

> Role first, name second. The why-us line is the strongest sentence on the slide
> and the one most often left blank.

**Head:** [ How the work splits. ]
**People:** `name · role | what they own`
- [ Name ] · [ role ] | [ What they own. ]
- [ Name ] · [ role ] | [ What they own. ]
**Why us:** [ Why this line would be false for any other team. ]

**Notes:** [ what you say out loud — never what is on the slide ]

_Done when:_ the why-us line would be false for any other team.

---

## 11 · Vision 🔴

> The wedge expanding. Layer one is what you sell today and draws filled; the outer
> layers are where the same machinery applies next.

**Head:** [ One sentence about the world, not the product. ]
**Lead:** [ The line you want quoted. ]
**Layers:** `label | sub` — innermost first, up to four
- [ Today's wedge ] | [ What you sell now. ]
- [ Next ] | [ Same machinery, new surface. ]

**Notes:** [ what you say out loud — never what is on the slide ]

_Done when:_ it describes a company, not a bigger feature.

---

## 12 · The ask 🔴

> One specific thing. "Intros" and "feedback" are not asks.

**Head:** [ The one thing you want. ]
**Lines:** the two conditions that make it useful
- [ First condition. ]
- [ Second condition. ]

**Notes:** [ what you say out loud — never what is on the slide ]

_Done when:_ a listener could act on it this week.

---

## 13 · Risks 🟡 → feeds the ask slide

> Name the biggest one before they ask it. Naming it first is disarming; being
> caught not knowing it is fatal.

**Biggest risk:** [ Biggest risk ] | [ What breaks, and what the pilot does about it. ]
**Other risks:** not on a slide — for the Q&A
- [ Risk ] → [ what would retire it ]

_Done when:_ the biggest risk is on the ask slide, in your own words.

---

## 14 · Demo path 🔴 → becomes DEMO.md

> Not a slide. This is the 90-second run, decided early so everything else is
> cuttable scope.

**Must work:** [ The one thing that cannot break. ]
**Steps:** `seconds | what you do | what they see`
- [ 0–15 ] | [ action ] | [ result ]
- [ 15–45 ] | [ action ] | [ result ]
**Seed data:** [ exactly what is loaded before you start ]
**Fallback:** [ the sentence you say if it breaks live ]

_Done when:_ you have run it twice, on the machine you'll present from.

---

## Mapping

Which section feeds which slide. `deck-kit/visual-map.json` holds the slide side;
this is the pitch side. The parser reads this table.

| Pitch section | Deck slide | Notes |
|---|---|---|
| §1 One-liner | `cover` | |
| §2 Problem | `problem` | Timeline → `timeline` recipe |
| §3 Insight | `insight` | Left/Right → `split` recipe |
| §4 Why now | `whynow` | Timeline → `timeline` recipe |
| §5 What we built | `solution` + `product` | Steps and Pipeline → two `flow` recipes |
| §6 Market | `market` | Terms/Total → `stack` recipe |
| §7 Competition & moat | `competition` | Axes/Players → `quadrant`. **Moat is not a slide** |
| §8 Business model | `model` | |
| §9 Traction | `traction` | Bars → `bars` recipe, only when Verified |
| §10 Team | `team` | People → `flow`; Why us → the footer |
| §11 Vision | `vision` | Layers → `rings` recipe |
| §12 The ask | `ask` | |
| §13 Risks | `ask` | Biggest risk → the red card. **Not its own slide** |
| §14 Demo path | — | **Operational.** Becomes `DEMO.md` |
