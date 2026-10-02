// World light: tone mapping, a sun whose shadow box follows the view, sky fill and distance haze. The numbers come from
// the mood table in client/moods.js; setMood() applies one row. main.js calls setupLight() once and renderFrame() in
// place of renderer.render().
import * as THREE from 'three';
import { gfx, watchFps } from './gfx.js';
import { MOODS, DEFAULT_MOOD, TONE } from './moods.js';

// The sun sits up and to the right of each player's opening view, so shadows fall toward the lower left of the screen
// (as in the concept) whichever spawn you get. It stays put in the world when you rotate.
const SUN_SIDE = 60 * Math.PI / 180;
const SUN_DIR = new THREE.Vector3(); // from the ground toward the sun
// The mood sets these: sun height in degrees (read when a match starts) and how much closer the haze sits (1 = the
// default distances).
export const sky = { sunUp: MOODS[DEFAULT_MOOD].sunUp, haze: 1 };
const EDIT = new URLSearchParams(location.search).has('edit');

let renderer, scene, camera, sun, hemi, mood = MOODS[DEFAULT_MOOD], gfxBtn = null, lastT = performance.now();
const v3 = new THREE.Vector3();
const view = { mesh: null, key: '' }; // the ground mesh the sun was last aimed for

// ---------- setup ----------

export function setupLight(r, s, c) {
  renderer = r; scene = s; camera = c;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE[`${TONE}ToneMapping`];
  renderer.shadowMap.enabled = true;
  renderer.info.autoReset = false; // renderFrame resets once, so renderer.info covers every pass of a frame

  scene.background = new THREE.Color();
  scene.fog = new THREE.Fog(0xffffff, 50, 300);
  hemi = new THREE.HemisphereLight();
  sun = new THREE.DirectionalLight();
  sun.castShadow = true;
  sun.shadow.bias = -0.0003;
  scene.add(hemi, sun, sun.target);

  const menu = document.getElementById('menu');
  if (menu) {
    gfxBtn = document.createElement('button');
    gfxBtn.id = 'gfxBtn';
    gfxBtn.title = 'Low uses cheaper shadows, fewer particles and no cloud shadows or birds';
    gfxBtn.onclick = () => gfx.set(gfx.low ? 'high' : 'low');
    menu.insertBefore(gfxBtn, document.getElementById('leaveBtn'));
  }
  setMood(MOODS[DEFAULT_MOOD]);
  gfx.onChange(applyGfx);
  return { sun, hemi };
}

// Apply one row of the mood table: sun, sky fill, haze color, exposure and shadow softness.
export function setMood(M) {
  mood = M;
  sky.sunUp = M.sunUp; sky.haze = M.hazeK;
  sun.color.setHex(M.sun); sun.intensity = M.sunI; sun.shadow.intensity = M.shadow;
  hemi.color.setHex(M.top); hemi.groundColor.setHex(M.bottom); hemi.intensity = M.hemiI;
  scene.background.setHex(M.haze); scene.fog.color.setHex(M.haze);
  renderer.toneMappingExposure = M.exposure;
  applyGfx();
}

function applyGfx() {
  const low = gfx.low;
  const type = low ? THREE.BasicShadowMap : THREE.PCFShadowMap, text = `Graphics: ${low ? 'Low' : 'High'}`;
  if (renderer.shadowMap.type !== type) renderer.shadowMap.type = type; // three rebuilds the map on a type change
  sun.shadow.mapSize.set(low ? 1024 : 2048, low ? 1024 : 2048);
  sun.shadow.radius = low ? 1 : 2.5 * mood.soft;
  if (gfxBtn && gfxBtn.textContent !== text) gfxBtn.textContent = text; // setMood runs while the weather eases
}

function notice(msg) {
  const el = document.getElementById('status');
  if (!el) return;
  el.textContent = msg;
  setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 6000);
}

// ---------- per frame ----------

// cam is main.js's camera rig ({ x, z, y, dist }); ground is the terrain mesh (or null before a match).
export function renderFrame(cam, ground) {
  const now = performance.now(), dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
  renderer.info.reset();
  if (ground) {
    watchFps(dt, notice);
    // a new match (new ground mesh) re-aims the sun for this player's view; the editor keeps one sun per map size
    if (ground !== view.mesh) {
      const prm = ground.geometry.parameters, box = ground.geometry.boundingBox;
      const key = prm ? `${prm.width}x${prm.height}` : `${box?.max.x}x${box?.max.z}`;
      if (!EDIT || key !== view.key) aimSun(cam?.yaw ?? 0);
      view.mesh = ground; view.key = key;
    }
  }
  followView(cam);
  renderer.render(scene, camera);
}

// Haze scales with zoom, and the sun's shadow box covers just what the camera sees, so shadows stay crisp.
const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]], foot = corners.map(() => new THREE.Vector3());
const center = new THREE.Vector3(), lx = new THREE.Vector3(), ly = new THREE.Vector3();
function aimSun(yaw) {
  const az = yaw + Math.PI - SUN_SIDE; // the camera looks along -(sin yaw, cos yaw); turn right of that by SUN_SIDE
  const up = sky.sunUp * Math.PI / 180;
  SUN_DIR.set(Math.sin(az) * Math.cos(up), Math.sin(up), Math.cos(az) * Math.cos(up));
  lx.crossVectors(new THREE.Vector3(0, 1, 0), SUN_DIR).normalize(); ly.crossVectors(SUN_DIR, lx); // shadow camera axes
}
aimSun(0);
function followView(cam) {
  const dist = cam?.dist ?? 85, gy = cam?.y ?? 0;
  scene.fog.near = dist * 0.6 / sky.haze; scene.fog.far = dist * 3.8 / sky.haze;

  camera.updateMatrixWorld();
  center.set(0, 0, 0);
  corners.forEach(([sx, sy], i) => {
    const dir = v3.set(sx, sy, 0.5).unproject(camera).sub(camera.position).normalize();
    const t = dir.y < -0.02 ? Math.min(600, (gy - camera.position.y) / dir.y) : 600;
    foot[i].copy(camera.position).addScaledVector(dir, t);
    center.add(foot[i]);
  });
  center.multiplyScalar(0.25);
  let rad = 0;
  for (const p of foot) rad = Math.max(rad, p.distanceTo(center));
  rad = Math.ceil((rad + 10) / 8) * 8; // steps of 8 m, so panning doesn't resize the shadow map

  // snap the box center to whole shadow texels in light space: shadow edges don't crawl while panning
  const texel = (2 * rad) / sun.shadow.mapSize.x;
  const a = Math.round(center.dot(lx) / texel) * texel, b = Math.round(center.dot(ly) / texel) * texel, c = center.dot(SUN_DIR);
  sun.target.position.copy(lx).multiplyScalar(a).addScaledVector(ly, b).addScaledVector(SUN_DIR, c);
  sun.position.copy(sun.target.position).addScaledVector(SUN_DIR, rad + 120);
  sun.target.updateMatrixWorld();
  const sc = sun.shadow.camera;
  if (sc.right !== rad) {
    Object.assign(sc, { left: -rad, right: rad, top: rad, bottom: -rad, near: 1, far: 2 * rad + 240 });
    sc.updateProjectionMatrix();
  }
  sun.shadow.normalBias = texel * 0.8;
}
