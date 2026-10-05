// Cosmetic debris follows recipient-known rubble cells and never chooses obstacles.
import * as THREE from 'three';
import { CELL } from '../shared/sim.js';
import { fogShader } from './surfaces.js';

const CAPACITY = 2048, SEGMENTS = 4, VERTICES = 25, INDICES = 96;
const ATLAS = '/client/textures/fx-rubble-materials-v1.webp';
const quadrant = material => material === 'wood' ? 2
  : ['stone', 'concrete', 'steel'].includes(material) ? 1
  : ['soil', 'road'].includes(material) ? 3 : 0;

// Supply only changed, recipient-known cell keys. Initial hydration uses the same API.
export function createRubbleDecals({ parent, hAt, w, grid, materialAt = () => 'brick' }) {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(CAPACITY * VERTICES * 3);
  const uvs = new Float32Array(CAPACITY * VERTICES * 2);
  const normals = new Float32Array(positions.length);
  const indices = new Uint16Array(CAPACITY * INDICES);
  for (let slot = 0; slot < CAPACITY; slot++) {
    for (let v = 0; v < VERTICES; v++) normals[(slot * VERTICES + v) * 3 + 1] = 1;
    let offset = slot * INDICES;
    for (let z = 0; z < SEGMENTS; z++) for (let x = 0; x < SEGMENTS; x++) {
      const a = slot * VERTICES + z * (SEGMENTS + 1) + x;
      indices.set([a, a + 5, a + 1, a + 1, a + 5, a + 6], offset); offset += 6;
    }
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.setDrawRange(0, 0);
  const texture = new THREE.TextureLoader().load(ATLAS);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  const material = new THREE.MeshLambertMaterial({ map: texture, transparent: true, opacity: 0.9,
    alphaTest: 0.08, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  material.onBeforeCompile = fogShader;
  material.customProgramCacheKey = () => 'material-rubble-known-fog-v1';
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'material-rubble-decals'; mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  parent.add(mesh);
  const slots = new Map(), cells = [];
  let disposed = false;

  function write(slot, cell) {
    const cx = cell % w, cy = Math.floor(cell / w), q = quadrant(materialAt(cell));
    // Keep all geometry within its authoritative cell, including the rotated atlas.
    const turn = (Math.imul(cell + 1, 2654435761) >>> 30) & 3;
    for (let z = 0; z <= SEGMENTS; z++) for (let x = 0; x <= SEGMENTS; x++) {
      const i = slot * VERTICES + z * 5 + x, fx = x / SEGMENTS, fz = z / SEGMENTS;
      const px = (cx + 0.06 + fx * 0.88) * CELL, pz = (cy + 0.06 + fz * 0.88) * CELL;
      positions.set([px, hAt(px, pz) + 0.025, pz], i * 3);
      let u = fx, v = 1 - fz;
      for (let r = 0; r < turn; r++) [u, v] = [v, 1 - u];
      // Half-texel inset prevents adjacent atlas quadrants bleeding through mipmaps.
      uvs.set([(q % 2) * 0.5 + 0.001 + u * 0.498,
        (q < 2 ? 0.5 : 0) + 0.001 + v * 0.498], i * 2);
    }
  }

  return {
    mesh,
    update(changed) {
      if (disposed) return;
      let dirty = false;
      for (const cell of changed ?? []) {
        if (!Number.isInteger(cell) || cell < 0 || cell >= w * grid.length) continue;
        let slot = slots.get(cell);
        if (grid[Math.floor(cell / w)]?.[cell % w] === 'R') {
          if (slot === undefined) {
            if (cells.length >= CAPACITY) continue;
            slot = cells.length; cells.push(cell); slots.set(cell, slot);
          }
          write(slot, cell); dirty = true;
        } else if (slot !== undefined) {
          const last = cells.pop(); slots.delete(cell);
          if (slot < cells.length) {
            cells[slot] = last; slots.set(last, slot);
            positions.copyWithin(slot * VERTICES * 3, cells.length * VERTICES * 3, (cells.length + 1) * VERTICES * 3);
            uvs.copyWithin(slot * VERTICES * 2, cells.length * VERTICES * 2, (cells.length + 1) * VERTICES * 2);
          }
          dirty = true;
        }
      }
      if (dirty) {
        geometry.attributes.position.needsUpdate = true; geometry.attributes.uv.needsUpdate = true;
        geometry.setDrawRange(0, cells.length * INDICES);
      }
    },
    reset() {
      if (disposed) return;
      slots.clear(); cells.length = 0; geometry.setDrawRange(0, 0);
    },
    dispose() {
      if (disposed) return;
      disposed = true; slots.clear(); cells.length = 0;
      mesh.removeFromParent(); geometry.dispose(); material.dispose(); texture.dispose();
    },
  };
}
