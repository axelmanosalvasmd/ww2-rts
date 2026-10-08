// Physical flight checks use normal attack, fire-at and ability commands after arranging a controlled fixture.
import assert from 'node:assert/strict';
import * as sim from './shared/sim.js';
import { fixtureCommand, clearFixtureUnits } from './test-fixtures.js';
import { createGame, command, step, snapshotFor, UNITS, TICK } from './shared/sim.js';
import { sweepBody, contactResponse, CONTACT_MATERIALS } from './shared/projectiles.js';
import { createProjectileView } from './client/projectiles.js';

const map = { w: 64, h: 64, rows: Array(64).fill('.'.repeat(64)), spawns: [{ x: 2, y: 2 }, { x: 60, y: 60 }, { x: 60, y: 2 }], points: [] };
function fresh(rows = map.rows, structures) {
  const g = createGame({ ...map, rows, ...(structures ? { structures } : {}) }, ['a', 'b', 'c'], false);
  clearFixtureUnits(g);
  g.players.forEach(p => { p.mp = 10000; p.spawn = { x: -1000, z: -1000 }; });
  return g;
}
function put(g, owner, type, x, z) {
  assert.equal(fixtureCommand(g, owner, { t: 'buy', unit: type }), undefined);
  const u = [...g.units.values()].at(-1);
  Object.assign(u, { x, z, still: 5, auto: false, holdFire: true, holdPos: true, cooldown: 1e9, path: [], orders: [] });
  return u;
}
function wallRows(cells) {
  const rows = map.rows.map(row => [...row]);
  for (const c of cells) rows[Math.floor(c / map.w)][c % map.w] = 'B';
  return rows.map(row => row.join(''));
}
function wall(g, c, object) {
  if (sim.mutateWorldCell) sim.mutateWorldCell(g, c, { object });
  else { g.chars[c] = object; g.flags[c] = sim.TERRAIN[object]; }
}
function advance(g, ticks) { for (let i = 0; i < ticks; i++) step(g); }
function attack(g, gun, target) {
  step(g); gun.cooldown = 0;
  assert.equal(command(g, gun.owner, { t: 'attack', ids: [gun.id], target: target.id }), undefined);
  step(g);
  gun.cooldown = 1e9;
  return g.shots.find(s => s.k === 'flight' && s.f === gun.id);
}
const originalRandom = Math.random;
try {
  Math.random = () => 0;
  {
    const g = fresh(), gun = put(g, 0, 'at', 15, 35), tank = put(g, 1, 'tank', 45, 35), hp = tank.hp;
    const launch = attack(g, gun, tank);
    assert.ok(launch, 'attack launches an identified round');
    assert.equal(tank.hp, hp, 'health stays unchanged at launch');
    assert.ok(snapshotFor(g, 0, g.shots).flights.some(p => p.flight === launch.flight), 'active flight is durable snapshot state');
    advance(g, 2); assert.equal(tank.hp, hp, 'no damage before traveled space reaches the hull');
    const approach = snapshotFor(g, 0, []).flights.find(p => p.flight === launch.flight);
    advance(g, 2); assert.equal(tank.hp, hp - UNITS.at.w.veh * 2, 'rear armor applies at actual arrival');
    const impacts = g.shots.filter(s => s.k === 'contact' && s.flight === launch.flight);
    assert.equal(impacts.length, 1, 'one terminal contact');
    assert.ok(impacts[0].time > launch.time && impacts[0].time <= g.tick * TICK, 'impact carries physical arrival time');
    assert.ok(Math.abs(approach.until - impacts[0].time) < 1e-9, 'a visible stationary contact bounds the trace at the physical arrival time');
    const after = tank.hp, xp = gun.xp; advance(g, 10);
    assert.equal(tank.hp, after); assert.equal(gun.xp, xp, 'arrival cannot duplicate veterancy');
  }
  {
    const c = 17 * map.w + 17, g = fresh(), gun = put(g, 0, 'at', 15, 35), tank = put(g, 1, 'tank', 45, 35);
    const launch = attack(g, gun, tank); wall(g, c, 'Q');
    const hp = g.cellHp[c]; g.flights.get(launch.flight).terrain = 0;
    advance(g, 8);
    assert.ok(g.cellHp[c] < hp, 'direct contact wears a nonstructural solid even without a terminal blast');
    assert.equal(tank.hp, UNITS.tank.hpPer, 'the wreck surface stops the round before its intended target');
  }
  {
    const g = fresh(), gun = put(g, 0, 'at', 15, 35), tank = put(g, 1, 'tank', 45, 35), hp = tank.hp;
    const launch = attack(g, gun, tank);
    tank.z = 45; advance(g, 12);
    assert.equal(tank.hp, hp, 'a target leaving the launch line is not followed');
    assert.ok(!g.flights.has(launch.flight), 'miss eventually expires');
  }
  {
    const c = 17 * map.w + 17, g = fresh(wallRows([c])), gun = put(g, 0, 'at', 15, 35), tank = put(g, 1, 'tank', 45, 35), hp = tank.hp;
    const wallHp = g.structuralCells?.get(c)?.hp ?? g.cellHp[c];
    wall(g, c, '.'); const launch = attack(g, gun, tank); wall(g, c, 'B');
    advance(g, 8);
    const hit = g.shots.find(s => s.k === 'contact' && s.flight === launch.flight);
    assert.ok(hit && hit.x >= 34 && hit.x <= 36, 'a thin inserted obstacle takes swept first contact');
    assert.equal(tank.hp, hp, 'the round does not pass through the wall to the intended target');
    assert.ok((g.structuralCells?.get(c)?.hp ?? g.cellHp[c]) < wallHp, 'contact damages the local surface');
  }
  {
    const g = fresh(), gun = put(g, 0, 'at', 15, 35), tank = put(g, 1, 'tank', 45, 35), hp = tank.hp;
    const launch = attack(g, gun, tank); gun.hp = 0;
    advance(g, 8);
    assert.equal(g.units.has(gun.id), false, 'shooter was removed');
    assert.ok(tank.hp < hp, 'its launched round remains valid');
    assert.equal(g.shots.filter(s => s.k === 'contact' && s.flight === launch.flight).length, 1);
  }
  {
    const g = fresh(), gun = put(g, 0, 'at', 15, 35), ally = put(g, 0, 'rifle', 27, 35), tank = put(g, 1, 'tank', 45, 35);
    const alliedHp = ally.hp, hp = tank.hp; attack(g, gun, tank); advance(g, 8);
    assert.equal(ally.hp, alliedHp, 'ordinary allied bodies do not intercept or take damage');
    assert.ok(tank.hp < hp, 'the direct round reaches the eligible enemy');
  }
  {
    const g = fresh(), gun = put(g, 0, 'at', 15, 35), intended = put(g, 1, 'tank', 45, 35), blocker = put(g, 1, 'tank', 28, 35);
    const hp = intended.hp, blockerHp = blocker.hp; attack(g, gun, intended); advance(g, 8);
    assert.equal(intended.hp, hp); assert.ok(blocker.hp < blockerHp, 'an intervening eligible enemy takes first contact');
  }
  {
    const g = fresh(), gun = put(g, 0, 'rifle', 15, 35), target = put(g, 1, 'rifle', 36, 35);
    attack(g, gun, target); advance(g, 6);
    assert.ok(target.supp > 0 && target.supp <= UNITS.rifle.w.supp, 'one volley suppresses a target once across all traveled segments');
  }
  {
    const c = 17 * map.w + 18, g = fresh(wallRows([c])), gun = put(g, 0, 'tank', 15, 35);
    step(g); gun.cooldown = 0;
    assert.equal(command(g, 0, { t: 'fireat', ids: [gun.id], x: 37, z: 35 }), undefined);
    const originalHp = g.cellHp[c]; step(g); const hp = g.cellHp[c]; assert.equal(hp, originalHp, 'fire-at does not damage terrain when launched');
    advance(g, 8); assert.ok(g.cellHp[c] < hp, 'fire-at damages terrain on arrival');
  }
  {
    const g = fresh(), gun = put(g, 0, 'rifle', 15, 35), ally = put(g, 0, 'rifle', 31, 35), enemy = put(g, 1, 'rifle', 33, 37);
    step(g); const hp = ally.hp; gun.cd = 0;
    assert.equal(command(g, 0, { t: 'ability', ids: [gun.id], x: 32, z: 35 }), undefined);
    step(g); assert.equal(ally.hp, hp, 'grenade blast waits for flight');
    advance(g, 28); assert.ok(ally.hp < hp && enemy.hp < UNITS.rifle.hpPer * UNITS.rifle.models, 'grenade retains blast friendly fire at arrival');
  }
  {
    const g = fresh(), gun = put(g, 0, 'at', 15, 35), tank = put(g, 1, 'tank', 45, 35);
    put(g, 2, 'rifle', 115, 110);
    const launch = attack(g, gun, tank), hidden = snapshotFor(g, 2, g.shots);
    assert.deepEqual(hidden.flights, []); assert.ok(!hidden.shots.some(s => s.flight === launch.flight), 'uninformed recipient receives no trajectory');
    const initial = snapshotFor(g, 0, g.shots); assert.ok(initial.flights.length > 0);
    gun.hp = 0; advance(g, 3);
    assert.deepEqual(snapshotFor(g, 0, []).flights, [], 'owner knowledge ends when the round leaves all current vision');
    advance(g, 8); assert.ok(!snapshotFor(g, 2, g.shots).shots.some(s => s.flight === launch.flight), 'hidden contact remains private');
    assert.deepEqual(snapshotFor(g, 1, []).flights, [], 'reconnect gets current state without an old impact');
  }
  {
    const cells = [19, 20, 21].map(x => 20 * map.w + x);
    const authored = { id: 'ricochetwall', kind: 'house', sections: cells.map((c, i) => ({ id: 's' + i, c, hp: 400, material: 'stone', anchor: true, supports: [] })) };
    const g = fresh(wallRows(cells), [authored]), gun = put(g, 0, 'at', 15, 35), tank = put(g, 1, 'tank', 45, 40.8);
    for (const c of cells) wall(g, c, '.');
    const launch = attack(g, gun, tank);
    for (const c of cells) wall(g, c, 'B');
    advance(g, 7);
    const contacts = g.shots.filter(s => s.k === 'contact' && s.flight === launch.flight);
    assert.ok(contacts.length > 0 && !contacts[0].terminal, 'a shallow hard-wall contact continues the same physical round');
    assert.equal(contacts[0].explosive, false, 'nonterminal contact applies no terminal blast');
    assert.equal(new Set(contacts.map(s => s.contactId)).size, contacts.length, 'each contact has one distinct sequence identity');
    assert.ok(contacts.length <= 2, 'one round has bounded contacts');
    assert.ok(tank.hp >= UNITS.tank.hpPer - UNITS.at.w.veh * 2, 'a reflected round cannot gain damage energy');
  }
  {
    const hit = sweepBody({ x: 0, y: 1, z: 0 }, { x: 10, y: 1, z: 0 }, { x: 5, z: -5 }, { x: 5, z: 5 }, 0.5, 0, 2);
    assert.ok(hit && hit.fraction > 0 && hit.fraction < 1, 'relative sweep sees a body crossing between updates');
    const p = { explosive: false, sequence: 1, maxContacts: 2, energy: 1 }, v = { x: 100, y: 0, z: -10 }, n = { x: 0, y: 0, z: 1 };
    const bounce = contactResponse(p, v, n, CONTACT_MATERIALS.stone);
    assert.ok(bounce && bounce.vz > 0 && bounce.energy < 1, 'hard shallow contact reflects with bounded energy loss');
    assert.equal(contactResponse({ ...p, explosive: true }, v, n, CONTACT_MATERIALS.stone), null, 'explosive shells do not bounce');
    assert.equal(contactResponse({ ...p, sequence: 2 }, v, n, CONTACT_MATERIALS.stone), null, 'contact count is bounded');
  }
  {
    const seen = [], removed = [], launches = [], contacts = [];
    const view = createProjectileView({ trail: (...a) => seen.push(a), remove: id => removed.push(id), launch: s => launches.push(s), contact: s => contacts.push(s) });
    const row = { flight: 1, kind: 'tank', seq: 0, x: 0, y: 2, z: 0, v: [10, 3, 0], gravity: 9.81, time: 1, launched: 1, expires: 2, until: 1.15 };
    view.snapshot({ tick: 20, flights: [row], shots: [{ k: 'flight', flight: 1, seq: 0, time: 1 }] }, 0);
    view.frame(0.1); assert.ok(Math.abs(seen.at(-1)[1].x - 1) < 1e-9, 'display uses the delivered physical solution');
    const impact = { k: 'contact', flight: 1, seq: 1, time: 1.1, terminal: true };
    view.snapshot({ tick: 22, flights: [], shots: [impact] }, 0.1);
    view.snapshot({ tick: 22, flights: [], shots: [impact] }, 0.1); view.frame(0.2);
    assert.equal(contacts.length, 1, 'duplicate delivery displays one contact'); assert.equal(view.count, 0, 'resolved trail stops immediately');
    view.snapshot({ tick: 21, flights: [row], shots: [] }, 0.2); assert.equal(view.count, 0, 'a late snapshot cannot restore a terminal round');
    view.reset(); view.snapshot({ tick: 50, flights: [], shots: [] }, 1); assert.equal(contacts.length, 1, 'reconnect baseline does not replay impact');
  }
} finally { Math.random = originalRandom; }
console.log('all engine projectile checks passed');
