import assert from 'node:assert/strict';
import * as THREE from 'three';
import { UNITS } from './shared/sim.js';
import { buildModel, animate, vehicleBody } from './client/unit-models.js';
import { vehicleTerrainPose } from './client/engine-presentation.js';
import { createRelief } from './client/relief.js';
import { TERRAIN_SCENARIOS, TERRAIN_TYPES, terrainFixture } from './tools/terrain-workshop-fixtures.js';

const makeVehicle = (type, faction = 0) => {
  const root = new THREE.Group(), base = new THREE.Group(), sel = new THREE.Group(), bars = new THREE.Group();
  root.add(base, sel);
  const unit = { id: 5, type, root, base, sel, bars, models: [], x: 20, z: 20, rot: 0, aim: 0 };
  buildModel(unit, root, { uniform: 0x596a41, vehicle: 0x59623d, color: 0x75965b }, faction, UNITS[type]);
  root.position.set(unit.x, 0, unit.z);
  return unit;
};
const tank = makeVehicle('medium'), body = vehicleBody(tank);
assert.equal(vehicleBody(tank), body, 'the chassis group is reused');
assert.equal(tank.base.parent, tank.root); assert.equal(tank.sel.parent, tank.root);
assert.equal(tank.turret.parent, body, 'turret aim remains a local transform under the tilted chassis');
let queries = 0;
const slope = (x, z) => { queries++; return x * 0.1 + z * 0.06; };
vehicleTerrainPose(tank, 1 / 60, true, slope, body, UNITS.medium);
assert.ok(Math.abs(body.rotation.z - Math.atan(0.1)) < 1e-8, 'pitch follows the delivered uphill surface');
assert.ok(Math.abs(body.rotation.x + Math.atan(0.06 * Math.cos(body.rotation.z))) < 1e-8, 'roll follows the compound surface normal');
assert.equal(tank.root.rotation.x, 0); assert.equal(tank.root.rotation.z, 0);
assert.equal(tank.base.rotation.x, 0); assert.equal(tank.sel.rotation.z, 0); assert.equal(tank.bars.rotation.x, 0);
const transform = tank.root.position.clone(), pitch = body.rotation.z;
vehicleTerrainPose(tank, 1 / 60, true, () => 0, body, UNITS.medium);
assert.ok(body.rotation.z > 0 && body.rotation.z < pitch, 'an ordinary slope transition interpolates');
const before = queries;
for (let i = 0; i < 120; i++) vehicleTerrainPose(tank, 1 / 60, false, slope, body, UNITS.medium);
assert.equal(queries, before, 'off-screen vehicles perform no detailed slope sampling');
tank.rot = Math.PI / 2;
tank.root.rotation.y = -tank.rot;
vehicleTerrainPose(tank, 1 / 60, true, slope, body, UNITS.medium);
assert.ok(Math.abs(body.rotation.z - Math.atan(0.06)) < 1e-8, 'return evaluates current hull direction immediately');
assert.ok(Math.abs(body.rotation.x - Math.atan(0.1 * Math.cos(body.rotation.z))) < 1e-8);
assert.deepEqual(tank.root.position, transform, 'visual tilt does not move the authoritative footprint');
tank.root.visible = false;
const hiddenQueries = queries;
vehicleTerrainPose(tank, 1 / 60, true, slope, body, UNITS.medium);
assert.equal(queries, hiddenQueries, 'hidden delivered vehicles cannot sample a fresh pose');
tank.root.visible = true;
vehicleTerrainPose(tank, 1 / 60, true, (x, z) => x * 100 + z * 100, body, UNITS.medium);
assert.ok(Math.abs(body.rotation.z) <= Math.PI / 3 && Math.abs(body.rotation.x) <= Math.PI / 3, 'cliff samples cannot overturn a chassis');
const wheeled = makeVehicle('armoredcar'), wheeledBody = vehicleBody(wheeled);
vehicleTerrainPose(wheeled, 1 / 60, true, (x, z) => x * 100 + z * 100, wheeledBody, UNITS.armoredcar);
assert.equal(wheeledBody.rotation.z, Math.PI / 3); assert.equal(wheeledBody.rotation.x, -Math.PI / 3);
const held = wheeledBody.rotation.clone();
vehicleTerrainPose(wheeled, 1 / 60, true, () => NaN, wheeledBody, UNITS.armoredcar);
assert.ok(wheeledBody.rotation.equals(held), 'missing terrain cannot corrupt a current pose');
vehicleTerrainPose(wheeled, 1 / 60, true, () => 0, wheeledBody, UNITS.armoredcar);
assert.equal(wheeledBody.rotation.z, 0, 'valid terrain immediately replaces a stale pose after missing data');
// Stop and reverse state never invent living knockback, hull yaw, distance or turret aim.
tank.turret.rotation.y = 0.7;
tank.moveSpeed = -3; tank.vx = -3; tank.vz = 0;
vehicleTerrainPose(tank, 0.1, true, () => 0, body, UNITS.medium);
assert.equal(tank.turret.rotation.y, 0.7); assert.equal(tank.root.rotation.y, -Math.PI / 2);
assert.deepEqual(tank.root.position, transform);

function supportGaps(v, ground) {
  const f = v.groundContact, gaps = [];
  v.root.updateMatrixWorld(true);
  for (const x of [f.minX, (f.minX + f.maxX) / 2, f.maxX]) for (const z of [f.minZ, (f.minZ + f.maxZ) / 2, f.maxZ]) {
    const p = new THREE.Vector3(x, f.y, z);
    (v.visualBody ?? v.visualChassis).localToWorld(p);
    gaps.push(p.y - ground(p.x, p.z));
  }
  return gaps;
}

// Test the composed model pipeline rather than isolated Euler values. The old caps leave tracks level on hills.
const eye = new THREE.Vector3(20, 30, 35);
for (const type of ['tank', 'medium', 'tiger', 'churchill', 'tankdestroyer', 'armoredcar', 'halftrack', 'flaktrack', 'rocket']) {
  for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 3]) {
    for (const [a, b] of [[0, 0], [0.65, 0], [-0.65, 0], [0, 0.55], [0.5, -0.35], [1.25, 0]]) {
      const v = makeVehicle(type), chassis = vehicleBody(v);
      const ground = (x, z) => x * a + z * b;
      v.rot = yaw; v.root.rotation.y = -yaw; v.root.position.y = ground(v.x, v.z);
      animate(v, 1 / 60, eye, ground, true);
      vehicleTerrainPose(v, 1 / 60, true, ground, chassis, UNITS[type]);
      assert.equal(v.visualBody.parent, chassis, 'suspension always sits inside terrain alignment');
      const up = chassis.localToWorld(new THREE.Vector3(0, 1, 0)).sub(chassis.getWorldPosition(new THREE.Vector3())).normalize();
      const normal = new THREE.Vector3(-a, 1, -b).normalize();
      assert.ok(up.dot(normal) > 1 - 1e-9, `${type}/${yaw}/${a}/${b}: chassis normal matches traversable terrain`);
      const forward = new THREE.Vector3(1, 0, 0).applyQuaternion(chassis.getWorldQuaternion(new THREE.Quaternion()));
      assert.ok(Math.abs(forward.y - a * forward.x - b * forward.z) < 1e-8, 'hull forward lies in the ground plane');
      assert.ok(Math.abs(Math.atan2(forward.z, forward.x) - yaw) < 1e-8, 'compound slopes preserve horizontal hull heading');
      const gaps = supportGaps(v, ground);
      assert.ok(Math.min(...gaps) >= -1e-8 && Math.max(...gaps) < 1e-8, 'native track footprint rests on a planar slope');
      assert.equal(v.base.parent, v.root); assert.equal(v.sel.parent, v.root);
      if (v.turret) {
        v.turret.rotation.y = 0.7;
        assert.equal(v.turret.rotation.y, 0.7, 'gun traversal remains independent on the hill');
        const muzzle = v.turret.localToWorld(new THREE.Vector3(...v.fxTip));
        assert.ok(muzzle.toArray().every(Number.isFinite), 'tilted turret retains a valid muzzle transform');
      }
    }
  }
}

// The game creates the suspension first; the viewer can request the chassis first. Both orders must compose identically.
for (const chassisFirst of [false, true]) {
  const v = makeVehicle('medium'), ground = (x, z) => 5 - Math.abs(x - 20) * 0.6;
  if (chassisFirst) vehicleBody(v);
  animate(v, 1 / 60, eye, ground, true);
  const chassis = vehicleBody(v);
  v.root.position.y = ground(v.x, v.z);
  vehicleTerrainPose(v, 1 / 60, true, ground, chassis, UNITS.medium);
  assert.equal(v.visualBody.parent, chassis);
  assert.ok(Math.min(...supportGaps(v, ground)) >= -1e-8, 'the hull bridges a crest without sinking through it');
  v.x += 0.06; v.root.position.x = v.x; v.root.position.y = ground(v.x, v.z);
  animate(v, 1 / 60, eye, ground, true);
  vehicleTerrainPose(v, 1 / 60, true, ground, chassis, UNITS.medium);
  assert.ok(Math.min(...supportGaps(v, ground)) >= -1e-8, 'acceleration settling cannot sink support points into the hill');
  v.x += 30; v.root.position.x = v.x; v.root.position.y = 0;
  animate(v, 1 / 60, eye, () => 0, true);
  vehicleTerrainPose(v, 1 / 60, true, () => 0, chassis, UNITS.medium);
  assert.equal(chassis.rotation.z, 0, 'repositioning resets a stale hill pose immediately');
  assert.ok(Math.max(...supportGaps(v, () => 0)) < 1e-8);
  const position = chassis.position.clone(), rotation = chassis.rotation.clone();
  let calls = 0;
  vehicleTerrainPose(v, 1 / 60, true, () => ++calls > 4 ? NaN : 3, chassis, UNITS.medium);
  assert.ok(chassis.position.equals(position) && chassis.rotation.equals(rotation), 'incomplete support data leaves the previous transform intact');
}

// Scrub the workshop's real relief, then drive continuously across it using the same render order as a match.
let reliefSamples = 0;
for (const scenario of TERRAIN_SCENARIOS) {
  const fixture = terrainFixture(scenario.id), relief = createRelief(fixture.map);
  for (const type of TERRAIN_TYPES) for (const faction of (['tank', 'medium'].includes(type) ? [0, 1, 2, 3] : [0])) {
    const v = makeVehicle(type, faction);
    animate(v, 0, eye, relief.hAt, true);
    const chassis = vehicleBody(v);
    for (let distance = 0; distance <= fixture.length; distance += 0.25) {
      Object.assign(v, fixture.point(distance));
      v.root.position.set(v.x, relief.hAt(v.x, v.z), v.z); v.root.rotation.y = -v.rot;
      animate(v, 1 / 60, eye, relief.hAt, true);
      vehicleTerrainPose(v, 1 / 60, true, relief.hAt, chassis, UNITS[type]);
      const gaps = supportGaps(v, relief.hAt);
      assert.ok(Math.min(...gaps) >= -1e-7, `${scenario.id}/${type}/${faction}/${distance}: native support remains above actual relief`);
      assert.ok(chassis.position.toArray().every(Number.isFinite), 'relief never produces an invalid hull transform');
      reliefSamples++;
    }
  }
  relief.dispose();
}

// Check rendered geometry independently of support probes. A one-cell crest can fit between sparse probes.
const ridge = createRelief({ w: 24, h: 24, rows: Array(24).fill('.'.repeat(24)), heights: Array(24).fill('000000000001000000000000') });
const point = new THREE.Vector3();
for (const type of ['medium', 'churchill', 'armoredcar']) {
  const v = makeVehicle(type, type === 'churchill' ? 3 : 0), chassis = vehicleBody(v);
  for (const yaw of [0, 0.31, Math.PI / 2, Math.PI, -0.7]) for (const x of [21, 22, 23, 24.5]) {
    v.x = x; v.z = 20; v.rot = yaw;
    v.root.position.set(x, ridge.hAt(x, 20), 20); v.root.rotation.y = -yaw;
    animate(v, 0, eye, ridge.hAt, true);
    v.terrainPose = undefined;
    vehicleTerrainPose(v, 1 / 60, true, ridge.hAt, chassis, UNITS[type]);
    v.root.updateMatrixWorld(true);
    for (const child of v.visualBody.children) if (child !== v.turret) child.traverse(mesh => {
      if (!mesh.isMesh) return;
      const positions = mesh.geometry.attributes.position;
      for (let i = 0; i < positions.count; i++) {
        point.fromBufferAttribute(positions, i);
        if (point.y > v.groundContact.y + 0.15) continue;
        point.applyMatrix4(mesh.matrixWorld);
        assert.ok(point.y >= ridge.hAt(point.x, point.z) - 0.001, `${type}/${yaw}/${x}: native track or tire vertex clears a narrow crest`);
      }
    });
  }
}
ridge.dispose();

// A contact vertex slightly above the track bottom projects outside its rectangle on a compound slope.
const rough = createRelief({ w: 8, h: 8, rows: Array(8).fill('........'), heights: ['10101000', '11000010', '01100100', '00101011', '01001100', '01101001', '00111001', '10011110'] });
const roughTank = makeVehicle('medium'), roughBody = vehicleBody(roughTank);
roughTank.x = 7.4851046691183; roughTank.z = 8.19908968359232; roughTank.rot = 4.432885635457045;
roughTank.root.position.set(roughTank.x, rough.hAt(roughTank.x, roughTank.z), roughTank.z);
roughTank.root.rotation.y = -roughTank.rot;
animate(roughTank, 0, eye, rough.hAt, true);
vehicleTerrainPose(roughTank, 1 / 60, true, rough.hAt, roughBody, UNITS.medium);
roughTank.root.updateMatrixWorld(true);
for (const child of roughTank.visualBody.children) if (child !== roughTank.turret) child.traverse(mesh => {
  if (!mesh.isMesh) return;
  const positions = mesh.geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    point.fromBufferAttribute(positions, i);
    if (point.y > roughTank.groundContact.y + 0.15) continue;
    point.applyMatrix4(mesh.matrixWorld);
    assert.ok(point.y >= rough.hAt(point.x, point.z) - 0.001, 'raised track vertices clear the compound terrain after projection');
  }
});
rough.dispose();
console.log('vehicle terrain pose checks passed: native footprints, composed slope normals and support, all nine vehicles, yaw/reverse, suspension ordering, crests, resets and hidden sampling');
console.log(`PASS workshop relief: ${reliefSamples} composed poses across ${TERRAIN_SCENARIOS.length} scenes and faction models`);
