// One terrain overlay buffer serves the slots, connecting line and facing arrow throughout a drag.
import { Batch, makeOverlay } from './overlay.js';
export function createFormationPreview({ THREE, hAt }) {
  const group = new THREE.Group(), material = makeOverlay({ color: 0x5fa4f2, opacity: 0.9, depthTest: false });
  const batch = new Batch(material, { colored: false, order: 6 });
  group.add(batch.mesh); group.visible = false;
  const sorted = [], points = [];
  function ribbon(ax, az, bx, bz) {
    points.length = 4; points[0] = ax; points[1] = az; points[2] = bx; points[3] = bz;
    batch.b.line(points, 2, { w: 0.24, min: 0.9, y: 0.16, step: 1.6 });
  }
  function chevron(x, z, fx, fz, length, halfWidth) {
    batch.b.arrow(x + fx * length / 2, z + fz * length / 2, fx, fz, length, halfWidth, { y: 0.16, rim: 0.05 });
  }
  // items carry { id, radius }; at.reach is the ground length of the drag.
  function show(spots, items, face, at, color) {
    batch.begin(); sorted.length = 0;
    if (!spots.length || !Number.isFinite(face) || !at) { hide(); return; }
    const fx = Math.cos(face), fz = Math.sin(face), ax = -fz, az = fx;
    for (let i = 0; i < spots.length; i++) sorted.push(i);
    sorted.sort((a, b) => {
      const p = spots[a], q = spots[b], rank = Math.round((q[1] * fx + q[2] * fz) * 100) - Math.round((p[1] * fx + p[2] * fz) * 100);
      return rank || (p[1] - q[1]) * ax + (p[2] - q[2]) * az;
    });
    for (let i = 1; i < sorted.length; i++) {
      const p = spots[sorted[i - 1]], q = spots[sorted[i]];
      if (Math.abs((p[1] - q[1]) * fx + (p[2] - q[2]) * fz) < 0.1) ribbon(p[1], p[2], q[1], q[2]);
    }
    for (const [id, x, z] of spots) {
      const item = items.find(v => v.id === id), radius = item?.radius ?? 1;
      const halfSide = Math.max(0.85, radius), halfDepth = Math.max(0.85, radius * 0.8);
      const x0 = x - ax * halfSide - fx * halfDepth, z0 = z - az * halfSide - fz * halfDepth;
      const x1 = x + ax * halfSide - fx * halfDepth, z1 = z + az * halfSide - fz * halfDepth;
      const x2 = x + ax * halfSide + fx * halfDepth, z2 = z + az * halfSide + fz * halfDepth;
      const x3 = x - ax * halfSide + fx * halfDepth, z3 = z - az * halfSide + fz * halfDepth;
      ribbon(x0, z0, x1, z1); ribbon(x1, z1, x2, z2); ribbon(x2, z2, x3, z3); ribbon(x3, z3, x0, z0);
      chevron(x + fx * (halfDepth + 0.65), z + fz * (halfDepth + 0.65), fx, fz, 0.9, 0.65);
    }
    const reach = Number.isFinite(at.reach) ? Math.max(2, at.reach) : 4, ex = at.x + fx * reach, ez = at.z + fz * reach;
    ribbon(at.x, at.z, ex, ez); chevron(ex, ez, fx, fz, 1.8, 1.15);
    material.color.setHex(color); batch.end(); group.visible = true;
  }
  function hide() { group.visible = false; }
  return { show, hide, group };
}
