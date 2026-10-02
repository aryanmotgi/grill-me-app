// The stage's card: a 65% see-through glass panel whose edges breathe in
// slow waves, with a shiny ember rim that flows around it and a few sparks
// drifting off the edge. Canvas2D, one small canvas around the stage, drawn
// under the diagrams so they stay bright. Reduce Motion: still, no sparks.

const MARGIN = 70;      // room around the card for the waves, glow and sparks
const PAD_X = 30, PAD_Y = 26;
const RADIUS = 24;
const SAMPLES = 220;    // points around the edge
const MAX_SPARKS = 26;

interface Spark { u: number; d: number; v: number; life: number; age: number; size: number }

export class GlassCard {
  private ctx: CanvasRenderingContext2D;
  private raf = 0;
  private target: { left: number; top: number; width: number; height: number } | null = null;
  private box = { x: 0, y: 0, w: 0, h: 0 };
  private alpha = 0;
  private sparks: Spark[] = [];
  private t0 = performance.now();
  private last = performance.now();

  constructor(private canvas: HTMLCanvasElement, private reduce: boolean) {
    this.ctx = canvas.getContext("2d")!;
    this.raf = requestAnimationFrame(this.tick);
  }

  /** The stage's rect (or null when there's no stage). */
  setRect(r: { left: number; top: number; width: number; height: number } | null) { this.target = r && r.width ? r : null; }

  /** Where the card is, for click-through (the card itself, no margin). */
  rect(): [number, number, number, number] | null {
    if (this.alpha < .05) return null;
    return [this.box.x - PAD_X, this.box.y - PAD_Y, this.box.w + PAD_X * 2, this.box.h + PAD_Y * 2];
  }

  stop() { cancelAnimationFrame(this.raf); }

  private tick = (now: number) => {
    this.raf = requestAnimationFrame(this.tick);
    const dt = Math.min(.05, (now - this.last) / 1000);
    this.last = now;
    const t = this.reduce ? 0 : (now - this.t0) / 1000;

    // follow the stage (eased, so a step change glides instead of jumping)
    const r = this.target;
    if (r) {
      const k = this.box.w === 0 || this.reduce ? 1 : 1 - Math.pow(.0005, dt);
      this.box.x += (r.left - this.box.x) * k; this.box.y += (r.top - this.box.y) * k;
      this.box.w += (r.width - this.box.w) * k; this.box.h += (r.height - this.box.h) * k;
    }
    this.alpha += ((r ? 1 : 0) - this.alpha) * (this.reduce ? 1 : Math.min(1, dt * 5));
    if (this.alpha < .003 && !r) { this.canvas.style.opacity = "0"; return; }
    this.canvas.style.opacity = "1";

    // size the canvas to the card plus its margin
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const cw = this.box.w + (PAD_X + MARGIN) * 2, ch = this.box.h + (PAD_Y + MARGIN) * 2;
    const left = this.box.x - PAD_X - MARGIN, top = this.box.y - PAD_Y - MARGIN;
    this.canvas.style.left = `${left}px`; this.canvas.style.top = `${top}px`;
    this.canvas.style.width = `${cw}px`; this.canvas.style.height = `${ch}px`;
    const pw = Math.round(cw * dpr), ph = Math.round(ch * dpr);
    if (this.canvas.width !== pw || this.canvas.height !== ph) { this.canvas.width = pw; this.canvas.height = ph; }
    const g = this.ctx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, cw, ch);
    g.globalAlpha = this.alpha;

    // the card's edge: a clean rounded rect (the waves live outside it)
    const W = this.box.w + PAD_X * 2, H = this.box.h + PAD_Y * 2;
    const per = perimeter(W, H);
    const pts: { x: number; y: number; nx: number; ny: number; s: number }[] = [];
    for (let i = 0; i < SAMPLES; i++) {
      const s = i / SAMPLES * per, p = pointAt(s, W, H);
      pts.push({ x: MARGIN + p.x, y: MARGIN + p.y, nx: p.nx, ny: p.ny, s });
    }
    const path = new Path2D();
    pts.forEach((p, i) => (i ? path.lineTo(p.x, p.y) : path.moveTo(p.x, p.y)));
    path.closePath();

    // glass: a 65% see-through ember-dark gradient, with a soft top sheen
    const fill = g.createLinearGradient(MARGIN, MARGIN, MARGIN + W * .6, MARGIN + H);
    fill.addColorStop(0, "rgba(46, 27, 21, .65)");
    fill.addColorStop(.55, "rgba(21, 15, 18, .65)");
    fill.addColorStop(1, "rgba(11, 9, 13, .65)");
    g.save();
    g.shadowColor = "rgba(0, 0, 0, .35)"; g.shadowBlur = 50; g.shadowOffsetY = 18;
    g.fillStyle = fill; g.fill(path);
    g.restore();
    const sheen = g.createLinearGradient(0, MARGIN, 0, MARGIN + H * .5);
    sheen.addColorStop(0, "rgba(255, 210, 170, .07)");
    sheen.addColorStop(1, "rgba(255, 210, 170, 0)");
    g.fillStyle = sheen; g.fill(path);

    // the shiny rim: a crisp hairline, then thin ember ribbons rippling just
    // outside it like heat shimmer, brightest where a band of light flows by
    g.lineJoin = "round"; g.lineCap = "butt"; // butt: round caps overlap into beads
    g.lineWidth = 1; g.strokeStyle = "rgba(255, 255, 255, .11)"; g.stroke(path);
    const head = (t * .045) % 1, tail = .42;
    const glow = (u: number) => {
      let k = 0;
      for (const h of [head, (head + .5) % 1]) {
        const d = (h - u + 1) % 1;
        if (d < tail) k = Math.max(k, Math.pow(1 - d / tail, 2));
        const ahead = (u - h + 1) % 1; // a soft front edge, not a hard cut
        if (ahead < .035) k = Math.max(k, 1 - ahead / .035);
      }
      return .12 + .88 * k; // a faint glow all the way round, bright in the bands
    };
    g.save();
    g.globalCompositeOperation = "lighter";
    const RIBBONS = [
      { base: 1.5, amp: 1.6, len: 120, speed: .55, phase: 0, width: 1.4, a: .95 },
      { base: 4.5, amp: 2.6, len: 170, speed: -.4, phase: 2.1, width: 1, a: .45 },
      { base: 8, amp: 3.4, len: 230, speed: .3, phase: 4.2, width: .8, a: .22 },
    ];
    for (const rb of RIBBONS) {
      const off = (s: number) => rb.base + rb.amp * (.5 + .5 * Math.sin(s / rb.len * Math.PI * 2 + t * rb.speed * 2 + rb.phase));
      const at = (i: number) => { const p = pts[i % SAMPLES], o = off(p.s); return [p.x + p.nx * o, p.y + p.ny * o]; };
      // soft glow pass, then the bright line
      for (const [w, a] of [[rb.width * 6, rb.a * .08], [rb.width, rb.a]] as const) {
        g.lineWidth = w;
        for (let i = 0; i < SAMPLES; i++) {
          const k = glow(i / SAMPLES);
          if (k * a < .004) continue;
          const [x0, y0] = at(i), [x1, y1] = at(i + 1);
          g.strokeStyle = `rgba(255, ${Math.round(110 + 110 * k)}, ${Math.round(45 + 60 * k)}, ${a * k})`;
          g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
        }
      }
    }
    g.restore();

    // sparks: shed from the bright band, drifting outward and fading
    if (!this.reduce) {
      if (this.sparks.length < MAX_SPARKS && Math.random() < dt * 14) {
        const h = Math.random() < .5 ? head : (head + .5) % 1;
        this.sparks.push({ u: (h - Math.random() * .08 + 1) % 1, d: 0, v: 8 + Math.random() * 16, life: 1.2 + Math.random() * 1.6, age: 0, size: .8 + Math.random() * 1.5 });
      }
      g.save();
      g.globalCompositeOperation = "lighter";
      this.sparks = this.sparks.filter((s) => (s.age += dt) < s.life);
      for (const s of this.sparks) {
        s.d += s.v * dt; s.u = (s.u + dt * .004) % 1;
        const p = pts[Math.floor(s.u * SAMPLES) % SAMPLES];
        const x = p.x + p.nx * s.d, y = p.y + p.ny * s.d - s.age * 6;
        const k = Math.sin(Math.PI * s.age / s.life);
        const grd = g.createRadialGradient(x, y, 0, x, y, s.size * 4);
        grd.addColorStop(0, `rgba(255, 220, 160, ${.9 * k})`);
        grd.addColorStop(.35, `rgba(255, 130, 60, ${.5 * k})`);
        grd.addColorStop(1, "rgba(255, 90, 30, 0)");
        g.fillStyle = grd;
        g.beginPath(); g.arc(x, y, s.size * 4, 0, Math.PI * 2); g.fill();
      }
      g.restore();
    }
  };
}

// ---- rounded-rect perimeter, walked by distance -----------------------------------
function perimeter(w: number, h: number) {
  const r = Math.min(RADIUS, w / 2, h / 2);
  return 2 * (w - 2 * r) + 2 * (h - 2 * r) + 2 * Math.PI * r;
}

/** Point (and outward normal) at distance s along a rounded rect, clockwise from top-left. */
function pointAt(s: number, w: number, h: number) {
  const r = Math.min(RADIUS, w / 2, h / 2);
  const sw = w - 2 * r, sh = h - 2 * r, arc = Math.PI * r / 2;
  const segs: [number, (d: number) => { x: number; y: number; nx: number; ny: number }][] = [
    [sw, (d) => ({ x: r + d, y: 0, nx: 0, ny: -1 })],
    [arc, (d) => corner(w - r, r, -Math.PI / 2 + d / r)],
    [sh, (d) => ({ x: w, y: r + d, nx: 1, ny: 0 })],
    [arc, (d) => corner(w - r, h - r, d / r)],
    [sw, (d) => ({ x: w - r - d, y: h, nx: 0, ny: 1 })],
    [arc, (d) => corner(r, h - r, Math.PI / 2 + d / r)],
    [sh, (d) => ({ x: 0, y: h - r - d, nx: -1, ny: 0 })],
    [arc, (d) => corner(r, r, Math.PI + d / r)],
  ];
  for (const [len, f] of segs) {
    if (s <= len) return f(s);
    s -= len;
  }
  return { x: r, y: 0, nx: 0, ny: -1 };
  function corner(cx: number, cy: number, a: number) {
    const nx = Math.cos(a), ny = Math.sin(a);
    return { x: cx + nx * r, y: cy + ny * r, nx, ny };
  }
}
