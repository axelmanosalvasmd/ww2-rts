// Model viewer (client/viewer.html): builds a unit through the game's own model code (client/unit-models.js, and
// client/aircraft.js for planes and the airfield, the way main.js makeUnit() does) and shows it under the game's light
// from fixed angles, or (?all=1) a lineup of every type one faction fields. A tool for checking models; the game never
// loads it. tools/model-shots.sh screenshots it. URL options are listed in viewer.html.
import * as THREE from 'three';
import { UNITS, SUPPORT } from '/shared/sim.js';
import { buildModel, animate, setSurfaces, setBuildings } from './unit-models.js';
import { loadModelTextures, modelTexturesOn } from './model-textures.js';
import { createAviation } from './aircraft.js';
import { ownerRing } from './markers.js';
import { setupLight, sky } from './light.js';
import { MOODS, DEFAULT_MOOD } from './moods.js';
import { surface } from './surfaces.js';
import { buildingModel } from './structures.js';
import { gfx } from './gfx.js';

// ---------- copied from main.js (the header warns when main.js changes them) ----------
const FACTIONS = [
  { name: 'USA', uniform: 0x6b7248, vehicle: 0x59623d, names: { rifle: 'Rifle Squad', mg: '.30 cal MG', at: '57mm AT Gun', tank: 'M5 Stuart', rocket: 'T34 Calliope', ranger: 'Ranger Squad', bunker: 'Command Bunker', mortar: '81mm Mortar', sniper: 'Sniper Team', armoredcar: 'M8 Greyhound', medium: 'M4 Sherman', flak: '40mm Bofors', flaktrack: 'M16 Half-track', fighter: 'P-51 Mustang', attacker: 'P-47 Thunderbolt', halftrack: 'M3 Half-track', medic: 'Medics', lcvp: 'LCVP', gunboat: 'PT Boat', destroyer: 'Fletcher Destroyer', tankdestroyer: 'M10 Wolverine', howitzer: 'M2A1 105mm Howitzer', flamer: 'Flamethrower Team', bomber: 'B-25 Mitchell' } },
  { name: 'Germany', uniform: 0x5c6266, vehicle: 0x50565a, names: { rifle: 'Grenadiers', mg: 'MG 42 Team', at: 'PaK 40', tank: 'Panzer II', rocket: 'Panzerwerfer', tiger: 'Tiger I', bunker: 'Command Bunker', mortar: 'GrW 34 Mortar', sniper: 'Scharfschützen', armoredcar: 'Sd.Kfz. 222', medium: 'Panzer IV', flak: 'Flak 38', flaktrack: 'Wirbelwind', fighter: 'Bf 109', attacker: 'Ju 87 Stuka', halftrack: 'Sd.Kfz. 251', medic: 'Sanitäter', lcvp: 'Sturmboot', gunboat: 'S-Boot', destroyer: 'Zerstörer 1936', tankdestroyer: 'StuG III', howitzer: 'leFH 18', flamer: 'Flammenwerfer Team', bomber: 'He 111' } },
  { name: 'USSR', uniform: 0x7d7250, vehicle: 0x4e5a38, names: { rifle: 'Riflemen', mg: 'Maxim MG', at: '45mm AT Gun', tank: 'T-70', rocket: 'Katyusha', conscript: 'Conscripts', bunker: 'Command Bunker', mortar: '82mm Mortar', sniper: 'Snipers', armoredcar: 'BA-64', medium: 'T-34', flak: '61-K AA Gun', flaktrack: 'ZSU-37', fighter: 'Yak-9', attacker: 'Il-2 Sturmovik', halftrack: 'M5 Half-track', medic: 'Sanitary Team', lcvp: 'Assault Boat', gunboat: 'Armored Boat', destroyer: 'Gnevny Destroyer', tankdestroyer: 'SU-85', howitzer: '122mm M-30 Howitzer', flamer: 'ROKS-2 Flamethrower Team', bomber: 'Pe-2' } },  { name: 'UK', uniform: 0x6f6448, vehicle: 0x565640, names: { rifle: 'Rifle Section', mg: 'Vickers MG', at: '6-pounder', tank: 'Stuart V', rocket: 'Land Mattress', churchill: 'Churchill VII', commando: 'Commandos', bunker: 'Command Bunker', mortar: '3-inch Mortar', sniper: 'Sniper Pair', armoredcar: 'Daimler Armoured Car', medium: 'Cromwell', flak: '40mm Bofors', flaktrack: 'Crusader AA', fighter: 'Spitfire', attacker: 'Typhoon', halftrack: 'Universal Carrier', medic: 'Stretcher Bearers', lcvp: 'LCA', gunboat: 'MTB', destroyer: 'Tribal-class Destroyer', tankdestroyer: 'Achilles', howitzer: '25-pounder', flamer: 'Lifebuoy Flamethrower Team', bomber: 'Mosquito' } },
];
// planes that only fly air support (no unit type in the sim), shown with ?type=bomber or ?type=transport
const PLANES = {
  bomber: { air: true, name: 'Bomber (air support)', radius: 8, models: 1, names: ['B-25 Mitchell', 'He 111', 'Pe-2', 'Mosquito'] },
  transport: { air: true, name: 'Transport (air support)', radius: 8, models: 1, names: ['C-47 Skytrain', 'Ju 52', 'Li-2', 'Dakota'] },
};
const COLORS = [0x3b73d6, 0xcc3a2e, 0xece6d6, 0xe2832b, 0x9b5cd4, 0x35b6c0]; // grease-pencil palette: blue, red, chalk, orange, violet, cyan
const AIR_ALT = 20; // main.js: planes fly this high over the ground
const facOf = () => fac;

// ---------- the game camera and sun (client/camera.js, client/light.js) ----------
const GAME = { fov: 42, pitch: 0.95, dist: 40, w: 1920, h: 1080 }; // the cell crops a 1920x1080 frame at 1:1
const SUN_SIDE = 60 * Math.PI / 180, HAZE = MOODS[DEFAULT_MOOD].haze; // light.js and moods.js
const GRASS = 0x6c6c45; // ground.js painted grass, flat: its texture average after the grass tint and saturation
const SUN_DIR = new THREE.Vector3(); // light.js aimSun(0): the opening view of yaw 0
{
  const az = Math.PI - SUN_SIDE, up = sky.sunUp * Math.PI / 180;
  SUN_DIR.set(Math.sin(az) * Math.cos(up), Math.sin(up), Math.cos(az) * Math.cos(up));
}

// ---------- options ----------
const q = new URLSearchParams(location.search);
const hex = (s) => { const n = parseInt(String(s ?? '').replace(/^(#|0x)/i, ''), 16); return Number.isFinite(n) ? n : null; };
const int = (s, lo, hi, d) => { const n = parseInt(s ?? '', 10); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
const fac = int(q.get('fac'), 0, FACTIONS.length - 1, 0);
const colorArg = q.get('color');
const slot = colorArg === null ? fac : /^\d$/.test(colorArg) && +colorArg < COLORS.length ? +colorArg : null;
const color = slot !== null ? COLORS[slot] : hex(colorArg) ?? COLORS[fac];
const f = { ...FACTIONS[fac], color }; // main.js look(slot)
const type = q.get('type') ?? 'medium';
const posture = int(q.get('posture'), 0, 3, 0);
const POSTURES = ['standing', 'crouched', 'prone', 'retreating'];
const bg = hex(q.get('bg')) ?? HAZE;
const aim = (Number(q.get('aim')) || 0) * Math.PI / 180;
const farLod = q.get('far') === '1', showGrid = q.get('grid') !== '0', lineup = q.get('all') === '1', textures = q.get('tex') !== '0';
const noCrew = q.get('crew') === '0', moving = q.get('motion') === '1';
let motionUnit = null, motionTime = 0, motionLast = 0;

// ---------- page ----------
const $ = (id) => document.getElementById(id);
const HEAD = 64, GAP = 4;
const warnings = [];
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const colorHex = '#' + color.toString(16).padStart(6, '0');
let ready = false;
window.__viewerReady = false;
function fail(msg) {
  warnings.push(`Error: ${msg}`);
  window.__viewerError = msg;
  showWarnings();
  window.__viewerReady = true; // let tools/model-shots.sh take the screenshot with the error on it
}
window.addEventListener('error', (e) => fail(e.message));
window.addEventListener('unhandledrejection', (e) => fail(String(e.reason?.message ?? e.reason)));
function showWarnings() {
  let el = $('warn');
  if (!el) { el = document.createElement('div'); el.id = 'warn'; $('head').append(el); }
  el.textContent = warnings.join(' | ');
}

// textures (wood, sandbags, building walls) load through three's default manager; count what is still in flight
const manager = THREE.DefaultLoadingManager;
let pending = 0;
for (const [k, d] of [['itemStart', 1], ['itemEnd', -1], ['itemError', -1]]) {
  const fn = manager[k];
  manager[k] = (url) => { pending += d; fn(url); if (d < 0) dirty = true; };
}

// ---------- renderer, scene and light, set up like main.js ----------
setSurfaces(surface); setBuildings(buildingModel);
if (textures) loadModelTextures(); // after the loading manager hooks above, so the screenshot waits for them
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.localClippingEnabled = true;
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
// the canvas sits below the header: with the opaque header over it, headless Chrome screenshots lost its bottom rows
renderer.setSize(innerWidth, innerHeight - HEAD);
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene();
const gameCam = new THREE.PerspectiveCamera(GAME.fov, GAME.w / GAME.h, 1, 1000); // main.js camera
const closeCam = new THREE.PerspectiveCamera(30, 1, 0.05, 3000);
const { sun } = setupLight(renderer, scene, gameCam); // tone mapping, shadows, hemisphere fill, the sun, haze (the default mood)
scene.background = new THREE.Color(bg);

const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshLambertMaterial({ color: GRASS }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
const grid = new THREE.GridHelper(48, 24, 0x4a5530, 0x56623a); // 2 m squares: the game's build grid
grid.position.y = 0.02; grid.material.transparent = true; grid.material.opacity = 0.45;
scene.add(ground, grid);

const aviation = createAviation({
  hAt: () => 0, UNITS, SUPPORT, units: new Map(), altitude: AIR_ALT, world: () => scene, facOf,
  colorOf: () => color, vehicleOf: () => f.vehicle, me: () => fac, explode() {}, play() {},
  flakTypes: new Set(['flak', 'flaktrack', 'flakpos']),
});

// main.js makeUnit() without the HUD pieces (bars, stars, badge, selection ring)
let nextId = 1;
function makeUnit(t) {
  const def = UNITS[t] ?? PLANES[t], root = new THREE.Group();
  const v = { id: nextId++, type: t, owner: fac, root, models: [], alive: def.models, x: 0, z: 0, rot: 0, aim, turret: null };
  const base = ownerRing(def.radius + 0.4, f.color);
  root.add(base); v.base = base;
  if (def.air) aviation.buildUnit(v, root, t, fac);
  else if (t === 'airfield') aviation.buildAirfield(v, root, fac);
  else buildModel(v, root, f, facOf(), def);
  if (def.air) { base.visible = false; v.shadow.visible = true; } // main.js hides the ring of planes; tick() shows the shadow
  scene.add(root);
  return v;
}
const nearEye = (v) => new THREE.Vector3(v.x, 30, v.z + 30);
const farEye = (v) => new THREE.Vector3(v.x, 160, v.z + 160); // past LOD.high
// the posture main.js gets from suppression and retreat; a long dt snaps the blend to it
function pose(v) {
  v.supp = [0, 50, 90, 0][posture]; v.flags = posture === 3 ? 1 : 0;
  if (v.turret) { const a = -(v.aim - v.rot); v.turret.rotation.y = v.traverse ? Math.max(-v.traverse, Math.min(v.traverse, Math.atan2(Math.sin(a), Math.cos(a)))) : a; } // a casemate gun turns only so far
  animate(v, 10, farLod ? farEye(v) : nearEye(v));
}
// a plane's painted ground shadow under it (aircraft.js tick() puts it there each frame)
function placeShadow(v) { if (v.shadow) { v.shadow.position.set(v.x, 0.3, v.z); v.shadow.rotation.y = -v.rot; } }

// ---------- framing ----------
const tmpV = new THREE.Vector3(), tmpBox = new THREE.Box3();
const boxCorners = (b) => [0, 1, 2, 3, 4, 5, 6, 7].map((i) => new THREE.Vector3(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z));
// world points of the visible meshes under the roots: every vertex (so soldier postures and turrets count as posed),
// or the box corners of an instanced or very large mesh
function points(roots) {
  const out = [];
  for (const root of roots) {
    root.updateMatrixWorld(true);
    root.traverseVisible((o) => {
      const pos = o.isMesh ? o.geometry?.getAttribute('position') : null;
      if (!pos) return;
      if (!o.isInstancedMesh && pos.count < 60000) {
        for (let i = 0; i < pos.count; i++) out.push(o.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(o.matrixWorld));
      } else {
        if (o.isInstancedMesh) { if (!o.boundingBox) o.computeBoundingBox(); tmpBox.copy(o.boundingBox); }
        else { if (!o.geometry.boundingBox) o.geometry.computeBoundingBox(); tmpBox.copy(o.geometry.boundingBox); }
        out.push(...boxCorners(tmpBox.applyMatrix4(o.matrixWorld)));
      }
    });
  }
  return out;
}
const bounds = (roots) => new THREE.Box3().setFromPoints(points(roots));
// put cam on direction dir from the middle of pts, far enough back that their box is in front of it, then crop the
// view to where the points land on screen (setViewOffset, as the game cell does) so the model fills the cell.
// margin: room around the model; padTop: extra room on top, as a share of the height (for the lineup's tags)
function fit(cam, pts, dir, up, aspect, margin = 1.14, padTop = 0) {
  const box = new THREE.Box3().setFromPoints(pts), c = box.getCenter(new THREE.Vector3()), d = new THREE.Vector3(...dir).normalize();
  cam.up.set(...up); cam.aspect = aspect;
  cam.position.copy(c).add(d); cam.lookAt(c); cam.updateMatrixWorld();
  const r = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0), u = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
  const ty = Math.tan(cam.fov * Math.PI / 360), tx = ty * aspect;
  let dist = 0;
  for (const p of boxCorners(box)) {
    const o = p.sub(c), z = o.dot(d);
    dist = Math.max(dist, Math.abs(o.dot(r)) / tx + z, Math.abs(o.dot(u)) / ty + z);
  }
  cam.position.copy(c).addScaledVector(d, dist);
  cam.near = Math.max(0.02, dist * 0.02); cam.far = dist + 2000;
  // the points' extent in view tangents (x and y over depth), grown by the margins, then to the cell's aspect
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of pts) {
    tmpV.subVectors(p, cam.position);
    const depth = Math.max(1e-4, -tmpV.dot(d)), x = tmpV.dot(r) / depth, y = tmpV.dot(u) / depth;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  const mx = (x1 - x0) * (margin - 1) / 2, my = (y1 - y0) * (margin - 1) / 2;
  x0 -= mx; x1 += mx; y0 -= my; y1 += my; y1 += (y1 - y0) * padTop;
  const w = x1 - x0, h = y1 - y0;
  if (w / h > aspect) { const g = (w / aspect - h) / 2; y0 -= g; y1 += g; } else { const g = (h * aspect - w) / 2; x0 -= g; x1 += g; }
  cam.setViewOffset(2 * tx, 2 * ty, x0 + tx, ty - y1, x1 - x0, y1 - y0);
  cam.updateMatrixWorld();
  return cam;
}
// a tight sun shadow box around what a close view shows, so its shadows are crisp
function sunOn(box) {
  const c = box.getCenter(new THREE.Vector3()), rad = box.getSize(tmpV).length() / 2 + 1;
  aimSunBox(c, rad);
}
function aimSunBox(c, rad) {
  sun.target.position.copy(c); sun.position.copy(c).addScaledVector(SUN_DIR, rad + 120);
  sun.target.updateMatrixWorld();
  const sc = sun.shadow.camera;
  Object.assign(sc, { left: -rad, right: rad, top: rad, bottom: -rad, near: 1, far: 2 * rad + 240 });
  sc.updateProjectionMatrix();
  sun.shadow.normalBias = (2 * rad) / sun.shadow.mapSize.x * 0.8;
}
// light.js followView() for the full game frame: haze by zoom, and a shadow box that covers what the camera sees
const NDC = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
function gameLight(cam) {
  scene.fog.near = GAME.dist * 0.7 / sky.haze; scene.fog.far = GAME.dist * 4.5 / sky.haze;
  cam.updateMatrixWorld();
  const foot = NDC.map(([sx, sy]) => {
    const dir = new THREE.Vector3(sx, sy, 0.5).unproject(cam).sub(cam.position).normalize();
    const t = dir.y < -0.02 ? Math.min(600, -cam.position.y / dir.y) : 600;
    return cam.position.clone().addScaledVector(dir, t);
  });
  const c = foot.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(0.25);
  const rad = Math.ceil((Math.max(...foot.map((p) => p.distanceTo(c))) + 10) / 8) * 8;
  aimSunBox(c, rad); // light.js also snaps the center to whole shadow texels; that only matters while panning
}
// the in-game camera over (x, z) at yaw 0, cropped to the cell's size out of a 1920x1080 frame (true game scale).
// alt lifts the point it centers on, so a plane AIR_ALT up sits mid-cell like the ground units.
function gameView(rect, x, z, alt = 0) {
  const hd = GAME.dist * Math.cos(GAME.pitch), h = GAME.dist * Math.sin(GAME.pitch), tz = z - hd * alt / h;
  const cam = gameCam;
  cam.position.set(x, h, tz + hd); cam.up.set(0, 1, 0); cam.lookAt(x, 0, tz);
  cam.aspect = GAME.w / GAME.h; cam.clearViewOffset();
  gameLight(cam);
  cam.setViewOffset(GAME.w, GAME.h, (GAME.w - rect.w) / 2, (GAME.h - rect.h) / 2, rect.w, rect.h);
  return cam;
}

// ---------- measuring: renderer.info for one camera pass and the sun's shadow pass ----------
function measure(cam, hide = []) {
  const was = [ground, grid, ...hide].map((o) => o.visible);
  [ground, grid, ...hide].forEach((o) => (o.visible = false));
  const info = renderer.info.render, sm = renderer.shadowMap;
  sm.autoUpdate = false; sm.needsUpdate = false;
  renderer.info.reset(); renderer.render(scene, cam);
  const out = { calls: info.calls, tris: info.triangles };
  sm.needsUpdate = true;
  renderer.info.reset(); renderer.render(scene, cam);
  out.shadowCalls = info.calls - out.calls; out.shadowTris = info.triangles - out.tris;
  sm.autoUpdate = true;
  [ground, grid, ...hide].forEach((o, i) => (o.visible = was[i]));
  return out;
}
function parts(roots, skip) {
  const mats = new Set();
  let meshes = 0;
  for (const r of roots) r.traverseVisible((o) => { if (o.isMesh && o !== skip) { meshes++; [o.material].flat().forEach((m) => mats.add(m)); } });
  return { meshes, materials: mats.size };
}

// ---------- one unit: six views (nine for squads) ----------
const UP = [0, 1, 0];
const CLOSE = [
  { label: 'front', dir: [1, 0.12, 0] },
  { label: 'left side', dir: [0, 0.12, -1] },
  { label: 'top', dir: [0, 1, 0], up: [0, 0, -1] }, // forward points right, as in the game camera
  { label: 'three-quarter front', dir: [1, 0.7, -1] },
  { label: 'three-quarter back', dir: [-1, 0.7, 1] },
];
let views = [], rows = 2, stats = null, measured = false, labelFor = null;

function singleUnit() {
  const def = UNITS[type] ?? PLANES[type];
  if (!def) throw new Error(`unknown type "${type}" (one of ${[...Object.keys(UNITS), ...Object.keys(PLANES)].join(', ')})`);
  if (def.faction >= 0 && def.faction !== fac) warnings.push(`In the game only ${FACTIONS[def.faction].name} fields ${type}; this is what the model code builds for ${FACTIONS[fac].name}`);
  const v = makeUnit(type), air = !!def.air;
  pose(v); placeShadow(v);
  if (moving && !air) motionUnit = v;
  // close views lift a plane so its lowest point is 1.5 m over the ground; the game view flies it at AIR_ALT
  const lift = air ? 1.5 - bounds([v.root]).min.y : 0;
  const man = v.squad ? v.models[0] : null;
  const state = (game, solo) => {
    v.base.visible = game && !air;
    grid.visible = showGrid && !game;
    for (const c of v.root.children) if (c !== v.base) c.visible = !solo || c === man;
    if (noCrew && v.squad) for (const m of v.models) m.visible = false; // &crew=0: only the weapon
    v.root.position.y = air ? (game ? AIR_ALT : lift) : 0;
    v.root.updateMatrixWorld(true);
  };
  state(false, false); const whole = points([v.root]);
  let solo = null;
  if (man) { state(false, true); solo = points([v.root]); }
  const close = (view, pts, isSolo) => {
    const box = new THREE.Box3().setFromPoints(pts);
    return {
      label: isSolo ? `one soldier: ${view.label}` : view.label,
      setup(rect) {
        state(false, isSolo);
        scene.fog.near = 1e4; scene.fog.far = 2e4;
        sunOn(box);
        const framing = moving && isSolo ? boxCorners(new THREE.Box3(new THREE.Vector3(-0.65, 0, -0.5), new THREE.Vector3(0.85, 1.8, 0.5))) : pts;
        const cam = fit(closeCam, framing, view.dir, view.up ?? UP, rect.w / rect.h, moving ? 1.5 : 1.14);
        if (moving) {
          cam.position.x += isSolo ? man.userData.motion.x : v.x;
          cam.position.z += isSolo ? man.userData.motion.z : v.z;
          cam.updateMatrixWorld();
        }
        return cam;
      },
    };
  };
  views = CLOSE.map((view) => close(view, whole, false));
  views.push({
    label: `in-game camera: ${GAME.fov}° FOV, pitch ${GAME.pitch}, distance ${GAME.dist}, 1:1 with a 1920x1080 window`,
    game: true,
    setup(rect) { state(true, false); return gameView(rect, v.x, v.z, air ? AIR_ALT : 0); },
  });
  if (man) { rows = 3; views.push(...[CLOSE[0], CLOSE[1], CLOSE[3]].map((view) => close(view, solo, true))); }

  const name = FACTIONS[fac].names[type] ?? def.names?.[fac] ?? def.name;
  $('title').innerHTML = `${name}<span class="sub">${type}, ${FACTIONS[fac].name} (fac ${fac}), color ${colorHex}${slot !== null ? ` (slot ${slot})` : ''}${v.squad ? `, ${def.models} men, ${POSTURES[posture]}${farLod ? ', far model' : ''}` : ''}</span>`;
  // measured once, in the game view, before the first real frame
  const game = views.find((x) => x.game);
  window.__viewer = { type, fac, color: colorHex, name, posture, gfx: gfx.level };
  measureOnce = (rect) => {
    game.setup(rect);
    const base = [v.base]; // the owner ring is one more draw call per unit in the game; left out here
    stats = measure(gameCam, base);
    if (v.squad) { // the other level of detail too
      animate(v, 0, farLod ? nearEye(v) : farEye(v)); stats.other = measure(gameCam, base);
      animate(v, 0, farLod ? farEye(v) : nearEye(v));
    }
    Object.assign(stats, parts([v.root], v.base));
    window.__viewer.stats = stats;
    const shadow = (s) => s.shadowCalls ? ` (+${s.shadowCalls} shadow, +${fmt(s.shadowTris)} tris)` : ' (casts no sun shadow)';
    $('stats').innerHTML = `In-game camera: <b>${stats.calls}</b> draw calls, <b>${fmt(stats.tris)}</b> triangles${shadow(stats)}`
      + (stats.other ? ` | ${farLod ? 'near' : 'far'} soldier model: ${stats.other.calls} calls, ${fmt(stats.other.tris)} tris` : '')
      + ` | ${stats.meshes} meshes, ${stats.materials} materials${air ? ' | counts include the painted ground shadow' : ' | owner ring +1 call'} | Graphics ${gfx.level}, model textures ${modelTexturesOn() ? 'on' : 'off'}`;
  };
}

// ---------- every type of one faction in a lineup ----------
const GUNS = new Set(['mg', 'at', 'flak', 'mortar']);
const ROWS = [ // back to front, so the small pieces stand nearest the camera
  (d) => d.structure,
  (d) => d.air,
  (d) => !d.infantry && !d.air && !d.structure,
  (d, t) => GUNS.has(t),
  (d, t) => d.infantry && !GUNS.has(t),
];
function lineupAll() {
  const types = Object.keys(UNITS).filter((t) => !(UNITS[t].faction >= 0) || UNITS[t].faction === fac);
  const units = [];
  let zAt = 0;
  for (const row of ROWS) {
    const list = types.filter((t) => row(UNITS[t], t));
    if (!list.length) continue;
    const built = list.map((t) => {
      const v = makeUnit(t);
      v.base.visible = false; pose(v);
      if (UNITS[t].air) v.lift = 1.5 - bounds([v.root]).min.y;
      v.root.position.y = v.lift ?? 0;
      return { v, box: bounds([v.root]) };
    });
    const depth = Math.max(...built.map((b) => b.box.max.z - b.box.min.z)), mid = zAt + depth / 2;
    let xAt = 0;
    for (const b of built) {
      b.v.x = xAt - b.box.min.x; b.v.z = mid - (b.box.min.z + b.box.max.z) / 2;
      xAt += b.box.max.x - b.box.min.x + 2.5;
    }
    for (const b of built) {
      b.v.x -= (xAt - 2.5) / 2;
      b.v.root.position.set(b.v.x, b.v.lift ?? 0, b.v.z); placeShadow(b.v); pose(b.v);
      units.push(b.v);
    }
    zAt += depth + 3;
  }
  const roots = units.map((v) => v.root), pts = points(roots), box = new THREE.Box3().setFromPoints(pts);
  grid.scale.setScalar(Math.ceil(Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 48 + 0.5));
  grid.position.set(0, 0.02, (box.min.z + box.max.z) / 2);
  grid.visible = showGrid;
  const dir = [0.3, 0.85, 1];
  views = [{
    label: 'three-quarter view from the game camera side',
    setup(rect) {
      scene.fog.near = 1e4; scene.fog.far = 2e4;
      sunOn(box);
      return fit(closeCam, pts, dir, UP, rect.w / rect.h, 1.04, 0.05);
    },
  }];
  rows = 1;
  $('title').innerHTML = `Lineup: ${FACTIONS[fac].name}<span class="sub">fac ${fac}, color ${colorHex}${slot !== null ? ` (slot ${slot})` : ''}, ${units.length} types</span>`;
  window.__viewer = { all: true, fac, color: colorHex, types: units.map((v) => v.type), gfx: gfx.level };
  // labels over each unit, with what it costs to draw (the lineup camera; all other units hidden)
  measureOnce = (rect) => {
    const cam = views[0].setup(rect);
    stats = {};
    for (const v of units) {
      const others = units.filter((u) => u !== v).flatMap((u) => [u.root, u.shadow].filter(Boolean));
      stats[v.type] = measure(cam, others);
    }
    const sum = (k) => Object.values(stats).reduce((a, s) => a + s[k], 0);
    window.__viewer.stats = stats;
    $('stats').innerHTML = `All ${units.length}: <b>${sum('calls')}</b> draw calls, <b>${fmt(sum('tris'))}</b> triangles (+${sum('shadowCalls')} shadow calls, +${fmt(sum('shadowTris'))} tris); owner rings hidden | Graphics ${gfx.level}, model textures ${modelTexturesOn() ? 'on' : 'off'}`;
  };
  labelFor = (rect, cam) => units.map((v) => {
    const b = bounds([v.root]), p = new THREE.Vector3((b.min.x + b.max.x) / 2, b.max.y + 0.4, (b.min.z + b.max.z) / 2).project(cam);
    const s = stats?.[v.type];
    return { x: rect.x + (p.x + 1) / 2 * rect.w, y: HEAD + rect.y + (1 - p.y) / 2 * rect.h,
      html: `${FACTIONS[fac].names[v.type] ?? UNITS[v.type].name}<br><i>${v.type}${s ? `, ${s.calls} calls, ${fmt(s.tris)} tris` : ''}</i>` };
  });
}

// ---------- layout and drawing ----------
let measureOnce = null, dirty = true, frames = 0, cells = [];
function layout() {
  const W = innerWidth, H = innerHeight - HEAD, cols = views.length === 1 ? 1 : 3;
  const cw = (W - GAP * (cols - 1)) / cols, ch = (H - GAP * (rows - 1)) / rows;
  cells = views.map((view, i) => {
    const c = i % cols, r = Math.floor(i / cols);
    return { view, rect: { x: Math.round(c * (cw + GAP)), y: Math.round(r * (ch + GAP)), w: Math.round(cw), h: Math.round(ch) } };
  });
  const box = $('labels');
  box.innerHTML = '';
  for (const { view, rect } of cells) {
    const el = document.createElement('div');
    el.className = 'cell'; el.textContent = view.label;
    el.style.left = `${rect.x}px`; el.style.top = `${HEAD + rect.y}px`;
    box.append(el);
  }
  renderer.setSize(innerWidth, innerHeight - HEAD);
  dirty = true;
}
function draw() {
  const H = innerHeight - HEAD;
  renderer.setScissorTest(false); renderer.setClearColor(0x15171a, 1); renderer.clear();
  renderer.setScissorTest(true);
  if (measureOnce && !measured) { // once, in the game cell (or the lineup's one cell); every cell is drawn over after
    const { rect } = cells.find((c) => c.view.game) ?? cells[0], y = H - rect.y - rect.h;
    renderer.setViewport(rect.x, y, rect.w, rect.h); renderer.setScissor(rect.x, y, rect.w, rect.h);
    measured = true; measureOnce(rect);
  }
  for (const { view, rect } of cells) {
    const y = H - rect.y - rect.h;
    renderer.setViewport(rect.x, y, rect.w, rect.h); renderer.setScissor(rect.x, y, rect.w, rect.h);
    const cam = view.setup(rect);
    renderer.render(scene, cam);
    if (labelFor) placeTags(labelFor(rect, cam));
  }
  renderer.setScissorTest(false);
}
function placeTags(tags) {
  let box = $('tags');
  if (!box) { box = document.createElement('div'); box.id = 'tags'; document.body.append(box); }
  box.innerHTML = tags.map((t) => `<div class="tag" style="left:${t.x.toFixed(0)}px;top:${t.y.toFixed(0)}px">${t.html}</div>`).join('');
}
function frame(now) {
  if (motionUnit && ready) {
    const dt = motionLast ? Math.min(0.1, (now - motionLast) / 1000) : 0;
    motionLast = now; motionTime += dt;
    const v = motionUnit, t = motionTime % 10;
    // Four seconds moving, a stop, then a quarter turn and another walk. This is a visual test, not a sim order.
    if (t < 4) { v.x = t * 1.8; v.z = 0; v.rot = 0; }
    else if (t < 5) { v.x = 7.2; v.z = 0; v.rot = 0; }
    else if (t < 9) { v.x = 7.2; v.z = (t - 5) * 1.8; v.rot = Math.PI / 2; }
    else { v.x = 7.2; v.z = 7.2; v.rot = Math.PI / 2; }
    v.root.position.set(v.x, 0, v.z); v.root.rotation.y = -v.rot;
    v.models.forEach((m) => { m.visible = true; });
    animate(v, dt, farLod ? farEye(v) : nearEye(v));
    window.__viewer.motion = v.models.map((m) => ({ ...m.userData.motion }));
    dirty = true;
  }
  if (!dirty) return;
  if (!ready && pending > 0) return; // wait for textures; itemEnd marks the frame dirty
  dirty = false; draw(); frames++;
  if (!ready) {
    if (frames >= 3) { ready = true; window.__viewerReady = true; } else dirty = true; // a few frames: shaders recompile once maps arrive
  }
}

try {
  if (lineup) lineupAll(); else singleUnit();
  const only = views[int(q.get('view'), 0, views.length - 1, -1)]; // &view=N: that view alone, filling the window
  if (only) { views = [only]; rows = 1; }
  if (warnings.length) showWarnings();
} catch (e) { fail(e.message); }
// the copy of FACTIONS and COLORS above must match main.js
fetch('/client/main.js').then((r) => r.text()).then((src) => {
  const grab = (re) => { const m = src.match(re); return m ? JSON.stringify(Function(`return ${m[1]}`)()) : null; };
  if (grab(/const FACTIONS = (\[[\s\S]*?\n\]);/) !== JSON.stringify(FACTIONS) || grab(/const COLORS = (\[[^\]]*\]);/) !== JSON.stringify(COLORS)) {
    warnings.push('FACTIONS or COLORS in main.js changed: update the copy in client/viewer.js'); showWarnings();
  }
}).catch(() => {});
setTimeout(() => { if (!ready) { ready = true; window.__viewerTimedOut = true; dirty = true; warnings.push('Textures still loading after 20 s'); showWarnings(); window.__viewerReady = true; } }, 20000);
layout();
addEventListener('resize', layout);
renderer.setAnimationLoop(frame);
