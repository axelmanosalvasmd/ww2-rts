import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createGame, findPath, command, CELL, blockOf, UNITS, MOVE, SIGHT } from './shared/sim.js';
import { vehiclePositionClear } from './shared/vehicle-motion.js';

// Existing route hashes were captured at 66a3734240d98d32d4c5ecd471bd7a1bbbc63336.
// Only freshRoad and wornRoad change for the six-metre, hull-checked portal fixture.
// All fixtures use the public game, path and command interfaces.
const W = 40;
const H = 30;
const routeOracle = {
  house: '603d83d3454052aeaa916ffcc52c55f0e68c9d97c4467121382ebb8cffd06321',
  mines: '595d74b9da8cd4806c442ce462b48c635c935ad6e1d0d643af779e4a5be172f0',
  roadMud: 'f3214194663892841cb096763ea9d9732a72149237fbeeef7f38df7a7c819dba',
  naval: 'f6dfa6f44a61afe78340cb771aee1b8acb537171b3202b70ac5f80f54f0229e0',
  elevation: '2c7348829bdd69db854f3ff21874901818b9540c92b4a43bcb1dff9e763a208e',
  bunkerBase: 'ca40f1b77e8940d39a59c4d3227e14af5c409fcd293c061eb7191d0b0e415b59',
  bunkerNear: '9f197446e69527df75469b8a595ddbb2b546f1fd0bc4d186c8970599c5fcd170',
  groupMove: '8c0b031cc901b56c8dafc8d6ad52a3fed4ae8480457ad5ab3bc86f56cdc6271a',
  freshRoad: '357795d0df4e3151ec226ac54e3740cea85d12d51403df91c6c67446bbd98151',
  wornRoad: 'ebc84399dc4d07d167c45b883dabfb8d941990c9729e34f5272a997b92bf54f7',
};

function mapWith(fill = '.') {
  return {
    name: 'Path performance regression fixture',
    w: W,
    h: H,
    rows: Array.from({ length: H }, () => fill.repeat(W)),
    spawns: [{ x: 2, y: 15 }, { x: 37, y: 15 }],
    points: [],
    naval: false,
  };
}

function newGame(map) {
  const g = createGame(map, ['Blue', 'Red'], false, [0, 1], [0, 1], { weather: false, supply: false });
  // These cost/cache fixtures supply complete known state. Room tests verify recipient authority.
  g.navigationObserved = true;
  g.worldNearWalls = new Uint8Array(g.w * g.h);
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
    for (let ny = Math.max(0, y - 1); ny <= Math.min(g.h - 1, y + 1); ny++) for (let nx = Math.max(0, x - 1); nx <= Math.min(g.w - 1, x + 1); nx++) {
      if ((g.flags[ny * g.w + nx] & (MOVE | SIGHT)) === (MOVE | SIGHT)) g.worldNearWalls[y * g.w + x] = 1;
    }
  }
  return g;
}

function rifle(g, x = 2, y = 15, ordinal = 0, type = 'rifle') {
  const u = [...g.units.values()].filter(unit => unit.owner === 0 && unit.type === 'rifle')[ordinal];
  assert.ok(u, `expected starting rifle ${ordinal}`);
  u.type = type;
  u.x = (x + 0.5) * CELL;
  u.z = (y + 0.5) * CELL;
  return u;
}

function route(g, u, x = 36, y = 15) {
  return findPath(g, u, { x: (x + 0.5) * CELL, z: (y + 0.5) * CELL }).map(p => [p.x, p.z]);
}

function hash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function expectRoute(label, actual, expected) {
  assert.equal(hash(actual), expected, `${label} route changed`);
}

function expectVehicleClear(g, from, points) {
  assert.ok(points.length, 'a vehicle has a reachable route');
  let at = from;
  for (const [x, z] of points) {
    const d = Math.hypot(x - at.x, z - at.z), rot = Math.atan2(z - at.z, x - at.x), n = Math.max(1, Math.ceil(d / 0.25));
    for (let i = 0; i <= n; i++) assert.ok(vehiclePositionClear(g, { x: at.x + (x - at.x) * i / n, z: at.z + (z - at.z) * i / n, rot }, UNITS[from.type], blockOf(UNITS[from.type])), 'the selected vehicle route leaves room for its hull');
    at = { x, z };
  }
}


{
  const map = mapWith();
  const rows = map.rows.map(row => [...row]);
  for (let y = 5; y < 25; y++) for (let x = 18; x < 22; x++) rows[y][x] = 'B';
  map.rows = rows.map(row => row.join(''));
  const g = newGame(map);
  const u = rifle(g, 3, 15);
  expectRoute('house block', route(g, u), routeOracle.house);
}

{
  const g = newGame(mapWith());
  const u = rifle(g, 3, 15);
  for (const c of [15 * W + 19, 14 * W + 19, 16 * W + 19, 15 * W + 20]) {
    g.chars[c] = 'N';
    g.mineSeen.set(c, 1);
  }
  expectRoute('known mine avoidance', route(g, u), routeOracle.mines);
}

{
  const map = mapWith();
  const rows = map.rows.map(row => [...row]);
  for (let y = 0; y < H; y++) for (let x = 12; x < 28; x++) rows[y][x] = 'D';
  for (let y = 0; y < H; y++) for (let x = 28; x < 30; x++) rows[y][x] = 'M';
  map.rows = rows.map(row => row.join(''));
  const g = newGame(map);
  const u = rifle(g, 3, 15, 0, 'tank');
  const selected = route(g, u);
  expectVehicleClear(g, u, selected);
  expectRoute('vehicle roads and mud', selected, routeOracle.roadMud);
}

{
  const map = mapWith('W');
  map.naval = true;
  const rows = map.rows.map(row => [...row]);
  for (let y = 12; y < 18; y++) for (let x = 18; x < 22; x++) rows[y][x] = '.';
  map.rows = rows.map(row => row.join(''));
  const g = newGame(map);
  const boat = rifle(g, 3, 15, 0, 'gunboat');
  expectRoute('naval water around land', route(g, boat), routeOracle.naval);
}

{
  const map = mapWith();
  const rows = Array.from({ length: H }, () => [...'0'.repeat(W)]);
  for (let y = 0; y < H; y++) for (let x = 18; x < 22; x++) rows[y][x] = '2';
  for (let x = 18; x < 22; x++) rows[3][x] = '1';
  map.heights = rows.map(row => row.join(''));
  const g = newGame(map);
  const u = rifle(g, 3, 15);
  expectRoute('elevation and cliffs', route(g, u), routeOracle.elevation);
}

{
  const map = mapWith();
  const rows = map.rows.map(row => [...row]);
  // Six-metre portals admit the tank footprint; the former two-metre holes could not.
  for (let y = 5; y < 25; y++) if (!(y >= 7 && y <= 9) && !(y >= 21 && y <= 23)) {
    for (let x = 18; x < 22; x++) rows[y][x] = 'B';
  }
  for (let y = 7; y <= 9; y++) for (let x = 12; x <= 27; x++) rows[y][x] = 'D';
  for (let y = 21; y <= 23; y++) for (let x = 12; x <= 27; x++) rows[y][x] = 'M';
  map.rows = rows.map(row => row.join(''));
  const g = newGame(map);
  const tank = rifle(g, 3, 15, 0, 'tank');
  const freshRoute = route(g, tank);
  expectVehicleClear(g, tank, freshRoute);
  expectRoute('fresh road', freshRoute, routeOracle.freshRoad);
  const roadCells = [...g.chars.keys()].filter(c => g.chars[c] === 'D');
  const mudCells = [...g.chars.keys()].filter(c => g.chars[c] === 'M');
  for (const c of roadCells) g.wear[c] = 1;
  for (const c of mudCells) g.wear[c] = 0;
  const wornRoute = route(g, tank);
  expectVehicleClear(g, tank, wornRoute);
  expectRoute('worn road and shallow mud', wornRoute, routeOracle.wornRoad);
  g.wx = { wet: 1 };
  const wetRoute = route(g, tank);
  expectVehicleClear(g, tank, wetRoute);
  assert.notDeepEqual(wetRoute, wornRoute, 'wet ground costs refresh after a prior search without a topology change');
  for (const c of roadCells) g.wear[c] = 0;
  const wetFreshRoute = route(g, tank);
  expectVehicleClear(g, tank, wetFreshRoute);
  expectRoute('fresh road in wet ground', wetFreshRoute, routeOracle.freshRoad);
}

{
  const g = newGame(mapWith());
  const u = rifle(g, 3, 15);
  expectRoute('bunker absent', route(g, u), routeOracle.bunkerBase);
  const bunker = { id: 999, type: 'bunker', hp: 3000, x: 41, z: 31, owner: 1 };
  g.units.set(bunker.id, bunker);
  expectRoute('bunker inserted on route', route(g, u), routeOracle.bunkerNear);
  bunker.x = 41;
  bunker.z = 7;
  expectRoute('bunker moved away', route(g, u), routeOracle.bunkerBase);
  bunker.z = 31;
  expectRoute('bunker moved back', route(g, u), routeOracle.bunkerNear);
  bunker.hp = 0;
  expectRoute('bunker destroyed', route(g, u), routeOracle.bunkerBase);
  bunker.hp = 3000;
  expectRoute('bunker restored', route(g, u), routeOracle.bunkerNear);
  g.units.delete(bunker.id);
  expectRoute('bunker removed', route(g, u), routeOracle.bunkerBase);
}

{
  const g = newGame(mapWith());
  const [first, second] = [...g.units.values()].filter(u => u.owner === 0 && u.type === 'rifle');
  const result = command(g, 0, { t: 'move', orders: [[first.id, 73, 31], [second.id, 73, 35]] });
  assert.equal(result, undefined, 'group move should be accepted');
  expectRoute('group move paths', [first.path.map(p => [p.x, p.z]), second.path.map(p => [p.x, p.z])], routeOracle.groupMove);
}

{
  const size = 512, N = size * size;
  const g = { w: size, h: size, chars: Array(N).fill('.'), flags: new Uint16Array(N).fill(1024), height: new Int8Array(N), wear: new Float32Array(N),
    worldKnown: true, navigationObserved: true, worldNearWalls: new Uint8Array(N), units: new Map(), mineSeen: new Map(), fires: new Map(), roads: false,
    infantryRegionVersion: 0, vehicleRegionVersion: 0, navalRegionVersion: 0, obstructionVersion: 0, navigationKnowledgeVersion: 0 };
  const to = { x: 995, z: 991 };
  for (const type of ['rifle', 'tank']) {
    const from = { type, x: 21, z: 21 }, samples = [];
    let peakExpansions = 0;
    for (let n = 0; n < 31; n++) {
      const previous = g.pathStats?.expansions ?? 0, start = performance.now(), points = findPath(g, from, to);
      const elapsed = performance.now() - start, expanded = g.pathStats.expansions - previous;
      assert.ok(points.length && Math.hypot(points.at(-1).x - from.x, points.at(-1).z - from.z) < 120, 'large-map hierarchy produces a bounded useful route leg');
      assert.ok(expanded <= 4096, 'a route leg stays within the fine-search expansion budget');
      peakExpansions = Math.max(peakExpansions, expanded);
      if (n) samples.push(elapsed);
    }
    samples.sort((a, b) => a - b);
    console.log(`512x512 ${type}: warm median ${samples[15].toFixed(2)} ms, p95 ${samples[28].toFixed(2)} ms, peak ${peakExpansions} expansions`);
  }
}
console.log('Passed 8 focused pathfinding scenarios and bounded large-map searches.');
