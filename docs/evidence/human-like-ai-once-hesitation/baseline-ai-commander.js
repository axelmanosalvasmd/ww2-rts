// Perceive one view, attend one concern, deliberate, then let the hands finish before choosing again.
import { CELL, UNITS } from './sim.js';
import { perceive, onScreen, startCamera, needsInspection, cameraFootprint } from './ai-perception.js';
import { chooseConcern, deferEmptyCombat, screenEventNeedsAttention } from './ai-attention.js';
import { createHands, advanceHands, interruptHands, enqueueDecision, queueCamera, queueInspection, groundClickable } from './ai-hands.js';
import { random, between } from './ai-rng.js';
import { personaFor, estimateSightings, optionBias } from './ai-persona.js';
import { prioritizeVisit, commandServesObservedEvent } from './ai-priority.js';

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
  if (cmd.t === 'garrison' && Number.isFinite(cmd.x)) return onScreen(cmd, camera, view) ? null : cmd;
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

function mergeMovements(intents, view, dangerMoves) {
  const danger = cmd => movement(cmd) && cmd.orders.some(row => { const at=dangerMoves.get(row[0]); return at && row[1]===at.x && row[2]===at.z; });
  const merged = [];
  const support = new Set(['mg', 'at', 'mortar', 'howitzer', 'rocket', 'flak']);
  const role = cmd => idsOf(cmd).every(id => support.has(view.units.get(id)?.type)) ? 'support' : 'line';
  for (const cmd of intents) {
    const at = anchorOf(cmd);
    const batch = movement(cmd) && !danger(cmd) && merged.find(old => !danger(old) && old.t === cmd.t && !!old.queue === !!cmd.queue
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
      x: concern.x, z: concern.z, unitId: recorded?.unitId, targetId: recorded?.targetId } : undefined,
    eventTick: event ? eventTick : undefined, reactionStartTick: event ? eventTick : state.decisionStartedTick,
    cycle: state.cycle ?? 0 };
}

function moveConcernCamera(state, hands, target, context, mode) {
  if (!queueCamera(hands, target, context, mode)) return false;
  // The physical trip precedes inspection. A long pan must not use up the whole visit before arrival.
  state.cameraVisit = { id: state.concern.id, dwell: Math.max(1, state.concern.until - state.concern.since) };
  return true;
}

// A short trip across the current ground footprint uses a held pan; distant visits use the minimap.
export function cameraTravelMode(camera, target, alert = false) {
  if (alert) return 'alert';
  const footprint = cameraFootprint(camera), span = Math.max(...footprint.map((point, i) =>
    distance(point, footprint[(i + 1) % footprint.length])));
  return distance(camera, target) <= span ? 'pan' : 'minimap';
}


// These keys record only this commander's own accepted physical commands, not hidden game facts.
const acceptedCommands = new WeakMap();
function exactCommandKey(cmd) {
  const canonical = value => {
    if(Array.isArray(value))return value.map(canonical);
    if(value && typeof value==='object')return Object.fromEntries(Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>[key,canonical(value[key])]));
    return value;
  };
  const copy={...cmd};
  if(movement(cmd)) { copy.orders=cmd.orders.map(row=>[...row]);copy.queue=!!cmd.queue; }
  else if(cmd.ids)copy.ids=[...cmd.ids];
  return JSON.stringify(canonical(copy));
}
// Pair accepted actor destinations with the complete planned operation, including formation membership and order.
function movementIntentKey(cmd, id) {
  if (!movement(cmd)) return null;
  const row = cmd.orders.find(row => row[0] === id);
  return row ? exactCommandKey(cmd) : null;
}
function acceptedMovementIntent(cmd, planned, id) {
  if (!planned || cmd.t !== planned.t || !!cmd.queue !== !!planned.queue
    || !acceptedIntent(cmd, planned)) return null;
  return movementIntentKey(planned, id);
}
function acceptedIntent(cmd, planned) {
  if(!planned || cmd.t!==planned.t || cmd.target!==planned.target || cmd.kind!==planned.kind)return null;
  const actual=[...idsOf(cmd)].sort((a,b)=>a-b), intended=[...idsOf(planned)].sort((a,b)=>a-b);
  return actual.length===intended.length && actual.every((id,i)=>id===intended[i]) ? exactCommandKey(planned) : null;
}
function pendingAccepted(state, cmd, view, slot) {
  const entries=acceptedCommands.get(state);if(!entries)return false;
  for(const [key,entry]of entries)if(view.tick>entry.tick || entry.ids.some(id=>{
    const unit=view.units.get(id);return !unit || unit.owner!==slot || unit.hp<=0;
  }))entries.delete(key);
  const key=exactCommandKey(cmd);
  return [...entries.values()].some(entry=>entry.actual===key || entry.intended===key);
}
function eligibleMovement(cmd, view, state, concern, tick, dangerMoves, reserved) {
  if(!movement(cmd))return cmd;
  const rows=cmd.orders.filter(row=>{
    const id=row[0], at={x:row[1],z:row[2]}, unit=view.units.get(id), old=state.orderHistory?.get(id);
    if(reserved.has(id))return false;
    if(old && unit && distance(old,at)<2 && distance(unit,at)<2)return false;
    const local=dangerMoves.get(id);
    const danger=cmd.t==='move'&&local&&row[1]===local.x&&row[2]===local.z
      || concern.event==='base'&&unit&&distance(unit,concern)<=48&&distance(at,concern)<=24;
    if(!danger && old && unit && distance(unit,old)>8 && tick-old.tick<240)return false;
    if(!danger && old && distance(old,at)>16 && old.previous?.some(target=>tick-target.tick<600&&distance(target,at)<=12))return false;
    return true;
  });
  return rows.length ? {...cmd,orders:rows.map(row=>[...row])} : null;
}

// Match the complete merged operation before pruning arrived actors. A different group can form different destinations.
function arrivedMovement(cmd, view, state, concern, dangerMoves) {
  if (!movement(cmd)) return cmd;
  let current = cmd;
  while (current.orders.length) {
    const intent = exactCommandKey(current);
    const rows = current.orders.filter(row => {
      const id = row[0], unit = view.units.get(id), old = state.orderHistory?.get(id);
      if (!old?.intent || old.intent !== intent || !unit || distance(unit, old) >= 2) return true;
      const at = { x: row[1], z: row[2] }, local = dangerMoves.get(id);
      return cmd.t === 'move' && local && row[1] === local.x && row[2] === local.z
        || concern.event === 'base' && distance(unit, concern) <= 48 && distance(at, concern) <= 24;
    });
    if (rows.length === current.orders.length) return current;
    // Removing arrived members can restore a smaller operation already accepted for its remaining actors.
    current = { ...current, orders: rows.map(row => [...row]) };
  }
  return null;
}

function responseContext(cmd, context, view, state, slot, tick) {
  const causal = commandServesObservedEvent(cmd, context.event, view, slot);
  const result = causal ? { ...context } : { ...context, event: undefined, eventTick: undefined };
  result.responseEvents = (view.events ?? []).filter(event => event.tick <= tick && tick - event.tick <= 240
    && !state.answeredEvents?.has(event.id) && commandServesObservedEvent(cmd, event, view, slot))
    .map(event => ({ ...event }));
  result.responseActorIds = idsOf(cmd);
  result.responseTarget = anchorOf(cmd);
  return result;
}

// The actual queued start packet contains the map size and this seat's spawn, but no actors.
// This explicit initializer starts only the opening read. Late takeovers keep their actual first-look clock.
export function initializePublicStart(setup, slot, mem, options = {}) {
  const { w, h, spawn, level = 'normal', seed = 1 } = setup;
  if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0
    || !Number.isFinite(spawn?.x) || !Number.isFinite(spawn?.z)) throw new TypeError('Invalid public start scene');
  if (mem.human) return false;
  const camera = startCamera({ w, h, players: { [slot]: { spawn: { x: spawn.x, z: spawn.z } } } }, slot);
  mem.human = { camera, startedTick: 0,
    hands: createHands({ slot, seed, level, camera, startedTick: 0, calibration: options.calibration }) };
  return true;
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
  const selectionKey = hands.selected.join(',');
  if (!state.view || state.deliveredTick !== observation.tick || state.cameraKey !== cameraKey || state.selectionKey !== selectionKey) {
    state.view = perceive(observation, slot, state, tick, opts.perceptionMeasurements); state.deliveredTick = observation.tick;
    state.cameraKey = cameraKey; state.selectionKey = selectionKey;
  }
  const view = state.view;
  state.interruptEvents ??= new Set();
  const workingPriority = hands.active?.job.context.priority ?? state.concern?.urgency ?? 0;
  const emergency = view.newEvents?.filter(event => !state.interruptEvents.has(event.id)
    && ['base', 'air', 'attack', 'screen-damage', 'screen-contact', 'unitLost'].includes(event.kind))
    .filter(event => eventRank(event) > workingPriority
      && (event.source !== 'screen' || screenEventNeedsAttention(event)))
    .sort((a, b) => eventRank(b) - eventRank(a))[0];
  if (emergency) {
    state.interruptEvents.add(emergency.id);
    hands.queue.length = 0;
    interruptHands(hands, tick, view);
    state.pendingEmergency = emergency;
    state.cameraVisit = null;
    state.pendingInspection = null;
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
    if(result===undefined) {
      const entries=acceptedCommands.get(state)??new Map();acceptedCommands.set(state,entries);
      const actual=exactCommandKey(cmd);
      entries.set(actual,{actual,intended:acceptedIntent(cmd,hands.active?.job.command),tick,ids:[...idsOf(cmd)]});
    }
    if (result === undefined && movement(cmd)) for (const row of cmd.orders ?? []) {
      const old = state.orderHistory?.get(row[0]);
      const previous = [...(old?.previous ?? []), ...(old ? [{ tick: old.tick, x: old.x, z: old.z }] : [])]
        .filter(target => tick - target.tick < 600).slice(-8);
      (state.orderHistory ??= new Map()).set(row[0], { tick, x: row[1], z: row[2], t: cmd.t,
        intent: acceptedMovementIntent(cmd, hands.active?.job.command, row[0]), previous });
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
    // Only an accepted, relevant actual command completes these obligations. A missed selection can still
    // be a human response, but a refused order must not suppress future attempts at the same concern.
    if (result === undefined) {
      const context = hands.active?.job.context;
      const events = [...(context?.responseEvents ?? []), ...(context?.event ? [context.event] : [])];
      for (const event of events) if (commandServesObservedEvent(cmd, event, view, slot))
        (state.answeredEvents ??= new Set()).add(event.id);
    }
    if (result === undefined && cmd.t === 'buy') {
      state.buys++;
      state.lastAcceptedBuyTick = tick;
    }
    if (movement(cmd)) state.didOrder = true;
    return result;
  });
  if (fired || !hands.ready) return fired;
  if (tick < (state.noWorkUntil ?? 0)) return;
  // Completion of a camera input changes what can be inspected, even between snapshot beats.
  if (`${state.camera.x},${state.camera.z}` !== state.cameraKey) return;
  if (hands.selected.join(',') !== state.selectionKey) return;
  if (state.pendingInspection) {
    const inspection = state.pendingInspection; state.pendingInspection = null;
    if (inspection.concern === state.concern?.id) {
      state.planned = false;
      state.decisionStartedTick = tick;
      state.deliberateUntil = tick + ({ easy: 10, normal: 6, hard: 4 }[level] ?? 6);
      state.concern.until = Math.max(state.concern.until, state.deliberateUntil + 20);
      if (state.attention) state.attention.until = state.concern.until;
    }
  }
  if (state.cameraVisit) {
    const visit = state.cameraVisit;
    if (visit.id === state.concern?.id) {
      const target = cameraTarget(view, state.concern, slot);
      // A held pan moves one axis. Finish the other axis before inspecting the destination.
      if (!onScreen(target, state.camera, view)
        && queueCamera(hands, target, contextFor(view, state.concern, state),
          cameraTravelMode(state.camera, target, state.concern.id.startsWith('alert:')))) return;
      state.cameraVisit = null;
      state.concern.since = tick; state.concern.until = tick + visit.dwell;
      if (state.attention) { state.attention.since = tick; state.attention.until = state.concern.until; }
      state.decisionStartedTick = tick;
      const complexity = state.concern.kind === 'combat' ? 1.2 : state.concern.kind === 'production' ? 1 : .7;
      state.deliberateUntil = tick + Math.max(2, Math.round(between(hands.rng,
        ...({ easy: [8, 18], normal: [5, 10], hard: [2, 5] }[level] ?? [5, 10])) * complexity));
    } else state.cameraVisit = null;
  }
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
    if (!continuing && !onScreen(target, state.camera, view)) {
      moveConcernCamera(state, hands, target, context, cameraTravelMode(state.camera, target, candidate.id.startsWith('alert:')));
      return;
    }
  }
  if (tick < state.deliberateUntil) return;
  if (state.pendingEmergency) {
    const target = cameraTarget(view, state.concern, slot);
    const context = contextFor(view, state.concern, state);
    state.pendingEmergency = null;
    if (!onScreen(target, state.camera, view)) {
      moveConcernCamera(state, hands, target, context, cameraTravelMode(state.camera, target, state.concern.id.startsWith('alert:')));
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
  const inspections = [];
  const reservedMovement = new Set();
  const dangerMoves = new Map();
  // Each concern sees the same tier view. Spending and micro wait until that concern has attention.
  const decisionOptions = { level, adaptive: opts.adaptive, rules: opts.rules, handoff: opts.handoff, human: true, concern,
    requestDangerMove: (id, destination) => dangerMoves.set(id, { ...destination }),
    requestInspection: cmd => {
      if (concern.kind === 'production' || cmd.t !== 'ability') return;
      const id = idsOf(cmd)[0], unit = view.units.get(id);
      if (!unit || !view.screenIds.has(id) || !needsInspection(view, id)
        || concern.kind === 'idle' && id !== concern.unitId) return;
      const last = state.inspectionAttempts?.get(id);
      if (last !== undefined && tick - last < 160) return;
      const old = unit.lastHUD;
      if (old?.ability?.cooldownSeconds > 0 && tick - old.observedTick < old.ability.cooldownSeconds * 20) return;
      if (!inspections.some(candidate => idsOf(candidate)[0] === id)) inspections.push(cmd);
    } };
  plan({ ...view, sightings: estimates }, slot, decisionOptions, mem, proposed => {
    const cmd=eligibleMovement(proposed,view,state,concern,tick,dangerMoves,reservedMovement);
    if(!cmd)return 'commitment';
    if(pendingAccepted(state,cmd,view,slot))return 'accepted';
    const failed = mem.failedInputs?.get(inputKey(cmd));
    if (failed && tick - failed.tick < 300) return failed.reason;
    const ids = idsOf(cmd), at = anchorOf(cmd);
    if (cmd.t === 'garrison' && at && onScreen(at, state.camera, view) && !view.sees(at)) return 'notVisible';
    const idleActor = concern.kind === 'idle' && view.units.get(concern.unitId);
    const localMaintenance = fortification(cmd) && idleActor && ids.includes(idleActor.id)
      && at && distance(at, idleActor) <= 24;
    const workTarget = cmd.t === 'assist' ? view.units.get(cmd.id) : at;
    const localEngineerWork = ['build', 'assist'].includes(cmd.t) && idleActor?.type === 'engineer'
      && ids.length === 1 && ids[0] === idleActor.id && !idleActor.inventoryOnly
      && view.screenIds.has(idleActor.id) && workTarget && distance(workTarget, idleActor) <= 24
      && view.sees(workTarget) && (cmd.t !== 'assist' || workTarget.owner === slot);
    if ((economy(cmd) || fortification(cmd)) && !['production', 'expansion'].includes(concern.kind)
      && !localMaintenance && !localEngineerWork) return 'attention';
    if (cmd.t === 'support' && !['combat', 'support'].includes(concern.kind)) return 'attention';
    if (['ability', 'attack', 'fireat', 'retreat'].includes(cmd.t) && concern.kind === 'production') return 'attention';
    if (concern.kind === 'idle' && !ids.includes(concern.unitId)) return 'attention';
    if (concern.point != null && movement(cmd) && distance(at, concern) > 24) return 'attention';
    if (concern.panel === 'air' && !ids.includes(concern.unitId)) return 'attention';
    const recalled = movement(cmd) && [...hands.groups.values()].some(group => group.length === ids.length && ids.every(id => group.includes(id)));
    const panel = ids.length && ids.every(id => view.airPanel?.some(plane => plane.id === id));
    if (ids.some(id => !view.screenIds.has(id)) && !recalled && !panel) return 'attention';
    if (movement(cmd)) {
      for (const id of ids) reservedMovement.add(id);
    }
    if (cmd.t === 'ability' && ids.some(id => {
      const old = state.aimedHistory?.get(id), unit = view.units.get(id);
      return old && unit && unit.cd <= old.cd
        && tick - old.tick < (old.attempts >= 2 ? 1200 : 300);
    })) return 'pending';
    intents.push(cmd); return undefined;
  });
  if (!state.didOrder) intents.sort((a, b) => Number(movement(b)) - Number(movement(a)));
  else if (concern.kind === 'combat') {
    const rank = cmd => cmd.t === 'retreat' ? 0 : cmd.t === 'ability' || cmd.t === 'attack' ? 1 : movement(cmd) ? 2 : cmd.t === 'support' ? 3 : 4;
    intents.sort((a, b) => rank(a) - rank(b));
  }
  const prioritized = prioritizeVisit(intents, inspections, view, concern, state.answeredEvents, slot, tick);
  // A useful ability needs a current HUD reading. Select one actual squad, then replan from that selection.
  // An urgent retreat can proceed without looking up an ability's cooldown first.
  if (!intents.some(cmd => cmd.t === 'retreat')) for (const cmd of prioritized.inspections) {
    const id = idsOf(cmd)[0];
    if (!queueInspection(hands, [id], view, responseContext(cmd, context, view, state, slot, tick))) continue;
    (state.inspectionAttempts ??= new Map()).set(id, tick);
    state.pendingInspection = { id, concern: concern.id };
    state.emptyCombatVisits?.delete(concern.id);
    state.planned = false;
    return;
  }
  let queued = 0;
  for (const merged of mergeMovements(intents, view, dangerMoves)) {
    const cmd = arrivedMovement(merged, view, state, concern, dangerMoves);
    if (!cmd) continue;
    if (queued >= ({ easy: 2, normal: 4, hard: 6 }[level] ?? 4)) break;
    // Hesitation belongs to risky advances, rather than cancelling an order already issued.
    if (cmd.t === 'amove' && concern.kind === 'combat' && random(hands.rng) < ({ easy: 0.25, normal: 0.12, hard: 0.04 }[level] ?? 0.12)) continue;
    const jobContext = responseContext(cmd, context, view, state, slot, tick);
    // These are deliberate links to already perceived episodes. One local group order can address several
    // contacts, while each episode keeps its own creation time and complete population descriptor.
    jobContext.operation = movement(cmd) && idsOf(cmd).length > 0 && idsOf(cmd).every(id => {
      const unit = view.units.get(id);
      return unit?.owner === slot && !unit.air && !UNITS[unit.type].structure && !unit.inventoryOnly;
    });
    const hiddenGround = blockedPlacement(cmd, state.camera, view);
    if (hiddenGround) {
      if (!queued) {
        const target = placementCamera(cmd, hiddenGround, state.camera, view);
        if (!target) continue;
        if (!queueCamera(hands, target, jobContext, cameraTravelMode(state.camera, target))) continue;
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
  if (!queued) {
    state.noWorkUntil = tick + (level === 'easy' ? 30 : level === 'hard' ? 8 : 16);
    if (deferEmptyCombat(view, slot, state, concern, tick, level)) {
      state.concern.until = tick;
      if (state.attention) state.attention.until = tick;
    }
  } else state.emptyCombatVisits?.delete(concern.id);
}

function inputKey(cmd) {
  return JSON.stringify([cmd.t, cmd.kind, cmd.unit, cmd.ids ?? cmd.orders?.map(row => row[0]),
    cmd.target, cmd.id, Math.round((cmd.x ?? 0) / 8), Math.round((cmd.z ?? 0) / 8)]);
}
