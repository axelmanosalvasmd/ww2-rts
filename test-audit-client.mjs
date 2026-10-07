// Regression contracts from the client bug audit. Node adapters execute the actual browser modules.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createGame, command, mutateWorldCell, placementCheck, snapshotFor, step, validateMap, terrainFor, worldMapFor, levelChar, UNITS } from './shared/sim.js';
import { fixtureCommand, clearFixtureUnits } from './test-fixtures.js';
import { generateWorldMap } from './shared/world-conquest.js';
import { migrateWorldMap, composeWorldCell } from './shared/world-layers.js';
import { placementState } from './client/availability.js';

const root = new URL('./', import.meta.url);
const source = readFileSync(new URL('./client/main.js', root), 'utf8');
const patchLevelSource = source.slice(source.indexOf('function setLevel(map,'), source.indexOf('\nfunction applyCells(', source.indexOf('function setLevel(map,')));
const patchLevelContext = vm.createContext({ levelChar });
vm.runInContext(patchLevelSource + '\nglobalThis.patchLevel = setLevel;', patchLevelContext);
const plainMap = () => ({ w: 40, h: 40, rows: Array(40).fill('.'.repeat(40)), heights: Array(40).fill('0'.repeat(40)), spawns: [{ x: 8, y: 8 }, { x: 32, y: 32 }], points: [] });
const cell = 20 * 40 + 20, order = { kind: 'fill', x: 41, z: 41, dir: 0 };
const gridOf = g => Array.from({ length: g.h }, (_, y) => g.chars.slice(y * g.w, (y + 1) * g.w));

function placementFixture() {
  const map = { w: 64, h: 64, rows: Array(64).fill('.'.repeat(64)), spawns: [{ x: 2, y: 2 }, { x: 60, y: 60 }], points: [] };
  const g = createGame(map, ['One', 'Two'], false, [0, 1], [0, 1], { weather: false, supply: false });
  clearFixtureUnits(g); g.players[0].mp = 10000; g.reveal = true;
  const put = (type, x, z) => {
    assert.equal(fixtureCommand(g, 0, { t: 'buy', unit: type }), undefined);
    const unit = [...g.units.values()].at(-1);
    Object.assign(unit, { x, z, auto: false, autoRetreat: false, holdPos: true });
    return unit;
  };
  return { map, g, put };
}

await test('B05 aircraft above an open footprint do not block the construction preview', () => {
  const { map, g, put } = placementFixture(), plane = put('fighter', 61, 61);
  plane.air.state = 'station';
  const order = { kind: 'barracks', x: 61, z: 61 };
  const client = placementState(snapshotFor(g, 0, []), structuredClone(map), gridOf(g), [0, 1]);
  assert.equal(placementCheck(g, order, () => true).ok, true, 'aircraft permit ground construction');
  assert.equal(placementCheck(client.game, order, () => true).ok, true, 'the detached preview agrees with the server');
});

await test('B05 a newly boarded passenger does not block its former ground footprint in the preview', () => {
  const { map, g, put } = placementFixture(), squad = put('rifle', 61, 61), carrier = put('halftrack', 65, 61);
  assert.equal(command(g, 0, { t: 'board', ids: [squad.id], target: carrier.id }), undefined);
  step(g);
  assert.equal(squad.riding, carrier.id, 'the squad has boarded before its coordinates follow the carrier');
  assert.equal(squad.x, 61);
  const order = { kind: 'barracks', x: 61, z: 61 };
  const client = placementState(snapshotFor(g, 0, []), structuredClone(map), gridOf(g), [0, 1]);
  assert.equal(placementCheck(g, order, () => true).ok, true, 'a passenger no longer occupies ground');
  assert.equal(placementCheck(client.game, order, () => true).ok, true, 'wire riding state prevents a transient false blockage');
});

await test('Fill in still restores open ground below its original elevation after partial filling', () => {
  const map = plainMap(), g = createGame(map, ['One', 'Two'], false, [0, 1], [0, 1], { mode: 'classic', weather: 'clear' });
  g.reveal = true;
  const displayed = structuredClone(map);
  placementState(snapshotFor(g, 0, []), displayed, gridOf(g), [0, 1]);
  mutateWorldCell(g, cell, { ground: '.', object: '.', height: -1 });
  patchLevelContext.patchLevel(displayed, cell, -1);
  const client = placementState(snapshotFor(g, 0, []), displayed, gridOf(g), [0, 1]);
  assert.equal(placementCheck(g, order, () => true).ok, true, 'authoritative restoration is legal');
  assert.equal(placementCheck(client.game, order, () => true).ok, true, 'the preview must offer the legal restoration');
  assert.equal(client.game.initialTerrain.height[cell], 0, 'live height patches retain the authored height');
});

await test('World reconnect restores a flooded crater using only delivered original terrain facts', () => {
  const map = plainMap(), g = createGame(map, ['One', 'Two'], false, [0, 1], [0, 1], { mode: 'classic', weather: 'clear' });
  g.reveal = true;
  mutateWorldCell(g, cell, { ground: 'F', object: '.', height: -1 });
  const displayed = plainMap(); displayed.world = { total: 64 };
  displayed.rows[20] = displayed.rows[20].slice(0, 20) + 'F' + displayed.rows[20].slice(21);
  patchLevelContext.patchLevel(displayed, cell, -1);
  const snap = snapshotFor(g, 0, []);
  snap.cells = [[cell, 'F', -1, 0, { ground: 'F', object: '.', initial: ['.', 0] }]];
  const client = placementState(snap, displayed, gridOf(g), [0, 1]);
  assert.equal(placementCheck(client.game, order, () => true).ok, true, 'reconnecting after flooding must preserve Fill in');
  assert.equal(client.game.initialTerrain.chars[cell], '.');
  assert.equal(client.game.initialTerrain.height[cell], 0);
  assert.equal(client.game.initialTerrain.chars[0], '?', 'unknown cells do not inherit invented authored ground');
  assert.equal(client.game.initialTerrain.height[0], 0, 'unknown cells have no authored elevation disclosure');
  // Repeated updates cannot turn a restored crater into an authored ford.
  snap.cells[0][4].initial = undefined;
  const retained = placementState(snap, displayed, gridOf(g), [0, 1]);
  assert.equal(retained.game.initialTerrain.chars[cell], '.');
  // An actual authored ford remains outside Fill in.
  const fordMap = structuredClone(displayed), ford = placementState({ ...snap, cells: [[cell, 'F', -1, 0, { ground: 'F', object: '.', initial: ['F', -1] }]] }, fordMap, gridOf(g), [0, 1]);
  assert.equal(placementCheck(ford.game, order, () => true).ok, false, 'natural fords must stay water');
});

await test('real World reconnect metadata restores crater previews without revealing undiscovered cells or authored mines', () => {
  const map = migrateWorldMap(generateWorldMap({ seed: 42, players: 2 })), spawn = map.spawns[0];
  const mineX = spawn.x + 12, mineY = spawn.y + 2, mineCell = mineY * map.w + mineX, mineSurface = composeWorldCell(map.layers.ground[mineY][mineX], map.layers.objects[mineY][mineX]);
  map.rows[mineY] = map.rows[mineY].slice(0, mineX) + 'N' + map.rows[mineY].slice(mineX + 1);
  map.layers.mines[mineY] = map.layers.mines[mineY].slice(0, mineX) + 'N' + map.layers.mines[mineY].slice(mineX + 1);
  const g = createGame(map, ['One', 'Two'], false, [0, 1], [0, 1], { mode: 'world', logistics: false, weather: 'clear' });
  const rows = terrainFor(g, 0, true), known = new Set(rows.map(row => row[0]));
  const originalMine = rows.find(row => row[0] === mineCell);
  assert.ok(originalMine, 'the authored mine sits in delivered terrain');
  assert.equal(originalMine[1], mineSurface, 'terrain conceals the authored mine before detection');
  assert.deepEqual(originalMine[4].initial, [mineSurface, g.initialTerrain.height[mineCell]], 'original facts also conceal the authored mine');
  const target = rows.find(([c, ch]) => ch === '.' && g.initialTerrain.chars[c] === '.' && g.height[c] === 0 && c !== mineCell);
  assert.ok(target, 'fixture has discovered dry open ground');
  const c = target[0], x = (c % g.w + 0.5) * 2, z = (Math.floor(c / g.w) + 0.5) * 2;
  mutateWorldCell(g, c, { ground: 'F', object: '.', height: -1 });
  const reconnectMap = worldMapFor(g, 0), delivered = terrainFor(g, 0, true), current = delivered.find(row => row[0] === c);
  assert.equal(current[1], 'F');
  assert.deepEqual(current[4].initial, ['.', 0], 'current flooded terrain retains the actual dry baseline');
  const snap = snapshotFor(g, 0, []); snap.cells = delivered;
  const preview = placementState(snap, reconnectMap, reconnectMap.rows.map(row => [...row]), [0, 1]);
  assert.equal(placementCheck(g, { kind: 'fill', x, z, dir: 0 }, () => true).ok, true);
  assert.equal(placementCheck(preview.game, { kind: 'fill', x, z, dir: 0 }, () => true).ok, true, 'real reconnect rows preserve the legal Fill in preview');
  const secret = g.initialTerrain.height.findIndex((level, cell) => level > 0 && !known.has(cell));
  assert.ok(secret >= 0, 'fixture has an undiscovered elevated cell');
  assert.equal(delivered.some(row => row[0] === secret), false, 'no original metadata is sent for unknown cells');
  assert.equal(reconnectMap.rows[Math.floor(secret / g.w)][secret % g.w], '.');
  assert.equal(reconnectMap.heights[Math.floor(secret / g.w)][secret % g.w], '0');
  assert.equal(preview.game.initialTerrain.chars[secret], '?');
  assert.equal(preview.game.initialTerrain.height[secret], 0);
  assert.equal(reconnectMap.world.seed, undefined);
  assert.equal(reconnectMap.world.regionMap, undefined);
});

class Element {
  constructor() { this.children = []; this.style = {}; this.attrs = {}; this.dataset = {}; this.events = {}; this.hidden = false; this.textContent = ''; this.classList = { toggle() {} }; }
  append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } }
  prepend(child) { child.parent = this; this.children.unshift(child); }
  insertBefore(child, before) { child.parent = this; const i = this.children.indexOf(before); if (i < 0) this.children.push(child); else this.children.splice(i, 0, child); }
  get nextSibling() { return this.parent?.children[this.parent.children.indexOf(this) + 1] ?? null; }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
  setAttribute(key, value) { this.attrs[key] = value; }
  addEventListener(key, fn) { this.events[key] = fn; }
  getBoundingClientRect() { return { width: 200, right: 1000, top: 500, bottom: 100 }; }
}
const boxes = Object.fromEntries(['alerts', 'minimap', 'top', 'hud'].map(id => [id, new Element()]));
Object.assign(globalThis, { document: { documentElement: { lang: 'en' }, head: new Element(), querySelector() { return null; }, getElementById: id => boxes[id] ?? null, createElement: () => new Element() }, performance: { now: () => 0 }, addEventListener() {}, innerWidth: 1200, innerHeight: 800 });
async function browserModule(path) {
  const code = readFileSync(new URL(path, root), 'utf8').replace(/from '([^']+)'/g, (_, dependency) => `from '${dependency === 'three' ? import.meta.resolve('three') : dependency.startsWith('/shared/') ? new URL('.' + dependency, root) : new URL(dependency, new URL(path, root))}'`);
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
}
const missionMap = () => ({ name: 'mission', w: 24, h: 24, rows: Array(24).fill('.'.repeat(24)), spawns: [{ x: 2, y: 2 }, { x: 21, y: 21 }], points: [{ x: 12, y: 12 }] });
const scenario = (map, actions, objectives = []) => {
  map.scenario = { version: 1, areas: [], groups: [], objectives, triggers: [{ id: 'opening', scope: 'match', recipients: 'side', side: 0, condition: { kind: 'time', seconds: 0 }, actions, repeat: { mode: 'once' } }] };
  assert.equal(validateMap(map), null);
  const g = createGame(map, ['One', 'Two'], false, [0, 1], [0, 1], { weather: false, supply: false });
  step(g); step(g); return g;
};

await test('first-snapshot announcements appear once and reconnect does not replay delivered events', async () => {
  const { audio } = await import('./client/audio.js'); audio.alert = () => {};
  const { alerts } = await browserModule('client/alerts.js');
  alerts.init({ me: () => 0, friend: slot => slot === 0, jump() {}, pointPos: () => ({ x: 24, z: 24 }), onScreen: () => false, home: () => ({ x: 4, z: 4 }), unitName: type => UNITS[type].name });
  alerts.startMatch('audit-announcement');
  const g = scenario(missionMap(), [{ kind: 'say', text: { en: 'Opening orders' }, recipients: 'side', side: 0 }]), first = snapshotFor(g, 0, g.shots);
  assert.equal(first.shots.some(shot => shot.text === 'Opening orders'), true);
  alerts.snapshot(first, null);
  assert.deepEqual(alerts.lines, ['Opening orders'], 'direct announcements need no comparison baseline');
  assert.deepEqual(alerts.history.map(entry => entry.text), ['Opening orders']);
  alerts.snapshot(first, null);
  alerts.startMatch('audit-announcement'); alerts.snapshot(first, null);
  assert.equal(alerts.history.length, 1, 'same tick and same-match reconnect cannot repeat an event');
  alerts.snapshot({ ...first, tick: 4, shots: [{ k: 'say', text: 'New reconnect orders' }] }, null);
  assert.deepEqual(alerts.history.map(entry => entry.text), ['New reconnect orders', 'Opening orders'], 'a new reconnect event is delivered');
});

await test('reconnect and replay reveal unchanged active objectives and tutorial goals', async () => {
  const { createObjectives } = await browserModule('client/objectives.js');
  const objectives = createObjectives({ points: () => [], units: new Map(), hAt: () => 0 }); objectives.init();
  const g = scenario(missionMap(), [{ kind: 'objectiveActivate', objective: 'hold' }], [{ id: 'hold', text: { en: 'Hold the gate' }, recipients: 'side', side: 0 }]);
  const snap = snapshotFor(g, 0, []), goal = boxes.hud.children.find(child => child.id === 'objective-goal');
  objectives.snapshot(snap); assert.equal(goal.hidden, false);
  for (const source of ['same-match reconnect', 'same mission replay']) {
    objectives.reset(); objectives.snapshot(snap);
    assert.equal(goal.hidden, false, source + ' must display the still-active objective');
  }
  const tutorial = { ...snap, mode: { kind: 'tutorial', goal: 'Select your squad' }, scenario: undefined };
  objectives.snapshot(tutorial); objectives.reset(); objectives.snapshot(tutorial);
  assert.equal(goal.hidden, false, 'unchanged tutorial goal is restored');
  objectives.snapshot({ ...tutorial, mode: { kind: 'classic' } });
  assert.equal(goal.hidden, true, 'a match without a goal clears the panel');
});
