// Territory supply on ordinary maps (docs/territory-supply.md): distance, damaged ground, chokepoints, Annihilation
// points as sources, free refills and the truck cap.
import assert from 'node:assert/strict';
import { createGame, step, CFG, TICK, supplyRateAt } from './shared/sim.js';
import { LOGISTICS } from './shared/logistics.js';
import { fixtureCommand } from './test-fixtures.js';

const W = 400, H = 40;
const map = (rows) => ({ w: W, h: H, rows: rows ?? Array(H).fill('.'.repeat(W)), spawns: [{ x: 5, y: 20 }, { x: W - 6, y: 20 }], points: [] });
const game = (m = map(), mode = 'conquest') => createGame(m, ['one', 'two'], false, [0, 1], [0, 1], { mode, logistics: true, weather: 'clear' });
const advance = (g, seconds) => { for (let n = 0; n < Math.ceil(seconds / TICK); n++) step(g); };
const hqOf = (g, owner) => [...g.units.values()].find(u => u.owner === owner && u.type === 'hq');
const rateAt = (g, x, owner = 0) => supplyRateAt(g, owner, { x: hqOf(g, owner).x + x, z: hqOf(g, owner).z });
const settle = (g) => advance(g, CFG.supply.network * TICK);

{
  // refill weakens with distance: full near the source, falling evenly to the floor
  const g = game();
  for (const u of [...g.units.values()]) if (u.owner === 1 && !u.cells) g.units.delete(u.id); // no enemy zone of control
  settle(g);
  assert.equal(rateAt(g, 100), 1, 'within 150 m of travel the line is at full strength');
  const half = rateAt(g, 375);
  assert.ok(Math.abs(half - (1 - (1 - CFG.supply.floor) * (375 - CFG.supply.near) / (CFG.supply.far - CFG.supply.near))) < 0.03, `the rate falls evenly beyond 150 m (${half})`);
  assert.equal(rateAt(g, 700), CFG.supply.floor, 'far out it holds at the floor');

  // craters lengthen the line without cutting it; filling them restores it
  const band = []; for (let y = 0; y < H; y++) for (let x = 100; x < 110; x++) band.push(y * W + x);
  for (const c of band) g.chars[c] = '+';
  settle(g);
  const cratered = rateAt(g, 375);
  assert.ok(cratered < half && cratered > 0, `a cratered band weakens supply beyond it without cutting it (${cratered} < ${half})`);
  for (const c of band) g.chars[c] = '.';
  settle(g);
  assert.ok(Math.abs(rateAt(g, 375) - half) < 1e-6, 'filled craters restore the line');
}

{
  // a river crossed only by a bridge: the bridge carries supply, a broken bridge cuts it
  const rows = Array.from({ length: H }, (_, y) => '.'.repeat(60) + (y === 20 ? '====' : 'WWWW') + '.'.repeat(W - 64));
  const g = game(map(rows));
  for (const u of [...g.units.values()]) if (u.owner === 1 && !u.cells) g.units.delete(u.id);
  settle(g);
  const across = { x: 70 * 2, z: 20 * 2 };
  assert.ok(supplyRateAt(g, 0, across) > 0, 'supply crosses the river on the bridge');
  const bridge = [0, 1, 2, 3].map(i => 20 * W + 60 + i), saved = bridge.map(c => g.flags[c]);
  for (const c of bridge) g.flags[c] = g.flags[10 * W + 60];
  settle(g);
  assert.equal(supplyRateAt(g, 0, across), 0, 'a broken bridge cuts the line beyond it');
  bridge.forEach((c, i) => { g.flags[c] = saved[i]; });
  settle(g);
  assert.ok(supplyRateAt(g, 0, across) > 0, 'a rebuilt bridge restores it');
}

{
  // Annihilation: a held point connected to the HQ is a source, so supply runs at full strength around it
  const m = map(); m.points = [{ x: 300, y: 20 }];
  const g = game(m, 'annihilation');
  // the enemy keeps riflemen (Annihilation ends a side with no units), parked by its own HQ for now
  for (const u of [...g.units.values()]) if (u.owner === 1 && !u.cells) g.units.delete(u.id);
  g.players[1].mp = 10000;
  for (let i = 0; i < 10; i++) assert.equal(fixtureCommand(g, 1, { t: 'buy', unit: 'rifle' }), undefined, 'enemy riflemen for the line');
  const enemies = [...g.units.values()].filter(u => u.owner === 1 && u.type === 'rifle');
  enemies.forEach((u, i) => Object.assign(u, { x: (W - 8) * 2, z: 2 + i * 8, holdFire: true, holdPos: true, auto: false, autoRetreat: false }));
  assert.ok(g.points.length === 1, 'the map keeps its capture point');
  settle(g);
  const near = { x: 300 * 2 + 20, z: 20 * 2 };
  const before = supplyRateAt(g, 0, near);
  g.points[0].owner = 0; g.points[0].cut = false; settle(g);
  assert.equal(supplyRateAt(g, 0, near), 1, 'a held, connected point supplies at full strength');
  assert.ok(before < 1, 'without the point that ground was far down the line');
  // a line of enemy riflemen across the map: their zone of control cuts the point from the HQ
  enemies.forEach((u, i) => Object.assign(u, { x: 250 * 2, z: 2 + i * 8 }));
  advance(g, 3);
  assert.equal(g.points[0].cut, true, 'the enemy line cuts the point from its HQ');
  assert.equal(supplyRateAt(g, 0, near), 0, 'a point cut off from its HQ supplies nothing');
}

{
  // refills along the line are free in every mode: the currencies buy decisions, supply lines limit ammunition
  for (const mode of ['classic', 'conquest']) {
    const g = game(map(), mode);
    for (const u of [...g.units.values()]) if (u.owner === 1 && !u.cells) g.units.delete(u.id);
    const u = [...g.units.values()].find(v => v.owner === 0 && v.logistics?.ammoMax > 0);
    Object.assign(u, { x: hqOf(g, 0).x + 100, holdFire: true, holdPos: true, auto: false, autoRetreat: false });
    settle(g);
    u.logistics.ammo = 0; const mun = g.players[0].mun = 50;
    advance(g, 4);
    assert.ok(u.logistics.ammo > 0, `${mode}: the line refills ammunition`);
    const trickle = mode === 'classic' ? CFG.classic.hqMun * g.army.income * 4 : 0; // Classic's HQ trickle comes in meanwhile
    assert.ok(Math.abs(g.players[0].mun - (mun + trickle)) < 1e-6, `${mode}: refills are free (${g.players[0].mun} Munitions)`);
  }
}

{
  // trucks only for what is out of supply, at most four per player
  const g = game();
  const every = CFG.supply.network; CFG.supply.network = 0; g.supplyNet = {};
  for (const u of g.units.values()) if (u.logistics) Object.assign(u.logistics, { supplyRate: 0, cutFor: LOGISTICS.supplyGrace, provisions: 20 });
  advance(g, 12);
  const trucks = [...g.units.values()].filter(u => u.owner === 0 && u.type === 'truck');
  assert.ok(trucks.length > 0 && trucks.length <= LOGISTICS.maxTrucks, `cut-off troops get trucks, at most ${LOGISTICS.maxTrucks} (${trucks.length})`);
  CFG.supply.network = every;
}
console.log('PASS territory supply: distance, craters and filling, bridges, Annihilation points, free refills and truck cap');
