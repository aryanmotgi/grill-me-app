#!/usr/bin/env node
/* pitch-to-project.cjs — reads a filled PITCH.<slug>.md and emits
 * projects/<slug>.cjs. The pitch document is the source; this is the only
 * thing allowed to write a project file.
 *   node pitch-to-project.cjs ../PITCH.dealghost.md dealghost [--write]
 * Without --write it prints what it parsed and changes nothing.
 */
const fs = require('fs'), path = require('path');

/* ---------- grammar ---------- */
function parse(md) {
  const out = {};
  const blocks = md.split(/^## (\d+) · .*$/m).slice(1);
  for (let i = 0; i < blocks.length; i += 2) {
    const n = blocks[i], body = blocks[i + 1];
    const f = {};
    const lines = body.split('\n');
    let key = null;
    for (const raw of lines) {
      const line = raw.trimEnd();
      if (/^>/.test(line) || /^_Done when:_/.test(line) || /^---/.test(line)) { key = null; continue; }
      const m = line.match(/^\*\*([^*]+):\*\*[ \t]*(.*)$/);
      if (m) {
        const name = m[1].trim(), val = m[2].trim();
        if (val) { f[name] = smart(val); key = null; } else { f[name] = []; key = name; }
        continue;
      }
      const li = line.match(/^-[ \t]+(.*)$/);
      if (li && key) { f[key].push(li[1].split('|').map(s => smart(s.trim()))); continue; }
      if (!line) continue;
    }
    out[n] = f;
  }
  return out;
}

const smart = v => typeof v === 'string' ? v.replace(/(\w)'(\w)/g, '$1\u2019$2') : v;
const cells = v => (typeof v === 'string' ? v.split('|').map(s => smart(s.trim())) : v);
const blank = v => v == null || /^\[.*\]$/.test(String(v).trim()) || String(v).trim() === '—';
const yes = v => /^(yes|true)$/i.test(String(v || '').trim());
const rows = v => (Array.isArray(v) ? v : []);
const hot = r => r[r.length - 1] === 'hot';
const drop = r => (hot(r) ? r.slice(0, -1) : r);

/* ---------- pitch sections -> the project shape build.cjs consumes ---------- */
function toProject(P, slug) {
  const s = n => P[String(n)] || {};
  const one = s(1), pr = s(2), ins = s(3), wn = s(4), built = s(5), mk = s(6),
        comp = s(7), mod = s(8), tr = s(9), tm = s(10), vis = s(11), ask = s(12), rk = s(13);

  const cover = cells(one['Cover line']);
  const risk = cells(rk['Biggest risk']);
  const honest = cells(tr['Honest']);
  const total = cells(mk['Total']);

  return {
    slug,
    name: one['Name'],
    byline: one['Byline'],
    kicker: one['Kicker'],
    cover: { title: one['Name'], sub: cover.join('<br>'), notes: one['Notes'] },
    problem: { head: pr['Head'], lead: pr['Lead'], notes: pr['Notes'],
      visual: { marks: rows(pr['Timeline']).map(r => ({ label: drop(r)[0], sub: drop(r)[1], ...(hot(r) ? { hot: true } : {}) })) } },
    insight: { head: ins['Head'], notes: ins['Notes'], visual: {
      left:  { kicker: cells(ins['Left'])[0],  title: cells(ins['Left'])[1],  body: cells(ins['Left'])[2] },
      right: { kicker: cells(ins['Right'])[0], title: cells(ins['Right'])[1], body: cells(ins['Right'])[2] } } },
    solution: { head: built['Solution head'], notes: built['Solution notes'],
      visual: { steps: rows(built['Steps']).map(r => ({ title: r[0], body: r[1] })) } },
    whynow: { head: wn['Head'], notes: wn['Notes'],
      visual: { marks: rows(wn['Timeline']).map(r => ({ label: drop(r)[0], sub: drop(r)[1], ...(hot(r) ? { hot: true } : {}) })) } },
    product: { head: built['Product head'], notes: built['Product notes'],
      visual: { steps: rows(built['Pipeline']).map(r => ({ title: r[0], body: r[1] })) } },
    market: { head: mk['Head'], verified: yes(mk['Verified']), footer: mk['Footer'], notes: mk['Notes'],
      visual: { terms: rows(mk['Terms']).map(r => ({ value: r[0], label: r[1] })),
                total: { value: total[0], label: total[1] } } },
    competition: { head: comp['Head'], moat: comp['Moat'], notes: comp['Notes'],
      visual: { poles: { top: comp['Axis top'], bottom: comp['Axis bottom'], left: comp['Axis left'], right: comp['Axis right'] },
        points: rows(comp['Players']).map(r => ({ x: +drop(r)[0], y: +drop(r)[1], label: drop(r)[2], sub: drop(r)[3], ...(hot(r) ? { hot: true } : {}) })) } },
    model: { head: mod['Head'], lead: mod['Lead'], notes: mod['Notes'] },
    traction: { head: tr['Head'], verified: yes(tr['Verified']), big: tr['Big'], bigSub: tr['Big sub'], notes: tr['Notes'],
      honest: { title: honest[0], body: honest[1] },
      visual: blank(tr['Bars']) ? null : { rows: rows(tr['Bars']).map(r => ({ label: drop(r)[0], pct: +drop(r)[1], value: drop(r)[2], ...(hot(r) ? { hot: true } : {}) })) } },
    team: { head: tm['Head'], notes: tm['Notes'], footer: blank(tm['Why us']) ? '[ Why us — still unwritten ]' : tm['Why us'],
      visual: { steps: rows(tm['People']).map(r => ({ title: r[0], body: r[1] })) } },
    vision: { head: vis['Head'], lead: vis['Lead'], notes: vis['Notes'],
      visual: { layers: rows(vis['Layers']).map(r => ({ label: r[0], sub: r[1] })) } },
    ask: { head: ask['Head'], notes: ask['Notes'], lines: rows(ask['Lines']).map(r => r[0]),
      risk: { title: risk[0], body: risk[1] } },
  };
}

/* ---------- run ---------- */
const [src, slug, flag] = process.argv.slice(2);
if (!src || !slug) { console.error('usage: pitch-to-project.cjs <PITCH.<slug>.md> <slug> [--write]'); process.exit(1); }
const parsed = parse(fs.readFileSync(path.resolve(src), 'utf8'));
const proj = toProject(parsed, slug);

const missing = [];
(function walk(n, t) {
  if (n == null) return;
  if (typeof n === 'string') { if (blank(n)) missing.push(t); return; }
  if (typeof n === 'object') for (const [k, v] of Object.entries(n)) walk(v, t ? `${t}.${k}` : k);
})(proj, '');

console.log(`parsed ${Object.keys(parsed).length} sections from ${path.basename(src)}`);
console.log(`slides built: ${Object.keys(proj).filter(k => proj[k] && typeof proj[k] === 'object').length}`);
console.log(`diagram data present: ${Object.entries(proj).filter(([, v]) => v && v.visual).map(([k]) => k).join(', ')}`);
if (missing.length) console.log(`unfilled: ${missing.join(', ')}`);

if (flag === '--write') {
  const dst = path.join(__dirname, 'projects', `${slug}.cjs`);
  fs.writeFileSync(dst, `/* GENERATED from ${path.basename(src)} by pitch-to-project.cjs — do not edit.\n * Edit the pitch document and regenerate. */\nmodule.exports = ${JSON.stringify(proj, null, 2)};\n`);
  console.log(`\nwrote ${path.relative(process.cwd(), dst)}`);
} else {
  console.log('\n(dry run — pass --write to emit projects/' + slug + '.cjs)');
}
