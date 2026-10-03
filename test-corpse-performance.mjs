// The same body-manager interface used by the game, using real soldier geometry and Three cameras.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildModel, createBodies, CORPSES, LOD } from './client/unit-models.js';
import { gfx } from './client/gfx.js';
import { UNITS } from './shared/sim.js';

const palette = [0x3b73d6, 0xcc3a2e, 0xece6d6, 0xe2832b, 0x9b5cd4, 0x35b6c0];
function squad(faction = 0, color = palette[0], type = 'rifle') {
  const root = new THREE.Group(), unit = { type, root, models: [], turret: null };
  buildModel(unit, root, { uniform: 0x6b7248, vehicle: 0x59623d, color }, faction, UNITS[type]);
  return unit.models;
}
function field() {
  const scene = new THREE.Scene(), world = new THREE.Group(), bodies = createBodies();
  scene.add(world);
  return { scene, world, bodies };
}
const meshes = (world) => world.children.filter((m) => m.isInstancedMesh);
const active = (world) => meshes(world).filter((m) => m.count > 0);
function metrics(world) {
  const all = meshes(world), drawing = active(world);
  return {
    batches: drawing.length,
    triangles: drawing.reduce((n, m) => n + m.count * (m.geometry.index.count / 3), 0),
    drawn: drawing.reduce((n, m) => n + m.count, 0),
    instanceBytes: all.reduce((n, m) => n + m.instanceMatrix.array.byteLength, 0),
    geometryBytes: all.reduce((n, m) => n + m.geometry.index.array.byteLength + Object.values(m.geometry.attributes).reduce((v, a) => v + a.array.byteLength, 0), 0),
  };
}
function camera(distance) {
  const camera = new THREE.PerspectiveCamera(50, 1.5, 0.1, 2000);
  camera.position.set(10, distance, 5); camera.lookAt(10, 0, 5);
  return camera;
}
function assertBounds(world) {
  const matrix = new THREE.Matrix4(), sphere = new THREE.Sphere();
  for (const mesh of active(world)) {
    assert.equal(mesh.frustumCulled, true, 'instance batches allow camera culling');
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, matrix);
      assert.ok(Math.abs(matrix.determinant() - 1) < 1e-5, 'pool growth preserves a complete rigid transform for every corpse');
      sphere.copy(mesh.geometry.boundingSphere).applyMatrix4(matrix);
      assert.ok(mesh.boundingSphere.center.distanceTo(sphere.center) + sphere.radius <= mesh.boundingSphere.radius + 1e-4,
        'batch bounds enclose every transformed fallen body');
    }
  }
}

const men = squad(), { scene, world, bodies } = field();
for (let i = 0; i < CORPSES.cap; i++) bodies.add(world, i % 20, 0, Math.floor(i / 20), men[i % men.length], 0.6);
const near = metrics(world);
assert.equal(near.drawn, CORPSES.cap);
assert.equal(near.batches, 4, 'near bodies reuse each actual kit');
assertBounds(world);
for (const mesh of active(world)) {
  const source = men.find((man) => {
    const src = man.userData.hi[0].geometry;
    return src.index.count === mesh.geometry.index.count && src.attributes.color.array.every((value, i) => value === mesh.geometry.attributes.color.array[i]);
  })?.userData.hi[0].geometry;
  assert.ok(source, 'near corpse topology comes from the detailed soldier');
  assert.deepEqual(mesh.geometry.attributes.color.array, source.attributes.color.array, 'uniform and equipment colors survive');
  assert.deepEqual(mesh.geometry.attributes.matId.array, source.attributes.matId.array, 'cloth, helmet and weapon materials survive');
  assert.notEqual(mesh.geometry.index, source.index, 'owned corpse buffers do not alias living buffers');
  const pose = source.userData.fallen.position, scale = men[0].scale.x, P = mesh.geometry.attributes.position;
  let floor = Infinity;
  for (let i = 0; i < pose.count; i++) floor = Math.min(floor, pose.getY(i) * scale);
  for (let i = 0; i < P.count; i++) {
    assert.ok(Math.abs(P.getX(i) - pose.getX(i) * scale) < 1e-6);
    assert.ok(Math.abs(P.getY(i) - (pose.getY(i) * scale - floor)) < 1e-6);
    assert.ok(Math.abs(P.getZ(i) - pose.getZ(i) * scale) < 1e-6);
  }
}
const cam = camera(150);
bodies.update(0, null, null, cam);
const far = metrics(world);
assert.equal(far.drawn, CORPSES.cap);
assert.equal(far.batches, near.batches);
assert.ok(far.triangles < near.triangles * 0.4, 'distant fallen models cut submitted triangles substantially');
for (const mesh of active(world)) assert.ok(men.some((m) => m.userData.lo[0].geometry.index.count === mesh.geometry.index.count), 'far geometry retains the soldier kit silhouette');
assertBounds(world);
const farMeshes = active(world);
cam.position.y = LOD.high; bodies.update(0, null, null, cam);
assert.deepEqual(active(world), farMeshes, 'the LOD hysteresis holds at the cutoff');
cam.position.y = LOD.high - 5; bodies.update(0, null, null, cam);
assert.equal(metrics(world).triangles, near.triangles, 'zooming close restores the detailed fallen pose');
cam.position.y = 95; gfx.set('low'); bodies.update(0, null, null, cam);
assert.equal(metrics(world).triangles, far.triangles, 'Low graphics chooses the distant body sooner');
gfx.set('high');
cam.position.y = 150; cam.lookAt(10, 300, 5); bodies.update(0.1, null, null, cam);
assert.equal(metrics(world).drawn, 0, 'bodies behind the camera leave the draw batches');
assert.equal(bodies.count, CORPSES.cap, 'visibility never deletes logical bodies');
cam.lookAt(10, 0, 5); bodies.update(0, null, null, cam);
assert.deepEqual(active(world), farMeshes, 'visible pools reuse their geometry and mesh after culling');

let geometryDisposals = 0, meshDisposals = 0, sourceDisposals = 0;
for (const mesh of meshes(world)) {
  mesh.geometry.addEventListener('dispose', () => geometryDisposals++);
  mesh.addEventListener('dispose', () => meshDisposals++);
}
for (const man of men) for (const mesh of [...man.userData.hi, ...man.userData.lo]) mesh.geometry.addEventListener('dispose', () => sourceDisposals++);
const allocated = meshes(world).length;
cam.lookAt(10, 300, 5);
bodies.update(CORPSES.life + CORPSES.fade, null, null, cam);
assert.equal(bodies.count, 0, 'off-screen and on-screen bodies still expire');
assert.equal(meshes(world).length, 0, 'expiry removes empty pools from the scene');
assert.equal(geometryDisposals, allocated, 'expiry disposes each owned geometry');
assert.equal(meshDisposals, allocated, 'expiry disposes each instance buffer');
assert.equal(sourceDisposals, 0, 'cleanup preserves shared living soldier geometry');

const mixed = [];
for (const fac of [0, 1, 2]) for (const color of palette) mixed.push(...squad(fac, color));
for (let i = 0; i < CORPSES.cap; i++) bodies.add(world, i % 20, 0, Math.floor(i / 20), mixed[i % mixed.length], 0);
bodies.update(0, null, null, camera(50));
const mixedNear = metrics(world);
assert.equal(mixedNear.drawn, CORPSES.cap);
assert.ok(mixedNear.instanceBytes < mixedNear.batches * CORPSES.cap * 64 * 0.2,
  'mixed uniforms grow instance buffers to observed demand instead of reserving 200 each');
bodies.update(0, null, null, camera(150));
const mixedFar = metrics(world);
assert.ok(mixedFar.triangles < mixedNear.triangles * 0.4);
bodies.add(world, 0, 0, 0, men[0]);
assert.equal(bodies.count, CORPSES.cap, 'the global cap survives mixed appearances and LOD pools');
const next = new THREE.Group(); scene.add(next);
bodies.add(next, 0, 0, 0, men[0]);
assert.equal(meshes(world).length, 0, 'world replacement releases old pools');
assert.equal(bodies.count, 1, 'world replacement removes the old bodies');
assert.equal(metrics(next).drawn, 1);
scene.remove(next); bodies.update(0);
assert.equal(bodies.count, 0, 'a detached match resets the logical bodies');
assert.equal(meshes(next).length, 0, 'a detached match releases its pools');
bodies.add(world, 0, 0, 0, men[0]);
bodies.dispose(); bodies.dispose();
assert.equal(meshes(world).length, 0, 'explicit disposal is safe to repeat');
bodies.add(world, 0, 0, 0, men[0]);
assert.equal(bodies.count, 1, 'a cleared manager can be reused');

// A snapshot can contain many deaths. Camera-aware additions wait for the next update's single pack.
const burst = field(); burst.bodies.add(burst.world, 0, 0, 0, men[0], 0);
const burstCamera = camera(50); burst.bodies.update(0, null, null, burstCamera);
const initial = active(burst.world)[0], version = initial.instanceMatrix.version;
for (let i = 1; i <= 100; i++) burst.bodies.add(burst.world, i % 10, 0, Math.floor(i / 10), men[0], 0);
assert.equal(burst.bodies.count, 101);
assert.equal(initial.instanceMatrix.version, version, 'snapshot additions never repack prior camera-aware instances');
assert.equal(initial.count, 1, 'camera-aware deaths are queued until the frame update');
burst.bodies.update(0, null, null, burstCamera);
assert.equal(metrics(burst.world).drawn, 101, 'one update packs the complete death snapshot');
assertBounds(burst.world);
const burstMesh = active(burst.world)[0], placed = new THREE.Matrix4();
for (let i = 0; i <= 100; i++) {
  burstMesh.getMatrixAt(i, placed);
  assert.equal(placed.elements[12], i % 10, 'growth preserves each death position');
  assert.equal(placed.elements[14], Math.floor(i / 10), 'growth preserves each death row');
}
burst.bodies.dispose();

// Bounds track large translations, scene transforms, rotated flying poses and the sinking fade.
const transformed = field(); transformed.world.position.set(400, 0, 300);
transformed.bodies.add(transformed.world, 1, 0, 1, men[0], 0);
const view = camera(50); view.position.set(401, 50, 301); view.lookAt(401, 0, 301);
let blood = 0;
transformed.bodies.update(0.1, { blastNear: () => ({ x: 0, z: 0, s: 3 }), gore: () => blood++ }, () => 0, view);
assert.equal(blood, 1, 'blast toss still emits blood');
assert.equal(metrics(transformed.world).drawn, 1, 'camera visibility respects the world transform');
assertBounds(transformed.world);
transformed.bodies.update(1, null, () => 0, view);
assertBounds(transformed.world);
const fading = field(); fading.bodies.add(fading.world, 0, 0, 0, men[0], 0);
fading.bodies.update(CORPSES.life - 0.1); fading.bodies.update(0.2);
const fadeMesh = active(fading.world)[0], matrix = new THREE.Matrix4();
fadeMesh.getMatrixAt(0, matrix);
assert.ok(fadeMesh.geometry.attributes.fade.getX(0) < 1 && fadeMesh.geometry.attributes.fade.getX(0) > 0, 'old bodies fade gradually');
assert.ok(matrix.elements[13] < 0 && matrix.elements[13] > -CORPSES.sink, 'fading bodies sink into the ground');
assertBounds(fading.world);
const another = field(); another.bodies.add(another.world, 0, 0, 0, men[0]);
assert.equal(active(another.world)[0].material, fadeMesh.material, 'managers share one long-lived textured material');
for (const manager of [bodies, transformed.bodies, fading.bodies, another.bodies]) manager.dispose();
console.log(JSON.stringify({ near, far, mixedNear, mixedFar }));
console.log('Corpse performance, visibility, lifetime, and resource tests passed.');
