// One concern gets attention. Minimap positions and delivered alerts tell the commander where to look.
import { CELL, UNITS } from './sim.js';
import { random } from './ai-rng.js';
import { HUMAN_SKILLS } from './ai-hands.js';
import { recordPerceptionEvent } from './ai-perception.js';
import { insideKnownRegion } from './world-territories.js';

const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const next = rng => typeof rng === 'function' ? rng() : rng?.next ? rng.next() : Number.isFinite(rng?.state) ? random(rng) : 0.5;
const at = dot => ({ x: dot.x, z: dot.z });
const idleUnit = unit => !unit.retreating && !unit.path.length && !unit.orders.length
  && !unit.targetId && !unit.attackId && !unit.amove && !unit.dig && !unit.build
  && !unit.nade && !unit.entrench && unit.enter < 0 && unit.fireAt < 0;
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
    if (!Number.isFinite(candidate.x) || !Number.isFinite(candidate.z)) return;
    const old = candidates.get(candidate.id);
    if (!old || old.urgency < candidate.urgency) candidates.set(candidate.id, candidate);
  };
  const stimuli = (perception.events ?? perception.alerts ?? []).filter(event => !state.answeredEvents?.has(event.id));
  for (const event of stimuli) {
    if (event.source === 'minimap' || tick - event.tick > 240 || event.x == null) continue;
    const screen = event.source === 'screen';
    const monitoring = screen && event.responseRequired === false;
    const danger = screen || ['base', 'air', 'unitLost', 'attack', 'pointLost'].includes(event.kind);
    const kind = danger ? 'combat' : event.kind === 'ready' ? 'production' : 'expansion';
    add({ id: `${screen ? 'stimulus' : 'alert'}:${event.id}`, kind, ...at(event),
      urgency: (monitoring ? 52 : event.kind === 'base' ? 110 : event.kind === 'screen-damage' ? 103 : screen ? 92 : danger ? 80 : 30) - (tick - event.tick) / 10,
      event: event.kind, eventId: event.id, eventTick: event.tick, eventOnScreen: !!event.onScreen,
      ...(event.responsePolicy && { responseRequired: event.responseRequired, responseReason: event.responseReason,
        responsePolicy: event.responsePolicy, responseUnits: [...event.responseUnits] }),
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
  add({ id: 'production', kind: 'production', ...at(home), urgency: Math.min(92, 18 + productionAge / 20 * productionRate + Math.max(0, me.mp - 250) / 45) });
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
    if (idle || (!inspected && age >= 120))
      add({ id: `idle:${unit.id}`, kind: 'idle', ...at(unit), unitId: unit.id,
        urgency: 24 + Math.min(tune.capacity >= 4 ? 66 : tune.capacity >= 3 ? 50 : 30,
          (tick - Math.max(still.get(unit.id)?.since ?? tick, attention.visits.get(`idle:${unit.id}`) ?? 0)) / 12) });
  }
  if (enemies.length && Object.values(me.sup ?? {}).some(cd => cd <= 0)) {
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
  const best = state.concerns[0] ?? { id: 'production', kind: 'production', ...at(home), urgency: 0 };
  const emergency = best.kind === 'combat' && best.urgency >= 90 && best.id !== current?.id;
  if (current && tick < attention.until && !emergency) return { ...current, since: attention.since, until: attention.until };
  if (attention.current) attention.visits.set(attention.current.id, tick);
  attention.since = tick; attention.until = tick + Math.round(tune.dwell * (0.75 + next(rng) * 0.5));
  attention.current = { ...best };
  return { ...best, since: attention.since, until: attention.until, slipped: slipping };
}
