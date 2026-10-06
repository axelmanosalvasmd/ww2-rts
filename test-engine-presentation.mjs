import assert from 'node:assert/strict';
import * as THREE from 'three';
import { UNITS, CELL } from './shared/sim.js';
import { buildModel, animate, animationInterest, drawSoldiers, crowd, vehicleBody, vehicleDamageAnchor } from './client/unit-models.js';
import { vehicleDamageFrame, environmentalMix } from './client/engine-presentation.js';
import { gfx } from './client/gfx.js';

// Real model transforms and poses, without claiming renderer frame times from this adapter.
const camera = new THREE.PerspectiveCamera(50, 1, 1, 600);
camera.position.set(0, 55, 65); camera.lookAt(0, 0, 0); camera.updateProjectionMatrix();
const root = new THREE.Group();
const unit = { id: 9, type: 'rifle', owner: 0, root, models: [], x: 0, z: 0, rot: 0, supp: 0, cover: 0, flags: 0 };
buildModel(unit, root, { uniform: 0x6b7248, vehicle: 0x59623d, color: 0x75965b }, 0, UNITS.rifle);
let groundQueries = 0;
const ground = () => { groundQueries++; return 0; };
animate(unit, 1 / 60, camera.position, ground, animationInterest(camera)(unit));
assert.equal(groundQueries, unit.models.length);
const firstPose = unit.models[0].userData.hi[0].morphTargetInfluences.slice();
for (let n = 0; n < 120; n++) {
  root.position.set(400 + n, 0, 0); unit.x = root.position.x; unit.supp = 95;
  const interested = animationInterest(camera)(unit);
  assert.equal(interested, false);
  animate(unit, 1 / 60, camera.position, ground, interested);
}
assert.equal(groundQueries, unit.models.length, 'off-screen squads never evaluate detailed terrain or poses');
assert.deepEqual(unit.models[0].userData.hi[0].morphTargetInfluences, firstPose);
assert.equal(animationInterest(camera)(unit, true), true, 'selected delivered units keep detail');
root.visible = false;
assert.equal(animationInterest(camera)(unit, true), false, 'selection cannot restore a hidden unit');
drawSoldiers([unit], camera);
assert.equal(crowd.children.reduce((sum, mesh) => sum + mesh.count, 0), 0, 'hidden units are absent from instancing');
root.visible = true;
root.position.set(0, 0, 0); unit.x = 0;
animate(unit, 1 / 60, camera.position, ground, animationInterest(camera)(unit));
assert.equal(unit.squad.w[2], 1, 'the returned view immediately uses current pinned posture');
assert.equal(unit.models[0].userData.motion.blend, 0, 'a large delivered reposition does not replay walking');
assert.ok(unit.models.every(man => Math.hypot(man.userData.motion.x, man.userData.motion.z) < 5), 'followers return at current slots');
assert.equal(groundQueries, unit.models.length * 2, 'one current evaluation replaces all missed frames');
// A center just outside the view retains detail when the squad margin intersects the view.
root.position.set(50, 0, 0);
assert.equal(animationInterest(camera)(unit), true);
root.position.set(400, 0, 0);
drawSoldiers([unit], camera);
assert.equal(crowd.children.reduce((sum, mesh) => sum + mesh.count, 0), 0);
root.position.set(0, 0, 0); unit.x = 0;
for (const level of ['high', 'low']) {
  gfx.set(level);
  animate(unit, 1 / 60, camera.position, ground, true);
  drawSoldiers([unit], camera);
  assert.equal(crowd.children.reduce((sum, mesh) => sum + mesh.count, 0), unit.models.length, `${level} preserves current instanced soldiers`);
}

// Smoke belongs above the actual native hull. A vertical ray through its mount must hit the deck below it.
for (const [type, faction] of [['tank', 0], ['tank', 1], ['tank', 2], ['medium', 0], ['tiger', 1], ['churchill', 3], ['armoredcar', 0], ['halftrack', 0], ['rocket', 2]]) {
  const v = { type, root: new THREE.Group(), models: [], x: 10, z: 15 };
  buildModel(v, v.root, { uniform: 0x6b7248, vehicle: 0x59623d, color: 0x75965b }, faction, UNITS[type]);
  const body = vehicleBody(v), anchor = vehicleDamageAnchor(v, new THREE.Vector3()), hull = [];
  for (const child of body.children) if (child !== v.turret) child.traverse(mesh => { if (mesh.isMesh) hull.push(mesh); });
  v.root.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(anchor, new THREE.Vector3(0, -1, 0));
  const deck = ray.intersectObjects(hull, false)[0];
  assert.ok(deck, `${type}/${faction} native hull lies below the smoke mount`);
  assert.ok(deck.distance > 0.05 && deck.distance < 2, `${type}/${faction} smoke begins outside and near the engine deck`);
  assert.ok(!hull.some(mesh => new THREE.Box3().setFromObject(mesh).containsPoint(anchor)), `${type}/${faction} mount is outside hull geometry bounds`);
  const cached = v.damageAnchorLocal;
  v.root.position.set(10, 3, 15); v.root.rotation.y = -.9; body.rotation.z = -.16; body.rotation.x = .12;
  const transformed = vehicleDamageAnchor(v, new THREE.Vector3());
  const expected = body.localToWorld(cached.clone());
  assert.ok(transformed.distanceTo(expected) < 1e-8, 'smoke follows the current hull yaw, pitch, roll and terrain height');
  assert.equal(v.damageAnchorLocal, cached, 'stable native geometry reuses its cached mount');
}

let puffs = 0;
const tank = { hp: 100, maxHealth: 100, root: { visible: true } };
const damage = (hp, frames = 1, detailed = true) => {
  tank.hp = hp;
  for (let i = 0; i < frames; i++) vehicleDamageFrame(tank, 0.1, detailed, () => puffs++);
};
damage(64, 10); assert.equal(tank.damageCue.stage, 1);
for (const hp of [65, 64, 67, 70, 65]) damage(hp);
assert.equal(tank.damageCue.stage, 1, 'small health fluctuations retain the light damage stage');
damage(31, 15); assert.equal(tank.damageCue.stage, 2);
damage(34, 10); assert.equal(tank.damageCue.stage, 2);
damage(39); assert.equal(tank.damageCue.stage, 1);
const damagedLevel = tank.damageCue.level;
damage(100); assert.ok(tank.damageCue.level > 0 && tank.damageCue.level < damagedLevel, 'repair fades the cue');
damage(100, 50); assert.equal(tank.damageCue.level, 0);
const beforeHidden = puffs;
tank.root.visible = false; damage(10, 60);
assert.equal(puffs, beforeHidden, 'hidden delivered vehicles cannot emit a fresh cue');
tank.root.visible = true; damage(10, 60, false);
assert.equal(puffs, beforeHidden, 'off-screen cues accrue no emission debt');
damage(10); assert.equal(puffs, beforeHidden + 1, 'return emits only one current cue');
damage(0); assert.equal(tank.damageCue.level, 0, 'death releases the living cue to the wreck effects');

const grid = Array.from({ length: 20 }, () => Array(20).fill('.'));
const groundGrid = grid.map(row => [...row]), objectGrid = grid.map(row => [...row]);
objectGrid[8][11] = 'O'; groundGrid[10][13] = 'W'; objectGrid[10][13] = '=';
const ear = { x: CELL * 10, z: CELL * 10, yaw: 0, dist: 45 };
const sample = (known = () => true, extra = {}) => environmentalMix({ grid, groundGrid, objectGrid, cell: CELL, camera: ear, known, ...extra });
const unknown = sample(() => false), known = sample();
assert.equal(unknown.water.gain, 0); assert.equal(unknown.woodland.gain, 0);
assert.ok(known.water.gain > 0 && known.woodland.gain > 0, 'delivered layered bridge and woods produce location ambience');
assert.ok(known.water.pan > 0, 'water to camera right is weighted right');
assert.ok(sample(undefined, { camera: { ...ear, yaw: Math.PI } }).water.pan < 0, 'camera yaw changes spatial placement');
const hidden = sample((x) => x < CELL * 12);
assert.equal(hidden.water.gain, 0);
groundGrid[10][13] = '.'; objectGrid[10][13] = '.';
assert.deepEqual(sample(() => false), unknown, 'a hidden world change cannot alter the mix');
assert.equal(sample(undefined, { weather: 'rain' }).rain.gain, 0.2);
assert.equal(sample(undefined, { weather: 'clear', wx: [0.5] }).rain.gain, 0.1);
assert.equal(sample(undefined, { weather: 'snow', wx: [1] }).rain.gain, 0);
const dense = grid.map(row => row.map(() => 'W'));
const denseMix = environmentalMix({ grid: dense, cell: CELL, camera: ear });
assert.ok(denseMix.water.gain <= 0.14, 'dense known terrain has a bounded layer gain');

// The Web Audio adapter records routing and ramps; it does not judge audible quality.
const params = [], nodes = [];
class Param {
  value = 1; calls = [];
  constructor() { params.push(this); }
  setTargetAtTime(value, time, constant) { this.calls.push(['target', value, time, constant]); this.value = value; }
  setValueAtTime(value, time) { this.calls.push(['set', value, time]); this.value = value; }
  linearRampToValueAtTime(value, time) { this.calls.push(['ramp', value, time]); this.value = value; }
  cancelScheduledValues(time) { this.calls.push(['cancel', time]); }
}
class Node {
  gain = new Param(); pan = new Param(); playbackRate = new Param(); frequency = new Param(); Q = new Param();
  threshold = new Param(); knee = new Param(); ratio = new Param(); attack = new Param(); release = new Param();
  destinations = []; starts = []; stops = [];
  constructor(type) { this.type = type; nodes.push(this); }
  connect(node) { this.destinations.push(node); return node; }
  start(...args) { this.starts.push(args); }
  stop(...args) { this.stops.push(args); }
}
class Context {
  state = 'running'; currentTime = 0; sampleRate = 2000; destination = new Node('destination');
  createDynamicsCompressor() { return new Node('compressor'); }
  createGain() { return new Node('gain'); }
  createStereoPanner() { return new Node('pan'); }
  createBiquadFilter() { return new Node('filter'); }
  createBufferSource() { return new Node('source'); }
  createBuffer(channels, length, rate) { const data = new Float32Array(length); return { duration: length / rate, getChannelData: () => data }; }
  decodeAudioData() { return Promise.resolve(this.createBuffer(1, 2000, 2000)); }
}
globalThis.AudioContext = Context;
globalThis.addEventListener = () => {};
globalThis.fetch = async url => String(url).endsWith('index.json')
  ? { json: async () => ({ sfx: { alert_attack: {}, blast_large: {}, match_start: {} }, voice: {} }) }
  : { ok: true, arrayBuffer: async () => new ArrayBuffer(1) };
const { audio } = await import('./client/audio.js');
audio.start();
await new Promise(resolve => setImmediate(resolve));
audio.environment({ ...known, rain: { gain: 0.2, pan: 0 } });
assert.equal(audio.stats().beds.length, 4, 'four environmental beds bound active sources');
const sources = nodes.filter(node => node.type === 'source' && node.loop);
assert.equal(sources.length, 4);
for (let i = 0; i < 30; i++) audio.environment(unknown);
assert.equal(nodes.filter(node => node.type === 'source' && node.loop).length, 4, 'camera moves reuse the bounded loop set');
assert.ok(params.some(param => param.calls.some(call => call[0] === 'target' && call[1] === 0 && call[3] === 1.3)), 'departed terrain fades gradually');
audio.alert('attack');
assert.ok(params.some(param => param.calls.some(call => call[0] === 'target' && call[1] === 0.32)), 'critical Alerts lower ambience');
audio.setVolume(0); assert.equal(audio.stats().volume, 0);
assert.ok(params.some(param => param.calls.some(call => call[0] === 'target' && call[1] === 0 && call[3] === 0.03)), 'mute controls the shared master');
audio.toggleMute(); assert.ok(audio.stats().volume > 0);
audio.end(); assert.equal(audio.stats().beds.length, 0);
assert.ok(sources.every(source => source.stops.length), 'match end releases every environmental loop');
console.log('engine presentation checks passed: known terrain, Weather crossfades, mute/Alert routing, health hysteresis, repair/death, early animation gating and current-pose reentry');
