import * as THREE from 'three';
import { CELL } from '/shared/sim.js';

const raycaster = new THREE.Raycaster(), cursor = new THREE.Vector2();
const flat = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), d = new THREE.Vector3(), hit = new THREE.Vector3();
const EPS = 1e-7;

// Visit crossed cells in order so even a narrow peak gets its two mesh triangles tested.
export function groundAt(camera, hAt, mx, my, w, h, mapW, mapH, terrainMesh = null) {
  cursor.set(mx / w * 2 - 1, 1 - my / h * 2);
  raycaster.setFromCamera(cursor, camera);
  // Relief picks its sampled triangles and cliff boundaries, the same surface used for grounding.
  if (terrainMesh) return raycaster.intersectObject(terrainMesh, false)[0]?.point ?? raycaster.ray.intersectPlane(flat, new THREE.Vector3());
  const ray = raycaster.ray, o = ray.origin, direction = ray.direction;
  if (direction.y < -1e-6 && Number.isFinite(mapW) && Number.isFinite(mapH)) {
    let lo = Math.max(0, (10.01 - o.y) / direction.y), hi = Math.min(2000, (-5.01 - o.y) / direction.y);
    for (let axis = 0; axis < 2; axis++) {
      const origin = axis ? o.z : o.x, axisDir = axis ? direction.z : direction.x, size = axis ? mapH : mapW;
      if (Math.abs(axisDir) < 1e-9) { if (origin < 0 || origin > size) hi = -1; }
      else {
        const a = -origin / axisDir, b = (size - origin) / axisDir;
        lo = Math.max(lo, Math.min(a, b)); hi = Math.min(hi, Math.max(a, b));
      }
    }
    if (lo <= hi) {
      const columns = Math.ceil(mapW / CELL), rows = Math.ceil(mapH / CELL);
      let ix = Math.min(columns - 1, Math.max(0, Math.floor((o.x + direction.x * (lo + EPS)) / CELL)));
      let iz = Math.min(rows - 1, Math.max(0, Math.floor((o.z + direction.z * (lo + EPS)) / CELL)));
      const sx = Math.sign(direction.x), sz = Math.sign(direction.z);
      const dx = sx ? CELL / Math.abs(direction.x) : Infinity, dz = sz ? CELL / Math.abs(direction.z) : Infinity;
      let nextX = sx ? ((sx > 0 ? ix + 1 : ix) * CELL - o.x) / direction.x : Infinity;
      let nextZ = sz ? ((sz > 0 ? iz + 1 : iz) * CELL - o.z) / direction.z : Infinity;
      for (let t = lo; t <= hi && ix >= 0 && ix < columns && iz >= 0 && iz < rows;) {
        const end = Math.min(hi, nextX, nextZ), x = ix * CELL, z = iz * CELL;
        a.set(x, hAt(x, z), z); b.set(x, hAt(x, z + CELL), z + CELL);
        c.set(x + CELL, hAt(x + CELL, z + CELL), z + CELL); d.set(x + CELL, hAt(x + CELL, z), z);
        const max = Math.max(a.y, b.y, c.y, d.y);
        if (o.y + ray.direction.y * end <= max + EPS) {
          // PlaneGeometry uses (a, b, d) and (b, c, d) after its world rotation.
          const first = ray.intersectTriangle(a, b, d, true, hit);
          if (first && o.distanceTo(first) >= t - EPS && o.distanceTo(first) <= end + EPS) return first.clone();
          const second = ray.intersectTriangle(b, c, d, true, hit);
          if (second && o.distanceTo(second) >= t - EPS && o.distanceTo(second) <= end + EPS) return second.clone();
        }
        if (end >= hi) break;
        if (nextX <= nextZ) { ix += sx; nextX += dx; }
        if (nextZ <= end + EPS) { iz += sz; nextZ += dz; }
        t = end;
      }
    }
  }
  return ray.intersectPlane(flat, new THREE.Vector3());
}

const PAN = [0.6, 1, 1.6], SPEEDS = ['Slow', 'Normal', 'Fast'];
const PAN_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight'];
let hooks, followed = null, middle = null, anchor = null, intro = null;
let edge = true, speed = 1, cornerKey = null, cornerPoints = [];

function pose() {
  const { cam, camera, pitch } = hooks, hd = cam.dist * Math.cos(pitch);
  camera.position.set(cam.x + Math.sin(cam.yaw) * hd, (cam.y ?? 0) + cam.dist * Math.sin(pitch), cam.z + Math.cos(cam.yaw) * hd);
  camera.lookAt(cam.x, cam.y ?? 0, cam.z);
  camera.updateMatrixWorld();
}
// The clear band between the HUD's top panels and the recruit bar, in CSS pixels. Measured on demand (match start,
// H, zoom) and after a resize, not every frame; the whole view when the HUD is hidden or leaves too little room.
let bandCache = null;
function band(fresh = false) {
  if (fresh || !bandCache) {
    const b = hooks.band?.(), top = Math.max(0, b?.top ?? 0), bottom = Math.min(innerHeight, b?.bottom ?? innerHeight);
    bandCache = bottom - top >= innerHeight * 0.3 ? { top, bottom } : { top: 0, bottom: innerHeight };
  }
  return bandCache;
}
// The widest zoom: the distance and target at which the whole map, at the current heading, fits the clear band
// with a small margin of the land around it (client/apron.js) on every side and sits in its middle. Cached until the
// heading, window, band or map changes.
const FIT_MARGIN = 0.04, MIN_WIDE = 60;
let fitKey = '', fit = { dist: 150, x: 80, z: 80 };
function wide() {
  const { cam, camera } = hooks, { w, h } = hooks.bounds();
  if (!w || !h) return { dist: 150, x: (w || 160) / 2, z: (h || 160) / 2 };
  const { top, bottom } = band(), key = `${w},${h},${cam.yaw},${innerWidth},${innerHeight},${top},${bottom}`;
  if (key === fitKey) return fit;
  const saved = { x: cam.x, y: cam.y, z: cam.z, dist: cam.dist };
  const corners = [[0, 0], [w, 0], [w, h], [0, h]].map(([x, z]) => new THREE.Vector3(x, hooks.hAt(Math.min(x, w - 0.01), Math.min(z, h - 0.01)), z));
  const roomX = innerWidth * (1 - 2 * FIT_MARGIN), roomY = bottom - top - 2 * innerHeight * FIT_MARGIN;
  const middle = new THREE.Vector3(w / 2, hooks.hAt(w / 2, h / 2), h / 2);
  // the map's box on screen, looking at its middle from dist
  const box = (dist) => {
    cam.x = w / 2; cam.z = h / 2; cam.y = middle.y; cam.dist = dist; pose();
    const r = { ok: true, x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
    for (const p of corners) {
      const s = a.copy(p).project(camera), x = (s.x + 1) / 2 * innerWidth, y = (1 - s.y) / 2 * innerHeight;
      if (!(s.z > -1 && s.z < 1)) r.ok = false;
      r.x0 = Math.min(r.x0, x); r.x1 = Math.max(r.x1, x); r.y0 = Math.min(r.y0, y); r.y1 = Math.max(r.y1, y);
    }
    return r;
  };
  let lo = 20, hi = Math.max(800, Math.hypot(w, h) * 3);
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2, r = box(mid);
    if (r.ok && r.x1 - r.x0 <= roomX && r.y1 - r.y0 <= roomY) hi = mid; else lo = mid;
  }
  const dist = Math.max(MIN_WIDE, hi), r = box(dist);
  // slide the target so the box's middle lands on the band's middle (perspective puts the near edge lower)
  shift(middle, innerWidth - (r.x0 + r.x1) / 2, innerHeight / 2 + (top + bottom) / 2 - (r.y0 + r.y1) / 2);
  fit = { dist, x: Math.min(w, Math.max(0, cam.x)), z: Math.min(h, Math.max(0, cam.z)) };
  fitKey = key;
  Object.assign(cam, saved); pose();
  return fit;
}
// The target stays on the map. Zoomed out past half the widest view it is drawn toward the widest view's target,
// so the widest view is the whole map, centered, and not a corner of it with the land past the edge filling the rest.
function clamp() {
  const { cam } = hooks, { w, h } = hooks.bounds(), W = w || 160, H = h || 160, f = wide();
  const free = Math.min(1, Math.max(0, 2 * (1 - cam.dist / f.dist)));
  cam.x = Math.min(f.x + (W - f.x) * free, Math.max(f.x * (1 - free), cam.x));
  cam.z = Math.min(f.z + (H - f.z) * free, Math.max(f.z * (1 - free), cam.z));
}
// Move the target so the screen point (mx, my) looks at the ground point p. False when the ray runs level.
function shift(p, mx, my) {
  const { cam, camera } = hooks;
  pose();
  cursor.set(mx / innerWidth * 2 - 1, 1 - my / innerHeight * 2);
  raycaster.setFromCamera(cursor, camera);
  const { origin, direction } = raycaster.ray;
  if (Math.abs(direction.y) < 1e-6) return false;
  // Translate the ray through the anchor at its ground height, including the camera's height glide.
  const t = (p.y - origin.y) / direction.y;
  cam.x += p.x - (origin.x + direction.x * t);
  cam.z += p.z - (origin.z + direction.z * t);
  return true;
}
function solve(p, mx, my) {
  if (shift(p, mx, my)) { clamp(); pose(); }
}
function solveAnchor() {
  if (anchor) solve(anchor.point, anchor.mx, anchor.my);
}
// Put the ground point (x, z) in the middle of the clear band, so the recruit bar and top panels do not cover it.
function frame(x, z) {
  const { cam } = hooks, { top, bottom } = band(true), p = new THREE.Vector3(x, hooks.hAt(x, z), z);
  anchor = null; cam.x = x; cam.z = z;
  cam.dist = Math.min(cam.dist, wide().dist);
  // two passes: the camera's height follows the ground under the target, which moves in the first
  for (let i = 0; i < 2; i++) { cam.y = hooks.hAt(cam.x, cam.z); solve(p, innerWidth / 2, (top + bottom) / 2); }
}

function showFollow() {
  const v = followed == null ? null : hooks.units.get(followed), chip = hooks.chip;
  if (!chip) return;
  const changed = chip.classList.contains('hidden') === !!v;
  chip.classList.toggle('hidden', !v);
  const text = v ? `Following ${hooks.unitName(v)}` : '';
  if (chip.textContent !== text) chip.textContent = text;
  const top = hooks.top;
  if (v && top && changed) chip.style.top = Math.ceil(top.getBoundingClientRect().bottom + 8) + 'px';
}
function cancelFollow() { followed = null; anchor = null; showFollow(); }
function follow(id) {
  if (followed != null) { cancelFollow(); return; }
  if (id == null || !hooks.units.has(id)) return;
  followed = id; anchor = null; edgeHold = true; showFollow();
}
function preferences() {
  hooks.edgeButton.textContent = `Edge scroll: ${edge ? 'On' : 'Off'}`;
  hooks.edgeButton.setAttribute('aria-pressed', String(edge));
  hooks.panButton.textContent = `Pan speed: ${SPEEDS[speed]}`;
}
function init(h) {
  hooks = h;
  edge = hooks.tryStore(() => localStorage.getItem('ww2-edge')) !== '0';
  const saved = hooks.tryStore(() => localStorage.getItem('ww2-pan'));
  speed = /^[012]$/.test(saved ?? '') ? +saved : 1;
  hooks.edgeButton.onclick = () => { edge = !edge; hooks.tryStore(() => localStorage.setItem('ww2-edge', edge ? '1' : '0')); preferences(); };
  hooks.panButton.onclick = () => { speed = (speed + 1) % 3; hooks.tryStore(() => localStorage.setItem('ww2-pan', String(speed))); preferences(); };
  preferences();
  addEventListener('resize', () => {
    bandCache = null;
    if (followed != null && hooks.top && hooks.chip) hooks.chip.style.top = Math.ceil(hooks.top.getBoundingClientRect().bottom + 8) + 'px';
  });
}
function skipIntro() {
  if (!intro) return false;
  Object.assign(hooks.cam, intro.to); intro = null; pose(); return true;
}
function startIntro(skip) {
  cancelFollow(); middle = null; intro = null; cornerKey = null;
  const { cam } = hooks;
  cam.y = hooks.hAt(cam.x, cam.z);
  if (!skip) {
    // the sweep starts on the whole map (the widest view) and settles on the start view
    const f = wide(), to = { ...cam };
    intro = { to, from: { x: f.x, z: f.z, y: hooks.hAt(f.x, f.z), dist: Math.max(f.dist, to.dist) }, age: 0 };
    Object.assign(cam, intro.from);
  }
  pose();
}
function wheel(e) {
  e.preventDefault();
  if (skipIntro()) return;
  const { cam } = hooks;
  pose();
  const point = hooks.groundAt(e.clientX, e.clientY);
  band(true); // the panels may have changed height since the last zoom
  cam.dist = Math.min(wide().dist, Math.max(25, cam.dist * (1 + Math.sign(e.deltaY) * 0.1)));
  // Following holds the unit at the center while zoom changes its viewing distance.
  anchor = point && followed == null ? { point, mx: e.clientX, my: e.clientY, left: 0.4 } : null;
  pose(); solveAnchor();
}
function beginMiddle(e) { middle = { x: e.clientX }; anchor = null; e.preventDefault(); }
function moveMiddle(e) {
  if (!middle) return;
  if (!(e.buttons & 4)) { middle = null; return; }
  hooks.cam.yaw -= (e.clientX - middle.x) * 0.006; middle.x = e.clientX; anchor = null;
}
function stopDrag() { middle = null; anchor = null; }
// A mouse press during the opening glide ends it and still counts, so the first click or box drag of a match selects.
// Only a right-click is dropped: its order was aimed at a view that has just jumped to the start view.
function introPress(e) {
  if (skipIntro() && e.button === 2) { e.preventDefault(); e.stopPropagation(); }
}

// Edge scrolling, as in Warcraft III. The cursor (hooks.pointer, client/pointer.js) inside the zone along a window
// edge pushes the view that way: 30% speed at the zone's inner border up to full speed at the edge, eased in over
// EDGE_EASE seconds, both ways at once in a corner. A cursor that leaves the window across an edge stays pinned there,
// so the push goes on until it comes back in, the window loses focus or the tab is hidden. Over a HUD panel only the
// outer strip counts, so a recruit button near the bottom does not scroll the view while the player aims at it.
// No push while a mouse button drags (box select, rotate), while a menu or the lobby covers the board, or while a
// follow is starting with the cursor already at the edge; a fresh push after that ends the follow.
const EDGE_EASE = 0.15;
let edgeAge = 0, edgeHold = false;
function edgeZone() {
  // CSS pixels already grow with devicePixelRatio (32 CSS px are 64 device px on a 2x screen), so a share of the
  // window keeps the zone the same size by eye on a laptop and on a large monitor: 32 px at 1920x1080
  return Math.min(48, Math.max(24, Math.min(innerWidth, innerHeight) * 0.03));
}
function edgePush(dt) {
  const p = hooks.pointer;
  if (!edge || !p?.active || !hooks.world() || hooks.blocked?.() || (p.buttons & 5) || hooks.dragging() || middle) {
    edgeAge = 0; edgeHold = false; return null;
  }
  const W = innerWidth, H = innerHeight, zone = edgeZone(), reach = p.out || p.overView ? zone : Math.max(6, zone / 4);
  const depth = (d) => d < reach ? 0.3 + 0.7 * (1 - d / zone) : 0;
  const rt = depth(W - 1 - p.x) - depth(p.x), fw = depth(p.y) - depth(H - 1 - p.y);
  if (!rt && !fw) { edgeAge = 0; edgeHold = false; return null; }
  if (edgeHold && followed != null) return null;
  edgeHold = false;
  edgeAge += dt;
  const t = Math.min(1, edgeAge / EDGE_EASE), ease = t * t * (3 - 2 * t);
  const dir = (fw > 0 ? 'n' : fw < 0 ? 's' : '') + (rt > 0 ? 'e' : rt < 0 ? 'w' : '');
  return { fw: fw * ease, rt: rt * ease, dir };
}
function update(dt) {
  if (!hooks) return;
  const { cam, keys } = hooks;
  if (intro) {
    hooks.pointer?.frame(null);
    intro.age = Math.min(2.5, intro.age + dt);
    const t = intro.age / 2.5, eased = t * t * (3 - 2 * t);
    for (const k of ['x', 'y', 'z', 'dist']) cam[k] = intro.from[k] + (intro.to[k] - intro.from[k]) * eased;
    if (t === 1) skipIntro(); else pose();
    return;
  }
  let fw = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  let rt = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  const push = edgePush(dt);
  hooks.pointer?.frame(push?.dir ?? null);
  if (push) { fw = Math.max(-1, Math.min(1, fw + push.fw)); rt = Math.max(-1, Math.min(1, rt + push.rt)); }
  if (PAN_KEYS.some(k => keys.has(k)) || fw || rt) cancelFollow();
  if (followed != null) {
    const v = hooks.units.get(followed);
    if (v) { cam.x = v.x; cam.z = v.z; anchor = null; } else cancelFollow();
  }
  const pan = cam.dist * 1.1 * dt * PAN[speed], s = Math.sin(cam.yaw), c = Math.cos(cam.yaw);
  cam.x += (-s * fw + c * rt) * pan; cam.z += (-c * fw - s * rt) * pan; clamp();
  cam.yaw += ((keys.has('KeyE') ? 1 : 0) - (keys.has('KeyQ') ? 1 : 0)) * 1.6 * dt;
  cam.y = (cam.y ?? 0) + (hooks.hAt(cam.x, cam.z) - (cam.y ?? 0)) * Math.min(1, dt * 4);
  pose();
  if (anchor) { solveAnchor(); anchor.left -= dt; if (anchor.left <= 0) anchor = null; }
  showFollow();
}
function corners(terrain) {
  const { cam } = hooks, key = [cam.x, cam.y, cam.z, cam.yaw, cam.dist, innerWidth, innerHeight, terrain];
  if (!cornerKey || key.some((v, i) => v !== cornerKey[i])) {
    cornerKey = key;
    cornerPoints = [[0, 0], [innerWidth, 0], [innerWidth, innerHeight], [0, innerHeight]].map(([x, y]) => hooks.groundAt(x, y)).filter(Boolean);
  }
  return cornerPoints;
}

export const rig = { init, update, pose, wheel, frame, follow, cancelFollow, startIntro, skipIntro, introPress, beginMiddle, moveMiddle, stopDrag, corners,
  get following() { return followed; }, get intro() { return !!intro; }, get wide() { return wide().dist; } };
