// The forge's arrival: the same 3D block-letter wordmark as the launch
// animation (Chakra Petch, ember → gold, real lighting), on a fully
// see-through canvas. The letters arrive one by one out of the depth, each
// glowing hot as it lands, a light sweeps across the word, then the letters
// pull into one point — where the Spark is born. It always faces you (tilts
// stay small), so it never reads backwards. Three.js loads only here, only
// for these few seconds.

import fontJson from "../splash/chakra-bold.typeface.json";

export async function playLogo3D(canvas: HTMLCanvasElement, text: string, reduce: boolean): Promise<{ x: number; y: number }> {
  const THREE = await import("three");
  const { FontLoader } = await import("three/examples/jsm/loaders/FontLoader.js");
  const { TextGeometry } = await import("three/examples/jsm/geometries/TextGeometry.js");
  const { RoomEnvironment } = await import("three/examples/jsm/environments/RoomEnvironment.js");

  const W = innerWidth, H = innerHeight;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, premultipliedAlpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(W, H, false);
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
  const camera = new THREE.PerspectiveCamera(35, W / H, 0.1, 100);
  camera.position.set(0, 0, 10);
  const key = new THREE.PointLight(0xffc89a, 90, 0, 2);
  const rim = new THREE.DirectionalLight(0x86b4ff, 1.4);
  rim.position.set(-5, 2, -4);
  scene.add(key, rim, new THREE.AmbientLight(0xffffff, 0.15));

  const font = new FontLoader().parse(fontJson as never);
  const data = fontJson as unknown as { resolution: number; glyphs: Record<string, { ha: number }> };
  const opts = { font, size: 1, height: 0.34, depth: 0.34, curveSegments: 8, bevelEnabled: true, bevelThickness: 0.045, bevelSize: 0.028, bevelSegments: 4 } as never;

  // lay the letters out by their advances, then fit the word to the screen
  const chars = [...text];
  const adv = chars.map((ch) => (data.glyphs[ch]?.ha ?? 600) / data.resolution);
  const total = adv.reduce((a, b) => a + b, 0);
  const visW = 2 * 10 * Math.tan((35 / 2) * Math.PI / 180) * (W / H);
  const s = Math.min(4.6, visW * .38) / total;
  const hot = new THREE.Color("#ff4f1a"), ember = new THREE.Color("#e0793a"), gold = new THREE.Color("#f2c14e"), c = new THREE.Color();
  const group = new THREE.Group();
  group.position.y = .55; // a little above the middle: the stage sits below it
  scene.add(group);
  const letters: { mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial; home: THREE.Vector3 }[] = [];
  let x = -total / 2;
  chars.forEach((ch, i) => {
    const geo = new TextGeometry(ch, opts);
    geo.computeBoundingBox();
    const bb = geo.boundingBox!;
    // centre each letter on itself (so it tilts about its own middle)
    const cx = (bb.min.x + bb.max.x) / 2, cy = .36, cz = (bb.min.z + bb.max.z) / 2;
    geo.translate(-cx, -cy, -cz);
    geo.scale(s, s, s);
    const pos = geo.attributes.position, colors = new Float32Array(pos.count * 3);
    for (let j = 0; j < pos.count; j++) {
      // the ember → gold gradient runs across the whole word
      const k = (x + cx + pos.getX(j) / s + total / 2) / total;
      c.copy(hot).lerp(ember, Math.min(1, k * 1.8)).lerp(gold, Math.max(0, (k - .45) / .55));
      const back = pos.getZ(j) < 0 ? .55 : 1;
      colors.set([c.r * back, c.g * back, c.b * back], j * 3);
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: .62, roughness: .24, envMapIntensity: 1.3, transparent: true, opacity: 0, emissive: new THREE.Color("#ff6a1f"), emissiveIntensity: 0 });
    const mesh = new THREE.Mesh(geo, mat);
    const home = new THREE.Vector3((x + cx) * s, (cy - .36) * s, 0);
    mesh.position.copy(home);
    group.add(mesh);
    letters.push({ mesh, mat, home });
    x += adv[i];
  });
  renderer.compile(scene, camera);

  const eout = (x: number) => 1 - Math.pow(1 - x, 3);
  const eback = (x: number) => { const k = 1.6; return 1 + (k + 1) * Math.pow(x - 1, 3) + k * Math.pow(x - 1, 2); };
  const ein = (x: number) => x * x * x;
  const span = (t: number, a: number, b: number) => Math.min(1, Math.max(0, (t - a) / (b - a)));
  const n = letters.length;
  const dur = reduce ? 1.2 : 3.9;
  const OUT = dur - .9; // the pull into a point starts here
  await new Promise<void>((done) => {
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = (now - t0) / 1000;
      letters.forEach(({ mesh, mat, home }, i) => {
        if (reduce) {
          mat.opacity = 1 - span(t, dur - .5, dur);
          return;
        }
        // in: out of the depth, tilted back a little, landing with a small overshoot
        const a = span(t, .1 + i * .085, .1 + i * .085 + .85);
        const land = eback(a);
        // heat: each letter flashes as it lands, then cools
        const heat = Math.max(0, 1 - Math.abs(a - .8) / .35) * (a < 1 ? 1 : 1 - span(t, .1 + i * .085 + .85, .1 + i * .085 + 1.4));
        // out: outside letters first, all pulling into the middle
        const order = Math.abs(i - (n - 1) / 2) / ((n - 1) / 2 || 1);
        const o = ein(span(t, OUT + (1 - order) * .18, OUT + (1 - order) * .18 + .62));
        mesh.position.set(home.x * (1 - o), home.y * (1 - o) - .7 * (1 - land), -5 * (1 - land));
        mesh.rotation.x = -1.0 * (1 - land);
        mesh.rotation.y = .25 * (1 - land) * (i % 2 ? 1 : -1);
        mesh.scale.setScalar(Math.max(.02, 1 - o * .98));
        mat.opacity = eout(span(a, 0, .5)) * (1 - span(o, .75, 1));
        mat.emissiveIntensity = heat * 1.4 + o * 1.2;
      });
      if (!reduce) {
        // a gentle turn toward you as the word settles (never past ~10°)
        group.rotation.y = .18 * Math.sin(span(t, 0, OUT) * Math.PI) * -1;
        group.rotation.x = .06 * Math.sin(span(t, 0, OUT) * Math.PI);
        // the light sweeps across the word once, left to right
        const sw = eout(span(t, .9, 2.6));
        key.position.set(-6 + 12 * sw, 2.2, 4.5);
      }
      renderer.render(scene, camera);
      if (t < dur) requestAnimationFrame(tick);
      else done();
    };
    requestAnimationFrame(tick);
  });
  // where it ended, in screen pixels (the Spark is born there)
  const p = new THREE.Vector3(0, group.position.y, 0).project(camera);
  letters.forEach(({ mesh, mat }) => { mesh.geometry.dispose(); mat.dispose(); });
  pmrem.dispose(); renderer.dispose();
  return { x: (p.x + 1) / 2 * W, y: (1 - p.y) / 2 * H };
}
