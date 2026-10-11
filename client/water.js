// Water: a see-through surface over river (W), ford (F) and bridge (=) cells, glossy, with a slow drift, drawn as one
// mesh per 64 x 64 cell chunk so a change redraws only the chunks around it (client/chunk-jobs.js). Water that
// reaches the map edge carries on past it (client/apron.js keeps the bed low there). It draws before every other
// see-through thing and writes no depth, so the fog of war overlay, smoke and effects all still draw on top of it.
// A mask texture (4 texels per cell) holds the soft shoreline, a depth guess, the fords and the bridges; a per-vertex
// flow direction drives the slow drift. gfx.low freezes it (no animation).
import * as THREE from 'three';
import { CELL, CFG, levelOf } from '../shared/sim.js';
import { WET, WATER_LIFT, createWaterLevels } from './water-levels.js';
import { gfx } from './gfx.js';
import { createChunkJobs } from './chunk-jobs.js';

const SUB = 4; // mask texels per cell
const REACH = 3 * 4; // mask texels the widest blur (radius 4, three passes) carries a change
const LIFT = WATER_LIFT; // the surface sits this far above a flat bank
const EDGE_REACH = 900; // metres water carries on past the map edge where it leaves the map
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const CHUNK = 64; // cells per side of one water mesh

// Separable box blur, run 3 times (close to a Gaussian). Edges repeat, so water that reaches the map edge stays full.
function blur(src, w, h, r) {
  const a = Float32Array.from(src), b = new Float32Array(a.length), n = 2 * r + 1;
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < h; y++) {
      const o = y * w;
      let s = 0;
      for (let k = -r; k <= r; k++) s += a[o + Math.min(w - 1, Math.max(0, k))];
      for (let x = 0; x < w; x++) {
        b[o + x] = s / n;
        s += a[o + Math.min(w - 1, x + r + 1)] - a[o + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -r; k <= r; k++) s += b[Math.min(h - 1, Math.max(0, k)) * w + x];
      for (let y = 0; y < h; y++) {
        a[y * w + x] = s / n;
        s += b[Math.min(h - 1, y + r + 1) * w + x] - b[Math.max(0, y - r) * w + x];
      }
    }
  }
  return a;
}

// Tileable ripple texture made of whole-number waves. R height, G/B slope (x, z), A slower blotches for foam.
function noiseTexture() {
  const N = 128, data = new Uint8Array(N * N * 4);
  let seed = 9173;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const waves = (count, kmin, kmax) => {
    const out = [];
    while (out.length < count) {
      const kx = Math.round((rand() * 2 - 1) * kmax), kz = Math.round((rand() * 2 - 1) * kmax), k = Math.hypot(kx, kz);
      if (k >= kmin && k <= kmax) out.push([kx, kz, 1 / k, rand() * Math.PI * 2]);
    }
    return out;
  };
  const ripple = waves(16, 2, 9), blot = waves(8, 1, 4);
  const H = new Float32Array(N * N), GX = new Float32Array(N * N), GZ = new Float32Array(N * N), B = new Float32Array(N * N);
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
    const i = z * N + x;
    for (const [kx, kz, a, p] of ripple) {
      const t = (Math.PI * 2 * (kx * x + kz * z)) / N + p;
      H[i] += a * Math.sin(t); GX[i] += a * kx * Math.cos(t); GZ[i] += a * kz * Math.cos(t);
    }
    for (const [kx, kz, a, p] of blot) B[i] += a * Math.sin((Math.PI * 2 * (kx * x + kz * z)) / N + p);
  }
  const range = (arr) => { let lo = Infinity, hi = -Infinity; for (const v of arr) { lo = Math.min(lo, v); hi = Math.max(hi, v); } return [lo, hi]; };
  const [h0, h1] = range(H), [b0, b1] = range(B);
  let g = 0;
  for (let i = 0; i < N * N; i++) g = Math.max(g, Math.abs(GX[i]), Math.abs(GZ[i]));
  for (let i = 0; i < N * N; i++) {
    data[i * 4] = ((H[i] - h0) / (h1 - h0)) * 255;
    data[i * 4 + 1] = (0.5 + (0.5 * GX[i]) / g) * 255;
    data[i * 4 + 2] = (0.5 + (0.5 * GZ[i]) / g) * 255;
    data[i * 4 + 3] = ((B[i] - b0) / (b1 - b0)) * 255;
  }
  const tex = new THREE.DataTexture(data, N, N);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

const VERT_PARS = /* glsl */`
attribute vec2 flow;
varying vec2 vFlow;
varying vec3 vWPos;
`;
const VERT_MAIN = /* glsl */`
vFlow = flow;
vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
`;
const FRAG_PARS = /* glsl */`
uniform float uTime;
uniform sampler2D uMask;
uniform sampler2D uNoise;
uniform vec2 uSize;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uFord;
uniform vec3 uFoam;
uniform vec3 uSky;
varying vec2 vFlow;
varying vec3 vWPos;
`;
// replaces <map_fragment>: colour, coverage and foam; leaves wN (ripple normal, world space) and wFoam for later chunks
const FRAG_COLOR = /* glsl */`
vec4 wm = texture2D(uMask, vWPos.xz / uSize);
float cover = smoothstep(0.26, 0.34, wm.r);
if (cover < 0.004) discard;
float deep = smoothstep(0.3, 0.85, wm.g), ford = smoothstep(0.25, 0.6, wm.b), bridge = wm.a;
vec2 nuv = vWPos.xz / 9.0;
vec4 nA = texture2D(uNoise, vWPos.xz / 31.0 + uTime * vec2(0.004, -0.003));
#ifdef WATER_LOW
  vec4 n0 = texture2D(uNoise, nuv);
#else
  // two copies of the ripples slide along the flow half a cycle apart and cross-fade, so nothing stretches forever
  float p0 = fract(uTime * 0.22), p1 = fract(uTime * 0.22 + 0.5), k0 = 1.0 - abs(1.0 - 2.0 * p0);
  vec2 drift = vFlow * (2.2 / 9.0);
  vec4 n0 = mix(texture2D(uNoise, nuv - drift * p1 + 0.37), texture2D(uNoise, nuv - drift * p0), k0);
#endif
// fine detail fades out when a pixel covers more ground than a ripple, so far water doesn't shimmer
float detail = 1.0 - smoothstep(0.12, 0.45, length(fwidth(vWPos.xz)));
// calmer in open water, with slow patches of rougher and smoother water so a big sea doesn't show the tiling
float chop = mix(0.32, 0.16, ford) * mix(1.0, 0.6, deep) * (0.45 + 0.9 * nA.a);
vec2 slope = (n0.gb * 2.0 - 1.0) * chop * mix(0.35, 1.0, detail) + (nA.gb * 2.0 - 1.0) * 0.08;
vec3 wN = normalize(vec3(-slope.x, 1.0, -slope.y));
vec3 wCol = mix(uShallow, uDeep, deep);
wCol = mix(wCol, uFord, ford);
wCol *= 0.93 + 0.14 * nA.r;
// pebbles on the ford bed show through the shallow water
wCol *= 1.0 - 0.2 * ford * smoothstep(0.62, 0.8, texture2D(uNoise, vWPos.xz / 2.3 + 0.21).a);
// light dry-brushed ripple crests that ride the flow, more of them over the shallow fords
float crest = smoothstep(mix(0.64, 0.56, ford), 0.84, n0.r) * (1.0 - 0.5 * deep) * detail;
wCol = mix(wCol, uFoam, crest * (0.14 + 0.3 * ford));
// a broken pale band where the water meets the bank
float brk = smoothstep(0.35, 0.75, n0.a * 0.6 + nA.a * 0.6 - 0.1);
float wFoam = (1.0 - smoothstep(0.31, 0.52, wm.r)) * (0.25 + 0.75 * brk) * 0.8;
// foam hugging the bridge piers, plus a short wake downstream of each bridge
float ring = smoothstep(0.03, 0.14, bridge) * (1.0 - smoothstep(0.3, 0.55, bridge));
#ifndef WATER_LOW
  float up = texture2D(uMask, (vWPos.xz - vFlow * 3.5) / uSize).a;
  ring = max(ring, smoothstep(0.25, 0.65, up) * (1.0 - smoothstep(0.08, 0.35, bridge)) * brk);
#endif
wFoam = max(wFoam, ring * (0.55 + 0.45 * brk));
wCol = mix(wCol, uFoam, wFoam);
diffuseColor = vec4(wCol, cover * max(mix(0.86, 0.6, ford), wFoam * 0.95) * opacity);
`;
const FRAG_ROUGH = /* glsl */`
float roughnessFactor = mix(roughness, 0.95, wFoam);
`;
const FRAG_NORMAL = /* glsl */`
normal = normalize((viewMatrix * vec4(wN, 0.0)).xyz);
`;
// a little sky sheen, stronger at grazing angles, so the surface reads as glossy under any sun angle
const FRAG_SHEEN = /* glsl */`
float wFres = 1.0 - clamp(dot(wN, normalize(cameraPosition - vWPos)), 0.0, 1.0);
totalEmissiveRadiance += uSky * (0.015 + 0.25 * wFres * wFres * wFres) * (1.0 - wFoam);
`;

// grid: the live terrain grid (rows of chars, updated in place by the caller); map: { w, h, heights }.
// options.deferred: the water meshes of changed chunks are redrawn over the following tick() calls, about
// options.budgetMs each, instead of all in the tick that sees the change (see client/chunk-jobs.js).
// options.unknown(c): true for a cell this player has not discovered (World Conquest). Water reaching such a cell runs
// on under the fog instead of ending in a shore at the edge of what was seen.
export function createWater(grid, map, groundHeight, options = {}) {
  const w = map.w, h = map.h, n = w * h;
  const wetAt = (c) => WET.has(grid[Math.floor(c / w)][c % w]);
  let any = false;
  for (let c = 0; c < n && !any; c++) any = wetAt(c);
  if (!any) return null;

  // levels are read once: later dents dig the bed or the bank but never move the water line
  const waterLevels = createWaterLevels(map);

  const MWs = w * SUB, MHs = h * SUB;
  const maskData = new Uint8Array(MWs * MHs * 4);
  const mask = new THREE.DataTexture(maskData, MWs, MHs);
  mask.magFilter = mask.minFilter = THREE.LinearFilter;
  // until the first full upload, a partial one would leave the rest of the texture empty
  let uploaded = false;
  mask.onUpdate = () => { uploaded = true; };
  const stats = { maskTexels: 0 };
  const noise = noiseTexture();
  const color = (hex) => new THREE.Color(hex);
  const uniforms = {
    uTime: { value: 0 }, uMask: { value: mask }, uNoise: { value: noise }, uSize: { value: new THREE.Vector2(w * CELL, h * CELL) },
    uDeep: { value: color(0x234a4c) }, uShallow: { value: color(0x3a6a66) }, uFord: { value: color(0x7a9a88) },
    uFoam: { value: color(0xddd6bc) }, uSky: { value: color(0xb9c6c2) },
  };
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.46, metalness: 0, transparent: true, depthWrite: false });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT_MAIN}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_PARS}`)
      .replace('#include <map_fragment>', FRAG_COLOR)
      .replace('#include <roughnessmap_fragment>', FRAG_ROUGH)
      .replace('#include <normal_fragment_maps>', FRAG_NORMAL)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${FRAG_SHEEN}`);
  };
  const setLow = () => {
    if (gfx.low) material.defines.WATER_LOW = ''; else delete material.defines.WATER_LOW;
    material.needsUpdate = true;
  };
  setLow();
  const unsubscribe = gfx.onChange(setLow);

  // mesh: a group with one mesh per chunk of CHUNK x CHUNK cells (options.chunk) that holds water
  const mesh = new THREE.Group();
  mesh.name = 'water';
  const chunkSide = options.chunk ?? CHUNK; // cells per chunk side (tests may draw a map as one chunk)
  const cols = Math.ceil(w / chunkSide), rows = Math.ceil(h / chunkSide), parts = new Array(cols * rows).fill(null);
  let merged = null;

  let wet = new Uint8Array(n), bridges = new Uint8Array(n), fords = new Uint8Array(n), raised = new Uint8Array(n), dirty = false;
  // The shore follows open water: known water and the undiscovered cells within OPEN of it. Undiscovered ground is
  // dark, so a shore drawn at the edge of discovery would show only a beach that is not there.
  const OPEN = 2, open = new Uint8Array(n), unknown = options.unknown;
  const openAt = (c) => {
    if (wet[c]) return 1;
    if (!unknown?.(c)) return 0;
    const x = c % w, y = (c - x) / w;
    for (let dy = -OPEN; dy <= OPEN; dy++) for (let dx = -OPEN; dx <= OPEN; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < w && ny < h && wet[ny * w + nx]) return 1;
    }
    return 0;
  };
  let pending = new Set(); // cells changed since the last rebuild that are or were wet
  const relevel = new Set(); // dented cells beside a span that lies on the ground
  // what the vertices read, per cell: the water line (NaN away from water), the flow and the wet cells they were made with
  let wl = new Float32Array(n).fill(NaN), fx = new Float32Array(n), fz = new Float32Array(n), flowWet = new Uint8Array(n);
  const near = (arr, c) => {
    const x = c % w, y = (c - x) / w;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < w && ny < h && arr[ny * w + nx]) return true;
    }
    return false;
  };
  // the ground level now, in world units (dents included)
  const groundAt = (c) => levelOf(map.heights?.[Math.floor(c / w)]?.[c % w] ?? '0') * CFG.levelHeight;

  // one mask channel: cells where pick(c) is true, softened by a blur of radius r texels. Only the texels in [x0, x1) x
  // [y0, y1) are written; the blur reads a window REACH texels wider, and the map edges, so they come out exactly as a
  // blur of the whole map would make them (the running sums of these 0/1 inputs are exact, in any order).
  function channel(k, pick, r, x0 = 0, y0 = 0, x1 = MWs, y1 = MHs) {
    const wx0 = Math.max(0, x0 - REACH), wy0 = Math.max(0, y0 - REACH), wx1 = Math.min(MWs, x1 + REACH), wy1 = Math.min(MHs, y1 + REACH), ww = wx1 - wx0;
    const bin = new Float32Array(ww * (wy1 - wy0));
    for (let y = wy0; y < wy1; y++) for (let x = wx0; x < wx1; x++) bin[(y - wy0) * ww + x - wx0] = pick(Math.floor(y / SUB) * w + Math.floor(x / SUB)) ? 1 : 0;
    const soft = blur(bin, ww, wy1 - wy0, r);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) maskData[(y * MWs + x) * 4 + k] = Math.min(255, soft[(y - wy0) * ww + x - wx0] * 255 + 0.5);
    stats.maskTexels += bin.length;
  }
  // all four channels over a box of cells, plus the texels the blur carries a change of these cells into
  function paintMask(cx0, cy0, cx1, cy1) {
    const x0 = Math.max(0, cx0 * SUB - REACH), y0 = Math.max(0, cy0 * SUB - REACH), x1 = Math.min(MWs, cx1 * SUB + REACH), y1 = Math.min(MHs, cy1 * SUB + REACH);
    channel(0, (c) => open[c], 2, x0, y0, x1, y1); // R: coverage, edge at about 0.3 (a third of a cell into the bank)
    channel(1, (c) => open[c], 4, x0, y0, x1, y1); // G: how far from the bank, read as depth
    channel(2, (c) => fords[c], 2, x0, y0, x1, y1); // B: fords
    channel(3, (c) => bridges[c], 2, x0, y0, x1, y1); // A: bridges
    if (uploaded) for (let y = y0; y < y1; y++) mask.addUpdateRange((y * MWs + x0) * 4, (x1 - x0) * 4);
    mask.needsUpdate = true;
  }
  // changed cells grouped into boxes whose blur windows overlap, so scouts far apart redraw small separate boxes
  function boxes(cells) {
    const gap = Math.ceil(4 * REACH / SUB), out = [];
    for (const c of cells) {
      const x = c % w, y = (c - x) / w;
      let box = [x, y, x + 1, y + 1];
      for (let i = 0; i < out.length; i++) {
        const b = out[i];
        if (b[0] - gap > box[2] || box[0] - gap > b[2] || b[1] - gap > box[3] || box[1] - gap > b[3]) continue;
        box = [Math.min(b[0], box[0]), Math.min(b[1], box[1]), Math.max(b[2], box[2]), Math.max(b[3], box[3])];
        out.splice(i, 1); i = -1; // grown: check the others again
      }
      out.push(box);
    }
    return out;
  }

  // Water lines, raised spans and flow for every cell, from the current grid. The flow runs toward one end of each body
  // of water (the end on the map edge, if only one is), slower far from the banks. Each body is walked through its own
  // cells, so the cost follows the water, not the number of bodies times the map. Returns the cells whose vertices or
  // triangles change.
  function readFields() {
    const water = waterLevels.read(grid), { comp, compLevel } = water, bodies = compLevel.length;
    // the cells of each body, in cell order
    const first = new Int32Array(bodies + 1);
    for (let c = 0; c < n; c++) if (comp[c] >= 0) first[comp[c] + 1]++;
    for (let id = 0; id < bodies; id++) first[id + 1] += first[id];
    const members = new Int32Array(first[bodies]), fill = first.slice(0, bodies);
    for (let c = 0; c < n; c++) if (comp[c] >= 0) members[fill[comp[c]]++] = c;
    const queue = new Int32Array(n), steps = new Int32Array(n).fill(-1), dist = new Int32Array(n).fill(-1);
    // steps from the shore: from every dry cell through wet ones (seeded at the wet cells beside a dry one)
    const shore = new Int32Array(n).fill(-1);
    let head = 0, tail = 0;
    for (let c = 0; c < n; c++) if (wet[c]) {
      const x = c % w, y = (c - x) / w;
      if ((x > 0 && !wet[c - 1]) || (x + 1 < w && !wet[c + 1]) || (y > 0 && !wet[c - w]) || (y + 1 < h && !wet[c + w])) { shore[c] = 1; queue[tail++] = c; }
    }
    while (head < tail) {
      const c = queue[head++], x = c % w, y = (c - x) / w;
      for (const [dx, dy] of N4) {
        const nx = x + dx, ny = y + dy, k = ny * w + nx;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h || shore[k] >= 0 || !wet[k]) continue;
        shore[k] = shore[c] + 1; queue[tail++] = k;
      }
    }
    // breadth-first steps from one cell through its body, into steps; returns how many cells it reached (in queue)
    const walk = (from, id) => {
      let head = 0, tail = 1;
      queue[0] = from; steps[from] = 0;
      while (head < tail) {
        const c = queue[head++], x = c % w, y = (c - x) / w;
        for (const [dx, dy] of N4) {
          const nx = x + dx, ny = y + dy, k = ny * w + nx;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h || steps[k] >= 0 || comp[k] !== id) continue;
          steps[k] = steps[c] + 1; queue[tail++] = k;
        }
      }
      return tail;
    };
    const clear = reached => { for (let i = 0; i < reached; i++) steps[queue[i]] = -1; };
    // the first cell of the body, in cell order, farthest from the last walk
    const far = id => { let best = members[first[id]]; for (let i = first[id]; i < first[id + 1]; i++) if (steps[members[i]] > steps[best]) best = members[i]; return best; };
    const onEdge = (c) => c % w === 0 || c % w === w - 1 || c < w || c >= n - w;
    for (let id = 0; id < bodies; id++) {
      let reached = walk(members[first[id]], id);
      const a = far(id);
      clear(reached); reached = walk(a, id);
      const b = far(id);
      if (onEdge(b) && !onEdge(a)) { clear(reached); reached = walk(b, id); }
      for (let i = 0; i < reached; i++) dist[queue[i]] = steps[queue[i]];
      clear(reached);
    }
    const wetCells = [];
    for (let c = 0; c < n; c++) if (wet[c]) wetCells.push(c);
    const nextFx = new Float32Array(n), nextFz = new Float32Array(n);
    for (const c of wetCells) {
      const x = c % w, y = (c - x) / w;
      const at = (nx, ny) => { const k = ny * w + nx; return nx >= 0 && ny >= 0 && nx < w && ny < h && comp[k] === comp[c] ? dist[k] : dist[c]; };
      const gx = at(x + 1, y) - at(x - 1, y), gz = at(x, y + 1) - at(x, y - 1), len = Math.hypot(gx, gz);
      const s = shore[c] < 0 ? 0.25 : 1 - 0.75 * THREE.MathUtils.smoothstep(shore[c], 2, 8);
      if (len > 0) { nextFx[c] = (-gx / len) * s; nextFz[c] = (-gz / len) * s; }
    }
    // three passes of a 3 x 3 average within each body (dry cells keep no flow)
    const sumX = new Float32Array(wetCells.length), sumZ = new Float32Array(wetCells.length);
    for (let pass = 0; pass < 3; pass++) {
      wetCells.forEach((c, i) => {
        const x = c % w, y = (c - x) / w;
        let sx = 0, sz = 0, m = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const ax = x + dx, ay = y + dy, k = ay * w + ax;
          if (ax >= 0 && ay >= 0 && ax < w && ay < h && comp[k] === comp[c]) { sx += nextFx[k]; sz += nextFz[k]; m++; }
        }
        sumX[i] = sx / m; sumZ[i] = sz / m;
      });
      wetCells.forEach((c, i) => { nextFx[c] = sumX[i]; nextFz[c] = sumZ[i]; });
    }
    const changed = [];
    for (let c = 0; c < n; c++) {
      const a = wl[c], b = water.wl[c];
      if ((a === b || (a !== a && b !== b)) && fx[c] === nextFx[c] && fz[c] === nextFz[c] && raised[c] === water.raised[c] && flowWet[c] === wet[c]) continue;
      changed.push(c);
    }
    wl = water.wl; raised = water.raised; fx = nextFx; fz = nextFz; flowWet = Uint8Array.from(wet);
    return changed;
  }

  // the water mesh of chunk i: a vertex per cell corner (surface height and flow), triangles over the wet cells plus
  // one cell of bank around them, and the strips that carry water on past the map edge; null where it holds no water
  function buildChunk(i) {
    const cx = i % cols, cy = (i - cx) / cols, x0 = cx * chunkSide, y0 = cy * chunkSide, x1 = Math.min(w, x0 + chunkSide), y1 = Math.min(h, y0 + chunkSide);
    let any = false;
    for (let y = y0; y < y1 && !any; y++) for (let x = x0; x < x1 && !any; x++) any = !Number.isNaN(wl[y * w + x]);
    if (!any) return null;
    const W1 = x1 - x0 + 1, verts = W1 * (y1 - y0 + 1), local = (vx, vy) => (vy - y0) * W1 + vx - x0;
    const pos = new Float32Array(verts * 3), nor = new Float32Array(verts * 3), flow = new Float32Array(verts * 2);
    for (let vy = y0; vy <= y1; vy++) for (let vx = x0; vx <= x1; vx++) {
      const v = local(vx, vy);
      let y = Infinity, sx = 0, sz = 0, m = 0, ground = 0, cells = 0, drape = false;
      for (let k = 0; k < 4; k++) {
        const cx = vx - 1 + (k & 1), cy = vy - 1 + (k >> 1);
        if (cx < 0 || cy < 0 || cx >= w || cy >= h) continue;
        const c = cy * w + cx;
        if (wl[c] < y) y = wl[c];
        if (flowWet[c]) { sx += fx[c]; sz += fz[c]; m++; }
        ground += groundAt(c); cells++; drape ||= !!raised[c];
      }
      // Relief supplies the visible surface; the nominal corner average remains the fallback.
      if (drape) y = Math.max(y, groundHeight ? groundHeight(vx * CELL, vy * CELL) : ground / cells);
      pos[v * 3] = vx * CELL; pos[v * 3 + 1] = (y === Infinity ? 0 : y) + LIFT; pos[v * 3 + 2] = vy * CELL;
      nor[v * 3 + 1] = 1;
      if (m) { flow[v * 2] = sx / m; flow[v * 2 + 1] = sz / m; }
    }
    const index = [];
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      if (Number.isNaN(wl[y * w + x])) continue;
      const a = local(x, y), b = a + 1, c = a + W1, d = c + 1;
      index.push(a, c, b, b, c, d);
    }

    // Water that reaches the map edge keeps going: a strip out from each edge cell that carries water, and a block past
    // each corner. The mask texture repeats its edge texels outward, so the shore and the flow carry on unchanged (the
    // apron, client/apron.js, keeps the bed low there).
    const extraPos = [], extraFlow = [], outer = new Map();
    const vertexAt = (x, y, z, fx, fz) => { extraPos.push(x, y, z); extraFlow.push(fx, fz); return verts + extraPos.length / 3 - 1; };
    const outerOf = (v, ox, oz) => {
      const key = `${v}:${ox}:${oz}`;
      if (!outer.has(key)) outer.set(key, vertexAt(pos[v * 3] + ox * EDGE_REACH, pos[v * 3 + 1], pos[v * 3 + 2] + oz * EDGE_REACH, flow[v * 2], flow[v * 2 + 1]));
      return outer.get(key);
    };
    const at = (v) => [pos[v * 3], pos[v * 3 + 2]];
    // four vertices around a quad, in order; the first triangle must face up
    const quad = (p, q, r, s) => {
      const [px, pz] = p < verts ? at(p) : [extraPos[(p - verts) * 3], extraPos[(p - verts) * 3 + 2]];
      const [qx, qz] = q < verts ? at(q) : [extraPos[(q - verts) * 3], extraPos[(q - verts) * 3 + 2]];
      const [rx, rz] = r < verts ? at(r) : [extraPos[(r - verts) * 3], extraPos[(r - verts) * 3 + 2]];
      const flip = (qz - pz) * (rx - px) - (qx - px) * (rz - pz) < 0; // (q - p) x (r - p) points down: wind the other way
      if (flip) index.push(p, r, q, p, s, r); else index.push(p, q, r, p, r, s);
    };
    const edgeCell = (x, y) => !Number.isNaN(wl[y * w + x]);
    for (let x = x0; x < x1; x++) {
      if (y0 === 0 && edgeCell(x, 0)) { const v = local(x, 0); quad(v, v + 1, outerOf(v + 1, 0, -1), outerOf(v, 0, -1)); }
      if (y1 === h && edgeCell(x, h - 1)) { const s = local(x, h); quad(s, s + 1, outerOf(s + 1, 0, 1), outerOf(s, 0, 1)); }
    }
    for (let y = y0; y < y1; y++) {
      if (x0 === 0 && edgeCell(0, y)) { const v = local(0, y); quad(v, v + W1, outerOf(v + W1, -1, 0), outerOf(v, -1, 0)); }
      if (x1 === w && edgeCell(w - 1, y)) { const v = local(w, y); quad(v, v + W1, outerOf(v + W1, 1, 0), outerOf(v, 1, 0)); }
    }
    for (const [cx, cy, ox, oz] of [[0, 0, -1, -1], [w - 1, 0, 1, -1], [w - 1, h - 1, 1, 1], [0, h - 1, -1, 1]]) {
      if (cx < x0 || cx >= x1 || cy < y0 || cy >= y1 || !edgeCell(cx, cy)) continue;
      const v = local(ox < 0 ? 0 : w, oz < 0 ? 0 : h), [x, z] = at(v), y = pos[v * 3 + 1], f = [flow[v * 2], flow[v * 2 + 1]];
      quad(v, vertexAt(x + ox * EDGE_REACH, y, z, ...f), vertexAt(x + ox * EDGE_REACH, y, z + oz * EDGE_REACH, ...f), vertexAt(x, y, z + oz * EDGE_REACH, ...f));
    }
    const allPos = new Float32Array(pos.length + extraPos.length), allNor = new Float32Array(nor.length + extraPos.length), allFlow = new Float32Array(flow.length + extraFlow.length);
    allPos.set(pos); allPos.set(extraPos, pos.length);
    allNor.set(nor);
    for (let i = nor.length + 1; i < allNor.length; i += 3) allNor[i] = 1;
    allFlow.set(flow); allFlow.set(extraFlow, flow.length);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(allPos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(allNor, 3));
    geo.setAttribute('flow', new THREE.BufferAttribute(allFlow, 2));
    geo.setIndex(index);
    geo.computeBoundingSphere();
    return geo;
  }

  // Shows a rebuilt chunk: a new mesh where water appeared, the new geometry, or no mesh where the water is gone.
  function publishChunk(i, geo) {
    const part = parts[i];
    if (part && geo) { part.geometry.dispose(); part.geometry = geo; }
    else if (geo) {
      const next = parts[i] = new THREE.Mesh(geo, material);
      next.renderOrder = -1; // first of the see-through pass: fog of war, smoke and effects draw over it
      next.receiveShadow = true;
      mesh.add(next);
    } else if (part) { part.removeFromParent(); part.geometry.dispose(); parts[i] = null; }
    merged?.dispose(); merged = null;
  }
  const jobs = createChunkJobs({ cols, rows, build: buildChunk, publish: publishChunk, discard: geo => geo?.dispose(), now: options.now });
  // the chunks holding any vertex in the inclusive vertex box (a chunk's vertices include its far edge)
  const markVertices = (vx0, vy0, vx1, vy1) => jobs.markBox(Math.ceil(vx0 / chunkSide) - 1, Math.ceil(vy0 / chunkSide) - 1, Math.floor(vx1 / chunkSide), Math.floor(vy1 / chunkSide));

  // The whole water surface as one geometry: for tests and tools, not for frames (it copies every chunk). Anything still
  // queued is drawn first.
  function wholeGeometry() {
    jobs.flush();
    if (merged) return merged;
    const geos = parts.filter(Boolean).map(part => part.geometry), layout = { position: 3, normal: 3, flow: 2 };
    const vertices = geos.reduce((sum, g) => sum + g.attributes.position.count, 0), indices = geos.reduce((sum, g) => sum + g.index.count, 0);
    const out = Object.fromEntries(Object.entries(layout).map(([key, size]) => [key, new Float32Array(vertices * size)])), index = new Uint32Array(indices);
    let vi = 0, ti = 0;
    for (const g of geos) {
      for (const [key, size] of Object.entries(layout)) out[key].set(g.attributes[key].array, vi * size);
      const source = g.index.array;
      for (let k = 0; k < source.length; k++) index[ti + k] = source[k] + vi;
      vi += g.attributes.position.count; ti += source.length;
    }
    merged = new THREE.BufferGeometry();
    for (const [key, size] of Object.entries(layout)) merged.setAttribute(key, new THREE.BufferAttribute(out[key], size));
    merged.setIndex(new THREE.BufferAttribute(index, 1));
    return merged;
  }

  // only the pending cells can have changed; the mask is redrawn around those whose water, ford or bridge changed
  function rebuild() {
    dirty = false; stats.maskTexels = 0;
    const moved = [];
    let wetChanged = false, bridgesChanged = false;
    for (const c of pending) {
      const ch = grid[Math.floor(c / w)][c % w], nextWet = WET.has(ch) ? 1 : 0, nextBridge = ch === '=' ? 1 : 0, nextFord = ch === 'F' ? 1 : 0;
      if (nextWet === wet[c] && nextBridge === bridges[c] && nextFord === fords[c]) continue;
      wetChanged ||= nextWet !== wet[c]; bridgesChanged ||= nextBridge !== bridges[c];
      wet[c] = nextWet; bridges[c] = nextBridge; fords[c] = nextFord; moved.push(c);
    }
    // open water around the pending cells: their own discovery, and water found or gone within OPEN of a cell
    if (unknown) {
      const seen = new Set(moved);
      for (const c of pending) {
        const x = c % w, y = (c - x) / w;
        for (let ny = Math.max(0, y - OPEN); ny <= Math.min(h - 1, y + OPEN); ny++) for (let nx = Math.max(0, x - OPEN); nx <= Math.min(w - 1, x + OPEN); nx++) {
          const k = ny * w + nx, next = openAt(k);
          if (next !== open[k]) { open[k] = next; if (!seen.has(k)) { seen.add(k); moved.push(k); } }
        }
      }
    } else for (const c of moved) open[c] = wet[c];
    pending = new Set();
    for (const [x0, y0, x1, y1] of boxes(moved)) paintMask(x0, y0, x1, y1);
    // a cell's water line, flow or triangles move the four vertices around it
    if (wetChanged || bridgesChanged) for (const c of readFields()) { const x = c % w, y = (c - x) / w; markVertices(x, y, x + 1, y + 1); }
    // a dent reshapes the relief up to three cells around it, and a span lying on the ground follows the relief
    for (const c of relevel) { const x = c % w, y = (c - x) / w; markVertices(x - 3, y - 3, x + 4, y + 4); }
    relevel.clear();
    if (!options.deferred) jobs.flush();
  }
  for (let c = 0; c < n; c++) {
    const ch = grid[Math.floor(c / w)][c % w];
    wet[c] = WET.has(ch) ? 1 : 0; bridges[c] = ch === '=' ? 1 : 0; fords[c] = ch === 'F' ? 1 : 0;
  }
  for (let c = 0; c < n; c++) if (wet[c]) {
    open[c] = 1;
    const x = c % w, y = (c - x) / w;
    if (unknown) for (let ny = Math.max(0, y - OPEN); ny <= Math.min(h - 1, y + OPEN); ny++) for (let nx = Math.max(0, x - OPEN); nx <= Math.min(w - 1, x + OPEN); nx++)
      if (!wet[ny * w + nx] && unknown(ny * w + nx)) open[ny * w + nx] = 1;
  }
  paintMask(0, 0, w, h);
  readFields();
  for (let i = 0; i < parts.length; i++) publishChunk(i, buildChunk(i));

  return {
    mesh, mask, stats,
    get geometry() { return wholeGeometry(); },
    // chunks still to redraw (deferred)
    get pending() { return jobs.waiting; },
    get jobs() { return jobs.stats; },
    // cells: [[cell, char, level?], ...] already written into grid; a bridge or bank change rebuilds on the next tick
    changed(cells) {
      for (const [c, ch, lv] of cells || []) {
        if (WET.has(ch) || wet[c] || open[c]) { dirty = true; pending.add(c); }
        // a dent on or beside a span that lies on the ground moves that ground
        if (lv !== undefined && near(raised, c)) { dirty = true; relevel.add(c); }
      }
    },
    tick(now) {
      if (dirty) rebuild();
      if (options.deferred) jobs.run(options.budgetMs ?? 3);
      // wraps every 1000 s, where every speed in the shader lands on a whole cycle, so the wrap is invisible
      if (!gfx.low) uniforms.uTime.value = (now / 1000) % 1000;
    },
    dispose() {
      unsubscribe(); jobs.cancel();
      mesh.removeFromParent();
      for (const part of parts) part?.geometry.dispose();
      merged?.dispose(); material.dispose(); mask.dispose(); noise.dispose();
    },
  };
}
