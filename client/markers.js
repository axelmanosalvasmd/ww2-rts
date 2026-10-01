// Map markings in a grease-pencil look: unit and selection rings, weapon range rings, order lines with arrowheads,
// capture point rings and flags, the military symbol badge over each unit and the text tags in the world.
// Textures, materials and ring geometries are made once and shared; order lines reuse two growable buffers, so a
// snapshot only rewrites vertex data and never makes or frees GPU objects.
import * as THREE from 'three';
import { UNITS } from '/shared/sim.js';
import { drawSymbol } from './symbols.js';

const css = (c) => '#' + c.toString(16).padStart(6, '0');
const hash = (n) => { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
const lum = (c) => (0.299 * ((c >> 16) & 255) + 0.587 * ((c >> 8) & 255) + 0.114 * (c & 255)) / 255;

export const CHALK = 0xf2ecdc, INK = '#2b2418', HALO = 0x16160f;
// order line colors keep their meaning: blue move, orange attack-move, white retreat, red attack, yellow dig/build
export const PLAN_COLORS = { 1: 0x6fa8f0, 2: 0xf0973a, 3: 0xf4efe2, 4: 0xe2483a, 5: 0xe2483a, 6: 0xe2483a, 7: 0xe8c860, 8: 0xe8c860, 9: 0x6fa8f0 };
export const MOVE_COLOR = PLAN_COLORS[1], ATTACK_COLOR = PLAN_COLORS[4];

// ---------- pencil stroke textures ----------
// White with a grainy alpha: ragged edges, streaks along the stroke and paper grain. The strip tiles along u (the
// edge wobble uses whole cycles across the width), so one texture serves every line and ring. Geometry carries u in
// meters; texture.repeat turns that into one tile every PERIOD meters.
const PERIOD = { solid: 7, dashed: 2.4 };
const tex = {};
function strokeTexture(style) {
  if (tex[style]) return tex[style];
  const W = 256, H = 32, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const c = cv.getContext('2d'), img = c.createImageData(W, H), d = img.data;
  const wave = (x, k, p) => Math.sin((x / W) * Math.PI * 2 * k + p);
  const streak = Array.from({ length: H }, (_, y) => 0.72 + 0.28 * hash(y * 3.3 + 1));
  for (let x = 0; x < W; x++) {
    const top = 5 + 1.4 * wave(x, 3, 0.4) + 0.7 * wave(x, 11, 2.1) + 0.5 * wave(x, 23, 4.2);
    const bot = H - 5 + 1.4 * wave(x, 4, 1.3) + 0.7 * wave(x, 13, 0.2) + 0.5 * wave(x, 29, 5.1);
    // dashes: 62% ink, soft ends so they read as pencil dabs
    let dash = 1;
    if (style === 'dashed') { const f = x / W; dash = f < 0.62 ? Math.min(1, f / 0.06, (0.62 - f) / 0.08) : 0; }
    for (let y = 0; y < H; y++) {
      const edge = Math.max(0, Math.min(1, (y - top) / 2.2, (bot - y) / 2.2));
      const grain = 0.68 + 0.32 * hash(x * 31.7 + y * 7.9);
      const a = edge * streak[y] * grain * dash, i = (y * W + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = Math.round(255 * Math.min(1, a * 1.08));
    }
  }
  c.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = THREE.RepeatWrapping; t.repeat.set(1 / PERIOD[style], 1); t.anisotropy = 4;
  return (tex[style] = t);
}

// shared materials, one per look
const mats = new Map();
export function pencilMat(color, { dashed = false, opacity = 1, depthTest = true, vertexColors = false } = {}) {
  const key = `${color}|${dashed}|${opacity}|${depthTest}|${vertexColors}`;
  let m = mats.get(key);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color, map: strokeTexture(dashed ? 'dashed' : 'solid'), transparent: true, opacity, depthTest, depthWrite: false, side: THREE.DoubleSide, vertexColors });
    mats.set(key, m);
  }
  return m;
}

// ---------- hand-drawn rings ----------
// A ring in the XZ plane, drawn clockwise from north. A loop wobbles a little, tapers where the pencil lands and
// lifts, and runs past its start so the ends overlap. An arc (for capture progress) is an even band with 6 indices
// per segment, so setDrawRange(0, k * 6) shows the first k segments.
const ringGeos = new Map();
function ringGeometry(r, w, { arc = false, segs = 0 } = {}) {
  const key = `${r.toFixed(2)}|${w}|${arc}|${segs}`;
  if (ringGeos.has(key)) return ringGeos.get(key);
  const n = segs || Math.max(36, Math.min(180, Math.round(r * 7)));
  const over = arc ? 0 : 0.34, total = Math.PI * 2 + over;
  const p1 = hash(r * 9.1) * 6.28, p2 = hash(r * 3.7 + 1) * 6.28, start = arc ? 0 : hash(r * 5.3 + 2) * 6.28;
  const pos = new Float32Array((n + 1) * 6), uv = new Float32Array((n + 1) * 4), idx = [];
  let u = 0, px = 0, pz = 0;
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * total, a = start + t;
    const k = arc ? 1 : 1 + 0.022 * (0.6 * Math.sin(2 * a + p1) + 0.4 * Math.sin(3 * a + p2)) + (t / total - 0.5) * 0.05;
    const hw = (w / 2) * (arc ? 1 : 0.55 + 0.45 * Math.min(1, t / 0.5, (total - t) / 0.5));
    const sx = Math.sin(a), sz = -Math.cos(a), cx = sx * r * k, cz = sz * r * k;
    if (i) u += Math.hypot(cx - px, cz - pz);
    px = cx; pz = cz;
    pos.set([sx * (r * k - hw), 0, sz * (r * k - hw), sx * (r * k + hw), 0, sz * (r * k + hw)], i * 6);
    uv.set([u, 0, u, 1], i * 4);
    if (i < n) { const b = i * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  if (!arc) ringGeos.set(key, g);
  return g;
}

function ringMesh(r, w, material, y, order = 2) {
  const m = new THREE.Mesh(ringGeometry(r, w), material);
  m.position.y = y; m.renderOrder = order;
  return m;
}

// the ring under a unit, in its owner's color (white while it retreats)
export const ownerRing = (radius, color) => ringMesh(radius, 0.34, pencilMat(color, { opacity: 0.92 }), 0.15);
export function setOwnerRing(mesh, color) { const m = pencilMat(color, { opacity: 0.92 }); if (mesh.material !== m) mesh.material = m; }

// selection: a bold chalk ring over a dark halo, so it reads on any ground and for every player color.
// Weapon range rings (dashed chalk) hang off it, so they show and hide with the selection.
export function selectionRing(radius, ranges = []) {
  const g = new THREE.Group();
  g.add(ringMesh(radius, 0.78, pencilMat(HALO, { opacity: 0.5 }), 0.16), ringMesh(radius, 0.42, pencilMat(CHALK), 0.17));
  g.visible = false;
  let range = null;
  if (ranges.length) {
    range = new THREE.Group(); range.visible = false;
    for (const r of ranges) range.add(ringMesh(r, 0.38, pencilMat(CHALK, { dashed: true, opacity: 0.6, depthTest: false }), 0.2));
    g.add(range);
  }
  return { sel: g, range };
}

// the reinforce circle around an HQ
export const hqRing = (R, color) => ringMesh(R - 0.35, 0.8, pencilMat(color, { opacity: 0.88 }), 0.07, 1);

// click feedback: its own material, since each one fades on its own
export function clickRing(color) {
  const m = new THREE.Mesh(ringGeometry(1, 0.26), new THREE.MeshBasicMaterial({ color, map: strokeTexture('solid'), transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide }));
  m.renderOrder = 3;
  return m;
}

// ---------- unit symbol badges ----------
// The unit's military map symbol, frame filled in the owner's color with chalk lines (dark ink on the chalk player).
const badgeMats = new Map(), badgeGeo = new THREE.PlaneGeometry(1, 1);
export function symbolBadge(type, color) {
  const key = type + '|' + color;
  let m = badgeMats.get(key);
  if (!m) {
    const cv = document.createElement('canvas'); cv.width = cv.height = 128;
    drawSymbol(cv.getContext('2d'), type, 64, 64, 112, { color: lum(color) > 0.7 ? INK : '#f4efe2', fill: css(color), halo: 'rgba(18,18,12,0.9)', stroke: 9 });
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    m = new THREE.MeshBasicMaterial({ map: t, transparent: true, depthTest: false, depthWrite: false });
    badgeMats.set(key, m);
  }
  const b = new THREE.Mesh(badgeGeo, m);
  b.scale.set(1.45, 1.45, 1); b.position.set(-1.98, 0.08, 0.02); b.renderOrder = 5;
  return b;
}

// ---------- text tags ----------
// HQ names in Stardos Stencil with an owner-color bar; point and node tags in Courier Prime. Canvas text drawn
// before a web font arrives uses the fallback, so every tag is redrawn when fonts finish loading.
const LABEL = {
  hq: { w: 512, h: 112, sx: 11, px: 62, font: (px) => `700 ${px}px "Stardos Stencil", Impact, sans-serif`, upper: true, spacing: 3 },
  tag: { w: 256, h: 64, sx: 8, px: 32, font: (px) => `700 ${px}px "Courier Prime", "IBM Plex Mono", monospace`, upper: false, spacing: 0 },
};
const labels = new Map();
function paintLabel(e) {
  const st = LABEL[e.style], c = e.cv.getContext('2d'), W = st.w, H = st.h, bar = e.color != null ? 14 : 0, pad = 14;
  c.clearRect(0, 0, W, H);
  if ('letterSpacing' in c) c.letterSpacing = st.spacing + 'px';
  let px = st.px; c.font = st.font(px);
  while (c.measureText(e.text).width > W - 2 * pad - bar - 8 && px > 12) c.font = st.font(px -= 2);
  const bw = Math.min(W - 4, c.measureText(e.text).width + 2 * pad + bar), bh = H - 12, x0 = (W - bw) / 2, y0 = 6;
  c.fillStyle = 'rgba(34, 37, 27, 0.86)'; c.fillRect(x0, y0, bw, bh);
  c.strokeStyle = 'rgba(236, 230, 214, 0.35)'; c.lineWidth = 2; c.strokeRect(x0 + 1, y0 + 1, bw - 2, bh - 2);
  if (bar) { c.fillStyle = css(e.color); c.fillRect(x0, y0, bar, bh); }
  c.fillStyle = '#e6dcc0'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText(e.text, x0 + bar + (bw - bar) / 2, H / 2 + (e.style === 'hq' ? 4 : 2));
}
let fontsHooked = false;
function hookFonts() {
  if (fontsHooked || !document.fonts) return;
  fontsHooked = true;
  const redraw = () => { for (const e of labels.values()) { paintLabel(e); e.tex.needsUpdate = true; } };
  const want = () => Promise.all([LABEL.hq.font(62), LABEL.tag.font(32)].map(f => document.fonts.load(f))).then(redraw, redraw);
  document.fonts.addEventListener('loadingdone', redraw);
  if (document.readyState === 'complete') want(); else addEventListener('load', want, { once: true });
}
export function label(text, { style = 'tag', color = null } = {}) {
  hookFonts();
  const st = LABEL[style], shown = st.upper ? String(text).toUpperCase() : String(text), key = `${style}|${color}|${shown}`;
  let e = labels.get(key);
  if (!e) {
    const cv = document.createElement('canvas'); cv.width = st.w; cv.height = st.h;
    e = { cv, style, color, text: shown };
    paintLabel(e);
    e.tex = new THREE.CanvasTexture(cv); e.tex.colorSpace = THREE.SRGBColorSpace;
    e.mat = new THREE.SpriteMaterial({ map: e.tex, depthTest: false, transparent: true });
    labels.set(key, e);
  }
  const sp = new THREE.Sprite(e.mat);
  sp.scale.set(st.sx, (st.sx * st.h) / st.w, 1); sp.position.y = 10; sp.renderOrder = 5;
  return sp;
}

// ---------- flags ----------
// one grayscale cloth texture (folds, weave, a hem on the pole side), tinted per owner
let cloth = null;
const flagMats = new Map();
export function flagMat(color) {
  let m = flagMats.get(color);
  if (!m) {
    if (!cloth) {
      const cv = document.createElement('canvas'); cv.width = 128; cv.height = 64;
      const c = cv.getContext('2d');
      c.fillStyle = '#f2f0ea'; c.fillRect(0, 0, 128, 64);
      for (let x = 0; x < 128; x++) {
        const s = 0.5 + 0.5 * Math.sin((x / 128) * Math.PI * 5 + 0.6) * Math.sin((x / 128) * Math.PI * 1.3 + 0.3);
        c.fillStyle = `rgba(40, 36, 28, ${0.2 * s})`; c.fillRect(x, 0, 1, 64);
      }
      for (let i = 0; i < 900; i++) { c.fillStyle = `rgba(30, 28, 20, ${0.05 + 0.06 * hash(i)})`; c.fillRect(hash(i * 1.7) * 128, hash(i * 2.9) * 64, 1, 1); }
      c.fillStyle = 'rgba(30, 26, 18, 0.22)'; c.fillRect(0, 0, 6, 64);
      cloth = new THREE.CanvasTexture(cv); cloth.colorSpace = THREE.SRGBColorSpace;
    }
    m = new THREE.MeshLambertMaterial({ color, map: cloth, side: THREE.DoubleSide });
    flagMats.set(color, m);
  }
  return m;
}

// ---------- capture points ----------
// A dashed chalk ring while neutral, a solid ring in the owner's color once held, a pencil progress arc and a
// cloth flag. set() only swaps shared materials and moves the arc's draw range.
const NEUTRAL_RING = 0xd8d0bc, NEUTRAL_FLAG = 0x8f8a7c, PROG_SEGS = 64, flagGeo = new THREE.PlaneGeometry(1, 1);
export function capturePoint(radius, text) {
  const group = new THREE.Group();
  const ring = ringMesh(radius - 0.3, 0.62, pencilMat(NEUTRAL_RING, { dashed: true, opacity: 0.7, depthTest: false }), 0.3);
  // progress is a broad band, shaded in with the side of the pencil, inside the ring
  const prog = new THREE.Mesh(ringGeometry(radius - 1.5, 1.5, { arc: true, segs: PROG_SEGS }), pencilMat(0xffffff, { opacity: 0.45, depthTest: false }));
  prog.position.y = 0.32; prog.renderOrder = 2; prog.geometry.setDrawRange(0, 0);
  const flag = new THREE.Mesh(flagGeo, flagMat(NEUTRAL_FLAG));
  flag.scale.set(2.2, 1.4, 1); flag.position.set(1.1, 7.2, 0); flag.castShadow = true;
  group.add(ring, prog, flag, label(text));
  const swap = (o, m) => { if (o.material !== m) o.material = m; };
  return {
    group,
    // owner and capper are player colors, or null
    set(owner, capper, progress) {
      swap(ring, owner != null ? pencilMat(owner, { opacity: 0.9, depthTest: false }) : pencilMat(NEUTRAL_RING, { dashed: true, opacity: 0.7, depthTest: false }));
      swap(flag, flagMat(owner ?? NEUTRAL_FLAG));
      swap(prog, pencilMat(owner ?? capper ?? 0xffffff, { opacity: 0.45, depthTest: false }));
      prog.geometry.setDrawRange(0, Math.round(progress * PROG_SEGS) * 6);
    },
  };
}

// ---------- order lines ----------
// Quads appended into a preallocated buffer each snapshot. Vertex colors (with alpha) carry each line's color, so
// one solid and one dashed mesh draw every order on screen. A buffer that runs out doubles once and keeps the room.
class StrokeBatch {
  constructor(material) {
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 3;
    this.n = 0; this.cap = 0;
    this.grow(512);
  }
  grow(cap) {
    const old = this.mesh.geometry, g = new THREE.BufferGeometry(), v = cap * 4;
    const attr = (name, size) => {
      const a = new THREE.BufferAttribute(new Float32Array(v * size), size).setUsage(THREE.DynamicDrawUsage);
      const prev = old.getAttribute(name); if (prev) a.array.set(prev.array);
      g.setAttribute(name, a); return a.array;
    };
    this.pos = attr('position', 3); this.uv = attr('uv', 2); this.col = attr('color', 4);
    const idx = new (v > 65535 ? Uint32Array : Uint16Array)(cap * 6);
    for (let q = 0; q < cap; q++) idx.set([q * 4, q * 4 + 1, q * 4 + 2, q * 4 + 1, q * 4 + 3, q * 4 + 2], q * 6);
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    this.mesh.geometry = g; old.dispose(); this.cap = cap;
  }
  // a and b are the left and right edge at the start of the quad, c and d at its end
  quad(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, u0, u1, r, gr, bl, al) {
    if (this.n >= this.cap) this.grow(this.cap * 2);
    const q = this.n++, p = this.pos, t = this.uv, k = this.col;
    p[q * 12] = ax; p[q * 12 + 1] = ay; p[q * 12 + 2] = az; p[q * 12 + 3] = bx; p[q * 12 + 4] = by; p[q * 12 + 5] = bz;
    p[q * 12 + 6] = cx; p[q * 12 + 7] = cy; p[q * 12 + 8] = cz; p[q * 12 + 9] = dx; p[q * 12 + 10] = dy; p[q * 12 + 11] = dz;
    t[q * 8] = u0; t[q * 8 + 1] = 0; t[q * 8 + 2] = u0; t[q * 8 + 3] = 1; t[q * 8 + 4] = u1; t[q * 8 + 5] = 0; t[q * 8 + 6] = u1; t[q * 8 + 7] = 1;
    for (let i = 0; i < 4; i++) { k[q * 16 + i * 4] = r; k[q * 16 + i * 4 + 1] = gr; k[q * 16 + i * 4 + 2] = bl; k[q * 16 + i * 4 + 3] = al; }
  }
  end() {
    const g = this.mesh.geometry, n = this.n;
    g.setDrawRange(0, n * 6);
    this.mesh.visible = n > 0;
    if (!n) return;
    for (const [name, size] of [['position', 3], ['uv', 2], ['color', 4]]) {
      const a = g.getAttribute(name);
      a.clearUpdateRanges(); a.addUpdateRange(0, n * 4 * size); a.needsUpdate = true;
    }
  }
}

// Scratch space reused every draw: P holds the polyline being built (x, z pairs), S its resampled points (x, z, s).
const P = [], S = [], tmpColor = new THREE.Color();
// wobble tied to the ground, so a line does not shimmer as the unit at its start moves
const wob = (x, z) => 0.5 * Math.sin(x * 0.53 + z * 0.31) + 0.35 * Math.sin(x * 0.17 - z * 0.71 + 1.3) + 0.15 * Math.sin(x * 1.37 + z * 1.11);

// Cut length d off the end (or the start) of the first n points of P; returns how many points remain.
function trimEnd(n, d) {
  while (n >= 2 && d > 0) {
    const ax = P[n * 2 - 4], az = P[n * 2 - 3], bx = P[n * 2 - 2], bz = P[n * 2 - 1], l = Math.hypot(bx - ax, bz - az);
    if (l <= d) { n--; d -= l; continue; }
    P[n * 2 - 2] = bx + ((ax - bx) / l) * d; P[n * 2 - 1] = bz + ((az - bz) / l) * d; d = 0;
  }
  return n;
}
function trimStart(n, d) {
  let i = 0;
  while (n - i >= 2 && d > 0) {
    const ax = P[i * 2], az = P[i * 2 + 1], bx = P[i * 2 + 2], bz = P[i * 2 + 3], l = Math.hypot(bx - ax, bz - az);
    if (l <= d) { i++; d -= l; continue; }
    P[i * 2] = ax + ((bx - ax) / l) * d; P[i * 2 + 1] = az + ((bz - az) / l) * d; d = 0;
  }
  if (i) { P.copyWithin(0, i * 2, n * 2); n -= i; }
  return n;
}
const lengthOf = (n) => { let l = 0; for (let i = 1; i < n; i++) l += Math.hypot(P[i * 2] - P[i * 2 - 2], P[i * 2 + 1] - P[i * 2 - 1]); return l; };

export function planLayer(hAt) {
  const group = new THREE.Group();
  const solid = new StrokeBatch(pencilMat(0xffffff, { depthTest: false, vertexColors: true }));
  const dashed = new StrokeBatch(pencilMat(0xffffff, { dashed: true, depthTest: false, vertexColors: true }));
  group.add(solid.mesh, dashed.mesh);
  let cr = 1, cg = 1, cb = 1, ca = 1;
  const color = (hex, a) => { tmpColor.setHex(hex); cr = tmpColor.r; cg = tmpColor.g; cb = tmpColor.b; ca = a; };

  // the first n points of P as one stroke: resampled every 2.5 m, draped over the ground, slightly wobbly,
  // thinner where the pencil lands and lifts; u runs from the far end so dashes stay put near the goal
  function stroke(batch, n, width, wobble = 0.13) {
    S.length = 0;
    let s = 0;
    S.push(P[0], P[1], 0);
    for (let i = 1; i < n; i++) {
      const ax = P[i * 2 - 2], az = P[i * 2 - 1], bx = P[i * 2], bz = P[i * 2 + 1], l = Math.hypot(bx - ax, bz - az);
      if (l < 1e-3) continue;
      const k = Math.ceil(l / 2.5);
      for (let j = 1; j <= k; j++) S.push(ax + ((bx - ax) * j) / k, az + ((bz - az) * j) / k, s + (l * j) / k);
      s += l;
    }
    const m = S.length / 3, L = s;
    if (m < 2) return;
    let plx = 0, ply = 0, plz = 0, prx = 0, prz = 0, pu = 0;
    for (let i = 0; i < m; i++) {
      const x = S[i * 3], z = S[i * 3 + 1], si = S[i * 3 + 2], i0 = Math.max(0, i - 1), i1 = Math.min(m - 1, i + 1);
      const tx = S[i1 * 3] - S[i0 * 3], tz = S[i1 * 3 + 1] - S[i0 * 3 + 1], tl = Math.hypot(tx, tz) || 1, nx = -tz / tl, nz = tx / tl;
      const off = wobble * wob(x, z), hw = (width / 2) * (0.6 + 0.4 * Math.min(1, si / 1.2, (L - si) / 1.2));
      const cx = x + nx * off, cz = z + nz * off, y = hAt(x, z) + 0.3, u = L - si;
      const lx = cx + nx * hw, lz = cz + nz * hw, rx = cx - nx * hw, rz = cz - nz * hw;
      if (i) batch.quad(plx, ply, plz, prx, ply, prz, lx, y, lz, rx, y, rz, pu, u, cr, cg, cb, ca);
      plx = lx; ply = y; plz = lz; prx = rx; prz = rz; pu = u;
    }
  }
  // an open chevron at the end of the first n points of P
  function arrow(batch, n, size) {
    if (n < 2) return;
    const tx = P[n * 2 - 2], tz = P[n * 2 - 1];
    let dx = tx - P[n * 2 - 4], dz = tz - P[n * 2 - 3];
    const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    const c = Math.cos(0.5), s = Math.sin(0.5);
    for (const side of [1, -1]) {
      const bx = dx * c - side * dz * s, bz = dz * c + side * dx * s;
      P.length = 4; P[0] = tx - bx * size; P[1] = tz - bz * size; P[2] = tx; P[3] = tz;
      stroke(batch, 2, 0.42, 0);
    }
  }
  // a pencil loop around (x, z): it wobbles with the angle (not the ground), so it holds still on a moving target
  function loop(batch, x, z, r, width) {
    const n = Math.max(20, Math.round(r * 6)), total = Math.PI * 2 + 0.4;
    P.length = 0;
    for (let i = 0; i <= n; i++) {
      const a = -0.7 + (i / n) * total, k = r * (1 + 0.03 * Math.sin(3 * a + 1.1) + (i / n - 0.5) * 0.06);
      P.push(x + Math.sin(a) * k, z - Math.cos(a) * k);
    }
    stroke(batch, n + 1, width, 0);
  }
  // a line from a unit (starting at its ring) to a goal, cut short at the goal's ring, with an arrowhead
  function leg(batch, n, fromR, toR, width) {
    n = trimStart(n, fromR);
    if (lengthOf(n) < toR + 0.6) return;
    n = trimEnd(n, toR);
    stroke(batch, n, width);
    arrow(batch, n, 1.5);
  }

  function draw(selected, units) {
    solid.n = dashed.n = 0;
    for (const id of selected) {
      const v = units.get(id);
      if (!v) continue;
      const p = v.plan, fromR = (UNITS[v.type]?.radius ?? 1.5) + 0.5;
      if (v.rally) {
        color(MOVE_COLOR, 0.75);
        P.length = 4; P[0] = v.x; P[1] = v.z; P[2] = v.rally.x; P[3] = v.rally.z;
        leg(dashed, 2, fromR + 1, 1.5, 0.42);
        color(MOVE_COLOR, 0.9); loop(solid, v.rally.x, v.rally.z, 1.1, 0.4);
      }
      // what it is shooting at right now (ordered or picked by itself), or the enemy it was told to attack
      const t = units.get(v.tgt) ?? (p?.kind === 4 ? { x: p.tx, z: p.tz, type: 'rifle' } : null);
      const tr = t ? (UNITS[t.type]?.radius ?? 1.5) + 1.2 : 0;
      // an attack order's route already ends at its target: no second line when that is the one it shoots at
      const onOrder = t && p?.kind === 4 && Math.hypot(t.x - p.tx, t.z - p.tz) < 3;
      if (p?.kind) {
        const hex = PLAN_COLORS[p.kind] ?? MOVE_COLOR;
        P.length = 2; P[0] = v.x; P[1] = v.z;
        for (let i = 0; i + 1 < p.path.length; i += 2) P.push(p.path[i], p.path[i + 1]);
        let n = P.length / 2;
        color(hex, 0.85);
        if (p.kind > 4) {
          // the route, then a dashed leg to whatever it is set on
          n = trimStart(n, fromR);
          if (n >= 2 && lengthOf(n) > 0.5) stroke(solid, n, 0.55);
          const lx = P[n * 2 - 2], lz = P[n * 2 - 1];
          P.length = 4; P[0] = lx; P[1] = lz; P[2] = p.tx; P[3] = p.tz;
          color(hex, 0.75); leg(dashed, 2, 0, 1.5, 0.42);
        } else leg(solid, n, fromR, p.kind === 4 ? (onOrder ? tr : 2.7) + 0.3 : 1.5, 0.55);
        if (p.kind !== 4) { color(hex, 0.9); loop(solid, p.tx, p.tz, 1.1, 0.4); }
      }
      if (t) {
        if (!onOrder) {
          color(ATTACK_COLOR, 0.85);
          P.length = 4; P[0] = v.x; P[1] = v.z; P[2] = t.x; P[3] = t.z;
          leg(dashed, 2, fromR, tr + 0.3, 0.36);
        }
        color(ATTACK_COLOR, 0.95); loop(solid, t.x, t.z, tr, 0.42);
      }
    }
    solid.end(); dashed.end();
  }
  return { group, draw };
}
