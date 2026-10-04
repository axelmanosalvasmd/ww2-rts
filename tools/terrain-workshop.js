import * as THREE from 'three';
import { UNITS, startState } from '../shared/sim.js';
import { createRelief } from '../client/relief.js';
import { createGround } from '../client/ground.js';
import { buildModel, animate, vehicleBody, setSurfaces } from '../client/unit-models.js';
import { vehicleTerrainPose } from '../client/engine-presentation.js';
import { loadModelTextures, modelTexturesOn } from '../client/model-textures.js';
import { surface } from '../client/surfaces.js';
import { ownerRing } from '../client/markers.js';
import { setupLight } from '../client/light.js';
import { TERRAIN_SCENARIOS, TERRAIN_TYPES, terrainFixture } from './terrain-workshop-fixtures.js';

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const FACTIONS = [
  { uniform: 0x6b7248, vehicle: 0x59623d, color: 0x3b73d6 },
  { uniform: 0x5c6266, vehicle: 0x50565a, color: 0xcc3a2e },
  { uniform: 0x7d7250, vehicle: 0x4e5a38, color: 0xece6d6 },
  { uniform: 0x6f6448, vehicle: 0x565640, color: 0xe2832b },
];
for (const scenario of TERRAIN_SCENARIOS) $('scenario').add(new Option(scenario.name, scenario.id));
for (const type of TERRAIN_TYPES) $('type').add(new Option(UNITS[type].name, type));
$('type').value = 'medium';
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.localClippingEnabled = true;
renderer.domElement.setAttribute('aria-label', 'Vehicle traveling over the game terrain mesh');
$('stage').append(renderer.domElement);
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(36, 1, 0.1, 500);
const { sun } = setupLight(renderer, scene, camera);
scene.background = new THREE.Color(0x84918d);
scene.fog = new THREE.Fog(0x84918d, 65, 160);
Object.assign(sun.shadow.camera, { left: -35, right: 35, top: 35, bottom: -35, near: 1, far: 180 });
sun.shadow.camera.updateProjectionMatrix();
setSurfaces(surface);
let textureErrors = [];
const textureReady = new Promise(resolve => {
  THREE.DefaultLoadingManager.onLoad = resolve;
  THREE.DefaultLoadingManager.onError = url => textureErrors.push(url);
  loadModelTextures();
});
let fixture, ground, relief, unit, distance = 0, elapsed = 0, running = false;
let options = { scenario: 'ramp', type: 'medium', faction: 0, aligned: true, view: 'side' };
window.__terrainWorkshopReady = false;
const speed = 3;

function pose(dt, snap = false) {
  const at = fixture.point(distance);
  Object.assign(unit, at);
  const height = relief.hAt(at.x, at.z);
  unit.root.position.set(at.x, height, at.z);
  unit.root.rotation.set(0, -at.rot, 0);
  if (snap && unit.modelMotion) {
    Object.assign(unit.modelMotion, { x: at.x, z: at.z, yaw: -at.rot, speed: 0, travel: 0 });
    unit.visualBody.rotation.set(0, 0, 0); unit.visualBody.position.y = 0;
  }
  if (unit.turret) unit.turret.rotation.y = -(unit.aim - at.rot);
  animate(unit, dt, camera.position, relief.hAt, true);
  const body = vehicleBody(unit);
  if (options.aligned) {
    if (snap && unit.terrainPose) unit.terrainPose.suspended = true;
    vehicleTerrainPose(unit, dt, true, relief.hAt, body, UNITS[unit.type]);
  } else {
    body.rotation.set(0, 0, 0); body.position.y = 0;
    if (unit.terrainPose) unit.terrainPose.suspended = true;
  }
  unit.root.updateMatrixWorld(true);
}

function measureContact(v) {
  const points = [], point = new THREE.Vector3();
  let minY = Infinity;
  v.root.updateMatrixWorld(true);
  const visit = node => {
    if (node === v.base || node === v.sel || node === v.turret || v.mounts?.includes(node)) return;
    const positions = node.isMesh && node.geometry?.attributes.position;
    if (positions) for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i).applyMatrix4(node.matrixWorld);
      points.push(point.clone()); minY = Math.min(minY, point.y);
    }
    for (const child of node.children) visit(child);
  };
  visit(v.root);
  if (!Number.isFinite(minY)) return null;
  const bounds = new THREE.Box3().setFromPoints(points.filter(point => point.y <= minY + 0.15));
  return { minX: bounds.min.x, maxX: bounds.max.x, minZ: bounds.min.z, maxZ: bounds.max.z, y: minY };
}

function contacts() {
  const footprint = unit.groundContact ?? unit.workshopContact;
  if (!footprint) return [];
  const xValues = [footprint.minX, (footprint.minX + footprint.maxX) / 2, footprint.maxX];
  const zValues = [footprint.minZ, (footprint.minZ + footprint.maxZ) / 2, footprint.maxZ];
  const transform = unit.visualBody ?? unit.visualChassis;
  return xValues.flatMap(x => zValues.map(z => {
    const point = transform.localToWorld(new THREE.Vector3(x, footprint.y, z));
    const height = relief.hAt(point.x, point.z);
    return { x: point.x, y: point.y, z: point.z, ground: height, gap: point.y - height };
  }));
}

function state() {
  if (!unit) return null;
  unit.root.updateMatrixWorld(true);
  const visual = unit.visualBody ?? unit.visualChassis;
  const rotation = visual.getWorldQuaternion(new THREE.Quaternion());
  const forward = new THREE.Vector3(1, 0, 0).applyQuaternion(rotation);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(rotation);
  const support = contacts(), gaps = support.map(p => p.gap);
  return {
    ...options, alignment: options.aligned, ready: window.__terrainWorkshopReady, running, distance, length: fixture.length, elapsed, speed,
    x: unit.x, z: unit.z, height: unit.root.position.y, chassisLift: unit.visualChassis.position.y,
    pitch: Math.asin(clamp(forward.y, -1, 1)), roll: unit.visualChassis.rotation.x,
    forward: forward.toArray(), up: up.toArray(), contacts: support, contactAvailable: !!unit.groundContact,
    contactSource: unit.groundContact ? 'native vehicle footprint' : 'independent native lower-hull bounds',
    minGap: gaps.length ? Math.min(...gaps) : null, maxGap: gaps.length ? Math.max(...gaps) : null,
    textures: modelTexturesOn(), textureErrors: [...textureErrors],
    terrain: { vertices: relief.stats.vertices, triangles: relief.stats.triangles },
    fixture: 'Scripted presentation path. No simulation navigation or gravity.',
  };
}

function draw() {
  if (!unit) return;
  const height = unit.root.position.y + unit.visualChassis.position.y;
  const target = new THREE.Vector3(unit.x, height + 1.2, unit.z);
  const offset = options.view === 'oblique' ? [11, 8, 13] : options.view === 'front' ? [15, 5, 1] : [0, 4.5, 14];
  camera.position.copy(target).add(new THREE.Vector3(...offset)); camera.lookAt(target);
  sun.target.position.copy(target); sun.target.updateMatrixWorld();
  sun.position.copy(target).add(new THREE.Vector3(32, 50, 20));
  renderer.info.reset(); renderer.render(scene, camera);
  const current = state(), degrees = value => `${(value * 180 / Math.PI).toFixed(1)}°`;
  $('height').textContent = `${current.height.toFixed(2)} m`;
  $('pitch').textContent = degrees(current.pitch); $('roll').textContent = degrees(current.roll);
  $('lift').textContent = `${current.chassisLift.toFixed(2)} m`;
  $('gap').textContent = current.minGap === null ? 'Unavailable' : `${current.minGap.toFixed(3)} m`;
  $('elapsed').textContent = `${elapsed.toFixed(1)} s`;
  $('distance').textContent = `${distance.toFixed(1)} / ${fixture.length} m`;
  $('scrub').value = distance;
  $('play').textContent = running ? 'Pause' : 'Run';
  $('badge').textContent = options.aligned ? 'Terrain alignment on' : 'Comparison: level hull';
  $('badge').classList.toggle('off', !options.aligned);
}

function reset(next = {}) {
  if ('alignment' in next) next = { ...next, aligned: next.alignment };
  const candidate = { ...options, ...next };
  if (!TERRAIN_TYPES.includes(candidate.type)) throw new Error(`Unknown vehicle: ${candidate.type}`);
  if (!Number.isInteger(Number(candidate.faction)) || candidate.faction < 0 || candidate.faction > 3) throw new Error('Faction must be 0 through 3');
  const nextFixture = terrainFixture(candidate.scenario);
  options = { ...candidate, faction: Number(candidate.faction), aligned: !!candidate.aligned };
  running = false; distance = 0; elapsed = 0;
  if (unit) scene.remove(unit.root);
  if (relief) { scene.remove(relief.mesh); relief.dispose(); }
  ground?.dispose();
  fixture = nextFixture;
  ground = createGround(fixture.map, renderer);
  const grid = fixture.map.rows.map(row => [...row]);
  ground.paint(grid, Uint8Array.from(fixture.map.rows.join(''), startState));
  relief = createRelief(fixture.map, grid, { texture: ground.tex, isRoad: ground.isRoad, low: !!fixture.map.world });
  scene.add(relief.mesh);
  const root = new THREE.Group(), base = ownerRing(UNITS[options.type].radius + 0.4, FACTIONS[options.faction].color), sel = new THREE.Group();
  root.add(base, sel);
  unit = { id: 17, type: options.type, owner: options.faction, root, base, sel, models: [], alive: 1, rot: 0, aim: 0, flags: 0, supp: 0, cover: 0 };
  buildModel(unit, root, FACTIONS[options.faction], options.faction, UNITS[options.type]);
  unit.workshopContact = measureContact(unit);
  scene.add(root);
  pose(0, true);
  $('scenario').value = options.scenario; $('type').value = options.type; $('faction').value = options.faction;
  $('view').value = options.view; $('aligned').checked = options.aligned;
  $('scrub').max = fixture.length; $('description').textContent = fixture.description;
  draw();
  return state();
}

function seek(value) {
  running = false; distance = clamp(Number(value) || 0, 0, fixture.length); elapsed = distance / speed;
  pose(0, true); draw(); return state();
}

function advance(seconds = 1 / 60) {
  const duration = Number(seconds);
  if (!Number.isFinite(duration) || duration < 0 || duration > 120) throw new Error('Advance must be between 0 and 120 seconds');
  const count = Math.ceil(duration * 60), dt = count ? duration / count : 0;
  for (let i = 0; i < count; i++) {
    distance = Math.min(fixture.length, distance + speed * dt); elapsed += dt;
    pose(dt);
  }
  if (distance >= fixture.length) running = false;
  draw(); return state();
}

window.__terrainWorkshop = { reset, seek, advance, state, get ready() { return window.__terrainWorkshopReady; } };
for (const id of ['scenario', 'type', 'faction']) $(id).addEventListener('change', () => reset({ [id]: id === 'faction' ? Number($(id).value) : $(id).value }));
$('view').addEventListener('change', () => { options.view = $('view').value; draw(); });
$('aligned').addEventListener('change', () => { options.aligned = $('aligned').checked; seek(distance); });
$('scrub').addEventListener('input', () => seek($('scrub').value));
$('play').addEventListener('click', () => { if (distance >= fixture.length) seek(0); running = !running; draw(); });
$('reset').addEventListener('click', () => reset());
$('step').addEventListener('click', () => { running = false; advance(1 / 60); });
const resize = () => {
  const box = $('stage').getBoundingClientRect();
  renderer.setSize(box.width, box.height); camera.aspect = box.width / box.height; camera.updateProjectionMatrix(); draw();
};
new ResizeObserver(resize).observe($('stage'));
window.addEventListener('error', event => { $('error').textContent = event.message; });
window.addEventListener('unhandledrejection', event => { $('error').textContent = String(event.reason); });
reset(); resize();
await Promise.all([textureReady, ground.loading]);
if (textureErrors.length) $('error').textContent = `${textureErrors.length} model textures failed to load.`;
draw(); await new Promise(requestAnimationFrame); draw();
window.__terrainWorkshopReady = true;
let last = performance.now();
renderer.setAnimationLoop(now => {
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000)); last = now;
  if (running) advance(dt);
});
