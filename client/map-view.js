// The paper war map: zoomed all the way out, the battlefield turns into a staff map lying on a desk.
//
// Three layers fade in together over the last stretch of zoom and, fully in, cover the 3D scene:
// - the paper, a canvas painted once per terrain change (inked contours, woods, houses, roads, water, a blue grid),
//   draped over the ground mesh, with a desk under it past the map's edge;
// - a sepia wash read straight from the fog texture: darker where you have never scouted, lighter where you have
//   but cannot see now (enemies there are simply not on the map, the server never sends them);
// - a flat screen overlay drawn at 30 Hz while the camera is still, or immediately when it moves: every unit as
//   its map symbol in its owner's color, capture points, strikes, your units' orders in grease pencil, the map's
//   name and a compass.
// The floating 3D labels fade out while the map is up (client/markers.js fadeLabels).
import * as THREE from 'three';
import { drawSymbol } from './symbols.js';
import { CELL, CFG, UNITS, SUPPORT } from '/shared/sim.js';

const PAPER = '#e8dec3', INK = '#3b3226', CONTOUR = '#9a6b3c', WATER = '#9fbcc4', WOOD = '#b5c194', GRID = 'rgba(60, 90, 130, 0.22)';
const PENCIL = { move: '#2f3d6b', attack: '#a3241c', retreat: '#6b5a2f', other: '#3b3226' };
// where the fade runs, as a share of the widest zoom
const FROM = 0.7, TO = 0.9;
const DRAW_INTERVAL = 1 / 30, MAX_DPR = 1.5;

// grid: terrain rows of cell chars, w and h in cells, geometry: the relief's (its uv spans the map), hAt(x, z),
// fog: client/fog.js state or null, units: the live unit map, colorOf(slot) -> css color, title: the map's name,
// camera, view: the WebGL canvas (the overlay goes right after it, under the HUD), state() -> { me, selected,
// points: [{ x, z, owner }], strikes: the snapshot's strike rows }
export function createMapView({ grid, w, h, geometry, hAt, fog, units, colorOf, title = '', camera, view, state }) {
  const MW = w * CELL, MH = h * CELL;
  const PX = Math.max(2, Math.min(12, Math.floor(2048 / Math.max(w, h))));
  const W = w * PX, H = h * PX;
  const object = new THREE.Group();

  // the paper
  const paper = document.createElement('canvas'); paper.width = W; paper.height = H;
  const texture = new THREE.CanvasTexture(paper);
  texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 8;
  const paperMat = new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false, toneMapped: false });
  const paperMesh = new THREE.Mesh(geometry, paperMat);
  paperMesh.renderOrder = 1000;

  // the fog as a sepia wash: the fog texture's alpha is 0 seen, about 0.47 explored, about 0.73 never seen
  const washMat = new THREE.ShaderMaterial({
    uniforms: { map: { value: fog?.texture ?? null }, k: { value: 0 } }, transparent: true, depthTest: false, depthWrite: false,
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform sampler2D map; uniform float k; varying vec2 vUv; void main() { gl_FragColor = vec4(0.55, 0.4, 0.22, texture2D(map, vUv).a * k); }',
  });
  const washMesh = new THREE.Mesh(geometry, washMat);
  washMesh.renderOrder = 1001; washMesh.visible = !!fog;

  // the desk: one big plank-and-grain canvas with the paper's shadow on it, flat under the map
  const SPAN = 7, desk = document.createElement('canvas'); desk.width = desk.height = 2048;
  paintDesk(desk.getContext('2d'), 2048, SPAN, MW / Math.max(MW, MH), MH / Math.max(MW, MH));
  const deskTex = new THREE.CanvasTexture(desk); deskTex.colorSpace = THREE.SRGBColorSpace; deskTex.anisotropy = 8;
  const deskMat = new THREE.MeshBasicMaterial({ map: deskTex, transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false, toneMapped: false });
  const deskMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), deskMat);
  deskMesh.rotation.x = -Math.PI / 2; deskMesh.scale.set(Math.max(MW, MH) * SPAN, Math.max(MW, MH) * SPAN, 1);
  deskMesh.position.set(MW / 2, 0, MH / 2); deskMesh.renderOrder = 999;
  for (const m of [deskMesh, paperMesh, washMesh]) { m.raycast = () => {}; object.add(m); }
  object.visible = false;

  // the screen overlay
  const overlay = document.createElement('canvas');
  overlay.style.cssText = 'position: fixed; inset: 0; width: 100vw; height: 100vh; pointer-events: none; opacity: 0;';
  view.after(overlay);
  const ctx = overlay.getContext('2d');

  let fade = 0, dirty = true, drawAge = DRAW_INTERVAL, renderObject = null;
  const drawnView = new THREE.Matrix4(), drawnProjection = new THREE.Matrix4();
  const at = (x, y) => grid[y]?.[x];

  function paint() {
    const c = paper.getContext('2d'), rnd = mulberry(7);
    c.fillStyle = PAPER; c.fillRect(0, 0, W, H);
    for (let i = 0; i < W * H / 60; i++) { c.fillStyle = `rgba(90, 70, 40, ${rnd() * 0.06})`; c.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 2, 1 + rnd() * 2); }
    for (let i = 0; i < 6; i++) { // coffee and damp stains
      const x = rnd() * W, y = rnd() * H, r = (0.05 + rnd() * 0.12) * Math.max(W, H), g = c.createRadialGradient(x, y, r * 0.2, x, y, r);
      g.addColorStop(0, 'rgba(150, 110, 60, 0.05)'); g.addColorStop(0.85, 'rgba(150, 110, 60, 0.09)'); g.addColorStop(1, 'rgba(150, 110, 60, 0)');
      c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // water and woods as washes, then houses, roads and the rest in ink
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const ch = at(x, y), X = x * PX, Y = y * PX;
      if (ch === 'W' || ch === 'F') { c.fillStyle = WATER; c.fillRect(X, Y, PX, PX); }
      else if (ch === 'O' || ch === 'H') { c.fillStyle = WOOD; c.fillRect(X, Y, PX, PX); }
      else if (ch === 'M') { c.fillStyle = 'rgba(120, 95, 60, 0.25)'; c.fillRect(X, Y, PX, PX); }
    }
    c.strokeStyle = '#5f7f88'; c.lineWidth = Math.max(1, PX * 0.12); // ripples along the water
    for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 3) if (at(x, y) === 'W' && rnd() < 0.5) {
      const X = x * PX, Y = y * PX + PX / 2; c.beginPath(); c.moveTo(X, Y); c.quadraticCurveTo(X + PX * 0.5, Y - PX * 0.4, X + PX, Y); c.quadraticCurveTo(X + PX * 1.5, Y + PX * 0.4, X + PX * 2, Y); c.stroke();
    }
    c.strokeStyle = '#5e6d3e'; c.lineWidth = Math.max(1, PX * 0.12); // little tree circles in the woods
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (at(x, y) === 'O' && rnd() < 0.55) {
      c.beginPath(); c.arc((x + 0.2 + rnd() * 0.6) * PX, (y + 0.2 + rnd() * 0.6) * PX, PX * (0.25 + rnd() * 0.15), 0, Math.PI * 2); c.stroke();
    }
    // contours: an ink line wherever the ground steps a level
    const lv = new Int8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) lv[y * w + x] = Math.round(hAt((x + 0.5) * CELL, (y + 0.5) * CELL) / CFG.levelHeight);
    c.strokeStyle = CONTOUR; c.lineWidth = Math.max(1, PX * 0.18); c.beginPath();
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const l = lv[y * w + x];
      if (x + 1 < w && lv[y * w + x + 1] !== l) { c.moveTo((x + 1) * PX, y * PX); c.lineTo((x + 1) * PX, (y + 1) * PX); }
      if (y + 1 < h && lv[(y + 1) * w + x] !== l) { c.moveTo(x * PX, (y + 1) * PX); c.lineTo((x + 1) * PX, (y + 1) * PX); }
    }
    c.stroke();
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const ch = at(x, y), X = x * PX, Y = y * PX;
      if (ch === 'D' || ch === '=') { c.fillStyle = ch === '=' ? INK : '#8a6e4c'; c.fillRect(X, Y + PX * 0.3, PX, PX * 0.4); c.fillRect(X + PX * 0.3, Y, PX * 0.4, PX); }
      else if (ch === 'B' || ch === 'K') { c.fillStyle = INK; c.fillRect(X - 0.5, Y - 0.5, PX + 1, PX + 1); }
      else if (ch === 'R' || ch === '#' || ch === 'Q') { c.fillStyle = 'rgba(59, 50, 38, 0.55)'; c.fillRect(X + PX * 0.15, Y + PX * 0.15, PX * 0.7, PX * 0.7); }
      else if (ch === 'T') { c.strokeStyle = INK; c.lineWidth = Math.max(1, PX * 0.15); c.beginPath(); c.moveTo(X, Y + PX * 0.5); c.lineTo(X + PX * 0.33, Y + PX * 0.2); c.lineTo(X + PX * 0.66, Y + PX * 0.8); c.lineTo(X + PX, Y + PX * 0.5); c.stroke(); }
      else if (ch === 'X' || ch === 'Y') { c.strokeStyle = INK; c.lineWidth = Math.max(1, PX * 0.1); c.beginPath(); c.moveTo(X, Y); c.lineTo(X + PX, Y + PX); c.moveTo(X + PX, Y); c.lineTo(X, Y + PX); c.stroke(); }
    }
    // a blue map grid every 10 cells and an inked border
    c.strokeStyle = GRID; c.lineWidth = 1; c.beginPath();
    for (let x = 0; x <= w; x += 10) { c.moveTo(x * PX, 0); c.lineTo(x * PX, H); }
    for (let y = 0; y <= h; y += 10) { c.moveTo(0, y * PX); c.lineTo(W, y * PX); }
    c.stroke();
    c.strokeStyle = INK; c.lineWidth = Math.max(2, PX * 0.4); c.strokeRect(PX, PX, W - 2 * PX, H - 2 * PX);
    texture.needsUpdate = true;
  }

  // world (x, z) on the ground -> overlay pixels, or null behind the camera
  const p3 = new THREE.Vector3();
  let sw = 0, sh = 0, dpr = 1;
  // Only the opaque desk can hide every battlefield pass. Panning or a steep view can uncover its edge.
  const ray = new THREE.Ray(), deskPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3();
  const halfDesk = Math.max(MW, MH) * SPAN / 2;
  function coversView() {
    for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      ray.origin.copy(camera.position);
      ray.direction.set(x, y, 0.5).unproject(camera).sub(ray.origin).normalize();
      if (ray.direction.y >= 0 || !ray.intersectPlane(deskPlane, hit)) return false;
      if (Math.abs(hit.x - MW / 2) >= halfDesk || Math.abs(hit.z - MH / 2) >= halfDesk) return false;
      hit.project(camera);
      if (hit.z < -1 || hit.z > 1) return false;
    }
    return true;
  }
  function screen(x, z) {
    p3.set(x, hAt(Math.min(MW - 0.01, Math.max(0, x)), Math.min(MH - 0.01, Math.max(0, z))), z).project(camera);
    return p3.z > 1 ? null : { x: (p3.x + 1) / 2 * sw, y: (1 - p3.y) / 2 * sh };
  }
  // a grease-pencil stroke: a slightly wobbly line, the same wobble every frame (seeded by id)
  function pencil(pts, color, { dash = null, width = 3, head = true, seed = 1 } = {}) {
    if (pts.length < 2) return;
    const rnd = mulberry(seed);
    ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = width * dpr; ctx.lineCap = ctx.lineJoin = 'round'; ctx.globalAlpha = 0.85;
    if (dash) ctx.setLineDash(dash.map(d => d * dpr));
    ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], mx = (a.x + b.x) / 2 + (rnd() - 0.5) * 6 * dpr, my = (a.y + b.y) / 2 + (rnd() - 0.5) * 6 * dpr;
      ctx.quadraticCurveTo(mx, my, b.x, b.y);
    }
    ctx.stroke(); ctx.setLineDash([]);
    if (head) {
      const b = pts.at(-1), a = pts.at(-2), ang = Math.atan2(b.y - a.y, b.x - a.x), L = 11 * dpr;
      ctx.beginPath(); ctx.moveTo(b.x - Math.cos(ang - 0.45) * L, b.y - Math.sin(ang - 0.45) * L); ctx.lineTo(b.x, b.y); ctx.lineTo(b.x - Math.cos(ang + 0.45) * L, b.y - Math.sin(ang + 0.45) * L); ctx.stroke();
    }
    ctx.restore();
  }

  const KIND = [null, 'move', 'attack', 'retreat', 'attack', 'attack', 'attack', 'other', 'other', 'other'];
  function draw() {
    dpr = Math.min(MAX_DPR, devicePixelRatio || 1);
    const cw = Math.round(innerWidth * dpr), ch = Math.round(innerHeight * dpr);
    if (overlay.width !== cw || overlay.height !== ch) { overlay.width = cw; overlay.height = ch; }
    sw = cw; sh = ch;
    ctx.clearRect(0, 0, sw, sh);
    const { me, selected, points = [], strikes = [] } = state();
    // a meter on the map in screen pixels, at its middle
    const mid = screen(MW / 2, MH / 2), east = screen(MW / 2 + 10, MH / 2), north = screen(MW / 2, MH / 2 - 10);
    if (!mid || !east || !north) return;
    const m = Math.hypot(east.x - mid.x, east.y - mid.y) / 10;
    ctx.font = `bold ${Math.round(12 * dpr)}px "Courier New", monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

    // capture points: an inked ring, filled in the holder's color, lettered
    points.forEach((p, i) => {
      const s = screen(p.x, p.z); if (!s) return;
      const r = CFG.pointRadius * m;
      ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.fillStyle = p.owner >= 0 ? colorOf(p.owner) + '55' : 'rgba(59, 50, 38, 0.08)'; ctx.fill();
      ctx.setLineDash([5 * dpr, 3 * dpr]); ctx.strokeStyle = INK; ctx.lineWidth = 2 * dpr; ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = INK; ctx.font = `bold ${Math.round(15 * dpr)}px "Courier New", monospace`; ctx.fillText(String.fromCharCode(65 + i), s.x, s.y);
    });
    // strikes on the way: their box, hatched in red
    for (const [kind, x, z, dir] of strikes) {
      const sp = SUPPORT[kind]; if (!sp) continue;
      const c = Math.cos(dir), sn = Math.sin(dir), L = sp.len / 2, Wd = sp.width / 2;
      const pts = [[-L, -Wd], [L, -Wd], [L, Wd], [-L, Wd]].map(([a, b]) => screen(x + a * c - b * sn, z + a * sn + b * c));
      if (pts.some(q => !q)) continue;
      ctx.save(); ctx.beginPath(); pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); ctx.closePath();
      ctx.strokeStyle = '#a3241c'; ctx.lineWidth = 2 * dpr; ctx.stroke(); ctx.clip();
      ctx.globalAlpha = 0.5; ctx.beginPath();
      const bx = Math.min(...pts.map(q => q.x)), by = Math.min(...pts.map(q => q.y)), ex = Math.max(...pts.map(q => q.x)), ey = Math.max(...pts.map(q => q.y));
      for (let t = bx - (ey - by); t < ex; t += 7 * dpr) { ctx.moveTo(t, ey); ctx.lineTo(t + (ey - by), by); }
      ctx.stroke(); ctx.restore();
    }
    // your units' orders in grease pencil: the route to where each is going, then what is queued after it
    for (const v of units.values()) {
      if (v.owner !== me) continue;
      const from = screen(v.x, v.z); if (!from) continue;
      if (v.plan && KIND[v.plan.kind]) {
        const pts = [from];
        for (let i = 0; i + 1 < v.plan.path.length; i += 2) { const q = screen(v.plan.path[i], v.plan.path[i + 1]); if (q) pts.push(q); }
        const end = screen(v.plan.tx, v.plan.tz); if (end) pts.push(end);
        const kind = KIND[v.plan.kind];
        if (pts.length > 1 && Math.hypot(pts.at(-1).x - from.x, pts.at(-1).y - from.y) > 14 * dpr) pencil(pts, PENCIL[kind], { dash: kind === 'retreat' ? [8, 6] : null, seed: v.id });
      }
      let last = v.plan ? screen(v.plan.tx, v.plan.tz) : from;
      for (const o of v.orders ?? []) { const q = screen(o.x, o.z); if (last && q) pencil([last, q], PENCIL.move, { dash: [6, 6], width: 2, seed: v.id + 7 }); last = q; }
    }
    // every unit as its symbol, in its owner's color, upright on screen; yours that are selected get a pencil ring
    const size = 26 * dpr;
    for (const v of units.values()) {
      const s = screen(v.x, v.z); if (!s) continue;
      const k = UNITS[v.type]?.building ? 1.45 : 1;
      if (selected?.has(v.id)) { ctx.beginPath(); ctx.arc(s.x, s.y, size * k * 0.62, 0, Math.PI * 2); ctx.strokeStyle = INK; ctx.lineWidth = 2 * dpr; ctx.stroke(); }
      drawSymbol(ctx, v.type, s.x, s.y, size * k, { color: colorOf(v.owner), halo: PAPER, haloWidth: 18 });
    }
    // the map's name above its far edge, and a compass in the corner
    const top = [screen(MW / 2, 0), screen(MW / 2, MH), screen(0, MH / 2), screen(MW, MH / 2)].filter(Boolean).sort((a, b) => a.y - b.y)[0];
    if (title && top) { ctx.font = `bold ${Math.round(20 * dpr)}px "Courier New", monospace`; ctx.fillStyle = '#efe6cc'; ctx.fillText(title.toUpperCase(), top.x, top.y - 22 * dpr); }
    const ang = Math.atan2(north.y - mid.y, north.x - mid.x) + Math.PI / 2, cx = 70 * dpr, cy = sh - 230 * dpr, R = 26 * dpr;
    ctx.save(); ctx.translate(cx, cy);
    ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fillStyle = 'rgba(232, 222, 195, 0.9)'; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 2 * dpr; ctx.stroke();
    ctx.rotate(ang);
    ctx.beginPath(); ctx.moveTo(0, -R * 0.8); ctx.lineTo(R * 0.22, 0); ctx.lineTo(0, R * 0.8); ctx.lineTo(-R * 0.22, 0); ctx.closePath(); ctx.fillStyle = INK; ctx.fill();
    ctx.beginPath(); ctx.moveTo(0, -R * 0.8); ctx.lineTo(R * 0.22, 0); ctx.lineTo(-R * 0.22, 0); ctx.closePath(); ctx.fillStyle = '#a3241c'; ctx.fill();
    ctx.fillStyle = INK; ctx.font = `bold ${Math.round(12 * dpr)}px "Courier New", monospace`; ctx.fillText('N', 0, -R - 9 * dpr);
    ctx.restore();
  }

  return {
    object,
    // fade: 0 (3D) to 1 (the map), so other layers can fade with it
    get fade() { return fade; },
    // Null keeps the full battlefield visible during fades or when the desk does not cover the screen.
    get renderObject() { return renderObject; },
    // the relief replaced its geometry (a crater)
    setGeometry(g) { paperMesh.geometry = washMesh.geometry = g; drawAge = DRAW_INTERVAL; },
    // the terrain changed (craters, wrecked houses): repainted the next time the map shows
    refresh() { dirty = true; },
    // every frame: zoom is the camera distance as a share of the widest zoom
    frame(dt, zoom) {
      const t = Math.min(1, Math.max(0, (zoom - FROM) / (TO - FROM))), want = t * t * (3 - 2 * t);
      fade += (want - fade) * Math.min(1, dt * 8);
      if ((want === 0 || want === 1) && Math.abs(want - fade) < 0.001) fade = want;
      camera.updateMatrixWorld();
      renderObject = fade === 1 && coversView() ? object : null;
      const on = fade > 0.01;
      object.visible = on; overlay.style.opacity = on ? fade.toFixed(3) : '0';
      paperMat.opacity = deskMat.opacity = fade; washMat.uniforms.k.value = fade * 0.55;
      if (!on) { if (overlay.width) overlay.width = 0; drawAge = DRAW_INTERVAL; return; }
      const changed = dirty;
      if (dirty) { dirty = false; paint(); }
      drawAge += dt;
      const ratio = Math.min(MAX_DPR, devicePixelRatio || 1);
      const resized = overlay.width !== Math.round(innerWidth * ratio) || overlay.height !== Math.round(innerHeight * ratio);
      const moved = !drawnView.equals(camera.matrixWorld) || !drawnProjection.equals(camera.projectionMatrix);
      if (changed || resized || moved || drawAge + 1e-8 >= DRAW_INTERVAL) {
        draw(); drawAge = 0;
        drawnView.copy(camera.matrixWorld); drawnProjection.copy(camera.projectionMatrix);
      }
    },
    dispose() { texture.dispose(); paperMat.dispose(); washMat.dispose(); deskTex.dispose(); deskMat.dispose(); deskMesh.geometry.dispose(); overlay.remove(); },
  };
}

// dark wooden planks with grain, and the paper's soft shadow in the middle (the map covers 1/span of it)
function paintDesk(c, S, span, fx, fz) {
  const rnd = mulberry(3), plank = S / 14;
  c.fillStyle = '#3a2717'; c.fillRect(0, 0, S, S);
  for (let i = 0; i < 14; i++) {
    c.fillStyle = `rgb(${52 + rnd() * 14}, ${35 + rnd() * 9}, ${21 + rnd() * 6})`; c.fillRect(0, i * plank + 1, S, plank - 2);
    c.strokeStyle = 'rgba(20, 12, 6, 0.35)'; c.lineWidth = 1.2;
    for (let k = 0; k < 9; k++) {
      const y = i * plank + rnd() * plank; c.beginPath(); c.moveTo(0, y);
      for (let x = 0; x <= S; x += 64) c.lineTo(x, y + Math.sin(x / (90 + k * 20) + k) * 3);
      c.stroke();
    }
  }
  const mw = S / span * fx, mh = S / span * fz;
  c.shadowColor = 'rgba(0, 0, 0, 0.75)'; c.shadowBlur = Math.max(mw, mh) * 0.06; c.fillStyle = 'rgba(0, 0, 0, 0.6)';
  c.fillRect((S - mw) / 2 + mw * 0.01, (S - mh) / 2 + mh * 0.02, mw, mh);
}

// a small seeded random, so the paper looks the same every match
function mulberry(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
