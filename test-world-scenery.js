// World Conquest scenery (shared/world-scenery.js): region looks, towns and landmarks dressed onto the seeded geography.
import assert from 'node:assert/strict';
import { check } from './test-check.js';
import { generateWorldMap } from './shared/world-conquest.js';
import { createGame, step, terrainFor, worldMapFor, validateMap } from './shared/sim.js';
import { BIOMES } from './shared/world-layers.js';

const seed = 20261008, dressed = generateWorldMap({ seed, players: 2 });

await check('World scenery keeps a seed\'s rivers, roads, regions, homes and names', () => {
  const bare = generateWorldMap({ seed, players: 2, scenery: false });
  assert.deepEqual(dressed.world.regions.map(({ biome, ...r }) => r), bare.world.regions, 'regions, homes and names');
  assert.deepEqual([dressed.spawns, dressed.heights, dressed.world.waterways, dressed.world.regionMap], [bare.spawns, bare.heights, bare.world.waterways, bare.world.regionMap]);
  for (let y = 0; y < bare.h; y++) for (let x = 0; x < bare.w; x++)
    if (bare.rows[y][x] !== dressed.rows[y][x]) assert.ok('.O'.includes(bare.rows[y][x]), `scenery only builds on open ground or woods (${x},${y})`);
});

await check('World scenery gives every region a biome and each kind its landmark', () => {
  assert.equal(validateMap(dressed), null);
  assert.ok(dressed.world.regions.every(r => BIOMES.includes(r.biome)), 'every region has a biome');
  const kindOf = { church: 'city', factory: 'industrial', 'mine head': 'resource' };
  for (const b of dressed.buildings) assert.equal(dressed.world.regions[dressed.world.regionMap[b.y * dressed.w + b.x]].kind, kindOf[b.kind], `${b.kind} stands in its own kind of region`);
  for (const kind of Object.keys(kindOf)) assert.ok(dressed.buildings.some(b => b.kind === kind), `the map has a ${kind}`);
});

await check('A World cell\'s biome and landmark reach a player only with the discovered cell', () => {
  const map = generateWorldMap({ seed, players: 2, teams: [0, 1] }), g = createGame(map, ['a', 'b'], false, [0, 1], [0, 1], { mode: 'world' });
  step(g);
  const rows = terrainFor(g, 0, true);
  assert.ok(rows.length && rows.every(row => row[4].biome === undefined || BIOMES[row[4].biome]), 'discovered cells carry a biome index');
  assert.ok(rows.some(row => row[4].biome !== undefined));
  const start = JSON.stringify(worldMapFor(g, 0));
  assert.ok(!start.includes('biome') && !start.includes('buildings'), 'the start map does not give looks or landmarks away');
  g.reveal = true; step(g);
  const landmarks = terrainFor(g, 0, true).filter(row => row[4].landmark);
  assert.deepEqual([...new Set(landmarks.map(row => row[4].landmark))].sort(), ['church', 'factory', 'mine head'], 'revealed landmarks carry their names');
});
