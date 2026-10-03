import assert from 'node:assert/strict';
import * as THREE from 'three';
import { updateBuildingBreach, releaseBuildingBreach, buildModel, setBuildings } from './client/unit-models.js';
import { UNITS, CELL } from './shared/sim.js';

const width = 32, x = 10 * CELL, z = 10 * CELL;
const root = new THREE.Group(), source = new THREE.BoxGeometry(CELL * 3, 3, CELL * 3);
const mesh = new THREE.Mesh(source, new THREE.MeshLambertMaterial()), ring = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial());
root.add(ring, mesh);
const unit = { id: 8, root, base: ring, tx: x + CELL / 2, tz: z + CELL / 2 };
const sectionCell = 10 * width + 10;
const sections = new Map([[sectionCell, { structureId: 'building:8', state: 'failed', material: 'wood' }]]);
const original = source.attributes.position.array.slice();
assert.equal(updateBuildingBreach(unit, sections, width, CELL), true);
assert.notEqual(mesh.geometry, source);
assert.equal(ring.geometry.userData.breach, undefined, 'the owner ring is not clipped');
assert.deepEqual(source.attributes.position.array, original, 'the model cache keeps its intact shared geometry');
const geometry = mesh.geometry, p = geometry.attributes.position;
// No triangle centroid lies within the failed footprint; broad roof triangles are split at section borders.
let retained = 0;
for (let i = 0; i < p.count; i += 3) {
  const cx = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3 + unit.tx;
  const cz = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3 + unit.tz;
  assert.ok(cx <= x + 1e-6 || cx >= x + CELL - 1e-6 || cz <= z + 1e-6 || cz >= z + CELL - 1e-6, 'surfaces inside the breach are gone');
  retained++;
}
assert.ok(retained > 0, 'supported building sections retain geometry');
assert.equal(updateBuildingBreach(unit, sections, width, CELL), false, 'unchanged snapshots do not allocate new geometry');
assert.equal(mesh.geometry, geometry);
assert.equal(unit.tx, x + CELL / 2, 'presentation never moves the building or chooses its obstruction');
assert.ok(mesh.geometry.attributes.normal && mesh.geometry.attributes.uv, 'surviving surfaces retain normals and texture coordinates');
let disposed = 0;
geometry.addEventListener('dispose', () => disposed++);
// Hidden changes are absent from the supplied recipient-known Map, so the remembered breach stays settled.
assert.equal(updateBuildingBreach(unit, new Map(sections), width, CELL), false);
sections.get(sectionCell).state = 'intact';
assert.equal(updateBuildingBreach(unit, sections, width, CELL), true);
assert.equal(mesh.geometry, source, 'delivered rebuilding restores the intact geometry');
assert.equal(disposed, 1, 'replaced clipped geometry is freed exactly once');
sections.get(sectionCell).state = 'failed';
updateBuildingBreach(unit, sections, width, CELL);
const replaced = mesh.geometry;
let released = 0; replaced.addEventListener('dispose', () => released++);
releaseBuildingBreach(unit);
assert.equal(released, 1); assert.equal(mesh.geometry, source);
releaseBuildingBreach(unit); assert.equal(released, 1, 'release is safe to repeat');

// Real model families, including a three-by-three footprint and multiple material meshes.
for (const type of ['hq', 'barracks', 'motorpool', 'depot', 'flakpos', 'worldbase', 'shipyard']) {
  const modelRoot = new THREE.Group(), building = { id: 9, type, root: modelRoot, models: [], tx: x + CELL / 2, tz: z + CELL / 2 };
  buildModel(building, modelRoot, { uniform: 0x596a41, vehicle: 0x59623d, color: 0x75965b }, 0, UNITS[type]);
  const delivered = new Map([[sectionCell, { structureId: 'building:9', state: 'failed' }]]);
  assert.equal(updateBuildingBreach(building, delivered, width, CELL), true);
  assert.ok(building.breach.meshes.every(entry => entry.mesh.geometry !== entry.base), `${type} has an owned partial model`);
  assert.ok(building.breach.meshes.some(entry => entry.mesh.geometry.attributes.position.count > 0), `${type} retains supported surfaces`);
  releaseBuildingBreach(building);
}
// Use the normal textured browser models with only image loading replaced by a headless adapter.
const loadTexture = THREE.TextureLoader.prototype.load;
THREE.TextureLoader.prototype.load = () => new THREE.Texture();
const { buildingModel } = await import('./client/structures.js');
THREE.TextureLoader.prototype.load = loadTexture;
setBuildings(buildingModel);
for (const type of ['hq', 'barracks', 'motorpool', 'depot']) {
  const nativeRoot = new THREE.Group(), native = { id: 11, type, root: nativeRoot, models: [], tx: unit.tx, tz: unit.tz };
  buildModel(native, nativeRoot, { uniform: 0x596a41, vehicle: 0x59623d, color: 0x75965b }, 0, UNITS[type]);
  const intact = nativeRoot.children[0].children[0].geometry;
  const known = new Map([[sectionCell, { structureId: 'building:11', state: 'failed', material: 'wood' }]]);
  updateBuildingBreach(native, known, width, CELL);
  assert.ok(native.breach.meshes[0].mesh.geometry.attributes.position.count > 0);
  assert.notDeepEqual(native.breach.meshes[0].mesh.geometry.attributes.position.array, intact.attributes.position.array, `${type} uses a visibly breached native mesh`);
  assert.equal(native.breach.meshes[0].mesh.geometry.attributes.uv.count, native.breach.meshes[0].mesh.geometry.attributes.position.count, 'native material coordinates survive clipping');
  releaseBuildingBreach(native);
}
setBuildings(null);
// A Ghost rebuilt from remembered delivered sections gets the same settled geometry without any event playback.
const ghostRoot = new THREE.Group(), ghostMesh = new THREE.Mesh(source, mesh.material.clone()); ghostRoot.add(ghostMesh);
const ghost = { id: 8, root: ghostRoot, tx: unit.tx, tz: unit.tz };
updateBuildingBreach(ghost, sections, width, CELL);
assert.deepEqual(ghostMesh.geometry.attributes.position.array, replaced.attributes.position.array);
releaseBuildingBreach(ghost);
console.log('building breach checks passed: partial live geometry, shared cache, supported sections, retained materials, bounded updates, rebuild, Ghost memory and disposal');
