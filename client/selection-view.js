import * as THREE from 'three';

const envelopes = new WeakMap();
const edges = [[0, 1], [0, 2], [0, 4], [1, 3], [1, 5], [2, 3], [2, 6], [3, 7], [4, 5], [4, 6], [5, 7], [6, 7]];

// Absolute morph envelopes blend with the same weights as the rendered posture.
function localBounds(mesh) {
  const geometry = mesh.geometry;
  let boxes = envelopes.get(geometry);
  if (!boxes) {
    boxes = [geometry.attributes.position, ...(geometry.morphAttributes.position || [])]
      .map(position => new THREE.Box3().setFromBufferAttribute(position));
    envelopes.set(geometry, boxes);
  }
  const weights = mesh.morphTargetInfluences || [], box = new THREE.Box3();
  box.min.set(0, 0, 0); box.max.set(0, 0, 0);
  const add = (bounds, weight) => {
    box.min.addScaledVector(weight >= 0 ? bounds.min : bounds.max, weight);
    box.max.addScaledVector(weight >= 0 ? bounds.max : bounds.min, weight);
  };
  add(boxes[0], geometry.morphTargetsRelative ? 1 : 1 - weights.reduce((sum, w) => sum + w, 0));
  weights.forEach((weight, i) => { if (weight && boxes[i + 1]) add(boxes[i + 1], weight); });
  return box;
}

// Project each visible mesh separately so gaps between soldiers remain empty ground.
export function selectionPoints(v, camera, screenOf, width, height) {
  const points = v.garr ? [] : [screenOf(v)];
  const skip = new Set([v.base, v.sel, v.range]);
  camera.updateMatrixWorld();
  function visit(node) {
    if (!node.visible || skip.has(node)) return;
    if (node.isMesh && node.geometry?.attributes.position) {
      node.updateWorldMatrix(true, false);
      const box = localBounds(node), corners = [];
      for (let i = 0; i < 8; i++) corners.push(new THREE.Vector3(
        i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z
      ).applyMatrix4(node.matrixWorld).applyMatrix4(camera.matrixWorldInverse));
      const clipped = corners.filter(p => p.z <= -camera.near && p.z >= -camera.far);
      for (const [a, b] of edges) for (const z of [-camera.near, -camera.far]) {
        const from = corners[a], to = corners[b];
        if ((from.z < z) !== (to.z < z)) clipped.push(from.clone().lerp(to, (z - from.z) / (to.z - from.z)));
      }
      if (clipped.length) {
        const bounds = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
        for (const p of clipped) {
          p.applyMatrix4(camera.projectionMatrix);
          const x = (p.x + 1) * width / 2, y = (1 - p.y) * height / 2;
          bounds.x0 = Math.min(bounds.x0, x); bounds.x1 = Math.max(bounds.x1, x);
          bounds.y0 = Math.min(bounds.y0, y); bounds.y1 = Math.max(bounds.y1, y);
        }
        points.push({ x: (bounds.x0 + bounds.x1) / 2, y: (bounds.y0 + bounds.y1) / 2, bounds, front: true, radius: 6 });
      }
    }
    for (const child of node.children) visit(child);
  }
  if (v.root.visible && !v.garr) for (const model of v.models) visit(model);
  if (v.bars.visible) visit(v.bars);
  return points;
}
