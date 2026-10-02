// ---------------------------------------------------------------------------
// The forge world: what moves and why. Rendering is all on the GPU
// (gl.ts); this file only decides where things are. Ambient embers cost
// nothing here (their motion lives in a shader); the CPU only moves the few
// hundred points that act with intent: the logo, bursts, scouts, the
// constellation, AI orbs and stage beacons. Labels are DOM (crisp text).
//
// Reduce Motion: no drifting, nothing flies; things appear in place.
// Lite (auto when frames run long): fewer ambient embers, 1× resolution.
// ---------------------------------------------------------------------------

import { EmberGL, type GLLine, type GLPoint } from "./gl";

export interface StarSpec { id: string; label: string; kind: "agent" | "kid" | "mate"; sub?: string; parent?: string }
interface Star extends StarSpec { x: number; y: number; tx: number; ty: number; op: number; top: number; orbit: boolean; ang: number; rad: number; el: HTMLDivElement; parentStar?: Star; home?: [number, number, boolean] }
interface Mote { x: number; y: number; vx: number; vy: number; tx: number; ty: number; mode: "hold" | "burst" | "seek" | "rise"; temp: number; cool: number; size: number; alpha: number; soft: number; life: number; speed: number; done?: () => void }
export interface Beacon { x: number; y: number; lit: number; size: number; pulse?: boolean }
export interface PathPoint { x: number; y: number; lit: boolean }

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export class ForgeWorld {
  reduce: boolean;
  lite = false;
  W = innerWidth;
  H = innerHeight;
  readonly gl: EmberGL;
  private motes: Mote[] = [];
  private stars: Star[] = [];
  private links: [Star, Star, number][] = [];
  private path: PathPoint[] | null = null;
  private beacons = new Map<string, Beacon & { cur: number }>();
  private dim = 0;
  private tdim = 0;
  private calm = 0;
  private tcalm = 0;
  private raf = 0;
  private last = 0;
  private t0 = 0;
  private slow = 0;
  private frames = 0;
  /** CPU time spent per frame (ms), for the perf probe */
  workMs = 0;
  private workN = 0;
  workAvg() { return this.workN ? Math.round((this.workMs / this.workN) * 100) / 100 : 0; }
  spark = { x: 0, y: 0, tx: 0, ty: 0, r: 0, tr: 20, glow: 1, born: false, speaking: false, ring: 0, alpha: 1, energy: 0 };
  onFrame?: (spark: { x: number; y: number; r: number }) => void;
  onLite?: () => void;

  constructor(canvas: HTMLCanvasElement, private starLayer: HTMLDivElement, reduce: boolean) {
    this.reduce = reduce;
    this.gl = new EmberGL(canvas, 700);
    this.resize();
    addEventListener("resize", this.resize);
  }

  resize = () => {
    this.W = innerWidth;
    this.H = innerHeight;
    this.gl.resize(this.W, this.H, this.lite ? 1 : Math.min(devicePixelRatio || 1, 2));
  };

  setLite(on: boolean) {
    this.lite = on;
    this.gl.setAmbient(on ? 260 : 700);
    this.resize();
  }

  start() {
    this.t0 = this.last = performance.now();
    const loop = (now: number) => { this.frame(now); this.raf = requestAnimationFrame(loop); };
    this.raf = requestAnimationFrame(loop);
  }
  stop() {
    cancelAnimationFrame(this.raf);
    removeEventListener("resize", this.resize);
    this.starLayer.innerHTML = "";
  }

  // ---- the Spark ----------------------------------------------------------------
  sparkBorn(x: number, y: number) { Object.assign(this.spark, { x, y, tx: x, ty: y, r: this.reduce ? this.spark.tr : 0, born: true, alpha: 1 }); }
  sparkTo(x: number, y: number, r?: number) {
    this.spark.tx = x; this.spark.ty = y;
    if (r) this.spark.tr = r;
    if (this.reduce) { this.spark.x = x; this.spark.y = y; }
  }
  /** an answer was absorbed: a little brighter */
  feed() {
    this.spark.tr = Math.min(this.spark.tr + 2, 32);
    this.spark.glow = Math.min(2.2, this.spark.glow + .2);
    this.burstAt(this.spark.x, this.spark.y, 18, .9);
  }
  setDim(on: boolean) { this.tdim = on ? 1 : 0; }

  // ---- motes: points that act with intent ------------------------------------------
  private mote(x: number, y: number, o: Partial<Mote> = {}): Mote {
    const m: Mote = { x, y, vx: 0, vy: 0, tx: x, ty: y, mode: "burst", temp: 1, cool: .35, size: rand(1.4, 3.2), alpha: 1, soft: 0, life: 1, speed: 3, ...o };
    this.motes.push(m);
    return m;
  }
  burstAt(x: number, y: number, n = 30, temp = 1) {
    if (this.reduce) return;
    for (let i = 0; i < n; i++) {
      const a = rand(0, 6.283), sp = rand(40, 220);
      this.mote(x, y, { vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 30, temp: temp * rand(.8, 1), cool: rand(.5, .9), size: rand(1.2, 3) });
    }
  }

  /** First run: embers rise and gather into the wordmark, hold, then burst
   *  outward, and the Spark is born from the middle. */
  async logoBurst(text: string, wait: (ms: number) => Promise<void>) {
    const pts = this.textPoints(text, Math.min(this.W * .11, 128));
    const cx = this.W / 2, cy = this.H * .45;
    // embers rise from below and settle into the letters, warming as they arrive
    const logo = pts.slice(0, this.lite ? 600 : 1300).map((p) => this.mote(this.reduce ? p.x : p.x + rand(-160, 160), this.reduce ? p.y : this.H + rand(20, 260), {
      mode: "seek", tx: p.x, ty: p.y, speed: rand(2.2, 3.2), temp: rand(.75, .95), cool: 0, size: rand(2.2, 3.4), life: 1,
    }));
    await wait(1900);
    for (const m of logo) { m.mode = "hold"; m.temp = rand(.85, 1); m.x = m.tx; m.y = m.ty; }
    await wait(1500);
    for (const m of logo) {
      if (this.reduce) { m.life = 0; continue; }
      const a = Math.atan2(m.y - cy, m.x - cx) + rand(-.4, .4), sp = rand(120, 520);
      Object.assign(m, { mode: "burst", vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, cool: rand(.25, .55) });
    }
    await wait(350);
    this.sparkBorn(cx, cy);
    this.sparkTo(cx, this.H * .34, 20);
    await wait(900);
  }

  private textPoints(text: string, size: number) {
    const c = document.createElement("canvas"), x = c.getContext("2d")!;
    c.width = this.W; c.height = this.H;
    x.font = `600 ${size}px -apple-system, "SF Pro Display", "Helvetica Neue", sans-serif`;
    x.textAlign = "center"; x.textBaseline = "middle"; x.fillStyle = "#fff";
    x.fillText(text, this.W / 2, this.H * .45);
    const d = x.getImageData(0, 0, this.W, this.H).data, out: { x: number; y: number }[] = [];
    for (let y = 0; y < this.H; y += 3) for (let xx = 0; xx < this.W; xx += 3) if (d[(y * this.W + xx) * 4 + 3] > 140) out.push({ x: xx + rand(-.8, .8), y: y + rand(-.8, .8) });
    return out.sort(() => Math.random() - .5);
  }

  /** Embers fly out from the Spark to the edges (the scan is looking)… */
  scoutOut(): Mote[] {
    const out: Mote[] = [];
    if (this.reduce) return out;
    for (let i = 0; i < (this.lite ? 30 : 60); i++) {
      const a = rand(0, 6.283), d = Math.max(this.W, this.H) * .65;
      out.push(this.mote(this.spark.x, this.spark.y, { mode: "seek", tx: this.W / 2 + Math.cos(a) * d, ty: this.H / 2 + Math.sin(a) * d, speed: rand(1.4, 2.2), temp: .9, cool: 0, size: rand(1.6, 2.6) }));
    }
    return out;
  }
  /** …and come back. */
  scoutBack(scouts: Mote[]) {
    for (const m of scouts) Object.assign(m, { tx: this.spark.x + rand(-30, 30), ty: this.spark.y + rand(-30, 30), speed: rand(1.6, 2.4), done: () => { m.mode = "burst"; m.vx = rand(-40, 40); m.vy = rand(-60, -10); m.cool = .8; } });
  }

  // ---- constellation -------------------------------------------------------------------
  setStars(specs: StarSpec[], links: [string, string][] = []) {
    this.starLayer.innerHTML = "";
    this.stars = [];
    this.links = [];
    const agents = specs.filter((s) => s.kind === "agent");
    const cx = this.W / 2, cy = this.H * .5, spread = Math.min(this.W * .19, 250);
    for (const spec of specs) {
      const el = document.createElement("div");
      el.className = `forge-star ${spec.kind}`;
      el.textContent = spec.label;
      if (spec.sub) { const em = document.createElement("em"); em.textContent = spec.sub; el.append(em); }
      this.starLayer.append(el);
      this.stars.push({ ...spec, x: cx, y: cy, tx: cx, ty: cy, op: 0, top: 0, orbit: false, ang: 0, rad: 0, el });
    }
    agents.forEach((a, i) => {
      const s = this.stars.find((x) => x.id === a.id)!;
      s.tx = cx + (i - (agents.length - 1) / 2) * spread * 2;
      s.ty = cy;
    });
    const byParent = new Map<string, Star[]>();
    for (const s of this.stars) if (s.parent) byParent.set(s.parent, [...(byParent.get(s.parent) ?? []), s]);
    for (const [pid, kids] of byParent) {
      const p = this.stars.find((x) => x.id === pid);
      if (!p) continue;
      kids.forEach((k, j) => {
        Object.assign(k, { parentStar: p, orbit: true, rad: Math.min(150, this.W * .11) + (j % 2) * 28, ang: (j / kids.length) * 6.283 + agents.indexOf(p) * .7 });
        k.tx = p.tx + Math.cos(k.ang) * k.rad;
        k.ty = p.ty + Math.sin(k.ang) * k.rad * .6;
        this.links.push([p, k, .5]);
      });
    }
    for (const [a, b] of links) {
      const sa = this.stars.find((s) => s.id === a), sb = this.stars.find((s) => s.id === b);
      if (sa && sb) this.links.push([sa, sb, .25]);
    }
    for (const s of this.stars) { s.x = s.tx + (s.tx - cx) * 1.8; s.y = s.ty + (s.ty - cy) * 1.8; }
  }
  async revealStars(wait: (ms: number) => Promise<void>) {
    for (const s of this.stars) { s.top = 1; await wait(this.reduce ? 0 : 90); }
  }
  showAllStars() { for (const s of this.stars) { s.top = 1; s.op = 1; s.x = s.tx; s.y = s.ty; } }
  hasStars() { return this.stars.length > 0; }
  /** During the interview the constellation steps back to a faint arc near the top. */
  recede(on: boolean) {
    this.starLayer.classList.toggle("recede", on);
    if (on) {
      this.stars.forEach((s, i) => {
        s.home = [s.tx, s.ty, s.orbit];
        s.orbit = false;
        const a = Math.PI * (.1 + .8 * (i / Math.max(1, this.stars.length - 1)));
        s.tx = this.W / 2 - Math.cos(a) * this.W * .42;
        s.ty = this.H * .08 + (1 - Math.sin(a)) * this.H * .16;
      });
    } else for (const s of this.stars) if (s.home) [s.tx, s.ty, s.orbit] = s.home;
  }
  /** Stars pull into a line, then each flies into its stage (or fades). */
  async forgeLine(stageOf: (label: string) => number | null, slots: { x: number; y: number }[], wait: (ms: number) => Promise<void>) {
    const x0 = slots[0].x, x1 = slots[slots.length - 1].x, y = slots[0].y;
    this.links = [];
    this.stars.forEach((s, i) => { s.orbit = false; s.tx = lerp(x0, x1, (i + .5) / this.stars.length); s.ty = y; });
    await wait(1000);
    for (const s of this.stars) {
      const i = stageOf(s.label);
      if (i != null && slots[i]) { s.tx = slots[i].x; s.ty = slots[i].y; } else s.ty = s.y + 24;
      s.top = 0;
    }
    await wait(700);
    this.starLayer.innerHTML = "";
    this.stars = [];
  }
  hideStars() { for (const s of this.stars) s.top = 0; this.links = []; }
  addMate(id: string, label: string, side: number) {
    const el = document.createElement("div");
    el.className = "forge-star mate";
    el.textContent = label;
    this.starLayer.append(el);
    const s: Star = { id, label, kind: "mate", x: side > 0 ? this.W + 40 : -40, y: this.H * rand(.3, .8), tx: this.W / 2 + side * Math.min(this.W * .3, 380), ty: this.H * .76, op: 0, top: 1, orbit: false, ang: 0, rad: 0, el };
    this.stars.push(s);
    for (const a of this.stars.filter((x) => x.kind === "agent")) this.links.push([s, a, .3]);
  }

  // ---- beacons (AI orbs, stages) and the path ---------------------------------------------
  setBeacon(id: string, b: Beacon | null) {
    if (!b) { this.beacons.delete(id); return; }
    const prev = this.beacons.get(id);
    if (prev && b.lit > prev.lit + .3) this.burstAt(b.x, b.y, 34, 1);
    this.beacons.set(id, { ...b, cur: prev?.cur ?? (this.reduce ? b.lit : 0) });
  }
  clearBeacons() { this.beacons.clear(); }
  setPath(points: PathPoint[] | null) { this.path = points; }

  /** Finale: everything is drawn into the centre. */
  collapse() {
    this.links = [];
    this.path = null;
    this.tdim = 0;
    for (const s of this.stars) { s.orbit = false; s.tx = this.W / 2; s.ty = this.H / 2; s.top = 0; }
    for (const [id, b] of this.beacons) { this.mote(b.x, b.y, { mode: "seek", tx: this.W / 2, ty: this.H / 2, speed: 2.4, temp: 1, cool: 0, size: 3, done: () => {} }); this.beacons.delete(id); }
    if (!this.reduce) for (let i = 0; i < (this.lite ? 60 : 160); i++) {
      const a = rand(0, 6.283), d = rand(.3, .7) * Math.max(this.W, this.H);
      this.mote(this.W / 2 + Math.cos(a) * d, this.H / 2 + Math.sin(a) * d, { mode: "seek", tx: this.W / 2, ty: this.H / 2, speed: rand(1.4, 2.6), temp: rand(.7, 1), cool: 0, size: rand(1.4, 2.8) });
    }
    this.sparkTo(this.W / 2, this.H / 2, 14);
    this.tcalm = 1;
  }
  fadeSpark() { this.spark.alpha = 0; }

  // ---- frame ------------------------------------------------------------------------------
  private frame(now: number) {
    const w0 = performance.now();
    this.frameInner(now);
    this.gl.gl.flush();
    this.workMs += performance.now() - w0;
    this.workN++;
  }
  private frameInner(now: number) {
    const dt = Math.min(1 / 30, (now - this.last) / 1000);
    const real = now - this.last;
    this.last = now;
    const t = (now - this.t0) / 1000;
    if (!this.lite && this.frames < 150) {
      this.frames++;
      if (real > 1000 / 24) this.slow++;
      if (this.frames === 150 && this.slow > 50) { this.setLite(true); this.onLite?.(); }
    }
    const { W, H, reduce } = this;
    this.dim = lerp(this.dim, this.tdim, reduce ? 1 : clamp(dt * 3.5));
    this.calm = lerp(this.calm, this.tcalm, reduce ? 1 : clamp(dt * 1.5));

    const pts: GLPoint[] = [];
    // motes
    const keep: Mote[] = [];
    for (const m of this.motes) {
      if (m.mode === "burst") {
        m.vx *= Math.pow(.18, dt); m.vy = m.vy * Math.pow(.18, dt) - 22 * dt; // drag, then heat lifts it
        m.x += m.vx * dt; m.y += m.vy * dt;
        m.temp -= m.cool * dt;
      } else if (m.mode === "seek") {
        const k = reduce ? 1 : clamp(dt * m.speed);
        m.x = lerp(m.x, m.tx, k); m.y = lerp(m.y, m.ty, k);
        if (m.done && Math.abs(m.x - m.tx) + Math.abs(m.y - m.ty) < 3) { const f = m.done; m.done = undefined; f(); }
        if (this.tcalm && Math.abs(m.x - m.tx) + Math.abs(m.y - m.ty) < 6) m.temp -= dt * 2;
      } else if (m.mode === "hold") {
        m.x += Math.sin(t * 2 + m.y) * .05;
      }
      if (m.temp <= 0.02 || m.life <= 0 || m.y < -40) continue;
      keep.push(m);
      const flick = .82 + .18 * Math.sin(t * 13 + m.x * .7);
      pts.push({ x: m.x, y: m.y, size: m.size, temp: clamp(m.temp) * flick, alpha: m.alpha, soft: m.soft });
    }
    this.motes = keep;

    // the Spark sheds a tiny ember now and then, like a real coal
    const sp = this.spark;
    if (sp.born && !reduce && Math.random() < dt * (sp.speaking ? 9 : 3)) {
      this.mote(sp.x + rand(-sp.r, sp.r) * .5, sp.y, { vx: rand(-20, 20), vy: rand(-70, -30), temp: rand(.8, 1), cool: rand(.5, .9), size: rand(1, 2) });
    }

    // beacons: dim orbs that ignite
    for (const b of this.beacons.values()) {
      b.cur = lerp(b.cur, b.lit, reduce ? 1 : clamp(dt * 2.5));
      const pulse = b.pulse && !reduce ? .5 + .5 * Math.sin(t * 5) : 0;
      const breath = reduce ? 1 : .92 + .08 * Math.sin(t * 1.7 + b.x);
      pts.push({ x: b.x, y: b.y, size: b.size * (.55 + .45 * b.cur) * breath, temp: .22 + .73 * b.cur + pulse * .15, alpha: .5 + .5 * b.cur, soft: .65 });
      if (b.cur > .5) pts.push({ x: b.x, y: b.y, size: b.size * .28, temp: 1, alpha: b.cur, soft: 0 });
      if (pulse) pts.push({ x: b.x, y: b.y, size: b.size * (1.6 + pulse), temp: .6, alpha: .25 * pulse, soft: 1 });
    }

    // constellation
    for (const s of this.stars) {
      if (s.parentStar && s.orbit && !reduce) {
        s.ang += dt * .1;
        s.tx = s.parentStar.x + Math.cos(s.ang) * s.rad;
        s.ty = s.parentStar.y + Math.sin(s.ang) * s.rad * .6;
      }
      const k = reduce ? 1 : clamp(dt * 2.6);
      s.x = lerp(s.x, s.tx, k); s.y = lerp(s.y, s.ty, k);
      s.op = lerp(s.op, s.top, reduce ? 1 : clamp(dt * 3));
      const recede = this.starLayer.classList.contains("recede") ? .3 : 1;
      const big = s.kind === "agent" ? 7 : s.kind === "mate" ? 5 : 3;
      if (s.op > .02) pts.push({ x: s.x, y: s.y, size: big, temp: s.kind === "mate" ? .7 : .92, alpha: s.op * recede, soft: 0 }, { x: s.x, y: s.y, size: big * 4, temp: .55, alpha: s.op * .35 * recede, soft: 1 });
      s.el.style.transform = `translate(${s.x}px, ${s.y + big + 8}px) translate(-50%, 0)`;
      s.el.style.opacity = String(s.op);
    }

    const lines: GLLine[] = [];
    for (const [a, b, w] of this.links) {
      const al = w * Math.min(a.op, b.op) * (1 - this.dim * .85) * .55;
      if (al > .01) lines.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, r: 1, g: .62, b: .3, a: al });
    }
    if (this.path) {
      for (let i = 0; i < this.path.length - 1; i++) {
        const a = this.path[i], b = this.path[i + 1], lit = a.lit && b.lit;
        lines.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, r: 1, g: lit ? .55 : 1, b: lit ? .2 : 1, a: lit ? .7 : .14, dotted: !lit });
        // heat travelling along lit stretches
        if (lit && !reduce) for (let j = 0; j < 3; j++) {
          const u = ((t * .35 + j / 3 + i * .17) % 1);
          pts.push({ x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u), size: 2.2, temp: .95, alpha: Math.sin(u * Math.PI), soft: 0 });
        }
      }
    }

    // the Spark
    if (sp.born) {
      const k = reduce ? 1 : clamp(dt * 2.2);
      sp.x = lerp(sp.x, sp.tx, k); sp.y = lerp(sp.y, sp.ty, k);
      sp.r = lerp(sp.r, sp.tr, reduce ? 1 : clamp(dt * 2.5));
      sp.energy = lerp(sp.energy, sp.speaking && !reduce ? 1 + .5 * Math.sin(t * 11) : 0, clamp(dt * 8));
    }
    this.gl.draw({
      time: t, w: W, h: H, dim: this.dim, calm: this.calm,
      points: pts, lines,
      spark: sp.born ? { x: sp.x, y: sp.y, r: sp.r, energy: sp.energy, glow: sp.glow, alpha: sp.alpha } : null,
    });
    if (sp.born) this.onFrame?.({ x: sp.x, y: sp.y, r: sp.r });
  }
}
