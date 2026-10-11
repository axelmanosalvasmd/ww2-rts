// Unit movement along a route, one tick at a time: ground vehicles (driveVehicle) and infantry and boats (walkRoute),
// called from step()'s unit loop in shared/sim.js. The simulation hands over what it owns through createMovers (its
// walkability test, who is allied, the unit table and the config), so this file does not import shared/sim.js.
import { vehicleStep, sweptVehicleClear, movementProfile, bodyRadius, angleDelta } from './vehicle-motion.js';
import { gridFor } from './grid.js';
import { TRAFFIC, startGhost, ghostPair } from './local-traffic.js';

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export function createMovers({ walkable, allied, blockOf, UNITS, CFG, WIRE }) {
  // two friends, one of them a ghost for now: they pass through each other
  const friendsGhost = (g, a, b) => allied(g, a.owner, b.owner) && ghostPair(g, a, b, true);
  // One tick of a ground vehicle along its route (from step's unit loop): the hull's own motion (vehicleStep), backing
  // or sliding out when walled in, the fuel limit, the swept check against walls and units, ghosting past a friend that
  // boxes it in, and taking the next leg. route: what traffic lets it follow now; before: where it stood this tick.
  function driveVehicle(g, u, def, route, speed, dt, back, traffic, before, trafficView) {
    const reverse = back || traffic.yielding && traffic.goal && Math.cos(Math.atan2(traffic.goal.z - u.z, traffic.goal.x - u.x) - u.rot) < -0.5;
    if (u.motionClearance && (u.motionClearance.path !== u.path || g.tick > u.motionClearance.until || dist(u, u.motionClearance.goal) < 0.3)) u.motionClearance = null;
    let next = vehicleStep(u, def, u.motionClearance ? [u.motionClearance.goal] : route, u.motionClearance ? Math.min(speed, 1.2) : speed, dt, u.motionClearance ? u.motionClearance.reverse : reverse);
    if (!u.motionClearance && route.length && u.stuck > 0.3 && !sweptVehicleClear(g, before, { ...before, rot: next.rot }, def, blockOf(def))) {
      for (const direction of [-1, 1]) {
        const goal = { x: before.x + Math.cos(before.rot) * 2 * direction, z: before.z + Math.sin(before.rot) * 2 * direction, rot: before.rot };
        if (!sweptVehicleClear(g, before, goal, def, blockOf(def))) continue;
        const bearing = Math.atan2(route[0].z - goal.z, route[0].x - goal.x) + (reverse ? Math.PI : 0);
        if (!sweptVehicleClear(g, goal, { ...goal, rot: bearing }, def, blockOf(def))) continue;
        u.motionClearance = { goal, reverse: direction < 0, path: u.path, until: g.tick + 80 };
        next = vehicleStep(u, def, [goal], Math.min(speed, 1.2), dt, direction < 0); break;
      }
      // walled in lengthwise too (a hull shoved off-centre and sideways in a narrow street): slide over, up to
      // 1.5 m at 1.2 m/s, to where the turn fits. Separation already shoves hulls sideways, so this adds no new move.
      if (!u.motionClearance) for (const side of [0.5, -0.5, 1, -1, 1.5, -1.5]) {
        const at = { x: before.x - Math.sin(before.rot) * side, z: before.z + Math.cos(before.rot) * side, rot: before.rot };
        const bearing = Math.atan2(route[0].z - at.z, route[0].x - at.x) + (reverse ? Math.PI : 0);
        if (!sweptVehicleClear(g, before, at, def, blockOf(def)) || !sweptVehicleClear(g, at, { ...at, rot: bearing }, def, blockOf(def))) continue;
        const k = Math.min(1, 1.2 * dt / Math.abs(side));
        next = { ...next, x: before.x + (at.x - before.x) * k, z: before.z + (at.z - before.z) * k, rot: before.rot, moveSpeed: 0 }; break;
      }
    }
    const fuelLimit = speed * dt, proposed = dist(next, before);
    if ((u.convoy || u.logistics) && proposed > fuelLimit) { const f = fuelLimit / (proposed || 1); next.x = before.x + (next.x-before.x)*f; next.z = before.z + (next.z-before.z)*f; next.moveSpeed *= f; }
    // Never allow a hull to rotate or travel through a cell during this tick.
    let clearMotion = sweptVehicleClear(g, before, next, def, blockOf(def));
    if (clearMotion) {
      const nearby = gridFor(g).unordered(u, bodyRadius(def) + 9, v => v.id !== u.id && v.hp > 0 && !v.air && !v.riding && v.garrison < 0 && !friendsGhost(g, u, v));
      const blocker = nearby.find(v => {
        const min = bodyRadius(def) + bodyRadius(UNITS[v.type]);
        const dx = next.x - before.x, dz = next.z - before.z, t = Math.max(0, Math.min(1, ((v.x - before.x) * dx + (v.z - before.z) * dz) / (dx * dx + dz * dz || 1)));
        const closest = Math.hypot(before.x + dx * t - v.x, before.z + dz * t - v.z);
        return !(closest >= min - 1e-6 || dist(before, v) < min && dist(next, v) > dist(before, v));
      });
      clearMotion = !blocker;
      // boxed in by a friend for a while (a crowded gate or street): pass through friends for a moment
      if (blocker && allied(g, blocker.owner, u.owner) && u.stuck > TRAFFIC.ghost) startGhost(g, u, TRAFFIC.ghostTime, dt);
    }
    if (clearMotion) { u.x = next.x; u.z = next.z; u.rot = next.rot; u.moveSpeed = next.moveSpeed; }
    else {
      u.moveSpeed = 0;
      const turned = { ...before, rot: next.rot };
      if (sweptVehicleClear(g, before, turned, def, blockOf(def))) u.rot = next.rot;
      u.trafficWait = (u.trafficWait ?? 0) + dt;
    }
    u.travelDir = next.travelDir;
    // A bend is taken at speed (vehicleStep brakes to it): turn onto the next leg a little early, or just past the
    // waypoint, where the hull has a clear straight line to the next one; otherwise on reaching the waypoint.
    const nextLeg = route[1], near = route.length ? dist(u, route[0]) : Infinity, pace = Math.abs(u.moveSpeed);
    const bend = nextLeg ? Math.abs(angleDelta(u.travelDir, Math.atan2(nextLeg.z - route[0].z, nextLeg.x - route[0].x))) : Math.PI;
    const lead = bend < Math.PI / 2 ? pace / movementProfile(u.type, def).hullTurn * Math.tan(bend / 2) : 0;
    const passed = near < 2 && Math.cos(Math.atan2(u.z - route[0]?.z, u.x - route[0]?.x) - u.travelDir) > 0;
    const reached = near < Math.max(0.12, pace * dt * 1.5) || nextLeg && (near < lead || passed) && walkable(trafficView(), u, nextLeg, blockOf(def), bodyRadius(def));
    if (reached && !traffic.yielding && !u.motionClearance) u.path.shift();
  }
  // One tick of infantry or a boat along its route (from step's unit loop), the counterpart of driveVehicle: straight legs
  // at full speed, the next waypoint taken on reaching it. Infantry responds on the command tick; boats keep their class
  // rules. A leg that runs into a blocked cell drops the route and asks for a new one shortly.
  function walkRoute(g, u, def, route, speed, dt, back, traffic, trafficView) {
    if (def.infantry && !traffic.yielding) {
      // Crowded squads can pass beside a waypoint. Keep required terrain corners and the exact final spot.
      while (route.length > 1 && dist(u, route[0]) < 1 && walkable(trafficView(), u, route[1], blockOf(def) | WIRE)) route.shift();
    }
    let budget = speed * dt * (back ? CFG.behavior.reverseSpeed : 1);
    while (budget > 0 && route.length) {
      const wp = route[0], d = dist(u, wp), advance = Math.min(d, budget), next = { x: u.x + (wp.x - u.x) / (d || 1) * advance, z: u.z + (wp.z - u.z) / (d || 1) * advance };
      if (!walkable(g, u, next, blockOf(def))) { u.repath = 0.2; if (!traffic.yielding) u.path = []; break; }
      if (!back) u.rot = Math.atan2(wp.z - u.z, wp.x - u.x);
      u.x = next.x; u.z = next.z; budget -= advance;
      if (d <= advance + 1e-9) { if (traffic.yielding) break; route.shift(); } else break;
    }
  }
  return { driveVehicle, walkRoute };
}
