#!/usr/bin/env node
/* submission.cjs — render SUBMISSION.md from PITCH.<slug>.md.
 *
 *   node submission.cjs PITCH.farmsim.md > SUBMISSION.md
 *
 * Same source as the deck and the README, so the three cannot drift. This is
 * the whole reason it exists: the hand-written SUBMISSION.md this replaces sat
 * 248 commits stale, describing features that had been renamed and missing six
 * months of work, because nothing regenerated it.
 *
 * Platform-neutral on purpose. Devpost's field names are not every event's, and
 * reformatting at 3am on submission day is the worst possible time for it.
 *
 * What is derivable is filled. What is not — the war stories, what you learned —
 * is left as a question with a line to answer it on. A generator inventing
 * "challenges we ran into" produces exactly the kind of plausible paragraph a
 * judge punctures by asking one follow-up.
 */
const fs = require('fs');

const BLANK = (v) => v == null || /^\[.*\]$/.test(String(v).trim()) || String(v).trim() === '—';
const un = (s) => String(s)
  .replace(/&#8212;/g, '—').replace(/&#183;/g, '·').replace(/&#8217;/g, '’')
  .replace(/&#215;/g, '×').replace(/<br>/g, ' ');

function parse(md) {
  const out = {};
  const parts = md.split(/^## (\d+) · (.*)$/m).slice(1);
  for (let i = 0; i < parts.length; i += 3) {
    const n = parts[i], body = parts[i + 2] ?? '';
    const f = {}, rows = {};
    let key = null;
    for (const raw of body.split('\n')) {
      const line = raw.trimEnd();
      if (/^>/.test(line) || /^_Done when:_/.test(line) || /^---/.test(line)) { key = null; continue; }
      const m = line.match(/^\*\*([^*]+):\*\*[ \t]*(.*)$/);
      if (m) {
        const name = m[1].trim(), val = m[2].trim();
        if (val) { f[name] = val; key = null; } else { rows[name] = []; key = name; }
        continue;
      }
      const li = line.match(/^-[ \t]+(.*)$/);
      if (li && key) rows[key].push(li[1].split('|').map((s) => s.trim()));
    }
    out[n] = { fields: f, rows };
  }
  return out;
}

const src = process.argv[2];
if (!src) { console.error('usage: submission.cjs PITCH.<slug>.md > SUBMISSION.md'); process.exit(1); }
const P = parse(fs.readFileSync(src, 'utf8'));
const g = (n, k) => { const v = P[n]?.fields?.[k]; return BLANK(v) ? null : un(v); };
const rows = (n, k) => (P[n]?.rows?.[k] ?? []).filter((r) => !r.some(BLANK)).map((r) => r.map(un));

/* Pitch section numbers, named so the mapping is readable at a glance. */
const ONELINER = '1', PROBLEM = '2', INSIGHT = '3', WHYNOW = '4', BUILT = '5';
const VISION = '11', RISKS = '13', DEMO = '14';

const name = g(ONELINER, 'Project') ?? g(ONELINER, 'Name') ?? 'This project';
const tagline = g(ONELINER, 'Head') ?? g(ONELINER, 'One-liner');

/** A section whose answer has to come from a person. The question is the point —
 *  it is what they answer at 2am, and it is better than invented prose. */
const ask = (q) => `_${q}_\n\n`;

const out = [];
const P_ = (s) => out.push(s);

P_(`# ${name} — submission\n`);
if (tagline) P_(`> ${tagline}\n`);
P_(`<!-- Generated from ${src.replace(/^.*\//, '')} by submission.cjs.
     Edit the pitch and re-run; edits made here are lost on the next run,
     except in the sections marked "write this yourself". -->\n`);

/* ---------- what it is ---------- */
P_('## What it does\n');
const sol = g(BUILT, 'Solution head');
const prod = g(BUILT, 'Product head');
if (sol) P_(`${sol}\n`);
const steps5 = rows(BUILT, 'Steps');
if (steps5.length) {
  for (const r of steps5) P_(`- **${r[0]}** — ${r.slice(1).join(' · ')}`);
  P_('');
}
if (prod) P_(`${prod}\n`);
const pipe = rows(BUILT, 'Pipeline');
if (pipe.length) {
  P_('How it works:\n');
  for (const r of pipe) P_(`- **${r[0]}** — ${r.slice(1).join(' · ')}`);
  P_('');
}
if (!sol && !prod && !steps5.length) P_(ask('Fill section 5 of the pitch — what you built — and re-run.'));

/* ---------- why ---------- */
P_('## Inspiration\n');
const prob = g(PROBLEM, 'Lead') ?? g(PROBLEM, 'Head');
const ins = g(INSIGHT, 'Head') ?? g(INSIGHT, 'Lead');
if (prob) P_(`${prob}\n`);
if (ins) P_(`${ins}\n`);
const why = g(WHYNOW, 'Head') ?? g(WHYNOW, 'Lead');
if (why) P_(`${why}\n`);
if (!prob && !ins && !why) P_(ask('Why did you build this? Fill sections 2–4 of the pitch and re-run.'));

/* ---------- how ---------- */
P_('## How we built it\n');
P_(ask('Write this yourself: the stack, and the one or two decisions that shaped it. A list of library names is not interesting; why you picked them is.'));

P_('## Challenges we ran into\n');
P_(ask('Write this yourself. A real thing that broke, what it cost you, and how you got out. This is the section judges remember, and the one nothing can generate for you.'));

P_('## What we learned\n');
P_(ask('Write this yourself. Something you did not know on day one.'));

/* ---------- forward ---------- */
P_("## What's next\n");
const vis = g(VISION, 'Head') ?? g(VISION, 'Lead');
if (vis) P_(`${vis}\n`);
const big = g(RISKS, 'Biggest risk');
const risks = rows(RISKS, 'Other risks');
if (big || risks.length) {
  P_('Known risks, and what would settle them:\n');
  if (big) P_(`- **Biggest** — ${big}`);
  for (const r of risks) P_(`- **${r[0]}** — ${r.slice(1).join(' · ')}`);
  P_('');
}
if (!vis && !big && !risks.length) P_(ask('Fill sections 11 and 13 of the pitch and re-run.'));

/* ---------- the demo ---------- */
P_('## Demo\n');
const steps = rows(DEMO, 'Steps');
const must = g(DEMO, 'Must work');
const fallback = g(DEMO, 'Fallback');
if (steps.length) {
  P_('The exact path to walk, in order. Rehearse it until it is boring.\n');
  steps.forEach((r, i) => P_(`${i + 1}. ${r.join(' — ')}`));
  P_('');
  if (must) P_(`The one thing that cannot break: **${must}**\n`);
  if (fallback) P_(`If it breaks live, say: "${fallback}"\n`);
  P_('Keep the recording under three minutes. Show the thing working before explaining how it works.\n');
} else {
  P_(ask('Fill section 14 of the pitch — the demo path — and re-run. Without it there is no shot list.'));
}

/* ---------- the checklist ---------- */
P_('## Before the deadline\n');
P_(`- [ ] Repo public, and an incognito window can see it
- [ ] README works on a machine that has never run this
- [ ] Demo video recorded, under three minutes, link: \`____________\`
- [ ] Screenshots taken of each step in the demo path above
- [ ] Every team member listed on the submission
- [ ] Tagline, under 60 characters: \`${tagline ? tagline.slice(0, 60) : '____________'}\`
- [ ] Built-with tags filled in
- [ ] Sponsor or track requirements met — list them here, they differ every event
- [ ] Submitted, with time to spare for the form being slow
`);

process.stdout.write(out.join('\n').replace(/\n{3,}/g, '\n\n').trimStart() + '\n');
