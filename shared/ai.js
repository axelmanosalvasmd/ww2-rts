// Seat commander. Runs on the server every couple of seconds and plays through command(),
// from a detached per-seat observation. Each look it picks one situation, wait, hold, or attack,
// and keeps that operation while the reason for it still holds.
import { UNITS, CELL, CFG, COVER, MOVE, TRENCH, FORTS, command, spoiled, SUPPORT, abCost, canBuild, allied, supCost, siteNear, priceOf, alive, los, isSkirmishBaseMode, productionAccess, productionBuildings, placementCheck } from './sim.js';
import { viewFor } from './ai-view.js';
import { tierOf, techCost, TECH } from './tech.js';
import { beginMind, knownSince, pointReady, lesson, pointExtra, dropEmptyGround, liveSightings, operationHolds, planAssault, clearAssault, ARMOR, ANTI_ARMOR } from './ai-mind.js';
import { gridFor, rebuildGrid } from './grid.js';
import { aiCaution } from './weather.js';
import { insideKnownRegion } from './world-territories.js';

const d = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const SUPPORT_PLANE = (kind) => kind === 'strafe' || kind === 'bombing' || kind === 'dive' || kind === 'para';

function houseNear(view, p, r) {
  let best = null, bd = Infinity;
  for (let y = Math.floor((p.z - r) / CELL); y <= (p.z + r) / CELL; y++)
    for (let x = Math.floor((p.x - r) / CELL); x <= (p.x + r) / CELL; x++) {
      if (x < 0 || y < 0 || x >= view.w || y >= view.h || view.chars[y * view.w + x] !== 'B') continue;
      const c = { x: (x + 0.5) * CELL, z: (y + 0.5) * CELL }, dd = d(c, p);
      if (dd < bd) { bd = dd; best = c; }
    }
  return best;
}

// manpower a point holder keeps back for units when it fortifies
const FORT_RESERVE = 60;
// how many cells within the square of half-size r around p pass test(cell)
function cellsNear(view, p, r, test) {
  let n = 0;
  for (let y = Math.floor((p.z - r) / CELL); y <= (p.z + r) / CELL; y++)
    for (let x = Math.floor((p.x - r) / CELL); x <= (p.x + r) / CELL; x++)
      if (x >= 0 && y >= 0 && x < view.w && y < view.h && test(y * view.w + x)) n++;
  return n;
}
const trenchesNear = (view, p, r) => cellsNear(view, p, r, c => view.flags[c] & TRENCH);

// how many of my side's mines lie within r of p (the view's terrain shows only the mines my side laid)
const minesNear = (view, p, r) => view.mines.filter(m => d(p, m) <= r).length;

// Keep every bridge delivered to this seat, including World crossings scouted after the first look.
function rememberBridges(view, mem) {
  if (mem.bridgeMap === view.mapChars) return;
  const cells = new Set(mem.bridges ?? []);
  view.mapChars.forEach((ch, c) => { if (ch === '=') cells.add(c); });
  mem.bridges = [...cells]; mem.bridgeMap = view.mapChars;
}

// A blown bridge to put back: observed bridge cells are remembered, and one that is river now gets a
// builder squad. The span runs along the shorter stretch of water through the cell. One job per look.
function rebuildBridge(view, slot, squads, enemies, busy, mem, submit) {
  const me = view.players[slot], now = view.tick / 20;
  rememberBridges(view, mem);
  // The squad this AI sent to dig a bridge is remembered, since a view shows that a squad digs but not what.
  const crew = mem.bridgeCrew ??= new Map(), byId = new Map(squads.map(u => [u.id, u]));
  for (const [id, job] of crew) {
    const u = byId.get(id);
    if (!u || (job.dug && !u.dig) || now - job.t > 90) crew.delete(id); else if (u.dig) job.dug = true;
  }
  if (me.mp < FORTS.bridge.cost + 150 || squads.some(u => u.dig && crew.has(u.id))) return;
  const at = (c) => ({ x: (c % view.w + 0.5) * CELL, z: (Math.floor(c / view.w) + 0.5) * CELL });
  const idle = squads.filter(u => CFG.fortBuilders.includes(u.type) && !u.retreating && !u.targetId && !u.dig && u.garrison < 0);
  const gap = mem.bridges.filter(c => view.chars[c] === 'W' && !enemies.some(e => d(e, at(c)) < 35))
    .sort((a, b) => d(at(a), me.spawn) - d(at(b), me.spawn))[0];
  if (gap === undefined || !idle.length) return;
  // how far the water runs each way from the gap, along x and along y
  const run = (step) => { let lo = 0, hi = 0; while (lo > -8 && view.chars[gap + (lo - 1) * step] === 'W') lo--; while (hi < 8 && view.chars[gap + (hi + 1) * step] === 'W') hi++; return [lo, hi]; };
  const [x0, x1] = run(1), [y0, y1] = run(view.w), alongX = x1 - x0 <= y1 - y0;
  const mid = at(gap), off = (alongX ? x0 + x1 : y0 + y1) / 2 * CELL;
  const spot = { x: mid.x + (alongX ? off : 0), z: mid.z + (alongX ? 0 : off) };
  const u = idle.sort((a, b) => d(a, spot) - d(b, spot))[0];
  busy.add(u.id);
  // out of sight (every cell of the span must be seen, and a bomb crater hides them from afar): walk up to its own
  // bank first, to a point just inside the builders' reach (the middle of the river has no reachable nearest cell)
  const refused = submit({ t: 'dig', ids: [u.id], kind: 'bridge', x: spot.x, z: spot.z, dir: alongX ? 0 : Math.PI / 2 });
  if (refused === undefined) crew.set(u.id, { t: now, dug: false });
  else if (!u.path.length) {
    const k = Math.min(1, (FORTS.bridge.reach - 2) / (d(u, spot) || 1));
    submit({ t: 'move', orders: [[u.id, spot.x + (u.x - spot.x) * k, spot.z + (u.z - spot.z) * k]] });
  }
}

// The squads this AI sent on a job of one kind (a view shows that a squad digs, not what): id -> { t, dug }.
// Forgotten once the squad has dug and stopped, is gone, or 90 s have passed.
function sent(mem, key, squads, now) {
  const crew = mem[key] ??= new Map(), byId = new Map(squads.map(u => [u.id, u]));
  for (const [id, job] of crew) {
    const u = byId.get(id);
    if (!u || (job.dug && !u.dig) || now - job.t > 90) crew.delete(id); else if (u.dig) job.dug = true;
  }
  return crew;
}
const builders = (squads, busy) => squads.filter(u => CFG.fortBuilders.includes(u.type) && !u.retreating && !u.targetId && !u.dig && !u.entrench && u.garrison < 0 && !busy.has(u.id));

// Spoiled ground to shovel back in: flooded craters, ground that shelling sank and rubble across a road (it stops
// vehicles and so cuts supply), around a point my side holds or on
// a supply node nobody has built on (a depot needs a nearly level site). One job per look, never with a visible
// enemy within 35 m, and only a squad within 60 m goes.
function fillHoles(view, slot, squads, enemies, busy, mem, submit) {
  const me = view.players[slot], now = view.tick / 20, crew = sent(mem, 'fillCrew', squads, now);
  if (me.mp < FORTS.fill.cost + 150 || crew.size) return;
  const idle = builders(squads, busy);
  if (!idle.length) return;
  // the ground as this seat knows it, in the shape the sim's own test reads
  const ground = { w: view.w, chars: view.chars, height: view.height, initialTerrain: { chars: view.mapChars, height: view.mapHeight } };
  const spots = [...view.points.filter(p => p.owner >= 0 && allied(view, p.owner, slot)).map(p => [p, CFG.pointRadius + 10]), ...view.nodes.filter((n, i) => !view.claimedNodes.has(i)).map(n => [n, 4])];
  for (const [p, r] of spots) {
    const n = Math.ceil(r / CELL), px = Math.floor(p.x / CELL), py = Math.floor(p.z / CELL);
    for (let y = Math.max(0, py - n); y <= Math.min(view.h - 1, py + n); y++) for (let x = Math.max(0, px - n); x <= Math.min(view.w - 1, px + n); x++) {
      const at = { x: (x + 0.5) * CELL, z: (y + 0.5) * CELL };
      if (!spoiled(ground, y * view.w + x) || d(at, p) > r || enemies.some(e => d(e, at) < 35)) continue;
      const u = idle.sort((a, b) => d(a, at) - d(b, at))[0];
      if (d(u, at) > 60) continue;
      busy.add(u.id);
      // the bottom of a deep hole cannot be seen from afar: walk up to it first
      if (submit({ t: 'dig', ids: [u.id], kind: 'fill', x: at.x, z: at.z, dir: 0 }) === undefined) crew.set(u.id, { t: now, dug: false });
      else if (!u.path.length) submit({ t: 'move', orders: [[u.id, at.x, at.z]] });
      return;
    }
  }
}

// Enemy mines my side has found (a builder squad stood near them): the nearest free builder squad within 40 m lifts
// them, working from a few metres back. One job per look, never with a visible enemy within 35 m.
function clearMines(view, slot, squads, enemies, busy, mem, submit) {
  const me = view.players[slot], now = view.tick / 20, crew = sent(mem, 'demineCrew', squads, now);
  if (!view.foundMines.length || me.mp < FORTS.demine.cost || crew.size) return;
  const idle = builders(squads, busy);
  for (const at of view.foundMines) {
    if (enemies.some(e => d(e, at) < 35)) continue;
    const u = idle.sort((a, b) => d(a, at) - d(b, at))[0];
    if (!u || d(u, at) > 40) continue;
    busy.add(u.id);
    // out of sight: walk up to 9 m short of it first (never onto it)
    if (submit({ t: 'dig', ids: [u.id], kind: 'demine', x: at.x, z: at.z, dir: 0 }) === undefined) crew.set(u.id, { t: now, dug: false });
    else if (!u.path.length && d(u, at) > 10) {
      const k = 1 - 9 / d(u, at);
      submit({ t: 'move', orders: [[u.id, u.x + (at.x - u.x) * k, u.z + (at.z - u.z) * k]] });
    }
    return;
  }
}

// a random cover cell near the point, so squads dig in instead of standing in the open
function spotNear(view, p) {
  const r = Math.floor((CFG.pointRadius - 2) / CELL), cx = Math.floor(p.x / CELL), cy = Math.floor(p.z / CELL), cover = [];
  for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
    const f = view.flags[y * view.w + x];
    if (x >= 0 && y >= 0 && x < view.w && y < view.h && f & COVER && !(f & MOVE)) cover.push({ x: (x + 0.5) * CELL, z: (y + 0.5) * CELL });
  }
  if (cover.length) return cover[Math.floor(Math.random() * cover.length)];
  const a = Math.random() * Math.PI * 2;
  return { x: p.x + Math.cos(a) * 4, z: p.z + Math.sin(a) * 4 };
}

// What each AI remembers seeing: enemy unit id -> { type, owner, x, z, t (seconds), val (cost x health) }.
// Kept out of the game state; only fed by what the AI's team can see.
const MEMORY = new WeakMap();
const memoryOf = (g, slot) => { if (!MEMORY.has(g)) MEMORY.set(g, []); const m = MEMORY.get(g); return (m[slot] ??= {}); };
// Called when a human resumes this seat, before the next AI takeover can claim its units.
export function resetAI(g, slot) { const memories = MEMORY.get(g); if (memories) delete memories[slot]; }
const knownBuildings = (view) => view.ghosts;
const inCover = (_view, u) => u.cover === 1 || u.cover === 2;

// Refresh on the same beat as human snapshots. A think between beats uses the previous view.
export function observe(g, slot, cache) {
  const mem = memoryOf(g, slot), view = viewFor(g, slot, mem, cache);
  rememberBridges(view, mem);
  flushHordeMovement(view, slot, mem, cmd => command(g, slot, cmd));
  return view;
}

// Spread a large idle Horde over observation beats. Player commands keep their immediate path search.
export const HORDE_ORDER_BATCH = 4;
function hordeQueue(view, slot, mem) {
  const mode = view.mode;
  if (mode?.kind !== 'horde' || mode.slot !== slot || !mode.active || view.winner !== null) {
    mem.hordeOrders = null; return null;
  }
  if (mem.hordeOrders?.wave !== mode.wave) mem.hordeOrders = { wave: mode.wave, pending: new Map(), tick: -1, issued: 0 };
  return mem.hordeOrders;
}
const ownPlan = u => JSON.stringify([u.orderPlan, u.worldGoal, u.routeEnd, u.moveOutcome, u.moveOutcomeTick, u.path, u.amove, u.attackId, u.targetId, u.retreating, u.orders, u.dig, u.entrench, u.build, u.enter, u.fireAt, u.nade, u.holdPos]);
export function flushHordeMovement(view, slot, mem, send) {
  const queue = hordeQueue(view, slot, mem); if (!queue) return;
  if (queue.tick !== view.tick) { queue.tick = view.tick; queue.issued = 0; }
  for (const [id, job] of queue.pending) {
    const u = view.units.get(id);
    if (!u || u.owner !== slot || u.hp <= 0 || u.air || u.retreating || ownPlan(u) !== job.before) { queue.pending.delete(id); continue; }
    if (queue.issued >= HORDE_ORDER_BATCH) break;
    queue.pending.delete(id); queue.issued++;
    send({ ...job.command, orders: [job.order] });
  }
}
function submitHordeMovement(view, slot, mem, cmd, send) {
  const queue = hordeQueue(view, slot, mem);
  if (!queue || !['move', 'amove'].includes(cmd.t) || cmd.queue === true) return send(cmd);
  const direct = [];
  for (const order of cmd.orders ?? []) {
    const u = view.units.get(order[0]);
    if (!u || u.owner !== slot || u.air || UNITS[u.type].structure) { direct.push(order); continue; }
    if (!queue.pending.has(u.id) && queue.pending.size >= CFG.horde.fieldMax) continue;
    queue.pending.set(u.id, { order: [...order], command: { ...cmd, orders: undefined }, before: ownPlan(u) });
  }
  if (direct.length) send({ ...cmd, orders: direct });
  flushHordeMovement(view, slot, mem, send);
}

const worth = (u) => UNITS[u.type].cost * u.hp / (UNITS[u.type].models * UNITS[u.type].hpPer);

const centroid = (us) => ({ x: us.reduce((a, u) => a + u.x, 0) / us.length, z: us.reduce((a, u) => a + u.z, 0) / us.length });
// the spot k meters from a toward b (b itself when that's closer)
const toward = (a, b, k) => { const l = d(a, b) || 1, s = Math.min(k, l) / l; return { x: a.x + (b.x - a.x) * s, z: a.z + (b.z - a.z) * s }; };
const HEAVY = new Set(['tank', 'medium', 'tiger', 'churchill']);

// Difficulty, picked per AI seat in the lobby. No level gets extra income or vision: they differ in how fast they react
// and how well they play. Normal is the default (and what takes over a player who leaves).
//   every       ticks between decisions (the server calls think on this beat, staggered by slot)
//   adaptive    Classic's adaptive rules (DESIGN.md)    memory  remembers enemy sightings in every mode, not only Classic
//   supReserve  MP kept back when calling off-map support (munReserve: Munitions in Classic); supGap: seconds between calls
//   cluster     the smallest enemy group worth a barrage or strafing run (best: aim at the biggest one, clear of its own)
//   wave        units it sends together at an enemy-held point; firstAssault: not before
//               this many seconds; ratio: the wave must be worth this much more than the enemies seen there (0 = any)
//   baseArmy    army size before it marches on an enemy base    retreat: health share at which a squad falls back
//   focus       units in a fight shoot the same target          guard: defend the points it holds in Conquest
//   notice      seconds a new contact is watched before a strike, a grenade, or a retarget
//   hands       march orders one look can give (a push already chosen is one order, not one per squad)
//   casts       abilities one look can throw                    commit: seconds it sticks with the point it picked
export const AI_LEVELS = {
  easy: { every: 120, adaptive: false, supReserve: 250, munReserve: 40, supGap: 45, cluster: 2, wave: 3, firstAssault: 150, ratio: 0, baseArmy: 10, retreat: 0.35, notice: 2.5, hands: 4, casts: 1, commit: 16 },
  normal: { every: 40, adaptive: true, supReserve: 100, munReserve: 0, supGap: 0, cluster: 2, wave: 3, firstAssault: 0, ratio: 0, baseArmy: 6, retreat: 0.35, notice: 1.25, hands: 6, casts: 2, commit: 10 },
  hard: { every: 20, adaptive: true, memory: true, supReserve: 100, munReserve: 0, supGap: 0, cluster: 3, best: true, wave: 2, firstAssault: 0, ratio: 1.2, baseArmy: 6, retreat: 0.5, focus: true, guard: true, notice: 0.5, hands: 8, casts: 3, commit: 6 },
};
export const AI_LEVEL_NAMES = Object.keys(AI_LEVELS);
export const thinkEvery = (level) => (Object.hasOwn(AI_LEVELS, level) ? AI_LEVELS[level] : AI_LEVELS.normal).every;

// opts.adaptive = false plays the plain scripted Classic AI; opts.rules = [1..5] turns on only those adaptive rules
// (both for measuring the rules against the scripted AI).
// opts.view supplies the latest delivered observation, opts.memory isolates a history, and opts.submit intercepts orders.
export function think(g, slot, opts = {}) {
  const mem = opts.memory ?? memoryOf(g, slot);
  mem.seen ??= new Map(); mem.node ??= new Map();
  const view = opts.view ?? viewFor(g, slot, mem);
  // Wave lifecycle is public. A between-snapshot look cannot dispatch an expired Wave's queue.
  if (view.mode?.kind === 'horde' && view.mode.slot === slot
    && (g.mode?.kind !== 'horde' || !g.mode.active || g.mode.wave !== view.mode.wave || g.winner !== null)) {
    mem.hordeOrders = null; return;
  }
  return plan(view, slot, opts, mem, opts.submit ?? (cmd => command(g, slot, cmd)));
}

// This function has no reference to authoritative state. All actions use the slot-bound submit handle.
function plan(observation, slot, opts, mem, send) {
  const L = Object.hasOwn(AI_LEVELS, opts.level) ? AI_LEVELS[opts.level] : AI_LEVELS.normal;
  mem.called ??= -1e9;
  // Mirror accepted orders locally so later decisions in this turn see their own spending and throws.
  const view = { ...observation, players: observation.players.map(p => ({ ...p, sup: p.sup && { ...p.sup } })),
    units: new Map([...observation.units].map(([id, u]) => [id, structuredClone(u)])) };
  if (observation.players[-1]) view.players[-1] = { ...observation.players[-1] };
  const submit = (cmd) => {
    const result = submitHordeMovement(view, slot, mem, cmd, send);
    if (result !== undefined) return result;
    const me = view.players[slot];
    if (cmd.t === 'buy') { const price = priceOf(view, cmd.unit); me.mp -= price.mp; if (price.fuel) me.fuel -= price.fuel; }
    else if (cmd.t === 'support') { const { cur, cost } = supCost(view, cmd.kind); me[cur] -= cost; me.sup[cmd.kind] = SUPPORT[cmd.kind].cd; }
    else if (cmd.t === 'build') me.mp -= UNITS[cmd.kind].cost;
    else if (cmd.t === 'tech') { const c = techCost(me.tech, cmd.kind, ['classic', 'world'].includes(view.mode?.kind)); me.mp -= c.mp; if (c.mun) me.mun -= c.mun; }
    else if (cmd.t === 'dig') me.mp -= FORTS[cmd.kind ?? 'trench']?.cost ?? CFG.digCost;
    for (const id of cmd.ids ?? []) {
      const u = view.units.get(id);
      if (!u || u.owner !== slot) continue;
      if (cmd.t === 'ability') {
        const ab = UNITS[u.type].ab;
        if (['grenade', 'satchel', 'barrage'].includes(ab.id)) u.nade = { x: cmd.x, z: cmd.z };
        else { const cost = abCost(view, ab); if (cost) me.mun -= cost; u.cd = ab.cd; if (ab.id === 'ura') u.supp = 0; }
      } else if (cmd.t === 'build' || cmd.t === 'assist') u.build = 1;
      else if (cmd.t === 'garrison') u.enter = 0;
      else if (cmd.t === 'fireat') u.fireAt = 0;
      else if (cmd.t === 'dig') u.dig = { x: cmd.x, z: cmd.z };
      else if (cmd.t === 'entrench') u.entrench = { x: cmd.x, z: cmd.z };
      else if (cmd.t === 'stance') u[cmd.key] = cmd.on;
    }
  };
  const grid = rebuildGrid(view);
  const me = view.players[slot];
  if (me.out) return;
  const trucks = new Set((view.logistics?.trucks ?? []).map(row => row.id));
  const owned = grid.ownedBy(slot).filter(u => !UNITS[u.type].structure && !UNITS[u.type].logisticsTruck && !trucks.has(u.id));
  // Withdrawal and convoy jobs belong to the simulation. Recover half the stocks before committing again.
  const waiting = mem.supplyWaiting ??= new Set();
  for (const id of waiting) if (!view.units.has(id)) waiting.delete(id);
  const all = owned.filter(u => {
    const stock = u.logistics;
    if (!stock) { waiting.delete(u.id); return true; }
    if (stock.forced) return false;
    const critical = (stock.ammo !== null && stock.ammo <= 0) || stock.provisions <= 0 || (stock.fuel !== null && stock.fuel <= 36);
    const recovered = (stock.ammo === null || stock.ammo >= 0.5) && stock.provisions >= 60 && (stock.fuel === null || stock.fuel >= 90);
    if (waiting.has(u.id) && recovered) waiting.delete(u.id);
    if (critical) {
      if (!u.retreating && !waiting.has(u.id) && submit({ t: 'retreat', ids: [u.id] }) === undefined) waiting.add(u.id);
      return false;
    }
    return !waiting.has(u.id);
  });
  const horde = view.mode?.kind === 'horde' && slot === view.mode.slot; // the horde itself: no shopping, no retreat, straight at the bunker
  const assault = view.mode?.kind === 'assault' || view.mode?.kind === 'annihilation' || view.mode?.kind === 'horde', defending = assault && me.team === view.mode.defenderTeam, world = view.mode?.kind === 'world', classic = view.mode?.kind === 'classic' || world;
  // what the army marches on: assault bunkers, or in Classic the enemy's Production Buildings
  // (Classic: only buildings its team has seen, remembered under fog; with none known, head for the enemy spawns)
  const known = classic ? knownBuildings(view, slot).filter(b => UNITS[b.type].produces && view.players[b.owner].team !== me.team) : [];
  const bunkers = (assault ? [...view.units.values()].filter(u => UNITS[u.type].structure && !UNITS[u.type].building && me.visible.has(u.id) && view.players[u.owner].team !== me.team)
    : !classic ? [] : known.length ? known : world ? [] : view.players.filter(q => q.team !== me.team && !q.out).map(q => q.spawn))
    .sort((a, b) => d(a, me.spawn) - d(b, me.spawn)); // nearest first, so nobody gangs up on whoever was created first
  const count = (t) => all.filter(u => u.type === t).length;
  // weather (shared/weather.js): in poor sight it has seen less of the enemy than is there and its tanks arrive late,
  // so it marches on a base or bunker only with a bigger margin and a bigger army (1 in clear weather, 1.43 in fog)
  const caution = aiCaution(view); // the weather is public: the view carries the row every snapshot sends
  // ---- Classic adaptive AI: remember the last minute of sightings, then react ----
  const adapt = classic && opts.adaptive !== false && L.adaptive, now = view.tick / 20, rule = (n) => adapt && (!opts.rules || opts.rules.includes(n));
  const recent = adapt || L.memory ? observation.sightings ?? [] : [];
  const counters = rule(1) || !!L.memory;
  const skirmish = isSkirmishBaseMode(view) && !horde;
  const ownB = classic ? grid.ownedBy(slot).filter(b => UNITS[b.type].building) : [];
  // rule 2, rush defense: enemy fighters at my buildings in the first 4 minutes
  const rush = rule(2) && now < 240 ? recent.filter(e => now - e.t < 5 && ownB.some(b => d(b, e) < 35)) : [];
  // rule 1, counters: tanks seen lately push the Motor Pool (for AT guns) up the build order
  const seenArmor = recent.filter(e => HEAVY.has(e.type)).length, seenInf = recent.filter(e => UNITS[e.type].infantry).length;
  me.mp -= research(view, slot, classic, submit); // MP saved for the next HQ tier is hidden from every other spender
  const reserve = (classic ? (rush.length ? 0 : 1) * buildEconomy(view, slot, all.filter(u => u.type === 'engineer'), counters && seenArmor > 0, mem, submit) : skirmish ? buildSkirmishBase(view, slot, all, submit) : 0);
  // Classic: only what my finished buildings can train (and, with HQ tiers, what my tier allows)
  const trains = (t) => (!me.tech || tierOf(t) <= me.tech.tier) && (skirmish ? productionBuildings(view, slot, t).length > 0 : !classic || grid.ownedBy(slot).some(b => b.built >= 1 && UNITS[b.type].makes?.includes(t)));
  const mine = all.filter(u => u.type !== 'engineer' && !(skirmish && u.build)); // Engineers build; everyone else fights
  // The horde is a wave, not a player: it still arms every squad. A seat commander arms squads when it
  // sends them into a fight, or once that fight has been watched, not the whole army at the first look.
  const mindful = !horde;
  const mind = beginMind(view, slot, mem, mindful ? 1 : 0);
  if (opts.handoff) clearAssault(mind);
  if (horde) {
    const steady = all.filter(u => !u.air && !u.autoRetreat);
    if (steady.length) submit({ t: 'stance', ids: steady.map(u => u.id), key: 'autoRetreat', on: true });
  }
  // One situation for this look, from the seat's own sightings and the operation it already committed to.
  // Wait: a remembered threat it cannot answer. Hold: a watched enemy on ground it owns. Attack: one objective.
  let sit = null;
  let armorSightings = [];
  const enemies = [...me.visible].map(id => view.units.get(id)).filter(Boolean);
  // once the enemy has shown armor, points get tank traps too
  if (!mem.armor) mem.armor = enemies.some(e => !UNITS[e.type].infantry && !UNITS[e.type].structure && !e.air);
  const watched = (e) => !mindful || knownSince(mind, e?.id, now, L.notice);
  if (mindful) {
    dropEmptyGround(mem, view, slot, now);
    const sightings = liveSightings(mem, view, slot, now);
    armorSightings = sightings.filter(s => ARMOR.has(s.type));
    mind.released ??= [];
    if (mind.operation?.kind === 'wait' && mind.operation.threatId != null && !(now + 1e-9 < mind.operation.until)
      && !mind.released.includes(mind.operation.threatId)) mind.released.push(mind.operation.threatId);
    const onHeld = enemies.filter(e => watched(e) && !e.air && !UNITS[e.type].structure && e.hp > 0).filter(e => {
      const onPoint = view.points.some(p => allied(view, p.owner, slot) && d(e, p) <= CFG.pointRadius + 4);
      const onDepot = [...view.units.values()].some(u => u.type === 'depot' && u.owner === slot && d(e, u) <= 24);
      const onBase = d(e, me.spawn) <= 32 || [...view.units.values()].some(u => u.type === 'hq' && u.owner === slot && d(e, u) <= 32);
      return onPoint || onDepot || onBase;
    }).sort((a, b) => d(a, me.spawn) - d(b, me.spawn) || a.id - b.id)[0];
    if (onHeld) {
      const until = mind.operation?.kind === 'defense' && mind.operation.threatId === onHeld.id && now + 1e-9 < mind.operation.until
        ? mind.operation.until : now + L.commit;
      sit = { kind: 'defense', until, point: null, threatId: onHeld.id, at: { x: onHeld.x, z: onHeld.z }, counter: null, failedAt: 0 };
    } else if (operationHolds(mind.operation, view, slot, mind, now, sightings)) {
      sit = mind.operation;
    } else {
      const answer = mine.filter(u => ANTI_ARMOR.has(u.type)).reduce((a, u) => a + worth(u), 0);
      const armorVal = armorSightings.reduce((a, s) => a + (s.val ?? 0), 0);
      const openArmor = armorSightings.filter(s => !mind.released.includes(s.id));
      const crowd = sightings.filter(s => UNITS[s.type]?.infantry);
      const crowdVal = crowd.reduce((a, s) => a + (s.val ?? 0), 0);
      const foot = mine.filter(u => UNITS[u.type].infantry).reduce((a, u) => a + worth(u), 0);
      if (openArmor.length && armorVal > answer + 1e-9) {
        const s = openArmor[0];
        sit = { kind: 'wait', until: now + L.commit, point: null, threatId: s.id, at: { x: s.x, z: s.z }, counter: count('at') < 2 ? 'at' : null, failedAt: 0 };
      } else if (crowd.length >= 4 && crowdVal > foot + 1e-9 && count('mg') < 1 && !mind.released.includes(crowd[0].id)) {
        const s = crowd[0];
        sit = { kind: 'wait', until: now + L.commit, point: null, threatId: s.id, at: { x: s.x, z: s.z }, counter: 'mg', failedAt: 0 };
      } else sit = { kind: 'push', until: now + L.commit, point: null, threatId: null, at: null, counter: null, failedAt: 0 };
    }
  }
  const seenTanks = Math.max([...me.visible].filter(id => HEAVY.has(view.units.get(id)?.type)).length, counters ? seenArmor : 0, mindful ? armorSightings.length : 0);

  // shopping: counter tanks it has seen, get one tank once the infantry is out, a mortar for dug-in enemies, a sniper
  // against infantry crowds, an armored car to scout and raid, else 2 rifles per MG
  const seenGarrison = [...me.visible].some(id => view.units.get(id)?.garrison >= 0);
  const seenDugIn = [...me.visible].some(id => { const e = view.units.get(id); return e && !allied(view, e.owner, slot) && (e.type === 'mg' || e.type === 'at') && inCover(view, e); });
  const tanks = count('tank') + count('medium') + count('tiger') + count('churchill');
  // air: enemy planes it can see now (they're visible from far away), its own anti-air and planes
  const enemyPlanes = Math.max([...me.visible].filter(id => view.units.get(id)?.air).length, L.memory ? recent.filter(e => UNITS[e.type].air && now - e.t < 30).length : 0), flakN = count('flak') + count('flaktrack');
  const airWant = enemyPlanes && flakN < Math.min(3, Math.ceil(enemyPlanes / 2)) ? (trains('flaktrack') && tanks ? 'flaktrack' : 'flak')
    : enemyPlanes > count('fighter') && trains('fighter') ? 'fighter' : count('attacker') < 2 && mine.length >= 8 && trains('attacker') ? 'attacker'
    : count('bomber') < 1 && count('attacker') >= 1 && mine.length >= 9 && trains('bomber') ? 'bomber' : null;
  const atN = count('at') + count('tankdestroyer');
  const want = airWant ? airWant : seenTanks > atN ? 'at' : seenGarrison && count('rocket') < 1 ? 'rocket' : seenGarrison && count('flamer') < 1 ? 'flamer' : tanks < 1 && mine.length >= 4 ? 'tank'
    : (seenDugIn || mine.length >= 6) && count('mortar') < 1 ? 'mortar' : mine.length >= 8 && count('howitzer') < 1 && trains('howitzer') ? 'howitzer'
    : seenInf >= 6 && count('sniper') < 1 && mine.length >= 5 ? 'sniper'
    : count('medic') < 1 && mine.filter(u => UNITS[u.type].infantry).length >= 5 ? 'medic' // one medic team once there is infantry to patch up
    : count('armoredcar') < 1 && mine.length >= 7 ? 'armoredcar' : tanks < 2 && mine.length >= 8 ? 'tank'
    : count('mg') * 2 < count('rifle') || (rule(1) && seenInf >= 6 && count('mg') < 3) ? 'mg' : 'rifle'; // many infantry seen: more MGs
  // faction flavor: USA mixes in Rangers, Germany saves up for its Tiger, USSR fields Conscripts instead of rifles,
  // UK mixes in Commandos and fields its Churchill
  let buy = want;
  // the medium tank is the mainline tank once it can be afforded; the light tank is the cheap fallback
  const affords = (t) => { const pr = priceOf(view, t); return me.mp >= pr.mp && !(pr.fuel > (me.fuel ?? 0)); };
  if (want === 'tank' && trains('medium') && affords('medium')) buy = 'medium';
  // every other tank answer is a tank destroyer once there is a gun line to back it
  if (want === 'at' && count('at') > count('tankdestroyer') && trains('tankdestroyer') && affords('tankdestroyer')) buy = 'tankdestroyer';
  if (want === 'rifle' && canBuild('conscript', me.faction)) buy = 'conscript';
  if (want === 'rifle' && canBuild('ranger', me.faction) && count('ranger') < 2 && count('rifle') >= 1) buy = 'ranger';
  // Tiger only when it's affordable right now: saving up for it starved the German army
  if (canBuild('tiger', me.faction) && count('tiger') < 1 && mine.length >= 5 && affords('tiger') && (want === 'tank' || want === 'rifle')) buy = 'tiger';
  if (want === 'rifle' && canBuild('commando', me.faction) && count('commando') < 2 && count('rifle') >= 1) buy = 'commando';
  if (canBuild('churchill', me.faction) && count('churchill') < 1 && mine.length >= 5 && affords('churchill') && (want === 'tank' || want === 'rifle')) buy = 'churchill';
  // A tank that already wiped a squad, or one this seat still remembers, changes the next buy after it leaves sight.
  if (mindful) {
    const learned = lesson(mind, buy, count('at'), count('mg')) || sit?.counter || null;
    if (learned) buy = learned;
  }
  // Classic: keep an Engineer while there are nodes to build on
  // Classic: no building for it, or no Fuel for a vehicle: infantry instead
  // (with HQ tiers, an MG for every two rifle squads, so a low tier still fields a mixed army)
  if (!trains(buy) || !canBuild(buy, me.faction) || priceOf(view, buy).fuel > (me.fuel ?? 0)) buy = me.tech && count('mg') * 2 < count('rifle') + count('conscript') && trains('mg') ? 'mg' : trains('conscript') && canBuild('conscript', me.faction) ? 'conscript' : 'rifle';
  if (world && (!count('engineer') || !ownB.some(b => b.type === 'hq'))) submit({ t: 'recover' });
  if (classic && count('engineer') < (view.nodes.some((_, i) => !view.claimedNodes.has(i)) ? 2 : 1)) buy = 'engineer';
  // Classic: save up for the next building, unless the army is nearly gone
  // big armies: buy several at a time (one per decision can't keep a 60-unit army topped up)
  if (!horde && trains(buy)) for (let k = 0; k < (view.army?.pop > 1 ? 4 : 1); k++) if (me.mp - (mine.length >= 3 ? reserve : 0) >= priceOf(view, buy).mp) submit({ t: 'buy', unit: buy });

  // how many of my units are at or heading to each point
  const pointOf = (pos) => view.points.findIndex(p => d(pos, p) <= CFG.pointRadius);
  const load = view.points.map(() => 0), holding = view.points.map(() => 0);
  for (const u of mine) {
    const i = pointOf(u.path.length ? u.path.at(-1) : u);
    if (i >= 0) load[i]++;
  }

  const orders = [], assault_ = [], retreat = [], pending = view.points.map(() => []), heading = [...load];
  const enemyOrder = new Map(enemies.map((u, i) => [u.id, i]));
  const enemiesNear = (at, r) => grid.radius(at, r).filter(u => enemyOrder.has(u.id)).sort((a, b) => enemyOrder.get(a.id) - enemyOrder.get(b.id));
  // The attack's objective is chosen once, before support, so a strike aims at that push and not at some other cluster.
  if (mindful && sit?.kind === 'push' && sit.point == null) {
    const scout = mine.find(u => !u.air && !UNITS[u.type].medic) ?? mine[0];
    let best = -1, bestScore = Infinity;
    if (scout) view.points.forEach((p, i) => {
      if ((allied(view, p.owner, slot) && !p.cut) || p.locked) return;
      if (defending && d(p, me.spawn) > 70) return;
      const score = d(scout, p) + load[i] * 40 - (p.vp - 1) * 25 - p.mp * 10 + pointExtra(mind, i) * 40;
      if (score < bestScore) { bestScore = score; best = i; }
    });
    if (best >= 0) {
      sit = { ...sit, point: best, at: { x: view.points[best].x, z: view.points[best].z }, failedAt: mind.points[best]?.failed ?? 0 };
      if (!mind.aim) mind.aim = { i: best, until: sit.until };
    }
  }
  // A wait is about the ground it cannot take. Another point, clear of that threat, is still a fair attack.
  if (mindful && sit?.kind === 'wait') {
    const threatNear = (p) => !!(sit.at && Math.hypot(sit.at.x - p.x, sit.at.z - p.z) <= 28);
    const owned = (p) => allied(view, p.owner, slot) && !p.cut;
    const stale = sit.safe == null || !view.points[sit.safe] || threatNear(view.points[sit.safe]) || owned(view.points[sit.safe]);
    if (stale) {
      const scout = mine.find(u => !u.air && !UNITS[u.type].medic) ?? mine[0];
      let best = -1, bestScore = Infinity;
      if (scout) view.points.forEach((p, i) => {
        if (owned(p) || threatNear(p) || p.locked) return;
        if (defending && d(p, me.spawn) > 70) return;
        const score = d(scout, p) + load[i] * 40 - (p.vp - 1) * 25 - p.mp * 10 + pointExtra(mind, i) * 40;
        if (score < bestScore) { bestScore = score; best = i; }
      });
      sit = { ...sit, safe: best >= 0 ? best : null };
      if (best >= 0 && !mind.aim) mind.aim = { i: best, until: sit.until };
    }
  }
  let hands = 0, casts = 0, pushed = false, spentSupport = false;
  const takeHand = () => {
    if (!mindful) return true;
    if (hands >= L.hands) return false;
    hands += 1;
    return true;
  };
  const armSet = new Set();
  const arm = (u) => { if (mindful && u && !u.air && !u.autoRetreat && !u.retreating) armSet.add(u.id); };
  const cast = (cmd) => {
    if (mindful && casts >= L.casts) return false;
    if (submit(cmd) !== undefined) return false;
    casts += 1;
    return true;
  };

  // off-map support, keeping some MP back so reinforcing never stalls (Easy keeps more, and waits between calls)
  const can = (k) => { const { cur, cost } = supCost(view, k); return me.sup[k] <= 0 && me[cur] >= cost + (cur === 'mp' ? L.supReserve : L.munReserve) && now - mem.called >= L.supGap; };
  // a group of at least min enemies within r: the first one found, or (Hard) the biggest with none of its own units close
  const cluster = (min, r, test = () => true) => {
    let best = null, most = min - 1;
    for (const e of enemies) {
      if (!watched(e)) continue;
      const near = enemiesNear(e, r).filter(o => test(o) && watched(o) && d(o, e) <= r);
      if (near.length <= most) continue;
      const at = { x: near.reduce((a, o) => a + o.x, 0) / near.length, z: near.reduce((a, o) => a + o.z, 0) / near.length };
      if (!L.best) return at;
      if (grid.radius(at, 10).some(u => allied(view, u.owner, slot) && !u.air && d(u, at) < 10)) continue;
      best = at; most = near.length;
    }
    return best;
  };
  const clearOfFriends = at => !grid.radius(at, 10).some(u => allied(view, u.owner, slot) && !u.air && d(u, at) < 10);
  // One support call per look. A siren (fighter cover) can be that call. A unit just spotted is not a target yet.
  const call = (kind, at, dir) => {
    if (spentSupport || !at) return;
    // Cover answers a siren wherever it is. Every other call has to be the fight this look already chose.
    if (mindful && kind !== 'cover' && sit?.at && d(at, sit.at) > 40) return;
    if (!submit({ t: 'support', kind, x: at.x, z: at.z, dir })) { mem.called = now; spentSupport = true; }
  };
  // bombs for tanks and for squads holed up in houses
  // an enemy air strike announced near my units: put fighter cover over it (cover arrives in 2s, strikes take 3-6s)
  const incoming = view.strikes.find(q => q.t > 0 && !allied(view, q.owner, slot) && SUPPORT_PLANE(q.kind) && all.some(u => d(u, q) < 25)); // builders under the bombs count too
  if (incoming && can('cover')) call('cover', incoming);
  const heavy = enemies.find(e => (e.type === 'tank' || e.type === 'medium' || e.type === 'tiger' || e.type === 'churchill' || e.type === 'flaktrack') && watched(e));
  if (heavy && can('dive')) call('dive', heavy);
  const dropZone = view.points.find(q => q.owner >= 0 && !allied(view, q.owner, slot) && view.sees(q));
  if (dropZone && !horde && mine.length >= 6 && can('para') && (!mindful || pointReady(mind, view.points.indexOf(dropZone), now, L.notice))) call('para', dropZone);
  const bombTarget = enemies.find(e => (e.type === 'tank' || e.garrison >= 0) && watched(e));
  if (bombTarget && can('bombing')) call('bombing', bombTarget);
  else if (can('artillery')) call('artillery', cluster(L.cluster, 8) || enemies.find(e => (e.type === 'mg' || e.type === 'at') && watched(e) && now - e.firstStillAt > 3 && (!L.best || clearOfFriends(e))));
  else if (can('strafe')) call('strafe', cluster(L.cluster, 10, o => UNITS[o.type].infantry));
  if (can('recon') && !enemies.length && (classic || me.mp > 250)) call('recon', view.points.find(p => p.owner >= 0 && !allied(view, p.owner, slot)));
  const hurt = u => { const def = UNITS[u.type], frac = u.hp / (def.models * def.hpPer); return frac < L.retreat || (def.models > 1 && alive(u) <= 1) || (u.supp >= 90 && frac < 0.6); };
  const busy = new Set();
  rebuildBridge(view, slot, mine.filter(u => !u.air), enemies, busy, mem, submit);
  fillHoles(view, slot, mine.filter(u => !u.air), enemies, busy, mem, submit);
  clearMines(view, slot, mine.filter(u => !u.air), enemies, busy, mem, submit);
  if (adapt) {
    const free = mine.filter(u => !u.retreating && !u.targetId);
    // a hurt squad is left to the normal logic, which pulls it back to reinforce
    const send = (u, at) => { if (worth(u) < UNITS[u.type].cost * 0.4 || hurt(u)) return; busy.add(u.id); arm(u); if (!u.amove || d(u.amove, at) > 6) assault_.push([u.id, at.x, at.z]); };
    if (rush.length) {
      // everyone home to meet it, Engineers out of the way
      const c = { x: rush.reduce((a, e) => a + e.x, 0) / rush.length, z: rush.reduce((a, e) => a + e.z, 0) / rush.length };
      for (const u of mine) if (!u.retreating) send(u, c);
      for (const u of all.filter(u => u.type === 'engineer' && d(u, c) < 25)) submit({ t: 'move', orders: [[u.id, me.spawn.x, me.spawn.z]] });
      if (can('artillery')) call('artillery', c);
    } else {
      // rule 5, scout when blind: no enemy base known yet, so fly recon over the likeliest spawn
      // (a lone scouting squad just died on the way; the army already heads for the spawns when it attacks)
      const spawns = view.players.filter(q => q.team !== me.team && !q.out && q.spawn).map(q => q.spawn).sort((a, b) => d(a, me.spawn) - d(b, me.spawn));
      if (rule(5) && !known.length && spawns.length && can('recon')) call('recon', spawns[0]);
      // rule 4, raid a depot nobody has been seen guarding for 30s
      const raiders = mem.raid ? mem.raid.ids.map(id => view.units.get(id)).filter(u => u && u.owner === slot) : [];
      if (mem.raid && (!raiders.length || !knownBuildings(view, slot).some(b => b.id === mem.raid.id))) mem.raid = null;
      if (rule(4) && !mem.raid) {
        const depot = knownBuildings(view, slot).filter(b => b.type === 'depot' && view.players[b.owner].team !== me.team && !recent.some(e => now - e.t < 30 && d(e, b) < 25))
          .sort((a, b) => d(a, me.spawn) - d(b, me.spawn))[0];
        const fast = (u) => (u.type === 'armoredcar' ? 0 : 1); // armored cars are the raiders
        const pick = depot && free.filter(u => !busy.has(u.id) && !['mg', 'at', 'mortar', 'sniper', 'howitzer'].includes(u.type)).sort((a, b) => fast(a) - fast(b) || d(a, depot) - d(b, depot)).slice(0, 2);
        if (pick?.length === 2) mem.raid = { id: depot.id, ids: pick.map(u => u.id), at: { x: depot.x, z: depot.z } };
      }
      if (mem.raid) for (const u of mem.raid.ids.map(id => view.units.get(id)).filter(u => u && u.owner === slot)) send(u, mem.raid.at);
    }
  }
  // enemies it can see at one of its Classic depots (or, Hard, a point it holds in Conquest). The nearest free units go to
  // fight them off, but only when together they're worth more than the attackers (else they'd just feed them); units
  // already there count, and stay where they are (in their house or trench). A lost depot is lost income at any level.
  const guarded = [...ownB.filter(b => b.type === 'depot'), ...(L.guard && !classic ? view.points.filter(p => p.owner === slot) : [])];
  for (const at of guarded) {
    const foes = enemiesNear(at, 24).filter(e => !UNITS[e.type].structure && !e.air && d(e, at) <= 24);
    if (!foes.length) continue;
    const foeVal = foes.reduce((a, e) => a + worth(e), 0), go = [];
    let val = 0;
    for (const u of mine.filter(u => !u.air && !u.retreating && !busy.has(u.id) && (!u.targetId || d(u, at) < 30) && d(u, at) < 70 && worth(u) >= UNITS[u.type].cost * 0.4 && !hurt(u)).sort((a, b) => d(a, at) - d(b, at))) {
      if (val >= foeVal * 1.3) break;
      go.push(u); val += worth(u);
    }
    if (val < foeVal) continue;
    for (const u of go) { busy.add(u.id); arm(u); if (d(u, at) > 12 && (!u.amove || d(u.amove, at) > 6)) assault_.push([u.id, at.x, at.z]); }
  }
  // rule 3, attack timing: march on a base only with an army worth 1.3x what that enemy was recently seen fielding
  const target = bunkers[0], myVal = mine.reduce((a, u) => a + worth(u), 0);
  const theirVal = target?.owner === undefined ? 0 : recent.filter(e => now - e.t < CFG.classic.aiSeenWindow && view.players[e.owner].team === view.players[target.owner].team).reduce((a, e) => a + e.val, 0);
  const strongEnough = !rule(3) || myVal > CFG.classic.aiAttackRatio * caution * theirVal;

  // planes: a ready ground-attack plane goes for the nearest enemy tank or gun it can see near the army; a ready fighter
  // hunts enemy planes it can see, else covers the army. They come home on their own when fuel or ammo runs out.
  const army = mine.filter(u => !u.air), front = army.length ? { x: army.reduce((a, u) => a + u.x, 0) / army.length, z: army.reduce((a, u) => a + u.z, 0) / army.length } : me.spawn;
  for (const u of mine.filter(u => u.air && u.air.state === 'base')) {
    if (u.type === 'attacker') {
      const t = enemies.filter(e => !e.air && !UNITS[e.type].building && (!UNITS[e.type].infantry || e.type === 'at' || e.type === 'flak' || e.type === 'mortar' || e.type === 'howitzer')).sort((a, b) => d(a, front) - d(b, front))[0];
      if (t && d(t, front) < 120) submit({ t: 'attack', ids: [u.id], target: t.id });
    } else {
      const e = enemies.filter(e => e.air).sort((a, b) => d(a, front) - d(b, front))[0];
      submit({ t: 'move', orders: [[u.id, (e ?? front).x, (e ?? front).z]] });
    }
  }
  // where squads get reinforced: near the spawn, or in Classic near any finished Production Building of its team (a squad
  // that fell back to a Barracks away from the HQ used to head out again half empty)
  const bases = classic ? [...view.units.values()].filter(b => UNITS[b.type].produces && b.built >= 1 && b.hp > 0 && allied(view, b.owner, slot)) : skirmish ? productionBuildings(view, slot).filter(b => b.type === 'hq') : null;
  const atBase = (u) => (bases ? bases.some(b => d(u, b) <= CFG.reinforceRadius) : d(u, me.spawn) <= CFG.reinforceRadius);
  const idleCombat = (u) => !u.air && !u.retreating && !busy.has(u.id) && !UNITS[u.type].medic && !u.path.length && !u.attackId && !u.targetId && !u.dig && !u.entrench && u.enter < 0 && u.fireAt < 0;
  // A watched threat on ground we hold: idle squads go there, and the attack loop will not open another objective.
  if (mindful && sit?.kind === 'defense' && sit.at) {
    for (const u of mine) {
      if (!idleCombat(u)) continue;
      if (!takeHand()) break;
      assault_.push([u.id, sit.at.x, sit.at.z]);
      arm(u);
      busy.add(u.id);
    }
  }
  // Remembered armor: the anti-tank gun goes toward it. Rifles are taken off that ground at the end of the look.
  if (mindful && armorSightings.length && sit && sit.kind !== 'defense') {
    const spot = armorSightings[0];
    for (const u of mine) {
      if (!ANTI_ARMOR.has(u.type) || !idleCombat(u)) continue;
      if (!takeHand()) break;
      assault_.push([u.id, spot.x, spot.z]);
      arm(u);
      busy.add(u.id);
    }
  }
  for (const u of mine) {
    if (u.air) continue; // planes are flown above
    if (busy.has(u.id)) continue;
    const def = UNITS[u.type], frac = u.hp / (def.models * def.hpPer), home = atBase(u);
    if (u.retreating) continue;

    // abilities: a few throws per look, and not at a squad that was spotted on this same look
    const target = view.units.get(u.targetId);
    if (u.cd <= 0) {
      if (def.ab.id === 'grenade') {
        // lob it at a dug-in MG or AT gun, or any squad sitting in cover
        const t = enemiesNear(u, def.ab.range + 4).find(e => watched(e) && UNITS[e.type].infantry && d(u, e) <= def.ab.range + 4 && (e.type !== 'rifle' || inCover(view, e)));
        if (t) cast({ t: 'ability', ids: [u.id], x: t.x, z: t.z });
      } else if (def.ab.id === 'suppress' && target && watched(target)) cast({ t: 'ability', ids: [u.id] });
      else if (def.ab.id === 'ap' && target && !UNITS[target.type].infantry && !UNITS[target.type].structure && watched(target)) cast({ t: 'ability', ids: [u.id] });
      else if (def.ab.id === 'smoke' && frac < 0.5 && !home) cast({ t: 'ability', ids: [u.id] });
      else if (def.ab.id === 'satchel') {
        // demolish a house the enemy is holding, or plant it on a tank
        const t = enemiesNear(u, 20).find(e => watched(e) && (e.garrison >= 0 || !UNITS[e.type].infantry) && d(u, e) <= 20);
        if (t) cast({ t: 'ability', ids: [u.id], x: t.x, z: t.z });
      } else if (def.ab.id === 'ura' && (u.supp >= 50 || (u.amove && enemiesNear(u, 30).some(e => watched(e) && d(u, e) < 30)))) cast({ t: 'ability', ids: [u.id] });
      else if (def.ab.id === 'barrage') { const t = (L.best && cluster(L.cluster, 8, e => d(u, e) <= def.ab.range)) || enemiesNear(u, def.ab.range).find(e => watched(e) && e.garrison >= 0 && d(u, e) <= def.ab.range && (!L.best || clearOfFriends(e))); if (t) cast({ t: 'ability', ids: [u.id], x: t.x, z: t.z }); }
    }
    // save hurt units instead of letting them die: retreat, get reinforced, come back
    if (!horde && !home && hurt(u)) { retreat.push(u.id); continue; }
    if (!horde && home && frac < 1 && (me.mp >= 20 || hurt(u))) continue; // wait for reinforcements
    // a medic keeps near the middle of the army; within reach of it the sim walks it to the wounded
    if (def.medic) { if (!u.path.length && d(u, front) > CFG.aid.seek * 0.8) orders.push([u.id, front.x, front.z]); continue; }
    // tanks knock down houses that enemy squads are hiding in
    if (def.w.shellTerrain && !u.targetId && u.fireAt < 0) {
      const house = enemiesNear(u, 60).find(e => watched(e) && e.garrison >= 0 && d(u, e) < 60);
      if (house) { submit({ t: 'fireat', ids: [u.id], x: house.x, z: house.z }); continue; }
    }
    if (u.path.length || u.attackId || u.nade || u.dig || u.enter >= 0 || u.fireAt >= 0) continue;
    if (u.targetId) continue; // in a fight: hold
    if (horde) { if (bunkers[0]) assault_.push([u.id, bunkers[0].x, bunkers[0].z]); continue; }
    if (world) {
      // Regions and frontiers come only from the delivered observation. No hidden homes are targets.
      const regions = (view.world?.regions ?? []).filter(r => r.team !== me.team);
      const target = regions.filter(r => !r.locked || mine.length >= L.wave).sort((a, b) => d(u, a) - d(u, b))[0];
      if (target && (target.locked || def.infantry)) {
        const base = target.locked && known.filter(e => insideRegion(target, e)).sort((a, b) => d(u, a) - d(u, b))[0];
        if (base && takeHand()) {
          if (me.visible.has(base.id)) submit({ t: 'attack', ids: [u.id], target: base.id });
          else assault_.push([u.id, base.x, base.z]);
          arm(u);
        }
        else if (d(u, target) > CFG.pointRadius - 2 && takeHand()) {
          assault_.push([u.id, target.x, target.z]); arm(u);
        }
      } else {
        const frontier = worldFrontier(view, u);
        if (frontier && takeHand()) { assault_.push([u.id, frontier.x, frontier.z]); arm(u); }
      }
      continue;
    }
    const here = pointOf(u);
    // infantry stays to capture, and one squad stays behind to hold each captured point (and digs in)
    if (here >= 0 && def.infantry) {
      const p = view.points[here];
      if (!allied(view, p.owner, slot)) continue;
      if (holding[here]++ === 0) {
        // Fortify toward the closest enemy HQ: mines just outside the point, trench around it, then a belt of wire across
        // the approach and tank traps beyond it once the enemy has shown armor. Wire and traps are short lines, so the
        // side's own units go round them. While the point is quiet a builder squad does the work still owed, stepping out
        // of its house for it (from inside it cannot see the ground); otherwise it holds the point from a house close by.
        const foe = view.players.filter(q => q.team !== me.team).sort((a, b) => d(a.spawn, p) - d(b.spawn, p))[0]?.spawn;
        if (!foe) continue;
        const l = d(foe, p) || 1, R = CFG.pointRadius, free = !u.dig && !u.entrench && CFG.fortBuilders.includes(u.type);
        const toward = (k) => ({ x: p.x + (foe.x - p.x) / l * k, z: p.z + (foe.z - p.z) / l * k }), ahead = toward(R + 7);
        const across = (k, half) => { const at = toward(k), px = -(foe.z - p.z) / l * half, pz = (foe.x - p.x) / l * half; return { x: at.x - px, z: at.z - pz, x2: at.x + px, z2: at.z + pz }; };
        const needs = {
          mines: me.mp >= FORTS.mines.cost + FORT_RESERVE && minesNear(view, p, R + 10) < 2,
          trench: me.mp >= CFG.digCost + FORT_RESERVE && trenchesNear(view, p, R + 4) < 6,
          wire: me.mp >= FORTS.wire.cost * 2 + FORT_RESERVE && cellsNear(view, ahead, 6, c => view.chars[c] === 'X') < 4,
          traps: !!mem.armor && me.mp >= FORTS.traps.cost * 2 + FORT_RESERVE && cellsNear(view, ahead, 8, c => view.chars[c] === 'Y') < 4,
        };
        const work = free && !enemies.some(e => d(e, p) < 40) && Object.values(needs).some(Boolean);
        const house = !work && u.garrison < 0 && def.garrisons && houseNear(view, p, R + 3);
        if (house && submit({ t: 'garrison', ids: [u.id], x: house.x, z: house.z }) === undefined) continue;
        if (u.garrison >= 0) { if (work) submit({ t: 'move', orders: [[u.id, p.x, p.z]] }); continue; }
        const mines = toward(R + 2);
        if (free && needs.mines && submit({ t: 'dig', ids: [u.id], kind: 'mines', x: mines.x, z: mines.z, dir: Math.atan2(foe.z - p.z, foe.x - p.x) + Math.PI / 2 }) === undefined) continue;
        // an arc of trench, or a strongpoint when there is manpower to spare
        if (free && needs.trench) { const at = toward(6); submit({ t: 'entrench', ids: [u.id], pattern: me.mp >= 600 ? 'strongpoint' : 'arc', x: p.x, z: p.z, x2: at.x, z2: at.z }); continue; }
        if (free && needs.wire && submit({ t: 'entrench', ids: [u.id], pattern: 'line', fort: 'wire', ...across(R + 5, 7) }) === undefined) continue;
        if (free && needs.traps && submit({ t: 'entrench', ids: [u.id], pattern: 'line', fort: 'traps', ...across(R + 10, 8) }) === undefined) continue;
        if (!u.dig && !u.entrench && !inCover(view, u)) submit({ t: 'cover', ids: [u.id] }); // stand in the trench, not beside it
        continue;
      }
    }
    // otherwise go for the closest point we don't hold, spreading out across targets
    let best = -1, bestScore = Infinity;
    // attackers with a big enough army go for the bunkers
    if (bunkers.length && mine.length >= Math.round(L.baseArmy * caution) && strongEnough && !(mindful && sit && sit.kind !== 'push')) {
      if (takeHand()) {
        const b = bunkers.sort((a, c) => d(u, a) - d(u, c))[0];
        assault_.push([u.id, b.x, b.z]);
        arm(u);
      }
      continue;
    }
    view.points.forEach((p, i) => {
      // a point of ours that is cut off from the HQ is a target again, for units not already at it: they
      // attack-move to it and meet whatever sits on the road
      if ((allied(view, p.owner, slot) && (!p.cut || d(u, p) <= CFG.pointRadius + 16)) || p.locked) return;
      if (defending && d(p, me.spawn) > 70) return; // defenders stay near home
      // While waiting on a threat, only the clear point is worth a march. The dangerous one is not.
      if (mindful && sit?.kind === 'wait' && (sit.safe == null || i !== sit.safe) && !(allied(view, p.owner, slot) && p.cut)) return;
      // the center is worth double VP, villages feed manpower. A point that has already killed our squads
      // looks worse. The point this commander already picked keeps a small pull until that choice expires.
      const loyal = mindful && mind.aim && mind.aim.i === i ? 18 : 0;
      const score = d(u, p) + load[i] * 40 - (p.vp - 1) * 25 - p.mp * 10 + (mindful ? pointExtra(mind, i) * 40 : 0) - loyal;
      if (score < bestScore) { bestScore = score; best = i; }
    });
    if (best < 0) continue; // we hold everything: stay put
    if (mindful && !mind.aim) mind.aim = { i: best, until: now + L.commit };
    load[best]++;
    pending[best].push(u);
  }
  // grab neutral points with whoever is free, but only hit enemy-held points as a group (and, Hard, one worth more than
  // the enemies seen there). Nobody joins a fight there that is clearly lost: more units would only feed the defenders.
  pending.forEach((group, i) => {
    const p = view.points[i];
    if (p.owner < 0 || allied(view, p.owner, slot)) {
      // a cut point is reopened immediately: the supply rule is the same at every difficulty
      if (p.cut) { for (const u of group) { const s = spotNear(view, p); assault_.push([u.id, s.x, s.z]); } return; }
      for (const u of group) { if (!takeHand()) return; const s = spotNear(view, p); orders.push([u.id, s.x, s.z]); }
      return;
    }
    if (mindful && sit?.kind === 'defense') return; // holding does not open another enemy point
    if (mindful && sit?.kind === 'wait' && i !== sit.safe) return; // the other point is the action; this ground is the threat
    if (mindful && sit?.kind === 'push' && sit.point != null && i !== sit.point) return; // the operation already has its objective
    if (mindful && pushed) return; // one enemy point per look. The other can wait until the next decision.
    if (now < L.firstAssault || !group.length || group.length + heading[i] < Math.min(L.wave, mine.length)) return;
    const ids = new Set(group.map(u => u.id));
    const there = mine.filter(u => !u.air && !u.retreating && !ids.has(u.id) && (d(u, p) <= 25 || [u.amove, u.path.at(-1)].some(at => at && d(at, p) <= CFG.pointRadius + 2)));
    // what holds it: enemies seen there now, or (Hard) in the last 30s unless its own units have since seen the spot empty
    const foes = L.memory ? recent.filter(e => now - e.t < 30 && d(e, p) <= 25 && (me.visible.has(e.id) || !view.sees(e))).map(e => e.val)
      : enemiesNear(p, 25).filter(e => d(e, p) <= 25 && !UNITS[e.type].structure).map(worth);
    const foeVal = foes.reduce((a, v) => a + v, 0), ourVal = [...group, ...there].reduce((a, u) => a + worth(u), 0);
    if (foeVal > 1.5 * ourVal) return;
    // losses on this point raise the margin the next push has to bring
    if (ourVal < (L.ratio + (mindful ? pointExtra(mind, i) * 0.45 : 0)) * foeVal) return;
    // screen the assault with smoke, 60% of the way in; attack-move, so they fight their way in past the defenders
    const c = centroid(group);
    if (can('smoke')) call('smoke', toward(c, p, d(c, p) * 0.6), Math.atan2(p.z - c.z, p.x - c.x) + Math.PI / 2); // wall across the approach
    pushed = true;
    for (const u of group) { const s = spotNear(view, p); assault_.push([u.id, s.x, s.z]); arm(u); }
  });
  // Hard: units in a fight shoot together at the target they can kill best (the most value per second of their combined
  // fire, finishing hurt units first), instead of each picking its own. Only units already in range, out in the open.
  if (L.focus) {
    const hit = (u, inf) => { const w = UNITS[u.type].w; return inf ? w.inf * w.accInf : w.veh * w.accVeh; };
    const dps = (u, inf) => hit(u, inf) * (UNITS[u.type].w.perModel ? alive(u) : 1) / UNITS[u.type].w.interval;
    const shooters = mine.filter(u => !u.air && !u.retreating && u.targetId && u.garrison < 0 && !u.nade && !u.dig && u.fireAt < 0 && !UNITS[u.type].w.salvo && !retreat.includes(u.id));
    // (a squad running away isn't chased: they'd follow it into its own lines)
    const targets = enemies.filter(e => watched(e) && !e.air && !UNITS[e.type].structure && e.hp > 0 && !e.retreating), used = new Set();
    // a focus target that moved out of range or behind cover isn't chased either: back to the attack-move (or hold here)
    const stop = mine.filter(u => !u.air && u.attackId && !retreat.includes(u.id) && (t => t && me.visible.has(t.id) && (t.retreating || d(u, t) > UNITS[u.type].w.range || !los(view, u, t)))(view.units.get(u.attackId)));
    const next = (u) => u.orders?.find(o => o.kind === 2) ?? u;
    if (stop.length) submit({ t: 'amove', orders: stop.map(u => [u.id, next(u).x, next(u).z]) });
    for (let k = 0; k < (mindful ? 1 : 4) && shooters.length - used.size >= 2; k++) {
      let best = null, bestScore = 0, team = null;
      for (const e of targets) {
        const def = UNITS[e.type], full = def.models * def.hpPer, inf = def.infantry;
        // only units that can shoot it from where they stand, and are good against this kind of target (no AT guns on
        // squads, no rifles on tanks)
        const ids = shooters.filter(u => !used.has(u.id) && d(u, e) <= UNITS[u.type].w.range && hit(u, inf) >= 0.5 * Math.max(hit(u, true), hit(u, false)) && los(view, u, e));
        if (ids.length < 2) continue;
        const score = ids.reduce((a, u) => a + dps(u, inf), 0) * def.cost / full * (2 - e.hp / full);
        if (score > bestScore) { best = e; bestScore = score; team = ids; }
      }
      if (!best) break;
      team.forEach(u => used.add(u.id));
      const go = team.filter(u => u.attackId !== best.id && u.targetId !== best.id);
      if (!go.length) continue;
      // an attack order drops the attack-move, so queue it again: once the target is down they carry on to the point
      const resume = go.flatMap(u => {
        const at = u.amove ?? u.orders?.find(o => o.kind === 2);
        return at ? [[u.id, at.x, at.z]] : [];
      });
      submit({ t: 'attack', ids: go.map(u => u.id), target: best.id });
      if (resume.length) submit({ t: 'amove', orders: resume, queue: true });
    }
  }
  if (mindful) for (const u of mine) if (!u.air && !u.autoRetreat && !u.retreating && enemies.some(e => watched(e) && d(u, e) < 40)) arm(u);
  if (armSet.size) submit({ t: 'stance', ids: [...armSet], key: 'autoRetreat', on: true });
  // Rifles do not walk onto armor this seat still remembers. The gun, if one was ordered, stays in that order.
  if (mindful && armorSightings.length) {
    const hot = (x, z) => armorSightings.some(s => Math.hypot((s.x ?? 0) - x, (s.z ?? 0) - z) <= 28);
    const soft = (id) => { const u = view.units.get(id); return !!u && !ANTI_ARMOR.has(u.type); };
    for (const list of [orders, assault_]) for (let i = list.length - 1; i >= 0; i--) if (soft(list[i][0]) && hot(list[i][1], list[i][2])) list.splice(i, 1);
  }
  // Persistent members own their ground orders for this look, while abilities keep their ordinary checks.
  const operationSituation = sit?.kind === 'push' && !sit.at && target && mine.length >= Math.round(L.baseArmy * caution) && strongEnough
    ? { ...sit, at: { x: target.x, z: target.z } } : sit;
  const operation = mindful ? planAssault(view, slot, mind, operationSituation, L, now, { busy, recovering: new Set(retreat), supportAt: mem.called, handoff: opts.handoff, sightings: liveSightings(mem, view, slot, now) }) : { claims: new Set(), commands: [] };
  const controlled = new Set([...operation.claims, ...[...(mind.assaultReleased ?? [])].filter(([,until]) => now < until).map(([id]) => id)]);
  if (controlled.size) {
    for (const list of [orders, assault_]) for (let i = list.length - 1; i >= 0; i--) if (controlled.has(list[i][0])) list.splice(i, 1);
    for (let i = retreat.length - 1; i >= 0; i--) if (controlled.has(retreat[i])) retreat.splice(i, 1);
  }
  if (mindful && sit) {
    const action = sit.kind === 'defense' ? 'hold' : sit.kind === 'wait' ? (sit.safe != null ? 'take-other' : 'prepare') : 'take';
    mind.operation = {
      kind: sit.kind, until: sit.until, point: sit.point ?? null, threatId: sit.threatId ?? null,
      at: sit.at ? { x: sit.at.x, z: sit.at.z } : null, counter: sit.counter ?? null, safe: sit.safe ?? null,
      failedAt: sit.point != null ? (mind.points[sit.point]?.failed ?? sit.failedAt ?? 0) : (sit.failedAt ?? 0),
    };
    mind.decision = { situation: sit.kind, action, buy, aim: mind.aim ? mind.aim.i : (sit.point ?? sit.safe ?? null) };
  } else mind.decision = { buy, aim: mind.aim ? mind.aim.i : null };
  if (retreat.length) submit({ t: 'retreat', ids: retreat });
  if (orders.length) submit({ t: 'move', orders });
  if (assault_.length) submit({ t: 'amove', orders: assault_ });
  for (const cmd of operation.commands) submit(cmd);
}

// Skirmish tech uses only this seat's observation and the same commands as a human.
function buildSkirmishBase(view, slot, squads, submit) {
  const me = view.players[slot], own = [...view.units.values()].filter(b => UNITS[b.type].building && b.hp > 0 && productionAccess(view, b, slot));
  const has = (t, done = false) => own.some(b => b.type === t && (!done || b.built >= 1));
  let next = !has('hq') ? 'hq' : !has('barracks') ? 'barracks' : has('barracks', true) && !has('motorpool') ? 'motorpool' : has('motorpool', true) && !has('airfield') ? 'airfield' : view.naval && !has('shipyard') ? 'shipyard' : null;
  next = techBuild(me.tech, next, has, null);
  const free = squads.filter(u => CFG.fortBuilders.includes(u.type) && !u.retreating && !u.build && !u.targetId && !u.dig && !u.entrench && u.garrison < 0).sort((a,b) => d(a,me.spawn)-d(b,me.spawn));
  const working = squads.some(u => u.build);
  const u = free[0];
  if (!u || working) return next ? UNITS[next].cost : 0;
  const fix = own.filter(b => b.built < 1 || b.hp < UNITS[b.type].hpPer * .8).sort((a,b) => (a.built < 1 ? 0 : 1)-(b.built < 1 ? 0 : 1) || d(u,a)-d(u,b))[0];
  if (fix) { submit({ t:'assist', ids:[u.id], id:fix.id }); return next ? UNITS[next].cost : 0; }
  if (!next || me.mp < UNITS[next].cost) return next ? UNITS[next].cost : 0;
  const home = own.find(b => b.type === 'hq') ?? me.spawn;
  // Try visible nearby sites, including a coast for naval production. Never inspect hidden ground.
  for (const r of [12, 20, 30, 42]) for (let k=0;k<8;k++) {
    const a=k*Math.PI/4, at=siteNear(view,home.x+Math.cos(a)*r,home.z+Math.sin(a)*r,UNITS[next].size);
    if (!at || !placementCheck(view,{kind:next,...at,team:me.team},p=>view.sees(p)).ok) continue;
    if (submit({t:'build',ids:[u.id],kind:next,...at}) === undefined) return 0;
  }
  return UNITS[next].cost;
}

// HQ tiers: a building above my tier waits (`instead` goes up meanwhile); at Company HQ an Armory joins the build order
function techBuild(tech, next, has, instead) {
  if (!tech) return next;
  if (next && tierOf(next) > tech.tier) next = instead;
  return next ?? (tech.tier >= 2 && !has('armory') ? 'armory' : null);
}
// HQ tiers: Company HQ from 2 minutes and Battalion HQ from 6:30 (they finish near 3 and 8 minutes), then the Armory
// lines in turn, Infantry Weapons first. Returns the MP to keep for the next one.
const TIER_AT = { 2: 120, 3: 390 };
function research(view, slot, classic, submit) {
  const me = view.players[slot], tech = me.tech;
  if (!tech || (view.mode?.kind === 'horde' && slot === view.mode.slot)) return 0;
  const busy = new Set(tech.lab.map(([kind]) => kind));
  const lines = Object.keys(TECH.lines).filter(k => !busy.has(k) && tech.armory[k] < tech.tier).sort((a, b) => tech.armory[a] - tech.armory[b]);
  const kind = !busy.has('tier') && tech.tier < 3 && view.tick / 20 >= TIER_AT[tech.tier + 1] ? 'tier' : lines[0];
  const cost = kind && techCost(tech, kind, classic);
  if (!cost) return 0;
  if (me.mp >= cost.mp && !(cost.mun > (me.mun ?? 0)) && submit({ t: 'tech', kind }) === undefined) return 0;
  return kind === 'tier' ? cost.mp : 0; // the Armory only gets spare MP
}

// a Fuel node (tanks) is worth about as much to the AI as a 2.5 MP/s node
const worthOf = (n) => (n.fuel ? 2.5 : n.rate);
// Classic build order for idle Engineers: two depots, a Barracks, a Motor Pool, then the remaining nodes.
// Damaged buildings get repaired and unfinished sites get help first. Returns the MP to keep for the next building.
function buildEconomy(view, slot, engineers, needArmor, mem, submit) {
  const me = view.players[slot], own = gridFor(view).ownedBy(slot).filter(b => UNITS[b.type].building);
  const has = (t, done) => own.some(b => b.type === t && (!done || b.built >= 1));
  const hq = own.find(b => b.type === 'hq') ?? me.spawn, cx = view.w * CELL / 2, cz = view.h * CELL / 2;
  const depots = own.filter(b => b.type === 'depot').length, free = view.nodes.filter((n, i) => !view.claimedNodes.has(i) && ownedGround(view, me.team, n));
  const planesNear = gridFor(view).radius(hq, 60).some(e => me.visible.has(e.id) && e.air && !allied(view, e.owner, slot) && d(e, hq) < 60);
  let next = view.mode?.kind === 'world' && !has('hq') ? 'hq' : depots < 2 && free.length && !(needArmor && has('barracks', true) && !has('motorpool')) ? 'depot' : !has('barracks') ? 'barracks' : has('barracks', true) && !has('motorpool') ? 'motorpool'
    : planesNear && own.filter(b => b.type === 'flakpos').length < 2 ? 'flakpos' : free.length ? 'depot' : has('motorpool', true) && !has('airfield') && depots >= 3 ? 'airfield' : null;
  next = techBuild(me.tech, next, has, free.length ? 'depot' : null);
  const ids = new Set(engineers.map(u => u.id));
  for (const id of mem.node.keys()) if (!ids.has(id)) mem.node.delete(id);
  const taken = new Set(engineers.map(u => mem.node.get(u.id)).filter(n => n !== undefined));
  for (const u of engineers) {
    if (u.retreating || u.build) continue;
    const fix = own.filter(b => b.built < 1 || b.hp < UNITS[b.type].hpPer * 0.7).sort((a, b) => d(u, a) - d(u, b))[0];
    if (fix && d(u, fix) < 60) { submit({ t: 'assist', ids: [u.id], id: fix.id }); continue; }
    if (next === 'depot') {
      const pick = free.map(n => ({ n, i: view.nodes.indexOf(n) })).filter(({ i }) => !taken.has(i) || mem.node.get(u.id) === i).sort((a, b) => d(u, a.n) - worthOf(a.n) * 20 - (d(u, b.n) - worthOf(b.n) * 20))[0]; // richer nodes are worth a walk
      if (!pick) continue;
      mem.node.set(u.id, pick.i); taken.add(pick.i);
      if (me.mp >= UNITS.depot.cost && view.sees(pick.n)) submit({ t: 'build', ids: [u.id], kind: 'depot', x: pick.n.x, z: pick.n.z });
      else if (!u.path.length) submit({ t: 'move', orders: [[u.id, pick.n.x, pick.n.z]] });
    } else if (next) {
      // behind the HQ's front: a little toward the map center, off to one side
      const a = Math.atan2(cz - hq.z, cx - hq.x) + ({ barracks: 0.9, motorpool: -0.9, airfield: Math.PI, flakpos: (Math.random() - 0.5) * 2 }[next] ?? 0), spot = siteNear(view.mode?.kind === 'world' ? { ...view, players: view.players.filter(p => p.spawn) } : view, hq.x + Math.cos(a) * 16, hq.z + Math.sin(a) * 16, UNITS[next].size);
      if (spot && ownedGround(view, me.team, spot) && me.mp >= UNITS[next].cost) submit({ t: 'build', ids: [u.id], kind: next, x: spot.x, z: spot.z });
    }
  }
  return next && next !== 'depot' ? UNITS[next].cost : 0;
}

function ownedGround(view, team, at) {
  if (view.mode?.kind !== 'world') return true;
  return view.world?.regions.some(r => r.team === team && insideRegion(r, at));
}

function insideRegion(region, at) {
  return insideKnownRegion(region, at, CELL);
}

function worldFrontier(view, from) {
  // Build candidates once per planning turn, then each squad chooses from this small frontier list.
  if (!view.frontiers) {
    view.frontiers = [];
    for (let z = 1; z < view.h - 1; z += 2) for (let x = 1; x < view.w - 1; x += 2) {
      const c = z * view.w + x;
      if (view.chars[c] === '?' || view.flags[c] & MOVE) continue;
      if ([c - 1, c + 1, c - view.w, c + view.w].some(n => view.chars[n] === '?'))
        view.frontiers.push({ x: (x + 0.5) * CELL, z: (z + 0.5) * CELL });
    }
  }
  let best = null, distance = Infinity;
  for (const at of view.frontiers) {
    const dd = d(from, at);
    if (dd < 3 || dd >= distance) continue;
    best = at; distance = dd;
  }
  return best;
}
