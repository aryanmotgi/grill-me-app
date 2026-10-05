/* visuals.js — themed diagram recipes for the Slides subset.
 *
 * Every recipe takes (t, data) where t is a theme token bag and returns an
 * HTML string built ONLY from the closed slide subset: div / p / x-shape.
 * Nothing external, no <img>, no data: URIs — the diagram is stored inside
 * the slide file itself, so a theme swap recolors it and nothing can 404.
 *
 * No recipe invents a number. Anything the project has not measured renders
 * as an em dash and the caller is expected to say so on the slide.
 */

const px = n => `${Math.round(n)}px`;
const W = 1664;                       // canvas width inside 128px margins
const dot = (t, size, color) =>
  `<div style="width:${px(size)};height:${px(size)};background:${color};border-radius:50%"></div>`;

/* ---- flow: n stages left to right, arrows between ---------------------- */
function flow(t, { steps }) {
  const parts = [];
  steps.forEach((s, i) => {
    if (i) parts.push(`<x-shape kind="arrow-right" style="width:48px;height:24px;background:${t.accent}"></x-shape>`);
    parts.push(
      `<div style="flex:1;display:flex;flex-direction:column;gap:14px;background:${t.cardBg};border:1px solid ${t.line};border-radius:${t.cardR};padding:40px">
<h3 style="font-family:${t.disp};font-size:34px;font-weight:${t.dispW};color:${t.ink}">${s.title}</h3>
<p style="font-size:26px;line-height:1.4;color:${t.muted}">${s.body}</p>
</div>`);
  });
  return `<div style="display:flex;gap:22px;align-items:center">${parts.join('')}</div>`;
}

/* ---- split: two panels, one divider ----------------------------------- */
function split(t, { left, right }) {
  const panel = (p, hot) =>
    `<div style="flex:1;display:flex;flex-direction:column;gap:18px;justify-content:center;padding:52px">
<p style="font-family:${t.eyeF};font-size:24px;font-weight:600;letter-spacing:${t.eyeTrack};text-transform:uppercase;color:${hot ? t.risk : t.accent}">${p.kicker}</p>
<h3 style="font-family:${t.disp};font-size:54px;font-weight:${t.dispW};color:${t.ink}">${p.title}</h3>
<p style="font-size:30px;line-height:1.45;color:${t.muted}">${p.body}</p>
</div>`;
  return `<div style="display:flex;align-items:stretch;background:${t.cardBg};border:1px solid ${t.line};border-radius:${t.cardR}">
${panel(left, false)}
<div style="width:1px;background:${t.line}"></div>
${panel(right, true)}
</div>`;
}

/* ---- timeline: marks along an axis, one of them hot ------------------- */
function timeline(t, { marks, height = 300 }) {
  const n = marks.length, pad = 150, span = W - pad * 2;
  const bits = [`<div style="position:absolute;left:0px;top:${px(height / 2)};width:${px(W)};height:2px;background:${t.line}"></div>`];
  marks.forEach((m, i) => {
    const x = pad + (n === 1 ? span / 2 : (span * i) / (n - 1));
    const c = m.hot ? t.risk : t.accent;
    bits.push(`<div style="position:absolute;left:${px(x - 13)};top:${px(height / 2 - 12)};width:26px;height:26px;background:${c};border-radius:50%"></div>`);
    bits.push(`<p style="position:absolute;left:${px(x - 160)};top:${px(height / 2 - 118)};width:320px;text-align:center;font-family:${t.disp};font-size:36px;font-weight:${t.dispW};line-height:1.15;color:${m.hot ? t.risk : t.ink}">${m.label}</p>`);
    bits.push(`<p style="position:absolute;left:${px(x - 160)};top:${px(height / 2 + 36)};width:320px;text-align:center;font-size:26px;line-height:1.35;color:${t.muted}">${m.sub}</p>`);
  });
  return `<div style="position:relative;width:${px(W)};height:${px(height)}">${bits.join('')}</div>`;
}

/* ---- stack: a × b × c = total, the bottom-up market math -------------- */
function stack(t, { terms, total }) {
  const cell = (v, label, hot) =>
    `<div style="flex:1;display:flex;flex-direction:column;gap:12px;background:${hot ? 'transparent' : t.cardBg};border:1px solid ${hot ? t.accent : t.line};border-radius:${t.cardR};padding:40px">
<p style="font-family:${t.disp};font-size:84px;font-weight:${t.dispW};line-height:1;color:${hot ? t.accent : t.ink}">${v}</p>
<p style="font-size:26px;line-height:1.35;color:${t.muted}">${label}</p>
</div>`;
  const op = s => `<p style="font-family:${t.disp};font-size:52px;font-weight:${t.dispW};color:${t.muted}">${s}</p>`;
  const parts = [];
  terms.forEach((x, i) => { if (i) parts.push(op('&#215;')); parts.push(cell(x.value, x.label, false)); });
  parts.push(op('='));
  parts.push(cell(total.value, total.label, true));
  return `<div style="display:flex;gap:22px;align-items:center">${parts.join('')}</div>`;
}

/* ---- bars: labelled horizontal bars, values the project actually has -- */
function bars(t, { rows, track = 940 }) {
  const out = rows.map(r => {
    const w = Math.max(0, Math.min(100, r.pct)) * track / 100;
    const c = r.hot ? t.accent : t.line;
    return `<div style="display:flex;align-items:center;gap:28px">
<p style="width:400px;font-size:30px;line-height:1.3;color:${r.hot ? t.ink : t.muted}">${r.label}</p>
<div style="position:relative;width:${px(track)};height:44px;background:${t.cardBg};border:1px solid ${t.line};border-radius:8px">
<div style="position:absolute;left:0px;top:0px;width:${px(w)};height:44px;background:${c};border-radius:8px"></div>
</div>
<p style="width:200px;font-family:${t.disp};font-size:34px;font-weight:${t.dispW};color:${r.hot ? t.accent : t.muted}">${r.value}</p>
</div>`;
  });
  return `<div style="display:flex;flex-direction:column;gap:22px">${out.join('')}</div>`;
}

/* ---- quadrant: a 2x2 positioning map with plotted players ------------- */
function quadrant(t, { poles, points, height = 460 }) {
  const pole = (txt, left, top, width, align) =>
    `<p style="position:absolute;left:${px(left)};top:${px(top)};width:${px(width)};text-align:${align};font-family:${t.eyeF};font-size:24px;letter-spacing:2px;text-transform:uppercase;color:${t.muted}">${txt}</p>`;
  const bits = [
    `<div style="position:absolute;left:${px(W / 2)};top:0px;width:1px;height:${px(height)};background:${t.line}"></div>`,
    `<div style="position:absolute;left:0px;top:${px(height / 2)};width:${px(W)};height:1px;background:${t.line}"></div>`,
    pole(poles.top, 0, 16, W, 'center'),
    pole(poles.bottom, 0, height - 44, W, 'center'),
    pole(poles.left, 24, height / 2 - 48, 440, 'left'),
    pole(poles.right, W - 464, height / 2 - 48, 440, 'right'),
  ];
  points.forEach(p => {
    const x = Math.max(0.1, Math.min(0.9, p.x)) * W;
    const y = (1 - Math.max(0.14, Math.min(0.86, p.y))) * height;
    const c = p.hot ? t.accent : t.muted;
    const s = p.hot ? 30 : 22;
    bits.push(`<div style="position:absolute;left:${px(x - s / 2)};top:${px(y - s / 2)};width:${px(s)};height:${px(s)};background:${c};border-radius:50%"></div>`);
    bits.push(`<p style="position:absolute;left:${px(x - 190)};top:${px(y + 26)};width:380px;text-align:center;font-family:${t.disp};font-size:${p.hot ? 40 : 34}px;font-weight:${t.dispW};color:${p.hot ? t.accent : t.ink}">${p.label}</p>`);
    bits.push(`<p style="position:absolute;left:${px(x - 190)};top:${px(y + (p.hot ? 80 : 72))};width:380px;text-align:center;font-size:25px;line-height:1.3;color:${t.muted}">${p.sub}</p>`);
  });
  return `<div style="position:relative;width:${px(W)};height:${px(height)};background:${t.cardBg};border:1px solid ${t.line};border-radius:${t.cardR}">${bits.join('')}</div>`;
}

/* ---- rings: concentric expansion. layers[0] is the wedge you sell today */
function rings(t, { layers, height = 440 }) {
  const cx = 420, cy = height / 2, n = Math.min(layers.length, 4);
  const sizes = [[440, 400], [336, 306], [232, 212], [128, 118]];   // outer to inner
  const bits = [];
  for (let i = 0; i < n; i++) {                                     // outermost first
    const [w, h] = sizes[i], innermost = i === n - 1;
    bits.push(`<x-shape kind="ellipse" style="position:absolute;left:${px(cx - w / 2)};top:${px(cy - h / 2)};width:${px(w)};height:${px(h)};background:${innermost ? t.accent : 'transparent'};border:2px solid ${t.accent};opacity:${(0.4 + i * 0.2).toFixed(2)}"></x-shape>`);
  }
  layers.slice(0, 4).forEach((l, i) => {                            // legend: inner first
    const y = 30 + i * 98;
    bits.push(`<div style="position:absolute;left:900px;top:${px(y + 10)};width:18px;height:18px;background:${i === 0 ? t.accent : t.muted};border-radius:50%"></div>`);
    bits.push(`<p style="position:absolute;left:940px;top:${px(y)};width:700px;font-family:${t.disp};font-size:38px;font-weight:${t.dispW};color:${i === 0 ? t.accent : t.ink}">${l.label}</p>`);
    bits.push(`<p style="position:absolute;left:940px;top:${px(y + 48)};width:700px;font-size:26px;line-height:1.3;color:${t.muted}">${l.sub}</p>`);
  });
  return `<div style="position:relative;width:${px(W)};height:${px(height)}">${bits.join('')}</div>`;
}

module.exports = { flow, split, timeline, stack, bars, quadrant, rings, dot, W };
