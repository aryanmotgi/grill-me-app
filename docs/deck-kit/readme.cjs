#!/usr/bin/env node
/* readme.cjs — render README.md from PITCH.<slug>.md.
 *
 *   node readme.cjs PITCH.grillme.md > README.md
 *
 * Same source as the deck, so the two can't drift. A section the pitch has
 * not filled is left out entirely rather than printed as a placeholder: a
 * README with "[ TODO ]" in it is worse than a shorter README.
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
const layoutName = (process.argv[3] || 'plain');
if (!src) { console.error('usage: readme.cjs PITCH.<slug>.md [showcase|dev-tool|plain]'); process.exit(1); }
const P = parse(fs.readFileSync(src, 'utf8'));
const g = (n, k) => { const v = P[n]?.fields?.[k]; return BLANK(v) ? null : un(v); };
const rows = (n, k) => (P[n]?.rows?.[k] ?? []).filter((r) => !r.some(BLANK)).map((r) => r.map(un));

/* ---------- template mode ----------
 * Renders docs/readme-kit/layouts/<name>.md: fill {{TOKENS}} from the pitch
 * and DELETE any block whose tokens the pitch has not answered, rather than
 * shipping a README with {{TAM}} in it. Same rule the deck follows. */
function renderTemplate(name) {
  const path = require('path');
  const file = path.join(__dirname, 'layouts', `${name}.md`);
  if (!fs.existsSync(file)) {
    console.error(`no layout ${name}; falling back to plain`);
    return null;
  }
  const players = rows('7', 'Players');
  const us = players.find((r) => r[4] === 'hot') ?? players[players.length - 1];
  const steps = rows('5', 'Steps');
  const people = rows('10', 'People');

  const T = {
    PROJECT: g('1', 'Name'),
    NAME: g('1', 'Name'),
    ONE_SENTENCE: g('1', 'Twenty-five words') ?? (g('1', 'Cover line') || '').split('|').map(s=>s.trim()).join(' '),
    PROBLEM_PARAGRAPH: [g('2', 'Head'), g('2', 'Lead')].filter(Boolean).join(' '),
    THE_INSIGHT_IN_ONE_LINE: g('3', 'Head'),
    WHY_NOW_PARAGRAPH: g('4', 'Head'),
    SOLUTION_PARAGRAPH: g('5', 'Solution head'),
    TWO_SENTENCES_ON_THE_SHAPE_OF_IT: g('5', 'Product head'),
    MOAT_PARAGRAPH: g('7', 'Moat'),
    COMPETITOR_A: players[0]?.[2], COMPETITOR_B: players[1]?.[2],
    US: us?.[2], WHAT_THE_AXES_MEASURE: [g('7','Axis left'), g('7','Axis right')].filter(Boolean).join(' \u2192 '),
    TOP_LEFT_LABEL: g('7','Axis top'), BOTTOM_LEFT_LABEL: g('7','Axis bottom'),
    TOP_RIGHT_LABEL: g('7','Axis top'), BOTTOM_RIGHT_LABEL: g('7','Axis bottom'),
    TRACTION: g('9', 'Big') ? `${g('9','Big')} — ${g('9','Big sub') ?? ''}`.trim() : null,
    NEXT: g('11', 'Head'),
    ONE_SENTENCE_ON_THE_WEDGE: g('11', 'Lead'),
    WHAT_YOU_SHOULD_SEE: g('14', 'Must work'),
    TAM: null, SAM: null, GROWTH: null, PAIN_STAT: null,   // never invented
  };
  // the feature grid is the solution's own verbs, where the pitch gave them
  steps.forEach(([title, body], i) => {
    T[`FEATURE_${i + 1}`] = title;
    T[`FEATURE_${i + 1}_LINE`] = body;
  });
  rows('5', 'Pipeline').forEach(([title, body], i) => {
    T[`STAGE_${i + 1}`] = title;
    T[`STAGE_${i + 1}_LINE`] = body;
  });

  let out = fs.readFileSync(file, 'utf8');
  // drop the template's own authoring comments
  out = out.replace(/<!--[\s\S]*?-->/g, '');
  // a line still holding an unanswered token is dropped whole
  out = out.replace(/\{\{([^}]+)\}\}/g, (m, raw) => {
    const k = raw.trim();
    const v = T[k];
    // a lowercase hint like {{one line — what it does}} is authoring guidance,
    // not data: it has no answer, so its line goes too
    return v == null ? `\u0000${/^[A-Z0-9_]+$/.test(k) ? k : 'hint'}\u0000` : v;
  });
  const kept = [], dropped = new Set();
  for (const line of out.split('\n')) {
    const miss = [...line.matchAll(/\u0000([A-Z_]+)\u0000/g)].map((m) => m[1]);
    if (miss.length) { miss.forEach((k) => dropped.add(k)); continue; }
    kept.push(line);
  }
  out = kept.join('\n');
  // a wrapper whose contents were dropped leaves an empty shell; remove them
  out = out.replace(/<table>\s*(?:<tr>\s*<\/tr>\s*)*<\/table>/g, '');
  out = out.replace(/<div align="center">\s*<\/div>/g, '');
  out = out.replace(/^\s*<br>\s*$/gm, '');
  // a heading with nothing under it says less than no heading
  out = out.split('\n').reduce((acc, line, i, arr) => {
    if (/^## /.test(line)) {
      const rest = arr.slice(i + 1);
      const next = rest.findIndex((l) => /^## |^---/.test(l));
      const body = (next === -1 ? rest : rest.slice(0, next)).join('').trim();
      if (!body) return acc;
    }
    acc.push(line);
    return acc;
  }, []).join('\n');
  out = out.replace(/\n{3,}/g, '\n\n').trim();
  if (people.length) out += `\n\n## Team\n\n` + people.map(([w, d]) => `- **${w}** \u2014 ${d}`).join('\n');
  if (steps.length) out += `\n\n## What it does\n\n` + steps.map(([t, b]) => `- **${t}** \u2014 ${b}`).join('\n');
  out += `\n\n---\n\nGenerated from \`${src}\` with the ${name} layout \u2014 edit the pitch, not this file.\n`;
  if (dropped.size) console.error(`left out (unfilled in the pitch): ${[...dropped].sort().join(', ')}`);
  return out;
}

if (layoutName !== 'plain') {
  const t = renderTemplate(layoutName);
  if (t) { process.stdout.write(t); process.exit(0); }
}


const out = [];
const name = g('1', 'Name') ?? 'Project';
out.push(`# ${name}`);

const line = g('1', 'Cover line');
if (line) out.push(`\n> ${line.split('|').map((s) => s.trim()).join('  \n> ')}`);

const quick = g('1', 'Twenty-five words');
if (quick) out.push(`\n${quick}`);

const problem = g('2', 'Head'), plead = g('2', 'Lead');
if (problem || plead) {
  out.push(`\n## The problem\n`);
  if (problem) out.push(`**${problem}**\n`);
  if (plead) out.push(plead);
}

const insight = g('3', 'Head');
if (insight) out.push(`\n## Why this exists\n\n${insight}`);

const steps = rows('5', 'Steps');
if (steps.length) {
  out.push(`\n## What it does\n`);
  for (const [t, b] of steps) out.push(`- **${t}** — ${b}`);
}

const pipe = rows('5', 'Pipeline');
if (pipe.length) {
  out.push(`\n## How it works\n`);
  out.push(pipe.map(([t]) => `**${t}**`).join(' → ') + '\n');
  for (const [t, b] of pipe) out.push(`- **${t}** — ${b}`);
}

const players = rows('7', 'Players');
if (players.length) {
  out.push(`\n## Where it sits\n`);
  out.push('| | What it does |');
  out.push('|---|---|');
  for (const r of players) out.push(`| **${r[2]}** | ${r[3]} |`);
}

const people = rows('10', 'People');
if (people.length) {
  out.push(`\n## Team\n`);
  for (const [who, what] of people) out.push(`- **${who}** — ${what}`);
}

const demoMust = g('14', 'Must work');
const demoSteps = rows('14', 'Steps');
if (demoMust || demoSteps.length) {
  out.push(`\n## Demo\n`);
  if (demoMust) out.push(`${demoMust}\n`);
  for (const r of demoSteps) out.push(`1. ${r[1]}${r[2] ? ` — *${r[2]}*` : ''}`);
}

const skipped = [];
for (const [n, label] of [['6', 'Market'], ['9', 'Traction'], ['11', 'Vision'], ['12', 'The ask']]) {
  const head = g(n, 'Head');
  if (head) out.push(`\n## ${label}\n\n${head}${g(n, 'Lead') ? `\n\n${g(n, 'Lead')}` : ''}`);
  else skipped.push(label);
}

out.push(`\n---\n\nGenerated from \`${src}\` — edit the pitch, not this file.`);
process.stdout.write(out.join('\n') + '\n');
if (skipped.length) console.error(`left out (unfilled in the pitch): ${skipped.join(', ')}`);
