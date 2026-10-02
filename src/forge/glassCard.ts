// The stage's card: an 80% glass panel (20% see-through) with a living ember rim.
// WebGL, on one small canvas around the stage, drawn under the diagrams so
// they stay bright.
//
//  - The card and its rim come from one shader: a signed distance to the
//    card's rounded rect gives a crisp white-hot hairline, a soft heat glow,
//    and flame tongues (noise) licking outward. Two bands of heat flow around
//    the rim; colour follows temperature (deep red → orange → gold → white).
//  - Embers: shed where the heat is, they rise, swirl, flicker and cool along
//    the same colour ramp, each with a short motion trail. Additive light.
//
// Reduce Motion: a still card and rim, no embers.

const MARGIN = 90;      // room around the card for the flames and embers
const PAD_X = 30, PAD_Y = 26;
const RADIUS = 24;
const MAX_EMBERS = 140;
const TRAIL = 4;        // points per ember: the head and its trail

const QUAD_VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() { vUv = vec2(aPos.x * .5 + .5, .5 - aPos.y * .5); gl_Position = vec4(aPos, 0., 1.); }`;

const CARD_FRAG = `
precision highp float;
varying vec2 vUv;
uniform vec2 uRes;    // canvas, css px
uniform vec2 uHalf;   // card half-size, css px
uniform float uR, uT, uA, uPer, uHead, uPulse;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1., 0.)), f.x), mix(hash(i + vec2(0., 1.)), hash(i + vec2(1., 1.)), f.x), f.y);
}
float fbm(vec2 p) { float v = 0., a = .5; for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + 17.1; a *= .5; } return v; }
// temperature -> colour: deep red, orange, gold, white
vec3 heat(float h) {
  vec3 c = mix(vec3(.45, .04, .01), vec3(1., .36, .06), smoothstep(0., .4, h));
  c = mix(c, vec3(1., .7, .26), smoothstep(.35, .75, h));
  return mix(c, vec3(1., .96, .88), smoothstep(.75, 1.15, h));
}
float bandAt(float u) {
  float b = 0.;
  for (int k = 0; k < 2; k++) {
    float h = fract(uHead + float(k) * .5);
    float behind = fract(h - u), ahead = fract(u - h);
    if (behind < .45) b = max(b, pow(1. - behind / .45, 2.2));
    if (ahead < .03) b = max(b, 1. - ahead / .03);
  }
  return b;
}
void main() {
  vec2 px = vUv * uRes, p = px - uRes * .5;
  vec2 q = abs(p) - (uHalf - uR);
  float d = length(max(q, 0.)) + min(max(q.x, q.y), 0.) - uR;   // > 0 outside
  float u = atan(p.y / uHalf.y, p.x / uHalf.x) / 6.2831853 + .5;
  float s = u * uPer;
  float band = bandAt(u);
  // a step change: a flare runs around the whole rim
  float energy = min(1.25, .16 + .84 * band + uPulse * (.55 + .45 * sin(u * 25.1327 - uT * 9.)));

  // glass: 65% see-through, ember-dark, a sheen at the top, warm light just inside the rim
  float cover = clamp(.5 - d, 0., 1.);
  vec2 g = px / uRes;
  vec3 glass = mix(vec3(.17, .1, .08), vec3(.045, .036, .055), clamp(g.y * .75 + g.x * .35, 0., 1.));
  glass += vec3(1., .8, .62) * .07 * (1. - smoothstep(0., uHalf.y * 1.1, p.y + uHalf.y));
  glass += heat(.45) * exp(min(d, 0.) / 9.) * (.05 + .3 * band);
  float ga = .8 * cover;
  vec3 rgb = glass * ga; float a = ga;

  // deep inside the card there's no rim to draw: skip the noise (most pixels)
  if (d < -8.) { gl_FragColor = vec4(rgb, a) * uA; return; }
  // the rim: hairline, glow, and flame tongues outside
  float o = max(d, 0.);
  float core = exp(-d * d / 1.1);
  float glow = (exp(-o / 6.) * .5 + exp(-o / 20.) * .22) * exp(min(d, 0.) / 2.5); // outside only (a thin bleed in)
  float flow = fbm(vec2(s / 34., o / 12. - uT * 1.7)) + .55 * fbm(vec2(s / 95. + 7.3, uT * .4));
  float flame = smoothstep(.55, 1.05, flow - o / 30.) * exp(-o / 24.) * step(-.5, d);
  float h = core * (.55 + .7 * energy) + (glow * .8 + flame * 1.25) * energy;
  float la = clamp(h, 0., 1.);
  rgb += heat(clamp(h * (.6 + .6 * energy), 0., 1.2)) * la;
  a = 1. - (1. - a) * (1. - la * .9);
  gl_FragColor = vec4(rgb, a) * uA;
}`;

const EMBER_VERT = `
attribute vec2 aPos;
attribute float aSize;
attribute vec4 aCol;
uniform vec2 uRes;
uniform float uDpr;
varying vec4 vCol;
void main() {
  vCol = aCol;
  gl_Position = vec4(aPos.x / uRes.x * 2. - 1., 1. - aPos.y / uRes.y * 2., 0., 1.);
  gl_PointSize = aSize * uDpr;
}`;

const EMBER_FRAG = `
precision highp float;
varying vec4 vCol;
void main() {
  float r = length(gl_PointCoord - .5) * 2.;
  float k = exp(-r * r * 9.) + exp(-r * r * 2.5) * .35;
  gl_FragColor = vec4(vCol.rgb * k * vCol.a, 0.);
}`;

interface Ember { x: number; y: number; vx: number; vy: number; age: number; life: number; size: number; seed: number; hist: number[] }

export class GlassCard {
  private gl: WebGLRenderingContext | null;
  private card!: WebGLProgram;
  private ember!: WebGLProgram;
  private quad!: WebGLBuffer;
  private ebuf!: WebGLBuffer;
  private edata = new Float32Array(MAX_EMBERS * TRAIL * 7);
  private raf = 0;
  private target: { left: number; top: number; width: number; height: number } | null = null;
  private box = { x: 0, y: 0, w: 0, h: 0 };
  private alpha = 0;
  private flare = 0;
  private held = false;
  private squeeze = 0;
  private embers: Ember[] = [];
  private t0 = performance.now();
  private last = performance.now();

  constructor(private canvas: HTMLCanvasElement, private reduce: boolean) {
    this.gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: false });
    if (!this.gl) return;
    const gl = this.gl;
    this.card = program(gl, QUAD_VERT, CARD_FRAG);
    this.ember = program(gl, EMBER_VERT, EMBER_FRAG);
    this.quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    this.ebuf = gl.createBuffer()!;
    this.raf = requestAnimationFrame(this.tick);
  }

  /** The visible part of the stage (or null when there's no stage). */
  setRect(r: { left: number; top: number; width: number; height: number } | null) {
    if (this.held && !r) return;
    this.target = r && r.width ? r : null;
  }

  /** Keep the card where it is even when the stage goes (the finale). */
  hold(on: boolean) { this.held = on; if (!on) this.target = null; }

  /** The finale: 0 → 1 folds the card into a line of light, then a point. */
  setSqueeze(k: number) { this.squeeze = k; if (k > 0 && !this.reduce) this.flare = 1; }

  /** The card's centre, in page px. */
  center() { return { x: this.box.x + this.box.w / 2, y: this.box.y + this.box.h / 2 }; }

  /** Where the card is, for click-through (the card itself, no margin). */
  rect(): [number, number, number, number] | null {
    if (this.alpha < .05) return null;
    return [this.box.x - PAD_X, this.box.y - PAD_Y, this.box.w + PAD_X * 2, this.box.h + PAD_Y * 2];
  }

  stop() { cancelAnimationFrame(this.raf); }

  /** A new step: the rim flares and throws a burst of embers. */
  pulse() { if (!this.reduce) this.flare = 1; }

  private tick = (now: number) => {
    this.raf = requestAnimationFrame(this.tick);
    const gl = this.gl!;
    const dt = Math.min(.05, (now - this.last) / 1000);
    this.last = now;
    const t = this.reduce ? 0 : (now - this.t0) / 1000;

    // follow the stage (eased, so it grows smoothly as text types out)
    const r = this.target;
    if (r) {
      const k = this.box.w === 0 || this.reduce ? 1 : 1 - Math.pow(.0005, dt);
      this.box.x += (r.left - this.box.x) * k; this.box.y += (r.top - this.box.y) * k;
      this.box.w += (r.width - this.box.w) * k; this.box.h += (r.height - this.box.h) * k;
    }
    this.alpha += ((r ? 1 : 0) - this.alpha) * (this.reduce ? 1 : Math.min(1, dt * 5));
    if (this.alpha < .003 && !r) { this.canvas.style.opacity = "0"; this.embers.length = 0; return; }
    this.canvas.style.opacity = "1";

    // size the canvas to the card plus its margin
    // soft light doesn't need full Retina resolution: 1.5x draws ~45% fewer pixels
    const dpr = Math.min(devicePixelRatio || 1, 1.5);
    let W = this.box.w + PAD_X * 2, H = this.box.h + PAD_Y * 2;
    if (this.squeeze > 0) {
      // first flatten to a bright line, then pull the line into a point
      const io = (x: number) => (x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
      const a = io(Math.min(1, this.squeeze * 1.8)), b = io(Math.max(0, (this.squeeze - .45) / .55));
      H = H + (3 - H) * a;
      W = W * (1 - .08 * a) + (2 - W * (1 - .08 * a)) * b;
    }
    const cx = this.box.x + this.box.w / 2, cy = this.box.y + this.box.h / 2;
    const cw = W + MARGIN * 2, ch = H + MARGIN * 2;
    Object.assign(this.canvas.style, { left: `${cx - cw / 2}px`, top: `${cy - ch / 2}px`, width: `${cw}px`, height: `${ch}px` });
    const pw = Math.round(cw * dpr), ph = Math.round(ch * dpr);
    if (this.canvas.width !== pw || this.canvas.height !== ph) { this.canvas.width = pw; this.canvas.height = ph; }
    gl.viewport(0, 0, pw, ph);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);

    this.flare = Math.max(0, this.flare - dt * 1.1);
    const per = perimeter(W, H);
    const head = (t * .045) % 1;

    // card + rim
    gl.useProgram(this.card);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    const aPos = gl.getAttribLocation(this.card, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    const U = (n: string) => gl.getUniformLocation(this.card, n);
    gl.uniform2f(U("uRes"), cw, ch);
    gl.uniform2f(U("uHalf"), W / 2, H / 2);
    gl.uniform1f(U("uR"), Math.min(RADIUS, W / 2, H / 2));
    gl.uniform1f(U("uT"), t);
    gl.uniform1f(U("uA"), this.alpha);
    gl.uniform1f(U("uPer"), per);
    gl.uniform1f(U("uHead"), head);
    gl.uniform1f(U("uPulse"), this.flare * this.flare);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disableVertexAttribArray(aPos);

    if (this.reduce) return;

    // embers: shed where the heat flows, most at the bright heads
    const spawn = dt * (34 + 260 * this.flare * this.flare) * this.alpha;
    for (let n = Math.floor(spawn) + (Math.random() < spawn % 1 ? 1 : 0); n > 0 && this.embers.length < MAX_EMBERS; n--) {
      const hot = Math.random() < .85 - this.flare * .8; // a flare sheds all round
      const h = Math.random() < .5 ? head : (head + .5) % 1;
      const u = hot ? (h - Math.pow(Math.random(), 2) * .2 + 1) % 1 : Math.random();
      const p = edgeAt(u, W, H);
      const out = 18 + Math.random() * 46;
      const tang = (Math.random() - .5) * 30;
      this.embers.push({
        x: MARGIN + p.x, y: MARGIN + p.y,
        vx: p.nx * out - p.ny * tang, vy: p.ny * out + p.nx * tang - 10,
        age: 0, life: (hot ? 1 : .7) * (.9 + Math.random() * 1.5), size: 2.2 + Math.random() * 3.2, seed: Math.random() * 100, hist: [],
      });
    }
    let n = 0;
    const d = this.edata;
    this.embers = this.embers.filter((e) => (e.age += dt) < e.life);
    for (const e of this.embers) {
      // rise with the heat, swirl in the air, slow down
      e.vx += Math.sin(e.y * .045 + t * 2.1 + e.seed) * 70 * dt;
      e.vy += (Math.cos(e.x * .04 - t * 1.6 + e.seed) * 55 - 38) * dt;
      const drag = 1 - 1.3 * dt;
      e.vx *= drag; e.vy *= drag;
      e.x += e.vx * dt; e.y += e.vy * dt;
      e.hist.unshift(e.x, e.y);
      if (e.hist.length > TRAIL * 8) e.hist.length = TRAIL * 8;
      const life = e.age / e.life;
      const temp = 1 - life;                                   // cools as it flies
      const fade = Math.min(1, e.age * 8) * (1 - Math.pow(life, 3));
      const flick = .75 + .25 * Math.sin(e.age * 31 + e.seed * 7);
      const [cr, cg, cb] = heatRGB(.25 + temp * .95);
      for (let k = 0; k < TRAIL; k++) {
        const i = Math.min(k * 4, e.hist.length - 2);           // two frames apart
        const tk = 1 - k / TRAIL;
        const size = e.size * (.55 + .7 * temp) * (k ? .75 * tk : 1.25);
        d.set([e.hist[i], e.hist[i + 1], size, cr, cg, cb, fade * flick * (k ? .45 * tk : 1)], n++ * 7);
      }
    }
    if (!n) return;
    gl.useProgram(this.ember);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ebuf);
    gl.bufferData(gl.ARRAY_BUFFER, d.subarray(0, n * 7), gl.DYNAMIC_DRAW);
    const attrs: [string, number, number][] = [["aPos", 2, 0], ["aSize", 1, 2], ["aCol", 4, 3]];
    for (const [name, size, off] of attrs) {
      const l = gl.getAttribLocation(this.ember, name);
      gl.enableVertexAttribArray(l);
      gl.vertexAttribPointer(l, size, gl.FLOAT, false, 28, off * 4);
    }
    gl.uniform2f(gl.getUniformLocation(this.ember, "uRes"), cw, ch);
    gl.uniform1f(gl.getUniformLocation(this.ember, "uDpr"), dpr);
    gl.drawArrays(gl.POINTS, 0, n);
    for (const [name] of attrs) gl.disableVertexAttribArray(gl.getAttribLocation(this.ember, name));
  };
}

function program(gl: WebGLRenderingContext, vs: string, fs: string) {
  const p = gl.createProgram()!;
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? "link");
  return p;
}

/** The same colour ramp as the shader's heat(). */
function heatRGB(h: number): [number, number, number] {
  const ss = (a: number, b: number, x: number) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
  const mix = (a: number[], b: number[], k: number) => a.map((v, i) => v + (b[i] - v) * k);
  let c = mix([.45, .04, .01], [1, .36, .06], ss(0, .4, h));
  c = mix(c, [1, .7, .26], ss(.35, .75, h));
  c = mix(c, [1, .96, .88], ss(.75, 1.15, h));
  return c as [number, number, number];
}

// ---- the card's edge, matched to the shader's perimeter coordinate --------------------
function perimeter(w: number, h: number) {
  const r = Math.min(RADIUS, w / 2, h / 2);
  return 2 * (w - 2 * r) + 2 * (h - 2 * r) + 2 * Math.PI * r;
}

/** Point and outward normal on the card's edge at the shader's u (an angle around the card). */
function edgeAt(u: number, w: number, h: number) {
  // the shader's u = atan(p.y / halfH, p.x / halfW): walk that ray out to the edge
  const a = (u - .5) * Math.PI * 2;
  const hw = w / 2, hh = h / 2, r = Math.min(RADIUS, hw, hh);
  const dx = Math.cos(a) * hw, dy = Math.sin(a) * hh;
  const sdf = (x: number, y: number) => {
    const qx = Math.abs(x) - (hw - r), qy = Math.abs(y) - (hh - r);
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
  };
  let lo = 0, hi = 1.5;
  for (let i = 0; i < 18; i++) { const m = (lo + hi) / 2; if (sdf(dx * m, dy * m) > 0) hi = m; else lo = m; }
  const x = dx * lo, y = dy * lo, e = .5;
  let nx = sdf(x + e, y) - sdf(x - e, y), ny = sdf(x, y + e) - sdf(x, y - e);
  const len = Math.hypot(nx, ny) || 1; nx /= len; ny /= len;
  return { x: x + hw, y: y + hh, nx, ny };
}
