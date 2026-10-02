// ---------------------------------------------------------------------------
// WebGL renderer for the forge. Everything that glows is drawn here, on the
// GPU, onto a pure-black canvas:
//
//   • ambient embers — their whole life is computed in the vertex shader from
//     a per-ember seed and the clock (zero CPU work per frame): they rise on
//     heat, drift on turbulence, flicker, and cool white → orange → deep red
//     as they fade. Depth: near embers are bigger and soft (out of focus),
//     far ones tiny and sharp.
//   • points — a small CPU-updated set for things that move with intent
//     (the logo, bursts, scouts, stars, orbs, stage beacons).
//   • lines — constellation links and the forged path (solid or dotted).
//   • the Spark — a shader: white-hot core, a flickering corona made of
//     noise, and a soft halo.
//   • beams — the diagrams' links: thick-quad lines with a crisp hot core, a
//     soft glow, flowing dashes, and pulses of light travelling along them.
//   • nodes — the diagrams' shapes, drawn as distance fields: an agent's
//     orbit ring with a comet of light, a faceted ember gem for a filled
//     stage, a slowly turning dashed ring for an empty one, a pulse ring.
// A touch of film grain is mixed into lit pixels only, so black stays black.
// ---------------------------------------------------------------------------

const RAMP = `
vec3 heat(float t) {
  // t = temperature: 1 white-hot → 0 cold
  vec3 c = mix(vec3(0.0), vec3(0.42, 0.04, 0.01), smoothstep(0.0, 0.18, t));
  c = mix(c, vec3(0.92, 0.26, 0.05), smoothstep(0.15, 0.45, t));
  c = mix(c, vec3(1.0, 0.56, 0.16), smoothstep(0.4, 0.72, t));
  c = mix(c, vec3(1.0, 0.86, 0.6), smoothstep(0.7, 0.92, t));
  return mix(c, vec3(1.0, 0.97, 0.92), smoothstep(0.9, 1.0, t));
}
float grain(vec2 p, float t) { return fract(sin(dot(p + t, vec2(12.9898, 78.233))) * 43758.5453); }
`;

const POINT_FRAG = `
precision highp float;
varying float vTemp; varying float vAlpha; varying float vSoft;
uniform float uTime;
${RAMP}
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  // far embers: a crisp dot; near ones: a soft, out-of-focus disc
  float sharp = 1.0 - smoothstep(0.55, 1.0, d);
  float soft = exp(-d * d * 3.2) * (1.0 - smoothstep(0.85, 1.0, d));
  float a = mix(sharp, soft, vSoft) * vAlpha;
  if (a < 0.003) discard;
  float g = 0.94 + 0.12 * grain(gl_FragCoord.xy, uTime);
  vec3 c = heat(vTemp) * a * g;
  // premultiplied: alpha follows brightness, so light floats over any app
  gl_FragColor = vec4(c, max(c.r, max(c.g, c.b)));
}`;

const AMBIENT_VERT = `
attribute vec4 aSeed; // x, depth, phase, speed — all 0..1
uniform float uTime; uniform vec2 uRes; uniform float uDpr; uniform float uDim; uniform float uCalm;
varying float vTemp; varying float vAlpha; varying float vSoft;
void main() {
  float depth = aSeed.y;
  float life = mix(6.0, 13.0, aSeed.w) * mix(1.25, 0.85, depth);
  float age = mod(uTime + aSeed.z * life, life);
  float k = age / life;
  // heat lifts them; near ones (closer to the camera) cross the frame faster
  float rise = mix(0.035, 0.11, depth) * age + 0.004 * age * age;
  float s = aSeed.x * 61.7 + aSeed.z * 13.1;
  float sway = 0.018 * sin(age * 0.9 + s) + 0.009 * sin(age * 2.3 + s * 1.7) + 0.004 * sin(age * 5.1 + s * 3.1);
  vec2 p = vec2(aSeed.x + sway + 0.006 * age, -0.04 + rise);
  // temperature falls over its life; flicker like a real coal
  float flick = 0.78 + 0.22 * sin(uTime * (9.0 + aSeed.w * 13.0) + s) * sin(uTime * 3.3 + s * 2.0);
  vTemp = clamp((1.0 - k) * (0.85 + 0.15 * aSeed.w), 0.0, 1.0) * flick;
  float fade = smoothstep(0.0, 0.06, k) * (1.0 - smoothstep(0.75, 1.0, k));
  vSoft = smoothstep(0.55, 0.95, depth);
  vAlpha = fade * mix(0.95, 0.32, vSoft) * (1.0 - uDim * 0.8) * (1.0 - uCalm);
  float size = mix(1.1, 2.4, depth) + pow(depth, 6.0) * 22.0;
  gl_PointSize = size * uDpr * (0.7 + 0.3 * vTemp);
  gl_Position = vec4(p.x * 2.0 - 1.0, p.y * 2.0 - 1.0, 0.0, 1.0);
}`;

const POINT_VERT = `
attribute vec2 aPos; attribute vec4 aParams; // size(px), temp, alpha, soft
uniform vec2 uRes; uniform float uDpr;
varying float vTemp; varying float vAlpha; varying float vSoft;
void main() {
  vTemp = aParams.y; vAlpha = aParams.z; vSoft = aParams.w;
  gl_PointSize = aParams.x * uDpr;
  gl_Position = vec4(aPos.x / uRes.x * 2.0 - 1.0, 1.0 - aPos.y / uRes.y * 2.0, 0.0, 1.0);
}`;

const LINE_VERT = `
attribute vec2 aPos; attribute vec4 aCol; attribute float aU;
uniform vec2 uRes;
varying vec4 vCol; varying float vU;
void main() { vCol = aCol; vU = aU; gl_Position = vec4(aPos.x / uRes.x * 2.0 - 1.0, 1.0 - aPos.y / uRes.y * 2.0, 0.0, 1.0); }`;
const LINE_FRAG = `
precision mediump float;
varying vec4 vCol; varying float vU;
void main() {
  // aU < 0 marks a dotted line (gaps stay dark)
  if (vU < 0.0 && fract(-vU / 7.0) > 0.35) discard;
  gl_FragColor = vec4(vCol.rgb * vCol.a, 1.0);
}`;

const QUAD_VERT = `
attribute vec2 aCorner;
uniform vec2 uCenter; uniform float uR; uniform vec2 uRes;
varying vec2 vP;
void main() {
  vP = aCorner * 8.0;
  vec2 px = uCenter + aCorner * uR * 8.0;
  gl_Position = vec4(px.x / uRes.x * 2.0 - 1.0, 1.0 - px.y / uRes.y * 2.0, 0.0, 1.0);
}`;
const SPARK_FRAG = `
precision highp float;
varying vec2 vP;
uniform float uTime; uniform float uEnergy; uniform float uGlow; uniform float uAlpha;
${RAMP}
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
void main() {
  float d = length(vP);
  float ang = atan(vP.y, vP.x);
  float t = uTime;
  // the corona churns outward like burning gas
  float n = fbm(vec2(ang * 2.2 + 0.4 * sin(t * 0.3), d * 2.6 - t * 1.4));
  float n2 = fbm(vec2(ang * 5.0 - t * 0.2, d * 5.0 - t * 2.2));
  float e = 1.0 + 0.35 * uEnergy;
  float core = exp(-d * d * 2.2 / e);
  float corona = exp(-d * 1.1 / e) * (0.3 + 0.7 * n) * 1.7;
  float tongues = pow(max(0.0, n2 - 0.38), 1.4) * exp(-d * 0.7) * 2.2;
  float halo = exp(-d * 0.38) * 0.11 * uGlow;
  vec3 col = vec3(1.0, 0.97, 0.92) * core * 1.5 + heat(0.78) * corona + heat(0.55) * tongues + heat(0.42) * halo;
  col *= 0.95 + 0.1 * grain(gl_FragCoord.xy, t);
  vec3 c = col * uAlpha * smoothstep(8.0, 5.5, d);
  gl_FragColor = vec4(c, clamp(max(c.r, max(c.g, c.b)), 0.0, 1.0));
}`;

const BEAM_VERT = `
attribute vec2 aPos; attribute float aSide; attribute float aU; attribute float aLen;
attribute vec4 aCol; attribute vec3 aFx; // dotted, pulse speed, seed
uniform vec2 uRes;
varying float vSide; varying float vU; varying float vLen; varying vec4 vCol; varying vec3 vFx;
void main() {
  vSide = aSide; vU = aU; vLen = aLen; vCol = aCol; vFx = aFx;
  gl_Position = vec4(aPos.x / uRes.x * 2.0 - 1.0, 1.0 - aPos.y / uRes.y * 2.0, 0.0, 1.0);
}`;
const BEAM_FRAG = `
precision highp float;
varying float vSide; varying float vU; varying float vLen; varying vec4 vCol; varying vec3 vFx;
uniform float uTime;
void main() {
  float s = vSide;
  float core = exp(-s * s * 38.0);
  float glow = exp(-s * s * 4.5) * 0.32;
  float a = (core + glow) * vCol.a;
  if (vFx.x > 0.5) {
    // dashes that drift along the line
    float m = fract((vU - uTime * 14.0) / 10.0);
    a *= smoothstep(0.0, 0.12, m) * (1.0 - smoothstep(0.38, 0.5, m));
  }
  float pk = 0.0;
  if (vFx.y > 0.0) {
    // pulses of light running from start to end
    for (int i = 0; i < 2; i++) {
      float p = fract(uTime * vFx.y + vFx.z + float(i) * 0.5);
      float d = vU - p * (vLen + 40.0) + 20.0;
      pk += exp(-d * d / 160.0) * smoothstep(0.0, 0.15, p) * (1.0 - smoothstep(0.85, 1.0, p));
    }
  }
  vec3 c = mix(vCol.rgb, vec3(1.0, 0.95, 0.86), clamp(pk, 0.0, 1.0) * 0.8) * (a + pk * (core * 1.4 + glow * 1.6) * max(vCol.a, 0.35));
  gl_FragColor = vec4(c, clamp(max(c.r, max(c.g, c.b)), 0.0, 1.0));
}`;

const NODE_VERT = `
attribute vec2 aPos; attribute vec2 aLocal; attribute vec4 aP; // R(px), kind, alpha, rot
attribute float aCur;
uniform vec2 uRes;
varying vec2 vL; varying vec4 vP; varying float vCur;
void main() {
  vL = aLocal; vP = aP; vCur = aCur;
  gl_Position = vec4(aPos.x / uRes.x * 2.0 - 1.0, 1.0 - aPos.y / uRes.y * 2.0, 0.0, 1.0);
}`;
const NODE_FRAG = `
precision highp float;
varying vec2 vL; varying vec4 vP; varying float vCur;
uniform float uTime;
${RAMP}
const float TAU = 6.2831853;
void main() {
  float R = vP.x, kind = vP.y, alpha = vP.z, rot = vP.w;
  vec2 l = vL * 1.8;                 // the quad spans 1.8 R each way
  float r = length(l), ang = atan(l.y, l.x);
  vec3 c = vec3(0.0);
  if (kind < 0.5) {
    // agent: a fine orbit ring with a comet of light running round it
    float d = abs(r - 1.0) * R;
    float ph = fract(ang / TAU - rot);
    float comet = pow(1.0 - ph, 5.0);
    float ring = exp(-d * d / 0.9) * (0.28 + 1.5 * comet) + exp(-d * d / 26.0) * (0.06 + 0.35 * comet);
    float d2 = abs(r - 1.32) * R;
    float dash = step(0.5, fract(ang / TAU * 36.0 + rot * 3.0));
    float outer = exp(-d2 * d2 / 0.6) * 0.16 * dash;
    float bloom = exp(-r * r * 2.2) * 0.22 * vCur;
    c = heat(0.72 + 0.26 * comet) * ring + heat(0.6) * (outer + bloom);
  } else if (kind < 1.5) {
    // a filled stage: a faceted ember gem that catches the light
    float cs = cos(rot), sn = sin(rot);
    vec2 q = vec2(cs * l.x - sn * l.y, sn * l.x + cs * l.y);
    float dd = abs(q.x) + abs(q.y) - 0.78;              // diamond, < 0 inside
    float inside = 1.0 - smoothstep(-0.02, 0.02, dd);
    vec2 n = normalize(sign(q) + 1e-4);
    float light = 0.5 + 0.5 * dot(n, normalize(vec2(-0.8, -1.0)));
    float facet = smoothstep(0.03, 0.0, min(abs(q.x), abs(q.y))) * 0.35;   // the cross-cut seams
    vec3 fill = heat(0.42 + 0.42 * light) * (0.55 + 0.45 * light);
    float core = exp(-dot(q, q) * 14.0);
    float rimD = dd * R;
    float rim = exp(-rimD * rimD / 0.7);
    float glow = exp(-max(dd, 0.0) * R / 7.0) * 0.45 + exp(-max(dd, 0.0) * R / 22.0) * 0.18;
    c = fill * inside * 0.85 + heat(1.0) * core * 0.9 * inside + heat(0.95) * (rim * 0.9 + facet * inside) + heat(0.62) * glow * (1.0 - inside);
  } else if (kind < 2.5) {
    // an empty stage: a dashed ring, turning slowly, waiting to be filled
    float d = abs(r - 0.62) * R;
    float dash = smoothstep(0.42, 0.5, fract(ang / TAU * 16.0 - rot)) * (1.0 - smoothstep(0.9, 0.98, fract(ang / TAU * 16.0 - rot)));
    float ring = exp(-d * d / 0.8) * dash;
    float dot0 = exp(-r * r * 60.0) * 0.35;
    c = vec3(0.86, 0.8, 0.74) * (ring * 0.75 + dot0);
  } else {
    // a pulse: a ring that swells and fades (rot = phase 0..1)
    float rr = 0.55 + rot * 0.95;
    float d = abs(r - rr) * R;
    c = heat(0.75) * exp(-d * d / 3.0) * (1.0 - rot) * 0.9;
  }
  c *= alpha * smoothstep(1.8, 1.55, r);
  gl_FragColor = vec4(c, clamp(max(c.r, max(c.g, c.b)), 0.0, 1.0));
}`;

function compile(gl: WebGLRenderingContext, vs: string, fs: string): WebGLProgram {
  const mk = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
    return s;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? "link");
  return p;
}

export interface GLPoint { x: number; y: number; size: number; temp: number; alpha: number; soft: number }
export interface GLLine { x1: number; y1: number; x2: number; y2: number; r: number; g: number; b: number; a: number; dotted?: boolean }

/** A glowing link. `w`: half-width of its glow (px). `pulse`: pulses per second (0 = none). */
export interface GLBeam { x1: number; y1: number; x2: number; y2: number; r: number; g: number; b: number; a: number; w?: number; dotted?: boolean; pulse?: number; seed?: number; u0?: number }
/** A diagram shape. kind: 0 agent orbit, 1 gem, 2 empty ring, 3 pulse ring. */
export interface GLNode { x: number; y: number; R: number; kind: 0 | 1 | 2 | 3; alpha: number; rot: number; cur?: number }

const BEAM_F = 12, MAX_BEAMS = 1400;
const NODE_F = 9, MAX_NODES = 128;

export class EmberGL {
  readonly gl: WebGLRenderingContext;
  private ambient: WebGLProgram;
  private points: WebGLProgram;
  private lines: WebGLProgram;
  private spark: WebGLProgram;
  private beams: WebGLProgram;
  private nodes: WebGLProgram;
  private beamBuf: WebGLBuffer;
  private nodeBuf: WebGLBuffer;
  private beamData = new Float32Array(BEAM_F * 6 * MAX_BEAMS);
  private nodeData = new Float32Array(NODE_F * 6 * MAX_NODES);
  private seedBuf: WebGLBuffer;
  private ptBuf: WebGLBuffer;
  private lineBuf: WebGLBuffer;
  private quadBuf: WebGLBuffer;
  private ptData = new Float32Array(6 * 4096);
  private lineData = new Float32Array(7 * 2 * 512);
  ambientCount: number;
  private maxAmbient: number;
  dpr = 1;

  /** `clear`: draw light only, over a fully transparent canvas (the forge
   *  floats over the user's apps); otherwise over black. */
  constructor(private canvas: HTMLCanvasElement, ambient = 700, private clear = false) {
    const gl = canvas.getContext("webgl", { alpha: clear, antialias: false, premultipliedAlpha: true, powerPreference: "high-performance", preserveDrawingBuffer: false });
    if (!gl) throw new Error("WebGL unavailable");
    this.gl = gl;
    this.ambient = compile(gl, AMBIENT_VERT, POINT_FRAG);
    this.points = compile(gl, POINT_VERT, POINT_FRAG);
    this.lines = compile(gl, LINE_VERT, LINE_FRAG);
    this.spark = compile(gl, QUAD_VERT, SPARK_FRAG);
    this.beams = compile(gl, BEAM_VERT, BEAM_FRAG);
    this.nodes = compile(gl, NODE_VERT, NODE_FRAG);
    this.maxAmbient = this.ambientCount = ambient;
    const seeds = new Float32Array(ambient * 4);
    for (let i = 0; i < ambient; i++) {
      // depth: most embers are far (small, sharp); a few drift close to the lens
      const depth = Math.pow(Math.random(), 1.8);
      seeds.set([Math.random(), depth, Math.random(), Math.random()], i * 4);
    }
    this.seedBuf = this.buffer(seeds, gl.STATIC_DRAW);
    this.ptBuf = this.buffer(this.ptData, gl.DYNAMIC_DRAW);
    this.lineBuf = this.buffer(this.lineData, gl.DYNAMIC_DRAW);
    this.quadBuf = this.buffer(new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    this.beamBuf = this.buffer(this.beamData, gl.DYNAMIC_DRAW);
    this.nodeBuf = this.buffer(this.nodeData, gl.DYNAMIC_DRAW);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE); // light adds up, black stays black
  }

  private buffer(data: Float32Array, usage: number) {
    const b = this.gl.createBuffer()!;
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, b);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, data, usage);
    return b;
  }

  resize(w: number, h: number, dpr: number) {
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  /** fewer ambient embers on slow machines */
  setAmbient(n: number) { this.ambientCount = Math.min(n, this.maxAmbient); }

  private attr(prog: WebGLProgram, name: string, size: number, stride: number, offset: number) {
    const gl = this.gl, loc = gl.getAttribLocation(prog, name);
    if (loc < 0) return;
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride * 4, offset * 4);
  }
  /** turn a program's attributes off again (programs don't share layouts) */
  private off(prog: WebGLProgram, names: string[]) {
    for (const n of names) { const l = this.gl.getAttribLocation(prog, n); if (l >= 0) this.gl.disableVertexAttribArray(l); }
  }
  private u(prog: WebGLProgram, name: string) { return this.gl.getUniformLocation(prog, name); }

  draw(o: {
    time: number; w: number; h: number; dim: number; calm: number;
    points: GLPoint[]; lines: GLLine[]; beams?: GLBeam[]; nodes?: GLNode[];
    spark: { x: number; y: number; r: number; energy: number; glow: number; alpha: number } | null;
  }) {
    const gl = this.gl;
    gl.clearColor(0, 0, 0, this.clear ? 0 : 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // ambient embers
    if (this.ambientCount) {
      gl.useProgram(this.ambient);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.seedBuf);
      this.attr(this.ambient, "aSeed", 4, 4, 0);
      gl.uniform1f(this.u(this.ambient, "uTime"), o.time);
      gl.uniform2f(this.u(this.ambient, "uRes"), o.w, o.h);
      gl.uniform1f(this.u(this.ambient, "uDpr"), this.dpr);
      gl.uniform1f(this.u(this.ambient, "uDim"), o.dim);
      gl.uniform1f(this.u(this.ambient, "uCalm"), o.calm);
      gl.drawArrays(gl.POINTS, 0, this.ambientCount);
    }

    // lines
    if (o.lines.length) {
      const n = Math.min(o.lines.length, 512);
      for (let i = 0; i < n; i++) {
        const l = o.lines[i], len = Math.hypot(l.x2 - l.x1, l.y2 - l.y1);
        const u2 = l.dotted ? -len - 0.001 : len, u1 = l.dotted ? -0.001 : 0;
        this.lineData.set([l.x1, l.y1, l.r, l.g, l.b, l.a, u1, l.x2, l.y2, l.r, l.g, l.b, l.a, u2], i * 14);
      }
      gl.useProgram(this.lines);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.lineData.subarray(0, n * 14));
      this.attr(this.lines, "aPos", 2, 7, 0);
      this.attr(this.lines, "aCol", 4, 7, 2);
      this.attr(this.lines, "aU", 1, 7, 6);
      gl.uniform2f(this.u(this.lines, "uRes"), o.w, o.h);
      gl.drawArrays(gl.LINES, 0, n * 2);
    }

    // beams: the diagrams' glowing links
    if (o.beams?.length) {
      const n = Math.min(o.beams.length, MAX_BEAMS), d = this.beamData;
      let k = 0;
      let n2 = 0;
      for (let i = 0; i < n; i++) {
        const b = o.beams[i], dx = b.x2 - b.x1, dy = b.y2 - b.y1, len = Math.hypot(dx, dy) || .001;
        // a bad coordinate would smear a quad across the whole screen: skip it
        if (!Number.isFinite(dx + dy + b.x1 + b.y1) || len > 4 * (o.w + o.h)) continue;
        n2++;
        const w = b.w ?? 5, nx = -dy / len * w, ny = dx / len * w, u0 = b.u0 ?? 0;
        // a hair past each end closes the seams between segments of a curve
        // (more would overlap, and overlapping light adds up into beads)
        const ex = dx / len * .5, ey = dy / len * .5;
        const fx = [b.dotted ? 1 : 0, b.pulse ?? 0, b.seed ?? 0];
        const v = (x: number, y: number, side: number, u: number) => { d.set([x, y, side, u, len + u0, b.r, b.g, b.b, b.a, fx[0], fx[1], fx[2]], k); k += BEAM_F; };
        const ax = b.x1 - ex, ay = b.y1 - ey, bx = b.x2 + ex, by = b.y2 + ey;
        v(ax + nx, ay + ny, 1, u0); v(ax - nx, ay - ny, -1, u0); v(bx + nx, by + ny, 1, u0 + len);
        v(bx + nx, by + ny, 1, u0 + len); v(ax - nx, ay - ny, -1, u0); v(bx - nx, by - ny, -1, u0 + len);
      }
      gl.useProgram(this.beams);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.beamBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, d.subarray(0, k));
      this.attr(this.beams, "aPos", 2, BEAM_F, 0);
      this.attr(this.beams, "aSide", 1, BEAM_F, 2);
      this.attr(this.beams, "aU", 1, BEAM_F, 3);
      this.attr(this.beams, "aLen", 1, BEAM_F, 4);
      this.attr(this.beams, "aCol", 4, BEAM_F, 5);
      this.attr(this.beams, "aFx", 3, BEAM_F, 9);
      gl.uniform2f(this.u(this.beams, "uRes"), o.w, o.h);
      gl.uniform1f(this.u(this.beams, "uTime"), o.time);
      gl.drawArrays(gl.TRIANGLES, 0, n2 * 6);
      this.off(this.beams, ["aPos", "aSide", "aU", "aLen", "aCol", "aFx"]);
    }

    // nodes: orbit rings, gems, empty rings, pulses
    if (o.nodes?.length) {
      const n = Math.min(o.nodes.length, MAX_NODES), d = this.nodeData;
      let k = 0;
      let n2 = 0;
      for (let i = 0; i < n; i++) {
        const q = o.nodes[i], h = Math.min(q.R, 90) * 1.8;
        if (!Number.isFinite(q.x + q.y + h)) continue;
        n2++;
        const v = (cx: number, cy: number) => { d.set([q.x + cx * h, q.y + cy * h, cx, cy, h / 1.8, q.kind, q.alpha, q.rot, q.cur ?? 1], k); k += NODE_F; };
        v(-1, -1); v(1, -1); v(-1, 1); v(-1, 1); v(1, -1); v(1, 1);
      }
      gl.useProgram(this.nodes);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.nodeBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, d.subarray(0, k));
      this.attr(this.nodes, "aPos", 2, NODE_F, 0);
      this.attr(this.nodes, "aLocal", 2, NODE_F, 2);
      this.attr(this.nodes, "aP", 4, NODE_F, 4);
      this.attr(this.nodes, "aCur", 1, NODE_F, 8);
      gl.uniform2f(this.u(this.nodes, "uRes"), o.w, o.h);
      gl.uniform1f(this.u(this.nodes, "uTime"), o.time);
      gl.drawArrays(gl.TRIANGLES, 0, n2 * 6);
      this.off(this.nodes, ["aPos", "aLocal", "aP", "aCur"]);
    }

    // points with intent
    if (o.points.length) {
      const n = Math.min(o.points.length, 4096);
      for (let i = 0; i < n; i++) {
        const p = o.points[i];
        const ok = Number.isFinite(p.x + p.y + p.size);
        this.ptData.set([ok ? p.x : -9999, ok ? p.y : -9999, ok ? Math.min(p.size, 256) : 0, p.temp, ok ? p.alpha : 0, p.soft], i * 6);
      }
      gl.useProgram(this.points);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.ptBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.ptData.subarray(0, n * 6));
      this.attr(this.points, "aPos", 2, 6, 0);
      this.attr(this.points, "aParams", 4, 6, 2);
      gl.uniform2f(this.u(this.points, "uRes"), o.w, o.h);
      gl.uniform1f(this.u(this.points, "uDpr"), this.dpr);
      gl.uniform1f(this.u(this.points, "uTime"), o.time);
      gl.drawArrays(gl.POINTS, 0, n);
      this.off(this.points, ["aPos", "aParams"]);
    }

    // the Spark
    if (o.spark && o.spark.alpha > 0.01) {
      const s = o.spark;
      gl.useProgram(this.spark);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
      this.attr(this.spark, "aCorner", 2, 2, 0);
      gl.uniform2f(this.u(this.spark, "uCenter"), s.x, s.y);
      gl.uniform1f(this.u(this.spark, "uR"), s.r);
      gl.uniform2f(this.u(this.spark, "uRes"), o.w, o.h);
      gl.uniform1f(this.u(this.spark, "uTime"), o.time);
      gl.uniform1f(this.u(this.spark, "uEnergy"), s.energy);
      gl.uniform1f(this.u(this.spark, "uGlow"), s.glow);
      gl.uniform1f(this.u(this.spark, "uAlpha"), s.alpha);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      this.off(this.spark, ["aCorner"]);
    }
  }
}
