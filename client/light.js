// World light: tone mapping, a sun whose shadow box follows the view, sky fill and distance haze. The numbers come from
// the mood table in client/moods.js; setMood() applies one row. main.js calls setupLight() once and renderFrame() in
// place of renderer.render().
import * as THREE from 'three';
import { gfx, watchFps } from './gfx.js';
import { MOODS, DEFAULT_MOOD, TONE } from './moods.js';
import { t as tr } from './i18n.js';

// The sun sits up and to the right of each player's opening view, so shadows fall toward the lower left of the screen
// (as in the concept) whichever spawn you get. It stays put in the world when you rotate.
const SUN_SIDE = 60 * Math.PI / 180;
const SUN_DIR = new THREE.Vector3(); // from the ground toward the sun
// The mood sets these: sun height in degrees (read when a match starts) and how much closer the haze sits (1 = the
// default distances).
export const sky = { sunUp: MOODS[DEFAULT_MOOD].sunUp, haze: 1 };
const EDIT = new URLSearchParams(location.search).has('edit');

let renderer, scene, camera, sun, hemi, environmentFor, mood = MOODS[DEFAULT_MOOD], gfxBtn = null, goreBtn = null, lastT = performance.now();
const v3 = new THREE.Vector3();
const view = { mesh: null, key: '' }; // the ground mesh the sun was last aimed for
const environments = new WeakMap(); // renderer -> one filtered reflection target, retained across quality changes

// A small outdoor radiance map gives bare metal and painted surfaces different reflections. It is filtered once,
// never captures the battlefield, and needs no frame pass or downloaded HDR image. Colors are linear radiance.
export function outdoorEnvironment(r) {
  if (environments.has(r)) return environments.get(r).texture;
  const W = 256, H = 128, data = new Uint16Array(W * H * 4), toHalf = THREE.DataUtils.toHalfFloat;
  const light = new THREE.Vector3(0.55, 0.72, -0.42).normalize();
  for (let y = 0; y < H; y++) {
    const latitude = ((y + 0.5) / H - 0.5) * Math.PI, up = Math.sin(latitude), ring = Math.cos(latitude);
    const skyMix = THREE.MathUtils.smoothstep(up, -0.08, 0.12), high = Math.max(up, 0), horizon = Math.exp(-Math.abs(up) * 6);
    for (let x = 0; x < W; x++) {
      const longitude = ((x + 0.5) / W - 0.5) * Math.PI * 2;
      const dx = Math.cos(longitude) * ring, dz = Math.sin(longitude) * ring;
      const brightSky = Math.pow(Math.max(0, dx * light.x + up * light.y + dz * light.z), 24) * 0.75;
      const rgb = [
        0.11 * (1 - skyMix) + (0.26 + high * 0.28 + horizon * 0.16 + brightSky) * skyMix,
        0.092 * (1 - skyMix) + (0.34 + high * 0.29 + horizon * 0.15 + brightSky * 0.93) * skyMix,
        0.064 * (1 - skyMix) + (0.48 + high * 0.3 + horizon * 0.08 + brightSky * 0.78) * skyMix,
      ];
      const i = (y * W + x) * 4;
      data[i] = toHalf(rgb[0]); data[i + 1] = toHalf(rgb[1]); data[i + 2] = toHalf(rgb[2]); data[i + 3] = toHalf(1);
    }
  }
  const source = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.HalfFloatType);
  source.mapping = THREE.EquirectangularReflectionMapping;
  source.colorSpace = THREE.LinearSRGBColorSpace;
  source.needsUpdate = true;
  const generator = new THREE.PMREMGenerator(r), target = generator.fromEquirectangular(source);
  source.dispose(); generator.dispose();
  environments.set(r, target);
  return target.texture;
}

// ---------- setup ----------

export function setupLight(r, s, c, makeEnvironment = outdoorEnvironment) {
  renderer = r; scene = s; camera = c; environmentFor = makeEnvironment;
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
    goreBtn = document.createElement('button');
    goreBtn.id = 'goreBtn';
    goreBtn.title = 'Blood and torn bodies when men die in a blast';
    goreBtn.onclick = () => gfx.setGore(!gfx.gore);
    menu.insertBefore(goreBtn, document.getElementById('leaveBtn'));
  }
  setMood(MOODS[DEFAULT_MOOD]);
  gfx.onChange(applyGfx);
  gfx.onGoreChange(applyGore);
  return { sun, hemi };
}

// Apply one row of the mood table: sun, sky fill, haze color, exposure and shadow softness.
export function setMood(M) {
  mood = M;
  sky.sunUp = M.sunUp; sky.haze = M.hazeK;
  sun.color.setHex(M.sun); sun.intensity = M.sunI; sun.shadow.intensity = M.shadow;
  hemi.color.setHex(M.top); hemi.groundColor.setHex(M.bottom); hemi.intensity = M.hemiI;
  scene.background.setHex(M.haze); scene.fog.color.setHex(M.haze);
  scene.environmentIntensity = 0.38 * (0.7 + 0.3 * Math.min(M.sunI / 3.2, 1));
  renderer.toneMappingExposure = M.exposure;
  applyGfx();
}

function applyGfx() {
  const low = gfx.low;
  scene.environment = low ? null : environmentFor(renderer);
  const type = low ? THREE.BasicShadowMap : THREE.PCFShadowMap, text = tr(`Graphics: ${low ? 'Low' : 'High'}`);
  if (renderer.shadowMap.type !== type) renderer.shadowMap.type = type; // three rebuilds the map on a type change
  sun.shadow.mapSize.set(low ? 1024 : 2048, low ? 1024 : 2048);
  sun.shadow.radius = low ? 1 : 2.5 * mood.soft;
  if (gfxBtn && gfxBtn.textContent !== text) gfxBtn.textContent = text; // setMood runs while the weather eases
  applyGore();
}

function applyGore() { if (goreBtn) goreBtn.textContent = `Gore: ${gfx.gore ? 'On' : 'Off'}`; }

function notice(msg) {
  const el = document.getElementById('status');
  if (!el) return;
  el.textContent = msg = tr(msg);
  setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 6000);
}

// ---------- per frame ----------

const SHADOW_MS = 25;
let shadowAt = -Infinity;

// cam is main.js's camera rig ({ x, z, y, dist }); ground is the terrain mesh (or null before a match).
// A fully opaque paper map supplies its own render object and needs no battlefield or shadow pass.
export function renderFrame(cam, ground, renderObject = null) {
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
  if (!renderObject) followView(cam);
  // three redraws the shadow map in every render() of the scene, so High drew it twice a frame (the AO pass renders
  // the scene again for its normals). Draw it once, and at most every SHADOW_MS: it draws every caster in view again,
  // and a shadow one frame behind does not show at 60 fps from above. Below 40 fps, and at eye level (the operative's
  // view, shadows right in front of him), it is still drawn every frame.
  renderer.shadowMap.autoUpdate = false;
  if (cam?.fps || now - shadowAt >= SHADOW_MS) { renderer.shadowMap.needsUpdate = true; shadowAt = now; }
  const p = !renderObject && !gfx.low && !NO_AO ? postFor() : null;
  if (!p) { renderer.render(renderObject ?? scene, camera); return; }
  renderer.getSize(v2);
  const ratio = renderer.getPixelRatio();
  if (p.w !== v2.x || p.h !== v2.y || p.ratio !== ratio) { p.composer.setPixelRatio(ratio); p.composer.setSize(v2.x, v2.y); Object.assign(p, { w: v2.x, h: v2.y, ratio }); }
  p.composer.render(dt);
}

// ---------- ambient occlusion (High) ----------
// GTAO: soft shade where surfaces meet (a tank on the ground, the foot of a wall, a trench lip, the gap under a
// turret). It draws its own depth and normals of the meshes (a second scene pass; points and lines cast none). The
// add-ons load on first use; a page without them in its import map, ?ao=0, or Graphics Low draws straight to the screen.
// ponytail: sharing the multisampled frame's depth instead (no second pass) drew nothing here; try again if the pass
// shows up in frame time.
const AO = { radius: 1.6, mix: 0.85 };
const NO_AO = new URLSearchParams(location.search).get('ao') === '0';
const v2 = new THREE.Vector2();
let post = null, postLoading = false;
function postFor() {
  if (post || postLoading) return post;
  postLoading = true;
  Promise.all(['EffectComposer', 'RenderPass', 'GTAOPass', 'OutputPass'].map((n) => import(`three/addons/postprocessing/${n}.js`))).then((mods) => {
    const { EffectComposer, RenderPass, GTAOPass, OutputPass } = Object.assign({}, ...mods);
    // 4x multisampling keeps edges as smooth as the plain renderer's antialias
    const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
    const ao = new GTAOPass(scene, camera, 1, 1);
    ao.updateGtaoMaterial({ radius: AO.radius, distanceFallOff: 1, thickness: 1, samples: 12 });
    ao.blendIntensity = AO.mix;
    // three only leaves points and lines out of the AO depth: see-through things (capture rings, labels, fog, the
    // apron haze) then count as solid walls and cast long black streaks over the ground behind them. Leave them out too.
    // This runs every frame: walk only what is drawn (most of a big battle's ~20,000 objects are hidden soldiers'
    // meshes, and a hidden parent hides its children anyway) and allocate nothing per object.
    const seeThrough = (m) => m.transparent || !m.depthWrite;
    ao._overrideVisibility = function () {
      const cache = this._visibilityCache;
      this.scene.traverseVisible((o) => {
        const m = o.material;
        if (o.isPoints || o.isLine || o.isLine2 || o.isSprite || (m && (Array.isArray(m) ? m.every(seeThrough) : seeThrough(m)))) { o.visible = false; cache.push(o); }
      });
    };
    composer.addPass(new RenderPass(scene, camera)); composer.addPass(ao); composer.addPass(new OutputPass());
    post = { composer, w: 0, h: 0, ratio: 0 };
  }).catch((e) => console.warn('ambient occlusion unavailable:', e.message));
  return null;
}

// Haze scales with zoom, and the sun's shadow box covers just what the camera sees, so shadows stay crisp.
const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]], foot = corners.map(() => new THREE.Vector3());
const center = new THREE.Vector3(), lx = new THREE.Vector3(), ly = new THREE.Vector3();
function aimSun(yaw) {
  if (scene) scene.environmentRotation.y = yaw;
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
  let rad = 0;
  if (cam?.fps) {
    // at eye level the frustum reaches the horizon: shadow a fixed patch ahead of the soldier instead, kept sharp
    camera.getWorldDirection(v3); v3.y = 0; v3.normalize();
    center.copy(camera.position).addScaledVector(v3, 22); center.y = gy; rad = 48;
  } else {
    center.set(0, 0, 0);
    corners.forEach(([sx, sy], i) => {
      const dir = v3.set(sx, sy, 0.5).unproject(camera).sub(camera.position).normalize();
      const t = dir.y < -0.02 ? Math.min(600, (gy - camera.position.y) / dir.y) : 600;
      foot[i].copy(camera.position).addScaledVector(dir, t);
      center.add(foot[i]);
    });
    center.multiplyScalar(0.25);
    for (const p of foot) rad = Math.max(rad, p.distanceTo(center));
    rad = Math.ceil((rad + 10) / 8) * 8; // steps of 8 m, so panning doesn't resize the shadow map
  }

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
