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
  startForce: ['rifle', 'rifle', 'mg'],
};

export const MOVE = 1, SIGHT = 2, COVER = 4;
export const TERRAIN = { '.': 0, B: MOVE | SIGHT, H: SIGHT | COVER, '#': COVER, '+': COVER };

// w = weapon. acc* = hit chance vs infantry / vehicles. supp = suppression added per shot.
// perModel: damage scales with living squad members. moveFire: accuracy multiplier while moving (absent = can't).
// setup: seconds stationary before it can fire. ab = the unit's one active ability (cd = cooldown seconds).
export const UNITS = {
  rifle: { name: 'Rifle Squad', cost: 100, models: 5, hpPer: 20, speed: 4.5, radius: 1.5, vision: 36, infantry: true,
    w: { range: 28, interval: 1.6, inf: 3, veh: 0.4, accInf: 0.7, accVeh: 0.7, supp: 4, perModel: true, moveFire: 0.5 },
    ab: { id: 'grenade', name: 'Grenade', cd: 30, range: 18, fuse: 1.2, radius: 4.5, inf: 40, veh: 15, supp: 50 } },
  mg: { name: 'MG Team', cost: 150, models: 3, hpPer: 25, speed: 3.5, radius: 1.3, vision: 36, infantry: true,
    w: { range: 36, interval: 0.3, inf: 2.4, veh: 0.2, accInf: 0.5, accVeh: 0.5, supp: 8, setup: 2 },
    ab: { id: 'suppress', name: 'Suppressive Fire', cd: 40, dur: 10 } },
  at: { name: 'AT Gun', cost: 200, models: 4, hpPer: 20, speed: 2.5, radius: 1.8, vision: 34, infantry: true,
    w: { range: 45, interval: 4.5, inf: 8, veh: 120, accInf: 0.3, accVeh: 0.75, supp: 0, setup: 2 },
    ab: { id: 'ap', name: 'AP Round', cd: 45 } },
  tank: { name: 'Light Tank', cost: 300, models: 1, hpPer: 360, speed: 6.5, radius: 2.5, vision: 40, infantry: false,
    w: { range: 35, interval: 3, inf: 30, veh: 45, accInf: 0.6, accVeh: 0.7, supp: 25, moveFire: 1 },
    ab: { id: 'smoke', name: 'Smoke', cd: 45, dur: 14, radius: 9 } },
};
export const UNIT_TYPES = Object.keys(UNITS);

// Off-map support bought with manpower. Every strike is announced to all players `delay` seconds ahead.
export const SUPPORT = {
  recon: { name: 'Recon Flight', cost: 60, cd: 45, delay: 3, dur: 15, radius: 40 },
  artillery: { name: 'Artillery Barrage', cost: 150, cd: 60, delay: 5, radius: 10, shells: 10, every: 0.4, blast: 4, inf: 30, veh: 35, supp: 60 },
  strafe: { name: 'Strafing Run', cost: 200, cd: 90, delay: 5, len: 36, width: 4, inf: 25, veh: 10, supp: 80 },
};
export const SUPPORT_TYPES = Object.keys(SUPPORT);

export const alive = u => Math.ceil(u.hp / UNITS[u.type].hpPer);
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export function createGame(map, names, shuffle = true) {
  // random spawn per match: no 3-way map is perfectly fair on a square grid
  const spawnOrder = [...map.spawns];
  if (shuffle) for (let i = spawnOrder.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [spawnOrder[i], spawnOrder[j]] = [spawnOrder[j], spawnOrder[i]]; }
  const g = {
    w: map.w, h: map.h, flags: new Uint8Array(map.w * map.h),
    tick: 0, nextId: 1, units: new Map(), shots: [], nades: [], smokes: [], strikes: [], winner: null,
    players: names.map((name, slot) => {
      const s = spawnOrder[slot];
      return { slot, name, vp: 0, mp: CFG.mpStart, inc: CFG.mpBase, sup: Object.fromEntries(SUPPORT_TYPES.map(k => [k, 0])), spawn: { x: (s.x + 0.5) * CELL, z: (s.y + 0.5) * CELL }, visible: new Set() };
    }),
    // vp/mp per second while held; the map can make some points worth more
    points: map.points.map(p => ({ x: (p.x + 0.5) * CELL, z: (p.y + 0.5) * CELL, vp: p.vp ?? 1, mp: p.mp ?? 1, owner: -1, capper: -1, progress: 0 })),
  };
  map.rows.forEach((row, y) => [...row].forEach((ch, x) => { g.flags[y * map.w + x] = TERRAIN[ch] ?? 0; }));
  for (const p of g.players) CFG.startForce.forEach((t, i) => spawnUnit(g, p.slot, t, i));
  return g;
}

function spawnUnit(g, owner, type, n = g.units.size) {
  const s = g.players[owner].spawn, a = n * 2.4;
  const c = nearestFree(g, s.x + Math.cos(a) * 4, s.z + Math.sin(a) * 4);
  const u = { id: g.nextId++, type, owner, x: (c % g.w + 0.5) * CELL, z: (Math.floor(c / g.w) + 0.5) * CELL,
    rot: 0, aim: 0, hp: UNITS[type].models * UNITS[type].hpPer, supp: 0,
    path: [], attackId: 0, targetId: 0, cooldown: 0, still: 0, retarget: 0, repath: 0, stuck: 0,
    cd: 0, buff: 0, ap: false, nade: null, retreating: false, reinf: 0 };
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
export const los = (g, a, b) => clear(g, a.x, a.z, b.x, b.z, SIGHT, false) && !g.smokes.some(s => segHits(a, b, s, s.r));

function walkable(g, a, b) {
  // three parallel rays so wide units don't clip building corners
  const d = Math.hypot(b.x - a.x, b.z - a.z) || 1, ox = -(b.z - a.z) / d * 0.9, oz = (b.x - a.x) / d * 0.9;
  return [-1, 0, 1].every(k => clear(g, a.x + ox * k, a.z + oz * k, b.x + ox * k, b.z + oz * k, MOVE, true));
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
      const cost = gs[c] + (dx && dy ? 1.414 : 1);
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
  if (cmd.t === 'move' && Array.isArray(cmd.orders)) {
    for (const o of cmd.orders.slice(0, 50)) {
      const u = Array.isArray(o) && mine(o[0]), x = num(o?.[1], g.w * CELL), z = num(o?.[2], g.h * CELL);
      if (!u || x === null || z === null) continue;
      u.attackId = 0; u.targetId = 0; u.stuck = 0; u.retreating = false; u.nade = null;
      u.path = findPath(g, u, { x, z });
    }
  } else if (cmd.t === 'attack') {
    const t = g.units.get(cmd.target);
    if (!t || t.owner === slot || !g.players[slot].visible.has(t.id)) return;
    for (const id of ids) { const u = mine(id); if (u) { u.attackId = t.id; u.repath = 0; u.retreating = false; u.nade = null; } }
  } else if (cmd.t === 'stop') {
    for (const id of ids) { const u = mine(id); if (u) { u.path = []; u.attackId = 0; u.retreating = false; u.nade = null; } }
  } else if (cmd.t === 'retreat') {
    for (const id of ids) {
      const u = mine(id); if (!u) continue;
      Object.assign(u, { retreating: true, attackId: 0, targetId: 0, nade: null, stuck: 0 });
      u.path = findPath(g, u, g.players[slot].spawn);
    }
  } else if (cmd.t === 'ability') {
    const x = num(cmd.x, g.w * CELL), z = num(cmd.z, g.h * CELL);
    for (const id of ids) {
      const u = mine(id), ab = u && UNITS[u.type].ab;
      if (!u || u.cd > 0 || u.retreating) continue;
      if (ab.id === 'grenade') { if (x === null || z === null) continue; u.nade = { x, z }; u.attackId = 0; u.repath = 0; }
      else if (ab.id === 'suppress') { u.buff = ab.dur; u.cd = ab.cd; }
      else if (ab.id === 'ap') { u.ap = true; u.cd = ab.cd; }
      else if (ab.id === 'smoke') { g.smokes.push({ x: u.x, z: u.z, r: ab.radius, t: ab.dur }); u.cd = ab.cd; }
    }
  } else if (cmd.t === 'support' && Object.hasOwn(SUPPORT, cmd.kind)) {
    const p = g.players[slot], sp = SUPPORT[cmd.kind], x = num(cmd.x, g.w * CELL), z = num(cmd.z, g.h * CELL);
    if (x === null || z === null || p.sup[cmd.kind] > 0 || p.mp < sp.cost) return;
    p.mp -= sp.cost; p.sup[cmd.kind] = sp.cd;
    // planes come in from your own HQ
    const dir = Math.atan2(z - p.spawn.z, x - p.spawn.x);
    g.strikes.push({ kind: cmd.kind, owner: slot, x, z, dir, t: sp.delay, left: sp.shells ?? sp.dur ?? 0, next: 0, live: false });
  } else if (cmd.t === 'buy' && Object.hasOwn(UNITS, cmd.unit)) {
    const p = g.players[slot], def = UNITS[cmd.unit];
    const pop = [...g.units.values()].filter(u => u.owner === slot).length;
    if (p.mp >= def.cost && pop < CFG.popCap) { p.mp -= def.cost; spawnUnit(g, slot, cmd.unit); }
  }
}

// ---------- simulation ----------

const suppMul = (u) => (u.supp >= 90 ? { speed: 0.3, rate: 3, acc: 0.5 } : u.supp >= 50 ? { speed: 0.6, rate: 1.5, acc: 0.7 } : { speed: 1, rate: 1, acc: 1 });

function canShoot(g, u, t) {
  const w = UNITS[u.type].w;
  return t && t.hp > 0 && t.owner !== u.owner && dist(u, t) <= w.range && g.players[u.owner].visible.has(t.id) && los(g, u, t);
}

function pickTarget(g, u) {
  const w = UNITS[u.type].w;
  let best = 0, bestScore = Infinity;
  for (const t of g.units.values()) {
    if (!canShoot(g, u, t)) continue;
    const inf = UNITS[t.type].infantry, value = inf ? w.inf * w.accInf : w.veh * w.accVeh;
    const score = dist(u, t) / value;
    if (score < bestScore) { bestScore = score; best = t.id; }
  }
  return best;
}

function fire(g, u, t, moving) {
  const w = UNITS[u.type].w, def = UNITS[t.type], inf = def.infantry, sm = suppMul(u);
  const cover = inCover(g, t);
  let acc = (inf ? w.accInf : w.accVeh) * sm.acc * (moving ? w.moveFire : 1) * (cover ? 0.5 : 1);
  let dmg = inf ? w.inf : w.veh, supp = w.supp, rate = sm.rate;
  if (u.buff > 0) { dmg *= 0.5; supp *= 2.5; rate *= 0.5; } // suppressive fire: faster, pins harder, kills less
  if (u.ap && !inf) { acc = 1; dmg *= 1.5; u.ap = false; }
  if (t.retreating) dmg *= CFG.retreatDamage;
  if (!inf) {
    // rear armor: shot coming from behind the hull does double damage
    const a = Math.atan2(u.z - t.z, u.x - t.x) - t.rot;
    if (Math.cos(a) < -0.5) dmg *= 2;
  }
  const shots = w.perModel ? alive(u) : 1;
  let hits = 0;
  for (let i = 0; i < shots; i++) if (Math.random() < acc) hits++;
  t.hp -= dmg * hits;
  if (inf && !t.retreating) t.supp = Math.min(100, t.supp + supp * (cover ? 0.5 : 1) * (w.perModel ? shots / UNITS[u.type].models : 1));
  u.cooldown = w.interval * rate;
  g.shots.push({ f: u.id, t: t.id, fo: u.owner, to: t.owner, x: t.x, z: t.z, hit: hits > 0, kill: t.hp <= 0, k: u.type });
}

function updateVision(g) {
  for (const p of g.players) {
    p.visible.clear();
    const own = [...g.units.values()].filter(u => u.owner === p.slot);
    for (const t of g.units.values()) {
      if (t.owner === p.slot) continue;
      if (own.some(u => { const d = dist(u, t); return d < 6 || (d <= UNITS[u.type].vision && los(g, u, t)); })
        || g.strikes.some(s => s.live && s.kind === 'recon' && s.owner === p.slot && dist(s, t) <= SUPPORT.recon.radius)) p.visible.add(t.id);
    }
  }
}

function hurt(g, t, src, fall, owner) {
  const inf = UNITS[t.type].infantry;
  t.hp -= (inf ? src.inf : src.veh) * fall * (t.retreating ? CFG.retreatDamage : 1);
  if (inf) t.supp = Math.min(100, t.supp + src.supp);
  g.shots.push({ t: t.id, fo: owner, to: t.owner, x: t.x, z: t.z, k: 'hurt', kill: t.hp <= 0 });
}
function blast(g, list, at, radius, src, owner) {
  for (const t of list) {
    const d = dist(t, at);
    if (d <= radius && t.hp > 0) hurt(g, t, src, 1 - d / radius * 0.5, owner);
  }
}

export function step(g) {
  if (g.winner !== null) return;
  const dt = TICK;
  g.tick++;
  if (g.tick % 4 === 1) updateVision(g);

  for (const u of g.units.values()) {
    const def = UNITS[u.type], w = def.w, sm = suppMul(u);
    if (def.infantry) u.supp = Math.max(0, u.supp - 8 * dt);
    u.cooldown -= dt; u.retarget -= dt; u.repath -= dt; u.cd -= dt; u.buff -= dt;

    // grenade order: walk into range, then throw
    if (u.nade) {
      const ab = def.ab;
      if (dist(u, u.nade) <= ab.range) {
        g.nades.push({ x: u.nade.x, z: u.nade.z, t: ab.fuse, owner: u.owner, ab });
        g.shots.push({ f: u.id, fo: u.owner, x: u.nade.x, z: u.nade.z, k: 'throw', pub: true });
        u.nade = null; u.path = []; u.cd = ab.cd;
      } else if (u.repath <= 0) { u.path = findPath(g, u, u.nade); u.repath = 1; }
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
    const speed = def.speed * (u.retreating ? CFG.retreatSpeed : sm.speed);
    let budget = speed * dt;
    while (budget > 0 && u.path.length) {
      const wp = u.path[0], d = dist(u, wp);
      u.rot = Math.atan2(wp.z - u.z, wp.x - u.x);
      if (d <= budget) { u.x = wp.x; u.z = wp.z; u.path.shift(); budget -= d; }
      else { u.x += (wp.x - u.x) / d * budget; u.z += (wp.z - u.z) / d * budget; budget = 0; }
    }
    const moved = dist(u, before), moving = u.path.length > 0 || moved > 0.001;
    u.still = moving ? 0 : u.still + dt;
    // give up if blocked by friends crowding the destination
    if (u.retreating && !u.path.length) u.retreating = false;
    if (u.path.length && moved < speed * dt * 0.3) { u.stuck += dt; if (u.stuck > 1) { u.path = []; u.stuck = 0; } } else u.stuck = 0;

    // targeting + firing
    if (u.retreating) { u.targetId = 0; u.aim = u.rot; continue; }
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
    const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
    if (d >= min || d === 0) continue;
    const push = (min - d) / 2 * 0.5, px = dx / d * push, pz = dz / d * push;
    if (!(flagsAt(g, a.x - px, a.z - pz) & MOVE)) { a.x -= px; a.z -= pz; }
    if (!(flagsAt(g, b.x + px, b.z + pz) & MOVE)) { b.x += px; b.z += pz; }
  }

  // grenades: hurt everyone in the blast (friendly fire included), cover doesn't help
  for (const n of g.nades) {
    if ((n.t -= dt) > 0) continue;
    g.shots.push({ x: n.x, z: n.z, k: 'boom', pub: true });
    blast(g, list, n, n.ab.radius, n.ab, n.owner);
  }
  g.nades = g.nades.filter(n => n.t > 0);

  // off-map support
  for (const s of g.strikes) {
    const sp = SUPPORT[s.kind];
    if ((s.t -= dt) > 0) continue;
    if (!s.live) { s.live = true; if (s.kind !== 'artillery') g.shots.push({ k: s.kind, x: s.x, z: s.z, dir: s.dir, fo: s.owner, pub: true }); }
    if (s.kind === 'recon') s.left -= dt;
    else if (s.kind === 'artillery' && (s.next -= dt) <= 0) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * sp.radius, at = { x: s.x + Math.cos(a) * r, z: s.z + Math.sin(a) * r };
      g.shots.push({ x: at.x, z: at.z, k: 'shell', pub: true });
      blast(g, list, at, sp.blast, sp, s.owner);
      s.left--; s.next = sp.every;
    } else if (s.kind === 'strafe') {
      // everything within `width` of the run's line gets raked
      const cx = Math.cos(s.dir), cz = Math.sin(s.dir);
      for (const t of list) {
        const along = (t.x - s.x) * cx + (t.z - s.z) * cz, side = Math.abs(-(t.x - s.x) * cz + (t.z - s.z) * cx);
        if (Math.abs(along) <= sp.len / 2 && side <= sp.width && t.hp > 0) hurt(g, t, sp, 1, s.owner);
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

  // capture points: infantry only, uncontested
  for (const p of g.points) {
    const present = new Set(list.filter(u => u.hp > 0 && !u.retreating && UNITS[u.type].infantry && dist(u, p) <= CFG.pointRadius).map(u => u.owner));
    if (present.size !== 1) continue;
    const [s] = present, rate = dt / CFG.captureTime;
    if (p.owner === s) p.progress = 1;
    else if (p.owner >= 0) { p.progress -= rate; if (p.progress <= 0) { p.owner = -1; p.progress = 0; p.capper = s; } }
    else {
      if (p.capper !== s) { p.capper = s; p.progress = 0; }
      p.progress += rate;
      if (p.progress >= 1) { p.owner = s; p.progress = 1; }
    }
  }

  const lead = Math.max(...g.players.map(q => q.vp));
  for (const pl of g.players) {
    const held = g.points.filter(p => p.owner === pl.slot);
    pl.vp += held.reduce((a, p) => a + p.vp, 0) * dt;
    pl.inc = CFG.mpBase + held.reduce((a, p) => a + p.mp, 0) + Math.min(CFG.catchupMax, (lead - pl.vp) / CFG.catchupPer);
    pl.mp += pl.inc * dt;
    if (pl.vp >= CFG.vpToWin && g.winner === null) g.winner = pl.slot;
  }
}

// What one player is allowed to know: own units + enemies they can see. Fog is enforced here.
export function snapshotFor(g, slot, shots) {
  const p = g.players[slot], r = (v) => Math.round(v * 10) / 10;
  const seen = (id) => g.units.get(id)?.owner === slot || p.visible.has(id);
  return {
    t: 's', tick: g.tick, winner: g.winner, mp: Math.floor(p.mp), inc: r(p.inc),
    // flags: 1 retreating, 2 ability active, 4 AP loaded, 8 reinforcing. Cooldowns only for your own units.
    units: [...g.units.values()].filter(u => seen(u.id))
      .map(u => [u.id, u.type, u.owner, r(u.x), r(u.z), r(u.rot), r(u.aim), Math.ceil(u.hp), Math.round(u.supp), u.targetId && seen(u.targetId) ? u.targetId : 0, inCover(g, u) ? 1 : 0,
        u.owner === slot ? Math.max(0, Math.ceil(u.cd)) : 0, (u.retreating ? 1 : 0) | (u.buff > 0 ? 2 : 0) | (u.ap ? 4 : 0) | (u.reinf > 0 ? 8 : 0)]),
    smokes: g.smokes.map(q => [r(q.x), r(q.z), q.r]),
    // incoming and active strikes are public: that's the counterplay
    strikes: g.strikes.map(q => [q.kind, r(q.x), r(q.z), r(q.dir), Math.max(0, r(q.t)), q.owner]),
    sup: Object.fromEntries(SUPPORT_TYPES.map(k => [k, Math.max(0, Math.ceil(p.sup[k]))])),
    points: g.points.map(q => [q.owner, q.capper, r(q.progress)]),
    vp: g.players.map(q => Math.floor(q.vp)),
    shots: shots.filter(s => s.pub || s.fo === slot || s.to === slot || p.visible.has(s.f) || p.visible.has(s.t)),
  };
}
