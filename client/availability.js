import { worldLayers, composeWorldCell } from '../shared/world-layers.js';
import { tierOf, techCost, TIER_NAMES } from '../shared/tech.js';
import { UNITS, FORTS, CFG, TERRAIN, CELL, RIDING_FLAG, priceOf, supCost, popCap, popUse, dropPop, abCost, levelOf, teamSees, buildKinds, builderTypes, isSkirmishBaseMode, productionAccess, productionBuildings } from '../shared/sim.js';

// Server denials deliberately contain no target details.
export const DENY_SENTENCES = Object.freeze({
  mp: 'Not enough manpower', mun: 'Not enough munitions', fuel: 'Not enough fuel', ammo: 'Not enough carried ammunition', ammo: 'Not enough carried ammunition',
  pop: 'The army is at its limit', cooldown: 'That order is still on cooldown',
  unseen: 'That target is not visible', notVisible: 'That spot is not visible',
  blocked: 'That spot is blocked or uneven', needs: 'The required unit or building is missing',
  max: 'That unit or position is at its limit', suddenDeath: 'Not during Sudden Death',
  queueFull: 'The training queue is full', ordersFull: 'This unit already has 8 queued orders',
  retreating: 'That squad is retreating', noBuilders: 'Select a builder squad',
  noCover: 'No cover within reach',
  notWaiting: 'That recruit is no longer waiting',
  scenario: 'This scenario cannot start with the selected sides, factions or mode',
  territory: 'Build inside territory your team owns',
  coast: 'A Shipyard needs open water beside it', tier: 'Needs a higher HQ tier', shore: 'Too far from the shore to land',
});
// The server answers queueFull for both a full training queue (buy) and a full order queue (every other command).
export const denySentence = (code, cmd) =>
  DENY_SENTENCES[code === 'queueFull' && cmd && cmd !== 'buy' ? 'ordersFull' : code] ?? 'That order cannot happen';
// The one rounding for every cooldown the player reads (reason sentences and button labels): whole seconds, rounded up.
export const cooldownSeconds = (cd) => Math.max(0, Math.ceil(cd));
const yes = () => ({ ok: true, reason: '' });
const no = (reason) => ({ ok: false, reason });
export const snapshotUnits = (s) => (s?.units ?? []).map((v) => ({
  id: v[0], type: v[1], owner: v[2], x: v[3], z: v[4], hp: v[7], cd: v[11], flags: v[12], riding: !!(v[12] & RIDING_FLAG), built: v[14] ?? 1,
  queue: (s.queues ?? []).find((q) => q[0] === v[0])?.slice(4) ?? [],
}));
// Global cards prefer a selected compatible facility, otherwise the server chooses one.
export function recruitAction(s, slot, unit, ids = [], teams = []) {
  const action = { t: 'buy', unit };
  if (!s || !isSkirmishBaseMode(s)) return action;
  const view = { ...s, units: snapshotUnits(s), players: teams.map(team => ({ team })) };
  const b = productionBuildings(view, slot, unit).find(b => ids.includes(b.id));
  return b ? { ...action, from: b.id } : action;
}
const resources = (s, mp = 0, fuel = 0, mun = 0) =>
  s.mp < mp ? no(`Needs ${mp} MP`) : !(s.fuel >= fuel) && fuel ? no(`Needs ${fuel} fuel`) :
  !(s.mun >= mun) && mun ? no(`Needs ${mun} munitions`) : yes();

// Reads only the player's snapshot. Queued recruits count toward both limits.
export function availability(s, cfg = CFG, action = {}) {
  if (!s) return no('Waiting for the army');
  if (action.watching || s.out?.[action.slot]) return no('You are spectating');
  const own = snapshotUnits(s).filter((v) => v.owner === action.slot), queued = own.flatMap((v) => v.queue);
  const selected = own.filter((v) => (action.ids ?? []).includes(v.id));
  const classic = ['classic', 'world'].includes(s.mode?.kind), sudden = classic && s.mode.suddenDeath, skirmish = isSkirmishBaseMode(s);
  const baseView = { ...s, units: snapshotUnits(s), players: (action.teams ?? []).map(team => ({ team })) };
  const facilities = baseView.units.filter(v => productionAccess(baseView, v, action.slot));
  const population = (unit, need = unit ? popUse(unit) : 1) => {
    const pop = popTotal(own, queued), cap = s.world?.cap ?? popCap(s);
    return pop + need > cap ? no(`Army at its limit (${pop}/${cap})`) : yes();
  };
  if (action.t === 'cancelProduction') {
    if (sudden) return no(DENY_SENTENCES.suddenDeath);
    const jobs = (s.productionJobs ?? []).find(row => row[0] === action.id)?.[1] ?? [];
    return own.some(v => v.id === action.id && v.built >= 1) && jobs.some(job => job.id === action.job && job.status === 'waiting') ? yes() : no(DENY_SENTENCES.notWaiting);
  }
  if (action.t === 'buy') {
    const def = UNITS[action.unit];
    if (!def || def.structure || (def.classic && !classic)) return no('Unavailable in this mode');
    if (def.naval && !action.naval) return no('Needs a map with a sea');
    if (s.tech && tierOf(action.unit) > s.tech.tier) return no(`Needs ${TIER_NAMES[tierOf(action.unit)]}`);
    const price = priceOf(s, action.unit), money = resources(s, price.mp, price.fuel);
    if (!money.ok) return money;
    const pop = population(action.unit); if (!pop.ok) return pop;
    if (own.filter((v) => v.type === action.unit).length + queued.filter((t) => t === action.unit).length >= (def.max ?? Infinity)) return no('Maximum of this unit reached');
    if (classic || skirmish) {
      if (sudden) return no(DENY_SENTENCES.suddenDeath);
      const makers = skirmish ? productionBuildings(baseView, action.slot, action.unit) : own.filter((v) => v.built >= 1 && UNITS[v.type].makes?.includes(action.unit));
      if (!makers.length) {
        const type = Object.keys(UNITS).find((t) => UNITS[t].makes?.includes(action.unit));
        return no(`Needs a ${UNITS[type]?.name ?? 'Production Building'}`);
      }
      // a card on a selected building asks that building (`from`); the server refuses a full one rather than using another
      if (!makers.some((v) => (skirmish || v.queue.length < 5) && (action.from === undefined || v.id === action.from))) return no(skirmish ? 'Selected building cannot produce this unit' : DENY_SENTENCES.queueFull);
    }
    return yes();
  }
  if (action.t === 'support') {
    const cd = s.sup?.[action.kind] ?? 0;
    if (cd > 0) return no(`Cooldown ${cooldownSeconds(cd)} s`);
    const { cur, cost } = supCost(s, action.kind), money = resources(s, cur === 'mp' ? cost : 0, 0, cur === 'mun' ? cost : 0);
    if (!money.ok) return money;
    return action.kind === 'para' ? population(null, dropPop('para')) : yes();
  }
  if (action.t === 'build') {
    if (!buildKinds(classic, skirmish).includes(action.kind) || (action.kind === 'armory' && !s.tech)) return no('Unavailable in this mode');
    if (s.tech && tierOf(action.kind) > s.tech.tier) return no(`Needs ${TIER_NAMES[tierOf(action.kind)]}`);
    if (sudden) return no(DENY_SENTENCES.suddenDeath);
    const crew = selected.filter((v) => builderTypes(classic).includes(v.type));
    if (!crew.length) return no(DENY_SENTENCES.noBuilders);
    if (crew.every((v) => v.flags & 1)) return no(DENY_SENTENCES.retreating);
    const def = UNITS[action.kind], money = resources(s, def.cost); if (!money.ok) return money;
    if (def.needs && !facilities.some((v) => v.type === def.needs && v.built >= 1 && v.hp > 0)) return no(`Needs a ${UNITS[def.needs].name}`);
    return yes();
  }
  if (action.t === 'tech') {
    const t = s.tech, cost = t && techCost(t, action.kind, classic), armory = action.kind !== 'tier';
    if (!t) return no('Unavailable in this mode');
    if (sudden) return no(DENY_SENTENCES.suddenDeath);
    if (!cost) return no('Fully researched');
    if (t.lab.some(([k]) => k === action.kind)) return no('Already researching');
    if (armory && t.armory[action.kind] >= t.tier) return no(`Needs ${TIER_NAMES[t.tier + 1]}`);
    const labs = facilities.filter(v => v.type === (armory ? 'armory' : 'hq') && v.built >= 1 && v.hp > 0).length;
    if (!labs) return no(`Needs a finished ${armory ? 'Armory' : 'HQ'}`);
    if (armory && t.lab.filter(([k]) => k !== 'tier').length >= labs) return no('Each Armory researches one line at a time');
    return resources(s, cost.mp, 0, cost.mun);
  }
  if (action.t === 'dig') {
    const crew = selected.filter((v) => cfg.fortBuilders.includes(v.type));
    if (!crew.length) return no(DENY_SENTENCES.noBuilders);
    if (crew.every((v) => v.flags & 1)) return no(DENY_SENTENCES.retreating);
    return action.queue ? yes() : resources(s, FORTS[action.kind].cost); // a queued dig is paid when it starts
  }
  if (action.t === 'entrench') {
    // nothing is paid up front: each digger pays for its segment as it starts
    const crew = selected.filter((v) => cfg.fortBuilders.includes(v.type));
    if (!crew.length) return no(DENY_SENTENCES.noBuilders);
    return crew.every((v) => v.flags & 1) ? no(DENY_SENTENCES.retreating) : yes();
  }
  if (action.t === 'stance') return selected.some((v) => !UNITS[v.type].structure) ? yes() : no('Select a unit');
  if (action.t === 'cover') {
    const squads = selected.filter((v) => UNITS[v.type].infantry);
    if (!squads.length) return no('Select an infantry squad');
    return squads.every((v) => v.flags & 1) ? no(DENY_SENTENCES.retreating) : yes();
  }
  if (action.t === 'ability') {
    const crew = selected.filter((v) => v.type === action.unit);
    if (!crew.length) return no('Select a squad');
    const active = crew.filter((v) => !(v.flags & 1));
    if (!active.length) return no(DENY_SENTENCES.retreating);
    if (action.queue === true && ['grenade', 'barrage', 'satchel'].includes(UNITS[action.unit].ab.id)) return yes();
    if (active.every((v) => v.cd > 0)) return no(`Cooldown ${cooldownSeconds(Math.min(...active.map((v) => v.cd)))} s`);
    return resources(s, 0, 0, abCost(s, UNITS[action.unit].ab));
  }
  return yes();
}

// How many of one unit a single Shift purchase can buy right now, up to `want`: what manpower, fuel, the army limit,
// the unit limit and (Classic) the room in the training queues leave. 0 whenever availability() refuses the first one.
// the army limit used: units on the field plus queued ones, Conscripts at their own weight
export const popTotal = (own, queued) => own.reduce((n, v) => n + (UNITS[v.type].structure ? 0 : popUse(v.type)), 0) + queued.reduce((n, t) => n + popUse(t), 0);

export function buyCount(s, cfg, action, want) {
  if (!availability(s, cfg, action).ok) return 0;
  const def = UNITS[action.unit], price = priceOf(s, action.unit), classic = ['classic', 'world'].includes(s.mode?.kind);
  const own = snapshotUnits(s).filter((v) => v.owner === action.slot), queued = own.flatMap((v) => v.queue);
  const pop = popTotal(own, queued);
  const have = own.filter((v) => v.type === action.unit).length + queued.filter((t) => t === action.unit).length;
  const room = own.filter((v) => v.built >= 1 && UNITS[v.type].makes?.includes(action.unit) && (action.from === undefined || v.id === action.from))
    .reduce((n, v) => n + Math.max(0, 5 - v.queue.length), 0);
  return Math.max(0, Math.min(want, price.mp ? Math.floor(s.mp / price.mp) : want, price.fuel ? Math.floor((s.fuel ?? 0) / price.fuel) : want,
    Math.floor(((s.world?.cap ?? popCap(s)) - pop) / popUse(action.unit)), (def.max ?? Infinity) - have, classic ? room : want));
}

// Adapter for the shared server placement and sight rules, using unsmoothed snapshot positions.
// Ordinary maps are public at match start. World baselines grow only from delivered, discovered cells.
const placementTerrain = new WeakMap();
export function rememberPlacementTerrain(map, cells = []) {
  let initial = placementTerrain.get(map);
  if (!initial) {
    initial = {
      chars: map.world ? Array(map.w * map.h).fill('?') : [...map.rows.join('')],
      height: Array.from({ length: map.w * map.h }, (_, c) => map.world ? 0 : levelOf(map.heights?.[Math.floor(c / map.w)]?.[c % map.w] ?? '0')),
    };
    placementTerrain.set(map, initial);
  }
  if (map.world) for (const [c, ch, lv, , data] of cells) {
    if (initial.chars[c] !== '?') continue;
    initial.chars[c] = data?.initial?.[0] ?? (ch === 'N' ? composeWorldCell(data?.ground ?? '.', data?.object ?? '.') : ch);
    initial.height[c] = data?.initial?.[1] ?? lv ?? 0;
  }
  return initial;
}

export function placementState(s, map, grid, teams, layers) {
  const chars = grid.flat(), w = map.w, h = map.h, us = snapshotUnits(s), authored = worldLayers(map), ground = layers?.groundGrid?.flat() ?? authored.ground, objects = layers?.objectGrid?.flat() ?? authored.objects;
  const g = { w, h, chars, ground, objects, mode: s.mode, logisticsEnabled: s.logistics?.enabled === true, logisticsEnabled: s.logistics?.enabled === true, world: s.world ? { regions: s.world.regions } : undefined, naval: map.naval === true, flags: chars.map((ch, c) => TERRAIN[ch === 'N' ? composeWorldCell(ground[c], objects[c]) : ch] ?? 0),
    height: Array.from({ length: w * h }, (_, c) => levelOf(map.heights?.[Math.floor(c / w)]?.[c % w] ?? '0')),
    smokes: (s.smokes ?? []).map(([x, z, r]) => ({ x, z, r })),
    units: new Map(us.map((v) => [v.id, v])), players: teams.map((team) => ({ team })),
    nodes: (s.nodes ?? []).map(([x, z]) => ({ x, z, c: (Math.floor(z / CELL) - 1) * w + Math.floor(x / CELL) - 1,
      depot: us.find((v) => v.type === 'depot' && Math.hypot(v.x - x, v.z - z) < 1)?.id ?? 0 })),
  };
  g.initialTerrain = rememberPlacementTerrain(map, s.cells);
  return { game: g, sees: (slot, at) => teamSees(g, teams[slot] ?? slot, at) };
}
