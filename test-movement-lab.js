import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MOVEMENT_SCENARIOS, MOVEMENT_TYPES } from './tools/movement-lab-scenarios.js';
import { runMovementCase } from './tools/movement-lab-runner.js';

const dropMiddleControl = process.argv.includes('--drop-middle-control');
const ignoreCliffsControl = process.argv.includes('--ignore-cliffs-control');
if (dropMiddleControl || ignoreCliffsControl) registerHooks({ load(url, context, nextLoad) {
  const loaded = nextLoad(url, context);
  if (!url.endsWith(dropMiddleControl ? '/shared/sim.js' : '/shared/vehicle-motion.js')) return loaded;
  const source = String(loaded.source), original = dropMiddleControl ? '(u.orders ??= []).push(order);' : 'export function segmentCliffClear(g, from, to, cell = 2) {';
  assert.equal(source.split(original).length, 2, 'the negative control replaces exactly one behavior');
  return { ...loaded, source: source.replace(original, dropMiddleControl ? 'u.orders = [order];' : original + ' return true;') };
} });
const sim = await import('./shared/sim.js'), motion = await import('./shared/vehicle-motion.js');
if (dropMiddleControl || ignoreCliffsControl) {
  for (const type of ['tank', 'armoredcar', 'rifle']) {
    const result = runMovementCase(sim, motion, dropMiddleControl ? 'queue' : 'cliff', { type });
    assert.ok(result.failures.some(failure => failure.includes(dropMiddleControl ? 'missed a queued destination' : 'crossed a cliff')), `${type} detects the broken control`);
  }
  console.log(dropMiddleControl ? 'PASS queue negative control: dropped middle destinations fail the lab' : 'PASS cliff negative control: illegal height crossings fail the lab');
  process.exit(0);
}

let cases = 0;
for (const type of MOVEMENT_TYPES) for (const scenario of MOVEMENT_SCENARIOS) {
  const result = runMovementCase(sim, motion, scenario.id, { type });
  assert.deepEqual(result.failures, [], `${type}/${scenario.id}: ${result.failures.join('; ')}`);
  cases++;
}
for (const type of Object.keys(motion.VEHICLE_PROFILES)) {
  const def = sim.UNITS[type], profile = motion.VEHICLE_PROFILES[type];
  for (const reverse of [false, true]) {
    const unit = { type, x: 30, z: 30, rot: 0, moveSpeed: 0 };
    const next = motion.vehicleStep(unit, def, [{ x: reverse ? 10 : 80, z: 30 }], def.speed, sim.TICK, reverse);
    assert.ok(Math.abs(next.moveSpeed) <= (reverse ? profile.reverseAcceleration : profile.acceleration) * sim.TICK + 1e-9, `${type} starts within its acceleration limit`);
    assert.ok(reverse ? next.moveSpeed < 0 : next.moveSpeed > 0, `${type} starts in the commanded direction`);
  }
}
for (const scenario of ['arrival', 'clearance', 'closure', 'reverse-obstacle']) {
  assert.deepEqual(runMovementCase(sim, motion, scenario), runMovementCase(sim, motion, scenario), `${scenario} has a repeatable verdict and trajectory metrics`);
}
for (const heights of [[0, 2, 0, 0], [0, 0, 2, 0], [0, 1, 1, 2]]) {
  const grid = { w: 2, h: 2, height: Int8Array.from(heights) }, a = { x: 1, z: 1 }, b = { x: 3, z: 3 };
  assert.equal(motion.segmentCliffClear(grid, a, b), false, 'a diagonal cannot cut a cliff corner or jump two levels');
  assert.equal(motion.segmentCliffClear(grid, b, a), false, 'cliff clearance has the same result in reverse');
}
for (const control of ['--drop-middle-control', '--ignore-cliffs-control']) execFileSync(process.execPath,
  [fileURLToPath(new URL('./test-movement-lab.js', import.meta.url)), control], { stdio: 'inherit', timeout: 30000 });
console.log(`PASS movement lab: ${cases} authoritative scenarios across all ground vehicles, rifles and support guns; profile limits and deterministic replay`);
