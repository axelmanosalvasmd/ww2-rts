import { CELL, CFG, TRENCH, UNITS, RIDING_FLAG, SUPPORT } from './sim.js';
import { formation } from './formation.js';
import { createRng, between, random } from './ai-rng.js';
import { onScreen, cameraFootprint, HUMAN_CAMERA } from './ai-perception.js';
import { bindings } from '../client/keys.js';

// Provisional design values. Fitts coefficients and endpoint error need local recordings, not paper-derived labels.
export const HUMAN_SKILLS = Object.freeze({
  easy: Object.freeze({ reaction: [0.9, 1.4], offscreen: [3, 6], opening: [4, 8], apm: [20, 35], peak: 60, concerns: [1, 2], noise: 1, error: 1.8, key: [0.15, 0.25], pointer: [0.12, 0.11] }),
  normal: Object.freeze({ reaction: [0.5, 0.8], offscreen: [1.5, 3], opening: [3, 6], apm: [40, 70], peak: 120, concerns: [2, 3], noise: 0.5, error: 1, key: [0.10, 0.18], pointer: [0.09, 0.085] }),
  hard: Object.freeze({ reaction: [0.3, 0.45], offscreen: [0.8, 1.6], opening: [2, 4], apm: [80, 120], peak: 200, concerns: [3, 4], noise: 0.2, error: 0.6, key: [0.075, 0.13], pointer: [0.07, 0.065] }),
});
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const centroid = units => ({ x: units.reduce((sum, u) => sum + u.x, 0) / units.length,
  z: units.reduce((sum, u) => sum + u.z, 0) / units.length });
const sameIds = (a, b) => a.length === b.length && a.every(id => b.includes(id));
const ticks = seconds => Math.max(1, Math.ceil(seconds * 20));
const isPoint = at => Number.isFinite(at?.x) && Number.isFinite(at?.z);
const clampPoint = (at, view) => ({ x: Math.min(view.w * CELL - 1, Math.max(1, at.x)), z: Math.min(view.h * CELL - 1, Math.max(1, at.z)) });

function calibratedSkill(defaults, calibration, level) {
  const config = calibration?.calibration ?? calibration?.timingFit?.calibration ?? calibration;
  const values = config?.skills?.[level] ?? config?.[level] ?? config;
  const skill = { ...defaults };
  const pair = (key, min, max) => {
    const p = values?.[key];
    if (!Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite) || (key !== 'pointer' && p[1] < p[0])) return;
    skill[key] = [Math.min(max, Math.max(min, p[0])), Math.min(max, Math.max(min, p[1]))];
  };
  pair('reaction', 0.2, 2); pair('key', 0.05, 0.4); pair('pointer', 0.04, 0.3);
  if (Number.isFinite(values?.error)) skill.error = Math.min(5, Math.max(0.2, values.error));
  return skill;
}

export function createHands({ slot, seed = 1, level = 'normal', camera, log, startedTick = 0, handover = false, calibration, resolveMinimap } = {}) {
  const name = typeof level === 'string' ? level : ['easy', 'normal', 'hard'][level] ?? 'normal';
  const skill = calibratedSkill(HUMAN_SKILLS[name] ?? HUMAN_SKILLS.normal, calibration, name), rng = createRng(seed, slot);
  // The sampled opening is a total first-order deadline, including reading, selection and all motor work.
  const opening = between(rng, ...skill.opening);
  const cam = camera ?? { x: 0, z: 0 };
  return { slot, level: name, skill, rng, camera: cam, log, tick: startedTick,
    openingUntil: startedTick + ticks(1.5),
    openingDeadline: startedTick + ticks(handover ? Math.max(1.5, opening / 2) : opening), openingDone: false,
    handover, queue: [], active: null, selected: [], groups: new Map(), groupUse: new Map(), operationHistory: new Map(), inputTicks: [], resolveMinimap,
    lastVisit: null, visitEvents: new Set(),
    lastCommandTick: -Infinity, lastCommandTarget: null, clicks: [], concern: 'opening',
    cursor: { x: cam.x, z: cam.z, fromX: cam.x, fromZ: cam.z, toX: cam.x, toZ: cam.z, startTick: startedTick, endTick: startedTick },
    pointer: { x: HUMAN_CAMERA.width / 2, y: HUMAN_CAMERA.height / 2, mode: 'screen',
      fromX: HUMAN_CAMERA.width / 2, fromY: HUMAN_CAMERA.height / 2, toX: HUMAN_CAMERA.width / 2,
      toY: HUMAN_CAMERA.height / 2, startTick: startedTick, endTick: startedTick },
    ready: false, interruptAfterInput: false, cancelTargeting: false };
}

const armsTargeting = action => !action.fire && (action.kind === 'place-anchor'
  || action.kind === 'attack-key' && action.input?.code === 'KeyG'
  || ['ability-key', 'ability-click', 'support-key', 'support-click', 'build-key', 'build-click', 'area-key'].includes(action.kind));
const selectsUnits = action => ['select-click', 'select-add-click', 'select-box', 'select-air-panel', 'group-recall'].includes(action.kind);
const namedActorSelected = (hands, job) => job.context.concernKind !== 'idle'
  || job.ids.includes(job.context.concernUnitId) && hands.selected.includes(job.context.concernUnitId);

function frozenContext(context) {
  const copy = structuredClone(context);
  const freeze = value => {
    if (value && typeof value === 'object') {
      for (const child of Object.values(value)) freeze(child);
      Object.freeze(value);
    }
    return value;
  };
  if (Array.isArray(copy.responseEvents)) freeze(copy.responseEvents);
  return copy;
}

function minimumResponseTick(context) {
  let floor = context.event && Number.isFinite(context.eventTick) ? context.eventTick + 4 : 0;
  for (const event of context.responseEvents ?? []) if (Number.isFinite(event?.tick)) floor = Math.max(floor, event.tick + 4);
  return floor;
}

function emit(hands, action, command) {
  const entry = { tick: hands.tick, kind: action.kind, camera: { x: hands.camera.x, z: hands.camera.z, yaw: hands.camera.yaw ?? HUMAN_CAMERA.yaw,
      distance: hands.camera.distance ?? HUMAN_CAMERA.distance },
    selected: hands.selected.length, concern: action.context.concern ?? hands.concern };
  if (hands.selected.length) entry.ids = [...hands.selected];
  if (hands.active?.job.inspect && action.ids) {
    entry.inspection = true;
    entry.inspectionAcquired = sameIds(hands.selected, hands.active.job.ids);
  }
  if (isPoint(action.at)) entry.target = { x: action.at.x, z: action.at.z };
  if (action.context.event !== undefined) entry.event = structuredClone(action.context.event);
  if (action.context.cycle !== undefined) entry.cycle = action.context.cycle;
  if (action.context.concernKind !== undefined) entry.concernKind = action.context.concernKind;
  for (const key of ['concernTarget', 'concernUnitId', 'responseActorIds', 'responseTarget', 'responseEvents']) {
    if (action.context[key] !== undefined) entry[key] = structuredClone(action.context[key]);
  }
  if (action.camera) entry.method = action.mode;
  if (action.input) entry.input = { ...action.input };
  if (action.motor) entry.pointer = structuredClone(action.motor);
  if (Number.isFinite(action.startedTick)) entry.inputStartedTick = action.startedTick;
  if (Number.isFinite(action.duration)) entry.motorTicks = action.duration;
  if (Number.isFinite(hands.active?.job.queuedTick)) entry.queuedTick = hands.active.job.queuedTick;
  if (Number.isFinite(action.context.reactionStartTick)) entry.reactionStartTick = action.context.reactionStartTick;
  if (Number.isFinite(action.context.eventTick)) {
    entry.eventTick = action.context.eventTick;
    entry.latency = (hands.tick - action.context.eventTick) / 20;
  }
  if (command) entry.command = structuredClone(command);
  if (Array.isArray(hands.log)) hands.log.push(entry); else if (typeof hands.log === 'function') hands.log(entry);
  hands.inputTicks.push(hands.tick);
  if (isPoint(action.at)) {
    hands.clicks.push({ x: action.at.x, z: action.at.z, tick: hands.tick, kind: action.kind });
    hands.clicks = hands.clicks.filter(click => hands.tick - click.tick < 40).slice(-8);
  }
  const interrupted = hands.interruptAfterInput || hands.active?.interruptAfterCommand && action.fire;
  if (interrupted) {
    hands.interruptAfterInput = false;
    if ((hands.active?.armed || armsTargeting(action)) && !action.fire) hands.cancelTargeting = true;
    hands.active = null; hands.ready = !hands.queue.length;
  }
  return interrupted;
}

function affordableInput(hands, tick) {
  hands.inputTicks = hands.inputTicks.filter(at => tick - at < 1200);
  return hands.inputTicks.length < hands.skill.apm[1]
    && hands.inputTicks.filter(at => tick - at < 200).length < Math.floor(hands.skill.peak / 6);
}

// The client drops dead members from recalled groups. Empty numbers can be bound again.
function pruneGroups(hands, view) {
  for (const [number, members] of hands.groups) {
    const living = members.filter(id => {
      const u = view.units.get(id);
      return u && u.owner === hands.slot && (u.hp === undefined || u.hp > 0);
    });
    if (living.length) hands.groups.set(number, living);
    else { hands.groups.delete(number); hands.groupUse.delete(number); }
  }
}

const OPERATION_MEMORY_TICKS = 1200, OPERATION_MEMORY_SETS = 32;
const operationKey = ids => [...ids].sort((a, b) => a - b).join(',');
function operationMembers(hands, view, ids) {
  const units = knownOwn(view, hands.slot, ids);
  return ids.length >= 2 && ids.length <= 8 && units.length === ids.length && new Set(ids).size === ids.length
    && units.every(unit => UNITS[unit.type] && !UNITS[unit.type].structure && !UNITS[unit.type].air);
}
function pruneOperationHistory(hands, view) {
  for (const [key, item] of hands.operationHistory) if (hands.tick - item.tick >= OPERATION_MEMORY_TICKS
    || !operationMembers(hands, view, item.ids)) hands.operationHistory.delete(key);
}
function acceptedOperation(hands, active, command, view) {
  const job = active.job, ids = command.orders?.map(row => row[0]) ?? [];
  if (!job.context.operation || job.panel || !['move', 'amove'].includes(command.t)
    || !sameIds(ids, hands.selected) || !operationMembers(hands, view, ids)) return;
  const key = operationKey(ids), previous = hands.operationHistory.get(key);
  hands.operationHistory.delete(key);
  hands.operationHistory.set(key, { ids: [...ids], tick: hands.tick });
  while (hands.operationHistory.size > OPERATION_MEMORY_SETS) hands.operationHistory.delete(hands.operationHistory.keys().next().value);
  if (!previous || hands.tick - previous.tick >= OPERATION_MEMORY_TICKS || groupFor(hands, ids) !== null) return;
  const number = groupNumber(hands), input = physicalKey(`group:set:${number}`);
  if (!input) return;
  // The repeated real operation succeeded. The next gesture binds its actual selection for expected reuse.
  active.actions.splice(active.index + 1, 0, { kind: 'group-set', at: null, context: job.context,
    ids: [...ids], group: number, input });
}

function groupNumber(hands) {
  for (let number = 1; number <= 9; number++) if (!hands.groups.has(number)) return number;
  return [...hands.groups.keys()].sort((a, b) => (hands.groupUse.get(a) ?? -Infinity) - (hands.groupUse.get(b) ?? -Infinity) || a - b)[0];
}

// The table specifies median ranges, rather than hard limits on every delay. A shifted lognormal keeps
// the authored median inside its range and permits slower tail responses. These parameters await local recordings.
function skewedDelay(hands, range) {
  const [lo, hi] = range, span = hi - lo;
  if (span <= 0) return lo;
  const normal = Math.sqrt(-2 * Math.log(Math.max(1e-9, random(hands.rng)))) * Math.cos(2 * Math.PI * random(hands.rng));
  return lo + span * 0.3 * Math.exp(0.7 * normal);
}

const causalLinks = context => (context.responseEvents ?? []).filter(event => Number.isFinite(event?.tick)
  && (event.source === 'screen' || event.source === 'alert'));

function reactionDelay(hands, context, tick, motorTicks, includeLinks = true) {
  const visit = JSON.stringify([context.concern ?? null, context.cycle ?? null]);
  const event = context.event == null ? null : JSON.stringify([context.event?.id ?? context.event, context.eventTick ?? null]);
  const links = includeLinks ? causalLinks(context) : [];
  const linkedEvents = links.map(link => JSON.stringify([link.id ?? link, link.tick]));
  const newVisit = hands.lastVisit !== visit;
  if (newVisit) hands.visitEvents.clear();
  const fresh = newVisit || (event !== null && !hands.visitEvents.has(event))
    || linkedEvents.some(link => !hands.visitEvents.has(link));
  hands.lastVisit = visit;
  if (event !== null) hands.visitEvents.add(event);
  for (const link of linkedEvents) hands.visitEvents.add(link);
  if (!fresh) {
    const floor = context.event && Number.isFinite(context.eventTick) ? context.eventTick + 4 - tick - motorTicks : 0;
    return Math.max(0, floor, ticks(skewedDelay(hands, hands.skill.key)));
  }
  const causal = context.event && Number.isFinite(context.eventTick)
    && (context.event.onScreen || context.event.source === 'alert');
  let start = causal ? context.eventTick : Number.isFinite(context.reactionStartTick) ? context.reactionStartTick
    : tick - (Number.isFinite(context.paidTicks) ? Math.max(0, context.paidTicks) : 0);
  let stimulus = context.event;
  // A newly linked stimulus can arrive after the original choice started. Its response budget
  // starts at creation without replacing the primary event retained in the input log.
  for (const link of links) if (link.tick > start) { start = link.tick; stimulus = link; }
  const range = stimulus?.source === 'alert' && !stimulus.onScreen ? hands.skill.offscreen : hands.skill.reaction;
  // The target is the complete first-input interval. Choice time already paid and the full motor duration
  // consume this budget. Slow choices, long gestures and backlog remain slow, rather than shortening the motor.
  const deadline = start + Math.max(4, ticks(skewedDelay(hands, range)));
  return Math.max(0, deadline - tick - motorTicks);
}

function groupFor(hands, ids) {
  for (const [number, members] of hands.groups) if (sameIds(members, ids)) return number;
  return null;
}

function knownOwn(view, slot, ids, panel = false) {
  return ids.map(id => view.units.get(id)).filter(u => u && u.owner === slot && (u.hp === undefined || u.hp > 0)
    && (!(u.flags & (512 | RIDING_FLAG)) || UNITS[u.type]?.building
      || panel && UNITS[u.type]?.air && view.airPanel?.some(row => row.id === u.id)));
}

// Delivered height levels provide a terrain proxy. The client's decorative relief mesh is not in a seat view.
function groundHeight(at, view) {
  const fx = Math.min(view.w - 1, Math.max(0, at.x / CELL - 0.5));
  const fz = Math.min(view.h - 1, Math.max(0, at.z / CELL - 0.5));
  const x = Math.floor(fx), z = Math.floor(fz), x1 = Math.min(view.w - 1, x + 1), z1 = Math.min(view.h - 1, z + 1);
  const tx = fx - x, tz = fz - z, h = (cx, cz) => view.height?.[cz * view.w + cx] ?? 0;
  return (h(x, z) * (1 - tx) * (1 - tz) + h(x1, z) * tx * (1 - tz)
    + h(x, z1) * (1 - tx) * tz + h(x1, z1) * tx * tz) * CFG.levelHeight;
}

export function projectPointer(u, camera, view, { minimap = false, elevation = 0 } = {}) {
  if (minimap) {
    // The 240-pixel canvas is displayed at 228 CSS pixels at the specified 1920x1080 viewport.
    const size = 228, scale = size / Math.hypot(view.w * CELL, view.h * CELL);
    const angle = camera.yaw ?? HUMAN_CAMERA.yaw, s = Math.sin(angle), c = Math.cos(angle);
    const dx = u.x - view.w * CELL / 2, dz = u.z - view.h * CELL / 2;
    return { x: HUMAN_CAMERA.width - 8 - size / 2 + scale * (c * dx - s * dz),
      y: HUMAN_CAMERA.height - 8 - size / 2 + scale * (s * dx + c * dz) };
  }
  const angle = camera.yaw ?? HUMAN_CAMERA.yaw, s = Math.sin(angle), c = Math.cos(angle);
  const dx = u.x - camera.x, dz = u.z - camera.z, y = groundHeight(u, view) + elevation - groundHeight(camera, view);
  const sin = Math.sin(HUMAN_CAMERA.pitch), cos = Math.cos(HUMAN_CAMERA.pitch);
  const forward = dx * s + dz * c, right = dx * c - dz * s;
  const depth = (camera.distance ?? HUMAN_CAMERA.distance) - sin * y - cos * forward, up = cos * y - sin * forward;
  const tan = Math.tan(HUMAN_CAMERA.fov * Math.PI / 360), aspect = HUMAN_CAMERA.width / HUMAN_CAMERA.height;
  return { x: HUMAN_CAMERA.width * (1 + right / (depth * tan * aspect)) / 2,
    y: HUMAN_CAMERA.height * (1 - up / (depth * tan)) / 2 };
}

export function unprojectPointer(pointer, camera, view, { minimap = false } = {}) {
  const angle = camera.yaw ?? HUMAN_CAMERA.yaw, s = Math.sin(angle), c = Math.cos(angle);
  if (minimap) {
    const size = 228, scale = size / Math.hypot(view.w * CELL, view.h * CELL);
    const a = (pointer.x - (HUMAN_CAMERA.width - 8 - size / 2)) / scale;
    const b = (pointer.y - (HUMAN_CAMERA.height - 8 - size / 2)) / scale;
    return { x: view.w * CELL / 2 + c * a + s * b, z: view.h * CELL / 2 - s * a + c * b };
  }
  const sin = Math.sin(HUMAN_CAMERA.pitch), cos = Math.cos(HUMAN_CAMERA.pitch);
  const tan = Math.tan(HUMAN_CAMERA.fov * Math.PI / 360), aspect = HUMAN_CAMERA.width / HUMAN_CAMERA.height;
  const nx = (pointer.x / HUMAN_CAMERA.width * 2 - 1) * tan * aspect, ny = (1 - pointer.y / HUMAN_CAMERA.height * 2) * tan;
  const dist = camera.distance ?? HUMAN_CAMERA.distance;
  const origin = { x: camera.x + s * dist * cos,
    y: groundHeight(camera, view) + dist * sin, z: camera.z + c * dist * cos };
  const ray = { x: -s * (cos + ny * sin) + c * nx, y: -sin + ny * cos, z: -c * (cos + ny * sin) - s * nx };
  let at = { x: camera.x, z: camera.z };
  for (let i = 0; i < 16; i++) {
    const t = (groundHeight(at, view) - origin.y) / ray.y;
    const next = { x: origin.x + ray.x * t, z: origin.z + ray.z * t };
    if (distance(at, next) < 1e-7) return next;
    at = next;
  }
  // Fixed-point iteration can oscillate where a crater crosses the ray. Resolve the actual
  // first intersection with the same continuous height proxy instead of returning the last guess.
  const end = Math.max(1, (CFG.minLevel * CFG.levelHeight - origin.y) / ray.y + 1);
  const surface = t => origin.y + ray.y * t - groundHeight({ x: origin.x + ray.x * t, z: origin.z + ray.z * t }, view);
  let lo = 0;
  for (let step = 1; step <= 64; step++) {
    let hi = end * step / 64;
    if (surface(hi) <= 0) {
      for (let j = 0; j < 32; j++) {
        const mid = (lo + hi) / 2;
        if (surface(mid) > 0) lo = mid; else hi = mid;
      }
      const t = (lo + hi) / 2;
      return { x: origin.x + ray.x * t, z: origin.z + ray.z * t };
    }
    lo = hi;
  }
  return at;
}

export function groundClickable(at, camera, view) {
  if (!isPoint(at)) return false;
  const pixel = projectPointer(at, camera, view);
  if (pixel.x < 0 || pixel.y < 0 || pixel.x > HUMAN_CAMERA.width || pixel.y > HUMAN_CAMERA.height) return false;
  return distance(at, unprojectPointer(pixel, camera, view)) <= 0.5;
}

const screenPoint = (u, camera, view) => projectPointer(u, camera, view, { elevation: 1 + (UNITS[u.type]?.air ? 20 : 0) });

function selectionHit(hands, view, pixel) {
  const own = knownOwn(view, hands.slot, [...view.units.keys()]).filter(u => onScreen(u, hands.camera, view));
  const near = candidates => candidates.map(u => ({ u, d: pixelDistance(screenPoint(u, hands.camera, view), pixel) }))
    .filter(({ u, d }) => d < (UNITS[u.type]?.building ? 60 : UNITS[u.type]?.infantry ? 32 : 45))
    .sort((a, b) => a.d - b.d || a.u.id - b.u.id)[0]?.u;
  return near(own.filter(u => !UNITS[u.type]?.structure)) ?? near(own.filter(u => UNITS[u.type]?.building));
}

function selectionBox(units, hands, view) {
  const points = units.map(u => screenPoint(u, hands.camera, view));
  return { x0: Math.min(...points.map(p => p.x)) - 2, x1: Math.max(...points.map(p => p.x)) + 2,
    y0: Math.min(...points.map(p => p.y)) - 2, y1: Math.max(...points.map(p => p.y)) + 2 };
}

function boxUnits(box, hands, view) {
  return [...view.units.values()].filter(u => u.owner === hands.slot && !UNITS[u.type]?.structure
    && knownOwn(view, hands.slot, [u.id]).length && onScreen(u, hands.camera, view)).filter(u => {
    const p = screenPoint(u, hands.camera, view);
    return p.x >= box.x0 && p.x <= box.x1 && p.y >= box.y0 && p.y <= box.y1;
  });
}

function enqueueOne(hands, cmd, view, context, at) {
  if (hands.queue.length >= 24) return false;
  pruneGroups(hands, view);
  let ids = cmd.orders ? cmd.orders.map(order => order[0]) : cmd.ids ?? [];
  if (cmd.t === 'buy' && ['classic', 'world'].includes(view.mode?.kind)) {
    const makers = [...view.units.values()].filter(u => u.owner === hands.slot && u.built >= 1 && UNITS[u.type]?.makes?.includes(cmd.unit)
      && (!cmd.from || u.id === cmd.from) && onScreen(u, hands.camera, view) && (u.queue?.length ?? 0) < 5);
    const producer = makers.sort((a, b) => (a.queue?.length ?? 0) - (b.queue?.length ?? 0) || a.id - b.id)[0];
    if (!producer) return false;
    ids = [producer.id]; cmd = { ...cmd, from: producer.id };
  }
  const panel = ids.length > 0 && ids.every(id => UNITS[view.units.get(id)?.type]?.air
    && view.airPanel?.some(row => row.id === id));
  const units = knownOwn(view, hands.slot, ids, panel), group = groupFor(hands, ids);
  if (panel && !['move', 'amove', 'attack', 'escort', 'fireat', 'stop', 'retreat'].includes(cmd.t)) return false;
  if (ids.length && units.length !== ids.length) return false;
  if (cmd.t === 'ability') {
    if (!units.length || units.some(u => !UNITS[u.type].ab || UNITS[u.type].ab.id === 'none')) return false;
    const aimed = ['grenade', 'barrage', 'satchel'].includes(UNITS[units[0].type].ab.id);
    if (aimed && !isPoint(at)) return false;
    if (!aimed) { at = null; cmd = { ...cmd }; delete cmd.x; delete cmd.z; }
  }
  if (cmd.t === 'stance') {
    if (!['holdFire', 'holdPos', 'autoRetreat'].includes(cmd.key)) return false;
    const bit = { holdFire: 2048, holdPos: 4096, autoRetreat: 8192 }[cmd.key];
    const wouldEnable = !units.every(u => u[cmd.key] === true || !!(u.flags & bit));
    if (cmd.on !== wouldEnable) return false;
  }
  if (ids.length && !panel && group === null && !units.every(u => onScreen(u, hands.camera, view))) return false;
  if (['attack', 'assist', 'board', 'escort'].includes(cmd.t)) {
    const target = view.units.get(cmd.target ?? cmd.id);
    if (!target || !onScreen(target, hands.camera, view)) return false;
    at = { x: target.x, z: target.z };
  }
  if (isPoint(at) && ['ability', 'support', 'build', 'dig', 'entrench', 'fireat'].includes(cmd.t)
    && !groundClickable(at, hands.camera, view)) return false;
  const minimap = isPoint(at) && !onScreen(at, hands.camera, view);
  if (minimap && !['move', 'amove', 'rally', 'attack'].includes(cmd.t)) return false;
  const key = JSON.stringify([cmd.t, ids, cmd.unit, cmd.kind, cmd.target, cmd.id, cmd.key, cmd.on,
    isPoint(at) ? [Math.round(at.x / 5), Math.round(at.z / 5)] : null, !!cmd.queue]);
  // Each authored purchase is a separate UI click and expense. Repeated orders still deduplicate.
  if (cmd.t !== 'buy' && (hands.active?.job?.key === key || hands.queue.some(job => job.key === key))) return false;
  // Snapshot only what the seat knew while it made this decision. A later wasted click is still a real input.
  hands.queue.push({ command: structuredClone(cmd), ids: [...ids], units: units.map(u => ({ ...u })),
    at: isPoint(at) ? { ...at } : null, minimap, panel, group, key,
    context: frozenContext(ids.length && Array.isArray(context.responseActorIds) ? subsetContext(context, ids) : context),
    queuedTick: hands.tick });
  return true;
}

// Inspecting selects a real own squad so the next delivered selection HUD can inform a decision.
// It neither creates an order nor binds a group just to acquire information.
export function queueInspection(hands, ids, view, context = {}) {
  if (!view || view.players[hands.slot]?.out || view.winner != null || hands.queue.length >= 24
    || !Array.isArray(ids) || ids.length !== 1 || sameIds(hands.selected, ids)) return false;
  pruneGroups(hands, view);
  const units = knownOwn(view, hands.slot, ids), group = groupFor(hands, ids);
  if (units.length !== 1 || units.some(u => UNITS[u.type]?.structure || UNITS[u.type]?.air
    || !UNITS[u.type]?.ab || UNITS[u.type].ab.id === 'none')) return false;
  if (group === null && !units.every(u => onScreen(u, hands.camera, view))) return false;
  const key = JSON.stringify(['inspection', ids]);
  if (hands.active?.job?.key === key || hands.queue.some(job => job.key === key)) return false;
  hands.queue.push({ inspect: true, ids: [...ids], units: units.map(u => ({ ...u })), at: null,
    panel: false, group, key, context: frozenContext(context), queuedTick: hands.tick });
  hands.ready = false;
  return true;
}

export function enqueueDecision(hands, cmd, view, context = {}) {
  if (!cmd || !view || view.players[hands.slot]?.out || view.winner != null) return false;
  if (cmd.t === 'orders') {
    let any = false;
    for (const child of cmd.commands ?? []) any = enqueueDecision(hands, { ...child, queue: cmd.queue }, view, context) || any;
    return any;
  }
  if (cmd.t === 'ability' && cmd.ids?.length > 1) {
    const byType = new Map();
    for (const unit of knownOwn(view, hands.slot, cmd.ids)) {
      const list = byType.get(unit.type) ?? []; list.push(unit); byType.set(unit.type, list);
    }
    let any = false;
    for (const units of byType.values()) {
      // F activates one selected type. The aimed client ability chooses one nearest ready squad per click.
      const ids = isPoint(cmd) ? [units.sort((a, b) => distance(a, cmd) - distance(b, cmd) || a.id - b.id)[0].id] : units.map(u => u.id);
      any = enqueueOne(hands, { ...cmd, ids }, view, context, isPoint(cmd) ? cmd : null) || any;
    }
    return any;
  }
  if (cmd.orders) {
    const clusters = [];
    for (const [id, x, z] of cmd.orders) {
      const u = view.units.get(id);
      if (!u || u.owner !== hands.slot) continue;
      const cluster = clusters.find(c => c.orders.length < 8 && distance(c.at, { x, z }) <= 10
        && c.units.every(other => !!UNITS[u.type]?.air === !!UNITS[other.type]?.air && distance(u, other) <= 45));
      if (cluster) { cluster.orders.push([id, x, z]); cluster.units.push(u); }
      else clusters.push({ orders: [[id, x, z]], units: [u], at: { x, z } });
    }
    let any = false;
    for (const c of clusters) {
      const at = { x: c.orders.reduce((sum, o) => sum + o[1], 0) / c.orders.length,
        z: c.orders.reduce((sum, o) => sum + o[2], 0) / c.orders.length };
      any = enqueueOne(hands, { ...cmd, orders: c.orders }, view, context, at) || any;
    }
    return any;
  }
  if (cmd.ids?.length > 8) {
    let any = false;
    for (let i = 0; i < cmd.ids.length; i += 8) any = enqueueDecision(hands, { ...cmd, ids: cmd.ids.slice(i, i + 8) }, view, context) || any;
    return any;
  }
  return enqueueOne(hands, cmd, view, context, isPoint(cmd) ? cmd : null);
}

function newestAlert(view, tick) {
  return (view?.alerts ?? []).map((event, index) => ({ ...event, index }))
    .filter(event => isPoint(event) && tick - event.tick < 120)
    .sort((a, b) => b.tick - a.tick || b.index - a.index)[0];
}

function matchesAlert(job, latest) {
  const id = job.context.event?.id;
  return latest && (id !== undefined ? id === latest.id : distance(job.at, latest) < 2);
}

export function queueCamera(hands, at, context = {}, mode = 'minimap') {
  if (!['minimap', 'pan', 'alert', 'group'].includes(mode)) return false;
  if (!isPoint(at) || distance(at, hands.camera) < 2 || hands.queue.length >= 24) return false;
  if (hands.active?.job?.camera || hands.queue.some(job => job.camera)) return false;
  let group = null, ids = [];
  if (mode === 'alert' && hands.lastView && !matchesAlert({ at, context }, newestAlert(hands.lastView, hands.tick))) mode = 'minimap';
  if (mode === 'group') {
    for (const [number, members] of hands.groups) {
      const units = members.map(id => hands.lastView?.units.get(id)).filter(Boolean);
      if (units.length && distance(centroid(units), at) < 8) { group = number; ids = members; at = centroid(units); break; }
    }
    if (group === null) return false;
  }
  hands.queue.push({ camera: true, at: { x: at.x, z: at.z }, mode, group, ids, context: frozenContext(context), queuedTick: hands.tick });
  hands.ready = false;
  return true;
}

const pixelDistance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export function fittsMovement(skill, from, to, width) {
  const d = pixelDistance(from, to), w = Math.max(1, width);
  return { from: { x: from.x, y: from.y }, to: { ...to }, distance: d, width: w,
    seconds: skill.pointer[0] + skill.pointer[1] * Math.log2(1 + d / w) };
}

function noisyPointer(hands, intended, width) {
  const index = Math.log2(1 + pixelDistance(hands.pointer, intended) / Math.max(1, width));
  // Endpoint noise is a provisional pixel distribution, not an error rate established by Fitts' law.
  const sigma = hands.skill.error * (1.5 + 0.35 * index) * Math.sqrt(0.085 / hands.skill.pointer[1]);
  const angle = random(hands.rng) * Math.PI * 2, radius = Math.sqrt(-2 * Math.log(Math.max(1e-9, random(hands.rng)))) * sigma;
  return { x: intended.x + Math.cos(angle) * radius, y: intended.y + Math.sin(angle) * radius };
}

function physicalKey(id) {
  const binding = bindings.find(key => key.id === id);
  return binding ? { code: binding.code, ctrl: binding.ctrl, shift: binding.shift, alt: binding.alt } : null;
}

// UI targets use a documented layout proxy inside the client's card/command regions. Their exact DOM boxes vary
// with faction, available cards and selected units. All travel and widths still use the same CSS-pixel units.
const uiTarget = kind => kind === 'buy' ? { x: 980, y: 1000, width: 80 }
  : kind === 'recover' ? { x: 980, y: 1000, width: 160 } : { x: 140, y: 740, width: 80 };

// Measured at1920x1080 in the actual human HUD with two snapshot aircraft (hud.js drawAir).
// The narrow row height is the Fitts width. The panel layout remains a fixed-viewport approximation.
function airRow(index) {
  const y0 = 184.09375 + index * 28.546875, height = 25.546875;
  return { x: HUMAN_CAMERA.width - 117, y: y0 + height / 2, width: height,
    x0: HUMAN_CAMERA.width - 217, x1: HUMAN_CAMERA.width - 17, y0, y1: y0 + height };
}

function airPanelHit(view, pixel) {
  return (view.airPanel ?? []).find((row, index) => {
    const box = airRow(index);
    return pixel.x >= box.x0 && pixel.x <= box.x1 && pixel.y >= box.y0 && pixel.y <= box.y1;
  });
}

function actionsFor(hands, job, view) {
  const context = job.context, actions = [];
  const add = (kind, at, extra = {}) => actions.push({ kind, at, context, ...extra });
  const key = (kind, id, extra = {}) => {
    const input = physicalKey(id);
    add(input ? kind : kind.replace(/-key$/, '-click'), null, input ? { input, ...extra } : { ui: uiTarget(id), input: { button: 0 }, ...extra });
  };
  if (hands.cancelTargeting) key('cancel-key', 'cancelAim');
  if (job.camera) {
    if (job.mode === 'alert') {
      const latest = newestAlert(view, hands.tick);
      if (matchesAlert(job, latest)) { job.at = { x: latest.x, z: latest.z }; job.alertId = latest.id; }
      else job.mode = 'minimap';
    }
    if (job.mode === 'group') key('group-recall', `group:recall:${job.group}`, { ids: job.ids, group: job.group });
    let pan = null;
    if (job.mode === 'pan') {
      const angle = hands.camera.yaw ?? 0, s = Math.sin(angle), c = Math.cos(angle);
      const dx = job.at.x - hands.camera.x, dz = job.at.z - hands.camera.z;
      const right = dx * c - dz * s, forward = dx * s + dz * c;
      const horizontal = Math.abs(right) >= Math.abs(forward), amount = horizontal ? right : forward;
      const hold = ticks(Math.abs(amount) / HUMAN_CAMERA.panSpeed), travel = Math.sign(amount) * HUMAN_CAMERA.panSpeed * hold / 20;
      pan = { hold, code: horizontal ? amount >= 0 ? 'KeyD' : 'KeyA' : amount >= 0 ? 'KeyS' : 'KeyW',
        at: clampPoint({ x: hands.camera.x + (horizontal ? c : s) * travel,
          z: hands.camera.z + (horizontal ? -s : c) * travel }, view) };
    }
    add(job.mode === 'pan' ? 'camera-pan' : `camera-${job.mode}`, pan?.at ?? job.at, { camera: true, mode: job.mode,
      ...(job.mode === 'minimap' ? { input: { button: 0 }, noise: true } : {}),
      ...(job.mode === 'alert' ? { input: physicalKey('alert') } : {}),
      ...(pan ? { input: { code: pan.code }, panHold: pan.hold } : {}),
      ...(job.mode === 'group' ? { ids: job.ids, group: job.group, input: physicalKey(`group:recall:${job.group}`) } : {}) });
    return actions;
  }
  if (job.ids.length && (!sameIds(hands.selected, job.ids) || job.panel && hands.selectionOrigin !== 'air-panel')) {
    const group = groupFor(hands, job.ids);
    if (job.panel) {
      for (let i = 0; i < job.ids.length; i++) {
        const index = (view.airPanel ?? []).findIndex(row => row.id === job.ids[i]);
        if (index < 0) return [];
        add('select-air-panel', null, { ids: job.ids.slice(0, i + 1), ui: airRow(index), noise: true, input: { button: 0, shift: i > 0 } });
      }
    }
    else if (group !== null) key('group-recall', `group:recall:${group}`, { ids: job.ids, group });
    else {
      if (!job.units.every(u => onScreen(u, hands.camera, view))) return [];
      const box = job.ids.length > 1 ? selectionBox(job.units, hands, view) : null;
      if (box && sameIds(boxUnits(box, hands, view).map(u => u.id), job.ids)) add('select-box', centroid(job.units), { ids: job.ids, box, input: { button: 0 } });
      else for (let i = 0; i < job.units.length; i++) {
        add(i ? 'select-add-click' : 'select-click', job.units[i], { ids: job.ids.slice(0, i + 1), clickedId: job.units[i].id,
          input: { button: 0, shift: i > 0 }, unitTarget: true, noise: true });
      }
    }
  }
  if (job.inspect) return actions;
  if (!namedActorSelected(hands, job) && !actions.some(selectsUnits)) return [];
  const cmd = job.command;
  if (isPoint(job.at) && ['ability', 'support', 'build', 'dig', 'entrench', 'fireat'].includes(cmd.t)
    && !groundClickable(job.at, hands.camera, view)) return [];
  job.minimap = isPoint(job.at) && !onScreen(job.at, hands.camera, view);
  if (cmd.t === 'amove') {
    if (job.minimap) add('attack-key', null, { input: { code: 'ControlLeft', ctrl: true } });
    else key('attack-key', 'amove');
  }
  if (cmd.t === 'ability') {
    const priority = new Set(['rifle', 'ranger', 'commando', 'conscript', 'mg', 'mortar', 'howitzer', 'at', 'armoredcar', 'tank', 'medium', 'tankdestroyer', 'tiger', 'churchill', 'rocket']);
    if (job.units.every(u => priority.has(u.type))) key('ability-key', 'ability');
    else add('ability-click', null, { ui: uiTarget('ability'), input: { button: 0 } });
  }
  if (cmd.t === 'support') key('support-key', `support:${cmd.kind}`);
  if (cmd.t === 'build') key('build-key', `build:${cmd.kind}`);
  if (cmd.t === 'dig') key('build-key', `fort:${cmd.kind}`);
  if (cmd.t === 'entrench') {
    if (cmd.pattern && cmd.pattern !== 'line') add('build-menu-click', null, { ui: uiTarget('entrench-menu'), input: { button: 0 } });
    key('build-key', cmd.pattern === 'line' || !cmd.pattern ? 'entrench:line' : `entrench:${cmd.pattern}`);
  }
  if (cmd.t === 'fireat') key('area-key', 'area');
  if (cmd.t === 'buy' || cmd.t === 'recover') add('buy-click', null, { fire: true, ui: uiTarget(cmd.t), input: { button: 0 } });
  else if (cmd.t === 'ability' && !job.at) actions[actions.length - 1].fire = true;
  else if (!job.at) key(`${cmd.t}-key`, cmd.t === 'stance' ? `stance:${cmd.key}` : cmd.t, { fire: true });
  else {
    if (['assist', 'board', 'escort'].includes(cmd.t) && !onScreen(job.at, hands.camera, view)) return [];
    job.minimap = !onScreen(job.at, hands.camera, view);
    if (job.minimap && !['move', 'amove', 'rally', 'attack'].includes(cmd.t)) return [];
    const unitTarget = !job.minimap && ['attack', 'assist', 'board', 'escort'].includes(cmd.t);
    const targetType = unitTarget ? view.units.get(cmd.target ?? cmd.id)?.type : null;
    const queued = cmd.queue ? { shift: true } : {};
    if (['dig', 'entrench'].includes(cmd.t) || (cmd.t === 'support' && !SUPPORT[cmd.kind]?.point)) {
      // These client gestures pin a centre, then use a second click to set the direction or endpoint.
      add('place-anchor', job.at, { pointRole: 'anchor', noise: true, input: { button: 0, ...queued } });
      const endpoint = cmd.t === 'entrench' && Number.isFinite(cmd.x2) && Number.isFinite(cmd.z2)
        ? { x: cmd.x2, z: cmd.z2 } : { x: job.at.x + Math.cos(cmd.dir ?? 0) * 4, z: job.at.z + Math.sin(cmd.dir ?? 0) * 4 };
      if (!groundClickable(endpoint, hands.camera, view)) return [];
      add('place-click', endpoint, { fire: true, pointRole: 'endpoint', noise: true, input: { button: 0, ...queued } });
      return actions;
    }
    const left = !job.minimap && ['ability', 'support', 'build', 'dig', 'entrench', 'amove', 'fireat'].includes(cmd.t);
    add(job.minimap ? 'minimap-rightclick' : left ? 'place-click' : 'rightclick', job.at,
      { fire: true, pointRole: 'target', noise: true, unitTarget, targetType,
        ...(unitTarget && { trackingId: cmd.target ?? cmd.id }),
        input: { button: left ? 0 : 2, ...queued, ...(cmd.t === 'amove' && job.minimap ? { ctrl: true } : {}) } });
  }
  return actions;
}

const cameraPose = (camera, view) => [camera.x, camera.z, camera.y ?? groundHeight(camera, view),
  camera.yaw ?? HUMAN_CAMERA.yaw, camera.distance ?? HUMAN_CAMERA.distance].join(',');

function collectTargetSamples(hands, active, view) {
  if (!active.targetSamples) {
    active.targetSamples = new Map(active.actions.filter(action => action.unitTarget)
      .map(action => action.clickedId ?? action.trackingId).filter(Number.isSafeInteger)
      .map(id => [id, { pose: cameraPose(hands.camera, view), samples: [] }]));
  }
  for (const [id, history] of active.targetSamples) {
    if (history.frozen) continue;
    if (history.pose !== cameraPose(hands.camera, view)) { history.frozen = true; continue; }
    const unit = view.units.get(id);
    if (!unit || unit.hp <= 0 || unit.inventoryOnly || !view.screenIds?.has(id)
      || !onScreen(unit, hands.camera, view)) continue;
    if (!history.samples.length || view.tick > history.samples.at(-1).tick) {
      history.samples.push({ tick: view.tick, point: screenPoint(unit, hands.camera, view) });
      if (history.samples.length > 32) history.samples.shift();
    }
  }
}

function laggedAim(hands, action, tick, view) {
  const tracking = action.tracking, history = tracking?.history;
  if (!history || history.frozen) return null;
  const unit = view.units.get(tracking.id);
  if (!unit || unit.hp <= 0 || unit.inventoryOnly || !view.screenIds?.has(unit.id)
    || !onScreen(unit, hands.camera, view)) return null;
  const sample = history.samples.findLast(sample => sample.tick <= tick - tracking.lag);
  return sample && { x: sample.point.x + tracking.error.x, y: sample.point.y + tracking.error.y };
}

function trackPointerTarget(hands, tick, view) {
  const active = hands.active;
  if (!active) return;
  collectTargetSamples(hands, active, view);
  const action = active.actions[active.index], tracking = action?.tracking;
  if (!tracking || active.reacting || tick <= active.start || tick > active.due) return;
  const aim = laggedAim(hands, action, tick, view);
  if (!aim) return;
  const endpoint = action.screenClick, d = pixelDistance(aim, endpoint);
  if (d < 1e-8) return;
  tracking.moved = true;
  const budget = action.motor.width / action.duration * Math.max(0, tick - tracking.correctedAt);
  const p = d ? Math.min(1, budget / d) : 0;
  endpoint.x += (aim.x - endpoint.x) * p; endpoint.y += (aim.y - endpoint.y) * p;
  tracking.correctedAt = tick;
  hands.pointer.toX = endpoint.x; hands.pointer.toY = endpoint.y;
  action.outsideScreen = endpoint.x < 0 || endpoint.y < 0
    || endpoint.x > HUMAN_CAMERA.width || endpoint.y > HUMAN_CAMERA.height;
}

function trackedClick(hands, active, action, view) {
  if (!action.tracking?.moved) return;
  action.screenClick = { x: hands.pointer.x, y: hands.pointer.y };
  action.motor.plannedTo = { ...action.motor.to };
  action.motor.to = { ...action.screenClick };
  action.motor.endpointDistance = pixelDistance(action.motor.from, action.screenClick);
  action.at = clampPoint(unprojectPointer(action.screenClick, hands.camera, view), view);
  if (action.pointRole === 'target') {
    active.job.clickedAt = { ...action.at }; active.job.clickPixel = { ...action.screenClick };
  }
}

const subsetOrders = new Set(['move', 'amove', 'attack', 'retreat', 'stop', 'cover']);
function subsetContext(context, ids) {
  const serves = event => event?.kind !== 'screen-damage' || ids.includes(event.unitId);
  const copy = { ...context, responseActorIds: [...ids] };
  if (copy.event && !serves(copy.event)) { delete copy.event; delete copy.eventTick; }
  if (copy.responseEvents) copy.responseEvents = copy.responseEvents.filter(serves);
  return copy;
}

function selectionContinues(hands, active, view) {
  const job = active.job;
  if (sameIds(hands.selected, job.ids)) return true;
  if (job.inspect || !subsetOrders.has(job.command?.t)
    || hands.selected.some(id => !job.ids.includes(id)) || !namedActorSelected(hands, job)) return false;
  if (active.actions.slice(active.index + 1).some(selectsUnits)) return true;
  if (!hands.selected.length) return false;
  const units = knownOwn(view, hands.slot, hands.selected, job.panel);
  if (units.length !== hands.selected.length) return false;
  job.ids = job.ids.filter(id => hands.selected.includes(id));
  job.units = units.map(unit => ({ ...unit }));
  if (job.command.orders) job.command.orders = job.command.orders.filter(row => job.ids.includes(row[0]));
  if (job.command.ids) job.command.ids = [...job.ids];
  job.context = subsetContext(job.context, job.ids);
  active.actions = active.actions.filter((action, index) => index <= active.index
    || action.kind !== 'group-set' || job.ids.length >= 2);
  const following = selectsUnits(active.actions[active.index]) ? active.index + 1 : active.index;
  for (const action of active.actions.slice(following)) {
    action.context = subsetContext(action.context, job.ids);
    if (action.kind === 'group-set') action.ids = [...job.ids];
  }
  return true;
}

function prepareAction(hands, active) {
  const action = active.actions[active.index];
  const key = action.input?.code || action.input?.codes;
  let duration = key ? ticks(skewedDelay(hands, hands.skill.key)) : 1;
  if (!key) {
    const minimap = action.kind.includes('minimap') || (action.camera && action.mode === 'minimap');
    const targetType = action.targetType ?? action.at?.type;
    const width = action.ui?.width ?? (minimap ? 10 * 228 / 240 : action.unitTarget
      ? UNITS[targetType]?.building ? 120 : UNITS[targetType]?.infantry ? 64 : 90 : 32);
    const intended = action.ui ? { x: action.ui.x, y: action.ui.y } : action.box
      ? { x: action.box.x1, y: action.box.y1 } : projectPointer(action.at, hands.camera, hands.lastView,
        { minimap, elevation: action.unitTarget ? 1 + (UNITS[targetType]?.air ? 20 : 0) : 0 });
    const endpoint = action.noise ? noisyPointer(hands, intended, width) : intended;
    action.screenClick = endpoint;
    action.outsideScreen = !action.ui && !minimap && (endpoint.x < 0 || endpoint.y < 0
      || endpoint.x > HUMAN_CAMERA.width || endpoint.y > HUMAN_CAMERA.height);
    action.motor = fittsMovement(hands.skill, hands.pointer, endpoint, width);
    if (action.box) {
      const corner = { x: action.box.x0, y: action.box.y0 };
      const approach = fittsMovement(hands.skill, hands.pointer, corner, width);
      const drag = fittsMovement(hands.skill, corner, endpoint, width);
      action.motor.seconds = approach.seconds + drag.seconds + 0.16;
      action.motor.distance = approach.distance + drag.distance;
      action.motor.via = corner;
      action.motor.approachFraction = approach.seconds / action.motor.seconds;
    }
    duration = ticks(action.motor.seconds);
    const trackingId = action.clickedId ?? action.trackingId;
    const history = active.targetSamples?.get(trackingId);
    if (action.unitTarget && !minimap && !action.ui && !action.box && history?.samples.length) action.tracking = {
      id: trackingId, history,
      // Reuse the existing motor lower bound. This is an authored tracking choice, not a human measurement.
      lag: ticks(hands.skill.key[0]), error: { x: endpoint.x - intended.x, y: endpoint.y - intended.y },
      correctedAt: hands.tick, pointerAt: hands.tick,
    };
    if (!action.ui && !action.box) {
      const ground = unprojectPointer(endpoint, hands.camera, hands.lastView, { minimap });
      const minimapOrder = action.kind === 'minimap-rightclick' && ['move', 'amove', 'attack'].includes(active.job.command?.t);
      // Human minimap right clicks dispatch anywhere inside its canvas. Formation clamps final slots to the map.
      action.outsideMinimap = minimapOrder
        ? endpoint.x < HUMAN_CAMERA.width - 236 || endpoint.x > HUMAN_CAMERA.width - 8
          || endpoint.y < HUMAN_CAMERA.height - 236 || endpoint.y > HUMAN_CAMERA.height - 8
        : minimap && (ground.x < 0 || ground.z < 0 || ground.x > hands.lastView.w * CELL || ground.z > hands.lastView.h * CELL);
      const clicked = action.unitTarget ? { x: action.at.x, z: action.at.z } : minimapOrder ? ground : clampPoint(ground, hands.lastView);
      action.at = clicked;
      if (action.pointRole === 'anchor' || action.pointRole === 'target') active.job.clickedAt = clicked;
      if (action.pointRole === 'target') active.job.clickPixel = { ...endpoint };
      if (action.pointRole === 'endpoint') active.job.endClick = clicked;
    }
  }
  if (action.camera && action.mode === 'pan') { action.panPrep = duration; duration += action.panHold; }
  action.duration = duration;
}

function scheduleAction(hands, active, tick) {
  const action = active.actions[active.index];
  if (action.duration === undefined) prepareAction(hands, active);
  const duration = action.duration;
  if (action.screenClick) {
    const pointer = hands.pointer, endpoint = action.screenClick;
    if (action.tracking) {
      const aim = laggedAim(hands, action, tick, hands.lastView);
      if (aim && pixelDistance(aim, endpoint) > 1e-8) {
        action.tracking.moved = true;
        // The approach starts at the real pointer. One target width bounds visual reacquisition.
        const distance = pixelDistance(pointer, aim), budget = action.motor.distance + action.motor.width;
        const fraction = distance ? Math.min(1, budget / distance) : 0;
        endpoint.x = pointer.x + (aim.x - pointer.x) * fraction;
        endpoint.y = pointer.y + (aim.y - pointer.y) * fraction;
      }
      action.tracking.pointerAt = tick;
      action.outsideScreen = endpoint.x < 0 || endpoint.y < 0
        || endpoint.x > HUMAN_CAMERA.width || endpoint.y > HUMAN_CAMERA.height;
    }
    Object.assign(pointer, { fromX: pointer.x, fromY: pointer.y, toX: endpoint.x, toY: endpoint.y,
      startTick: tick, endTick: tick + duration, mode: action.ui ? 'ui' : action.kind.includes('minimap') ? 'minimap' : 'screen',
      via: action.motor.via ?? null, viaFraction: action.motor.approachFraction ?? null });
  }
  active.start = tick; active.due = tick + duration; action.startedTick = tick;
  if (action.tracking) action.tracking.correctedAt = tick;
  if (action.screenClick && action.at) Object.assign(hands.cursor, { fromX: hands.cursor.x, fromZ: hands.cursor.z,
    toX: action.at.x, toZ: action.at.z, startTick: tick, endTick: active.due });
  if (action.camera) active.cameraFrom = { ...hands.camera };
}

function prepareOpening(hands, active) {
  const original = hands.pointer, index = active.index;
  hands.pointer = { ...original };
  let duration = 0;
  try {
    for (active.index = 0; active.index < active.actions.length; active.index++) {
      prepareAction(hands, active);
      const action = active.actions[active.index]; duration += action.duration;
      if (action.screenClick) Object.assign(hands.pointer, action.screenClick);
    }
  } finally { hands.pointer = original; active.index = index; }
  return duration;
}

function updatePointer(hands, tick, view) {
  const action = hands.active?.actions[hands.active.index], tracking = action?.tracking;
  const previous = { x: hands.pointer.x, y: hands.pointer.y };
  const pointer = hands.pointer, p = Math.min(1, Math.max(0, (tick - pointer.startTick) / Math.max(1, pointer.endTick - pointer.startTick)));
  if (pointer.via) {
    const press = pointer.viaFraction ?? 0.5, approaching = p < press;
    const fraction = approaching ? p / press : (p - press) / (1 - press);
    const a = approaching ? { x: pointer.fromX, y: pointer.fromY } : pointer.via;
    const b = approaching ? pointer.via : { x: pointer.toX, y: pointer.toY };
    pointer.x = a.x + (b.x - a.x) * fraction; pointer.y = a.y + (b.y - a.y) * fraction;
  } else {
    pointer.x = pointer.fromX + (pointer.toX - pointer.fromX) * p;
    pointer.y = pointer.fromY + (pointer.toY - pointer.fromY) * p;
  }
  if (tracking?.moved && !hands.active.reacting) {
    const budget = (action.motor.distance + action.motor.width) / action.duration
      * Math.max(0, tick - tracking.pointerAt);
    const distance = pixelDistance(previous, pointer), fraction = distance ? Math.min(1, budget / distance) : 0;
    pointer.x = previous.x + (pointer.x - previous.x) * fraction;
    pointer.y = previous.y + (pointer.y - previous.y) * fraction;
  }
  if (tracking) tracking.pointerAt = tick;
  if (pointer.mode !== 'ui') {
    const at = unprojectPointer(pointer, hands.camera, view, { minimap: pointer.mode === 'minimap' });
    hands.cursor.x = at.x; hands.cursor.z = at.z;
  }
}

// A pointer approach can stop before its button press. Held drags/pans and key gestures
// finish through the existing completion path, so no physical release is silently discarded.
export function interruptHands(hands, tick, view = hands.lastView) {
  if (tick < hands.tick) throw new Error('AI input clock cannot run backwards');
  const active = hands.active, action = active?.actions[active.index];
  // Ctrl+minimap-click is one held-modifier gesture. Finish its click/release rather than abandon Ctrl.
  if (active && !active.reacting && (active.modifierHeld || action?.input?.code === 'ControlLeft')) {
    hands.interruptAfterInput = false; active.interruptAfterCommand = true; return false;
  }
  const approach = action?.screenClick
    && (!action.box || tick < active.start + action.duration * action.motor.approachFraction);
  if (active && !active.reacting && !approach) {
    hands.interruptAfterInput = true;
    return false;
  }
  if (active?.armed) hands.cancelTargeting = true;
  if (approach && view) updatePointer(hands, tick, view);
  const pointer = hands.pointer;
  Object.assign(pointer, { fromX: pointer.x, fromY: pointer.y, toX: pointer.x, toY: pointer.y,
    startTick: tick, endTick: tick, via: null, viaFraction: null });
  Object.assign(hands.cursor, { fromX: hands.cursor.x, fromZ: hands.cursor.z,
    toX: hands.cursor.x, toZ: hands.cursor.z, startTick: tick, endTick: tick });
  hands.active = null; hands.interruptAfterInput = false;
  hands.ready = tick >= hands.openingUntil && !hands.queue.length;
  return true;
}

function commandFor(hands, job, view) {
  const cmd = { ...job.command };
  if (['attack', 'assist', 'board', 'escort'].includes(cmd.t) && !job.minimap) {
    const friendly = u => u.owner === hands.slot || view.players[hands.slot]?.team !== undefined
      && view.players[u.owner]?.team === view.players[hands.slot].team;
    const targets = [...view.units.values()].filter(u => (cmd.t === 'attack' ? !friendly(u)
      : cmd.t === 'escort' ? friendly(u) : cmd.t === 'board' ? u.owner === hands.slot && UNITS[u.type]?.carries
        : u.owner === hands.slot && UNITS[u.type]?.building)
      && (view.screenIds ? view.screenIds.has(u.id) : onScreen(u, hands.camera, view)));
    const target = targets.map(u => ({ u, d: pixelDistance(screenPoint(u, hands.camera, view), job.clickPixel) }))
      .filter(({ u, d }) => d < (UNITS[u.type].building ? 60 : UNITS[u.type].infantry ? 32 : 45)).sort((a, b) => a.d - b.d)[0]?.u;
    if (target) { if (cmd.t === 'assist') cmd.id = target.id; else cmd.target = target.id; }
    else {
      job.clickedAt = clampPoint(unprojectPointer(job.clickPixel, hands.camera, view), view);
      cmd.t = 'move'; cmd.orders = job.ids.map(id => [id, job.clickedAt.x, job.clickedAt.z]); delete cmd.ids; delete cmd.target; delete cmd.id;
    }
  }
  if (job.minimap && ['attack', 'move', 'amove'].includes(cmd.t)) {
    // The client's minimap dispatcher snaps to the nearest delivered dot within five canvas pixels.
    const radius = 5 * Math.hypot(view.w * CELL, view.h * CELL) / 240;
    // Only the motor dispatcher sees the raw identity. Planning receives anonymous dots and chooses a position.
    const cursor = hands.resolveMinimap?.(job.clickedAt, radius);
    const target = Number.isSafeInteger(cursor) ? cursor : cursor?.enemyId;
    const friend = cursor?.friendId;
    if (job.units.every(u => UNITS[u.type]?.air) && Number.isSafeInteger(friend)) {
      cmd.t = 'escort'; cmd.ids = [...job.ids]; cmd.target = friend; delete cmd.orders;
    } else if (Number.isSafeInteger(target)) { cmd.t = 'attack'; cmd.ids = [...job.ids]; cmd.target = target; delete cmd.orders; }
    else if (cmd.t === 'attack') { cmd.t = 'move'; cmd.orders = job.ids.map(id => [id, job.clickedAt.x, job.clickedAt.z]); delete cmd.ids; delete cmd.target; }
  }
  if (cmd.orders) {
    const units = hands.selected.map(id => view.units.get(id) ?? job.units.find(old => old.id === id)).filter(Boolean);
    cmd.orders = formation(units, job.clickedAt, { defs: UNITS, cell: CELL, width: view.w * CELL, height: view.h * CELL,
      face: cmd.face, shape: 'line', spread: 1, snap: true,
      terrainAt: (x, z) => x >= 0 && z >= 0 && x < view.w && z < view.h && !!(view.flags[z * view.w + x] & TRENCH) });
    cmd.together = true;
  } else if (isPoint(job.clickedAt) && isPoint(cmd)) Object.assign(cmd, job.clickedAt);
  if (job.endClick) {
    if (cmd.t === 'entrench') { cmd.x2 = job.endClick.x; cmd.z2 = job.endClick.z; }
    else cmd.dir = Math.atan2(job.endClick.z - job.clickedAt.z, job.endClick.x - job.clickedAt.x);
  }
  return cmd;
}

export function advanceHands(hands, tick, view, submit) {
  if (tick < hands.tick) throw new Error('AI input clock cannot run backwards');
  hands.tick = tick;
  hands.lastView = view;
  pruneGroups(hands, view);
  pruneOperationHistory(hands, view);
  hands.ready = tick >= hands.openingUntil && !hands.active && !hands.queue.length;
  if (view.players[hands.slot]?.out || view.winner != null) { hands.queue.length = 0; hands.active = null; return null; }
  trackPointerTarget(hands, tick, view);
  updatePointer(hands, tick, view);
  if (hands.interruptAfterInput && (!hands.active || hands.active.reacting)) {
    hands.active = null; hands.interruptAfterInput = false;
    hands.ready = tick >= hands.openingUntil && !hands.queue.length;
  }
  if (tick < hands.openingUntil) return null;
  if (!hands.active) {
    let job, actions;
    while (hands.queue.length && !actions?.length) {
      job = hands.queue.shift(); actions = actionsFor(hands, job, view);
    }
    if (!actions?.length) return null;
    hands.concern = job.context.concern ?? hands.concern;
    const active = hands.active = { job, actions, index: 0 };
    collectTargetSamples(hands, active, view);
    const opening = !hands.openingDone && actions.some(action => action.fire);
    const duration = opening ? prepareOpening(hands, active) : (prepareAction(hands, active), actions[0].duration);
    const reaction = Math.max(actions[0].camera ? 0 : minimumResponseTick(job.context) - tick - actions[0].duration,
      opening && !job.context.event && !causalLinks(job.context).length ? Math.max(0, hands.openingDeadline - tick - duration)
        : Math.max(opening ? hands.openingDeadline - tick - duration : 0,
          reactionDelay(hands, job.context, tick, actions[0].duration, !actions[0].camera)));
    if (reaction > 0) Object.assign(active, { due: tick + reaction, reacting: true });
    else scheduleAction(hands, active, tick);
    return null;
  }
  const active = hands.active, action = active.actions[active.index];
  if (active.reacting) {
    if (tick < active.due || (action.camera && !affordableInput(hands, tick))) return null;
    active.reacting = false; scheduleAction(hands, active, tick); return null;
  }
  if (action.camera && action.mode === 'pan') {
    const p = Math.max(0, Math.min(1, (tick - active.start - action.panPrep) / action.panHold));
    hands.camera.x = active.cameraFrom.x + (action.at.x - active.cameraFrom.x) * p;
    hands.camera.z = active.cameraFrom.z + (action.at.z - active.cameraFrom.z) * p;
    updatePointer(hands, tick, view);
  }
  if (tick < active.due || !affordableInput(hands, tick)) return null;
  if (!action.camera && tick < minimumResponseTick(action.context)) return null;
  if (action.outsideMinimap || action.outsideScreen) {
    if (active.armed) hands.cancelTargeting = true;
    emit(hands, action); hands.active = null; hands.ready = !hands.queue.length; return null;
  }
  if (action.fire && !hands.openingDone && tick < hands.openingDeadline) return null;
  if (action.fire && hands.lastCommandTick === tick) return null;
  if (action.fire && active.job.at && hands.lastCommandTarget && distance(active.job.at, hands.lastCommandTarget) > 90
    && tick - hands.lastCommandTick < 5) return null;
  if (action.camera && action.mode === 'group' && (hands.lastGroup !== action.group || tick - hands.lastGroupTick > 6)) {
    emit(hands, action); hands.active = null; return null;
  }
  if (action.camera && action.mode === 'group') {
    const units = knownOwn(view, hands.slot, hands.groups.get(action.group) ?? []);
    if (!units.length) { emit(hands, action); hands.active = null; return null; }
    action.at = centroid(units);
  }
  if (action.camera && action.mode === 'alert') {
    const latest = newestAlert(view, tick);
    // Space goes to the newest current line even if another alert arrived during the key press.
    if (!latest) { emit(hands, action); hands.active = null; return null; }
    action.at = { x: latest.x, z: latest.z };
  }
  if (action.camera) Object.assign(hands.camera, action.at);
  updatePointer(hands, tick, view);
  trackedClick(hands, active, action, view);
  if (action.ids && ['select-box', 'select-click', 'select-add-click'].includes(action.kind)) {
    if (action.box) hands.selected = boxUnits(action.box, hands, view).map(u => u.id);
    else {
      const hit = selectionHit(hands, view, action.screenClick);
      if (!action.input.shift) hands.selected = [];
      if (hit) {
        if (action.input.shift && hands.selected.includes(hit.id)) hands.selected = hands.selected.filter(id => id !== hit.id);
        else hands.selected.push(hit.id);
      }
    }
    hands.selectionOrigin = 'screen';
    if (!sameIds(hands.selected, action.ids) && !selectionContinues(hands, active, view)) {
      emit(hands, action); hands.active = null; return null;
    }
  }
  if (action.kind === 'select-air-panel') {
    const hit = airPanelHit(view, action.screenClick);
    if (!action.input.shift) hands.selected = [];
    if (hit) {
      if (action.input.shift && hands.selected.includes(hit.id)) hands.selected = hands.selected.filter(id => id !== hit.id);
      else hands.selected.push(hit.id);
    }
    hands.selectionOrigin = 'air-panel';
    if (!sameIds(hands.selected, action.ids)) { emit(hands, action); hands.active = null; return null; }
  }
  if (action.kind === 'group-recall' || action.kind === 'camera-group') {
    hands.selected = [...(hands.groups.get(action.group) ?? [])]; hands.lastGroup = action.group; hands.lastGroupTick = tick;
    hands.groupUse.set(action.group, tick);
    hands.selectionOrigin = 'group';
  }
  if (action.kind === 'group-set') {
    hands.groups.set(action.group, [...hands.selected]); hands.groupUse.set(action.group, tick);
  }
  let cmd = null;
  if (action.fire) {
    if (active.job.ids.length && !sameIds(hands.selected, active.job.ids)
      && !selectionContinues(hands, active, view)) {
      emit(hands, action); hands.active = null; hands.ready = !hands.queue.length; return null;
    }
    const local = active.job.units.every(old => onScreen(view.units.get(old.id) ?? old, hands.camera, view));
    // The commander deliberately requires a current screen, a real group recall or a minimap order. The client
    // itself allows a persistent selection to act after walking off screen; this stricter rule wastes that input.
    const panelMission = active.job.panel && hands.selectionOrigin === 'air-panel' && active.job.units.every(u => UNITS[u.type]?.air);
    if (!local && !panelMission && hands.selectionOrigin !== 'group' && action.kind !== 'minimap-rightclick') {
      emit(hands, action); hands.active = null; hands.ready = !hands.queue.length; return null;
    }
    // Every issuing selection was made by a click, a box drag or a group recall.
    if (active.job.ids.length && !sameIds(hands.selected, active.job.ids)) {
      emit(hands, action); hands.active = null; hands.ready = !hands.queue.length; return null;
    }
    const selectedGroup = groupFor(hands, hands.selected);
    if (selectedGroup !== null) hands.groupUse.set(selectedGroup, tick);
    cmd = commandFor(hands, active.job, view);
    hands.lastCommandTick = tick; hands.lastCommandTarget = active.job.at; hands.openingDone = true;
    const result = submit(cmd);
    if (result === undefined) acceptedOperation(hands, active, cmd, view);
  }
  const interrupted = emit(hands, action, cmd);
  if (action.kind === 'cancel-key') hands.cancelTargeting = false;
  if (armsTargeting(action)) active.armed = true;
  if (action.input?.code === 'ControlLeft') active.modifierHeld = true;
  if (interrupted) return cmd;
  // Read the actual selection before starting an order for the attended idle squad.
  // A split or missed selection can leave only its companion selected. Keep that HUD and retry later.
  if (!active.job.inspect && !namedActorSelected(hands, active.job)
    && !active.actions.slice(active.index + 1).some(selectsUnits)) {
    hands.active = null; hands.ready = !hands.queue.length; return null;
  }
  active.index++;
  if (active.index >= active.actions.length) hands.active = null;
  else scheduleAction(hands, active, tick);
  hands.ready = !hands.active && !hands.queue.length;
  return cmd;
}

export function diagnostics(hands, tick = hands.tick) {
  const footprint = cameraFootprint(hands.camera);
  return { slot: hands.slot, camera: { x: hands.camera.x, z: hands.camera.z,
    w: Math.max(...footprint.map(p => p.x)) - Math.min(...footprint.map(p => p.x)),
    h: Math.max(...footprint.map(p => p.z)) - Math.min(...footprint.map(p => p.z)), corners: footprint },
    cursor: { ...hands.cursor, pixelX: hands.pointer.x, pixelY: hands.pointer.y, mode: hands.pointer.mode },
    clicks: hands.clicks.filter(click => tick - click.tick < 40).map(click => ({ ...click })),
    selected: hands.selected.length, concern: hands.concern };
}
