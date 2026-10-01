// Ground overlays: the shared plumbing for every ring, route line, zone and cell drawn on the terrain.
//
// Everything is flat geometry made of ribbons (a line with a width) and fills, in the XZ plane around its owner. One
// material patch (below) does the rest on the GPU:
//   - Draping: the vertex shader looks the ground height up in a texture of the relief (setTerrain), so any shape
//     follows hills and ramps, moves with its unit and never needs per-frame CPU work.
//   - Even width: a line's half-width is in meters but never drops under a pixel count, so it stays readable zoomed out
//     and crisp zoomed in. The offset is applied in the shader, so one geometry serves every zoom.
//   - Anti-aliasing: the fragment shader fades the ribbon's edge over one pixel (fwidth), draws the thin dark edge that
//     keeps a line readable on bright or dark ground, and cuts dashes with soft ends, all without textures.
//
// Vertex layout shared by every overlay geometry: position (x, lift above the ground, z of the center line),
// aEdge (offset direction x, z with the miter length baked in, half-width in meters, minimum half-width in pixels),
// aLine (distance along in meters, side from -1 to +1, where the dark edge starts). A vertex at side < -1 is the fill
// (the inside of a ring, a polygon) and takes the material's fill alpha.
import * as THREE from 'three';

const VIEW_H = { value: innerHeight };
addEventListener('resize', () => { VIEW_H.value = innerHeight; });

// ---------- the ground, as a texture ----------
// One half-float height per 1.25 m (the relief's own vertex spacing), sampled with linear filtering. A crater or a
// ramp changes a few cells, and refreshTerrain redoes only the samples around them.
const blank = new THREE.DataTexture(new Uint16Array([0]), 1, 1, THREE.RedFormat, THREE.HalfFloatType);
blank.needsUpdate = true;
const shared = { height: { value: blank }, map: { value: new THREE.Vector4(0, 0, 0, 0) }, drape: { value: 0 }, viewH: VIEW_H };
let field = null;

function fillField(i0, j0, i1, j1) {
  const { data, nx, nz, width, height, hAt } = field;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) data[j * nx + i] = THREE.DataUtils.toHalfFloat(hAt((i * width) / (nx - 1), (j * height) / (nz - 1)));
  field.tex.needsUpdate = true;
}
export function setTerrain(hAt, width, height, step = 1.25) {
  field?.tex.dispose();
  const nx = Math.max(2, Math.round(width / step) + 1), nz = Math.max(2, Math.round(height / step) + 1);
  const data = new Uint16Array(nx * nz), tex = new THREE.DataTexture(data, nx, nz, THREE.RedFormat, THREE.HalfFloatType);
  tex.minFilter = tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = false;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  field = { tex, data, nx, nz, width, height, hAt };
  fillField(0, 0, nx - 1, nz - 1);
  shared.height.value = tex;
  shared.map.value.set((nx - 1) / (nx * width), (nz - 1) / (nz * height), 0.5 / nx, 0.5 / nz);
  shared.drape.value = 1;
}
// the ground changed inside this box (meters); the margin covers the cells the relief reshapes around a change
export function refreshTerrain(x0, z0, x1, z1) {
  if (!field) return;
  const { nx, nz, width, height } = field, clamp = (v, n) => Math.max(0, Math.min(n - 1, v));
  fillField(clamp(Math.floor((x0 / width) * (nx - 1)) - 2, nx), clamp(Math.floor((z0 / height) * (nz - 1)) - 2, nz),
    clamp(Math.ceil((x1 / width) * (nx - 1)) + 2, nx), clamp(Math.ceil((z1 / height) * (nz - 1)) + 2, nz));
}

// ---------- the material patch ----------
const VERT_PARS = `
attribute vec4 aEdge;
attribute vec3 aLine;
varying vec3 vLine;
uniform float viewH;
uniform float uDrape;
uniform vec4 uMap;
uniform sampler2D uHeight;
`;
const VERT_BODY = `
{
  float sc = length(modelMatrix[0].xyz);
  vec3 wp = (modelMatrix * vec4(transformed, 1.0)).xyz;
  float depth = -(viewMatrix * vec4(wp, 1.0)).z;
  float hw = max(aEdge.z, aEdge.w * depth * 2.0 / (projectionMatrix[1][1] * viewH));
  transformed.xz += aEdge.xy * (hw / sc);
  if (uDrape > 0.5) {
    wp = (modelMatrix * vec4(transformed, 1.0)).xyz;
    float gy = texture2D(uHeight, wp.xz * uMap.xy + uMap.zw).r;
    transformed.y = (gy + position.y - modelMatrix[3].y) / sc;
  }
  vLine = aLine;
}
`;
const FRAG_PARS = `
uniform vec2 uDash;
uniform float uFill;
varying vec3 vLine;
`;
const FRAG_BODY = `
float lv = abs(vLine.y);
float aa = max(fwidth(vLine.y), 1e-3);
float band = 1.0 - smoothstep(1.0 - aa, 1.0, lv);
float dash = 1.0;
if (uDash.y > 0.0) {
  float p = mod(vLine.x, uDash.x), au = max(fwidth(vLine.x), 1e-3);
  dash = smoothstep(0.0, au, p) * (1.0 - smoothstep(uDash.y - au, uDash.y, p));
}
float body = max(1.0 - smoothstep(vLine.z - aa, vLine.z, lv), step(1.0, lv));
float inside = step(1.0, -vLine.y);
`;
const FRAG_END = `
diffuseColor.rgb = mix(vec3(0.012, 0.016, 0.014), diffuseColor.rgb, body);
diffuseColor.a *= band * dash * mix(0.55, 1.0, body) + inside * uFill;
`;

function patch(shader, m) {
  const o = m.userData;
  Object.assign(shader.uniforms, {
    viewH: shared.viewH, uDrape: shared.drape, uMap: shared.map, uHeight: shared.height,
    uDash: { value: new THREE.Vector2(o.dash?.[0] ?? 1, o.dash?.[1] ?? 0) }, uFill: { value: o.fill ?? 0 },
  });
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT_BODY}`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${FRAG_PARS}`)
    .replace('vec4 diffuseColor = vec4( diffuse, opacity );', `${FRAG_BODY}\nvec4 diffuseColor = vec4( diffuse, opacity );`)
    .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAG_END}`);
}

// A new material for one look. Cached by overlayMat; build one directly when it needs its own opacity or color.
//   depthTest   true paints on the ground and hides behind buildings and trees; false draws over everything
//   dash        [period, on] in meters, or null for a solid line
//   fill        alpha of the inside of a ring or polygon (times opacity and vertex alpha)
export function makeOverlay({ color = 0xffffff, opacity = 1, depthTest = true, vertexColors = false, dash = null, fill = 0, clip = null } = {}) {
  const m = new THREE.MeshBasicMaterial({
    color, opacity, vertexColors, transparent: true, depthTest, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    polygonOffset: depthTest, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
  });
  if (clip) m.clippingPlanes = clip;
  Object.assign(m.userData, { dash, fill });
  m.onBeforeCompile = (shader) => patch(shader, m);
  m.customProgramCacheKey = () => 'overlay';
  return m;
}
const mats = new Map();
export function overlayMat(o = {}) {
  const key = [o.color ?? 0xffffff, o.opacity ?? 1, o.depthTest ?? true, o.vertexColors ?? false, o.dash, o.fill ?? 0].join('|');
  let m = mats.get(key);
  if (!m) mats.set(key, m = makeOverlay(o));
  return m;
}

// ---------- geometry ----------
// Vertices and triangles for one overlay geometry, in growable typed arrays. A static shape builds once and
// toGeometry() copies it out; a Batch keeps one around and rewrites it each snapshot.
const tmp = new THREE.Color();
const T = []; // scratch for line(): x, z, distance along

export class Builder {
  constructor({ colored = false, cap = 512 } = {}) {
    this.colored = colored; this.nv = 0; this.ni = 0; this.cap = 0; this.icap = 0; this.version = 0;
    this.r = this.g = this.b = this.a = 1;
    this.grow(cap, cap * 3);
  }
  grow(vcap, icap) {
    const make = (old, size) => { const a = new Float32Array(vcap * size); if (old) a.set(old.subarray(0, this.nv * size)); return a; };
    this.pos = make(this.pos, 3); this.edge = make(this.edge, 4); this.ln = make(this.ln, 3);
    this.col = this.colored ? make(this.col, 4) : null;
    const idx = new Uint32Array(icap); if (this.idx) idx.set(this.idx.subarray(0, this.ni));
    this.idx = idx; this.cap = vcap; this.icap = icap; this.version++;
  }
  reset() { this.nv = 0; this.ni = 0; return this; }
  color(hex, a = 1) { tmp.setHex(hex); this.r = tmp.r; this.g = tmp.g; this.b = tmp.b; this.a = a; return this; }
  vert(x, y, z, ex, ez, hw, mn, u, v, core) {
    if (this.nv >= this.cap) this.grow(this.cap * 2, this.icap * 2);
    const i = this.nv++, p = this.pos, e = this.edge, l = this.ln;
    p[i * 3] = x; p[i * 3 + 1] = y; p[i * 3 + 2] = z;
    e[i * 4] = ex; e[i * 4 + 1] = ez; e[i * 4 + 2] = hw; e[i * 4 + 3] = mn;
    l[i * 3] = u; l[i * 3 + 1] = v; l[i * 3 + 2] = core;
    if (this.col) { const c = this.col; c[i * 4] = this.r; c[i * 4 + 1] = this.g; c[i * 4 + 2] = this.b; c[i * 4 + 3] = this.a; }
    return i;
  }
  tri(a, b, c) {
    if (this.ni + 3 > this.icap) this.grow(this.cap, this.icap * 2);
    this.idx[this.ni++] = a; this.idx[this.ni++] = b; this.idx[this.ni++] = c;
  }
  quad(a, b, c, d) { this.tri(a, b, c); this.tri(b, d, c); }

  // A line through the first n points of pts ([x, z, x, z, ...]) with mitered corners. o: { w width in meters,
  // min minimum half-width in pixels, core where the dark edge starts (0..1), y lift, closed, step longest segment
  // (draping needs a vertex every so often), uEnd count distance from the far end so dashes hold still there,
  // dashPeriod fit a whole number of dashes into a closed line }
  line(pts, n, o) {
    const { w = 0.3, min = 1.1, core = 0.74, y = 0.1, closed = false, step = 0, uEnd = false } = o;
    T.length = 0;
    let s = 0;
    T.push(pts[0], pts[1], 0);
    const seg = (ax, az, bx, bz) => {
      const l = Math.hypot(bx - ax, bz - az);
      if (l < 1e-4) return;
      const k = step ? Math.max(1, Math.ceil(l / step)) : 1;
      for (let j = 1; j <= k; j++) T.push(ax + ((bx - ax) * j) / k, az + ((bz - az) * j) / k, s + (l * j) / k);
      s += l;
    };
    for (let i = 1; i < n; i++) seg(pts[i * 2 - 2], pts[i * 2 - 1], pts[i * 2], pts[i * 2 + 1]);
    if (closed) seg(pts[n * 2 - 2], pts[n * 2 - 1], pts[0], pts[1]);
    const m = T.length / 3;
    if (m < 2) return;
    const L = s, k = o.dashPeriod ? (Math.max(1, Math.round(L / o.dashPeriod)) * o.dashPeriod) / L : 1;
    let first = -1, prev = -1, prev2 = -1;
    for (let i = 0; i < m; i++) {
      const x = T[i * 3], z = T[i * 3 + 1];
      // directions of the segments before and after this point (the closing point wraps to the start)
      let ax = 0, az = 0, bx = 0, bz = 0;
      const pi = i > 0 ? i - 1 : closed ? m - 2 : -1, ni = i < m - 1 ? i + 1 : closed ? 1 : -1;
      if (pi >= 0) { ax = x - T[pi * 3]; az = z - T[pi * 3 + 1]; const l = Math.hypot(ax, az) || 1; ax /= l; az /= l; }
      if (ni >= 0) { bx = T[ni * 3] - x; bz = T[ni * 3 + 1] - z; const l = Math.hypot(bx, bz) || 1; bx /= l; bz /= l; }
      if (pi < 0) { ax = bx; az = bz; } else if (ni < 0) { bx = ax; bz = az; }
      // the mitered normal: the average of the two segment normals, stretched so the width holds through a corner
      let nx = -az - bz, nz = ax + bx;
      const nl = Math.hypot(nx, nz);
      if (nl < 1e-4) { nx = -bz; nz = bx; } else {
        nx /= nl; nz /= nl;
        const cos = Math.max(0.55, nx * -az + nz * ax);
        nx /= cos; nz /= cos;
      }
      const u = (uEnd ? L - T[i * 3 + 2] : T[i * 3 + 2]) * k;
      const a = this.vert(x, y, z, nx, nz, w / 2, min, u, 1, core), b = this.vert(x, y, z, -nx, -nz, w / 2, min, u, -1, core);
      if (i) this.quad(prev, prev2, a, b);
      if (i === 0) first = a;
      prev = a; prev2 = b;
    }
    return first;
  }

  // A filled arrowhead with its tip at (x, z) pointing along (dx, dz). Two triangles split along its axis so each
  // edge carries its own side value and anti-aliases like a ribbon edge. rim: width of the dark edge in meters.
  arrow(x, z, dx, dz, len, half, { y = 0.1, rim = 0.04 } = {}) {
    const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    const nx = -dz, nz = dx, bx = x - dx * len, bz = z - dz * len;
    const edge = (half * len) / Math.hypot(half, len), core = Math.max(0.5, 1 - rim / edge);
    const A = this.vert(bx + nx * half, y, bz + nz * half, 0, 0, 0, 0, 0, 1, core);
    const B = this.vert(bx - nx * half, y, bz - nz * half, 0, 0, 0, 0, 0, -1, core);
    const M = this.vert(bx, y, bz, 0, 0, 0, 0, 0, 0, core);
    const TL = this.vert(x, y, z, 0, 0, 0, 0, 0, 1, core), TR = this.vert(x, y, z, 0, 0, 0, 0, 0, -1, core);
    this.tri(A, M, TL); this.tri(B, M, TR);
  }

  // A ring around the origin (or an arc of it from north, clockwise), drawn as a ribbon. With fill, the inside is
  // covered too. o: { w, min, core, y, fill, dashPeriod, arc: fraction of the circle, segs, ox, oz: center }
  ring(r, o = {}) {
    const { w = 0.3, min = 1.1, core = 0.74, y = 0.1, fill = false, arc = 1, ox = 0, oz = 0 } = o;
    const full = Math.PI * 2 * Math.min(1, arc), n = o.segs ?? Math.max(40, Math.min(360, Math.ceil((Math.PI * 2 * r) / 1.1)));
    const k = o.dashPeriod ? (Math.max(1, Math.round((Math.PI * 2 * r) / o.dashPeriod)) * o.dashPeriod) / (Math.PI * 2 * r) : 1;
    const hub = fill ? this.vert(ox, y, oz, 0, 0, 0, 0, 0, -3, core) : -1;
    let prev = -1, prev2 = -1;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * full, sx = Math.sin(a), sz = -Math.cos(a), u = a * r * k;
      const p = this.vert(ox + sx * r, y, oz + sz * r, sx, sz, w / 2, min, u, 1, core), q = this.vert(ox + sx * r, y, oz + sz * r, -sx, -sz, w / 2, min, u, -1, core);
      if (i) { this.quad(prev2, prev, q, p); if (fill) this.tri(hub, prev2, q); }
      prev = p; prev2 = q;
    }
  }

  // an axis-aligned fill split into nx by nz quads so it can follow the ground
  fillRect(x0, z0, x1, z1, nx, nz, y = 0.1) {
    const base = this.nv;
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) this.vert(x0 + ((x1 - x0) * i) / nx, y, z0 + ((z1 - z0) * j) / nz, 0, 0, 0, 0, 0, -3, 0.74);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const a = base + j * (nx + 1) + i; this.quad(a, a + 1, a + nx + 1, a + nx + 2); }
  }

  toGeometry() {
    const g = new THREE.BufferGeometry(), nv = this.nv;
    g.setAttribute('position', new THREE.BufferAttribute(this.pos.slice(0, nv * 3), 3));
    g.setAttribute('aEdge', new THREE.BufferAttribute(this.edge.slice(0, nv * 4), 4));
    g.setAttribute('aLine', new THREE.BufferAttribute(this.ln.slice(0, nv * 3), 3));
    if (this.col) g.setAttribute('color', new THREE.BufferAttribute(this.col.slice(0, nv * 4), 4));
    g.setIndex(new THREE.BufferAttribute(this.idx.slice(0, this.ni), 1));
    return g;
  }
}

// A mesh whose geometry is rewritten in place: begin(), draw with batch.b, end(). Growing the buffers (doubling)
// is the only time it makes GPU objects.
export class Batch {
  constructor(material, { colored = true, order = 3 } = {}) {
    this.b = new Builder({ colored });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = order;
    this.version = -1;
    this.end();
  }
  begin() { this.b.reset(); return this.b; }
  end() {
    const b = this.b, g = this.mesh.geometry;
    if (this.version !== b.version) {
      const old = g, next = new THREE.BufferGeometry(), attr = (name, array, size) => next.setAttribute(name, new THREE.BufferAttribute(array, size).setUsage(THREE.DynamicDrawUsage));
      attr('position', b.pos, 3); attr('aEdge', b.edge, 4); attr('aLine', b.ln, 3);
      if (b.col) attr('color', b.col, 4);
      next.setIndex(new THREE.BufferAttribute(b.idx, 1).setUsage(THREE.DynamicDrawUsage));
      this.mesh.geometry = next; old.dispose(); this.version = b.version;
    }
    const geo = this.mesh.geometry;
    geo.setDrawRange(0, b.ni);
    this.mesh.visible = b.ni > 0;
    if (!b.ni) return;
    const touch = (a, size, n) => { a.clearUpdateRanges(); a.addUpdateRange(0, n * size); a.needsUpdate = true; };
    touch(geo.getAttribute('position'), 3, b.nv); touch(geo.getAttribute('aEdge'), 4, b.nv); touch(geo.getAttribute('aLine'), 3, b.nv);
    if (b.col) touch(geo.getAttribute('color'), 4, b.nv);
    touch(geo.index, 1, b.ni);
  }
}
