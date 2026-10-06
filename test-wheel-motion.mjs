import assert from 'node:assert/strict';
import * as THREE from 'three';
import { UNITS } from './shared/sim.js';
import { buildModel, animate, vehicleBody, mergeParts, VEHICLE_PAINT } from './client/unit-models.js';
import { vehicleTerrainPose } from './client/engine-presentation.js';
import { wheelAngle, releaseWheels } from './client/wheel-motion.js';
import { trackVertex, trackLength } from './client/track-motion.js';
import { tagWheel, merge, mirrorZ, xf, scaleWheelPivots } from './client/models/geom.js';

const eye = new THREE.Vector3(0, 20, 20), dt = 1 / 60;
const looks = [{ vehicle: 0x59623d, color: 0x3b73d6 }, { vehicle: 0x50565a, color: 0xcc3a2e },
  { vehicle: 0x4e5a38, color: 0xece6d6 }, { vehicle: 0x565640, color: 0xe2832b }];
function unit(type, faction) {
  const root = new THREE.Group(), base = new THREE.Group(), sel = new THREE.Group();
  root.add(base, sel);
  const v = { type, root, base, sel, models: [] };
  buildModel(v, root, looks[faction], faction, UNITS[type]);
  animate(v, dt, eye);
  return v;
}
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-7, `${message}: ${actual} vs ${expected}`);
const phases = v => v.wheelMotion.pivots.map(p => wheelAngle(p, v.wheelMotion.travel, v.wheelMotion.turn));

// Native metadata must survive every actual bake, reflection and model scale.
const cases = ['tank', 'medium', 'tiger', 'churchill', 'tankdestroyer'].flatMap(type => looks.map((_, faction) => [type, faction]));
cases.push(['flaktrack', 1], ['flaktrack', 2], ['rocket', 0], ['rocket', 3]);
for (const [type, faction] of cases) {
  const v = unit(type, faction), label = `${type} faction ${faction}`, motion = v.wheelMotion;
  assert.equal(motion.meshes.length, 1, `${label}: one animated native hull`);
  const mesh = motion.meshes[0], geo = mesh.geometry, pivots = motion.pivots;
  assert.ok(pivots.length >= 8 && pivots.every(p => p.every(Number.isFinite) && p[3] > 0.04), `${label}: real axle centers and radii`);
  for (const p of pivots) assert.ok(pivots.some(q => q[0] === p[0] && q[1] === p[1] && q[2] === -p[2] && q[3] === p[3]), `${label}: both native sides are tagged`);
  let draws = 0; v.root.traverse(o => { if (o.isMesh) draws++; });
  assert.equal(draws, 2, `${label}: native hull and turret keep two draws`);
  assert.equal(mesh.material, VEHICLE_PAINT, `${label}: shared textured material retained`);
  assert.equal(v.turret.children[0].geometry.attributes.wheelPivot, undefined, `${label}: turret does not turn with wheels`);
  const W = geo.attributes.wheelPivot, P = geo.attributes.position;
  let fixed = 0, turning = 0;
  for (let i = 0; i < W.count; i++) {
    if (!W.getW(i)) { fixed++; continue; }
    turning++;
    assert.ok(Math.hypot(P.getX(i) - W.getX(i), P.getY(i) - W.getY(i)) <= W.getW(i) * 1.03, `${label}: tagged vertex belongs to its authored wheel`);
  }
  assert.ok(fixed > 0 && turning > 0, `${label}: hull and suspension remain outside wheel rotation`);
  const tracks = geo.attributes.trackData;
  assert.ok(tracks && geo.userData.trackSupport.length > 0, `${label}: native belts preserve their support band`);
  const bottom = [];
  for (let i = 0; i < tracks.count; i++) if (tracks.getY(i) >= 0) {
    const at = trackVertex(geo, i, 0, 0);
    assert.ok(at.y >= tracks.getW(i) - 1e-7, `${label}: track details stay above the support floor`);
    if (P.getY(i) >= tracks.getW(i)) assert.ok(at.distanceTo(new THREE.Vector3().fromBufferAttribute(P, i)) < 1e-7, `${label}: stopped visible track retains its native shape`);
    if (P.getY(i) <= tracks.getW(i) + 0.015 && Math.abs(P.getX(i)) < 0.4) bottom.push(i);
  }
  assert.ok(bottom.length > 1, `${label}: actual bottom tread samples`);
  for (const i of bottom) {
    const start = trackVertex(geo, i, 0, 0), forward = trackVertex(geo, i, 0.19, 0);
    assert.ok(Math.abs(forward.x - start.x + 0.19) < 0.001, `${label}: forward tank travel carries the bottom belt backward`);
    assert.ok(Math.abs(trackVertex(geo, i, -0.19, 0).x - start.x - 0.19) < 0.001, `${label}: reverse carries the belt forward`);
    assert.ok(Math.abs(trackVertex(geo, i, 0, 0.08).x - start.x + 0.08 * tracks.getZ(i)) < 0.001, `${label}: pivot turn gives each entire belt its side travel`);
  }
  for (const pivot of pivots) assert.ok(bottom.some(i => tracks.getZ(i) === pivot[4]), `${label}: paired wheels share their belt's steering travel`);
  for (let i = 0; i < tracks.count; i += 13) if (tracks.getY(i) >= 0) {
    for (const travel of [-37, -0.19, 0.19, 37]) {
      const point = trackVertex(geo, i, travel, 0.08);
      assert.ok(point.toArray().every(Number.isFinite) && point.y >= tracks.getW(i) - 1e-7, `${label}: moving links wrap and clear the ground in either direction`);
      assert.ok(point.distanceTo(trackVertex(geo, i, travel + trackLength(geo, i), 0.08)) < 1e-6, `${label}: a complete belt circuit returns the same link position`);
    }
  }
  const geometryBefore = geo.attributes.position.array.slice(), normalsBefore = geo.attributes.normal.array.slice();
  v.root.position.x += 0.19; animate(v, dt, eye);
  pivots.forEach(p => near(wheelAngle(p, motion.travel, motion.turn) * p[3], -0.19, `${label}: forward rim follows travel`));
  const held = phases(v), version = mesh.userData.wheelTravel.version;
  const heldTracks = bottom.map(i => trackVertex(geo, i, motion.travel, motion.turn).toArray());
  for (let i = 0; i < 30; i++) animate(v, dt, eye);
  assert.deepEqual(phases(v), held, `${label}: stopping holds wheel phase exactly`);
  assert.deepEqual(bottom.map(i => trackVertex(geo, i, motion.travel, motion.turn).toArray()), heldTracks, `${label}: stopping holds actual belt geometry exactly`);
  assert.equal(mesh.userData.wheelTravel.version, version, `${label}: idle frames do not upload motion`);
  v.root.position.x -= 0.19; animate(v, dt, eye);
  phases(v).forEach(p => near(p, 0, `${label}: reversing retraces the wheel rotation`));
  for (const i of bottom) assert.ok(trackVertex(geo, i, motion.travel, motion.turn).distanceTo(trackVertex(geo, i, 0, 0)) < 1e-7, `${label}: reversing retraces the belt links`);
  v.root.rotation.y = 0.08; animate(v, dt, eye);
  const right = pivots.find(p => p[2] > 0), left = pivots.find(p => p[0] === right[0] && p[1] === right[1] && p[2] === -right[2]);
  assert.ok(wheelAngle(right, motion.travel, motion.turn) < 0 && wheelAngle(left, motion.travel, motion.turn) > 0, `${label}: pivot turn counter-rotates the tracks`);
  near(wheelAngle(right, motion.travel, motion.turn), -wheelAngle(left, motion.travel, motion.turn), `${label}: mirrored sides use coherent axes`);
  const beforeCorrection = phases(v);
  v.root.position.x += 50; animate(v, dt, eye);
  assert.deepEqual(phases(v), beforeCorrection, `${label}: teleport does not spin the wheels`);
  v.root.visible = false; v.root.position.x += 1; animate(v, dt, eye);
  v.root.visible = true; v.root.position.x += 1; animate(v, dt, eye);
  assert.deepEqual(phases(v), beforeCorrection, `${label}: hidden and revealed positions reset the baseline`);
  v.root.position.x += 1; animate(v, 0, eye);
  assert.deepEqual(phases(v), beforeCorrection, `${label}: a paused seek cannot create wheel travel`);
  assert.deepEqual(geo.attributes.position.array, geometryBefore, `${label}: cached native positions are never mutated`);
  assert.deepEqual(geo.attributes.normal.array, normalsBefore, `${label}: cached native normals are never mutated`);
  releaseWheels(v);
}

// Paired discs on one native axle follow their belt together while retaining separate geometric centers.
for (const [type, faction] of [['tiger', 1], ['churchill', 3], ['medium', 3]]) {
  const v = unit(type, faction), groups = new Map(), mesh = v.wheelMotion.meshes[0];
  const tracks = mesh.geometry.attributes.trackData, beltCenters = new Set();
  for (let i = 0; i < tracks.count; i++) if (tracks.getY(i) >= 0) beltCenters.add(tracks.getZ(i));
  for (const pivot of v.wheelMotion.pivots) {
    const axle = [pivot[0], pivot[1], pivot[3], Math.sign(pivot[2])].join(',');
    if (!groups.has(axle)) groups.set(axle, []);
    groups.get(axle).push(pivot);
  }
  const pairs = [...groups.values()].filter(group => group.length > 1);
  assert.ok(pairs.length > 0, `${type}: actual paired native wheel discs`);
  v.root.rotation.y = 0.23; animate(v, dt, eye);
  for (const pair of pairs) {
    assert.ok(new Set(pair.map(p => p[2])).size > 1, `${type}: paired discs retain their distinct axle planes`);
    const side = [...beltCenters].find(z => Math.sign(z) === Math.sign(pair[0][2]));
    for (const pivot of pair) {
      assert.equal(pivot[4], side, `${type}: paired axle uses its native belt center`);
      near(wheelAngle(pivot, v.wheelMotion.travel, v.wheelMotion.turn) * pivot[3], -0.23 * side,
        `${type}: both paired discs have the belt's rim travel during a turn`);
    }
  }
  releaseWheels(v);
}

// Independent vehicles share static buffers, with independent GPU motion values and safe disposal.
const a = unit('medium', 0), b = unit('medium', 0), am = a.wheelMotion.meshes[0], bm = b.wheelMotion.meshes[0];
assert.equal(am.geometry.attributes.position, bm.geometry.attributes.position);
assert.notEqual(am.userData.wheelTravel, bm.userData.wheelTravel);
a.root.position.x = 0.2; animate(a, dt, eye);
assert.equal(bm.userData.wheelTravel.getX(0), 0, 'one moving tank cannot rotate a parked copy');
am.geometry.addEventListener('dispose', () => {
  assert.deepEqual(Object.keys(am.geometry.attributes), ['wheelTravel'], 'disposal frees only the private motion buffer');
  assert.equal(am.geometry.index, null, 'the cached native index stays alive');
});
releaseWheels(a);
b.root.position.x = -0.2; animate(b, dt, eye);
assert.ok(bm.userData.wheelTravel.getX(0) < 0, 'a surviving copy still reverses after another is removed');

// Compose animation and terrain alignment in the same order as gameplay.
const wrapped = unit('medium', 0);
wrapped.root.rotation.y = Math.PI - 0.01; animate(wrapped, 0, eye);
wrapped.root.rotation.y = -Math.PI + 0.01; wrapped.root.position.x -= 0.2;
animate(wrapped, dt, eye);
near(wrapped.wheelMotion.travel, 0.2, 'forward travel respects a hull facing west');
near(wrapped.wheelMotion.turn, 0.02, 'yaw wrapping keeps the small turn across the angle seam');
wrapped.root.position.x += 0.2; animate(wrapped, dt, eye);
assert.ok(wrapped.wheelMotion.travel < 0.00002, 'reversing a rotated hull reverses its wheels');
const curved = unit('medium', 0), radius = 4;
for (let i = 1; i <= 20; i++) {
  const yaw = i * 0.01;
  curved.root.rotation.y = yaw;
  curved.root.position.set(radius * Math.sin(yaw), 0, radius * (Math.cos(yaw) - 1));
  animate(curved, dt, eye);
}
for (const pivot of curved.wheelMotion.pivots) {
  const rimTravel = -phases(curved)[curved.wheelMotion.pivots.indexOf(pivot)] * pivot[3];
  assert.ok(Math.abs(rimTravel - 0.2 * (radius + pivot[4])) < 0.00001, 'a moving turn gives each track its own arc length');
}

// Compose animation and terrain alignment in the same order as gameplay.
for (const [slopeX, slopeZ] of [[0, 0], [0.65, 0], [-0.65, 0], [0.5, -0.35]]) {
  const v = unit('medium', 0), chassis = vehicleBody(v), ground = (x, z) => x * slopeX + z * slopeZ;
  vehicleTerrainPose(v, dt, true, ground, chassis, UNITS.medium);
  const marker = v.base.matrix.clone(), selection = v.sel.matrix.clone();
  v.turret.rotation.y = 0.6;
  for (let i = 0; i < 10; i++) {
    v.root.position.x += 0.03; v.root.position.y = ground(v.root.position.x, v.root.position.z);
    animate(v, dt, eye); vehicleTerrainPose(v, dt, true, ground, chassis, UNITS.medium);
  }
  near(v.wheelMotion.travel, 0.3 * Math.hypot(1, slopeX), 'wheel travel follows the hill surface length');
  assert.equal(v.turret.rotation.y, 0.6, 'terrain and wheel animation preserve turret aim');
  v.base.updateMatrix(); v.sel.updateMatrix();
  assert.ok(v.base.matrix.equals(marker) && v.sel.matrix.equals(selection), 'owner and selection markers remain level');
  const mesh = v.wheelMotion.meshes[0], pivot = v.wheelMotion.pivots.find(p => p[2] > 0), center = new THREE.Vector3(...pivot);
  const rotation = wheelAngle(pivot, v.wheelMotion.travel, v.wheelMotion.turn);
  const top = center.clone().add(new THREE.Vector3(0, pivot[3], 0).applyAxisAngle(new THREE.Vector3(0, 0, 1), rotation));
  v.root.updateMatrixWorld(true);
  const worldCenter = center.clone().applyMatrix4(mesh.matrixWorld), worldTop = top.applyMatrix4(mesh.matrixWorld);
  near(worldTop.distanceTo(worldCenter), pivot[3], 'a tilted wheel retains its radius around the native axle');
  const axle = new THREE.Vector3(0, 0, 1).transformDirection(mesh.matrixWorld);
  near(worldTop.sub(worldCenter).dot(axle), 0, 'wheel rotation remains in the pitched and rolled axle plane');
  releaseWheels(v);
}

// All geometry transformations in the source pipeline carry pivots with the wheel.
const native = tagWheel(new THREE.CylinderGeometry(0.3, 0.3, 0.2, 12).rotateX(Math.PI / 2), 0.3);
const transformed = merge([{ geo: native, matrix: xf(2, 1, 1.2, 0, 0, 0, 2, 2, 2) }]);
const mirrored = scaleWheelPivots(mirrorZ(transformed).scale(0.9, 0.9, 0.9), 0.9);
const baked = mergeParts([{ geo: mirrored, color: new THREE.Color(1, 1, 1), matrix: new THREE.Matrix4() }], true);
const pivot = baked.attributes.wheelPivot;
near(pivot.getX(0), 1.8, 'scaled pivot x'); near(pivot.getY(0), 0.9, 'scaled pivot y');
near(pivot.getZ(0), 1.08, 'scaled pivot side'); near(pivot.getW(0), 0.54, 'scaled radius');
near(pivot.getZ(native.attributes.position.count), -1.08, 'mirrored pivot side');
const spare = unit('tankdestroyer', 1).wheelMotion.meshes[0].geometry;
for (let i = 0; i < spare.attributes.position.count; i++) {
  if (spare.attributes.position.getX(i) < -1.3 && spare.attributes.position.getY(i) > 1.3) {
    assert.equal(spare.attributes.wheelPivot.getW(i), 0, 'StuG engine-deck spare wheels stay fixed');
  }
}
for (const [type, faction] of [['armoredcar', 0], ['rocket', 1], ['rocket', 2], ['flaktrack', 0], ['halftrack', 0]]) {
  assert.equal(unit(type, faction).wheelMotion.meshes.length, 0, `${type} faction ${faction}: wheeled and halftrack models remain outside tank coverage`);
}
console.log(`PASS native wheel and belt motion: ${cases.length} tank/faction builds, reverse, stops, pivot turns, belt circuits, slopes, shared buffers and disposal`);
