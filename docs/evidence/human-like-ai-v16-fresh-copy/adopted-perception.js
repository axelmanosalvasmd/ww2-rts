// Detail belongs to one camera. Delivered rows outside it supply only minimap dots.
import { CELL, CFG, UNITS, abCost } from './sim.js';
import { deriveAlertEvents } from './alert-events.js';
import { armedContactActor } from './ai-priority.js';

// Match start uses distance 60 and a heading toward the map centre. Normal pan speed is dist*1.1.
export const HUMAN_CAMERA = Object.freeze({ width: 1920, height: 1080, fov: 42, pitch: 0.95, distance: 60, yaw: 0, panSpeed: 66, markerHeight: 1, aircraftAltitude: 20 });
export const SCREEN_MEMORY_SECONDS = 60;
export const SCREEN_CONTACT_QUIET_TICKS = 200;
export const SCREEN_RESPONSE_POLICY = 'screen-v1';
export const OBSERVED_RESPONSE_POLICY = 'screen-observed-v1';
const tangent = Math.tan(HUMAN_CAMERA.fov * Math.PI / 360), aspect = HUMAN_CAMERA.width / HUMAN_CAMERA.height;
const sin = Math.sin(HUMAN_CAMERA.pitch), cos = Math.cos(HUMAN_CAMERA.pitch);
const unsupportedCopy = Symbol('unsupported detached graph');
function copyData(value, seen) {
  if (value === null) return value;
  const type = typeof value;
  if (type === 'function' || type === 'symbol') throw unsupportedCopy;
  if (type !== 'object') return value;
  if (seen.has(value)) return seen.get(value);
  const prototype = Object.getPrototypeOf(value);
  let result;
  if (prototype === Map.prototype) {
    result = new Map(); seen.set(value, result);
    for (const [key, item] of Map.prototype.entries.call(value)) result.set(copyData(key, seen), copyData(item, seen));
    return result;
  }
  if (prototype === Set.prototype) {
    result = new Set(); seen.set(value, result);
    for (const item of Set.prototype.values.call(value)) result.add(copyData(item, seen));
    return result;
  }
  if (Array.isArray(value) && prototype === Array.prototype) result = new Array(value.length);
  else if (prototype === Object.prototype || prototype === null) result = {};
  else throw unsupportedCopy;
  seen.set(value, result);
  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    // Do not invoke a getter before discovering another unsupported value and restarting the graph.
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw unsupportedCopy;
    const item = copyData(descriptor.value, seen);
    if (key === '__proto__') Object.defineProperty(result, key, { value: item, writable: true, enumerable: true, configurable: true });
    else result[key] = item;
  }
  return result;
}
// Perception owns plain delivered data. Copy supported graphs once; native fallback starts from
// the original root so aliases spanning unknown types are preserved and unsupported values still reject.
export function detachedCopy(value) {
  try { return copyData(value, new Map()); }
  catch { return structuredClone(value); }
}
// The root was just built by object spread here and has not been exposed. Nested
// values still use descriptor checks and the original-root native fallback.
function copyFreshRoot(value) {
  try {
    const result = {}, seen = new Map([[value, result]]);
    for (const key of Object.keys(value)) {
      const item = copyData(value[key], seen);
      if (key === '__proto__') Object.defineProperty(result, key, { value: item, writable: true, enumerable: true, configurable: true });
      else result[key] = item;
    }
    return result;
  } catch { return structuredClone(value); }
}
function copyFreshData(value, seen) {
  if (value === null) return value;
  const type = typeof value;
  if (type === 'function' || type === 'symbol') throw unsupportedCopy;
  if (type !== 'object') return value;
  if (seen.has(value)) return seen.get(value);
  const prototype = Object.getPrototypeOf(value); let result;
  if (prototype === Map.prototype) {
    result = new Map(); seen.set(value, result);
    for (const [key, item] of Map.prototype.entries.call(value)) result.set(copyFreshData(key, seen), copyFreshData(item, seen));
    return result;
  }
  if (prototype === Set.prototype) {
    result = new Set(); seen.set(value, result);
    for (const item of Set.prototype.values.call(value)) result.add(copyFreshData(item, seen));
    return result;
  }
  if (Array.isArray(value) && prototype === Array.prototype) result = new Array(value.length);
  else if (prototype === Object.prototype || prototype === null) result = {};
  else throw unsupportedCopy;
  seen.set(value, result);
  for (const key of Object.keys(value)) {
    const item = copyFreshData(value[key], seen);
    if (key === '__proto__') Object.defineProperty(result, key, { value: item, writable: true, enumerable: true, configurable: true });
    else result[key] = item;
  }
  return result;
}
// Only an immediate second copy of this function's newly detached, unexposed graph uses this helper.
function copyFresh(value) {
  try { return copyFreshData(value, new Map()); }
  catch { return structuredClone(value); }
}
const clone = detachedCopy;
// The client also frames the spawn within its measured HUD band. This shared pose anchors at the spawn.
export function startCamera(observation, slot) {
  const spawn = observation.players[slot]?.spawn ?? { x: observation.w * CELL / 2, z: observation.h * CELL / 2 };
  return { x: spawn.x, z: spawn.z, yaw: Math.atan2(spawn.x - observation.w * CELL / 2, spawn.z - observation.h * CELL / 2), distance: HUMAN_CAMERA.distance };
}
// The renderer interpolates cell levels, lowers roads by at most .1 m, trenches by .9 m,
// crater lips by at most 1.15 m, and water beds by at most 1.12 m below their water level.
// Use a local height envelope instead of importing the client's Three.js terrain geometry.
// Natural hills retain this 3x3 envelope: control values and tangent donors use those cells.
// Each limited tangent fits both distances to the extrema. Its Hermite basis/value basis
// ratio is at most 1/3 per axis, so their sum cannot push a control outside that envelope.
const surfaceRanges = new WeakMap();
function groundRange(view, at) {
  if (!view?.height) return [0, 0];
  let ranges = surfaceRanges.get(view);
  if (!ranges) { ranges = new Map(); surfaceRanges.set(view, ranges); }
  const x = Math.min(view.w - 1, Math.max(0, Math.floor(at.x / CELL))), z = Math.min(view.h - 1, Math.max(0, Math.floor(at.z / CELL)));
  const cell = z * view.w + x;
  if (ranges.has(cell)) return ranges.get(cell);
  let lo = Infinity, hi = -Infinity, cut = 0.1, water = false;
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const xx = Math.min(view.w - 1, Math.max(0, x + dx)), zz = Math.min(view.h - 1, Math.max(0, z + dz)), c = zz * view.w + xx;
    const level = (view.height[c] ?? 0) * CFG.levelHeight, ch = view.chars?.[c];
    lo = Math.min(lo, level); hi = Math.max(hi, level);
    if (ch === 'T') cut = Math.max(cut, 1.0); // Road lowering and the trench cut can overlap.
    if (ch === '+' || ch === 'R') cut = Math.max(cut, 1.25);
    if (ch === 'W' || ch === 'F' || ch === '=') water = true;
  }
  // A water body can have a lower nominal level elsewhere in its connected component.
  if (water) lo = Math.min(lo, CFG.minLevel * CFG.levelHeight - 1.12);
  const range = [lo - cut, hi]; ranges.set(cell, range); return range;
}

export function onScreen(at, camera, observation) {
  if (!camera || !Number.isFinite(at?.x) || !Number.isFinite(at?.z)) return false;
  const yaw = camera.yaw ?? HUMAN_CAMERA.yaw, s = Math.sin(yaw), c = Math.cos(yaw);
  const dx = at.x - camera.x, dz = at.z - camera.z;
  const right = dx * c - dz * s, forward = dx * s + dz * c;
  const surface = groundRange(observation, at), focus = groundRange(observation, camera);
  const altitude = HUMAN_CAMERA.markerHeight + (UNITS[at.type]?.air ? HUMAN_CAMERA.aircraftAltitude : 0);
  const distance = camera.distance ?? HUMAN_CAMERA.distance;
  // Requiring both envelope extremes to fit excludes uncertain fringe detail, while the minimap stays complete.
  return [surface[0] - focus[1] + altitude, surface[1] - focus[0] + altitude].every(y => {
    const depth = distance - sin * y - cos * forward, up = cos * y - sin * forward;
    return depth >= 1 && depth <= 2200 && Math.abs(right) <= depth * tangent * aspect && Math.abs(up) <= depth * tangent;
  });
}

// Ray intersections with the camera target's ground plane, clockwise from the top left.
export function cameraFootprint(camera) {
  const yaw = camera.yaw ?? HUMAN_CAMERA.yaw, s = Math.sin(yaw), c = Math.cos(yaw);
  const distance = camera.distance ?? HUMAN_CAMERA.distance;
  return [[-1, 1], [1, 1], [1, -1], [-1, -1]].map(([nx, ny]) => {
    const forward = -ny * distance * tangent / (sin - ny * cos * tangent);
    const right = nx * tangent * aspect * (distance - cos * forward);
    return { x: camera.x + right * c + forward * s, z: camera.z - right * s + forward * c };
  });
}

function inventoryUnit(entry, dot) {
  const def = UNITS[entry.type];
  return { ...entry, x: dot.x, z: dot.z, hp: def.models * def.hpPer, supp: 0, cd: Infinity, targetId: 0,
    flags: 0, built: 0, path: [], orders: [], attackId: 0, retreating: false, buff: 0, ap: false, reinf: 0,
    dig: null, garrison: -1, amove: null, build: 0, enter: -1, fireAt: -1, nade: null, entrench: null,
    holdFire: false, holdPos: false, autoRetreat: false, auto: false, queue: [], prog: 0,
    ...(def.air && { air: { state: 'unknown' } }), lastSeen: null, screenSeen: false, inventoryOnly: true,
    estimatedHealth: true, confidence: 0 };
}

export const PERCEPTION_EVENT_LIMIT = 128;
export function recordPerceptionEvent(state, event) {
  state.events ??= [];
  if (!(state.events instanceof Array)) throw new Error('Perception event history must be an array');
  if (state.events.some(old => old.id === event.id)) return null;
  const saved = clone(event); state.events.push(saved);
  if (state.events.length > PERCEPTION_EVENT_LIMIT) state.events.splice(0, state.events.length - PERCEPTION_EVENT_LIMIT);
  state.eventsHistory = state.events;
  return saved;
}

const retreatRisk = (row, def) => row && (row.hp / (def.models * def.hpPer) < .35
  || (def.models > 1 && Math.ceil(row.hp / def.hpPer) <= 1)
  || (row.supp >= 90 && row.hp / (def.models * def.hpPer) < .6));
function autoRetreatCovered(unit, observation, slot, inventory, dots) {
  const def = UNITS[unit.type], mode = observation.mode?.kind;
  if (!unit.autoRetreat || def.air || def.speed <= 0 || slot === observation.mode?.slot
    || unit.hp >= def.models * def.hpPer * CFG.autoRetreat || mode === 'world') return false;
  const spawn = observation.players[slot].spawn;
  if (!spawn) return false;
  const homes = [spawn];
  if (mode === 'classic') {
    // A construction site may become a home. Excluding all nearby production identities is conservative
    // and requires no off-camera construction progress or health to match the nearest-home rule.
    for (const dot of dots) if (dot.owner === slot && UNITS[inventory.get(dot.id)?.type]?.produces) homes.push(dot);
  }
  return homes.every(home => Math.hypot(home.x - unit.x, home.z - unit.z) > CFG.reinforceRadius);
}
function alreadyEngaged(unit, screen, observation) {
  const def = UNITS[unit.type], weapon = def.w, target = screen.get(unit.targetId);
  // A positive delivered target is maintained by the engine's canShoot check. Keep this exemption
  // camera-local and require the engine's hold-fire, area-order and moving/setup firing conditions.
  if (retreatRisk(unit, def) || !weapon || !target || target.hp <= 0 || UNITS[target.type].air || target.flags & 262144
    || observation.players[target.owner]?.team === observation.players[unit.owner]?.team
    || Math.hypot(target.x - unit.x, target.z - unit.z) > weapon.range
    || unit.holdFire && !unit.attackId || weapon.area && unit.attackId !== target.id) return false;
  return unit.path.length ? weapon.moveFire !== undefined : observation.tick / 20 - unit.firstStillAt >= (weapon.setup ?? 0);
}
function screenResponse(event, screen, previous, slot, observation, inventory, dots) {
  const controllable = unit => unit.owner === slot && unit.hp > 0 && !UNITS[unit.type].structure
    && !(unit.flags & (512 | 262144));
  let reason, units = [];
  if (event.kind === 'screen-contact') {
    units = [...screen.values()].filter(unit => controllable(unit) && UNITS[unit.type].w
      && !UNITS[unit.type].air && !UNITS[unit.type].medic && unit.type !== 'engineer'
      && Math.hypot(unit.x - event.x, unit.z - event.z) <= 45 && !unit.retreating
      && !unit.path.length && !unit.orders.length && !unit.amove && !unit.attackId && !unit.targetId
      && !unit.dig && !unit.build && !unit.entrench && unit.enter < 0 && unit.fireAt < 0 && !unit.nade).map(unit => unit.id);
    reason = units.length ? 'idle-combat-contact' : 'monitoring-contact';
  } else {
    const unit = screen.get(event.unitId), old = previous.get(event.unitId), def = unit && UNITS[unit.type];
    if (!unit || !controllable(unit)) reason = 'uncontrollable-damage';
    else if (unit.retreating) reason = 'already-retreating';
    else if (autoRetreatCovered(unit, observation, slot, inventory, dots)) reason = 'auto-retreat-enabled';
    else if (alreadyEngaged(unit, screen, observation)) reason = 'already-engaged';
    else if (event.amount >= def.models * def.hpPer * .25) { reason = 'heavy-damage'; units = [unit.id]; }
    else if (!retreatRisk(old, def) && retreatRisk(unit, def)) { reason = 'retreat-risk-crossing'; units = [unit.id]; }
    else reason = 'monitoring-damage';
  }
  return { responseRequired: units.length > 0, responseReason: reason, responsePolicy: OBSERVED_RESPONSE_POLICY, responseUnits: units };
}

// Detector history never enters the memory supplied to the planner. Each state has its own baseline.
const detectorMemory = new WeakMap();
function copyAlertSnapshot(snapshot) {
  if (!snapshot) return undefined;
  // These are the previous-snapshot fields read by the shared alert detector.
  return detachedCopy({ tick: snapshot.tick, units: snapshot.units, points: snapshot.points,
    queues: snapshot.queues, strikes: snapshot.strikes, world: snapshot.world, home: snapshot.home });
}
function detectorFor(state) {
  let detector = detectorMemory.get(state);
  if (!detector) {
    detector = { previousScreen: state.previousScreen ? detachedCopy(state.previousScreen) : undefined,
      previousSnapshot: copyAlertSnapshot(state.previousSnapshot) };
    detectorMemory.set(state, detector);
  }
  delete state.previousScreen; delete state.previousSnapshot;
  return detector;
}
function perceiveScene(observation, slot, state = {}, eventTick = observation.tick) {
  const detector = detectorFor(state);
  const me = observation.players[slot], now = observation.tick / 20;
  state.camera ??= startCamera(observation, slot);
  state.camera.yaw ??= startCamera(observation, slot).yaw; state.camera.distance ??= HUMAN_CAMERA.distance;
  state.screenMemory ??= new Map(); state.inventory ??= new Map(); state.screenStill ??= new Map();
  const screen = new Map(), screenIds = new Set(), dots = [], newEvents = [], screenStimuli = [];
  const previousScreen = detector.previousScreen ?? new Map();
  const selectedCounts = new Map(), selectedIds = new Set();
  for (const id of new Set(state.hands?.selected ?? [])) {
    const unit = observation.units.get(id);
    if (!unit || unit.owner !== slot || unit.hp <= 0 || unit.flags & 262144) continue;
    selectedIds.add(id); selectedCounts.set(unit.type, (selectedCounts.get(unit.type) ?? 0) + 1);
  }
  const screenSeenAt = state.screenSeenAt ??= new Map();
  state.damageEpisodes ??= new Map();
  const emit = event => {
    const { responseRequired, responseReason, responsePolicy, responseUnits, ...runtime } = event;
    const saved = recordPerceptionEvent(state, runtime);
    if (saved) {
      newEvents.push(saved);
      const measured = observedMeasurements.get(state) ?? new Map(); observedMeasurements.set(state, measured);
      measured.set(event.id, clone(event));
    }
  };
  for (const delivered of observation.units.values()) {
    const def = UNITS[delivered.type], full = (def.models ?? 1) * def.hpPer;
    const exactHUD = delivered.owner === slot && selectedIds.has(delivered.id) && selectedCounts.get(delivered.type) === 1;
    const u = { ...delivered, hp: exactHUD ? Math.ceil(delivered.hp) : observedHealth(delivered.hp, full),
      supp: observedSuppression(delivered.supp), hpBasis: exactHUD ? 'selected-hud' : 'world-bar',
      suppSource: 'world-bar', suppressionBand: delivered.supp >= 90 ? 'pinned' : delivered.supp >= 50 ? 'suppressed' : 'normal', healthBand: delivered.hp / full > .5 ? 'healthy' : delivered.hp / full > .25 ? 'hurt' : 'critical' };
    // These are exactly the two dot sizes drawn by client/main.js drawMinimap, not unit symbols.
    const dot = { ...(u.owner === slot && { id: u.id }), owner: u.owner, x: u.x, z: u.z, vehicle: !UNITS[u.type].infantry };
    dots.push(dot);
    if (u.owner === slot && !state.inventory.has(u.id)) state.inventory.set(u.id, { id: u.id, owner: u.owner, type: u.type });
    // Parked planes have a HUD button, but their model and health bars are hidden by the client.
    if ((UNITS[u.type].air && u.flags & 512) || !onScreen(u, state.camera, observation)) continue;
    const previous = previousScreen.get(u.id);
    const lastScreenTick = screenSeenAt.get(u.id) ?? state.screenMemory.get(u.id)?.lastScreenTick;
    if (observation.players[u.owner]?.team !== me.team && (!previous || previous.team === me.team)
      && (lastScreenTick === undefined || eventTick - lastScreenTick >= SCREEN_CONTACT_QUIET_TICKS)) screenStimuli.push({
      id: `observed-screen:${eventTick}:${state.eventSerial = (state.eventSerial ?? 0) + 1}`, kind: 'screen-contact',
      tick: eventTick, observationTick: observation.tick, source: 'screen', onScreen: true, x: u.x, z: u.z, targetId: u.id,
      provenance: 'entered-screen',
    });
    if (u.owner === slot && previous?.owner === slot && observation.tick > previous.observationTick && previous.hpBasis === u.hpBasis && u.hp < previous.hp) {
      const old = state.damageEpisodes.get(u.id), amount = previous.hp - u.hp;
      const quiet = !old || eventTick - old.lastDamage >= 60;
      const heavy = amount >= UNITS[u.type].models * UNITS[u.type].hpPer * 0.25;
      const riskCrossing = !retreatRisk(previous, UNITS[u.type]) && retreatRisk(u, UNITS[u.type]);
      const episode = quiet ? { id: `${u.id}:${state.damageSerial = (state.damageSerial ?? 0) + 1}`, started: eventTick, lastDamage: eventTick } : old;
      episode.lastDamage = eventTick; state.damageEpisodes.set(u.id, episode);
      if (quiet || heavy || riskCrossing) screenStimuli.push({ id: `observed-screen:${eventTick}:${state.eventSerial = (state.eventSerial ?? 0) + 1}`,
        kind: 'screen-damage', tick: eventTick, observationTick: observation.tick, source: 'screen', onScreen: true,
        x: u.x, z: u.z, unitId: u.id, amount, episode: episode.id, episodeTick: episode.started,
        provenance: heavy ? 'heavy-damage' : riskCrossing ? 'retreat-risk-crossing' : 'first-damage-after-quiet',
      });
    }
    const stationary = state.screenStill.get(u.id);
    const firstStillAt = stationary && Math.hypot(stationary.x - u.x, stationary.z - u.z) <= 0.1 + 1e-9 ? stationary.since : now;
    state.screenStill.set(u.id, { x: u.x, z: u.z, since: firstStillAt });
    screenSeenAt.set(u.id, eventTick);
    const seen = { ...copyFreshRoot(u), firstStillAt, lastSeen: now, lastScreenTick: eventTick, screenSeen: true, confidence: 1 };
    screen.set(u.id, seen); screenIds.add(u.id); state.screenMemory.set(u.id, copyFresh(seen));
  }
  for (const id of state.screenStill.keys()) if (!screenIds.has(id)) state.screenStill.delete(id);
  // Keep debounce clocks through empty-ground memory invalidation, without retaining hidden unit details.
  for (const [id, seenTick] of screenSeenAt) if (!screenIds.has(id) && eventTick - seenTick > SCREEN_CONTACT_QUIET_TICKS) screenSeenAt.delete(id);
  dots.sort((a, b) => a.owner - b.owner || a.x - b.x || a.z - b.z || Number(a.vehicle) - Number(b.vehicle));
  const dotById = new Map(dots.filter(dot => dot.id !== undefined).map(dot => [dot.id, dot]));
  for (const event of screenStimuli) emit({ ...event, observedDanger: dangerFor(event, screen, previousScreen, slot, observation, state.inventory, dots),
    ...screenResponse(event, screen, previousScreen, slot, observation, state.inventory, dots) });
  detector.previousScreen = new Map([...screen.values()].map(u => [u.id, { hp: u.hp, supp: u.supp, owner: u.owner, team: observation.players[u.owner]?.team, observationTick: observation.tick, hpBasis: u.hpBasis }]));
  for (const [id, episode] of state.damageEpisodes) if (eventTick - episode.lastDamage > 1200) state.damageEpisodes.delete(id);
  // Own inventory is always listed in delivered snapshots. Removal is known, not a fabricated fog loss.
  for (const id of state.inventory.keys()) if (!dotById.has(id)) state.inventory.delete(id);
  const sees = at => onScreen(at, state.camera, observation) && observation.sees?.(at) === true;
  const units = new Map(screen);
  for (const [id, old] of state.screenMemory) {
    if (screenIds.has(id)) continue;
    const friendly = observation.players[old.owner]?.team === me.team;
    if ((old.owner === slot && !state.inventory.has(id)) || (!friendly && sees(old)) || now - old.lastSeen > SCREEN_MEMORY_SECONDS) {
      state.screenMemory.delete(id); continue;
    }
    const remembered = { ...clone(old), screenSeen: false, confidence: Math.max(0, 1 - (now - old.lastSeen) / SCREEN_MEMORY_SECONDS) };
    // Current positions are a minimap fact. Health, abilities, orders and construction remain stale.
    if (friendly && dotById.has(id)) Object.assign(remembered, { x: dotById.get(id).x, z: dotById.get(id).z });
    units.set(id, remembered);
  }
  for (const [id, entry] of state.inventory) if (!units.has(id)) units.set(id, inventoryUnit(entry, dotById.get(id)));
  const players = observation.players.map(p => ({ ...clone(p), visible: new Set() }));
  if (observation.players[-1]) players[-1] = clone(observation.players[-1]);
  players[slot].visible = new Set([...screen.values()].filter(u => observation.players[u.owner]?.team !== me.team).map(u => u.id));
  const sightings = [...state.screenMemory.values()].filter(u => observation.players[u.owner]?.team !== me.team && !UNITS[u.type].structure)
    .map(u => ({ id: u.id, type: u.type, owner: u.owner, x: u.x, z: u.z, t: u.lastSeen,
      val: UNITS[u.type].cost * u.hp / (UNITS[u.type].models * UNITS[u.type].hpPer), confidence: Math.max(0, 1 - (now - u.lastSeen) / SCREEN_MEMORY_SECONDS) }));
  const knownBuildings = [...state.screenMemory.values()].filter(u => observation.players[u.owner]?.team !== me.team && UNITS[u.type].building)
    .map(u => ({ id: u.id, type: u.type, owner: u.owner, x: u.x, z: u.z, built: u.built, t: u.lastSeen }));
  const snapshot = observation.snapshot;
  // Only HUD text is fresh off camera: aircraft names, status, station fuel and rearm countdown.
  const airPanel = (snapshot?.air ?? []).flatMap(([id, status, fuel, , timer]) => {
    const unit = observation.units.get(id);
    if (unit?.owner !== slot || !UNITS[unit.type]?.air) return [];
    return [{ id, type: unit.type, state: ['base', 'out', 'station', 'home', 'rearm'][status],
      ...(status === 2 && { fuel }), ...(status === 4 && { timer }) }];
  });
  state.alertState ??= {};
  const newAlerts = snapshot ? deriveAlertEvents(snapshot, detector.previousSnapshot, {
    me: () => slot, team: () => me.team, friend: owner => observation.players[owner]?.team === me.team,
    unitName: type => UNITS[type]?.name ?? type, playerName: owner => observation.players[owner]?.name ?? 'An ally',
    home: () => me.spawn, pointPos: i => observation.points[i], onScreen: (x, z) => onScreen({ x, z }, state.camera, observation),
  }, state.alertState) : [];
  if (snapshot && snapshot.tick > (detector.previousSnapshot?.tick ?? -1)) detector.previousSnapshot = copyAlertSnapshot(snapshot);
  for (const alert of newAlerts) emit({ ...alert, source: 'alert' });
  state.events ??= []; state.eventsHistory = state.events;
  state.alerts = [...(state.alerts ?? []), ...newAlerts].filter(a => observation.tick - a.tick <= 300).slice(-20);
  state.minimap = dots;
  const claims = [...units.values()].filter(u => u.type === 'depot' && observation.players[u.owner]?.team === me.team).concat(knownBuildings.filter(u => u.type === 'depot'));
  const view = { ...observation, players, units, screen, screenIds, camera: { ...state.camera }, minimap: dots,
    sightings, ghosts: knownBuildings, knownBuildings, airPanel, events: state.events.map(clone), newEvents: newEvents.map(clone), alerts: state.alerts.map(clone), newAlerts: newAlerts.map(clone), sees,
    smokes: observation.smokes.filter(at => onScreen(at, state.camera, observation)),
    covers: observation.covers.filter(at => onScreen(at, state.camera, observation)),
    claimedNodes: new Set(observation.nodes.flatMap((node, i) => claims.some(u => Math.hypot(u.x - node.x, u.z - node.z) < 8) ? [i] : [])) };
  // The detailed delivered snapshot is private to the detector and never reaches planning.
  delete view.snapshot;
  return view;
}

// Only the actual living own selection supplies the selected-type HUD, even off camera.
export function selectedHUDFor(observation, slot, hands) {
  const rows = [], byType = new Map(), ids = [];
  for (const id of [...new Set(hands?.selected ?? [])]) {
    const unit = observation.units.get(id);
    if (!unit || unit.owner !== slot || unit.hp <= 0 || unit.flags & 262144) continue;
    ids.push(id);
    const list = byType.get(unit.type) ?? []; list.push(unit); byType.set(unit.type, list);
  }
  for (const [type, all] of byType) {
    const def = UNITS[type], active = all.filter(unit => !(unit.flags & 1)), shown = active.length ? active : all;
    const anyReady = shown.some(unit => !unit.cd), cooldownSeconds = Math.max(0, Math.ceil(Math.min(...shown.map(unit => unit.cd || 0))));
    const cost = def.ab ? abCost(observation, def.ab) : 0;
    const ability = def.ab && def.ab.id !== 'none' ? { id: def.ab.id, anyReady, cooldownSeconds, allAuto: all.every(unit => unit.flags & 16384),
      usable: active.length > 0 && anyReady && (!cost || observation.players[slot].mun >= cost),
      reason: !active.length ? 'retreating' : !anyReady ? 'cooldown' : cost && !(observation.players[slot].mun >= cost) ? 'munitions' : null } : null;
    rows.push({ type, ids: all.map(unit => unit.id), count: all.length,
      hp: Math.ceil(all.reduce((sum, unit) => sum + unit.hp, 0)), maxHp: all.length * def.hpPer * (def.models ?? 1),
      suppressionTags: { suppressed: all.some(unit => unit.supp >= 50 && unit.supp < 90), pinned: all.some(unit => unit.supp >= 90) },
      allRetreating: !active.length, ability });
  }
  return { slot, ids, types: rows, observedTick: observation.tick };
}
export function readinessFor(view, id) {
  const unit = view.units.get(id), row = view.selectedHUD?.types.find(row => row.ids.includes(id));
  if (!unit || unit.owner !== view.selectedHUD?.slot || (!UNITS[unit.type].ab || UNITS[unit.type].ab.id === 'none')) return { known: false, state: 'unavailable' };
  if (!row) return { known: false, state: unit.lastHUD ? 'stale-hud' : 'unknown', lastHUD: unit.lastHUD ? detachedCopy(unit.lastHUD) : null };
  if (row.count > 1) return { known: false, state: 'group-hud', aggregate: detachedCopy(row.ability), ids: [...row.ids] };
  return { known: true, state: 'selected-hud', ...detachedCopy(row.ability), observedTick: view.selectedHUD.observedTick };
}
export function requiresInspection(view, id) {
  const unit = view.units.get(id);
  return !!unit && unit.owner === view.selectedHUD?.slot && !!UNITS[unit.type].ab && UNITS[unit.type].ab.id !== 'none' && !readinessFor(view, id).known;
}
export const needsInspection = requiresInspection;
// The optional external collector owns diagnostic graphs. Normal runtime has one observed pass.
const measurementStates = new WeakMap(), observedMeasurements = new WeakMap();
function observedHealth(hp, full) { return Math.max(hp > 0 ? full / 20 : 0, Math.min(full, Math.round(hp / full * 20) * full / 20)); }
function observedSuppression(supp) {
  const bar = Math.max(supp > 0 ? 5 : 0, Math.min(100, Math.round(supp / 5) * 5));
  // Preserve the visible pinned color/posture and suppressed infantry posture categories.
  return supp >= 90 ? Math.max(90, bar) : supp >= 50 ? Math.min(85, Math.max(50, bar)) : Math.min(45, bar);
}
function observedMeasurementEvents(state) {
  const measured = observedMeasurements.get(state);
  return (state.events ?? []).map(event => detachedCopy(measured?.get(event.id) ?? event));
}
function dangerFor(event, screen, previous, slot, observation, inventory, dots) {
  if (event.kind === 'screen-contact') {
    const nearby = [...screen.values()].filter(unit => unit.owner === slot && unit.hp > 0
      && armedContactActor(unit)
      && Math.hypot(unit.x - event.x, unit.z - event.z) <= 45);
    return { nearbyOwnUnits: nearby.map(unit => unit.id), idleOwnUnits: nearby.filter(unit => !unit.retreating
      && !unit.path.length && !unit.orders.length && !unit.amove && !unit.attackId && !unit.targetId
      && !unit.dig && !unit.build && !unit.entrench && unit.enter < 0 && unit.fireAt < 0 && !unit.nade).map(unit => unit.id) };
  }
  const unit = screen.get(event.unitId), def = UNITS[unit.type], full = (def.models ?? 1) * def.hpPer;
  return { healthShare: unit.hp / full, lossShare: event.amount / full, healthBand: unit.healthBand,
    suppressionBand: unit.suppressionBand, retreatRisk: !!retreatRisk(unit, def),
    alreadyRetreating: !!unit.retreating, alreadyEngaged: !!alreadyEngaged(unit, screen, observation),
    autoRetreatCovered: !!autoRetreatCovered(unit, observation, slot, inventory, dots) };
}
export function perceive(observation, slot, state = {}, eventTick = observation.tick, measurements = {}) {
  const { onMeasurements, measureRaw } = measurements;
  let measured, rawView;
  if (typeof onMeasurements === 'function' && typeof measureRaw === 'function') {
    measured = measurementStates.get(state);
    if (!measured) { measured = { camera: { ...(state.camera ?? startCamera(observation, slot)) }, hands: { selected: [] }, measurementBaselineTick: observation.tick }; measurementStates.set(state, measured); }
    measured.camera = { ...(state.camera ?? startCamera(observation, slot)) }; measured.hands.selected = [...(state.hands?.selected ?? [])];
    rawView = measureRaw(observation, slot, measured, eventTick);
  }

  // Runtime episodes and eligibility use human observations. The raw detector is diagnostics only.
  const view = perceiveScene(observation, slot, state, eventTick), hud = selectedHUDFor(observation, slot, state.hands);
  view.selectedHUD = hud;
  state.hudMemory ??= new Map();
  const byId = new Map(hud.types.flatMap(row => row.ids.map(id => [id, row])));
  for (const row of hud.types) for (const id of row.ids) state.hudMemory.set(id, {
    type: row.type, ids: [...row.ids], hp: row.hp, maxHp: row.maxHp,
    ability: detachedCopy(row.ability), observedTick: observation.tick,
  });
  for (const id of state.hudMemory.keys()) if (!state.inventory.has(id)) state.hudMemory.delete(id);
  const mask = unit => {
    const def = UNITS[unit.type], full = (def.models ?? 1) * def.hpPer;
    if (view.screenIds.has(unit.id)) {
      unit.hp = Math.max(unit.hp > 0 ? full / 20 : 0, Math.min(full, Math.round(unit.hp / full * 20) * full / 20));
      unit.hpSource = 'world-bar'; unit.hpObservedTick = observation.tick; unit.exactHPKnown = false;
    } else {
      unit.exactHPKnown = false; unit.hpSource = unit.inventoryOnly ? 'inventory-estimate' : unit.hpSource === 'selected-hud' || unit.hpSource === 'stale-selected-hud' ? 'stale-selected-hud' : 'screen-memory';
    }
    const own = unit.owner === slot, row = own && byId.get(unit.id), single = row && row.count === 1;
    if (single) {
      unit.hp = row.hp; unit.hpSource = 'selected-hud'; unit.hpObservedTick = observation.tick; unit.exactHPKnown = true;
      if (!view.screenIds.has(unit.id)) {
        unit.suppressionBand = row.suppressionTags.pinned ? 'pinned' : row.suppressionTags.suppressed ? 'suppressed' : 'normal';
        unit.supp = row.suppressionTags.pinned ? 90 : row.suppressionTags.suppressed ? 50 : 0;
        unit.suppSource = 'selected-hud-tag';
      }
    }
    unit.cd = single && row.ability ? row.ability.cooldownSeconds : Infinity;
    unit.cdKnown = !!single && !!row.ability;
    unit.cdState = single ? 'selected-hud' : row ? 'group-hud' : own && state.hudMemory.has(unit.id) ? 'stale-hud' : 'unknown';
    unit.cdObservedTick = row ? observation.tick : own ? state.hudMemory.get(unit.id)?.observedTick ?? null : null;
    if (own && state.hudMemory.has(unit.id)) unit.lastHUD = detachedCopy(state.hudMemory.get(unit.id));
    else delete unit.lastHUD;
  };
  for (const unit of view.units.values()) mask(unit);
  for (const unit of state.screenMemory.values()) mask(unit);
  // Remembered enemy values must use the same coarse health estimate, never the private scene detector's exact HP.
  for (const sighting of view.sightings) {
    const remembered = state.screenMemory.get(sighting.id);
    if (remembered) sighting.val = UNITS[remembered.type].cost * remembered.hp / ((UNITS[remembered.type].models ?? 1) * UNITS[remembered.type].hpPer);
  }
  const retained = new Set(view.events.map(event => event.id));
  const observed = observedMeasurements.get(state);
  if (observed) for (const id of observed.keys()) if (!retained.has(id)) observed.delete(id);
  if (typeof onMeasurements === 'function') {
    const sameSource = (runtime, raw) => runtime.source === raw.source && runtime.kind === raw.kind
      && runtime.tick === raw.tick && runtime.observationTick === raw.observationTick
      && runtime.unitId === raw.unitId && runtime.targetId === raw.targetId
      && (runtime.source === 'screen' || (runtime.id === raw.id && runtime.x === raw.x && runtime.z === raw.z));
    const observedEvents = observedMeasurementEvents(state), emitted = new Set(view.newEvents.map(event => event.id));
    onMeasurements({ tick: eventTick, observationTick: observation.tick,
      original: rawView ? { policy: SCREEN_RESPONSE_POLICY, baselineTick: measured.measurementBaselineTick, events: detachedCopy(measured.events ?? []), newEvents: detachedCopy(rawView.newEvents) } : null,
      observed: { policy: OBSERVED_RESPONSE_POLICY, events: observedEvents, newEvents: detachedCopy(observedEvents.filter(event => emitted.has(event.id))) },
      links: view.newEvents.map(runtime => ({ runtimeId: runtime.id, originalIds: (rawView?.newEvents ?? []).filter(raw => sameSource(runtime, raw)).map(raw => raw.id) })) });
  }
  return view;
}
