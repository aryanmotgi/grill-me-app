// ---------------------------------------------------------------------------
// The forge world: what moves and why. It floats over the user's own apps:
// no background at all, just the Spark, a few embers with intent, and the
// diagrams, which are 3D (perspective, slow camera orbit, depth-sorted
// labels).
//
// Two layers so it reads on any app, light or dark:
//   • shade (Canvas 2D, underneath): soft dark halos under the Spark and the
//     AI orbs, so they stand out on white too (the diagrams sit on the
//     stage's dark glass card, so they need none);
//   • light (WebGL, gl.ts, on top): the Spark, glows, embers, and the
//     diagrams' glowing links, orbits and gems.
// Labels are DOM, so text stays crisp.
// ---------------------------------------------------------------------------

import { EmberGL, type GLBeam, type GLNode, type GLPoint } from "./gl";

export interface StarSpec { id: string; label: string; kind: "agent" | "kid" | "dust" | "mate"; sub?: string; parent?: string }
export interface StageSpec { id: string; name: string; sub: string; lit: boolean }
interface V3 { x: number; y: number; z: number }
interface Star extends StarSpec {
  p: V3;            // place in the 3D scene
  sx: number; sy: number; ss: number; // where it is on screen now (+ depth scale)
  flat: { x: number; y: number } | null; // overrides 3D (recede, forging the line)
  op: number; top: number; el: HTMLDivElement; parentStar?: Star; ang: number; rad: number; tilt: number;
  flared?: boolean;
  slot: number; slots: number; seed: number; // place among its agent's tools
  lw: number; lh: number; lx: number; ly: number; // label size and (eased) place
}
interface Box { x: number; y: number; w: number; h: number }
interface Link { a: Star; b: Star; w: number; grow: number; kind: "kid" | "peer" | "mate" }
interface Stage extends StageSpec { p: V3; sx: number; sy: number; ss: number; cur: number; el: HTMLDivElement; pulse: boolean }
interface Mote { x: number; y: number; vx: number; vy: number; tx: number; ty: number; mode: "hold" | "burst" | "seek"; temp: number; cool: number; size: number; speed: number; done?: () => void }
export interface Beacon { x: number; y: number; lit: number; size: number; pulse?: boolean }

/** tool kinds: their colour (links, chips, key) and name */
type Kind = "mcp" | "plugin" | "skill";
const KIND_RGB: Record<Kind, [number, number, number]> = { mcp: [.45, .78, 1], plugin: [1, .58, .26], skill: [.78, .62, 1] };
const KIND_NAME: Record<Kind, string> = { mcp: "MCP", plugin: "Plugin", skill: "Skill" };
const kindOf = (sub: string): Kind => (/mcp/i.test(sub) ? "mcp" : /skill/i.test(sub) ? "skill" : "plugin");
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
  private links: Link[] = [];
  private stages: Stage[] = [];
  private beacons = new Map<string, Beacon & { cur: number }>();
  private raf = 0;
  private last = 0;
  private t0 = 0;
  private yaw = 0;
  /** where diagrams live (the stage's picture area); they never leave it */
  private vp = { x: 0, y: 0, w: innerWidth, h: innerHeight };
  private fading = false;
  workMs = 0;
  private workN = 0;
  spark = { x: 0, y: 0, tx: 0, ty: 0, r: 0, tr: 22, glow: 1, flash: 0, born: false, speaking: false, alpha: 1, energy: 0 };
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
  /** Embers rise from `points` (the logo burning away), swirl a little, and
   *  stream into (x, y), where the Spark is about to ignite. */
  gatherInto(points: { x: number; y: number }[], x: number, y: number) {
    if (this.reduce) return;
    const max = this.lite ? 350 : 800;
    const pick = points.length > max ? points.filter((_, i) => i % Math.ceil(points.length / max) === 0) : points;
    // a short hop up and out first, then the pull (reads as burning, not
    // sliding); four waves, not one timer per ember
    const waves: Mote[][] = [[], [], [], []];
    for (const p of pick) {
      const a = Math.atan2(p.y - y, p.x - x) + rand(-.6, .6), sp = rand(30, 110);
      waves[Math.floor(Math.random() * 4)].push(this.mote(p.x, p.y, { vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - rand(20, 60), temp: rand(.9, 1), cool: .05, size: rand(1.6, 3) }));
    }
    waves.forEach((wave, i) => window.setTimeout(() => {
      for (const m of wave) Object.assign(m, { mode: "seek", tx: x + rand(-5, 5), ty: y + rand(-5, 5), speed: rand(3.6, 5.4), cool: 0, done: () => { m.temp = 0; } });
    }, 120 + i * 80));
  }

  /** The Spark ignites: born small and white-hot, a ring of sparks, then it settles. */
  ignite(x: number, y: number) {
    this.sparkBorn(x, y);
    if (this.reduce) return;
    this.spark.flash = 1.8;
    this.spark.energy = 1;
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * 6.283 + rand(-.05, .05), sp = rand(260, 340);
      this.mote(x, y, { vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, temp: 1, cool: rand(1.1, 1.5), size: rand(1.6, 2.4) });
    }
    this.burstAt(x, y, 30, 1);
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

  setViewport(r: { x: number; y: number; w: number; h: number }) { this.vp = r; }

  // ---- constellation ----------------------------------------------------------------------
  /**
   * Each agent gets its own column of the picture: its core in the middle,
   * named "Claude Code · 4 tools", its tools spaced evenly around it, each
   * linked by a line in its kind's colour (MCP / plugin / skill). A tool two
   * agents share is drawn once, chipped "shared", and linked to both.
   */
  setStars(specs: StarSpec[], links: [string, string][] = []) {
    this.clearStars();
    const counts = new Map<string, number>();
    for (const sp of specs) if (sp.parent) counts.set(sp.parent, (counts.get(sp.parent) ?? 0) + 1);
    const shared = new Set(links.flat().filter((id) => !id.startsWith("agent:")));
    const kinds = new Set<string>();
    for (const spec of specs) {
      const el = document.createElement("div");
      el.className = `forge-star ${spec.kind}`;
      if (spec.kind === "agent") {
        const n = counts.get(spec.id) ?? 0;
        el.innerHTML = "<b></b><small></small>";
        (el.firstChild as HTMLElement).textContent = spec.label;
        (el.lastChild as HTMLElement).textContent = n ? `${n} tool${n === 1 ? "" : "s"}` : "no tools yet";
      } else if (spec.kind !== "dust") {
        el.append(spec.label);
        if (spec.sub) {
          const k = kindOf(spec.sub);
          kinds.add(k);
          const em = document.createElement("em");
          em.className = `k-${k}`;
          em.textContent = KIND_NAME[k];
          el.append(em);
        }
        if (shared.has(spec.id)) { const em = document.createElement("em"); em.className = "k-shared"; em.textContent = "shared"; el.append(em); }
      }
      el.style.opacity = "0";
      this.labels.append(el);
      this.stars.push({ ...spec, p: { x: 0, y: 0, z: 0 }, sx: 0, sy: 0, ss: 1, flat: null, op: 0, top: 0, el, ang: 0, rad: 0, tilt: 0, slot: 0, slots: 1, seed: rand(0, 100), lw: el.offsetWidth, lh: el.offsetHeight, lx: NaN, ly: NaN });
    }
    const byParent = new Map<string, Star[]>();
    for (const s of this.stars) if (s.parent) byParent.set(s.parent, [...(byParent.get(s.parent) ?? []), s]);
    for (const [pid, kids] of byParent) {
      const p = this.stars.find((x) => x.id === pid);
      if (!p) continue;
      const named = kids.filter((k) => k.kind !== "dust"), dust = kids.filter((k) => k.kind === "dust");
      named.forEach((k, j) => { Object.assign(k, { parentStar: p, slot: j, slots: named.length }); this.links.push({ a: p, b: k, w: .7, grow: 0, kind: "kid" }); });
      dust.forEach((k, j) => Object.assign(k, { parentStar: p, slot: j, slots: dust.length, ang: (j + .5) / dust.length * 6.283 + rand(-.2, .2) }));
    }
    for (const [a, b] of links) {
      const sa = this.stars.find((s) => s.id === a), sb = this.stars.find((s) => s.id === b);
      if (sa && sb) this.links.push({ a: sb, b: sa, w: .4, grow: 0, kind: "peer" });
    }
    // a small key, so the colours mean something without reading
    if (kinds.size) {
      const lg = document.createElement("div");
      lg.className = "forge-legend";
      lg.style.opacity = "0";
      lg.innerHTML = (["mcp", "plugin", "skill"] as const).filter((k) => kinds.has(k)).map((k) => `<span class="k-${k}"><i></i>${KIND_NAME[k]}</span>`).join("")
        + (shared.size ? `<span class="k-shared"><i></i>Shared by two AIs</span>` : "");
      this.labels.append(lg);
      this.legend = lg;
    }
    // everything starts at its agent's core and moves out
    this.layoutStars(0, true);
  }
  private legend: HTMLDivElement | null = null;

  /** Where each star belongs right now (screen px), from the picture area. */
  private layoutStars(t: number, snap = false) {
    const vp = this.vp;
    const agents = this.stars.filter((s) => s.kind === "agent");
    const nA = Math.max(1, agents.length), zoneW = vp.w / nA;
    const ry = Math.min(vp.h * .33, 118), rx = Math.min(zoneW * .3, ry * 1.45);
    const homes = new Map<Star, { x: number; y: number }>();
    agents.forEach((a, i) => homes.set(a, { x: vp.x + zoneW * (i + .5), y: vp.y + vp.h * .47 }));
    for (const s of this.stars) {
      const p = s.parentStar && homes.get(s.parentStar);
      if (!p) continue;
      if (s.kind === "dust") {
        homes.set(s, { x: p.x + Math.cos(s.ang + t * .05) * rx * 1.3, y: p.y + Math.sin(s.ang + t * .05) * ry * 1.25 });
        continue;
      }
      // evenly round the core, leaving the bottom clear for the agent's name
      const gap = .7; // radians kept free either side of straight down
      const ang = Math.PI / 2 + gap + ((s.slot + .5) / s.slots) * (Math.PI * 2 - gap * 2);
      s.ang = ang;
      const bob = this.reduce ? 0 : 1;
      homes.set(s, { x: p.x + Math.cos(ang) * rx + bob * 2.5 * Math.sin(t * .7 + s.seed), y: p.y + Math.sin(ang) * ry + bob * 2 * Math.cos(t * .6 + s.seed) });
    }
    for (const s of this.stars) {
      const h = homes.get(s);
      if (!h) continue;
      if (snap) {
        const from = s.parentStar ? homes.get(s.parentStar) ?? h : h;
        s.sx = from.x; s.sy = from.y;
      }
      s.p = { x: h.x, y: h.y, z: 0 };
    }
    return { rx, ry, homes, zoneW };
  }
  async revealStars(wait: (ms: number) => Promise<void>) { for (const s of this.stars) { s.top = 1; await wait(this.reduce ? 0 : 90); } }
  showAllStars() { for (const s of this.stars) { s.top = 1; s.op = 1; } }
  hasStars() { return this.stars.length > 0; }
  hideStars() { for (const s of this.stars) s.top = 0; }
  /** remove the constellation entirely (its step is over) */
  clearStars() { this.labels.querySelectorAll(".forge-star").forEach((e) => e.remove()); this.legend?.remove(); this.legend = null; this.stars = []; this.links = []; }
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
    this.clearStars();
  }
  addMate(id: string, label: string, side: number) {
    const el = document.createElement("div");
    el.className = "forge-star mate";
    el.textContent = label;
    this.labels.append(el);
    const s: Star = { id, label, kind: "mate", p: { x: 0, y: 0, z: 0 }, sx: side > 0 ? this.W + 40 : -40, sy: this.H * .7, ss: 1, flat: { x: this.W / 2 + side * Math.min(this.W * .3, 380), y: this.H * .7 }, op: 0, top: 1, el, ang: 0, rad: 0, tilt: 0, slot: 0, slots: 1, seed: 0, lw: 0, lh: 0, lx: NaN, ly: NaN };
    this.stars.push(s);
    for (const a of this.stars.filter((x) => x.kind === "agent")) this.links.push({ a, b: s, w: .4, grow: 0, kind: "mate" });
  }

  // ---- the workflow path (3D) -------------------------------------------------------------
  /** Five stages on a gentle 3D arc; the camera drifts so it reads as a
   *  real object. Labels and drop targets follow the projection. */
  setStages(specs: StageSpec[]) {
    const span = Math.min(this.vp.w * .42, 520);
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
      return { ...sp, p: { x: (u * 2 - 1) * span, y: -Math.sin(u * Math.PI) * 18, z: -Math.cos((u * 2 - 1) * Math.PI * .5) * 160 + 80 }, sx: prev?.sx ?? this.vp.x + this.vp.w / 2, sy: prev?.sy ?? this.vp.y + this.vp.h / 2, ss: prev?.ss ?? .3, cur: prev?.cur ?? 0, el, pulse: prev?.pulse ?? false };
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

    // constellation: one column per agent, its tools evenly around it
    const receded = this.labels.classList.contains("recede");
    const beams: GLBeam[] = [];
    const nodes: GLNode[] = [];
    const dimmed = receded ? .35 : 1;
    if (this.stars.length) {
      const { rx, ry, zoneW } = this.layoutStars(reduce ? 0 : t);
      const k = reduce ? 1 : clamp(dt * 3);
      for (const s of this.stars) {
        const to = s.flat ?? s.p;
        s.sx = lerp(s.sx, to.x, k); s.sy = lerp(s.sy, to.y, k);
        s.op = lerp(s.op, s.top, reduce ? 1 : clamp(dt * 3));
      }
      const agents = this.stars.filter((s) => s.kind === "agent");
      // each agent's orbit: a faint ring its tools sit on
      if (!receded) for (const ag of agents) {
        if (ag.op < .02 || ag.flat) continue;
        const N = 64;
        for (let i = 0; i < N; i++) {
          const a0 = i / N * 6.283, a1 = (i + 1) / N * 6.283;
          beams.push({ x1: ag.sx + Math.cos(a0) * rx, y1: ag.sy + Math.sin(a0) * ry, x2: ag.sx + Math.cos(a1) * rx, y2: ag.sy + Math.sin(a1) * ry, r: 1, g: .7, b: .45, a: ag.op * .13, w: 3, dotted: true, u0: i * 6.283 * rx / N });
        }
        nodes.push({ x: ag.sx, y: ag.sy, R: 22, kind: 0, alpha: ag.op, rot: reduce ? .2 : t * .16 + agents.indexOf(ag) * .37, cur: 1 });
      }
      // links grow out from the agent as each tool arrives, then carry pulses
      for (const L of this.links) {
        const { a, b } = L;
        const ready = Math.min(a.op, b.op);
        L.grow = reduce ? (ready > .3 ? 1 : 0) : lerp(L.grow, ready > .3 ? 1 : 0, clamp(dt * 2.6));
        const al = L.w * ready * (receded ? .25 : 1);
        if (al < .02 || L.grow < .01) continue;
        const x2 = lerp(a.sx, b.sx, L.grow), y2 = lerp(a.sy, b.sy, L.grow);
        const [r, g, bl] = KIND_RGB[b.sub ? kindOf(b.sub) : "plugin"];
        if (L.kind === "peer") arc(beams, a.sx, a.sy, x2, y2, -28, { r, g, b: bl, a: al, w: 4, dotted: true });
        else beams.push({ x1: a.sx, y1: a.sy, x2, y2, r, g, b: bl, a: al, w: 6, pulse: reduce ? 0 : .32, seed: (b.seed * .37) % 1 });
      }

      // lights
      const placed: Box[] = [];
      for (const s of this.stars) {
        if (s.op < .02) { s.el.style.opacity = "0"; continue; }
        const dust = s.kind === "dust", agent = s.kind === "agent";
        if (!s.flared && !dust && s.top > .5 && s.op > .5) { s.flared = true; this.burstAt(s.sx, s.sy, agent ? 16 : 9, .9); }
        const big = agent ? 11 : s.kind === "mate" ? 6 : dust ? 2 : 5;
        const breathe = reduce ? 1 : 1 + .08 * Math.sin(t * 2.2 + s.seed);
        pts.push({ x: s.sx, y: s.sy, size: big * breathe, temp: s.kind === "mate" ? .7 : dust ? .65 : 1, alpha: s.op * dimmed * (dust ? .55 : 1), soft: 0 });
        if (!dust) pts.push({ x: s.sx, y: s.sy, size: big * (agent ? 5.5 : 4.2) * breathe, temp: agent ? .7 : .6, alpha: s.op * (agent ? .55 : .4) * dimmed, soft: 1 });
        if (agent) placed.push({ x: s.sx - 16, y: s.sy - 16, w: 32, h: 32 });
      }

      // labels: agents under their core; tools outward from their dot,
      // nudged apart so no label covers another label or a core
      const boxes: [Star, Box, boolean][] = [];
      for (const s of this.stars) {
        if (s.op < .02 || s.kind === "dust") continue;
        if (!s.lw) { s.lw = s.el.offsetWidth; s.lh = s.el.offsetHeight; }
        const w = s.lw, h = s.lh;
        let bx: Box;
        let side = false;
        if (s.kind === "agent" || s.flat || !s.parentStar) bx = { x: s.sx - w / 2, y: s.sy + 18, w, h };
        else {
          const c = Math.cos(s.ang), sn = Math.sin(s.ang);
          // beside the dot when it fits inside its agent's column, else above/below
          const zx = s.parentStar.sx - zoneW / 2 - 12, zr = s.parentStar.sx + zoneW / 2 + 12;
          const sx = c > 0 ? s.sx + 10 : s.sx - 10 - w;
          if (Math.abs(c) > .5 && sx >= zx && sx + w <= zr) { side = true; bx = { x: sx, y: s.sy - h / 2, w, h }; }
          else bx = { x: s.sx - w / 2, y: sn < .2 ? s.sy - 10 - h : s.sy + 10, w, h };
        }
        if (s.kind === "agent") placed.push(bx);
        else boxes.push([s, bx, side]);
      }
      for (let it = 0; it < 3; it++) {
        for (let i = 0; i < boxes.length; i++) {
          const [, r, side] = boxes[i];
          for (const o of [...placed, ...boxes.slice(0, i).map((x) => x[1])]) {
            const ox = Math.min(r.x + r.w, o.x + o.w) - Math.max(r.x, o.x), oy = Math.min(r.y + r.h, o.y + o.h) - Math.max(r.y, o.y);
            if (ox <= 0 || oy <= 0) continue;
            if (side || oy < ox) r.y += (r.y + r.h / 2 >= o.y + o.h / 2 ? 1 : -1) * (oy + 2);
            else r.x += (r.x + r.w / 2 >= o.x + o.w / 2 ? 1 : -1) * (ox + 2);
          }
          r.x = clamp(r.x, this.vp.x - 20, this.vp.x + this.vp.w + 20 - r.w);
        }
      }
      const lk = reduce ? 1 : clamp(dt * 8);
      const show = (s: Star, b: Box) => {
        s.lx = Number.isNaN(s.lx) ? b.x : lerp(s.lx, b.x, lk); s.ly = Number.isNaN(s.ly) ? b.y : lerp(s.ly, b.y, lk);
        s.el.style.transform = `translate(${s.lx.toFixed(1)}px, ${s.ly.toFixed(1)}px)`;
        s.el.style.opacity = String(s.op);
      };
      for (const s of this.stars) if (s.kind === "agent" && s.op >= .02) show(s, { x: s.sx - s.lw / 2, y: s.sy + 18, w: s.lw, h: s.lh });
      for (const [s, b] of boxes) show(s, b);
      if (this.legend) {
        const op = Math.max(0, ...agents.map((a) => a.op)) * (receded ? 0 : 1);
        this.legend.style.transform = `translate(${this.vp.x + this.vp.w / 2}px, ${this.vp.y + this.vp.h}px) translate(-50%, -100%)`;
        this.legend.style.opacity = String(op);
      }
    }

    // workflow path (3D)
    if (this.stages.length) {
      for (const s of this.stages) {
        const pr = this.project(s.p, this.vp.x + this.vp.w / 2, this.vp.y + this.vp.h * .42, this.yaw * .5, .38);
        const k = reduce ? 1 : clamp(dt * 3.2);
        s.sx = lerp(s.sx, pr.x, k); s.sy = lerp(s.sy, pr.y, k); s.ss = lerp(s.ss, pr.s, k);
        s.cur = lerp(s.cur, s.lit ? 1 : 0, reduce ? 1 : clamp(dt * 2.2));
      }
      // the path: a smooth curve through the stages; filled stretches glow
      // and carry light forward, gaps are dashes drifting along
      const st = this.stages;
      for (let i = 0; i < st.length - 1; i++) {
        const p0 = st[Math.max(0, i - 1)], p1 = st[i], p2 = st[i + 1], p3 = st[Math.min(st.length - 1, i + 2)];
        const lit = p1.lit && p2.lit, N = 14;
        const heat = Math.min(p1.cur, p2.cur);
        let prev = { x: p1.sx, y: p1.sy }, u0 = 0;
        for (let j = 1; j <= N; j++) {
          const q = catmull(p0, p1, p2, p3, j / N);
          const seg = Math.hypot(q.x - prev.x, q.y - prev.y);
          if (lit) beams.push({ x1: prev.x, y1: prev.y, x2: q.x, y2: q.y, r: 1, g: .58, b: .24, a: .35 + .6 * heat, w: 8, pulse: reduce ? 0 : .3, seed: i * .23, u0 });
          else beams.push({ x1: prev.x, y1: prev.y, x2: q.x, y2: q.y, r: 1, g: .92, b: .85, a: .4, w: 4, dotted: true, u0 });
          u0 += seg; prev = q;
        }
      }
      st.forEach((s, i) => {
        const pulse = s.pulse && !reduce;
        const size = 34 * clamp(s.ss, .5, 1.6);
        const R = size * .5;
        if (s.cur > .02) nodes.push({ x: s.sx, y: s.sy, R, kind: 1, alpha: s.cur, rot: reduce ? 0 : .12 * Math.sin(t * .9 + i * 1.3) });
        if (s.cur < .98) nodes.push({ x: s.sx, y: s.sy, R: R * 1.15, kind: 2, alpha: (1 - s.cur) * (pulse ? 1 : .8), rot: reduce ? 0 : t * .25 + i * .2 });
        if (pulse) for (let k = 0; k < 2; k++) nodes.push({ x: s.sx, y: s.sy, R: R * 1.2, kind: 3, alpha: 1, rot: (t * .8 + k * .5) % 1 });
        s.el.classList.toggle("gap", !s.lit);
        (s.el.firstChild as HTMLElement).textContent = s.name;
        (s.el.lastChild as HTMLElement).textContent = s.sub;
        s.el.style.transform = `translate(${s.sx}px, ${s.sy + size * .62 + 12}px) translate(-50%, 0)`;
        s.el.style.zIndex = String(Math.round(s.ss * 100));
      });
    }

    // the Spark
    if (sp.born) {
      const k = reduce ? 1 : clamp(dt * 2.2);
      sp.x = lerp(sp.x, sp.tx, k); sp.y = lerp(sp.y, sp.ty, k);
      sp.r = lerp(sp.r, sp.tr, reduce ? 1 : clamp(dt * 2.5));
      sp.energy = lerp(sp.energy, sp.speaking && !reduce ? 1 + .5 * Math.sin(t * 11) : 0, clamp(dt * 8));
      sp.flash = lerp(sp.flash, 0, clamp(dt * 1.6));
      if (sp.alpha > 0) halo(sp.x, sp.y, sp.r * 5, sp.alpha);
    }
    this.gl.draw({
      time: t, w: W, h: H, dim: 0, calm: 0, points: pts, lines: [], beams, nodes,
      spark: sp.born ? { x: sp.x, y: sp.y, r: sp.r, energy: sp.energy, glow: sp.glow + sp.flash, alpha: sp.alpha } : null,
    });
    if (sp.born) this.onFrame?.({ x: sp.x, y: sp.y, r: sp.r });
  }
}

/** A curved glowing link from (x1,y1) to (x2,y2), bowed by `bow` px. */
function arc(out: GLBeam[], x1: number, y1: number, x2: number, y2: number, bow: number, o: Omit<GLBeam, "x1" | "y1" | "x2" | "y2" | "u0">) {
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const nx = -(y2 - y1) / len, ny = (x2 - x1) / len, N = 12;
  let px = x1, py = y1, u0 = 0;
  for (let i = 1; i <= N; i++) {
    const t = i / N, k = 4 * t * (1 - t);
    const x = lerp(x1, x2, t) + nx * bow * k, y = lerp(y1, y2, t) + ny * bow * k;
    out.push({ ...o, x1: px, y1: py, x2: x, y2: y, u0 });
    u0 += Math.hypot(x - px, y - py); px = x; py = y;
  }
}

/** Catmull-Rom between p1 and p2 (screen positions). */
function catmull(p0: { sx: number; sy: number }, p1: { sx: number; sy: number }, p2: { sx: number; sy: number }, p3: { sx: number; sy: number }, t: number) {
  const t2 = t * t, t3 = t2 * t;
  const f = (a: number, b: number, c: number, d: number) => .5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  return { x: f(p0.sx, p1.sx, p2.sx, p3.sx), y: f(p0.sy, p1.sy, p2.sy, p3.sy) };
}
