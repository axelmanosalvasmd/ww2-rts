import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGame, step, command, UNITS, CFG, placementCheck, supplyRateAt } from './shared/sim.js';
import * as scheduler from './shared/supply-convoys.js';
import { initializeUnit, LOGISTICS as L } from './shared/logistics.js';
import { createOrders } from './client/orders.js';

const empty = () => ({ ammo: 0, provisions: 0, fuel: 0 });
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
function fixture(teams = [0]) {
  const g = { logisticsEnabled: true, winner: null, tick: 0, nextId: 1, mode: { kind: 'classic' }, units: new Map(), points: [], players: teams.map((team, slot) => ({ team, slot, spawn: { x: slot * 5, z: 0 }, fuel: 100, mun: 100 })), w: 100, chars: [], aid: new Map() };
  const unit = (type, owner = 0, at = { x: 0, z: 0 }) => {
    const u = { id: g.nextId++, type, owner, hp: 100, built: 1, x: at.x, z: at.z, path: [], orders: [], worldGoal: null, still: 3 };
    g.units.set(u.id, u); return u;
  };
  for (const p of g.players) unit('hq', p.slot, p.spawn);
  const hooks = { spawn: (owner, type, at) => unit(type, owner, at), route: (u, at) => [{ x: at.x, z: at.z }], handoff: () => true, retire: u => g.units.delete(u.id) };
  const troop = (at = { x: 60, z: 0 }, owner = 0) => {
    const u = unit('rifle', owner, at); initializeUnit(g, u, UNITS.rifle);
    Object.assign(u.logistics, { provisions: 20, cutFor: L.supplyGrace }); return u;
  };
  scheduler.setupConvoys(g);
  const tick = (dt = .05) => { scheduler.stepConvoys(g, dt, hooks); g.tick += Math.round(dt * 20); };
  const truck = (owner = 0) => scheduler.addTruck(g, owner, [...g.convoys.stores.values()].find(s => s.source && s.owner === owner), hooks);
  const arrive = u => { Object.assign(u, u.convoy.destination); u.path = []; u.worldGoal = null; };
  return { g, hooks, unit, troop, tick, truck, arrive };
}
function game(logistics = true) {
  const w = 120, h = 60;
  const g = createGame({ w, h, rows: Array(h).fill('.'.repeat(w)), spawns: [{ x: 8, y: 30 }, { x: 111, y: 30 }], points: [] }, ['one', 'two'], false, [0, 1], [0, 1], { mode: 'classic', logistics, weather: 'clear' });
  for (const u of g.units.values()) Object.assign(u, { holdFire: true, auto: false, autoRetreat: false, holdPos: true });
  g.players[0].mp = 10000; return g;
}
function build(g, kind, at = { x: 105, z: 51 }) {
  const engineer = [...g.units.values()].find(u => u.owner === 0 && u.type === 'engineer');
  Object.assign(engineer, { x: at.x + 8, z: at.z });
  assert.equal(placementCheck(g, { kind, ...at, team: 0 }).ok, true);
  assert.equal(command(g, 0, { t: 'build', ids: [engineer.id], kind, ...at }), undefined);
  return [...g.units.values()].find(u => u.owner === 0 && u.type === kind);
}

test('ordinary truck right-click safely refuses a cache still under construction', () => {
  const g = game(); step(g);
  const source = [...g.convoys.stores.values()].find(s => s.source && s.owner === 0);
  const truck = scheduler.addTruck(g, 0, source, { spawn: (owner, type, at) => {
    const u = { id: g.nextId++, owner, type, x: at.x, z: at.z, hp: 100, path: [], orders: [], worldGoal: null }; g.units.set(u.id, u); return u;
  } });
  const cache = build(g, 'supplycache'), sent = [];
  const orders = createOrders({ units: g.units, selected: new Set([truck.id]), me: 0, defs: UNITS, diggers: [], send: cmd => sent.push(cmd), moveColor: 0, feedback: () => {} });
  assert.equal(orders.dispatch({ building: cache, ground: cache }), true);
  assert.deepEqual(sent, [{ t: 'supply', ids: [truck.id], target: cache.id, queue: false }]);
  const state = () => ({ convoy: truck.convoy, path: truck.path, orders: truck.orders, worldGoal: truck.worldGoal, fuel: g.players[0].fuel, mun: g.players[0].mun, mp: g.players[0].mp });
  const before = structuredClone(state());
  assert.equal(command(g, 0, sent[0]), 'needs');
  assert.deepEqual(state(), before, 'refusal leaves cargo, payment and manual state unchanged');
});

test('a normally completed cache accepts Supply before the next inventory sync', () => {
  const g = game(); step(g);
  const cache = build(g, 'supplycache');
  for (let n = 0; n < 700 && cache.built < 1; n++) step(g);
  assert.equal(cache.built, 1);
  assert.equal([...g.convoys.stores.values()].some(s => s.entity === cache.id), false, 'construction completed between dispatch cycles');
  const source = [...g.convoys.stores.values()].find(s => s.source && s.owner === 0);
  const truck = scheduler.addTruck(g, 0, source, { spawn: (owner, type, at) => {
    const u = { id: g.nextId++, owner, type, x: at.x, z: at.z, hp: 100, path: [], orders: [], worldGoal: null }; g.units.set(u.id, u); return u;
  } });
  assert.equal(command(g, 0, { t: 'supply', ids: [truck.id], target: cache.id }), undefined);
  assert.equal(truck.convoy.target.store, `cache:${cache.id}`);
  assert.equal(truck.convoy.state, 'loading');
});

test('malformed convoy order rows are refused before currency or control changes', () => {
  const f = fixture(); f.tick(0); const truck = f.truck();
  for (const orders of [[null], [null, [truck.id, 60, 0]], [[truck.id, 60, 0], null], [{}], [1], [[truck.id, 60]], [[truck.id, NaN, 0]], [[truck.id, 60, Infinity]], [['1', 60, 0]], {}]) {
    const before = structuredClone({ truck, players: f.g.players });
    assert.deepEqual(scheduler.commandConvoy(f.g, 0, { t: 'move', ids: [truck.id], orders }, f.hooks), { result: 'blocked' });
    assert.deepEqual({ truck, players: f.g.players }, before, 'an invalid later row must not charge an earlier valid row');
  }
});

test('supplied forward Barracks reinforce normally with logistics on and off', () => {
  for (const enabled of [false, true]) {
    const g = game(enabled), barracks = build(g, 'barracks');
    for (let n = 0; n < 700; n++) step(g);
    assert.equal(barracks.built, 1);
    const rifle = [...g.units.values()].find(u => u.owner === 0 && u.type === 'rifle');
    Object.assign(rifle, { x: barracks.x + 8, z: barracks.z, hp: UNITS.rifle.hpPer * 2, path: [], worldGoal: null });
    for (let n = 0; n < 240; n++) step(g);
    if (enabled) {
      assert.equal(supplyRateAt(g, 0, rifle), 1);
      assert.ok([...g.convoys.stores.values()].filter(s => s.active && s.owner === 0).every(s => Math.hypot(s.x - rifle.x, s.z - rifle.z) > L.sourceRadius));
    }
    assert.equal(rifle.hp, UNITS.rifle.hpPer * UNITS.rifle.models, `forward recovery completes with logistics ${enabled}`);
  }
});

test('forward recovery consumes the real unit reserve and cannot duplicate provisions', () => {
  const f = fixture(), rifle = f.troop({ x: 80, z: 0 }); f.tick(0);
  rifle.logistics.provisions = 7;
  assert.equal(scheduler.supportProvision(f.g, rifle, 0, 5, f.hooks), true);
  near(rifle.logistics.provisions, 2);
  assert.equal(scheduler.supportProvision(f.g, rifle, 0, 5, f.hooks), false);
  near(rifle.logistics.provisions, 2);
  assert.equal(scheduler.supportProvision(f.g, { ...rifle }, 0, 1, f.hooks), false, 'copies cannot manufacture a recovery reserve');
  assert.equal(scheduler.supportProvision(f.g, rifle, 1, 1, f.hooks), false, 'another payer cannot spend this reserve');
});

test('supplied forward Motor Pools repair their normally produced vehicles', () => {
  const g = game(), barracks = build(g, 'barracks', { x: 55, z: 51 });
  for (let n = 0; n < 700 && barracks.built < 1; n++) step(g);
  assert.equal(barracks.built, 1);
  const motorpool = build(g, 'motorpool');
  g.players[0].fuel = 1000;
  for (let n = 0; n < 1000 && motorpool.built < 1; n++) step(g);
  assert.equal(motorpool.built, 1);
  assert.equal(command(g, 0, { t: 'buy', unit: 'tank', from: motorpool.id }), undefined);
  let tank;
  for (let n = 0; n < 2000 && !tank; n++) { step(g); tank = [...g.units.values()].find(u => u.owner === 0 && u.type === 'tank'); }
  assert.ok(tank, 'normal Motor Pool production supplies the vehicle');
  const full = UNITS.tank.hpPer * UNITS.tank.models;
  Object.assign(tank, { x: motorpool.x + 8, z: motorpool.z, hp: full / 2, path: [], worldGoal: null, holdFire: true, holdPos: true, auto: false, autoRetreat: false });
  for (let n = 0; n < 240; n++) step(g);
  assert.equal(supplyRateAt(g, 0, tank), 1);
  assert.ok(tank.hp > full / 2, 'the supported vehicle repairs without a nearby finite inventory store');
  assert.ok(tank.hp <= full);
});

test('initial dispatch carries target search progress across ticks within three plans', () => {
  const f = fixture(), troops = Array.from({ length: 8 }, (_, n) => f.troop({ x: 60 + n * 20, z: 0 })), searches = [];
  f.hooks.route = (u, at) => { searches.push([f.g.tick, at.x]); return at.x > 180 ? [{ ...at }] : []; };
  for (let n = 0; n < 3; n++) { f.tick(0); f.g.tick++; }
  assert.ok([...Map.groupBy(searches, ([tick]) => tick).values()].every(rows => rows.length <= 3));
  assert.equal(searches.length, 8, 'failed targets are not repeated while the pass is unfinished');
  const truck = [...f.g.units.values()].find(u => u.type === 'truck');
  assert.equal(truck.convoy.target.unit, troops.at(-1).id, 'the later reachable job is eventually dispatched');
  assert.equal(truck.convoy.state, 'loading');
});

test('initial dispatch also carries origin search progress within the route budget', () => {
  const f = fixture(); for (let n = 1; n < 6; n++) f.unit('hq', 0, { x: n * 100, z: 0 });
  const recipient = f.troop({ x: 900, z: 0 }), searches = [];
  f.hooks.route = (u, at) => { searches.push([f.g.tick, at.x]); return at.x > 800 ? [{ ...at }] : []; };
  for (let n = 0; n < 2; n++) { f.tick(0); f.g.tick++; }
  assert.ok([...Map.groupBy(searches, ([tick]) => tick).values()].every(rows => rows.length <= 3));
  assert.equal(searches.length, 6);
  const truck = [...f.g.units.values()].find(u => u.type === 'truck');
  assert.equal(truck.convoy.target.unit, recipient.id);
  assert.equal(truck.convoy.origin, 'source:1');
});

test('initial dispatch advances through the remaining fleet and later players', () => {
  const f = fixture([0, 1]);
  for (const owner of [0, 1]) for (let n = 0; n < 5; n++) f.troop({ x: 60 + n * 30, z: owner * 30 }, owner);
  f.tick(0);
  for (const owner of [0, 1]) for (let n = 0; n < 3; n++) f.truck(owner);
  for (const u of f.g.units.values()) if (u.type === 'truck') Object.assign(u.convoy, { state: 'idle', target: null });
  const searches = []; f.hooks.route = (u, at) => { searches.push(f.g.tick); return [{ ...at }]; };
  f.g.tick = 40;
  for (let n = 0; n < 4; n++) { f.tick(0); f.g.tick++; }
  assert.ok([...Map.groupBy(searches, tick => tick).values()].every(rows => rows.length <= 3));
  const trucks = [...f.g.units.values()].filter(u => u.type === 'truck');
  assert.equal(trucks.length, 8);
  assert.ok(trucks.every(u => u.convoy.state === 'loading' && u.convoy.target), 'all due trucks and both players complete their dispatch pass');
  assert.equal(f.g.convoys.scheduleQueue.length, 0);
});

test('initial failed assignment retains exponential retry backoff after rollback', () => {
  const f = fixture(); f.troop(); const searches = [];
  f.hooks.route = () => { searches.push(f.g.tick / 20); return []; };
  for (let n = 0; n <= 24 * 20; n++) f.tick();
  assert.deepEqual(searches, [0, 2, 6, 14]);
  const truck = [...f.g.units.values()].find(u => u.type === 'truck');
  assert.equal(truck.convoy.retry.wait, 16);
  assert.equal(truck.convoy.retry.at, 600);
  assert.deepEqual(truck.convoy.cargo, empty());
});

test('explicit allied cache relief feeds the recipient and retains payer stock accounting', () => {
  for (const explicit of [false, true]) {
    const f = fixture([0, 0]), cache = f.unit('supplycache', 1, { x: 80, z: 0 }); f.tick(0);
    const recipient = f.troop({ x: 82, z: 0 }, 1); recipient.logistics.ammo = 0;
    f.g.players[1].away = true;
    const truck = f.truck(), target = { id: `cache:${cache.id}`, store: `cache:${cache.id}`, owner: 1, x: cache.x, z: cache.z, need: { ammo: 24, provisions: 960, fuel: 1440 } };
    if (explicit) assert.deepEqual(scheduler.commandConvoy(f.g, 0, { t: 'supply', ids: [truck.id], target: cache.id }, f.hooks), { result: undefined });
    else Object.assign(truck.convoy, { target, state: 'loading', timer: L.loadSeconds });
    for (let n = 0; n < 4; n++) f.tick(1);
    const loaded = { ...truck.convoy.cargo }, paid = { mun: f.g.players[0].mun, fuel: f.g.players[0].fuel };
    assert.deepEqual(loaded, target.need);
    near(paid.mun, 100);
    near(f.g.players[1].mun, 100); near(f.g.players[1].fuel, 100);
    f.arrive(truck); f.tick(0);
    for (let n = 0; n < 9; n++) f.tick(1);
    const store = f.g.convoys.stores.get(target.store), donor = store.buckets.get(0);
    near(donor.ammo + recipient.logistics.ammo * recipient.logistics.ammoPrice + recipient.logistics.ammoCredit + truck.convoy.cargo.ammo, loaded.ammo);
    near(donor.provisions + recipient.logistics.provisions - 20 + truck.convoy.cargo.provisions, loaded.provisions);
    near(donor.fuel + truck.convoy.cargo.fuel, loaded.fuel);
    near(f.g.players[0].mun, paid.mun); near(f.g.players[1].mun, 100); near(f.g.players[1].fuel, 100);
    assert.deepEqual(store.buckets.get(1), empty(), 'donated stock stays attributed to its donor');
    if (explicit) {
      assert.equal(recipient.logistics.ammo, recipient.logistics.ammoMax);
      assert.equal(recipient.logistics.provisions, L.provisions);
      const beforeSupport = { ...donor };
      assert.equal(scheduler.supportProvision(f.g, recipient, 1, 5, f.hooks), true);
      near(donor.ammo, beforeSupport.ammo); near(donor.fuel, beforeSupport.fuel);
      for (const recipients of store.donations.values()) for (const grant of recipients.values()) for (const value of Object.values(grant)) assert.ok(Number.isFinite(value), 'provision support leaves every authorized commodity finite');
      near(donor.provisions + recipient.logistics.provisions - 20 + truck.convoy.cargo.provisions, loaded.provisions - 5);
      const donorTroop = f.troop({ x: cache.x + 3, z: cache.z }, 0); donorTroop.logistics.ammo = 0;
      f.tick(1);
      assert.equal(donorTroop.logistics.provisions, 20, 'donated provisions are reserved for the intended recipient');
      assert.equal(donorTroop.logistics.ammo, 0, 'the automatic donor fleet cannot reclaim relief as private stock');
      assert.deepEqual(scheduler.logisticsSnapshot(f.g, 0).stores.find(s => s.id === store.id).stock, empty());
      assert.deepEqual(scheduler.logisticsSnapshot(f.g, 1).stores.find(s => s.id === store.id).stock, donor);
    } else {
      assert.equal(recipient.logistics.ammo, 0, 'automatic donor stock remains private');
      assert.equal(recipient.logistics.provisions, 20);
    }
  }
});

test('relief from two donors shares one unloading rate and conserves each payer bucket', () => {
  const f = fixture([0, 0, 0]), cache = f.unit('supplycache', 1, { x: 80, z: 0 }); f.tick(0);
  for (const p of f.g.players) p.away = true;
  const trucks = [f.truck(0), f.truck(2)];
  for (const truck of trucks) assert.deepEqual(scheduler.commandConvoy(f.g, truck.owner, { t: 'supply', ids: [truck.id], target: cache.id }, f.hooks), { result: undefined });
  for (let n = 0; n < 4; n++) f.tick(1);
  for (const truck of trucks) f.arrive(truck);
  f.tick(0); f.tick(L.unloadSeconds);
  const store = f.g.convoys.stores.get(`cache:${cache.id}`), recipient = f.troop({ x: 82, z: 0 }, 1);
  recipient.logistics.ammo = recipient.logistics.ammoMax;
  const before = trucks.map(t => ({ ...store.buckets.get(t.owner) }));
  f.tick(1);
  near(recipient.logistics.provisions, 35, 'one local store unloads one provision allowance regardless of donor count');
  near(store.buckets.get(0).provisions, before[0].provisions - 15);
  near(store.buckets.get(2).provisions, before[1].provisions);
  assert.equal(scheduler.supportProvision(f.g, recipient, 1, 5, f.hooks), true);
  near(store.buckets.get(0).provisions + store.buckets.get(2).provisions + recipient.logistics.provisions - 20 + 5, before[0].provisions + before[1].provisions);
  near(f.g.players[0].mun, 100); near(f.g.players[2].mun, 100); near(f.g.players[1].mun, 100);
});
