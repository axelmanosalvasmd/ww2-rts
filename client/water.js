// Water: one see-through mesh over river (W), ford (F) and bridge (=) cells, painted like varnished resin on a terrain
// model. It draws before every other see-through thing and writes no depth, so the fog of war overlay, smoke and
// effects all still draw on top of it. A mask texture (4 texels per cell) holds the soft shoreline, a depth guess,
// the fords and the bridges; a per-vertex flow direction drives the slow drift. gfx.low freezes it (no animation).
import * as THREE from 'three';
import { CELL, CFG, levelOf } from '../shared/sim.js';
import { WET, WATER_LIFT, createWaterLevels } from './water-levels.js';
import { gfx } from './gfx.js';

const SUB = 4; // mask texels per cell
const LIFT = WATER_LIFT; // the surface sits this far above a flat bank
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

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

// Breadth-first step counts from the seed cells through cells that allow(c); -1 where it never reached.
function bfs(w, h, seeds, allow) {
  const d = new Int32Array(w * h).fill(-1), q = new Int32Array(w * h);
  let head = 0, tail = 0;
  for (const c of seeds) { d[c] = 0; q[tail++] = c; }
  while (head < tail) {
    const c = q[head++], x = c % w, y = (c - x) / w;
    for (const [dx, dy] of N4) {
      const nx = x + dx, ny = y + dy, n = ny * w + nx;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h || d[n] >= 0 || !allow(n)) continue;
      d[n] = d[c] + 1; q[tail++] = n;
    }
  }
  return d;
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
// a little sky sheen, stronger at grazing angles, so the resin reads as glossy under any sun angle
const FRAG_SHEEN = /* glsl */`
float wFres = 1.0 - clamp(dot(wN, normalize(cameraPosition - vWPos)), 0.0, 1.0);
totalEmissiveRadiance += uSky * (0.015 + 0.25 * wFres * wFres * wFres) * (1.0 - wFoam);
`;

// grid: the live terrain grid (rows of chars, updated in place by the caller); map: { w, h, heights }
export function createWater(grid, map, groundHeight) {
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

  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
  mesh.name = 'water';
  mesh.renderOrder = -1; // first of the see-through pass: fog of war, smoke and effects draw over it
  mesh.receiveShadow = true;

  let wet = new Uint8Array(n), bridges = new Uint8Array(n), raised = new Uint8Array(n), dirty = false, regeo = false;
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

  // one mask channel: cells where pick(c) is true, softened by a blur of radius r texels
  function channel(k, pick, r) {
    const bin = new Float32Array(MWs * MHs);
    for (let y = 0; y < MHs; y++) for (let x = 0; x < MWs; x++) bin[y * MWs + x] = pick(Math.floor(y / SUB) * w + Math.floor(x / SUB)) ? 1 : 0;
    const soft = blur(bin, MWs, MHs, r);
    for (let i = 0; i < soft.length; i++) maskData[i * 4 + k] = Math.min(255, soft[i] * 255 + 0.5);
  }

  // surface height and flow per vertex, and triangles over the wet cells plus one cell of bank around them
  function rebuildGeometry() {
    const water = waterLevels.read(grid);
    const { comp, compLevel, wl } = water;
    // Raised spans drape on the current ground while each body's water line stays fixed.
    raised = water.raised;

    // flow: toward one end of each body of water (the end on the map edge, if only one is), slower far from the banks
    const shore = bfs(w, h, [...Array(n).keys()].filter((c) => !wet[c]), (k) => wet[k]);
    const dist = new Int32Array(n).fill(-1), onEdge = (c) => c % w === 0 || c % w === w - 1 || c < w || c >= n - w;
    for (let id = 0; id < compLevel.length; id++) {
      const inComp = (k) => comp[k] === id, start = comp.indexOf(id);
      const far = (d) => { let best = start; for (let k = 0; k < n; k++) if (d[k] > d[best]) best = k; return best; };
      const a = far(bfs(w, h, [start], inComp));
      let d = bfs(w, h, [a], inComp);
      const b = far(d);
      if (onEdge(b) && !onEdge(a)) d = bfs(w, h, [b], inComp);
      for (let k = 0; k < n; k++) if (d[k] >= 0) dist[k] = d[k];
    }
    let fx = new Float32Array(n), fz = new Float32Array(n);
    for (let c = 0; c < n; c++) {
      if (!wet[c]) continue;
      const x = c % w, y = (c - x) / w;
      const at = (nx, ny) => { const k = ny * w + nx; return nx >= 0 && ny >= 0 && nx < w && ny < h && comp[k] === comp[c] ? dist[k] : dist[c]; };
      const gx = at(x + 1, y) - at(x - 1, y), gz = at(x, y + 1) - at(x, y - 1), len = Math.hypot(gx, gz);
      const s = shore[c] < 0 ? 0.25 : 1 - 0.75 * THREE.MathUtils.smoothstep(shore[c], 2, 8);
      if (len > 0) { fx[c] = (-gx / len) * s; fz[c] = (-gz / len) * s; }
    }
    for (let pass = 0; pass < 3; pass++) {
      const nx2 = new Float32Array(n), nz2 = new Float32Array(n);
      for (let c = 0; c < n; c++) {
        if (!wet[c]) continue;
        const x = c % w, y = (c - x) / w;
        let sx = 0, sz = 0, m = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const ax = x + dx, ay = y + dy, k = ay * w + ax;
          if (ax >= 0 && ay >= 0 && ax < w && ay < h && comp[k] === comp[c]) { sx += fx[k]; sz += fz[k]; m++; }
        }
        nx2[c] = sx / m; nz2[c] = sz / m;
      }
      fx = nx2; fz = nz2;
    }

    const W1 = w + 1, verts = W1 * (h + 1);
    const pos = new Float32Array(verts * 3), nor = new Float32Array(verts * 3), flow = new Float32Array(verts * 2);
    for (let vy = 0; vy <= h; vy++) for (let vx = 0; vx <= w; vx++) {
      const v = vy * W1 + vx;
      let y = Infinity, sx = 0, sz = 0, m = 0, ground = 0, cells = 0, drape = false;
      for (const [cx, cy] of [[vx - 1, vy - 1], [vx, vy - 1], [vx - 1, vy], [vx, vy]]) {
        if (cx < 0 || cy < 0 || cx >= w || cy >= h) continue;
        const c = cy * w + cx;
        if (wl[c] < y) y = wl[c];
        if (wet[c]) { sx += fx[c]; sz += fz[c]; m++; }
        ground += groundAt(c); cells++; drape ||= !!raised[c];
      }
      // Relief supplies the visible surface; the nominal corner average remains the fallback.
      if (drape) y = Math.max(y, groundHeight ? groundHeight(vx * CELL, vy * CELL) : ground / cells);
      pos[v * 3] = vx * CELL; pos[v * 3 + 1] = (y === Infinity ? 0 : y) + LIFT; pos[v * 3 + 2] = vy * CELL;
      nor[v * 3 + 1] = 1;
      if (m) { flow[v * 2] = sx / m; flow[v * 2 + 1] = sz / m; }
    }
    const index = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (Number.isNaN(wl[y * w + x])) continue;
      const a = y * W1 + x, b = a + 1, c = a + W1, d = c + 1;
      index.push(a, c, b, b, c, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('flow', new THREE.BufferAttribute(flow, 2));
    geo.setIndex(index);
    geo.computeBoundingSphere();
    mesh.geometry.dispose();
    mesh.geometry = geo;
  }

  function rebuild() {
    dirty = false;
    const nextWet = new Uint8Array(n), nextBridges = new Uint8Array(n);
    for (let c = 0; c < n; c++) {
      const ch = grid[Math.floor(c / w)][c % w];
      nextWet[c] = WET.has(ch) ? 1 : 0; nextBridges[c] = ch === '=' ? 1 : 0;
    }
    const wetChanged = nextWet.some((v, c) => v !== wet[c]), bridgesChanged = nextBridges.some((v, c) => v !== bridges[c]);
    const relevel = regeo;
    regeo = false;
    if (!wetChanged && !bridgesChanged && !relevel) return;
    wet = nextWet; bridges = nextBridges;
    if (wetChanged) {
      channel(0, (c) => wet[c], 2); // R: coverage, edge at about 0.3 (a third of a cell into the bank)
      channel(1, (c) => wet[c], 4); // G: how far from the bank, read as depth
      channel(2, (c) => grid[Math.floor(c / w)][c % w] === 'F', 2); // B: fords
    }
    if (wetChanged || bridgesChanged) { channel(3, (c) => bridges[c], 2); mask.needsUpdate = true; } // A: bridges
    if (wetChanged || bridgesChanged || relevel) rebuildGeometry();
  }
  rebuild();

  return {
    mesh,
    // cells: [[cell, char, level?], ...] already written into grid; a bridge or bank change rebuilds on the next tick
    changed(cells) {
      for (const [c, ch, lv] of cells || []) {
        if (WET.has(ch) || wet[c]) dirty = true;
        // a dent on or beside a span that lies on the ground moves that ground
        if (lv !== undefined && near(raised, c)) dirty = regeo = true;
      }
    },
    tick(now) {
      if (dirty) rebuild();
      // wraps every 1000 s, where every speed in the shader lands on a whole cycle, so the wrap is invisible
      if (!gfx.low) uniforms.uTime.value = (now / 1000) % 1000;
    },
    dispose() {
      unsubscribe();
      mesh.removeFromParent();
      mesh.geometry.dispose(); material.dispose(); mask.dispose(); noise.dispose();
    },
  };
}
