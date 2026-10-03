// Cell centres retain their simulation height. Only connected neighbours share a ramp;
// disconnected cliff sides have separate vertices and a vertical rock strip between them.
import * as THREE from 'three';
import { CELL, CFG, levelOf } from '../shared/sim.js';
import { createWaterLevels, WATER_LIFT } from './water-levels.js';
import { createReliefMaterial } from './relief-material.js';
export { createReliefMaterial } from './relief-material.js';

const S = 4, STRIDE = 25;
// Trench cells ('T') are cut into the mesh: the inner 3x3 nodes drop by this much, and the channel runs on through
// the edge nodes shared with a neighbouring trench cell. Purely visual: the sim's cover and sight lines ignore it.
export const TRENCH_DEPTH = 0.9;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = t => t * t * (3 - 2 * t);
// Cell-scale noise for a crater rim. The ground fBm is too broad to break a bowl's outline.
function fieldNoise(u, v, k) {
  const x0 = Math.floor(u), y0 = Math.floor(v), tx = u - x0, ty = v - y0;
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  const n = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7 + k * 74.7) * 43758.5453; return s - Math.floor(s); };
  const a = n(x0, y0), b = n(x0 + 1, y0), c = n(x0, y0 + 1), d = n(x0 + 1, y0 + 1);
  return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
}

export function createRelief(map, grid = map.rows, options = {}) {
  const { w, h } = map, n = w * h, qw = w + 1;
  const levels = new Int8Array(n), roads = new Uint8Array(n);
  const masks = new Uint16Array((w + 1) * (h + 1));
  const heights = new Float32Array(n * STRIDE), normals = new Float32Array(n * STRIDE * 3);
  const nx = new Uint8Array(n), nz = new Uint8Array(n), flat = new Uint8Array(n);
  const controls = new Float32Array(n * 9), roadCorners = new Float32Array(n * 4);
  const waterSource = createWaterLevels(map);
  let water, depth, low = !!options.low;
  const material = options.material ?? createReliefMaterial(options.texture ?? null, { low });
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
  mesh.receiveShadow = true;
  mesh.castShadow = false; // seen from above the ground hardly shades itself; it still takes the shadows of all else
  const stats = { vertices: 0, triangles: 0, cliffEdges: 0, buildMs: 0, updateMs: 0, cellsUpdated: 0 };
  const baseValues = new Float32Array(25), baseDx = new Float32Array(25), baseDz = new Float32Array(25);
  const waterDx = new Float32Array(9), waterDz = new Float32Array(9);
  const out = new Float64Array(6), ids = new Int32Array(4), weights = new Float64Array(4), dxs = new Float64Array(4), dzs = new Float64Array(4);
  const idAt = (x, y) => clamp(y, 0, h - 1) * w + clamp(x, 0, w - 1);

  function readCell(c) {
    const x = c % w, y = Math.floor(c / w);
    levels[c] = levelOf(map.heights?.[y]?.[x] ?? '0');
    roads[c] = options.isRoad?.(x, y) ? 1 : 0;
  }
  function readQuad(x, y) {
    const a = levels[idAt(x - 1, y - 1)], b = levels[idAt(x, y - 1)];
    const c = levels[idAt(x - 1, y)], d = levels[idAt(x, y)];
    const edges = [1, 2, 4, 8];
    if (Math.abs(a - b) < 2) { edges[0] |= 2; edges[1] |= 1; }
    if (Math.abs(a - c) < 2) { edges[0] |= 4; edges[2] |= 1; }
    if (Math.abs(b - d) < 2) { edges[1] |= 8; edges[3] |= 2; }
    if (Math.abs(c - d) < 2) { edges[2] |= 8; edges[3] |= 4; }
    let packed = 0;
    for (let seed = 0; seed < 4; seed++) {
      let bits = edges[seed];
      for (let pass = 0; pass < 3; pass++) for (let k = 0; k < 4; k++) if (bits & (1 << k)) bits |= edges[k];
      packed |= bits << (seed * 4);
    }
    masks[y * qw + x] = packed;
  }
  function readWater() {
    water = waterSource.read(grid);
    depth = new Uint8Array(n).fill(3);
    // Saturated distance needs just two local passes, including bridge shallows.
    for (let c = 0; c < n; c++) {
      if (!water.wet[c] || water.bridges[c]) { depth[c] = 0; continue; }
      const x = c % w, y = Math.floor(c / w);
      if ((x > 0 && !water.wet[c - 1]) || (x + 1 < w && !water.wet[c + 1]) ||
          (y > 0 && !water.wet[c - w]) || (y + 1 < h && !water.wet[c + w])) depth[c] = 1;
    }
    for (let c = 0; c < n; c++) if (depth[c] > 1) {
      const x = c % w, y = Math.floor(c / w);
      if ((x > 0 && depth[c - 1] <= 1) || (x + 1 < w && depth[c + 1] <= 1) ||
          (y > 0 && depth[c - w] <= 1) || (y + 1 < h && depth[c + w] <= 1)) depth[c] = 2;
    }
  }

  // Smooth interpolation and its derivatives, evaluated on one specified side of a boundary.
  function sample(u, v, owner, nearWet) {
    baseSample(u, v, owner); roadSample(u, v, owner); out[3] = out[0]; out[4] = out[1]; out[5] = out[2];
    if (!nearWet) return;
    const initialHeight = out[0], initialX = out[1], initialZ = out[2];
    const qx = clamp(Math.floor(u + 0.5), 0, w), qz = clamp(Math.floor(v + 0.5), 0, h);
    const tx = clamp(u - qx + 0.5, 0, 1), tz = clamp(v - qz + 0.5, 0, 1);
    const ex = ease(tx), ez = ease(tz), dex = 6 * tx * (1 - tx) / CELL, dez = 6 * tz * (1 - tz) / CELL;
    ids[0] = idAt(qx - 1, qz - 1); ids[1] = idAt(qx, qz - 1);
    ids[2] = idAt(qx - 1, qz); ids[3] = idAt(qx, qz);
    const ox = owner % w, oz = Math.floor(owner / w), seed = (ox >= qx ? 1 : 0) + (oz >= qz ? 2 : 0);
    const bits = (masks[qz * qw + qx] >> (seed * 4)) & 15;
    weights[0] = (1 - ex) * (1 - ez); weights[1] = ex * (1 - ez); weights[2] = (1 - ex) * ez; weights[3] = ex * ez;
    dxs[0] = -dex * (1 - ez); dxs[1] = dex * (1 - ez); dxs[2] = -dex * ez; dxs[3] = dex * ez;
    dzs[0] = -(1 - ex) * dez; dzs[1] = -ex * dez; dzs[2] = (1 - ex) * dez; dzs[3] = ex * dez;
    let sum = 0, sx = 0, sz = 0, height = initialHeight, hx = initialX, hz = initialZ;
    let wet = 0, wx = 0, wz = 0, bed = 0, bx = 0, bz = 0, bridge = 0, gx = 0, gz = 0;
    for (let k = 0; k < 4; k++) if (bits & (1 << k)) {
      const c = ids[k], a = weights[k], ax = dxs[k], az = dzs[k];
      sum += a; sx += ax; sz += az;
      if (water.bridges[c]) { bridge += a; gx += ax; gz += az; }
      else if (water.wet[c]) {
        // Raised spans use the draped surface, so carving also fades before their dike.
        const target = water.wl[c] + WATER_LIFT - (grid[Math.floor(c / w)][c % w] === 'F' ? 0.15 : 0.42 + 0.38 * (depth[c] - 1));
        wet += a; wx += ax; wz += az; bed += a * target; bx += ax * target; bz += az * target;
      }
    }
    if (wet > 0.000001) {
      const target = bed / wet, targetX = (bx * wet - bed * wx) / (wet * wet), targetZ = (bz * wet - bed * wz) / (wet * wet);
      const wetX = (wx * sum - wet * sx) / (sum * sum), wetZ = (wz * sum - wet * sz) / (sum * sum), amount = wet / sum;
      const bridgeX = (gx * sum - bridge * sx) / (sum * sum), bridgeZ = (gz * sum - bridge * sz) / (sum * sum);
      const t = clamp(amount / 0.08, 0, 1), bt = clamp(bridge / sum / 0.45, 0, 1);
      const fade = 1 - ease(bt), carving = ease(t) * fade;
      const kx = 6 * t * (1 - t) / 0.08 * wetX * fade - ease(t) * 6 * bt * (1 - bt) / 0.45 * bridgeX;
      const kz = 6 * t * (1 - t) / 0.08 * wetZ * fade - ease(t) * 6 * bt * (1 - bt) / 0.45 * bridgeZ;
      if (target < height) { hx += (targetX - hx) * carving + (target - height) * kx; hz += (targetZ - hz) * carving + (target - height) * kz; height += (target - height) * carving; }
    }
    out[0] = height; out[1] = hx; out[2] = hz;
  }

  function controlCell(c) {
    const x = c % w, z = Math.floor(c / w), off = c * 9;
    controls[off + 4] = levels[c] * CFG.levelHeight;
    for (let side = 0; side < 4; side++) {
      const other = idAt(x + (side === 0 ? -1 : side === 1 ? 1 : 0), z + (side === 2 ? -1 : side === 3 ? 1 : 0));
      controls[off + [3, 5, 1, 7][side]] = (Math.abs(levels[c] - levels[other]) < 2 ? (levels[c] + levels[other]) * 0.5 : levels[c]) * CFG.levelHeight;
    }
    for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
      const qx = x + i, qz = z + j, seed = (1 - i) + (1 - j) * 2;
      const bits = (masks[qz * qw + qx] >> (seed * 4)) & 15;
      let sum = 0, count = 0, road = 0, building = false;
      for (let k = 0; k < 4; k++) {
        const id = idAt(qx - 1 + (k & 1), qz - 1 + (k >> 1));
        road += roads[id] * 0.25;
        building ||= grid[Math.floor(id / w)][id % w] === 'B';
        if (bits & (1 << k)) { sum += levels[id]; count++; }
      }
      controls[off + j * 6 + i * 2] = sum / count * CFG.levelHeight;
      roadCorners[c * 4 + j * 2 + i] = building ? 0 : road;
    }
  }
  function baseSample(u, v, owner) {
    const x = owner % w, z = Math.floor(owner / w), fx = clamp((u - x) * 2, 0, 2), fz = clamp((v - z) * 2, 0, 2);
    const i = Math.min(1, Math.floor(fx)), j = Math.min(1, Math.floor(fz)), tx = fx - i, tz = fz - j;
    const ex = i ? 2 * ease(tx * 0.5) : 1 - 2 * ease((1 - tx) * 0.5);
    const ez = j ? 2 * ease(tz * 0.5) : 1 - 2 * ease((1 - tz) * 0.5);
    const dx = 6 * (i ? tx * 0.5 : (1 - tx) * 0.5) * (1 - (i ? tx * 0.5 : (1 - tx) * 0.5)) * 2 / CELL;
    const dz = 6 * (j ? tz * 0.5 : (1 - tz) * 0.5) * (1 - (j ? tz * 0.5 : (1 - tz) * 0.5)) * 2 / CELL;
    const k = owner * 9 + j * 3 + i, a = controls[k], b = controls[k + 1], c = controls[k + 3], d = controls[k + 4];
    out[0] = (a + (b - a) * ex) * (1 - ez) + (c + (d - c) * ex) * ez;
    out[1] = ((b - a) * (1 - ez) + (d - c) * ez) * dx;
    out[2] = ((c - a) * (1 - ex) + (d - b) * ex) * dz;
  }
  // A shallow centre fan makes road shoulders cheap and keeps building centres unsunk.
  function roadSample(u, v, owner) {
    const x = u - owner % w - 0.5, z = v - Math.floor(owner / w) - 0.5, k = owner * 4, centre = roads[owner];
    let a, b, amount, rx, rz;
    if (Math.abs(z) >= Math.abs(x)) {
      a = roadCorners[k + (z < 0 ? 0 : 2)]; b = roadCorners[k + (z < 0 ? 1 : 3)];
      amount = centre + Math.abs(z) * (a + b - 2 * centre) + x * (b - a);
      rx = (b - a) / CELL; rz = Math.sign(z) * (a + b - 2 * centre) / CELL;
    } else {
      a = roadCorners[k + (x < 0 ? 0 : 1)]; b = roadCorners[k + (x < 0 ? 2 : 3)];
      amount = centre + Math.abs(x) * (a + b - 2 * centre) + z * (b - a);
      rx = Math.sign(x) * (a + b - 2 * centre) / CELL; rz = (b - a) / CELL;
    }
    out[0] -= 0.1 * amount; out[1] -= 0.1 * rx; out[2] -= 0.1 * rz;
  }

  // A blast's bowl is a smoothstep between cell centres, so a stick of bombs reads as a row of rounded squares.
  // The height of that cross stays on the sim (the relief checks sample only the height). On a stick the banks
  // slide along the run, and the ground between the spokes sinks, or each bowl stays a closed octagon.
  // A sideways shove uses the world position, so both cells of a shared edge move together.
  // Intact ground, where no crater or rubble touches the point, is left alone.
  const shift = new Float64Array(2), torn = new Uint8Array(n);
  function touch(wu, wv) {
    // The four cells around the nearest corner. A southwest-only window missed the north lip of a trench,
    // so that bank stayed a straight cut while the south bank moved.
    const ix = Math.round(wu), iz = Math.round(wv);
    let minL = 99, maxL = -99, scar = false, gx = 0, gz = 0, inside = true;
    for (let dz = 0; dz <= 1; dz++) for (let dx = 0; dx <= 1; dx++) {
      const x = ix - 1 + dx, z = iz - 1 + dz, L = levels[idAt(x, z)];
      if (L < minL) minL = L;
      if (L > maxL) maxL = L;
      gx += L * (dx - 0.5); gz += L * (dz - 0.5);
      const onMap = x >= 0 && z >= 0 && x < w && z < h;
      const dug = onMap && (grid[z][x] === '+' || grid[z][x] === 'R');
      if (dug) scar = true;
      if (!dug) inside = false;
    }
    return { span: maxL - minL, scar, gx, gz, minL, inside };
  }
  // A bombing run is a long scar. A lone hit and a block are not, and they keep the softer shove below.
  function scarRun(wu, wv) {
    const cx = Math.round(wu - 0.5), cz = Math.round(wv - 0.5);
    let n = 0, sx = 0, sz = 0, sxx = 0, szz = 0, sxz = 0;
    for (let dz = -5; dz <= 5; dz++) for (let dx = -5; dx <= 5; dx++) {
      const x = cx + dx, z = cz + dz;
      if (x < 0 || z < 0 || x >= w || z >= h) continue;
      const ch = grid[z][x];
      if (ch !== '+' && ch !== 'R') continue;
      const px = x + 0.5, pz = z + 0.5;
      n++; sx += px; sz += pz; sxx += px * px; szz += pz * pz; sxz += px * pz;
    }
    if (n < 6) return null;
    const mx = sx / n, mz = sz / n;
    const cxx = sxx / n - mx * mx, czz = szz / n - mz * mz, cxz = sxz / n - mx * mz;
    const tr = cxx + czz, det = cxx * czz - cxz * cxz;
    const major = tr * 0.5 + Math.sqrt(Math.max(0, tr * tr * 0.25 - det));
    const minor = tr - major;
    if (!(major > 1.6 && minor < major * 0.42)) return null;
    let ax, az;
    if (Math.abs(cxz) < 1e-6) { if (cxx >= czz) { ax = 1; az = 0; } else { ax = 0; az = 1; } }
    else { ax = cxz; az = major - cxx; }
    if (ax < 0 || (ax === 0 && az < 0)) { ax = -ax; az = -az; }
    const len = Math.hypot(ax, az) || 1;
    return { ax: ax / len, az: az / len };
  }
  function lipShift(wu, wv) {
    shift[0] = shift[1] = 0;
    const t = touch(wu, wv);
    if (!t.scar || (t.span < 1 && !t.inside)) return shift;
    // The pale lip runs through the cell centres. A shove that is the same on every side of one bowl
    // only moves the octagon. Along a stick the two banks spread and sway together, a few metres at a time.
    // Movement still uses the unshifted height, so a unit can stand a few metres off the visible lip.
    // A shorter wave folds the surface. The cap keeps a shared edge from crossing itself.
    const run = scarRun(wu, wv);
    let dx = 0, dz = 0;
    if (run) {
      const along = wu * run.ax + wv * run.az, px = -run.az, pz = run.ax;
      const side = Math.max(-1, Math.min(1, t.gx * px + t.gz * pz));
      const width = (fieldNoise(along * 0.08 + 1.7, 4.2, 4) * 2 - 1) * 0.8;
      const sway = (fieldNoise(along * 0.045 + 9.1, 1.3, 6) * 2 - 1) * 1.35;
      const alongJ = (fieldNoise(along * 0.07 + 3.1, 8.8, 8) * 2 - 1) * 0.35;
      // Sway alone slides each bowl along the stick. This nick pushes the lip in and out
      // around one bomb, short enough to bend the ring and long enough not to fold it.
      const nick = (fieldNoise(wu * 0.2 + 2.4, wv * 0.17 + 6.1, 9) * 2 - 1) * 0.7;
      const glen = Math.hypot(t.gx, t.gz) || 1;
      dx = px * (side * width + sway) + run.ax * alongJ + (t.gx / glen) * nick;
      dz = pz * (side * width + sway) + run.az * alongJ + (t.gz / glen) * nick;
    } else {
      const radial = (fieldNoise(wu * 0.18 + 1.7, wv * 0.16 + 4.2, 2) * 2 - 1) * 0.65;
      const tangent = (fieldNoise(wu * 0.11 + 3.3, wv * 0.09 + 9.1, 8) * 2 - 1) * 0.22;
      const glen = Math.hypot(t.gx, t.gz) || 1, rx = t.gx / glen, rz = t.gz / glen;
      dx = rx * radial - rz * tangent;
      dz = rz * radial + rx * tangent;
    }
    const mag = Math.hypot(dx, dz), cap = 2.1;
    if (mag > cap) { dx *= cap / mag; dz *= cap / mag; }
    shift[0] = dx; shift[1] = dz;
    return shift;
  }
  function chewScar(x, z, off) {
    let moved = false;
    for (let j = 0; j <= S; j++) for (let i = 0; i <= S; i++) {
      if (i === 2 || j === 2) continue;
      const wu = x + i / S, wv = z + j / S, t = touch(wu, wv);
      if (!t.scar || t.span < 1) continue;
      const here = heights[off + j * 5 + i];
      const rise = (here - t.minL * CFG.levelHeight) / (CFG.levelHeight * Math.max(1, t.span));
      const bite = fieldNoise(wu * 0.23 + 4.2, wv * 0.19 + 1.1, 5);
      // Bite the high lip only. Sinking the floor leaves the locked spokes standing up as a plus sign.
      if (rise > 0.45) heights[off + j * 5 + i] -= Math.min(1.15, (rise - 0.45) * (0.7 + 1.5 * bite));
      moved = true;
    }
    if (moved) torn[x + z * w] = 1;
    if (!moved) return;
    for (let j = 0; j <= S; j++) for (let i = 0; i <= S; i++) {
      const i0 = Math.max(0, i - 1), i1 = Math.min(S, i + 1), j0 = Math.max(0, j - 1), j1 = Math.min(S, j + 1);
      const dx = (heights[off + j * 5 + i1] - heights[off + j * 5 + i0]) / ((i1 - i0) * CELL / S);
      const dz = (heights[off + j1 * 5 + i] - heights[off + j0 * 5 + i]) / ((j1 - j0) * CELL / S);
      const inv = 1 / Math.hypot(dx, 1, dz), k = off + j * 5 + i;
      normals[k * 3] = -dx * inv; normals[k * 3 + 1] = inv; normals[k * 3 + 2] = -dz * inv;
    }
  }
  function buildCell(c) {
    const x = c % w, z = Math.floor(c / w), off = c * STRIDE;
    torn[c] = 0;
    const dug = grid[z][x] === 'T';
    let constant = !dug, reference = levels[c], nearWet = false, nearRoad = false;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const k = idAt(x + i, z + j);
      if (levels[k] !== reference) constant = false;
      if (water.wet[k]) nearWet = true;
      if (roads[k]) nearRoad = true;
    }
    if (constant && !nearWet) {
      if (!nearRoad) {
        heights.fill(reference * CFG.levelHeight, off, off + STRIDE);
        for (let k = off; k < off + STRIDE; k++) { normals[k * 3] = normals[k * 3 + 2] = 0; normals[k * 3 + 1] = 1; }
        nx[c] = nz[c] = flat[c] = 1; return;
      }
      const shape = 2;
      for (let j = 0; j <= S; j++) for (let i = 0; i <= S; i++) {
        const k = off + j * 5 + i;
        out[0] = reference * CFG.levelHeight; out[1] = out[2] = 0;
        if (nearRoad) roadSample(x + i / S, z + j / S, c);
        heights[k] = out[0]; const inv = 1 / Math.hypot(out[1], 1, out[2]);
        normals[k * 3] = -out[1] * inv; normals[k * 3 + 1] = inv; normals[k * 3 + 2] = -out[2] * inv;
      }
      nx[c] = nz[c] = 1; flat[c] = shape === 2 && heights[off] === heights[off + 12] && heights[off] === heights[off + 4] && heights[off] === heights[off + 20] && heights[off] === heights[off + 24] ? 1 : shape; return;
    }
    let wetFlat = constant && !nearRoad && grid[z][x] === 'W';
    if (wetFlat) for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const k = idAt(x + i, z + j);
      if (grid[Math.floor(k / w)][k % w] !== 'W' || depth[k] !== depth[c] || water.wl[k] !== water.wl[c]) wetFlat = false;
    }
    if (wetFlat) {
      const target = water.wl[c] + WATER_LIFT - 0.42 - 0.38 * (depth[c] - 1);
      heights.fill(Math.min(reference * CFG.levelHeight, target), off, off + STRIDE);
      for (let k = off; k < off + STRIDE; k++) { normals[k * 3] = normals[k * 3 + 2] = 0; normals[k * 3 + 1] = 1; }
      nx[c] = nz[c] = flat[c] = 1; return;
    }
    for (let j = 0; j <= S; j++) for (let i = 0; i <= S; i++) {
      sample(x + i / S, z + j / S, c, nearWet);
      const k = off + j * 5 + i, inv = 1 / Math.hypot(out[1], 1, out[2]);
      heights[k] = out[0]; baseValues[j * 5 + i] = out[3]; baseDx[j * 5 + i] = out[4]; baseDz[j * 5 + i] = out[5]; normals[k * 3] = -out[1] * inv; normals[k * 3 + 1] = inv; normals[k * 3 + 2] = -out[2] * inv;
    }
    // Water displacement uses a shared half-cell lattice. Fine ramps keep their own density.
    if (nearWet) {
      const delta = (i, j) => heights[off + j * 10 + i * 2] - baseValues[j * 10 + i * 2];
      for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) {
        const left = Math.max(0, i - 1), right = Math.min(2, i + 1), top = Math.max(0, j - 1), bottom = Math.min(2, j + 1);
        waterDx[j * 3 + i] = (delta(right, j) - delta(left, j)) / ((right - left) * CELL / 2);
        waterDz[j * 3 + i] = (delta(i, bottom) - delta(i, top)) / ((bottom - top) * CELL / 2);
      }
      for (let j = 0; j <= S; j++) for (let i = 0; i <= S; i++) {
        const ix = Math.min(1, Math.floor(i / 2)), iz = Math.min(1, Math.floor(j / 2)), tx = i / 2 - ix, tz = j / 2 - iz, a = iz * 10 + ix * 2;
        if ((i & 1) || (j & 1)) {
          const A = heights[off + a] - baseValues[a], B = heights[off + a + 2] - baseValues[a + 2];
          const C = heights[off + a + 10] - baseValues[a + 10], D = heights[off + a + 12] - baseValues[a + 12];
          heights[off + j * 5 + i] = baseValues[j * 5 + i] + (tx + tz <= 1 ? A + (B - A) * tx + (C - A) * tz : D + (C - D) * (1 - tx) + (B - D) * (1 - tz));
        }
        const k = iz * 3 + ix, node = off + j * 5 + i;
        const dx = baseDx[j * 5 + i] + (waterDx[k] * (1 - tx) + waterDx[k + 1] * tx) * (1 - tz) + (waterDx[k + 3] * (1 - tx) + waterDx[k + 4] * tx) * tz;
        const dz = baseDz[j * 5 + i] + (waterDz[k] * (1 - tx) + waterDz[k + 1] * tx) * (1 - tz) + (waterDz[k + 3] * (1 - tx) + waterDz[k + 4] * tx) * tz;
        const inv = 1 / Math.hypot(dx, 1, dz);
        normals[node * 3] = -dx * inv; normals[node * 3 + 1] = inv; normals[node * 3 + 2] = -dz * inv;
      }
    } else chewScar(x, z, off);
    if (dug) {
      const T = (dx, dz) => grid[z + dz]?.[x + dx] === 'T';
      const w0 = T(-1, 0), e = T(1, 0), n0 = T(0, -1), s = T(0, 1);
      for (let j = 0; j <= S; j++) for (let i = 0; i <= S; i++) {
        const inI = i > 0 && i < S, inJ = j > 0 && j < S;
        if ((inI && inJ) || (inJ && ((i === 0 && w0) || (i === S && e))) || (inI && ((j === 0 && n0) || (j === S && s)))) heights[off + j * 5 + i] -= TRENCH_DEPTH;
      }
      // the walls are steep, so redo the normals from the carved nodes
      const H = (i, j) => heights[off + clamp(j, 0, S) * 5 + clamp(i, 0, S)], step = CELL / S;
      for (let j = 0; j <= S; j++) for (let i = 0; i <= S; i++) {
        const k = off + j * 5 + i, dx = (H(i + 1, j) - H(i - 1, j)) / (step * (Math.min(S, i + 1) - Math.max(0, i - 1)));
        const dz = (H(i, j + 1) - H(i, j - 1)) / (step * (Math.min(S, j + 1) - Math.max(0, j - 1))), inv = 1 / Math.hypot(dx, 1, dz);
        normals[k * 3] = -dx * inv; normals[k * 3 + 1] = inv; normals[k * 3 + 2] = -dz * inv;
      }
    }
    let cx = 1, cz = 1, isFlat = true;
    for (let j = 0; j <= S; j++) for (let i = 0; i <= S; i++) {
      const value = heights[off + j * 5 + i];
      if (Math.abs(value - heights[off]) > 0.00001) isFlat = false;
      const ax = heights[off + j * 5], bx = heights[off + j * 5 + 2], ex = heights[off + j * 5 + 4];
      const az = heights[off + i], bz = heights[off + 10 + i], ez = heights[off + 20 + i];
      if (Math.abs(bx - (ax + ex) * 0.5) > 0.004) cx = Math.max(cx, 2);
      if (Math.abs(bz - (az + ez) * 0.5) > 0.004) cz = Math.max(cz, 2);
      if (Math.abs(value - (i < 2 ? ax + (bx - ax) * i / 2 : bx + (ex - bx) * (i - 2) / 2)) > 0.000001) cx = 4;
      if (Math.abs(value - (j < 2 ? az + (bz - az) * j / 2 : bz + (ez - bz) * (j - 2) / 2)) > 0.000001) cz = 4;
    }
    // A centre node is required on any varying axis to preserve nominal centre heights.
    if (!isFlat) { if (cx === 1 && Math.abs(heights[off] - heights[off + 4]) > 0.00001) cx = 2; if (cz === 1 && Math.abs(heights[off] - heights[off + 20]) > 0.00001) cz = 2; }
    if (constant && nearWet) { cx = Math.min(cx, 2); cz = Math.min(cz, 2); }
    // Keep a narrow paint strip beside cliffs even when the plateau itself is perfectly flat.
    const cliffX = (x > 0 && Math.abs(levels[c] - levels[c - 1]) >= 2) || (x + 1 < w && Math.abs(levels[c] - levels[c + 1]) >= 2);
    const cliffZ = (z > 0 && Math.abs(levels[c] - levels[c - w]) >= 2) || (z + 1 < h && Math.abs(levels[c] - levels[c + w]) >= 2);
    if (cliffX) cx = 4; if (cliffZ) cz = 4;
    nx[c] = cx; nz[c] = cz; flat[c] = isFlat && !cliffX && !cliffZ ? 1 : 0;
    // Wall strips read these same nodes, including the vertices discarded by adaptive density.
    if (cx < S || cz < S) for (let j = 0; j <= S; j++) for (let i = 0; i <= S; i++) {
      const stepX = S / cx, stepZ = S / cz;
      if (i % stepX === 0 && j % stepZ === 0) continue;
      const ix = Math.min(cx - 1, Math.floor(i / stepX)), iz = Math.min(cz - 1, Math.floor(j / stepZ)), tx = i / stepX - ix, tz = j / stepZ - iz;
      const a = off + iz * stepZ * 5 + ix * stepX, A = heights[a], B = heights[a + stepX], C = heights[a + stepZ * 5], D = heights[a + stepZ * 5 + stepX];
      heights[off + j * 5 + i] = tx + tz <= 1 ? A + (B - A) * tx + (C - A) * tz : D + (C - D) * (1 - tx) + (B - D) * (1 - tz);
    }
  }

  function hAt(x, z) {
    const u = clamp(x / CELL, 0, w), v = clamp(z / CELL, 0, h), ix = Math.min(w - 1, Math.floor(u)), iz = Math.min(h - 1, Math.floor(v));
    const c = iz * w + ix;
    if (flat[c] === 2) { out[0] = levels[c] * CFG.levelHeight; out[1] = out[2] = 0; roadSample(u, v, c); return out[0]; }
    const xs = nx[c], zs = nz[c], fx = (u - ix) * xs, fz = (v - iz) * zs;
    const i = Math.min(xs - 1, Math.floor(fx)), j = Math.min(zs - 1, Math.floor(fz)), tx = fx - i, tz = fz - j;
    const stepX = S / xs, stepZ = S / zs, a = c * STRIDE + j * stepZ * 5 + i * stepX;
    const A = heights[a], B = heights[a + stepX], C = heights[a + stepZ * 5], D = heights[a + stepZ * 5 + stepX];
    return tx + tz <= 1 ? A + (B - A) * tx + (C - A) * tz : D + (C - D) * (1 - tx) + (B - D) * (1 - tz);
  }

  // the water line at (x, z), NaN away from water: boats ride on it
  function waterAt(x, z) {
    const c = Math.min(h - 1, Math.max(0, Math.floor(z / CELL))) * w + Math.min(w - 1, Math.max(0, Math.floor(x / CELL)));
    return water.wl[c] + WATER_LIFT;
  }

  function rebuildGeometry() {
    // Merge flat row runs. Extra edge vertices on their neighbours are collinear, so no seams open.
    const runs = [], walls = [];
    let vertices = 0, triangles = 0;
    for (let z = 0; z < h; z++) for (let x = 0; x < w; x++) {
      const c = z * w + x;
      if (flat[c] === 1) {
        let end = x + 1;
        while (end < w && end - x < 32 && flat[z * w + end] === 1 && heights[(z * w + end) * STRIDE] === heights[c * STRIDE]) end++;
        runs.push([c, end - x, 1, 1, false]); vertices += 4; triangles += 2; x = end - 1;
      } else if (flat[c] === 2) {
        runs.push([c, 1, 1, 1, false]); vertices += 5; triangles += 4;
      } else {
        runs.push([c, 1, nx[c], nz[c], false]); vertices += (nx[c] + 1) * (nz[c] + 1); triangles += nx[c] * nz[c] * 2;
      }
    }
    let cliffEdges = 0;
    for (let z = 0; z < h; z++) for (let x = 0; x < w; x++) {
      const c = z * w + x;
      for (let axis = 0; axis < 2; axis++) {
        if ((axis === 0 && x + 1 >= w) || (axis === 1 && z + 1 >= h)) continue;
        const d = c + (axis === 0 ? 1 : w);
        if (Math.abs(levels[c] - levels[d]) < 2) continue;
        cliffEdges++;
        for (let k = 0; k < S; k++) {
          const a0 = c * STRIDE + (axis === 0 ? k * 5 + 4 : 20 + k), a1 = a0 + (axis === 0 ? 5 : 1);
          const b0 = d * STRIDE + (axis === 0 ? k * 5 : k), b1 = b0 + (axis === 0 ? 5 : 1);
          if (Math.abs(heights[a0] - heights[b0]) < 0.00001 && Math.abs(heights[a1] - heights[b1]) < 0.00001) continue;
          walls.push([c, axis, k, a0, a1, b0, b1]); vertices += 4;
          if (Math.abs(heights[a0] - heights[b0]) > 0.00001) triangles++;
          if (Math.abs(heights[a1] - heights[b1]) > 0.00001) triangles++;
        }
      }
    }
    let extra = Math.max(0, Math.min(150000, Math.floor(n * 5)) - triangles);
    if (!low) for (const run of runs) {
      const [c, , xs, zs] = run, cost = xs * zs * 2;
      if (flat[c] || torn[c] || (xs < 4 && zs < 4) || Number.isFinite(water.wl[c]) || cost > extra) continue;
      run[4] = true; vertices += xs * zs; triangles += cost; extra -= cost;
    }
    const pos = new Float32Array(vertices * 3), normal = new Float32Array(vertices * 3), uv = new Float32Array(vertices * 2), paint = new Float32Array(vertices * 4), scar = new Float32Array(vertices), index = new Uint32Array(triangles * 3);
    let vi = 0, ti = 0;
    function vertex(x, z, height, nxv, nyv, nzv, rock = 0, lip = 0, foot = 0, damp = 0, dug = 0) {
      const k = vi++;
      pos[k * 3] = x; pos[k * 3 + 1] = height; pos[k * 3 + 2] = z;
      normal[k * 3] = nxv; normal[k * 3 + 1] = nyv; normal[k * 3 + 2] = nzv;
      uv[k * 2] = x / (w * CELL); uv[k * 2 + 1] = 1 - z / (h * CELL);
      paint[k * 4] = rock; paint[k * 4 + 1] = lip; paint[k * 4 + 2] = foot; paint[k * 4 + 3] = damp;
      scar[k] = dug;
      return k;
    }
    function surfaceVertex(c, u, v, heightOverride) {
      const x = c % w, z = Math.floor(c / w), node = c * STRIDE + Math.round(v * S) * 5 + Math.round(u * S);
      lipShift(x + u, z + v);
      const sx = shift[0], sz = shift[1], dug = touch(x + u, z + v);
      const scarHere = dug.scar && (dug.span >= 1 || dug.inside) ? 1 : 0;
      let lip = 0, foot = 0;
      for (let side = 0; side < 4; side++) {
        const other = side === 0 ? (x > 0 ? c - 1 : c) : side === 1 ? (x + 1 < w ? c + 1 : c) : side === 2 ? (z > 0 ? c - w : c) : (z + 1 < h ? c + w : c);
        if (Math.abs(levels[c] - levels[other]) < 2) continue;
        const distance = side === 0 ? u : side === 1 ? 1 - u : side === 2 ? v : 1 - v;
        const edge = Math.max(0, 1 - distance * CELL / 0.32);
        // Spread foot paint across the existing quarter-cell vertices, without changing the surface.
        const footEdge = Math.max(0, 1 - distance * CELL / 0.75);
        if (levels[c] > levels[other]) lip = Math.max(lip, edge * 0.65); else foot = Math.max(foot, footEdge * 0.35);
      }
      if (heightOverride !== undefined) {
        const fx = u * S, fz = v * S, i = Math.min(3, Math.floor(fx)), j = Math.min(3, Math.floor(fz)), tx = fx - i, tz = fz - j;
        const a = c * STRIDE + j * 5 + i;
        let vx = 0, vy = 0, vz = 0;
        for (let k = 0; k < 4; k++) {
          const nk = (a + (k & 1) + (k >> 1) * 5) * 3, weight = ((k & 1) ? tx : 1 - tx) * ((k >> 1) ? tz : 1 - tz);
          vx += normals[nk] * weight; vy += normals[nk + 1] * weight; vz += normals[nk + 2] * weight;
        }
        const inv = 1 / Math.hypot(vx, vy, vz);
        return vertex((x + u) * CELL + sx, (z + v) * CELL + sz, heightOverride, vx * inv, vy * inv, vz * inv, 0, lip, foot, water.wet[c] ? 1 : 0, scarHere);
      }
      return vertex((x + u) * CELL + sx, (z + v) * CELL + sz, heights[node], normals[node * 3], normals[node * 3 + 1], normals[node * 3 + 2], 0, lip, foot, water.wet[c] ? 1 : 0, scarHere);
    }
    const tri = (a, b, c) => { index[ti++] = a; index[ti++] = b; index[ti++] = c; };
    for (const [c, width, xs, zs, fan] of runs) {
      const start = vi;
      if (flat[c] === 1) {
        const x = (c % w) * CELL, z = Math.floor(c / w) * CELL, height = heights[c * STRIDE];
        vertex(x, z, height, 0, 1, 0); vertex(x + width * CELL, z, height, 0, 1, 0); vertex(x, z + CELL, height, 0, 1, 0); vertex(x + width * CELL, z + CELL, height, 0, 1, 0);
        tri(start, start + 2, start + 1); tri(start + 1, start + 2, start + 3); continue;
      }
      if (flat[c] === 2) {
        surfaceVertex(c, 0, 0); surfaceVertex(c, 1, 0); surfaceVertex(c, 0, 1); surfaceVertex(c, 1, 1); surfaceVertex(c, 0.5, 0.5);
        tri(start, start + 4, start + 1); tri(start + 1, start + 4, start + 3); tri(start + 3, start + 4, start + 2); tri(start + 2, start + 4, start); continue;
      }
      for (let j = 0; j <= zs; j++) for (let i = 0; i <= xs; i++) surfaceVertex(c, i / xs, j / zs);
      for (let j = 0; j < zs; j++) for (let i = 0; i < xs; i++) {
        const a = start + j * (xs + 1) + i, b = a + 1, cc = a + xs + 1, d = cc + 1;
        if (fan) {
          const mid = surfaceVertex(c, (i + 0.5) / xs, (j + 0.5) / zs, (pos[b * 3 + 1] + pos[cc * 3 + 1]) * 0.5);
          tri(a, cc, mid); tri(cc, d, mid); tri(d, b, mid); tri(b, a, mid);
        } else { tri(a, cc, b); tri(b, cc, d); }
      }
    }
    for (const [c, axis, k, a0, a1, b0, b1] of walls) {
      const x = c % w, z = Math.floor(c / w), sign = levels[c] > levels[c + (axis === 0 ? 1 : w)] ? 1 : -1;
      const p0x = (x + (axis === 0 ? 1 : k / S)) * CELL, p0z = (z + (axis === 0 ? k / S : 1)) * CELL;
      const p1x = p0x + (axis === 0 ? 0 : CELL / S), p1z = p0z + (axis === 0 ? CELL / S : 0);
      lipShift(p0x / CELL, p0z / CELL);
      const s0x = shift[0], s0z = shift[1];
      lipShift(p1x / CELL, p1z / CELL);
      const s1x = shift[0], s1z = shift[1];
      const start = vi, ah = heights[a0], bh = heights[b0], ah1 = heights[a1], bh1 = heights[b1];
      vertex(p0x + s0x, p0z + s0z, ah, axis === 0 ? sign : 0, 0, axis === 1 ? sign : 0, 1, Math.max(ah, bh), Math.min(ah, bh));
      vertex(p1x + s1x, p1z + s1z, ah1, axis === 0 ? sign : 0, 0, axis === 1 ? sign : 0, 1, Math.max(ah1, bh1), Math.min(ah1, bh1));
      vertex(p0x + s0x, p0z + s0z, bh, axis === 0 ? sign : 0, 0, axis === 1 ? sign : 0, 1, Math.max(ah, bh), Math.min(ah, bh));
      vertex(p1x + s1x, p1z + s1z, bh1, axis === 0 ? sign : 0, 0, axis === 1 ? sign : 0, 1, Math.max(ah1, bh1), Math.min(ah1, bh1));
      const reverse = (axis === 0 ? sign < 0 : sign > 0);
      if (Math.abs(ah - bh) > 0.00001) { if (reverse) tri(start, start + 2, start + 1); else tri(start, start + 1, start + 2); }
      if (Math.abs(ah1 - bh1) > 0.00001) { if (reverse) tri(start + 1, start + 2, start + 3); else tri(start + 1, start + 3, start + 2); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(normal, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); geo.setAttribute('reliefPaint', new THREE.BufferAttribute(paint, 4)); geo.setAttribute('reliefScar', new THREE.BufferAttribute(scar, 1)); geo.setIndex(new THREE.BufferAttribute(index, 1));
    // Fixed bounds avoid another full vertex scan on every crater.
    geo.boundingBox = new THREE.Box3(new THREE.Vector3(0, -12, 0), new THREE.Vector3(w * CELL, 12, h * CELL));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(w * CELL / 2, 0, h * CELL / 2), Math.hypot(w * CELL / 2, h * CELL / 2, 12));
    const previous = mesh.geometry; mesh.geometry = geo; options.onGeometry?.(geo); previous.dispose();
    stats.vertices = vertices; stats.triangles = triangles; stats.cliffEdges = cliffEdges;
  }

  function update(cells) {
    const t0 = performance.now(), dirty = new Set();
    for (const entry of cells) {
      const c = typeof entry === 'number' ? entry : entry[0], x = c % w, z = Math.floor(c / w);
      for (let j = Math.max(0, z - 3); j <= Math.min(h - 1, z + 3); j++) for (let i = Math.max(0, x - 3); i <= Math.min(w - 1, x + 3); i++) dirty.add(j * w + i);
    }
    // A topology change can alter the minimum of an entire connected water body.
    const oldWater = water;
    const wetChanged = cells.some(entry => {
      const c = typeof entry === 'number' ? entry : entry[0], ch = grid[Math.floor(c / w)][c % w];
      return !!oldWater.wet[c] !== 'WF='.includes(ch) || !!oldWater.bridges[c] !== (ch === '=');
    });
    if (wetChanged) readWater();
    for (let c = 0; wetChanged && c < n; c++) if (oldWater.wl[c] !== water.wl[c] && !(Number.isNaN(oldWater.wl[c]) && Number.isNaN(water.wl[c]))) {
      const x = c % w, z = Math.floor(c / w);
      for (let j = Math.max(0, z - 1); j <= Math.min(h - 1, z + 1); j++) for (let i = Math.max(0, x - 1); i <= Math.min(w - 1, x + 1); i++) dirty.add(j * w + i);
    }
    for (const c of dirty) readCell(c);
    for (const c of dirty) { const x = c % w, z = Math.floor(c / w); readQuad(x, z); readQuad(x + 1, z); readQuad(x, z + 1); readQuad(x + 1, z + 1); }
    for (const c of dirty) controlCell(c);
    for (const c of dirty) buildCell(c);
    rebuildGeometry(); stats.cellsUpdated = dirty.size; stats.updateMs = performance.now() - t0;
  }

  // March against the exact terrain surface. A boundary crossing also catches vertical cliff walls.
  mesh.raycast = function (raycaster, hits) {
    const ray = raycaster.ray, o = ray.origin, d = ray.direction;
    let begin = Math.max(0, raycaster.near), end = raycaster.far;
    const origins = [o.x, o.y, o.z], directions = [d.x, d.y, d.z], mins = [0, -12, 0], maxs = [w * CELL, 12, h * CELL];
    for (let axis = 0; axis < 3; axis++) {
      if (Math.abs(directions[axis]) < 1e-12) { if (origins[axis] < mins[axis] || origins[axis] > maxs[axis]) return; }
      else { const a = (mins[axis] - origins[axis]) / directions[axis], b = (maxs[axis] - origins[axis]) / directions[axis]; begin = Math.max(begin, Math.min(a, b)); end = Math.min(end, Math.max(a, b)); }
    }
    if (end < begin) return;
    const delta = Math.min(0.25 / Math.max(Math.abs(d.x), Math.abs(d.z), 0.01), 0.4 / Math.max(Math.abs(d.y), 0.01));
    const diff = t => o.y + d.y * t - hAt(o.x + d.x * t, o.z + d.z * t);
    let a = begin, va = diff(a), found = Math.abs(va) < 1e-7;
    while (!found && a < end) {
      const b = Math.min(end, a + delta), vb = diff(b);
      if (va * vb <= 0) {
        let left = a, right = b;
        for (let i = 0; i < 22; i++) { const mid = (left + right) * 0.5; if (diff(mid) * va > 0) left = mid; else right = mid; }
        a = (left + right) * 0.5; found = true;
      } else { a = b; va = vb; }
    }
    if (found) hits.push({ distance: a, point: ray.at(a, new THREE.Vector3()), object: this, face: null });
  };

  const t0 = performance.now();
  for (let c = 0; c < n; c++) readCell(c);
  for (let z = 0; z <= h; z++) for (let x = 0; x <= w; x++) readQuad(x, z);
  readWater();
  for (let c = 0; c < n; c++) controlCell(c);
  for (let c = 0; c < n; c++) buildCell(c);
  rebuildGeometry(); stats.buildMs = performance.now() - t0;
  const unsubscribe = options.gfx?.onChange(() => {
    low = options.gfx.low || !!map.world; material.userData.setLow?.(low); rebuildGeometry();
  });
  return { mesh, get geometry() { return mesh.geometry; }, hAt, waterAt, update, stats,
    dispose() { unsubscribe?.(); mesh.geometry.dispose(); if (!options.material) material.dispose(); } };
}
