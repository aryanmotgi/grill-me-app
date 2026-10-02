// The forge's arrival: the same 3D block-letter wordmark as the launch
// animation (Chakra Petch, ember → gold, real lighting), on a fully
// see-through canvas. It rises in, turns once catching the light, holds,
// then shrinks to a point — where the Spark is born. Three.js loads only
// here, only for these few seconds.

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
  const geo = new TextGeometry(text, { font, size: 1, height: 0.34, depth: 0.34, curveSegments: 8, bevelEnabled: true, bevelThickness: 0.045, bevelSize: 0.028, bevelSegments: 4 } as never);
  geo.computeBoundingBox();
  const visW = 2 * 10 * Math.tan((35 / 2) * Math.PI / 180) * (W / H);
  const s = Math.min(4.6, visW * .38) / (geo.boundingBox!.max.x - geo.boundingBox!.min.x);
  geo.center();
  geo.scale(s, s, s);
  geo.computeBoundingBox();
  const { min, max } = geo.boundingBox!;
  const pos = geo.attributes.position, colors = new Float32Array(pos.count * 3);
  const hot = new THREE.Color("#ff4f1a"), ember = new THREE.Color("#e0793a"), gold = new THREE.Color("#f2c14e"), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const k = (pos.getX(i) - min.x) / (max.x - min.x);
    c.copy(hot).lerp(ember, Math.min(1, k * 1.8)).lerp(gold, Math.max(0, (k - .45) / .55));
    const back = pos.getZ(i) < 0 ? .55 : 1;
    colors.set([c.r * back, c.g * back, c.b * back], i * 3);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: .62, roughness: .24, envMapIntensity: 1.3, transparent: true, opacity: 0 });
  const mesh = new THREE.Mesh(geo, mat);
  const group = new THREE.Group();
  group.add(mesh);
  group.position.y = .55; // a little above the middle: the stage sits below it
  scene.add(group);
  renderer.compile(scene, camera);

  const eio = (x: number) => (x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  const span = (t: number, a: number, b: number) => Math.min(1, Math.max(0, (t - a) / (b - a)));
  const total = reduce ? 1.2 : 4.2;
  await new Promise<void>((done) => {
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = (now - t0) / 1000;
      const fin = span(t, total - .7, total);
      mat.opacity = reduce ? 1 - fin : span(t, 0, .7) * (1 - fin);
      if (!reduce) {
        group.position.y = .55 - .5 * (1 - eio(span(t, 0, 1)));
        group.rotation.y = -Math.PI * 1.15 * (1 - eio(span(t, 0, 2.7)));
        group.rotation.x = .12 * Math.sin(span(t, 0, 2.7) * Math.PI);
        group.scale.setScalar(1 - eio(fin) * .97);
        const a = span(t, 0, 2.7) * Math.PI * 2 + .9;
        key.position.set(Math.cos(a) * 5.5, 2.4, Math.sin(a) * 3 + 4);
      }
      renderer.render(scene, camera);
      if (t < total) requestAnimationFrame(tick);
      else done();
    };
    requestAnimationFrame(tick);
  });
  // where it ended, in screen pixels (the Spark is born there)
  const p = new THREE.Vector3(0, group.position.y, 0).project(camera);
  geo.dispose(); mat.dispose(); pmrem.dispose(); renderer.dispose();
  return { x: (p.x + 1) / 2 * W, y: (1 - p.y) / 2 * H };
}
