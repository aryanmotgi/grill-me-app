<!--
═══════════════════════════════════════════════════════════════════════════
PITCH — the source document
Copy to the repo root as PITCH.md. Fill it during brainstorm, before you
build. Refine it as you go. Everything else is generated FROM this file.

This is a WORKING doc, not a published one. It can be ugly. It cannot be
vague — every downstream artefact inherits whatever fuzziness you leave here.

  PITCH.md ──┬──► README.md      (layouts/showcase.md or dev-tool.md)
             ├──► SUBMISSION.md  (layouts/submission.md — the field bank)
             └──► demo script    (3 minutes, spoken)

Answer once. Reuse three times.

STATUS MARKERS — put one on every section so weak spots are visible at a
glance. Nothing ships to a judge while a 🔴 is still in the file.
  🟢 solid — survives a follow-up question
  🟡 draft — says something, not yet sharp
  🔴 empty / unsourced — must be fixed or the section gets cut downstream
═══════════════════════════════════════════════════════════════════════════
-->

# {{PROJECT}} — pitch

**Status:** 🔴 draft · **Last updated:** {{DATE}} · **Event:** {{HACKATHON}} · **Track:** {{TRACK}}

---

## 1 · One-liner 🔴

<!--
Write all three. Submission forms have character limits and you do not want
to be counting characters at 3am. The 60-char version is the hardest and the
most reused — it becomes the repo description, the Devpost tagline, and the
first thing anyone hears.

Rules: name the user and the job. No "revolutionary", "seamless", "powerful",
"next-generation". If it could describe a competitor, it isn't yours yet.
-->

**≤60 chars:** {{}}

**≤200 chars:** {{}}

**One sentence:** {{}}

> **Done when:** a stranger reads the 60-char version and can say who it's for and what it does.

## 2 · The problem 🔴

<!--
Open on a SCENE, not a statistic. A specific person, at a specific moment,
doing a specific frustrating thing. Numbers come later — they size a pain
the reader already believes in.

Then name the tradeoff everyone has quietly accepted. That's the sentence
the whole pitch hangs from.
-->

**The moment:** {{who, doing what, when it goes wrong}}

**What they do today:** {{the current bad workaround}}

**What it costs them:** {{time, money, deals, sanity — be concrete}}

**The tradeoff everyone accepts:** {{"you have to choose between X and Y"}}

> **Done when:** someone in the target audience interrupts you to say "yes, exactly that."

## 3 · The insight 🔴

<!--
The most valuable section in this document and the one most teams skip.
ONE belief about the world that, if true, makes your approach obviously
right and the incumbent approach obviously wrong.

THE DISAGREEMENT TEST: could a competent competitor read this and disagree?
If not, it's a description of your product, not an insight.

Not an insight: "teams need better visibility."
An insight:     "call recording solved capture. Nobody solved recall."
-->

**The belief:** {{one line}}

**Why it makes the incumbent approach wrong:** {{two or three sentences}}

**Who would disagree, and what they'd say:** {{name the counter-argument}}

> **Done when:** you can name a real company whose strategy this belief contradicts.

## 4 · Why now 🔴

<!--
The question judges ask when they're actually interested: why couldn't this
exist two years ago? Name ONE specific unlock with a date. A capability that
got cheap, a platform that opened, a behaviour that changed.

"AI is big now" is not an answer.
-->

**What changed, and when:** {{}}

**What it unlocks that wasn't possible before:** {{}}

**Why the incumbents haven't done it:** {{structural reason, not "they're slow"}}

> **Done when:** the unlock has a date attached to it.

## 5 · What we built 🔴

<!--
One paragraph. What it does, for whom, and the one thing that makes it
different. NOT a feature list. End on the sentence only you could write.
-->

{{}}

**Who it's for, specifically:** {{not "developers" — "the person on a 4-person team who…"}}

> **Done when:** the last sentence is one a competitor's README could not contain.

## 6 · Market 🔴

<!--
⚠️  EVERY NUMBER NEEDS A REAL, CLICKABLE SOURCE. Anyone who has raised money
spots an invented TAM instantly, and one fake figure discredits everything
else on the page. Three sourced numbers beat five made-up ones.

A bottom-up number (users × price) is worth more than a top-down analyst
headline, because bottom-up survives the follow-up question. Do both if you
can; lead with bottom-up.

Leave 🔴 and a dash until sourced. Downstream artefacts will render "—"
rather than invent, and that is the correct behaviour.
-->

| | Figure | Source | Status |
|---|---|---|---|
| **TAM** | {{—}} | {{url}} | 🔴 |
| **SAM** | {{—}} | {{url}} | 🔴 |
| **Bottom-up** | {{N customers × $X}} | {{show the arithmetic}} | 🔴 |
| **Cost of the problem today** | {{—}} | {{url}} | 🔴 |

**The arithmetic, spelled out:** {{how you got the bottom-up number}}

> **Done when:** every row has a link you have actually clicked.

## 7 · Competition 🔴

<!--
Naming real competitors and showing why you're different reads as confidence.
Claiming you have none reads as someone who didn't look — and it's almost
never true. "They use spreadsheets" is a competitor.

Be fair. You should LOSE on at least one axis. That's what makes the rest
believable.
-->

| Who | What they do well | Where they leave the gap |
|---|---|---|
| {{}} | {{}} | {{}} |
| {{}} | {{}} | {{}} |

**Where we lose:** {{name it — this is the credibility line}}

**The wedge:** {{the one thing you do that none of them do}}

> **Done when:** you've named a real competitor's genuine strength.

## 8 · Moat 🔴

<!--
Why isn't this copyable in a weekend? A head start is not a moat.
Real answers: data that compounds with use, a workflow people won't leave,
distribution, or genuine technical difficulty.

Saying what ISN'T defensible is what makes the real claim land.
-->

**What compounds:** {{}}

**What's NOT defensible (say it):** {{the part a competitor could rebuild quickly}}

> **Done when:** you've conceded something real.

## 9 · Business model 🟡

<!--
One concrete price. A number reads as thought-through; a range reads as
evasion. Even a wrong number beats no number.
-->

**Who pays:** {{}} · **How much:** {{$X/seat/mo}} · **For what:** {{the thing behind the paywall}}

**Why the margins work:** {{one clause}}

> **Done when:** there's an actual number in it.

## 10 · Traction 🟡

<!--
Whatever is TRUE. At a hackathon that may be "built in 36 hours, demoed to
12 people, 3 asked for access" — and that's fine. Small and real beats big
and vague. If there's nothing, write "none yet" and the downstream README
will cut the section rather than pad it.
-->

{{}}

**Best quote from a real person:** {{one sentence + their role}}

> **Done when:** every claim here could be checked.

## 11 · Team 🟡

<!--
One clause per person on what they OWN, not their title. Then the why-us
line — prior experience with this exact problem is the strongest thing you
can say, and most teams leave it out entirely.
-->

| Person | Owns | GitHub |
|---|---|---|
| {{}} | {{}} | {{}} |

**Why this team:** {{}}

## 12 · The demo path 🔴

<!--
The EXACT clicks a judge will see, in order, under 3 minutes. Write this
early — it tells you what must work and therefore what to build. Everything
not on this path is negotiable scope.

This section becomes the demo script directly.
-->

| # | Beat | What's on screen | Seconds |
|---|---|---|---|
| 1 | Hook | {{}} | 20 |
| 2 | The problem, shown | {{}} | 30 |
| 3 | **The wow moment** | {{}} | 45 |
| 4 | It's real, not a mock | {{}} | 40 |
| 5 | Close + ask | {{}} | 25 |

**The single frame that sells it:** {{this is also your hero.gif}}

> **Done when:** you've run it end to end without touching anything off-path.

## 13 · Risks 🟡

<!--
What would have to be true for this to work? Naming your own weak points
before a judge does is disarming, and it's what separates people who've
thought about the business from people who've built a demo.
-->

- **{{Risk}}** — {{what would have to be true, or how you'd find out}}
- **{{Risk}}** — {{}}

## 14 · The ask 🟡

<!--
What do you actually want from whoever reads this? At a hackathon: the prize
track, an intro, a pilot user, a sponsor credit. Be specific — "feedback"
is not an ask.
-->

{{}}

---

<!--
═══════════════════════════════════════════════════════════════════════════
FIELD MAP — where each section lands downstream

 §1  One-liner      → README tagline · submission tagline (all 3 lengths)
 §2  Problem        → README "The problem" · submission "Inspiration"
 §3  Insight        → README "The insight" · the thing you say out loud first
 §4  Why now        → README "Why now" · judge Q&A
 §5  What we built  → README "What we built" · submission "What it does"
 §6  Market         → README stat-band (sourced cells only)
 §7  Competition    → README quadrant + matrix-3state
 §8  Moat           → README "Why it's hard to copy"
 §9  Model          → README "Business model"
 §10 Traction       → README "Traction" (cut entirely if empty)
 §11 Team           → README team-avatars · submission team fields
 §12 Demo path      → demo script · hero.gif · shot list
 §13 Risks          → judge Q&A prep (rarely published)
 §14 Ask            → README close · submission "What's next"

BEFORE GENERATING ANYTHING DOWNSTREAM
□ No 🔴 left in sections 1-5 — those are non-negotiable
□ Every market figure has a clicked source, or stays a dash
□ Competition names a real competitor's real strength
□ Moat concedes something
□ Demo path runs end to end
═══════════════════════════════════════════════════════════════════════════
-->
