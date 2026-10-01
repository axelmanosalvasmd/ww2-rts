// The AI plans from the same rows a human receives. Only command() can change the game.
import { CELL, TERRAIN, UNITS, snapshotFor, terrainFor, teamSees } from './sim.js';

const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const copy = (value) => value === undefined ? undefined : structuredClone(value);
const worth = (u) => UNITS[u.type].cost * u.hp / (UNITS[u.type].models * UNITS[u.type].hpPer);
const cellAt = (view, x, z) => Math.floor(z / CELL) * view.w + Math.floor(x / CELL);

function decodeUnit(row) {
  const [id, type, owner, x, z, rot, aim, hp, supp, targetId, cover, cd, flags, veterancy, built] = row;
  const u = { id, type, owner, x, z, rot, aim, hp, supp, targetId, cover, cd, flags, veterancy, built,
    path: [], orders: [], attackId: 0, retreating: !!(flags & 1), buff: flags & 2 ? 1 : 0,
    ap: !!(flags & 4), reinf: flags & 8 ? 1 : 0, dig: flags & 16 ? {} : null,
    garrison: flags & 32 ? 0 : -1, amove: null, build: flags & 128 ? 1 : 0,
    enter: -1, fireAt: -1, nade: null,
    // 1024 marks a mass entrenchment for everyone; the stances and autocast (2048 and up) are sent to the owner only
    entrench: flags & 1024 ? {} : null, holdFire: !!(flags & 2048), holdPos: !!(flags & 4096), autoRetreat: !!(flags & 8192), auto: !!(flags & 16384) };
  // Other seats' aircraft expose only whether they are grounded.
  if (UNITS[type].air) u.air = { state: flags & 512 ? 'base' : 'out' };
  return u;
}

function decodeOwn(view, snap) {
  for (const [id, kind, x, z, ...waypoints] of snap.plans) {
    const u = view.units.get(id);
    if (!u) continue;
    for (let i = 0; i < waypoints.length; i += 2) u.path.push({ x: waypoints[i], z: waypoints[i + 1] });
    const at = { x, z };
    if (kind === 2) u.amove = at;
    else if (kind === 4) u.attackId = u.targetId || 1;
    else if (kind === 5) u.fireAt = cellAt(view, x, z);
    else if (kind === 6) u.nade = at;
    else if (kind === 7 && u.dig) u.dig = at; // an entrenching squad reports kind 7 between segments too, but is not digging one
    else if (kind === 8) u.build = 1;
    else if (kind === 9) u.enter = cellAt(view, x, z);
    if (u.air && kind) u.air.mission = { kind: kind === 4 ? 'attack' : 'move', x, z };
  }
  for (const [id, progress, x, z, ...queue] of snap.queues) {
    const u = view.units.get(id);
    if (!u) continue;
    u.queue = [...queue]; u.prog = progress; u.rally = x < 0 ? null : { x, z };
  }
  for (const [id, state, fuel, ammo, timer] of snap.air) {
    const u = view.units.get(id);
    if (u) Object.assign(u.air, { state: ['base', 'out', 'station', 'home', 'rearm'][state], fuel, ammo, timer });
  }
  for (const [id, count, ...orders] of snap.orders) {
    const u = view.units.get(id);
    if (!u) continue;
    for (let i = 0; i < count; i++) u.orders.push({ kind: orders[i * 3], x: orders[i * 3 + 1], z: orders[i * 3 + 2] });
  }
}

function remember(view, slot, memory) {
  const now = view.tick / 20, visible = view.players[slot].visible;
  memory.seen ??= new Map(); memory.still ??= new Map();
  for (const id of memory.still.keys()) if (!visible.has(id)) memory.still.delete(id);
  for (const id of visible) {
    const u = view.units.get(id), old = memory.still.get(id);
    const stationary = old && distance(old, u) <= 0.1 + 1e-9;
    const observation = stationary ? old : { x: u.x, z: u.z, since: now };
    memory.still.set(id, observation); u.firstStillAt = observation.since;
    if (!UNITS[u.type].structure) memory.seen.set(id, { id, type: u.type, owner: u.owner, x: u.x, z: u.z, t: now, val: worth(u) });
  }
  for (const [id, sighting] of memory.seen) if (now - sighting.t > 60) memory.seen.delete(id);
  view.sightings = [...memory.seen.values()].map(sighting => ({ ...sighting }));
}

function updateTerrain(memory, changes, length) {
  const old = memory.terrain;
  let chars = old.chars, flags = old.flags, height = old.height;
  // Terrain delivers a seat only the mines its own side laid, so every N it learns of after the start is its own.
  // (A mine painted in the map belongs to nobody and is not counted.)
  const mines = memory.mines ??= new Set();
  for (const [c, ch, level] of changes) {
    if (ch === 'N' && memory.mapChars[c] !== 'N') mines.add(c); else mines.delete(c);
    if (chars[c] !== ch) {
      if (chars === old.chars) chars = [...chars];
      if (flags === old.flags) flags = [...flags];
      chars[c] = ch; flags[c] = TERRAIN[ch] ?? 0;
    }
    if (level !== undefined && (!height || height[c] !== level)) {
      if (height === old.height) height = height ? [...height] : Array(length).fill(0);
      height[c] = level;
    }
  }
  // Old delivered views keep their terrain version when a later snapshot reveals an edit.
  if (chars !== old.chars || height !== old.height) memory.terrain = Object.freeze({
    chars: chars === old.chars ? chars : Object.freeze(chars),
    flags: flags === old.flags ? flags : Object.freeze(flags),
    height: height === old.height ? height : Object.freeze(height),
  });
}

export function viewFor(g, slot, memory = {}, cache) {
  const seat = g.players[slot];
  if (!g.initialTerrain) throw new Error('AI view requires the starting terrain');
  const first = !memory.terrain;
  if (first) {
    memory.terrain = Object.freeze({
      chars: Object.freeze([...g.initialTerrain.chars]),
      flags: Object.freeze(g.initialTerrain.chars.map(ch => TERRAIN[ch] ?? 0)),
      height: g.initialTerrain.height ? Object.freeze([...g.initialTerrain.height]) : null,
    });
    // A human handover keeps the cells that seat already discovered.
    memory.mapChars = memory.terrain.chars; memory.mapHeight = memory.terrain.height;
    memory.terrainCells = new Map([...(seat.terrainMemory ?? [])].map(([c, row]) => [c, [...row]]));
  }
  // snapshotFor consumes terrain updates. Keep those writes in AI memory, away from the live player.
  const players = [...g.players];
  players[slot] = { ...seat, terrainMemory: memory.terrainCells, terrainPending: new Set(g.cellLog.keys()) };
  const projection = { ...g, players, skipFog: true }; // no fog masks: the AI plans from units and terrain, not from what a client draws
  const seed = first ? terrainFor(projection, slot, true) : [];
  const snap = snapshotFor(projection, slot, [], [], cache);
  updateTerrain(memory, first ? [...seed, ...snap.cells] : snap.cells, g.w * g.h);
  const view = {
    w: g.w, h: g.h, tick: snap.tick, winner: snap.winner, end: copy(snap.end), winVp: g.winVp,
    chars: memory.terrain.chars, flags: memory.terrain.flags, height: memory.terrain.height,
    mapChars: memory.mapChars, mapHeight: memory.mapHeight, // the map as the file every client downloads shows it
    units: new Map(snap.units.map(row => { const u = decodeUnit(row); return [u.id, u]; })),
    players: g.players.map((p, i) => ({ slot: i, name: p.name, team: p.team, faction: p.faction, spawn: { ...p.spawn }, out: snap.out[i], vp: snap.vp[i] })),
    points: g.points.map((p, i) => ({ x: p.x, z: p.z, vp: p.vp, mp: p.mp,
      owner: snap.points[i][0], capper: snap.points[i][1], progress: snap.points[i][2], contested: !!snap.points[i][3], cut: !!snap.points[i][4] })),
    nodes: (snap.nodes ?? []).map(([x, z, rate, fuel]) => ({ x, z, rate, fuel: !!fuel })),
    // my side's own mines, and apart from them the enemy mines its builder squads have found
    mines: [...(memory.mines ?? [])].filter(c => !snap.foundMines.includes(c)).map(c => ({ x: (c % g.w + 0.5) * CELL, z: (Math.floor(c / g.w) + 0.5) * CELL })),
    foundMines: snap.foundMines.map(c => ({ x: (c % g.w + 0.5) * CELL, z: (Math.floor(c / g.w) + 0.5) * CELL })),
    // the match weather every player is told: now, and just before it turns, what comes next and in how many seconds
    weather: { now: snap.weather?.[0] ?? 'clear', next: snap.weather?.[1], left: snap.weather?.[2] },
    mode: copy(snap.mode), army: copy(snap.army),
    smokes: snap.smokes.map(([x, z, r]) => ({ x, z, r })),
    strikes: snap.strikes.map(([kind, x, z, dir, t, owner]) => ({ kind, x, z, dir, t, owner, live: t <= 0 })),
    covers: snap.covers.map(([x, z, r, t]) => ({ x, z, r, t })),
    ghosts: (snap.ghosts ?? []).map(([id, type, owner, x, z, built]) => ({ id, type, owner, x, z, built })),
  };
  const me = view.players[slot];
  Object.assign(me, { mp: snap.mp, mun: snap.mun, fuel: snap.fuel, inc: snap.inc, fuelInc: snap.fuelInc,
    upkeep: snap.upkeep, sup: { ...snap.sup }, rally: snap.rally ? { x: snap.rally[0], z: snap.rally[1] } : null,
    visible: new Set([...view.units.values()].filter(u => view.players[u.owner].team !== me.team).map(u => u.id)) });
  decodeOwn(view, snap);
  remember(view, slot, memory);
  const known = new Map(view.ghosts.map(b => [b.id, b]));
  memory.buildingSeen ??= new Map();
  for (const u of view.units.values()) if (UNITS[u.type].building && view.players[u.owner].team !== me.team) {
    known.set(u.id, { id: u.id, type: u.type, owner: u.owner, x: u.x, z: u.z, built: u.built });
    memory.buildingSeen.set(u.id, view.tick / 20);
  }
  for (const id of memory.buildingSeen.keys()) if (!known.has(id)) memory.buildingSeen.delete(id);
  // A handover can remember a building without knowing when the human last saw it.
  view.ghosts = [...known.values()].map(b => ({ ...b, t: memory.buildingSeen.get(b.id) ?? null }));
  view.knownBuildings = view.ghosts;
  // Only depots occupy a node. A Barracks that happens to stand close by does not.
  const claims = [...view.units.values()].filter(u => u.type === 'depot' && view.players[u.owner].team === me.team)
    .concat(view.ghosts.filter(b => b.type === 'depot'));
  view.claimedNodes = new Set(view.nodes.flatMap((node, i) => claims.some(b => distance(b, node) < 8) ? [i] : []));
  view.sees = (at) => teamSees(view, me.team, at);
  return view;
}
