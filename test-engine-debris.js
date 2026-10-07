import assert from 'node:assert/strict';
import { debrisBody, stepDebris, DEBRIS_LIMITS, wreckMass } from './shared/debris-motion.js';
import { createGame, step, damageWorldSection, snapshotFor, UNITS, CELL, TICK } from './shared/sim.js';
import { fixtureCommand as command } from './test-fixtures.js';
import { createDebrisView } from './client/debris.js';
const env = { ground: () => 0, material: () => ({ rebound: 0.15, absorption: 0.7 }) };
{
  const light = debrisBody({ id: 'light', kind: 'wreck', x: 0, y: 0.08, z: 0, impulse: 2, mass: wreckMass('tank', UNITS.tank) });
  const heavy = debrisBody({ id: 'heavy', kind: 'wreck', x: 0, y: 0.08, z: 0, impulse: 2, mass: wreckMass('tiger', UNITS.tiger) });
  for (let i = 0; i < 60; i++) { stepDebris(light, TICK, env); stepDebris(heavy, TICK, env); }
  assert.ok(light.settled && heavy.settled, 'both hulls become static in bounded time');
  assert.ok(light.x > heavy.x && light.x <= 2, 'the heavier hull travels less under the same impulse');
  assert.deepEqual([light.vx, light.vy, light.vz], [0, 0, 0], 'settled state has no remaining motion');
}
{
  const body = debrisBody({ id: 'section', x: 0, y: 1.6, z: 0, impulse: 4, mass: 350 });
  let contacts = 0;
  const wall = { ...env, contact(a, b) { if (a.x <= 0.25 && b.x > 0.25) { contacts++; return { fraction: (0.25 - a.x) / (b.x - a.x), normal: { x: -1, y: 0, z: 0 }, material: { rebound: 0.2, absorption: 0.8 } }; } return null; } };
  for (let i = 0; i < 60; i++) stepDebris(body, TICK, wall);
  assert.equal(contacts, 1, 'a thin contact reflects the bounded moving section');
  assert.ok(body.settled && body.x < 0.25 && body.contacts <= DEBRIS_LIMITS.contacts, 'the reflected section settles without passing through the wall');
}
const base = { w: 32, h: 32, rows: Array(32).fill('.'.repeat(32)), spawns: [{ x: 2, y: 2 }, { x: 28, y: 28 }], points: [] };
function fresh(material = 'stone') {
  const c = 10 * base.w + 10, rows = base.rows.map(row => [...row]); rows[10][10] = 'B';
  const g = createGame({ ...base, rows: rows.map(row => row.join('')), structures: [{ id: 'section', kind: 'house', sections: [{ id: 'wall', c, hp: 40, material, anchor: true, supports: [] }] }] }, ['a', 'b'], false);
  g.units.clear(); g.players.forEach(p => { p.mp = 10000; p.spawn = { x: -1000, z: -1000 }; });
  return { g, c };
}
function put(g, owner, type, x, z) {
  assert.equal(command(g, owner, { t: 'buy', unit: type }), undefined);
  const u = [...g.units.values()].at(-1); Object.assign(u, { x, z, auto: false, holdFire: true, holdPos: true, cooldown: 1e9, path: [] }); return u;
}
{
  const { g, c } = fresh(), viewer = put(g, 0, 'rifle', 15, 21);
  damageWorldSection(g, c, 2000, { direction: { x: 1, z: 0 }, contactId: 'failure', owner: 0 });
  assert.equal(g.structuralCells.get(c).state, 'failed', 'support failure is immediate');
  assert.notEqual(g.objects[c], 'R', 'rubble waits for authoritative settling');
  const first = snapshotFor(g, 0, g.shots).falling[0];
  assert.ok(first && first.mass > 0 && first.y > 0 && first.v.length === 3, 'visible snapshots hydrate the current physical fall');
  const originalHP = viewer.hp;
  for (let i = 0; i < 60; i++) step(g);
  assert.equal(g.fallingSections.length, 0, 'active sections leave the solver after settling');
  assert.ok(g.structuralCells.get(c).rubble.length > 0, 'the final obstruction footprint is durable');
  assert.equal(viewer.hp, originalHP, 'falling section contacts do not crush living units');
  assert.deepEqual(snapshotFor(g, 0, []).falling, [], 'reconnect sees settled state without replaying a fall');
}
{
  const { g } = fresh(), killed = put(g, 1, 'tank', 29, 21), blocker = put(g, 0, 'tank', 31, 21);
  killed.hp = 0; killed.deathImpulse = { dir: 0, impulse: 4 }; const hp = blocker.hp, at = { x: blocker.x, z: blocker.z };
  step(g); const wreck = g.wrecks.find(w => w.id === killed.id);
  assert.ok(wreck?.motion && wreck.c === -1, 'a wreck starts with authoritative motion before becoming a static obstacle');
  for (let i = 0; i < 60; i++) step(g);
  assert.equal(wreck.motion, null, 'wreck settles within the motion lifetime');
  assert.equal(blocker.hp, hp, 'wreck contact causes no living-unit damage');
  assert.deepEqual({ x: blocker.x, z: blocker.z }, at, 'wreck contact never pushes a commanded vehicle');
  assert.ok(wreck.c < 0 || Math.hypot(wreck.x - blocker.x, wreck.z - blocker.z) >= UNITS.tank.radius, 'settled obstruction avoids the live vehicle footprint');
}
{
  const positions = [], removed = [], contacts = [], view = createDebrisView({ pose: (id, row) => positions.push({ id, ...row }), remove: id => removed.push(id), contact: sh => contacts.push(sh.id) });
  const row = { id: 'collapse:wall:0', kind: 'section', x: 10, y: 1.6, z: 20, dir: 0, tilt: 0, material: 'stone', mass: 1200 };
  const event = { k: 'collapse', id: row.id, at: 0 };
  view.snapshot({ tick: 0, falling: [row], shots: [event] }, 0);
  view.snapshot({ tick: 2, falling: [{ ...row, x: 10.2, y: 1.4, tilt: 0.2 }], shots: [event] }, 0.1);
  view.frame(0.15);
  assert.ok(Math.abs(positions.at(-1).x - 10.1) < 1e-9 && Math.abs(positions.at(-1).y - 1.5) < 1e-9, 'visible motion interpolates between actual delivered positions');
  assert.deepEqual(contacts, [row.id], 'duplicate snapshot events do not replay section contact effects');
  view.frame(10);
  assert.equal(positions.at(-1).x, 10.2, 'a network stall cannot predict an unseen future collision');
  view.snapshot({ tick: 3, falling: [], shots: [] }, 10);
  assert.deepEqual(removed, [row.id], 'a hidden or settled row removes its moving geometry');
  view.reset(); view.snapshot({ tick: 20, falling: [{ ...row, x: 10.5, y: 0.4 }], shots: [] }, 11);
  assert.equal(positions.at(-1).x, 10.5, 'reconnect hydrates the current pose directly');
  assert.equal(contacts.length, 1, 'reconnect does not replay historical contact fragments');
}
{
  const rows = base.rows.map(row => [...row]), sections = [];
  for (let i = 0; i <= DEBRIS_LIMITS.active; i++) {
    const x = 2 + i % 12, z = 2 + Math.floor(i / 12), c = z * base.w + x; rows[z][x] = 'B';
    sections.push({ id: 'wall:' + i, c, hp: 40, material: 'stone', anchor: true, supports: [] });
  }
  const g = createGame({ ...base, rows: rows.map(row => row.join('')), structures: [{ id: 'budget', kind: 'house', sections }] }, ['a', 'b'], false);
  g.units.clear();
  for (const section of sections) damageWorldSection(g, section.c, 1000, { contactId: 'contact:' + section.c });
  assert.equal(g.fallingSections.length, DEBRIS_LIMITS.active, 'a large collapse obeys the authoritative active body cap');
  const overflow = g.structuralCells.get(sections.at(-1).c);
  assert.ok(overflow.settledAt !== undefined, 'overflow uses the bounded solver to reach a durable final state');
  for (let i = 0; i < 60; i++) step(g);
  assert.equal(g.fallingSections.length, 0, 'every retained active body settles within its lifetime');
}
console.log('all engine debris checks passed');
