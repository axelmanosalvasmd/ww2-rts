import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createGame, findPath, command, CELL } from './shared/sim.js';

// Route hashes captured with shared/sim.js at 66a3734240d98d32d4c5ecd471bd7a1bbbc63336.
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
  freshRoad: 'b95e1eb0edccad101563a41457fda2ef792b2b7fbfc22aa3d472c675469202dd',
  wornRoad: '8b9335ad1d7778398e189c3bcd47ab28f00f318cc2a19e7fcd53f2728a23ec74',
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
  return createGame(map, ['Blue', 'Red'], false, [0, 1], [0, 1], { weather: false, supply: false });
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
  expectRoute('vehicle roads and mud', route(g, u), routeOracle.roadMud);
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
  for (let y = 5; y < 25; y++) if (y !== 8 && y !== 22) {
    for (let x = 18; x < 22; x++) rows[y][x] = 'B';
  }
  for (let x = 12; x <= 27; x++) rows[8][x] = 'D';
  for (let x = 12; x <= 27; x++) rows[22][x] = 'M';
  map.rows = rows.map(row => row.join(''));
  const g = newGame(map);
  const tank = rifle(g, 3, 15, 0, 'tank');
  expectRoute('fresh road', route(g, tank), routeOracle.freshRoad);
  const roadCells = [...g.chars.keys()].filter(c => g.chars[c] === 'D');
  const mudCells = [...g.chars.keys()].filter(c => g.chars[c] === 'M');
  for (const c of roadCells) g.wear[c] = 1;
  for (const c of mudCells) g.wear[c] = 0;
  expectRoute('worn road and shallow mud', route(g, tank), routeOracle.wornRoad);
  g.wx = { wet: 1 };
  expectRoute('wet road and mud after prior search', route(g, tank), routeOracle.freshRoad);
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

console.log('Passed 8 focused pathfinding scenarios.');
