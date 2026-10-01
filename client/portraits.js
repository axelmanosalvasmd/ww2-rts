// Unit portraits for the HUD: each unit type's live 3D model, built by the same code the battlefield uses, rendered
// once per type and look (faction and player color) into a small image for the recruit cards and the selection list.
// Unit models keep changing, so nothing is baked into files: every portrait comes from the model code that runs.
//
// Rendering is lazy. A slot asks for its portrait with portrait(type, slot) and shows the type's silhouette icon
// (client/symbols.js) until the image is ready. Work starts a moment after the first request (the match start) and
// renders one portrait per frame on a small renderer of its own, so start-up and the frame rate are not hurt; the
// finished image replaces the icon in place. The renderer stays (idle, it costs nothing) for types asked for later.
//
// main.js hands in the model source once with setPortraitSource({ key, build, quiet }):
//   key(type, slot)   cache key for what the model looks like for that player (type, faction, color)
//   build(type, slot) -> { root, models }: a fresh model tree (sharing cached geometry and materials, so nothing here
//                     is ever disposed) and its soldiers; only the three front soldiers of a squad are framed
//   quiet(draw)       runs draw() with the fog of war lifted, so fogged structure materials render in full light
import * as THREE from 'three';
import { symbolSVG } from './symbols.js';

const W = 176, H = 132;        // image size in px (4:3); cards show about 88 x 66 CSS px, so this is sharp at 2x
const DELAY = 1200;            // ms after the first request before rendering starts (the match is still loading)
const DESATURATE = 0.2;        // how far colors move toward grey: natural, a little quieter than the battlefield
const FRONT = 3;               // soldiers framed in a squad's portrait

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
let source = null;
const ready = new Map();       // key -> object URL of the PNG
const failed = new Set();
const queue = [], queued = new Set(); // queued: waiting or rendering, until the image is ready or failed
let firstAsk = 0, pumping = false, gl = null;

export function setPortraitSource(s) { source = s; }

// HTML for a portrait slot: the image when it is ready, otherwise the silhouette icon, swapped in place later
export function portrait(type, slot) {
  const icon = symbolSVG(type);
  if (!source) return `<span class="pt">${icon}</span>`;
  const key = source.key(type, slot), url = ready.get(key);
  if (url) return `<span class="pt"><img src="${url}" alt="" draggable="false"></span>`;
  if (!failed.has(key) && !queued.has(key)) { queued.add(key); queue.push({ key, type, slot }); start(); }
  return `<span class="pt" data-pt="${esc(key)}">${icon}</span>`;
}

function start() {
  if (!firstAsk) firstAsk = performance.now();
  if (pumping) return;
  pumping = true;
  requestAnimationFrame(pump);
}

function pump(now) {
  if (!queue.length) { pumping = false; return; }
  if (now - firstAsk >= DELAY) {
    const job = queue.shift();
    try { render(job); } catch { fail(job.key); }
  }
  requestAnimationFrame(pump);
}

function fail(key) { failed.add(key); queued.delete(key); }

// ---------- the small renderer and its studio ----------
function studio() {
  if (gl) return gl;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(1); renderer.setSize(W, H, false); renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping; // the battlefield's tone curve (client/light.js)
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(22, W / H, 0.1, 400);
  // daylight like the battlefield, softer: sky and earth bounce, a warm key from the front left, a cool rim behind
  const sky = new THREE.HemisphereLight(0xd0d8e0, 0x4c4232, 0.85);
  const key = new THREE.DirectionalLight(0xffeedb, 1.9); key.castShadow = true; key.shadow.mapSize.set(512, 512); key.shadow.bias = -0.0015; key.shadow.normalBias = 0.02;
  const rim = new THREE.DirectionalLight(0xbfd0e6, 0.7);
  // the floor only catches the model's shadow; the card shows through everywhere else
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.38 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
  scene.add(sky, key, key.target, rim, rim.target, floor);
  const out = document.createElement('canvas'); out.width = W; out.height = H;
  gl = { renderer, scene, camera, key, rim, floor, out, ctx: out.getContext('2d', { willReadFrequently: true }) };
  return gl;
}

const box = new THREE.Box3(), part = new THREE.Box3(), center = new THREE.Vector3(), size = new THREE.Vector3(), v3 = new THREE.Vector3();
// the camera looks at the model's front (+x) from the right and above, so vehicles face right like the icons
const VIEW = new THREE.Vector3(0.62, 0.42, 1).normalize();

function render({ key, type, slot }) {
  const s = studio(), { root, models } = source.build(type, slot);
  // a squad shows its front soldiers up close instead of the whole formation small
  const men = models.filter((m) => m !== root);
  men.slice(FRONT).forEach((m) => (m.visible = false));
  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  s.scene.add(root);
  try { shoot(s, root); } finally { s.scene.remove(root); }
  develop(s, key); // copy out at once (same task as the draw), then quiet the colors a little
}

function shoot(s, root) {
  root.updateMatrixWorld(true);
  // bounds of what is visible (hidden soldiers and the far-away soldier models stay out)
  box.makeEmpty();
  root.traverseVisible((o) => { if (o.isMesh && o.geometry) { if (!o.geometry.boundingBox) o.geometry.computeBoundingBox(); part.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld); box.union(part); } });
  if (box.isEmpty()) throw new Error('nothing to frame');
  box.getCenter(center); box.getSize(size);
  const radius = Math.max(0.5, size.length() / 2);
  // fit: place the camera along VIEW, then pull it back until every corner of the box is inside the frame
  const cam = s.camera, tanV = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)), tanH = tanV * cam.aspect;
  cam.position.copy(center).addScaledVector(VIEW, radius * 6); cam.lookAt(center); cam.updateMatrixWorld(true);
  const inv = cam.matrixWorldInverse;
  let need = 0;
  for (let i = 0; i < 8; i++) {
    v3.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).applyMatrix4(inv);
    const depth = -v3.z - radius * 6; // corner depth relative to the center plane
    need = Math.max(need, Math.abs(v3.x) / tanH - depth, Math.abs(v3.y) / tanV - depth);
  }
  const dist = need * 1.05; // a little air around the model
  cam.position.copy(center).addScaledVector(VIEW, dist); cam.near = Math.max(0.05, dist - radius * 2); cam.far = dist + radius * 3;
  cam.lookAt(center); cam.updateProjectionMatrix();
  // lights and the shadow camera follow the model's size
  s.key.target.position.copy(center); s.key.position.copy(center).add(v3.set(-0.55, 1.1, 0.75).multiplyScalar(radius * 3));
  s.rim.target.position.copy(center); s.rim.position.copy(center).add(v3.set(0.4, 0.8, -1).multiplyScalar(radius * 3));
  const sc = s.key.shadow.camera;
  sc.left = sc.bottom = -radius * 1.4; sc.right = sc.top = radius * 1.4; sc.near = 0.1; sc.far = radius * 7; sc.updateProjectionMatrix();
  s.floor.position.set(center.x, box.min.y + 0.01, center.z); s.floor.scale.setScalar(radius * 6);
  source.quiet(() => s.renderer.render(s.scene, cam));
}

function develop(s, key) {
  const c = s.ctx;
  c.clearRect(0, 0, W, H); c.drawImage(s.renderer.domElement, 0, 0);
  const img = c.getImageData(0, 0, W, H), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    d[i] += (y - d[i]) * DESATURATE; d[i + 1] += (y - d[i + 1]) * DESATURATE; d[i + 2] += (y - d[i + 2]) * DESATURATE;
  }
  c.putImageData(img, 0, 0);
  s.out.toBlob((blob) => {
    if (!blob) { fail(key); return; }
    const url = URL.createObjectURL(blob);
    ready.set(key, url); queued.delete(key);
    for (const el of document.querySelectorAll(`.pt[data-pt="${CSS.escape(key)}"]`)) {
      el.removeAttribute('data-pt');
      el.innerHTML = `<img src="${url}" alt="" draggable="false">`;
    }
  }, 'image/png');
}
