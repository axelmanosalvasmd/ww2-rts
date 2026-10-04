// Detail belongs to one camera. Delivered rows outside it supply only minimap dots.
import { CELL, CFG, UNITS } from './sim.js';
import { deriveAlertEvents } from './alert-events.js';

// Match start uses distance 60 and a heading toward the map centre. Normal pan speed is dist*1.1.
export const HUMAN_CAMERA = Object.freeze({ width: 1920, height: 1080, fov: 42, pitch: 0.95, distance: 60, yaw: 0, panSpeed: 66, markerHeight: 1, aircraftAltitude: 20 });
export const SCREEN_MEMORY_SECONDS = 60;
export const SCREEN_CONTACT_QUIET_TICKS = 200;
export const SCREEN_RESPONSE_POLICY = 'screen-v1';
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
  return { responseRequired: units.length > 0, responseReason: reason, responsePolicy: SCREEN_RESPONSE_POLICY, responseUnits: units };
}

export function perceive(observation, slot, state = {}, eventTick = observation.tick) {
  const me = observation.players[slot], now = observation.tick / 20;
  state.camera ??= startCamera(observation, slot);
  state.camera.yaw ??= startCamera(observation, slot).yaw; state.camera.distance ??= HUMAN_CAMERA.distance;
  state.screenMemory ??= new Map(); state.inventory ??= new Map(); state.screenStill ??= new Map();
  const screen = new Map(), screenIds = new Set(), dots = [], newEvents = [], screenStimuli = [];
  const previousScreen = state.previousScreen ?? new Map();
  const screenSeenAt = state.screenSeenAt ??= new Map();
  state.damageEpisodes ??= new Map();
  const emit = event => { const saved = recordPerceptionEvent(state, event); if (saved) newEvents.push(saved); };
  for (const u of observation.units.values()) {
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
      id: `screen:${eventTick}:${state.eventSerial = (state.eventSerial ?? 0) + 1}`, kind: 'screen-contact',
      tick: eventTick, observationTick: observation.tick, source: 'screen', onScreen: true, x: u.x, z: u.z, targetId: u.id,
      provenance: 'entered-screen',
    });
    if (u.owner === slot && previous?.owner === slot && observation.tick > previous.observationTick && u.hp < previous.hp) {
      const old = state.damageEpisodes.get(u.id), amount = previous.hp - u.hp;
      const quiet = !old || eventTick - old.lastDamage >= 60;
      const heavy = amount >= UNITS[u.type].models * UNITS[u.type].hpPer * 0.25;
      const riskCrossing = !retreatRisk(previous, UNITS[u.type]) && retreatRisk(u, UNITS[u.type]);
      const episode = quiet ? { id: `${u.id}:${state.damageSerial = (state.damageSerial ?? 0) + 1}`, started: eventTick, lastDamage: eventTick } : old;
      episode.lastDamage = eventTick; state.damageEpisodes.set(u.id, episode);
      if (quiet || heavy || riskCrossing) screenStimuli.push({ id: `screen:${eventTick}:${state.eventSerial = (state.eventSerial ?? 0) + 1}`,
        kind: 'screen-damage', tick: eventTick, observationTick: observation.tick, source: 'screen', onScreen: true,
        x: u.x, z: u.z, unitId: u.id, amount, episode: episode.id, episodeTick: episode.started,
        provenance: heavy ? 'heavy-damage' : riskCrossing ? 'retreat-risk-crossing' : 'first-damage-after-quiet',
      });
    }
    const stationary = state.screenStill.get(u.id);
    const firstStillAt = stationary && Math.hypot(stationary.x - u.x, stationary.z - u.z) <= 0.1 + 1e-9 ? stationary.since : now;
    state.screenStill.set(u.id, { x: u.x, z: u.z, since: firstStillAt });
    screenSeenAt.set(u.id, eventTick);
    const seen = { ...clone(u), firstStillAt, lastSeen: now, lastScreenTick: eventTick, screenSeen: true, confidence: 1 };
    screen.set(u.id, seen); screenIds.add(u.id); state.screenMemory.set(u.id, clone(seen));
  }
  for (const id of state.screenStill.keys()) if (!screenIds.has(id)) state.screenStill.delete(id);
  // Keep debounce clocks through empty-ground memory invalidation, without retaining hidden unit details.
  for (const [id, seenTick] of screenSeenAt) if (!screenIds.has(id) && eventTick - seenTick > SCREEN_CONTACT_QUIET_TICKS) screenSeenAt.delete(id);
  dots.sort((a, b) => a.owner - b.owner || a.x - b.x || a.z - b.z || Number(a.vehicle) - Number(b.vehicle));
  const dotById = new Map(dots.filter(dot => dot.id !== undefined).map(dot => [dot.id, dot]));
  for (const event of screenStimuli) emit({ ...event, ...screenResponse(event, screen, previousScreen, slot, observation, state.inventory, dots) });
  state.previousScreen = new Map([...screen.values()].map(u => [u.id, { hp: u.hp, supp: u.supp, owner: u.owner, team: observation.players[u.owner]?.team, observationTick: observation.tick }]));
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
  const newAlerts = snapshot ? deriveAlertEvents(snapshot, state.previousSnapshot, {
    me: () => slot, team: () => me.team, friend: owner => observation.players[owner]?.team === me.team,
    unitName: type => UNITS[type]?.name ?? type, playerName: owner => observation.players[owner]?.name ?? 'An ally',
    home: () => me.spawn, pointPos: i => observation.points[i], onScreen: (x, z) => onScreen({ x, z }, state.camera, observation),
  }, state.alertState) : [];
  if (snapshot && snapshot.tick > (state.previousSnapshot?.tick ?? -1)) state.previousSnapshot = snapshot;
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
