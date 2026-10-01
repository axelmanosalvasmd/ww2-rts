// Pure game logic. The server runs it; the client imports the tables for rendering.
// Coordinates: world metres, x right, z down the map rows. Grid cells are CELL metres.
import { tally, died, captured, lastCapture, sample, SAMPLE_EVERY } from './story.js';
import { gridFor, rebuildGrid, updateGrid } from './grid.js';
import { planWeather, stepWeather, sightMul, weatherSpeed, weatherRow } from './weather.js';

export const CELL = 2;
export const TICK = 1 / 20;
export const CFG = {
  vpToWin: 1200, mpStart: 150,
  // Assault mode: attackers must destroy every defender's command bunker before the clock runs out.
  assault: { time: 900, directMul: 0.25, supportMul: 0.05, attackerMp: 320, attackerBase: 5, defenderMp: 250, defenderBase: 3.5, fortRadius: 11,
    // Annihilation: every player gets a fortified bunker; a team is out when its last bunker falls. No clock.
    annihilationMp: 300, annihilationBase: 4.5 },
  // Horde: co-op defense of one shared bunker against waves. budget: wave 1's MP worth of units, x growth per wave,
  // x defending players x the army size's income. field: the most horde units on the map per defender (fieldMax in
  // all); the rest of the wave waits in reserve. heal: bunker hp share restored per cleared wave. reveal: with this few
  // horde units left they show through the fog. support: MP of off-map support per wave from supportWave; planes from
  // airWave. unlock: [unit, first wave, weight in the mix]
  horde: { budget: 300, growth: 1.25, field: 60, fieldMax: 240, break: 45, heal: 0.1, reveal: 3, supportWave: 6, support: 150, airWave: 10,
    unlock: [['rifle', 1, 4], ['conscript', 1, 4], ['mg', 3, 2], ['mortar', 3, 1], ['armoredcar', 5, 1], ['tank', 5, 2], ['at', 5, 1], ['medium', 8, 2], ['rocket', 8, 1], ['tiger', 12, 1]] },
  // flat income does most of the work; points add a little and trailing players catch up
  mpBase: 4, catchupMax: 6, catchupPer: 60,
  captureTime: 8, pointRadius: 8, popCap: 12,
  retreatSpeed: 1.5, retreatDamage: 0.25, reinforceRadius: 15, reinforceEvery: 2,
  // incoming accuracy/suppression multipliers; blasts only care about trenches
  coverMul: 0.5, trenchMul: 0.35, trenchBlastMul: 0.5,
  // planes: seen from this far with no line of sight; time on station (fuel); rearm time at base; circling radius;
  // how far a fighter looks for enemy planes; hp share at which a plane turns for home; off-map airbase distance
  // kill bounty: whoever lands the killing blow gets this share of the dead unit's (or building's) cost in MP
  bounty: 0.2,
  // army size, picked in the lobby: multiplies the unit limit and every income (MP, Munitions, Fuel, starting MP)
  armies: { standard: { pop: 1, income: 1 }, large: { pop: 2.5, income: 3 }, massive: { pop: 5, income: 6 }, endless: { pop: 5, income: 20 } },
  air: { seeRange: 60, station: 50, rearm: 30, orbit: 18, seek: 60, bail: 0.35, offmap: 40 },
  digCost: 30, digCells: 4, digTime: 3, wireSpeed: 0.35, fortBuilders: ['rifle', 'conscript', 'engineer'], camoRange: 12,
  // seeking cover: how far a squad will walk for it (metres), and how long an idle squad under fire waits between looks
  coverSeek: 10, coverRetry: 2,
  // auto-retreat (a per-unit switch): the share of full strength below which a unit runs for home. hullTurn: how fast
  // an idle vehicle turns its front to a threat (rad/s)
  autoRetreat: 0.35, hullTurn: 1.2,
  // destruction: hit points per structure cell, what it turns into, and what tanks flatten by driving through
  terrainHp: { B: 400, H: 60, '#': 150, '=': 200, X: 40, Y: 250, N: 1 }, wreck: { B: 'R', H: '.', '#': '+', '=': 'W', X: '.', Y: '.', N: '+' }, crush: { H: '.', '#': 'R', X: '.' },
  // a ford's speed, shallow to deep (each ford cell has its own depth)
  fordSpeed: [0.75, 0.35],
  // vehicles: faster on an unbroken road or bridge; mud from shallow to deep; open ground down to 1 - churn as traffic
  // cuts it up, after which it is mud. traffic: wear per metre a tank drives over a cell (light vehicles half)
  roadSpeed: 1.35, mudSpeed: [0.7, 0.35], churn: 0.3, traffic: 0.05,
  // going uphill costs speed in proportion to the grade (a rise of 1 m per metre = the full share): [infantry, vehicles]
  slope: [0.2, 0.45],
  // weather: first rain no sooner than firstRain s, a dry spell and a shower each last between these seconds. Ground
  // takes soak s of rain to get fully wet and dryOut s to dry. Wet ground slows vehicles (twice as much below level 0),
  // wears three times faster, deepens fords, shortens sight and smothers fire.
  weather: { firstRain: 180, dry: [240, 480], rain: [90, 180], soak: 90, dryOut: 240, wetGround: 0.2, wetFord: 0.3, wetWear: 3, sight: 0.2 },
  // wind: smoke drifts at up to this many m/s, and fire runs before it
  windSpeed: 1.2,
  // dust: a vehicle moving over dry ground is seen from this much further away
  dustSeen: 1.3,
  // fire: seconds a cell burns, chance per second of catching from a burning neighbour (more downwind, little upwind),
  // chance a heavy blast sets it alight. Infantry in a burning cell lose hp and nerve every second.
  fire: { burn: { H: 14, B: 25, '.': 5 }, spread: { H: 0.25, B: 0.03, '.': 0.022 }, ignite: { H: 0.3, B: 0.15, '.': 0.03 }, inf: 8, supp: 12, smoke: { r: 5, t: 12 } },
  // a mine goes off under the first enemy to step on it; any explosion that damages terrain clears it
  mine: { blast: 3, inf: 45, veh: 220, supp: 60 },
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
    popCap: 24, decay: 0.01,
    // adaptive AI: attack a base only with an army worth this much more than the enemy it saw in the last window seconds
    aiAttackRatio: 1.1, aiSeenWindow: 30 },
};

export const MOVE = 1, SIGHT = 2, COVER = 4, TRENCH = 8, FORD = 16, WIRE = 32, VBLOCK = 64, ROAD = 128, MUD = 256;
// T trench (heavy cover, diggable) · W river (impassable, see across) · F ford (wade at half speed)
// = bridge (walkable, can be blown) · R rubble (what's left of a house: walkable cover)
// K = footprint of a Classic building (never in map files): solid until the building falls, then rubble
export const TERRAIN = { '.': 0, B: MOVE | SIGHT, H: SIGHT | COVER, '#': COVER, '+': COVER, T: COVER | TRENCH, W: MOVE, F: FORD, '=': ROAD, R: COVER, K: MOVE | SIGHT, X: WIRE, Y: VBLOCK | COVER, D: ROAD, M: MUD, N: 0 };
// X barbed wire (infantry wade through slowly, tanks flatten it) · Y tank traps (stop vehicles, cover for infantry)
// D road (vehicles drive faster and route along it) · M mud (vehicles crawl) · N mine (hidden from the enemy)

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
// Flak gun: a towed 20mm cannon. Its job is the sky (aa: shoot-down chance against passing support planes, damage per
// second against planes on station); on the ground it shreds infantry at short range but can't hurt tanks.
UNITS.flak = { name: 'Flak Gun', cost: 200, models: 3, hpPer: 20, speed: 2.5, radius: 1.6, vision: 36, infantry: true,
  w: { range: 30, interval: 0.3, inf: 3, veh: 0, accInf: 0.35, accVeh: 0, supp: 6, setup: 2 },
  aa: { range: 45, dps: 25, chance: 0.35, setup: true },
  ab: { id: 'none', name: '', cd: 1e9 } };
// Planes fly sorties from an airfield (Classic) or an off-map airbase behind the HQ: out to a mission, circling it while
// fuel lasts, home to rearm. They fly over everything at one height; only anti-air (aa) and fighters can hurt them.
UNITS.fighter = { name: 'Fighter', cost: 280, models: 1, hpPer: 200, speed: 20, radius: 2, vision: 40, infantry: false, air: true, role: 'fighter', ammo: 60,
  w: { range: 22, interval: 0.6, inf: 3, veh: 0, accInf: 0.3, accVeh: 0, supp: 8, moveFire: 1 },
  aa: { range: 30, dps: 30 },
  ab: { id: 'none', name: '', cd: 1e9 } };
UNITS.attacker = { name: 'Ground-attack Plane', cost: 340, models: 1, hpPer: 280, speed: 15, radius: 2.4, vision: 40, infantry: false, air: true, role: 'attack', ammo: 8,
  w: { range: 24, interval: 2.5, inf: 25, veh: 90, accInf: 0.5, accVeh: 0.6, supp: 40, moveFire: 1 },
  ab: { id: 'none', name: '', cd: 1e9 } };
// Mobile flak (M16 half-track / Wirbelwind / ZSU): the flak gun's fire on wheels, so armies bring their own air cover.
UNITS.flaktrack = { name: 'Mobile Flak', cost: 260, models: 1, hpPer: 240, speed: 6, radius: 2.2, vision: 38, infantry: false,
  w: { range: 30, interval: 0.3, inf: 3, veh: 1, accInf: 0.35, accVeh: 0.3, supp: 6, moveFire: 0.6 },
  aa: { range: 45, dps: 25, chance: 0.35 },
  ab: { id: 'none', name: '', cd: 1e9 } };
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
UNITS.ranger = { name: 'Ranger Squad', faction: 0, cost: 200, models: 6, hpPer: 24, speed: 5, radius: 1.6, vision: 36, infantry: true, garrisons: true,
  w: { range: 26, interval: 1.4, inf: 3.6, veh: 3, accInf: 0.72, accVeh: 0.6, supp: 5, perModel: true, moveFire: 0.6 },
  ab: { id: 'satchel', name: 'Satchel Charge', cd: 40, range: 6, fuse: 4, radius: 5, inf: 60, veh: 180, supp: 60, terrain: 600 } };
// Germany Tiger: heavy tank, one at a time. Thick front armor: flank it.
UNITS.tiger = { name: 'Tiger', faction: 1, max: 1, cost: 560, models: 1, hpPer: 900, speed: 4, radius: 3, vision: 42, infantry: false, crushes: true, frontArmor: 0.7,
  w: { range: 42, interval: 4, inf: 40, veh: 110, accInf: 0.55, accVeh: 0.8, supp: 30, moveFire: 0.6, shellTerrain: 140 },
  ab: { id: 'smoke', name: 'Smoke', cd: 45, dur: 14, radius: 9 } };
// USSR Conscripts: cheap human waves. Ura! = sprint and shrug off suppression.
UNITS.conscript = { name: 'Conscripts', faction: 2, cost: 80, models: 7, hpPer: 14, speed: 4.6, radius: 1.8, vision: 34, infantry: true, garrisons: true,
  w: { range: 24, interval: 1.8, inf: 2.2, veh: 0.3, accInf: 0.55, accVeh: 0.5, supp: 3, perModel: true, moveFire: 0.5 },
  ab: { id: 'ura', name: 'Ura!', cd: 35, dur: 6, speed: 1.6 } };
UNITS.rifle.garrisons = UNITS.mg.garrisons = true;
UNITS.mg.aa = { range: 30, dps: 5, setup: true }; // an MG can fire at low planes too, a little
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
UNITS.barracks = building({ name: 'Barracks', cost: 150, hpPer: 1500, radius: 3, vision: 24, size: 3, buildTime: 30, produces: true, makes: ['mg', 'mortar', 'sniper', 'flak', 'ranger', 'conscript'] });
UNITS.motorpool = building({ name: 'Motor Pool', cost: 200, hpPer: 1900, radius: 3, vision: 24, size: 3, buildTime: 45, produces: true, needs: 'barracks', makes: ['at', 'armoredcar', 'flaktrack', 'tank', 'medium', 'rocket', 'tiger'] });
UNITS.airfield = building({ name: 'Airfield', cost: 250, hpPer: 1800, radius: 3, vision: 30, size: 3, buildTime: 40, produces: true, needs: 'motorpool', makes: ['fighter', 'attacker'] });
UNITS.flakpos = building({ name: 'Flak Emplacement', cost: 100, hpPer: 1500, radius: 2, vision: 40, size: 2, buildTime: 20, aa: { range: 55, dps: 40, chance: 0.45 } });
export const BUILDABLE = ['depot', 'barracks', 'motorpool', 'airfield', 'flakpos'];
// Classic: seconds to train each unit at its building
for (const [t, s] of Object.entries({ engineer: 12, rifle: 15, conscript: 12, mg: 18, flak: 20, mortar: 20, sniper: 20, ranger: 20, at: 22, armoredcar: 25, flaktrack: 30, fighter: 30, attacker: 35, rocket: 30, tank: 35, medium: 40, tiger: 50 })) UNITS[t].train = s;
// Classic: vehicles cost Fuel and less MP
for (const [t, mp, fuel] of [['flaktrack', 200, 30], ['fighter', 200, 40], ['attacker', 240, 70], ['armoredcar', 160, 25], ['tank', 200, 60], ['medium', 260, 90], ['rocket', 170, 50], ['tiger', 420, 150]]) Object.assign(UNITS[t], { classicCost: mp, fuel });
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
  // point supports (one click, no direction): a precise single heavy bomb, a squad dropped behind the lines,
  // and fighters that intercept the next enemy air strike over the area (never recon)
  dive: { name: 'Dive Bomber', cost: 180, cd: 75, delay: 5, point: true, blast: 5, dig: 1, inf: 80, veh: 400, supp: 90, terrain: 500 },
  para: { name: 'Paratroopers', cost: 260, cd: 90, delay: 6, point: true, unit: 'rifle' },
  cover: { name: 'Fighter Cover', cost: 120, cd: 90, delay: 2, point: true, dur: 60, radius: 40 },
};
// which supports arrive by plane (flak and fighter cover can shoot those down)
for (const k of ['recon', 'strafe', 'bombing', 'dive', 'para']) SUPPORT[k].plane = true;
export const SUPPORT_TYPES = Object.keys(SUPPORT);

// Field fortifications infantry can build (the dig command), laid across the line the player draws.
// The MG nest is a trench pit behind a horseshoe of sandbags that faces away from the builders.
export const FORTS = {
  trench: { name: 'Trench', cost: CFG.digCost, ch: 'T', n: CFG.digCells },
  sandbags: { name: 'Sandbags', cost: 20, ch: '#', n: 4 },
  wire: { name: 'Barbed Wire', cost: 25, ch: 'X', n: 5 },
  traps: { name: 'Tank Traps', cost: 40, ch: 'Y', n: 4 },
  nest: { name: 'MG Nest', cost: 60, nest: true },
  mines: { name: 'Minefield', cost: 40, ch: 'N', n: 4 },
  // on: the ground it is built on (river); reach: the builders work from the bank; along: runs the way they walk
  bridge: { name: 'Bridge', cost: 80, ch: '=', n: 5, on: 'W', reach: 9, along: true },
};
// the fortifications that run in a line on open ground, so they can be drawn out as one continuous line
export const lineFort = (kind) => typeof kind === 'string' && Object.hasOwn(FORTS, kind) && FORTS[kind].n > 0 && !FORTS[kind].on;
const BUILDABLE_GROUND = '.+RDM'; // a trench, wire or traps across a road cut it
// the cells a fortification covers when centered on (x, z), running along direction a
export function fortCells(g, f, x, z, a) {
  const sx = Math.cos(a), sz = Math.sin(a), fx = sz, fz = -sx; // forward: away from the builders
  const at = (along, fwd) => cellOf(g, x + (sx * along + fx * fwd) * CELL, z + (sz * along + fz * fwd) * CELL);
  const plan = f.nest ? [[0, 0, 'T'], [-1, 1, '#'], [0, 1, '#'], [1, 1, '#'], [-1, 0, '#'], [1, 0, '#']].map(([s, w, ch]) => [at(s, w), ch])
    : Array.from({ length: f.n }, (_, i) => [at(i - (f.n - 1) / 2, 0), f.ch]);
  const out = [];
  for (const [c, ch] of plan) if (c >= 0 && (f.on ?? BUILDABLE_GROUND).includes(g.chars[c]) && !out.some(o => o[0] === c)) out.push([c, ch]);
  return out;
}
// Mass entrenchment: every selected digger works one shared pattern. The player gives two points (a click, then a
// second click): a line runs from a to b; an arc, a ring and a strongpoint are centered on a and face or reach to b.
export const ENTRENCH = { line: 'Trench line', zigzag: 'Zigzag trench', double: 'Double line', arc: 'Arc', ring: 'Ring', strongpoint: 'Strongpoint' };
export const ENTRENCH_TYPES = Object.keys(ENTRENCH);
// The pattern as fortification segments [{ kind, x, z, dir }], middle first. back: where the diggers are, so the works
// face away from them (a plain click, with no second point, also runs a line across their approach).
// fort: what the line patterns are made of (trench, sandbags, wire, tank traps, mines); the others are always trench.
export function entrenchPlan(pattern, a, b, back, fort = 'trench') {
  const SEG = FORTS[fort].n * CELL, len = Math.hypot(b.x - a.x, b.z - a.z), drawn = len >= 2, linear = pattern === 'line' || pattern === 'zigzag' || pattern === 'double';
  const away = back && Math.hypot(a.x - back.x, a.z - back.z) > 0.5 ? Math.atan2(a.z - back.z, a.x - back.x) : 0;
  const dir = drawn ? Math.atan2(b.z - a.z, b.x - a.x) : linear ? away + Math.PI / 2 : away;
  const dx = Math.cos(dir), dz = Math.sin(dir), clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v)), out = [];
  const seg = (kind, x, z, d) => out.push({ kind, x, z, dir: d });
  if (linear) {
    const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2, L = drawn ? len : SEG;
    // the front is the side away from the diggers
    const side = back && (mx - back.x) * dz + (mz - back.z) * -dx < 0 ? -1 : 1, nx = dz * side, nz = -dx * side;
    const row = (off) => { const n = clamp(Math.round(L / SEG), 1, 12); for (let i = 0; i < n; i++) { const t = (i - (n - 1) / 2) * SEG; seg(fort, mx + dx * t + nx * off, mz + dz * t + nz * off, dir); } };
    if (pattern === 'zigzag') {
      // a sawtooth: each segment turns 0.6 rad off the line, alternately forward and back
      const w = SEG * Math.cos(0.6), h = SEG * Math.sin(0.6), n = clamp(Math.round(L / w), 1, 16);
      const v = (i) => ({ x: mx + dx * (i - n / 2) * w + nx * (i % 2 ? h / 2 : -h / 2), z: mz + dz * (i - n / 2) * w + nz * (i % 2 ? h / 2 : -h / 2) });
      for (let i = 0; i < n; i++) { const p = v(i), q = v(i + 1); seg(fort, (p.x + q.x) / 2, (p.z + q.z) / 2, Math.atan2(q.z - p.z, q.x - p.x)); }
    } else { row(0); if (pattern === 'double') row(-3 * CELL); }
  } else if (pattern === 'arc' || pattern === 'ring') {
    const ring = pattern === 'ring', R = drawn ? clamp(len, ring ? 6 : 8, ring ? 24 : 30) : ring ? 10 : 12, span = ring ? Math.PI * 2 : Math.PI * 2 / 3;
    const n = clamp(Math.round(R * span / SEG), ring ? 4 : 2, 20), step = ring ? span / n : SEG / R;
    for (let i = 0; i < n; i++) { const t = dir + (i - (n - 1) / 2) * step; seg('trench', a.x + Math.cos(t) * R, a.z + Math.sin(t) * R, t + Math.PI / 2); }
  } else if (pattern === 'strongpoint') {
    // a trench square around a, with barbed wire across the side it faces
    const h = SEG / 2 - CELL / 2, px = -dz, pz = dx;
    seg('trench', a.x + dx * h, a.z + dz * h, dir + Math.PI / 2); seg('trench', a.x - dx * h, a.z - dz * h, dir + Math.PI / 2);
    seg('trench', a.x + px * h, a.z + pz * h, dir); seg('trench', a.x - px * h, a.z - pz * h, dir);
    const f = h + 3 * CELL, wl = FORTS.wire.n * CELL / 2;
    seg('wire', a.x + dx * f + px * wl, a.z + dz * f + pz * wl, dir + Math.PI / 2); seg('wire', a.x + dx * f - px * wl, a.z + dz * f - pz * wl, dir + Math.PI / 2);
    return out; // trenches before wire
  }
  const cx = out.reduce((s, j) => s + j.x, 0) / out.length, cz = out.reduce((s, j) => s + j.z, 0) / out.length;
  return out.map((j, i) => [Math.hypot(j.x - cx, j.z - cz), i, j]).sort((p, q) => p[0] - q[0] || p[1] - q[1]).map(p => p[2]);
}
// what a segment costs: the fortification's price, less for the cells that cannot be built (already a trench, a road)
export const segmentCost = (kind, cells) => Math.max(1, Math.round(FORTS[kind].cost * cells / FORTS[kind].n));
const SUPPORT_SRC = new Set(Object.values(SUPPORT));
// Classic prices support in Munitions (mun) instead of manpower
Object.assign(SUPPORT.recon, { mun: 25 }); Object.assign(SUPPORT.artillery, { mun: 60 }); Object.assign(SUPPORT.strafe, { mun: 80 });
Object.assign(SUPPORT.smoke, { mun: 20 }); Object.assign(SUPPORT.bombing, { mun: 100 });
Object.assign(SUPPORT.dive, { mun: 70 }); Object.assign(SUPPORT.para, { mun: 90 }); Object.assign(SUPPORT.cover, { mun: 40 });
// Classic: unit abilities cost Munitions on top of their cooldown
export const AB_MUN = { grenade: 15, suppress: 10, ap: 15, smoke: 10, satchel: 30, ura: 10, barrage: 25 };
export const abCost = (g, ab) => (g.mode?.kind === 'classic' ? ab.mun ?? AB_MUN[ab.id] ?? 0 : 0);
const AIMED_AB = new Set(['grenade', 'barrage', 'satchel']); // used on a spot: the unit walks into range, then throws
// pay for an ability as it's used; false if the owner can't afford it
function payAb(g, u) {
  const c = abCost(g, UNITS[u.type].ab), p = g.players[u.owner];
  if (!c) return true;
  if (!(p.mun >= c)) return false;
  p.mun -= c;
  return true;
}
// units a player fields, trains or has incoming with paratroopers (planes count too)
export const popOf = (g, slot) => [...g.units.values()].reduce((a, u) => a + (u.owner === slot ? (UNITS[u.type].structure ? (u.queue?.length ?? 0) : 1) : 0), 0)
  + g.strikes.reduce((a, s) => a + (s.owner === slot && !s.live && SUPPORT[s.kind].unit ? 1 : 0), 0);
export const popCap = (g) => Math.round((g.mode?.kind === 'classic' ? CFG.classic.popCap : CFG.popCap) * (g.army?.pop ?? 1));
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
// 'annihilation' (every player has a fortified bunker, last team with one standing wins),
// 'classic' (base building, won by Annihilation) or 'horde' (everyone defends one bunker against waves; the horde is
// one more player, added here after the last name)
export function createGame(map, names, shuffle = true, teams = names.map((_, i) => i), factions = names.map((_, i) => i % 3), opts = {}) {
  const horde = opts.mode === 'horde' && map.defend?.length > 0 && names.length < MAX_PLAYERS;
  const assault = opts.mode === 'assault', noVp = assault || opts.mode === 'annihilation' || horde;
  if (horde) {
    // the horde wears a faction no defender picked (Germany first)
    factions = [...factions, [1, 2, 0].find(f => !factions.includes(f)) ?? 1];
    teams = [...names.map(() => 0), 1]; names = [...names, 'Horde'];
  }
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
  // horde: every defender shares the middle defender spawn as one HQ; the horde's own is the first attacker spawn
  if (horde) teams.forEach((t, i) => { spawnIdx[i] = t ? map.spawns.findIndex((_, k) => !map.defend.includes(k)) : map.defend[map.defend.length >> 1]; });
  const g = {
    w: map.w, h: map.h, flags: new Uint16Array(map.w * map.h),
    tick: 0, nextId: 1, winVp: winVp(teams), units: new Map(), shots: [], nades: [], salvos: [], smokes: [], strikes: [], winner: null,
    // terrain changed mid-match: full log for (re)joining clients, plus what's new since the last snapshot
    cellLog: [], newCells: [],
    players: names.map((name, slot) => {
      const s = map.spawns[spawnIdx[slot]];
      return { slot, name, team: teams[slot], faction: factions[slot], vp: 0, mp: CFG.mpStart, inc: CFG.mpBase, sup: Object.fromEntries(SUPPORT_TYPES.map(k => [k, 0])), spawn: { x: (s.x + 0.5) * CELL, z: (s.y + 0.5) * CELL }, visible: new Set() };
    }),
    // vp/mp per second while held; the map can make some points worth more
    // Assault and Annihilation have no VP, so points that only pay VP are left out (clients filter the same way)
    points: map.points.filter(p => !noVp || (p.mp ?? 1) > 0).map(p => ({ x: (p.x + 0.5) * CELL, z: (p.y + 0.5) * CELL, vp: p.vp ?? 1, mp: p.mp ?? 1, owner: -1, capper: -1, progress: 0 })),
  };
  map.rows.forEach((row, y) => [...row].forEach((ch, x) => { g.flags[y * map.w + x] = TERRAIN[ch] ?? 0; }));
  g.chars = [...map.rows.join('')];
  g.roads = g.chars.includes('D'); // no roads: vehicle paths skip the road arithmetic
  g.mines = new Map(); // mine cell -> the slot that laid it (a mine drawn on the map belongs to nobody)
  g.cellHp = Float32Array.from(g.chars, ch => CFG.terrainHp[ch] ?? 0);
  g.wear = Float32Array.from(g.chars, startWear); g.burnt = new Uint8Array(g.chars.length);
  g.cellState = Uint8Array.from(g.chars, startState);
  g.fires = new Map(); // burning cell -> seconds left
  g.soak = new Set(g.chars.keys()); // cells to look at for flooding (see flood)
  // wind, weather and fire roll their own dice, so they do not disturb the order of the combat rolls
  g.seed = Math.floor(Math.random() * 2 ** 32);
  g.wind = { a: rng(g) * Math.PI * 2, v: 0.3 + rng(g) * 0.5 };
  // rain 0-1 is how hard it is raining, wet 0-1 how soaked the ground is, next the seconds to the next change
  g.wx = opts.weather === false ? null : { rain: 0, raining: false, wet: 0, next: CFG.weather.firstRain + rng(g) * CFG.weather.dry[0] };
  g.height = Int8Array.from((map.heights || []).join(''), levelOf);
  if (g.height.length !== g.w * g.h) g.height = null; // flat map: skip all elevation math
  // The map clients download stays separate from later building footprints and terrain edits.
  g.initialTerrain = Object.freeze({ chars: Object.freeze([...g.chars]), height: g.height ? Object.freeze([...g.height]) : null });
  if (opts.mode === 'classic') setupClassic(g);
  for (const p of g.players) if (!horde || p.team === 0) (g.mode?.kind === 'classic' ? CFG.classic.startForce : CFG.startForce).forEach((t, i) => spawnUnit(g, p.slot, t, horde ? p.slot * 3 + i : i));
  if (horde) setupHorde(g, map);
  if (assault) {
    setupAssault(g, opts.defenderTeam, map.assaultTime);
    g.mode.total = [...g.units.values()].filter(u => UNITS[u.type].structure).length;
  }
  if (opts.mode === 'annihilation') {
    g.mode = { kind: 'annihilation', teams: new Set(teams).size };
    for (const p of g.players) { p.mp = CFG.assault.annihilationMp; fortify(g, p); }
    g.mode.bunkers = Array(Math.max(...teams) + 1).fill(0);
    for (const u of g.units.values()) if (u.type === 'bunker') g.mode.bunkers[g.players[u.owner].team]++;
  }
  g.army = typeof opts.army === 'string' && Object.hasOwn(CFG.armies, opts.army) ? CFG.armies[opts.army] : CFG.armies.standard;
  for (const p of g.players) p.mp *= g.army.income;
  // weather (shared/weather.js): the lobby's pick ('map' by default), the same plan for the same seed
  // (only Random uses the seed, so other weather leaves the sim's own random stream, and so the match, as it was)
  g.weather = planWeather(opts.weather ?? 'map', map, opts.mapKey, opts.weatherSeed ?? (opts.weather === 'random' ? Math.floor(Math.random() * 2 ** 31) : 1));
  // Rain is the living ground's rain (weather() below) all match, and Mud its soaked ground; either starts soaked, since a
  // match starts in its weather
  if (g.wx && g.weather.now === 'rain') Object.assign(g.wx, { raining: true, rain: 1, wet: 1 });
  if (g.wx && g.weather.now === 'mud') g.wx.wet = 1;
  return g;
}

// time: the map's own clock in seconds (big maps take longer to cross), else the default
function setupAssault(g, defenderTeam, time) {
  const A = CFG.assault;
  g.mode = { kind: 'assault', defenderTeam, attackerTeam: g.players.find(p => p.team !== defenderTeam)?.team ?? -1, timeLeft: time ?? A.time };
  for (const p of g.players) {
    const defending = p.team === defenderTeam;
    p.mp = defending ? A.defenderMp : A.attackerMp;
    if (defending) fortify(g, p);
  }
}
// Horde: one bunker and trench line at the shared HQ (owned by the first player), the waves' gates at the attacker
// spawns, and a break before wave 1. timeLeft counts the break down; active = a wave is on the map or in reserve.
function setupHorde(g, map) {
  const slot = g.players.length - 1;
  for (const p of g.players) p.mp = p.slot === slot ? 0 : CFG.assault.defenderMp;
  fortify(g, g.players[0]);
  const gate = (i) => ({ x: (map.spawns[i].x + 0.5) * CELL, z: (map.spawns[i].y + 0.5) * CELL });
  g.mode = { kind: 'horde', defenderTeam: 0, attackerTeam: 1, slot, defenders: slot, wave: 0, active: false, timeLeft: CFG.horde.break, reserve: [], budget: 0, left: 0,
    bunker: [...g.units.values()].find(u => u.type === 'bunker').id, gates: map.spawns.map((_, i) => i).filter(i => !map.defend.includes(i)).map(gate) };
}
// the units of wave n: the budget spent at random on what is unlocked by then, by weight
function hordePick(pool, left) {
  const can = pool.filter(([t]) => UNITS[t].cost <= left), total = can.reduce((a, c) => a + c[2], 0);
  if (!can.length) return null;
  let r = Math.random() * total;
  return (can.find(c => (r -= c[2]) < 0) ?? can[0])[0];
}
export function hordeWave(n, defenders, income = 1) {
  const H = CFG.horde, pool = H.unlock.filter(([, from]) => n >= from), out = [];
  let left = H.budget * H.growth ** (n - 1) * defenders * income;
  for (;;) {
    const type = hordePick(pool, left);
    if (!type) return out;
    out.push(type); left -= UNITS[type].cost;
  }
}
function stepHorde(g, dt) {
  const H = CFG.horde, m = g.mode, bunker = g.units.get(m.bunker), boss = g.players[m.slot];
  if (g.winner !== null) return;
  if (!bunker || bunker.hp <= 0) return finish(g, m.attackerTeam, 'structures', g.fallen?.structure);
  if (!m.active) {
    if ((m.timeLeft -= dt) > 0) return;
    m.wave++; m.active = true; m.timeLeft = 0;
    m.reserve = [];
    m.budget = Math.min(Number.MAX_SAFE_INTEGER, H.budget * H.growth ** (m.wave - 1) * m.defenders * g.army.income);
    // this wave's off-map support (the AI keeps 100 MP back) and planes; planes are not part of "wave dead"
    boss.mp = m.wave >= H.supportWave ? 100 + H.support * (m.wave - H.supportWave + 1) * m.defenders * g.army.income : 0;
    if (m.wave >= H.airWave) for (let i = 0, n = Math.min(8, (1 + Math.floor((m.wave - H.airWave) / 3)) * Math.ceil(m.defenders / 2)); i < n; i++) spawnUnit(g, m.slot, i % 3 === 2 ? 'fighter' : 'attacker');
  }
  const pool = H.unlock.filter(([, from]) => m.wave >= from);
  // Buy at most 32 units per tick into a fixed buffer; the rest of the wave remains a budget.
  for (let i = 0; i < 32 && m.budget > 0 && m.reserve.length < H.fieldMax; i++) {
    const type = hordePick(pool, m.budget);
    if (!type) { m.budget = 0; break; }
    m.reserve.push(type); m.budget -= UNITS[type].cost;
  }
  let field = 0;
  for (const u of g.units.values()) if (u.owner === m.slot && !u.air && u.hp > 0) field++;
  // reserves walk on at the gates, one per gate twice a second, while there is room on the field
  if (g.tick % 10 === 0) for (const gate of m.gates) {
    if (!m.reserve.length || field >= Math.min(H.fieldMax, H.field * m.defenders)) break;
    const u = spawnUnit(g, m.slot, m.reserve.pop()), a = Math.random() * Math.PI * 2;
    Object.assign(u, cellCenter(g, nearestFree(g, gate.x + Math.cos(a) * 5, gate.z + Math.sin(a) * 5)));
    updateGrid(g, u); field++;
    command(g, m.slot, { t: 'amove', orders: [[u.id, bunker.x, bunker.z]] });
  }
  m.left = field + m.reserve.length + Math.ceil(m.budget / Math.min(...pool.map(([t]) => UNITS[t].cost)));
  if (m.left) return;
  // wave dead: a break, the bunker is patched up, the horde's planes go home
  m.active = false; m.timeLeft = H.break;
  bunker.hp = Math.min(UNITS.bunker.hpPer, bunker.hp + UNITS.bunker.hpPer * H.heal);
  for (const u of [...g.units.values()]) if (u.owner === m.slot) g.units.delete(u.id);
}
// the shared horde bunker has 3000 hp per defender: it takes that much less damage instead, so its hp bar stays 0-100%
const bunkerMul = (g, t) => (t.type === 'bunker' && g.mode?.kind === 'horde' ? 1 / g.mode.defenders : 1);
// a command bunker for player p, with a trench line and sandbag walls on the side that faces the map center
function fortify(g, p) {
  // a trench line, then sandbag walls, with gaps to move through
  const toward = Math.atan2(g.h * CELL / 2 - p.spawn.z, g.w * CELL / 2 - p.spawn.x), r = CFG.assault.fortRadius;
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
  const footprints = g.buildingCells ??= new Map(), at = { id: u.id, owner, x: u.x, z: u.z };
  for (const k of cells) footprints.set(k, at); // Keep the footprint private after cancellation or destruction too.
  updateGrid(g, u);
  return u;
}
// a building works through its queue; each finished unit steps out on the side facing its rally point
function train(g, b, dt) {
  const type = b.queue[0];
  if ((b.prog += dt) < UNITS[type].train) return;
  b.prog = 0; b.queue.shift();
  const to = b.rally ?? { x: g.w * CELL / 2, z: g.h * CELL / 2 }, a = Math.atan2(to.z - b.z, to.x - b.x), r = UNITS[b.type].radius + 2;
  const u = spawnUnit(g, b.owner, type);
  if (u.air) { Object.assign(u, { x: b.x, z: b.z }); updateGrid(g, u); return; }
  const c = nearestFree(g, b.x + Math.cos(a) * r, b.z + Math.sin(a) * r);
  Object.assign(u, cellCenter(g, c), { rot: a, aim: a });
  updateGrid(g, u);
  if (b.rally) u.path = findPath(g, u, b.rally);
}
function wreckBuilding(g, u) {
  for (const c of u.cells) setCell(g, c, 'R');
  g.shots.push({ k: 'collapse', t: u.id, to: u.owner, x: u.x, z: u.z });
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
// how far a unit sees before height and houses: weather shortens it for everything on the ground (shared/weather.js)
const visionOf = (g, u) => UNITS[u.type].vision * (u.air ? 1 : sightMul(g));
// can this team see the spot right now? Airborne planes see across terrain.
export function teamSees(g, team, at) {
  return [...g.units.values()].some(u => g.players[u.owner].team === team && dist(u, at) <= visionOf(g, u)
    && (u.air ? airborne(u) : UNITS[u.type].building || los(g, u, at)));
}

function spawnUnit(g, owner, type, n = g.units.size) {
  const s = g.players[owner].spawn, a = n * 2.4;
  const c = nearestFree(g, s.x + Math.cos(a) * 4, s.z + Math.sin(a) * 4);
  const u = { id: g.nextId++, type, owner, x: (c % g.w + 0.5) * CELL, z: (Math.floor(c / g.w) + 0.5) * CELL,
    rot: 0, aim: 0, hp: UNITS[type].models * UNITS[type].hpPer, supp: 0,
    path: [], orders: [], attackId: 0, targetId: 0, cooldown: 0, still: 0, retarget: 0, repath: 0, stuck: 0,
    cd: 0, buff: 0, ap: false, nade: null, retreating: false, reinf: 0, dig: null,
    garrison: -1, enter: -1, amove: null, xp: 0, fireAt: -1, sprint: 0,
    // autocast starts on where abilities are free (cooldown only) and off where they cost Munitions (Classic)
    auto: UNITS[type].ab.id !== 'none' && !abCost(g, UNITS[type].ab) };
  if (UNITS[type].air) { u.air = { state: 'base', fuel: CFG.air.station, ammo: UNITS[type].ammo, timer: 0, ang: 0, mission: null }; Object.assign(u, airBase(g, u)); }
  g.units.set(u.id, u);
  updateGrid(g, u);
  return u;
}
// ---------- planes ----------
export const airborne = (u) => !!u.air && (u.air.state === 'out' || u.air.state === 'station' || u.air.state === 'home');
// where a plane takes off and rearms: in Classic its owner's nearest finished Airfield, otherwise (or with none) an
// off-map airbase out past its owner's HQ
function airBase(g, u) {
  let best = null, bd = Infinity;
  for (const b of g.units.values()) if (b.type === 'airfield' && b.owner === u.owner && b.built >= 1 && b.hp > 0 && dist(b, u) < bd) { bd = dist(b, u); best = b; }
  if (best) return { x: best.x, z: best.z };
  const p = g.players[u.owner].spawn, cx = g.w * CELL / 2, cz = g.h * CELL / 2, l = Math.hypot(p.x - cx, p.z - cz) || 1;
  return { x: p.x + (p.x - cx) / l * CFG.air.offmap, z: p.z + (p.z - cz) / l * CFG.air.offmap };
}
// give a plane a mission (patrol a spot, attack a target, escort a friend); a rearming plane, or one out of fuel or
// ammo, can't go
function sendPlane(u, m) {
  const a = u.air;
  if (a.state === 'rearm' || a.fuel <= 0 || a.ammo <= 0) return;
  a.mission = m; a.state = 'out';
}
function stepPlane(g, u, dt) {
  const def = UNITS[u.type], a = u.air, A = CFG.air, base = airBase(g, u);
  u.cooldown -= dt; u.retarget -= dt; u.targetId = 0;
  if (a.state === 'base' || a.state === 'rearm') {
    Object.assign(u, base);
    updateGrid(g, u);
    if (a.state === 'rearm') { u.hp = Math.min(def.hpPer, u.hp + def.hpPer * dt / A.rearm); if ((a.timer -= dt) <= 0) Object.assign(a, { state: 'base', fuel: A.station, ammo: def.ammo }); }
    return;
  }
  // follow the mission's target; a lost attack target becomes a patrol where it was, a lost escort too
  const m = a.mission, t = m?.id && g.units.get(m.id);
  if (m && t && t.hp > 0 && (m.kind === 'escort' || g.players[u.owner].visible.has(t.id))) { m.x = t.x; m.z = t.z; }
  else if (m && m.id) { m.kind = 'patrol'; m.id = 0; }
  let center = m ?? base;
  // fighters go after enemy planes they can see near the mission
  if (def.role === 'fighter' && !u.holdFire && a.state !== 'home') {
    let bd = A.seek;
    for (const e of g.units.values()) if (e.air && airborne(e) && !allied(g, e.owner, u.owner) && g.players[u.owner].visible.has(e.id) && dist(e, center) < bd) { bd = dist(e, center); center = e; }
  }
  if (a.state === 'station') a.fuel -= dt;
  if (a.state !== 'home' && (a.fuel <= 0 || a.ammo <= 0 || u.hp < def.hpPer * A.bail || !m)) a.state = 'home';
  // fly: out to the mission, circle it (tighter on an attack run), home to rearm
  const R = m?.kind === 'attack' && def.role === 'attack' ? 10 : A.orbit;
  let goal = base;
  if (a.state === 'out') { goal = center; if (dist(u, center) < R + 6) a.state = 'station'; }
  if (a.state === 'station') { a.ang += def.speed / R * dt; goal = { x: center.x + Math.cos(a.ang) * R, z: center.z + Math.sin(a.ang) * R }; }
  const d = dist(u, goal), step = Math.min(d, def.speed * dt);
  if (d > 0.01) { u.rot = Math.atan2(goal.z - u.z, goal.x - u.x); u.x += (goal.x - u.x) / d * step; u.z += (goal.z - u.z) / d * step; }
  updateGrid(g, u);
  if (a.state === 'home') { if (dist(u, base) < 6) Object.assign(a, { state: 'rearm', timer: A.rearm, mission: null }); return; }
  // guns, rockets and bombs on ground targets (the attack target first)
  const tgt = m?.kind === 'attack' && t && !allied(g, t.owner, u.owner) && canShoot(g, u, t) ? t : null;
  if (u.holdFire && !tgt) return;
  if (!tgt && u.retarget <= 0) { u.attackPick = pickTarget(g, u); u.retarget = 0.5; }
  const shoot = tgt ?? g.units.get(u.attackPick);
  if (shoot && canShoot(g, u, shoot)) { u.targetId = shoot.id; u.aim = Math.atan2(shoot.z - u.z, shoot.x - u.x); if (u.cooldown <= 0) { fire(g, u, shoot, true); a.ammo--; } }
}
// anti-air: everything with aa (flak, mobile flak, emplacements, fighters, a little from MGs) damages the nearest enemy
// plane it can see in range, every tick. Flak and MGs must be set up; buildings must be finished; fighters airborne.
function antiAir(g, list, dt) {
  for (const u of list) {
    const aa = UNITS[u.type].aa;
    if (!aa?.dps || u.hp <= 0 || (aa.setup && u.still < 2) || (u.air && !airborne(u)) || (u.built !== undefined && u.built < 1)) continue;
    if (u.holdFire && (!u.air || u.air.mission?.kind !== 'attack')) continue;
    let best = null, bd = aa.range;
    for (const t of gridFor(g).candidates(u, aa.range, true, t => t.air && airborne(t) && t.hp > 0 && !allied(g, t.owner, u.owner) && g.players[u.owner].visible.has(t.id) && (!u.holdFire || u.air.mission.id === t.id))) if (dist(u, t) <= bd) { bd = dist(u, t); best = t; }
    if (!best) continue;
    best.hp -= aa.dps * dt; best.lastHit = u.owner;
    u.xp += Math.min(aa.dps * dt, Math.max(0, best.hp + aa.dps * dt));
    if ((u.aaShot = (u.aaShot ?? 0) - dt) <= 0) { u.aaShot = 0.35; g.shots.push({ f: u.id, t: best.id, fo: u.owner, to: best.owner, x: best.x, z: best.z, k: 'aa' }); }
    if (best.hp <= 0 && !best.downed) { best.downed = true; tally(g, u.owner, 'planesDowned'); g.shots.push({ k: 'planedown', t: best.id, to: best.owner, x: best.x, z: best.z, dir: best.rot, kill: true }); }
  }
}

// ---------- grid ----------

const cellOf = (g, x, z) => {
  const cx = Math.floor(x / CELL), cy = Math.floor(z / CELL);
  return cx < 0 || cy < 0 || cx >= g.w || cy >= g.h ? -1 : cy * g.w + cx;
};
const flagsAt = (g, x, z) => { const c = cellOf(g, x, z); return c < 0 ? MOVE | SIGHT : g.flags[c]; };
export const inCover = (g, u) => UNITS[u.type].infantry && (flagsAt(g, u.x, u.z) & COVER) > 0;
export const inTrench = (g, u) => UNITS[u.type].infantry && (flagsAt(g, u.x, u.z) & TRENCH) > 0;
// how much of its protection a cover cell still gives: walls and hedges lose it as they are shot up (down to half),
// a crater gives more the deeper it is
const coverQ = (g, c) => {
  const ch = g.chars[c], max = CFG.terrainHp[ch];
  return ch === '+' ? Math.min(1.4, 0.55 + (g.wear ? g.wear[c] : 0.45)) : max > 1 ? 0.5 + 0.5 * Math.max(0, g.cellHp[c]) / max : 1;
};
const coverMul = (g, t) => (t.garrison >= 0 ? CFG.garrisonMul : inTrench(g, t) ? CFG.trenchMul : inCover(g, t) ? 1 - (1 - CFG.coverMul) * coverQ(g, cellOf(g, t.x, t.z)) : 1);
// Cover from something solid between you and the shooter, within ~2 m on their side:
// a house, wall, rubble, hedge, or a vehicle. Protects from the front, not the flank.
const SOLID = new Set(['B', '#', 'R', 'H', 'K']);
const WALLS = new Set(['B', 'K']), AROUND = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
// 0-1: full within about 2 m of the thing, fading to nothing at 3.8 m, and less behind something half shot away
export function coverBehind(g, t, from) {
  const a = Math.atan2(from.z - t.z, from.x - t.x), ca = Math.cos(a), sa = Math.sin(a);
  let best = 0;
  for (let d = 0.8; d < 3.7; d += 0.7) {
    const c = cellOf(g, t.x + ca * d, t.z + sa * d);
    if (c >= 0 && SOLID.has(g.chars[c])) { best = Math.min(1, (3.8 - d) / 1.6) * Math.min(1, coverQ(g, c)); break; }
  }
  // leaning out from a corner: a house wall in a cell next to the squad, within 60 degrees of the shooter
  const x = Math.floor(t.x / CELL), y = Math.floor(t.z / CELL);
  for (const [dx, dy] of AROUND) {
    if (x + dx < 0 || y + dy < 0 || x + dx >= g.w || y + dy >= g.h || !WALLS.has(g.chars[(y + dy) * g.w + x + dx])) continue;
    if ((dx * ca + dy * sa) / Math.hypot(dx, dy) > 0.5) best = 1;
  }
  for (const v of gridFor(g).candidates(t, 4, false, v => v !== t && !v.air && !UNITS[v.type].infantry && v.hp > 0)) {
    const dx = v.x - t.x, dz = v.z - t.z, d = Math.hypot(dx, dz);
    if (d > 0 && d < 4 && (dx * ca + dz * sa) / d > 0.7) best = Math.max(best, Math.min(1, (4 - d) / 1.5));
  }
  return best;
}
const behindCover = (g, t, from) => coverBehind(g, t, from) > 0.4;

// ---------- ground: wear, depth and the speed it allows ----------
// g.wear holds one number per cell, 0-1, and it means what the cell's type makes of it: how churned open ground is,
// how deep mud, a ford or a crater is, how broken a road is.
const lerp = (a, b, t) => a + (b - a) * t;
const rng = (g) => { let t = g.seed = (g.seed + 0x6D2B79F5) | 0; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
// a stable 0-1 number per cell, so two fords or two mud patches on one map are not alike
const cellNoise = (c) => { let h = Math.imul(c + 1, 0x9e3779b1); h ^= h >>> 15; h = Math.imul(h, 0x85ebca6b); return ((h ^ h >>> 13) >>> 0) / 4294967296; };
const startWear = (ch, c) => (ch === 'M' || ch === 'F' ? 0.2 + 0.6 * cellNoise(c) : ch === '+' ? 0.3 + 0.3 * cellNoise(c) : 0);
// What clients are told about a cell besides its type: wear in quarters (bits 0-1), burnt (bit 2), and how shot up a
// wall, hedge or house is (bits 3-4: 0 whole, 1 damaged, 2 nearly gone).
const packState = (wear, burnt, hp, max) => Math.min(3, Math.floor(wear * 4)) | (burnt ? 4 : 0) | (max > 1 && hp < max * 0.67 ? (hp < max * 0.34 ? 16 : 8) : 0);
const stateOf = (g, c) => packState(g.wear[c], g.burnt[c], g.cellHp[c], CFG.terrainHp[g.chars[c]]);
// the state a map cell starts in (clients use it for cells the server has not mentioned yet)
export const startState = (ch, c) => packState(startWear(ch, c), 0, 1, 1);
// tell the clients when a cell's state crosses into another step
function touch(g, c) { const s = stateOf(g, c); if (s !== g.cellState[c]) { g.cellState[c] = s; logCell(g, c, [c, g.chars[c]]); } }
// how fast a unit moves on one cell (1 = open dry ground)
function groundMul(g, c, veh) {
  const f = g.flags[c], w = g.wear ? g.wear[c] : 0, wet = g.wx ? g.wx.wet * (g.height && g.height[c] < 0 ? 2 : 1) : 0;
  if (f & FORD) return lerp(CFG.fordSpeed[0], CFG.fordSpeed[1], w) * (1 - CFG.weather.wetFord * Math.min(1, wet));
  if (!veh) return f & WIRE ? CFG.wireSpeed : 1;
  if (f & ROAD) return lerp(CFG.roadSpeed, 1, w);
  if (f & MUD) return lerp(CFG.mudSpeed[0], CFG.mudSpeed[1], w) * (1 - CFG.weather.wetGround * wet);
  return (1 - CFG.churn * w) * (1 - CFG.weather.wetGround * wet);
}
// A unit's speed is the average over what it stands on, so a tank half on a road gets half the bonus and nothing
// snaps at a cell's edge. Water and walls beside it do not count.
const FOOT = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]];
function speedMul(g, u) {
  const def = UNITS[u.type], r = def.radius * 0.6;
  let sum = 0, n = 0;
  for (const [dx, dz] of FOOT) { const c = cellOf(g, u.x + dx * r, u.z + dz * r); if (c >= 0 && !(g.flags[c] & MOVE)) { sum += groundMul(g, c, !def.infantry); n++; } }
  return n ? sum / n : 1;
}
// for the HUD: is there anything solid right next to this squad?
function nearCover(g, u) {
  const c = Math.floor(u.z / CELL) * g.w + Math.floor(u.x / CELL);
  if (SOLID.has(g.chars[c + 1]) || SOLID.has(g.chars[c - 1]) || SOLID.has(g.chars[c + g.w]) || SOLID.has(g.chars[c - g.w])) return true;
  if (WALLS.has(g.chars[c + g.w + 1]) || WALLS.has(g.chars[c + g.w - 1]) || WALLS.has(g.chars[c - g.w + 1]) || WALLS.has(g.chars[c - g.w - 1])) return true; // a house corner
  return gridFor(g).candidates(u, 3.5, false, v => v !== u && !v.air && !UNITS[v.type].infantry).some(v => dist(u, v) < 3.5);
}
export const vet = (u) => (UNITS[u.type].cost ? CFG.vetXp.filter(k => u.xp >= k * UNITS[u.type].cost).length : 0); // free units (the bunker) never rank up
const cellCenter = (g, c) => ({ x: (c % g.w + 0.5) * CELL, z: (Math.floor(c / g.w) + 0.5) * CELL });

// ---------- seeking cover ----------
// how well a spot protects infantry from a threat at `from` (may be null): 0 trench, 1 cover cell,
// 2 behind something solid on the threat's side, 3 open ground
const coverRank = (g, at, from) => { const f = flagsAt(g, at.x, at.z); return f & TRENCH ? 0 : f & COVER ? 1 : from && behindCover(g, at, from) ? 2 : 3; };
// nothing ordered and nothing under way
const busy = (u) => u.path.length > 0 || !!u.attackId || !!u.dig || !!u.nade || !!u.amove || !!u.build || u.enter >= 0 || u.fireAt >= 0 || u.retreating;
const idle = (u) => !busy(u) && !u.orders.length;
// squads in cover are not pushed out of it by others crowding past
const shovedFromCover = (g, u, x, z) => inCover(g, u) && !(flagsAt(g, x, z) & COVER);
// Sends a squad to the nearest spot within CFG.coverSeek that protects it better than where it stands (a trench is
// worth a 4 m longer walk than plain cover). Spots another squad stands on or has just claimed are left alone.
// Returns whether it set off.
function seekCover(g, u, from) {
  const now = coverRank(g, u, from);
  if (now === 0) return false;
  const r = Math.ceil(CFG.coverSeek / CELL), cx = Math.floor(u.x / CELL), cy = Math.floor(u.z / CELL), claims = g.coverClaims ??= new Map(), spots = [];
  for (let y = Math.max(0, cy - r); y <= Math.min(g.h - 1, cy + r); y++) for (let x = Math.max(0, cx - r); x <= Math.min(g.w - 1, cx + r); x++) {
    const c = y * g.w + x;
    if (g.flags[c] & (MOVE | WIRE)) continue;
    const at = cellCenter(g, c), d = dist(u, at), rank = d <= CFG.coverSeek ? coverRank(g, at, from) : 3;
    if (rank >= now) continue;
    const claim = claims.get(c);
    if (claim && claim.id !== u.id && g.tick - claim.tick < 100 && g.units.get(claim.id)?.hp > 0) continue;
    // behind something solid, a spot that can still see the threat (a corner to lean out from) beats a blind one
    spots.push({ c, at, score: d + rank * 4 + (rank === 2 && !los(g, at, from) ? 3 : 0) });
  }
  spots.sort((a, b) => a.score - b.score);
  let tries = 0;
  for (const { c, at } of spots) {
    if (gridFor(g).candidates(at, CELL, false, v => v !== u && !v.air && v.garrison < 0 && cellOf(g, v.x, v.z) === c).length) continue;
    if (tries++ >= 3) break; // ponytail: three path searches at most; cover behind a river or cliff is simply skipped
    const path = findPath(g, u, at);
    let len = 0, p = u;
    for (const q of path) { len += dist(p, q); p = q; }
    if (!path.length || len > CFG.coverSeek * 1.5) continue;
    u.path = path; claims.set(c, { id: u.id, tick: g.tick });
    return true;
  }
  return false;
}

// leave a building onto the nearest open cell
function exitBuilding(g, u) {
  if (u.garrison < 0) return;
  const c = nearestFree(g, u.x, u.z), p = cellCenter(g, c);
  u.x = p.x; u.z = p.z; u.garrison = -1;
  updateGrid(g, u);
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

function logCell(g, c, change) {
  const indexes = g.cellLogIndexes ??= new Map();
  let index = indexes.get(c);
  const state = g.cellState ? g.cellState[c] : 0;
  const latest = state ? [c, g.chars[c], g.height ? g.height[c] : 0, state] : g.height ? [c, g.chars[c], g.height[c]] : change;
  if (index === undefined) { index = g.cellLog.length; indexes.set(c, index); g.cellLog.push(latest); }
  else g.cellLog[index] = latest;
  // Keep each viewer's changes independently of the transient snapshot batch.
  for (const p of g.players) p.terrainPending?.add(index);
  g.newCells.push(change);
}

function setCell(g, c, ch) {
  const old = g.flags[c], next = TERRAIN[ch];
  if (g.chars[c] === 'N') g.mines.delete(c);
  g.flags[c] = next; g.chars[c] = ch; g.cellHp[c] = CFG.terrainHp[ch] ?? 0;
  g.fires?.delete(c);
  if (g.soak) for (const n of [c, c - 1, c + 1, c - g.w, c + g.w]) g.soak.add(n); // flood() sorts out which of them count
  if (g.wear) { g.wear[c] = startWear(ch, c); g.cellState[c] = stateOf(g, c); }
  g.terrainVersion = (g.terrainVersion ?? 0) + 1;
  // Cover and wire edits leave the region graph unchanged. Only movement bits relabel it.
  if ((old ^ next) & MOVE) g.infantryRegionVersion = (g.infantryRegionVersion ?? 0) + 1;
  if ((old ^ next) & (MOVE | VBLOCK)) g.vehicleRegionVersion = (g.vehicleRegionVersion ?? 0) + 1;
  logCell(g, c, [c, ch]);
}
// a heavy blast digs the cell one level down, but never below a neighbour's slope (no pits you can't climb out of)
function dent(g, c) {
  if (c < 0) return;
  g.height ??= new Int8Array(g.w * g.h);
  const L = g.height[c] - 1, x = c % g.w;
  if (L < CFG.minLevel || [c - g.w, c + g.w, x > 0 ? c - 1 : -1, x < g.w - 1 ? c + 1 : -1].some(n => n >= 0 && n < g.height.length && g.height[n] - L > 1)) return;
  g.height[c] = L; g.soak?.add(c);
  g.terrainVersion = (g.terrainVersion ?? 0) + 1;
  g.infantryRegionVersion = (g.infantryRegionVersion ?? 0) + 1;
  g.vehicleRegionVersion = (g.vehicleRegionVersion ?? 0) + 1;
  logCell(g, c, [c, g.chars[c], L]);
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
// ground height in metres, smooth between cell centres (levelAt is the step version)
function heightAt(g, x, z) {
  const fx = Math.min(g.w - 1, Math.max(0, x / CELL - 0.5)), fz = Math.min(g.h - 1, Math.max(0, z / CELL - 0.5));
  const x0 = Math.floor(fx), z0 = Math.floor(fz), x1 = Math.min(g.w - 1, x0 + 1), z1 = Math.min(g.h - 1, z0 + 1), tx = fx - x0, tz = fz - z0;
  const h = (cx, cz) => g.height[cz * g.w + cx];
  return (h(x0, z0) * (1 - tx) * (1 - tz) + h(x1, z0) * tx * (1 - tz) + h(x0, z1) * (1 - tx) * tz + h(x1, z1) * tx * tz) * CFG.levelHeight;
}
// hills block sight: sample the line between two eyes and compare with the ground under it
const overHills = (g, a, b) => hillsClear(g, a.x, a.z, b.x, b.z);
function hillsClear(g, ax, az, bx, bz) {
  if (!g.height) return true;
  const L = CFG.levelHeight, ya = levelAt(g, ax, az) * L + CFG.eye, yb = levelAt(g, bx, bz) * L + CFG.eye;
  const d = Math.hypot(bx - ax, bz - az), n = Math.ceil(d / (CELL / 2));
  for (let i = 1; i < n; i++) {
    const t = i / n;
    if (levelAt(g, ax + (bx - ax) * t, az + (bz - az) * t) * L > ya + (yb - ya) * t) return false;
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

function walkable(g, a, b, mask = MOVE) {
  // three parallel rays so wide units don't clip building corners
  const d = Math.hypot(b.x - a.x, b.z - a.z) || 1, ox = -(b.z - a.z) / d * 0.9, oz = (b.x - a.x) / d * 0.9;
  return [-1, 0, 1].every(k => clear(g, a.x + ox * k, a.z + oz * k, b.x + ox * k, b.z + oz * k, mask, true)) && noCliffs(g, a, b);
}

// Shared scratch buffers are safe because path searches are synchronous. Stamps avoid map-wide fills.
let pathBuffers;
function buffersFor(N) {
  if (!pathBuffers || pathBuffers.gs.length < N) pathBuffers = {
    gs: new Float32Array(N), came: new Int32Array(N), seen: new Uint32Array(N), closed: new Uint32Array(N),
    freeSeen: new Uint32Array(N), freeQueue: new Int32Array(N), generation: 0, freeGeneration: 0,
    heapScores: new Float64Array(N), heapCells: new Int32Array(N), heapLength: 0,
  };
  return pathBuffers;
}
function nextGeneration(b, free = false) {
  const key = free ? 'freeGeneration' : 'generation';
  b[key] = (b[key] + 1) >>> 0;
  if (!b[key]) {
    if (free) b.freeSeen.fill(0);
    else { b.seen.fill(0); b.closed.fill(0); }
    b[key] = 1;
  }
  return b[key];
}
function nearestFree(g, x, z) {
  const cx = Math.min(g.w - 1, Math.max(0, Math.floor(x / CELL))), cy = Math.min(g.h - 1, Math.max(0, Math.floor(z / CELL)));
  const start = cy * g.w + cx;
  if (!(g.flags[start] & MOVE)) return start;
  const b = buffersFor(g.w * g.h), gen = nextGeneration(b, true), seen = b.freeSeen, q = b.freeQueue;
  let length = 1;
  q[0] = start; seen[start] = gen;
  for (let i = 0; i < length; i++) {
    const c = q[i];
    if (!(g.flags[c] & MOVE)) return c;
    const x0 = c % g.w, y0 = Math.floor(c / g.w);
    for (const [ddx, ddy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x0 + ddx, ny = y0 + ddy, n = ny * g.w + nx;
      if (nx >= 0 && ny >= 0 && nx < g.w && ny < g.h && seen[n] !== gen) { seen[n] = gen; q[length++] = n; }
    }
  }
  return start;
}

const pathRegions = new WeakMap();
const regionDx = [-1, 1, 0, 0, -1, 1, -1, 1], regionDy = [0, 0, -1, 1, -1, -1, 1, 1];
function regionsFor(g, block) {
  let data = pathRegions.get(g);
  const version = block === MOVE ? g.infantryRegionVersion ?? 0 : g.vehicleRegionVersion ?? 0, W = g.w, N = W * g.h;
  if (!data || data.w !== W || data.h !== g.h) {
    data = { w: W, h: g.h, masks: new Map() }; pathRegions.set(g, data);
  }
  let entry = data.masks.get(block);
  if (entry?.version === version) return entry.labels;
  if (!entry) { entry = { labels: new Int32Array(N), version: -1 }; data.masks.set(block, entry); }
  const { labels } = entry, flags = g.flags, heights = g.height, queue = buffersFor(N).freeQueue;
  for (let c = 0; c < N; c++) labels[c] = flags[c] & block ? -1 : 0;
  const offsets = [-1, 1, -W, W, -W - 1, -W + 1, W - 1, W + 1], directions = heights ? 8 : 4;
  // Flat diagonals connect through their open corners, so cardinal edges already give the same regions.
  // With hills, add a diagonal when either directed corner check permits it.
  for (let seed = 0; seed < N; seed++) {
    if (labels[seed] !== 0) continue;
    const label = seed + 1;
    let tail = 1;
    queue[0] = seed; labels[seed] = label;
    for (let head = 0; head < tail; head++) {
      const c = queue[head], x = c % W, height = heights ? heights[c] : 0;
      for (let k = 0; k < directions; k++) {
        const dx = regionDx[k];
        if (dx < 0 && x === 0 || dx > 0 && x === W - 1) continue;
        const n = c + offsets[k];
        if (labels[n] !== 0) continue; // also skips cells outside the map
        if (heights) {
          const nextHeight = heights[n];
          if (Math.abs(nextHeight - height) > 1) continue;
          if (k >= 4) {
            const a = c + dx, b = c + regionDy[k] * W;
            if (flags[a] & block || flags[b] & block) continue;
            const ah = heights[a], bh = heights[b];
            if (!(Math.abs(ah - height) <= 1 && Math.abs(bh - height) <= 1) && !(Math.abs(ah - nextHeight) <= 1 && Math.abs(bh - nextHeight) <= 1)) continue;
          }
        }
        labels[n] = label; queue[tail++] = n;
      }
    }
  }
  entry.version = version;
  return labels;
}
const pathStatsFor = (g) => (g.pathStats ??= { calls: 0, deferred: 0, failed: 0, dropped: 0, expansions: 0, regionRejected: 0 });
const pathFailures = new WeakMap(), pathWork = new WeakMap();

function heapPush(b, score, cell) {
  if (b.heapLength === b.heapCells.length) {
    const scores = new Float64Array(b.heapLength * 2), cells = new Int32Array(b.heapLength * 2);
    scores.set(b.heapScores); cells.set(b.heapCells); b.heapScores = scores; b.heapCells = cells;
  }
  let i = b.heapLength++;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (b.heapScores[p] <= score) break;
    b.heapScores[i] = b.heapScores[p]; b.heapCells[i] = b.heapCells[p]; i = p;
  }
  b.heapScores[i] = score; b.heapCells[i] = cell;
}
function heapPop(b) {
  const top = b.heapCells[0], last = --b.heapLength;
  if (last) {
    b.heapScores[0] = b.heapScores[last]; b.heapCells[0] = b.heapCells[last];
    for (let i = 0; ;) {
      const l = 2 * i + 1, r = l + 1; let m = i;
      if (l < last && b.heapScores[l] < b.heapScores[m]) m = l;
      if (r < last && b.heapScores[r] < b.heapScores[m]) m = r;
      if (m === i) break;
      const score = b.heapScores[i], cell = b.heapCells[i];
      b.heapScores[i] = b.heapScores[m]; b.heapCells[i] = b.heapCells[m];
      b.heapScores[m] = score; b.heapCells[m] = cell; i = m;
    }
  }
  return top;
}

// A* over the grid, 8-directional, no corner cutting. Returns smoothed world waypoints.
export function findPath(g, from, to) {
  pathFailures.delete(from); // a fresh immediate command resets earlier retry failures
  const W = g.w, N = W * g.h, goal = nearestFree(g, to.x, to.z), start = Math.max(0, cellOf(g, from.x, from.z));
  // vehicles can't cross tank traps; infantry go around wire when there's a way (straight lines don't cross it either)
  const veh = UNITS[from.type] && !UNITS[from.type].infantry, block = veh ? MOVE | VBLOCK : MOVE, pull = veh ? block | MUD : MOVE | WIRE;
  const roads = veh && g.roads, low = roads ? 1 / CFG.roadSpeed : 1; // the cheapest step, so the estimate never overshoots
  const burning = g.fires?.size > 0;
  const stats = pathStatsFor(g); stats.calls++;
  if (goal !== start && !(g.flags[start] & block)) {
    const labels = regionsFor(g, block);
    if (labels[goal] < 0 || labels[start] !== labels[goal]) { stats.failed++; stats.regionRejected++; return []; }
  }
  const b = buffersFor(N), gen = nextGeneration(b), { gs, came, seen, closed } = b;
  const gx = goal % W, gy = Math.floor(goal / W);
  const hq = (c) => { const dx = Math.abs(c % W - gx), dy = Math.abs(Math.floor(c / W) - gy); return (Math.max(dx, dy) + 0.414 * Math.min(dx, dy)) * low; };
  b.heapLength = 0; heapPush(b, hq(start), start);
  gs[start] = 0; seen[start] = gen; came[start] = -1;
  while (b.heapLength) {
    const c = heapPop(b);
    if (c === goal) break;
    if (closed[c] === gen) continue;
    closed[c] = gen; stats.expansions++;
    const x = c % W, y = Math.floor(c / W);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= g.h) continue;
      const n = ny * W + nx;
      if (g.flags[n] & block || closed[n] === gen) continue;
      if (dx && dy && (g.flags[y * W + nx] & block || g.flags[ny * W + x] & block)) continue;
      const climb = level(g, n) - level(g, c);
      if (Math.abs(climb) > 1) continue; // cliff
      if (dx && dy && (Math.abs(level(g, y * W + nx) - level(g, c)) > 1 || Math.abs(level(g, ny * W + x) - level(g, c)) > 1)) continue;
      // uphill costs a bit more, wire a lot, fire more; a vehicle's step costs the time its ground takes (road, mud, churn)
      const cost = gs[c] + (dx && dy ? 1.414 : 1) * (veh ? Math.max(low, 1 / groundMul(g, n, true)) : 1) + Math.max(0, climb) * 0.5 + (!veh && g.flags[n] & WIRE ? 4 : 0) + (burning && g.fires.has(n) ? 8 : 0);
      if (seen[n] !== gen || cost < gs[n]) { gs[n] = cost; came[n] = c; seen[n] = gen; heapPush(b, cost + hq(n), n); }
    }
  }
  if (goal !== start && (seen[goal] !== gen || came[goal] < 0)) { stats.failed++; return []; }
  const pts = [];
  for (let c = goal; c !== start && c >= 0; c = came[c]) pts.unshift({ x: (c % W + 0.5) * CELL, z: (Math.floor(c / W) + 0.5) * CELL });
  if (goal === cellOf(g, to.x, to.z) && pts.length) pts[pts.length - 1] = { x: to.x, z: to.z };
  // string-pull: jump to the furthest waypoint reachable in a straight line
  const out = [];
  let at = from;
  for (let i = 0; i < pts.length;) {
    let j = pts.length - 1;
    // a vehicle keeps to the road it chose: no shortcut past the next road cell
    if (roads) for (let k = i; k < j; k++) if (flagsAt(g, pts[k].x, pts[k].z) & ROAD) { j = k; break; }
    while (j > i && !walkable(g, at, pts[j], pull)) j--;
    out.push(pts[j]); at = pts[j]; i = j + 1;
  }
  return out;
}

// where a squad walks to for its dig: the spot itself, or for a bridge a point on its own bank just inside reach
// (the middle of the river has no nearest bank, and the far one cannot be walked to)
const digGoal = (u) => (!u.dig.reach ? u.dig : (u.dig.from ??= (() => { const k = (u.dig.reach - 2) / (dist(u, u.dig) || 1); return { x: u.dig.x + (u.x - u.dig.x) * k, z: u.dig.z + (u.z - u.dig.z) * k }; })()));
function currentPathGoal(g, u, kind) {
  if (u.hp <= 0 || u.retreating) return null;
  const def = UNITS[u.type];
  if (kind === 'build') {
    const s = g.units.get(u.build);
    return s && !(s.built >= 1 && s.hp >= UNITS[s.type].hpPer) && !u.path.length && dist(u, s) > UNITS[s.type].radius + CFG.classic.buildReach ? s : null;
  }
  if (kind === 'dig') return u.dig && !u.path.length && dist(u, u.dig) > (u.dig.reach ?? 3) ? digGoal(u) : null;
  if (kind === 'nade') return u.nade && dist(u, u.nade) > def.ab.range ? u.nade : null;
  if (kind === 'enter') {
    const at = u.enter >= 0 && g.chars[u.enter] === 'B' ? cellCenter(g, u.enter) : null;
    return at && !u.path.length && dist(u, at) > CELL * 1.6 ? at : null;
  }
  if (kind === 'amove') return u.amove && !u.path.length && dist(u, u.amove) >= 2.5 && !canShoot(g, u, g.units.get(u.targetId)) ? u.amove : null;
  if (kind === 'fireAt') {
    const at = u.fireAt >= 0 && g.cellHp[u.fireAt] > 0 ? cellCenter(g, u.fireAt) : null;
    return at && !u.path.length && !(dist(u, at) <= def.w.range && (def.w.salvo || los(g, u, at))) ? at : null;
  }
  const target = g.units.get(u.attackId);
  return target && g.players[u.owner].visible.has(target.id) && !canShoot(g, u, target) ? target : null;
}
const pathGoalKey = (kind, to) => `${kind}:${to.x}:${to.z}`;
function performStepPath(g, u, to, kind, work) {
  const key = pathGoalKey(kind, to), previous = pathFailures.get(u), stats = pathStatsFor(g), failures = stats.failed;
  work.used++;
  u.path = findPath(g, u, to); u.repath = 1;
  if (stats.failed === failures) return;
  const version = g.terrainVersion ?? 0;
  const count = previous?.key === key && previous.version === version ? previous.count + 1 : 1;
  if (count < (g.pathRetryLimit ?? 20)) { pathFailures.set(u, { key, version, count }); return; }
  u[kind] = kind === 'build' || kind === 'attackId' ? 0 : kind === 'enter' || kind === 'fireAt' ? -1 : null;
  u.path = []; u.stuck = 0; pathFailures.delete(u); stats.dropped++;
}
function beginPathTick(g) {
  let work = pathWork.get(g);
  if (!work) { work = { queue: [], queued: new Map(), used: 0, budget: 0 }; pathWork.set(g, work); }
  work.used = 0; work.budget = Math.max(0, Math.floor(g.pathBudget ?? 4096));
  // Serve the overflow before new requests. Dead units and changed orders lose their old place in the FIFO.
  while (work.queue.length) {
    const request = work.queue[0], u = g.units.get(request.id), to = u && currentPathGoal(g, u, request.kind);
    if (work.queued.get(request.id) !== request || !to || pathGoalKey(request.kind, to) !== request.key) {
      work.queue.shift();
      if (work.queued.get(request.id) === request) work.queued.delete(request.id);
      continue;
    }
    if (work.used >= work.budget) break;
    work.queue.shift(); work.queued.delete(request.id);
    performStepPath(g, u, to, request.kind, work);
    u.repath += TICK; // the normal unit loop subtracts this tick's time below
  }
}
function requestStepPath(g, u, to, kind) {
  const work = pathWork.get(g), key = pathGoalKey(kind, to), pending = work.queued.get(u.id);
  if (pending?.key === key) return;
  if (work.used < work.budget) { performStepPath(g, u, to, kind, work); return; }
  const request = { id: u.id, kind, key };
  work.queued.set(u.id, request); work.queue.push(request); pathStatsFor(g).deferred++;
}

// ---------- commands (trust boundary: everything from clients is validated here) ----------

const num = (v, max) => (Number.isFinite(v) ? Math.min(max, Math.max(0, v)) : null);

// Shared by placement previews and commands. Sight masks blocked building reasons.
export function placementCheck(g, { kind, x, z, dir = 0 }, sees = () => true) {
  const fail = (reason, extra = {}) => ({ ok: false, reason, x: Number.isFinite(x) ? x : 0, z: Number.isFinite(z) ? z : 0, ...extra });
  if (!Number.isFinite(x) || !Number.isFinite(z)) return fail('blocked');
  if (Object.hasOwn(FORTS, kind)) {
    const f = FORTS[kind], sx = Math.cos(dir), sz = Math.sin(dir);
    const at = (along, fwd) => cellOf(g, x + (sx * along + sz * fwd) * CELL, z + (sz * along - sx * fwd) * CELL);
    const plan = f.nest ? [[0, 0], [-1, 1], [0, 1], [1, 1], [-1, 0], [1, 0]].map(([s, w]) => at(s, w))
      : Array.from({ length: f.n }, (_, i) => at(i - (f.n - 1) / 2, 0));
    if (plan.some(c => c >= 0 && !sees(cellCenter(g, c)))) return fail('notVisible', { cells: [] });
    const cells = fortCells(g, f, x, z, dir);
    if (cells.length) return { ok: true, reason: undefined, cells, x, z };
    return fail('blocked', { cells });
  }
  if (!BUILDABLE.includes(kind)) return fail('blocked');
  const def = UNITS[kind];
  let c, node;
  if (kind === 'depot') {
    node = (g.nodes ?? []).filter(n => !n.depot && dist(n, { x, z }) <= 8)
      .sort((a, b) => dist(a, { x, z }) - dist(b, { x, z }))[0];
    if (!node) {
      const hidden = (g.nodes ?? []).some(n => dist(n, { x, z }) <= 8 && !sees(footCenter(g, n.c, def.size)));
      return fail(hidden ? 'notVisible' : 'blocked');
    }
    c = node.c;
  } else {
    const cx = Math.round(x / CELL - def.size / 2), cy = Math.round(z / CELL - def.size / 2);
    if (cx < 0 || cy < 0 || cx >= g.w || cy >= g.h) return fail('blocked');
    c = cy * g.w + cx;
  }
  const cells = footprint(g, c, def.size), center = footCenter(g, c, def.size), extra = { c, node, cells, ...center };
  if (!cells) return fail('blocked', extra);
  if (!sees(center)) return fail('notVisible', extra);
  if (kind !== 'depot') {
    const taken = new Set((g.nodes ?? []).flatMap(n => footprint(g, n.c, 2) ?? []));
    if (cells.some(k => taken.has(k))) return fail('blocked', extra);
  }
  return canStamp(g, cells) ? { ok: true, reason: undefined, ...extra } : fail('blocked', extra);
}

// A digger on a mass entrenchment picks the segment nearest to it among the next ones (as many as there are
// diggers, so the middle is dug first) and pays for it on the way. Segments that can no longer be built are dropped.
function takeDigJob(g, u) {
  const jobs = u.entrench.jobs, p = g.players[u.owner];
  let k = 0;
  for (let i = 1; i < Math.min(jobs.length, u.entrench.crew); i++) if (dist(u, jobs[i]) < dist(u, jobs[k])) k = i;
  const job = jobs[k], place = placementCheck(g, job, at => teamSees(g, p.team, at));
  if (!place.ok) { jobs.splice(k, 1); return; }
  const cost = segmentCost(job.kind, place.cells.length);
  if (p.mp < cost) return;
  jobs.splice(k, 1);
  p.mp -= cost; tally(g, u.owner, 'mpSpent', cost);
  u.entrench.active++;
  u.dig = { x: job.x, z: job.z, cells: place.cells, t: 0, project: u.entrench, kind: job.kind, dir: job.dir }; u.repath = 0;
}

// Per-unit switches the player sets. holdFire: shoot only on an attack order. holdPos: never move unordered (no
// seeking cover). autoRetreat: run for home when below CFG.autoRetreat of full strength.
export const STANCES = ['holdFire', 'holdPos', 'autoRetreat'];
const stanceBits = (u) => (u.holdFire ? 2048 : 0) | (u.holdPos ? 4096 : 0) | (u.autoRetreat ? 8192 : 0);
function retreatUnit(g, u) {
  u.orders = []; u.entrench = null;
  if (u.air) { if (airborne(u)) u.air.state = 'home'; return; } // back to base
  exitBuilding(g, u);
  Object.assign(u, { retreating: true, attackId: 0, targetId: 0, nade: null, dig: null, stuck: 0, enter: -1, amove: null, fireAt: -1, build: 0 });
  u.path = findPath(g, u, homeOf(g, u));
}

// Puts diggers on a mass entrenchment (g.projects), now or as a waiting order. A project lives while it has segments
// left and someone working on it or waiting to (see the sweep in step).
function joinProject(g, project, diggers, queue) {
  const at = project.jobs[0];
  let any = false;
  for (const u of diggers) {
    if (queue) { if (enqueueOrder(u, { t: 'entrench', ids: [u.id], join: project.id, x: at.x, z: at.z })) any = true; continue; }
    any = true;
    if (u.entrench === project) continue;
    project.crew++;
    exitBuilding(g, u);
    Object.assign(u, { orders: [], entrench: project, dig: null, attackId: 0, targetId: 0, nade: null, enter: -1, amove: null, fireAt: -1, build: 0, path: [], repath: 0 });
  }
  return any ? undefined : 'queueFull';
}

// Waiting orders are separate from a Production Building's training queue.
// Returns false when the unit already has 8 waiting orders.
function enqueueOrder(u, order) {
  if ((u.orders?.length ?? 0) >= 8) return false;
  (u.orders ??= []).push(order);
  return true;
}

function startQueuedOrders(g, u) {
  while (u.orders?.length && planOf(g, u)[0] === 0) {
    const order = u.orders.shift(), remaining = u.orders;
    command(g, u.owner, order);
    u.orders = remaining;
  }
}

function queuedPlan(g, slot, order) {
  const kind = { move: 1, amove: 2, attack: 4, dig: 7, assist: 8, garrison: 9, entrench: 7, cover: 1, fireat: 5, ability: 6 }[order.t];
  const target = order.t === 'attack' && g.units.get(order.target);
  const at = target && g.players[slot].visible.has(target.id) ? target : order;
  return [kind, at.x, at.z];
}

function sendToRally(g, u) {
  const rally = g.players[u.owner].rally;
  if (g.mode?.kind === 'classic' || !rally || u.air || UNITS[u.type].structure) return;
  u.path = findPath(g, u, rally);
}

// One click can order troops and set the selected Production Buildings' rallies.
// It is refused only when every part is refused, with the first part's reason.
function dispatchOrderGroups(g, slot, cmd) {
  const allowed = ['move', 'amove', 'attack', 'garrison', 'fireat', 'escort', 'assist', 'rally', 'entrench'];
  let done = false, reason;
  for (const part of cmd.commands.slice(0, 8)) {
    if (!part || typeof part !== 'object' || !allowed.includes(part.t)) continue;
    const r = command(g, slot, { ...part, queue: cmd.queue === true });
    if (r) reason ??= r; else done = true;
  }
  return done ? undefined : reason ?? 'blocked';
}

export function command(g, slot, cmd, auto = false) {
  if (g.winner !== null || !Number.isInteger(slot) || !g.players[slot] || g.players[slot].out || g.players[slot].away || !cmd || typeof cmd !== 'object' || Array.isArray(cmd)) return 'blocked';
  if (cmd.t === 'orders' && Array.isArray(cmd.commands)) return dispatchOrderGroups(g, slot, cmd);
  const mine = (id) => { const u = g.units.get(id); return u && u.owner === slot && !UNITS[u.type].structure ? u : null; };
  const limit = Math.max(50, g.units.size), ids = Array.isArray(cmd.ids) ? cmd.ids.slice(0, limit) : [];
  if ((cmd.t === 'move' || cmd.t === 'amove') && Array.isArray(cmd.orders)) {
    let moved = false, full = false;
    for (const o of cmd.orders.slice(0, limit)) {
      const u = Array.isArray(o) && mine(o[0]), x = num(o?.[1], g.w * CELL), z = num(o?.[2], g.h * CELL);
      if (!u || x === null || z === null) continue;
      if (cmd.queue === true) { if (enqueueOrder(u, { t: cmd.t, orders: [[u.id, x, z]], x, z })) moved = true; else full = true; continue; }
      moved = true;
      u.orders = []; u.entrench = null;
      if (u.air) { sendPlane(u, { kind: 'patrol', x, z }); continue; }
      exitBuilding(g, u);
      Object.assign(u, { attackId: 0, targetId: 0, stuck: 0, retreating: false, nade: null, dig: null, enter: -1, fireAt: -1, build: 0, amove: cmd.t === 'amove' ? { x, z } : null });
      u.path = findPath(g, u, { x, z });
    }
    if (!moved) return full ? 'queueFull' : 'blocked';
  } else if (cmd.t === 'fireat') {
    const c = cellOf(g, num(cmd.x, g.w * CELL) ?? -1, num(cmd.z, g.h * CELL) ?? -1);
    if (c < 0 || !(g.cellHp[c] > 0)) return c < 0 || teamSees(g, g.players[slot].team, cellCenter(g, c)) ? 'blocked' : 'notVisible';
    if (!ids.some(id => { const u = mine(id); return u && (UNITS[u.type].w.shellTerrain || UNITS[u.type].w.salvo); })) return teamSees(g, g.players[slot].team, cellCenter(g, c)) ? 'needs' : 'notVisible';
    let ordered = false;
    for (const id of ids) {
      const u = mine(id);
      if (!u || !(UNITS[u.type].w.shellTerrain || UNITS[u.type].w.salvo)) continue;
      if (cmd.queue === true) { if (enqueueOrder(u, { t: 'fireat', ids: [u.id], ...cellCenter(g, c) })) ordered = true; }
      else { Object.assign(u, { orders: [], entrench: null, fireAt: c, attackId: 0, amove: null, retreating: false, repath: 0, path: [] }); ordered = true; }
    }
    if (!ordered) return 'queueFull';
  } else if (cmd.t === 'garrison') {
    const c0 = cellOf(g, num(cmd.x, g.w * CELL) ?? -1, num(cmd.z, g.h * CELL) ?? -1);
    if (c0 < 0 || g.chars[c0] !== 'B') return c0 < 0 || teamSees(g, g.players[slot].team, cellCenter(g, c0)) ? 'blocked' : 'notVisible';
    const taken = new Set([...g.units.values()].flatMap(u => [u.garrison, u.enter]).filter(c => c >= 0));
    let entered = false, reason = 'needs';
    for (const id of ids) {
      const u = mine(id);
      if (!u || !UNITS[u.type].garrisons || u.retreating) { reason = u?.retreating ? 'retreating' : 'needs'; continue; }
      if (cmd.queue === true) { const at = cellCenter(g, c0); if (enqueueOrder(u, { t: 'garrison', ids: [u.id], ...at })) entered = true; else reason = 'queueFull'; continue; }
      const c = entryCell(g, c0, u, taken);
      if (c < 0) { reason = 'max'; break; } // house is full
      exitBuilding(g, u);
      taken.add(c);
      Object.assign(u, { orders: [], entrench: null, enter: c, attackId: 0, nade: null, dig: null, amove: null, fireAt: -1, build: 0, repath: 0, path: findPath(g, u, cellCenter(g, c)) });
      entered = true;
    }
    if (!entered) return teamSees(g, g.players[slot].team, cellCenter(g, c0)) ? reason : 'notVisible';
  } else if (cmd.t === 'attack') {
    const t = g.units.get(cmd.target);
    if (!t || allied(g, t.owner, slot) || !g.players[slot].visible.has(t.id)) return 'unseen';
    // Ground units never target planes; only planes take an attack order on an aircraft.
    if (!ids.some(id => { const u = mine(id); return u && (u.air || !t.air); })) return 'needs';
    let ordered = false;
    for (const id of ids) {
      const u = mine(id); if (!u || (t.air && !u.air)) continue;
      if (cmd.queue === true) { if (enqueueOrder(u, { t: 'attack', ids: [u.id], target: t.id, x: t.x, z: t.z })) ordered = true; continue; }
      ordered = true;
      u.orders = []; u.entrench = null;
      if (u.air) { sendPlane(u, { kind: 'attack', id: t.id, x: t.x, z: t.z }); continue; }
      if (!canShoot(g, u, t)) exitBuilding(g, u);
      Object.assign(u, { attackId: t.id, repath: 0, retreating: false, nade: null, dig: null, enter: -1, amove: null, fireAt: -1, build: 0, path: [] });
    }
    if (!ordered) return 'queueFull';
  } else if (cmd.t === 'stop') {
    if (!ids.some(mine)) return 'needs';
    for (const id of ids) { const u = mine(id); if (u?.air) { u.orders = []; if (airborne(u)) sendPlane(u, { kind: 'patrol', x: u.x, z: u.z }); continue; } if (u) Object.assign(u, { orders: [], entrench: null, path: [], attackId: 0, retreating: false, nade: null, dig: null, enter: -1, amove: null, fireAt: -1, build: 0 }); }
  } else if (cmd.t === 'escort') {
    // planes circle a friendly unit (fighters guard it from enemy planes)
    const t = g.units.get(cmd.target);
    if (!t || !allied(g, t.owner, slot) || UNITS[t.type].structure || t.air) return 'unseen';
    if (!ids.some(id => mine(id)?.air)) return 'needs';
    for (const id of ids) { const u = mine(id); if (u?.air) { u.orders = []; sendPlane(u, { kind: 'escort', id: t.id, x: t.x, z: t.z }); } }
  } else if (cmd.t === 'retreat') {
    if (!ids.some(mine)) return 'needs';
    for (const id of ids) { const u = mine(id); if (u) retreatUnit(g, u); }
  } else if (cmd.t === 'stance') {
    // per-unit switches (STANCES), all off for a new unit
    if (!STANCES.includes(cmd.key) || typeof cmd.on !== 'boolean') return 'blocked';
    const us = ids.map(mine).filter(Boolean);
    if (!us.length) return 'needs';
    for (const u of us) u[cmd.key] = cmd.on;
  } else if (cmd.t === 'cover') {
    // Take Cover: every selected infantry squad drops what it is doing and runs to the best cover within reach,
    // judged against the nearest enemy its team can see. Squads already in a trench or a house stay put.
    const squads = ids.map(mine).filter(u => u && UNITS[u.type].infantry);
    if (!squads.length) return 'needs';
    const foes = [...g.players[slot].visible].map(id => g.units.get(id)).filter(e => e && !e.air && e.hp > 0);
    let went = false, reason = 'noCover';
    for (const u of squads) {
      if (u.retreating) { reason = 'retreating'; continue; }
      if (cmd.queue === true) {
        // shown where the squad's last waiting order ends; the cover is chosen when the order starts
        const last = u.orders.at(-1) ?? u.path.at(-1) ?? u;
        if (enqueueOrder(u, { t: 'cover', ids: [u.id], x: last.x, z: last.z })) went = true; else reason = 'queueFull';
        continue;
      }
      if (u.garrison >= 0) { Object.assign(u, { orders: [], entrench: null, path: [], attackId: 0, targetId: 0, nade: null, dig: null, enter: -1, amove: null, fireAt: -1, build: 0 }); went = true; continue; }
      let from = null, bd = 60;
      for (const e of foes) if (dist(u, e) < bd) { bd = dist(u, e); from = e; }
      from ??= u.hitAt >= g.tick - 100 ? u.hitFrom : null;
      const path = u.path;
      u.path = [];
      if (!seekCover(g, u, from) && coverRank(g, u, from) === 3) { u.path = path; continue; }
      Object.assign(u, { orders: [], entrench: null, attackId: 0, targetId: 0, stuck: 0, nade: null, dig: null, enter: -1, amove: null, fireAt: -1, build: 0 });
      went = true;
    }
    if (!went) return reason;
  } else if (cmd.t === 'ability') {
    // auto is only ever passed by step(): the autocast path, which keeps the unit's orders (a player's use clears them)
    const x = num(cmd.x, g.w * CELL), z = num(cmd.z, g.h * CELL);
    let used = false, reason = 'needs';
    for (const id of ids) {
      const u = mine(id), ab = u && UNITS[u.type].ab;
      // an aimed ability can wait its turn; it is checked (cooldown, munitions) when it starts
      if (cmd.queue === true && u && !u.retreating && x !== null && z !== null && (ab.id === 'grenade' || ab.id === 'barrage' || ab.id === 'satchel')) {
        if (enqueueOrder(u, { t: 'ability', ids: [u.id], x, z })) used = true; else reason = 'queueFull';
        continue;
      }
      if (!u || u.cd > 0 || u.retreating || !(g.players[slot].mun >= abCost(g, ab) || !abCost(g, ab))) { reason = !u ? 'needs' : u.cd > 0 ? 'cooldown' : u.retreating ? 'retreating' : 'mun'; continue; }
      if (AIMED_AB.has(ab.id)) {
        if (x === null || z === null) { reason = 'blocked'; continue; }
        if (auto) u.nade = { x, z, auto: true };
        else { exitBuilding(g, u); Object.assign(u, { orders: [], nade: { x, z }, attackId: 0, repath: 0, fireAt: -1 }); }
      }
      else if (!payAb(g, u)) { reason = 'mun'; continue; }
      else if (ab.id === 'suppress') { u.buff = ab.dur; u.cd = ab.cd; }
      else if (ab.id === 'ura') { u.sprint = ab.dur; u.supp = 0; u.cd = ab.cd; }
      else if (ab.id === 'ap') { u.ap = true; u.cd = ab.cd; }
      else if (ab.id === 'smoke') { g.smokes.push({ id: g.nextId++, x: u.x, z: u.z, r: ab.radius, t: ab.dur }); u.cd = ab.cd; }
      else continue;
      used = true;
    }
    if (!used) return reason;
  } else if (cmd.t === 'autocast') {
    // Warcraft 3 style: right-click an ability to let the unit use it by itself (autocastTarget decides when)
    if (typeof cmd.on !== 'boolean') return 'blocked';
    const list = ids.map(mine).filter(u => u && UNITS[u.type].ab.id !== 'none');
    if (!list.length) return 'needs';
    for (const u of list) u.auto = cmd.on;
  } else if (cmd.t === 'dig') {
    // one squad builds a field fortification (FORTS) across its line of approach
    const kind = cmd.kind ?? 'trench', f = typeof kind === 'string' && Object.hasOwn(FORTS, kind) ? FORTS[kind] : null;
    const u = mine(ids[0]), x = num(cmd.x, g.w * CELL), z = num(cmd.z, g.h * CELL), p = g.players[slot];
    if (!f || !u || !CFG.fortBuilders.includes(u.type) || u.retreating || x === null || z === null || (cmd.queue !== true && p.mp < f.cost)) return !f || x === null || z === null ? 'blocked' : !u || !CFG.fortBuilders.includes(u.type) ? 'noBuilders' : u.retreating ? 'retreating' : 'mp';
    const dir = angle(cmd.dir) ?? Math.atan2(z - u.z, x - u.x) + (f.along ? 0 : Math.PI / 2);
    const place = placementCheck(g, { kind, x, z, dir }, at => teamSees(g, p.team, at));
    if (!place.ok) return place.reason;
    if (cmd.queue === true) return enqueueOrder(u, { t: 'dig', ids: [u.id], kind, x, z, dir }) ? undefined : 'queueFull';
    const cells = place.cells;
    p.mp -= f.cost; tally(g, slot, 'mpSpent', f.cost);
    exitBuilding(g, u);
    Object.assign(u, { orders: [], entrench: null, dig: { x, z, cells, t: 0, reach: f.reach, kind, dir }, attackId: 0, targetId: 0, nade: null, enter: -1, amove: null, fireAt: -1, build: 0, path: [], repath: 0 });
  } else if (cmd.t === 'entrench') {
    // Mass entrenchment: all the selected diggers share one pattern. Nothing is paid here: each digger pays for a
    // segment as it takes it, so a pattern bigger than the purse gets dug as the manpower comes in.
    const p = g.players[slot], crew = ids.map(mine).filter(u => u && CFG.fortBuilders.includes(u.type)), able = crew.filter(u => !u.retreating);
    const x = num(cmd.x, g.w * CELL), z = num(cmd.z, g.h * CELL), x2 = num(cmd.x2, g.w * CELL) ?? x, z2 = num(cmd.z2, g.h * CELL) ?? z;
    // join: more diggers for a pattern already ordered, your own or an ally's (they pay for what they dig)
    let project = cmd.join === undefined ? null : g.projects?.get(cmd.join);
    if (cmd.join !== undefined && (!project || !project.jobs.length || !allied(g, project.owner, slot))) return 'blocked';
    if (!project && (typeof cmd.pattern !== 'string' || !Object.hasOwn(ENTRENCH, cmd.pattern) || x === null || z === null)) return 'blocked';
    if (!able.length) return crew.length ? 'retreating' : 'noBuilders';
    if (cmd.queue === true && able.every(u => (u.orders?.length ?? 0) >= 8)) return 'queueFull';
    // fort: a line of sandbags, wire, tank traps or mines instead of trench (the line patterns only)
    const fort = cmd.fort ?? 'trench';
    if (!project && (!lineFort(fort) || (fort !== 'trench' && !['line', 'zigzag', 'double'].includes(cmd.pattern)))) return 'blocked';
    if (project) return joinProject(g, project, able, cmd.queue === true);
    const back = { x: able.reduce((a, u) => a + u.x, 0) / able.length, z: able.reduce((a, u) => a + u.z, 0) / able.length };
    let reason = 'blocked', cheapest = Infinity;
    const jobs = entrenchPlan(cmd.pattern, { x, z }, { x: x2, z: z2 }, back, fort).filter(j => {
      const place = placementCheck(g, j, at => teamSees(g, p.team, at));
      if (place.ok) cheapest = Math.min(cheapest, segmentCost(j.kind, place.cells.length)); else if (place.reason === 'notVisible') reason = 'notVisible';
      return place.ok;
    });
    if (!jobs.length) return reason;
    if (p.mp < cheapest) return 'mp';
    project = { id: g.projectSeq = (g.projectSeq ?? 0) + 1, owner: slot, jobs, crew: 0, active: 0 };
    (g.projects ??= new Map()).set(project.id, project);
    return joinProject(g, project, able, cmd.queue === true);
  } else if (cmd.t === 'support' && typeof cmd.kind === 'string' && Object.hasOwn(SUPPORT, cmd.kind)) {
    const p = g.players[slot], sp = SUPPORT[cmd.kind], x = num(cmd.x, g.w * CELL), z = num(cmd.z, g.h * CELL), { cur, cost } = supCost(g, cmd.kind);
    if (x === null || z === null || p.sup[cmd.kind] > 0 || !(p[cur] >= cost)) return x === null || z === null ? 'blocked' : p.sup[cmd.kind] > 0 ? 'cooldown' : cur;
    if (sp.unit && (!teamSees(g, p.team, { x, z }) || popOf(g, slot) >= popCap(g))) return !teamSees(g, p.team, { x, z }) ? 'unseen' : 'pop';
    p[cur] -= cost; p.sup[cmd.kind] = sp.cd;
    tally(g, slot, 'supportCalls'); if (cur === 'mp') tally(g, slot, 'mpSpent', cost);
    const dir = angle(cmd.dir) ?? Math.atan2(z - p.spawn.z, x - p.spawn.x);
    g.strikes.push({ kind: cmd.kind, owner: slot, x, z, dir, t: sp.delay, left: sp.shells ?? sp.dur ?? 0, next: 0, live: false });
  } else if (cmd.t === 'build' && g.mode?.kind === 'classic' && !g.mode.suddenDeath && BUILDABLE.includes(cmd.kind)) {
    // Engineers put up a building: a depot on the free node nearest the click, anything else centered on the click.
    // Paid up front; the team must see the spot.
    const p = g.players[slot], def = UNITS[cmd.kind], x = num(cmd.x, g.w * CELL), z = num(cmd.z, g.h * CELL);
    const engineers = ids.map(mine).filter(u => u?.type === 'engineer' && !u.retreating);
    const crew = engineers.filter(u => cmd.queue !== true || (u.orders?.length ?? 0) < 8);
    if (!crew.length || x === null || z === null || p.mp < def.cost) return !crew.length ? (engineers.length ? 'queueFull' : ids.map(mine).some(u => u?.type === 'engineer' && u.retreating) ? 'retreating' : 'noBuilders') : x === null || z === null ? 'blocked' : 'mp';
    if (def.needs && ![...g.units.values()].some(b => b.owner === slot && b.type === def.needs && b.built >= 1)) return 'needs';
    const place = placementCheck(g, { kind: cmd.kind, x, z }, at => teamSees(g, p.team, at));
    if (!place.ok) return place.reason;
    const { c, node } = place;
    p.mp -= def.cost; tally(g, slot, 'mpSpent', def.cost);
    const site = placeBuilding(g, slot, cmd.kind, c, false);
    if (node) node.depot = site.id;
    for (const u of crew) {
      if (cmd.queue === true) { enqueueOrder(u, { t: 'assist', ids: [u.id], id: site.id, x: site.x, z: site.z }); continue; }
      exitBuilding(g, u); Object.assign(u, { orders: [], entrench: null, build: site.id, attackId: 0, nade: null, dig: null, enter: -1, amove: null, fireAt: -1, repath: 0, path: findPath(g, u, site) });
    }
  } else if (cmd.t === 'assist') {
    // Engineers join a site, or repair a damaged building of their own team
    const b = g.units.get(cmd.id);
    if (!b || !UNITS[b.type].building || !allied(g, b.owner, slot) || (b.built >= 1 && b.hp >= UNITS[b.type].hpPer)) return 'unseen';
    const crew = ids.map(mine).filter(u => u?.type === 'engineer' && !u.retreating);
    if (!crew.length) return ids.some(id => mine(id)?.type === 'engineer' && mine(id).retreating) ? 'retreating' : 'noBuilders';
    let assigned = false;
    for (const u of crew) {
      if (cmd.queue === true) { if (enqueueOrder(u, { t: 'assist', ids: [u.id], id: b.id, x: b.x, z: b.z })) assigned = true; continue; }
      assigned = true;
      exitBuilding(g, u); Object.assign(u, { orders: [], entrench: null, build: b.id, attackId: 0, nade: null, dig: null, enter: -1, amove: null, fireAt: -1, repath: 0, path: findPath(g, u, b) });
    }
    if (!assigned) return 'queueFull';
  } else if (cmd.t === 'cancel') {
    // tear down your own unfinished site for 75% back
    const b = g.units.get(cmd.id);
    if (!b || b.owner !== slot || !UNITS[b.type].building || b.built >= 1) return 'unseen';
    g.players[slot].mp += UNITS[b.type].cost * 0.75; tally(g, slot, 'mpSpent', -UNITS[b.type].cost * 0.75);
    g.units.delete(b.id);
    for (const c of b.cells) setCell(g, c, '.');
    for (const n of g.nodes ?? []) if (n.depot === b.id) n.depot = 0;
  } else if (cmd.t === 'rally') {
    if (g.mode?.kind === 'classic') {
      const x = num(cmd.x, g.w * CELL), z = num(cmd.z, g.h * CELL), list = cmd.id === undefined ? ids : [cmd.id];
      if (x === null || z === null) return 'blocked';
      let set = false;
      for (const id of list) {
        const b = g.units.get(id);
        if (b && b.owner === slot && UNITS[b.type].makes) { b.rally = { x, z }; set = true; }
      }
      if (!set) return list.some(id => g.units.get(id)?.owner === slot) ? 'needs' : 'unseen';
    } else if (cmd.id === undefined && !ids.length) {
      const { x, z } = cmd, c = cellOf(g, x, z);
      if (Number.isFinite(x) && Number.isFinite(z) && x >= 0 && z >= 0 && x < g.w * CELL && z < g.h * CELL && c >= 0 && !(g.flags[c] & MOVE)) g.players[slot].rally = { x, z };
      else return 'blocked';
    }
  } else if (cmd.t === 'buy' && typeof cmd.unit === 'string' && Object.hasOwn(UNITS, cmd.unit) && canBuild(cmd.unit, g.players[slot].faction)) {
    const p = g.players[slot], def = UNITS[cmd.unit], classic = g.mode?.kind === 'classic';
    if (def.classic && !classic) return 'needs'; // Engineers exist only in Classic
    const own = [...g.units.values()].filter(u => u.owner === slot);
    // Classic: training queues count toward the pop cap and the unit limit
    const queued = own.flatMap(b => b.queue ?? []);
    const pop = popOf(g, slot);
    const have = own.filter(u => u.type === cmd.unit).length + queued.filter(t => t === cmd.unit).length;
    const price = priceOf(g, cmd.unit);
    if (p.mp < price.mp || (price.fuel && !(p.fuel >= price.fuel)) || pop >= popCap(g) || have >= (def.max ?? Infinity)) return p.mp < price.mp ? 'mp' : price.fuel && !(p.fuel >= price.fuel) ? 'fuel' : pop >= popCap(g) ? 'pop' : 'max';
    if (!classic) { p.mp -= price.mp; tally(g, slot, 'mpSpent', price.mp); sendToRally(g, spawnUnit(g, slot, cmd.unit)); return; }
    // queue it at the building asked for, else the one with the shortest queue
    if (g.mode.suddenDeath) return 'suddenDeath';
    const makers = own.filter(b => b.built >= 1 && UNITS[b.type].makes?.includes(cmd.unit) && b.queue.length < 5);
    const b = Object.hasOwn(cmd, 'from') ? makers.find(m => m.id === cmd.from) : makers.sort((a, c) => a.queue.length - c.queue.length)[0];
    if (!b) return own.some(m => m.built >= 1 && UNITS[m.type].makes?.includes(cmd.unit)) ? 'queueFull' : 'needs';
    p.mp -= price.mp; p.fuel -= price.fuel; b.queue.push(cmd.unit); tally(g, slot, 'mpSpent', price.mp);
  } else return cmd.t === 'build' && g.mode?.suddenDeath ? 'suddenDeath' : 'blocked';
}

// ---------- simulation ----------

const suppMul = (u) => (u.supp >= 90 ? { speed: 0.3, rate: 3, acc: 0.5 } : u.supp >= 50 ? { speed: 0.6, rate: 1.5, acc: 0.7 } : { speed: 1, rate: 1, acc: 1 });

function canShoot(g, u, t) {
  const w = UNITS[u.type].w;
  if (!t || t.hp <= 0 || t.air || allied(g, t.owner, u.owner) || dist(u, t) > w.range || !g.players[u.owner].visible.has(t.id)) return false;
  if (u.air) return true;
  return w.salvo ? dist(u, t) >= w.minRange : los(g, u, aimPoint(g, u, t)); // salvos arc over: spotting is enough
}
// a building is aimed at by its nearest footprint cell (its own walls would block a line to the middle)
function aimPoint(g, u, t) {
  if (!t.cells) return t;
  let best = t, bd = Infinity;
  for (const c of t.cells) { const p = cellCenter(g, c), d = dist(u, p); if (d < bd) { bd = d; best = p; } }
  return best;
}

// Spread fire: g.claims holds, per team and target, the damage its shooters expect to land with their next volley.
// A target that is already getting more than it has left looks further away to the next shooter, in proportion, so
// a group does not empty every gun into a squad that is as good as dead.
const volley = (u, t) => { const w = UNITS[u.type].w; return !w || w.salvo ? 0 : (UNITS[t.type].infantry ? w.inf * w.accInf : w.veh * w.accVeh) * (w.perModel ? alive(u) : 1); };
function claim(g, u, id, sign) {
  const t = id && g.units.get(id);
  if (!t || !g.claims) return;
  const key = id * 8 + g.players[u.owner].team;
  g.claims.set(key, (g.claims.get(key) ?? 0) + sign * volley(u, t));
}
function retarget(g, u) {
  const next = pickTarget(g, u);
  if (next !== u.targetId) { claim(g, u, u.targetId, -1); claim(g, u, next, 1); }
  u.targetId = next;
}

// Autocast: is now a good moment for this unit's ability, and where? null = not now, {} = use it (no spot needed),
// {x, z} = use it there. Same judgment as the AI's, from what the unit's side can see; aimed ones never land on friends.
const AUTO_EVERY = 10; // ticks between checks (0.5 s), staggered by unit id
const SATCHEL_REACH = 20; // a Ranger ordered to attack a house or bunker this close walks up and plants its charge
export function autocastTarget(g, u) {
  const def = UNITS[u.type], ab = def.ab, w = def.w, grid = gridFor(g), seen = g.players[u.owner].visible;
  const foes = (at, r) => grid.radius(at, r, e => e.hp > 0 && !e.air && !allied(g, e.owner, u.owner) && seen.has(e.id));
  const clear = (at, r) => !grid.radius(at, r, o => o.hp > 0 && !o.air && allied(g, o.owner, u.owner)).length;
  const spot = (e) => ({ x: e.x, z: e.z });
  // holding fire: nothing thrown or fired on its own (smoke, AP loading and Ura! are not attacks; a satchel needs an attack order)
  if (u.holdFire && (ab.id === 'grenade' || ab.id === 'suppress' || ab.id === 'barrage')) return null;
  if (ab.id === 'grenade') {
    // infantry in cover, in a trench or in a house, within throwing range (from inside a house the squad would have to step out)
    if (u.garrison >= 0) return null;
    const e = foes(u, ab.range).filter(e => UNITS[e.type].infantry && (e.garrison >= 0 || inCover(g, e) || inTrench(g, e)) && clear(e, ab.radius + 1))
      .sort((a, b) => dist(u, a) - dist(u, b))[0];
    return e ? spot(e) : null;
  }
  if (ab.id === 'suppress') {
    // a squad coming at the MG while it is set up to fire: on the move, heading its way, in range and in sight
    return !u.path.length && foes(u, w.range).some(e => UNITS[e.type].infantry && e.path.length && !e.retreating
      && Math.cos(e.rot - Math.atan2(u.z - e.z, u.x - e.x)) > 0.5 && canShoot(g, u, e)) ? {} : null;
  }
  if (ab.id === 'ap') {
    // loaded for the vehicle it is shooting at
    const t = g.units.get(u.targetId);
    return !u.ap && t && !UNITS[t.type].infantry && !UNITS[t.type].structure && canShoot(g, u, t) ? {} : null;
  }
  if (ab.id === 'smoke') return u.hp < def.models * def.hpPer * 0.5 && g.tick - (u.atHit ?? -1e9) <= 3 / TICK ? {} : null; // hurt and still taking anti-tank hits
  if (ab.id === 'ura') return u.supp >= 50 && u.path.length ? {} : null; // pinned down on the move: get up and run
  if (ab.id === 'barrage') {
    // a crowd (3 or more in one blast area) or anyone dug in: a house, a trench, a bunker
    const r = w.spread + w.blast;
    let best = null, most = 0;
    for (const e of foes(u, ab.range)) {
      if (dist(u, e) < w.minRange || UNITS[e.type].building) continue;
      const crowd = foes(e, r).length, dug = e.garrison >= 0 || inTrench(g, e) || UNITS[e.type].structure;
      if ((dug || crowd >= 3) && crowd + (dug ? 2 : 0) > most && clear(e, r + 1)) { best = e; most = crowd + (dug ? 2 : 0); }
    }
    return best && spot(best);
  }
  if (ab.id === 'satchel') {
    // the house (an enemy squad holding it) or bunker it was ordered to attack: walk up and plant it
    const t = g.units.get(u.attackId), at = t && aimPoint(g, u, t);
    return u.garrison < 0 && t && seen.has(t.id) && (t.garrison >= 0 || UNITS[t.type].structure) && dist(u, at) <= SATCHEL_REACH && clear(at, ab.radius) ? spot(at) : null;
  }
  return null;
}

function pickTarget(g, u) {
  const w = UNITS[u.type].w, team = g.players[u.owner].team;
  let best = 0, bestScore = Infinity;
  for (const t of gridFor(g).candidates(u, w.range, true, t => t.hp > 0 && !t.air && !allied(g, t.owner, u.owner) && g.players[u.owner].visible.has(t.id))) {
    if (!canShoot(g, u, t)) continue;
    const inf = UNITS[t.type].infantry;
    // salvos go for garrisons first, then for whatever has the most enemies around it
    const value = w.salvo ? (t.garrison >= 0 ? 3 : 1) * (1 + gridFor(g).candidates(t, 6).filter(o => o.owner === t.owner && dist(o, t) < 6).length) : inf ? w.inf * w.accInf : w.veh * w.accVeh;
    const others = w.salvo ? 0 : (g.claims?.get(t.id * 8 + team) ?? 0) - (t.id === u.targetId ? volley(u, t) : 0);
    const score = dist(u, t) / value * (UNITS[t.type].structure ? 5 : 1) * Math.max(1, others / t.hp); // soldiers first, concrete later
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
  const cover = Math.min(coverMul(g, t), inf ? 1 - (1 - CFG.coverMul) * coverBehind(g, t, u) : 1);
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
  else if (def.structure) dmg *= CFG.assault.directMul * bunkerMul(g, t); // bullets and shells barely scratch concrete
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
  if (hits) t.lastHit = u.owner;
  // shot at, hit or not: idle squads look for cover, idle vehicles turn to face a gun (not a plane overhead)
  if (inf || (w.veh >= 20 && !u.air)) { t.hitAt = g.tick; t.hitFrom = { x: u.x, z: u.z }; }
  if (hits && !inf && !def.structure && w.veh >= 20) t.atHit = g.tick; // anti-tank fire (autocast smoke reacts to it)
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

// a vehicle that drove over dry ground in the last second trails dust
const dusty = (g, u) => g.tick - (u.dust ?? -1e9) < 20;
function updateVision(g) {
  g.visionTick = g.tick; // the fog masks (teamFog) follow this pass
  // shared vision: the whole team sees what any member sees (computed once per team)
  const byTeam = new Map(), ownByTeam = new Map(), list = [...g.units.values()];
  for (const u of list) {
    const team = g.players[u.owner].team;
    if (!ownByTeam.has(team)) ownByTeam.set(team, []);
    ownByTeam.get(team).push(u);
  }
  for (const p of g.players) {
    if (byTeam.has(p.team)) { p.visible = byTeam.get(p.team); continue; }
    const vis = new Set(), own = ownByTeam.get(p.team) ?? [];
    // Planes on the ground see nothing; airborne planes see across terrain.
    const sources = own.filter(u => !u.air || airborne(u)).map(u => {
      const def = UNITS[u.type];
      return { u, def, base: visionOf(g, u), range: visionRange(g, u, def) };
    });
    const watchers = new Map();
    // Gather observers once, in their original order. Each target's check then visits
    // only the sources near it, without querying once per team and target.
    for (const source of sources) {
      const { u, def, range } = source, reach = Math.max(6, CFG.camoRange, def.vision, range) * CFG.dustSeen;
      for (const t of gridFor(g).candidates(u, Math.max(reach, CFG.air.seeRange), false)) {
        if (g.players[t.owner].team === p.team) continue;
        const bound = t.air ? CFG.air.seeRange : reach;
        if (Math.abs(t.x - u.x) > bound || Math.abs(t.z - u.z) > bound) continue;
        let observers = watchers.get(t.id);
        if (!observers) watchers.set(t.id, observers = []);
        observers.push(source);
      }
    }
    const nearby = (at) => watchers.get(at.id) ?? [];
    const recon = g.strikes.filter(s => s.live && s.kind === 'recon' && g.players[s.owner].team === p.team);
    for (const t of list) {
      if (g.players[t.owner].team === p.team) continue;
      if (UNITS[t.type].structure && !UNITS[t.type].building) { vis.add(t.id); continue; }
      if (t.air) { if (airborne(t) && nearby(t).some(s => dist(s.u, t) <= CFG.air.seeRange)) vis.add(t.id); continue; }
      // camouflage: after 3s still and 4s without firing, only seen within camoRange (recon flights still spot it)
      const hidden = UNITS[t.type].camo && t.still >= 3 && g.tick - (t.shotAt ?? -1e9) >= 80;
      let seen = false;
      for (const { u, def, base, range } of nearby(t)) {
        const d = dist(u, t);
        if (u.air ? d <= def.vision && (!hidden || d < CFG.camoRange * 2)
          : hidden ? d < CFG.camoRange
            : d < 6 || (def.building && d <= base) || (d <= range * (dusty(g, t) ? CFG.dustSeen : 1) && los(g, u, t.cells ? aimPoint(g, u, t) : t))) { seen = true; break; }
      }
      if (seen || recon.some(s => inStrip(s, t, SUPPORT.recon.len, SUPPORT.recon.width))) vis.add(t.id);
    }
    // Horde: the last few of a wave show through the fog, so nobody hunts a straggler blind
    if (g.mode?.kind === 'horde' && p.team === g.mode.defenderTeam && g.mode.active && !g.mode.budget && g.mode.left <= CFG.horde.reveal) for (const t of list) if (t.owner === g.mode.slot && !t.air) vis.add(t.id);
    byTeam.set(p.team, p.visible = vis);
    // Ghosts: every enemy building this team has seen stays remembered where it was, until the team sees the spot
    // again without it (destroyed or cancelled)
    if (g.mode?.kind !== 'classic') continue;
    const mem = (g.ghosts ??= new Map()).get(p.team) ?? new Map();
    g.ghosts.set(p.team, mem);
    for (const id of vis) { const t = g.units.get(id); if (UNITS[t.type].building) mem.set(id, { id, type: t.type, owner: t.owner, x: t.x, z: t.z, built: t.built }); }
    for (const [id, gh] of mem) if (!vis.has(id) && !g.units.has(id) && own.some(u => (!u.air || airborne(u)) && dist(u, gh) <= visionOf(g, u) && (u.air || UNITS[u.type].building || los(g, u, gh) || dist(u, gh) < 8))) mem.delete(id);
  }
}
// the enemy buildings a player knows about: seen now, or remembered (Ghosts)
export const knownBuildings = (g, slot) => [...(g.ghosts?.get(g.players[slot].team)?.values() ?? [])];

// ---------- fog of war: the ground a team sees ----------
// updateVision's rule applied to every cell centre: anything within 6 m, a building's or an airborne plane's whole
// vision circle, a live recon corridor, otherwise the high-ground and garrison range with line of sight. The cells
// under the enemy ground units the team sees count too, so nothing a snapshot shows stands on fogged ground (planes
// fly over it: an enemy plane is seen up to CFG.air.seeRange away). The shortcuts below skip only work that cannot
// change the answer.
const FOG_BLOCK = 3; // 8 x 8 cell blocks for the highest-ground lookup and the change stamps
function fogTerrain(g) {
  const version = g.terrainVersion ?? 0, old = g.fogTerrain;
  if (old?.version === version) return old;
  const w = g.w, h = g.h, W = w + 1, n = w * h, sat = new Int32Array(W * (h + 1)), sight = new Uint8Array(n);
  // sight blockers summed over every box from the corner: any box's count in four reads
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) { const c = y * w + x; row += sight[c] = g.flags[c] & SIGHT ? 1 : 0; sat[(y + 1) * W + x + 1] = sat[y * W + x + 1] + row; }
  }
  const bw = (w >> FOG_BLOCK) + 1, blocks = bw * ((h >> FOG_BLOCK) + 1), top = new Int8Array(blocks).fill(CFG.minLevel);
  const height = g.height?.slice() ?? null, stamp = old?.stamp ?? new Uint32Array(blocks);
  for (let c = 0; c < n; c++) {
    const b = (Math.floor(c / w) >> FOG_BLOCK) * bw + ((c % w) >> FOG_BLOCK), level = height ? height[c] : 0;
    if (level > top[b]) top[b] = level;
    // the blocks where sight changed: sources looking over them work their cells out again
    if (old && (sight[c] !== old.sight[c] || level !== (old.height ? old.height[c] : 0))) stamp[b] = version;
  }
  return (g.fogTerrain = { version, sat, W, top, bw, sight, height, stamp });
}
const blockMax = (f, list, x0, y0, x1, y1) => {
  let top = -Infinity;
  for (let by = y0 >> FOG_BLOCK; by <= y1 >> FOG_BLOCK; by++) for (let bx = x0 >> FOG_BLOCK; bx <= x1 >> FOG_BLOCK; bx++) top = Math.max(top, list[by * f.bw + bx]);
  return top;
};
// sight blockers in the box between two cells, from the summed table
const sightIn = (f, ax, ay, bx, by) => {
  const S = f.sat, W = f.W, x0 = ax < bx ? ax : bx, x1 = ax < bx ? bx : ax, y0 = ay < by ? ay : by, y1 = ay < by ? by : ay;
  return S[(y1 + 1) * W + x1 + 1] - S[y0 * W + x1 + 1] - S[(y1 + 1) * W + x0] + S[y0 * W + x0];
};
// los(g, source, cell centre) with numbers only, and the smokes already narrowed down to the source's reach
function fogLos(g, f, sx, sz, ux, uy, x, y, la, srcTop, smokes) {
  const px = (x + 0.5) * CELL, pz = (y + 0.5) * CELL, w = g.w, start = f.sight[uy * w + ux], end = f.sight[y * w + x];
  // The grid walk only visits cells inside the box between its ends, and skips its first and last cell. A long
  // diagonal's box is wide, so the two halves' boxes get a second look (unless the midpoint sits on a cell edge).
  if (sightIn(f, ux, uy, x, y) - start - end > 0) {
    const mx = (sx + px) / 2, mz = (sz + pz) / 2, mcx = Math.floor(mx / CELL), mcy = Math.floor(mz / CELL);
    if (mx % CELL === 0 || mz % CELL === 0 || sightIn(f, ux, uy, mcx, mcy) - start > 0 || sightIn(f, mcx, mcy, x, y) - end > 0) {
      // clear(g, sx, sz, px, pz, SIGHT, false), unrolled
      const flags = g.flags, h = g.h, dx = px - sx, dz = pz - sz, stepX = Math.sign(dx), stepY = Math.sign(dz);
      const tdx = dx ? CELL / Math.abs(dx) : Infinity, tdy = dz ? CELL / Math.abs(dz) : Infinity;
      let cx = ux, cy = uy;
      let tx = dx ? (stepX > 0 ? (cx + 1) * CELL - sx : sx - cx * CELL) / Math.abs(dx) : Infinity;
      let ty = dz ? (stepY > 0 ? (cy + 1) * CELL - sz : sz - cy * CELL) / Math.abs(dz) : Infinity;
      for (let k = w + h; k > 0 && !(cx === x && cy === y); k--) {
        if (tx < ty) { tx += tdx; cx += stepX; } else { ty += tdy; cy += stepY; }
        if (cx === x && cy === y) break;
        if (cx < 0 || cy < 0 || cx >= w || cy >= h || flags[cy * w + cx] & SIGHT) return false;
      }
    }
  }
  const x0 = ux < x ? ux : x, x1 = ux < x ? x : ux, y0 = uy < y ? uy : y, y1 = uy < y ? y : uy;
  if (smokes.length) {
    // segHits, unrolled
    const dx = px - sx, dz = pz - sz, l2 = dx * dx + dz * dz || 1;
    for (const s of smokes) {
      const t = Math.max(0, Math.min(1, ((s.x - sx) * dx + (s.z - sz) * dz) / l2));
      if (Math.hypot(sx + dx * t - s.x, sz + dz * t - s.z) < s.r) return false;
    }
  }
  const height = g.height;
  if (!height) return true;
  // no ground in the box above the lower eye's own level: the hills can't block
  const lb = height[y * w + x], low = la < lb ? la : lb;
  if (srcTop <= low || blockMax(f, f.top, x0, y0, x1, y1) <= low) return true;
  // hillsClear's samples, read straight from the height grid (both ends are on the map, so every sample is)
  const L = CFG.levelHeight, ya = la * L + CFG.eye, yb = lb * L + CFG.eye, dx = px - sx, dz = pz - sz;
  const n = Math.ceil(Math.hypot(dx, dz) / (CELL / 2));
  for (let i = 1; i < n; i++) {
    const t = i / n;
    if (height[Math.floor((sz + dz * t) / CELL) * w + Math.floor((sx + dx * t) / CELL)] * L > ya + (yb - ya) * t) return false;
  }
  return true;
}
// Math.hypot(dx, dz) <= r (or < r when strict), from the squared distance except within a hair of the edge
const within = (q, dx, dz, r, strict) => {
  const r2 = r * r;
  if (q < r2 * (1 - 1e-9)) return true;
  if (q > r2 * (1 + 1e-9)) return false;
  const d = Math.hypot(dx, dz);
  return strict ? d < r : d <= r;
};
// A ground unit's sight: the match weather (visionOf), high ground and an upper floor see farther, rain sees less.
// updateVision and the fog masks both read it, so the drawn fog can't drift from what the team sees.
const visionRange = (g, u, def) => visionOf(g, u) * (1 + CFG.highGroundVision * levelAt(g, u.x, u.z)) * (u.garrison >= 0 ? CFG.garrisonVision : 1) * (1 - CFG.weather.sight * (g.wx?.rain ?? 0));
const fogReach = (g, u, def) => (u.air ? def.vision : Math.max(6, visionRange(g, u, def), def.building ? def.vision : 0));
const NO_SMOKE = [];
const smokesNear = (g, u, reach) => (g.smokes.length ? g.smokes.filter(s => Math.hypot(s.x - u.x, s.z - u.z) < reach + s.r) : NO_SMOKE);
// Marks what one source sees. With `list`, every cell of its circle is worked out and the seen ones are pushed there
// (kept while the source stands still); without, cells the team already sees are skipped.
function fogSource(g, f, vis, u, list) {
  const def = UNITS[u.type], w = g.w, h = g.h, air = !!u.air, building = !!def.building, vision = visionOf(g, u), sx = u.x, sz = u.z;
  const range = visionRange(g, u, def), R = fogReach(g, u, def);
  const x0 = Math.max(0, Math.floor((sx - R) / CELL)), x1 = Math.min(w - 1, Math.floor((sx + R) / CELL));
  const y0 = Math.max(0, Math.floor((sz - R) / CELL)), y1 = Math.min(h - 1, Math.floor((sz + R) / CELL));
  const ux = Math.floor(sx / CELL), uy = Math.floor(sz / CELL), inside = ux >= 0 && uy >= 0 && ux < w && uy < h;
  const la = levelAt(g, sx, sz), srcTop = g.height && x0 <= x1 && y0 <= y1 ? blockMax(f, f.top, x0, y0, x1, y1) : CFG.minLevel;
  const smokes = smokesNear(g, u, R);
  for (let y = y0; y <= y1; y++) {
    // only the stretch of the row that can be within R (one spare cell each side)
    const pz = (y + 0.5) * CELL, dz = sz - pz, span = Math.sqrt(Math.max(0, R * R - dz * dz));
    const xa = Math.max(x0, Math.floor((sx - span) / CELL) - 1), xb = Math.min(x1, Math.floor((sx + span) / CELL) + 1);
    for (let x = xa; x <= xb; x++) {
      const c = y * w + x;
      if (vis[c] && !list) continue;
      const px = (x + 0.5) * CELL, dx = sx - px, q = dx * dx + dz * dz;
      if (air ? within(q, dx, dz, vision) : within(q, dx, dz, 6, true) || (building && within(q, dx, dz, vision))
        || (within(q, dx, dz, range) && (inside ? fogLos(g, f, sx, sz, ux, uy, x, y, la, srcTop, smokes) : los(g, u, { x: px, z: pz })))) {
        vis[c] = 1;
        list?.push(c);
      }
    }
  }
  return { box: [x0, y0, Math.max(x0, x1), Math.max(y0, y1)], smokes, reach: R, range };
}
const sameList = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
// one cell per byte into vis (all zeros coming in), 1 = this team sees it right now
function teamCells(g, team, vis) {
  const w = g.w, h = g.h, f = fogTerrain(g), kept = g.fogSources ??= new Map(), moving = [];
  for (const id of kept.keys()) if (!g.units.has(id)) kept.delete(id);
  // A ground source standing still since the last pass keeps its seen cells until sight changes in its box (a
  // terrain edit or a smoke cloud coming or going) or its range does (rain). Moving ones skip the cells the team
  // already sees.
  for (const u of g.units.values()) {
    if (g.players[u.owner].team !== team || (u.air && !airborne(u))) continue;
    if (u.air) { moving.push(u); continue; }
    const e = kept.get(u.id);
    if (!e || e.x !== u.x || e.z !== u.z || e.garrison !== u.garrison) { kept.set(u.id, { x: u.x, z: u.z, garrison: u.garrison, cells: null }); moving.push(u); continue; }
    if (e.cells && e.range === visionRange(g, u, UNITS[u.type]) && blockMax(f, f.stamp, e.box[0], e.box[1], e.box[2], e.box[3]) <= e.version && sameList(e.smokes, smokesNear(g, u, e.reach))) {
      for (const c of e.cells) vis[c] = 1;
      continue;
    }
    const cells = [], { box, smokes, reach, range } = fogSource(g, f, vis, u, cells);
    Object.assign(e, { cells: Int32Array.from(cells), version: f.version, box, smokes, reach, range });
  }
  for (const u of moving) fogSource(g, f, vis, u, null);
  const { len, width } = SUPPORT.recon, reach = Math.hypot(len, width) / 2;
  for (const s of g.strikes) {
    if (!s.live || s.kind !== 'recon' || g.players[s.owner].team !== team) continue;
    for (let y = Math.max(0, Math.floor((s.z - reach) / CELL)); y <= Math.min(h - 1, Math.floor((s.z + reach) / CELL)); y++)
      for (let x = Math.max(0, Math.floor((s.x - reach) / CELL)); x <= Math.min(w - 1, Math.floor((s.x + reach) / CELL)); x++)
        if (!vis[y * w + x] && inStrip(s, { x: (x + 0.5) * CELL, z: (y + 0.5) * CELL }, len, width)) vis[y * w + x] = 1;
  }
  const seen = g.players.find(p => p.team === team)?.visible ?? [];
  for (const id of seen) {
    const t = g.units.get(id);
    if (!t || t.air) continue;
    if (t.cells) for (const c of t.cells) vis[c] = 1;
    else { const c = cellOf(g, t.x, t.z); if (c >= 0) vis[c] = 1; }
  }
  return vis;
}
// A team's fog: `vis` (seen now) and `explored` (ever seen), one byte per cell. Worked out once per vision pass, the
// first time a snapshot asks; `version` goes up only when `vis` changes. `deltas` maps an older version to the packed
// change from it to now (fogFor), starting with the step from the version before.
export function teamFog(g, team) {
  const all = g.fog ??= new Map(), key = g.visionTick ?? -1, n = g.w * g.h;
  let f = all.get(team);
  if (!f) all.set(team, f = { key: null, version: 0, vis: new Uint8Array(n), next: new Uint8Array(n), explored: new Uint8Array(n), deltas: new Map() });
  if (f.key === key) return f;
  const vis = teamCells(g, team, f.next.fill(0)), old = f.vis, explored = f.explored, codes = [];
  f.key = key;
  // one sweep: the cells that flipped since the last version (packed as packRuns does) and the explored ones
  let last = 0, on = false;
  for (let c = 0; c < n; c++) {
    const v = vis[c];
    if ((v !== old[c]) !== on) { putRun(codes, c - last); last = c; on = !on; }
    explored[c] |= v;
  }
  if (on) putRun(codes, n - last);
  if (codes.length) {
    // the two buffers swap, so a pass allocates nothing
    f.next = old; f.vis = vis; f.deltas.clear();
    f.deltas.set(f.version++, runString(codes));
  }
  return f;
}
// Run lengths of the cells where a differs from b (or from all zeros): same, different, same, ... with the trailing
// "same" left off. Each length is a little-endian base-32 varint in URL-safe base64 digits (32 and up: more follows).
const RUN_DIGITS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const RUN_VALUE = new Int8Array(128).fill(-1);
for (let i = 0; i < 64; i++) RUN_VALUE[RUN_DIGITS.charCodeAt(i)] = i;
function putRun(codes, v) {
  while (v >= 32) { codes.push(RUN_DIGITS.charCodeAt(32 | (v & 31))); v = Math.floor(v / 32); }
  codes.push(RUN_DIGITS.charCodeAt(v));
}
function runString(codes) {
  let out = '';
  for (let i = 0; i < codes.length; i += 8192) out += String.fromCharCode(...codes.slice(i, i + 8192));
  return out;
}
export function packRuns(a, b) {
  const n = a.length, codes = [];
  let last = 0, on = false;
  if (b) { for (let i = 0; i < n; i++) if ((a[i] !== b[i]) !== on) { putRun(codes, i - last); last = i; on = !on; } }
  else for (let i = 0; i < n; i++) if ((a[i] !== 0) !== on) { putRun(codes, i - last); last = i; on = !on; }
  if (on) putRun(codes, n - last);
  return runString(codes);
}
// calls run(start, count) for each run of differing cells in a packRuns string
export function unpackRuns(str, run) {
  let i = 0, c = 0, on = false;
  while (i < str.length) {
    let v = 0, scale = 1, d;
    do { d = RUN_VALUE[str.charCodeAt(i++)]; if (d < 0) throw new Error('bad fog run'); v += (d & 31) * scale; scale *= 32; } while (d & 32 && i < str.length);
    if (on && v) run(c, v);
    c += v; on = !on;
  }
}
// What one player is sent of its team's fog. full (match start and reconnect): { v: seen now, e: ever seen }, both
// packed against all zeros. Otherwise only when the team's view changed: the cells that flipped since this player's
// last fog, as one packRuns string. Teammates on the same base share one packing.
export function fogFor(g, slot, full = false) {
  const p = g.players[slot], f = teamFog(g, p.team), mine = p.fog ??= { version: 0, base: new Uint8Array(f.vis.length) };
  if (full) {
    mine.version = f.version; mine.base.set(f.vis);
    return { v: packRuns(f.vis), e: packRuns(f.explored) };
  }
  if (mine.version === f.version) return undefined;
  let delta = f.deltas.get(mine.version);
  if (delta === undefined) f.deltas.set(mine.version, delta = packRuns(f.vis, mine.base));
  mine.version = f.version; mine.base.set(f.vis);
  return delta;
}

// A support plane arriving over enemy fighter cover or flak can be shot down: fighter cover always gets it (and is used
// up; it never touches recon), each flak gun in range rolls its chance. Whatever the plane hasn't delivered is lost:
// a bombing run drops part of its stick first, a recon flight ends early.
function intercepted(g, s, list) {
  const team = g.players[s.owner].team, sp = SUPPORT[s.kind];
  const cover = s.kind !== 'recon' && g.covers?.find(c => c.t > 0 && c.team !== team && dist(c, s) <= c.r);
  let down = !!cover, by = cover ? cover.owner : -1;
  if (cover) cover.t = 0;
  for (const u of list) {
    const aa = UNITS[u.type].aa;
    if (down || !aa?.chance || u.holdFire || u.hp <= 0 || g.players[u.owner].team === team || dist(u, s) > aa.range || (aa.setup && u.still < 2) || (u.built !== undefined && u.built < 1)) continue;
    g.shots.push({ f: u.id, fo: u.owner, x: s.x, z: s.z, k: 'flak', pub: true });
    if (Math.random() < aa.chance) { down = true; by = u.owner; }
  }
  if (!down) return false;
  tally(g, by, 'planesDowned');
  g.shots.push({ k: 'shotdown', x: s.x, z: s.z, dir: s.dir, kind: s.kind, by: cover ? 'fighters' : 'flak', pub: true });
  s.left = s.kind === 'bombing' ? Math.floor(Math.random() * sp.shells) : s.kind === 'recon' ? Math.random() * s.left : 0;
  return true;
}

function hurt(g, t, src, fall, owner) {
  if (owner >= 0) t.lastHit = owner;
  const inf = UNITS[t.type].infantry;
  // concrete takes an explosive's demolition value (the same number that wrecks houses)
  const base = UNITS[t.type].structure ? src.terrain ?? src.veh : inf ? src.inf : src.veh;
  // the bunker is built to take a bombardment: off-map strikes barely touch it, it has to be taken on the ground
  const shrug = (t.type === 'bunker' && SUPPORT_SRC.has(src) ? CFG.assault.supportMul : 1) * bunkerMul(g, t);
  t.hp -= base * shrug * fall * (t.retreating ? CFG.retreatDamage : 1) * (t.garrison >= 0 ? src.antiGarrison ?? CFG.trenchBlastMul : inTrench(g, t) ? CFG.trenchBlastMul : 1) * (1 - CFG.vetArmor * vet(t));
  if (inf) t.supp = Math.min(100, t.supp + src.supp * (1 - CFG.vetSupp * vet(t)));
  g.shots.push({ t: t.id, fo: owner, to: t.owner, x: t.x, z: t.z, k: 'hurt', kill: t.hp <= 0 });
}
function blast(g, list, at, radius, src, owner) {
  for (const t of list) {
    const d = dist(t, at);
    if (d <= radius && t.hp > 0 && !t.air) hurt(g, t, src, 1 - d / radius * 0.5, owner);
  }
  if (src.terrain) damageCells(g, list, at, radius, src.terrain);
}
// explosions chew through structures; a wrecked cell changes type (house -> rubble, bridge -> river)
function damageCells(g, list, at, radius, dmg) {
  const r = Math.ceil(radius / CELL);
  for (let y = Math.floor(at.z / CELL) - r; y <= Math.floor(at.z / CELL) + r; y++) for (let x = Math.floor(at.x / CELL) - r; x <= Math.floor(at.x / CELL) + r; x++) {
    if (x < 0 || y < 0 || x >= g.w || y >= g.h) continue;
    const c = y * g.w + x, d = Math.hypot((x + 0.5) * CELL - at.x, (y + 0.5) * CELL - at.z);
    if (d > radius + CELL / 2) continue;
    const hit = dmg * (1 - Math.min(1, d / (radius + CELL)) * 0.5), ch = g.chars[c];
    // a shelled road breaks up until it is one more crater; a crater that is hit again gets deeper
    if (ch === 'D' || ch === '+') {
      g.wear[c] = Math.min(1, g.wear[c] + hit / (ch === 'D' ? 200 : 500));
      if (ch === 'D' && g.wear[c] >= 1) setCell(g, c, '+'); else touch(g, c);
    }
    if (dmg >= 60 && CFG.fire.ignite[ch] && rng(g) < CFG.fire.ignite[ch]) ignite(g, c);
    if (!(g.cellHp[c] > 0)) continue;
    if ((g.cellHp[c] -= hit) <= 0) wreckCell(g, list, c); else touch(g, c);
  }
}
// what burns: hedges, houses, and dry grass that is neither churned up nor already burnt
const flammable = (g, c) => {
  const ch = g.chars[c];
  return !g.fires.has(c) && (ch === 'H' || ch === 'B' || (ch === '.' && !g.burnt[c] && g.wear[c] < 0.5 && (g.wx?.wet ?? 0) < 0.35));
};
function ignite(g, c) {
  if (!flammable(g, c)) return;
  g.fires.set(c, CFG.fire.burn[g.chars[c]]);
  // hedges and houses throw up smoke, one cloud per stretch of fire
  const at = cellCenter(g, c), s = CFG.fire.smoke;
  if (g.chars[c] !== '.' && !g.smokes.some(q => dist(q, at) < s.r * 1.5)) g.smokes.push({ id: g.nextId++, x: at.x, z: at.z, r: s.r, t: s.t });
}
// Twice a second: fires burn down (faster in rain), hurt and pin infantry standing in them, and catch on to what is
// next to them. A burnt-out hedge is gone, a burnt-out house is rubble, burnt grass does not burn twice.
function burn(g, list, dt) {
  const rain = g.wx?.rain ?? 0, wx = Math.cos(g.wind.a), wz = Math.sin(g.wind.a);
  for (const u of list) {
    const c = u.hp > 0 && !u.air && UNITS[u.type].infantry ? (u.garrison >= 0 ? u.garrison : cellOf(g, u.x, u.z)) : -1;
    if (c < 0 || !g.fires.has(c)) continue;
    u.hp -= CFG.fire.inf * dt; u.supp = Math.min(100, u.supp + CFG.fire.supp * dt);
    g.shots.push({ t: u.id, to: u.owner, x: u.x, z: u.z, k: 'hurt', kill: u.hp <= 0 });
    // a squad with nothing to do steps out of the flames
    if (u.garrison < 0 && !u.path.length) {
      const out = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]].map(([dx, dy]) => cellOf(g, u.x + dx * CELL, u.z + dy * CELL)).filter(n => n >= 0 && !(g.flags[n] & MOVE) && !g.fires.has(n));
      const to = out.find(n => g.chars[n] !== 'H') ?? out[0]; // not further down the hedge that is burning
      if (to !== undefined) u.path = [cellCenter(g, to)];
    }
  }
  for (const [c, left] of [...g.fires]) {
    const ch = g.chars[c], x = c % g.w, y = Math.floor(c / g.w);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy, n = ny * g.w + nx;
      if ((!dx && !dy) || nx < 0 || ny < 0 || nx >= g.w || ny >= g.h || !flammable(g, n)) continue;
      const along = (dx * wx + dy * wz) / Math.hypot(dx, dy) * g.wind.v;
      if (rng(g) < CFG.fire.spread[g.chars[n]] * dt * Math.max(0.1, 1 + 1.5 * along) * (1 - rain)) ignite(g, n);
    }
    if (ch === 'B' && (g.cellHp[c] -= CFG.terrainHp.B / CFG.fire.burn.B * dt) <= 0) { g.burnt[c] = 1; wreckCell(g, list, c); continue; }
    const t = left - dt * (1 + 3 * rain);
    if (t > 0) { g.fires.set(c, t); continue; }
    g.fires.delete(c); g.burnt[c] = 1;
    if (ch === 'H') wreckCell(g, list, c, '.'); else touch(g, c);
  }
}
// Twice a second: a crater beside a river, a ford or a flooded crater fills up, unless it lies higher than the water.
// It becomes a ford as deep as the crater was: wade through it, no cover. One cell a go, so water creeps down a line
// of craters. Only cells that changed (and their neighbours) are looked at.
function flood(g) {
  const fill = [...g.soak].filter(c => {
    if (g.chars[c] !== '+') return false;
    const x = c % g.w;
    return [c - g.w, c + g.w, x > 0 ? c - 1 : -1, x < g.w - 1 ? c + 1 : -1].some(n => (g.chars[n] === 'W' || g.chars[n] === 'F') && level(g, n) >= level(g, c));
  });
  g.soak.clear();
  for (const c of fill) { const deep = g.wear[c]; setCell(g, c, 'F'); g.wear[c] = deep; touch(g, c); }
}
// The wind wanders. Showers come and go: the ground soaks and dries more slowly than the rain starts and stops.
function weather(g, dt) {
  g.wind.a += (rng(g) - 0.5) * 0.6 * dt; g.wind.v = Math.min(1, Math.max(0.15, g.wind.v + (rng(g) - 0.5) * 0.3 * dt));
  for (const s of g.smokes) { s.x += Math.cos(g.wind.a) * g.wind.v * CFG.windSpeed * dt; s.z += Math.sin(g.wind.a) * g.wind.v * CFG.windSpeed * dt; }
  const wx = g.wx, W = CFG.weather, kind = g.weather?.now;
  if (!wx) return;
  // the match weather (shared/weather.js) holds the showers: Rain rains all match (when it turns to mud the rain stops
  // at once), Snow never rains, and in Clear, Fog and Mud showers come and go as always (Mud's ground stays soaked)
  if (kind === 'rain') { wx.raining = true; wx.next = 0; }
  else if (kind === 'snow') wx.raining = false;
  else if ((wx.next -= dt) <= 0) { wx.raining = !wx.raining; const [lo, hi] = wx.raining ? W.rain : W.dry; wx.next = lo + rng(g) * (hi - lo); }
  wx.rain = Math.min(1, Math.max(0, wx.rain + (wx.raining ? dt : -dt) / 20));
  wx.wet = kind === 'mud' ? 1 : Math.min(1, Math.max(0, wx.wet + (wx.rain > 0.5 ? dt / W.soak : -dt / W.dryOut)));
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
  if (TERRAIN[into] & MOVE) for (const u of list) if (u.hp > 0 && !u.air && cellOf(g, u.x, u.z) === c) { u.hp = 0; g.shots.push({ t: u.id, to: u.owner, x: u.x, z: u.z, k: 'hurt', kill: true }); }
}

// After a winner the sim keeps running (the server's closing hold shows the last seconds) without win checks or story.
export function step(g) {
  const dt = TICK;
  rebuildGrid(g);
  g.tick++;
  if (g.winner === null && (g.tick === 1 || g.tick % SAMPLE_EVERY === 0)) sample(g, isStructure);
  stepWeather(g);
  if (g.tick % 4 === 1) updateVision(g);
  // Recount paid segments so cancelled work and dead diggers no longer hold up a project.
  if (g.projects?.size) {
    for (const p of g.projects.values()) p.active = 0;
    for (const u of g.units.values()) if (u.hp > 0 && u.dig?.project) u.dig.project.active++;
  }
  // once a second: drop entrenchments that are finished or that nobody works on (or waits to), and recount the crews
  if (g.projects?.size && g.tick % 20 === 0) {
    const crews = new Map();
    for (const u of g.units.values()) {
      if (u.entrench) crews.set(u.entrench, (crews.get(u.entrench) ?? 0) + 1);
      for (const o of u.orders ?? []) { const p = o.join !== undefined && g.projects.get(o.join); if (p && !crews.has(p)) crews.set(p, 0); }
    }
    for (const [id, p] of g.projects) { if ((!p.jobs.length || !crews.has(p)) && !p.active) g.projects.delete(id); else p.crew = Math.max(1, crews.get(p) ?? 0); }
  }

  beginPathTick(g);
  g.claims = new Map();
  for (const u of g.units.values()) if (u.targetId && u.hp > 0) claim(g, u, u.targetId, 1);
  const crews = new Map(); // construction site id -> engineers working on it this tick
  for (const u of g.units.values()) {
    if (u.hp <= 0) continue;
    const def = UNITS[u.type], w = def.w, sm = suppMul(u);
    if (!def.structure && u.hp > 0) startQueuedOrders(g, u);
    if (def.building) { if (u.queue?.length && u.built >= 1 && !g.mode.suddenDeath) train(g, u, dt); continue; }
    if (def.air) { stepPlane(g, u, dt); continue; }
    if (def.infantry) u.supp = Math.max(0, u.supp - 8 * dt);
    u.cooldown -= dt; u.retarget -= dt; u.repath -= dt; u.cd -= dt; u.buff -= dt; u.sprint -= dt;

    // auto-retreat: a broken unit runs for home by itself
    if (u.autoRetreat && u.owner !== g.mode?.slot && !u.retreating && def.speed > 0 && u.hp < def.models * def.hpPer * CFG.autoRetreat && dist(u, homeOf(g, u)) > CFG.reinforceRadius) retreatUnit(g, u);
    // autocast: twice a second, a ready ability goes off by itself when it's worth it. Through command(), so Munitions,
    // cooldowns and checks apply; never over a player's own ability order (u.nade) and never while retreating.
    if (u.auto && u.cd <= 0 && !u.nade && !u.retreating && (g.tick + u.id) % AUTO_EVERY === 0) {
      const at = autocastTarget(g, u);
      if (at) command(g, u.owner, { t: 'ability', ids: [u.id], x: at.x, z: at.z }, true);
    }

    // Engineers: walk up to the site, then build
    if (u.build) {
      const s = g.units.get(u.build);
      if (!s || (s.built >= 1 && s.hp >= UNITS[s.type].hpPer)) u.build = 0;
      else if (dist(u, s) <= UNITS[s.type].radius + CFG.classic.buildReach) { u.path = []; crews.set(s.id, (crews.get(s.id) ?? 0) + 1); }
      else if (!u.path.length && u.repath <= 0) requestStepPath(g, u, s, 'build');
    }

    // mass entrenchment: a free digger takes one of the next segments, or waits for the manpower to pay for it
    if (u.entrench && !u.dig) { if (!u.entrench.jobs.length && !u.entrench.active) u.entrench = null; else if (u.entrench.jobs.length && !busy(u) && u.garrison < 0) takeDigJob(g, u); }

    // digging: walk to the spot, then turn one cell into trench every digTime seconds
    if (u.dig) {
      if (dist(u, u.dig) > (u.dig.reach ?? 3)) { if (u.repath <= 0 && !u.path.length) requestStepPath(g, u, digGoal(u), 'dig'); }
      else if ((u.dig.t += dt) >= CFG.digTime * (u.type === 'engineer' ? 0.5 : 1)) {
        u.dig.t = 0;
        const [c, ch] = u.dig.cells.shift();
        // ground can change while building; tank traps never go down under a vehicle
        const under = ch === 'Y' && [...g.units.values()].some(v => !UNITS[v.type].infantry && cellOf(g, v.x, v.z) === c);
        if ((ch === '=' ? 'W' : BUILDABLE_GROUND).includes(g.chars[c]) && !under) { setCell(g, c, ch); if (ch === 'N') g.mines.set(c, u.owner); }
        if (!u.dig.cells.length) { if (u.dig.project) u.dig.project.active--; u.dig = null; tally(g, u.owner, 'built'); }
      }
    }

    // grenade order: walk into range, then throw. An autocast one thrown where the unit stands keeps its route.
    if (u.nade) {
      const ab = def.ab, halt = !u.nade.auto || u.nade.walked;
      if ((ab.id === 'barrage' || ab.id === 'grenade' || ab.id === 'satchel') && dist(u, u.nade) <= ab.range && !payAb(g, u)) u.nade = null; // can't afford it any more
      else if (ab.id === 'barrage' && dist(u, u.nade) <= ab.range) {
        launchSalvo(g, u, u.nade, ab.shells); u.cooldown = w.interval; u.cd = ab.cd; u.nade = null; if (halt) u.path = [];
      } else if ((ab.id === 'grenade' || ab.id === 'satchel') && dist(u, u.nade) <= ab.range) {
        g.nades.push({ x: u.nade.x, z: u.nade.z, t: ab.fuse, owner: u.owner, ab });
        g.shots.push({ f: u.id, fo: u.owner, x: u.nade.x, z: u.nade.z, k: 'throw', pub: true });
        u.nade = null; u.cd = ab.cd; if (halt) u.path = [];
      } else if (u.repath <= 0) { requestStepPath(g, u, u.nade, 'nade'); u.nade.walked = true; }
    }

    // heading into a building: walk up to it, then step inside
    if (u.enter >= 0) {
      const at = cellCenter(g, u.enter);
      if (g.chars[u.enter] !== 'B') u.enter = -1;
      else if (dist(u, at) <= CELL * 1.6) { Object.assign(u, { garrison: u.enter, enter: -1, x: at.x, z: at.z, path: [] }); updateGrid(g, u); }
      else if (!u.path.length && u.repath <= 0) requestStepPath(g, u, at, 'enter');
    }

    // attack-move: halt while something is in range, carry on when it's clear
    if (u.amove) {
      const t = g.units.get(u.targetId);
      if (dist(u, u.amove) < 2.5) u.amove = null;
      else if (t && canShoot(g, u, t)) u.path = [];
      else if (!u.path.length && u.repath <= 0) requestStepPath(g, u, u.amove, 'amove');
    }

    // shelling a structure: close to range with a clear line, then fire at it
    if (u.fireAt >= 0) {
      const at = cellCenter(g, u.fireAt);
      if (!(g.cellHp[u.fireAt] > 0)) u.fireAt = -1;
      else if (dist(u, at) <= w.range && (w.salvo || los(g, u, at))) u.path = [];
      else if (!u.path.length && u.repath <= 0) requestStepPath(g, u, at, 'fireAt');
    }

    // explicit attack order: chase until we can shoot (paused while an autocast satchel is carried up to the target)
    if (u.attackId && !u.nade) {
      const t = g.units.get(u.attackId);
      if (!t || !g.players[u.owner].visible.has(t.id)) u.attackId = 0;
      else if (canShoot(g, u, t)) { u.path = []; u.targetId = t.id; }
      else if (u.repath <= 0) requestStepPath(g, u, t, 'attackId');
    }

    // under fire with nothing to do: idle infantry shift to the nearest cover (crewed weapons keep their position)
    if (def.infantry && !w.setup && !u.holdPos && u.hitAt >= g.tick - 40 && (u.coverTry ?? 0) <= g.tick && u.garrison < 0 && idle(u)) {
      u.coverTry = g.tick + CFG.coverRetry / TICK; seekCover(g, u, u.hitFrom);
    }

    // movement
    const before = { x: u.x, z: u.z };
    // the ground under it, blended over its footprint, and the grade of the next metre if that is uphill
    let grade = 0;
    if (g.height && u.path.length) { const wp = u.path[0], d = dist(u, wp) || 1; grade = heightAt(g, u.x + (wp.x - u.x) / d, u.z + (wp.z - u.z) / d) - heightAt(g, u.x, u.z); }
    const speed = def.speed * (u.retreating ? CFG.retreatSpeed : u.sprint > 0 ? def.ab.speed : sm.speed) * speedMul(g, u) * (1 - CFG.slope[def.infantry ? 0 : 1] * Math.min(1, Math.max(0, grade)))
      * weatherSpeed(g, def); // the match weather: infantry in mud, everyone in snow (shared/weather.js)
    // jammed: units that reach one waypoint together push each other off it for good (the separation below undoes each
    // step). After a second without real progress, a unit that can walk straight to its next waypoint skips this one.
    const net = u.was ? dist(u, u.was) : Infinity;
    u.was = before;
    if (u.path.length > 1 && net < speed * dt * 0.3) {
      u.jam = (u.jam ?? 0) + dt;
      if (u.jam > 1 && walkable(g, u, u.path[1], def.infantry ? MOVE | WIRE : MOVE | VBLOCK)) { u.path.shift(); u.jam = 0; }
    } else u.jam = 0;
    let budget = speed * dt;
    while (budget > 0 && u.path.length) {
      const wp = u.path[0], d = dist(u, wp);
      u.rot = Math.atan2(wp.z - u.z, wp.x - u.x);
      if (d <= budget) { u.x = wp.x; u.z = wp.z; u.path.shift(); budget -= d; }
      else { u.x += (wp.x - u.x) / d * budget; u.z += (wp.z - u.z) / d * budget; budget = 0; }
    }
    const moved = dist(u, before), moving = u.path.length > 0 || moved > 0.001;
    updateGrid(g, u);
    if (def.crushes && moved > 0) { const c = cellOf(g, u.x, u.z); if (c >= 0 && CFG.crush[g.chars[c]]) wreckCell(g, [], c, CFG.crush[g.chars[c]]); }
    // a mine goes off under the first squad or vehicle that is not on the side that laid it
    if (moved > 0) {
      const c = cellOf(g, u.x, u.z);
      // vehicles cut up the ground they drive on, faster when it is wet: open ground slowly turns to mud, mud deepens.
      // On dry ground they raise dust instead.
      if (!def.infantry && c >= 0) {
        const ch = g.chars[c], wet = g.wx ? g.wx.wet * (g.height && g.height[c] < 0 ? 2 : 1) : 0;
        if (ch === '.' || ch === 'M') {
          g.wear[c] = Math.min(1, g.wear[c] + moved * CFG.traffic * (def.crushes ? 1 : 0.5) * (ch === 'M' ? 0.5 : 1) * (1 + CFG.weather.wetWear * wet));
          if (ch === '.' && g.wear[c] >= 1) { setCell(g, c, 'M'); g.wear[c] = 0; g.cellState[c] = stateOf(g, c); logCell(g, c, [c, 'M']); } else touch(g, c);
        }
        if (wet < 0.3 && !(g.flags[c] & (MUD | FORD))) u.dust = g.tick;
      }
      if (c >= 0 && g.chars[c] === 'N' && !allied(g, g.mines.get(c) ?? -1, u.owner)) {
        const at = cellCenter(g, c), by = g.mines.get(c) ?? -1;
        setCell(g, c, '+'); g.shots.push({ x: at.x, z: at.z, k: 'boom', pub: true });
        blast(g, [...g.units.values()], at, CFG.mine.blast, CFG.mine, by);
        if (u.hp <= 0) continue;
      }
    }
    u.still = moving ? 0 : u.still + dt;
    // give up if blocked by friends crowding the destination
    if (u.retreating && !u.path.length) u.retreating = false;
    if (u.path.length && moved < speed * dt * 0.3) { u.stuck += dt; if (u.stuck > 1) { u.path = []; u.stuck = 0; if (u.amove) u.amove = null; } } else u.stuck = 0;

    // a vehicle standing still turns its front armor to the gun that last shot at it, else to a gun it is fighting
    if (!def.infantry && !def.structure && !moving && def.speed > 0) {
      const foe = g.units.get(u.targetId), at = u.hitAt >= g.tick - 100 ? u.hitFrom : foe && UNITS[foe.type].w?.veh >= 20 ? foe : null;
      if (at) { const to = Math.atan2(at.z - u.z, at.x - u.x), d = Math.atan2(Math.sin(to - u.rot), Math.cos(to - u.rot)); u.rot += Math.max(-CFG.hullTurn * dt, Math.min(CFG.hullTurn * dt, d)); }
    }

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
    if (u.holdFire && !u.attackId) u.targetId = 0; // holding fire: only an attack order shoots
    else if (!u.attackId && (u.retarget <= 0 || (u.targetId && !canShoot(g, u, g.units.get(u.targetId))))) { retarget(g, u); u.retarget = 0.5; }
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
    if (s.built >= 1) tally(g, s.owner, 'built');
    s.hp = Math.min(def.hpPer, s.hp + def.hpPer * 0.75 * rate);
  }

  // soft separation; never push a unit into a blocked cell
  const list = [...g.units.values()];
  const order = new Map(list.map((u, i) => [u.id, i])), maxRadius = Math.max(0, ...list.map(u => UNITS[u.type].radius));
  for (let i = 0; i < list.length; i++) {
    const a = list[i], radius = (UNITS[a.type].radius + maxRadius) * 0.8;
    if (a.garrison >= 0 || a.air) continue;
    const grid = gridFor(g), size = grid.size;
    let x0 = Math.floor((a.x - radius) / size), x1 = Math.floor((a.x + radius) / size), z0 = Math.floor((a.z - radius) / size), z1 = Math.floor((a.z + radius) / size);
    let candidates = grid.candidates(a, radius).filter(b => order.get(b.id) > i);
    for (let k = 0; k < candidates.length; k++) {
      const b = candidates[k], j = order.get(b.id), min = (UNITS[a.type].radius + UNITS[b.type].radius) * 0.8;
      if (a.garrison >= 0 || b.garrison >= 0 || a.air || b.air) continue;
      const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
      if (d >= min || d === 0) continue;
      const sa = UNITS[a.type].structure, sb = UNITS[b.type].structure;
      if (sa && sb) continue;
      const push = (min - d) / 2 * (sa || sb ? 1 : 0.5), px = dx / d * push, pz = dz / d * push;
      // a squad holding its cover is not pushed off it, and does not push back at a friend walking past
      const ha = !sa && shovedFromCover(g, a, a.x - px, a.z - pz), hb = !sb && shovedFromCover(g, b, b.x + px, b.z + pz);
      if (!sa && !ha && !(hb && a.path.length) && !(flagsAt(g, a.x - px, a.z - pz) & MOVE) && Math.abs(levelAt(g, a.x - px, a.z - pz) - levelAt(g, a.x, a.z)) <= 1) { a.x -= px; a.z -= pz; }
      if (!sb && !hb && !(ha && b.path.length) && !(flagsAt(g, b.x + px, b.z + pz) & MOVE) && Math.abs(levelAt(g, b.x + px, b.z + pz) - levelAt(g, b.x, b.z)) <= 1) { b.x += px; b.z += pz; }
      updateGrid(g, a); updateGrid(g, b);
      // Unvisited units have not moved during this i pass. The candidate cells remain
      // complete until a push changes the query bounds. No displacement padding is needed.
      const nx0 = Math.floor((a.x - radius) / size), nx1 = Math.floor((a.x + radius) / size), nz0 = Math.floor((a.z - radius) / size), nz1 = Math.floor((a.z + radius) / size);
      if (nx0 !== x0 || nx1 !== x1 || nz0 !== z0 || nz1 !== z1) {
        x0 = nx0; x1 = nx1; z0 = nz0; z1 = nz1;
        candidates = grid.candidates(a, radius).filter(next => order.get(next.id) > j); k = -1;
      }
    }
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
    if (!s.live) {
      s.live = true;
      if (sp.plane) g.shots.push({ k: s.kind, x: s.x, z: s.z, dir: s.dir, fo: s.owner, pub: true });
      if (sp.plane && intercepted(g, s, list)) continue; // shot down on the way in
      if (s.kind === 'dive') {
        // one heavy bomb, right on the spot
        g.shots.push({ x: s.x, z: s.z, k: 'bomb', pub: true });
        blast(g, list, s, sp.blast, sp, s.owner);
        const c = cellOf(g, s.x, s.z); if (c >= 0 && g.chars[c] === '.') setCell(g, c, '+');
        digAt(g, s, sp.dig);
      } else if (s.kind === 'para') {
        if (!g.players[s.owner].out && popOf(g, s.owner) < popCap(g)) { const u = spawnUnit(g, s.owner, sp.unit); Object.assign(u, cellCenter(g, nearestFree(g, s.x, s.z))); updateGrid(g, u); g.shots.push({ k: 'chutes', x: u.x, z: u.z, pub: true }); }
      } else if (s.kind === 'cover') {
        (g.covers ??= []).push({ team: g.players[s.owner].team, owner: s.owner, x: s.x, z: s.z, r: sp.radius, t: sp.dur });
        s.left = 0;
      }
    }
    if (s.kind === 'recon') s.left -= dt;
    else if (s.kind === 'smoke') {
      for (let i = 0; i < sp.clouds; i++) {
        // a wall of clouds along the line
        const at = stripAt(s, (i / (sp.clouds - 1) - 0.5) * (sp.len - sp.cloud), (Math.random() - 0.5) * 2);
        g.smokes.push({ id: g.nextId++, x: at.x, z: at.z, r: sp.cloud, t: sp.dur });
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
        if (inStrip(s, t, sp.len, sp.width) && t.hp > 0 && !t.air) hurt(g, t, sp, 1, s.owner);
      }
      s.left = 0;
    }
  }
  g.strikes = g.strikes.filter(s => !s.live || s.left > 0);
  antiAir(g, list, dt);
  if (g.covers) { for (const c of g.covers) c.t -= dt; g.covers = g.covers.filter(c => c.t > 0); }
  for (const p of g.players) for (const k of SUPPORT_TYPES) p.sup[k] -= dt;
  for (const s of g.smokes) s.t -= dt * (1 + 0.5 * (g.wx?.rain ?? 0));
  weather(g, dt);
  if (g.fires.size && g.tick % 10 === 0) burn(g, list, dt * 10);
  if (g.soak.size && g.tick % 10 === 0) flood(g);
  g.smokes = g.smokes.filter(s => s.t > 0);

  // reinforce / repair near your own spawn (Classic: near any own or allied Production Building), paid in manpower
  const bases = g.mode?.kind === 'classic' ? list.filter(b => UNITS[b.type].produces && b.built >= 1 && b.hp > 0) : null;
  const atBase = (u) => (bases ? bases.some(b => allied(g, b.owner, u.owner) && dist(u, b) <= CFG.reinforceRadius) : dist(u, g.players[u.owner].spawn) <= CFG.reinforceRadius);
  for (const u of list) {
    const def = UNITS[u.type], p = g.players[u.owner], full = def.models * def.hpPer;
    if (def.structure || def.air || u.hp <= 0 || u.hp >= full || u.owner === g.mode?.slot || !atBase(u)) { u.reinf = 0; continue; }
    if (def.infantry) {
      const cost = def.cost / def.models * 0.5;
      if ((u.reinf += dt) >= CFG.reinforceEvery && p.mp >= cost) { u.reinf = 0; p.mp -= cost; tally(g, u.owner, 'mpSpent', cost); u.hp = Math.min(full, (alive(u) + 1) * def.hpPer); }
    } else {
      const hp = Math.min(full - u.hp, 18 * dt), cost = hp * 0.5;
      if (p.mp >= cost) { u.hp += hp; p.mp -= cost; u.reinf = 1; tally(g, u.owner, 'mpSpent', cost); }
    }
  }

  for (const u of list) if (u.hp <= 0) {
    g.units.delete(u.id); if (UNITS[u.type].building) wreckBuilding(g, u);
    // kill bounty for the enemy who finished it (no reward for friendly fire)
    const k = u.lastHit;
    if (k >= 0 && !allied(g, k, u.owner) && !g.players[k].out && k !== g.mode?.slot) g.players[k].mp += UNITS[u.type].cost * CFG.bounty;
    died(g, u, UNITS[u.type], k >= 0 && !allied(g, k, u.owner) ? k : -1);
  }

  // capture points: infantry only, uncontested by another team. A point belongs to the player who took it;
  // teammates standing on it keep it theirs.
  for (const p of g.points) {
    const on = list.filter(u => u.hp > 0 && !u.retreating && UNITS[u.type].infantry && dist(u, p) <= CFG.pointRadius);
    p.onPoint = on.map(u => u.id);
    p.contested = on.some(u => !allied(g, u.owner, on[0].owner));
    if (!on.length || p.contested) continue;
    const s = on[0].owner, rate = dt / CFG.captureTime;
    if (allied(g, p.owner, s)) p.progress = 1;
    else if (p.owner >= 0) { p.progress -= rate; if (p.progress <= 0) { p.owner = -1; p.progress = 0; p.capper = s; } }
    else {
      if (!allied(g, p.capper, s)) { p.capper = s; p.progress = 0; }
      p.progress += rate;
      if (p.progress >= 1) { p.owner = s; p.progress = 1; captured(g, p, s); }
    }
  }

  // victory points count per team: whichever team's players together reach g.winVp wins
  const teamVp = (t) => g.players.reduce((a, q) => a + (q.team === t ? q.vp : 0), 0);
  const lead = Math.max(...g.players.map(q => teamVp(q.team)));
  for (const pl of g.players) {
    const held = g.points.filter(p => p.owner === pl.slot);
    // away = disconnected (set by the server): their clock stops so a dropout doesn't decide the match
    if (!g.mode && g.winner === null) pl.vp += held.reduce((a, p) => a + p.vp, 0) * dt * (pl.away ? 0 : 1); // frozen once decided
    if (g.mode?.kind === 'classic') {
      // no catch-up: MP from the HQ trickle and finished depots, Munitions from every point the team holds
      const C = CFG.classic, own = list.filter(u => u.owner === pl.slot && u.hp > 0);
      // home depots pay MP, the contested ones by the villages pay Fuel
      const paying = g.nodes.filter(n => { const d = g.units.get(n.depot); return d && d.owner === pl.slot && d.built >= 1 && d.hp > 0; });
      const depots = paying.reduce((a, n) => a + (n.fuel ? 0 : n.rate), 0);
      pl.fuelInc = pl.away || pl.out ? 0 : (C.hqFuel + paying.reduce((a, n) => a + (n.fuel ? n.rate : 0), 0)) * g.army.income;
      pl.fuel += pl.fuelInc * dt;
      pl.upkeep = own.reduce((a, u) => a + (UNITS[u.type].structure ? 0 : UNITS[u.type].cost * C.upkeep), 0);
      pl.inc = pl.away || pl.out ? 0 : Math.max(C.minInc, (C.trickle + depots) * g.army.income - pl.upkeep);
      pl.mp += pl.inc * dt;
      if (!pl.away && !pl.out) pl.mun += g.points.reduce((a, p) => a + (allied(g, p.owner, pl.slot) ? p.vp : 0), 0) * C.munPerVp * g.army.income * dt;
      continue;
    }
    if (pl.slot === g.mode?.slot) { pl.inc = 0; continue; } // the horde is paid per wave (stepHorde)
    const base = !g.mode ? CFG.mpBase : g.mode.kind === 'annihilation' ? CFG.assault.annihilationBase : pl.team === g.mode.defenderTeam ? CFG.assault.defenderBase : CFG.assault.attackerBase;
    pl.inc = pl.away ? 0 : (base + held.reduce((a, p) => a + p.mp, 0) + Math.min(CFG.catchupMax, (lead - teamVp(pl.team)) / CFG.catchupPer)) * g.army.income;
    pl.mp += pl.inc * dt;
  }
  if (g.mode?.kind === 'classic') {
    // Annihilation: no Production Building (a site of one counts) = out, and everything you own goes with you
    if (g.winner === null) g.mode.timeLeft -= dt; // the clock stops once decided
    // Sudden Death: production and construction stop, and every Production Building crumbles
    if (g.mode.timeLeft <= 0 && !g.mode.suddenDeath) { g.mode.suddenDeath = true; for (const b of list) if (b.queue) b.queue = []; }
    if (g.mode.suddenDeath) for (const b of list) if (UNITS[b.type].produces && b.hp > 0) b.hp -= UNITS[b.type].hpPer * CFG.classic.decay * dt;
    for (const b of list) if (UNITS[b.type].building && b.hp <= 0 && g.units.has(b.id)) { g.units.delete(b.id); wreckBuilding(g, b); died(g, b, UNITS[b.type], -1); }
    for (const pl of g.players) {
      if (pl.out || [...g.units.values()].some(u => u.owner === pl.slot && UNITS[u.type].produces)) continue;
      pl.out = true;
      // the army goes to the nearest surviving teammate (no pop cap for it); buildings (depots) go down
      const mates = g.players.filter(q => q.team === pl.team && !q.out);
      for (const u of [...g.units.values()]) {
        if (u.owner !== pl.slot) continue;
        if (UNITS[u.type].building || !mates.length) { g.units.delete(u.id); if (UNITS[u.type].building) wreckBuilding(g, u); continue; }
        const to = mates.sort((a, b) => dist(a.spawn, u) - dist(b.spawn, u))[0];
        Object.assign(u, { owner: to.slot, orders: [], build: 0, attackId: 0, amove: null, path: [], retreating: false });
      }
    }
    const left = new Set(g.players.filter(p => !p.out).map(p => p.team));
    if (g.winner === null && g.mode.teams > 1 && left.size <= 1) finish(g, left.size ? [...left][0] : -1, 'hq', g.fallen?.hq); // -1 = draw
    return;
  }
  if (g.mode?.kind === 'horde') return stepHorde(g, dt);
  if (g.mode?.kind === 'annihilation') {
    // a team is out when its last bunker falls; the last team with one standing wins
    const left = new Set([...g.units.values()].filter(u => u.type === 'bunker' && u.hp > 0).map(u => g.players[u.owner].team));
    if (g.winner === null && g.mode.teams > 1 && left.size <= 1) finish(g, left.size ? [...left][0] : -1, 'bunkers', g.fallen?.bunker);
    return;
  }
  if (g.mode) {
    // assault: the attackers win when the last bunker falls, the defenders when the clock runs out
    if (g.winner !== null) return; // the clock stops once decided
    g.mode.timeLeft -= dt;
    if (![...g.units.values()].some(u => UNITS[u.type].structure && u.hp > 0)) finish(g, g.mode.attackerTeam, 'structures', g.fallen?.structure);
    else if (g.mode.timeLeft <= 0) finish(g, g.mode.defenderTeam, 'timer');
    return;
  }
  for (const pl of g.players) if (teamVp(pl.team) >= g.winVp && g.winner === null) finish(g, pl.team, 'vp', lastCapture(g, pl.team)); // winner = team id
}

const isStructure = (u) => !!UNITS[u.type].structure;
// The match is decided: the winning team id (-1 for a draw), why ('hq', 'bunkers', 'structures', 'timer' or 'vp'; a
// draw is always 'draw') and the decisive spot (else the map center). From here the fog is lifted for everyone
// (snapshotFor) and nothing more counts toward the story.
export function finish(g, winner, reason, at) {
  if (g.winner !== null) return;
  sample(g, isStructure);
  const c = at ?? { x: g.w * CELL / 2, z: g.h * CELL / 2 };
  Object.assign(g, { winner, endReason: winner === -1 ? 'draw' : reason, endAt: { x: Math.round(c.x * 10) / 10, z: Math.round(c.z * 10) / 10 }, endTick: g.tick, reveal: true });
}

// what a unit is set on, as [kind, x, z]. kind: 0 none, 1 move, 2 attack-move, 3 retreat, 4 attack a unit,
// 5 fire at a structure, 6 throw / plant at a spot, 7 dig, 8 build, 9 go into a house
function planOf(g, u) {
  if (u.air) { const m = u.air.mission; return airborne(u) && m ? [m.kind === 'attack' ? 4 : 1, m.x, m.z] : [0, 0, 0]; }
  const t = u.attackId && g.units.get(u.attackId), site = u.build && g.units.get(u.build);
  if (u.retreating) return [3, g.players[u.owner].spawn.x, g.players[u.owner].spawn.z];
  if (t && g.players[u.owner].visible.has(t.id)) return [4, t.x, t.z];
  if (u.fireAt >= 0) { const c = cellCenter(g, u.fireAt); return [5, c.x, c.z]; }
  if (u.nade) return [6, u.nade.x, u.nade.z];
  if (u.dig) return [7, u.dig.x, u.dig.z];
  if (u.entrench?.jobs.length) return [7, u.entrench.jobs[0].x, u.entrench.jobs[0].z]; // between segments, or waiting for manpower
  if (u.entrench?.active) return [7, u.x, u.z]; // waiting for the other diggers to finish
  if (site) return [8, site.x, site.z];
  if (u.enter >= 0) { const c = cellCenter(g, u.enter); return [9, c.x, c.z]; }
  if (u.amove) return [2, u.amove.x, u.amove.z];
  const end = u.path.at(-1);
  return end ? [1, end.x, end.z] : [0, 0, 0];
}

// Terrain remembers the last version each player saw. Building footprints catch up when discovered again.
export function terrainFor(g, slot, full = false) {
  const p = g.players[slot], memory = p.terrainMemory ??= new Map();
  const pending = p.terrainPending ??= new Set(g.cellLog.keys());
  if (!pending.size) return full ? [...memory.values()] : [];
  const changes = [], visible = new Map();
  // Unseen footprints stay pending. Replay order also preserves remembered terrain order.
  for (const index of [...pending].sort((a, b) => a - b)) {
    const cell = g.cellLog[index], [c, ch, height] = cell, old = memory.get(c);
    if (old && old[1] === ch && old[2] === height && old[3] === cell[3]) { pending.delete(index); continue; }
    // a mine shows only to the side that laid it, until it goes off
    if (ch === 'N' && !allied(g, g.mines.get(c) ?? -1, slot)) continue;
    const building = g.buildingCells?.get(c);
    if (building) {
      if (!visible.has(building)) visible.set(building, allied(g, building.owner, slot)
        || (g.units.has(building.id) ? p.visible.has(building.id) : teamSees(g, p.team, building)));
      if (!visible.get(building)) continue;
    }
    pending.delete(index);
    const known = [...cell]; memory.set(c, known); changes.push(known);
  }
  return full ? [...memory.values()] : changes;
}

const rounded = (v) => Math.round(v * 10) / 10;
export const AUTO_FLAG = 16384; // a unit's autocast is on; only its owner is told (1024 marks a mass entrenchment)
const unitFlags = (g, u) => (u.retreating ? 1 : 0) | (u.buff > 0 ? 2 : 0) | (u.ap ? 4 : 0) | (u.reinf > 0 ? 8 : 0) | (u.dig ? 16 : 0) | (u.garrison >= 0 ? 32 : 0) | (u.amove ? 64 : 0) | (u.build ? 128 : 0) | (UNITS[u.type].camo && u.still >= 3 && g.tick - (u.shotAt ?? -1e9) >= 80 ? 256 : 0) | (u.air && !airborne(u) ? 512 : 0) | (u.entrench ? 1024 : 0) | (dusty(g, u) ? 32768 : 0);
function unitRow(g, u) {
  const r = rounded;
  return [u.id, u.type, u.owner, r(u.x), r(u.z), r(u.rot), r(u.aim), Math.ceil(u.hp), Math.round(u.supp), u.targetId || 0, inTrench(g, u) ? 2 : inCover(g, u) ? 1 : UNITS[u.type].infantry && nearCover(g, u) ? 3 : 0,
    Math.max(0, Math.ceil(u.cd)), unitFlags(g, u) | stanceBits(u) | (u.auto ? AUTO_FLAG : 0), vet(u), u.built ?? 1];
}
// a unit's waiting orders as its owner sees them: [id, count, kind, x, z, ...]
function ordersRow(g, u) { return [u.id, u.orders.length, ...u.orders.flatMap(o => queuedPlan(g, u.owner, o).map(rounded))]; }
function modeRow(g) {
  return g.mode && { kind: g.mode.kind, defenderTeam: g.mode.defenderTeam, attackerTeam: g.mode.attackerTeam, timeLeft: Math.max(0, Math.ceil(g.mode.timeLeft)), suddenDeath: !!g.mode.suddenDeath, total: g.mode.total, bunkers: g.mode.bunkers,
    wave: g.mode.wave, left: g.mode.left, active: g.mode.active, slot: g.mode.slot };
}
function playerRow(row, slot, seen) {
  const result = row.slice();
  result[9] = row[9] && seen(row[9]) ? row[9] : 0;
  result[11] = row[2] === slot ? row[11] : 0;
  if (row[2] !== slot) result[12] = row[12] & (2047 | 32768); // stances and autocast are the owner's business, dust is everyone's
  return result;
}

const wxRow = (g) => [rounded(g.wx?.rain ?? 0), rounded(g.wx?.wet ?? 0), rounded(g.wind.a), rounded(g.wind.v)];
// Explicit send-scoped cache. The caller must rebuild after any state change.
export function snapshotCache(g) {
  rebuildGrid(g);
  const r = rounded, owners = g.players.map(() => ({ queues: [], plans: [], air: [], orders: [] })), teams = new Map(), units = [];
  for (const u of g.units.values()) {
    units.push(unitRow(g, u));
    const own = owners[u.owner];
    if (u.queue) own.queues.push([u.id, u.queue.length ? r(u.prog / UNITS[u.queue[0]].train) : 0, u.rally ? r(u.rally.x) : -1, u.rally ? r(u.rally.z) : -1, ...u.queue]);
    if (!UNITS[u.type].structure) {
      const plan = [u.id, ...planOf(g, u).map(r)];
      for (const q of u.path) plan.push(r(q.x), r(q.z));
      own.plans.push(plan);
    }
    if (u.orders?.length) own.orders.push(ordersRow(g, u));
    if (u.air) own.air.push([u.id, ['base', 'out', 'station', 'home', 'rearm'].indexOf(u.air.state), Math.ceil(u.air.fuel), u.air.ammo, Math.ceil(u.air.timer)]);
  }
  for (const p of g.players) if (!teams.has(p.team)) teams.set(p.team, {
    visible: p.visible,
    ghosts: g.mode?.kind === 'classic' ? knownBuildings(g, p.slot).map(gh => [gh.id, gh.type, gh.owner, r(gh.x), r(gh.z), r(gh.built)]) : undefined,
    covers: (g.covers ?? []).filter(c => c.team === p.team).map(c => [r(c.x), r(c.z), c.r, Math.ceil(c.t)]),
  });
  return { units, owners, teams,
    nodes: g.nodes?.map(n => [r(n.x), r(n.z), n.rate, n.fuel ? 1 : 0]), out: g.players.map(q => !!q.out),
    mode: modeRow(g),
    smokes: g.smokes.map(q => [r(q.x), r(q.z), q.r, q.id]), strikes: g.strikes.map(q => [q.kind, r(q.x), r(q.z), r(q.dir), Math.max(0, r(q.t)), q.owner]),
    fires: [...g.fires.keys()], wx: wxRow(g),
    points: g.points.map(q => [q.owner, q.capper, r(q.progress)]), vp: g.players.map(q => Math.floor(q.vp)),
  };
}

// What one player is allowed to know: own units + enemies they can see. Fog is enforced here.
export function seenBy(g, slot, id) {
  const u = g.units.get(id);
  // A plane is seen only while it flies, even between vision updates. The end-of-match reveal shows everything.
  return (g.reveal && !!u) || allied(g, u?.owner ?? -1, slot) || (g.players[slot].visible.has(id) && (!u?.air || airborne(u)));
}

export function snapshotFor(g, slot, shots, cells = [], cache) {
  if (!cache) rebuildGrid(g);
  const p = g.players[slot], r = (v) => Math.round(v * 10) / 10;
  const seen = (id) => seenBy(g, slot, id);
  return {
    t: 's', tick: g.tick, winner: g.winner, end: g.winner === null ? undefined : { reason: g.endReason, x: g.endAt.x, z: g.endAt.z }, mp: Math.floor(p.mp), inc: r(p.inc), mun: p.mun === undefined ? undefined : Math.floor(p.mun), fuel: p.fuel === undefined ? undefined : Math.floor(p.fuel), fuelInc: p.fuelInc === undefined ? undefined : r(p.fuelInc),
    nodes: cache ? cache.nodes : g.nodes?.map(n => [r(n.x), r(n.z), n.rate, n.fuel ? 1 : 0]), upkeep: p.upkeep === undefined ? undefined : r(p.upkeep), out: cache ? cache.out : g.players.map(q => !!q.out),
    // your own units' orders, for drawing when selected: [id, kind, target x, target z, ...remaining waypoints x, z]
    // your Production Buildings: [id, training progress 0-1, rally x, rally z (or -1), ...queued unit types]
    queues: cache ? cache.owners[slot].queues : [...g.units.values()].filter(b => b.owner === slot && b.queue).map(b => [b.id, b.queue.length ? r(b.prog / UNITS[b.queue[0]].train) : 0, b.rally ? r(b.rally.x) : -1, b.rally ? r(b.rally.z) : -1, ...b.queue]),
    plans: cache ? cache.owners[slot].plans : [...g.units.values()].filter(u => u.owner === slot && !UNITS[u.type].structure).map(u => [u.id, ...planOf(g, u).map(r), ...u.path.flatMap(q => [r(q.x), r(q.z)])]),
    // Only the receiver's waiting orders: [id, count, kind, x, z, ...].
    orders: cache ? cache.owners[slot].orders : [...g.units.values()].filter(u => u.owner === slot && u.orders?.length).map(u => ordersRow(g, u)),
    rally: p.rally ? [r(p.rally.x), r(p.rally.z)] : null,
    army: g.army,
    // public weather: [now] or, just before it turns, [now, next, seconds left]
    weather: weatherRow(g),
    mode: cache ? cache.mode : modeRow(g),
    // enemy buildings remembered under fog: [id, type, owner, x, z, how far built]
    ghosts: cache ? cache.teams.get(p.team).ghosts?.filter(gh => !seen(gh[0])) : g.mode?.kind === 'classic' ? knownBuildings(g, slot).filter(gh => !seen(gh.id)).map(gh => [gh.id, gh.type, gh.owner, r(gh.x), r(gh.z), r(gh.built)]) : undefined,
    // flags: 1 retreating, 2 ability active, 4 AP loaded, 8 reinforcing, 16 digging, 32 garrisoned, 64 attack-moving.
    // 128 building a site, 256 hidden sniper, 512 plane at base, 1024 on a mass entrenchment; own units only: 2048
    // holding fire, 4096 holding position, 8192 auto-retreat, 16384 autocast on. Then veterancy stars, then how far a
    // building is built (0-1). Cooldowns only for your own units.
    units: cache ? cache.units.filter(row => seen(row[0])).map(row => playerRow(row, slot, seen)) : [...g.units.values()].filter(u => seen(u.id))
      .map(u => [u.id, u.type, u.owner, r(u.x), r(u.z), r(u.rot), r(u.aim), Math.ceil(u.hp), Math.round(u.supp), u.targetId && seen(u.targetId) ? u.targetId : 0, inTrench(g, u) ? 2 : inCover(g, u) ? 1 : UNITS[u.type].infantry && nearCover(g, u) ? 3 : 0,
        u.owner === slot ? Math.max(0, Math.ceil(u.cd)) : 0, unitFlags(g, u) | (u.owner === slot ? stanceBits(u) | (u.auto ? AUTO_FLAG : 0) : 0), vet(u), u.built ?? 1]),
    smokes: cache ? cache.smokes : g.smokes.map(q => [r(q.x), r(q.z), q.r, q.id]),
    // burning cells, and the weather: [rain 0-1, how wet the ground is 0-1, wind direction, wind strength 0-1]
    fires: cache ? cache.fires : [...g.fires.keys()], wx: cache ? cache.wx : wxRow(g),
    // incoming and active strikes are public: that's the counterplay
    strikes: cache ? cache.strikes : g.strikes.map(q => [q.kind, r(q.x), r(q.z), r(q.dir), Math.max(0, r(q.t)), q.owner]),
    // your planes: [id, state (0 at base, 1 out, 2 on station, 3 heading home, 4 rearming), fuel s, ammo, rearm s]
    air: cache ? cache.owners[slot].air : [...g.units.values()].filter(u => u.owner === slot && u.air).map(u => [u.id, ['base', 'out', 'station', 'home', 'rearm'].indexOf(u.air.state), Math.ceil(u.air.fuel), u.air.ammo, Math.ceil(u.air.timer)]),
    covers: cache ? cache.teams.get(p.team).covers : (g.covers ?? []).filter(c => c.team === p.team).map(c => [r(c.x), r(c.z), c.r, Math.ceil(c.t)]),
    // segments still to dig of your side's mass entrenchments: [project id, 1 for wire, x, z, dir] (unrounded, so the
    // client lands on the same cells)
    // (the 6th element names the kind), then the works a squad is walking to or digging right now: they stay on the
    // ground until they are dug. Their id is the project's while it still has segments to hand out, else -1.
    works: [...[...(g.projects?.values() ?? [])].filter(q => allied(g, q.owner, slot)).flatMap(q => q.jobs.map(j => [q.id, j.kind === 'wire' ? 1 : 0, j.x, j.z, j.dir, j.kind])),
      ...[...g.units.values()].filter(u => u.hp > 0 && u.dig?.kind && allied(g, u.owner, slot)).map(u => [u.dig.project?.jobs.length ? u.dig.project.id : -1, u.dig.kind === 'wire' ? 1 : 0, u.dig.x, u.dig.z, u.dig.dir, u.dig.kind])],
    sup: Object.fromEntries(SUPPORT_TYPES.map(k => [k, Math.max(0, Math.ceil(p.sup[k]))])),
    points: g.points.map((q, i) => {
      // A contest is readable only when at least two teams' on-point units are already visible.
      const teams = new Set((q.contested ? q.onPoint : []).filter(seen).map(id => g.players[g.units.get(id)?.owner]?.team).filter(t => t !== undefined));
      return [...(cache ? cache.points[i] : [q.owner, q.capper, r(q.progress)]), teams.size > 1 ? 1 : 0];
    }),
    vp: cache ? cache.vp : g.players.map(q => Math.floor(q.vp)),
    // Terrain comes from each player's own memory (terrainFor), so the cells argument is unused.
    cells: terrainFor(g, slot),
    // the cells this player's team started or stopped seeing since its last fog (fogFor), only when there are any
    fog: g.skipFog ? undefined : fogFor(g, slot), // an AI seat's detached projection builds no fog masks (it never draws them)
    // A shot names only the units this player can see.
    shots: shots.filter(s => g.reveal || s.pub || allied(g, s.fo ?? -1, slot) || allied(g, s.to ?? -1, slot) || seen(s.f) || seen(s.t))
      .map(s => {
        const shot = { ...s };
        if (s.f && !seen(s.f)) delete shot.f;
        if (s.t && !seen(s.t)) delete shot.t;
        return shot;
      }),
  };
}
