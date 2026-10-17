<!-- EXAMPLE — PITCH.template.md filled with a real project (aryanmotgi/DealGhost).
     Product content is accurate to the repo.

     NOTE §6 is deliberately left 🔴. That's not laziness — it's what an honest
     pitch looks like at hour 10, and it shows the status markers doing their
     job: twelve sections readable, one obviously unfinished, and you can see
     at a glance exactly where the work is. -->

# DealGhost — pitch

**Status:** 🟡 draft · **Last updated:** 2026-09-29 · **Event:** {{HACKATHON}} · **Track:** Revenue / applied AI

---

## 1 · One-liner 🟢

**≤60 chars:** `Know a deal is dying before the rep does.` *(40)*

**≤200 chars:** `DealGhost reads your sales calls, remembers every deal you've ever run, and texts the rep the moment a live deal starts sounding like one that already churned.` *(157)*

**One sentence:** DealGhost turns every sales call into structured signals, holds them in a memory that spans every deal you've run, and proactively alerts the rep when a live deal starts tracking a known failure pattern.

## 2 · The problem 🟢

**The moment:** It's 4pm on a Tuesday. An AE finishes a renewal call. The champion mentioned they're "exploring options," procurement got named for the first time, and the tone shifted when pricing came up. The rep logs *"good call, positive signal"* in the CRM and moves on. The deal dies eleven weeks later and nobody can say when it turned.

**What they do today:** Record everything. Gong, Chorus, Zoom transcripts — capture is a solved problem. Then never read any of it again, because re-reading requires already suspecting something is wrong, which is exactly the thing that didn't happen.

**What it costs them:** A renewal nobody forecast losing, discovered at the worst possible moment. Multiply by every deal where the warning was on tape and unheard.

**The tradeoff everyone accepts:** You can have complete records, or you can have timely warnings. Search-based tools give you the first and quietly require you to supply the second yourself.

## 3 · The insight 🟢

**The belief:** Call recording solved capture. Nobody solved recall.

**Why it makes the incumbent approach wrong:** Every tool in this category treats a call as a document you search *after* you suspect a problem. But the rep doesn't know to go looking — that's the entire failure mode, and a better search box can't fix it. The useful unit isn't the transcript, it's the *pattern across transcripts*: this deal is starting to sound like the one that churned in Q2. That comparison can only be made by something holding every past deal in memory at once, and it has to arrive uninvited.

**Who would disagree, and what they'd say:** Gong would say their deal boards and alerts already surface risk. The counter: those score a deal against its *own* trajectory and a generic model. They don't say *"this sounds like Meridian in March, and here's what we tried."* Cross-deal recall against your own history is the part nobody ships.

## 4 · Why now 🟡

**What changed, and when:** Inference got cheap enough that running five separate extraction passes over every call stopped being a line item you justify and became a rounding error. In 2024 you'd have summarised each call once to control spend; now you can extract aggressively and structure everything.

**What it unlocks that wasn't possible before:** Five typed signals per call instead of one prose summary — and typed signals are what a graph can actually compare. Embeddable graph databases (Kuzu) mean that memory runs in-process, so there's no cluster and no per-seat infrastructure cost between a small team and the product.

**Why the incumbents haven't done it:** Their data model is the call. Ours is the deal-shaped pattern across calls. Retrofitting cross-account memory onto a per-call index is a rewrite, not a feature — and it collides with the enterprise data-isolation promises they've already sold.

## 5 · What we built 🟢

DealGhost ingests a sales-call transcript and runs five extraction skills over it in parallel — pain points, objections, sentiment, product fit, relationship health — writing each result as a typed signal into a persistent revenue memory built on Postgres plus a Kuzu graph. Every new call is matched against the shape of deals that already closed or churned. When a live deal starts tracking a known failure pattern, it scores the risk 0-100 and fires an iMessage to the rep, escalating to a phone call at the top of the range. You don't open a dashboard to find out. It tells you, and it names the past deal it's reminded of.

**Who it's for, specifically:** The AE or CS lead carrying 20-40 accounts who cannot possibly re-read their own calls, at a company with at least a year of recorded history to learn from.

## 6 · Market 🔴

> **This section is deliberately unfinished.** Every figure needs a real, clicked source before anything downstream renders it. The README generator will emit `—` rather than invent — which is correct behaviour, and why this stays 🔴.

| | Figure | Source | Status |
|---|---|---|---|
| **TAM** | — | revenue intelligence software, global | 🔴 |
| **SAM** | — | teams already running call recording | 🔴 |
| **Bottom-up** | `{{N}} companies × {{S}} seats × ${{P}}/seat/mo` | needs all three inputs | 🔴 |
| **Cost of the problem** | — | avg. B2B forecast error, or churn discovered late | 🔴 |

**The arithmetic, spelled out:** Bottom-up is the one to fill first and lead with. Sourceable inputs: companies running a call-recording tool (vendor disclosures or a market report), average revenue-team seats at that size, and a price anchored under the recording tool's own per-seat cost — DealGhost is additive, so it has to price like an add-on.

## 7 · Competition 🟢

| Who | What they do well | Where they leave the gap |
|---|---|---|
| **Gong** | Best-in-class capture, coaching, and in-deal risk scoring. Enormous data advantage. | Scores a deal against itself and a generic model — never against *your* past deals by name. |
| **Clari** | Forecast rollup and pipeline hygiene that execs actually trust. | Operates on CRM fields, not call content. Blind to anything said out loud. |
| **CRM notes** | Free, universal, already in the workflow. | Written by the rep least motivated to record bad news. |

**Where we lose:** Integrations, enterprise trust, and data volume — all three, badly. Gong has years of connector work and security review we don't have, and a new customer's graph starts empty.

**The wedge:** Cross-deal recall against your own history, delivered proactively. Nobody ships the comparison "this sounds like the one you lost."

## 8 · Moat 🟡

**What compounds:** The memory graph. Every closed or churned deal makes the next pattern match sharper, and that history is specific to one company's product, market and sales motion. A competitor starting today starts with an empty graph — and so does every customer they win. The asset is per-customer and can't be bought or transferred.

**What's NOT defensible (say it):** The five extraction prompts are a weekend of work for any competent team, and the alerting is a Twilio call. If we're right about the insight, Gong can ship a version of this. The bet is that their data model and their isolation guarantees make cross-account memory awkward for them, and that we compound inside accounts faster than they retrofit.

## 9 · Business model 🟡

**Who pays:** Revenue teams, per seat. · **How much:** $40/seat/mo · **For what:** the alerting and the cross-deal memory; read-only dashboards stay free so the whole team can see what fired.

**Why the margins work:** We consume transcripts a customer already pays to produce, so there's no capture cost — and extraction is a fixed per-call inference cost that falls every quarter while the price doesn't.

## 10 · Traction 🔴

Built in 36 hours. Demoed end to end on a live transcript with a real iMessage landing on a real phone.

**Best quote from a real person:** *none yet.*

> Nothing else is true yet, so nothing else goes here. The README will cut this section rather than pad it.

## 11 · Team 🟡

| Person | Owns | GitHub |
|---|---|---|
| Aryan | Product surface — pages, graph view, Postgres schema | [@aryanmotgi](https://github.com/aryanmotgi) |
| Shreyash | The brain — extraction skills, pattern matching, alert delivery | [@ssmoney1](https://github.com/ssmoney1) |

**Why this team:** *{{Weakest section in the document — needs the real reason. Prior exposure to sales ops, a previous revenue tool, time inside a team that lost a deal this way. If none of that is true, say what is: two engineers who wanted to see whether cross-deal memory actually works.}}*

## 12 · The demo path 🟢

| # | Beat | What's on screen | Seconds |
|---|---|---|---|
| 1 | Hook | One line: "this deal died eleven weeks ago and nobody noticed." Dashboard, everything green. | 20 |
| 2 | The problem, shown | Open a transcript. Scroll the wall of text. Nobody is reading this. | 30 |
| 3 | **The wow moment** | Paste the live call. Five signals resolve in parallel, the graph gains nodes, risk climbs to 100 — **the phone on the desk buzzes.** | 45 |
| 4 | It's real, not a mock | Open the alert: it names the past deal it matched and the pattern. Show the action ledger. Show the graph view. | 40 |
| 5 | Close + ask | The wedge in one line, then the ask. | 25 |

**The single frame that sells it:** the phone buzzing while the risk score hits 100 on screen. Both in one shot — that's the `hero.gif`.

## 13 · Risks 🟡

- **False positives destroy trust faster than misses.** One wrong 3pm alert and the rep mutes it forever. We'd need to know the precision floor before charging anyone — probably by shadow-running against closed deals and measuring against known outcomes.
- **Cold start.** The product is only good once the graph has history, but a new customer has none. Backfilling from existing recorded calls is the obvious answer and we haven't built it.
- **We need transcript access**, which usually means sitting downstream of Gong — a partner we're also arguing is leaving the gap. That's a real strategic tension, not a footnote.
- **Nobody may want another alerting channel.** Reps are already drowning. The bet is that a *rare, specific, named* alert is different from a notification, and that's unproven.

## 14 · The ask 🟡

A pilot with one revenue team that has twelve months of recorded calls and a churn problem they can name — enough history to make the graph useful on day one, and a known outcome to measure precision against.

---

<!--
WHAT THIS EXAMPLE DEMONSTRATES

Twelve sections readable, two red. You can see in ten seconds that the market
work and the traction are the gaps, and that everything else is defensible.
That is exactly what the status markers are for.

Sections worth copying the SHAPE of:
  §3  names the counter-argument instead of pretending there isn't one
  §7  concedes losing on three axes before claiming the wedge
  §8  says out loud which part is a weekend of work for a competitor
  §13 includes the risk that undermines the whole strategy (§7 partner tension)

Sections still weak, and honestly labelled:
  §6  no sourced numbers at all
  §10 nothing true beyond "we built it"
  §11 the why-us line is a placeholder asking for a real answer
-->
