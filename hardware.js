/* ArcSense hardware views: hero render + exploded hub.
   Uses real assets only. Picks the first source that exists:
     1. assets/hardware/hub.glb                     -> Three.js, meshes move apart
     2. assets/hardware/frame_000.webp ... 149      -> canvas image sequence
     3. nothing                                     -> labeled placeholder
   See assets/hardware/README.md for file names and export settings. */

const BASE = 'assets/hardware/';
// Bump when a model file changes so browsers don't show a cached old copy.
const ASSET_V = '4';
const v = (url) => `${url}?v=${ASSET_V}`;
const LAYERS = ['shell_top', 'board', 'battery', 'motor', 'base_patch'];
const LABELS = ['Top shell', 'Main board', 'Battery', 'Vibration motor', 'Base + skin patch'];
const FRAMES = 150;
const pad3 = (n) => String(n).padStart(3, '0');

const bus = (window.ArcSense = window.ArcSense || {});
const $ = (s) => document.querySelector(s);
const stage = $('#stage');
const canvas = $('#stage-canvas');
const labelsBox = $('#stage-labels');
const empty = $('#stage-empty');
const status = $('#stage-status');
const bar = $('#stage-bar');

async function exists(url) {
  try {
    const r = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    if (r.ok) return true;
    if (r.status === 405) { const g = await fetch(url, { cache: 'no-store' }); return g.ok; }
    return false;
  } catch { return false; }
}

/* Follow the scroll progress published by app.js. */
function onExplode(fn) {
  const ex = bus.explode || { p: 0, active: -1, listeners: new Set() };
  ex.listeners.add(fn);
  fn(ex.p, ex.active);
}

/* ---------------- Hero ---------------- */
(async function hero() {
  const img = $('#hero-img');
  let src = null;
  for (const f of ['hero.webp', 'hero.png', 'frame_000.webp']) {
    if (await exists(BASE + f)) { src = BASE + f; break; }
  }
  if (!src) return;
  img.onload = () => {
    if ($('#hero-slot').dataset.state === 'turntable') return; // the turntable already took over
    img.hidden = false; $('#hero-empty').hidden = true; $('#hero-slot').dataset.state = 'render';
  };
  img.src = src;
})();

/* ---------------- Hero turntable: photoreal 360° from Fusion renders ----------------
   180 frames (2° apart) rendered in Fusion at the same angle and quality as the still.
   Neighbouring frames are mixed per pixel ('lighter' adds the two weighted images,
   an exact linear blend) so the turn is continuous with no dimming between frames.
   Reduced motion: holds frame 0 (the original angle). Drag to turn it by hand. */
(async function heroFrames() {
  const N = 180, DIR = BASE + 'spin/';
  const canvas = $('#hero-canvas'), slot = $('#hero-slot'), img = $('#hero-img');
  if (!canvas || !(await exists(DIR + 'frame_000.webp'))) return;
  const ctx = canvas.getContext('2d');
  const frames = new Array(N);
  const load = (i) => new Promise((res) => {
    const im = new Image();
    im.decoding = 'async';
    im.onload = () => { frames[i] = im; res(); };
    im.onerror = () => res();
    im.src = v(`${DIR}frame_${pad3(i)}.webp`);
  });

  let w = 0, h = 0, dpr = 1;
  function resize() {
    const r = slot.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = r.width; h = r.height;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    draw();
  }
  let pos = 0; // in frames; 0 = the original hero angle
  function drawImg(im, alpha) {
    if (!im) return;
    const s = Math.min(w / im.naturalWidth, h / im.naturalHeight); // contain
    const dw = im.naturalWidth * s, dh = im.naturalHeight * s;
    ctx.globalAlpha = alpha;
    ctx.drawImage(im, (w - dw) / 2, (h - dh) / 2, dw, dh);
  }
  function draw() {
    if (!w) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const p = ((pos % N) + N) % N;
    const i = Math.floor(p), j = (i + 1) % N, t = p - i;
    if (frames[i] && frames[j]) {
      ctx.globalCompositeOperation = 'lighter';
      drawImg(frames[i], 1 - t); drawImg(frames[j], t);
      ctx.globalCompositeOperation = 'source-over';
    } else drawImg(frames[i] || frames[0], 1);
    ctx.globalAlpha = 1;
  }

  await load(0);
  new ResizeObserver(resize).observe(slot);
  resize();
  canvas.hidden = false; img.hidden = true;
  $('#hero-empty').hidden = true; slot.dataset.state = 'turntable';

  // Load the rest in the background, a few at a time, then start turning.
  for (let k = 1; k < N; k += 12) await Promise.all(Array.from({ length: Math.min(12, N - k) }, (_, m) => load(k + m)));
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const SPEED = N / 30; // frames per second: one full turn every 30 s
  let last = performance.now(), visible = true, drag = null, resumeAt = 0;
  new IntersectionObserver((es) => { visible = es.some((e) => e.isIntersecting); }).observe(slot);
  canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, p: pos }; canvas.setPointerCapture(e.pointerId); canvas.classList.add('dragging'); });
  canvas.addEventListener('pointermove', (e) => { if (drag) { pos = drag.p - (e.clientX - drag.x) * 0.25; draw(); } });
  const endDrag = () => { if (!drag) return; drag = null; canvas.classList.remove('dragging'); resumeAt = performance.now() + 1500; };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  (function tick(now) {
    requestAnimationFrame(tick);
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (!visible || drag || reduce.matches || now < resumeAt) return;
    pos += SPEED * dt;
    draw();
  })(performance.now());
})().catch((err) => console.error('Hero turntable unavailable, keeping the still image', err));

/* ---------------- Placeholder: show scroll progress on the stage ---------------- */
onExplode((p) => { if (bar) bar.style.transform = `scaleX(${p.toFixed(3)})`; });

/* ---------------- Exploded view, loaded lazily near the section ---------------- */
let started = false;
const io = new IntersectionObserver((entries) => {
  if (started || !entries.some((e) => e.isIntersecting)) return;
  started = true; io.disconnect(); boot();
}, { rootMargin: '900px 0px' });
io.observe(stage);

async function boot() {
  // hub.glb.b64.txt is a base64 text copy of hub.glb, for hosts that won't serve .glb files.
  if (await exists(BASE + 'hub.glb')) return glbMode('glb').catch((err) => fail('Could not load hub.glb', err));
  if (await exists(BASE + 'hub.glb.b64.txt')) return glbMode('b64').catch((err) => fail('Could not load hub.glb.b64.txt', err));
  if (await exists(BASE + 'frame_000.webp')) return sequenceMode().catch((err) => fail('Could not load the image sequence', err));
  status.textContent = '';
}

function fail(msg, err) {
  console.error(msg, err);
  stage.dataset.source = 'none';
  canvas.hidden = true; empty.hidden = false;
  status.textContent = `${msg}. Showing the placeholder.`;
}

function makeLabels() {
  labelsBox.innerHTML = '';
  return LABELS.map((t) => {
    const d = document.createElement('div');
    d.className = 'stage-label'; d.textContent = t;
    labelsBox.appendChild(d);
    return d;
  });
}

/* ================= 1. GLB with Three.js ================= */
async function glbMode(kind = 'glb') {
  status.textContent = 'Loading 3D model…';
  const THREE = await import('three');
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const { RoomEnvironment } = await import('three/addons/environments/RoomEnvironment.js');

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.85;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  // Studio lighting: RoomEnvironment is a soft-box studio baked into an env map.
  // To use your own HDRI instead, see README.md.
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;

  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.radius = 6;
  scene.add(key);

  let gltf;
  if (kind === 'glb') {
    gltf = await new GLTFLoader().loadAsync(v(BASE + 'hub.glb'), (e) => {
      if (e.total) status.textContent = `Loading 3D model… ${Math.round((e.loaded / e.total) * 100)}%`;
    });
  } else {
    const b64 = (await (await fetch(v(BASE + 'hub.glb.b64.txt'))).text()).trim();
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    gltf = await new GLTFLoader().parseAsync(bytes.buffer, '');
  }
  const model = gltf.scene;
  scene.add(model);

  const parts = LAYERS.map((n) => model.getObjectByName(n));
  const missing = LAYERS.filter((n, i) => !parts[i]);
  const extra = model.getObjectByName('pod_upper');
  if (extra) extra.visible = false; // the hero image covers the two-pod view

  model.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

  // Size everything from the closed assembly.
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  model.position.sub(center);                   // center the hub at the origin
  // Layers stack upward from the base: base_patch stays, motor +1, battery +2, board +3, shell_top +4.
  const spacing = Math.max(size.y, size.x * 0.12) * 1.15;
  const LIFT = [4, 3, 2, 1, 0]; // per LAYERS order
  const base = parts.map((p) => (p ? p.position.clone() : null));

  // Soft contact shadow under the lowest exploded layer.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(size.x * 8, size.z * 8), new THREE.ShadowMaterial({ opacity: 0.32 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -size.y / 2 - 0.5;
  ground.receiveShadow = true;
  scene.add(ground);
  key.position.set(size.x * 1.2, spacing * 8, size.z * 2);
  key.target.position.set(0, ground.position.y, 0);
  scene.add(key.target);
  const sc = key.shadow.camera; const ext = Math.max(size.x, size.z) * 2.5;
  Object.assign(sc, { left: -ext, right: ext, top: ext, bottom: -ext, near: 0.1, far: spacing * 30 });
  sc.updateProjectionMatrix();

  const camera = new THREE.PerspectiveCamera(30, 1, size.x * 0.01, size.x * 100);
  const halfFov = Math.sin((camera.fov * Math.PI) / 360);
  const distClosed = (Math.hypot(size.x, size.y, size.z) / 2) / halfFov * 0.95;
  const distOpen = (Math.hypot(size.x, size.y + spacing * 4, size.z) / 2) / halfFov * 0.9;
  const pivot = new THREE.Group(); scene.add(pivot); pivot.add(model);

  const labels = makeLabels();
  const tmp = new THREE.Vector3();
  let p = 0, active = -1, dirty = true;

  function resize() {
    const r = stage.getBoundingClientRect();
    renderer.setSize(r.width, r.height, false);
    camera.aspect = r.width / r.height;
    camera.updateProjectionMatrix();
    dirty = true;
  }

  // Camera eases out and rises with the stack so the hub fills the frame closed and open.
  function placeCamera(e) {
    let dist = distClosed + (distOpen - distClosed) * e;
    if (camera.aspect < 1) dist /= camera.aspect;
    const cy = spacing * 2 * e;
    camera.position.set(dist * 0.55, cy + dist * 0.5, dist * 0.68);
    camera.lookAt(0, cy, 0);
  }

  function frame() {
    requestAnimationFrame(frame);
    if (!dirty) return;
    dirty = false;
    const e = easeInOut(p);
    parts.forEach((part, i) => { if (part) part.position.y = base[i].y + LIFT[i] * spacing * e; });
    placeCamera(e);
    pivot.rotation.y = -0.35 + e * 0.5;
    renderer.render(scene, camera);
    // Labels sit in one column to the right of the model, each at its part's height,
    // nudged apart so they never overlap.
    const r = stage.getBoundingClientRect();
    // On narrow stages (phones) there's no room beside the model; the layer list names the active part instead.
    if (r.width < 520) { labels.forEach((l) => l.classList.remove('on')); return; }
    let colX = 0;
    const spots = parts.map((part, i) => {
      if (!part) return null;
      const box = new THREE.Box3().setFromObject(part);
      box.getCenter(tmp);
      const right = tmp.clone(); right.x = box.max.x; right.project(camera);
      tmp.project(camera);
      colX = Math.max(colX, (right.x * 0.5 + 0.5) * r.width);
      return { i, y: (-tmp.y * 0.5 + 0.5) * r.height };
    }).filter(Boolean).sort((a, b) => a.y - b.y);
    for (let k = 1; k < spots.length; k++) spots[k].y = Math.max(spots[k].y, spots[k - 1].y + 22);
    const maxW = Math.max(...labels.map((l) => l.offsetWidth || 150));
    const x = Math.min(colX + 16, r.width - maxW - 8);
    labels.forEach((l) => l.classList.remove('on'));
    spots.forEach(({ i, y }) => {
      const l = labels[i];
      l.style.transform = `translate(${x.toFixed(0)}px, ${(y - 8).toFixed(0)}px)`;
      l.classList.toggle('on', e > 0.18);
      l.classList.toggle('active', i === active);
    });
  }

  onExplode((np, na) => { p = np; active = na; dirty = true; });
  new ResizeObserver(resize).observe(stage);
  resize();
  empty.hidden = true; canvas.hidden = false;
  stage.dataset.source = 'glb';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', '3D model of the ArcSense hub separating into its five layers: top shell, main board, battery, vibration motor, and base with skin patch');
  status.textContent = missing.length ? `Model loaded. Missing mesh names: ${missing.join(', ')}` : '';
  frame();
}

const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

/* ================= 2. Image sequence on canvas ================= */
async function sequenceMode() {
  const small = window.innerWidth < 700 && (await exists(BASE + 'mobile/frame_000.webp'));
  const dir = small ? BASE + 'mobile/' : BASE;
  const count = await countFrames(dir);
  const ctx = canvas.getContext('2d');
  const imgs = new Array(count);
  let loaded = 0, target = 0;

  const load = (i) => new Promise((res) => {
    if (imgs[i]) return res();
    const im = new Image();
    im.decoding = 'async';
    im.onload = () => { imgs[i] = im; loaded++; status.textContent = loaded < count ? `Loading frames… ${Math.round((loaded / count) * 100)}%` : ''; res(); };
    im.onerror = () => res();
    im.src = `${dir}frame_${pad3(i)}.webp`;
  });

  // Progressive preload: first frame, then every 10th, then every frame.
  await load(0);
  empty.hidden = true; canvas.hidden = false; stage.dataset.source = 'sequence';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Rendered sequence of the ArcSense hub separating into its five layers');
  const order = [];
  for (let i = 10; i < count; i += 10) order.push(i);
  for (let i = 1; i < count; i++) if (i % 10) order.push(i);
  (async () => { for (let k = 0; k < order.length; k += 6) { await Promise.all(order.slice(k, k + 6).map(load)); draw(); } })();

  // Optional label positions at the fully exploded frame: labels.json
  // { "shell_top": [x, y], ... } with x, y from 0 to 1 across the frame.
  let spots = null;
  try { const r = await fetch(BASE + 'labels.json'); if (r.ok) spots = await r.json(); } catch {}
  const labels = makeLabels();

  let w = 0, h = 0;
  function resize() {
    const r = stage.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = r.width; h = r.height;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }
  let fit = { x: 0, y: 0, s: 1 };
  function draw() {
    // nearest loaded frame at or before the target
    let i = target;
    while (i > 0 && !imgs[i]) i--;
    const im = imgs[i];
    if (!im || !w) return;
    const s = Math.max(w / im.naturalWidth, h / im.naturalHeight); // cover
    fit = { s, x: (w - im.naturalWidth * s) / 2, y: (h - im.naturalHeight * s) / 2, iw: im.naturalWidth, ih: im.naturalHeight };
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(im, fit.x, fit.y, im.naturalWidth * fit.s, im.naturalHeight * fit.s);
  }
  onExplode((p, active) => {
    target = Math.min(count - 1, Math.round(p * (count - 1)));
    draw();
    labels.forEach((l, i) => {
      const spot = spots && spots[LAYERS[i]];
      if (!spot || !fit.iw) { l.classList.remove('on'); return; }
      const x = fit.x + spot[0] * fit.iw * fit.s, y = fit.y + spot[1] * fit.ih * fit.s;
      l.style.transform = `translate(${x.toFixed(0)}px, ${(y - 8).toFixed(0)}px)`;
      l.classList.toggle('on', p > 0.9);
      l.classList.toggle('active', i === active);
    });
  });
  new ResizeObserver(resize).observe(stage);
  resize();
}

async function countFrames(dir) {
  if (await exists(`${dir}frame_${pad3(FRAMES - 1)}.webp`)) return FRAMES;
  let lo = 0, hi = FRAMES - 1; // frame lo exists, frame hi does not
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (await exists(`${dir}frame_${pad3(mid)}.webp`)) lo = mid; else hi = mid;
  }
  return lo + 1;
}
