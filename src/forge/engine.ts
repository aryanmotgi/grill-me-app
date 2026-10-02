// ---------------------------------------------------------------------------
// The forge world: what moves and why. It floats over the user's own apps:
// no background at all, just the Spark, a few embers with intent, and the
// diagrams, which are 3D (perspective, slow camera orbit, depth-sorted
// labels).
//
// Two layers so it reads on any app, light or dark:
//   • shade (Canvas 2D, underneath): soft dark halos under every light and
//     a dark outline under every line, so they stand out on white too;
//   • light (WebGL, gl.ts, on top): the Spark, glows, embers.
// Labels are DOM, so text stays crisp.
// ---------------------------------------------------------------------------

import { EmberGL, type GLPoint } from "./gl";

export interface StarSpec { id: string; label: string; kind: "agent" | "kid" | "mate"; sub?: string; parent?: string }
export interface StageSpec { id: string; name: string; sub: string; lit: boolean }
interface V3 { x: number; y: number; z: number }
interface Star extends StarSpec {
  p: V3;            // place in the 3D scene
  sx: number; sy: number; ss: number; // where it is on screen now (+ depth scale)
  flat: { x: number; y: number } | null; // overrides 3D (recede, forging the line)
  op: number; top: number; el: HTMLDivElement; parentStar?: Star; ang: number; rad: number; tilt: number;
}
interface Stage extends StageSpec { p: V3; sx: number; sy: number; ss: number; cur: number; el: HTMLDivElement; pulse: boolean }
interface Mote { x: number; y: number; vx: number; vy: number; tx: number; ty: number; mode: "hold" | "burst" | "seek"; temp: number; cool: number; size: number; speed: number; done?: () => void }
export interface Beacon { x: number; y: number; lit: number; size: number; pulse?: boolean }

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export class ForgeWorld {
  reduce: boolean;
  lite = false;
  W = innerWidth;
  H = innerHeight;
  readonly gl: EmberGL;
  private shade: CanvasRenderingContext2D;
  private shadeCanvas: HTMLCanvasElement;
  private motes: Mote[] = [];
  private stars: Star[] = [];
  private links: [Star, Star, number][] = [];
  private stages: Stage[] = [];
  private beacons = new Map<string, Beacon & { cur: number }>();
  private raf = 0;
  private last = 0;
  private t0 = 0;
  private yaw = 0;
  private fading = false;
  workMs = 0;
  private workN = 0;
  spark = { x: 0, y: 0, tx: 0, ty: 0, r: 0, tr: 22, glow: 1, born: false, speaking: false, alpha: 1, energy: 0 };
  onFrame?: (spark: { x: number; y: number; r: number }) => void;
  onLite?: () => void;

  constructor(glCanvas: HTMLCanvasElement, shadeCanvas: HTMLCanvasElement, private labels: HTMLDivElement, reduce: boolean) {
    this.reduce = reduce;
    // no background: the GPU draws light only, over a fully clear canvas
    this.gl = new EmberGL(glCanvas, 0, true);
    this.shadeCanvas = shadeCanvas;
    this.shade = shadeCanvas.getContext("2d")!;
    this.resize();
    addEventListener("resize", this.resize);
  }

  resize = () => {
    this.W = innerWidth;
    this.H = innerHeight;
    const dpr = this.lite ? 1 : Math.min(devicePixelRatio || 1, 2);
    this.gl.resize(this.W, this.H, dpr);
    this.shadeCanvas.width = Math.round(this.W * dpr);
    this.shadeCanvas.height = Math.round(this.H * dpr);
    this.shade.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  setLite(on: boolean) { this.lite = on; this.resize(); }
  workAvg() { return this.workN ? Math.round((this.workMs / this.workN) * 100) / 100 : 0; }

  start() {
    this.t0 = this.last = performance.now();
    const loop = (now: number) => {
      const w0 = performance.now();
      this.frame(now);
      this.workMs += performance.now() - w0; this.workN++;
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }
  stop() {
    cancelAnimationFrame(this.raf);
    removeEventListener("resize", this.resize);
    this.labels.innerHTML = "";
  }

  // ---- the Spark --------------------------------------------------------------------
  sparkBorn(x: number, y: number) { Object.assign(this.spark, { x, y, tx: x, ty: y, r: this.reduce ? this.spark.tr : 0, born: true, alpha: 1 }); }
  sparkTo(x: number, y: number, r?: number) {
    this.spark.tx = x; this.spark.ty = y;
    if (r) this.spark.tr = r;
    if (this.reduce) { this.spark.x = x; this.spark.y = y; }
  }
  feed() {
    this.spark.tr = Math.min(this.spark.tr + 2, 32);
    this.spark.glow = Math.min(2.2, this.spark.glow + .2);
    this.burstAt(this.spark.x, this.spark.y, 18, .9);
  }
  /** kept for the scenes; with no background there's nothing to dim */
  setDim(_on: boolean) {}
  fadeSpark() { this.spark.alpha = 0; }
  /** the Spark's area on screen (it's clickable) */
  sparkRect(): [number, number, number, number] { const r = Math.max(this.spark.r, 10) * 2.4; return [this.spark.x - r, this.spark.y - r, r * 2, r * 2]; }

  // ---- embers with intent -------------------------------------------------------------
  private mote(x: number, y: number, o: Partial<Mote> = {}): Mote {
    const m: Mote = { x, y, vx: 0, vy: 0, tx: x, ty: y, mode: "burst", temp: 1, cool: .35, size: rand(1.4, 3.2), speed: 3, ...o };
    this.motes.push(m);
    return m;
  }
  burstAt(x: number, y: number, n = 30, temp = 1) {
    if (this.reduce) return;
    for (let i = 0; i < n; i++) {
      const a = rand(0, 6.283), sp = rand(40, 220);
      this.mote(x, y, { vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 30, temp: temp * rand(.8, 1), cool: rand(.5, .9), size: rand(1.4, 3.2) });
    }
  }

  /** The wordmark (Chakra Petch, the brand face) forms from rising embers,
   *  holds, bursts, and the Spark is born from its centre. */
  async logoBurst(text: string, wait: (ms: number) => Promise<void>) {
    const pts = this.textPoints(text, Math.min(this.W * .13, 150));
    const cx = this.W / 2, cy = this.H * .45;
    const logo = pts.slice(0, this.lite ? 700 : 1500).map((p) => this.mote(this.reduce ? p.x : p.x + rand(-180, 180), this.reduce ? p.y : this.H + rand(20, 260), {
      mode: "seek", tx: p.x, ty: p.y, speed: rand(2.2, 3.2), temp: rand(.75, .95), cool: 0, size: rand(2.4, 3.6),
    }));
    await wait(1900);
    for (const m of logo) { m.mode = "hold"; m.temp = rand(.85, 1); m.x = m.tx; m.y = m.ty; }
    await wait(1500);
    for (const m of logo) {
      if (this.reduce) { m.temp = 0; continue; }
      const a = Math.atan2(m.y - cy, m.x - cx) + rand(-.4, .4), sp = rand(120, 520);
      Object.assign(m, { mode: "burst", vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, cool: rand(.35, .7) });
    }
    await wait(350);
    this.sparkBorn(cx, cy);
    this.sparkTo(cx, this.H * .34, 22);
    await wait(900);
  }
  private textPoints(text: string, size: number) {
    const c = document.createElement("canvas"), x = c.getContext("2d")!;
    c.width = this.W; c.height = this.H;
    x.font = `700 ${size}px "Chakra Petch", -apple-system, sans-serif`;
    x.textAlign = "center"; x.textBaseline = "middle"; x.fillStyle = "#fff";
    x.fillText(text, this.W / 2, this.H * .45);
    const d = x.getImageData(0, 0, this.W, this.H).data, out: { x: number; y: number }[] = [];
    for (let y = 0; y < this.H; y += 3) for (let xx = 0; xx < this.W; xx += 3) if (d[(y * this.W + xx) * 4 + 3] > 140) out.push({ x: xx + rand(-.8, .8), y: y + rand(-.8, .8) });
    return out.sort(() => Math.random() - .5);
  }
  scoutOut(): Mote[] {
    if (this.reduce) return [];
    return Array.from({ length: this.lite ? 30 : 60 }, () => {
      const a = rand(0, 6.283), d = Math.max(this.W, this.H) * .6;
      return this.mote(this.spark.x, this.spark.y, { mode: "seek", tx: this.W / 2 + Math.cos(a) * d, ty: this.H / 2 + Math.sin(a) * d, speed: rand(1.4, 2.2), temp: .9, cool: 0, size: rand(1.8, 2.8) });
    });
  }
  scoutBack(scouts: Mote[]) {
    for (const m of scouts) Object.assign(m, { tx: this.spark.x + rand(-30, 30), ty: this.spark.y + rand(-30, 30), speed: rand(1.6, 2.4), done: () => { m.mode = "burst"; m.vx = rand(-40, 40); m.vy = rand(-60, -10); m.cool = .9; } });
  }

  // ---- 3D ----------------------------------------------------------------------------
  /** Perspective projection with a slowly orbiting camera. */
  private project(p: V3, cx: number, cy: number, yaw: number, pitch = .32): { x: number; y: number; s: number } {
    const cyw = Math.cos(yaw), syw = Math.sin(yaw);
    const x1 = p.x * cyw + p.z * syw, z1 = -p.x * syw + p.z * cyw;
    const cp = Math.cos(pitch), spt = Math.sin(pitch);
    const y2 = p.y * cp - z1 * spt, z2 = p.y * spt + z1 * cp;
    const f = 1100, s = f / (f + z2);
    return { x: cx + x1 * s, y: cy + y2 * s, s };
  }

  // ---- constellation ----------------------------------------------------------------------
  setStars(specs: StarSpec[], links: [string, string][] = []) {
    this.labels.querySelectorAll(".forge-star").forEach((e) => e.remove());
    this.stars = [];
    this.links = [];
    const agents = specs.filter((s) => s.kind === "agent");
    const spread = Math.min(this.W * .17, 230);
    for (const spec of specs) {
      const el = document.createElement("div");
      el.className = `forge-star ${spec.kind}`;
      el.textContent = spec.label;
      if (spec.sub) { const em = document.createElement("em"); em.textContent = spec.sub; el.append(em); }
      this.labels.append(el);
      this.stars.push({ ...spec, p: { x: 0, y: 0, z: 0 }, sx: this.W / 2, sy: this.H / 2, ss: 1, flat: null, op: 0, top: 0, el, ang: 0, rad: 0, tilt: 0 });
    }
    agents.forEach((a, i) => { this.stars.find((x) => x.id === a.id)!.p = { x: (i - (agents.length - 1) / 2) * spread * 2, y: 0, z: 0 }; });
    const byParent = new Map<string, Star[]>();
    for (const s of this.stars) if (s.parent) byParent.set(s.parent, [...(byParent.get(s.parent) ?? []), s]);
    for (const [pid, kids] of byParent) {
      const p = this.stars.find((x) => x.id === pid);
      if (!p) continue;
      kids.forEach((k, j) => {
        Object.assign(k, { parentStar: p, rad: Math.min(170, this.W * .12) + (j % 2) * 34, ang: (j / kids.length) * 6.283, tilt: rand(-.9, .9) });
        this.links.push([p, k, .55]);
      });
    }
    for (const [a, b] of links) {
      const sa = this.stars.find((s) => s.id === a), sb = this.stars.find((s) => s.id === b);
      if (sa && sb) this.links.push([sa, sb, .3]);
    }
    // they arrive from deep in the scene
    for (const s of this.stars) { s.sx = this.W / 2 + rand(-40, 40); s.sy = this.H * .5 + rand(-40, 40); s.ss = .2; }
  }
  async revealStars(wait: (ms: number) => Promise<void>) { for (const s of this.stars) { s.top = 1; await wait(this.reduce ? 0 : 90); } }
  showAllStars() { for (const s of this.stars) { s.top = 1; s.op = 1; } }
  hasStars() { return this.stars.length > 0; }
  hideStars() { for (const s of this.stars) s.top = 0; }
  recede(on: boolean) {
    this.labels.classList.toggle("recede", on);
    this.stars.forEach((s, i) => {
      if (!on) { s.flat = null; return; }
      const a = Math.PI * (.12 + .76 * (i / Math.max(1, this.stars.length - 1)));
      s.flat = { x: this.W / 2 - Math.cos(a) * this.W * .4, y: this.H * .08 + (1 - Math.sin(a)) * this.H * .14 };
    });
  }
  async forgeLine(stageOf: (label: string) => number | null, slots: { x: number; y: number }[], wait: (ms: number) => Promise<void>) {
    const x0 = slots[0].x, x1 = slots[slots.length - 1].x, y = slots[0].y;
    this.stars.forEach((s, i) => { s.flat = { x: lerp(x0, x1, (i + .5) / this.stars.length), y }; });
    await wait(1000);
    for (const s of this.stars) { const i = stageOf(s.label); s.flat = i != null && slots[i] ? { ...slots[i] } : { x: s.sx, y: s.sy + 24 }; s.top = 0; }
    await wait(700);
    this.labels.querySelectorAll(".forge-star").forEach((e) => e.remove());
    this.stars = [];
    this.links = [];
  }
  addMate(id: string, label: string, side: number) {
    const el = document.createElement("div");
    el.className = "forge-star mate";
    el.textContent = label;
    this.labels.append(el);
    const s: Star = { id, label, kind: "mate", p: { x: side * Math.min(this.W * .3, 380), y: 160, z: -60 }, sx: side > 0 ? this.W + 40 : -40, sy: this.H * .7, ss: 1, flat: null, op: 0, top: 1, el, ang: 0, rad: 0, tilt: 0 };
    this.stars.push(s);
    for (const a of this.stars.filter((x) => x.kind === "agent")) this.links.push([s, a, .35]);
  }

  // ---- the workflow path (3D) -------------------------------------------------------------
  /** Five stages on a gentle 3D arc; the camera drifts so it reads as a
   *  real object. Labels and drop targets follow the projection. */
  setStages(specs: StageSpec[]) {
    const span = Math.min(this.W * .36, 560);
    const next = specs.map((sp, i) => {
      const prev = this.stages.find((x) => x.id === sp.id);
      const u = specs.length > 1 ? i / (specs.length - 1) : .5;
      let el = prev?.el;
      if (!el) {
        el = document.createElement("div");
        el.className = "forge-stage";
        el.innerHTML = "<b></b><small></small>";
        this.labels.append(el);
      }
      return { ...sp, p: { x: (u * 2 - 1) * span, y: -Math.sin(u * Math.PI) * 26, z: -Math.cos((u * 2 - 1) * Math.PI * .5) * 220 + 110 }, sx: prev?.sx ?? this.W / 2, sy: prev?.sy ?? this.H * .45, ss: prev?.ss ?? .3, cur: prev?.cur ?? 0, el, pulse: prev?.pulse ?? false };
    });
    for (const s of this.stages) if (!next.some((n) => n.el === s.el)) s.el.remove();
    this.stages = next;
  }
  pulseStage(i: number) { this.stages.forEach((s, j) => (s.pulse = j === i)); }
  stagePos(i: number) { const s = this.stages[i]; return s ? { x: s.sx, y: s.sy } : null; }
  clearStages() { for (const s of this.stages) s.el.remove(); this.stages = []; }

  // ---- beacons (AI orbs) ---------------------------------------------------------------------
  setBeacon(id: string, b: Beacon | null) {
    if (!b) { this.beacons.delete(id); return; }
    const prev = this.beacons.get(id);
    if (prev && b.lit > prev.lit + .3) this.burstAt(b.x, b.y, 34, 1);
    this.beacons.set(id, { ...b, cur: prev?.cur ?? (this.reduce ? b.lit : 0) });
  }
  clearBeacons() { this.beacons.clear(); }

  collapse() {
    for (const s of this.stars) { s.flat = { x: this.W / 2, y: this.H / 2 }; s.top = 0; }
    for (const s of this.stages) this.mote(s.sx, s.sy, { mode: "seek", tx: this.W / 2, ty: this.H / 2, speed: 2.4, temp: 1, cool: 0, size: 3 });
    this.clearStages();
    this.links = [];
    for (const [id, b] of this.beacons) { this.mote(b.x, b.y, { mode: "seek", tx: this.W / 2, ty: this.H / 2, speed: 2.4, temp: 1, cool: 0, size: 3 }); this.beacons.delete(id); }
    if (!this.reduce) for (let i = 0; i < (this.lite ? 50 : 120); i++) {
      const a = rand(0, 6.283), d = rand(.25, .55) * Math.max(this.W, this.H);
      this.mote(this.W / 2 + Math.cos(a) * d, this.H / 2 + Math.sin(a) * d, { mode: "seek", tx: this.W / 2, ty: this.H / 2, speed: rand(1.4, 2.6), temp: rand(.7, 1), cool: 0, size: rand(1.6, 3) });
    }
    this.sparkTo(this.W / 2, this.H / 2, 14);
    setTimeout(() => (this.fading = true), 900);
  }

  // ---- frame -------------------------------------------------------------------------------
  private frame(now: number) {
    const dt = Math.min(1 / 30, (now - this.last) / 1000);
    this.last = now;
    const t = (now - this.t0) / 1000;
    const { W, H, reduce } = this;
    const sh = this.shade;
    sh.clearRect(0, 0, W, H);
    const pts: GLPoint[] = [];
    const halo = (x: number, y: number, r: number, a: number) => {
      // a soft dark pool under a light, so it reads on white too
      const g = sh.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(0,0,0,${.42 * a})`); g.addColorStop(1, "rgba(0,0,0,0)");
      sh.fillStyle = g; sh.fillRect(x - r, y - r, r * 2, r * 2);
    };
    const line = (x1: number, y1: number, x2: number, y2: number, rgb: string, a: number, dotted = false) => {
      sh.setLineDash(dotted ? [2, 6] : []);
      sh.lineCap = "round";
      sh.strokeStyle = `rgba(0,0,0,${.5 * a})`; sh.lineWidth = 3.4;
      sh.beginPath(); sh.moveTo(x1, y1); sh.lineTo(x2, y2); sh.stroke();
      sh.strokeStyle = `rgba(${rgb},${a})`; sh.lineWidth = 1.3;
      sh.beginPath(); sh.moveTo(x1, y1); sh.lineTo(x2, y2); sh.stroke();
      sh.setLineDash([]);
    };
    if (!reduce) this.yaw = Math.sin(t * .12) * .55;

    // embers with intent
    const keep: Mote[] = [];
    for (const m of this.motes) {
      if (m.mode === "burst") {
        m.vx *= Math.pow(.18, dt); m.vy = m.vy * Math.pow(.18, dt) - 22 * dt;
        m.x += m.vx * dt; m.y += m.vy * dt;
        m.temp -= m.cool * dt;
      } else if (m.mode === "seek") {
        const k = reduce ? 1 : clamp(dt * m.speed);
        m.x = lerp(m.x, m.tx, k); m.y = lerp(m.y, m.ty, k);
        if (m.done && Math.abs(m.x - m.tx) + Math.abs(m.y - m.ty) < 3) { const f = m.done; m.done = undefined; f(); }
        if (this.fading) m.temp -= dt * 2;
      } else m.x += Math.sin(t * 2 + m.y) * .05;
      if (m.temp <= 0.02 || m.y < -40) continue;
      keep.push(m);
      pts.push({ x: m.x, y: m.y, size: m.size, temp: clamp(m.temp) * (.82 + .18 * Math.sin(t * 13 + m.x * .7)), alpha: 1, soft: 0 });
    }
    this.motes = keep;

    const sp = this.spark;
    if (sp.born && !reduce && sp.alpha > 0 && Math.random() < dt * (sp.speaking ? 8 : 2.5)) {
      this.mote(sp.x + rand(-sp.r, sp.r) * .4, sp.y, { vx: rand(-20, 20), vy: rand(-70, -30), temp: rand(.8, 1), cool: rand(.6, 1), size: rand(1.2, 2.2) });
    }

    // AI orbs
    for (const b of this.beacons.values()) {
      b.cur = lerp(b.cur, b.lit, reduce ? 1 : clamp(dt * 2.5));
      const pulse = b.pulse && !reduce ? .5 + .5 * Math.sin(t * 5) : 0;
      halo(b.x, b.y, b.size * 1.6, 1);
      pts.push({ x: b.x, y: b.y, size: b.size * (.55 + .45 * b.cur), temp: .22 + .73 * b.cur + pulse * .15, alpha: .55 + .45 * b.cur, soft: .65 });
      if (b.cur > .5) pts.push({ x: b.x, y: b.y, size: b.size * .28, temp: 1, alpha: b.cur, soft: 0 });
      if (pulse) pts.push({ x: b.x, y: b.y, size: b.size * (1.6 + pulse), temp: .6, alpha: .3 * pulse, soft: 1 });
    }

    // constellation (3D)
    const receded = this.labels.classList.contains("recede");
    for (const s of this.stars) {
      if (s.parentStar) {
        if (!reduce) s.ang += dt * .22;
        const c = Math.cos(s.ang) * s.rad, d = Math.sin(s.ang) * s.rad;
        s.p = { x: s.parentStar.p.x + c, y: s.parentStar.p.y + d * Math.sin(s.tilt) * .55, z: s.parentStar.p.z + d * Math.cos(s.tilt) };
      }
      const pr = s.flat ? { x: s.flat.x, y: s.flat.y, s: 1 } : this.project(s.p, W / 2, H * .5, this.yaw);
      const k = reduce ? 1 : clamp(dt * 3);
      s.sx = lerp(s.sx, pr.x, k); s.sy = lerp(s.sy, pr.y, k); s.ss = lerp(s.ss, pr.s, k);
      s.op = lerp(s.op, s.top, reduce ? 1 : clamp(dt * 3));
    }
    for (const [a, b, w] of this.links) {
      const al = w * Math.min(a.op, b.op) * (receded ? .25 : 1);
      if (al > .02) line(a.sx, a.sy, b.sx, b.sy, "255,176,110", al);
    }
    const dimmed = receded ? .35 : 1;
    for (const s of this.stars) {
      if (s.op < .02) { s.el.style.opacity = "0"; continue; }
      const depth = clamp((s.ss - .78) / .45); // 0 far … 1 near
      const big = (s.kind === "agent" ? 8 : s.kind === "mate" ? 6 : 3.4) * s.ss;
      halo(s.sx, s.sy, big * 5, s.op * dimmed);
      pts.push({ x: s.sx, y: s.sy, size: big, temp: s.kind === "mate" ? .7 : .95, alpha: s.op * dimmed, soft: 0 },
        { x: s.sx, y: s.sy, size: big * 4.2, temp: .6, alpha: s.op * .4 * dimmed, soft: 1 });
      s.el.style.transform = `translate(${s.sx}px, ${s.sy + big + 8}px) translate(-50%, 0) scale(${(.82 + .25 * depth).toFixed(3)})`;
      s.el.style.opacity = String(s.op * (.45 + .55 * depth));
      s.el.style.zIndex = String(Math.round(s.ss * 100));
    }

    // workflow path (3D)
    if (this.stages.length) {
      for (const s of this.stages) {
        const pr = this.project(s.p, W / 2, H * .45, this.yaw * .5, .38);
        const k = reduce ? 1 : clamp(dt * 3.2);
        s.sx = lerp(s.sx, pr.x, k); s.sy = lerp(s.sy, pr.y, k); s.ss = lerp(s.ss, pr.s, k);
        s.cur = lerp(s.cur, s.lit ? 1 : 0, reduce ? 1 : clamp(dt * 2.2));
      }
      for (let i = 0; i < this.stages.length - 1; i++) {
        const a = this.stages[i], b = this.stages[i + 1], lit = a.lit && b.lit;
        line(a.sx, a.sy, b.sx, b.sy, lit ? "255,160,90" : "255,255,255", lit ? .9 : .45, !lit);
        if (lit && !reduce) for (let j = 0; j < 3; j++) {
          const u = (t * .35 + j / 3 + i * .17) % 1;
          pts.push({ x: lerp(a.sx, b.sx, u), y: lerp(a.sy, b.sy, u), size: 2.6, temp: .95, alpha: Math.sin(u * Math.PI), soft: 0 });
        }
      }
      for (const s of this.stages) {
        const pulse = s.pulse && !reduce ? .5 + .5 * Math.sin(t * 5) : 0;
        const size = 34 * s.ss;
        halo(s.sx, s.sy, size * 1.7, 1);
        // the diamond: a hairline square turned 45°, with a dark outline under it
        sh.save(); sh.translate(s.sx, s.sy); sh.rotate(Math.PI / 4);
        sh.setLineDash(s.lit ? [] : [3, 4]);
        sh.strokeStyle = "rgba(0,0,0,.55)"; sh.lineWidth = 3.2; sh.strokeRect(-size * .36, -size * .36, size * .72, size * .72);
        sh.strokeStyle = s.lit ? `rgba(255,200,150,${.5 + .5 * s.cur})` : `rgba(255,255,255,${.5 + pulse * .5})`; sh.lineWidth = 1.2; sh.strokeRect(-size * .36, -size * .36, size * .72, size * .72);
        sh.restore(); sh.setLineDash([]);
        if (s.cur > .02) pts.push({ x: s.sx, y: s.sy, size: size * (.7 + .3 * s.cur), temp: .55 + .4 * s.cur, alpha: s.cur, soft: .7 }, { x: s.sx, y: s.sy, size: size * .25, temp: 1, alpha: s.cur, soft: 0 });
        if (pulse) pts.push({ x: s.sx, y: s.sy, size: size * (1.5 + pulse), temp: .65, alpha: .35 * pulse, soft: 1 });
        s.el.classList.toggle("gap", !s.lit);
        (s.el.firstChild as HTMLElement).textContent = s.name;
        (s.el.lastChild as HTMLElement).textContent = s.sub;
        s.el.style.transform = `translate(${s.sx}px, ${s.sy + size * .62 + 10}px) translate(-50%, 0)`;
        s.el.style.zIndex = String(Math.round(s.ss * 100));
      }
    }

    // the Spark
    if (sp.born) {
      const k = reduce ? 1 : clamp(dt * 2.2);
      sp.x = lerp(sp.x, sp.tx, k); sp.y = lerp(sp.y, sp.ty, k);
      sp.r = lerp(sp.r, sp.tr, reduce ? 1 : clamp(dt * 2.5));
      sp.energy = lerp(sp.energy, sp.speaking && !reduce ? 1 + .5 * Math.sin(t * 11) : 0, clamp(dt * 8));
      if (sp.alpha > 0) halo(sp.x, sp.y, sp.r * 5, sp.alpha);
    }
    this.gl.draw({
      time: t, w: W, h: H, dim: 0, calm: 0, points: pts, lines: [],
      spark: sp.born ? { x: sp.x, y: sp.y, r: sp.r, energy: sp.energy, glow: sp.glow, alpha: sp.alpha } : null,
    });
    if (sp.born) this.onFrame?.({ x: sp.x, y: sp.y, r: sp.r });
  }
}
