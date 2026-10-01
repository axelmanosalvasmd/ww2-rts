// Pure game logic. The server runs it; the client imports the tables for rendering.
// Coordinates: world metres, x right, z down the map rows. Grid cells are CELL metres.

export const CELL = 2;
export const TICK = 1 / 20;
export const CFG = {
  vpToWin: 1200, mpStart: 150,
  // Assault mode: attackers must destroy every defender's command bunker before the clock runs out.
  assault: { time: 900, directMul: 0.25, supportMul: 0.05, attackerMp: 320, attackerBase: 5, defenderMp: 250, defenderBase: 3.5, fortRadius: 11 },
  // flat income does most of the work; points add a little and trailing players catch up
  mpBase: 4, catchupMax: 6, catchupPer: 60,
  captureTime: 8, pointRadius: 8, popCap: 12,
  retreatSpeed: 1.5, retreatDamage: 0.25, reinforceRadius: 15, reinforceEvery: 2,
  // incoming accuracy/suppression multipliers; blasts only care about trenches
  coverMul: 0.5, trenchMul: 0.35, trenchBlastMul: 0.5,
  digCost: 30, digCells: 4, digTime: 3, camoRange: 12,
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
  // Classic mode: build a base. MP from an HQ trickle plus Supply Depots on resource nodes, Munitions from points.
  // depots pay per node: safe home nodes less than the contested ones by the villages. upkeep: each fielded unit costs
  // this share of its price per second, off the income (never below minInc)
  classic: { time: 1500, mpStart: 200, trickle: 3, homeRate: 2.5, contestedFuel: 1.5, hqFuel: 0.5, upkeep: 0.0008, minInc: 0.5, munPerVp: 1.5, startForce: ['engineer', 'rifle'], buildReach: 2.5, crew: 0.72, repair: 0.005, smallArms: 0.25,
    // a bigger army than Conquest (the economy grows), and Sudden Death: Production Buildings lose decay x max hp per second
    popCap: 20, decay: 0.01,
    // adaptive AI: attack a base only with an army worth this much more than the enemy it saw in the last window seconds
    aiAttackRatio: 1.1, aiSeenWindow: 30 },
};

export const MOVE = 1, SIGHT = 2, COVER = 4, TRENCH = 8, FORD = 16;
// T trench (heavy cover, diggable) · W river (impassable, see across) · F ford (wade at half speed)
// = bridge (walkable, can be blown) · R rubble (what's left of a house: walkable cover)
// K = footprint of a Classic building (never in map files): solid until the building falls, then rubble
export const TERRAIN = { '.': 0, B: MOVE | SIGHT, H: SIGHT | COVER, '#': COVER, '+': COVER, T: COVER | TRENCH, W: MOVE, F: FORD, '=': 0, R: COVER, K: MOVE | SIGHT };

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

// Mortar team: lobs one shell at anything its side can see (no line of sight needed); out-ranges MGs, breaks dug-in squads.
UNITS.mortar = { name: 'Mortar Team', cost: 180, models: 3, hpPer: 20, speed: 3, radius: 1.4, vision: 30, infantry: true,
  w: { range: 50, minRange: 12, interval: 8, setup: 2, inf: 24, veh: 8, accInf: 1, accVeh: 1, supp: 35,
    salvo: true, rockets: 1, spread: 3.5, blast: 3, terrain: 60, antiGarrison: 1.2, flight: 1.5, every: 0.1 },
  ab: { id: 'barrage', name: 'Mortar Barrage', cd: 40, range: 50, shells: 4, mun: 15 } };
// Sniper: shooter + spotter. One shot, one soldier, at long range; must stand still. Camouflaged while it keeps still.
UNITS.sniper = { name: 'Sniper', cost: 160, models: 2, hpPer: 20, speed: 4.2, radius: 1.2, vision: 46, infantry: true, garrisons: true, camo: true,
  w: { range: 55, interval: 5, inf: 25, veh: 0, accInf: 0.85, accVeh: 0, supp: 30, setup: 1 },
  ab: { id: 'none', name: '', cd: 1e9 } };
// Armored car: the fastest thing on the map. Scouts, raids, hunts snipers and mortars; fires on the move, weak vs tanks.
UNITS.armoredcar = { name: 'Armored Car', cost: 220, models: 1, hpPer: 170, speed: 9, radius: 2, vision: 44, infantry: false,
  w: { range: 28, interval: 1, inf: 4, veh: 6, accInf: 0.45, accVeh: 0.4, supp: 8, moveFire: 0.7 },
  ab: { id: 'smoke', name: 'Smoke', cd: 45, dur: 14, radius: 9 } };
// Medium tank (Sherman / Panzer IV / T-34): the mainline tank, between the light tank and the Tiger.
UNITS.medium = { name: 'Medium Tank', cost: 380, models: 1, hpPer: 600, speed: 5.5, radius: 2.7, vision: 40, infantry: false, crushes: true,
  w: { range: 38, interval: 3.5, inf: 35, veh: 80, accInf: 0.6, accVeh: 0.75, supp: 25, moveFire: 0.8, shellTerrain: 110 },
  ab: { id: 'smoke', name: 'Smoke', cd: 45, dur: 14, radius: 9 } };

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
// Assault mode's objective: an immobile concrete bunker with an MG slit. Direct fire does 25%, explosives full damage.
UNITS.bunker = { name: 'Command Bunker', faction: -1, cost: 0, models: 1, hpPer: 3000, speed: 0, radius: 3, vision: 40, infantry: false, structure: true,
  w: { range: 36, interval: 0.4, inf: 3, veh: 0.5, accInf: 0.5, accVeh: 0.4, supp: 8 },
  ab: { id: 'none', name: '', cd: 1e9 } };
// ---------- Classic mode ----------
// Engineers build the base. A weak rifle squad; only the HQ trains them, only in Classic.
UNITS.engineer = { name: 'Engineer Squad', classic: true, cost: 60, models: 3, hpPer: 20, speed: 4.5, radius: 1.4, vision: 34, infantry: true, garrisons: true,
  w: { range: 24, interval: 1.8, inf: 2.4, veh: 0.3, accInf: 0.6, accVeh: 0.6, supp: 3, perModel: true, moveFire: 0.5 },
  ab: { id: 'none', name: '', cd: 1e9 } };
// Buildings: stamped size x size cells, hp on the entity. produces = counts for Annihilation.
const building = (o) => ({ faction: -1, models: 1, speed: 0, infantry: false, structure: true, building: true, w: null, ab: { id: 'none', name: '', cd: 1e9 }, ...o });
// makes = what it trains; needs = a finished building you must own first
UNITS.hq = building({ name: 'HQ', cost: 0, hpPer: 3000, radius: 3, vision: 30, size: 3, produces: true, makes: ['engineer', 'rifle'] });
UNITS.depot = building({ name: 'Supply Depot', cost: 60, hpPer: 600, radius: 2, vision: 16, size: 2, buildTime: 20 });
UNITS.barracks = building({ name: 'Barracks', cost: 150, hpPer: 1500, radius: 3, vision: 24, size: 3, buildTime: 30, produces: true, makes: ['mg', 'mortar', 'sniper', 'ranger', 'conscript'] });
UNITS.motorpool = building({ name: 'Motor Pool', cost: 200, hpPer: 1900, radius: 3, vision: 24, size: 3, buildTime: 45, produces: true, needs: 'barracks', makes: ['at', 'armoredcar', 'tank', 'medium', 'rocket', 'tiger'] });
export const BUILDABLE = ['depot', 'barracks', 'motorpool'];
// Classic: seconds to train each unit at its building
for (const [t, s] of Object.entries({ engineer: 12, rifle: 15, conscript: 12, mg: 18, mortar: 20, sniper: 20, ranger: 20, at: 22, armoredcar: 25, rocket: 30, tank: 35, medium: 40, tiger: 50 })) UNITS[t].train = s;
// Classic: vehicles cost Fuel and less MP
for (const [t, mp, fuel] of [['armoredcar', 160, 25], ['tank', 200, 60], ['medium', 260, 90], ['rocket', 170, 50], ['tiger', 420, 150]]) Object.assign(UNITS[t], { classicCost: mp, fuel });
export const priceOf = (g, t) => (g.mode?.kind === 'classic' ? { mp: UNITS[t].classicCost ?? UNITS[t].cost, fuel: UNITS[t].fuel ?? 0 } : { mp: UNITS[t].cost, fuel: 0 });
export const UNIT_TYPES = Object.keys(UNITS);
export const canBuild = (type, faction) => UNITS[type].faction === undefined || UNITS[type].faction === faction;
// same team (a player is always allied with itself); -1 = nobody
export const allied = (g, a, b) => a >= 0 && b >= 0 && g.players[a].team === g.players[b].team;

// Off-map support bought with manpower. Every strike is announced to all players `delay` seconds ahead.
export const SUPPORT = {
  recon: { name: 'Recon Flight', cost: 60, cd: 45, delay: 3, dur: 15, len: 80, width: 30 },
  artillery: { name: 'Artillery Barrage', cost: 150, cd: 60, delay: 5, len: 24, width: 10, shells: 10, every: 0.4, blast: 4, dig: 0, inf: 30, veh: 35, supp: 60, terrain: 90 },
  strafe: { name: 'Strafing Run', cost: 200, cd: 90, delay: 5, len: 36, width: 8, inf: 25, veh: 10, supp: 80 },
  smoke: { name: 'Smoke Barrage', cost: 50, cd: 40, delay: 3, len: 36, width: 14, clouds: 5, cloud: 7, dur: 20 },
  // a stick of heavy bombs along the line: flattens houses, big craters, deadly to tanks
  bombing: { name: 'Bombing Run', cost: 250, cd: 120, delay: 6, len: 40, width: 8, shells: 6, every: 0.2, blast: 7, dig: 1, inf: 60, veh: 150, supp: 90, terrain: 400 },
};
export const SUPPORT_TYPES = Object.keys(SUPPORT);
const SUPPORT_SRC = new Set(Object.values(SUPPORT));
// Classic prices support in Munitions (mun) instead of manpower
Object.assign(SUPPORT.recon, { mun: 25 }); Object.assign(SUPPORT.artillery, { mun: 60 }); Object.assign(SUPPORT.strafe, { mun: 80 });
Object.assign(SUPPORT.smoke, { mun: 20 }); Object.assign(SUPPORT.bombing, { mun: 100 });
// Classic: unit abilities cost Munitions on top of their cooldown
export const AB_MUN = { grenade: 15, suppress: 10, ap: 15, smoke: 10, satchel: 30, ura: 10, barrage: 25 };
export const abCost = (g, ab) => (g.mode?.kind === 'classic' ? ab.mun ?? AB_MUN[ab.id] ?? 0 : 0);
// pay for an ability as it's used; false if the owner can't afford it
function payAb(g, u) {
  const c = abCost(g, UNITS[u.type].ab), p = g.players[u.owner];
  if (!c) return true;
  if (!(p.mun >= c)) return false;
  p.mun -= c;
  return true;
}
export const popCap = (g) => (g.mode?.kind === 'classic' ? CFG.classic.popCap : CFG.popCap);
export const supCost = (g, k) => (g.mode?.kind === 'classic' ? { cur: 'mun', cost: SUPPORT[k].mun } : { cur: 'mp', cost: SUPPORT[k].cost });

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
  for (const r of m.rows) if (typeof r !== 'string' || r.length !== m.w || [...r].some(ch => !Object.hasOwn(TERRAIN, ch) || ch === 'K')) return 'rows must be ' + m.w + ' valid terrain chars';
  if (m.heights !== undefined && (!Array.isArray(m.heights) || m.heights.length !== m.h
    || m.heights.some(r => typeof r !== 'string' || r.length !== m.w || !/^[0-4ab]*$/.test(r)))) return 'heights must be ' + m.h + ' rows of 0-4 (a/b for depths -1/-2)';
  const at = (p) => m.rows[p.y][p.x];
  if (!Array.isArray(m.spawns) || m.spawns.length < 2 || m.spawns.length > MAX_PLAYERS) return 'needs 2-' + MAX_PLAYERS + ' spawns';
  for (const sp of m.spawns) if (!sp || !int(sp.x, 0, m.w - 1) || !int(sp.y, 0, m.h - 1) || TERRAIN[at(sp)] & MOVE) return 'spawns must be on open ground inside the map';
  if (m.spawns.some(sp => sp.assault !== undefined && typeof sp.assault !== 'boolean')) return 'spawn assault flag must be true or false';
  if (m.spawns.filter(sp => !sp.assault).length < 2) return 'needs 2+ spawns that every mode can use';
  if (m.assaultTime !== undefined && !(Number.isInteger(m.assaultTime) && m.assaultTime >= 300 && m.assaultTime <= 3600)) return 'assaultTime must be 300-3600 seconds';
  if (m.defend !== undefined && (!Array.isArray(m.defend) || !m.defend.length || m.defend.length >= m.spawns.length
    || m.defend.some(i => !int(i, 0, m.spawns.length - 1)) || new Set(m.defend).size !== m.defend.length)) return 'defend must list some (not all) spawn numbers';
  if (!Array.isArray(m.points) || m.points.length < 1 || m.points.length > 9) return 'needs 1-9 capture points';
  for (const p of m.points) if (!p || !int(p.x, 0, m.w - 1) || !int(p.y, 0, m.h - 1) || TERRAIN[at(p)] & MOVE || !numIn(p.vp ?? 1, 0, 5) || !numIn(p.mp ?? 1, 0, 5)) return 'points must be on open ground, vp and mp 0-5';
  return null;
}

export const MAX_PLAYERS = 6;
// spawns a mode can use: an `assault: true` spawn (say, inside the defenders' fortress) only exists in Assault
export const spawnsFor = (map, mode) => map.spawns.map((s, i) => i).filter(i => mode === 'assault' || !map.spawns[i].assault);
// team VP needed to win: scaled by average team size, so a 3v3 lasts about as long as a 1v1
export const winVp = (teams) => CFG.vpToWin * teams.length / new Set(teams).size;

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
// opts.mode: 'conquest' (default, VP race), 'assault' (opts.defenderTeam defends; everyone else attacks as one team)
// or 'classic' (base building, won by Annihilation)
export function createGame(map, names, shuffle = true, teams = names.map((_, i) => i), factions = names.map((_, i) => i % 3), opts = {}) {
  const assault = opts.mode === 'assault';
  if (assault) {
    const attackerTeam = teams.find(t => t !== opts.defenderTeam) ?? opts.defenderTeam + 1;
    teams = teams.map(t => (t === opts.defenderTeam ? t : attackerTeam));
  }
  const usable = spawnsFor(map, opts.mode), spawnIdx = spawnSlots(usable.length, teams, shuffle).map(k => usable[k]);
  // assault maps can reserve spawns for the defenders (a hilltop, a town); attackers get the rest
  if (assault && map.defend?.length) {
    const att = map.spawns.map((_, i) => i).filter(i => !map.defend.includes(i));
    let d = 0, a = 0;
    teams.forEach((t, i) => { spawnIdx[i] = t === opts.defenderTeam ? map.defend[d++ % map.defend.length] : att[a++ % att.length]; });
  }
  const g = {
    w: map.w, h: map.h, flags: new Uint8Array(map.w * map.h),
    tick: 0, nextId: 1, winVp: winVp(teams), units: new Map(), shots: [], nades: [], salvos: [], smokes: [], strikes: [], winner: null,
    // terrain changed mid-match: full log for (re)joining clients, plus what's new since the last snapshot
    cellLog: [], newCells: [],
    players: names.map((name, slot) => {
      const s = map.spawns[spawnIdx[slot]];
      return { slot, name, team: teams[slot], faction: factions[slot], vp: 0, mp: CFG.mpStart, inc: CFG.mpBase, sup: Object.fromEntries(SUPPORT_TYPES.map(k => [k, 0])), spawn: { x: (s.x + 0.5) * CELL, z: (s.y + 0.5) * CELL }, visible: new Set() };
    }),
    // vp/mp per second while held; the map can make some points worth more
    // Assault has no VP, so points that only pay VP are left out (clients filter the same way)
    points: map.points.filter(p => !assault || (p.mp ?? 1) > 0).map(p => ({ x: (p.x + 0.5) * CELL, z: (p.y + 0.5) * CELL, vp: p.vp ?? 1, mp: p.mp ?? 1, owner: -1, capper: -1, progress: 0 })),
  };
  map.rows.forEach((row, y) => [...row].forEach((ch, x) => { g.flags[y * map.w + x] = TERRAIN[ch] ?? 0; }));
  g.chars = [...map.rows.join('')];
  g.cellHp = Float32Array.from(g.chars, ch => CFG.terrainHp[ch] ?? 0);
  g.height = Int8Array.from((map.heights || []).join(''), levelOf);
  if (g.height.length !== g.w * g.h) g.height = null; // flat map: skip all elevation math
  if (opts.mode === 'classic') setupClassic(g);
  for (const p of g.players) (g.mode?.kind === 'classic' ? CFG.classic.startForce : CFG.startForce).forEach((t, i) => spawnUnit(g, p.slot, t, i));
  if (assault) setupAssault(g, opts.defenderTeam, map.assaultTime);
  return g;
}

// time: the map's own clock in seconds (big maps take longer to cross), else the default
function setupAssault(g, defenderTeam, time) {
  const A = CFG.assault;
  g.mode = { kind: 'assault', defenderTeam, attackerTeam: g.players.find(p => p.team !== defenderTeam)?.team ?? -1, timeLeft: time ?? A.time };
  const cx = g.w * CELL / 2, cz = g.h * CELL / 2;
  for (const p of g.players) {
    const defending = p.team === defenderTeam;
    p.mp = defending ? A.defenderMp : A.attackerMp;
    if (!defending) continue;
    // fortify the side of the base that faces the map center: a trench line, then sandbag walls, with gaps to move through
    const toward = Math.atan2(cz - p.spawn.z, cx - p.spawn.x), r = A.fortRadius;
    for (let a = -0.9; a <= 0.9; a += 0.04) for (const [rr, ch, gap] of [[r, 'T', 0.35], [r + 2, '#', 0.25]]) {
      if (Math.abs((a / gap) % 2) > 1.6) continue; // leave gaps
      const c = cellOf(g, p.spawn.x + Math.cos(toward + a) * rr * CELL, p.spawn.z + Math.sin(toward + a) * rr * CELL);
      if (c >= 0 && g.chars[c] === '.') setCell(g, c, ch);
    }
    // the bunker sits between the HQ and the fortifications
    const b = spawnUnit(g, p.slot, 'bunker');
    const at = nearestFree(g, p.spawn.x + Math.cos(toward) * 5 * CELL / 2, p.spawn.z + Math.sin(toward) * 5 * CELL / 2);
    Object.assign(b, cellCenter(g, at), { rot: toward, aim: toward });
  }
}

// ---------- Classic: buildings and resource nodes ----------
const footprint = (g, c, size) => {
  const x0 = c % g.w, y0 = Math.floor(c / g.w), out = [];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) out.push((y0 + y) * g.w + x0 + x);
  return x0 + size <= g.w && y0 + size <= g.h ? out : null;
};
// open, flat ground with nothing built on it (craters and trenches get filled in)
const canStamp = (g, cells) => !!cells && cells.every(c => !(g.flags[c] & MOVE) && !'WF=K'.includes(g.chars[c]) && level(g, c) === level(g, cells[0]));
const footCenter = (g, c, size) => ({ x: (c % g.w + size / 2) * CELL, z: (Math.floor(c / g.w) + size / 2) * CELL });

// place a building (finished, or a Construction Site at 25% hp) with its top-left cell at c
function placeBuilding(g, owner, type, c, finished) {
  const def = UNITS[type], cells = footprint(g, c, def.size), max = def.hpPer;
  for (const k of cells) setCell(g, k, 'K');
  const u = spawnUnit(g, owner, type);
  Object.assign(u, footCenter(g, c, def.size), { cells, built: finished ? 1 : 0, hp: finished ? max : max * 0.25, queue: [], prog: 0, rally: null });
  return u;
}
// a building works through its queue; each finished unit steps out on the side facing its rally point
function train(g, b, dt) {
  const type = b.queue[0];
  if ((b.prog += dt) < UNITS[type].train) return;
  b.prog = 0; b.queue.shift();
  const to = b.rally ?? { x: g.w * CELL / 2, z: g.h * CELL / 2 }, a = Math.atan2(to.z - b.z, to.x - b.x), r = UNITS[b.type].radius + 2;
  const u = spawnUnit(g, b.owner, type), c = nearestFree(g, b.x + Math.cos(a) * r, b.z + Math.sin(a) * r);
  Object.assign(u, cellCenter(g, c), { rot: a, aim: a });
  if (b.rally) u.path = findPath(g, u, b.rally);
}
function wreckBuilding(g, u) {
  for (const c of u.cells) setCell(g, c, 'R');
  g.shots.push({ k: 'collapse', x: u.x, z: u.z, pub: true });
  for (const n of g.nodes ?? []) if (n.depot === u.id) n.depot = 0;
}
// the first spot at or around (x, z) where a size x size building fits, clear of spawns, points and other nodes
function findSite(g, x, z, size, avoid = []) {
  const start = cellOf(g, Math.min(g.w * CELL - 1, Math.max(0, x)), Math.min(g.h * CELL - 1, Math.max(0, z)));
  const seen = new Set([start]), q = [start];
  for (let i = 0; i < q.length && i < 4000; i++) {
    const c = q[i], at = footCenter(g, c, size);
    if (canStamp(g, footprint(g, c, size)) && avoid.every(([p, r]) => dist(p, at) >= r)) return c;
    const cx = c % g.w, cy = Math.floor(c / g.w);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy, n = ny * g.w + nx;
      if (nx >= 0 && ny >= 0 && nx < g.w && ny < g.h && !seen.has(n)) { seen.add(n); q.push(n); }
    }
  }
  return -1;
}
function setupClassic(g) {
  const C = CFG.classic, cx = g.w * CELL / 2, cz = g.h * CELL / 2;
  g.mode = { kind: 'classic', timeLeft: C.time, teams: new Set(g.players.map(p => p.team)).size };
  // the HQ sits on the spawn, on ground cleared for it
  for (const p of g.players) {
    p.mp = C.mpStart; p.mun = 0; p.fuel = 0;
    const c = cellOf(g, p.spawn.x, p.spawn.z) - g.w - 1, cells = footprint(g, c, 3);
    if (!cells) continue;
    for (const k of cells) setCell(g, k, '.');
    placeBuilding(g, p.slot, 'hq', c, true);
  }
  // resource nodes (2x2): two safe ones per HQ toward its flanks, one beside every point that pays manpower
  const avoid = [...g.players.map(p => [p.spawn, 10]), ...g.points.map(p => [p, CFG.pointRadius + 3])];
  const want = [];
  for (const p of g.players) {
    const a = Math.atan2(cz - p.spawn.z, cx - p.spawn.x);
    for (const side of [-1, 1]) want.push({ x: p.spawn.x + Math.cos(a + side * 1.2) * 24, z: p.spawn.z + Math.sin(a + side * 1.2) * 24, rate: C.homeRate });
  }
  // Fuel nodes halfway between neighbouring enemy HQs, so each is as far from both sides as it can be (by villages,
  // some sat in one player's backyard). Each player pairs with its 2 nearest enemies; a 1v1 gets one on each flank.
  const foes = (p) => g.players.filter(q => q.team !== p.team).sort((a, b) => dist(a.spawn, p.spawn) - dist(b.spawn, p.spawn));
  const pairs = new Set();
  for (const p of g.players) for (const q of foes(p).slice(0, 2)) pairs.add([p.slot, q.slot].sort((a, b) => a - b).join());
  for (const key of pairs) {
    const [a, b] = key.split(',').map(i => g.players[+i].spawn), mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
    const l = dist(a, b) || 1, px = -(b.z - a.z) / l, pz = (b.x - a.x) / l;
    for (const side of pairs.size === 1 ? [-1, 1] : [0]) want.push({ x: mx + px * side * 22, z: mz + pz * side * 22, rate: C.contestedFuel, fuel: true, from: [a, b] });
  }
  g.nodes = [];
  // walking distance from an HQ's doorstep (a straight-line midpoint can be a long climb for one side)
  const walk = (from, to) => { const p = findPath(g, cellCenter(g, nearestFree(g, from.x, from.z)), to); let d = 0, at = from; for (const q of p) { d += dist(at, q); at = q; } return p.length ? d : Infinity; };
  for (const w of want) {
    const away = [...avoid, ...g.nodes.map(n => [n, 10])];
    let c = findSite(g, w.x, w.z, 2, away);
    if (w.from && c >= 0) {
      // Fuel: of the spots around the midpoint, the one both HQs reach in the most equal walk
      let best = Infinity;
      for (let r = 0; r <= 24; r += 8) for (let k = 0; k < (r ? 8 : 1); k++) {
        const t = findSite(g, w.x + Math.cos(k * Math.PI / 4) * r, w.z + Math.sin(k * Math.PI / 4) * r, 2, away);
        if (t < 0) continue;
        const at = footCenter(g, t, 2), da = walk(w.from[0], at), db = walk(w.from[1], at), score = Math.abs(da - db) + 0.1 * (da + db);
        if (score < best) { best = score; c = t; }
      }
    }
    if (c >= 0) g.nodes.push({ c, ...footCenter(g, c, 2), depot: 0, rate: w.rate, fuel: !!w.fuel });
  }
}
// Where a unit retreats to: in Classic the nearest of its owner's finished Production Buildings, else the spawn
function homeOf(g, u) {
  const p = g.players[u.owner];
  if (g.mode?.kind !== 'classic') return p.spawn;
  let best = null, bd = Infinity;
  for (const b of g.units.values()) if (b.owner === u.owner && UNITS[b.type].produces && b.built >= 1 && dist(u, b) < bd) { bd = dist(u, b); best = b; }
  return best ?? p.spawn;
}
// where a size x size building could go near (x, z), clear of nodes, points and spawns: its center, or null
export function siteNear(g, x, z, size) {
  const avoid = [...(g.nodes ?? []).map(n => [n, 5]), ...g.points.map(p => [p, CFG.pointRadius + 2]), ...g.players.map(p => [p.spawn, 6])];
  const c = findSite(g, x - size * CELL / 2, z - size * CELL / 2, size, avoid);
  return c < 0 ? null : footCenter(g, c, size);
}
// can this team see the spot right now? (any of its units within vision and line of sight)
export function teamSees(g, team, at) {
  return [...g.units.values()].some(u => g.players[u.owner].team === team && dist(u, at) <= UNITS[u.type].vision && (UNITS[u.type].building || los(g, u, at)));
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
const SOLID = new Set(['B', '#', 'R', 'H', 'K']);
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
export const vet = (u) => (UNITS[u.type].cost ? CFG.vetXp.filter(k => u.xp >= k * UNITS[u.type].cost).length : 0); // free units (the bunker) never rank up
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
// a heavy blast digs the cell one level down, but never below a neighbour's slope (no pits you can't climb out of)
function dent(g, c) {
  if (c < 0) return;
  g.height ??= new Int8Array(g.w * g.h);
  const L = g.height[c] - 1, x = c % g.w;
  if (L < CFG.minLevel || [c - g.w, c + g.w, x > 0 ? c - 1 : -1, x < g.w - 1 ? c + 1 : -1].some(n => n >= 0 && n < g.height.length && g.height[n] - L > 1)) return;
  g.height[c] = L;
  g.cellLog.push([c, g.chars[c], L]); g.newCells.push([c, g.chars[c], L]);
}
// dig a (2r+1)^2 patch of cells around a blast, centre first so repeated hits deepen it into a bowl
function digAt(g, at, r) {
  dent(g, cellOf(g, at.x, at.z));
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx || dy) dent(g, cellOf(g, at.x + dx * CELL, at.z + dy * CELL));
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
  const mine = (id) => { const u = g.units.get(id); return u && u.owner === slot && !UNITS[u.type].structure ? u : null; };
  const ids = Array.isArray(cmd.ids) ? cmd.ids.slice(0, 50) : [];
  if ((cmd.t === 'move' || cmd.t === 'amove') && Array.isArray(cmd.orders)) {
    for (const o of cmd.orders.slice(0, 50)) {
      const u = Array.isArray(o) && mine(o[0]), x = num(o?.[1], g.w * CELL), z = num(o?.[2], g.h * CELL);
      if (!u || x === null || z === null) continue;
      exitBuilding(g, u);
      Object.assign(u, { attackId: 0, targetId: 0, stuck: 0, retreating: false, nade: null, dig: null, enter: -1, fireAt: -1, build: 0, amove: cmd.t === 'amove' ? { x, z } : null });
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
    for (const id of ids) { const u = mine(id); if (u) Object.assign(u, { path: [], attackId: 0, retreating: false, nade: null, dig: null, enter: -1, amove: null, fireAt: -1, build: 0 }); }
  } else if (cmd.t === 'retreat') {
    for (const id of ids) {
      const u = mine(id); if (!u) continue;
      exitBuilding(g, u);
      Object.assign(u, { retreating: true, attackId: 0, targetId: 0, nade: null, dig: null, stuck: 0, enter: -1, amove: null, fireAt: -1, build: 0 });
      u.path = findPath(g, u, homeOf(g, u));
    }
  } else if (cmd.t === 'ability') {
    const x = num(cmd.x, g.w * CELL), z = num(cmd.z, g.h * CELL);
    for (const id of ids) {
      const u = mine(id), ab = u && UNITS[u.type].ab;
      if (!u || u.cd > 0 || u.retreating || !(g.players[slot].mun >= abCost(g, ab) || !abCost(g, ab))) continue;
      if (ab.id === 'grenade' || ab.id === 'barrage' || ab.id === 'satchel') { if (x === null || z === null) continue; exitBuilding(g, u); Object.assign(u, { nade: { x, z }, attackId: 0, repath: 0, fireAt: -1 }); }
      else if (!payAb(g, u)) continue;
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
    const p = g.players[slot], sp = SUPPORT[cmd.kind], x = num(cmd.x, g.w * CELL), z = num(cmd.z, g.h * CELL), { cur, cost } = supCost(g, cmd.kind);
    if (x === null || z === null || p.sup[cmd.kind] > 0 || !(p[cur] >= cost)) return;
    p[cur] -= cost; p.sup[cmd.kind] = sp.cd;
    const dir = angle(cmd.dir) ?? Math.atan2(z - p.spawn.z, x - p.spawn.x);
    g.strikes.push({ kind: cmd.kind, owner: slot, x, z, dir, t: sp.delay, left: sp.shells ?? sp.dur ?? 0, next: 0, live: false });
  } else if (cmd.t === 'build' && g.mode?.kind === 'classic' && !g.mode.suddenDeath && BUILDABLE.includes(cmd.kind)) {
    // Engineers put up a building: a depot on the free node nearest the click, anything else centered on the click.
    // Paid up front; the team must see the spot.
    const p = g.players[slot], def = UNITS[cmd.kind], x = num(cmd.x, g.w * CELL), z = num(cmd.z, g.h * CELL);
    const crew = ids.map(mine).filter(u => u?.type === 'engineer' && !u.retreating);
    if (!crew.length || x === null || z === null || p.mp < def.cost) return;
    if (def.needs && ![...g.units.values()].some(b => b.owner === slot && b.type === def.needs && b.built >= 1)) return;
    let c, node;
    if (cmd.kind === 'depot') {
      node = g.nodes.filter(n => !n.depot && dist(n, { x, z }) <= 8).sort((a, b) => dist(a, { x, z }) - dist(b, { x, z }))[0];
      if (!node) return;
      c = node.c;
    } else {
      const cx = Math.round(x / CELL - def.size / 2), cy = Math.round(z / CELL - def.size / 2);
      if (cx < 0 || cy < 0 || cx >= g.w || cy >= g.h) return;
      c = cy * g.w + cx;
      // keep resource nodes free for depots
      const cells = footprint(g, c, def.size), taken = new Set(g.nodes.flatMap(n => footprint(g, n.c, 2)));
      if (!cells || cells.some(k => taken.has(k))) return;
    }
    if (!canStamp(g, footprint(g, c, def.size)) || !teamSees(g, p.team, footCenter(g, c, def.size))) return;
    p.mp -= def.cost;
    const site = placeBuilding(g, slot, cmd.kind, c, false);
    if (node) node.depot = site.id;
    for (const u of crew) { exitBuilding(g, u); Object.assign(u, { build: site.id, attackId: 0, nade: null, dig: null, enter: -1, amove: null, fireAt: -1, repath: 0, path: findPath(g, u, site) }); }
  } else if (cmd.t === 'assist') {
    // Engineers join a site, or repair a damaged building of their own team
    const b = g.units.get(cmd.id);
    if (!b || !UNITS[b.type].building || !allied(g, b.owner, slot) || (b.built >= 1 && b.hp >= UNITS[b.type].hpPer)) return;
    for (const u of ids.map(mine).filter(u => u?.type === 'engineer' && !u.retreating)) { exitBuilding(g, u); Object.assign(u, { build: b.id, attackId: 0, nade: null, dig: null, enter: -1, amove: null, fireAt: -1, repath: 0, path: findPath(g, u, b) }); }
  } else if (cmd.t === 'cancel') {
    // tear down your own unfinished site for 75% back
    const b = g.units.get(cmd.id);
    if (!b || b.owner !== slot || !UNITS[b.type].building || b.built >= 1) return;
    g.players[slot].mp += UNITS[b.type].cost * 0.75;
    g.units.delete(b.id);
    for (const c of b.cells) setCell(g, c, '.');
    for (const n of g.nodes ?? []) if (n.depot === b.id) n.depot = 0;
  } else if (cmd.t === 'rally') {
    const b = g.units.get(cmd.id), x = num(cmd.x, g.w * CELL), z = num(cmd.z, g.h * CELL);
    if (b && b.owner === slot && UNITS[b.type].makes && x !== null && z !== null) b.rally = { x, z };
  } else if (cmd.t === 'buy' && Object.hasOwn(UNITS, cmd.unit) && canBuild(cmd.unit, g.players[slot].faction)) {
    const p = g.players[slot], def = UNITS[cmd.unit], classic = g.mode?.kind === 'classic';
    if (def.classic && !classic) return; // Engineers exist only in Classic
    const own = [...g.units.values()].filter(u => u.owner === slot);
    // Classic: training queues count toward the pop cap and the unit limit
    const queued = own.flatMap(b => b.queue ?? []);
    const pop = own.filter(u => !UNITS[u.type].structure).length + queued.length;
    const have = own.filter(u => u.type === cmd.unit).length + queued.filter(t => t === cmd.unit).length;
    const price = priceOf(g, cmd.unit);
    if (p.mp < price.mp || (price.fuel && !(p.fuel >= price.fuel)) || pop >= popCap(g) || have >= (def.max ?? Infinity)) return;
    if (!classic) { p.mp -= price.mp; spawnUnit(g, slot, cmd.unit); return; }
    // queue it at the building asked for, else the one with the shortest queue
    if (g.mode.suddenDeath) return;
    const makers = own.filter(b => b.built >= 1 && UNITS[b.type].makes?.includes(cmd.unit) && b.queue.length < 5);
    const b = makers.find(m => m.id === cmd.from) ?? makers.sort((a, c) => a.queue.length - c.queue.length)[0];
    if (!b) return;
    p.mp -= price.mp; p.fuel -= price.fuel; b.queue.push(cmd.unit);
  }
}

// ---------- simulation ----------

const suppMul = (u) => (u.supp >= 90 ? { speed: 0.3, rate: 3, acc: 0.5 } : u.supp >= 50 ? { speed: 0.6, rate: 1.5, acc: 0.7 } : { speed: 1, rate: 1, acc: 1 });

function canShoot(g, u, t) {
  const w = UNITS[u.type].w;
  if (!t || t.hp <= 0 || allied(g, t.owner, u.owner) || dist(u, t) > w.range || !g.players[u.owner].visible.has(t.id)) return false;
  return w.salvo ? dist(u, t) >= w.minRange : los(g, u, aimPoint(g, u, t)); // salvos arc over: spotting is enough
}
// a building is aimed at by its nearest footprint cell (its own walls would block a line to the middle)
function aimPoint(g, u, t) {
  if (!t.cells) return t;
  let best = t, bd = Infinity;
  for (const c of t.cells) { const p = cellCenter(g, c), d = dist(u, p); if (d < bd) { bd = d; best = p; } }
  return best;
}

function pickTarget(g, u) {
  const w = UNITS[u.type].w;
  let best = 0, bestScore = Infinity;
  for (const t of g.units.values()) {
    if (!canShoot(g, u, t)) continue;
    const inf = UNITS[t.type].infantry;
    // salvos go for garrisons first, then for whatever has the most enemies around it
    const value = w.salvo ? (t.garrison >= 0 ? 3 : 1) * (1 + [...g.units.values()].filter(o => o.owner === t.owner && dist(o, t) < 6).length) : inf ? w.inf * w.accInf : w.veh * w.accVeh;
    const score = dist(u, t) / value * (UNITS[t.type].structure ? 5 : 1); // soldiers first, concrete later
    if (score < bestScore) { bestScore = score; best = t.id; }
  }
  return best;
}

function launchSalvo(g, u, at, n = UNITS[u.type].w.rockets) {
  const w = UNITS[u.type].w;
  g.salvos.push({ x: at.x, z: at.z, owner: u.owner, left: n, next: w.flight, w });
  g.shots.push({ f: u.id, fo: u.owner, x: at.x, z: at.z, k: 'salvo', n, pub: true });
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
  // Classic buildings are timber: guns (anti-tank damage of 20+) hit them fully, small arms chip at them
  if (def.building) dmg = w.veh >= 20 ? w.veh : w.inf * CFG.classic.smallArms;
  else if (def.structure) dmg *= CFG.assault.directMul; // bullets and shells barely scratch concrete
  else if (!inf) {
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
  u.cooldown = w.interval * rate; u.shotAt = g.tick;
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
      if (UNITS[t.type].structure && !UNITS[t.type].building) { vis.add(t.id); continue; }
      const aim = t.cells ? null : t;
      // camouflage: after 3s still and 4s without firing, only seen within camoRange (recon flights still spot it)
      const hidden = UNITS[t.type].camo && t.still >= 3 && g.tick - (t.shotAt ?? -1e9) >= 80;
      if (own.some(u => { const d = dist(u, t), at = aim ?? aimPoint(g, u, t); if (hidden) return d < CFG.camoRange; return d < 6 || (UNITS[u.type].building && d <= UNITS[u.type].vision) || (d <= UNITS[u.type].vision * (1 + CFG.highGroundVision * levelAt(g, u.x, u.z)) * (u.garrison >= 0 ? CFG.garrisonVision : 1) && los(g, u, at)); })
        || g.strikes.some(s => s.live && s.kind === 'recon' && g.players[s.owner].team === p.team && inStrip(s, t, SUPPORT.recon.len, SUPPORT.recon.width))) vis.add(t.id);
    }
    byTeam.set(p.team, p.visible = vis);
    // Ghosts: every enemy building this team has seen stays remembered where it was, until the team sees the spot
    // again without it (destroyed or cancelled)
    if (g.mode?.kind !== 'classic') continue;
    const mem = (g.ghosts ??= new Map()).get(p.team) ?? new Map();
    g.ghosts.set(p.team, mem);
    for (const id of vis) { const t = g.units.get(id); if (UNITS[t.type].building) mem.set(id, { id, type: t.type, owner: t.owner, x: t.x, z: t.z, built: t.built }); }
    for (const [id, gh] of mem) if (!vis.has(id) && !g.units.has(id) && own.some(u => dist(u, gh) <= UNITS[u.type].vision && (UNITS[u.type].building || los(g, u, gh) || dist(u, gh) < 8))) mem.delete(id);
  }
}
// the enemy buildings a player knows about: seen now, or remembered (Ghosts)
export const knownBuildings = (g, slot) => [...(g.ghosts?.get(g.players[slot].team)?.values() ?? [])];

function hurt(g, t, src, fall, owner) {
  const inf = UNITS[t.type].infantry;
  // concrete takes an explosive's demolition value (the same number that wrecks houses)
  const base = UNITS[t.type].structure ? src.terrain ?? src.veh : inf ? src.inf : src.veh;
  // the bunker is built to take a bombardment: off-map strikes barely touch it, it has to be taken on the ground
  const shrug = t.type === 'bunker' && SUPPORT_SRC.has(src) ? CFG.assault.supportMul : 1;
  t.hp -= base * shrug * fall * (t.retreating ? CFG.retreatDamage : 1) * (t.garrison >= 0 ? src.antiGarrison ?? CFG.trenchBlastMul : inTrench(g, t) ? CFG.trenchBlastMul : 1) * (1 - CFG.vetArmor * vet(t));
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

  const crews = new Map(); // construction site id -> engineers working on it this tick
  for (const u of g.units.values()) {
    const def = UNITS[u.type], w = def.w, sm = suppMul(u);
    if (def.building) { if (u.queue?.length && u.built >= 1 && !g.mode.suddenDeath) train(g, u, dt); continue; }
    if (def.infantry) u.supp = Math.max(0, u.supp - 8 * dt);
    u.cooldown -= dt; u.retarget -= dt; u.repath -= dt; u.cd -= dt; u.buff -= dt; u.sprint -= dt;

    // Engineers: walk up to the site, then build
    if (u.build) {
      const s = g.units.get(u.build);
      if (!s || (s.built >= 1 && s.hp >= UNITS[s.type].hpPer)) u.build = 0;
      else if (dist(u, s) <= UNITS[s.type].radius + CFG.classic.buildReach) { u.path = []; crews.set(s.id, (crews.get(s.id) ?? 0) + 1); }
      else if (!u.path.length && u.repath <= 0) { u.path = findPath(g, u, s); u.repath = 1; }
    }

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
      if ((ab.id === 'barrage' || ab.id === 'grenade' || ab.id === 'satchel') && dist(u, u.nade) <= ab.range && !payAb(g, u)) u.nade = null; // can't afford it any more
      else if (ab.id === 'barrage' && dist(u, u.nade) <= ab.range) {
        launchSalvo(g, u, u.nade, ab.shells); u.cooldown = w.interval; u.cd = ab.cd; u.nade = null; u.path = [];
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

  // more engineers build faster, with diminishing returns (2 = ~1.65x, 3 = ~2.2x). Finished buildings get
  // repaired instead, for free but slowly (and slower than Sudden Death decay).
  for (const [id, n] of crews) {
    const s = g.units.get(id), def = UNITS[s.type], crew = n ** CFG.classic.crew;
    if (s.built >= 1) { s.hp = Math.min(def.hpPer, s.hp + def.hpPer * Math.min(CFG.classic.repair * crew, g.mode.suddenDeath ? CFG.classic.decay * 0.6 : Infinity) * dt); continue; }
    if (g.mode.suddenDeath) continue; // construction stops
    const rate = crew / (def.buildTime ?? 1) * dt;
    s.built = Math.min(1, s.built + rate);
    s.hp = Math.min(def.hpPer, s.hp + def.hpPer * 0.75 * rate);
  }

  // soft separation; never push a unit into a blocked cell
  const list = [...g.units.values()];
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], b = list[j], min = (UNITS[a.type].radius + UNITS[b.type].radius) * 0.8;
    if (a.garrison >= 0 || b.garrison >= 0) continue;
    const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
    if (d >= min || d === 0) continue;
    const sa = UNITS[a.type].structure, sb = UNITS[b.type].structure;
    if (sa && sb) continue;
    const push = (min - d) / 2 * (sa || sb ? 1 : 0.5), px = dx / d * push, pz = dz / d * push;
    if (!sa && !(flagsAt(g, a.x - px, a.z - pz) & MOVE) && Math.abs(levelAt(g, a.x - px, a.z - pz) - levelAt(g, a.x, a.z)) <= 1) { a.x -= px; a.z -= pz; }
    if (!sb && !(flagsAt(g, b.x + px, b.z + pz) & MOVE) && Math.abs(levelAt(g, b.x + px, b.z + pz) - levelAt(g, b.x, b.z)) <= 1) { b.x += px; b.z += pz; }
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
      digAt(g, at, sp.dig);
      s.left--; s.next = sp.every;
    }
    else if (s.kind === 'artillery' && (s.next -= dt) <= 0) {
      const at = stripAt(s, (Math.random() - 0.5) * sp.len, (Math.random() - 0.5) * sp.width);
      g.shots.push({ x: at.x, z: at.z, k: 'shell', pub: true });
      blast(g, list, at, sp.blast, sp, s.owner);
      const hole = cellOf(g, at.x, at.z);
      if (hole >= 0 && g.chars[hole] === '.') setCell(g, hole, '+'); // shell holes are cover from now on
      digAt(g, at, sp.dig);
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

  // reinforce / repair near your own spawn (Classic: near any own or allied Production Building), paid in manpower
  const bases = g.mode?.kind === 'classic' ? list.filter(b => UNITS[b.type].produces && b.built >= 1 && b.hp > 0) : null;
  const atBase = (u) => (bases ? bases.some(b => allied(g, b.owner, u.owner) && dist(u, b) <= CFG.reinforceRadius) : dist(u, g.players[u.owner].spawn) <= CFG.reinforceRadius);
  for (const u of list) {
    const def = UNITS[u.type], p = g.players[u.owner], full = def.models * def.hpPer;
    if (def.structure || u.hp <= 0 || u.hp >= full || !atBase(u)) { u.reinf = 0; continue; }
    if (def.infantry) {
      const cost = def.cost / def.models * 0.5;
      if ((u.reinf += dt) >= CFG.reinforceEvery && p.mp >= cost) { u.reinf = 0; p.mp -= cost; u.hp = Math.min(full, (alive(u) + 1) * def.hpPer); }
    } else {
      const hp = Math.min(full - u.hp, 18 * dt), cost = hp * 0.5;
      if (p.mp >= cost) { u.hp += hp; p.mp -= cost; u.reinf = 1; }
    }
  }

  for (const u of list) if (u.hp <= 0) { g.units.delete(u.id); if (UNITS[u.type].building) wreckBuilding(g, u); }

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

  // victory points count per team: whichever team's players together reach g.winVp wins
  const teamVp = (t) => g.players.reduce((a, q) => a + (q.team === t ? q.vp : 0), 0);
  const lead = Math.max(...g.players.map(q => teamVp(q.team)));
  for (const pl of g.players) {
    const held = g.points.filter(p => p.owner === pl.slot);
    // away = disconnected (set by the server): their clock stops so a dropout doesn't decide the match
    if (!g.mode) pl.vp += held.reduce((a, p) => a + p.vp, 0) * dt * (pl.away ? 0 : 1);
    if (g.mode?.kind === 'classic') {
      // no catch-up: MP from the HQ trickle and finished depots, Munitions from every point the team holds
      const C = CFG.classic, own = list.filter(u => u.owner === pl.slot && u.hp > 0);
      // home depots pay MP, the contested ones by the villages pay Fuel
      const paying = g.nodes.filter(n => { const d = g.units.get(n.depot); return d && d.owner === pl.slot && d.built >= 1 && d.hp > 0; });
      const depots = paying.reduce((a, n) => a + (n.fuel ? 0 : n.rate), 0);
      pl.fuelInc = pl.away || pl.out ? 0 : C.hqFuel + paying.reduce((a, n) => a + (n.fuel ? n.rate : 0), 0);
      pl.fuel += pl.fuelInc * dt;
      pl.upkeep = own.reduce((a, u) => a + (UNITS[u.type].structure ? 0 : UNITS[u.type].cost * C.upkeep), 0);
      pl.inc = pl.away || pl.out ? 0 : Math.max(C.minInc, C.trickle + depots - pl.upkeep);
      pl.mp += pl.inc * dt;
      if (!pl.away && !pl.out) pl.mun += g.points.reduce((a, p) => a + (allied(g, p.owner, pl.slot) ? p.vp : 0), 0) * C.munPerVp * dt;
      continue;
    }
    const base = !g.mode ? CFG.mpBase : pl.team === g.mode.defenderTeam ? CFG.assault.defenderBase : CFG.assault.attackerBase;
    pl.inc = pl.away ? 0 : base + held.reduce((a, p) => a + p.mp, 0) + Math.min(CFG.catchupMax, (lead - teamVp(pl.team)) / CFG.catchupPer);
    pl.mp += pl.inc * dt;
  }
  if (g.mode?.kind === 'classic') {
    // Annihilation: no Production Building (a site of one counts) = out, and everything you own goes with you
    g.mode.timeLeft -= dt;
    // Sudden Death: production and construction stop, and every Production Building crumbles
    if (g.mode.timeLeft <= 0 && !g.mode.suddenDeath) { g.mode.suddenDeath = true; for (const b of list) if (b.queue) b.queue = []; }
    if (g.mode.suddenDeath) for (const b of list) if (UNITS[b.type].produces && b.hp > 0) b.hp -= UNITS[b.type].hpPer * CFG.classic.decay * dt;
    for (const b of list) if (UNITS[b.type].building && b.hp <= 0 && g.units.has(b.id)) { g.units.delete(b.id); wreckBuilding(g, b); }
    for (const pl of g.players) {
      if (pl.out || [...g.units.values()].some(u => u.owner === pl.slot && UNITS[u.type].produces)) continue;
      pl.out = true;
      // the army goes to the nearest surviving teammate (no pop cap for it); buildings (depots) go down
      const mates = g.players.filter(q => q.team === pl.team && !q.out);
      for (const u of [...g.units.values()]) {
        if (u.owner !== pl.slot) continue;
        if (UNITS[u.type].building || !mates.length) { g.units.delete(u.id); if (UNITS[u.type].building) wreckBuilding(g, u); continue; }
        const to = mates.sort((a, b) => dist(a.spawn, u) - dist(b.spawn, u))[0];
        Object.assign(u, { owner: to.slot, build: 0, attackId: 0, amove: null, path: [], retreating: false });
      }
    }
    const left = new Set(g.players.filter(p => !p.out).map(p => p.team));
    if (g.mode.teams > 1 && left.size <= 1) g.winner = left.size ? [...left][0] : -1; // -1 = draw
    return;
  }
  if (g.mode) {
    // assault: the attackers win when the last bunker falls, the defenders when the clock runs out
    g.mode.timeLeft -= dt;
    if (![...g.units.values()].some(u => UNITS[u.type].structure && u.hp > 0)) g.winner = g.mode.attackerTeam;
    else if (g.mode.timeLeft <= 0) g.winner = g.mode.defenderTeam;
    return;
  }
  for (const pl of g.players) if (teamVp(pl.team) >= g.winVp && g.winner === null) g.winner = pl.team; // winner = team id
}

// what a unit is set on, as [kind, x, z]. kind: 0 none, 1 move, 2 attack-move, 3 retreat, 4 attack a unit,
// 5 fire at a structure, 6 throw / plant at a spot, 7 dig, 8 build, 9 go into a house
function planOf(g, u) {
  const t = u.attackId && g.units.get(u.attackId), site = u.build && g.units.get(u.build);
  if (u.retreating) return [3, g.players[u.owner].spawn.x, g.players[u.owner].spawn.z];
  if (t) return [4, t.x, t.z];
  if (u.fireAt >= 0) { const c = cellCenter(g, u.fireAt); return [5, c.x, c.z]; }
  if (u.nade) return [6, u.nade.x, u.nade.z];
  if (u.dig) return [7, u.dig.x, u.dig.z];
  if (site) return [8, site.x, site.z];
  if (u.enter >= 0) { const c = cellCenter(g, u.enter); return [9, c.x, c.z]; }
  if (u.amove) return [2, u.amove.x, u.amove.z];
  const end = u.path.at(-1);
  return end ? [1, end.x, end.z] : [0, 0, 0];
}

// What one player is allowed to know: own units + enemies they can see. Fog is enforced here.
export function snapshotFor(g, slot, shots, cells = []) {
  const p = g.players[slot], r = (v) => Math.round(v * 10) / 10;
  const seen = (id) => allied(g, g.units.get(id)?.owner ?? -1, slot) || p.visible.has(id);
  return {
    t: 's', tick: g.tick, winner: g.winner, mp: Math.floor(p.mp), inc: r(p.inc), mun: p.mun === undefined ? undefined : Math.floor(p.mun), fuel: p.fuel === undefined ? undefined : Math.floor(p.fuel), fuelInc: p.fuelInc === undefined ? undefined : r(p.fuelInc),
    nodes: g.nodes?.map(n => [r(n.x), r(n.z), n.rate, n.fuel ? 1 : 0]), upkeep: p.upkeep === undefined ? undefined : r(p.upkeep), out: g.players.map(q => !!q.out),
    // your own units' orders, for drawing when selected: [id, kind, target x, target z, ...remaining waypoints x, z]
    // your Production Buildings: [id, training progress 0-1, rally x, rally z (or -1), ...queued unit types]
    queues: [...g.units.values()].filter(b => b.owner === slot && b.queue).map(b => [b.id, b.queue.length ? r(b.prog / UNITS[b.queue[0]].train) : 0, b.rally ? r(b.rally.x) : -1, b.rally ? r(b.rally.z) : -1, ...b.queue]),
    plans: [...g.units.values()].filter(u => u.owner === slot && !UNITS[u.type].structure).map(u => [u.id, ...planOf(g, u).map(r), ...u.path.flatMap(q => [r(q.x), r(q.z)])]),
    mode: g.mode && { kind: g.mode.kind, defenderTeam: g.mode.defenderTeam, attackerTeam: g.mode.attackerTeam, timeLeft: Math.max(0, Math.ceil(g.mode.timeLeft)), suddenDeath: !!g.mode.suddenDeath },
    // enemy buildings remembered under fog: [id, type, owner, x, z, how far built]
    ghosts: g.mode?.kind === 'classic' ? knownBuildings(g, slot).filter(gh => !p.visible.has(gh.id)).map(gh => [gh.id, gh.type, gh.owner, r(gh.x), r(gh.z), r(gh.built)]) : undefined,
    // flags: 1 retreating, 2 ability active, 4 AP loaded, 8 reinforcing, 16 digging, 32 garrisoned, 64 attack-moving.
    // 128 building a site. Then veterancy stars, then how far a building is built (0-1). Cooldowns only for your own units.
    units: [...g.units.values()].filter(u => seen(u.id))
      .map(u => [u.id, u.type, u.owner, r(u.x), r(u.z), r(u.rot), r(u.aim), Math.ceil(u.hp), Math.round(u.supp), u.targetId && seen(u.targetId) ? u.targetId : 0, inTrench(g, u) ? 2 : inCover(g, u) ? 1 : UNITS[u.type].infantry && nearCover(g, u) ? 3 : 0,
        u.owner === slot ? Math.max(0, Math.ceil(u.cd)) : 0, (u.retreating ? 1 : 0) | (u.buff > 0 ? 2 : 0) | (u.ap ? 4 : 0) | (u.reinf > 0 ? 8 : 0) | (u.dig ? 16 : 0) | (u.garrison >= 0 ? 32 : 0) | (u.amove ? 64 : 0) | (u.build ? 128 : 0) | (UNITS[u.type].camo && u.still >= 3 && g.tick - (u.shotAt ?? -1e9) >= 80 ? 256 : 0), vet(u), u.built ?? 1]),
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
