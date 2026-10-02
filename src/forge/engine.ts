// ---------------------------------------------------------------------------
// The forge world behind first-run setup: drifting embers, the Spark (Grill
// Me's AI, a bright ember that pulses while it talks), a constellation of the
// user's tools, and the forged Plan → Ship path. Canvas 2D with pre-rendered
// glow sprites (cheap, no shadowBlur). All text lives in the DOM overlay
// (ForgeOnboarding.tsx), so it stays crisp and readable; the only DOM this
// file owns is the constellation's star labels.
//
// Reduce Motion: embers stand still, nothing flies, the Spark doesn't pulse.
// Lite mode (slow computers, auto-detected): fewer embers, 1× resolution, no
// path sparks.
// ---------------------------------------------------------------------------

export interface StarSpec { id: string; label: string; kind: "agent" | "kid" | "mate"; sub?: string; parent?: string }
interface Star extends StarSpec { x: number; y: number; tx: number; ty: number; op: number; shown: boolean; orbit: boolean; ang: number; rad: number; el: HTMLDivElement; parentStar?: Star }
interface Ember { x: number; y: number; vx: number; vy: number; h: number; s: number; a: number; ph: number; mode: "ambient" | "burst" | "seek" | "hold"; tx: number; ty: number; speed: number; green: boolean; onArrive?: (e: Ember) => void }
export interface PathPoint { x: number; y: number; lit: boolean }

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function sprite(r: number, g: number, b: number, size = 64): HTMLCanvasElement {
  const s = document.createElement("canvas");
  s.width = s.height = size;
  const c = s.getContext("2d")!, grd = c.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, "rgba(255,248,235,1)");
  grd.addColorStop(0.18, `rgba(${r},${g},${b},.95)`);
  grd.addColorStop(0.45, `rgba(${r},${g},${b},.28)`);
  grd.addColorStop(1, `rgba(${r},${g},${b},0)`);
  c.fillStyle = grd;
  c.fillRect(0, 0, size, size);
  return s;
}
const HUES: [number, number, number][] = [[255, 79, 26], [255, 106, 42], [255, 138, 58], [255, 170, 80], [242, 193, 78]];
export const SPRITES = HUES.map(([r, g, b]) => sprite(r, g, b));
const GREEN = sprite(79, 207, 134);

export class ForgeWorld {
  reduce: boolean;
  lite = false;
  W = 0;
  H = 0;
  private dpr = 1;
  private ctx: CanvasRenderingContext2D;
  private embers: Ember[] = [];
  private stars: Star[] = [];
  private lines: [Star, Star, number][] = [];
  private path: PathPoint[] | null = null;
  private pathSparks: { seg: number; u: number; v: number; ph: number }[] = [];
  private dim = 0;
  private tdim = 0;
  private raf = 0;
  private last = 0;
  private t0 = 0;
  private frames = 0;
  private slow = 0;
  /** the Spark */
  spark = { x: 0, y: 0, tx: 0, ty: 0, r: 0, tr: 14, glow: 1, born: false, speaking: false, ring: 0 };
  /** called every frame with the Spark's position (the overlay follows it) */
  onFrame?: (spark: { x: number; y: number; r: number }) => void;
  /** called once if the first ~2 s ran slowly and lite mode switched on */
  onLite?: () => void;

  constructor(private canvas: HTMLCanvasElement, private starLayer: HTMLDivElement, reduce: boolean) {
    this.reduce = reduce;
    this.ctx = canvas.getContext("2d")!;
    this.resize();
    addEventListener("resize", this.resize);
    for (let i = 0; i < this.emberCount(); i++) this.embers.push(this.ember(rand(0, this.W), rand(0, this.H)));
  }

  private emberCount() { return this.lite ? 160 : 480; }
  private ember(x: number, y: number): Ember {
    return { x, y, vx: 0, vy: 0, h: (Math.random() * SPRITES.length) | 0, s: rand(2, 6), a: rand(.35, .95), ph: rand(0, 6.28), mode: "ambient", tx: 0, ty: 0, speed: 3, green: false };
  }

  resize = () => {
    this.dpr = this.lite ? 1 : Math.min(devicePixelRatio || 1, 2);
    this.W = innerWidth;
    this.H = innerHeight;
    this.canvas.width = this.W * this.dpr;
    this.canvas.height = this.H * this.dpr;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  };

  setLite(on: boolean) {
    this.lite = on;
    this.resize();
    const want = this.emberCount();
    while (this.embers.length > want) this.embers.pop();
    while (this.embers.length < want) this.embers.push(this.ember(rand(0, this.W), rand(0, this.H)));
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
  sparkBorn(x: number, y: number) {
    Object.assign(this.spark, { x, y, tx: x, ty: y, r: this.reduce ? 14 : 0, born: true });
  }
  sparkTo(x: number, y: number, r?: number) {
    this.spark.tx = x;
    this.spark.ty = y;
    if (r) this.spark.tr = r;
    if (this.reduce) { this.spark.x = x; this.spark.y = y; }
  }
  /** an answer was absorbed: grow a little brighter */
  feed() {
    this.spark.tr = Math.min(this.spark.tr + 2, 26);
    this.spark.glow = Math.min(2, this.spark.glow + .18);
    this.spark.ring = 1;
    this.burstAt(this.spark.x, this.spark.y, 14);
  }
  setDim(on: boolean) { this.tdim = on ? 1 : 0; }

  // ---- embers ---------------------------------------------------------------------
  burstAt(x: number, y: number, n = 30, green = false) {
    if (this.reduce) return;
    for (let i = 0; i < n; i++) {
      const e = this.embers[(Math.random() * this.embers.length) | 0];
      const a = rand(0, 6.283), sp = rand(2, 6);
      Object.assign(e, { x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, mode: "burst", green, onArrive: undefined });
      if (green) setTimeout(() => (e.green = false), 1800);
    }
  }

  /** The launch animation hands off on the logo: show it in embers, then burst
   *  it outward into the ambient world and gather a few into the Spark. */
  async logoBurst(text: string, wait: (ms: number) => Promise<void>) {
    const pts = this.textPoints(text, Math.min(this.W * .16, 170));
    if (!pts.length) return;
    const n = Math.min(this.embers.length, Math.round(pts.length * 1.4));
    this.embers.forEach((e, i) => {
      if (i < n) { const p = pts[i % pts.length]; Object.assign(e, { x: p.x + rand(-1, 1), y: p.y + rand(-1, 1), mode: "hold", a: rand(.7, 1) }); }
      else e.a = 0;
    });
    await wait(900);
    const cx = this.W / 2, cy = this.H * .45;
    for (const e of this.embers) {
      if (e.mode !== "hold") { e.a = rand(.3, .9); continue; }
      if (this.reduce) { Object.assign(e, { x: rand(0, this.W), y: rand(0, this.H), mode: "ambient" }); continue; }
      const a = Math.atan2(e.y - cy, e.x - cx) + rand(-.5, .5), sp = rand(3, 13);
      Object.assign(e, { vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, mode: "burst" });
    }
    await wait(650);
    this.sparkBorn(cx, cy);
    this.sparkTo(cx, this.H * .36, 15);
    for (const e of this.embers.slice(0, 26)) {
      Object.assign(e, { mode: "seek", tx: cx, ty: this.H * .36, speed: 4, onArrive: (x: Ember) => { x.mode = "ambient"; x.x = rand(0, this.W); x.y = this.H + 10; } });
    }
    await wait(800);
  }

  private textPoints(text: string, size: number) {
    const c = document.createElement("canvas"), x = c.getContext("2d")!;
    c.width = this.W; c.height = this.H;
    x.font = `700 ${size}px "Chakra Petch", sans-serif`;
    x.textAlign = "center"; x.textBaseline = "middle"; x.fillStyle = "#fff";
    x.fillText(text, this.W / 2, this.H * .45);
    const d = x.getImageData(0, 0, this.W, this.H).data, out: { x: number; y: number }[] = [], step = this.lite ? 7 : 4;
    for (let y = 0; y < this.H; y += step) for (let xx = 0; xx < this.W; xx += step) if (d[(y * this.W + xx) * 4 + 3] > 128) out.push({ x: xx, y });
    return out.sort(() => Math.random() - .5);
  }

  /** Embers fly out from the Spark to the edges (the scan is looking). */
  scoutOut() {
    const scouts = this.embers.slice(0, this.lite ? 30 : 70);
    for (const e of scouts) {
      const a = rand(0, 6.283), d = Math.max(this.W, this.H) * .7;
      Object.assign(e, { x: this.spark.x, y: this.spark.y, mode: "seek", speed: 2.4, tx: this.W / 2 + Math.cos(a) * d, ty: this.H / 2 + Math.sin(a) * d, a: 1, onArrive: undefined });
    }
  }
  /** …and come back. */
  scoutBack() {
    for (const e of this.embers.slice(0, this.lite ? 30 : 70)) {
      Object.assign(e, { tx: this.spark.x + rand(-40, 40), ty: this.spark.y + rand(-40, 40), speed: 2.2, onArrive: (x: Ember) => { x.mode = "ambient"; x.a = rand(.3, .9); if (this.reduce) { x.x = rand(0, this.W); x.y = rand(0, this.H); } } });
    }
  }

  // ---- constellation ------------------------------------------------------------------
  /** Build the stars, starting far out (so they fly in as they're revealed). */
  setStars(specs: StarSpec[], links: [string, string][] = []) {
    this.starLayer.innerHTML = "";
    this.stars = [];
    this.lines = [];
    const agents = specs.filter((s) => s.kind === "agent");
    const cx = this.W / 2, cy = this.H * .52, spread = Math.min(this.W * .19, 240);
    for (const spec of specs) {
      const el = document.createElement("div");
      el.className = `forge-star ${spec.kind}`;
      const dot = document.createElement("i");
      const label = document.createElement("span");
      label.textContent = spec.label;
      if (spec.sub) { const em = document.createElement("em"); em.textContent = spec.sub; label.append(em); }
      el.append(dot, label);
      this.starLayer.append(el);
      this.stars.push({ ...spec, x: cx, y: cy, tx: cx, ty: cy, op: 0, shown: false, orbit: false, ang: 0, rad: 0, el });
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
        Object.assign(k, { parentStar: p, orbit: true, rad: Math.min(150, this.W * .12) + (j % 2) * 26, ang: (j / kids.length) * 6.283 + agents.indexOf(p) });
        k.tx = p.tx + Math.cos(k.ang) * k.rad;
        k.ty = p.ty + Math.sin(k.ang) * k.rad * .62;
        this.lines.push([p, k, .45]);
      });
    }
    for (const [a, b] of links) {
      const sa = this.stars.find((s) => s.id === a), sb = this.stars.find((s) => s.id === b);
      if (sa && sb) this.lines.push([sa, sb, .22]);
    }
    for (const s of this.stars) { s.x = s.tx + (s.tx - cx) * 2.2; s.y = s.ty + (s.ty - this.H / 2) * 2.2; }
  }
  /** Reveal stars one at a time. */
  async revealStars(wait: (ms: number) => Promise<void>) {
    for (const s of this.stars) { s.shown = true; s.op = 1; await wait(this.reduce ? 0 : 110); }
  }
  showAllStars() { for (const s of this.stars) { s.shown = true; s.op = 1; s.x = s.tx; s.y = s.ty; } }
  addMate(id: string, label: string, side: number) {
    const el = document.createElement("div");
    el.className = "forge-star mate";
    el.innerHTML = "<i></i><span></span>";
    el.querySelector("span")!.textContent = label;
    this.starLayer.append(el);
    const s: Star = { id, label, kind: "mate", x: side > 0 ? this.W + 40 : -40, y: this.H * rand(.3, .8), tx: this.W / 2 + side * Math.min(this.W * .32, 380), ty: this.H * .78, op: 1, shown: true, orbit: false, ang: 0, rad: 0, el };
    this.stars.push(s);
    for (const a of this.stars.filter((x) => x.kind === "agent")) this.lines.push([s, a, .3]);
    this.burstAt(s.tx, s.ty, 18, true);
  }
  /** During the interview the constellation steps back: labels hide (CSS
   *  .recede) and stars drift into a wide arc near the top. */
  recede(on: boolean) {
    this.starLayer.classList.toggle("recede", on);
    if (on) {
      this.stars.forEach((s, i) => {
        (s as Star & { home?: [number, number, boolean] }).home = [s.tx, s.ty, s.orbit];
        s.orbit = false;
        const a = Math.PI * (0.08 + 0.84 * (i / Math.max(1, this.stars.length - 1)));
        s.tx = this.W / 2 - Math.cos(a) * this.W * .44;
        s.ty = this.H * .1 + (1 - Math.sin(a)) * this.H * .18;
      });
    } else {
      for (const s of this.stars as (Star & { home?: [number, number, boolean] })[]) if (s.home) [s.tx, s.ty, s.orbit] = s.home;
    }
  }
  /** Stars pull into a line, then each flies to its stage (or fades). */
  async forgeLine(stageOf: (label: string) => number | null, slots: { x: number; y: number }[], wait: (ms: number) => Promise<void>) {
    const x0 = slots[0].x, x1 = slots[slots.length - 1].x, y = slots[0].y;
    this.stars.forEach((s, i) => { s.orbit = false; s.tx = lerp(x0, x1, (i + .5) / this.stars.length); s.ty = y; });
    await wait(900);
    for (const s of this.stars) {
      const i = stageOf(s.label);
      if (i != null && slots[i]) { s.tx = slots[i].x; s.ty = slots[i].y; } else { s.ty = s.y + 30; }
    }
    await wait(700);
    for (const s of this.stars) s.op = 0;
    this.lines = [];
  }
  hideStars() { for (const s of this.stars) s.op = 0; this.lines = []; }

  // ---- the forged path ----------------------------------------------------------------
  setPath(points: PathPoint[] | null) {
    this.path = points;
    if (points && !this.pathSparks.length) this.pathSparks = Array.from({ length: 16 }, () => ({ seg: (Math.random() * Math.max(1, points.length - 1)) | 0, u: Math.random(), v: rand(.5, 1.1), ph: rand(0, 6) }));
  }

  /** Finale: everything pulls into the centre. */
  collapse() {
    for (const s of this.stars) { s.orbit = false; s.tx = this.W / 2; s.ty = this.H / 2; s.op = 0; }
    this.lines = [];
    this.path = null;
    this.tdim = 0;
    for (const e of this.embers.slice(0, this.lite ? 60 : 180)) {
      Object.assign(e, { mode: "seek", tx: this.W / 2 + rand(-20, 20), ty: this.H / 2 + rand(-20, 20), speed: 3, onArrive: (x: Ember) => { x.mode = "ambient"; x.a = 0; } });
    }
    this.sparkTo(this.W / 2, this.H / 2, 6);
  }
  fadeEmbers(k: number) { for (const e of this.embers) e.a *= k; }

  // ---- frame ----------------------------------------------------------------------------
  private frame(now: number) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const t = (now - this.t0) / 1000;
    if (!this.lite && this.frames < 120) {
      this.frames++;
      if (dt > 1 / 40) this.slow++;
      if (this.frames === 120 && this.slow > 40) { this.setLite(true); this.onLite?.(); }
    }
    const { ctx, W, H, reduce } = this;
    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = "lighter";

    for (const e of this.embers) {
      if (e.mode === "ambient") {
        if (!reduce) {
          e.vx += Math.sin(t * .6 + e.ph) * .004; e.vx *= .985;
          e.vy = lerp(e.vy, -rand(.08, .35), .02);
          e.x += e.vx * 60 * dt; e.y += e.vy * 60 * dt;
          if (e.y < -10) { e.y = H + 10; e.x = rand(0, W); }
          if (e.x < -10) e.x = W + 10;
          if (e.x > W + 10) e.x = -10;
        }
      } else if (e.mode === "burst") {
        e.x += e.vx * 60 * dt; e.y += e.vy * 60 * dt; e.vx *= .94; e.vy *= .94;
        if (Math.abs(e.vx) + Math.abs(e.vy) < .4) e.mode = "ambient";
      } else if (e.mode === "seek") {
        const k = reduce ? 1 : clamp(dt * e.speed);
        e.x = lerp(e.x, e.tx, k); e.y = lerp(e.y, e.ty, k);
        if (Math.abs(e.x - e.tx) + Math.abs(e.y - e.ty) < 2 && e.onArrive) { const f = e.onArrive; e.onArrive = undefined; f(e); }
      }
      let a = e.a * (0.75 + 0.25 * Math.sin(t * 3 + e.ph));
      if (this.dim > 0 && e.mode === "ambient") a *= 1 - this.dim * .75;
      if (a <= 0.01) continue;
      const s = e.s * (e.mode === "seek" ? 1.4 : 1) * 4;
      ctx.globalAlpha = a;
      ctx.drawImage(e.green ? GREEN : SPRITES[e.h], e.x - s / 2, e.y - s / 2, s, s);
    }

    for (const [a, b, w] of this.lines) {
      if (!a.shown || !b.shown) continue;
      const al = w * Math.min(a.op, b.op) * (1 - this.dim * .85);
      if (al <= 0.01) continue;
      const g = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
      g.addColorStop(0, `rgba(255,170,90,${al})`);
      g.addColorStop(1, `rgba(242,193,78,${al * .7})`);
      ctx.strokeStyle = g; ctx.lineWidth = 1.2; ctx.globalAlpha = 1;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }

    if (this.path) {
      const pts = this.path;
      ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
      for (let i = 0; i < pts.length - 1; i++) {
        const lit = pts[i].lit && pts[i + 1].lit;
        ctx.strokeStyle = lit ? "rgba(255,150,70,.9)" : "rgba(255,255,255,.12)";
        ctx.lineWidth = lit ? 3 : 2;
        ctx.setLineDash(lit ? [] : [6, 8]);
        ctx.beginPath(); ctx.moveTo(pts[i].x, pts[i].y); ctx.lineTo(pts[i + 1].x, pts[i + 1].y); ctx.stroke();
      }
      ctx.setLineDash([]);
      if (!reduce && !this.lite) {
        ctx.globalCompositeOperation = "lighter";
        for (const p of this.pathSparks) {
          p.u += dt * p.v;
          if (p.u > 1) { p.u = 0; p.seg = (Math.random() * (pts.length - 1)) | 0; }
          if (!(pts[p.seg]?.lit && pts[p.seg + 1]?.lit)) continue;
          const a = pts[p.seg], b = pts[p.seg + 1];
          const x = lerp(a.x, b.x, p.u), y = lerp(a.y, b.y, p.u) + Math.sin(p.u * 9 + p.ph) * 3;
          ctx.globalAlpha = .9;
          ctx.drawImage(SPRITES[4], x - 9, y - 9, 18, 18);
        }
      }
    }

    this.dim = lerp(this.dim, this.tdim, reduce ? 1 : clamp(dt * 4));
    if (this.dim > 0.01) { ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = this.dim * .55; ctx.fillStyle = "#07040a"; ctx.fillRect(0, 0, W, H); }

    const sp = this.spark;
    if (sp.born) {
      const k = reduce ? 1 : clamp(dt * 2.6);
      sp.x = lerp(sp.x, sp.tx, k); sp.y = lerp(sp.y, sp.ty, k);
      sp.r = lerp(sp.r, sp.tr, reduce ? 1 : clamp(dt * 3));
      const pulse = sp.speaking && !reduce ? 1 + .14 * Math.sin(t * 14) + .06 * Math.sin(t * 23) : 1 + (reduce ? 0 : .04 * Math.sin(t * 2));
      const r = sp.r * pulse;
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = .55 * sp.glow; ctx.drawImage(SPRITES[2], sp.x - r * 7, sp.y - r * 7, r * 14, r * 14);
      ctx.globalAlpha = .9; ctx.drawImage(SPRITES[4], sp.x - r * 3, sp.y - r * 3, r * 6, r * 6);
      ctx.globalAlpha = 1; ctx.drawImage(SPRITES[4], sp.x - r * 1.2, sp.y - r * 1.2, r * 2.4, r * 2.4);
      if (sp.ring > 0) {
        sp.ring -= dt * 1.6;
        ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = clamp(sp.ring);
        ctx.strokeStyle = "#ffcf7a"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(sp.x, sp.y, r * (2 + (1 - sp.ring) * 4), 0, 6.283); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";

    for (const s of this.stars) {
      if (s.parentStar && s.orbit && !reduce) {
        s.ang += dt * .12;
        s.tx = s.parentStar.x + Math.cos(s.ang) * s.rad;
        s.ty = s.parentStar.y + Math.sin(s.ang) * s.rad * .62;
      }
      const k = reduce ? 1 : clamp(dt * 3);
      s.x = lerp(s.x, s.tx, k); s.y = lerp(s.y, s.ty, k);
      s.el.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -50%)`;
      s.el.style.opacity = String(s.op);
    }
    if (sp.born) this.onFrame?.({ x: sp.x, y: sp.y, r: sp.r });
  }
}
