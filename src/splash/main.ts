// ---------------------------------------------------------------------------
// Launch animation ("Ember swarm"), shown in a see-through, borderless splash
// window the same size as the app window:
//   particles drift in from the edges → form the 3D logo → it spins catching
//   light → sinks into a glass box → the box fills with real loading progress
//   (sent by the hidden main window) → the box opens into the app window.
// Later launches play a ~1 s version with "Welcome back". Click to skip.
// ---------------------------------------------------------------------------

import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/chakra-petch/600.css";
import * as THREE from "three";
import { FontLoader } from "three/examples/jsm/loaders/FontLoader.js";
import { TextGeometry } from "three/examples/jsm/geometries/TextGeometry.js";
import { MeshSurfaceSampler } from "three/examples/jsm/math/MeshSurfaceSampler.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import fontJson from "./chakra-bold.typeface.json";
import { probeFps } from "../lib/perf";
import { LOGO_TEXT } from "../brand";
import { GIVE_UP_S, MAX_STEP_S, PACE, REVEAL_AT, TIMELINE, WELCOME_HOLD_S, clamp, modeOf, nextFill, shouldExpand, skipOffset, span, stalled, welcomeLine } from "./timeline";

// the app passes these in (src-tauri/src/splash.rs); a browser preview uses ?mode=back&name=…
const boot = (window as { __GRILLME_SPLASH__?: { mode?: string; name?: string } }).__GRILLME_SPLASH__;

const params = new URLSearchParams(location.search);
const mode = modeOf(boot?.mode ?? params.get("mode"));
const tl = TIMELINE[mode];
const userName = boot?.name ?? params.get("name") ?? "";

const native = "__TAURI_INTERNALS__" in window;


const FONT = new FontLoader().parse(fontJson as never);
const EMBER = new THREE.Color("#e0793a"), GOLD = new THREE.Color("#f2c14e"), HOT = new THREE.Color("#ff4f1a");
const eOut = (x: number) => 1 - Math.pow(1 - x, 3);
const eIn = (x: number) => x * x * x;
const eIO = (x: number) => (x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const eBack = (x: number) => { const c = 1.6; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
const gradient = (k: number, out: THREE.Color) => out.copy(HOT).lerp(EMBER, clamp(k * 1.8)).lerp(GOLD, clamp((k - .45) / .55));

const canvas = document.getElementById("c") as HTMLCanvasElement;
const welcome = document.getElementById("welcome") as HTMLDivElement;
const caption = document.getElementById("caption") as HTMLDivElement;

// ---- talking to the app ------------------------------------------------------
let progress = 0, label = "Starting", mates: number | null = null;
let revealed = false, closed = false;
async function call(cmd: "splash_reveal" | "splash_close") {
  if (!native) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke(cmd).catch(() => {});
}
async function wire() {
  if (!native) {
    // browser preview: fake an uneven cold start
    for (const [at, v, l] of [[150, .1, "Starting"], [700, .3, "Reading your projects"], [1500, .6, "Connecting to your team"], [2600, 1, "Ready"]] as const) {
      setTimeout(() => { progress = v; label = l; }, at);
    }
    return;
  }
  const { listen, emitTo } = await import("@tauri-apps/api/event");
  await listen<{ value: number; label: string }>("boot-progress", (e) => {
    progress = Math.max(progress, clamp(e.payload.value));
    label = e.payload.label || label;
  });
  await listen<{ mates: number }>("splash-info", (e) => { mates = Math.max(0, e.payload.mates | 0); });
  await emitTo("main", "splash-ready", {});
}
void wire();

// ---- scene ---------------------------------------------------------------------
let renderer: THREE.WebGLRenderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
} catch {
  // no WebGL: just open the app
  void call("splash_reveal").then(() => call("splash_close"));
  throw new Error("no webgl");
}
// 1.5× is sharp on Retina for soft glowing shapes and draws ~45% fewer pixels than 2×
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setClearColor(0x000000, 0);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
const scene = new THREE.Scene();
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(renderer), 0.04).texture;
const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
camera.position.set(0, 0, 10);
const key = new THREE.PointLight(0xffc89a, 90, 0, 2);
const rim = new THREE.DirectionalLight(0x86b4ff, 1.6);
rim.position.set(-5, 2, -4);
const fillLight = new THREE.DirectionalLight(0xffffff, 0.35);
fillLight.position.set(2, 4, 6);
scene.add(key, rim, fillLight, new THREE.AmbientLight(0xffffff, 0.12));

const visH = () => 2 * camera.position.z * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
const visW = () => visH() * camera.aspect;
const wpp = () => visH() / innerHeight;
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener("resize", resize);
resize();

function edgePoint(margin = 0.6) {
  const W = visW() / 2 + margin, H = visH() / 2 + margin;
  const side = Math.floor(Math.random() * 4), u = Math.random() * 2 - 1;
  const p = side === 0 ? [-W, u * H] : side === 1 ? [W, u * H] : side === 2 ? [u * W, H] : [u * W, -H];
  return new THREE.Vector3(p[0], p[1], (Math.random() - .5) * 3);
}

// 3D logo with an ember → gold gradient, darker on the back for shading
const textGeo = new TextGeometry(LOGO_TEXT, { font: FONT, size: 1, height: 0.32, curveSegments: 6, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.025, bevelSegments: 3 } as never);
textGeo.computeBoundingBox();
const w0 = textGeo.boundingBox!.max.x - textGeo.boundingBox!.min.x;
const s = Math.min(4.8, visW() * 0.5) / w0;
textGeo.center();
textGeo.scale(s, s, s);
textGeo.computeBoundingBox();
const { min, max } = textGeo.boundingBox!;
{
  const pos = textGeo.attributes.position, colors = new Float32Array(pos.count * 3), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    gradient((pos.getX(i) - min.x) / (max.x - min.x), c);
    const back = pos.getZ(i) < 0 ? 0.55 : 1;
    colors.set([c.r * back, c.g * back, c.b * back], i * 3);
  }
  textGeo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
}
const textMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.65, roughness: 0.22, envMapIntensity: 1.35, transparent: true, opacity: 0 });
const text = new THREE.Mesh(textGeo, textMat);
const textGroup = new THREE.Group();
textGroup.add(text);
scene.add(textGroup);

// particles that land on the logo's surface. Each one's whole flight is
// computed on the GPU from its start/curve/target and the clock, so the CPU
// does no per-particle work per frame.
const N = mode === "first" ? 3600 : 0;
const START = new Float32Array(N * 3), MID = new Float32Array(N * 3), TARGET = new Float32Array(N * 3);
const C = new Float32Array(N * 3), TIMING = new Float32Array(N * 4);
{
  const sampler = new MeshSurfaceSampler(text).build();
  const tmp = new THREE.Vector3(), c = new THREE.Color(), cream = new THREE.Color(1, .93, .8);
  for (let i = 0; i < N; i++) {
    sampler.sample(tmp);
    const start = edgePoint();
    const mid = start.clone().lerp(tmp, 0.5);
    mid.x += (Math.random() - .5) * 2.4; mid.y += (Math.random() - .5) * 2.4; mid.z += Math.random() * 2.5;
    START.set([start.x, start.y, start.z], i * 3);
    MID.set([mid.x, mid.y, mid.z], i * 3);
    TARGET.set([tmp.x, tmp.y, tmp.z], i * 3);
    gradient((tmp.x - min.x) / (max.x - min.x), c).lerp(cream, Math.random() * .35);
    C.set([c.r, c.g, c.b], i * 3);
    // delay, flight time, size, wobble phase
    TIMING.set([Math.random() * 0.3 * PACE, (0.6 + Math.random() * 0.2) * PACE, 0.6 + Math.random() * 1.1, Math.random() * 6.28], i * 4);
  }
}
const pGeo = new THREE.BufferGeometry();
pGeo.setAttribute("position", new THREE.BufferAttribute(TARGET, 3));
pGeo.setAttribute("aStart", new THREE.BufferAttribute(START, 3));
pGeo.setAttribute("aMid", new THREE.BufferAttribute(MID, 3));
pGeo.setAttribute("color", new THREE.BufferAttribute(C, 3));
pGeo.setAttribute("aTiming", new THREE.BufferAttribute(TIMING, 4));
const pUniforms = {
  uTime: { value: 0 },
  uFadeFrom: { value: tl.inEnd - 0.25 * PACE },
  uFadeLen: { value: 0.4 * PACE },
  uFadeIn: { value: 0.06 * PACE },
  scale: { value: renderer.getPixelRatio() * innerHeight / 12 },
};
const points = new THREE.Points(pGeo, new THREE.ShaderMaterial({
  uniforms: pUniforms,
  vertexShader: `attribute vec3 aStart; attribute vec3 aMid; attribute vec4 aTiming; attribute vec3 color;
    uniform float uTime, uFadeFrom, uFadeLen, uFadeIn, scale;
    varying vec3 vC; varying float vA;
    void main(){
      float u = clamp((uTime - aTiming.x) / aTiming.y, 0.0, 1.0);
      u = u < 0.5 ? 4.0 * u * u * u : 1.0 - pow(-2.0 * u + 2.0, 3.0) / 2.0;
      float v = 1.0 - u, wob = v * 0.12;
      vec3 p = v * v * aStart + 2.0 * v * u * aMid + u * u * position;
      p.x += sin(uTime * 5.0 + aTiming.w) * wob;
      p.y += cos(uTime * 4.0 + aTiming.w) * wob;
      vC = color;
      vA = clamp((uTime - aTiming.x) / uFadeIn, 0.0, 1.0) * (1.0 - clamp((uTime - uFadeFrom) / uFadeLen, 0.0, 1.0));
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      gl_PointSize = aTiming.z * (0.55 + v * 1.1) * scale / -mv.z;
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: `varying vec3 vC; varying float vA;
    void main(){ float d = length(gl_PointCoord - .5); float a = smoothstep(.5, 0., d); a *= a; gl_FragColor = vec4(vC * (1.0 + 2.2 * a * a), a * vA); }`,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
}));
points.frustumCulled = false;
textGroup.add(points);

// the glass box and its molten fill
const BOX = 1.5, inner = BOX * 0.86;
const box = new THREE.Group();
const glassMat = new THREE.MeshStandardMaterial({ color: 0xffd6bd, metalness: 0.1, roughness: 0.05, transparent: true, opacity: 0.13, envMapIntensity: 1.8, depthWrite: false, side: THREE.DoubleSide });
const edgeMat = new THREE.LineBasicMaterial({ color: 0xffb27a, transparent: true, opacity: 0.85 });
box.add(new THREE.Mesh(new RoundedBoxGeometry(BOX, BOX, BOX, 6, 0.14), glassMat));
box.add(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(BOX * .985, BOX * .985, BOX * .985)), edgeMat));
const fillGeo = new THREE.BoxGeometry(inner, 1, inner);
fillGeo.translate(0, 0.5, 0);
const fillMat = new THREE.MeshStandardMaterial({ color: EMBER, emissive: EMBER, emissiveIntensity: 0.55, roughness: 0.22, metalness: 0.25, envMapIntensity: 0.25, transparent: true, opacity: 0.95 });
const fill = new THREE.Mesh(fillGeo, fillMat);
fill.position.y = -inner / 2;
box.add(fill);
box.scale.setScalar(0.0001);
scene.add(box);

// ---- frame -------------------------------------------------------------------------
function update(t: number, f: number, e: number) {
  pUniforms.uTime.value = t;
  points.visible = N > 0 && t < tl.inEnd + 0.2 * PACE;
  textMat.opacity = N ? span(t, tl.inEnd - 0.35 * PACE, tl.inEnd) : eOut(span(t, 0, 0.25 * PACE));

  const sp = span(t, tl.spin[0], tl.spin[1]);
  const turn = mode === "first" ? eIO(sp) * Math.PI * 2 : -Math.PI * 0.6 * (1 - eOut(sp));
  textGroup.rotation.set(0.14 * Math.sin(sp * Math.PI) - 0.04, turn + 0.08 * Math.sin(t * 0.8), 0);
  const a = sp * Math.PI * 2 + 0.9;
  key.position.set(Math.cos(a) * 5.5, 2.4, Math.sin(a) * 3 + 4);

  const fp = span(t, tl.fold[0], tl.fold[1]), sink = eIn(fp);
  textGroup.scale.setScalar(Math.max(0.0001, 1 - sink));
  textGroup.position.y = -0.3 * sink;
  textGroup.rotation.x -= 1.25 * eIO(fp);
  textGroup.visible = fp < 1;
  const grow = fp > 0 ? eBack(fp) : 0;

  fill.scale.y = Math.max(0.0001, f * inner);
  fillMat.color.copy(HOT).lerp(EMBER, 0.45).lerp(GOLD, f * 0.3);
  fillMat.emissive.copy(HOT).lerp(EMBER, 0.3).multiplyScalar(0.7);
  fillMat.emissiveIntensity = 0.55 + 0.15 * Math.sin(t * 6);

  // open into the window: this window IS the app window's frame
  const ee = eIO(e), k = wpp();
  const sx = (innerWidth * k) / BOX, sy = (innerHeight * k) / BOX;
  const base = Math.max(0.0001, grow);
  box.scale.set(THREE.MathUtils.lerp(base, sx, ee), THREE.MathUtils.lerp(base, sy, ee), THREE.MathUtils.lerp(base, 0.02, ee));
  box.position.set(0, 0.06 * Math.sin(t * 2.2) * (1 - ee), 0);
  box.rotation.set(THREE.MathUtils.lerp(0.4, 0, ee), THREE.MathUtils.lerp(0.62 + 0.15 * Math.sin(t * 0.9) + (1 - clamp(grow)) * 1.4, 0, ee), 0);
  glassMat.opacity = 0.13 * (1 - span(ee, 0, 0.45));
  edgeMat.opacity = THREE.MathUtils.lerp(0.85, 0.9, span(ee, 0, 0.3)) * (1 - span(ee, 0.75, 1));
  fillMat.opacity = 0.95 * (1 - span(ee, 0.1, 0.6));
}

// ---- run -------------------------------------------------------------------------------
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
let t0 = performance.now();
let last = t0, clock = 0, offset = 0, shownFill = 0, expandAt: number | null = null, shownAt: number | null = null;

// only touch the page when something visible changed (DOM writes every
// frame cost layout time and show up as stutter)
let captionKey = "", captionAlpha = "";
const capLabel = document.createElement("span"), capPct = document.createElement("b");
caption.append(capLabel, capPct);
function setCaption(f: number, alpha: number) {
  const key = `${label}|${Math.round(f * 100)}`;
  if (key !== captionKey) {
    captionKey = key;
    caption.style.top = `${innerHeight / 2 + (BOX * 0.95) / wpp() + 18}px`;
    capLabel.textContent = `${label}  `;
    capPct.textContent = `${Math.round(f * 100)}%`;
  }
  const a = alpha.toFixed(2);
  if (a !== captionAlpha) { captionAlpha = a; caption.style.opacity = a; }
}
function setWelcome() {
  const w = welcomeLine(userName, mates);
  const b = Object.assign(document.createElement("b"), { textContent: w.hello });
  const kids: Node[] = [b];
  if (w.online) {
    const live = Object.assign(document.createElement("span"), { className: "live" });
    live.append(document.createElement("i"), w.online);
    kids.push(Object.assign(document.createElement("span"), { className: "sep", textContent: "·" }), live);
  }
  welcome.replaceChildren(...kids);
}

let lastFrame = performance.now();
let loadReleased = false;
async function releaseLoad() {
  if (!native) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("boot_release").catch(() => {});
}
let workMs = 0, workN = 0;
function tick(now: number) {
  const w0 = performance.now();
  tickInner(now);
  workMs += performance.now() - w0; workN++;
}
function tickInner(now: number) {
  lastFrame = performance.now();
  const dt = Math.min(MAX_STEP_S, Math.max(0, (now - last) / 1000));
  last = now;
  clock += dt;
  const real = (now - t0) / 1000;
  if (real > GIVE_UP_S) progress = 1; // never trap anyone behind the animation
  if (reduce) {
    // reduced motion: no animation, just open when the app is ready
    if (progress >= 1 && !revealed) { revealed = true; void call("splash_reveal").then(() => setTimeout(() => void call("splash_close"), 250)); }
    if (!revealed) requestAnimationFrame(tick);
    return;
  }
  const t = clock + offset;
  // the logo has formed: let the app start loading behind us
  if (!loadReleased && t >= (mode === "first" ? tl.inEnd : tl.fold[0])) { loadReleased = true; void releaseLoad(); }
  shownFill = nextFill(shownFill, progress, t, dt, tl);
  if (expandAt === null && shouldExpand(t, shownFill, tl)) { expandAt = t; if (mode === "back") setWelcome(); }
  const e = expandAt === null ? 0 : span(t, expandAt, expandAt + tl.expand);
  update(t, shownFill, e);
  setCaption(shownFill, span(t, tl.fold[1] - 0.1, tl.fold[1] + 0.1) * (1 - clamp(e * 4)));
  if (e >= REVEAL_AT && !revealed) { revealed = true; void call("splash_reveal"); }
  canvas.style.opacity = String(1 - span(e, 0.75, 1));
  if (mode === "back") {
    if (e >= 1 && shownAt === null) shownAt = t;
    const out = shownAt === null ? 0 : span(t, shownAt + WELCOME_HOLD_S - 0.4, shownAt + WELCOME_HOLD_S);
    welcome.style.opacity = String(span(e, 0.05, 0.35) * (1 - out));
  }
  renderer.render(scene, camera);
  const finished = e >= 1 && (mode !== "back" || (shownAt !== null && t > shownAt + WELCOME_HOLD_S));
  if (finished && !closed) { closed = true; void call("splash_close"); return; }
  requestAnimationFrame(tick);
}
// compile every shader and upload every buffer before the clock starts, so
// the first second isn't spent stuttering through first-use compiles
renderer.compile(scene, camera);
renderer.render(scene, camera);
requestAnimationFrame(() => { t0 = last = performance.now(); requestAnimationFrame(tick); });
void probeFps(`splash-${mode}`, (tl.minReady + tl.expand) * 1000, () => ({ cpuMsPerFrame: Math.round((workMs / Math.max(1, workN)) * 100) / 100 }));

// if macOS isn't drawing us (another Space, covered window), nobody can see
// the animation: open the app as soon as it's loaded instead of waiting
setInterval(() => {
  if (closed || !(progress >= 1 || (performance.now() - t0) / 1000 > GIVE_UP_S)) return;
  if (stalled(lastFrame, performance.now(), document.hidden)) {
    closed = revealed = true;
    void call("splash_reveal").then(() => call("splash_close"));
  }
}, 250);

// click anywhere to skip ahead to the box (it still waits for loading)
addEventListener("click", () => {
  if (expandAt !== null) return;
  offset = skipOffset(clock + offset, offset, tl);
});
