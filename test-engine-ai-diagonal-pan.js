import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { PerspectiveCamera, Vector3 } from 'three';
import { CELL, createGame, command, step } from './shared/sim.js';
import { viewFor } from './shared/ai-view.js';
import { perceive, onScreen } from './shared/ai-perception.js';
import { createHands, queueCamera, advanceHands, interruptHands, HUMAN_SKILLS, projectPointer, unprojectPointer } from './shared/ai-hands.js';
import { bindings, match } from './client/keys.js';
// Run the actual browser camera module. Only its two import specifiers need Node resolution.
let client = await readFile(new URL('./client/camera.js', import.meta.url), 'utf8');
client = client.replace("from 'three'", `from '${new URL('./node_modules/three/build/three.module.js', import.meta.url)}'`)
  .replace("from '/shared/sim.js'", `from '${new URL('./shared/sim.js', import.meta.url)}'`);
const { rig } = await import(`data:text/javascript;base64,${Buffer.from(client).toString('base64')}`);
globalThis.innerWidth = 1920; globalThis.innerHeight = 1080;
globalThis.addEventListener = () => {};
globalThis.localStorage = { getItem: key => key === 'ww2-edge' ? '0' : '1' };
const map = { w: 200, h: 200, rows: Array(200).fill('.'.repeat(200)), spawns: [{ x: 50, y: 50 }, { x: 180, y: 180 }], points: [], heights: Array(200).fill('0'.repeat(200)) };
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} differs from ${b}`);
const pose = cam => ({ x: cam.x, z: cam.z, yaw: cam.yaw, distance: cam.distance });
function setup() {
  const saved = Math.random; let rng = 1;
  Math.random = () => ((rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0) / 4294967296);
  let game; try { game = createGame(map, ['AI', 'enemy'], false, [0, 1], [0, 1], { weather: false }); } finally { Math.random = saved; }
  game.units.clear(); game.players.forEach(p => p.mp = 500);
  for (const slot of [0, 1]) assert.equal(command(game, slot, { t: 'buy', unit: 'rifle' }), undefined);
  [...game.units.values()].forEach((u, i) => Object.assign(u, { x: i ? 360 : 100, z: i ? 360 : 100, holdFire: true, auto: false }));
  return game;
}
export const scenes = [
  { name: 'cardinal', right: 90, forward: 0, yaw: 0 },
  { name: 'diagonal', right: 90, forward: 60, yaw: 0 },
  { name: 'rotated', right: 90, forward: 60, yaw: .7 },
  { name: 'reverse', right: -45, forward: -70, yaw: -1.2 },
  { name: 'distance85', right: 90, forward: 60, yaw: .7, distance: 85 },
  { name: 'subtick-component', right: 90, forward: 2, yaw: 0 },
  { name: 'edge-clamp', right: -120, forward: -120, yaw: 0 },
  { name: 'cardinal-edge-clamp', right: -120, forward: 0, yaw: 0 },
  { name: 'held-interruption', right: 90, forward: 60, yaw: 0, interrupt: 'held', interruptTick: 1005 },
  { name: 'pending-interruption', right: 90, forward: 60, yaw: 0, interrupt: 'pending', interruptTick: 1003 },
  { name: 'full-budget', right: 90, forward: 60, yaw: 0, used: 120 },
  { name: 'one-budget-slot', right: 90, forward: 60, yaw: 0, used: 119 },
];
export function nativePan(api, scene, validate = true) {
  const g = setup(), log = [], state = { camera: { x: 100, z: 100, yaw: scene.yaw, distance: scene.distance ?? 60 } };
  const h = api.createHands({ slot: 0, level: 'hard', seed: 27, startedTick: 1000, camera: state.camera, log });
  h.openingUntil = 1000; g.tick = 1000; h.openingDone = true; state.hands = h;
  if (scene.used) h.inputTicks = scene.used === 119 ? Array.from({ length: 119 }, (_, i) => 100 + i * 6) : Array(scene.used).fill(1000);
  const c = Math.cos(scene.yaw), s = Math.sin(scene.yaw);
  const target = { x: 100 + c * scene.right + s * scene.forward, z: 100 - s * scene.right + c * scene.forward };
  assert.equal(api.queueCamera(h, target, { concern: scene.name }, 'pan'), true);
  const cam = { x: 100, z: 100, y: 0, yaw: scene.yaw, dist: scene.distance ?? 60 }, keys = new Set();
  const button = () => ({ setAttribute() {} });
  const renderer = new PerspectiveCamera(42, 1920 / 1080, 1, 2200);
  rig.init({ cam, keys, camera: renderer, pitch: .95,
    bounds: () => ({ w: map.w * CELL, h: map.h * CELL }), hAt: () => 0, units: new Map(),
    tryStore: fn => fn(), edgeButton: button(), panButton: button(), band: () => ({ top: 0, bottom: 1080 }) });
  const frames = [], gestures = new Map(); let view, interrupted = false, paidStarts = [];
  for (let tick = 1000; tick <= 1160; tick++) {
    if (tick % 2 === 0) { view = perceive(viewFor(g, 0, {}), 0, state, tick); g.shots = []; g.newCells = []; }
    const before = h.active;
    if (before && !before.reacting) for (const action of before.actions) if (action.startedTick !== undefined && !gestures.has(action)) {
      gestures.set(action, { code: action.input.code, start: action.startedTick, down: action.startedTick + action.panPrep, up: action.startedTick + action.duration });
    }
    keys.clear();
    for (const [action, key] of gestures) {
      const native = before?.panKeys?.find(held => held.action === action);
      if (native?.canceledAt !== undefined) key.canceledAt = native.canceledAt;
      if (key.canceledAt === undefined && tick > key.down && tick <= key.up) keys.add(key.code);
    }
    rig.update(.05);
    api.advanceHands(h, tick, view, () => assert.fail('a pan never issues a simulation command'));
    const active = h.active;
    if (!interrupted && active && tick === scene.interruptTick) {
      if (validate) {
        const second = active.panKeys[1];
        assert.ok(second && (scene.interrupt === 'held' ? tick >= second.down : tick < second.down),
          'the predeclared interruption really occurs during the named key phase');
      }
      assert.equal(api.interruptHands(h, tick, view), false); interrupted = true;
    }
    if (validate) { close(h.camera.x, cam.x); close(h.camera.z, cam.z); }
    const pixels = projectPointer({ x: h.camera.x, z: h.camera.z }, h.camera, view);
    const ground = unprojectPointer(pixels, h.camera, view); close(ground.x, h.camera.x); close(ground.z, h.camera.z);
    if (validate) {
      const at = { x: h.camera.x + 5, z: h.camera.z - 7 }, projected = projectPointer(at, h.camera, view);
      const actual = new Vector3(at.x, 0, at.z).project(renderer);
      close(projected.x, (actual.x + 1) * 960); close(projected.y, (1 - actual.y) * 540);
    }
    frames.push({ tick, camera: pose(h.camera), client: { x: cam.x, z: cam.z }, keys: [...keys],
      active: !!h.active, completed: log.length, screen: [...view.screenIds], starts: active?.panKeys?.map(key => ({ code: key.action.input.code, start: key.start, down: key.down, up: key.up, canceledAt: key.canceledAt })) ?? [] });
    step(g);
  }
  paidStarts = [...gestures.values()];
  if (validate) {
    assert.equal(log.length, scene.used === 120 ? 0 : scene.used === 119 || scene.interrupt === 'pending' || !scene.forward || Math.abs(scene.forward) < 3.3 ? 1 : 2, `${scene.name}: ${JSON.stringify({winner:g.winner,players:g.players.map(p=>p.out),active:!!h.active})}`);
    for (const input of log) { assert.ok(input.motorTicks > 0); assert.equal(input.tick, input.inputStartedTick + input.motorTicks); assert.ok(bindings.some(b => b.code === input.input.code && b.id.startsWith('pan'))); assert.ok(match({ code: input.input.code }, 'army').startsWith('pan')); }
    if (scene.used) assert.ok(h.inputTicks.length <= 120, 'overlapping keys reserve actual APM capacity');
    for (const input of log) {
      const window = log.filter(row => row.tick <= input.tick && input.tick - row.tick < 200);
      assert.ok(window.length <= Math.floor(HUMAN_SKILLS.hard.peak / 6));
    }
    if (scene.interrupt) assert.ok(interrupted);
    if (scene.interrupt === 'held') assert.equal(log.length, 2, 'both pressed keys finish through their real releases');
    if (scene.name === 'diagonal') {
      assert.ok(frames.some(f => f.keys.length === 2));
      assert.ok(log[1].inputStartedTick < log[0].tick);
      close(log.at(-1).camera.x, 100 + Math.ceil(90 / 3.3) * 3.3);
      close(log.at(-1).camera.z, 100 + Math.ceil(60 / 3.3) * 3.3);
      assert.ok(log.at(-1).camera.x - target.x < 3.3 && log.at(-1).camera.z - target.z < 3.3, 'only one native frame of release quantization, without endpoint snapping');
    }
    if (scene.name === 'edge-clamp') { assert.equal(h.camera.x, 0); assert.equal(h.camera.z, 0); }
  }
  return { scene, target, inputs: log, frames, paidStarts, final: pose(h.camera) };
}
const api = { createHands, queueCamera, advanceHands, interruptHands };
const results = scenes.map(scene => nativePan(api, scene));
assert.deepEqual(nativePan(api, scenes[1]), results[1], 'same authored scene and seed give the same native trace');
assert.deepEqual(HUMAN_SKILLS.hard.key, [.075, .13]);
if (process.env.AI_PAN_PROOF) await writeFile(process.env.AI_PAN_PROOF, JSON.stringify({ schema: 'ai-diagonal-pan-native-proof-v1', seed: 27, seconds: 8, diagnosticOnly: true, results }, null, 2));
console.log('Actual client camera parity: cardinal, concurrent/rotated/reverse keys, distance, quantization, clamp, interruption, budget, keyboard and projection controls passed.');
