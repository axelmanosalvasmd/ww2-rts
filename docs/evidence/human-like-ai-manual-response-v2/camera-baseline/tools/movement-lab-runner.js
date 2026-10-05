import { createMovementCase } from './movement-lab-scenarios.js';
const delta = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
// Check the observed trajectory independently of the movement solver's cliff reader.
function crossesCliff(g, from, to, cell) {
  if (!g.height) return false;
  const dx = to.x - from.x, dz = to.z - from.z, crossings = [0, 1];
  for (const [a, b, distance] of [[from.x, to.x, dx], [from.z, to.z, dz]]) {
    if (!distance) continue;
    for (let edge = Math.floor(Math.min(a, b) / cell) + 1; edge <= Math.floor(Math.max(a, b) / cell); edge++) {
      const t = (edge * cell - a) / distance; if (t > 0 && t < 1) crossings.push(t);
    }
  }
  crossings.sort((a, b) => a - b);
  const height = t => g.height[Math.floor((from.z + dz * t) / cell) * g.w + Math.floor((from.x + dx * t) / cell)];
  let previous = height(0);
  for (let i = 1; i < crossings.length; i++) {
    const current = height((crossings[i - 1] + crossings[i]) / 2);
    if (Math.abs(current - previous) > 1) return true;
    previous = current;
  }
  return Math.abs(height(1) - previous) > 1;
}

export function runMovementCase(sim, motion, id, options = {}) {
  const fixture = createMovementCase(sim, id, options), { g, scenario, goals, anchors, checkpoints, visits } = fixture;
  const visited = new Map([...visits.keys()].map(id => [id, 0]));
  const metrics = new Map([...g.units.values()].map(u => [u.id, { id: u.id, type: u.type, distance: 0, turn: 0, orderTurn: 0, maxOrderTurn: 0, stationaryTurn: 0, maxStationaryTurn: 0, hullViolations: 0, cliffViolations: 0, unreachable: false, reverseLost: false }]));
  const frames = [], record = () => frames.push({ time: fixture.elapsed, units: [...g.units.values()].map(u => ({ id: u.id, type: u.type, x: u.x, z: u.z, rot: u.rot, speed: u.moveSpeed ?? 0,
    path: u.path.map(p => ({ x: p.x, z: p.z })), goal: u.worldGoal, traffic: u.traffic?.goal ?? null, clearance: u.motionClearance?.goal ?? null, outcome: u.moveOutcome })) });
  record();
  for (let n = 0; n < Math.round(scenario.seconds / sim.TICK); n++) {
    const previous = new Map([...g.units.values()].map(u => [u.id, { x: u.x, z: u.z, rot: u.rot }]));
    fixture.advance();
    for (const u of g.units.values()) {
      const m = metrics.get(u.id), before = previous.get(u.id), travelled = Math.hypot(u.x - before.x, u.z - before.z), turn = Math.abs(delta(before.rot, u.rot));
      m.distance += travelled; m.turn += turn;
      const orderKey = u.worldGoal && `${u.worldGoal.x}:${u.worldGoal.z}`;
      if (orderKey && orderKey !== m.orderKey) { m.orderKey = orderKey; m.orderTurn = 0; }
      m.orderTurn += turn; m.maxOrderTurn = Math.max(m.maxOrderTurn, m.orderTurn);
      m.stationaryTurn = travelled < 0.001 ? m.stationaryTurn + turn : 0;
      m.maxStationaryTurn = Math.max(m.maxStationaryTurn, m.stationaryTurn);
      m.unreachable ||= u.moveResult?.[0] === 'unreachable';
      if (id === 'reverse-obstacle' && motion.isGroundVehicle(sim.UNITS[u.type]) && u.worldGoal && u.path.length && !u.reverse) m.reverseLost = true;
      const expectedVisit = visits.get(u.id)?.[visited.get(u.id)];
      if (expectedVisit && Math.hypot(u.x - expectedVisit.x, u.z - expectedVisit.z) < 0.25 && Math.abs(u.moveSpeed ?? 0) < 0.1) visited.set(u.id, visited.get(u.id) + 1);
      if (motion.isGroundVehicle(sim.UNITS[u.type]) && !motion.vehiclePositionClear(g, u, sim.UNITS[u.type], sim.MOVE | sim.VBLOCK)) m.hullViolations++;
      if (crossesCliff(g, before, u, sim.CELL)) m.cliffViolations++;
    }
    if (options.trace && n % 2 === 0) record();
  }
  const failures = [], rows = [...g.units.values()].map(u => {
    const m = metrics.get(u.id), goal = goals.get(u.id), destination = goal?.retreat ? goal : u.routeEnd ?? goal;
    const error = goal ? Math.hypot(u.x - destination.x, u.z - destination.z) : 0;
    if (goal && (error > (goal.retreat ? sim.CFG.reinforceRadius + 0.5 : 0.5) || u.path.length || u.worldGoal || Math.abs(u.moveSpeed ?? 0) > 0.1)) failures.push(`${u.type} #${u.id} did not finish (${error.toFixed(2)} m left)`);
    if (m.maxStationaryTurn > Math.PI * 1.9) failures.push(`${u.type} #${u.id} turned ${(m.maxStationaryTurn / Math.PI * 180).toFixed(1)} degrees without moving`);
    if (['arrival', 'short', 'redirect'].includes(id) && m.maxOrderTurn > Math.PI * 1.75) failures.push(`${u.type} #${u.id} turned ${(m.maxOrderTurn / Math.PI * 180).toFixed(1)} degrees on one open-route order`);
    if (m.reverseLost) failures.push(`${u.type} #${u.id} lost reverse intent while replanning`);
    if (m.hullViolations) failures.push(`${u.type} #${u.id} crossed blocked terrain on ${m.hullViolations} ticks`);
    if (m.cliffViolations) failures.push(`${u.type} #${u.id} crossed a cliff on ${m.cliffViolations} ticks`);
    const anchor = anchors.get(u.id);
    if (anchor && Math.hypot(u.x - anchor.x, u.z - anchor.z) > 0.01) failures.push(`Protected blocker #${u.id} moved`);
    if (visits.has(u.id) && visited.get(u.id) !== visits.get(u.id).length) failures.push(`${u.type} #${u.id} missed a queued destination (${visited.get(u.id)}/${visits.get(u.id).length} visited in order)`);
    return { ...m, x: u.x, z: u.z, speed: u.moveSpeed ?? 0, error, outcome: u.moveOutcome };
  });
  for (const checkpoint of checkpoints) {
    if (checkpoint.kind === 'stopped' && (checkpoint.speed || checkpoint.goal || checkpoint.path || checkpoint.clearance)) failures.push('Stop retained travel work');
    if (checkpoint.kind === 'stopDrift' && checkpoint.distance > 0.001) failures.push('Stopped unit drifted or resumed its old order');
    if (checkpoint.kind === 'budget' && (Math.hypot(checkpoint.x - 50.13, checkpoint.z - 50.27) > 0.001 || checkpoint.path)) failures.push('Deferred path moved before a route was available');
    if (checkpoint.kind === 'reverse' && motion.isGroundVehicle(sim.UNITS[fixture.type]) && (checkpoint.speed >= 0 || Math.cos(checkpoint.rot) < 0.99)) failures.push('Short reverse lost its threat-facing hull');
  }
  if (id === 'unreachable' && !rows.some(row => row.unreachable)) failures.push('Disconnected route did not report unreachable');
  if (options.trace) record();
  return { scenario: id, name: scenario.name, type: fixture.type, heading: fixture.heading, seed: fixture.seed, seconds: fixture.elapsed,
    passed: !failures.length, failures, units: rows, checkpoints, events: fixture.events.map(({ tick, label }) => ({ time: tick * sim.TICK, label })),
    ...(options.trace && { map: { w: g.w, h: g.h, rows: g.initialTerrain.chars.join('').match(new RegExp(`.{${g.w}}`, 'g')) }, frames }) };
}
