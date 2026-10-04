// Camera detail, coarse minimap facts, stale memory and shared alert rules.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createGame, command, step, CELL, CFG, UNITS, spawnsFor, levelOf } from './shared/sim.js';
import { viewFor } from './shared/ai-view.js';
import { perceive, onScreen, cameraFootprint, HUMAN_CAMERA, startCamera, detachedCopy } from './shared/ai-perception.js';
import { chooseConcern } from './shared/ai-attention.js';
import { createRelief } from './client/relief.js';
import { deriveAlertEvents } from './shared/alert-events.js';

const map = { w: 160, h: 160, rows: Array(160).fill('.'.repeat(160)), spawns: [{ x: 20, y: 20 }, { x: 140, y: 140 }], points: [{ x: 80, y: 80 }] };
const fixture = () => {
  const game = createGame(map, ['AI', 'enemy'], false, [0, 1], [0, 1]); game.units.clear();
  game.players[0].mp = game.players[1].mp = 5000;
  command(game, 0, { t: 'buy', unit: 'rifle' }); command(game, 1, { t: 'buy', unit: 'rifle' });
  const own = [...game.units.values()].find(u => u.owner === 0), enemy = [...game.units.values()].find(u => u.owner === 1);
  Object.assign(own, { x: 210, z: 210 }); Object.assign(enemy, { x: 220, z: 210 }); game.players[0].visible.add(enemy.id);
  return { game, own, enemy, view: viewFor(game, 0, {}) };
};
const normalized = view => ({ units: [...view.units], visible: [...view.players[0].visible], sightings: view.sightings,
  minimap: view.minimap, alerts: view.alerts, ghosts: view.ghosts });
{
  const shared = { nested: [1, { value: 2 }] }, root = { first: shared, second: shared, number: -0, nan: NaN, big: 42n, absent: undefined };
  root.self = root; root.map = new Map([[shared, root]]); root.set = new Set([shared, root]);
  const result = detachedCopy(root);
  assert.deepEqual(result, structuredClone(root));
  assert.equal(result.self, result); assert.equal(result.first, result.second);
  assert.equal(result.map.get(result.first), result); assert.ok(result.set.has(result.first) && result.set.has(result));
  assert.notEqual(result.first, shared); result.first.nested[1].value = 9; assert.equal(shared.nested[1].value, 2);
  const sparse = new Array(12); sparse[4] = shared; sparse.extra = shared; sparse.self = sparse;
  Object.defineProperty(sparse, '__proto__', { enumerable: true, value: { polluted: true } });
  const copy = detachedCopy(sparse);
  assert.deepEqual(copy, structuredClone(sparse)); assert.equal(copy.length, 12);
  assert.equal(0 in copy, false); assert.equal(11 in copy, false); assert.equal(copy[4], copy.extra); assert.equal(copy.self, copy);
  assert.equal(Object.getPrototypeOf(copy), Array.prototype); assert.equal(Object.hasOwn(copy, '__proto__'), true);
  assert.equal(Array.prototype.polluted, undefined);
}
{
  const buffer = new ArrayBuffer(8), shared = { value: 7 }, date = new Date('2001-02-03');
  const graph = { shared, map: new Map([[shared, date], [date, shared]]), date, buffer, bytes: new Uint8Array(buffer), view: new DataView(buffer) };
  graph.bytes[3] = 19;
  const copy = detachedCopy(graph);
  assert.deepEqual(copy, structuredClone(graph)); assert.equal(copy.map.get(copy.shared), copy.date);
  assert.equal(copy.map.get(copy.date), copy.shared); assert.equal(copy.bytes.buffer, copy.buffer); assert.equal(copy.view.buffer, copy.buffer);
  copy.bytes[3] = 20; assert.equal(graph.bytes[3], 19);
  class Unknown { constructor(item) { this.item = item; } }
  const unknown = { shared, instance: new Unknown(shared) }, copiedUnknown = detachedCopy(unknown);
  assert.deepEqual(copiedUnknown, structuredClone(unknown)); assert.equal(copiedUnknown.instance.item, copiedUnknown.shared);
  assert.equal(Object.getPrototypeOf(copiedUnknown.instance), Object.prototype, 'native whole-graph fallback preserves its prototype semantics');
  let reads = 0;
  const getter = { before: shared, get value() { reads++; return shared; }, after: date };
  const getterCopy = detachedCopy(getter);
  assert.equal(reads, 1, 'accessor fallback never executes the getter in a discarded partial copy');
  assert.equal(getterCopy.before, getterCopy.value);
  for (const invalid of [() => 1, Symbol('value'), { nested: { f: () => 1 } }, new Map([[shared, Symbol('map value')]])])
    assert.throws(() => detachedCopy(invalid), { name: 'DataCloneError' }, 'unsupported functions and symbol values retain native rejection');
}
{
  const data = Object.create(null); data.value = { n: 1 };
  Object.defineProperty(data, '__proto__', { enumerable: true, value: { polluted: true } });
  Object.defineProperty(data, 'readonly', { enumerable: true, value: 3 });
  Object.defineProperty(data, 'hidden', { value: () => 1 }); data[Symbol('ignored key')] = () => 2;
  const result = detachedCopy(data);
  assert.deepEqual(result, structuredClone(data)); assert.equal(Object.getPrototypeOf(result), Object.prototype);
  assert.equal(Object.hasOwn(result, '__proto__'), true); assert.equal(Object.prototype.polluted, undefined);
  result.readonly = 4; assert.equal(result.readonly, 4, 'copies have native writable data-property semantics');
  const map = new Map([[data, data]]); map[Symbol.iterator] = () => { throw new Error('not the native iterator'); };
  const set = new Set([data]); set[Symbol.iterator] = () => { throw new Error('not the native iterator'); };
  assert.deepEqual(detachedCopy({ map, set }), structuredClone({ map, set }), 'collection internals ignore custom iterator properties just like native cloning');
}
{
  const { view, own } = fixture();
  Object.assign(view.units.get(own.id), { path: [{ x: 211, z: 212, payload: { value: 7 } }], queue: ['rifle'], rally: { x: 213, z: 214 } });
  const event = { id: 'detach-event', kind: 'base', source: 'alert', tick: 0, x: 210, z: 210, payload: { values: [1, 2] } };
  const state = { camera: { x: 210, z: 210 }, events: [structuredClone(event)] }, perceived = perceive(view, 0, state);
  const screen = perceived.units.get(own.id), memory = state.screenMemory.get(own.id);
  screen.path[0].payload.value = 8; screen.queue.push('tank'); screen.rally.x = 99;
  assert.equal(view.units.get(own.id).path[0].payload.value, 7); assert.equal(memory.path[0].payload.value, 7);
  assert.deepEqual(memory.queue, ['rifle']); assert.equal(memory.rally.x, 213);
  memory.path[0].payload.value = 11; assert.equal(screen.path[0].payload.value, 8);
  perceived.events[0].payload.values.push(3); assert.deepEqual(state.events[0].payload.values, [1, 2]);
  view.players[0].spawn.x = 999; view.players[0].sup.artillery = 999;
  assert.notEqual(perceived.players[0].spawn.x, 999); assert.notEqual(perceived.players[0].sup.artillery, 999);
  state.camera = { x: 40, z: 40 };
  const recalled = perceive({ ...view, tick: 20 }, 0, state).units.get(own.id);
  recalled.path[0].payload.value = 12; assert.equal(memory.path[0].payload.value, 11, 'recalled detail is detached from persistent memory too');
}
{
  // Exercise the immediate screen-to-memory copy through perception, including native fallback.
  const copyThroughScreen = payload => {
    const { view, own } = fixture(), state = { camera: { x: 210, z: 210 } };
    view.units.get(own.id).copyProof = payload;
    const perceived = perceive(view, 0, state), screen = perceived.units.get(own.id), memory = state.screenMemory.get(own.id);
    assert.deepEqual(memory, structuredClone(screen), 'the private second copy retains native whole-graph semantics');
    assert.notEqual(screen.copyProof, payload); assert.notEqual(memory.copyProof, screen.copyProof);
    return { view, own, state, screen, memory };
  };
  const shared = { value: 2 }, cycle = { first: shared, second: shared };
  cycle.self = cycle; cycle.map = new Map([[shared, cycle]]); cycle.set = new Set([shared, cycle]);
  const copied = copyThroughScreen(cycle), screen = copied.screen.copyProof, memory = copied.memory.copyProof;
  assert.equal(memory.first, memory.second); assert.equal(memory.self, memory);
  assert.equal(memory.map.get(memory.first), memory); assert.ok(memory.set.has(memory.first) && memory.set.has(memory));
  screen.first.value = 9; assert.equal(memory.first.value, 2); assert.equal(shared.value, 2);
  memory.first.value = 11; assert.equal(screen.first.value, 9);

  const sparse = new Array(12); sparse[4] = { value: 2 }; sparse.extra = sparse[4]; sparse.self = sparse;
  Object.defineProperty(sparse, '__proto__', { enumerable: true, value: { polluted: true } });
  const sparseCopy = copyThroughScreen(sparse);
  assert.equal(sparseCopy.memory.copyProof.length, 12); assert.equal(0 in sparseCopy.memory.copyProof, false);
  assert.equal(11 in sparseCopy.memory.copyProof, false); assert.equal(sparseCopy.memory.copyProof[4], sparseCopy.memory.copyProof.extra);
  assert.equal(sparseCopy.memory.copyProof.self, sparseCopy.memory.copyProof);
  assert.equal(Object.getPrototypeOf(sparseCopy.memory.copyProof), Array.prototype);
  assert.ok(Object.hasOwn(sparseCopy.memory.copyProof, '__proto__')); assert.equal(Array.prototype.polluted, undefined);
  sparseCopy.screen.copyProof[4].value = 9; assert.equal(sparseCopy.memory.copyProof[4].value, 2);

  const buffer = new ArrayBuffer(8), date = new Date('2001-02-03'), item = { value: 2 };
  const fallback = copyThroughScreen({ item, date, buffer, bytes: new Uint8Array(buffer), data: new DataView(buffer),
    map: new Map([[item, date], [date, item]]) });
  const native = fallback.memory.copyProof;
  assert.equal(native.bytes.buffer, native.buffer); assert.equal(native.data.buffer, native.buffer);
  assert.equal(native.map.get(native.item), native.date); assert.equal(native.map.get(native.date), native.item);
  fallback.screen.copyProof.bytes[3] = 19; assert.equal(native.bytes[3], 0); assert.equal(new Uint8Array(buffer)[3], 0);

  let deliveredReads = 0;
  const accessor = copyThroughScreen({ before: item, get value() { deliveredReads++; return item; }, after: date });
  assert.equal(deliveredReads, 1, 'delivered accessors run once; the fresh second copy consumes their data-property result');
  assert.equal(accessor.memory.copyProof.before, accessor.memory.copyProof.value);
  // Public retained memory can acquire getters or unsupported values after the fresh-copy interval ends.
  let retainedReads = 0;
  Object.defineProperty(copied.memory, 'copyGetter', { enumerable: true, get() { retainedReads++; return this.copyProof; } });
  copied.state.camera = { x: 40, z: 40 };
  const recalled = perceive({ ...copied.view, tick: 20 }, 0, copied.state).units.get(copied.own.id);
  assert.equal(retainedReads, 1, 'later mutable memory retains descriptor validation and native accessor behavior');
  assert.equal(recalled.copyGetter, recalled.copyProof); assert.notEqual(recalled.copyProof, copied.memory.copyProof);
  copied.memory.copyInvalid = { callback: () => 1 };
  assert.throws(() => perceive({ ...copied.view, tick: 40 }, 0, copied.state), { name: 'DataCloneError' },
    'mutable retained memory never enters the private fresh-copy path');
  for (const payload of [{ nested: { callback: () => 1 } }, new Map([[item, Symbol('value')]])]) {
    const { view, own } = fixture(); view.units.get(own.id).copyProof = payload;
    assert.throws(() => perceive(view, 0, { camera: { x: 210, z: 210 } }), { name: 'DataCloneError' },
      'delivered unsupported values still reject before the second copy');
  }
}
{
  const { view } = fixture(), defaults = startCamera(view, 0), state = {};
  assert.equal(HUMAN_CAMERA.distance, 60); assert.equal(HUMAN_CAMERA.panSpeed, 66);
  assert.equal(defaults.distance, 60); assert.deepEqual({ x: defaults.x, z: defaults.z }, view.players[0].spawn);
  assert.equal(defaults.yaw, Math.atan2(defaults.x - view.w * CELL / 2, defaults.z - view.h * CELL / 2));
  perceive(view, 0, state); assert.deepEqual(state.camera, defaults, 'perception starts at the seat spawn facing the centre at actual match zoom');
  for (const [x, z] of [[0, 0], [320, 0], [0, 320], [320, 320]]) {
    const observation = { w: 160, h: 160, players: [{ spawn: { x, z } }] }, pose = startCamera(observation, 0);
    const camera = new THREE.PerspectiveCamera(42, 1920 / 1080, 1, 2200);
    camera.position.set(x + 60 * Math.cos(.95) * Math.sin(pose.yaw), 60 * Math.sin(.95), z + 60 * Math.cos(.95) * Math.cos(pose.yaw));
    camera.lookAt(x, 0, z); camera.updateMatrixWorld();
    for (let dx = -80; dx <= 80; dx += 3.9) for (let dz = -65; dz <= 65; dz += 4.1) {
      const p = new THREE.Vector3(x + dx, 1, z + dz).project(camera);
      assert.equal(onScreen({ x: x + dx, z: z + dz }, pose), p.z >= -1 && p.z <= 1 && Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1,
        'all seat-facing start poses match the real Three perspective viewport');
    }
  }
}
{
  const { view, enemy } = fixture(), altered = structuredClone({ ...view, sees: undefined }); altered.sees = view.sees;
  altered.units.get(enemy.id).hp = 1; altered.units.get(enemy.id).type = 'mg';
  altered.sightings = [{ id: enemy.id, type: 'tiger', owner: 1, x: 210, z: 210, t: 0, val: 10000 }];
  const far = { camera: { x: 40, z: 40 } }, a = perceive(view, 0, structuredClone(far)), b = perceive(altered, 0, structuredClone(far));
  assert.deepEqual(normalized(a), normalized(b), 'off-camera health and exact type within the same minimap class cannot leak');
  assert.equal(a.units.has(enemy.id), false); assert.equal(a.players[0].visible.size, 0); assert.equal(a.sightings.length, 0);
  assert.equal(a.snapshot, undefined); assert.equal('type' in a.minimap.find(dot => dot.owner === 1), false);
  assert.equal('hp' in a.minimap.find(dot => dot.owner === 1), false);
  assert.equal('id' in a.minimap.find(dot => dot.owner === 1), false, 'enemy minimap dots cannot expose stable identities');
  const near = { camera: { x: 210, z: 210 } };
  assert.notDeepEqual(normalized(perceive(view, 0, structuredClone(near))), normalized(perceive(altered, 0, structuredClone(near))), 'on-camera changes do alter detailed perception');
  altered.units.get(enemy.id).type = 'tank';
  assert.notDeepEqual(perceive(view, 0, structuredClone(far)).minimap, perceive(altered, 0, structuredClone(far)).minimap, 'vehicle dot size is a real minimap fact');
  const concernA = chooseConcern(a, 0, {}, 'hard', () => 0.5), concernB = chooseConcern(b, 0, {}, 'hard', () => 0.5);
  assert.deepEqual(concernA, concernB, 'attention is invariant to hidden detail');
}
{
  const { view, enemy, own } = fixture(), state = { camera: { x: 210, z: 210 } };
  const first = perceive(view, 0, state), old = first.units.get(enemy.id), oldOwn = first.units.get(own.id);
  const altered = { ...view, tick: 200, units: new Map([...view.units].map(([id, u]) => [id, structuredClone(u)])) };
  altered.units.get(enemy.id).hp = 1; altered.units.get(enemy.id).type = 'mg';
  altered.units.get(own.id).hp = 1; altered.units.get(own.id).cd = 0; state.camera = { x: 40, z: 40 };
  const remembered = perceive(altered, 0, state);
  assert.equal(remembered.units.get(enemy.id).hp, old.hp); assert.equal(remembered.units.get(enemy.id).type, old.type);
  assert.equal(remembered.units.get(own.id).hp, oldOwn.hp); assert.equal(remembered.units.get(own.id).cd, oldOwn.cd);
  assert.equal(remembered.units.get(enemy.id).lastSeen, 0); assert.ok(remembered.units.get(enemy.id).confidence < 1);
  assert.equal(remembered.players[0].visible.size, 0);
  const expired = perceive({ ...altered, tick: 1220 }, 0, state);
  assert.equal(expired.units.has(enemy.id), false, 'enemy detail expires after sixty seconds');
  assert.equal(expired.units.get(own.id).inventoryOnly, true, 'own static identity persists without fresh readiness');
  assert.equal(expired.units.get(own.id).cd, Infinity);
  state.camera = { x: 210, z: 210 };
  const refreshed = perceive({ ...altered, tick: 1240 }, 0, state);
  // A living one-HP enemy supplies the smallest positive world-bar estimate, not its exact hidden HUD health.
  assert.equal(refreshed.units.get(enemy.id).hp, UNITS.mg.models * UNITS.mg.hpPer / 20);
  assert.equal(refreshed.units.get(enemy.id).exactHPKnown, false);
  assert.equal(refreshed.units.get(enemy.id).hpSource, 'world-bar');
  assert.equal(refreshed.units.get(enemy.id).lastSeen, 62);
  assert.equal(refreshed.units.get(enemy.id).firstStillAt, 62, 'off-camera stationary history cannot leak into a fresh screen look');
}
{
  const { view, enemy } = fixture(), state = { camera: { x: 210, z: 210 } };
  perceive(view, 0, state); state.camera = { x: 40, z: 40 };
  const empty = { ...view, tick: 20, units: new Map([...view.units].filter(([id]) => id !== enemy.id)), sees: () => true };
  assert.equal(perceive(empty, 0, state).units.has(enemy.id), true, 'team seeing empty ground off-camera does not invalidate detail');
  state.camera = { x: 210, z: 210 };
  assert.equal(perceive({ ...empty, tick: 40 }, 0, state).units.has(enemy.id), false, 'looking at empty visible ground does invalidate detail');
}
{
  const camera = new THREE.PerspectiveCamera(HUMAN_CAMERA.fov, HUMAN_CAMERA.width / HUMAN_CAMERA.height, 1, 2200);
  const target = { x: 120, z: 100 };
  camera.position.set(target.x, HUMAN_CAMERA.distance * Math.sin(HUMAN_CAMERA.pitch), target.z + HUMAN_CAMERA.distance * Math.cos(HUMAN_CAMERA.pitch));
  camera.lookAt(target.x, 0, target.z); camera.updateMatrixWorld();
  for (let z = -100; z <= 300; z += 2.7) for (let x = -100; x <= 300; x += 3.1) {
    const point = new THREE.Vector3(x, HUMAN_CAMERA.markerHeight, z).project(camera);
    const actual = point.z >= -1 && point.z <= 1 && Math.abs(point.x) <= 1 && Math.abs(point.y) <= 1;
    assert.equal(onScreen({ x, z }, target), actual, 'AI detail matches the default client perspective projection');
  }
  const corners = cameraFootprint(target);
  assert.equal(corners.length, 4); assert.ok(corners[1].x - corners[0].x > corners[2].x - corners[3].x, 'perspective footprint is a trapezoid');
  for (const [i, [nx, ny]] of [[-1, 1], [1, 1], [1, -1], [-1, -1]].entries()) {
    const ray = new THREE.Ray(camera.position.clone(), new THREE.Vector3(nx, ny, .5).unproject(camera).sub(camera.position).normalize());
    const actual = ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
    assert.ok(Math.hypot(actual.x - corners[i].x, actual.z - corners[i].z) < 1e-9, 'camera footprint corners equal actual client ray intersections');
  }
  const main = readFileSync(new URL('./client/main.js', import.meta.url), 'utf8'), rig = readFileSync(new URL('./client/camera.js', import.meta.url), 'utf8');
  assert.match(main, /PerspectiveCamera\(42,/); assert.match(main, /const AIR_ALT = 20/); assert.match(main, /hAt\(v.x, v.z\) \+ 1/); assert.match(main, /PITCH = 0\.95/); assert.match(main, /cam\.yaw = Math\.atan2\(sx - MW \/ 2, sz - MH \/ 2\); cam\.dist = 60/);
  assert.match(rig, /cam\.dist \* 1\.1 \* dt \* PAN\[speed\]/); assert.ok(Math.abs(HUMAN_CAMERA.panSpeed - 60 * 1.1) < 1e-9);
}
{
  // The real client terrain builder supplies the reference heights, including its ramps and trenches.
  const hill = JSON.parse(readFileSync(new URL('./maps/hill-112.json', import.meta.url), 'utf8'));
  const material = new THREE.MeshBasicMaterial(), relief = createRelief(hill, hill.rows, { material });
  const slots = spawnsFor(hill, 'conquest').length;
  const game = createGame(hill, Array(slots).fill('AI'), true, Array.from({ length: slots }, (_, i) => i), Array.from({ length: slots }, (_, i) => i % 3));
  const observation = viewFor(game, 0, {}), target = { x: hill.w * CELL / 2, z: hill.h * CELL / 2 };
  const focusHeight = relief.hAt(target.x, target.z), camera = new THREE.PerspectiveCamera(42, 1920 / 1080, 1, 2200);
  assert.equal(focusHeight, 2 * CFG.levelHeight, 'the actual hill surface uses 2.5 metres per elevation level');
  camera.position.set(target.x, focusHeight + HUMAN_CAMERA.distance * Math.sin(.95), target.z + HUMAN_CAMERA.distance * Math.cos(.95));
  camera.lookAt(target.x, focusHeight, target.z); camera.updateMatrixWorld();
  let checked = 0, detailed = 0, fringeExcluded = 0, elevated = 0;
  for (let z = 0; z < hill.h * CELL; z += 1.7) for (let x = 0; x < hill.w * CELL; x += 1.9) {
    const height = relief.hAt(x, z), projected = new THREE.Vector3(x, height + 1, z).project(camera);
    const actual = projected.z >= -1 && projected.z <= 1 && Math.abs(projected.x) <= 1 && Math.abs(projected.y) <= 1;
    const ai = onScreen({ x, z }, target, observation); checked++;
    if (height > 0) elevated++;
    if (ai) { detailed++; assert.equal(actual, true, 'conservative AI viewport never includes a marker outside the real hill client viewport'); }
    else if (actual) fringeExcluded++;
  }
  assert.ok(elevated > 1000 && detailed > 1000 && checked > 10000);
  assert.ok(fringeExcluded > 0 && fringeExcluded / detailed < 0.1, 'uncertain hill fringe stays coarse instead of leaking detail');
  assert.equal(onScreen(target, target, observation), true, 'the elevated screen centre remains detailed');
  // Aircraft use the same 20 m model altitude as client/main.js screenOf.
  const plane = { x: target.x, z: target.z, type: 'fighter' };
  const projectedPlane = new THREE.Vector3(plane.x, relief.hAt(plane.x, plane.z) + 21, plane.z).project(camera);
  assert.equal(onScreen(plane, target, observation), Math.abs(projectedPlane.x) <= 1 && Math.abs(projectedPlane.y) <= 1);
  const template = [...observation.units.values()][0], contact = { ...structuredClone(template), id: 100000, owner: 1, type: 'rifle', x: target.x, z: target.z, hp: 100 };
  const ordinary = { ...observation, units: new Map([[contact.id, contact]]) };
  const perturbed = { ...ordinary, units: new Map([[contact.id, { ...contact, hp: 1, type: 'mg' }]]) };
  assert.notDeepEqual(normalized(perceive(ordinary, 0, { camera: { ...target } })), normalized(perceive(perturbed, 0, { camera: { ...target } })),
    'actual elevated on-camera detail changes are a negative control');
  const away = { x: 10, z: 10 };
  assert.deepEqual(normalized(perceive(ordinary, 0, { camera: { ...away } })), normalized(perceive(perturbed, 0, { camera: { ...away } })),
    'the same elevated contact changes stay hidden outside the camera');
  relief.dispose(); material.dispose();
}
{
  // Roads and trenches lower the same vertex. Test the small fringe their combined cut creates.
  const w = 128, h = 128, rows = Array(h).fill('.'.repeat(w));
  rows[80] = '.'.repeat(64) + 'T' + '.'.repeat(63);
  const terrain = { w, h, rows }, material = new THREE.MeshBasicMaterial();
  const relief = createRelief(terrain, rows, { material, isRoad: (x, z) => x === 64 && z === 80 });
  const point = { x: 129, z: 161 }, forward = cameraFootprint({ x: 0, z: 0 })[2].z + .01;
  const target = { x: point.x, z: point.z - forward }, focus = relief.hAt(target.x, target.z);
  const camera = new THREE.PerspectiveCamera(42, 1920 / 1080, 1, 2200);
  camera.position.set(target.x, focus + HUMAN_CAMERA.distance * Math.sin(.95), target.z + HUMAN_CAMERA.distance * Math.cos(.95));
  camera.lookAt(target.x, focus, target.z); camera.updateMatrixWorld();
  assert.equal(relief.hAt(point.x, point.z), -1, 'the actual renderer adds .1 m road lowering to the .9 m trench cut');
  const projected = new THREE.Vector3(point.x, relief.hAt(point.x, point.z) + 1, point.z).project(camera);
  assert.ok(projected.y < -1, 'the real lowered marker lies just outside the human viewport');
  assert.equal(onScreen(point, target, { w, h, height: Array(w * h).fill(0), chars: rows.join('').split('') }), false,
    'the full road and trench cut must stay in the conservative height envelope');
  relief.dispose(); material.dispose();
}
{
  // Use the checked-out renderer so the natural-hill merge changes the reference surface too.
  const realMaps = ['hill-112', 'crater-field', 'pegasus-bridge'].map(name =>
    JSON.parse(readFileSync(new URL(`./maps/${name}.json`, import.meta.url), 'utf8')));
  const w = 64, h = 64;
  const synthetic = (name, heightAt) => ({ name, w, h,
    rows: Array.from({ length: h }, (_, z) => Array.from({ length: w }, (_, x) =>
      x % 19 === 0 ? 'T' : z % 23 === 0 ? 'R' : '.').join('')),
    heights: Array.from({ length: h }, (_, z) => Array.from({ length: w }, (_, x) => String(heightAt(x, z))).join('')) });
  const syntheticMaps = [
    synthetic('rising hills and crests', (x, z) => Math.min(4, Math.floor((16 - Math.abs(x % 32 - 16)) / 4) + Math.floor(z / 32))),
    synthetic('saddle', (x, z) => Math.max(0, Math.min(4, 2 + Math.floor((Math.abs(x - 32) - Math.abs(z - 32)) / 8)))),
    synthetic('cliff and plateau', (x, z) => x < 29 ? Math.floor(z / 32) : 4),
  ];
  let checked = 0, detailed = 0, fringe = 0, surfaceChecked = 0;
  for (const terrain of [...realMaps, ...syntheticMaps]) {
    const material = new THREE.MeshBasicMaterial();
    const relief = createRelief(terrain, terrain.rows, { material, isRoad: x => x % 11 === 0 });
    const observation = { w: terrain.w, h: terrain.h,
      height: Array.from({ length: terrain.w * terrain.h }, (_, c) => levelOf(terrain.heights?.[Math.floor(c / terrain.w)]?.[c % terrain.w] ?? '0')),
      chars: terrain.rows.join('').split('') };
    if (syntheticMaps.includes(terrain)) {
      for (let z = .13; z < terrain.h * CELL; z += 1.63) for (let x = .17; x < terrain.w * CELL; x += 1.91) {
        const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL), levels = [];
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
          const xx = Math.max(0, Math.min(terrain.w - 1, cx + dx)), zz = Math.max(0, Math.min(terrain.h - 1, cz + dz));
          levels.push(observation.height[zz * terrain.w + xx] * CFG.levelHeight);
        }
        const actualHeight = relief.hAt(x, z); surfaceChecked++;
        assert.ok(actualHeight >= Math.min(...levels) - 1.25 - 1e-5 && actualHeight <= Math.max(...levels) + 1e-5,
          `${terrain.name}: real hills, cliff controls, roads and cuts retain the local 3x3 height envelope`);
      }
    }
    for (const yaw of [-Math.PI, -Math.PI / 2, 0, .7, Math.PI / 2, Math.PI]) for (const [rx, rz] of [[.5, .5], [.31, .37], [.73, .61]]) {
      const target = { x: terrain.w * CELL * rx, z: terrain.h * CELL * rz, yaw }, focus = relief.hAt(target.x, target.z);
      const camera = new THREE.PerspectiveCamera(HUMAN_CAMERA.fov, HUMAN_CAMERA.width / HUMAN_CAMERA.height, 1, 2200);
      camera.position.set(target.x + HUMAN_CAMERA.distance * Math.cos(.95) * Math.sin(yaw), focus + HUMAN_CAMERA.distance * Math.sin(.95), target.z + HUMAN_CAMERA.distance * Math.cos(.95) * Math.cos(yaw));
      camera.lookAt(target.x, focus, target.z); camera.updateMatrixWorld();
      for (let z = Math.max(0, target.z - 80); z < Math.min(terrain.h * CELL, target.z + 65); z += 2.37) {
        for (let x = Math.max(0, target.x - 100); x < Math.min(terrain.w * CELL, target.x + 100); x += 2.71) {
          const ground = relief.hAt(x, z);
          for (const type of ['rifle', 'fighter']) {
            const point = new THREE.Vector3(x, ground + HUMAN_CAMERA.markerHeight + (UNITS[type].air ? HUMAN_CAMERA.aircraftAltitude : 0), z).project(camera);
            const actual = point.z >= -1 && point.z <= 1 && Math.abs(point.x) <= 1 && Math.abs(point.y) <= 1;
            const detail = onScreen({ x, z, type }, target, observation); checked++;
            if (detail) {
              detailed++;
              assert.equal(actual, true, `${terrain.name}: ground and aircraft detail must fit the actual client terrain and camera`);
            } else if (actual) fringe++;
          }
        }
      }
    }
    relief.dispose(); material.dispose();
  }
  assert.ok(checked > 100000 && surfaceChecked > 10000 && detailed > 10000);
  assert.ok(fringe > 0 && fringe / detailed < .15, 'terrain uncertainty excludes a small fringe while preserving useful detail');
}
{
  const row = (id, type, owner, x, z, hp = 100, flags = 0, built = 1) => [id, type, owner, x, z, 0, 0, hp, 0, 0, 0, 0, flags, 0, built];
  const previous = { tick: 0, winner: null, units: [row(1, 'rifle', 0, 210, 210), row(2, 'rifle', 0, 215, 210), row(3, 'hq', 0, 40, 40)],
    points: [[0, -1, 100]], queues: [], strikes: [] };
  const snapshot = { ...previous, tick: 20, units: [row(1, 'rifle', 0, 210, 210, 50), row(3, 'hq', 0, 40, 40)], points: [[1, -1, 100]], shots: [{ t: 1, fo: 1 }, { t: 2, kill: true, fo: 1 }] };
  const hooks = { me: () => 0, team: () => 0, friend: owner => owner === 0, unitName: type => UNITS[type].name,
    playerName: owner => 'enemy', pointPos: () => ({ x: 160, z: 160 }), home: () => ({ x: 40, z: 40 }), onScreen: () => false };
  const events = deriveAlertEvents(snapshot, previous, hooks, {});
  assert.deepEqual(events.map(event => event.kind), ['attack', 'pointLost', 'unitLost']);
  const state = {};
  assert.equal(deriveAlertEvents(snapshot, previous, hooks, state).length, 3);
  assert.deepEqual(deriveAlertEvents(snapshot, previous, hooks, state), [], 'retained snapshots never repeat alerts');
  const fixtureView = fixture().view;
  fixtureView.points = [{ x: 160, z: 160, owner: 0 }]; fixtureView.players[0].spawn = { x: 40, z: 40 };
  const humanState = { camera: { x: 40, z: 40 } };
  perceive({ ...fixtureView, tick: 0, snapshot: previous }, 0, humanState);
  const ai = perceive({ ...fixtureView, tick: 20, snapshot }, 0, humanState);
  assert.deepEqual(ai.newAlerts, events, 'AI uses the same semantic event detector as the human client');
  assert.match(readFileSync(new URL('./client/alerts.js', import.meta.url), 'utf8'), /deriveAlertEvents\(s, prev/);
  const ownShot = { ...snapshot, points: previous.points, units: previous.units.map(u => u[0] === 1 ? row(1, 'rifle', 0, 210, 210, 50) : u), shots: [{ t: 1, fo: 0 }] };
  assert.deepEqual(deriveAlertEvents(ownShot, previous, hooks, {}), [], 'friendly fire does not raise attack alerts');
  const looking = { ...hooks, onScreen: () => true };
  assert.equal(deriveAlertEvents(snapshot, previous, looking, {}).some(event => event.kind === 'attack'), false);
}
{
  const { view } = fixture(), perceived = perceive(view, 0, { camera: { x: 210, z: 210 } }), state = {};
  const first = chooseConcern(perceived, 0, state, 'easy', () => 0.5);
  assert.ok(state.concerns.length <= 2);
  assert.equal(chooseConcern({ ...perceived, tick: 1 }, 0, state, 'easy', () => 0.5).id, first.id, 'attention dwells before switching');
  perceived.events.push({ id: 'emergency', kind: 'base', source: 'alert', onScreen: false, x: 40, z: 40, tick: 2 });
  assert.equal(chooseConcern({ ...perceived, tick: 2 }, 0, state, 'easy', () => 0.5).id, 'alert:emergency', 'base danger can interrupt dwell');
}
{
  const game = createGame(map, ['builder', 'enemy'], false, [0, 1], [0, 1], { mode: 'classic', weather: false, supply: false });
  const engineer = [...game.units.values()].find(unit => unit.owner === 0 && unit.type === 'engineer');
  game.players[0].mp = 5000;
  const goal = { x: game.players[0].spawn.x + 12, z: game.players[0].spawn.z + 12 };
  assert.equal(command(game, 0, { t: 'dig', ids: [engineer.id], ...goal }), undefined);
  assert.ok(engineer.dig, 'an actual Engineer order is in progress');
  const node = { x: goal.x + 6, z: goal.z + 6, rate: 2.5 };
  const inspect = () => {
    const perceived = perceive(viewFor(game, 0, {}), 0, { camera: { x: engineer.x, z: engineer.z, yaw: 0 } });
    perceived.events = []; perceived.points = []; perceived.players[0].mp = 0; perceived.players[0].sup = {};
    perceived.nodes = [node]; perceived.claimedNodes = new Set();
    return perceived;
  };
  const busy = inspect(), before = {};
  chooseConcern(busy, 0, before, 'hard', () => .5);
  assert.equal(before.concerns.some(concern => concern.id === `idle:${engineer.id}`), false, 'an Engineer executing a real dig order is not idle');
  assert.equal(before.concerns.some(concern => concern.id === 'node:0'), false, 'a visibly working Engineer cannot be assigned another expansion concern');
  for (let i = 0; i < 600 && engineer.dig; i++) step(game);
  assert.equal(engineer.dig, null, 'the actual simulation completes the dig order');
  const complete = inspect(), after = {};
  chooseConcern(complete, 0, after, 'hard', () => .5);
  assert.ok(after.concerns.some(concern => concern.id === `idle:${engineer.id}`), 'completed work permits an idle concern again');
  assert.ok(after.concerns.some(concern => concern.id === 'node:0' && concern.unitId === engineer.id), 'completed work permits a known expansion assignment again');
  for (const fields of [{ attackId: 4 }, { fireAt: 42 }, { nade: { x: goal.x, z: goal.z } }, { entrench: { jobs: [] } },
    { enter: 42 }, { path: [{ x: goal.x, z: goal.z }] }, { build: 42 }]) {
    const active = { ...complete, units: new Map([...complete.units].map(([id, unit]) => [id, { ...structuredClone(unit), ...(id === engineer.id && fields) }])) };
    const memory = {}; chooseConcern(active, 0, memory, 'hard', () => .5);
    assert.equal(memory.concerns.some(concern => concern.id === `idle:${engineer.id}` || concern.id === 'node:0'), false,
      'every currently observed ordinary action blocks idle and expansion assignment');
  }
}
{
  const { view, own } = fixture(), perceived = perceive(view, 0, { camera: { x: 210, z: 210 } });
  perceived.mode = { kind: 'classic' }; perceived.units.get(own.id).type = 'engineer';
  perceived.minimap = perceived.minimap.filter(dot => dot.owner === 0); perceived.players[0].mp = 0; perceived.events = []; perceived.newEvents = [];
  perceived.nodes = [{ x: 240, z: 210, rate: 2.5 }]; perceived.claimedNodes = new Set();
  const building = chooseConcern(perceived, 0, {}, 'normal', () => 0.5);
  assert.equal(building.id, 'node:0'); assert.equal(building.unitId, own.id, 'economy attention follows the engineer assigned to a known depot site');
  perceived.mode = { kind: 'world' }; perceived.nodes = []; perceived.world = { regions: [] }; perceived.points = [];
  perceived.units.get(own.id).type = 'rifle'; perceived.chars = Array(view.w * view.h).fill('?');
  const scouting = chooseConcern(perceived, 0, {}, 'normal', () => 0.5);
  assert.equal(scouting.kind, 'scouting'); assert.equal(scouting.unitId, own.id, 'World exploration works without a hidden enemy home');
}
{
  const { view, enemy } = fixture(), state = { camera: { x: 210, z: 210 } };
  const contacts = perceived => perceived.newEvents.filter(event => event.kind === 'screen-contact');
  assert.equal(contacts(perceive(view, 0, state)).length, 1);
  state.camera = { x: 40, z: 40 }; perceive({ ...view, tick: 20 }, 0, state);
  state.camera = { x: 210, z: 210 };
  assert.equal(contacts(perceive({ ...view, tick: 30 }, 0, state)).length, 0, 'camera reentry within ten seconds is a known contact');
  const empty = { ...view, tick: 40, units: new Map([...view.units].filter(([id]) => id !== enemy.id)), sees: () => true };
  perceive(empty, 0, state); assert.equal(state.screenMemory.has(enemy.id), false);
  assert.equal(contacts(perceive({ ...view, tick: 50 }, 0, state)).length, 0, 'empty-ground invalidation cannot erase a recent screen-contact debounce');
  state.camera = { x: 40, z: 40 }; perceive({ ...view, tick: 60 }, 0, state);
  state.camera = { x: 210, z: 210 };
  assert.equal(contacts(perceive({ ...view, tick: 250 }, 0, state)).length, 1, 'a contact returns after ten seconds without being seen');
}
{
  const { view, own } = fixture(), plane = { ...structuredClone(own), type: 'attacker', flags: 512, x: -40, z: -40, air: { state: 'base', ammo: 999 } };
  const station = { ...plane, id: own.id + 100, flags: 0, air: { state: 'station' } }, rearming = { ...plane, id: own.id + 101 };
  const observation = { ...view, units: new Map([[plane.id, plane], [station.id, station], [rearming.id, rearming]]),
    snapshot: { ...view.snapshot, air: [[plane.id, 0, 999, 999, 999], [station.id, 2, 17, 999, 999], [rearming.id, 4, 999, 999, 11]] } };
  const state = { camera: { x: -40, z: -40, yaw: 0 } }, perceived = perceive(observation, 0, state);
  assert.equal(perceived.screenIds.has(plane.id), false, 'the client hides parked plane models and health bars even inside the camera frustum');
  assert.deepEqual(perceived.airPanel, [{ id: plane.id, type: 'attacker', state: 'base' },
    { id: station.id, type: 'attacker', state: 'station', fuel: 17 }, { id: rearming.id, type: 'attacker', state: 'rearm', timer: 11 }],
    'air panel exposes exactly current client button labels, not hidden ammo or aircraft health');
  perceived.events = []; perceived.points = []; perceived.players[0].mp = 0; perceived.players[0].sup = {};
  const memory = {}, first = chooseConcern(perceived, 0, memory, 'normal', () => .5);
  assert.equal(first.id, `air:${plane.id}`); assert.equal(first.panel, 'air'); assert.equal(first.kind, 'production');
  assert.deepEqual({ x: first.x, z: first.z }, view.players[0].spawn, 'parked planes are a panel task at home, not an off-map camera target');
  chooseConcern({ ...perceived, tick: 400 }, 0, memory, 'normal', () => .5);
  assert.equal(memory.concerns.some(concern => concern.id.startsWith('idle:')), false, 'stationary parked or flying aircraft never raise ground-unit idle concerns');
  assert.equal(state.screenMemory.has(plane.id), false); assert.equal(perceived.units.get(plane.id).inventoryOnly, true);
}
{
  const { view, own } = fixture(), event = perceive(view, 0, { camera: { x: 210, z: 210 } }).newEvents.find(event => event.kind === 'screen-contact');
  assert.equal(event.responsePolicy, 'screen-v1'); assert.equal(event.responseRequired, true); assert.equal(event.responseReason, 'idle-combat-contact');
  assert.deepEqual(event.responseUnits, [own.id]);
  const busy = { ...view, units: new Map([...view.units].map(([id, unit]) => [id, { ...structuredClone(unit), ...(id === own.id && { path: [{ x: 240, z: 240 }] }) }])) };
  const monitoring = perceive(busy, 0, { camera: { x: 210, z: 210 } }).newEvents.find(event => event.kind === 'screen-contact');
  assert.equal(monitoring.responseRequired, false); assert.equal(monitoring.responseReason, 'monitoring-contact'); assert.deepEqual(monitoring.responseUnits, []);
  const state = { camera: { x: 210, z: 210 } };
  const hurt = (tick, hp, fields = {}) => ({ ...view, tick, units: new Map([...view.units].map(([id, unit]) => [id, { ...structuredClone(unit), ...(id === own.id && { hp, autoRetreat: false, ...fields }) }])) });
  perceive(hurt(0, 40), 0, state);
  const small = perceive(hurt(10, 39), 0, state).newEvents.find(event => event.kind === 'screen-damage');
  assert.equal(small.responseRequired, false); assert.equal(small.responseReason, 'monitoring-damage');
  const risk = perceive(hurt(20, 34), 0, state).newEvents.find(event => event.kind === 'screen-damage');
  assert.equal(risk.responseRequired, true); assert.equal(risk.responseReason, 'retreat-risk-crossing'); assert.deepEqual(risk.responseUnits, [own.id]);
  assert.equal(risk.episode, small.episode, 'meaningful risk crossing is reported within a continuous damage episode');
  const retreat = perceive(hurt(30, 5, { retreating: true, flags: 1 }), 0, state).newEvents.find(event => event.kind === 'screen-damage');
  assert.equal(retreat.responseRequired, false); assert.equal(retreat.responseReason, 'already-retreating');
  assert.ok(state.events.some(event => event.id === small.id), 'monitoring events remain in the all-stimuli population');
}
{
  const { game, view, own } = fixture(), state = { camera: { x: own.x, z: own.z } };
  perceive(view, 0, state); own.hp = 30; game.tick = 1;
  const covered = perceive(viewFor(game, 0, {}), 0, state).newEvents.find(event => event.kind === 'screen-damage');
  assert.equal(covered.responseRequired, false); assert.equal(covered.responseReason, 'auto-retreat-enabled');
  step(game);
  assert.equal(own.retreating, true, 'the actual simulation begins retreat on its next step without a human command');
  assert.equal(own.targetId, 0); assert.ok(own.path.length > 0 || own.worldGoal);
  const hurt = (hp, fields = {}, mode = view.mode, spawn = view.players[0].spawn) => ({ ...view, mode,
    players: view.players.map((player, i) => i === 0 ? { ...player, spawn } : player),
    units: new Map([...view.units].map(([id, unit]) => [id, { ...structuredClone(unit), ...(id === own.id && { hp, ...fields }) }])) });
  const response = (fields = {}, mode = view.mode, spawn) => {
    const memory = { camera: { x: own.x, z: own.z } };
    perceive(hurt(100, fields, mode, spawn), 0, memory);
    return perceive({ ...hurt(30, fields, mode, spawn), tick: 10 }, 0, memory).newEvents.find(event => event.kind === 'screen-damage');
  };
  assert.equal(response({ autoRetreat: false }).responseRequired, true, 'disabled auto-retreat cannot exempt risk');
  assert.equal(response({}, view.mode, { x: 210, z: 210 }).responseRequired, true, 'the engine does not auto-retreat within the home radius');
  assert.equal(response({}, { kind: 'world' }).responseRequired, true, 'an unknown World retreat home cannot be treated as proof of automatic handling');
  assert.equal(response({}, { kind: 'horde', slot: 0 }).responseRequired, true, 'the scripted wave owner is excluded by the actual auto-retreat branch');
  assert.ok(state.events.some(event => event.id === covered.id), 'automatically handled damage remains in the all-stimuli history');
}
{
  const { game, own, enemy } = fixture(); own.autoRetreat = false; enemy.holdFire = true;
  step(game);
  assert.equal(own.targetId, enemy.id, 'the real engine acquires a firing target without an attack command');
  const view = viewFor(game, 0, {}), state = { camera: { x: own.x, z: own.z } };
  perceive(view, 0, state); own.hp -= 30; game.tick++;
  const engaged = perceive(viewFor(game, 0, {}), 0, state).newEvents.find(event => event.kind === 'screen-damage');
  assert.equal(engaged.responseRequired, false); assert.equal(engaged.responseReason, 'already-engaged');
  let shots = 0;
  for (let i = 0; i < 40; i++) { step(game); shots += game.shots.filter(shot => shot.f === own.id).length; }
  assert.ok(shots > 0, 'the actual weapon continues firing after the heavy hit without a manual response');
  const response = (fields = {}, hp = 70, enemyFields = {}) => {
    const memory = { camera: { x: 210, z: 210 } };
    const def = UNITS[fields.type ?? own.type], full = def.models * def.hpPer;
    const observation = amount => ({ ...view, tick: amount === full ? view.tick : view.tick + 10,
      units: new Map([...view.units].map(([id, unit]) => [id, { ...structuredClone(unit),
        ...(id === own.id && { hp: amount, autoRetreat: false, ...fields }), ...(id === enemy.id && enemyFields) }])) });
    perceive(observation(full), 0, memory);
    return perceive(observation(hp), 0, memory).newEvents.find(event => event.kind === 'screen-damage');
  };
  assert.equal(response({}, 30).responseRequired, true, 'firing never exempts retreat risk without auto-retreat coverage');
  assert.equal(response({ holdFire: true, attackId: 0 }).responseRequired, true, 'hold-fire prevents the automatic firing exemption');
  assert.equal(response({ type: 'mg', path: [{ x: 240, z: 210 }] }, 45).responseRequired, true, 'a moving weapon without move-fire is not already firing');
  assert.equal(response({}, 70, { x: 270, z: 210 }).responseRequired, true, 'an out-of-range target cannot justify continued automatic fire');
  assert.ok(state.events.some(event => event.id === engaged.id), 'continued-combat damage remains recorded as monitoring');
}
{
  const { view, own, enemy } = fixture(), state = { camera: { x: 210, z: 210 } };
  const initial = perceive(view, 0, state, 5), contact = initial.newEvents.find(event => event.kind === 'screen-contact');
  assert.equal(contact.tick, 5); assert.equal(contact.observationTick, 0); assert.equal(contact.onScreen, true); assert.equal(contact.targetId, enemy.id);
  assert.equal(perceive(view, 0, state, 7).newEvents.length, 0, 'a retained snapshot cannot redeliver the screen contact');
  const damage = (tick, hp) => ({ ...view, tick, units: new Map([...view.units].map(([id, unit]) => [id, { ...structuredClone(unit), ...(id === own.id && { hp }) }])) });
  const first = perceive(damage(10, 90), 0, state, 12).newEvents.find(event => event.kind === 'screen-damage');
  assert.equal(first.tick, 12); assert.equal(first.onScreen, true); assert.equal(first.unitId, own.id); assert.equal(first.provenance, 'first-damage-after-quiet');
  assert.equal(perceive(damage(20, 89), 0, state, 22).newEvents.some(event => event.kind === 'screen-damage'), false, 'continuous small hits belong to one damage episode');
  const later = perceive(damage(80, 88), 0, state, 82).newEvents.find(event => event.kind === 'screen-damage');
  assert.notEqual(later.episode, first.episode, 'three seconds of quiet end an episode');
  const heavy = perceive(damage(90, 58), 0, state, 92).newEvents.find(event => event.kind === 'screen-damage');
  assert.equal(heavy.provenance, 'heavy-damage'); assert.equal(heavy.episode, later.episode);
  state.camera = { x: 40, z: 40 }; perceive(damage(100, 40), 0, state, 102);
  state.camera = { x: 210, z: 210 };
  assert.equal(perceive(damage(110, 30), 0, state, 112).newEvents.some(event => event.kind === 'screen-damage'), false, 'damage discovered after an off-screen interval is not stamped as on-screen damage');
  const attention = chooseConcern(initial, 0, {}, 'hard', () => .5);
  assert.equal(attention.eventId, contact.id); assert.equal(attention.eventTick, contact.tick); assert.equal(attention.eventOnScreen, true);
  assert.ok(state.events.some(event => event.id === contact.id), 'unanswered events remain in the diagnostic population');
}
{
  const { view } = fixture(), state = { camera: { x: 210, z: 210 } };
  for (let i = 0; i < 140; i++) {
    state.camera = { x: 40, z: 40 }; perceive({ ...view, tick: i * 240 }, 0, state);
    state.camera = { x: 210, z: 210 }; perceive({ ...view, tick: i * 240 + 2 }, 0, state);
  }
  assert.equal(state.events.length, 128, 'event history is bounded while keeping unhandled events');
  assert.equal(state.eventsHistory, state.events);
  const reversed = { ...view, units: new Map([...view.units].reverse()) };
  assert.deepEqual(perceive(view, 0, { camera: { x: 40, z: 40 } }).minimap,
    perceive(reversed, 0, { camera: { x: 40, z: 40 } }).minimap, 'enemy ordering cannot preserve latent unit identities');
}
{
  const { view } = fixture(), perceived = perceive(view, 0, { camera: { x: 210, z: 210 } });
  perceived.minimap = []; perceived.points = []; perceived.players[0].mp = 0; perceived.players[0].sup = {};
  perceived.events = [{ id: 'base-high', kind: 'base', source: 'alert', tick: 0, onScreen: false, x: 210, z: 210 },
    { id: 'contact-lower', kind: 'screen-contact', source: 'screen', tick: 0, onScreen: true, x: 215, z: 210,
      responseRequired: true, responsePolicy: 'screen-v1', responseReason: 'idle-combat-contact', responseUnits: [] }];
  const memory = {}, concern = chooseConcern(perceived, 0, memory, 'easy', () => 0);
  assert.equal(memory.concernCapacity, 1); assert.equal(concern.eventId, 'base-high', 'a weaker emergency cannot evict the urgent base alert from capacity one');
  assert.equal(memory.attention.working.get(concern.id).urgency, 110);
}
{
  const { view, own, enemy } = fixture(), perceived = perceive(view, 0, { camera: { x: 210, z: 210 } });
  perceived.points = []; perceived.players[0].mp = 200; perceived.players[0].sup = {};
  perceived.units.get(own.id).targetId = enemy.id;
  const memory = {}, visits = [];
  for (let tick = 0; tick <= 2400; tick += 80) {
    const event = { id: `watch:${tick}`, kind: 'screen-damage', source: 'screen', tick, onScreen: true, x: 210, z: 210,
      responseRequired: false, responsePolicy: 'screen-v1', responseReason: 'already-engaged', responseUnits: [] };
    const concern = chooseConcern({ ...perceived, tick, events: [event] }, 0, memory, 'hard', () => .5);
    visits.push(concern.kind);
    const monitored = memory.concerns.find(candidate => candidate.eventId === event.id);
    if (monitored) assert.equal(monitored.urgency, 52, 'monitoring stays a coarse-priority observation, preserving its event ID');
  }
  assert.ok(visits.includes('combat')); assert.ok(visits.filter(kind => kind === 'production').length >= 2,
    'an ongoing auto-handled fight still permits repeated affordable production visits');
}
{
  const { view, own } = fixture(), perceived = perceive(view, 0, { camera: { x: 40, z: 40 } });
  perceived.events = []; perceived.newEvents = []; perceived.players[0].mp = 0; perceived.players[0].sup = {}; perceived.players[0].spawn = { x: 40, z: 80 };
  perceived.points = []; perceived.minimap = [{ id: own.id, owner: 0, x: 40, z: 80, vehicle: false },
    { owner: 1, x: 39, z: 80, vehicle: false }, { owner: 1, x: 41, z: 80, vehicle: false }];
  const state = {}, first = chooseConcern(perceived, 0, state, 'easy', () => 0);
  assert.equal(state.fightClusters.size, 1, 'one spatial fight crossing a 40 metre grid boundary remains one concern');
  assert.equal(first.eventOnScreen, false, 'minimap contact scope is always coarse and off-screen');
  const emergencyState = {};
  chooseConcern({ ...perceived, events: [] }, 0, emergencyState, 'easy', () => 0);
  const emergency = chooseConcern({ ...perceived, tick: 1, events: [{ id: 'capacity-one-emergency', kind: 'base', source: 'alert', onScreen: false, tick: 1, x: 40, z: 80 }] }, 0, emergencyState, 'easy', () => 0);
  assert.equal(emergency.eventId, 'capacity-one-emergency', 'an emergency can replace the active concern even at capacity one');
  assert.equal(emergencyState.attention.working.size, 1);
  const clock = first.eventTick, identity = first.id;
  perceived.minimap[1].x = 43; perceived.minimap[2].x = 45;
  const shifted = chooseConcern({ ...perceived, tick: 20 }, 0, state, 'easy', () => 0);
  assert.equal(shifted.id, identity); assert.equal(shifted.eventTick, clock, 'a moving fight keeps its initial coarse event clock');
  const noContact = { ...perceived, tick: 30, minimap: perceived.minimap.filter(dot => dot.owner === 0) };
  chooseConcern(noContact, 0, state, 'easy', () => 0);
  const returned = chooseConcern({ ...perceived, tick: 40 }, 0, state, 'easy', () => 0);
  assert.equal(returned.id, identity); assert.equal(returned.eventTick, clock, 'brief minimap flicker does not restart a fight');
  for (const [level, expected] of [['easy', 1], ['normal', 2], ['hard', 3]]) {
    const many = { ...perceived, events: [], newEvents: [], minimap: [40, 100, 160, 220].flatMap((x, i) => [
      { id: own.id + i, owner: 0, x, z: 80, vehicle: false }, { owner: 1, x: x + 2, z: 80, vehicle: false }]) };
    const memory = {}; chooseConcern(many, 0, memory, level, () => 0);
    assert.equal(memory.concernCapacity, expected); assert.equal(memory.attention.working.size, expected);
    const remembered = new Set(memory.concerns.map(concern => concern.id));
    chooseConcern({ ...many, tick: 10 }, 0, memory, level, () => .99);
    assert.deepEqual(new Set(memory.concerns.map(concern => concern.id)), remembered, 'the working set persists instead of being discarded on each ranking');
    assert.ok(memory.attention.waiting.size > 0, 'unattended concerns wait with ages outside the bounded working set');
  }
}
console.log('AI camera perception, attention and shared alert checks passed');
