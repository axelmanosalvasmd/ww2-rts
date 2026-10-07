import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LOGISTICS, enabledFor, initializeUnit, ammoPrice, consumeAmmo, canFire, tickReserves, consumeDrivingFuel, shortageRate, recoveryRate, recovered, transferStock, shortageState } from './shared/logistics.js';

const rifle = { name: 'Rifle Squad', models: 5, speed: 4.5, infantry: true, w: { interval: 1.6, range: 28, inf: 3, veh: 1.5, perModel: true } };
const tank = { name: 'Light Tank', models: 1, speed: 6.5, infantry: false, w: { interval: 3, range: 35, inf: 30, veh: 45, shellTerrain: 90 } };
const mortar = { name: 'Mortar Team', models: 3, speed: 3, infantry: true, w: { interval: 8, range: 50, inf: 24, veh: 8, salvo: true, rockets: 1 } };
const rocket = { name: 'Rocket Launcher', models: 1, speed: 3.5, infantry: false, w: { interval: 20, range: 70, inf: 25, veh: 12, salvo: true, rockets: 8 } };
const medic = { name: 'Medic Team', models: 2, speed: 4.8, infantry: true, w: { interval: 9, range: 0, inf: 0, veh: 0 } };
const game = (mode) => ({ mode: mode ? { kind: mode } : undefined, players: [{ slot: 0 }] });
const troop = (def = rifle, extra = {}, g = game()) => { const u = { type: 'test', owner: 0, riding: 0, ...extra }; initializeUnit(g, u, def); return u; };
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

test('only selected modes enable reserves unless explicitly overridden', () => {
  for (const mode of [undefined, 'conquest', 'classic', 'annihilation', 'world']) assert.equal(enabledFor(game(mode)), true);
  for (const mode of ['assault', 'horde', 'tutorial', 'scenario']) assert.equal(enabledFor(game(mode)), false);
  assert.equal(enabledFor({ ...game(), scenario: {} }), false);
  assert.equal(enabledFor({ ...game('tutorial'), logisticsEnabled: true }), true);
  assert.equal(enabledFor({ ...game(), logisticsEnabled: false }), false);
});

test('eligible mobile troops start fully equipped and initialization cannot refill them', () => {
  const u = troop();
  assert.equal(u.logistics.ammoMax, 285);
  assert.equal(u.logistics.ammo, 285);
  assert.equal(u.logistics.provisions, 120);
  assert.equal(u.logistics.fuel, null);
  assert.equal(u.logistics.emergency, null);
  assert.equal(u.logistics.warning, null);
  assert.equal(u.logistics.forced, false);
  const v = troop(tank);
  assert.equal(v.logistics.fuel, 180);
  assert.equal(v.logistics.emergency, 60);
  u.logistics.ammo = 7;
  initializeUnit(game(), u, rifle);
  assert.equal(u.logistics.ammo, 7);
  assert.equal(troop(medic).logistics.ammoMax, 0);
});

test('guards, absent owners, trucks, structures, planes, ships and excluded modes have no reserves', () => {
  for (const def of [{ ...tank, speed: 0 }, { ...rifle, building: true }, { ...tank, structure: true }, { ...tank, air: true }, { ...tank, naval: true }, { ...tank, logisticsTruck: true }]) assert.equal(troop(def).logistics, undefined);
  for (const extra of [{ owner: -1 }, { owner: 2 }, { guardHome: { x: 0, z: 0 } }, { type: 'supplytruck' }]) assert.equal(troop(rifle, extra).logistics, undefined);
  assert.equal(troop(rifle, {}, game('tutorial')).logistics, undefined);
});

test('weapon endurance rounds up to full strength volleys and salvos', () => {
  assert.equal(troop(tank).logistics.ammoMax, 30);
  assert.equal(troop(mortar).logistics.ammoMax, 12);
  assert.equal(troop(rocket).logistics.ammoMax, 40);
  assert.equal(troop({ ...rifle, models: 7, w: { ...rifle.w, interval: 1.8 } }).logistics.ammoMax, 350);
});

test('weapon-specific cargo prices preserve projectile replacement cost', () => {
  assert.equal(ammoPrice(rifle), 0.01);
  assert.equal(ammoPrice({ ...tank, name: 'Armored Car', w: { interval: 1, inf: 4, veh: 14 } }), 0.01);
  assert.equal(ammoPrice(tank), 0.05);
  assert.equal(ammoPrice(mortar), 0.05);
  assert.equal(ammoPrice(rocket), 0.10);
  assert.equal(ammoPrice({ ...mortar, name: 'Field Howitzer', w: { ...mortar.w, range: 95, interval: 12 } }), 0.10);
});

test('accepted launches consume actual integer projectiles and never unfunded rounds', () => {
  const u = troop(rocket);
  u.logistics.ammo = 3;
  assert.equal(canFire(u, 8), false);
  assert.equal(canFire(u), true);
  assert.equal(consumeAmmo(u, 8), 3);
  assert.equal(u.logistics.ammo, 0);
  assert.equal(consumeAmmo(u, 8), 0);
  assert.equal(canFire(u), false);
  assert.equal(consumeAmmo({}, 5), 5);
  assert.equal(consumeAmmo(u, -2), 0);
  assert.equal(consumeAmmo(u, NaN), 0);
  assert.equal(consumeAmmo(u, Infinity), 0);
});

test('idle and riding troops use provisions but burn only actual powered driving seconds', () => {
  const u = troop(tank);
  tickReserves(game(), u, 10, 0);
  assert.equal(u.logistics.provisions, 110);
  assert.equal(u.logistics.fuel, 180);
  tickReserves(game(), u, 10, 4);
  assert.equal(u.logistics.fuel, 176);
  u.riding = 12;
  tickReserves(game(), u, 10, 10);
  assert.equal(u.logistics.provisions, 90);
  assert.equal(u.logistics.fuel, 176);
  const excluded = troop(tank, {}, game('tutorial'));
  tickReserves(game('tutorial'), excluded, 200, 200);
  assert.equal(excluded.logistics, undefined);
});

test('provisions exhaust after 120 seconds and warning counts only time after exhaustion', () => {
  const u = troop();
  tickReserves(game(), u, 119, 0);
  assert.equal(u.logistics.exhausted, false);
  tickReserves(game(), u, 1, 0);
  assert.equal(u.logistics.provisions, 0);
  assert.equal(u.logistics.warning, 20);
  tickReserves(game(), u, 19, 0);
  assert.equal(u.logistics.warning, 1);
  assert.equal(u.logistics.forced, false);
  tickReserves(game(), u, 1, 0);
  assert.equal(u.logistics.forced, true);
  assert.equal(u.logistics.warning, 0);
  const long = troop();
  tickReserves(game(), long, 130, 0);
  assert.equal(long.logistics.warning, 10);
});

test('fuel depletion forces withdrawal immediately and charges overrun to emergency fuel', () => {
  const u = troop(tank);
  u.logistics.fuel = 2;
  tickReserves(game(), u, 5, 5);
  assert.equal(u.logistics.fuel, 0);
  assert.equal(u.logistics.emergency, 57);
  assert.equal(u.logistics.forced, true);
  tickReserves(game(), u, 58, 58);
  assert.equal(u.logistics.emergency, 0);
  assert.equal(u.logistics.stranded, true);
  tickReserves(game(), u, 5, 5);
  assert.equal(u.logistics.emergency, 0);
});

test('post-movement fuel accounting does not tick provisions or exhaustion warnings again', () => {
  const u = troop(tank);
  Object.assign(u.logistics, { fuel: 2, provisions: 0, exhausted: true, warning: 10 });
  tickReserves(game(), u, 5, 0);
  const before = { provisions: u.logistics.provisions, warning: u.logistics.warning };
  consumeDrivingFuel(u, 5);
  assert.equal(u.logistics.fuel, 0);
  assert.equal(u.logistics.emergency, 57);
  assert.equal(u.logistics.forced, true);
  assert.equal(u.logistics.provisions, before.provisions);
  assert.equal(u.logistics.warning, before.warning);
  consumeDrivingFuel(u, 58);
  assert.equal(u.logistics.emergency, 0);
  assert.equal(u.logistics.stranded, true);
  const riding = troop(tank, { riding: 123 });
  consumeDrivingFuel(riding, 20);
  assert.equal(riding.logistics.fuel, 180);
  consumeDrivingFuel(troop(), 20);
  consumeDrivingFuel({}, 20);
});

test('shortage penalties never stack and exhaustion remains latched after partial relief', () => {
  const u = troop();
  u.logistics.ammo = 70;
  assert.equal(shortageRate(u), 2);
  u.logistics.provisions = 29;
  assert.equal(recoveryRate(u), 0.5);
  assert.equal(shortageRate(u), 2);
  tickReserves(game(), u, 30, 0);
  assert.equal(recoveryRate(u), 0);
  const warning = u.logistics.warning;
  transferStock({ ammo: 0, provisions: 20, fuel: 0 }, u, 8);
  assert.equal(u.logistics.exhausted, true);
  assert.equal(u.logistics.warning, warning);
  assert.equal(recoveryRate(u), 0);
  tickReserves(game(), u, 5, 0);
  assert.equal(u.logistics.warning, warning - 5);
});

test('release requires half of every applicable reserve and does not require emergency fuel', () => {
  const u = troop(tank);
  Object.assign(u.logistics, { ammo: 15, provisions: 60, fuel: 89, emergency: 0, exhausted: true, warning: 0, forced: true, stranded: true });
  assert.equal(recovered(u), false);
  transferStock({ ammo: 0, provisions: 0, fuel: 1 }, u, 1);
  assert.equal(recovered(u), true);
  assert.equal(u.logistics.forced, false);
  assert.equal(u.logistics.exhausted, false);
  assert.equal(u.logistics.stranded, false);
  assert.equal(u.logistics.warning, null);
  assert.equal(recoveryRate(u), 1);
  const healer = troop(medic);
  healer.logistics.provisions = 60;
  assert.equal(recovered(healer), true);
});

test('a blocked withdrawal stays stranded until recovery or explicit path retry', () => {
  const u = troop(tank);
  Object.assign(u.logistics, { ammo: 1, provisions: 1, fuel: 100, forced: true, stranded: true, exhausted: true, warning: 0 });
  tickReserves(game(), u, 1, 0);
  assert.equal(u.logistics.stranded, true);
  transferStock({ ammo: 0, provisions: 1, fuel: 1 }, u, 1);
  assert.equal(u.logistics.stranded, true);
});

test('full refill takes eight seconds and ordinary fuel precedes emergency fuel', () => {
  const u = troop(tank);
  Object.assign(u.logistics, { ammo: 0, provisions: 0, fuel: 0, emergency: 0 });
  const store = { ammo: 10, provisions: 300, fuel: 500, owner: 0 };
  const first = transferStock(store, u, 4);
  near(first.ammo, 0.75);
  assert.equal(first.provisions, 60);
  assert.equal(first.fuel, 120);
  assert.equal(u.logistics.ammo, 15);
  assert.equal(u.logistics.fuel, 120);
  assert.equal(u.logistics.emergency, 0);
  transferStock(store, u, 4);
  assert.equal(u.logistics.ammo, 30);
  assert.equal(u.logistics.provisions, 120);
  assert.equal(u.logistics.fuel, 180);
  assert.equal(u.logistics.emergency, 60);
  near(store.ammo, 8.5);
  assert.equal(store.provisions, 180);
  assert.equal(store.fuel, 260);
  assert.equal(store.owner, 0);
  assert.deepEqual(transferStock(store, u, 8), { ammo: 0, provisions: 0, fuel: 0 });
});

test('finite stocks conserve paid ammo credit across different weapon prices', () => {
  const cheap = troop(rifle), expensive = troop(rocket);
  cheap.logistics.ammo = expensive.logistics.ammo = 0;
  const store = { ammo: 1, provisions: 0, fuel: 0 };
  transferStock(store, cheap, 8);
  assert.equal(cheap.logistics.ammo, 100);
  assert.equal(store.ammo, 0);
  store.ammo = 1;
  transferStock(store, expensive, 8);
  assert.equal(expensive.logistics.ammo, 10);
  assert.equal(store.ammo, 0);
});

test('small incremental handoffs accumulate compatible credit without creating fractional projectiles', () => {
  const u = troop(tank);
  u.logistics.ammo = 0;
  const store = { ammo: 1.5, provisions: 0, fuel: 0 };
  for (let i = 0; i < 160; i++) {
    transferStock(store, u, 0.05);
    assert.equal(Number.isInteger(u.logistics.ammo), true);
    near(store.ammo + u.logistics.ammo * 0.05 + u.logistics.ammoCredit, 1.5);
  }
  assert.equal(u.logistics.ammo, 30);
  near(u.logistics.ammoCredit, 0);
  near(store.ammo, 0);
});

test('empty or invalid handoffs cannot create inventory or reset shortages', () => {
  const u = troop();
  u.logistics.ammo = 0;
  u.logistics.provisions = 0;
  tickReserves(game(), u, 1, 0);
  const warning = u.logistics.warning;
  const empty = { ammo: 0, provisions: 0, fuel: 0 };
  for (const seconds of [-1, 0, NaN, Infinity]) assert.deepEqual(transferStock(empty, u, seconds), empty);
  assert.equal(u.logistics.warning, warning);
  assert.deepEqual(shortageState(u), { lowAmmo: true, lowProvisions: true, exhausted: true, forced: false, stranded: false });
  assert.equal(shortageRate({}), 1);
  assert.equal(recoveryRate({}), 1);
  assert.equal(LOGISTICS.provisions, 120);
});
