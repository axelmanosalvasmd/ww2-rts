// One concern gets attention. Minimap positions and delivered alerts tell the commander where to look.
import { CELL, UNITS, CFG, SUPPORT, supCost, popUse, abCost } from './sim.js';
import { random } from './ai-rng.js';
import { HUMAN_SKILLS } from './ai-hands.js';
import { recordPerceptionEvent, onScreen, cameraFootprint } from './ai-perception.js';
import { insideKnownRegion } from './world-territories.js';

const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const next = rng => typeof rng === 'function' ? rng() : rng?.next ? rng.next() : Number.isFinite(rng?.state) ? random(rng) : 0.5;
const at = dot => ({ x: dot.x, z: dot.z });
const idleUnit = unit => !unit.retreating && !unit.path.length && !unit.orders.length
  && !unit.targetId && !unit.attackId && !unit.amove && !unit.dig && !unit.build
  && !unit.nade && !unit.entrench && unit.enter < 0 && unit.fireAt < 0;
export const SUPPORT_RESERVES = Object.freeze({
  easy: Object.freeze({ supReserve: 250, munReserve: 40 }),
  normal: Object.freeze({ supReserve: 100, munReserve: 0 }),
  hard: Object.freeze({ supReserve: 100, munReserve: 0 }),
});

// These are delivered identities and remembered inspection results, never inferred queue progress.
export function productionStatus(view, slot) {
  const own = [...view.units.values()].filter(unit => unit.owner === slot);
  const classic = ['classic', 'world'].includes(view.mode?.kind);
  return {
    roster: own.map(unit => `${unit.id}:${unit.type}`).sort().join(','),
    producers: own.filter(unit => UNITS[unit.type].makes).map(unit =>
      `${unit.id}:${unit.inventoryOnly ? '?' : unit.built >= 1 ? 'ready' : 'site'}:${unit.inventoryOnly ? '?' : unit.queue?.length ?? 0}`).sort().join(','),
    pop: own.filter(unit => !UNITS[unit.type].structure).reduce((sum, unit) => sum + popUse(unit.type), 0),
    cap: view.world?.cap ?? (classic ? CFG.classic.popCap : CFG.popCap) * (view.army?.pop ?? 1),
  };
}

export function productionDeferred(view, slot, production) {
  if (!production?.readiness || !Number.isFinite(production.requiredMP) || production.proposedBuys || production.queuedBuys
    || !['unaffordable', 'building-reserve', 'mp', 'fuel', 'pop', 'max', 'needs', 'queueFull'].includes(production.reason)
    || view.tick - production.tick >= 600) return false;
  const me = view.players[slot], ready = productionStatus(view, slot);
  if (Object.keys(ready).some(key => ready[key] !== production.readiness[key])) return false;
  const mpReady = me.mp >= production.requiredMP, fuelReady = (me.fuel ?? 0) >= production.price.fuel;
  if ((!production.mpReady && mpReady) || (!production.fuelReady && fuelReady)) return false;
  return !['unaffordable', 'building-reserve', 'mp', 'fuel'].includes(production.reason) || !mpReady || !fuelReady;
}

export function affordableSupport(view, slot, level) {
  const me = view.players[slot], reserve = SUPPORT_RESERVES[level] ?? SUPPORT_RESERVES.normal;
  return Object.keys(SUPPORT).some(kind => {
    const { cur, cost } = supCost(view, kind);
    return me.sup?.[kind] <= 0 && me[cur] >= cost + (cur === 'mp' ? reserve.supReserve : reserve.munReserve);
  });
}
// Urgency comes from watched damage and idle nearby squads, independently of scoring populations.
export function screenEventNeedsAttention(event) {
  const danger = event.observedDanger;
  if (!danger) return false;
  if (event.kind === 'screen-contact') return danger.idleOwnUnits?.length > 0;
  return event.kind === 'screen-damage' && !danger.alreadyRetreating && !danger.autoRetreatCovered
    && (danger.lossShare >= .25 || danger.retreatRisk);
}
// Empty visits describe an inspected camera area, rather than one alert or cluster alias.
// Only already delivered screen facts can reopen it before the bounded retry.
function sameCombatArea(area, view, concern, camera) {
  if (!camera || !onScreen(concern, camera, view) || !onScreen(concern, area.camera, view)) return false;
  const old = cameraFootprint(area.camera), current = cameraFootprint(camera);
  // Screen membership of the centre and four interior samples respects yaw, zoom and delivered relief.
  const samples = [camera, ...current.map(corner => ({ x: camera.x + (corner.x - camera.x) * .5,
    z: camera.z + (corner.z - camera.z) * .5 }))];
  const previous = [area.camera, ...old.map(corner => ({ x: area.camera.x + (corner.x - area.camera.x) * .5,
    z: area.camera.z + (corner.z - area.camera.z) * .5 }))];
  return samples.filter(point => onScreen(point, area.camera, view)).length >= 3
    && previous.filter(point => onScreen(point, camera, view)).length >= 3;
}
function abilityOpportunity(view, unit, enemies, level) {
  const def = UNITS[unit.type], ability = def.ab;
  if (!ability || ability.id === 'none' || unit.retreating || unit.dig || unit.build || unit.nade || unit.entrench) return false;
  if (abCost(view, ability) > view.players[unit.owner].mun || unit.cdKnown && unit.cd > 0) return false;
  const target = view.units.get(unit.targetId), full = def.models * def.hpPer;
  if (ability.id === 'grenade') return enemies.some(enemy => UNITS[enemy.type].infantry
    && distance(unit, enemy) <= ability.range + 4 && (enemy.type !== 'rifle' || enemy.cover === 1 || enemy.cover === 2));
  if (ability.id === 'suppress') return !!target && enemies.includes(target);
  if (ability.id === 'ap') return target?.type === 'tank' && enemies.includes(target);
  if (ability.id === 'smoke') {
    const bases = ['classic', 'world'].includes(view.mode?.kind) ? [...view.units.values()].filter(base => base.owner === unit.owner && UNITS[base.type].produces) : null;
    const home = bases ? bases.some(base => distance(unit, base) <= CFG.reinforceRadius) : distance(unit, view.players[unit.owner].spawn) <= CFG.reinforceRadius;
    return unit.hp / full < .5 && !home;
  }
  if (ability.id === 'satchel') return enemies.some(enemy => distance(unit, enemy) <= 20
    && (enemy.garrison >= 0 || !UNITS[enemy.type].infantry));
  if (ability.id === 'ura') return unit.supp >= 50 || !!unit.amove && enemies.some(enemy => distance(unit, enemy) < 30);
  if (ability.id === 'barrage') return enemies.some(enemy => distance(unit, enemy) <= ability.range && enemy.garrison >= 0)
    || level === 'hard' && enemies.filter(enemy => distance(unit, enemy) <= ability.range).some(enemy =>
      enemies.filter(other => distance(unit, other) <= ability.range && distance(enemy, other) <= 8).length >= 3);
  return false;
}
function supportOpportunity(view, slot, kind, own, enemies, level) {
  const friendNear = at => own.some(unit => !UNITS[unit.type].air && distance(unit, at) < 10);
  const cluster = (radius, infantry = false) => enemies.some(enemy => {
    const nearby = enemies.filter(other => distance(enemy, other) <= radius && (!infantry || UNITS[other.type].infantry));
    if (nearby.length < (level === 'hard' ? 3 : 2)) return false;
    const centre = { x: nearby.reduce((sum, other) => sum + other.x, 0) / nearby.length,
      z: nearby.reduce((sum, other) => sum + other.z, 0) / nearby.length };
    return level !== 'hard' || !friendNear(centre);
  });
  if (kind === 'dive') return enemies.some(enemy => ['tank', 'medium', 'tiger', 'churchill', 'flaktrack'].includes(enemy.type));
  if (kind === 'bombing') return enemies.some(enemy => enemy.type === 'tank' || enemy.garrison >= 0);
  if (kind === 'artillery') return cluster(8) || enemies.some(enemy => ['mg', 'at'].includes(enemy.type)
    && (level !== 'hard' || !friendNear(enemy)));
  if (kind === 'strafe') return cluster(10, true);
  if (kind === 'cover') return view.strikes?.some(strike => strike.t > 0 && view.players[strike.owner]?.team !== view.players[slot].team
    && ['strafe', 'bombing', 'dive', 'para'].includes(strike.kind) && own.some(unit => distance(unit, strike) < 25));
  return false;
}
export function emptyCombatFacts(view, slot, concern, camera = view.camera, level = 'normal') {
  const screen = [...view.units.values()].filter(unit => !unit.inventoryOnly && view.screenIds?.has(unit.id)
    && (!camera || onScreen(unit, camera, view)));
  const team = view.players[slot].team;
  const friendly = screen.filter(unit => view.players[unit.owner]?.team === team);
  const enemies = screen.filter(unit => view.players[unit.owner]?.team !== team);
  const threshold = level === 'hard' ? .5 : .35;
  const own = screen.filter(unit => unit.owner === slot && !UNITS[unit.type].structure && !UNITS[unit.type].air).map(unit => {
    const def = UNITS[unit.type], full = def.models * def.hpPer, fraction = unit.hp / full;
    const retreatRisk = fraction < threshold || def.models > 1 && unit.hp <= def.hpPer || unit.supp >= 90 && fraction < .6;
    const ability = abilityOpportunity(view, unit, enemies, level);
    return [unit.id, unit.type, unit.healthBand ?? (fraction > .5 ? 'healthy' : fraction > .25 ? 'hurt' : 'critical'),
      retreatRisk, unit.supp >= 90 ? 'pinned' : unit.supp >= 50 ? 'suppressed' : 'normal',
      idleUnit(unit), !!unit.retreating, unit.garrison >= 0, !!unit.holdPos,
      ability, !!unit.cdKnown && unit.cd <= 0 && ability];
  }).sort((a, b) => a[0] - b[0]);
  const hostile = enemies.map(unit => [unit.id, unit.type, unit.healthBand]).sort((a, b) => a[0] - b[0]);
  const cues = (view.events ?? []).filter(event => {
    if (view.tick - event.tick > 80 || camera && !onScreen(event, camera, view)) return false;
    if (event.source === 'screen') return event.kind === 'screen-damage' && view.screenIds?.has(event.unitId)
      && event.observedDanger?.lossShare >= .25;
    return event.source === 'alert' && ['base', 'air', 'unitLost', 'pointLost'].includes(event.kind);
  }).map(event => event.id).sort();
  const support = Object.keys(SUPPORT).filter(kind => {
    const price = supCost(view, kind), reserve = SUPPORT_RESERVES[level] ?? SUPPORT_RESERVES.normal;
    return supportOpportunity(view, slot, kind, friendly, enemies, level)
      && view.players[slot].sup?.[kind] <= 0 && view.players[slot][price.cur] >= price.cost
      + (price.cur === 'mp' ? reserve.supReserve : reserve.munReserve);
  });
  return JSON.stringify([own, hostile, cues, support]);
}
// Losing a target, a screen member or an expired cue removes options; it does not create a new one.
function combatWorkAppeared(previous, current) {
  const [beforeOwn, beforeHostile, beforeCues, beforeSupport] = JSON.parse(previous);
  const [own, hostile, cues, support] = JSON.parse(current);
  const oldOwn = new Map(beforeOwn.map(row => [row[0], row]));
  for (const row of own) {
    const old = oldOwn.get(row[0]);
    if (!old) { if (row[5] || row[3] && !row[6] || row[9] || row[10]) return true; continue; }
    if (row[1] !== old[1] || row[2] !== old[2] || row[4] !== old[4]
      || row[3] && !old[3] || row[5] && !old[5] || !row[6] && old[6]
      || !row[7] && old[7] || !row[8] && old[8] || row[9] && !old[9] || row[10] && !old[10]) return true;
  }
  const oldHostile = new Map(beforeHostile.map(row => [row[0], row]));
  return hostile.some(row => !oldHostile.has(row[0]) || row[1] !== oldHostile.get(row[0])[1]
      || row[2] !== oldHostile.get(row[0])[2])
    || cues.some(id => !beforeCues.includes(id)) || support.some(kind => !beforeSupport.includes(kind));
}
function combatAreas(state, tick) {
  const areas = state.emptyCombatAreas ??= new Map();
  for (const [id, area] of areas) if (tick - area.tick > 600) areas.delete(id);
  return areas;
}
export function deferEmptyCombat(view, slot, state, concern, tick, level) {
  if (concern.kind !== 'combat') return false;
  const camera = state.camera ?? view.camera;
  // A coarse off-camera concern has not been inspected, so it cannot suppress another screen.
  if (!camera || !onScreen(concern, camera, view)) return false;
  const areas = combatAreas(state, tick), visits = state.emptyCombatVisits ??= new Map();
  for (const [id, visit] of visits) if (tick - visit.tick > 600) visits.delete(id);
  const old = [...areas.values()].find(area => sameCombatArea(area, view, concern, camera));
  const facts = emptyCombatFacts(view, slot, concern, camera, level);
  const count = old && !combatWorkAppeared(old.facts, facts) ? old.count + 1 : 1;
  const retryAt = count >= 2 ? tick + ({ easy: 160, normal: 100, hard: 60 }[level] ?? 100) : tick;
  const id = old?.id ?? (state.emptyCombatAreaSerial = (state.emptyCombatAreaSerial ?? 0) + 1);
  const area = { id, camera: { ...(old?.camera ?? camera) }, facts, count, tick, retryAt, level };
  areas.set(id, area); visits.set(concern.id, { facts, count, tick, retryAt, area: id });
  while (areas.size > 12) areas.delete(areas.keys().next().value);
  return count >= 2;
}
export function emptyCombatDeferred(view, slot, state, concern) {
  if (concern.kind !== 'combat') return false;
  const camera = state.camera ?? view.camera;
  if (!camera) return false;
  return [...combatAreas(state, view.tick).values()].some(area => view.tick < area.retryAt
    && sameCombatArea(area, view, concern, camera)
    && !combatWorkAppeared(area.facts, emptyCombatFacts(view, slot, concern, camera, area.level)));
}
const limits = skill => {
  const level = typeof skill === 'string' ? skill : skill?.name ?? skill?.level ?? (skill?.noise === 1 ? 'easy' : skill?.noise === 0.2 ? 'hard' : 'normal');
  const defaults = level === 'easy' ? { capacity: 2, dwell: 100, noise: 18, slip: 0.5 }
    : level === 'hard' ? { capacity: 4, dwell: 45, noise: 5, slip: 0.15 } : { capacity: 3, dwell: 70, noise: 10, slip: 0.3 };
  const profile = typeof skill === 'object' && skill ? skill : HUMAN_SKILLS[level] ?? HUMAN_SKILLS.normal;
  return { ...defaults, level, capacity: typeof profile.concerns === 'number' ? profile.concerns : defaults.capacity, range: Array.isArray(profile.concerns) ? profile.concerns : HUMAN_SKILLS.normal.concerns };
};

function clusterFights(perception, slot, state, ownDots, home, tick) {
  const team = perception.players[slot].team;
  const contacts = perception.minimap.filter(dot => perception.players[dot.owner]?.team !== team
    && (ownDots.some(own => distance(own, dot) < 45) || distance(dot, home) < 55));
  const remaining = contacts.map(dot => ({ ...at(dot), owner: dot.owner })), groups = [];
  while (remaining.length) {
    const group = [remaining.shift()];
    for (let i = 0; i < group.length; i++) for (let j = remaining.length - 1; j >= 0; j--)
      if (distance(group[i], remaining[j]) <= 36) group.push(remaining.splice(j, 1)[0]);
    groups.push(group);
  }
  const remembered = state.fightClusters ??= new Map(), used = new Set(), live = [];
  for (const [id, cluster] of remembered) if (tick - cluster.lastSeen > 120) remembered.delete(id);
  for (const group of groups) {
    const center = { x: group.reduce((sum, dot) => sum + dot.x, 0) / group.length, z: group.reduce((sum, dot) => sum + dot.z, 0) / group.length };
    let cluster = [...remembered.values()].filter(old => !used.has(old.id) && distance(old, center) <= 45)
      .sort((a, b) => distance(a, center) - distance(b, center) || a.id.localeCompare(b.id))[0];
    if (!cluster) {
      const id = `fight:${state.fightSerial = (state.fightSerial ?? 0) + 1}`;
      const event = { id: `${id}:contact`, kind: 'minimap-contact', source: 'minimap', onScreen: false, tick, ...center,
        provenance: 'coarse-cluster-near-friendly' };
      recordPerceptionEvent(state, event);
      perception.events ??= []; perception.events.push({ ...event });
      perception.newEvents ??= []; perception.newEvents.push({ ...event });
      cluster = { id, since: tick, eventId: event.id }; remembered.set(id, cluster);
    }
    Object.assign(cluster, center, { count: group.length, lastSeen: tick }); used.add(cluster.id); live.push(cluster);
  }
  return live;
}

function workingConcerns(ranked, attention, state, tune, tick) {
  const working = attention.working ??= new Map(), waiting = attention.waiting ??= new Map();
  const currentIds = new Set(ranked.map(candidate => candidate.id));
  for (const id of waiting.keys()) if (!currentIds.has(id)) waiting.delete(id);
  for (const id of working.keys()) if (!currentIds.has(id)) working.delete(id);
  for (const candidate of ranked) {
    const old = working.get(candidate.id);
    if (old) working.set(candidate.id, { ...candidate, rememberedAt: old.rememberedAt });
    else if (!waiting.has(candidate.id)) waiting.set(candidate.id, tick);
  }
  const newcomers = ranked.filter(candidate => !working.has(candidate.id)).map(candidate => ({ ...candidate,
    score: candidate.score + Math.min(25, (tick - (waiting.get(candidate.id) ?? tick)) / 40) }));
  for (const candidate of newcomers) {
    if (working.size < tune.capacity) { working.set(candidate.id, { ...candidate, rememberedAt: tick }); waiting.delete(candidate.id); continue; }
    const lowest = [...working.values()].filter(old => old.id !== attention.current?.id || tick >= attention.until || candidate.urgency >= 90)
      .sort((a, b) => a.score - b.score || a.id.localeCompare(b.id))[0];
    if (lowest && (candidate.urgency >= 90 ? candidate.score > lowest.score : candidate.score > lowest.score + 12)) {
      working.delete(lowest.id); waiting.set(lowest.id, tick);
      working.set(candidate.id, { ...candidate, rememberedAt: tick }); waiting.delete(candidate.id);
    }
  }
  // Only remembered concerns compete for the next visit. Waiting concerns contain an age, not detailed observations.
  state.concerns = [...working.values()].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return state.concerns;
}

export function chooseConcern(perception, slot, state, skill, rng) {
  const me = perception.players[slot], tick = perception.tick, tune = limits(skill);
  if (tune.range) tune.capacity = state.concernCapacity ??= tune.range[0] + Math.floor(next(rng) * (tune.range[1] - tune.range[0] + 1));
  const attention = state.attention ??= { visits: new Map(), since: tick, until: tick, current: null };
  if (attention.current && tick >= attention.until) attention.visits.set(attention.current.id, tick);
  const candidates = new Map(), home = me.spawn ?? perception.camera;
  const add = candidate => {
    if (!Number.isFinite(candidate.x) || !Number.isFinite(candidate.z)
      || emptyCombatDeferred(perception, slot, state, candidate)) return;
    const old = candidates.get(candidate.id);
    if (!old || old.urgency < candidate.urgency) candidates.set(candidate.id, candidate);
  };
  const stimuli = (perception.events ?? perception.alerts ?? []).filter(event => !state.answeredEvents?.has(event.id));
  for (const event of stimuli) {
    if (event.source === 'minimap' || tick - event.tick > 240 || event.x == null) continue;
    const screen = event.source === 'screen';
    const monitoring = screen && !screenEventNeedsAttention(event);
    const danger = screen || ['base', 'air', 'unitLost', 'attack', 'pointLost'].includes(event.kind);
    const kind = danger ? 'combat' : event.kind === 'ready' ? 'production' : 'expansion';
    add({ id: `${screen ? 'stimulus' : 'alert'}:${event.id}`, kind, ...at(event),
      urgency: (monitoring ? 52 : event.kind === 'base' ? 110 : event.kind === 'screen-damage' ? 103 : screen ? 92 : danger ? 80 : 30) - (tick - event.tick) / 10,
      event: event.kind, eventId: event.id, eventTick: event.tick, eventOnScreen: !!event.onScreen,
      ...(event.observedDanger && { observedDanger: structuredClone(event.observedDanger) }),
      ...(event.unitId !== undefined && { unitId: event.unitId }), ...(event.targetId !== undefined && { targetId: event.targetId }) });
  }
  const ownDots = perception.minimap.filter(dot => dot.owner === slot);
  const still = state.ownStill ??= new Map();
  const ownIds = new Set(ownDots.map(dot => dot.id));
  for (const id of still.keys()) if (!ownIds.has(id)) still.delete(id);
  for (const dot of ownDots) {
    const old = still.get(dot.id);
    if (!old || distance(old, dot) > 4) still.set(dot.id, { ...at(dot), since: tick });
  }
  const enemies = perception.minimap.filter(dot => perception.players[dot.owner]?.team !== me.team);
  const fights = clusterFights(perception, slot, state, ownDots, home, tick);
  for (const cluster of fights) add({ id: cluster.id, kind: 'combat', ...at(cluster),
    urgency: 52 + Math.min(20, cluster.count * 4), contacts: cluster.count,
    event: 'minimap-contact', eventId: cluster.eventId, eventTick: cluster.since, eventOnScreen: false });
  const productionAge = tick - (attention.visits.get('production') ?? 0);
  const productionRate = (typeof skill === 'string' ? skill : skill?.name ?? skill?.level) === 'hard' ? 3
    : (typeof skill === 'string' ? skill : skill?.name ?? skill?.level) === 'easy' ? 0.7 : 1.5;
  const deferProduction = productionDeferred(perception, slot, state.production);
  if (!deferProduction) add({ id: 'production', kind: 'production', ...at(home), urgency: Math.min(92, 18 + productionAge / 20 * productionRate + Math.max(0, me.mp - 250) / 45) });
  for (const plane of perception.airPanel ?? []) if (plane.state === 'base') {
    const id = `air:${plane.id}`;
    add({ id, kind: 'production', panel: 'air', unitId: plane.id, ...at(home),
      urgency: 35 + Math.min(50, (tick - (attention.visits.get(id) ?? 0)) / 20) });
  }
  for (const [i, point] of perception.points.entries()) {
    if (point.locked || perception.players[point.owner]?.team === me.team) continue;
    add({ id: `point:${point.id ?? i}`, kind: 'expansion', ...at(point), point: i,
      urgency: 27 + Math.min(18, (tick - (attention.visits.get(`point:${point.id ?? i}`) ?? 0)) / 70) - distance(point, home) / 35 });
  }
  const engineers = [...perception.units.values()].filter(unit => unit.owner === slot && unit.type === 'engineer'
    && (!perception.screenIds.has(unit.id) || idleUnit(unit)));
  if (['classic', 'world'].includes(perception.mode?.kind) && engineers.length) {
    for (const [i, node] of perception.nodes.entries()) {
      if (perception.claimedNodes.has(i)) continue;
      if (perception.mode.kind === 'world' && !perception.world?.regions.some(region => region.team === me.team && insideKnownRegion(region, node, CELL))) continue;
      const engineer = [...engineers].sort((a, b) => distance(a, node) - distance(b, node))[0];
      add({ id: `node:${i}`, kind: 'expansion', ...at(node), node: i, unitId: engineer.id,
        urgency: 35 + Math.min(18, (tick - (attention.visits.get(`node:${i}`) ?? 0)) / 55) + (distance(engineer, node) < 20 ? 12 : 0) });
    }
  }
  for (const unit of perception.units.values()) {
    if (unit.owner !== slot || UNITS[unit.type].structure || UNITS[unit.type].air) continue;
    const age = tick - (still.get(unit.id)?.since ?? tick);
    const inspected = perception.screenIds.has(unit.id);
    const idle = inspected && idleUnit(unit);
    // A dot that stops moving may be fighting. Look at it before deciding that it is idle.
    let watchedBridge = null;
    if (idle && CFG.fortBuilders.includes(unit.type)) {
      const x0 = Math.max(0, Math.ceil((unit.x - 24) / CELL - .5));
      const x1 = Math.min(perception.w - 1, Math.floor((unit.x + 24) / CELL - .5));
      const z0 = Math.max(0, Math.ceil((unit.z - 24) / CELL - .5));
      const z1 = Math.min(perception.h - 1, Math.floor((unit.z + 24) / CELL - .5));
      for (let z = z0; z <= z1 && !watchedBridge; z++) for (let x = x0; x <= x1; x++) {
        const cell = z * perception.w + x;
        if (perception.chars[cell] !== 'W' || perception.mapChars[cell] !== '=') continue;
        const spot = { x: (x + .5) * CELL, z: (z + .5) * CELL };
        if (distance(unit, spot) <= 24 && perception.sees(spot) && onScreen(spot, perception.camera, perception)
          && !enemies.some(enemy => distance(enemy, spot) < 35)) { watchedBridge = { cell, ...spot }; break; }
      }
    }
    const idleId = watchedBridge ? `repair:${unit.id}:${watchedBridge.cell}` : `idle:${unit.id}`;
    if (idle || (!inspected && age >= 120))
      add({ id: idleId, kind: 'idle', ...at(unit), unitId: unit.id,
        urgency: watchedBridge ? 89 : 24 + Math.min(tune.capacity >= 4 ? 66 : tune.capacity >= 3 ? 50 : 30,
          (tick - Math.max(still.get(unit.id)?.since ?? tick, attention.visits.get(`idle:${unit.id}`) ?? 0)) / 12) });
  }
  if (enemies.length && affordableSupport(perception, slot, tune.level)) {
    const dot = enemies[0]; add({ id: 'support', kind: 'support', ...at(dot), urgency: 28 });
  }
  if (perception.mode?.kind === 'world') {
    const scouts = [...perception.units.values()].filter(unit => unit.owner === slot && UNITS[unit.type].infantry && unit.type !== 'engineer' && !unit.retreating)
      .sort((a, b) => distance(b, home) - distance(a, home));
    for (const scout of scouts.slice(0, 3)) {
      const frontier = [];
      for (const radius of [12, 24, 40]) for (let direction = 0; direction < 8; direction++) {
        const angle = direction * Math.PI / 4, spot = { x: scout.x + Math.cos(angle) * radius, z: scout.z + Math.sin(angle) * radius };
        const x = Math.floor(spot.x / CELL), z = Math.floor(spot.z / CELL);
        if (x >= 0 && z >= 0 && x < perception.w && z < perception.h && perception.chars[z * perception.w + x] === '?') frontier.push(spot);
      }
      frontier.sort((a, b) => distance(b, home) - distance(a, home));
      if (frontier[0]) add({ id: `scouting:${scout.id}`, kind: 'scouting', ...at(frontier[0]), unitId: scout.id,
        urgency: 28 + Math.min(20, (tick - (attention.visits.get(`scouting:${scout.id}`) ?? 0)) / 60) });
    }
  }
  if (!fights.length && !perception.points.some(point => perception.players[point.owner]?.team !== me.team)) {
    const frontier = perception.players.find(player => player.team !== me.team && !player.out && player.spawn)?.spawn;
    if (frontier) add({ id: 'scouting', kind: 'scouting', ...at(frontier), urgency: 22 });
  }
  const fighting = fights.length > 0 || [...candidates.values()].some(c => c.kind === 'combat');
  // Production keeps aging while a fight occupies attention. A seeded slip delays it for this cycle.
  const slipping = fighting && next(rng) < tune.slip;
  const ranked = [...candidates.values()].map(candidate => ({ ...candidate,
    score: candidate.urgency - (candidate.kind !== 'combat' && slipping ? 28 : 0)
      - Math.max(0, (candidate.kind === 'combat' ? 160 : 60) - (tick - (attention.visits.get(candidate.id) ?? -Infinity))) / (candidate.kind === 'combat' ? 4 : 2) + (next(rng) - 0.5) * tune.noise }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  workingConcerns(ranked, attention, state, tune, tick);
  const current = attention.current && candidates.get(attention.current.id);
  const best = state.concerns[0] ?? (deferProduction
    ? { id: 'observe', kind: 'idle', ...at(perception.camera), urgency: 0 }
    : { id: 'production', kind: 'production', ...at(home), urgency: 0 });
  const emergency = best.kind === 'combat' && best.urgency >= 90 && best.id !== current?.id;
  if (current && tick < attention.until && !emergency) return { ...current, since: attention.since, until: attention.until };
  if (attention.current) attention.visits.set(attention.current.id, tick);
  attention.since = tick; attention.until = tick + Math.round(tune.dwell * (0.75 + next(rng) * 0.5));
  attention.current = { ...best };
  return { ...best, since: attention.since, until: attention.until, slipped: slipping };
}
