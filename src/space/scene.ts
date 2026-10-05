// ---------------------------------------------------------------------------
// Code Space's 3D scene (three.js), kept apart from React: React tells it
// what to show and hears what you hover and click.
//
//   stars      a quiet starfield that turns very slowly
//   folders    folder glyphs that always face you; repos glow ember, folders
//              where an agent is working pulse, ones that need you go gold
//   files      small sheets under their folder, drawn all at once (one draw
//              call however many there are); changed-today files light up,
//              and in Architecture mode each takes its part's color
//   links      faint threads from each folder to what's inside it
//   parts      Architecture mode: one glowing hub per part of the app, with
//              threads to its files and between parts that talk
//   labels     crisp HTML labels for what's near and what matters, placed
//              each frame (a few dozen at most)
// Drag to orbit, scroll to zoom; picking something flies the camera to it.
// Inspired by the spatial view in extend-hq/jevbox (MIT); our own code.
// ---------------------------------------------------------------------------

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { Placed } from "./layout";

export type Glow = "working" | "needs" | "done";
export interface Hub { id: string; label: string; color: string; pos: [number, number, number]; files: [number, number, number][] }
/** A session on the map: a glowing orb above what it's on, a thread down. */
export interface Marker { id: string; label: string; color: string; at: [number, number, number]; working: boolean; needs: boolean }

const BG = 0x07060a;
const EMBER = "#e0793a";
const GOLD = "#f2c14e";
const FOLDER = "#7d86ad";
const SHEET = "#c9c6d6";

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function folderTexture(color: string): THREE.CanvasTexture {
  return canvasTexture(256, 208, (g) => {
    g.scale(2, 2);
    // the back and its tab, a shade darker
    g.fillStyle = `${color}cc`;
    g.beginPath();
    g.roundRect(8, 10, 50, 22, 8);
    g.fill();
    g.beginPath();
    g.roundRect(6, 20, 116, 70, 11);
    g.fill();
    // the front, glassy: light at the top, deeper below
    const grad = g.createLinearGradient(0, 30, 0, 98);
    grad.addColorStop(0, color);
    grad.addColorStop(1, `${color}b0`);
    g.fillStyle = grad;
    g.beginPath();
    g.roundRect(6, 30, 116, 68, 11);
    g.fill();
    // rim light along the top edge
    g.strokeStyle = "rgba(255,255,255,0.45)";
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(16, 31.5);
    g.lineTo(112, 31.5);
    g.stroke();
    // a soft sheen
    const sheen = g.createLinearGradient(0, 30, 0, 64);
    sheen.addColorStop(0, "rgba(255,255,255,0.22)");
    sheen.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = sheen;
    g.beginPath();
    g.roundRect(6, 30, 116, 34, 11);
    g.fill();
  });
}

const sheetTexture = () => canvasTexture(64, 64, (g) => {
  // a page with a folded corner and a few lines of "text"
  g.fillStyle = "#ffffff";
  g.beginPath();
  g.moveTo(14, 4); g.lineTo(42, 4); g.lineTo(52, 14); g.lineTo(52, 60); g.lineTo(14, 60); g.closePath();
  g.fill();
  g.fillStyle = "rgba(0,0,0,0.18)";
  g.beginPath(); g.moveTo(42, 4); g.lineTo(42, 14); g.lineTo(52, 14); g.closePath(); g.fill();
  for (let y = 22; y < 54; y += 6) g.fillRect(19, y, y % 12 ? 22 : 28, 2);
});

const glowTexture = () => canvasTexture(64, 64, (g) => {
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, "rgba(255,255,255,1)");
  r.addColorStop(0.25, "rgba(255,255,255,0.45)");
  r.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
});

const ringTexture = () => canvasTexture(64, 64, (g) => {
  g.strokeStyle = "#ffffff";
  g.lineWidth = 3;
  g.setLineDash([7, 5]);
  g.beginPath();
  g.arc(32, 32, 26, 0, Math.PI * 2);
  g.stroke();
});

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class SpaceScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private world = new THREE.Group();
  private stars: THREE.Points;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2(9, 9);
  private placed: Placed[] = [];
  private folderSprites: THREE.Sprite[] = [];
  private fileIndex: number[] = [];
  private filePoints: THREE.Points | null = null;
  private glows: { sprite: THREE.Sprite; kind: Glow; seed: number }[] = [];
  private selectRing: THREE.Sprite;
  private labels: HTMLDivElement[] = [];
  private tween: { from: THREE.Vector3; to: THREE.Vector3; tFrom: THREE.Vector3; tTo: THREE.Vector3; start: number; ms: number } | null = null;
  private frame = 0;
  private hovered: number | null = null;
  private selected: number | null = null;
  private hubs: { hub: Hub; sprite: THREE.Sprite }[] = [];
  private markers: { m: Marker; orb: THREE.Sprite; halo: THREE.Sprite; seed: number }[] = [];
  private markerGroup = new THREE.Group();
  private rings = new THREE.Group();
  private tex = { folder: folderTexture(FOLDER), repo: folderTexture(EMBER), sheet: sheetTexture(), glow: glowTexture(), ring: ringTexture() };
  private ro: ResizeObserver;
  private dirty = true;
  onHover: (p: Placed | null) => void = () => {};
  onPick: (p: Placed) => void = () => {};

  constructor(private host: HTMLElement, private labelLayer: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(BG);
    host.appendChild(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 3000);
    this.camera.position.set(30, 34, 52);
    this.scene.fog = new THREE.FogExp2(BG, 0.0065);
    this.scene.add(this.world);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 2.5;
    this.controls.maxDistance = 600;
    this.controls.addEventListener("change", () => { this.dirty = true; });
    this.controls.addEventListener("start", () => { this.tween = null; });

    // stars on a far shell
    const n = 1600;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(400 + Math.random() * 500);
      pos.set([v.x, v.y, v.z], i * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0x8b8fa6, size: 1.3, sizeAttenuation: false, transparent: true, opacity: 0.75, fog: false }));
    this.scene.add(this.stars);

    this.selectRing = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex.glow, color: new THREE.Color(EMBER), transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.selectRing.visible = false;
    this.scene.add(this.selectRing);
    this.scene.add(this.markerGroup, this.rings);

    // a faint nebula far behind everything: ember on one side, indigo on the other
    for (const [color, x, y, z, size, op] of [["#e0793a", -420, 120, -620, 900, 0.10], ["#5b5bd6", 520, -60, -560, 1000, 0.09], ["#2ac3de", 80, 320, -700, 700, 0.05]] as const) {
      const n = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex.glow, color: new THREE.Color(color), transparent: true, opacity: op, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
      n.scale.set(size, size, 1);
      n.position.set(x, y, z);
      this.scene.add(n);
    }

    const el = this.renderer.domElement;
    el.addEventListener("pointermove", (e) => {
      const r = el.getBoundingClientRect();
      this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      this.dirty = true;
    });
    el.addEventListener("pointerleave", () => { this.pointer.set(9, 9); this.dirty = true; });
    let down = { x: 0, y: 0 };
    el.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY }; });
    el.addEventListener("pointerup", (e) => {
      // a click, not the end of a drag
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
      if (this.hovered !== null) this.onPick(this.placed[this.hovered]);
    });
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
    const loop = (t: number) => { this.frame = requestAnimationFrame(loop); this.tick(t); };
    this.frame = requestAnimationFrame(loop);
  }

  private resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = `${w}px`;
    this.renderer.domElement.style.height = `${h}px`;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.dirty = true;
  }

  /** Show these entries. `fileColor` colors a file (null: the plain sheet);
   *  `glow` marks folders by path. */
  setData(placed: Placed[], fileColor: (p: Placed) => string | null, glow: Map<string, Glow>) {
    this.world.clear();
    this.folderSprites = [];
    this.glows = [];
    this.fileIndex = [];
    this.hubs = [];
    this.placed = placed;
    this.hovered = null;
    this.selected = null;
    this.selectRing.visible = false;
    const index = new Map(placed.map((p, i) => [p.path, i]));

    // threads from each folder to its sub-folders
    const link: number[] = [];
    for (const p of placed) {
      if (p.kind !== "folder" || !p.parent) continue;
      const parent = placed[index.get(p.parent) ?? -1];
      if (parent) link.push(...parent.pos, ...p.pos);
    }
    if (link.length) {
      const lg = new THREE.BufferGeometry();
      lg.setAttribute("position", new THREE.Float32BufferAttribute(link, 3));
      this.world.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x3b3650, transparent: true, opacity: 0.55 })));
    }

    // folders
    const folderMat = new THREE.SpriteMaterial({ map: this.tex.folder, transparent: true, alphaTest: 0.2 });
    const repoMat = new THREE.SpriteMaterial({ map: this.tex.repo, transparent: true, alphaTest: 0.2 });
    placed.forEach((p, i) => {
      if (p.kind !== "folder") return;
      const s = new THREE.Sprite(p.repo ? repoMat : folderMat);
      const size = 1.5 + Math.log2(1 + p.weight) * 0.55 + (p.depth === 0 ? 0.8 : 0);
      s.scale.set(size, size * 0.81, 1);
      s.position.set(...p.pos);
      s.userData.i = i;
      this.world.add(s);
      this.folderSprites.push(s);
      const g = glow.get(p.path);
      if (g) {
        const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex.glow, color: new THREE.Color(g === "needs" ? GOLD : g === "done" ? "#4fbf87" : EMBER), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
        halo.scale.set(size * 3.2, size * 3.2, 1);
        halo.position.set(...p.pos);
        this.world.add(halo);
        this.glows.push({ sprite: halo, kind: g, seed: Math.random() * 6 });
      }
    });

    // files, one draw call
    const files = placed.map((p, i) => [p, i] as const).filter(([p]) => p.kind === "file");
    if (files.length) {
      const pos = new Float32Array(files.length * 3);
      const col = new Float32Array(files.length * 3);
      const c = new THREE.Color();
      files.forEach(([p, i], k) => {
        pos.set(p.pos, k * 3);
        c.set(fileColor(p) ?? SHEET);
        col.set([c.r, c.g, c.b], k * 3);
        this.fileIndex.push(i);
      });
      const fg = new THREE.BufferGeometry();
      fg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      fg.setAttribute("color", new THREE.BufferAttribute(col, 3));
      this.filePoints = new THREE.Points(fg, new THREE.PointsMaterial({ size: 1.25, map: this.tex.sheet, vertexColors: true, transparent: true, alphaTest: 0.35, sizeAttenuation: true }));
      this.world.add(this.filePoints);
    } else {
      this.filePoints = null;
    }
    this.dirty = true;
  }

  /** Architecture mode: hubs for the app's parts, threads to their files,
   *  and between parts that talk. Empty list clears it. */
  setHubs(input: Hub[], links: [string, string][]) {
    let hubs = input;
    for (const h of this.hubs) this.world.remove(h.sprite);
    this.world.children.filter((o) => o.userData.arch).forEach((o) => this.world.remove(o));
    this.hubs = [];
    if (!hubs.length) { this.dirty = true; return; }
    // parts whose files sit in the same place would stack: fan them out
    hubs = hubs.map((h, i) => {
      const crowd = hubs.filter((o, j) => j < i && Math.hypot(o.pos[0] - h.pos[0], o.pos[2] - h.pos[2]) < 6).length;
      if (!crowd) return h;
      const a = crowd * 2.1;
      return { ...h, pos: [h.pos[0] + Math.cos(a) * 7 * Math.sqrt(crowd), h.pos[1] + crowd * 1.5, h.pos[2] + Math.sin(a) * 7 * Math.sqrt(crowd)] as [number, number, number] };
    });
    const at = new Map(hubs.map((h) => [h.id, h]));
    for (const h of hubs) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex.glow, color: new THREE.Color(h.color), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      s.scale.set(5, 5, 1);
      s.position.set(...h.pos);
      this.world.add(s);
      this.hubs.push({ hub: h, sprite: s });
      const seg: number[] = [];
      for (const f of h.files.slice(0, 300)) seg.push(...h.pos, ...f);
      if (seg.length) {
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute(seg, 3));
        const lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: new THREE.Color(h.color), transparent: true, opacity: 0.16 }));
        lines.userData.arch = true;
        this.world.add(lines);
      }
    }
    const between: number[] = [];
    for (const [a, b] of links) {
      const A = at.get(a), B = at.get(b);
      if (A && B) between.push(...A.pos, ...B.pos);
    }
    if (between.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(between, 3));
      const lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xf2e8de, transparent: true, opacity: 0.55 }));
      lines.userData.arch = true;
      this.world.add(lines);
    }
    this.dirty = true;
  }

  /** Sessions on the map: an orb floating above what each is on, with a
   *  thread down to it. Working ones breathe; ones that need you pulse gold. */
  setMarkers(list: Marker[]) {
    this.markerGroup.clear();
    this.markers = [];
    const thread: number[] = [];
    // sessions on the same spot stack upward instead of overlapping
    const seen = new Map<string, number>();
    for (const m of list) {
      const key = m.at.map((n) => n.toFixed(1)).join();
      const n = seen.get(key) ?? 0;
      seen.set(key, n + 1);
      const top: [number, number, number] = [m.at[0], m.at[1] + 4.2 + n * 2.2, m.at[2]];
      const orb = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex.glow, color: new THREE.Color(m.needs ? GOLD : m.color), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      orb.scale.set(1.6, 1.6, 1);
      orb.position.set(...top);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex.glow, color: new THREE.Color(m.needs ? GOLD : m.color), transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }));
      halo.scale.set(4.5, 4.5, 1);
      halo.position.set(...top);
      this.markerGroup.add(orb, halo);
      this.markers.push({ m: { ...m, at: top }, orb, halo, seed: Math.random() * 6 });
      thread.push(...top, ...m.at);
    }
    if (thread.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(thread, 3));
      this.markerGroup.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 })));
    }
    this.dirty = true;
  }

  /** Rings around spots where two sessions' changes could collide. */
  setRings(spots: [number, number, number][]) {
    this.rings.clear();
    for (const p of spots.slice(0, 60)) {
      const r = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex.ring, color: new THREE.Color("#f7768e"), transparent: true, depthWrite: false }));
      r.scale.set(2.4, 2.4, 1);
      r.position.set(...p);
      this.rings.add(r);
    }
    this.dirty = true;
  }

  /** Fly the camera so it looks at `target` from `camera`. */
  flyTo(target: [number, number, number], camera: [number, number, number], ms = 900) {
    this.tween = {
      from: this.camera.position.clone(), to: new THREE.Vector3(...camera),
      tFrom: this.controls.target.clone(), tTo: new THREE.Vector3(...target),
      start: performance.now(), ms,
    };
  }

  select(path: string | null) {
    const i = path ? this.placed.findIndex((p) => p.path === path) : -1;
    this.selected = i >= 0 ? i : null;
    this.selectRing.visible = i >= 0;
    if (i >= 0) {
      const p = this.placed[i];
      this.selectRing.position.set(...p.pos);
      const s = p.kind === "file" ? 2.6 : 5 + Math.log2(1 + p.weight);
      this.selectRing.scale.set(s, s, 1);
    }
    this.dirty = true;
  }

  private pick(): number | null {
    if (Math.abs(this.pointer.x) > 1 || Math.abs(this.pointer.y) > 1) return null;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const dist = this.camera.position.distanceTo(this.controls.target);
    this.raycaster.params.Points = { threshold: Math.max(0.35, dist / 120) };
    const hits = this.raycaster.intersectObjects([...this.folderSprites, ...(this.filePoints ? [this.filePoints] : [])], false);
    const h = hits[0];
    if (!h) return null;
    if (h.object === this.filePoints && h.index !== undefined) return this.fileIndex[h.index] ?? null;
    return (h.object.userData.i as number) ?? null;
  }

  private tick(t: number) {
    if (this.tween) {
      const k = Math.min(1, (t - this.tween.start) / this.tween.ms);
      const e = ease(k);
      this.camera.position.lerpVectors(this.tween.from, this.tween.to, e);
      this.controls.target.lerpVectors(this.tween.tFrom, this.tween.tTo, e);
      if (k >= 1) this.tween = null;
      this.dirty = true;
    }
    // draw only when something changed: the camera moved, something glows,
    // or the pointer moved (idle, it costs nothing)
    if (this.controls.update()) this.dirty = true;
    if (!this.dirty && !this.glows.length && !this.markers.length) return;
    this.stars.rotation.y = t * 0.000008;
    // working folders breathe, ones that need you pulse a little faster
    for (const k of this.markers) {
      const speed = k.m.needs ? 0.005 : k.m.working ? 0.0028 : 0;
      const b = speed ? 0.5 + 0.5 * Math.sin(t * speed + k.seed) : 0.4;
      (k.halo.material as THREE.SpriteMaterial).opacity = 0.18 + 0.35 * b;
      const s = 4 + b * 1.4;
      k.halo.scale.set(s, s, 1);
    }
    for (const g of this.glows) {
      const speed = g.kind === "needs" ? 0.004 : 0.0022;
      (g.sprite.material as THREE.SpriteMaterial).opacity = g.kind === "done" ? 0.5 : 0.35 + 0.3 * (0.5 + 0.5 * Math.sin(t * speed + g.seed));
    }
    if (this.dirty) {
      const h = this.pick();
      if (h !== this.hovered) {
        this.hovered = h;
        this.renderer.domElement.style.cursor = h === null ? "grab" : "pointer";
        this.onHover(h === null ? null : this.placed[h]);
      }
    }
    this.renderer.render(this.scene, this.camera);
    this.placeLabels();
    this.dirty = !!this.tween;
  }

  /** A few dozen labels: the hovered and selected thing, the hubs, and the
   *  folders and files that are biggest on screen right now. */
  private placeLabels() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    const v = new THREE.Vector3();
    type L = { text: string; x: number; y: number; score: number; cls: string; color?: string };
    const out: L[] = [];
    const add = (text: string, pos: [number, number, number], score: number, cls: string, color?: string) => {
      v.set(...pos).project(this.camera);
      if (v.z > 1 || v.x < -1.1 || v.x > 1.1 || v.y < -1.1 || v.y > 1.1) return;
      out.push({ text, x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h, score, cls, color });
    };
    for (const { m } of this.markers) add(m.label, [m.at[0], m.at[1] + 0.9, m.at[2]], 2e9, `marker${m.needs ? " needs" : ""}`, m.color);
    const cam = this.camera.position;
    this.placed.forEach((p, i) => {
      const d = cam.distanceTo(v.set(...p.pos));
      const special = i === this.hovered || i === this.selected;
      const score = special ? 1e9 : p.kind === "folder" ? (p.weight + 2) / d : 0.6 / d;
      if (!special && p.kind === "file" && d > 16) return;
      add(p.name, p.pos, score, `${p.kind}${special ? " on" : ""}${p.repo ? " repo" : ""}`);
    });
    for (const { hub } of this.hubs) add(hub.label, [hub.pos[0], hub.pos[1] + 2.4, hub.pos[2]], 1e8, "hub");
    out.sort((a, b) => b.score - a.score);
    // most important first; a label that would overlap one already shown is skipped
    const show: L[] = [];
    const boxes: [number, number, number, number][] = [];
    for (const l of out) {
      if (show.length >= 44) break;
      const bw = l.text.length * (l.cls.includes("file") ? 6 : 7) + 10, bh = 16;
      // session chips sit above their point, other labels below it
      const b: [number, number, number, number] = l.cls.startsWith("marker") ? [l.x - bw / 2 - 12, l.y - 30, bw + 24, 24] : [l.x - bw / 2, l.y + 8, bw, bh];
      if (!l.cls.includes(" on") && boxes.some((o) => b[0] < o[0] + o[2] && b[0] + b[2] > o[0] && b[1] < o[1] + o[3] && b[1] + b[3] > o[1])) continue;
      boxes.push(b);
      show.push(l);
    }
    while (this.labels.length < show.length) {
      const d = document.createElement("div");
      d.className = "space-label";
      this.labelLayer.appendChild(d);
      this.labels.push(d);
    }
    this.labels.forEach((d, i) => {
      const l = show[i];
      if (!l) { d.style.display = "none"; return; }
      d.style.display = "";
      if (d.textContent !== l.text) d.textContent = l.text;
      if (d.dataset.cls !== l.cls) { d.dataset.cls = l.cls; d.className = `space-label ${l.cls}`; }
      const col = l.color ?? "";
      if (d.dataset.col !== col) { d.dataset.col = col; d.style.setProperty("--c", col || "transparent"); }
      d.style.transform = `translate(${Math.round(l.x)}px, ${Math.round(l.y)}px)`;
    });
  }

  dispose() {
    cancelAnimationFrame(this.frame);
    this.ro.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
    Object.values(this.tex).forEach((t) => t.dispose());
    this.renderer.domElement.remove();
    this.labels.forEach((d) => d.remove());
  }
}
