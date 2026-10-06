// Cosmetic motion checks run without a browser or audio.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { moveModel } from './client/model-motion.js';
import { gaitWeights, moveSquad } from './client/squad-motion.js';
import { buildModel, animate } from './client/unit-models.js';
import { UNITS } from './shared/sim.js';

const look = { uniform: 0x6b7248, vehicle: 0x59623d, color: 0x3b73d6 }, eye = new THREE.Vector3(0, 30, 30);
function unit(type) {
  const root = new THREE.Group(), base = new THREE.Group(), sel = new THREE.Group();
  root.add(base, sel);
  const v = { id: 17, type, root, base, sel, models: [], x: 0, z: 0, flags: 0, supp: 0, cover: 0 };
  buildModel(v, root, look, 0, UNITS[type]);
  return v;
}
function draws(root) { let n = 0; root.traverse((o) => { if (o.isMesh) n++; }); return n; }

for (const type of ['medium', 'armoredcar', 'lcvp', 'gunboat', 'destroyer']) {
  const v = unit(type), count = draws(v.root), modelNodes = v.root.children.filter((c) => c !== v.base && c !== v.sel);
  const ring = v.base.matrix.clone(), selection = v.sel.matrix.clone();
  animate(v, 1 / 60, eye);
  assert.equal(v.visualBody.children.length, modelNodes.length, `${type}: only model nodes are grouped`);
  assert.equal(v.base.parent, v.root, `${type}: owner ring remains under the gameplay root`);
  assert.equal(v.sel.parent, v.root, `${type}: selection remains under the gameplay root`);
  let observedMotion = 0;
  for (let i = 0; i < 240; i++) {
    v.x += 0.04; v.z += i > 120 ? 0.015 : 0;
    v.root.position.set(v.x, 0.2, v.z); v.root.rotation.y = i > 120 ? -0.3 : 0;
    const position = v.root.position.clone(), rotation = v.root.rotation.clone();
    if (v.turret) v.turret.rotation.y = 0.41;
    animate(v, 1 / 60, eye);
    assert.ok(v.root.position.equals(position) && v.root.rotation.equals(rotation), `${type}: simulation transform stays intact`);
    assert.ok(Math.abs(v.visualBody.rotation.z) <= 0.022 && Math.abs(v.visualBody.rotation.x) <= 0.024, `${type}: hull response stays bounded`);
    assert.ok(Math.abs(v.visualBody.position.y) <= 0.045, `${type}: wave heave stays bounded`);
    if (v.turret) assert.equal(v.turret.rotation.y, 0.41, `${type}: turret traversal remains authoritative`);
    observedMotion += Math.abs(v.visualBody.rotation.x) + Math.abs(v.visualBody.rotation.z);
  }
  assert.ok(observedMotion > 0.01, `${type}: travel or water gives a visible response`);
  assert.equal(draws(v.root), count, `${type}: animation adds no draw calls`);
  v.base.updateMatrix(); v.sel.updateMatrix();
  assert.ok(v.base.matrix.equals(ring) && v.sel.matrix.equals(selection), `${type}: rings stay level`);
  if (v.turret) {
    v.root.updateMatrixWorld(true);
    const tip = new THREE.Vector3(...v.fxTip), actual = tip.clone().applyMatrix4(v.turret.matrixWorld);
    const expected = tip.clone().applyMatrix4(v.turret.matrix).applyMatrix4(v.visualBody.matrix).applyMatrix4(v.root.matrixWorld);
    assert.ok(actual.distanceTo(expected) < 1e-9, `${type}: the muzzle follows both hull response and turret traversal`);
    let nearest = Infinity;
    v.turret.traverse((mesh) => {
      if (!mesh.isMesh) return;
      const positions = mesh.geometry.attributes.position, point = new THREE.Vector3();
      for (let i = 0; i < positions.count; i++) nearest = Math.min(nearest, point.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld).distanceTo(actual));
    });
    assert.ok(nearest < 0.2, `${type}: the world muzzle remains on the animated barrel`);
  }
  const beforePause = v.visualBody.matrix.clone();
  v.visualBody.updateMatrix(); beforePause.copy(v.visualBody.matrix);
  animate(v, 0, eye); v.visualBody.updateMatrix();
  assert.ok(v.visualBody.matrix.equals(beforePause), `${type}: paused animation remains still`);
  v.root.position.x += 50; animate(v, 1 / 60, eye);
  assert.equal(v.visualBody.rotation.x, 0, `${type}: a teleport clears stale hull lean`);
  assert.equal(v.visualBody.rotation.z, 0); assert.equal(v.visualBody.position.y, 0);
  v.root.visible = false; animate(v, 1 / 60, eye);
  v.root.visible = true; animate(v, 1 / 60, eye);
  assert.equal(v.modelMotion.speed, 0, `${type}: a revealed unit resumes without false acceleration`);
  if (!UNITS[type].naval) {
    for (let i = 0; i < 120; i++) animate(v, 1 / 60, eye);
    assert.equal(v.visualBody.rotation.x, 0); assert.equal(v.visualBody.rotation.z, 0);
  }
}

const headquarters = unit('hq'); moveModel(headquarters, 1 / 60);
assert.equal(headquarters.visualBody, undefined, 'buildings have no hull motion');

for (const count of [4, 8]) {
  for (const phase of [-0.4, 0, 0.14, 0.5, 0.9999, 1.5]) {
    const weights = gaitWeights(phase, 0.7, count);
    assert.ok(weights.every((w) => w >= 0 && w <= 0.7), 'gait interpolation stays between authored frames');
    assert.ok(Math.abs(weights.reduce((a, b) => a + b, 0) - 0.7) < 1e-12, 'gait weights retain the movement blend');
  }
  const a = gaitWeights(1e-5, 1, count), b = gaitWeights(1 - 1e-5, 1, count);
  assert.ok(a[1] < 1e-7 && b[count - 1] < 1e-7, 'the loop eases into the first pose from either side');
}

const squad = unit('rifle'); moveSquad(squad, 1 / 60);
for (let i = 0; i < 60; i++) { squad.root.position.x += 0.03; moveSquad(squad, 1 / 60); }
const motion = squad.models[0].userData.motion, stride = motion.stride;
squad.supp = 95; squad.root.position.x += 0.03; moveSquad(squad, 1 / 60);
assert.ok(motion.stride < stride && motion.stride > 0.48, 'entering a crawl changes stride length gradually');
for (let i = 0; i < 120; i++) moveSquad(squad, 1 / 60);
const phase = motion.phase; moveSquad(squad, 0.1);
assert.equal(motion.phase, phase, 'idle soldiers never advance their gait');
assert.equal(motion.blend, 0, 'the stopped gait settles fully');
console.log('PASS model motion: stable roots and rings, bounded response, muzzle transforms, resets, eased strides');
