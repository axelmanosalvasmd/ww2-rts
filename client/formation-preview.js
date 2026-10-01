// One terrain ribbon buffer serves the slots, connecting line and facing arrow throughout a drag.
export function createFormationPreview({ THREE, hAt }) {
  const group = new THREE.Group(), geometry = new THREE.BufferGeometry();
  const material = new THREE.MeshBasicMaterial({ color: 0x6fa8f0, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geometry, material); mesh.renderOrder = 6; mesh.frustumCulled = false; group.add(mesh); group.visible = false;
  let capacity = 0, position = null, used = 0;
  const sorted = [], width = 0.26;
  function reserve(vertices) {
    if (vertices <= capacity) return;
    capacity = Math.max(1024, capacity * 2, vertices);
    const next = new Float32Array(capacity * 3); if (position) next.set(position.array);
    position = new THREE.BufferAttribute(next, 3); position.setUsage(THREE.DynamicDrawUsage); geometry.setAttribute('position', position);
  }
  function vertex(x, z) {
    const i = used++ * 3; position.array[i] = x; position.array[i + 1] = hAt(x, z) + 0.3; position.array[i + 2] = z;
  }
  function triangle(ax, az, bx, bz, cx, cz) {
    reserve(used + 3); vertex(ax, az); vertex(bx, bz); vertex(cx, cz);
  }
  function ribbon(ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz); if (len < 1e-6) return;
    const nx = -dz / len * width / 2, nz = dx / len * width / 2, n = Math.ceil(len / 2);
    reserve(used + n * 6);
    for (let i = 0; i < n; i++) {
      const t0 = i / n, t1 = (i + 1) / n, x0 = ax + dx * t0, z0 = az + dz * t0, x1 = ax + dx * t1, z1 = az + dz * t1;
      vertex(x0 + nx, z0 + nz); vertex(x0 - nx, z0 - nz); vertex(x1 + nx, z1 + nz);
      vertex(x0 - nx, z0 - nz); vertex(x1 - nx, z1 - nz); vertex(x1 + nx, z1 + nz);
    }
  }
  function chevron(x, z, fx, fz, length, halfWidth) {
    const ax = -fz, az = fx, tx = x + fx * length / 2, tz = z + fz * length / 2;
    const bx = x - fx * length / 2, bz = z - fz * length / 2, nx = x - fx * length * 0.12, nz = z - fz * length * 0.12;
    triangle(tx, tz, bx + ax * halfWidth, bz + az * halfWidth, nx, nz);
    triangle(tx, tz, nx, nz, bx - ax * halfWidth, bz - az * halfWidth);
  }
  // items carry { id, radius }; at.reach is the ground length of the drag.
  function show(spots, items, face, at, color) {
    used = 0; sorted.length = 0;
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
    material.color.setHex(color); geometry.setDrawRange(0, used); position.needsUpdate = true; group.visible = true;
  }
  function hide() { group.visible = false; }
  return { show, hide, group };
}
