// World Conquest railways: the track and stations this player has explored. Each track cell arrives with its terrain
// data as a bit per direction its rails leave by (RAIL_DIRS), so every cell draws its own half of each joint: the
// track runs on as more is explored and ends at the edge of the known world. Instanced ballast, sleepers and rails,
// rebuilt at most twice a second; a station is a platform, a station house and a water tower beside the line.
import * as THREE from 'three';
import { CELL, RAIL_DIRS } from '../shared/sim.js';
import { fogShader } from './surfaces.js';

const GAUGE = 0.72, SLEEPER_GAP = 0.66;
const lit = (color, extra = {}) => {
  const m = new THREE.MeshLambertMaterial({ color, ...extra });
  m.onBeforeCompile = fogShader; m.customProgramCacheKey = () => 'rail-known-fog-v1';
  return m;
};
const MATERIAL = { ballast: lit(0x5f5a52), sleeper: lit(0x4b3b2b), rail: lit(0x8f9297), platform: lit(0x8d877b), brick: lit(0x8a4a36),
  roof: lit(0x4d4f55), wood: lit(0x6e5638), tank: lit(0x3e4a44), trim: lit(0xd8cfb8) };

// center(region): that region's objective { x, z } when known; the station house stands on the side away from it
export function createRailways({ parent, hAt, w, center = () => null }) {
  const group = new THREE.Group(); group.name = 'railways'; parent.add(group);
  const track = new Map(), stations = new Map(), built = new Map();
  let dirty = false, wait = 0, meshes = [], waiting = 0; // waiting: stations whose town is not known yet
  const box = new THREE.BoxGeometry(1, 1, 1);

  // cells: start or snapshot terrain rows [cell, ch, level, state, data]
  function cells(rows) {
    for (const [c, , , , data] of rows ?? []) {
      if (data?.rail && track.get(c) !== data.rail) { track.set(c, data.rail); dirty = true; }
      if (data?.station !== undefined && !stations.has(c)) { stations.set(c, data.station); dirty = true; }
    }
  }
  function frame(dt) {
    if ((wait -= dt) > 0 || !(dirty || waiting)) return;
    if (dirty) rebuild();
    dirty = false; wait = 0.5;
    buildStations();
  }
  function rebuild() {
    for (const m of meshes) { group.remove(m); m.dispose?.(); }
    meshes = [];
    // half segments: from each cell's centre toward each direction it has
    const halves = [];
    for (const [c, mask] of track) {
      const x = (c % w + 0.5) * CELL, z = (Math.floor(c / w) + 0.5) * CELL;
      for (let d = 0; d < 8; d++) if (mask & 1 << d) {
        const [dx, dz] = RAIL_DIRS[d];
        halves.push([x, z, x + dx * CELL / 2, z + dz * CELL / 2]);
      }
    }
    const sleepers = halves.reduce((n, [x0, z0, x1, z1]) => n + Math.max(1, Math.round(Math.hypot(x1 - x0, z1 - z0) / SLEEPER_GAP)), 0);
    const ballast = new THREE.InstancedMesh(box, MATERIAL.ballast, halves.length), ties = new THREE.InstancedMesh(box, MATERIAL.sleeper, sleepers),
      rails = new THREE.InstancedMesh(box, MATERIAL.rail, halves.length * 2);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
    let ti = 0;
    halves.forEach(([x0, z0, x1, z1], i) => {
      const len = Math.hypot(x1 - x0, z1 - z0), y0 = hAt(x0, z0), y1 = hAt(x1, z1), yaw = Math.atan2(x1 - x0, z1 - z0), pitch = -Math.atan2(y1 - y0, len);
      e.set(pitch, yaw, 0, 'YXZ'); q.setFromEuler(e);
      const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)), mid = (k, up) => p.set(x0 + (x1 - x0) * k, y0 + (y1 - y0) * k + up, z0 + (z1 - z0) * k);
      ballast.setMatrixAt(i, m.compose(mid(0.5, 0.05), q, s.set(2.3, 0.14, len + 0.05)));
      for (const side of [-1, 1]) rails.setMatrixAt(i * 2 + (side > 0), m.compose(mid(0.5, 0.25).addScaledVector(right, side * GAUGE), q, s.set(0.09, 0.13, len + 0.02)));
      const n = Math.max(1, Math.round(len / SLEEPER_GAP));
      for (let k = 0; k < n; k++) ties.setMatrixAt(ti++, m.compose(mid((k + 0.5) / n, 0.15), q, s.set(2.0, 0.09, 0.24)));
    });
    for (const im of [ballast, ties, rails]) { im.instanceMatrix.needsUpdate = true; im.receiveShadow = true; im.frustumCulled = false; group.add(im); meshes.push(im); }
  }
  function buildStations() {
    waiting = 0;
    for (const [c, region] of stations) if (!built.has(c)) {
      if (!center(region) && (waiting = 1)) continue; // built once its region's centre is known
      const mask = track.get(c) ?? 1, d = [0, 1, 2, 3, 4, 5, 6, 7].find(k => mask & 1 << k) ?? 0, [dx, dz] = RAIL_DIRS[d];
      const x = (c % w + 0.5) * CELL, z = (Math.floor(c / w) + 0.5) * CELL, yaw = Math.atan2(dx, dz), town = center(region);
      // the house is on the station's +x side: turn it round when the town lies that way
      const st = station(yaw + ((town.x - x) * Math.cos(yaw) - (town.z - z) * Math.sin(yaw) > 0 ? Math.PI : 0));
      st.position.set(x, hAt(x, z), z); st.userData.region = region;
      group.add(st); built.set(c, st);
    }
  }
  // along the track (+z in its frame): a long platform on one side, the station house behind it, a water tower
  function station(yaw) {
    const g = new THREE.Group(), part = (mat, sx, sy, sz, x, y, z) => { const o = new THREE.Mesh(box, mat); o.scale.set(sx, sy, sz); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; g.add(o); return o; };
    part(MATERIAL.platform, 3.2, 0.7, 16, 2.9, 0.35, 0);
    part(MATERIAL.trim, 0.25, 0.08, 16, 1.35, 0.72, 0);
    part(MATERIAL.brick, 4.4, 3.4, 9, 6.6, 1.7, 0);
    const roof = part(MATERIAL.roof, 3.6, 0.25, 10, 5.4, 3.9, 0); roof.rotation.z = 0.5;
    const roof2 = part(MATERIAL.roof, 3.6, 0.25, 10, 7.8, 3.9, 0); roof2.rotation.z = -0.5;
    part(MATERIAL.wood, 2.6, 0.12, 6, 3.4, 3.1, 0); // the platform canopy
    for (const z of [-2.6, 2.6]) part(MATERIAL.wood, 0.14, 2.4, 0.14, 2.3, 1.9, z);
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 1.8, 10), MATERIAL.tank); tank.position.set(-3.4, 4.2, 6); tank.castShadow = true; g.add(tank);
    for (const [x, z] of [[-4, 5.4], [-2.8, 5.4], [-4, 6.6], [-2.8, 6.6]]) part(MATERIAL.wood, 0.16, 3.3, 0.16, x, 1.65, z);
    g.rotation.y = yaw;
    return g;
  }
  function dispose() { for (const m of meshes) m.dispose?.(); parent.remove(group); }
  return { cells, frame, dispose, has: (c) => track.has(c) || stations.has(c), track: () => track.keys(), stations: () => [...stations.entries()].map(([c, region]) => ({ region, x: (c % w + 0.5) * CELL, z: (Math.floor(c / w) + 0.5) * CELL })), group };
}
