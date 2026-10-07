import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as scheduler from './shared/supply-convoys.js';
import { initializeUnit } from './shared/logistics.js';

const empty = () => ({ ammo: 0, provisions: 0, fuel: 0 });
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
function fixture(mode = 'conquest', teams = [0]) {
  const g = { logisticsEnabled: true, winner: null, tick: 0, nextId: 1, mode: { kind: mode }, units: new Map(), points: [], players: teams.map((team, slot) => ({ team, slot, spawn: { x: slot * 5, z: 0 }, fuel: 100, mun: 100 })), w: 100, chars: [], aid: new Map() };
  const unit = (type, owner = 0, at = { x: 0, z: 0 }) => {
    const u = { id: g.nextId++, type, owner, hp: 100, built: 1, x: at.x, z: at.z, path: [], orders: [], worldGoal: null, still: 3 };
    g.units.set(u.id, u); return u;
  };
  if (mode === 'classic' || mode === 'world') for (const p of g.players) unit('hq', p.slot, p.spawn);
  const hooks = {
    spawn: (owner, type, at) => unit(type, owner, at),
    cache: (owner, region) => unit('supplycache', owner, region),
    route: (u, at) => [{ x: at.x, z: at.z }], handoff: () => true,
    retire: u => g.units.delete(u.id),
  };
  const troop = (at = { x: 60, z: 0 }, owner = 0) => {
    const u = unit('rifle', owner, at);
    initializeUnit(g, u, { models: 5, infantry: true, speed: 4.5, w: { interval: 1.6, range: 28, inf: 3, veh: 1, perModel: true } });
    // trucks serve troops cut off from territory supply (these fixtures have no supply network)
    u.logistics.provisions = 20; u.logistics.cutFor = 10; return u;
  };
  scheduler.setupConvoys(g);
  const step = (seconds = 1) => { scheduler.stepConvoys(g, seconds, hooks); g.tick += seconds * 20; };
  const trucks = () => [...g.units.values()].filter(u => u.type === 'truck');
  // trucks now exist only for out-of-supply work; tests of truck mechanics add one at the player's source
  const truck = (owner = 0) => scheduler.addTruck(g, owner, [...g.convoys.stores.values()].find(s => s.source && s.owner === owner), hooks);
  const arrive = u => { Object.assign(u, u.convoy.destination); u.path = []; u.worldGoal = null; };
  return { g, hooks, unit, troop, step, trucks, truck, arrive };
}

test('trucks stay at the source during four-second loading and unload incrementally', () => {
  const f = fixture(), recipient = f.troop();
  f.step(); const t = f.trucks()[0];
  assert.equal(t.convoy.state, 'loading');
  assert.equal(t.path.length, 0);
  assert.equal(t.worldGoal, null);
  assert.equal(t.convoy.cargo.provisions, 0);
  f.step(); f.step();
  assert.equal(t.convoy.state, 'loading');
  f.step();
  assert.equal(t.convoy.state, 'delivering');
  assert.equal(t.convoy.cargo.provisions, 100);
  f.arrive(t); f.step();
  assert.equal(t.convoy.state, 'unloading');
  f.step();
  assert.equal(recipient.logistics.provisions, 35);
  assert.equal(t.convoy.cargo.provisions, 85);
});

test('collecting and loading jobs reserve grouped troop demand before any cargo exists', () => {
  const f = fixture(); f.troop();
  for (let i = 0; i < 6; i++) f.step(0.5);
  assert.equal(f.trucks().filter(t => t.convoy.target?.unit).length, 1);
});

test('a moved recipient causes timely route retry instead of an infinite unload state', () => {
  const f = fixture(), u = f.troop();
  for (let i = 0; i < 4; i++) f.step();
  const t = f.trucks()[0]; f.arrive(t); f.step();
  u.x = 100;
  for (let i = 0; i < 9; i++) f.step();
  assert.equal(t.convoy.state, 'delivering');
  assert.equal(t.convoy.destination.x, 100);
  assert.equal(t.convoy.cargo.provisions, 100);
});

test('manual hold and resume preserve paid cargo and original delivery', () => {
  const f = fixture(); f.troop();
  for (let i = 0; i < 4; i++) f.step();
  const t = f.trucks()[0], cargo = { ...t.convoy.cargo }, target = t.convoy.target.id;
  scheduler.commandConvoy(f.g, 0, { t: 'stop', ids: [t.id] }, f.hooks);
  f.step(5);
  assert.deepEqual(t.convoy.cargo, cargo);
  assert.equal(t.convoy.hold, true);
  scheduler.commandConvoy(f.g, 0, { t: 'logisticsResume', ids: [t.id] }, f.hooks);
  assert.equal(t.convoy.state, 'delivering');
  assert.equal(t.convoy.target.id, target);
  assert.deepEqual(t.convoy.cargo, cargo);
});

test('idle trucks with returned cargo never overwrite it when assigning a new job', () => {
  const f = fixture(); f.step();
  const t = f.truck(); Object.assign(t.convoy.cargo, { ammo: 0.5, provisions: 40 });
  f.troop(); f.step(2); f.step(0);
  assert.equal(t.convoy.state, 'delivering');
  assert.equal(t.convoy.cargo.provisions, 40);
  assert.equal(t.convoy.cargo.ammo, 0.5);
});

test('destroyed trucks lose cargo and become replaceable only after thirty seconds', () => {
  const f = fixture(); f.troop(); f.step(); f.step();
  const before = f.trucks().length, dead = f.trucks()[0];
  dead.convoy.cargo.provisions = 100;
  scheduler.convoyDeath(f.g, dead); f.g.units.delete(dead.id);
  f.step(29);
  assert.equal(f.trucks().length, before - 1);
  f.step(); f.step(0);
  assert.equal(f.trucks().length, before);
  assert.equal(f.trucks().reduce((sum, t) => sum + t.convoy.cargo.provisions, 0), 0);
});

test('fleet shrink retires only empty automatic trucks parked at an active source', () => {
  const f = fixture();
  for (let i = 0; i < 20; i++) f.troop({ x: 60 + i, z: 0 });
  for (let i = 0; i < 8; i++) f.step();
  for (const u of [...f.g.units.values()]) if (u.logistics) f.g.units.delete(u.id);
  const own = f.trucks(), keep = own[0];
  keep.convoy.cargo.provisions = 50; keep.convoy.state = 'idle'; keep.path = [];
  for (const t of own.slice(1)) { t.convoy.state = 'idle'; t.convoy.target = null; t.convoy.cargo = empty(); t.path = []; t.worldGoal = null; Object.assign(t, { x: 0, z: 0 }); }
  f.step(2); f.step();
  assert.equal(f.trucks().length, 1, 'with no work left only the truck still holding cargo stays');
  assert.equal(f.g.units.has(keep.id), true);
  assert.equal(keep.convoy.cargo.provisions, 50);
});

test('source loads charge only the paying owner and explicit allied relief does not recharge cargo', () => {
  const f = fixture('classic', [0, 0]), recipient = f.troop({ x: 60, z: 0 }, 1);
  recipient.logistics.ammo = 0;
  f.step();
  const t = f.truck(), beforeOther = f.g.players[1].mun;
  for (const other of f.trucks().filter(t => t.owner === 1)) { other.convoy.hold = true; }
  f.g.players[1].away = true;
  scheduler.commandConvoy(f.g, 0, { t: 'supply', ids: [t.id], target: recipient.id }, f.hooks);
  for (let i = 0; i < 4; i++) f.step();
  assert.equal(t.convoy.cargo.ammo, 2.85);
  near(f.g.players[0].mun, 97.15);
  near(f.g.players[1].mun, beforeOther);
  const paid = f.g.players[0].mun;
  f.arrive(t); f.step(); f.step();
  near(f.g.players[0].mun, paid);
  assert.ok(recipient.logistics.ammo > 0);
});

test('manual extension cannot reuse consumed operating fuel or move without funding', () => {
  assert.equal(typeof scheduler.consumeConvoyTravel, 'function');
  assert.equal(typeof scheduler.convoyTravelBudget, 'function');
  const f = fixture('classic'); f.step();
  const t = f.truck();
  assert.equal(scheduler.commandConvoy(f.g, 0, { t: 'move', orders: [[t.id, 100, 0]] }, f.hooks), null);
  assert.ok(f.g.players[0].fuel < 100);
  const funded = scheduler.convoyTravelBudget(f.g, t, 10000);
  assert.ok(funded >= 200);
  scheduler.consumeConvoyTravel(f.g, t, funded);
  assert.equal(scheduler.convoyTravelBudget(f.g, t, 1), 0);
  f.g.players[0].fuel = 0;
  const before = { ...t.convoy };
  assert.deepEqual(scheduler.commandConvoy(f.g, 0, { t: 'move', orders: [[t.id, 200, 0]] }, f.hooks), { result: 'fuel' });
  assert.deepEqual(t.convoy, before);
});

test('returning unused paid cargo stores it once under its payer and does not refund currency', () => {
  const f = fixture('classic'); f.step();
  const t = f.truck(), source = [...f.g.convoys.stores.values()].find(s => s.source);
  Object.assign(t.convoy, { state: 'returning', origin: source.id, destination: { x: 0, z: 0 }, cargo: { ammo: 2, provisions: 50, fuel: 30 } });
  const money = { fuel: f.g.players[0].fuel, mun: f.g.players[0].mun };
  f.step(); f.step();
  assert.deepEqual(source.buckets.get(0), { ammo: 2, provisions: 50, fuel: 30 });
  assert.deepEqual(t.convoy.cargo, empty());
  assert.equal(f.g.players[0].fuel, money.fuel);
  assert.equal(f.g.players[0].mun, money.mun);
});

test('queued waypoints reserve the complete route once and preserve manual state', () => {
  const f = fixture('classic'); f.step();
  const t = f.truck();
  scheduler.commandConvoy(f.g, 0, { t: 'move', orders: [[t.id, 100, 0]] }, f.hooks);
  t.path = [{ x: 100, z: 0 }]; t.worldGoal = { x: 100, z: 0 };
  const before = f.g.players[0].fuel;
  scheduler.commandConvoy(f.g, 0, { t: 'move', orders: [[t.id, 200, 0]], queue: true }, f.hooks);
  near(before - f.g.players[0].fuel, 240 * 0.002);
  assert.equal(t.convoy.state, 'manual');
  scheduler.consumeConvoyTravel(f.g, t, 100);
  t.x = 100; t.path = []; t.worldGoal = null;
  const funded = f.g.players[0].fuel;
  scheduler.commandConvoy(f.g, 0, { t: 'move', orders: [[t.id, 200, 0]] }, f.hooks);
  assert.equal(f.g.players[0].fuel, funded);
});

test('support providers require a reachable local handoff', () => {
  const f = fixture(); f.step();
  assert.equal(scheduler.supportProvision(f.g, { x: 2, z: 0 }, 0, 1, { handoff: () => false }), false);
  assert.equal(scheduler.supportProvision(f.g, { x: 2, z: 0 }, 0, 1, f.hooks), true);
});

test('moving support stores cannot receive unloaded cargo from outside handoff range', () => {
  const f = fixture();
  const host = f.unit('halftrack', 0, { x: 40, z: 0 });
  f.step();
  const store = f.g.convoys.stores.get(`support:${host.id}`);
  store.buckets.get(0).provisions = 0;
  const t = f.truck();
  Object.assign(t, { x: 40, z: 0 });
  Object.assign(t.convoy, { state: 'unloading', timer: 8, target: { id: store.id, store: store.id, x: 40, z: 0 }, cargo: { ammo: 0, provisions: 50, fuel: 0 } });
  const before = store.buckets.get(0).provisions;
  host.x = 100; f.g.tick = 40;
  f.step();
  assert.equal(store.buckets.get(0).provisions, before);
  assert.equal(t.convoy.cargo.provisions, 50);
});

test('a full return source retains surplus cargo on the truck without duplicating stock', () => {
  const f = fixture('classic'); f.step();
  const t = f.truck(), source = [...f.g.convoys.stores.values()].find(s => s.source);
  source.buckets.set(0, { ammo: source.capacity.ammo, provisions: source.capacity.provisions, fuel: source.capacity.fuel });
  Object.assign(t.convoy, { state: 'returning', destination: { x: 0, z: 0 }, cargo: { ammo: 2, provisions: 50, fuel: 30 } });
  f.step();
  assert.deepEqual(t.convoy.cargo, { ammo: 2, provisions: 50, fuel: 30 });
  assert.equal(source.buckets.get(0).provisions, source.capacity.provisions);
});

test('sub-one army multipliers scale cargo instead of silently rounding to one', () => {
  const f = fixture(); f.g.army = { pop: 0.5, cap: 99 };
  f.step();
  assert.equal([...f.g.convoys.stores.values()][0].capacity.provisions, 32 * 120 * 0.5);
});

test('queued manual movement suspends delivery while retaining carried cargo', () => {
  const f = fixture('classic'); f.troop();
  for (let i = 0; i < 4; i++) f.step();
  const t = f.trucks()[0], cargo = { ...t.convoy.cargo };
  scheduler.commandConvoy(f.g, 0, { t: 'move', queue: true, orders: [[t.id, 80, 0]] }, f.hooks);
  assert.equal(t.convoy.state, 'manual');
  assert.equal(t.convoy.manual, true);
  assert.deepEqual(t.convoy.cargo, cargo);
});

test('contested depot stock pauses intact while an ownership change destroys it', () => {
  const f = fixture('classic', [0, 1]);
  f.g.points = [{ x: 30, z: 0, kind: 'depot', owner: 0, contested: false }];
  f.step();
  const store = f.g.convoys.stores.get('point:0'); store.buckets.set(0, { ammo: 1, provisions: 50, fuel: 10 });
  f.g.points[0].contested = true; f.g.tick = 40; f.step();
  assert.equal(f.g.convoys.stores.get('point:0'), store);
  assert.equal(store.active, false);
  f.g.points[0].contested = false; f.g.tick = 80; f.step();
  assert.equal(store.buckets.get(0).provisions, 50);
  f.g.points[0].owner = 1; f.g.tick = 120; f.step();
  assert.equal(f.g.convoys.stores.get('point:0').owner, 1);
  assert.equal(f.g.convoys.stores.get('point:0').buckets.get(0), undefined);
});

test('manual return reserves operating fuel before applying retreat state', () => {
  const f = fixture('classic'); f.step();
  const t = f.truck(); t.x = 100; f.g.players[0].fuel = 0;
  assert.deepEqual(scheduler.commandConvoy(f.g, 0, { t: 'retreat', ids: [t.id] }, f.hooks), { result: 'fuel' });
  assert.equal(t.convoy.manual, false);
  f.g.players[0].fuel = 1;
  assert.equal(scheduler.commandConvoy(f.g, 0, { t: 'retreat', ids: [t.id] }, f.hooks), null);
  assert.ok(scheduler.convoyTravelBudget(f.g, t, 1000) >= 100);
});

test('automatic deliveries stop for newly visible danger and resume the same funded cargo job', () => {
  const f = fixture(); f.troop();
  for (let i = 0; i < 4; i++) f.step();
  const t = f.trucks()[0], target = t.convoy.target, cargo = { ...t.convoy.cargo };
  let safe = false;
  f.hooks.route = (u, at, automatic) => automatic && !safe ? [] : [{ x: at.x, z: at.z }];
  f.g.tick = 80; f.step(0);
  assert.equal(t.convoy.state, 'waiting');
  assert.equal(t.path.length, 0);
  assert.equal(t.worldGoal, null);
  assert.equal(t.convoy.target, target);
  assert.deepEqual(t.convoy.cargo, cargo);
  safe = true; f.g.tick = 120; f.step(0);
  assert.equal(t.convoy.state, 'delivering');
  assert.ok(t.path.length > 0);
  assert.equal(t.convoy.target, target);
  assert.deepEqual(t.convoy.cargo, cargo);
});

test('interrupted collection resumes toward the origin and waits to load there', () => {
  const f = fixture(); f.step();
  const t = f.truck(); t.x = 100;
  f.troop({ x: 180, z: 0 }); f.g.tick = 40; f.step(0);
  assert.equal(t.convoy.state, 'collecting');
  let safe = false;
  f.hooks.route = (u, at, automatic) => automatic && !safe ? [] : [{ x: at.x, z: at.z }];
  f.g.tick = 80; f.step(0);
  assert.equal(t.convoy.state, 'waitingCollect');
  assert.equal(t.path.length, 0);
  assert.deepEqual(t.convoy.cargo, empty());
  safe = true; f.g.tick = 120; f.step(0);
  assert.equal(t.convoy.state, 'collecting');
  assert.equal(t.convoy.destination.x, 0);
  f.arrive(t); f.step(0);
  assert.equal(t.convoy.state, 'loading');
  assert.deepEqual(t.convoy.cargo, empty());
});

test('automatic blocked dispatch emits a grouped route reason and suppresses repeated alerts', () => {
  const f = fixture(); f.troop();
  f.hooks.route = (u, at, automatic) => { u.supplyRouteReason = automatic ? 'dangerous' : null; return automatic ? [] : [{ x: at.x, z: at.z }]; };
  f.step(0);
  assert.equal(f.g.convoys.events.filter(e => e.type === 'dangerous').length, 1);
  f.g.tick = 40; f.step(0);
  assert.equal(f.g.convoys.events.filter(e => e.type === 'dangerous').length, 1);
  f.g.tick = 400; f.step(0);
  assert.equal(f.g.convoys.events.filter(e => e.type === 'dangerous').length, 2);
});

test('forced and stranded units receive separate grouped notifications', () => {
  const f = fixture();
  for (let i = 0; i < 2; i++) Object.assign(f.troop({ x: 60 + i, z: 0 }).logistics, { forced: true, stranded: true });
  f.step(0);
  assert.equal(f.g.convoys.events.find(e => e.type === 'withdrawal')?.count, 2);
  assert.equal(f.g.convoys.events.find(e => e.type === 'stranded')?.count, 2);
});

test('collection survives source loss and resumes at a rebuilt friendly HQ', () => {
  const f = fixture('classic'); f.step();
  const t = f.truck(); t.x = 100; f.troop({ x: 180, z: 0 }); f.g.tick = 40; f.step(0);
  const target = t.convoy.target;
  const old = [...f.g.units.values()].find(u => u.type === 'hq');
  scheduler.convoyDeath(f.g, old); f.g.units.delete(old.id);
  f.g.tick = 80; f.step(0);
  assert.equal(t.convoy.state, 'waitingCollect');
  assert.equal(t.convoy.target, target);
  assert.equal(t.path.length, 0);
  const rebuilt = f.unit('hq', 0, { x: 20, z: 0 }); f.g.tick = 120; f.step(0);
  assert.equal(t.convoy.state, 'collecting');
  assert.equal(t.convoy.origin, `source:${rebuilt.id}`);
  assert.equal(t.convoy.target, target);
});

test('returned paid cargo survives absent sources and resumes after a friendly HQ rebuild', () => {
  const f = fixture('classic'); f.step();
  const t = f.truck(), old = [...f.g.units.values()].find(u => u.type === 'hq');
  t.x = 100;
  Object.assign(t.convoy, { state: 'returning', cargo: { ammo: 1, provisions: 30, fuel: 10 } });
  scheduler.convoyDeath(f.g, old); f.g.units.delete(old.id); f.g.tick = 40; f.step(0);
  assert.equal(t.convoy.state, 'waitingReturn');
  assert.deepEqual(t.convoy.cargo, { ammo: 1, provisions: 30, fuel: 10 });
  const rebuilt = f.unit('hq', 0, { x: 20, z: 0 }); f.g.tick = 80; f.step(0);
  assert.equal(t.convoy.state, 'returning');
  assert.equal(t.convoy.origin, `source:${rebuilt.id}`);
  f.arrive(t); f.step(0);
  assert.deepEqual(f.g.convoys.stores.get(`source:${rebuilt.id}`).buckets.get(0), { ammo: 1, provisions: 30, fuel: 10 });
});


test('queued long movement funds the full current goal beyond its active navigation leg', () => {
  for(const path of [[{x:64,z:0}],[]]) {
  const f=fixture('classic');f.step(0);const t=f.truck();
  Object.assign(t,{path,worldGoal:{x:1000,z:0}});
  Object.assign(t.convoy,{manual:true,state:'manual',operatingMetres:2400});
  assert.equal(scheduler.commandConvoy(f.g,0,{t:'move',queue:true,orders:[[t.id,1000,1000]]},f.hooks),null);
  const complete=(1000+1000+Math.hypot(1000,1000))*1.2;
  near(t.convoy.operatingMetres,complete);
  }
});


test('route reuse requires the safety hook and resumes rechecks when it rejects a changed route', () => {
  const f = fixture(); f.troop();
  f.step(); f.step(4);
  const truck = f.trucks().find(t => t.convoy.state === 'delivering');
  assert.ok(truck);
  let searches = 0;
  const route = f.hooks.route;
  f.hooks.route = (...args) => { searches++; return route(...args); };
  f.hooks.continueRoute = () => true;
  f.step(2);
  assert.equal(searches, 0, 'stable safe routes avoid a new route search');
  const cargo = { ...truck.convoy.cargo };
  f.hooks.continueRoute = () => false;
  f.hooks.route = (u, at, safe) => safe ? [] : route(u, at);
  f.step(2);
  assert.equal(truck.convoy.state, 'waiting', 'unsafe routes stop at the next dispatch');
  assert.deepEqual(truck.convoy.cargo, cargo, 'safety rechecks retain paid cargo');
});

test('a cycle with many trucks to reroute spreads their route plans over ticks', () => {
  const f = fixture(), recipient = f.troop();
  f.step(0);
  const fleet = Array.from({ length: 8 }, () => f.hooks.spawn(0, 'truck', { x: 30, z: 0 }));
  for (const t of fleet) t.convoy = { state: 'delivering', cargo: { ammo: 0, provisions: 1, fuel: 0 }, target: { id: `unit:${recipient.id}`, unit: recipient.id, x: 60, z: 0 }, origin: null, timer: 0, manual: false, hold: false, route: [], destination: { x: 60, z: 0 }, operatingMetres: 1e6 };
  const routed = []; f.hooks.route = (u, at) => { routed.push([f.g.tick, u.id]); return [{ x: at.x, z: at.z }]; };
  f.g.tick = 40;
  for (let n = 0; n < 4; n++) { f.step(0); f.g.tick++; }
  const perTick = Map.groupBy(routed, ([tick]) => tick);
  assert.ok([...perTick.values()].every(calls => calls.length <= 3), 'at most three route plans per tick');
  for (const t of fleet) assert.ok(routed.some(([, id]) => id === t.id), 'every due truck is rerouted within the cycle');
});

test('a truck stuck within loading reach of its HQ counts as home', () => {
  const f = fixture('classic'); f.step();
  const t = f.truck(), hq = [...f.g.units.values()].find(u => u.type === 'hq');
  Object.assign(t, { x: hq.x + 13, z: hq.z, path: [{ x: hq.x + 9, z: hq.z }], stuck: 0 });
  Object.assign(t.convoy, { state: 'returning', cargo: { ammo: 1, provisions: 30, fuel: 10 }, destination: { x: hq.x, z: hq.z }, origin: `source:${hq.id}` });
  f.step(0);
  assert.equal(t.convoy.state, 'returning', 'a truck still driving home is not there yet');
  t.stuck = 1; f.step(0);
  assert.equal(t.convoy.state, 'idle', 'parked trucks blocking the last metres do not keep it out');
  assert.deepEqual(f.g.convoys.stores.get(`source:${hq.id}`).buckets.get(0), { ammo: 1, provisions: 30, fuel: 10 });
});

test('pricing the way home needs no route search', () => {
  const f = fixture('classic'), troop = f.troop({ x: 300, z: 0 });
  f.step(); f.step(4);
  const t = f.trucks().find(u => u.convoy.state === 'delivering');
  assert.ok(t);
  const hq = [...f.g.units.values()].find(u => u.type === 'hq'), homeward = [];
  const route = f.hooks.route;
  f.hooks.route = (u, at, safe) => { if (Math.hypot(at.x - hq.x, at.z - hq.z) < 1) homeward.push(f.g.tick); return route(u, at, safe); };
  f.hooks.continueRoute = () => false;
  f.step(2); f.step(2);
  troop.x += 50; f.step(2);
  assert.equal(homeward.length, 0, 'the way home is priced by its straight line, rechecks and new trip ends alike');
});
