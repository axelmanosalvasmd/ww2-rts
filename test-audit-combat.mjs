import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as sim from './shared/sim.js';
import { fixtureCommand, clearFixtureUnits } from './test-fixtures.js';
import { vehiclePositionClear } from './shared/vehicle-motion.js';

const map = { w: 64, h: 64, rows: Array(64).fill('.'.repeat(64)), spawns: [{ x: 2, y: 2 }, { x: 60, y: 60 }], points: [] };
function fresh(rows = map.rows, extra = {}) {
  const g = sim.createGame({ ...map, rows, naval: extra.naval === true }, ['a', 'b'], false, [0, 1], [0, 1], { weather: false, supply: false, ...extra });
  clearFixtureUnits(g);
  g.players.forEach(p => { p.mp = 10000; p.mun = 10000; });
  return g;
}
function put(g, owner, type, x, z) {
  assert.equal(fixtureCommand(g, owner, { t: 'buy', unit: type }), undefined);
  const u = [...g.units.values()].at(-1);
  Object.assign(u, { x, z, still: 5, auto: false, autoRetreat: false, holdFire: true, holdPos: true, path: [], orders: [], cooldown: 1e9 });
  return u;
}
function ticks(g, n) { for (let i = 0; i < n; i++) sim.step(g); }
function fixedRandom(fn, value = 0) {
  const original = Math.random; Math.random = () => value;
  try { return fn(); } finally { Math.random = original; }
}
const cellAt = (g, u) => Math.floor(u.z / sim.CELL) * g.w + Math.floor(u.x / sim.CELL);

test('B05 construction refuses to entomb a live ground occupant while an adjacent site remains usable', () => {
  const g = fresh(), builder = put(g, 0, 'rifle', 31, 31), before = g.players[0].mp;
  sim.step(g);
  const paidBefore = g.players[0].mp;
  assert.equal(sim.command(g, 0, { t: 'build', ids: [builder.id], kind: 'barracks', x: 31, z: 31 }), 'blocked');
  assert.equal(g.players[0].mp, paidBefore, 'refusal spends no construction MP');
  assert.equal(g.chars[cellAt(g, builder)], '.', 'refusal leaves the occupant on open ground');
  assert.ok(g.players[0].mp >= before);
  assert.equal(sim.command(g, 0, { t: 'build', ids: [builder.id], kind: 'barracks', x: 35, z: 31 }), undefined);
  const building = [...g.units.values()].find(u => u.type === 'barracks');
  ticks(g, 700);
  assert.equal(building.built, 1, 'an ordinary adjacent builder completes construction');
  assert.equal(sim.command(g, 0, { t: 'move', orders: [[builder.id, 81, 31]] }), undefined);
  ticks(g, 600);
  assert.ok(Math.hypot(builder.x - 81, builder.z - 31) < 0.5, 'the builder can leave the completed site');
});

test('B06 cancelled construction leaves no physical sections or later ghost rubble', () => {
  const g = fresh(), builder = put(g, 0, 'rifle', 31, 31);
  sim.step(g);
  assert.equal(sim.command(g, 0, { t: 'build', ids: [builder.id], kind: 'barracks', x: 35, z: 31 }), undefined);
  const site = [...g.units.values()].find(u => u.type === 'barracks');
  ticks(g, 10);
  assert.equal(sim.command(g, 0, { t: 'cancel', id: site.id }), undefined);
  assert.ok(site.cells.every(c => g.chars[c] === '.' && g.cellHp[c] === 0), 'cancelled ground has no structural health');
  const shotsBefore = g.shots.length;
  for (const c of site.cells) sim.damageCells(g, [...g.units.values()], { x: (c % g.w + 0.5) * 2, z: (Math.floor(c / g.w) + 0.5) * 2 }, 0, 1000);
  ticks(g, 60);
  assert.ok(site.cells.every(c => g.chars[c] === '.'), 'shelling cleared ground does not recreate cancelled rubble');
  assert.ok(!g.shots.slice(shotsBefore).some(s => s.k === 'collapse'), 'cancelled sections cannot collapse later');
  const cells = sim.terrainFor(g, 0, true).filter(row => site.cells.includes(row[0]));
  assert.ok(cells.length && cells.every(row => !row[4].section), 'visible terrain no longer advertises cancelled sections');
  assert.equal(sim.command(g, 0, { t: 'build', ids: [builder.id], kind: 'barracks', x: 35, z: 31 }), undefined, 'the cleared footprint can be reused');
});

test('B07 a manual aimed ability replaces construction and reaches its target', () => fixedRandom(() => {
  const g = fresh(), builder = put(g, 0, 'rifle', 31, 31);
  sim.step(g);
  assert.equal(sim.command(g, 0, { t: 'build', ids: [builder.id], kind: 'barracks', x: 35, z: 31 }), undefined);
  const site = [...g.units.values()].find(u => u.type === 'barracks');
  ticks(g, 10);
  const built = site.built;
  assert.equal(sim.command(g, 0, { t: 'ability', ids: [builder.id], x: 80, z: 31 }), undefined);
  ticks(g, 240);
  assert.equal(site.built, built, 'manual grenade stops construction work');
  assert.ok(g.shots.some(s => s.k === 'throw' && s.f === builder.id), 'the squad walks into range and throws');
  assert.equal(builder.nade, null);
}));

test('B07 a manual aimed ability replaces a pending boarding order', () => {
  const g = fresh(), squad = put(g, 0, 'rifle', 31, 31), carrier = put(g, 0, 'halftrack', 34, 31);
  sim.step(g);
  assert.equal(sim.command(g, 0, { t: 'board', ids: [squad.id], target: carrier.id }), undefined);
  assert.equal(sim.command(g, 0, { t: 'ability', ids: [squad.id], x: 81, z: 31 }), undefined);
  ticks(g, 4);
  assert.equal(squad.riding, 0, 'the replaced boarding order cannot hide the ability user');
  assert.deepEqual(carrier.cargo, []);
});

test('B08 a halftrack cannot board infantry through an unbridged river, wall or cliff', () => {
  for (const obstacle of ['water', 'wall', 'cliff']) {
    const rows = obstacle === 'cliff' ? map.rows : Array(64).fill('.'.repeat(20) + (obstacle === 'water' ? 'W' : 'B') + '.'.repeat(43));
    const heights = obstacle === 'cliff' ? Array(64).fill('0'.repeat(20) + '2'.repeat(44)) : undefined;
    const g = fresh(rows, {}), squad = put(g, 0, 'rifle', 39.1, 61), carrier = put(g, 0, 'halftrack', 43.2, 61);
    if (heights) for (let c = 0; c < g.w * g.h; c++) sim.mutateWorldCell(g, c, { height: c % g.w < 20 ? 0 : 2 });
    carrier.rot = Math.PI / 2;
    ticks(g, 4);
    assert.equal(vehiclePositionClear(g, carrier, sim.UNITS.halftrack, sim.blockOf(sim.UNITS.halftrack)), true);
    assert.equal(sim.findPath(g, squad, carrier).length, 0, `${obstacle} disconnects the banks`);
    assert.equal(sim.command(g, 0, { t: 'board', ids: [squad.id], target: carrier.id }), undefined);
    ticks(g, 80);
    assert.equal(squad.riding, 0, `${obstacle} prevents distance-only boarding`);
    assert.deepEqual(carrier.cargo, []);
    assert.ok(squad.x < 40, `${obstacle} keeps the squad on its original side`);
  }
});

test('B08 ordinary carriers and landing craft still board from accessible ground', () => {
  const land = fresh(), squad = put(land, 0, 'rifle', 31, 31), carrier = put(land, 0, 'halftrack', 35, 31);
  ticks(land, 4);
  assert.equal(sim.command(land, 0, { t: 'board', ids: [squad.id], target: carrier.id }), undefined);
  ticks(land, 4);
  assert.equal(squad.riding, carrier.id);
  const rows = Array(64).fill('.'.repeat(20) + 'W'.repeat(10) + '.'.repeat(34));
  const sea = fresh(rows, { naval: true }), foot = put(sea, 0, 'rifle', 39.1, 61);
  const boat = put(sea, 0, 'lcvp', 41, 61);
  ticks(sea, 4);
  assert.equal(sim.command(sea, 0, { t: 'board', ids: [foot.id], target: boat.id }), undefined);
  ticks(sea, 4);
  assert.equal(foot.riding, boat.id, 'a squad boards the landing craft from its reachable bank');
});

test('B09 support interception respects empty ammo and debits a funded attempt even when it misses', () => {
  for (const [ammo, random] of [[0, 0], [1, 0], [1, 0.99]]) fixedRandom(() => {
    const rows = Array(64).fill('.'.repeat(20) + 'W'.repeat(3) + '.'.repeat(41));
    const g = fresh(rows, { logistics: true }), gun = put(g, 0, 'flak', 61, 61);
    gun.holdFire = false; gun.logistics.ammo = ammo;
    assert.equal(sim.command(g, 1, { t: 'support', kind: 'dive', x: 61, z: 61 }), undefined);
    ticks(g, sim.SUPPORT.dive.delay / sim.TICK + 2);
    const shots = g.shots.filter(s => s.k === 'flak'), down = g.shots.some(s => s.k === 'shotdown');
    assert.equal(shots.length, ammo ? 1 : 0, 'only a funded gun fires at the support plane');
    assert.equal(down, ammo > 0 && random === 0);
    assert.equal(gun.logistics.ammo, 0, 'both successful and failed interception attempts spend their round');
  }, random);
});

test('B10 an aircraft retains its queued sortie through rearming and launches when ready', () => {
  const g = fresh(), plane = put(g, 0, 'fighter', 31, 31);
  sim.step(g);
  assert.equal(sim.command(g, 0, { t: 'move', orders: [[plane.id, 31, 31]] }), undefined);
  assert.equal(sim.command(g, 0, { t: 'move', orders: [[plane.id, 91, 91]], queue: true }), undefined);
  let rearmed = false, relaunched = false;
  for (let i = 0; i < 2500; i++) {
    sim.step(g);
    if (plane.air.state === 'rearm') {
      rearmed = true;
      assert.equal(plane.orders.length, 1, 'the next sortie waits throughout rearming');
    }
    if (rearmed && plane.air.mission?.x === 91 && plane.air.mission?.z === 91) { relaunched = true; break; }
  }
  assert.equal(rearmed, true);
  assert.equal(relaunched, true, 'the queued destination becomes the next actual flight');
  assert.equal(plane.orders.length, 0);
  assert.equal(sim.airborne(plane), true);
});
