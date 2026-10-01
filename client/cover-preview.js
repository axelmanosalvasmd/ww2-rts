// Cover preview (Company of Heroes style). With infantry selected, the ground around the cursor shows the cover a
// squad would get in each 2 m cell, drawn in grease pencil on the table:
//   heavy (chalk green, cross-hatched pip): trench, the MG nest's center, a house edge cell a squad can garrison;
//   light (brass, hatched pip): hedge, wall, sandbags, crater, rubble, tank traps;
//   open (grease red, small dot): everything else a squad can stand on.
// Brass chevrons mark directional cover, the sim's behindCover (coverBehind above 0.4): something solid within
// 2.2 m on the shooter's side (or a wall not yet badly shot up at 2.9 m), a house wall at a corner of the squad's cell,
// or a vehicle or gun within 3.4 m. The sim counts it against direct fire from that side only, fading with distance.
// With an enemy in sight the cells are judged against the nearest one; otherwise each open cell shows the sides it
// is covered from. A right-click move flashes the same marks at the destination. Marks show only on ground your side
// has explored (the server's fog of war, client/fog.js), which a reload or rejoin keeps.
// The rules mirror shared/sim.js (coverMul, coverBehind, entryCell); test.js checks them against the sim itself.
// One mesh and one preallocated BufferGeometry draw everything; it is rewritten only when the cursor enters a new
// cell or what the marks depend on changes, and frame() allocates nothing.
import * as THREE from 'three';
import { CELL, TERRAIN, MOVE, COVER, TRENCH, UNITS } from '../shared/sim.js';

// ---------- rules ----------
// at(x, y) is the terrain char of cell (x, y), '' off the map.
export const NONE = 0, OPEN = 1, LIGHT = 2, HEAVY = 3;
// shared/sim.js SOLID: a house, wall or sandbags, rubble, hedge, or a Classic building; WALLS: a house or a building
const solid = (ch) => ch === 'B' || ch === '#' || ch === 'R' || ch === 'H' || ch === 'K';
const wall = (ch) => ch === 'B' || ch === 'K';
const AROUND = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const WHOLE = () => 0;
const walkable = (ch) => !((TERRAIN[ch] ?? MOVE) & MOVE);

// a house cell with ground next to it a squad can step onto, so it can see and shoot out (sim entryCell)
export function houseEdge(at, x, y) {
  return (at(x + 1, y) !== 'B' && walkable(at(x + 1, y))) || (at(x - 1, y) !== 'B' && walkable(at(x - 1, y)))
    || (at(x, y + 1) !== 'B' && walkable(at(x, y + 1))) || (at(x, y - 1) !== 'B' && walkable(at(x, y - 1)));
}
// the cover the ground itself gives a squad in cell (x, y), from every side (sim coverMul)
export function cellCover(at, x, y, garrisons = true) {
  const ch = at(x, y), f = TERRAIN[ch];
  if (f === undefined) return NONE;
  if (ch === 'B') return garrisons && houseEdge(at, x, y) ? HEAVY : NONE;
  if (f & MOVE) return NONE;
  return f & TRENCH ? HEAVY : f & COVER ? LIGHT : OPEN;
}
// sim behindCover, terrain half, from (px, pz) toward the shooter along (ca, sa). Stepping out as the sim does, the
// first solid cell decides: its cover, min(1, (3.8 - d) / 1.6) times its quality (0.5 to 1 with what is left of it),
// passes 0.4 for anything within 2.2 m, at 2.9 m only for a wall not yet badly shot up, and never at 3.6 m. A house wall
// in a cell next to the squad, within 60 degrees of the shooter, covers too (leaning out from the corner).
// stage(x, y): a cell's damage stage, 0 whole, 1 damaged, 2 nearly gone (the server's cell state, bits 3-4). The sim
// splits stage 1 at 42% health; the client only knows the stage, so all of stage 1 counts.
export function solidToward(at, px, pz, ca, sa, stage = WHOLE) {
  for (let d = 0.8; d < 3.7; d += 0.7) {
    const x = Math.floor((px + ca * d) / CELL), y = Math.floor((pz + sa * d) / CELL);
    if (!solid(at(x, y))) continue;
    if (d < 2.5 || (d < 3.3 && stage(x, y) < 2)) return true;
    break;
  }
  const x = Math.floor(px / CELL), y = Math.floor(pz / CELL);
  for (const [dx, dy] of AROUND) if (wall(at(x + dx, y + dy)) && (dx * ca + dy * sa) / Math.hypot(dx, dy) > 0.5) return true;
  return false;
}
// a vehicle or gun covers a squad as much as min(1, (4 - d) / 1.5): above 0.4 inside 3.4 m
const vehicleCovers = (d) => d > 0 && (4 - d) / 1.5 > 0.4;
// sim behindCover, vehicle half: one of n live ground non-infantry units (x, z pairs in pos) close enough, no more
// than about 45 degrees off the shooter's bearing
export function vehicleToward(pos, n, px, pz, ca, sa) {
  for (let i = 0; i < n; i++) {
    const dx = pos[i * 2] - px, dz = pos[i * 2 + 1] - pz, d = Math.hypot(dx, dz);
    if (vehicleCovers(d) && (dx * ca + dz * sa) / d > 0.7) return true;
  }
  return false;
}

// ---------- look ----------
const COLORS = { [HEAVY]: 0xb2de92, [LIGHT]: 0xe2b850, [OPEN]: 0xc63a2c }; // chalk green, brass, grease red
const TILE = { [HEAVY]: 0, [LIGHT]: 1, [OPEN]: 2, chevron: 3 };
const SIZE = { [HEAVY]: 1.3, [LIGHT]: 1.15, [OPEN]: 0.8, chevron: 0.85 };
const ALPHA = { [HEAVY]: 0.95, [LIGHT]: 0.95, [OPEN]: 0.6, chevron: 1 };
const LIFT = 0.1, CURSOR_OPACITY = 0.85, XRAY = 0.7, FLASH = 1.6;
const RADIUS = { high: 6.5, low: 5.2 }; // meters around the cursor; the marks fade over the outer 45%
const ENEMY_RANGE = 75; // the nearest enemy that can shoot straight at the spot, out to a little past sniper range
// regions of the shared buffer, in glyphs: the cursor and the flash, each on the ground and through houses
const CURSOR = 0, FLASHED = 1, MODELLED = 'BH#YR';
const PER = { ground: 300, xray: 120 };
const CAP = (PER.ground + PER.xray) * 2;
const VMAX = 48; // vehicles near the spot that can give cover
const hash = (x, y) => { const v = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return v - Math.floor(v); };
// the 8 sides of a cell: E, SE, S, SW, W, NW, N, NE in world x and z (+z is south on the map)
const SIDE_C = [1, Math.SQRT1_2, 0, -Math.SQRT1_2, -1, -Math.SQRT1_2, 0, Math.SQRT1_2];
const SIDE_S = [0, Math.SQRT1_2, 1, Math.SQRT1_2, 0, -Math.SQRT1_2, -1, -Math.SQRT1_2];

// White pencil marks with a dark halo on a 4-tile strip, tinted by the vertex colors.
function atlas() {
  const S = 64, cv = document.createElement('canvas'); cv.width = S * 4; cv.height = S;
  const c = cv.getContext('2d');
  c.lineCap = c.lineJoin = 'round';
  const halo = 'rgba(22,22,15,0.5)', ink = '#fff';
  const ring = (ox, r, w, style) => { c.strokeStyle = style; c.lineWidth = w; c.beginPath(); c.arc(ox + 32, 32, r, 0, Math.PI * 2); c.stroke(); };
  const hatch = (ox, r, dir, gap, w) => {
    c.save(); c.beginPath(); c.arc(ox + 32, 32, r, 0, Math.PI * 2); c.clip();
    c.strokeStyle = ink; c.lineWidth = w;
    for (let k = -40; k <= 40; k += gap) { c.beginPath(); c.moveTo(ox + 32 + k - 30 * dir, 2); c.lineTo(ox + 32 + k + 30 * dir, 62); c.stroke(); }
    c.restore();
  };
  // heavy: a thick ring, cross-hatched
  c.fillStyle = 'rgba(22,22,15,0.3)'; c.beginPath(); c.arc(32, 32, 24, 0, Math.PI * 2); c.fill();
  ring(0, 23, 9, halo); ring(0, 23, 4.5, ink);
  hatch(0, 20, 1, 9, 2.6); hatch(0, 20, -1, 9, 2.6);
  // light: a thinner ring, hatched one way
  c.fillStyle = 'rgba(22,22,15,0.25)'; c.beginPath(); c.arc(96, 32, 22, 0, Math.PI * 2); c.fill();
  ring(64, 21, 7, halo); ring(64, 21, 3.2, ink);
  hatch(64, 19, 1, 8, 2.6);
  // open: a dot
  c.fillStyle = halo; c.beginPath(); c.arc(160, 32, 15, 0, Math.PI * 2); c.fill();
  c.fillStyle = ink; c.beginPath(); c.arc(160, 32, 10, 0, Math.PI * 2); c.fill();
  // chevron, pointing up the tile (+v), which glyph() turns to face the cover
  const chev = (w, style) => { c.strokeStyle = style; c.lineWidth = w; c.beginPath(); c.moveTo(206, 46); c.lineTo(224, 18); c.lineTo(242, 46); c.stroke(); };
  chev(15, halo); chev(8, ink);
  // paper grain in the alpha, so the marks read as pencil rather than print
  const img = c.getImageData(0, 0, S * 4, S), d = img.data;
  for (let i = 3; i < d.length; i += 4) d[i] = Math.round(d[i] * (0.72 + 0.28 * hash(i * 0.37, i * 0.011)));
  c.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// ctx: { scene, camera, canvas, units, selected, hAt, groundAt(mx, my), gfx, me(), foe(slot), mouse(), targeting(),
// grid() (rows of char arrays, or null between matches), state() (each cell's server state, damage stage in bits 3-4,
// or null), fog() (client/fog.js's state: explored, a Uint8Array of ever-seen cells, and version, or null) }
export function createCoverPreview(ctx) {
  const store = (fn) => { try { return fn(); } catch { return null; } };
  let on = store(() => localStorage.getItem('ww2-cover')) !== '0';
  let mesh = null, geo = null, mats = null, seg = 0, vpg = 0, ipg = 0, pos = null, uvs = null, col = null;
  const rgb = {};
  for (const k of [HEAVY, LIGHT, OPEN]) { const c = new THREE.Color(COLORS[k]); rgb[k] = [c.r, c.g, c.b]; }

  // ---------- buffers ----------
  function build() {
    seg = ctx.gfx?.low ? 1 : 2; vpg = (seg + 1) ** 2; ipg = seg * seg * 6;
    const next = new THREE.BufferGeometry();
    const attr = (size) => new THREE.BufferAttribute(new Float32Array(CAP * vpg * size), size).setUsage(THREE.DynamicDrawUsage);
    next.setAttribute('position', attr(3)); next.setAttribute('uv', attr(2)); next.setAttribute('color', attr(4));
    const idx = new Uint16Array(CAP * ipg);
    for (let g = 0, o = 0; g < CAP; g++) for (let j = 0; j < seg; j++) for (let i = 0; i < seg; i++) {
      const a = g * vpg + j * (seg + 1) + i, b = a + 1, c = a + seg + 1, d = c + 1;
      idx[o++] = a; idx[o++] = c; idx[o++] = b; idx[o++] = b; idx[o++] = c; idx[o++] = d;
    }
    next.setIndex(new THREE.BufferAttribute(idx, 1));
    // groups: cursor ground, cursor through houses, flash ground, flash through houses
    for (let r = 0; r < 4; r++) next.addGroup(start(r) * ipg, 0, r);
    pos = next.attributes.position.array; uvs = next.attributes.uv.array; col = next.attributes.color.array;
    if (mesh) { geo.dispose(); mesh.geometry = next; }
    geo = next;
    cursorKey = -1; flT = FLASH; // the cursor marks are rewritten on the next frame; a running flash ends
  }
  const start = (r) => (r >> 1) * (PER.ground + PER.xray) + (r & 1) * PER.ground;
  function ensure() {
    if (mesh) return;
    const map = atlas();
    const mat = (depthTest) => new THREE.MeshBasicMaterial({ map, vertexColors: true, transparent: true, depthWrite: false, depthTest,
      side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    mats = [mat(true), mat(false), mat(true), mat(false)];
    mats[0].opacity = CURSOR_OPACITY; mats[1].opacity = CURSOR_OPACITY * XRAY;
    build();
    mesh = new THREE.Mesh(geo, mats);
    // under the fog overlay (renderOrder 1), so ground you can't see right now darkens the marks with it
    mesh.renderOrder = 0; mesh.frustumCulled = false; mesh.visible = false; mesh.raycast = () => {};
    ctx.scene.add(mesh);
    ctx.gfx?.onChange(() => build());
  }

  // ---------- the map as the client knows it ----------
  let grid = null, W = 0, H = 0, seen = null, lastFog = -1, terrainVersion = 0, seenVersion = 0;
  const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? '' : grid[y][x]);
  const stage = (x, y) => (ctx.state?.()?.[y * W + x] ?? 0) >> 3 & 3;
  // cells this side has seen (the server's explored cells): terrain is known, the marks stay out of ground never scouted
  function mergeFog() {
    const f = ctx.fog(), vis = f?.explored;
    if (!vis || f.version === lastFog || !seen || vis.length !== seen.length) return;
    lastFog = f.version;
    const rc = Math.ceil(radius() / CELL);
    for (let i = 0; i < vis.length; i++) if (vis[i] && !seen[i]) {
      seen[i] = 1;
      const x = i % W, y = (i - x) / W;
      if ((Math.abs(x - curX) <= rc && Math.abs(y - curY) <= rc) || (Math.abs(x - flX) <= rc && Math.abs(y - flY) <= rc)) seenVersion++;
    }
  }
  const radius = () => (seg === 1 ? RADIUS.low : RADIUS.high);

  // ---------- what's around a spot ----------
  // One pass over the units with a hoisted callback: the selection's infantry, the nearest enemy that can shoot
  // straight, and the vehicles that could give cover. Results land in these variables.
  let sx = 0, sz = 0, reach2 = 0, enemy = null, bestD2 = 0, nveh = 0, vhash = 0, infantry = false, garrisons = false;
  const vpos = new Float64Array(VMAX * 2);
  function scanUnit(v) {
    const def = UNITS[v.type];
    if (!def || def.air || v.hp <= 0) return;
    const dx = v.x - sx, dz = v.z - sz, d2 = dx * dx + dz * dz;
    if (!def.infantry && d2 < reach2 && nveh < VMAX) {
      vpos[nveh * 2] = v.x; vpos[nveh * 2 + 1] = v.z; nveh++;
      vhash = (vhash * 31 + Math.floor(v.z / CELL) * 4099 + Math.floor(v.x / CELL) + 1) | 0;
    }
    if (d2 < bestD2 && def.w && !def.w.salvo && ctx.foe(v.owner)) { bestD2 = d2; enemy = v; }
  }
  function scan(x, z) {
    sx = x; sz = z; reach2 = (radius() + 4 + CELL) ** 2; enemy = null; bestD2 = ENEMY_RANGE * ENEMY_RANGE; nveh = 0; vhash = 0;
    ctx.units.forEach(scanUnit);
  }
  let mine = 0;
  function scanSel(id) {
    const v = ctx.units.get(id), def = v && v.owner === mine && UNITS[v.type];
    if (!def?.infantry) return;
    infantry = true; if (def.garrisons) garrisons = true;
  }
  function selection() { mine = ctx.me(); infantry = garrisons = false; ctx.selected.forEach(scanSel); }

  // ---------- writing glyphs ----------
  let wi = 0, wEnd = 0;
  // one mark: a tile of the atlas centered at (x, z), turned so the tile's top faces angle a, draped over the ground
  function glyph(tile, x, z, size, a, r, g, b, alpha) {
    if (wi >= wEnd) return;
    const base = wi++ * vpg, ca = Math.cos(a) * size, sa = Math.sin(a) * size, u0 = tile * 0.25 + 0.004, du = 0.25 - 0.008;
    for (let j = 0, k = base; j <= seg; j++) {
      const t = j / seg - 0.5;
      for (let i = 0; i <= seg; i++, k++) {
        const s = i / seg - 0.5, px = x + ca * t - sa * s, pz = z + sa * t + ca * s;
        pos[k * 3] = px; pos[k * 3 + 1] = ctx.hAt(px, pz) + LIFT; pos[k * 3 + 2] = pz;
        uvs[k * 2] = u0 + du * (s + 0.5); uvs[k * 2 + 1] = t + 0.5;
        col[k * 4] = r; col[k * 4 + 1] = g; col[k * 4 + 2] = b; col[k * 4 + 3] = alpha;
      }
    }
  }
  const pip = (kind, x, z, tilt, fade) => { const c = rgb[kind]; glyph(TILE[kind], x, z, SIZE[kind], tilt, c[0], c[1], c[2], ALPHA[kind] * fade); };
  const chevron = (x, z, ca, sa, fade) => {
    const c = rgb[LIGHT];
    glyph(TILE.chevron, x + ca * 0.62, z + sa * 0.62, SIZE.chevron, Math.atan2(sa, ca), c[0], c[1], c[2], ALPHA.chevron * fade);
  };
  // Rewrite one region with the marks around cell (cx, cy), using the last scan() and selection().
  function fill(region, cx, cy) {
    const R = radius(), rc = Math.ceil(R / CELL), g0 = start(region * 2), x0 = start(region * 2 + 1);
    let ground = 0, xray = 0;
    for (let dy = -rc; dy <= rc; dy++) for (let dx = -rc; dx <= rc; dx++) {
      const x = cx + dx, y = cy + dy, d = Math.hypot(dx, dy) * CELL;
      if (d > R || x < 0 || y < 0 || x >= W || y >= H || !seen[y * W + x]) continue;
      const kind = cellCover(at, x, y, garrisons);
      if (!kind) continue;
      const fade = Math.min(1, (R - d) / (R * 0.45)), px = (x + 0.5) * CELL, pz = (y + 0.5) * CELL, tilt = hash(x, y) * 0.6 - 0.3;
      // houses, hedges, walls, traps and rubble: drawn through their models, at the cell's ground, so they show from
      // any angle (a squad stands inside the hedge or wall cell)
      if (MODELLED.includes(grid[y][x])) { wi = x0 + xray; wEnd = x0 + PER.xray; pip(kind, px, pz, tilt, fade); xray = wi - x0; continue; }
      wi = g0 + ground; wEnd = g0 + PER.ground;
      if (kind !== OPEN) pip(kind, px, pz, tilt, fade);
      else if (enemy) {
        // the sim aims from the squad to the shooter
        const a = Math.atan2(enemy.z - pz, enemy.x - px), ca = Math.cos(a), sa = Math.sin(a);
        if (solidToward(at, px, pz, ca, sa, stage) || vehicleToward(vpos, nveh, px, pz, ca, sa)) { pip(LIGHT, px, pz, tilt, fade); chevron(px, pz, ca, sa, fade); }
        else pip(OPEN, px, pz, tilt, fade);
      } else {
        pip(OPEN, px, pz, tilt, fade);
        // the sides with something solid next to them; a corner only when neither of its edges is covered
        for (let k = 0; k < 8; k += 2) if (solidToward(at, px, pz, SIDE_C[k], SIDE_S[k], stage)) chevron(px, pz, SIDE_C[k], SIDE_S[k], fade);
        for (let k = 1; k < 8; k += 2) {
          if (solidToward(at, px, pz, SIDE_C[k - 1], SIDE_S[k - 1], stage) || solidToward(at, px, pz, SIDE_C[(k + 1) & 7], SIDE_S[(k + 1) & 7], stage)) continue;
          if (solidToward(at, px, pz, SIDE_C[k], SIDE_S[k], stage)) chevron(px, pz, SIDE_C[k], SIDE_S[k], fade);
        }
        for (let i = 0, n = 0; i < nveh && n < 2; i++) {
          const vx = vpos[i * 2] - px, vz = vpos[i * 2 + 1] - pz, vd = Math.hypot(vx, vz);
          if (vehicleCovers(vd)) { chevron(px, pz, vx / vd, vz / vd, fade); n++; }
        }
      }
      ground = wi - g0;
    }
    geo.groups[region * 2].count = ground * ipg; geo.groups[region * 2 + 1].count = xray * ipg;
    for (let i = 0; i < 3; i++) {
      const a = geo.getAttribute(ATTRS[i]), size = a.itemSize;
      if (ground) a.addUpdateRange(g0 * vpg * size, ground * vpg * size);
      if (xray) a.addUpdateRange(x0 * vpg * size, xray * vpg * size);
      a.needsUpdate = true;
    }
  }
  const ATTRS = ['position', 'uv', 'color'];

  // ---------- input the main loop does not track ----------
  let buttons = 0, over = false;
  if (ctx.canvas) {
    addEventListener('pointerdown', (e) => { buttons = e.buttons; }, true);
    addEventListener('pointerup', (e) => { buttons = e.buttons; }, true);
    addEventListener('pointermove', (e) => { buttons = e.buttons; });
    addEventListener('blur', () => { buttons = 0; });
    ctx.canvas.addEventListener('pointermove', () => { over = true; });
    ctx.canvas.addEventListener('pointerleave', () => { over = false; });
  }

  // ---------- menu setting ----------
  let btn = null;
  function label() { if (btn) { btn.textContent = `Cover preview: ${on ? 'On' : 'Off'}`; btn.setAttribute('aria-pressed', String(on)); } }
  const menu = typeof document !== 'undefined' && document.getElementById('menu');
  if (menu) {
    btn = document.createElement('button'); btn.id = 'coverBtn';
    btn.title = 'With infantry selected, mark the cover around the cursor: green heavy, brass light, red open';
    btn.onclick = () => { on = !on; store(() => localStorage.setItem('ww2-cover', on ? '1' : '0')); label(); };
    menu.insertBefore(btn, menu.querySelector('.vol'));
    label();
  }

  // ---------- per frame ----------
  let curX = -99, curY = -99, curOk = false, cursorKey = -1, flT = FLASH, flX = -99, flY = -99;
  let mx = NaN, my = NaN, version = -1;
  const camPos = new Float64Array(7), cam = ctx.camera;
  function cameraMoved() {
    const p = cam.position, q = cam.quaternion;
    if (p.x === camPos[0] && p.y === camPos[1] && p.z === camPos[2] && q.x === camPos[3] && q.y === camPos[4] && q.z === camPos[5] && q.w === camPos[6]) return false;
    camPos[0] = p.x; camPos[1] = p.y; camPos[2] = p.z; camPos[3] = q.x; camPos[4] = q.y; camPos[5] = q.z; camPos[6] = q.w;
    return true;
  }
  // everything the cursor marks depend on, hashed: the cell, the enemy and its cell, the vehicles' cells, terrain
  // and scouting changes, whether a selected squad can garrison and the graphics level
  const keyOf = (cx, cy) => {
    let k = cy * 4099 + cx;
    k = (k * 31 + (enemy ? enemy.id : -1)) | 0;
    k = (k * 31 + (enemy ? Math.floor(enemy.z / CELL) * 4099 + Math.floor(enemy.x / CELL) : -1)) | 0;
    k = (k * 31 + vhash) | 0; k = (k * 31 + terrainVersion) | 0; k = (k * 31 + seenVersion) | 0;
    return (k * 4 + (garrisons ? 2 : 0) + seg) | 0;
  };
  function frame(dt) {
    if (!mesh) return;
    grid = ctx.grid();
    if (!on || !grid || !seen) { mesh.visible = false; return; }
    mergeFog();
    if (flT < FLASH) flT += dt;
    selection();
    const m = ctx.mouse(), aim = ctx.targeting();
    const show = infantry && m.inside && over && !(buttons & 1) && (aim === null || aim === 'amove');
    if (show) {
      // the ground under the cursor: only when the mouse, the view or the ground moved
      if (m.x !== mx || m.y !== my || cameraMoved() || version !== terrainVersion) {
        mx = m.x; my = m.y; version = terrainVersion;
        cam.updateMatrixWorld();
        const g = ctx.groundAt(mx, my);
        curOk = !!g;
        if (g) { curX = Math.floor(g.x / CELL); curY = Math.floor(g.z / CELL); }
      }
      if (curOk) {
        scan((curX + 0.5) * CELL, (curY + 0.5) * CELL);
        const key = keyOf(curX, curY);
        if (key !== cursorKey) { cursorKey = key; fill(CURSOR, curX, curY); }
      }
    }
    // a flash on the cell under the cursor stands in for the cursor marks, then hands back to them as it fades
    const same = flT < FLASH && show && curOk && curX === flX && curY === flY;
    let fo = flT < FLASH ? Math.min(1, flT / 0.12) * (1 - smooth((flT - 0.45) / (FLASH - 0.45))) : 0;
    if (same && flT > 0.45 && fo <= CURSOR_OPACITY) { flT = FLASH; fo = 0; }
    const cursorOn = show && curOk && !(same && flT < FLASH);
    mats[2].opacity = fo; mats[3].opacity = fo * XRAY;
    // a hidden or empty region is left out of the pass entirely
    mats[0].visible = cursorOn && geo.groups[0].count > 0; mats[1].visible = cursorOn && geo.groups[1].count > 0;
    mats[2].visible = fo > 0 && geo.groups[2].count > 0; mats[3].visible = fo > 0 && geo.groups[3].count > 0;
    mesh.visible = mats[0].visible || mats[1].visible || mats[2].visible || mats[3].visible;
  }
  const smooth = (t) => { const k = Math.max(0, Math.min(1, t)); return k * k * (3 - 2 * k); };

  return {
    // a new match (main.js has made its fog already): scouting is what the server says this side has explored, which
    // after a reload or rejoin includes everything seen before it
    start() {
      ensure();
      const g = ctx.grid(); grid = g; H = g?.length ?? 0; W = g?.[0]?.length ?? 0;
      seen = new Uint8Array(W * H); lastFog = -1; flT = FLASH; cursorKey = -1; curOk = false; mx = NaN;
      for (const gr of geo.groups) gr.count = 0;
    },
    // terrain changed (digging, shelling): rewrite the marks on the next frame
    dirty() { terrainVersion++; },
    frame,
    // the same marks at a move order's destination, for a moment
    flash(x, z) {
      if (!mesh || !on || !seen) return;
      grid = ctx.grid(); selection();
      if (!grid || !infantry) return;
      mergeFog();
      flX = Math.floor(x / CELL); flY = Math.floor(z / CELL);
      scan((flX + 0.5) * CELL, (flY + 0.5) * CELL);
      fill(FLASHED, flX, flY); flT = 0;
    },
    get enabled() { return on; },
    set enabled(v) { on = !!v; store(() => localStorage.setItem('ww2-cover', on ? '1' : '0')); label(); },
  };
}
