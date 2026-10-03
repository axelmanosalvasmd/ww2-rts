// Export the game's mesh data for Blender QA. Rendering shaders are reviewed in the game viewer.
import * as THREE from 'three';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UNITS } from '../../shared/sim.js';
import { buildModel, setBuildings } from '../../client/unit-models.js';
import { plane, ROLES } from '../../client/models/planes.js';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const option = (key, fallback) => { const i = args.indexOf(key); return i < 0 ? fallback : args[i + 1]; };
const types = option('--types', 'lcvp,gunboat,destroyer').split(',');
const factions = option('--factions', '0').split(',').map(Number);
if (factions.some((fac) => !Number.isInteger(fac) || fac < 0 || fac > 3)) throw new Error('Factions must be 0, 1, 2 or 3');
const destination = resolve(option('--output', `${project}/.cache/blender-mcp/model-review.json`));
// Read the same faction look literals the viewer uses without evaluating its browser code.
const viewer = await readFile(`${project}/client/viewer.js`, 'utf8');
const factionSource = viewer.match(/const FACTIONS = (\[[\s\S]*?\n\]);/)?.[1];
if (!factionSource) throw new Error('Could not read viewer faction looks');
const looks = Function(`"use strict"; return (${factionSource});`)();
// Buildings use browser texture loading at module initialization. Keep the exact geometry with plain texture fallback.
const loadTexture = THREE.TextureLoader.prototype.load;
THREE.TextureLoader.prototype.load = () => new THREE.Texture();
try { setBuildings((await import('../../client/structures.js')).buildingModel); }
finally { THREE.TextureLoader.prototype.load = loadTexture; }
const models = [];
for (const fac of factions) for (const type of types) {
  if (!UNITS[type] && !ROLES.includes(type)) throw new Error(`Unknown model type: ${type}`);
  const root = new THREE.Group(), look = { ...looks[fac], color: 0x3b73d6 };
  const unit = { type, models: [], x: 0, z: 0, root };
  if (ROLES.includes(type)) root.add(new THREE.Mesh(plane(fac, type, look.color).geo, new THREE.MeshBasicMaterial({ vertexColors: true })));
  else if (type === 'airfield') throw new Error('Airfield export is not supported; review it in client/viewer.html');
  else buildModel(unit, root, look, fac, UNITS[type]);
  root.updateMatrixWorld(true);
  const meshes = [];
  root.traverse((mesh) => {
    if (!mesh.isMesh) return;
    for (let at = mesh; at; at = at.parent) if (!at.visible) return;
    const geo = mesh.geometry, attributes = {};
    for (const [name, attr] of Object.entries(geo.attributes)) attributes[name] = { itemSize: attr.itemSize, array: Array.from(attr.array) };
    meshes.push({ name: `${type}_f${fac}_${meshes.length}`, matrixWorld: mesh.matrixWorld.toArray(), attributes,
      indices: geo.index ? Array.from(geo.index.array) : null,
      materialColor: mesh.material.color?.toArray() ?? [1, 1, 1],
      doubleSided: mesh.material.side === THREE.DoubleSide,
      morphTargets: Object.fromEntries(Object.entries(geo.morphAttributes).map(([name, list]) => [name, list.map((a) => ({ itemSize: a.itemSize, array: Array.from(a.array) }))])),
    });
  });
  const bounds = new THREE.Box3().setFromObject(root);
  models.push({ type, faction: fac, factionName: looks[fac].name, bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() }, meshes });
}
const data = { schema: 'ww2-rts-blender-review-v1', axes: 'Three.js x,y,z maps to Blender x,-z,y', colors: 'linear RGB',
  shaderLimit: 'Game triplanar textures, aircraft camouflage shader and animations are not reproduced in Blender. Mesh attributes and morph targets are retained.', models };
await mkdir(dirname(destination), { recursive: true });
await writeFile(destination, `${JSON.stringify(data)}\n`);
console.log(JSON.stringify({ output: destination, models: models.map((m) => ({ type: m.type, faction: m.faction, meshes: m.meshes.length,
  triangles: m.meshes.reduce((n, s) => n + (s.indices?.length ?? s.attributes.position.array.length / 3) / 3, 0), bounds: m.bounds })) }, null, 2));
