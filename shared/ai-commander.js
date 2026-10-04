// Perceive one view, attend one concern, deliberate, then let the hands finish before choosing again.
import { CELL, UNITS } from './sim.js';
import { perceive, onScreen, startCamera } from './ai-perception.js';
import { chooseConcern } from './ai-attention.js';
import { createHands, advanceHands, interruptHands, enqueueDecision, queueCamera, groundClickable } from './ai-hands.js';
import { random, between } from './ai-rng.js';
import { personaFor, estimateSightings, optionBias } from './ai-persona.js';

const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const movement = cmd => cmd.t === 'move' || cmd.t === 'amove';
const economy = cmd => ['buy', 'build', 'recover', 'assist'].includes(cmd.t);
const fortification = cmd => ['dig', 'entrench'].includes(cmd.t);
const idsOf = cmd => cmd.ids ?? cmd.orders?.map(order => order[0]) ?? [];
const anchorOf = cmd => cmd.orders?.length ? {
  x: cmd.orders.reduce((sum, row) => sum + row[1], 0) / cmd.orders.length,
  z: cmd.orders.reduce((sum, row) => sum + row[2], 0) / cmd.orders.length,
} : Number.isFinite(cmd.x) ? cmd : null;
const eventRank = event => event.kind === 'base' ? 110 : event.kind === 'screen-damage' ? 103
  : event.kind === 'screen-contact' ? 92 : event.kind === 'air' || event.kind === 'attack' || event.kind === 'unitLost' ? 80 : 0;
function blockedPlacement(cmd, camera, view) {
  if (!['dig', 'entrench', 'build', 'support', 'ability', 'fireat'].includes(cmd.t) || !Number.isFinite(cmd.x)) return null;
  const points = [cmd];
  if (Number.isFinite(cmd.x2)) points.push({ x: cmd.x2, z: cmd.z2 });
  return points.find(point => !groundClickable(point, camera, view)) ?? null;
}

function placementCamera(cmd, target, camera, view) {
  const yaw = camera.yaw ?? 0, s = Math.sin(yaw), c = Math.cos(yaw);
  const actors = idsOf(cmd).map(id => view.units.get(id)).filter(Boolean);
  const candidates = [];
  // A pit's floor may only be visible lower in the frame, even when its centre is on screen.
  for (const forward of [0, 8, 16, 24, 32]) for (const side of [0, -8, 8, -16, 16]) {
    const at = { ...camera,
      x: Math.min(view.w * CELL - 1, Math.max(1, target.x - s * forward + c * side)),
      z: Math.min(view.h * CELL - 1, Math.max(1, target.z - c * forward - s * side)) };
    if (distance(at, camera) >= 2 && !blockedPlacement(cmd, at, view)
      && actors.every(unit => onScreen(unit, at, view))) candidates.push(at);
  }
  return candidates.sort((a, b) => distance(a, camera) - distance(b, camera))[0] ?? null;
}

function servesEvent(cmd, event, view, slot) {
  if (!event || economy(cmd) || fortification(cmd)) return false;
  const ids = idsOf(cmd), own = ids.map(id => view.units.get(id)).filter(unit => unit?.owner === slot);
  const eligible = event.responseUnits ?? (event.unitId != null ? [event.unitId] : []);
  const at = anchorOf(cmd), target = view.units.get(cmd.target);
  if (cmd.t === 'support') return at && distance(at, event) <= 24;
  if (eligible.length && !ids.some(id => eligible.includes(id))) return false;
  if (cmd.t === 'ability' && at) return distance(at, event) <= 24;
  if (['retreat', 'ability', 'stance', 'cover', 'stop'].includes(cmd.t))
    return own.some(unit => distance(unit, event) <= 24 || unit.id === event.unitId);
  if (cmd.t === 'attack') return target && distance(target, event) <= 24;
  return movement(cmd) && at && distance(at, event) <= 24 && own.some(unit => distance(unit, event) <= 48);
}

function mergeMovements(intents, view) {
  const merged = [];
  const support = new Set(['mg', 'at', 'mortar', 'howitzer', 'rocket', 'flak']);
  const role = cmd => idsOf(cmd).every(id => support.has(view.units.get(id)?.type)) ? 'support' : 'line';
  for (const cmd of intents) {
    const at = anchorOf(cmd);
    const batch = movement(cmd) && merged.find(old => old.t === cmd.t && !!old.queue === !!cmd.queue
      && old.orders.length + cmd.orders.length <= 8 && role(old) === role(cmd) && distance(anchorOf(old), at) <= 10
      && [...idsOf(old), ...idsOf(cmd)].every(id => !view.units.get(id)?.air));
    if (batch) batch.orders.push(...cmd.orders);
    else merged.push(movement(cmd) ? { ...cmd, orders: cmd.orders.map(row => [...row]) } : cmd);
  }
  return merged;
}

function cameraTarget(view, concern, slot) {
  if (concern.panel === 'air') return view.players[slot].spawn;
  if (concern.unitId != null) {
    const unit = view.units.get(concern.unitId);
    if (unit?.owner === slot) return unit;
  }
  if (!['expansion', 'scouting'].includes(concern.kind)) return concern;
  // A remote objective is a minimap order. First look at the squad that will receive it.
  const candidates = [...view.units.values()].filter(u => u.owner === slot && !UNITS[u.type].structure
    && !u.air && !u.retreating && !u.targetId && !u.dig && !u.build && !u.path.length
    && !u.amove && !u.inventoryOnly);
  const engineer = candidates.find(u => u.type === 'engineer');
  const unit = (view.mode?.kind === 'classic' || view.mode?.kind === 'world') && engineer && concern.kind === 'expansion'
    ? engineer : candidates.filter(u => u.type !== 'engineer').sort((a, b) => distance(a, concern) - distance(b, concern))[0];
  return unit ?? concern;
}

function contextFor(view, concern, state) {
  const eventId = concern.eventId ?? concern.id;
  const answered = state.answeredEvents?.has(eventId);
  const event = answered ? null : concern.event ?? (concern.kind === 'combat' ? 'contact' : null);
  let eventTick = concern.eventTick;
  if (eventTick == null && event) {
    state.eventClocks ??= new Map();
    if (!state.eventClocks.has(concern.id)) state.eventClocks.set(concern.id, view.tick);
    eventTick = state.eventClocks.get(concern.id);
  }
  const recorded = (view.events ?? []).find(candidate => candidate.id === eventId);
  return { concern: concern.id, concernKind: concern.kind, concernTarget: { x: concern.x, z: concern.z },
    concernUnitId: concern.unitId, priority: concern.urgency ?? 0,
    event: event ? { kind: event, id: eventId,
      source: concern.eventSource ?? (event === 'minimap-contact' ? 'minimap' : concern.id.startsWith('stimulus:') ? 'screen' : 'alert'),
      onScreen: concern.eventOnScreen ?? concern.onScreen ?? onScreen(concern, state.camera, view),
      x: concern.x, z: concern.z, unitId: recorded?.unitId, targetId: recorded?.targetId,
      responseRequired: recorded?.responseRequired, responseUnits: recorded?.responseUnits } : undefined,
    eventTick: event ? eventTick : undefined, reactionStartTick: event ? eventTick : state.decisionStartedTick,
    cycle: state.cycle ?? 0 };
}

export function runCommander(observation, slot, opts, mem, send, plan) {
  if (!observation.players[slot] || observation.players[slot].out || observation.winner != null) return;
  const tick = opts.tick ?? observation.tick, level = opts.level ?? 'normal';
  if (observation.mode?.kind === 'horde' && observation.mode.slot === slot) {
    // The enemy Wave, including its support, remains a fog-fair scripted director. Co-op seats use the human loop.
    if ((tick + slot * 13) % 40 === 0) return plan(observation, slot, opts, mem, send);
    return;
  }
  const state = mem.human ??= { camera: startCamera(observation, slot), startedTick: tick };
  state.camera ??= startCamera(observation, slot);
  const inputLog = opts.inputLog ?? opts.log;
  state.hands ??= createHands({ slot, seed: opts.seed ?? observation.matchSeed ?? 1, level, camera: state.camera,
    log: inputLog, calibration: opts.calibration, startedTick: tick, handover: opts.handoff || tick >= 30 });
  const hands = state.hands;
  // Only the click dispatcher resolves anonymous enemy dots against the last delivered frame.
  hands.resolveMinimap = (at, radius) => {
    const team = observation.players[slot].team;
    const near = [...observation.units.values()].filter(unit => distance(unit, at) <= radius)
      .sort((a, b) => distance(a, at) - distance(b, at));
    return {
      enemyId: near.find(unit => observation.players[unit.owner]?.team !== team
        && observation.players[slot].visible.has(unit.id))?.id ?? null,
      friendId: near.find(unit => observation.players[unit.owner]?.team === team
        && !UNITS[unit.type].structure && !unit.air)?.id ?? null,
    };
  };
  if (inputLog) hands.log = inputLog;
  mem.rng = hands.rng;
  personaFor(state, hands.rng);
  const cameraKey = `${state.camera.x},${state.camera.z}`;
  if (!state.view || state.deliveredTick !== observation.tick || state.cameraKey !== cameraKey) {
    state.view = perceive(observation, slot, state, tick); state.deliveredTick = observation.tick; state.cameraKey = cameraKey;
  }
  const view = state.view;
  state.interruptEvents ??= new Set();
  const workingPriority = hands.active?.job.context.priority ?? state.concern?.urgency ?? 0;
  const emergency = view.newEvents?.filter(event => !state.interruptEvents.has(event.id)
    && ['base', 'air', 'attack', 'screen-damage', 'screen-contact', 'unitLost'].includes(event.kind))
    .filter(event => eventRank(event) > workingPriority
      && (event.source !== 'screen' || event.responseRequired !== false))
    .sort((a, b) => eventRank(b) - eventRank(a))[0];
  if (emergency) {
    state.interruptEvents.add(emergency.id);
    hands.queue.length = 0;
    interruptHands(hands, tick, view);
    state.pendingEmergency = emergency;
    state.noWorkUntil = 0;
    state.planned = false;
    if (state.attention) state.attention.until = tick;
    const candidate = chooseConcern({ ...view, tick }, slot, state, level, hands.rng);
    state.concern = candidate;
    state.decisionStartedTick = tick;
    state.deliberateUntil = tick + (emergency.onScreen
      ? ({ easy: 10, normal: 5, hard: 2 }[level] ?? 5)
      : ({ easy: 20, normal: 10, hard: 6 }[level] ?? 10));
  }
  const liveEvents = new Set((state.events ?? []).map(event => event.id));
  for (const id of state.interruptEvents) if (!liveEvents.has(id)) state.interruptEvents.delete(id);
  const fired = advanceHands(hands, tick, view, cmd => {
    const result = send(cmd);
    if (result === undefined && movement(cmd)) for (const row of cmd.orders ?? []) {
      const old = state.orderHistory?.get(row[0]);
      const previous = [...(old?.previous ?? []), ...(old ? [{ tick: old.tick, x: old.x, z: old.z }] : [])]
        .filter(target => tick - target.tick < 600).slice(-8);
      (state.orderHistory ??= new Map()).set(row[0], { tick, x: row[1], z: row[2], t: cmd.t, previous });
    }
    if (result === undefined && cmd.t === 'ability' && Number.isFinite(cmd.x)) for (const id of cmd.ids ?? []) {
      const unit = view.units.get(id);
      if (!['grenade', 'barrage', 'satchel'].includes(UNITS[unit?.type]?.ab.id)) continue;
      const old = state.aimedHistory?.get(id);
      const attempts = old && unit.cd <= old.cd && distance(old, cmd) < 8 ? old.attempts + 1 : 1;
      (state.aimedHistory ??= new Map()).set(id, { tick, x: cmd.x, z: cmd.z, cd: unit.cd, attempts });
    }
    if (result === undefined && cmd.t === 'dig') {
      const key = { bridge: 'bridgeCrew', fill: 'fillCrew', demine: 'demineCrew' }[cmd.kind];
      if (key) for (const id of cmd.ids ?? []) (mem[key] ??= new Map()).set(id, { t: tick / 20, dug: false });
    }
    if (result === undefined && movement(cmd)) for (const row of cmd.orders ?? []) {
      const member = mem.mind?.assault?.members.find(m => m.id === row[0]);
      if (member) {
        member.order = { x: row[1], z: row[2] }; member.acknowledged = true;
        member.acknowledgedAt = tick / 20; member.progressAt = tick / 20;
      }
    }
    if (result !== undefined) (mem.failedInputs ??= new Map()).set(inputKey(cmd), { tick, reason: result });
    else mem.failedInputs?.delete(inputKey(cmd));
    const event = hands.active?.job.context.event;
    if (event?.id) (state.answeredEvents ??= new Set()).add(event.id);
    if (result === undefined && cmd.t === 'buy') state.buys++;
    if (movement(cmd)) state.didOrder = true;
    return result;
  });
  if (fired || !hands.ready) return fired;
  if (tick < (state.noWorkUntil ?? 0)) return;
  // Completion of a camera input changes what can be inspected, even between snapshot beats.
  if (`${state.camera.x},${state.camera.z}` !== state.cameraKey) return;
  if (!state.concern) {
    state.concern = { id: 'production', kind: 'production', ...view.players[slot].spawn, since: tick, until: tick + 60 };
    state.deliberateUntil = tick;
  }
  if (state.planned || tick >= state.concern.until) {
    // The sensor may be two ticks old. Attention timing still uses the actual input tick.
    const candidate = chooseConcern({ ...view, tick }, slot, state, level, hands.rng);
    const continuing = candidate.id === state.concern.id && tick < state.concern.until;
    state.pendingEmergency = null;
    state.concern = candidate; state.planned = false;
    if (!continuing) state.decisionStartedTick = tick;
    const complexity = candidate.kind === 'combat' ? 1.2 : candidate.kind === 'production' ? 1 : 0.7;
    state.deliberateUntil = continuing ? tick : tick + Math.max(2, Math.round(between(hands.rng,
      ...({ easy: [8, 18], normal: [5, 10], hard: [2, 5] }[level] ?? [5, 10])) * complexity));
    const target = cameraTarget(view, candidate, slot), context = contextFor(view, candidate, state);
    if (!continuing && !candidate.eventOnScreen && !onScreen(target, state.camera, view)) {
      queueCamera(hands, target, context, candidate.id.startsWith('alert:') ? 'alert' : distance(target, state.camera) < 35 ? 'pan' : 'minimap');
      return;
    }
  }
  if (tick < state.deliberateUntil) return;
  if (state.pendingEmergency) {
    const target = cameraTarget(view, state.concern, slot);
    const context = contextFor(view, state.concern, state);
    state.pendingEmergency = null;
    if (!state.concern.eventOnScreen && !onScreen(target, state.camera, view)) {
      queueCamera(hands, target, context, state.concern.id.startsWith('alert:') ? 'alert' : 'minimap');
      return;
    }
  }
  for (const [key, failure] of mem.failedInputs ?? []) if (tick - failure.tick >= 300) mem.failedInputs.delete(key);
  const concern = state.concern;
  state.cycle = (state.cycle ?? 0) + 1;
  const context = contextFor(view, concern, state);
  state.pointCount = view.points.length; optionBias(state, hands.rng, level, tick / 20);
  const estimates = estimateSightings(view, hands.rng, level, state);
  mem.seen = new Map(estimates.map(s => [s.id, s]));
  const losses = (mem.mind?.losses ?? []).filter(l => tick / 20 - l.t < 20).length;
  const ownVP = view.players[slot].vp ?? 0, opposingVP = Math.max(0, ...view.players.filter(p => p.team !== view.players[slot].team).map(p => p.vp ?? 0));
  state.mood = Math.min(0.3, losses * 0.06) - (ownVP > opposingVP + 50 ? 0.1 : 0);
  const intents = [];
  const reservedMovement = new Set();
  // Each concern sees the same tier view. Spending and micro wait until that concern has attention.
  const decisionOptions = { level, adaptive: opts.adaptive, rules: opts.rules, handoff: opts.handoff, human: true, concern };
  plan({ ...view, sightings: estimates }, slot, decisionOptions, mem, cmd => {
    const failed = mem.failedInputs?.get(inputKey(cmd));
    if (failed && tick - failed.tick < 300) return failed.reason;
    if ((economy(cmd) || fortification(cmd)) && !['production', 'expansion'].includes(concern.kind)) return 'attention';
    if (cmd.t === 'support' && !['combat', 'support'].includes(concern.kind)) return 'attention';
    if (['ability', 'attack', 'fireat', 'retreat'].includes(cmd.t) && concern.kind === 'production') return 'attention';
    const ids = idsOf(cmd);
    const at = anchorOf(cmd);
    if (concern.kind === 'idle' && !ids.includes(concern.unitId)) return 'attention';
    if (concern.point != null && movement(cmd) && distance(at, concern) > 24) return 'attention';
    if (concern.panel === 'air' && !ids.includes(concern.unitId)) return 'attention';
    const recalled = movement(cmd) && [...hands.groups.values()].some(group => group.length === ids.length && ids.every(id => group.includes(id)));
    const panel = ids.length && ids.every(id => view.airPanel?.some(plane => plane.id === id));
    if (ids.some(id => !view.screenIds.has(id)) && !recalled && !panel) return 'attention';
    if (movement(cmd)) {
      if (ids.some(id => reservedMovement.has(id))) return 'commitment';
      if (ids.every(id => {
        const old = state.orderHistory?.get(id), unit = view.units.get(id);
        return old && unit && distance(old, at) < 2 && distance(unit, at) < 2;
      })) return 'arrived';
      const danger = concern.event === 'base' && ids.every(id => {
        const unit = view.units.get(id); return unit && distance(unit, concern) <= 48;
      }) && at && distance(at, concern) <= 24;
      if (!danger && ids.some(id => {
        const old = state.orderHistory?.get(id), unit = view.units.get(id);
        return old && unit && distance(unit, old) > 8
          && tick - old.tick < 240;
      })) return 'commitment';
      if (!danger && ids.some(id => {
        const old = state.orderHistory?.get(id);
        return old && distance(old, at) > 16 && old.previous?.some(target => tick - target.tick < 600 && distance(target, at) <= 12);
      })) return 'commitment';
      for (const id of ids) reservedMovement.add(id);
    }
    if (cmd.t === 'ability' && ids.some(id => {
      const old = state.aimedHistory?.get(id), unit = view.units.get(id);
      return old && unit && unit.cd <= old.cd
        && tick - old.tick < (old.attempts >= 2 ? 1200 : 300);
    })) return 'pending';
    intents.push(cmd); return undefined;
  });
  context.operation = !!mem.mind?.assault;
  if (!state.didOrder) intents.sort((a, b) => Number(movement(b)) - Number(movement(a)));
  else if (concern.kind === 'combat') {
    const rank = cmd => cmd.t === 'retreat' ? 0 : cmd.t === 'ability' || cmd.t === 'attack' ? 1 : movement(cmd) ? 2 : cmd.t === 'support' ? 3 : 4;
    intents.sort((a, b) => rank(a) - rank(b));
  }
  let queued = 0;
  for (const cmd of mergeMovements(intents, view)) {
    if (queued >= ({ easy: 2, normal: 4, hard: 6 }[level] ?? 4)) break;
    // Hesitation belongs to risky advances, rather than cancelling an order already issued.
    if (cmd.t === 'amove' && concern.kind === 'combat' && random(hands.rng) < ({ easy: 0.25, normal: 0.12, hard: 0.04 }[level] ?? 0.12)) continue;
    const causal = servesEvent(cmd, context.event, view, slot);
    const jobContext = causal ? { ...context, responseActorIds: idsOf(cmd), responseTarget: anchorOf(cmd) }
      : { ...context, event: undefined, eventTick: undefined };
    const hiddenGround = blockedPlacement(cmd, state.camera, view);
    if (hiddenGround) {
      if (!queued) {
        const target = placementCamera(cmd, hiddenGround, state.camera, view);
        if (!target) continue;
        if (!queueCamera(hands, target, jobContext, distance(target, state.camera) < 35 ? 'pan' : 'minimap')) continue;
        // Keep this visit long enough to inspect the occluded placement after the real camera gesture.
        state.concern.until = Math.max(state.concern.until, tick + 60);
        if (state.attention) state.attention.until = state.concern.until;
        queued++;
      }
      break;
    }
    if (enqueueDecision(hands, cmd, view, jobContext)) queued++;
  }
  if (state.production) state.production.queuedBuys = hands.queue.filter(job => job.command?.t === 'buy').length;
  state.planned = true;
  // Empty cycles still take time. An idle squad can wait unnoticed while another concern wins attention.
  if (!queued) state.noWorkUntil = tick + (level === 'easy' ? 30 : level === 'hard' ? 8 : 16);
}

function inputKey(cmd) {
  return JSON.stringify([cmd.t, cmd.kind, cmd.unit, cmd.ids ?? cmd.orders?.map(row => row[0]),
    cmd.target, cmd.id, Math.round((cmd.x ?? 0) / 8), Math.round((cmd.z ?? 0) / 8)]);
}
