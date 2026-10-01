// Map markings: unit and selection rings, weapon range rings, order lines with arrowheads, capture point rings and
// flags, strike warnings and entrenchment cells. Everything on the ground is flat geometry that client/overlay.js
// drapes over the terrain on the GPU and anti-aliases: thin even lines with a dark edge, small filled arrowheads, soft
// fills. The unit badges and the text tags in the world are drawn like the HUD instead: gunmetal plates, the HUD's
// silhouette icons and its type (Barlow Semi Condensed).
// Geometry and materials are made once and shared; order lines reuse growable buffers, so a snapshot only rewrites
// vertex data and never makes or frees GPU objects.
import * as THREE from 'three';
import { UNITS, CELL } from '/shared/sim.js';
import { drawSymbol } from './symbols.js';
import { Builder, Batch, overlayMat, makeOverlay } from './overlay.js';
export { setTerrain, refreshTerrain } from './overlay.js';

const css = (c) => '#' + c.toString(16).padStart(6, '0');
const hash = (n) => { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
const lum = (c) => (0.299 * ((c >> 16) & 255) + 0.587 * ((c >> 8) & 255) + 0.114 * (c & 255)) / 255;

export const CHALK = 0xf2ecdc, INK = '#2b2418';
const WHITE = 0xf4f2ea;
// order line colors keep their meaning: blue move, orange attack-move, white retreat, red attack, yellow dig/build
export const PLAN_COLORS = { 1: 0x5fa4f2, 2: 0xf0932f, 3: 0xf4f2ea, 4: 0xe5483b, 5: 0xe5483b, 6: 0xe5483b, 7: 0xe6c350, 8: 0xe6c350, 9: 0x5fa4f2 };
export const MOVE_COLOR = PLAN_COLORS[1], ATTACK_COLOR = PLAN_COLORS[4];
const RANGE_DASH = [2.4, 1.3];

// ---------- rings ----------
// A ring in the XZ plane, drawn clockwise from north, as a ribbon. Geometries are shared by radius and look.
const ringGeos = new Map();
function ringGeo(r, o) {
  const key = `${r.toFixed(2)}|${o.w}|${o.fill ? 1 : 0}|${o.y}|${o.dashPeriod ?? 0}|${o.min ?? ''}`;
  let g = ringGeos.get(key);
  if (!g) { const b = new Builder(); b.ring(r, o); g = b.toGeometry(); ringGeos.set(key, g); }
  return g;
}
function ringMesh(r, o, material, order = 2) {
  const m = new THREE.Mesh(ringGeo(r, o), material);
  m.renderOrder = order;
  return m;
}

// the ring under a unit, in its owner's color (white while it retreats)
const ownerLook = (color) => overlayMat({ color, opacity: 0.9 });
export const ownerRing = (radius, color) => ringMesh(radius, { w: 0.2, y: 0.1 }, ownerLook(color), 2);
export function setOwnerRing(mesh, color) { const m = ownerLook(color); if (mesh.material !== m) mesh.material = m; }

// selection: a thin light ring over a faint wash, which reads on any ground and for every player color.
// Weapon range rings (dashed, thin) hang off it, so they show and hide with the selection.
export function selectionRing(radius, ranges = []) {
  const g = new THREE.Group();
  g.add(ringMesh(radius, { w: 0.2, y: 0.14, fill: true }, overlayMat({ color: WHITE, opacity: 0.95, fill: 0.08 }), 3));
  g.visible = false;
  let range = null;
  if (ranges.length) {
    range = new THREE.Group(); range.visible = false;
    for (const r of ranges) range.add(ringMesh(r, { w: 0.22, y: 0.18, min: 1.2, dashPeriod: RANGE_DASH[0] }, overlayMat({ color: WHITE, opacity: 0.7, depthTest: false, dash: RANGE_DASH }), 4));
    g.add(range);
  }
  return { sel: g, range };
}

// the reinforce circle around an HQ; clip (world planes) cuts it at the board edge, with its own material
export function hqRing(R, color, clip = null) {
  return ringMesh(R - 0.35, { w: 0.36, y: 0.1 }, clip ? makeOverlay({ color, opacity: 0.85, clip }) : overlayMat({ color, opacity: 0.85 }), 1);
}

// a resource node: four corner brackets
const brackets = new Map();
function bracketGeo(half, len) {
  const key = `${half}|${len}`;
  let g = brackets.get(key);
  if (!g) {
    const b = new Builder();
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) b.line([sx * half, sz * (half - len), sx * half, sz * half, sx * (half - len), sz * half], 3, { w: 0.24, y: 0.12, step: 0.7 });
    brackets.set(key, g = b.toGeometry());
  }
  return g;
}
export function nodeSquare(color) {
  const m = new THREE.Mesh(bracketGeo(1.85, 1.1), overlayMat({ color, opacity: 0.9 }));
  m.renderOrder = 2;
  return m;
}

// click feedback: its own material, since each one fades on its own. The ring keeps its width while it grows.
export function clickRing(color) {
  const m = new THREE.Mesh(ringGeo(1, { w: 0.18, y: 0.2, min: 1.2 }), makeOverlay({ color, depthTest: false }));
  m.renderOrder = 3;
  return m;
}

// ---------- zones ----------
// What a strike or an aimed ability covers: a circle with a center mark, or a rectangle with chevrons along its run
// and a filled arrow past the far end (+x). shape: { r } or { len, width, arrow }.
function zoneGeometry(shape, y = 0.16) {
  const b = new Builder();
  if (shape.r) {
    b.ring(shape.r - 0.2, { w: 0.5, y, fill: true });
    b.line([-0.9, 0, 0.9, 0], 2, { w: 0.2, y, min: 0.9 });
    b.line([0, -0.9, 0, 0.9], 2, { w: 0.2, y, min: 0.9 });
  } else {
    const hx = shape.len / 2, hz = shape.width / 2;
    b.fillRect(-hx, -hz, hx, hz, Math.max(1, Math.ceil(shape.len / 3)), Math.max(1, Math.ceil(shape.width / 3)), y);
    b.line([-hx, -hz, hx, -hz, hx, hz, -hx, hz], 4, { w: 0.5, y, closed: true, step: 1.3 });
    if (shape.arrow !== false) {
      for (let x = -hx + 4; x < hx - 2; x += 8) b.line([x - 1.1, -1.5, x + 0.5, 0, x - 1.1, 1.5], 3, { w: 0.28, y, min: 0.9 });
      b.arrow(hx + 3.2, 0, 1, 0, 2.2, 1.2, { y, rim: 0.04 });
    }
  }
  return b.toGeometry();
}
// the outline that follows the mouse while aiming; its color changes through userData.mat (green/red for placement)
export function aimMarker(shape, color) {
  const g = new THREE.Group(), mat = makeOverlay({ color, opacity: 0.9, depthTest: false, fill: 0.18 });
  const m = new THREE.Mesh(zoneGeometry(shape, 0.2), mat); m.renderOrder = 4;
  g.add(m); g.userData.mat = mat;
  return g;
}

// ---------- entrenchment cells ----------
// One outlined square per cell the pattern would dig (trench green, wire brass). The preview is bold, the ghost of
// ordered work faint. set() rewrites a small buffer only when the cells change.
const CELL_TRENCH = 0x86d17a, CELL_WIRE = 0xd9b25c;
export function cellLayer({ depthTest = false } = {}) {
  const group = new THREE.Group(), batch = new Batch(makeOverlay({ vertexColors: true, depthTest, fill: 1 }), { order: 2 });
  group.add(batch.mesh);
  let last = [], lastGhost = null;
  const half = CELL * 0.44;
  return {
    group,
    // cells: [{ x, z, wire }]
    set(cells, ghost = false) {
      let same = ghost === lastGhost && cells.length === last.length / 3;
      for (let i = 0; same && i < cells.length; i++) same = cells[i].x === last[i * 3] && cells[i].z === last[i * 3 + 1] && cells[i].wire === !!last[i * 3 + 2];
      if (same) return;
      last = cells.flatMap(c => [c.x, c.z, c.wire ? 1 : 0]); lastGhost = ghost;
      const b = batch.begin();
      for (const c of cells) {
        const hex = c.wire ? CELL_WIRE : CELL_TRENCH;
        b.color(hex, ghost ? 0.12 : 0.24).fillRect(c.x - half, c.z - half, c.x + half, c.z + half, 2, 2, 0.14);
        b.color(hex, ghost ? 0.6 : 0.95).line([c.x - half, c.z - half, c.x + half, c.z - half, c.x + half, c.z + half, c.x - half, c.z + half], 4, { w: 0.22, min: 0.9, y: 0.14, closed: true, step: 1.5 });
      }
      batch.end();
    },
  };
}

// ---------- fighter cover ----------
// the airspace each fighter cover holds: a ring and a faint wash, fainter as it runs out. Pooled, one mesh per ring.
export function coverRings() {
  const group = new THREE.Group(), pool = [];
  return {
    group,
    // list: [x, z, radius, seconds left]
    set(list, hAt) {
      list.forEach(([x, z, r, t], i) => {
        let m = pool[i];
        if (!m) { m = new THREE.Mesh(ringGeo(r, { w: 0.5, y: 0.2, fill: true }), makeOverlay({ color: 0x9dd0ff, depthTest: false, fill: 0.07 })); m.renderOrder = 2; pool.push(m); group.add(m); }
        const geo = ringGeo(r, { w: 0.5, y: 0.2, fill: true });
        if (m.geometry !== geo) m.geometry = geo;
        m.visible = true; m.position.set(x, hAt(x, z), z); m.material.opacity = Math.min(0.85, 0.4 + t / 150);
      });
      for (let i = list.length; i < pool.length; i++) pool[i].visible = false;
    },
  };
}

// ---------- unit badges ----------
// The unit's silhouette (client/symbols.js) in the owner's color on a small gunmetal plate edged in that color, left
// of the health bar. Dark player colors are lifted toward white a little so the silhouette reads on the plate.
const badgeMats = new Map(), badgeGeo = new THREE.PlaneGeometry(1, 1);
const PLATE = 'rgba(22, 25, 27, 0.88)', HAIRLINE = 'rgba(176, 164, 122, 0.55)', LABEL_TEXT = '#e2dfd3';
const lift = (c, k) => { const m = (v) => Math.round(v + (255 - v) * k); return `rgb(${m((c >> 16) & 255)}, ${m((c >> 8) & 255)}, ${m(c & 255)})`; };
const rounded = (c, x, y, w, h, r) => { c.beginPath(); if (c.roundRect) c.roundRect(x, y, w, h, r); else c.rect(x, y, w, h); };
export function symbolBadge(type, color) {
  const key = type + '|' + color;
  let m = badgeMats.get(key);
  if (!m) {
    const cv = document.createElement('canvas'); cv.width = cv.height = 128;
    const c = cv.getContext('2d');
    // the badge shows at about 26 px, so 5 canvas px of edge reads as a 1 px hairline
    rounded(c, 5, 5, 118, 118, 7); c.fillStyle = PLATE; c.fill();
    c.lineWidth = 5; c.strokeStyle = css(color); c.stroke();
    drawSymbol(c, type, 64, 64, 104, { color: lift(color, lum(color) < 0.45 ? 0.25 : 0) });
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    m = new THREE.MeshBasicMaterial({ map: t, transparent: true, depthTest: false, depthWrite: false });
    badgeMats.set(key, m);
  }
  const b = new THREE.Mesh(badgeGeo, m);
  b.scale.set(1.45, 1.45, 1); b.position.set(-1.98, 0.08, 0.02); b.renderOrder = 5;
  return b;
}

// ---------- text tags ----------
// HQ names and point and node tags on gunmetal plates in the HUD's type; the HQ sign leads with an owner-color swatch
// holding the HQ silhouette. Canvas text drawn before a web font arrives uses the fallback, so every tag is redrawn
// when fonts finish loading.
// Tags keep a fixed size on screen: sx is the sprite width in CSS pixels (the 32 px tall tag prints its text at
// 16 px), so they stay readable zoomed out and never grow over a close fight. fade is the camera depth band (m)
// over which a tag fades out as you zoom in on it.
const LABEL = {
  hq: { w: 512, h: 112, sx: 156, px: 54, font: (px) => `600 ${px}px "Barlow Semi Condensed", "Arial Narrow", sans-serif`, upper: false, spacing: 1, fade: [10, 17] },
  tag: { w: 256, h: 64, sx: 128, px: 30, font: (px) => `600 ${px}px "Barlow Semi Condensed", "Arial Narrow", sans-serif`, upper: false, spacing: 0, fade: [19, 27] },
};
// The sprite shader with sizeAttenuation off keeps scale in clip units; this patch turns it into CSS pixels
// (2 / (P[1][1] * view height)) and fades the tag by its view depth.
const VIEW_H = { value: innerHeight };
addEventListener('resize', () => { VIEW_H.value = innerHeight; });
function screenSized(shader) {
  shader.uniforms.viewH = VIEW_H;
  shader.uniforms.fadeNear = this.userData.fadeNear;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nuniform float viewH;\nuniform vec2 fadeNear;\nvarying float vNear;')
    .replace('vec2 scale = vec2( length( modelMatrix[ 0 ].xyz ), length( modelMatrix[ 1 ].xyz ) );',
      'vec2 scale = vec2( length( modelMatrix[ 0 ].xyz ), length( modelMatrix[ 1 ].xyz ) ) * 2.0 / ( projectionMatrix[ 1 ][ 1 ] * viewH );\n\tvNear = smoothstep( fadeNear.x, fadeNear.y, - mvPosition.z );');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying float vNear;')
    .replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( diffuse, opacity * vNear );');
}
const labels = new Map();
function paintLabel(e) {
  // the sprite shows the canvas at about a third of its size, so 3 canvas px of edge reads as a 1 px hairline
  const st = LABEL[e.style], c = e.cv.getContext('2d'), W = st.w, H = st.h, bh = H - 12, y0 = 6, pad = 16;
  const sw = e.color != null ? bh - 22 : 0, lead = sw ? sw + 14 : 0;
  c.clearRect(0, 0, W, H);
  if ('letterSpacing' in c) c.letterSpacing = st.spacing + 'px';
  let px = st.px; c.font = st.font(px);
  while (c.measureText(e.text).width > W - 2 * pad - lead - 8 && px > 12) c.font = st.font(px -= 2);
  const bw = Math.min(W - 4, c.measureText(e.text).width + 2 * pad + lead), x0 = (W - bw) / 2;
  rounded(c, x0 + 1.5, y0 + 1.5, bw - 3, bh - 3, 5); c.fillStyle = PLATE; c.fill();
  c.lineWidth = 3; c.strokeStyle = HAIRLINE; c.stroke();
  if (sw) {
    const sx = x0 + 11, sy = (H - sw) / 2;
    rounded(c, sx, sy, sw, sw, 4); c.fillStyle = css(e.color); c.fill();
    drawSymbol(c, 'hq', sx + sw / 2, H / 2, sw * 0.86, { color: lum(e.color) > 0.6 ? '#1a1d1f' : '#f2efe6' });
  }
  c.fillStyle = LABEL_TEXT; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText(e.text, x0 + lead + (bw - lead) / 2, H / 2 + 2);
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
    e.mat = new THREE.SpriteMaterial({ map: e.tex, depthTest: false, transparent: true, sizeAttenuation: false });
    e.mat.userData.fadeNear = { value: new THREE.Vector2(...st.fade) };
    e.mat.onBeforeCompile = screenSized;
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
// A thin ring over a faint wash: chalk while neutral, the owner's color once held. A progress arc runs along the
// inside of the ring while a side is taking the point; a brass inner ring marks a contested one, and a brass ring fades
// out when the point changes hands. set() only swaps shared materials and moves the arc's draw range.
const NEUTRAL_RING = 0xe6e0d0, NEUTRAL_FLAG = 0x8f8a7c, PROG_SEGS = 64, flagGeo = new THREE.PlaneGeometry(1, 1);
const heldLook = (color) => color != null ? overlayMat({ color, opacity: 0.95, fill: 0.07 }) : overlayMat({ color: NEUTRAL_RING, opacity: 0.8, fill: 0.05 });
export function capturePoint(radius, text) {
  const group = new THREE.Group(), R = radius - 0.3;
  const ring = ringMesh(R, { w: 0.42, y: 0.12, fill: true }, heldLook(null), 2);
  // progress: a dim track the width of the arc, and the arc itself on top of it
  const track = ringMesh(R - 0.9, { w: 0.5, y: 0.13 }, overlayMat({ color: WHITE, opacity: 0.22 }), 2);
  const arc = new Builder(); arc.ring(R - 0.9, { w: 0.7, y: 0.14, segs: PROG_SEGS });
  const prog = new THREE.Mesh(arc.toGeometry(), overlayMat({ color: WHITE, opacity: 0.9 }));
  prog.renderOrder = 3; prog.geometry.setDrawRange(0, 0); track.visible = prog.visible = false;
  const flag = new THREE.Mesh(flagGeo, flagMat(NEUTRAL_FLAG));
  flag.scale.set(2.2, 1.4, 1); flag.position.set(1.1, 7.2, 0); flag.castShadow = true;
  const tag = label(text);
  const flip = ringMesh(R + 0.25, { w: 0.5, y: 0.15 }, makeOverlay({ color: 0xd2a849 }), 4);
  const danger = ringMesh(R - 0.3, { w: 0.5, y: 0.15 }, makeOverlay({ color: 0xd2a849 }), 4);
  flip.visible = danger.visible = false;
  group.add(ring, track, prog, flag, flip, danger, tag);
  let contested = false;
  const swap = (o, m) => { if (o.material !== m) o.material = m; };
  // the tag steps aside while the point is being taken or drained, so it does not sit over the fight for it
  let last = -1, busyUntil = 0;
  return {
    group,
    // owner and capper are player colors, or null
    set(owner, capper, progress, contest = false) {
      const now = performance.now();
      if (last >= 0 && progress !== last) busyUntil = now + 2500;
      last = progress; tag.visible = now >= busyUntil;
      contested = !!contest;
      group.userData.contested = contested;
      swap(ring, heldLook(owner));
      swap(flag, flagMat(owner ?? NEUTRAL_FLAG));
      const color = owner ?? capper, k = Math.round(progress * PROG_SEGS);
      // a point held in full needs no arc: the ring says it
      track.visible = prog.visible = color != null && k > 0 && !(owner != null && progress >= 0.999);
      if (color != null) swap(prog, overlayMat({ color, opacity: 0.9 }));
      prog.geometry.setDrawRange(0, k * 6);
    },
    // the inner ring fades in and out slowly while contested; a flip sends one brass ring outward, fading
    frame(time, change = 0) {
      danger.visible = contested;
      if (contested) danger.material.opacity = 0.55 + 0.3 * (0.5 + 0.5 * Math.sin(time * Math.PI * 1.6));
      flip.visible = change > 0;
      if (change > 0) { flip.material.opacity = 0.9 * (1 - change); flip.scale.setScalar(1 + 0.06 * change); }
      group.userData.flipping = change > 0;
    },
  };
}

// ---------- strike warnings ----------
// Where incoming support will land: a thin outline, a faint wash and a small mark, draped over the ground and depth
// tested, so units, flags and buildings standing in the zone keep their colors. A strip runs along +x, with chevrons
// and an arrowhead showing the way. shape: { r } for a circle, { len, width, arrow } for a strip.
export function strikeZone(shape, color, { x, z, rot = 0, hAt }) {
  const group = new THREE.Group(), geo = zoneGeometry(shape), mat = makeOverlay({ color, opacity: 0.8, fill: 0.16 });
  const m = new THREE.Mesh(geo, mat); m.renderOrder = 3;
  group.add(m);
  group.position.set(x, hAt(x, z), z); group.rotation.y = rot;
  return {
    group,
    // pending strikes fade gently in and out
    frame(pending, time) { mat.opacity = pending ? 0.82 + 0.1 * Math.sin(time / 300) : 0.6; },
    dispose() { geo.dispose(); mat.dispose(); },
  };
}

// ---------- order lines ----------
// Ribbons appended into two preallocated batches each snapshot. Vertex colors (with alpha) carry each line's color,
// so one solid and one dashed mesh draw every order on screen. A buffer that runs out doubles once and keeps the room.
// Arrowheads and destination rings always go in the solid batch.
const ORDER_DASH = [2.2, 1.3], ARROW_LEN = 1.7, ARROW_HALF = 0.72;

// Scratch space reused every draw: P holds the polyline being built (x, z pairs).
const P = [];

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

export function planLayer() {
  const group = new THREE.Group();
  const solid = new Batch(makeOverlay({ vertexColors: true, depthTest: false }));
  const dashed = new Batch(makeOverlay({ vertexColors: true, depthTest: false, dash: ORDER_DASH }));
  group.add(solid.mesh, dashed.mesh);
  const S = solid.b, D = dashed.b;
  const color = (hex, a) => { S.color(hex, a); D.color(hex, a); };

  // the first n points of P as one even line, with a vertex every 1.6 m so it follows the ground; distance runs from
  // the far end so dashes stay put near the goal
  const stroke = (b, n, width) => b.line(P, n, { w: width, y: 0.12, step: 1.6, uEnd: true });
  // a ring around (x, z)
  const loop = (x, z, r, width) => S.ring(r, { w: width, min: 0.9, y: 0.12, segs: 28, ox: x, oz: z });
  // a line from a unit (starting at its ring) to a goal, cut short at the goal's ring, ending in an arrowhead
  function leg(b, n, fromR, toR, width) {
    n = trimStart(n, fromR);
    if (lengthOf(n) < toR + ARROW_LEN * 0.8) return;
    n = trimEnd(n, toR);
    const tx = P[n * 2 - 2], tz = P[n * 2 - 1], dx = tx - P[n * 2 - 4], dz = tz - P[n * 2 - 3];
    n = trimEnd(n, ARROW_LEN * 0.85);
    if (n >= 2 && lengthOf(n) > 0.2) stroke(b, n, width);
    S.arrow(tx, tz, dx, dz, ARROW_LEN, ARROW_HALF, { y: 0.12, rim: 0.05 });
  }

  // a rally point: a ring, a pole and a pennant drawn on the ground
  function flag(x, z) {
    color(MOVE_COLOR, 0.95);
    loop(x, z, 1.1, 0.2);
    P.length = 4; P[0] = x; P[1] = z; P[2] = x; P[3] = z - 3.2;
    stroke(S, 2, 0.2);
    S.arrow(x + 1.9, z - 2.5, 1, 0, 1.9, 0.6, { y: 0.12, rim: 0.04 });
  }

  function draw(selected, units, rally = null) {
    solid.begin(); dashed.begin();
    if (rally) flag(rally.x, rally.z);
    for (const id of selected) {
      const v = units.get(id);
      if (!v) continue;
      const p = v.plan, fromR = (UNITS[v.type]?.radius ?? 1.5) + 0.5;
      if (v.rally) {
        color(MOVE_COLOR, 0.75);
        P.length = 4; P[0] = v.x; P[1] = v.z; P[2] = v.rally.x; P[3] = v.rally.z;
        leg(D, 2, fromR + 1, 1.5, 0.26);
        flag(v.rally.x, v.rally.z);
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
        color(hex, 0.9);
        if (p.kind > 4) {
          // the route, then a dashed leg to whatever it is set on
          n = trimStart(n, fromR);
          if (n >= 2 && lengthOf(n) > 0.5) stroke(S, n, 0.34);
          const lx = P[n * 2 - 2], lz = P[n * 2 - 1];
          P.length = 4; P[0] = lx; P[1] = lz; P[2] = p.tx; P[3] = p.tz;
          color(hex, 0.8); leg(D, 2, 0, 1.5, 0.28);
        } else leg(S, n, fromR, p.kind === 4 ? (onOrder ? tr : 2.7) + 0.3 : 1.2, 0.34);
        if (p.kind !== 4) { color(hex, 0.95); loop(p.tx, p.tz, 1.0, 0.22); }
      }
      let qx = p?.kind ? p.tx : v.x, qz = p?.kind ? p.tz : v.z;
      let qr = p?.kind ? 1.0 : fromR;
      for (const order of v.orders ?? []) {
        const hex = PLAN_COLORS[order.kind] ?? MOVE_COLOR;
        color(hex, 0.8);
        P.length = 4; P[0] = qx; P[1] = qz; P[2] = order.x; P[3] = order.z;
        leg(D, 2, qr, 1.2, 0.28);
        color(hex, 0.95); loop(order.x, order.z, 1.0, 0.22);
        qx = order.x; qz = order.z; qr = 1.0;
      }
      if (t) {
        if (!onOrder) {
          color(ATTACK_COLOR, 0.85);
          P.length = 4; P[0] = v.x; P[1] = v.z; P[2] = t.x; P[3] = t.z;
          leg(D, 2, fromR, tr + 0.3, 0.26);
        }
        color(ATTACK_COLOR, 0.95); loop(t.x, t.z, tr, 0.24);
      }
    }
    solid.end(); dashed.end();
  }
  return { group, draw };
}
