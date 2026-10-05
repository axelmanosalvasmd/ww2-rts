import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const candidatePath = process.env.WW2_TERRAIN_MAIN ?? new URL('./client/main.js', import.meta.url);
const candidate = fs.readFileSync(candidatePath, 'utf8');
function functionSource(source, name) {
  const from = source.indexOf(`function ${name}(`);
  assert.ok(from >= 0, `${name} exists`);
  const lineEnd = source.indexOf('\n', from);
  const firstLine = source.slice(from, lineEnd);
  if (firstLine.endsWith(' }')) return firstLine;
  const to = source.indexOf('\n}', from);
  assert.ok(to > from);
  return source.slice(from, to + 2);
}
function harness(source) {
  const calls = [], terrain = {
    group: {}, physicalGrid: [['.', '.']], groundGrid: [['g', 'g']], objectGrid: [['.', 'W']],
    state: new Uint8Array(2), mineGrid: [[0, 1]],
  };
  const ctx = vm.createContext({
    calls, terrain, lastStart: { map: { rows: ['.N'], buildings: [], world: true } },
    buildPieces: (...args) => calls.push(['pieces', args]), composeWorldCell: (g, o) => g + o,
    hAt() {}, rubbleDecals: { update() {} }, props: { dispose: () => calls.push(['disposeProps']) },
    createProps: args => { calls.push(['props', args]); return {}; },
    world: {}, mmImage: {}, mapView: { refresh: () => calls.push(['minimap']) },
    matchMemory: { clear() {} }, menuOpen() {}, $: () => ({ classList: { add() {} } }),
    receivePause() {}, audio: { end() {} }, epilogue: { reset() {} }, lobby: true,
  });
  const reset = source.includes('function clearTerrainDue(') ? functionSource(source, 'clearTerrainDue') : '';
  vm.runInContext(`const terrainDue = { pieces: false, minimap: false, props: false, wait: 0 };\n${reset}\n${functionSource(source, 'terrainFrame')}\n${functionSource(source, 'buildStructures')}\nglobalThis.pending = terrainDue;`, ctx);
  return { ctx, calls, run: code => vm.runInContext(code, ctx),
    enterLobby: () => vm.runInContext(source.match(/  if \(lobby\) \{ lastStart = null;.*|  if \(lobby\) \{ clearTerrainDue\(\); lastStart = null;.*/)[0], ctx),
  };
}
const h = harness(candidate);
// Delivered edits still rebuild structures, world props and minimap before a transition.
h.run('pending.pieces = pending.props = pending.minimap = true; terrainFrame(0.05);');
assert.equal(h.calls.filter(c => c[0] === 'pieces').length, 1);
assert.deepEqual(Array.from(h.calls[0][1][2]), ['.gW']);
assert.equal(h.calls.filter(c => c[0] === 'props').length, 1);
assert.equal(h.calls.filter(c => c[0] === 'minimap').length, 1);
assert.equal(h.ctx.pending.wait, 0.25);
// End arrives before a throttled frame flush. Lobby must discard old-match work.
h.run('pending.pieces = pending.props = pending.minimap = true; pending.wait = 0.2;');
h.enterLobby();
assert.equal(h.ctx.lastStart, null);
assert.equal(h.ctx.pending.wait, 0);
for (let n = 0; n < 30; n++) h.run('terrainFrame(0.05);');
assert.equal(h.calls.filter(c => c[0] === 'pieces').length, 1);
assert.equal(h.ctx.pending.pieces, false);
// New start clears stale work too, before map/terrain construction; later edits remain live.
assert.match(candidate, /function startGame\(m, restored = null\) \{\n  clearTerrainDue\(\);/);
h.run('pending.pieces = pending.props = pending.minimap = true; pending.wait = 10; clearTerrainDue(); lastStart = { map: { rows: [".."], buildings: [], world: false } }; terrainFrame(0.05);');
assert.equal(h.calls.filter(c => c[0] === 'pieces').length, 1);
h.run('pending.pieces = pending.minimap = true; terrainFrame(0.05);');
assert.equal(h.calls.filter(c => c[0] === 'pieces').length, 2);
assert.deepEqual(Array.from(h.calls.findLast(c => c[0] === 'pieces')[1][2]), ['..']);
assert.equal(h.calls.filter(c => c[0] === 'minimap').length, 2);
// The causal control always runs. Remove only the two lifecycle calls from this source.
const original = candidate.replace('if (lobby) { clearTerrainDue(); lastStart = null;', 'if (lobby) { lastStart = null;')
  .replace('function startGame(m, restored = null) {\n  clearTerrainDue();', 'function startGame(m, restored = null) {');
const old = harness(original);
old.run('pending.pieces = true;'); old.enterLobby();
assert.throws(() => old.run('terrainFrame(0.05);'), /Cannot read properties of null \(reading 'map'\)/);
assert.equal(old.ctx.pending.pieces, true, 'throw prevented reset and repeats every frame');
console.log('Client terrain End/lobby/restart transitions PASS (real source functions, mandatory old failure control)');
