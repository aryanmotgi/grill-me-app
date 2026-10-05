# DealGhost — pitch

Filled from `PITCH.template.md`. Source of truth for the deck, the submission and
the demo script. Audit with `node deck-kit/catalog.cjs dealghost`.

---

## 1 · One-liner 🟢

**Name:** DealGhost
**Kicker:** Pitch · 2026
**Byline:** Aryan · Shreyash
**Cover line:** Your CRM says the deal is open. | Nobody knows it died three weeks ago.
**Ten words:** Warns you the day a deal starts dying, not after.
**Twenty-five words:** DealGhost reads the calls you already record, matches them against deals that died, and texts the rep the day a deal starts going quiet.
**Notes:** Ten seconds on the title. Say the second line slowly and stop. Let it sit.

---
## 2 · The problem 🟢

**Head:** Deals don't die loudly.
**Lead:** They go quiet, one small signal at a time — and the system tells you six weeks late.
**Timeline:**
- Week 1 | Champion hedges on price
- Week 2 | Replies slow to two days
- Week 3 | The calendar goes quiet
- Week 6 | CRM finally says Closed Lost | hot
**Notes:** Walk the dots left to right. The only red one is the only one the CRM ever showed you.

---
## 3 · The insight 🟢

**Head:** Capture is solved.<br>Recall is not.
**Left:** Solved | Capture | Every call is recorded, transcribed and searchable. Three vendors do this well.
**Right:** Nobody's problem | Recall | Nothing surfaces the one sentence that mattered, on the day it still matters.
**Notes:** This is the whole company in six words. Pause after "Recall is not."

---
## 4 · Why now 🟡

**Head:** Transcripts got cheap.<br>Reasoning got good.
**Timeline:**
- 2023 | Transcription fell to cents per hour
- 2024 | Long context made a whole deal history readable in one pass
- Now | The graph is a prompt, not a data-labelling team
**Notes:** Why this could not have been built in 2022. One breath per mark.

---
## 5 · What we built 🟢

**Solution head:** A memory for why deals die.
**Steps:**
- Listen | Reads the calls you already record.
- Match | Finds the pattern in deals that died.
- Warn | Texts the rep while it still matters.

**Product head:** Four steps, no new habits.
**Pipeline:**
- Call | The recording you already make.
- Signals | Hedges, silences, who went quiet.
- Pattern | Matched against deals that died.
- Alert | One text, one action, same day.
**Solution notes:** Three verbs. Do not read the cards aloud — they read themselves.
**Product notes:** Nobody changes their workflow. That is the sale.

---
## 6 · Market 🔴

**Head:** Sized bottom-up, not borrowed.
**Verified:** no
**Terms:**
- — | Revenue teams already recording calls
- — | Seats per team
- — | Price per seat, per month
**Total:** — | Serviceable market, bottom-up
**Footer:** Unsourced — count the teams before you present this
**Sources:** [ one line per term, with a link ]
**Notes:** Do not present this slide with dashes on it. Count, multiply, cite. A borrowed top-down TAM is the fastest way to lose the room.

---
## 7 · Competition & moat 🟡

**Head:** Different question.
**Axis top:** Acts — tells the rep what to do
**Axis bottom:** Reports — tells you what happened
**Axis left:** Backward-looking
**Axis right:** Forward-looking
**Players:**
- 0.20 | 0.18 | Gong | Records and scores the call
- 0.74 | 0.26 | Clari | Forecasts the pipeline
- 0.70 | 0.84 | DealGhost | Why this deal is dying, today | hot

**Moat:** Nothing defensible yet, and we should say so. The intended moat is the pattern graph — it compounds with every deal that closes or dies inside a customer, so the second year is worth more than the first. With no customers there is no graph. Today the only honest answer is speed.
**Notes:** The axes are the argument. We are not competing on recording or forecasting — we sit on top of both. If asked about Gong: distribution partner, not rival.

---
## 8 · Business model 🟡

**Head:** Per rep, per month.
**Lead:** Sold to the VP who owns the number, not to the rep. Lands on one team, spreads by quota envy.
**Notes:** Land and expand. Price is a placeholder until the pilot.

---
## 9 · Traction 🔴

**Verified:** no
**Head:** What's actually true.
**Big:** 36h
**Big sub:** from zero to a live alert on a real phone
**Honest:** Nothing else is true yet. | No users. No pilots. No revenue. Cut this slide the week there is a real number to put on it.
**Bars:** [ nothing measured yet ]
**Notes:** Say it before they ask it. An empty section beats an inflated one.

---
## 10 · Team 🟡

**Head:** Two people, split at the database.
**People:**
- Aryan · the surface | Pages, the graph view, Postgres schema.
- Shreyash · the brain | Extraction, pattern matching, alert delivery.
**Why us:** [ still unwritten ]
**Notes:** Fill the why-us line before presenting. A team that lost a deal exactly this way beats any resume line.

---
## 11 · Vision 🟢

**Head:** Every company keeps a memory of<br>why its deals died.
**Lead:** The graph is the product. Sales is the wedge.
**Layers:**
- Revenue | Why deals die. The wedge we sell today.
- Support | Why the same escalation keeps repeating.
- Churn reviews | Why an account leaves the way the last one did.
- Any repeated mistake | Anywhere the recording already exists.
**Notes:** This is the slide that turns a tool into a company. Say the last line exactly as written.

---
## 12 · The ask 🟢

**Head:** One pilot with real history.
**Lines:**
- Twelve months of recorded calls.
- And a churn problem they can name.
**Notes:** End on the risk, not the product. Naming it first is disarming, and it was their next question anyway.

---
## 13 · Risks 🟡

**Biggest risk:** Biggest risk | One wrong alert and the rep mutes it forever. The pilot needs known outcomes so we can measure precision before anyone pays.
**Other risks:**
- Gong ships this as a feature → a distribution deal, or we lose
- Signals don't generalise across sales motions → pilot one motion first
- Reps ignore alerts in the wrong channel → deliver where they already work

---

## 14 · Demo path 🔴

**Must work:** [ the one thing that cannot break ]
**Steps:**
- [ 0–15 ] | [ action ] | [ result ]
**Seed data:** [ exactly what is loaded before you start ]
**Fallback:** [ the sentence you say if it breaks live ]
