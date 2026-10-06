// Movement profiles keep the current flat-ground top speeds as their baseline.
export const VEHICLE_PROFILES = Object.freeze({
  tank: { acceleration: 4.8, reverseAcceleration: 4, braking: 7.5, reverseSpeed: 0.5, hullTurn: 1.5, tracked: true },
  medium: { acceleration: 3.5, reverseAcceleration: 2.8, braking: 6.5, reverseSpeed: 0.45, hullTurn: 1.25, tracked: true },
  tankdestroyer: { acceleration: 4.2, reverseAcceleration: 3.2, braking: 7, reverseSpeed: 0.5, hullTurn: 1.35, tracked: true },
  tiger: { acceleration: 2.3, reverseAcceleration: 1.8, braking: 5, reverseSpeed: 0.4, hullTurn: 0.95, tracked: true },
  churchill: { acceleration: 1.9, reverseAcceleration: 1.6, braking: 4.5, reverseSpeed: 0.4, hullTurn: 0.85, tracked: true },
  armoredcar: { acceleration: 6.5, reverseAcceleration: 3.5, braking: 9, reverseSpeed: 0.4, hullTurn: 1.7, tracked: false },
  halftrack: { acceleration: 5.2, reverseAcceleration: 3, braking: 8, reverseSpeed: 0.4, hullTurn: 1.5, tracked: false },
  flaktrack: { acceleration: 4, reverseAcceleration: 2.7, braking: 7, reverseSpeed: 0.4, hullTurn: 1.35, tracked: false },
  truck: { acceleration: 5.2, reverseAcceleration: 3, braking: 8, reverseSpeed: .4, hullTurn: 1.5, tracked: false },
  rocket: { acceleration: 2.8, reverseAcceleration: 2, braking: 5.5, reverseSpeed: 0.4, hullTurn: 1.1, tracked: false },
});
const fallback = { acceleration: 4, reverseAcceleration: 2.5, braking: 7, reverseSpeed: 0.45, hullTurn: 1.5, tracked: true };
export const isGroundVehicle = def => !!def && !def.infantry && !def.structure && !def.air && !def.naval;
export const movementProfile = (type, def) => isGroundVehicle(def) ? VEHICLE_PROFILES[type] ?? fallback : null;
export const bodyRadius = def => (def?.radius ?? 1) * 0.8;
const navigationRadius = def => Math.hypot(bodyRadius(def), def.radius * 0.48);
export const angleDelta = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from));
export const turnAngle = (from, to, amount) => { const a = from + Math.max(-amount, Math.min(amount, angleDelta(from, to))); return Math.atan2(Math.sin(a), Math.cos(a)); };

// An oriented footprint against cell boxes. Checking boxes also catches a thin wall between sample points.
export function vehiclePositionClear(g, at, def, block, cell = 2) {
  const long = bodyRadius(def), wide = (def.radius ?? 1) * 0.48, a = at.rot ?? 0;
  const cos = Math.cos(a), sin = Math.sin(a), bx = Math.abs(cos) * long + Math.abs(sin) * wide, bz = Math.abs(sin) * long + Math.abs(cos) * wide;
  if (at.x - bx < 0 || at.z - bz < 0 || at.x + bx >= g.w * cell || at.z + bz >= g.h * cell) return false;
  const half = cell / 2;
  for (let y = Math.floor((at.z - bz) / cell); y <= Math.floor((at.z + bz) / cell); y++) {
    for (let x = Math.floor((at.x - bx) / cell); x <= Math.floor((at.x + bx) / cell); x++) {
      if (!(g.flags[y * g.w + x] & block)) continue;
      const dx = (x + 0.5) * cell - at.x, dz = (y + 0.5) * cell - at.z;
      if (Math.abs(dx) >= bx + half - 1e-6 || Math.abs(dz) >= bz + half - 1e-6) continue;
      if (Math.abs(dx * cos + dz * sin) >= long + half * (Math.abs(cos) + Math.abs(sin)) - 1e-6) continue;
      if (Math.abs(-dx * sin + dz * cos) >= wide + half * (Math.abs(cos) + Math.abs(sin)) - 1e-6) continue;
      return false;
    }
  }
  return true;
}
export function sweptVehicleClear(g, from, to, def, block, cell = 2) {
  if (!segmentCliffClear(g, from, to, cell)) return false;
  const d = Math.hypot(to.x - from.x, to.z - from.z), turn = angleDelta(from.rot ?? 0, to.rot ?? from.rot ?? 0);
  const count = Math.max(1, Math.ceil(d / 0.25), Math.ceil(Math.abs(turn) / 0.05));
  for (let i = 1; i <= count; i++) {
    const k = i / count, at = { x: from.x + (to.x - from.x) * k, z: from.z + (to.z - from.z) * k, rot: (from.rot ?? 0) + turn * k };
    if (!vehiclePositionClear(g, at, def, block, cell)) return false;
  }
  return true;
}

// Visit every crossed cell. Spaced samples can miss a cliff beside a ramp corner.
export function segmentCliffClear(g, from, to, cell = 2) {
  if (!g.height) return true;
  let x = Math.floor(from.x / cell), y = Math.floor(from.z / cell);
  const ex = Math.floor(to.x / cell), ey = Math.floor(to.z / cell), dx = to.x - from.x, dz = to.z - from.z;
  const sx = Math.sign(dx), sy = Math.sign(dz), stepX = dx ? cell / Math.abs(dx) : Infinity, stepY = dz ? cell / Math.abs(dz) : Infinity;
  let tx = dx ? (sx > 0 ? (x + 1) * cell - from.x : from.x - x * cell) / Math.abs(dx) : Infinity;
  let ty = dz ? (sy > 0 ? (y + 1) * cell - from.z : from.z - y * cell) / Math.abs(dz) : Infinity;
  if (x < 0 || y < 0 || x >= g.w || y >= g.h) return false;
  let height = g.height[y * g.w + x];
  for (let n = g.w + g.h; n > 0 && (x !== ex || y !== ey); n--) {
    if (x !== ex && y !== ey && Math.abs(tx - ty) < 1e-12) {
      const nx = x + sx, ny = y + sy;
      if (nx < 0 || ny < 0 || nx >= g.w || ny >= g.h) return false;
      if ([g.height[y * g.w + nx], g.height[ny * g.w + x], g.height[ny * g.w + nx]].some(next => Math.abs(next - height) > 1)) return false;
      x = nx; y = ny; tx += stepX; ty += stepY;
    } else if (y === ey || (x !== ex && tx < ty)) { x += sx; tx += stepX; } else { y += sy; ty += stepY; }
    if (x < 0 || y < 0 || x >= g.w || y >= g.h) return false;
    const next = g.height[y * g.w + x];
    if (Math.abs(next - height) > 1) return false;
    height = next;
  }
  return x === ex && y === ey;
}

// Return a candidate transform. Contacts may reduce it, but cannot increase its speed.
export function vehicleStep(u, def, path, topSpeed, dt, reverse = false) {
  const profile = movementProfile(u.type, def), wp = path[0], speed = u.moveSpeed ?? 0;
  let bearing = u.travelDir ?? u.rot, remaining = 0;
  if (wp) {
    bearing = Math.atan2(wp.z - u.z, wp.x - u.x);
    let at = u;
    for (let i = 0; i < path.length; i++) {
      const p = path[i], incoming = Math.atan2(p.z - at.z, p.x - at.x);
      remaining += Math.hypot(p.x - at.x, p.z - at.z); at = p;
      const next = path[i + 1];
      if (next && Math.abs(angleDelta(incoming, Math.atan2(next.z - p.z, next.x - p.x))) > 0.2) break;
    }
  }
  const hullGoal = reverse ? bearing + Math.PI : bearing;
  const error = Math.abs(angleDelta(u.rot, hullGoal)), rot = wp ? turnAngle(u.rot, hullGoal, profile.hullTurn * dt) : u.rot;
  const alignment = Math.max(0, Math.cos(error));
  // Leave one discrete step of braking room instead of chasing a point just passed.
  const brakeStep = profile.braking * dt / 2;
  const arrivalSpeed = Math.sqrt(2 * profile.braking * remaining + brakeStep * brakeStep) - brakeStep;
  let desired = wp ? Math.min(topSpeed * (reverse ? profile.reverseSpeed : 1), arrivalSpeed) * alignment : 0;
  if (error > (profile.tracked ? 0.16 : 0.45)) desired = 0;
  if (reverse) desired = -desired;
  const increasing = desired !== 0 && (!speed || Math.sign(desired) === Math.sign(speed)) && Math.abs(desired) > Math.abs(speed);
  const rate = increasing ? (reverse ? profile.reverseAcceleration : profile.acceleration) : profile.braking;
  let nextSpeed = speed + Math.max(-rate * dt, Math.min(rate * dt, desired - speed));
  if (Math.abs(nextSpeed) < 1e-6) nextSpeed = 0;
  // A changed direction brakes before accelerating the other way.
  if (speed && desired && Math.sign(speed) !== Math.sign(desired) && Math.sign(nextSpeed) !== Math.sign(speed)) nextSpeed = 0;
  const travel = nextSpeed < 0 ? rot + Math.PI : rot, distance = Math.abs(nextSpeed) * dt;
  return { x: u.x + Math.cos(travel) * distance, z: u.z + Math.sin(travel) * distance, rot, moveSpeed: nextSpeed, travelDir: bearing, distance };
}

const footprintViews = new WeakMap();
// An exact click needs the same turning room as the cell center used by navigation.
// The source flags belong to the observed terrain view, including on large maps.
export function vehicleDestinationClear(g, at, def, block, cell = 2) {
  const radius = navigationRadius(def), flags = g.vehicleSourceFlags ?? g.flags;
  if (at.x < radius || at.z < radius || at.x + radius >= g.w * cell || at.z + radius >= g.h * cell) return false;
  for (let y = Math.floor((at.z - radius) / cell); y <= Math.floor((at.z + radius) / cell); y++) {
    for (let x = Math.floor((at.x - radius) / cell); x <= Math.floor((at.x + radius) / cell); x++) {
      if (!(flags[y * g.w + x] & block)) continue;
      const dx = Math.max(x * cell - at.x, 0, at.x - (x + 1) * cell);
      const dz = Math.max(y * cell - at.z, 0, at.z - (y + 1) * cell);
      if (Math.hypot(dx, dz) < radius - 1e-6) return false;
    }
  }
  return true;
}
// Conservative clearance leaves enough room to rotate the rectangular hull at a waypoint.
export function vehicleNavigationView(g, def, block, cell = 2) {
  const radius = navigationRadius(def), reach = Math.ceil(radius / cell) + 1;
  let classes = footprintViews.get(g); if (!classes) footprintViews.set(g, classes = new Map());
  const key = `${block}:${radius}`, version = `${g.vehicleRegionVersion ?? 0}:${g.obstructionVersion ?? 0}:${g.navigationKnowledgeVersion ?? 0}`;
  let state = classes.get(key);
  if (state?.version === version && state.sourceFlags === g.flags) {
    // Terrain reuse must still refresh the currently observed moving obstacles and public weather.
    Object.assign(state.view, { units: g.units, fires: g.fires, wx: g.wx, weather: g.weather, tick: g.tick, reveal: g.reveal, vehicleSourceFlags: g.flags });
    return state.view;
  }
  const previous = state?.view.navigationKnowledgeVersion ?? 0, current = g.navigationKnowledgeVersion ?? g.vehicleRegionVersion ?? 0;
  const N = g.w * g.h, changed = new Set();
  const incremental = state && state.sourceFlags === g.flags && g.navigationChangedFromVersion === previous && g.navigationChangedCells;
  if (state && state.sourceFlags === g.flags && g.navigationChangedFromVersion === previous && g.navigationChangedCells) {
    for (const c of g.navigationChangedCells) {
      const x = c % g.w, y = Math.floor(c / g.w);
      for (let ny = Math.max(0, y - reach); ny <= Math.min(g.h - 1, y + reach); ny++) for (let nx = Math.max(0, x - reach); nx <= Math.min(g.w - 1, x + reach); nx++) changed.add(ny * g.w + nx);
    }
  } else {
    state = { view: { ...g, flags: new Uint16Array(N), vehicleFootprintKnown: true, navigationChanges: [] } }; classes.set(key, state);
    state.view.flags.set(g.flags);
  }
  const { view } = state, flags = view.flags;
  if (!incremental) {
    for (let c = 0; c < N; c++) {
      const x = c % g.w, y = Math.floor(c / g.w), px = (x + 0.5) * cell, pz = (y + 0.5) * cell;
      if (px < radius || pz < radius || px + radius >= g.w * cell || pz + radius >= g.h * cell) flags[c] |= block;
      if (!(g.flags[c] & block)) continue;
      for (let ny = Math.max(0, y - reach); ny <= Math.min(g.h - 1, y + reach); ny++) for (let nx = Math.max(0, x - reach); nx <= Math.min(g.w - 1, x + reach); nx++) {
        const dx = Math.max(0, Math.abs((nx - x) * cell) - cell / 2), dz = Math.max(0, Math.abs((ny - y) * cell) - cell / 2);
        if (Math.hypot(dx, dz) < radius - 1e-6) flags[ny * g.w + nx] |= block;
      }
    }
  }
  for (const c of changed) {
    const x = c % g.w, y = Math.floor(c / g.w), px = (x + 0.5) * cell, pz = (y + 0.5) * cell;
    let blocked = px < radius || pz < radius || px + radius >= g.w * cell || pz + radius >= g.h * cell;
    for (let ny = Math.max(0, y - reach); !blocked && ny <= Math.min(g.h - 1, y + reach); ny++) for (let nx = Math.max(0, x - reach); nx <= Math.min(g.w - 1, x + reach); nx++) {
      if (!(g.flags[ny * g.w + nx] & block)) continue;
      const dx = Math.max(0, Math.abs((nx - x) * cell) - cell / 2), dz = Math.max(0, Math.abs((ny - y) * cell) - cell / 2);
      if (Math.hypot(dx, dz) < radius - 1e-6) { blocked = true; break; }
    }
    flags[c] = g.flags[c] | (blocked ? block : 0);
  }
  const history = view.navigationChanges;
  Object.assign(view, g, { flags, vehicleSourceFlags: g.flags, vehicleFootprintKnown: true, navigationChangedFromVersion: previous, navigationChangedCells: changed,
    navigationKnowledgeVersion: current, navigationChanges: history });
  if (incremental && current !== previous) { history.push({ from: previous, to: current, cells: changed }); if (history.length > 32) history.shift(); }
  state.version = version; state.sourceFlags = g.flags;
  return view;
}
