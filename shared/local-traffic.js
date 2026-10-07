// Steering uses the existing spatial index. It leaves the ordered route intact.
import { bodyRadius } from './vehicle-motion.js';
export const TRAFFIC = Object.freeze({ horizon: 0.7, wait: 0.35, alternate: 1.1, replan: 3, age: 2, maxYield: 5 });
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
// nearby is unordered: the conflict ties on id and the rest only asks some/every, so the sort was wasted work.
export function trafficStep(g, u, goal, context) {
  const { defs, grid, clear, coverRank, visible, dt } = context;
  if (!goal || protectedUnit(u)) { u.traffic = null; u.trafficWait = 0; return { goal, blocked: false }; }
  const def = defs[u.type], d = length(u, goal), dx = (goal.x - u.x) / (d || 1), dz = (goal.z - u.z) / (d || 1);
  const radius = bodyRadius(def) + 7, nearby = grid.candidates(u, radius, false, v => v.id !== u.id && v.id !== u.board && v.hp > 0 && !v.air && !v.riding && v.garrison < 0 && !(def.infantry && defs[v.type].infantry) && visible(v));
  const velocity = Math.min(def.speed, d / dt), vx = dx * velocity, vz = dz * velocity;
  let conflict = null, time = Infinity;
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
    if (t < time || t === time && v.id < conflict?.id) { conflict = v; time = t; }
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
  // Stable priority remains for the whole maneuver. The other unit can see the yielded lane.
  if (conflict.traffic?.by === u.id || trafficWins(g, u, conflict) && !defs[conflict.type].structure && !protectedUnit(conflict) && conflict.path?.length) return { goal, blocked: false };
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
