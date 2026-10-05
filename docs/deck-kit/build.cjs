#!/usr/bin/env node
/* build.cjs — compose a deck from  project content x theme x visual-map.
 *   node build.cjs dealghost            -> every theme
 *   node build.cjs dealghost carbon     -> one theme
 * Writes out/<theme>/project/{deck.json,slides/*.html}. Diagrams are inlined
 * into the slide files; nothing references an external URL.
 */
const fs = require('fs'), path = require('path');
const V = require('./visuals.cjs');
const THEMES = require('./themes.cjs');
const MAP = require('./visual-map.json');

const slug = process.argv[2] || 'dealghost';
const only = process.argv[3];
const P = require(`./projects/${slug}.cjs`);
const log = [];

/* ---------- shared chrome ---------- */
const open = (t, id, o = {}) =>
  `<section id="${id}" data-transition="${o.tr || 'fade'}" style="background:${o.bg || t.bg1};color:${o.color || t.ink};font-family:${t.body};padding:${o.footer ? '128px 128px 160px' : '128px'};display:flex;flex-direction:column;justify-content:${o.justify || 'center'};gap:${o.gap == null ? 44 : o.gap}px">`;

const eyebrow = (t, label, col) => {
  const c = col || t.accent;
  return `<div style="display:flex;align-items:center;gap:18px">
<x-shape kind="ellipse" style="width:16px;height:16px;background:${c}"></x-shape>
<p style="font-family:${t.eyeF};font-size:${t.eyeSize}px;font-weight:600;letter-spacing:${t.eyeTrack};text-transform:uppercase;color:${c}">${label}</p>
</div>`;
};
const head = (t, html, size, col) =>
  `<h2 style="font-family:${t.disp};font-size:${size || t.h2}px;font-weight:${t.dispW};line-height:1.1;color:${col || t.ink}">${html}</h2>`;
const lead = (t, html, col) =>
  `<p style="font-size:${t.p}px;line-height:1.45;color:${col || t.muted};width:1320px">${html}</p>`;
const foot = (t, s, col) =>
  `<p style="position:absolute;left:128px;bottom:64px;width:1600px;font-family:${t.eyeF};font-size:26px;letter-spacing:2px;text-transform:uppercase;color:${col || t.muted}">${s}</p>`;
const notes = s => `<aside>${s}</aside>`;

/* resolve the visual for a slide from the map; fall back loudly, never invent */
function visualFor(id, t, data) {
  const spec = MAP.slides[id];
  if (!spec || !spec.recipe) return { html: '', how: 'none' };
  if (!data) { log.push(`  ${id.padEnd(12)} ${String(spec.recipe).padEnd(9)} FALLBACK — ${spec.fallback}`); return { html: '', how: 'fallback' }; }
  log.push(`  ${id.padEnd(12)} ${String(spec.recipe).padEnd(9)} inlined`);
  return { html: V[spec.recipe](t, data), how: spec.recipe };
}

/* ---------- slides ---------- */
const S = {};

S.cover = t => open(t, 'cover', { tr: 'push', gap: 52, footer: true }) +
  eyebrow(t, P.kicker) +
  `<h1 style="font-family:${t.disp};font-size:${t.h1}px;font-weight:${t.dispW};line-height:1.02;letter-spacing:-2px">${P.cover.title}</h1>` +
  `<p style="font-size:44px;line-height:1.3;color:${t.ink};width:1340px">${P.cover.sub}</p>` +
  foot(t, P.byline) + notes(P.cover.notes) + '</section>';

S.problem = t => open(t, 'problem', { bg: t.bg2 }) +
  eyebrow(t, 'The problem') + head(t, P.problem.head) + lead(t, P.problem.lead) +
  visualFor('problem', t, P.problem.visual).html +
  notes(P.problem.notes) + '</section>';

S.insight = t => open(t, 'insight') +
  eyebrow(t, 'The insight') + head(t, P.insight.head) +
  visualFor('insight', t, P.insight.visual).html +
  notes(P.insight.notes) + '</section>';

S.solution = t => open(t, 'solution', { bg: t.bg2 }) +
  eyebrow(t, 'What it is') + head(t, P.solution.head) +
  visualFor('solution', t, P.solution.visual).html +
  notes(P.solution.notes) + '</section>';

S.whynow = t => open(t, 'whynow') +
  eyebrow(t, 'Why now') + head(t, P.whynow.head) +
  visualFor('whynow', t, P.whynow.visual).html +
  notes(P.whynow.notes) + '</section>';

S.product = t => open(t, 'product', { bg: t.bg2, gap: 52 }) +
  eyebrow(t, 'How it works') + head(t, P.product.head, 76) +
  visualFor('product', t, P.product.visual).html +
  notes(P.product.notes) + '</section>';

S.market = t => open(t, 'market', { footer: true, gap: 48 }) +
  eyebrow(t, 'Market') + head(t, P.market.head, 76) +
  visualFor('market', t, P.market.visual).html +
  (P.market.verified ? '' : foot(t, P.market.footer, t.risk)) +
  notes(P.market.notes) + '</section>';

S.competition = t => open(t, 'competition', { bg: t.bg2 }) +
  eyebrow(t, 'Landscape') + head(t, P.competition.head, 76) +
  visualFor('competition', t, P.competition.visual).html +
  notes(P.competition.notes) + '</section>';

S.model = t => open(t, 'model') +
  eyebrow(t, 'Business model') + head(t, P.model.head) + lead(t, P.model.lead) +
  notes(P.model.notes) + '</section>';

S.traction = t => {
  const v = visualFor('traction', t, P.traction.verified ? P.traction.visual : null);
  return open(t, 'traction', { bg: t.bg2, gap: 48 }) +
    eyebrow(t, 'Traction', t.risk) + head(t, P.traction.head, 76) +
    (v.html || `<div style="display:flex;gap:48px;align-items:stretch">
<div style="flex:1;display:flex;flex-direction:column;gap:16px">
<p style="font-family:${t.disp};font-size:200px;font-weight:${t.dispW};line-height:1;color:${t.accent}">${P.traction.big}</p>
<p style="font-size:${t.p}px;line-height:1.35;color:${t.ink}">${P.traction.bigSub}</p>
</div>
<div style="flex:1;display:flex;flex-direction:column;gap:20px;justify-content:center;background:${t.cardBg};border:1px solid ${t.risk};border-radius:${t.cardR};padding:52px">
<h3 style="font-family:${t.disp};font-size:44px;font-weight:${t.dispW};color:${t.risk}">${P.traction.honest.title}</h3>
<p style="font-size:${t.small}px;line-height:1.45;color:${t.muted}">${P.traction.honest.body}</p>
</div>
</div>`) + notes(P.traction.notes) + '</section>';
};

S.team = t => open(t, 'team', { footer: true }) +
  eyebrow(t, 'Team') + head(t, P.team.head, 76) +
  visualFor('team', t, P.team.visual).html +
  foot(t, P.team.footer, t.risk) + notes(P.team.notes) + '</section>';

S.vision = t => open(t, 'vision', { tr: 'push', bg: t.accent, color: t.onAccent, footer: true, gap: 44 }) +
  `<div style="display:flex;align-items:center;gap:18px">
<x-shape kind="ellipse" style="width:16px;height:16px;background:${t.onAccent}"></x-shape>
<p style="font-family:${t.eyeF};font-size:${t.eyeSize}px;font-weight:600;letter-spacing:${t.eyeTrack};text-transform:uppercase;color:${t.onAccent}">Five years</p>
</div>` +
  head(t, P.vision.head, 76, t.onAccent) +
  visualFor('vision', { ...t, accent: t.onAccent, ink: t.onAccent, muted: t.onAccentMuted },
            P.vision.visual ? { ...P.vision.visual, height: 400 } : null).html +
  foot(t, P.vision.lead, t.onAccent) +
  notes(P.vision.notes) + '</section>';

S.ask = t => open(t, 'ask', { footer: true }) +
  eyebrow(t, 'The ask') + head(t, P.ask.head) +
  `<div style="display:flex;gap:48px;align-items:stretch">
<div style="flex:1;display:flex;flex-direction:column;gap:20px;justify-content:center">
${P.ask.lines.map(l => `<p style="font-size:${t.p}px;line-height:1.4;color:${t.ink}">${l}</p>`).join('')}
</div>
<div style="flex:1;display:flex;flex-direction:column;gap:20px;justify-content:center;background:${t.cardBg};border:1px solid ${t.risk};border-radius:${t.cardR};padding:52px">
<h3 style="font-family:${t.disp};font-size:38px;font-weight:${t.dispW};color:${t.risk}">${P.ask.risk.title}</h3>
<p style="font-size:${t.small}px;line-height:1.45;color:${t.muted}">${P.ask.risk.body}</p>
</div>
</div>` + foot(t, P.name) + notes(P.ask.notes) + '</section>';

const ORDER = Object.keys(MAP.slides);
const SECTIONS = {
  open:     { description: 'The scene where a deal quietly dies and nobody notices', start: 'cover' },
  argument: { description: 'Capture is solved, recall is not — and why that is newly buildable', start: 'insight' },
  evidence: { description: 'How the system works and where it sits against Gong and Clari', start: 'product' },
  company:  { description: 'Model, honest traction, team, and what we are asking for', start: 'model' },
};

for (const [key, t] of Object.entries(THEMES)) {
  if (only && key !== only) continue;
  log.length = 0;
  const dir = path.join(__dirname, 'out', key, 'project');
  fs.mkdirSync(path.join(dir, 'slides'), { recursive: true });
  for (const id of ORDER) fs.writeFileSync(path.join(dir, 'slides', `${id}.html`), S[id](t) + '\n');
  fs.writeFileSync(path.join(dir, 'deck.json'), JSON.stringify({
    v: 4, createdOnFiles: { v: 1, at: new Date().toISOString().replace(/\.\d+Z$/, 'Z') },
    title: `${P.name} — ${t.name}`, cover: 'cover', order: ORDER, sections: SECTIONS,
    faces: t.faces, designSystems: [],
  }, null, 2) + '\n');
  console.log(`\n${t.name}  ->  out/${key}/project`);
  console.log(log.join('\n'));
}
