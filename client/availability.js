import { UNITS, FORTS, CFG, TERRAIN, CELL, priceOf, supCost, popCap, popUse, abCost, levelOf, teamSees } from '../shared/sim.js';

// Server denials deliberately contain no target details.
export const DENY_SENTENCES = Object.freeze({
  mp: 'Not enough manpower', mun: 'Not enough munitions', fuel: 'Not enough fuel',
  pop: 'The army is at its limit', cooldown: 'That order is still on cooldown',
  unseen: 'That target is not visible', notVisible: 'That spot is not visible',
  blocked: 'That spot is blocked or uneven', needs: 'The required unit or building is missing',
  max: 'That unit or position is at its limit', suddenDeath: 'Not during Sudden Death',
  queueFull: 'The training queue is full', ordersFull: 'This unit already has 8 queued orders',
  retreating: 'That squad is retreating', noBuilders: 'Select a builder squad',
  noCover: 'No cover within reach',
  coast: 'A Shipyard needs open water beside it', shore: 'Too far from the shore to land',
});
// The server answers queueFull for both a full training queue (buy) and a full order queue (every other command).
export const denySentence = (code, cmd) =>
  DENY_SENTENCES[code === 'queueFull' && cmd && cmd !== 'buy' ? 'ordersFull' : code] ?? 'That order cannot happen';
// The one rounding for every cooldown the player reads (reason sentences and button labels): whole seconds, rounded up.
export const cooldownSeconds = (cd) => Math.max(0, Math.ceil(cd));
const yes = () => ({ ok: true, reason: '' });
const no = (reason) => ({ ok: false, reason });
export const snapshotUnits = (s) => (s?.units ?? []).map((v) => ({
  id: v[0], type: v[1], owner: v[2], x: v[3], z: v[4], cd: v[11], flags: v[12], built: v[14] ?? 1,
  queue: (s.queues ?? []).find((q) => q[0] === v[0])?.slice(4) ?? [],
}));
const resources = (s, mp = 0, fuel = 0, mun = 0) =>
  s.mp < mp ? no(`Needs ${mp} MP`) : !(s.fuel >= fuel) && fuel ? no(`Needs ${fuel} fuel`) :
  !(s.mun >= mun) && mun ? no(`Needs ${mun} munitions`) : yes();

// Reads only the player's snapshot. Queued recruits count toward both limits.
export function availability(s, cfg = CFG, action = {}) {
  if (!s) return no('Waiting for the army');
  const own = snapshotUnits(s).filter((v) => v.owner === action.slot), queued = own.flatMap((v) => v.queue);
  const selected = own.filter((v) => (action.ids ?? []).includes(v.id));
  const classic = s.mode?.kind === 'classic', sudden = classic && s.mode.suddenDeath;
  const population = (unit) => {
    const pop = popTotal(own, queued), cap = popCap(s);
    return pop + (unit ? popUse(unit) : 1) > cap ? no(`Army at its limit (${pop}/${cap})`) : yes();
  };
  if (action.t === 'buy') {
    const def = UNITS[action.unit];
    if (!def || def.structure || (def.classic && !classic)) return no('Unavailable in this mode');
    if (def.naval && !action.naval) return no('Needs a map with a sea');
    const price = priceOf(s, action.unit), money = resources(s, price.mp, price.fuel);
    if (!money.ok) return money;
    const pop = population(action.unit); if (!pop.ok) return pop;
    if (own.filter((v) => v.type === action.unit).length + queued.filter((t) => t === action.unit).length >= (def.max ?? Infinity)) return no('Maximum of this unit reached');
    if (classic) {
      if (sudden) return no(DENY_SENTENCES.suddenDeath);
      const makers = own.filter((v) => v.built >= 1 && UNITS[v.type].makes?.includes(action.unit));
      if (!makers.length) {
        const type = Object.keys(UNITS).find((t) => UNITS[t].makes?.includes(action.unit));
        return no(`Needs a ${UNITS[type]?.name ?? 'Production Building'}`);
      }
      // a card on a selected building asks that building (`from`); the server refuses a full one rather than using another
      if (!makers.some((v) => v.queue.length < 5 && (action.from === undefined || v.id === action.from))) return no(DENY_SENTENCES.queueFull);
    }
    return yes();
  }
  if (action.t === 'support') {
    const cd = s.sup?.[action.kind] ?? 0;
    if (cd > 0) return no(`Cooldown ${cooldownSeconds(cd)} s`);
    const { cur, cost } = supCost(s, action.kind), money = resources(s, cur === 'mp' ? cost : 0, 0, cur === 'mun' ? cost : 0);
    if (!money.ok) return money;
    return action.kind === 'para' ? population() : yes();
  }
  if (action.t === 'build') {
    if (!classic) return no('Unavailable in this mode');
    if (sudden) return no(DENY_SENTENCES.suddenDeath);
    const crew = selected.filter((v) => v.type === 'engineer');
    if (!crew.length) return no(DENY_SENTENCES.noBuilders);
    if (crew.every((v) => v.flags & 1)) return no(DENY_SENTENCES.retreating);
    const def = UNITS[action.kind], money = resources(s, def.cost); if (!money.ok) return money;
    if (def.needs && !own.some((v) => v.type === def.needs && v.built >= 1)) return no(`Needs a ${UNITS[def.needs].name}`);
    return yes();
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
  const def = UNITS[action.unit], price = priceOf(s, action.unit), classic = s.mode?.kind === 'classic';
  const own = snapshotUnits(s).filter((v) => v.owner === action.slot), queued = own.flatMap((v) => v.queue);
  const pop = popTotal(own, queued);
  const have = own.filter((v) => v.type === action.unit).length + queued.filter((t) => t === action.unit).length;
  const room = own.filter((v) => v.built >= 1 && UNITS[v.type].makes?.includes(action.unit) && (action.from === undefined || v.id === action.from))
    .reduce((n, v) => n + Math.max(0, 5 - v.queue.length), 0);
  return Math.max(0, Math.min(want, price.mp ? Math.floor(s.mp / price.mp) : want, price.fuel ? Math.floor((s.fuel ?? 0) / price.fuel) : want,
    Math.floor((popCap(s) - pop) / popUse(action.unit)), (def.max ?? Infinity) - have, classic ? room : want));
}

// Adapter for the shared server placement and sight rules, using unsmoothed snapshot positions.
export function placementState(s, map, grid, teams) {
  const chars = grid.flat(), w = map.w, h = map.h, us = snapshotUnits(s);
  const g = { w, h, chars, naval: map.naval === true, flags: chars.map((ch) => TERRAIN[ch] ?? 0),
    height: Array.from({ length: w * h }, (_, c) => levelOf(map.heights?.[Math.floor(c / w)]?.[c % w] ?? '0')),
    smokes: (s.smokes ?? []).map(([x, z, r]) => ({ x, z, r })),
    units: new Map(us.map((v) => [v.id, v])), players: teams.map((team) => ({ team })),
    nodes: (s.nodes ?? []).map(([x, z]) => ({ x, z, c: (Math.floor(z / CELL) - 1) * w + Math.floor(x / CELL) - 1,
      depot: us.find((v) => v.type === 'depot' && Math.hypot(v.x - x, v.z - z) < 1)?.id ?? 0 })),
  };
  return { game: g, sees: (slot, at) => teamSees(g, teams[slot] ?? slot, at) };
}
