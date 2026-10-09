// Steering uses the existing spatial index. It leaves the ordered route intact.
import { bodyRadius } from './vehicle-motion.js';
export const TRAFFIC = Object.freeze({ horizon: 0.7, wait: 0.35, alternate: 1.1, replan: 3, age: 2, maxYield: 5, ghost: 3, ghostTime: 2 });
const length = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const priority = (g, u) => (u.retreating ? 30 : u.drift ? 0 : u.path?.length ? 10 : 20) + Math.min(25, Math.floor((u.trafficWait ?? 0) / TRAFFIC.age) * 5);
export function trafficWins(g, a, b) {
  const pa = priority(g, a), pb = priority(g, b);
  if (pa !== pb) return pa > pb;
  const occupiedA = !!a.trafficEntered, occupiedB = !!b.trafficEntered;
  return occupiedA !== occupiedB ? occupiedA : a.id < b.id;
}
const protectedUnit = u => (u.holdPos && !u.path?.length && !u.worldGoal && !u.amove && !u.retreating) || u.garrison >= 0 || u.riding || u.build || u.dig || u.entrench;
function radiusPair(a, b, defs) {
  const da = defs[a.type], db = defs[b.type];
  return da.infantry && db.infantry ? (da.radius + db.radius) * 0.45 : bodyRadius(da) + bodyRadius(db);
}
// Which way a unit's route runs over the next 8 m. Friends whose routes run the same way are in one queue, even where
// they meet the mouth of a gap from opposite sides.
function heading(u) {
  let x = u.x, z = u.z, left = 8;
  for (const p of u.path ?? []) {
    const d = length({ x, z }, p);
    if (d >= left) { x += (p.x - x) * left / d; z += (p.z - z) * left / d; break; }
    left -= d; x = p.x; z = p.z;
  }
  const d = length(u, { x, z });
  return d > 0.1 ? { x: (x - u.x) / d, z: (z - u.z) / d } : null;
}
// Whether v already waits on u, directly or down a line of others. Then u goes, so no ring of waiting units forms.
function waitsOn(g, v, u) {
  for (let w = v, k = 0; w?.queuedBehind && k < 16; w = g.units.get(w.queuedBehind), k++) if (w.queuedBehind === u.id) return true;
  return false;
}
// One-lane stretches (a gap, a bridge, a street too narrow for two hulls to pass): oncoming friends take turns. The
// one in the stretch, or else the one nearer it, goes; the other holds short of it until it empties, instead of two
// columns meeting nose to nose inside. ahead: how far along its route a hull looks; margin: room beyond the two hull
// widths and passing gap; hold: how far short of the stretch it stops, beyond its own length.
export const LANE = Object.freeze({ ahead: 32, margin: 1.5, hold: 16 });
// Open ground across the route at (x, z), up to need on each side, from open(x, z) on the remembered terrain.
function laneWidth(open, x, z, nx, nz, need) {
  let width = 0;
  for (const side of [1, -1]) for (let k = 0.5; k <= need && width < need && open(x + nx * k * side, z + nz * k * side); k += 0.5) width += 0.5;
  return width;
}
// Where the route ahead first runs through ground too narrow for two of these hulls to pass, and where that ends.
function oneLane(u, def, open) {
  const need = 0.96 * def.radius + 2 * bodyRadius(def) + LANE.margin;
  let at = u, travelled = 0, entry = null, exit = null;
  for (const p of u.path) {
    const d = length(at, p), nx = -(p.z - at.z) / (d || 1), nz = (p.x - at.x) / (d || 1);
    for (let s = 0; s < d; s++) {
      const x = at.x + (p.x - at.x) * s / d, z = at.z + (p.z - at.z) * s / d;
      if (laneWidth(open, x, z, nx, nz, need) < need) { entry ??= { x, z }; exit = { x, z }; }
      else if (entry) return { entry, exit };
      if (travelled + s > LANE.ahead) return entry && { entry, exit };
    }
    travelled += d; at = p;
  }
  return entry && { entry, exit };
}
// The route's next one-lane stretch, looked for again every half second or on a new route (the search is the costly
// part, so it runs before anyone is asked whether they are oncoming).
function laneAhead(g, u, def, open) {
  if (u.laneScan?.path !== u.path || g.tick >= u.laneScan.until) u.laneScan = { path: u.path, until: g.tick + 10, lane: oneLane(u, def, open) };
  return u.laneScan.lane;
}
// The oncoming friend (a squad too) that has the one-lane stretch ahead of u, if u should hold short of it for one.
function laneHolder(g, u, def, context, friend) {
  const own = heading(u), lane = own && laneAhead(g, u, def, context.open);
  if (!lane) return null;
  // Its nose already in it (or past its start): drive on through. Further than the hold point: carry on for now.
  const { entry, exit } = lane, before = (entry.x - u.x) * own.x + (entry.z - u.z) * own.z;
  if (before < bodyRadius(def) + 0.5 || length(u, entry) > 2 * bodyRadius(def) + LANE.hold) return null;
  const oncoming = context.grid.candidates(u, LANE.ahead, false, v => v.id !== u.id && v.hp > 0 && !v.air && !v.riding && v.path?.length
    && friend(v) && context.visible(v) && (v.x - u.x) * own.x + (v.z - u.z) * own.z > 0 && (h => h && h.x * own.x + h.z * own.z < -0.3)(heading(v)));
  if (!oncoming.length) return null;
  const sx = exit.x - entry.x, sz = exit.z - entry.z, squared = sx * sx + sz * sz;
  // Who is nearer is measured to the 2 m cell in the middle of the stretch, so both sides agree.
  const mid = { x: (Math.floor((entry.x + exit.x) / 4) + 0.5) * 2, z: (Math.floor((entry.z + exit.z) / 4) + 0.5) * 2 }, near = length(u, mid);
  return oncoming.find(v => {
    const k = Math.max(0, Math.min(1, ((v.x - entry.x) * sx + (v.z - entry.z) * sz) / (squared || 1)));
    if (Math.hypot(entry.x + sx * k - v.x, entry.z + sz * k - v.z) <= bodyRadius(context.defs[v.type]) + 0.5) return true;
    // Outside it, only one on its way (not waiting on anyone) and nearer to it has the stretch.
    const far = length(v, mid), h = heading(v);
    return !v.queuedBehind && (mid.x - v.x) * h.x + (mid.z - v.z) * h.z > 0 && (far < near || far === near && v.id < u.id);
  }) ?? null;
}
// nearby is unordered: the conflict ties on id and the rest only asks some/every, so the sort was wasted work.
export function trafficStep(g, u, goal, context) {
  const { defs, grid, clear, coverRank, visible, dt } = context, friend = context.friend ?? (v => v.owner === u.owner);
  u.queuedBehind = 0;
  if (!goal || protectedUnit(u)) { u.traffic = null; u.trafficWait = 0; return { goal, blocked: false }; }
  const def = defs[u.type], d = length(u, goal), dx = (goal.x - u.x) / (d || 1), dz = (goal.z - u.z) / (d || 1);
  const holder = context.open && !def.infantry && !u.traffic && u.path?.length && laneHolder(g, u, def, context, friend);
  const radius = bodyRadius(def) + 7, nearby = grid.candidates(u, radius, false, v => !(def.infantry && defs[v.type].infantry) && v.id !== u.id && v.id !== u.board && v.hp > 0 && !v.air && !v.riding && v.garrison < 0 && !(((v.ghost ?? 0) > g.tick || (u.ghost ?? 0) > g.tick) && friend(v)) && visible(v), def.infantry); // a squad steers around vehicles only
  const velocity = Math.min(def.speed, d / dt), vx = dx * velocity, vz = dz * velocity;
  let conflict = null, time = Infinity, follow = false, own;
  for (const v of nearby) {
    const vd = defs[v.type];
    // Infantry pairs were excluded above, including from passing-leg occupancy.
    const wp = v.traffic?.goal ?? v.path?.[0], vl = wp ? length(v, wp) : 0;
    const vvx = v.vx ?? (wp ? (wp.x - v.x) / (vl || 1) * vd.speed : 0), vvz = v.vz ?? (wp ? (wp.z - v.z) / (vl || 1) * vd.speed : 0);
    const rx = v.x - u.x, rz = v.z - u.z, rvx = vvx - vx, rvz = vvz - vz;
    const t = Math.max(0, Math.min(TRAFFIC.horizon, -(rx * rvx + rz * rvz) / (rvx * rvx + rvz * rvz || 1)));
    const min = radiusPair(u, v, defs) + 0.15;
    if (Math.hypot(rx + rvx * t, rz + rvz * t) >= min) continue;
    // A unit already moving away does not hold up someone behind it.
    if (rx * rvx + rz * rvz >= 0 && Math.hypot(rx, rz) >= min - 0.1) continue;
    // Friends whose routes run the same way queue (a gap, a bridge, a street): one clearly in front (within 60 degrees
    // of this unit's travel) is waited for instead of dodged; one behind, or already waiting on this unit, is ignored.
    // One alongside is ordinary traffic. Two that each see the other in front: the first to wait holds.
    const a = friend(v) && (own ??= heading(u)), b = a && heading(v), along = (rx * dx + rz * dz) / (Math.hypot(rx, rz) || 1);
    const same = !!b && a.x * b.x + a.z * b.z > 0, queue = same && along > 0.5;
    if (same && (along < 0 || waitsOn(g, v, u))) continue;
    if (t < time || t === time && v.id < conflict?.id) { conflict = v; time = t; follow = queue; }
  }
  // Holding short of a one-lane stretch: wait there, unless someone runs into this unit; then it gives way like any other.
  if (holder && (!conflict || follow)) { u.queuedBehind = holder.id; return { goal: null, blocked: true, waiting: true }; }
  // The one in front is stuck without waiting on anyone, likely on this unit (both at the corner in a gap's mouth): give way.
  const giveWay = !!holder || follow && conflict.stuck > 1 && !conflict.queuedBehind;
  if (giveWay) follow = false;
  // Gridlocked by a friend, own or allied (waiting, yielding, waiting again): pass through friends for a moment (a ghost, see stepOut).
  if (conflict && !follow && friend(conflict) && u.trafficWait >= TRAFFIC.ghost) {
    u.ghost = g.tick + Math.round(TRAFFIC.ghostTime / dt); u.traffic = null; u.trafficWait = 0; u.trafficEntered = !!u.path?.length;
    return { goal: u.path?.[0] ?? goal, blocked: false };
  }
  if (u.traffic) {
    const v = g.units.get(u.traffic.by);
    if (u.traffic.passing && v?.hp > 0) {
      if (length(u, u.traffic.goal) < 0.4) {
        u.traffic.legs.shift();
        if (u.traffic.legs.length) { u.traffic.goal = u.traffic.legs[0]; u.traffic.until = g.tick * dt + TRAFFIC.maxYield; }
        else {
          // Resume only a retained waypoint whose complete segment clears terrain and visible bodies.
          let resume = -1;
          for (let i = u.path.length - 1; i >= 0; i--) {
            const point = u.path[i], sx = point.x - u.x, sz = point.z - u.z, squared = sx * sx + sz * sz;
            if (!clear(u, point)) continue;
            const free = nearby.every(other => {
              const along = Math.max(0, Math.min(1, ((other.x - u.x) * sx + (other.z - u.z) * sz) / (squared || 1)));
              return Math.hypot(u.x + sx * along - other.x, u.z + sz * along - other.z) >= radiusPair(u, other, defs) + 0.15;
            });
            if (free) { resume = i; break; }
          }
          u.traffic = null; u.trafficWait = 0; u.trafficEntered = false;
          if (resume >= 0) { u.path.splice(0, resume); return { goal: u.path[0], blocked: false }; }
          u.repath = 0; return { goal: u.path[0], blocked: false, replan: true };
        }
      }
      if (g.tick * dt < u.traffic.until) return { goal: u.traffic.goal, blocked: false, yielding: true };
      u.traffic = null;
    }
    if (!u.traffic) return { goal: u.path[0], blocked: false, replan: true };
    const arrived = length(u, u.traffic.goal) < 0.4;
    const safe = !v || v.hp <= 0 || length(u, v) > radiusPair(u, v, defs) + 4;
    if (safe || g.tick * dt >= u.traffic.until) { u.traffic = null; u.trafficEntered = false; }
    else if (!arrived) return { goal: u.traffic.goal, blocked: false, yielding: true };
    else return { goal: null, blocked: true, yielding: true };
  }
  if (!conflict) { u.trafficWait = Math.max(0, (u.trafficWait ?? 0) - dt); u.trafficEntered = !!u.path?.length; return { goal, blocked: false }; }
  // Waiting in a queue is not gridlock: it neither ages priority, leads to a ghost, nor asks for a new route.
  if (follow) { u.queuedBehind = conflict.id; return { goal: null, blocked: true, waiting: true }; }
  // Stable priority remains for the whole maneuver. The other unit can see the yielded lane.
  if (!giveWay && (conflict.traffic?.by === u.id || waitsOn(g, conflict, u) || trafficWins(g, u, conflict) && !defs[conflict.type].structure && !protectedUnit(conflict) && conflict.path?.length)) return { goal, blocked: false };
  u.trafficWait = (u.trafficWait ?? 0) + dt;
  if (u.trafficWait < TRAFFIC.wait) return { goal: null, blocked: true };
  const minCover = coverRank(u), side = u.id < conflict.id ? 1 : -1, distance = radiusPair(u, conflict, defs) + 0.7;
  const occupied = at => nearby.some(v => length(at, v) < radiusPair(u, v, defs) + 0.2);
  const candidates = [];
  for (const k of [1, 1.5, 2]) {
    for (const sign of [side, -side]) candidates.push({ x: u.x - dz * sign * distance * k - dx * 0.8, z: u.z + dx * sign * distance * k - dz * 0.8 });
  }
  // At a narrow crossing, back to a wider piece of the route instead of alternating sides every tick.
  for (const at of [...(u.trafficTrail ?? [])].reverse()) if (length(u, at) > distance && length(u, at) < 24) candidates.push(at);
  for (const at of candidates) {
    if (!clear(u, at) || occupied(at) || coverRank(at) > minCover) continue;
    if (!conflict.path?.length) {
      // A stopped unit cannot clear a yielded lane. Pass around it through validated local legs.
      const lateral = (at.x - u.x) * -dz + (at.z - u.z) * dx, offset = Math.sign(lateral) * Math.max(distance, Math.abs(lateral));
      const pass = { x: conflict.x - dz * offset, z: conflict.z + dx * offset };
      const corner = { x: pass.x + dx * distance, z: pass.z + dz * distance };
      const exit = { x: conflict.x + dx * distance, z: conflict.z + dz * distance };
      const legs = [{ x: at.x, z: at.z }, pass, corner, exit];
      let previous = u;
      if (!legs.every(point => { const safe = clear(previous, point) && !occupied(point) && coverRank(point) <= minCover; previous = point; return safe; })) continue;
      u.traffic = { goal: legs[0], legs, passing: true, by: conflict.id, until: g.tick * dt + TRAFFIC.maxYield };
      u.trafficEntered = false;
      return { goal: u.traffic.goal, blocked: false, yielding: true };
    }
    u.traffic = { goal: { x: at.x, z: at.z }, by: conflict.id, until: g.tick * dt + TRAFFIC.maxYield };
    u.trafficEntered = false;
    return { goal: u.traffic.goal, blocked: false, yielding: true };
  }
  return { goal: null, blocked: true, replan: u.trafficWait >= TRAFFIC.replan };
}
export function rememberTrafficPosition(u, dt) {
  if (!u.path?.length || u.traffic) return;
  const trail = u.trafficTrail ??= [], last = trail.at(-1);
  if (!last || length(u, last) >= 1.5) trail.push({ x: u.x, z: u.z, rot: u.rot });
  while (trail.length > 20) trail.shift();
}
