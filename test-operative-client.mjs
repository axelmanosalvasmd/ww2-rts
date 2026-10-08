import assert from 'node:assert/strict';
import * as fps from './client/operative-controls.js';
assert.equal(typeof fps.inputFor,'function','FPS input maps desktop controls explicitly');
const held=new Set(['KeyW','KeyD']);
assert.deepEqual(fps.inputFor(held,0,0,true,9),{t:'fps',seq:9,forward:1,strafe:1,yaw:0,pitch:0,fire:true});
assert.equal(fps.inputFor(new Set(['KeyW','KeyS']),0,0,false,10).forward,0);
const look=fps.lookDelta(0,0,100, -10000);
assert.ok(look.yaw>0);assert.equal(look.pitch,1.45,'vertical aim is bounded');
assert.equal(fps.cameraYaw(0),-Math.PI/2,'Three forward points along positive world X at yaw zero');
console.log('PASS desktop FPS input, mouse aim limits and camera/ray coordinate agreement');
// Prediction runs the server's movement: on open ground, the same inputs land on the same spot.
const sim = await import('./shared/sim.js');
const map = { w: 64, h: 64, rows: Array(64).fill('.'.repeat(64)), spawns: [{ x: 10, y: 32 }, { x: 54, y: 32 }], points: [] };
const g = sim.createGame(map, ['a', 'b'], true, [0, 1]), op = sim.joinOperative(g, 'p', 0), u = g.units.get(op.unitId);
for (const v of [...g.units.values()]) if (v !== u) g.units.delete(v.id);
Object.assign(u, { x: 64, z: 64 });
const p = { x: 64, z: 64, vx: 0, vz: 0, jy: 0, vy: 0, crouch: false };
let n = 0;
const plan = [[{ forward: 1, strafe: 1, yaw: 0.3 }, 10], [{ forward: 1, yaw: 0.3, sprint: true }, 15], [{ forward: 1, yaw: 1, jump: 1 }, 12], [{ strafe: -1, yaw: 1, crouch: true }, 10], [{ yaw: 1 }, 10]];
for (const [input, ticks] of plan) for (let i = 0; i < ticks; i++) {
  const full = { forward: 0, strafe: 0, pitch: 0, jump: 0, ...input };
  sim.operativeInput(g, 'p', { seq: n++, ...full }); sim.step(g);
  fps.predictStep(p, { ...full, jump: full.jump && i === 0 && n > 1 }, sim.TICK);
}
assert.ok(Math.hypot(p.x - u.x, p.z - u.z) < 0.02, `prediction ${p.x},${p.z} matches server ${u.x},${u.z}`);
console.log('PASS client movement prediction matches the server on open ground');
