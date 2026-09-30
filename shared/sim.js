// Pure game logic. The server runs it; the client imports the tables for rendering.
// Coordinates: world metres, x right, z down the map rows. Grid cells are CELL metres.

export const CELL = 2;
export const TICK = 1 / 20;
export const CFG = {
  vpToWin: 1200, mpStart: 150,
  // flat income does most of the work; points add a little and trailing players catch up
  mpBase: 4, catchupMax: 4, catchupPer: 80,
  captureTime: 8, pointRadius: 8, popCap: 12,
  retreatSpeed: 1.5, retreatDamage: 0.25, reinforceRadius: 15, reinforceEvery: 2,
  // incoming accuracy/suppression multipliers; blasts only care about trenches
  coverMul: 0.5, trenchMul: 0.35, trenchBlastMul: 0.5,
  digCost: 30, digCells: 4, digTime: 3,
  // destruction: hit points per structure cell, what it turns into, and what tanks flatten by driving through
  terrainHp: { B: 400, H: 60, '#': 150, '=': 200 }, wreck: { B: 'R', H: '.', '#': '+', '=': 'W' }, crush: { H: '.', '#': 'R' },
  fordSpeed: 0.5,
  // garrisoned squads: heavy cover, upper-floor vision, thrown out (and hurt) when the house comes down
  garrisonMul: 0.35, garrisonVision: 1.25, garrisonEvictDamage: 0.3,
  // veterancy: damage dealt (as multiples of the unit's cost) for 1/2/3 stars, and what each star is worth
  vetXp: [1, 2.5, 5], vetAcc: 0.1, vetArmor: 0.08, vetSupp: 0.15,
  // elevation: height level per cell. 1 level of difference is a slope, more is a cliff.
  levelHeight: 2.5, minLevel: -2, maxLevel: 4, eye: 1.6, highGroundAcc: 0.15, highGroundVision: 0.1,
  startForce: ['rifle', 'rifle', 'mg'],
};

export const MOVE = 1, SIGHT = 2, COVER = 4, TRENCH = 8, FORD = 16;
// T trench (heavy cover, diggable) · W river (impassable, see across) · F ford (wade at half speed)
// = bridge (walkable, can be blown) · R rubble (what's left of a house: walkable cover)
export const TERRAIN = { '.': 0, B: MOVE | SIGHT, H: SIGHT | COVER, '#': COVER, '+': COVER, T: COVER | TRENCH, W: MOVE, F: FORD, '=': 0, R: COVER };

// w = weapon. acc* = hit chance vs infantry / vehicles. supp = suppression added per shot.
// perModel: damage scales with living squad members. moveFire: accuracy multiplier while moving (absent = can't).
// setup: seconds stationary before it can fire. ab = the unit's one active ability (cd = cooldown seconds).
export const UNITS = {
  rifle: { name: 'Rifle Squad', cost: 100, models: 5, hpPer: 20, speed: 4.5, radius: 1.5, vision: 36, infantry: true,
    w: { range: 28, interval: 1.6, inf: 3, veh: 0.4, accInf: 0.7, accVeh: 0.7, supp: 4, perModel: true, moveFire: 0.5 },
    ab: { id: 'grenade', name: 'Grenade', cd: 30, range: 18, fuse: 1.2, radius: 4.5, inf: 40, veh: 15, supp: 50, terrain: 30 } },
  mg: { name: 'MG Team', cost: 150, models: 3, hpPer: 25, speed: 3.5, radius: 1.3, vision: 36, infantry: true,
    w: { range: 36, interval: 0.3, inf: 2.4, veh: 0.2, accInf: 0.5, accVeh: 0.5, supp: 8, setup: 2 },
    ab: { id: 'suppress', name: 'Suppressive Fire', cd: 40, dur: 10 } },
  at: { name: 'AT Gun', cost: 200, models: 4, hpPer: 20, speed: 2.5, radius: 1.8, vision: 34, infantry: true,
    w: { range: 45, interval: 4.5, inf: 8, veh: 120, accInf: 0.3, accVeh: 0.75, supp: 0, setup: 2 },
    ab: { id: 'ap', name: 'AP Round', cd: 45 } },
  tank: { name: 'Light Tank', cost: 300, models: 1, hpPer: 360, speed: 6.5, radius: 2.5, vision: 40, infantry: false, crushes: true,
    w: { range: 35, interval: 3, inf: 30, veh: 45, accInf: 0.6, accVeh: 0.7, supp: 25, moveFire: 1, shellTerrain: 90 },
    ab: { id: 'smoke', name: 'Smoke', cd: 45, dur: 14, radius: 9 } },
};
// Rocket launcher: no direct fire. Arcs an 8-rocket salvo onto anything its side can see (no line of sight needed),
// hits garrisons hard and wrecks buildings. Fragile, needs to stop to set up, slow to reload.
UNITS.rocket = { name: 'Rocket Launcher', cost: 250, models: 1, hpPer: 160, speed: 5, radius: 2.2, vision: 30, infantry: false,
  w: { range: 70, minRange: 18, interval: 20, setup: 2, inf: 25, veh: 30, accInf: 1, accVeh: 1, supp: 50,
    salvo: true, rockets: 8, spread: 6, blast: 3.5, terrain: 120, antiGarrison: 1.5, flight: 1.2, every: 0.15 },
  ab: { id: 'barrage', name: 'Rocket Barrage', cd: 45, range: 70 } };

// ---------- faction units (player faction: 0 USA, 1 Germany, 2 USSR) ----------
// USA Rangers: elite all-rounders with bazookas; satchel charge demolishes houses, walls and bridges.
UNITS.ranger = { name: 'Ranger Squad', faction: 0, cost: 185, models: 6, hpPer: 24, speed: 5, radius: 1.6, vision: 36, infantry: true, garrisons: true,
  w: { range: 26, interval: 1.4, inf: 3.6, veh: 3, accInf: 0.72, accVeh: 0.6, supp: 5, perModel: true, moveFire: 0.6 },
  ab: { id: 'satchel', name: 'Satchel Charge', cd: 40, range: 6, fuse: 4, radius: 5, inf: 60, veh: 180, supp: 60, terrain: 600 } };
// Germany Tiger: heavy tank, one at a time. Thick front armor: flank it.
UNITS.tiger = { name: 'Tiger', faction: 1, max: 1, cost: 620, models: 1, hpPer: 900, speed: 4, radius: 3, vision: 42, infantry: false, crushes: true, frontArmor: 0.7,
  w: { range: 42, interval: 4, inf: 40, veh: 110, accInf: 0.55, accVeh: 0.8, supp: 30, moveFire: 0.6, shellTerrain: 140 },
  ab: { id: 'smoke', name: 'Smoke', cd: 45, dur: 14, radius: 9 } };
// USSR Conscripts: cheap human waves. Ura! = sprint and shrug off suppression.
UNITS.conscript = { name: 'Conscripts', faction: 2, cost: 80, models: 7, hpPer: 14, speed: 4.6, radius: 1.8, vision: 34, infantry: true, garrisons: true,
  w: { range: 24, interval: 1.8, inf: 2.2, veh: 0.3, accInf: 0.55, accVeh: 0.5, supp: 3, perModel: true, moveFire: 0.5 },
  ab: { id: 'ura', name: 'Ura!', cd: 35, dur: 6, speed: 1.6 } };
UNITS.rifle.garrisons = UNITS.mg.garrisons = true;
export const UNIT_TYPES = Object.keys(UNITS);
export const canBuild = (type, faction) => UNITS[type].faction === undefined || UNITS[type].faction === faction;
// same team (a player is always allied with itself); -1 = nobody
export const allied = (g, a, b) => a >= 0 && b >= 0 && g.players[a].team === g.players[b].team;

// Off-map support bought with manpower. Every strike is announced to all players `delay` seconds ahead.
export const SUPPORT = {
  recon: { name: 'Recon Flight', cost: 60, cd: 45, delay: 3, dur: 15, len: 80, width: 30 },
  artillery: { name: 'Artillery Barrage', cost: 150, cd: 60, delay: 5, len: 24, width: 10, shells: 10, every: 0.4, blast: 4, inf: 30, veh: 35, supp: 60, terrain: 90 },
  strafe: { name: 'Strafing Run', cost: 200, cd: 90, delay: 5, len: 36, width: 8, inf: 25, veh: 10, supp: 80 },
  smoke: { name: 'Smoke Barrage', cost: 50, cd: 40, delay: 3, len: 36, width: 14, clouds: 5, cloud: 7, dur: 20 },
  // a stick of heavy bombs along the line: flattens houses, big craters, deadly to tanks
  bombing: { name: 'Bombing Run', cost: 250, cd: 120, delay: 6, len: 40, width: 8, shells: 6, every: 0.2, blast: 7, inf: 60, veh: 150, supp: 90, terrain: 400 },
};
export const SUPPORT_TYPES = Object.keys(SUPPORT);

// point in a len x width rectangle centered on s, long side along s.dir
export function inStrip(s, t, len, width) {
  const cx = Math.cos(s.dir), cz = Math.sin(s.dir), dx = t.x - s.x, dz = t.z - s.z;
  return Math.abs(dx * cx + dz * cz) <= len / 2 && Math.abs(-dx * cz + dz * cx) <= width / 2;
}
// position at (along, side) inside a strike's rectangle
const stripAt = (s, along, side) => ({ x: s.x + Math.cos(s.dir) * along - Math.sin(s.dir) * side, z: s.z + Math.sin(s.dir) * along + Math.cos(s.dir) * side });
const angle = (v) => (Number.isFinite(v) ? v : null);

export const alive = u => Math.ceil(u.hp / UNITS[u.type].hpPer);
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// Returns an error string, or null if the map is playable. Used by the server (trust boundary) and the editor.
export function validateMap(m) {
  const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
  const numIn = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
  if (!m || typeof m !== 'object') return 'not a map';
  if (typeof m.name !== 'string' || m.name.length > 40) return 'name must be a string up to 40 chars';
  if (!int(m.w, 20, 256) || !int(m.h, 20, 256)) return 'size must be 20-256 cells';
  if (!Array.isArray(m.rows) || m.rows.length !== m.h) return 'row count must equal height';
  for (const r of m.rows) if (typeof r !== 'string' || r.length !== m.w || [...r].some(ch => !Object.hasOwn(TERRAIN, ch))) return 'rows must be ' + m.w + ' valid terrain chars';
  if (m.heights !== undefined && (!Array.isArray(m.heights) || m.heights.length !== m.h
    || m.heights.some(r => typeof r !== 'string' || r.length !== m.w || !/^[0-4ab]*$/.test(r)))) return 'heights must be ' + m.h + ' rows of 0-4 (a/b for depths -1/-2)';
  const at = (p) => m.rows[p.y][p.x];
  if (!Array.isArray(m.spawns) || m.spawns.length < 2 || m.spawns.length > MAX_PLAYERS) return 'needs 2-' + MAX_PLAYERS + ' spawns';
  for (const sp of m.spawns) if (!sp || !int(sp.x, 0, m.w - 1) || !int(sp.y, 0, m.h - 1) || TERRAIN[at(sp)] & MOVE) return 'spawns must be on open ground inside the map';
  if (!Array.isArray(m.points) || m.points.length < 1 || m.points.length > 9) return 'needs 1-9 capture points';
  for (const p of m.points) if (!p || !int(p.x, 0, m.w - 1) || !int(p.y, 0, m.h - 1) || TERRAIN[at(p)] & MOVE || !numIn(p.vp ?? 1, 0, 5) || !numIn(p.mp ?? 1, 0, 5)) return 'points must be on open ground, vp and mp 0-5';
  return null;
}

export const MAX_PLAYERS = 6;

// Spawns are listed in order around the map. Teammates get neighbouring spawns, and fewer players than
// spawns spread out evenly (2 on a 6-spawn map sit opposite). shuffle rotates/mirrors it per match.
export function spawnSlots(nSpawns, teams, shuffle = true) {
  const order = teams.map((t, i) => i).sort((a, b) => teams[a] - teams[b]);
  const rot = shuffle ? Math.floor(Math.random() * nSpawns) : 0, dir = shuffle && Math.random() < 0.5 ? -1 : 1;
  const out = [];
  order.forEach((slot, k) => { out[slot] = ((rot + dir * Math.round(k * nSpawns / teams.length)) % nSpawns + nSpawns) % nSpawns; });
  return out;
}

// teams[i] / factions[i] per player; default is free-for-all with factions cycling USA, Germany, USSR
export function createGame(map, names, shuffle = true, teams = names.map((_, i) => i), factions = names.map((_, i) => i % 3)) {
  const spawnIdx = spawnSlots(map.spawns.length, teams, shuffle);
  const g = {
    w: map.w, h: map.h, flags: new Uint8Array(map.w * map.h),
    tick: 0, nextId: 1, units: new Map(), shots: [], nades: [], salvos: [], smokes: [], strikes: [], winner: null,
    // terrain changed mid-match: full log for (re)joining clients, plus what's new since the last snapshot
    cellLog: [], newCells: [],
    players: names.map((name, slot) => {
      const s = map.spawns[spawnIdx[slot]];
      return { slot, name, team: teams[slot], faction: factions[slot], vp: 0, mp: CFG.mpStart, inc: CFG.mpBase, sup: Object.fromEntries(SUPPORT_TYPES.map(k => [k, 0])), spawn: { x: (s.x + 0.5) * CELL, z: (s.y + 0.5) * CELL }, visible: new Set() };
    }),
    // vp/mp per second while held; the map can make some points worth more
    points: map.points.map(p => ({ x: (p.x + 0.5) * CELL, z: (p.y + 0.5) * CELL, vp: p.vp ?? 1, mp: p.mp ?? 1, owner: -1, capper: -1, progress: 0 })),
  };
  map.rows.forEach((row, y) => [...row].forEach((ch, x) => { g.flags[y * map.w + x] = TERRAIN[ch] ?? 0; }));
  g.chars = [...map.rows.join('')];
  g.cellHp = Float32Array.from(g.chars, ch => CFG.terrainHp[ch] ?? 0);
  g.height = Int8Array.from((map.heights || []).join(''), levelOf);
  if (g.height.length !== g.w * g.h) g.height = null; // flat map: skip all elevation math
  for (const p of g.players) CFG.startForce.forEach((t, i) => spawnUnit(g, p.slot, t, i));
  return g;
}

function spawnUnit(g, owner, type, n = g.units.size) {
  const s = g.players[owner].spawn, a = n * 2.4;
  const c = nearestFree(g, s.x + Math.cos(a) * 4, s.z + Math.sin(a) * 4);
  const u = { id: g.nextId++, type, owner, x: (c % g.w + 0.5) * CELL, z: (Math.floor(c / g.w) + 0.5) * CELL,
    rot: 0, aim: 0, hp: UNITS[type].models * UNITS[type].hpPer, supp: 0,
    path: [], attackId: 0, targetId: 0, cooldown: 0, still: 0, retarget: 0, repath: 0, stuck: 0,
    cd: 0, buff: 0, ap: false, nade: null, retreating: false, reinf: 0, dig: null,
    garrison: -1, enter: -1, amove: null, xp: 0, fireAt: -1, sprint: 0 };
  g.units.set(u.id, u);
  return u;
}

// ---------- grid ----------

const cellOf = (g, x, z) => {
  const cx = Math.floor(x / CELL), cy = Math.floor(z / CELL);
  return cx < 0 || cy < 0 || cx >= g.w || cy >= g.h ? -1 : cy * g.w + cx;
};
const flagsAt = (g, x, z) => { const c = cellOf(g, x, z); return c < 0 ? MOVE | SIGHT : g.flags[c]; };
export const inCover = (g, u) => UNITS[u.type].infantry && (flagsAt(g, u.x, u.z) & COVER) > 0;
export const inTrench = (g, u) => UNITS[u.type].infantry && (flagsAt(g, u.x, u.z) & TRENCH) > 0;
const coverMul = (g, t) => (t.garrison >= 0 ? CFG.garrisonMul : inTrench(g, t) ? CFG.trenchMul : inCover(g, t) ? CFG.coverMul : 1);
// Cover from something solid between you and the shooter, within ~2 m on their side:
// a house, wall, rubble, hedge, or a vehicle. Protects from the front, not the flank.
const SOLID = new Set(['B', '#', 'R', 'H']);
function behindCover(g, t, from) {
  const a = Math.atan2(from.z - t.z, from.x - t.x), ca = Math.cos(a), sa = Math.sin(a);
  for (const d of [1.2, 2.2]) { const c = cellOf(g, t.x + ca * d, t.z + sa * d); if (c >= 0 && SOLID.has(g.chars[c])) return true; }
  for (const v of g.units.values()) {
    if (v === t || UNITS[v.type].infantry || v.hp <= 0) continue;
    const dx = v.x - t.x, dz = v.z - t.z, d = Math.hypot(dx, dz);
    if (d > 0 && d < 4 && (dx * ca + dz * sa) / d > 0.7) return true;
  }
  return false;
}
// for the HUD: is there anything solid right next to this squad?
function nearCover(g, u) {
  const x = Math.floor(u.x / CELL), y = Math.floor(u.z / CELL);
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (SOLID.has(g.chars[(y + dy) * g.w + x + dx])) return true;
  return [...g.units.values()].some(v => v !== u && !UNITS[v.type].infantry && dist(u, v) < 3.5);
}
export const vet = (u) => CFG.vetXp.filter(k => u.xp >= k * UNITS[u.type].cost).length;
const cellCenter = (g, c) => ({ x: (c % g.w + 0.5) * CELL, z: (Math.floor(c / g.w) + 0.5) * CELL });

// leave a building onto the nearest open cell
function exitBuilding(g, u) {
  if (u.garrison < 0) return;
  const c = nearestFree(g, u.x, u.z), p = cellCenter(g, c);
  u.x = p.x; u.z = p.z; u.garrison = -1;
}
// a free house cell with open ground next to it (so the squad can see and shoot out), nearest to `from`
function entryCell(g, c0, from, taken) {
  const seen = new Set([c0]), q = [c0], edge = [];
  for (let i = 0; i < q.length; i++) {
    const c = q[i], x = c % g.w, y = Math.floor(c / g.w);
    let open = false;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, n = ny * g.w + nx;
      if (nx < 0 || ny < 0 || nx >= g.w || ny >= g.h) continue;
      if (g.chars[n] === 'B') { if (!seen.has(n)) { seen.add(n); q.push(n); } } else if (!(g.flags[n] & MOVE)) open = true;
    }
    if (open && !taken.has(c)) edge.push(c);
  }
  edge.sort((a, b) => dist(cellCenter(g, a), from) - dist(cellCenter(g, b), from));
  return edge[0] ?? -1;
}

function setCell(g, c, ch) {
  g.flags[c] = TERRAIN[ch]; g.chars[c] = ch; g.cellHp[c] = CFG.terrainHp[ch] ?? 0;
  g.cellLog.push([c, ch]); g.newCells.push([c, ch]);
}

// Grid ray walk (Amanatides-Woo). Skips the start cell; checks the end cell only if withEnd.
function clear(g, x0, z0, x1, z1, mask, withEnd) {
  let cx = Math.floor(x0 / CELL), cy = Math.floor(z0 / CELL);
  const ex = Math.floor(x1 / CELL), ey = Math.floor(z1 / CELL);
  const dx = x1 - x0, dz = z1 - z0, sx = Math.sign(dx), sy = Math.sign(dz);
  const tdx = dx ? CELL / Math.abs(dx) : Infinity, tdy = dz ? CELL / Math.abs(dz) : Infinity;
  let tx = dx ? (sx > 0 ? (cx + 1) * CELL - x0 : x0 - cx * CELL) / Math.abs(dx) : Infinity;
  let ty = dz ? (sy > 0 ? (cy + 1) * CELL - z0 : z0 - cy * CELL) / Math.abs(dz) : Infinity;
  for (let n = g.w + g.h; n > 0 && !(cx === ex && cy === ey); n--) {
    if (tx < ty) { tx += tdx; cx += sx; } else { ty += tdy; cy += sy; }
    const end = cx === ex && cy === ey;
    if (end && !withEnd) return true;
    if (cx < 0 || cy < 0 || cx >= g.w || cy >= g.h || g.flags[cy * g.w + cx] & mask) return false;
  }
  return true;
}
// does segment a-b pass through (or start/end inside) a circle?
function segHits(a, b, c, r) {
  const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((c.x - a.x) * dx + (c.z - a.z) * dz) / l2));
  return Math.hypot(a.x + dx * t - c.x, a.z + dz * t - c.z) < r;
}
// ---------- elevation ----------
// map files store a level per cell as one char: '0'-'4' up, 'a' = -1 and 'b' = -2 for depressions
export const levelOf = (ch) => (ch >= 'a' ? 96 - ch.charCodeAt(0) : +ch);
export const levelChar = (n) => (n < 0 ? String.fromCharCode(96 - n) : String(n));
const level = (g, c) => (g.height && c >= 0 ? g.height[c] : 0);
export const levelAt = (g, x, z) => level(g, cellOf(g, x, z));
// hills block sight: sample the line between two eyes and compare with the ground under it
function overHills(g, a, b) {
  if (!g.height) return true;
  const L = CFG.levelHeight, ya = levelAt(g, a.x, a.z) * L + CFG.eye, yb = levelAt(g, b.x, b.z) * L + CFG.eye;
  const d = Math.hypot(b.x - a.x, b.z - a.z), n = Math.ceil(d / (CELL / 2));
  for (let i = 1; i < n; i++) {
    const t = i / n;
    if (levelAt(g, a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t) * L > ya + (yb - ya) * t) return false;
  }
  return true;
}
// no step of more than one level along a straight segment
function noCliffs(g, a, b) {
  if (!g.height) return true;
  const d = Math.hypot(b.x - a.x, b.z - a.z), n = Math.ceil(d / (CELL / 2));
  let prev = levelAt(g, a.x, a.z);
  for (let i = 1; i <= n; i++) {
    const h = levelAt(g, a.x + (b.x - a.x) * i / n, a.z + (b.z - a.z) * i / n);
    if (Math.abs(h - prev) > 1) return false;
    prev = h;
  }
  return true;
}

export const los = (g, a, b) => clear(g, a.x, a.z, b.x, b.z, SIGHT, false) && !g.smokes.some(s => segHits(a, b, s, s.r)) && overHills(g, a, b);

function walkable(g, a, b) {
  // three parallel rays so wide units don't clip building corners
  const d = Math.hypot(b.x - a.x, b.z - a.z) || 1, ox = -(b.z - a.z) / d * 0.9, oz = (b.x - a.x) / d * 0.9;
  return [-1, 0, 1].every(k => clear(g, a.x + ox * k, a.z + oz * k, b.x + ox * k, b.z + oz * k, MOVE, true)) && noCliffs(g, a, b);
}

function nearestFree(g, x, z) {
  const cx = Math.min(g.w - 1, Math.max(0, Math.floor(x / CELL))), cy = Math.min(g.h - 1, Math.max(0, Math.floor(z / CELL)));
  const start = cy * g.w + cx, seen = new Uint8Array(g.w * g.h), q = [start];
  seen[start] = 1;
  for (let i = 0; i < q.length; i++) {
    const c = q[i];
    if (!(g.flags[c] & MOVE)) return c;
    const x0 = c % g.w, y0 = Math.floor(c / g.w);
    for (const [ddx, ddy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x0 + ddx, ny = y0 + ddy, n = ny * g.w + nx;
      if (nx >= 0 && ny >= 0 && nx < g.w && ny < g.h && !seen[n]) { seen[n] = 1; q.push(n); }
    }
  }
  return start;
}

// A* over the grid, 8-directional, no corner cutting. Returns smoothed world waypoints.
export function findPath(g, from, to) {
  const W = g.w, N = W * g.h, goal = nearestFree(g, to.x, to.z), start = Math.max(0, cellOf(g, from.x, from.z));
  const gs = new Float32Array(N).fill(Infinity), came = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
  const gx = goal % W, gy = Math.floor(goal / W);
  const hq = (c) => { const dx = Math.abs(c % W - gx), dy = Math.abs(Math.floor(c / W) - gy); return Math.max(dx, dy) + 0.414 * Math.min(dx, dy); };
  const heap = [[hq(start), start]];
  const push = (e) => { heap.push(e); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= e[0]) break; heap[i] = heap[p]; i = p; } heap[i] = e; };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[i], heap[m]] = [heap[m], heap[i]]; i = m;
      }
    }
    return top;
  };
  gs[start] = 0;
  while (heap.length) {
    const [, c] = pop();
    if (c === goal) break;
    if (closed[c]) continue;
    closed[c] = 1;
    const x = c % W, y = Math.floor(c / W);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= g.h) continue;
      const n = ny * W + nx;
      if (g.flags[n] & MOVE || closed[n]) continue;
      if (dx && dy && (g.flags[y * W + nx] & MOVE || g.flags[ny * W + x] & MOVE)) continue;
      const climb = level(g, n) - level(g, c);
      if (Math.abs(climb) > 1) continue; // cliff
      if (dx && dy && (Math.abs(level(g, y * W + nx) - level(g, c)) > 1 || Math.abs(level(g, ny * W + x) - level(g, c)) > 1)) continue;
      const cost = gs[c] + (dx && dy ? 1.414 : 1) + Math.max(0, climb) * 0.5; // uphill costs a bit more
      if (cost < gs[n]) { gs[n] = cost; came[n] = c; push([cost + hq(n), n]); }
    }
  }
  if (goal !== start && came[goal] < 0) return [];
  const pts = [];
  for (let c = goal; c !== start && c >= 0; c = came[c]) pts.unshift({ x: (c % W + 0.5) * CELL, z: (Math.floor(c / W) + 0.5) * CELL });
  if (goal === cellOf(g, to.x, to.z) && pts.length) pts[pts.length - 1] = { x: to.x, z: to.z };
  // string-pull: jump to the furthest waypoint reachable in a straight line
  const out = [];
  let at = from;
  for (let i = 0; i < pts.length;) {
    let j = pts.length - 1;
    while (j > i && !walkable(g, at, pts[j])) j--;
    out.push(pts[j]); at = pts[j]; i = j + 1;
  }
  return out;
}

// ---------- commands (trust boundary: everything from clients is validated here) ----------

const num = (v, max) => (Number.isFinite(v) ? Math.min(max, Math.max(0, v)) : null);

export function command(g, slot, cmd) {
  if (g.winner !== null || !cmd || typeof cmd !== 'object') return;
  const mine = (id) => { const u = g.units.get(id); return u && u.owner === slot ? u : null; };
  const ids = Array.isArray(cmd.ids) ? cmd.ids.slice(0, 50) : [];
  if ((cmd.t === 'move' || cmd.t === 'amove') && Array.isArray(cmd.orders)) {
    for (const o of cmd.orders.slice(0, 50)) {
      const u = Array.isArray(o) && mine(o[0]), x = num(o?.[1], g.w * CELL), z = num(o?.[2], g.h * CELL);
      if (!u || x === null || z === null) continue;
      exitBuilding(g, u);
      Object.assign(u, { attackId: 0, targetId: 0, stuck: 0, retreating: false, nade: null, dig: null, enter: -1, fireAt: -1, amove: cmd.t === 'amove' ? { x, z } : null });
      u.path = findPath(g, u, { x, z });
    }
  } else if (cmd.t === 'fireat') {
    const c = cellOf(g, num(cmd.x, g.w * CELL) ?? -1, num(cmd.z, g.h * CELL) ?? -1);
    if (c < 0 || !(g.cellHp[c] > 0)) return;
    for (const id of ids) { const u = mine(id); if (u && (UNITS[u.type].w.shellTerrain || UNITS[u.type].w.salvo)) Object.assign(u, { fireAt: c, attackId: 0, amove: null, retreating: false, repath: 0, path: [] }); }
  } else if (cmd.t === 'garrison') {
    const c0 = cellOf(g, num(cmd.x, g.w * CELL) ?? -1, num(cmd.z, g.h * CELL) ?? -1);
    if (c0 < 0 || g.chars[c0] !== 'B') return;
    const taken = new Set([...g.units.values()].flatMap(u => [u.garrison, u.enter]).filter(c => c >= 0));
    for (const id of ids) {
      const u = mine(id);
      if (!u || !UNITS[u.type].garrisons || u.retreating) continue;
      const c = entryCell(g, c0, u, taken);
      if (c < 0) break; // house is full
      exitBuilding(g, u);
      taken.add(c);
      Object.assign(u, { enter: c, attackId: 0, nade: null, dig: null, amove: null, repath: 0, path: findPath(g, u, cellCenter(g, c)) });
    }
  } else if (cmd.t === 'attack') {
    const t = g.units.get(cmd.target);
    if (!t || allied(g, t.owner, slot) || !g.players[slot].visible.has(t.id)) return;
    for (const id of ids) { const u = mine(id); if (u) { if (!canShoot(g, u, t)) exitBuilding(g, u); Object.assign(u, { attackId: t.id, repath: 0, retreating: false, nade: null, dig: null, enter: -1, amove: null, fireAt: -1 }); } }
  } else if (cmd.t === 'stop') {
    for (const id of ids) { const u = mine(id); if (u) Object.assign(u, { path: [], attackId: 0, retreating: false, nade: null, dig: null, enter: -1, amove: null, fireAt: -1 }); }
  } else if (cmd.t === 'retreat') {
    for (const id of ids) {
      const u = mine(id); if (!u) continue;
      exitBuilding(g, u);
      Object.assign(u, { retreating: true, attackId: 0, targetId: 0, nade: null, dig: null, stuck: 0, enter: -1, amove: null, fireAt: -1 });
      u.path = findPath(g, u, g.players[slot].spawn);
    }
  } else if (cmd.t === 'ability') {
    const x = num(cmd.x, g.w * CELL), z = num(cmd.z, g.h * CELL);
    for (const id of ids) {
      const u = mine(id), ab = u && UNITS[u.type].ab;
      if (!u || u.cd > 0 || u.retreating) continue;
      if (ab.id === 'grenade' || ab.id === 'barrage' || ab.id === 'satchel') { if (x === null || z === null) continue; exitBuilding(g, u); Object.assign(u, { nade: { x, z }, attackId: 0, repath: 0, fireAt: -1 }); }
      else if (ab.id === 'suppress') { u.buff = ab.dur; u.cd = ab.cd; }
      else if (ab.id === 'ura') { u.sprint = ab.dur; u.supp = 0; u.cd = ab.cd; }
      else if (ab.id === 'ap') { u.ap = true; u.cd = ab.cd; }
      else if (ab.id === 'smoke') { g.smokes.push({ x: u.x, z: u.z, r: ab.radius, t: ab.dur }); u.cd = ab.cd; }
    }
  } else if (cmd.t === 'dig') {
    // one rifle squad digs a short trench across its line of approach
    const u = mine(ids[0]), x = num(cmd.x, g.w * CELL), z = num(cmd.z, g.h * CELL), p = g.players[slot];
    if (!u || u.type !== 'rifle' || u.retreating || x === null || z === null || p.mp < CFG.digCost) return;
    const a = angle(cmd.dir) ?? Math.atan2(z - u.z, x - u.x) + Math.PI / 2, px = Math.cos(a), pz = Math.sin(a), cells = [];
    for (let i = 0; i < CFG.digCells; i++) {
      const o = (i - (CFG.digCells - 1) / 2) * CELL, c = cellOf(g, x + px * o, z + pz * o);
      if (c >= 0 && !(g.flags[c] & (MOVE | TRENCH)) && !cells.includes(c)) cells.push(c);
    }
    if (!cells.length) return;
    p.mp -= CFG.digCost;
    Object.assign(u, { dig: { x, z, cells, t: 0 }, attackId: 0, nade: null, repath: 0 });
  } else if (cmd.t === 'support' && Object.hasOwn(SUPPORT, cmd.kind)) {
    const p = g.players[slot], sp = SUPPORT[cmd.kind], x = num(cmd.x, g.w * CELL), z = num(cmd.z, g.h * CELL);
    if (x === null || z === null || p.sup[cmd.kind] > 0 || p.mp < sp.cost) return;
    p.mp -= sp.cost; p.sup[cmd.kind] = sp.cd;
    const dir = angle(cmd.dir) ?? Math.atan2(z - p.spawn.z, x - p.spawn.x);
    g.strikes.push({ kind: cmd.kind, owner: slot, x, z, dir, t: sp.delay, left: sp.shells ?? sp.dur ?? 0, next: 0, live: false });
  } else if (cmd.t === 'buy' && Object.hasOwn(UNITS, cmd.unit) && canBuild(cmd.unit, g.players[slot].faction)) {
    const p = g.players[slot], def = UNITS[cmd.unit];
    const pop = [...g.units.values()].filter(u => u.owner === slot).length;
    const have = [...g.units.values()].filter(u => u.owner === slot && u.type === cmd.unit).length;
    if (p.mp >= def.cost && pop < CFG.popCap && have < (def.max ?? Infinity)) { p.mp -= def.cost; spawnUnit(g, slot, cmd.unit); }
  }
}

// ---------- simulation ----------

const suppMul = (u) => (u.supp >= 90 ? { speed: 0.3, rate: 3, acc: 0.5 } : u.supp >= 50 ? { speed: 0.6, rate: 1.5, acc: 0.7 } : { speed: 1, rate: 1, acc: 1 });

function canShoot(g, u, t) {
  const w = UNITS[u.type].w;
  if (!t || t.hp <= 0 || allied(g, t.owner, u.owner) || dist(u, t) > w.range || !g.players[u.owner].visible.has(t.id)) return false;
  return w.salvo ? dist(u, t) >= w.minRange : los(g, u, t); // salvos arc over: spotting is enough
}

function pickTarget(g, u) {
  const w = UNITS[u.type].w;
  let best = 0, bestScore = Infinity;
  for (const t of g.units.values()) {
    if (!canShoot(g, u, t)) continue;
    const inf = UNITS[t.type].infantry;
    // salvos go for garrisons first, then for whatever has the most enemies around it
    const value = w.salvo ? (t.garrison >= 0 ? 3 : 1) * (1 + [...g.units.values()].filter(o => o.owner === t.owner && dist(o, t) < 6).length) : inf ? w.inf * w.accInf : w.veh * w.accVeh;
    const score = dist(u, t) / value;
    if (score < bestScore) { bestScore = score; best = t.id; }
  }
  return best;
}

function launchSalvo(g, u, at) {
  const w = UNITS[u.type].w;
  g.salvos.push({ x: at.x, z: at.z, owner: u.owner, left: w.rockets, next: w.flight, w });
  g.shots.push({ f: u.id, fo: u.owner, x: at.x, z: at.z, k: 'salvo', pub: true });
}

function fire(g, u, t, moving) {
  if (UNITS[u.type].w.salvo) { launchSalvo(g, u, t); u.cooldown = UNITS[u.type].w.interval; return; }
  const w = UNITS[u.type].w, def = UNITS[t.type], inf = def.infantry, sm = suppMul(u);
  const cover = Math.min(coverMul(g, t), inf && behindCover(g, t, u) ? CFG.coverMul : 1);
  // shooting downhill is easier, uphill harder
  const hg = Math.min(1.45, Math.max(0.7, 1 + CFG.highGroundAcc * (levelAt(g, u.x, u.z) - levelAt(g, t.x, t.z))));
  let acc = (inf ? w.accInf : w.accVeh) * sm.acc * (moving ? w.moveFire : 1) * cover * hg * (1 + CFG.vetAcc * vet(u));
  let dmg = inf ? w.inf : w.veh, supp = w.supp, rate = sm.rate;
  if (u.buff > 0) { dmg *= 0.5; supp *= 2.5; rate *= 0.5; } // suppressive fire: faster, pins harder, kills less
  if (u.ap && !inf) { acc = 1; dmg *= 1.5; u.ap = false; }
  if (t.retreating) dmg *= CFG.retreatDamage;
  dmg *= 1 - CFG.vetArmor * vet(t); supp *= 1 - CFG.vetSupp * vet(t);
  if (!inf) {
    // rear armor: shot coming from behind the hull does double damage
    const a = Math.atan2(u.z - t.z, u.x - t.x) - t.rot;
    if (Math.cos(a) < -0.5) dmg *= 2;
    else if (def.frontArmor && Math.cos(a) > 0.5) dmg *= def.frontArmor; // Tiger: the front shrugs it off
  }
  const shots = w.perModel ? alive(u) : 1;
  let hits = 0;
  for (let i = 0; i < shots; i++) if (Math.random() < acc) hits++;
  const before = t.hp;
  t.hp -= dmg * hits;
  u.xp += Math.min(before, dmg * hits) + (t.hp <= 0 && before > 0 ? UNITS[t.type].cost * 0.2 : 0);
  if (inf && !t.retreating && !(t.sprint > 0)) t.supp = Math.min(100, t.supp + supp * cover * (w.perModel ? shots / UNITS[u.type].models : 1));
  u.cooldown = w.interval * rate;
  g.shots.push({ f: u.id, t: t.id, fo: u.owner, to: t.owner, x: t.x, z: t.z, hit: hits > 0, kill: t.hp <= 0, k: u.type });
  if (w.shellTerrain) {
    // a miss still lands somewhere near the target; either way it hits whatever structure is there
    const a = Math.random() * Math.PI * 2, off = hits ? 0 : 1 + Math.random() * 3;
    damageCells(g, [...g.units.values()], { x: t.x + Math.cos(a) * off, z: t.z + Math.sin(a) * off }, 1.5, w.shellTerrain);
  }
}

function updateVision(g) {
  // shared vision: the whole team sees what any member sees (computed once per team)
  const byTeam = new Map();
  for (const p of g.players) {
    if (byTeam.has(p.team)) { p.visible = byTeam.get(p.team); continue; }
    const vis = new Set(), own = [...g.units.values()].filter(u => g.players[u.owner].team === p.team);
    for (const t of g.units.values()) {
      if (g.players[t.owner].team === p.team) continue;
      if (own.some(u => { const d = dist(u, t); return d < 6 || (d <= UNITS[u.type].vision * (1 + CFG.highGroundVision * levelAt(g, u.x, u.z)) * (u.garrison >= 0 ? CFG.garrisonVision : 1) && los(g, u, t)); })
        || g.strikes.some(s => s.live && s.kind === 'recon' && g.players[s.owner].team === p.team && inStrip(s, t, SUPPORT.recon.len, SUPPORT.recon.width))) vis.add(t.id);
    }
    byTeam.set(p.team, p.visible = vis);
  }
}

function hurt(g, t, src, fall, owner) {
  const inf = UNITS[t.type].infantry;
  t.hp -= (inf ? src.inf : src.veh) * fall * (t.retreating ? CFG.retreatDamage : 1) * (t.garrison >= 0 ? src.antiGarrison ?? CFG.trenchBlastMul : inTrench(g, t) ? CFG.trenchBlastMul : 1) * (1 - CFG.vetArmor * vet(t));
  if (inf) t.supp = Math.min(100, t.supp + src.supp * (1 - CFG.vetSupp * vet(t)));
  g.shots.push({ t: t.id, fo: owner, to: t.owner, x: t.x, z: t.z, k: 'hurt', kill: t.hp <= 0 });
}
function blast(g, list, at, radius, src, owner) {
  for (const t of list) {
    const d = dist(t, at);
    if (d <= radius && t.hp > 0) hurt(g, t, src, 1 - d / radius * 0.5, owner);
  }
  if (src.terrain) damageCells(g, list, at, radius, src.terrain);
}
// explosions chew through structures; a wrecked cell changes type (house -> rubble, bridge -> river)
function damageCells(g, list, at, radius, dmg) {
  const r = Math.ceil(radius / CELL);
  for (let y = Math.floor(at.z / CELL) - r; y <= Math.floor(at.z / CELL) + r; y++) for (let x = Math.floor(at.x / CELL) - r; x <= Math.floor(at.x / CELL) + r; x++) {
    if (x < 0 || y < 0 || x >= g.w || y >= g.h) continue;
    const c = y * g.w + x, d = Math.hypot((x + 0.5) * CELL - at.x, (y + 0.5) * CELL - at.z);
    if (d > radius + CELL / 2 || !(g.cellHp[c] > 0)) continue;
    if ((g.cellHp[c] -= dmg * (1 - Math.min(1, d / (radius + CELL)) * 0.5)) <= 0) wreckCell(g, list, c);
  }
}
function wreckCell(g, list, c, into = CFG.wreck[g.chars[c]]) {
  const x = (c % g.w + 0.5) * CELL, z = (Math.floor(c / g.w) + 0.5) * CELL, was = g.chars[c];
  setCell(g, c, into);
  // a bridge fails as a structure: the whole connected span goes into the river
  if (was === '=') for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = c % g.w + dx, ny = Math.floor(c / g.w) + dy;
    if (nx >= 0 && ny >= 0 && nx < g.w && ny < g.h && g.chars[ny * g.w + nx] === '=') wreckCell(g, list, ny * g.w + nx, into);
  }
  g.shots.push({ k: 'collapse', x, z, pub: true });
  for (const u of g.units.values()) if (u.garrison === c) {
    u.garrison = -1; u.hp -= UNITS[u.type].models * UNITS[u.type].hpPer * CFG.garrisonEvictDamage;
    g.shots.push({ t: u.id, to: u.owner, x: u.x, z: u.z, k: 'hurt', kill: u.hp <= 0 });
  }
  // anyone on a bridge that drops into the river goes with it
  if (TERRAIN[into] & MOVE) for (const u of list) if (u.hp > 0 && cellOf(g, u.x, u.z) === c) { u.hp = 0; g.shots.push({ t: u.id, to: u.owner, x: u.x, z: u.z, k: 'hurt', kill: true }); }
}

export function step(g) {
  if (g.winner !== null) return;
  const dt = TICK;
  g.tick++;
  if (g.tick % 4 === 1) updateVision(g);

  for (const u of g.units.values()) {
    const def = UNITS[u.type], w = def.w, sm = suppMul(u);
    if (def.infantry) u.supp = Math.max(0, u.supp - 8 * dt);
    u.cooldown -= dt; u.retarget -= dt; u.repath -= dt; u.cd -= dt; u.buff -= dt; u.sprint -= dt;

    // digging: walk to the spot, then turn one cell into trench every digTime seconds
    if (u.dig) {
      if (dist(u, u.dig) > 3) { if (u.repath <= 0 && !u.path.length) { u.path = findPath(g, u, u.dig); u.repath = 1; } }
      else if ((u.dig.t += dt) >= CFG.digTime) {
        u.dig.t = 0;
        const c = u.dig.cells.shift();
        if (!(g.flags[c] & (MOVE | TRENCH))) setCell(g, c, 'T');
        if (!u.dig.cells.length) u.dig = null;
      }
    }

    // grenade order: walk into range, then throw
    if (u.nade) {
      const ab = def.ab;
      if (ab.id === 'barrage' && dist(u, u.nade) <= ab.range) {
        launchSalvo(g, u, u.nade); u.cooldown = w.interval; u.cd = ab.cd; u.nade = null; u.path = [];
      } else if ((ab.id === 'grenade' || ab.id === 'satchel') && dist(u, u.nade) <= ab.range) {
        g.nades.push({ x: u.nade.x, z: u.nade.z, t: ab.fuse, owner: u.owner, ab });
        g.shots.push({ f: u.id, fo: u.owner, x: u.nade.x, z: u.nade.z, k: 'throw', pub: true });
        u.nade = null; u.path = []; u.cd = ab.cd;
      } else if (u.repath <= 0) { u.path = findPath(g, u, u.nade); u.repath = 1; }
    }

    // heading into a building: walk up to it, then step inside
    if (u.enter >= 0) {
      const at = cellCenter(g, u.enter);
      if (g.chars[u.enter] !== 'B') u.enter = -1;
      else if (dist(u, at) <= CELL * 1.6) { Object.assign(u, { garrison: u.enter, enter: -1, x: at.x, z: at.z, path: [] }); }
      else if (!u.path.length && u.repath <= 0) { u.path = findPath(g, u, at); u.repath = 1; }
    }

    // attack-move: halt while something is in range, carry on when it's clear
    if (u.amove) {
      const t = g.units.get(u.targetId);
      if (dist(u, u.amove) < 2.5) u.amove = null;
      else if (t && canShoot(g, u, t)) u.path = [];
      else if (!u.path.length && u.repath <= 0) { u.path = findPath(g, u, u.amove); u.repath = 1; }
    }

    // shelling a structure: close to range with a clear line, then fire at it
    if (u.fireAt >= 0) {
      const at = cellCenter(g, u.fireAt);
      if (!(g.cellHp[u.fireAt] > 0)) u.fireAt = -1;
      else if (dist(u, at) <= w.range && (w.salvo || los(g, u, at))) u.path = [];
      else if (!u.path.length && u.repath <= 0) { u.path = findPath(g, u, at); u.repath = 1; }
    }

    // explicit attack order: chase until we can shoot
    if (u.attackId) {
      const t = g.units.get(u.attackId);
      if (!t || !g.players[u.owner].visible.has(t.id)) u.attackId = 0;
      else if (canShoot(g, u, t)) { u.path = []; u.targetId = t.id; }
      else if (u.repath <= 0) { u.path = findPath(g, u, t); u.repath = 1; }
    }

    // movement
    const before = { x: u.x, z: u.z };
    const speed = def.speed * (u.retreating ? CFG.retreatSpeed : u.sprint > 0 ? def.ab.speed : sm.speed) * (flagsAt(g, u.x, u.z) & FORD ? CFG.fordSpeed : 1);
    let budget = speed * dt;
    while (budget > 0 && u.path.length) {
      const wp = u.path[0], d = dist(u, wp);
      u.rot = Math.atan2(wp.z - u.z, wp.x - u.x);
      if (d <= budget) { u.x = wp.x; u.z = wp.z; u.path.shift(); budget -= d; }
      else { u.x += (wp.x - u.x) / d * budget; u.z += (wp.z - u.z) / d * budget; budget = 0; }
    }
    const moved = dist(u, before), moving = u.path.length > 0 || moved > 0.001;
    if (def.crushes && moved > 0) { const c = cellOf(g, u.x, u.z); if (c >= 0 && CFG.crush[g.chars[c]]) wreckCell(g, [], c, CFG.crush[g.chars[c]]); }
    u.still = moving ? 0 : u.still + dt;
    // give up if blocked by friends crowding the destination
    if (u.retreating && !u.path.length) u.retreating = false;
    if (u.path.length && moved < speed * dt * 0.3) { u.stuck += dt; if (u.stuck > 1) { u.path = []; u.stuck = 0; if (u.amove) u.amove = null; } } else u.stuck = 0;

    // targeting + firing
    if (u.retreating) { u.targetId = 0; u.aim = u.rot; continue; }
    if (u.fireAt >= 0) {
      const at = cellCenter(g, u.fireAt);
      u.aim = Math.atan2(at.z - u.z, at.x - u.x); u.targetId = 0;
      if (!u.path.length && dist(u, at) <= w.range && u.cooldown <= 0 && w.salvo && u.still >= w.setup) { launchSalvo(g, u, at); u.cooldown = w.interval; }
      else if (!u.path.length && dist(u, at) <= w.range && u.cooldown <= 0 && !w.salvo && los(g, u, at)) {
        u.cooldown = w.interval * sm.rate;
        g.shots.push({ f: u.id, fo: u.owner, x: at.x, z: at.z, hit: true, k: u.type, pub: true });
        damageCells(g, [...g.units.values()], at, 1.5, w.shellTerrain);
      }
      continue;
    }
    if (!u.attackId && (u.retarget <= 0 || !canShoot(g, u, g.units.get(u.targetId)))) { u.targetId = pickTarget(g, u); u.retarget = 0.5; }
    const t = g.units.get(u.targetId);
    if (t && canShoot(g, u, t)) {
      u.aim = Math.atan2(t.z - u.z, t.x - u.x);
      if (def.infantry && !moving) u.rot = u.aim;
      const ready = moving ? w.moveFire !== undefined : u.still >= (w.setup ?? 0);
      if (ready && u.cooldown <= 0) fire(g, u, t, moving);
    } else { u.targetId = 0; u.aim = u.rot; }
  }

  // soft separation; never push a unit into a blocked cell
  const list = [...g.units.values()];
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], b = list[j], min = (UNITS[a.type].radius + UNITS[b.type].radius) * 0.8;
    if (a.garrison >= 0 || b.garrison >= 0) continue;
    const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
    if (d >= min || d === 0) continue;
    const push = (min - d) / 2 * 0.5, px = dx / d * push, pz = dz / d * push;
    if (!(flagsAt(g, a.x - px, a.z - pz) & MOVE) && Math.abs(levelAt(g, a.x - px, a.z - pz) - levelAt(g, a.x, a.z)) <= 1) { a.x -= px; a.z -= pz; }
    if (!(flagsAt(g, b.x + px, b.z + pz) & MOVE) && Math.abs(levelAt(g, b.x + px, b.z + pz) - levelAt(g, b.x, b.z)) <= 1) { b.x += px; b.z += pz; }
  }

  // grenades: hurt everyone in the blast (friendly fire included), cover doesn't help
  for (const n of g.nades) {
    if ((n.t -= dt) > 0) continue;
    g.shots.push({ x: n.x, z: n.z, k: 'boom', pub: true });
    blast(g, list, n, n.ab.radius, n.ab, n.owner);
  }
  g.nades = g.nades.filter(n => n.t > 0);
  for (const s of g.salvos) {
    if ((s.next -= dt) > 0) continue;
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * s.w.spread, at = { x: s.x + Math.cos(a) * r, z: s.z + Math.sin(a) * r };
    g.shots.push({ x: at.x, z: at.z, k: 'rocket', pub: true });
    blast(g, list, at, s.w.blast, s.w, s.owner);
    s.left--; s.next = s.w.every;
  }
  g.salvos = g.salvos.filter(s => s.left > 0);

  // off-map support
  for (const s of g.strikes) {
    const sp = SUPPORT[s.kind];
    if ((s.t -= dt) > 0) continue;
    if (!s.live) { s.live = true; if (s.kind === 'strafe' || s.kind === 'recon' || s.kind === 'bombing') g.shots.push({ k: s.kind, x: s.x, z: s.z, dir: s.dir, fo: s.owner, pub: true }); }
    if (s.kind === 'recon') s.left -= dt;
    else if (s.kind === 'smoke') {
      for (let i = 0; i < sp.clouds; i++) {
        // a wall of clouds along the line
        const at = stripAt(s, (i / (sp.clouds - 1) - 0.5) * (sp.len - sp.cloud), (Math.random() - 0.5) * 2);
        g.smokes.push({ x: at.x, z: at.z, r: sp.cloud, t: sp.dur });
      }
      g.shots.push({ k: 'smokeshells', x: s.x, z: s.z, pub: true });
      s.left = 0;
    }
    else if (s.kind === 'bombing' && (s.next -= dt) <= 0) {
      const i = sp.shells - s.left, at = stripAt(s, (i / (sp.shells - 1) - 0.5) * sp.len, (Math.random() - 0.5) * 3);
      g.shots.push({ x: at.x, z: at.z, k: 'bomb', pub: true });
      blast(g, list, at, sp.blast, sp, s.owner);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const c = cellOf(g, at.x + dx * CELL, at.z + dy * CELL);
        if (c >= 0 && g.chars[c] === '.') setCell(g, c, '+');
      }
      s.left--; s.next = sp.every;
    }
    else if (s.kind === 'artillery' && (s.next -= dt) <= 0) {
      const at = stripAt(s, (Math.random() - 0.5) * sp.len, (Math.random() - 0.5) * sp.width);
      g.shots.push({ x: at.x, z: at.z, k: 'shell', pub: true });
      blast(g, list, at, sp.blast, sp, s.owner);
      const hole = cellOf(g, at.x, at.z);
      if (hole >= 0 && g.chars[hole] === '.') setCell(g, hole, '+'); // shell holes are cover from now on
      s.left--; s.next = sp.every;
    } else if (s.kind === 'strafe') {
      // everything within `width` of the run's line gets raked
      for (const t of list) {
        if (inStrip(s, t, sp.len, sp.width) && t.hp > 0) hurt(g, t, sp, 1, s.owner);
      }
      s.left = 0;
    }
  }
  g.strikes = g.strikes.filter(s => !s.live || s.left > 0);
  for (const p of g.players) for (const k of SUPPORT_TYPES) p.sup[k] -= dt;
  for (const s of g.smokes) s.t -= dt;
  g.smokes = g.smokes.filter(s => s.t > 0);

  // reinforce / repair near your own spawn, paid in manpower
  for (const u of list) {
    const def = UNITS[u.type], p = g.players[u.owner], full = def.models * def.hpPer;
    if (u.hp <= 0 || u.hp >= full || dist(u, p.spawn) > CFG.reinforceRadius) { u.reinf = 0; continue; }
    if (def.infantry) {
      const cost = def.cost / def.models * 0.5;
      if ((u.reinf += dt) >= CFG.reinforceEvery && p.mp >= cost) { u.reinf = 0; p.mp -= cost; u.hp = Math.min(full, (alive(u) + 1) * def.hpPer); }
    } else {
      const hp = Math.min(full - u.hp, 18 * dt), cost = hp * 0.5;
      if (p.mp >= cost) { u.hp += hp; p.mp -= cost; u.reinf = 1; }
    }
  }

  for (const u of list) if (u.hp <= 0) g.units.delete(u.id);

  // capture points: infantry only, uncontested by another team. A point belongs to the player who took it;
  // teammates standing on it keep it theirs.
  for (const p of g.points) {
    const on = list.filter(u => u.hp > 0 && !u.retreating && UNITS[u.type].infantry && dist(u, p) <= CFG.pointRadius);
    if (!on.length || on.some(u => !allied(g, u.owner, on[0].owner))) continue;
    const s = on[0].owner, rate = dt / CFG.captureTime;
    if (allied(g, p.owner, s)) p.progress = 1;
    else if (p.owner >= 0) { p.progress -= rate; if (p.progress <= 0) { p.owner = -1; p.progress = 0; p.capper = s; } }
    else {
      if (!allied(g, p.capper, s)) { p.capper = s; p.progress = 0; }
      p.progress += rate;
      if (p.progress >= 1) { p.owner = s; p.progress = 1; }
    }
  }

  // victory points count per team: whichever team's players together reach vpToWin wins
  const teamVp = (t) => g.players.reduce((a, q) => a + (q.team === t ? q.vp : 0), 0);
  const lead = Math.max(...g.players.map(q => teamVp(q.team)));
  for (const pl of g.players) {
    const held = g.points.filter(p => p.owner === pl.slot);
    // away = disconnected (set by the server): their clock stops so a dropout doesn't decide the match
    pl.vp += held.reduce((a, p) => a + p.vp, 0) * dt * (pl.away ? 0 : 1);
    pl.inc = pl.away ? 0 : CFG.mpBase + held.reduce((a, p) => a + p.mp, 0) + Math.min(CFG.catchupMax, (lead - teamVp(pl.team)) / CFG.catchupPer);
    pl.mp += pl.inc * dt;
  }
  for (const pl of g.players) if (teamVp(pl.team) >= CFG.vpToWin && g.winner === null) g.winner = pl.team; // winner = team id
}

// What one player is allowed to know: own units + enemies they can see. Fog is enforced here.
export function snapshotFor(g, slot, shots, cells = []) {
  const p = g.players[slot], r = (v) => Math.round(v * 10) / 10;
  const seen = (id) => allied(g, g.units.get(id)?.owner ?? -1, slot) || p.visible.has(id);
  return {
    t: 's', tick: g.tick, winner: g.winner, mp: Math.floor(p.mp), inc: r(p.inc),
    // flags: 1 retreating, 2 ability active, 4 AP loaded, 8 reinforcing, 16 digging, 32 garrisoned, 64 attack-moving.
    // Last field: veterancy stars. Cooldowns only for your own units.
    units: [...g.units.values()].filter(u => seen(u.id))
      .map(u => [u.id, u.type, u.owner, r(u.x), r(u.z), r(u.rot), r(u.aim), Math.ceil(u.hp), Math.round(u.supp), u.targetId && seen(u.targetId) ? u.targetId : 0, inTrench(g, u) ? 2 : inCover(g, u) ? 1 : UNITS[u.type].infantry && nearCover(g, u) ? 3 : 0,
        u.owner === slot ? Math.max(0, Math.ceil(u.cd)) : 0, (u.retreating ? 1 : 0) | (u.buff > 0 ? 2 : 0) | (u.ap ? 4 : 0) | (u.reinf > 0 ? 8 : 0) | (u.dig ? 16 : 0) | (u.garrison >= 0 ? 32 : 0) | (u.amove ? 64 : 0), vet(u)]),
    smokes: g.smokes.map(q => [r(q.x), r(q.z), q.r]),
    // incoming and active strikes are public: that's the counterplay
    strikes: g.strikes.map(q => [q.kind, r(q.x), r(q.z), r(q.dir), Math.max(0, r(q.t)), q.owner]),
    sup: Object.fromEntries(SUPPORT_TYPES.map(k => [k, Math.max(0, Math.ceil(p.sup[k]))])),
    points: g.points.map(q => [q.owner, q.capper, r(q.progress)]),
    vp: g.players.map(q => Math.floor(q.vp)),
    cells,
    shots: shots.filter(s => s.pub || allied(g, s.fo ?? -1, slot) || allied(g, s.to ?? -1, slot) || p.visible.has(s.f) || p.visible.has(s.t)),
  };
}
