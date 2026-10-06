import assert from 'node:assert/strict';
import { createGame, command, step, terrainFor, snapshotFor, damageCells, damageWorldSection, mutateWorldCell, worldMaterial, validateMap, placementCheck, CELL, CFG, UNITS, FORTS, TERRAIN, ROAD, VBLOCK, findPath, TICK } from './shared/sim.js';
import { DEBRIS_LIMITS } from './shared/debris-motion.js';
import { migrateWorldMap, mapForClient } from './shared/world-layers.js';
import { clearFixtureUnits } from './test-fixtures.js';

const map = (n = 64) => ({ name: 'World contract', w: n, h: n, rows: Array(n).fill('.'.repeat(n)), spawns: [{ x: 2, y: 2 }, { x: n - 3, y: n - 3 }], points: [{ x: n >> 1, y: n >> 1 }] });
const write = (m, x, y, ch) => { m.rows[y] = m.rows[y].slice(0, x) + ch + m.rows[y].slice(x + 1); };
const make = (m, options = {}) => {
  const g = createGame(m, ['A', 'B'], false, [0, 1], [0, 1], { weather: false, supply: false, ...options });
  for (const u of g.units.values()) Object.assign(u, { holdFire: true, auto: false, autoRetreat: false });
  for (const p of g.players) p.mp = 5000;
  return g;
};
const at = (g, c) => ({ x: (c % g.w + 0.5) * CELL, z: (Math.floor(c / g.w) + 0.5) * CELL });
const ticks = (g, n) => { for (let i = 0; i < n; i++) step(g); };
const settleTicks = Math.ceil(DEBRIS_LIMITS.lifetime / TICK) + 2;

{
  const m = map(); write(m, 9, 9, 'N'); write(m, 10, 9, '='); write(m, 11, 9, 'R');
  const migrated = migrateWorldMap(m);
  assert.equal(migrated.worldVersion, 2);
  assert.equal(migrated.layers.ground[9].slice(9, 12), '.W.', 'legacy mine and rubble never invent roads');
  assert.equal(validateMap(migrated), null);
  assert.deepEqual(migrateWorldMap(migrated), migrated, 'migration is idempotent');
  const invalid = structuredClone(migrated); invalid.layers.ground[9] = 'D'.repeat(64);
  assert.match(validateMap(invalid), /composed/);
  const client = mapForClient(migrated);
  assert.equal(client.rows[9][9], '.'); assert.equal(client.layers.objects[9][9], '.');
}

{
  const m = map(); for (let x = 7; x < 13; x++) write(m, x, 10, 'D');
  const g = make(m), c = 10 * g.w + 9, crew = [...g.units.values()].find(u => u.owner === 0 && UNITS[u.type].infantry);
  Object.assign(crew, at(g, c), { type: 'engineer' });
  mutateWorldCell(g, c, { object: 'N' }); g.mines.set(c, 0);
  assert.equal(g.ground[c], 'D'); assert.ok(g.flags[c] & ROAD, 'a mine leaves the actual road movement intact');
  const hidden = terrainFor(g, 1, true);
  assert.ok(!hidden.some(row => row[0] === c), 'an undiscovered mine makes no terrain delta');
  const mp = g.players[0].mp;
  assert.equal(command(g, 0, { t: 'dig', ids: [crew.id], kind: 'demine', ...at(g, c), dir: 0 }), undefined);
  ticks(g, Math.ceil(CFG.digTime / 2 / (1 / 20)) + 4);
  assert.equal(g.chars[c], 'D', 'the paid Clear mines order restores the road');
  assert.equal(g.objects[c], '.'); assert.equal(g.ground[c], 'D'); assert.ok(!g.mines.has(c));
  assert.ok(g.players[0].mp >= mp - FORTS.demine.cost, 'only the normal order is charged');
}

{
  const m = map(); const cells = [8, 9, 10, 11, 12].map(x => 14 * m.w + x);
  for (let y = 0; y < m.h; y++) for (let x = 8; x <= 12; x++) write(m, x, y, 'W');
  for (const c of cells) write(m, c % m.w, 14, '=');
  m.structures = [{ id: 'span', kind: 'bridge', sections: cells.map((c, i) => ({ id: `s${i}`, c, hp: 200, material: 'stone', anchor: i === 0 || i === 4, supports: [i - 1, i + 1].filter(j => j >= 0 && j < cells.length).map(j => `s${j}`) })) }];
  assert.equal(validateMap(m), null);
  const g = make(m), own = [...g.units.values()].filter(u => u.owner === 0), failed = cells[2];
  Object.assign(own[0], at(g, failed)); Object.assign(own[1], at(g, cells[1]));
  damageWorldSection(g, failed, 500, { contactId: 'bridge-hit', direction: { x: 1, z: 0 } });
  assert.equal(g.chars[failed], 'W'); assert.equal(own[0].hp, 0, 'only failed deck occupants are lost');
  assert.ok(own[1].hp > 0); assert.equal(g.chars[cells[1]], '='); assert.equal(g.chars[cells[3]], '=', 'the far anchored deck survives');
  assert.equal(damageWorldSection(g, failed, 500, { contactId: 'bridge-hit' }), 0);
  const floating = placementCheck(g, { kind: 'bridge', x: 21, z: 75, dir: Math.PI / 2, team: 0 });
  assert.equal(floating.ok, false, 'a plan floating parallel to the banks is rejected');
  const reset = placementCheck(g, { kind: 'bridge', ...at(g, failed), dir: 0, team: 0 });
  assert.equal(reset.ok, true, 'a missing section attaches to surviving supported deck');
  const crew = own.find(u => u.hp > 0 && UNITS[u.type].infantry); Object.assign(crew, at(g, cells[1]), { type: 'engineer' });
  assert.equal(command(g, 0, { t: 'dig', ids: [crew.id], kind: 'bridge', ...at(g, failed), dir: 0 }), undefined);
  ticks(g, Math.ceil(CFG.digTime / 2 / (1 / 20)) + 4);
  assert.equal(g.chars[failed], '='); assert.equal(worldMaterial(g, failed).name, 'wood', 'paid replacement uses plank material');
  assert.equal(g.structuralCells.get(failed).maxHp, CFG.terrainHp['=']);
}

{
  const m = map(), cells = [8 * m.w + 8, 8 * m.w + 9, 9 * m.w + 9, 9 * m.w + 8];
  cells.forEach(c => write(m, c % m.w, Math.floor(c / m.w), 'B'));
  m.structures = [{ id: 'cycle', kind: 'house', sections: cells.map((c, i) => ({ id: `s${i}`, c, hp: 100, material: 'stone', anchor: i === 0, supports: [`s${(i + 1) % 4}`] })) }];
  assert.equal(validateMap(m), null);
  const unsupported = structuredClone(m); unsupported.structures[0].sections[0].anchor = false;
  assert.match(validateMap(unsupported), /path to an anchor/);
  const g = make(m);
  damageWorldSection(g, cells[0], 100, { contactId: 'anchor', direction: { x: 1, z: 0 } });
  assert.ok(cells.every(c => g.structuralCells.get(c).state === 'failed'), 'a disconnected support cycle cannot support itself');
  assert.ok(g.shots.filter(shot => shot.k === 'collapse').every(shot => shot.pub !== true), 'local collapse effects do not become public');
}

{
  const m = map(), c = 48 * m.w + 48; write(m, 48, 48, 'B'); write(m, 49, 48, 'D');
  const g = make(m), version = g.obstructionVersion ?? 0;
  damageWorldSection(g, c, 10000, { contactId: 'hidden-collapse', direction: { x: 1, z: 0 } });
  assert.equal(g.structuralCells.get(c).state, 'failed');
  assert.ok(snapshotFor(g, 0, g.shots, []).falling.length === 0, 'hidden moving debris is absent from snapshots');
  ticks(g, settleTicks);
  const footprint = [...g.structuralCells.get(c).rubble];
  assert.ok(footprint.length > 0 && footprint.every(cell => g.objects[cell] === 'R'), 'bounded debris creates a durable rubble footprint');
  assert.equal(g.chars[c + 1], 'R'); assert.equal(g.ground[c + 1], 'D');
  assert.ok(g.obstructionVersion > version);
  assert.ok(!snapshotFor(g, 0, g.shots, []).shots.some(shot => shot.k === 'collapse'), 'a hidden collapse is absent from snapshots');
  assert.ok(!terrainFor(g, 0, true).some(row => row[0] === c), 'a hidden settled obstacle waits for discovery');
  const scout = [...g.units.values()].find(u => u.owner === 0); Object.assign(scout, at(g, c - 2));
  g.visionTick = -1;
  const discovered = terrainFor(g, 0, true).find(row => row[0] === c);
  assert.equal(discovered[4].section.state, 'failed', 'reconnect carries durable failure rather than a replay');
  ticks(g, settleTicks);
  assert.equal(snapshotFor(g, 0, g.shots, []).falling.length, 0, 'expired falling state does not replay after reconnect');
  assert.equal(g.ground[c + 1], 'D');
  assert.deepEqual(g.structuralCells.get(c).rubble, footprint, 'reconnect cannot move the settled footprint');
}

{
  const m = map(), g = make(m, { mode: 'classic' });
  const crew = [...g.units.values()].find(u => u.owner === 0 && u.type === 'engineer');
  Object.assign(crew, { x: 20, z: 20 });
  assert.equal(command(g, 0, { t: 'build', ids: [crew.id], kind: 'barracks', x: 25, z: 25 }), undefined);
  const building = [...g.units.values()].find(u => u.owner === 0 && u.type === 'barracks');
  ticks(g, 650);
  assert.equal(building.built, 1); assert.ok(Math.abs(building.hp - UNITS.barracks.hpPer) < 0.001);
  assert.equal(command(g, 0, { t: 'buy', unit: 'mg', building: building.id }), undefined);
  const queue = [...building.queue], section = g.structures.get(building.structureId).sections[0], hp = building.hp;
  const hit = damageWorldSection(g, section.c, section.maxHp, { contactId: 'building-contact', owner: 1 });
  assert.ok(Math.abs(building.hp - (hp - hit)) < 0.001, 'section loss debits the existing health budget once');
  assert.equal(g.units.has(building.id), true); assert.deepEqual(building.queue, queue, 'a breach preserves the recruitment identity and queue');
  assert.equal(damageWorldSection(g, section.c, section.maxHp, { contactId: 'building-contact' }), 0);
  const mp = g.players[0].mp;
  assert.equal(command(g, 0, { t: 'assist', ids: [crew.id], id: building.id }), undefined);
  ticks(g, 2);
  assert.ok(section.hp > 0 && g.chars[section.c] === 'K', 'free Engineer repair restores a supported footprint section');
  assert.ok(g.players[0].mp >= mp, 'building repair charges no manpower');
  for (const s of g.structures.get(building.structureId).sections) damageWorldSection(g, s.c, Infinity, { contactId: `total:${s.id}` });
  ticks(g, 1); assert.equal(g.units.has(building.id), false, 'total failure runs normal entity destruction');
}

{
  const g = make(map()), c = 12 * g.w + 12;
  mutateWorldCell(g, c, { ground: 'D', object: 'N' }); g.mines.set(c, 0);
  assert.equal(worldMaterial(g, c, true).name, 'road');
  damageCells(g, [], at(g, c), 0, 80, 1);
  assert.equal(g.ground[c], 'D', 'a blast clears the mine and applies normal road damage');
  assert.ok(Math.abs(g.surfaceWear[c] - 0.4) < 0.001);
  damageCells(g, [], at(g, c), 0, 125);
  assert.equal(g.ground[c], '+', 'enough blast damage breaks the road beneath a mine');
  const h = g.height?.[c] ?? 0;
  assert.equal(mutateWorldCell(g, c, { ground: 'invalid', height: h - 1 }), false, 'invalid mutations fail before changing any layer');
  assert.equal(g.height?.[c] ?? 0, h);
}

{
  const m = map(), c = 20 * m.w + 20; write(m, 20, 20, 'B'); write(m, 21, 20, 'D');
  const g = make(m), vehicle = [...g.units.values()].find(u => u.owner === 0);
  Object.assign(vehicle, at(g, c + 1), { type: 'tank', hp: 400 });
  damageWorldSection(g, c, Infinity, { direction: { x: 1, z: 0 } });
  ticks(g, settleTicks);
  assert.equal(g.chars[c + 1], 'D', 'directional rubble respects the full live vehicle footprint');
  assert.equal(vehicle.hp, 400, 'debris contact cannot damage a live vehicle');
}

{
  const m = map(), cells = [20 * m.w + 20, 20 * m.w + 21];
  cells.forEach(c => write(m, c % m.w, 20, 'B'));
  m.structures = [{ id: 'burning', kind: 'house', sections: cells.map((c, i) => ({ id: `s${i}`, c, hp: 100, material: 'wood', anchor: i === 0, supports: [i ? 's0' : 's1'] })) }];
  const g = make(m); g.fires.set(cells[0], CFG.fire.burn.B);
  ticks(g, 100);
  assert.equal(g.structuralCells.get(cells[0]).state, 'burning');
  assert.ok(g.structuralCells.get(cells[0]).hp < 100 && g.structuralCells.get(cells[0]).hp > 0, 'fire causes progressive damage before failure');
  ticks(g, 450);
  assert.ok(cells.every(c => g.structuralCells.get(c).state === 'failed'), 'fire uses the same support failure path as shelling');
  assert.equal(g.fires.has(cells[0]), false);
  assert.equal(g.shots.filter(shot => shot.k === 'collapse').length, 2);
  ticks(g, 100);
  assert.equal(g.shots.filter(shot => shot.k === 'collapse').length, 2, 'support failure and later fire ticks resolve each collapse once');
}

{
  const m = map();
  for (let y = 30; y < 38; y++) for (let x = 20; x < 36; x++) write(m, x, y, 'B');
  const g = make(m); clearFixtureUnits(g); // only the test's own block counts, not the starting bases
  for (const section of g.structuralCells.values()) damageWorldSection(g, section.c, Infinity);
  assert.equal(g.fallingSections.length, DEBRIS_LIMITS.active, 'active falling state has a fixed server limit');
  assert.equal([...g.structuralCells.values()].filter(section => section.state === 'failed').length, 128, 'overflow retains all failures');
  ticks(g, settleTicks);
  assert.equal(g.fallingSections.length, 0);
  assert.ok([...g.structuralCells.values()].every(section => section.settledAt !== undefined), 'overflow and moving sections settle through the same bounded solver');
}


{
  const m = migrateWorldMap(map()), c = 10 * m.w + 9;
  const ground = m.layers.ground.map(row => [...row]), objects = m.layers.objects.map(row => [...row]);
  ground[10][9] = 'D'; objects[10][9] = 'R'; m.layers.ground = ground.map(row => row.join('')); m.layers.objects = objects.map(row => row.join('')); write(m, 9, 10, 'R');
  m.layers.groundMaterials = [{ c, material: 'concrete' }]; m.layers.objectMaterials = [{ c, material: 'stone' }];
  const g = make(m), crew = [...g.units.values()].find(u => u.owner === 0 && UNITS[u.type].infantry);
  Object.assign(crew, at(g, c), { type: 'engineer' });
  damageCells(g, [], at(g, c), 0, 120); const wear = g.wear[c], flags = g.flags[c], hp = g.cellHp[c];
  assert.equal(command(g, 0, { t: 'dig', ids: [crew.id], kind: 'mines', ...at(g, c), dir: 0 }), undefined);
  ticks(g, 270);
  assert.equal(g.mineLayer[c], 1); assert.equal(g.objects[c], 'R'); assert.equal(g.ground[c], 'D'); assert.equal(g.flags[c], flags); assert.ok(g.flags[c] & VBLOCK);
  assert.equal(g.cellHp[c], hp, 'mine placement leaves underlying obstacle health intact'); assert.equal(g.wear[c], wear, 'mine placement preserves previous road wear');
  const known = terrainFor(g, 0, true).find(row => row[0] === c); assert.equal(known[4].object, 'R'); assert.equal(known[4].material, 'stone'); assert.equal(known[4].groundMaterial, 'concrete');
  assert.equal(command(g, 0, { t: 'dig', ids: [crew.id], kind: 'demine', ...at(g, c), dir: 0 }), undefined); ticks(g, 270);
  assert.equal(g.mineLayer[c], 0); assert.equal(g.chars[c], 'R'); assert.equal(g.objects[c], 'R'); assert.equal(g.ground[c], 'D'); assert.equal(g.wear[c], wear); assert.equal(worldMaterial(g, c, true).name, 'concrete');
  damageCells(g, [], at(g, c), 0, 85); assert.equal(g.ground[c], '+', 'clearing a mine does not reset the road damage threshold'); assert.equal(g.objects[c], 'R');
}
{
  const m = migrateWorldMap(map()), c = 45 * m.w + 45;
  const ground = m.layers.ground.map(row => [...row]), objects = m.layers.objects.map(row => [...row]); ground[45][45] = 'D'; objects[45][45] = 'R'; m.layers.ground = ground.map(row => row.join('')); m.layers.objects = objects.map(row => row.join('')); write(m,45,45,'R');
  m.layers.objectMaterials = [{ c, material: 'concrete' }];
  const g = make(m), scout = [...g.units.values()].find(u => u.owner === 1 && UNITS[u.type].infantry); Object.assign(scout, at(g, c - 4));
  mutateWorldCell(g, c, { height: 1 }); const before = terrainFor(g, 1, true).find(row => row[0] === c);
  const pathBefore = findPath(g, { owner: 1, type: 'tank', ...at(g, c - 2) }, at(g, c + 2)), obstruction = g.obstructionVersion ?? 0;
  mutateWorldCell(g, c, { mine: true, material: 'steel' }); g.mines.set(c, 0);
  assert.deepEqual(terrainFor(g, 1, true).find(row => row[0] === c), before, 'hidden mine does not alter recipient cell metadata');
  assert.equal(g.obstructionVersion ?? 0, obstruction); assert.deepEqual(findPath(g, { owner: 1, type: 'tank', ...at(g, c - 2) }, at(g, c + 2)), pathBefore, 'hidden mine does not open a vehicle passage');
  mutateWorldCell(g, c, { mine: false });
  assert.equal(g.objects[c], 'R'); assert.equal(worldMaterial(g,c).name,'concrete');
}


{
  const g = make(map()), c = 3 * g.w + 3;
  // Keep the normal vision and cell delivery code, with a compact World memory fixture.
  g.mode = { kind: 'world' }; g.world = { memory: new Map() }; g.wear[c] = 0.1;
  const before = terrainFor(g, 0, true).find(row => row[0] === c);
  mutateWorldCell(g, c, { mine: true }); g.mines.set(c, 1);
  const after = terrainFor(g, 0, true).find(row => row[0] === c);
  assert.deepEqual(after, before, 'a hidden mine cannot synchronize stale wear into World metadata');
}


{
  const g = make(map()), c = 18 * g.w + 18;
  mutateWorldCell(g, c, { ground: 'D', object: 'Q', material: 'steel' });
  damageCells(g, [], at(g, c), 0, 30); const hp = g.cellHp[c], wear = g.wear[c];
  mutateWorldCell(g, c, { mine: true }); g.mines.set(c, 0);
  assert.equal(g.objects[c], 'Q'); assert.ok(g.flags[c] & VBLOCK); assert.equal(g.cellHp[c], hp);
  mutateWorldCell(g, c, { mine: false });
  assert.equal(g.chars[c], 'Q'); assert.equal(g.wear[c], wear); assert.equal(g.cellHp[c], hp, 'clearing a mine preserves damaged wreck health');
  mutateWorldCell(g, c, { mine: true });
  mutateWorldCell(g, c, { object: '.' });
  assert.equal(g.mineLayer[c], 1); assert.equal(g.chars[c], 'N'); assert.equal(g.objects[c], '.'); assert.ok(g.flags[c] & ROAD, 'wreck expiry reveals the road while preserving its separate mine');
  mutateWorldCell(g, c, { mine: false }); assert.equal(g.chars[c], 'D'); assert.equal(g.wear[c], wear);
}


{
  const g = make(map(), { mode: 'classic' }), engineer = [...g.units.values()].find(u => u.owner === 0 && u.type === 'engineer');
  Object.assign(engineer, { x: 71, z: 71 });
  assert.equal(command(g, 0, { t: 'build', ids: [engineer.id], kind: 'barracks', x: 71, z: 83 }), undefined);
  const first = [...g.units.values()].at(-1);
  assert.equal(command(g, 0, { t: 'build', ids: [engineer.id], kind: 'barracks', x: 91, z: 83, queue: true }), undefined);
  const second = [...g.units.values()].at(-1);
  for (let i = 0; i < 65 / TICK && engineer.build !== second.id; i++) step(g);
  assert.equal(first.built, 1); assert.equal(first.hp, UNITS.barracks.hpPer, 'fully repaired sections finish at the exact entity health maximum');
  assert.equal(engineer.build, second.id, 'fully repaired first building releases the Engineer to its queued site');
  ticks(g, 65 / TICK); assert.equal(second.built, 1); assert.equal(second.hp, UNITS.barracks.hpPer);
  first.hp -= 100;
  assert.equal(command(g, 0, { t: 'assist', ids: [engineer.id], id: first.id }), undefined);
  ticks(g, 35 / TICK);
  assert.equal(first.hp, UNITS.barracks.hpPer, 'the normal assist order also finishes at exact full health');
  assert.equal(engineer.build, 0, 'fully repaired assist ends without waiting on a rounding remainder');
}

console.log('PASS layered world, anchored sections, paid bridge rebuild, remembered destruction and shared building health');
