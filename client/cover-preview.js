// With infantry selected, shields mark nearby explored ground: green heavy, yellow light and red open.
// Small yellow direction marks point toward cover that protects from direct fire on that side.
// Rules mirror shared/sim.js and are checked against the simulation in test.js.
// Four fixed buffer regions separate cursor/flash marks and marks visible through terrain models.
import * as THREE from 'three';
import { Builder, makeOverlay } from './overlay.js';
import { CELL, TERRAIN, MOVE, COVER, TRENCH, UNITS } from '../shared/sim.js';

// ---------- rules ----------
// at(x, y) is the terrain char of cell (x, y), '' off the map.
export const NONE = 0, OPEN = 1, LIGHT = 2, HEAVY = 3;
// shared/sim.js SOLID: a house, wall or sandbags, rubble, hedge, or a Classic building; WALLS: a house or a building
const solid = (ch) => ch === 'B' || ch === '#' || ch === 'R' || ch === 'H' || ch === 'K' || ch === 'Q';
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
const COLORS = { [HEAVY]: 0xb2de92, [LIGHT]: 0xe2b850, [OPEN]: 0xe5483b }; // green heavy, yellow light, red open
const TILE = { [HEAVY]: 0, [LIGHT]: 1, [OPEN]: 2, chevron: 3 };
const SIZE = { [HEAVY]: 1.3, [LIGHT]: 1.15, [OPEN]: 1.05, chevron: 0.85 };
const ALPHA = { [HEAVY]: 0.95, [LIGHT]: 0.95, [OPEN]: 0.85, chevron: 1 };
const LIFT = 0.14, CURSOR_OPACITY = 0.85, XRAY = 0.7, FLASH = 1.6;
const RADIUS = { high: 6.5, low: 5.2 }; // meters around the cursor; the marks fade over the outer 45%
const ENEMY_RANGE = 75; // the nearest enemy that can shoot straight at the spot, out to a little past sniper range
// regions of the shared buffer, in glyphs: the cursor and the flash, each on the ground and through houses
const CURSOR = 0, FLASHED = 1, MODELLED = 'BH#YROQ';
const PER = { ground: 300, xray: 120 };
const CAP = (PER.ground + PER.xray) * 2;
const VMAX = 48; // vehicles near the spot that can give cover
// Cover depends on exact distance and bearing, including movement within one terrain cell.
const posFloat = new Float64Array(2), posBits = new Uint32Array(posFloat.buffer);
function positionHash(x, z) {
  posFloat[0] = x; posFloat[1] = z;
  let h = 0;
  for (let i = 0; i < posBits.length; i++) h = (h * 31 + posBits[i]) | 0;
  return h;
}

// the 8 sides of a cell: E, SE, S, SW, W, NW, N, NE in world x and z (+z is south on the map)
const SIDE_C = [1, Math.SQRT1_2, 0, -Math.SQRT1_2, -1, -Math.SQRT1_2, 0, Math.SQRT1_2];
const SIDE_S = [0, Math.SQRT1_2, 1, Math.SQRT1_2, 0, -Math.SQRT1_2, -1, -Math.SQRT1_2];

// ctx: { scene, camera, canvas, units, selected, hAt, groundAt(mx, my), gfx, me(), foe(slot), mouse(), targeting(),
// grid() (rows of char arrays, or null between matches), state() (each cell's server state, damage stage in bits 3-4,
// or null), fog() (client/fog.js's state: explored, a Uint8Array of ever-seen cells, and version, or null) }
export function createCoverPreview(ctx) {
  const store = (fn) => { try { return fn(); } catch { return null; } };
  let on = store(() => localStorage.getItem('ww2-cover')) !== '0';
  let mesh = null, geo = null, mats = null, seg = 0, vpg = 0, ipg = 0, pos = null, edge = null, line = null, indices = null, col = null;
  const rgb = {};
  for (const k of [HEAVY, LIGHT, OPEN]) { const c = new THREE.Color(COLORS[k]); rgb[k] = [c.r, c.g, c.b]; }

  // ---------- buffers ----------
  function build() {
    seg = ctx.gfx?.low ? 1 : 2; vpg = 24; ipg = 72;
    const next = new THREE.BufferGeometry();
    const attr = (size) => new THREE.BufferAttribute(new Float32Array(CAP * vpg * size), size).setUsage(THREE.DynamicDrawUsage);
    next.setAttribute('position', attr(3)); next.setAttribute('aEdge', attr(4)); next.setAttribute('aLine', attr(3)); next.setAttribute('color', attr(4));
    const idx = new Uint16Array(CAP * ipg);
    next.setIndex(new THREE.BufferAttribute(idx, 1));
    // groups: cursor ground, cursor through houses, flash ground, flash through houses
    for (let r = 0; r < 4; r++) next.addGroup(start(r) * ipg, 0, r);
    pos = next.attributes.position.array; edge = next.attributes.aEdge.array; line = next.attributes.aLine.array; col = next.attributes.color.array; indices = idx;
    if (mesh) { geo.dispose(); mesh.geometry = next; }
    geo = next;
    cursorKey = -1; flT = FLASH; // the cursor marks are rewritten on the next frame; a running flash ends
  }
  const start = (r) => (r >> 1) * (PER.ground + PER.xray) + (r & 1) * PER.ground;
  function ensure() {
    if (mesh) return;
    const mat = (depthTest) => makeOverlay({ vertexColors: true, depthTest, fill: 0.3 });
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
      vhash = (vhash * 31 + positionHash(v.x, v.z)) | 0;
    }
    if (d2 < bestD2 && def.w && !def.w.salvo && ctx.foe(v.owner)) { bestD2 = d2; enemy = v; }
  }
  function scan(x, z) {
    sx = x; sz = z; reach2 = (radius() + 4 + CELL) ** 2; enemy = null; bestD2 = ENEMY_RANGE * ENEMY_RANGE; nveh = 0; vhash = 0;
    ctx.units.forEach(scanUnit);
    for (const [id, , , vx, vz] of ctx.wrecks?.() ?? []) {
      if (nveh >= VMAX || (vx - x) ** 2 + (vz - z) ** 2 >= reach2) continue;
      vpos[nveh * 2] = vx; vpos[nveh * 2 + 1] = vz; nveh++;
      vhash = (vhash * 31 + id + 1) | 0;
    }
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
  // Build two local shapes once. Rebuilds transform their vertices into the existing region buffers.
  const templates = new Map();
  for (const cue of [false, true]) {
    const pts = cue ? [-0.26, -0.22, 0, 0.12, 0.26, -0.22] : [-0.34, 0.36, 0.34, 0.36, 0.34, -0.04, 0.2, -0.3, 0, -0.45, -0.2, -0.3, -0.34, -0.04];
    const b = new Builder({ cap: 32 });
    b.line(pts, pts.length / 2, { w: 0.18, min: 1.15, y: LIFT, closed: !cue });
    if (!cue) {
      const hub = b.vert(0, LIFT, 0, 0, 0, 0, 0, 0, -3, 0.74);
      for (let i = 0; i < pts.length / 2; i++) b.tri(hub, i * 2 + 1, (i + 1) * 2 + 1);
    }
    templates.set(cue, b);
  }
  // Shields and directional cues share the ribbon shader with the other ground overlays.
  function glyph(tile, x, z, size, a, r, g, b, alpha) {
    if (wi >= wEnd) return;
    const slot = wi++, base = slot * vpg, ca = Math.cos(a), sa = Math.sin(a), t = templates.get(tile === TILE.chevron);
    for (let i = 0; i < t.nv; i++) {
      const p = (base + i) * 3, e = (base + i) * 4, tp = i * 3, te = i * 4;
      pos[p] = x + size * (ca * t.pos[tp + 2] - sa * t.pos[tp]); pos[p + 1] = LIFT;
      pos[p + 2] = z + size * (sa * t.pos[tp + 2] + ca * t.pos[tp]);
      edge[e] = ca * t.edge[te + 1] - sa * t.edge[te]; edge[e + 1] = sa * t.edge[te + 1] + ca * t.edge[te];
      edge[e + 2] = t.edge[te + 2]; edge[e + 3] = t.edge[te + 3];
      line[p] = t.ln[tp] * size; line[p + 1] = t.ln[tp + 1]; line[p + 2] = t.ln[tp + 2];
      col[e] = r; col[e + 1] = g; col[e + 2] = b; col[e + 3] = alpha;
    }
    for (let i = 0; i < ipg; i++) indices[slot * ipg + i] = base + (i < t.ni ? t.idx[i] : 0);
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
      const fade = Math.min(1, (R - d) / (R * 0.45)), px = (x + 0.5) * CELL, pz = (y + 0.5) * CELL, tilt = -Math.PI / 2;
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
    for (let i = 0; i < ATTRS.length; i++) {
      const a = geo.getAttribute(ATTRS[i]), size = a.itemSize;
      if (ground) a.addUpdateRange(g0 * vpg * size, ground * vpg * size);
      if (xray) a.addUpdateRange(x0 * vpg * size, xray * vpg * size);
      a.needsUpdate = true;
    }
    if (ground) geo.index.addUpdateRange(g0 * ipg, ground * ipg);
    if (xray) geo.index.addUpdateRange(x0 * ipg, xray * ipg);
    geo.index.needsUpdate = true;
  }
  const ATTRS = ['position', 'aEdge', 'aLine', 'color'];

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
    btn.title = 'With infantry selected, mark the cover around the cursor: green heavy, yellow light, red open';
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
  // everything the cursor marks depend on, hashed: the cell, enemy and vehicle positions, terrain
  // and scouting changes, whether a selected squad can garrison and the graphics level
  const keyOf = (cx, cy) => {
    let k = cy * 4099 + cx;
    k = (k * 31 + (enemy ? enemy.id : -1)) | 0;
    k = (k * 31 + (enemy ? positionHash(enemy.x, enemy.z) : -1)) | 0;
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
