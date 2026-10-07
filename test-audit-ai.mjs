// Later World scouting must feed repair memory through the same detached view as all AI decisions.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createGame, step, damageCells } from './shared/sim.js';
import { generateWorldMap } from './shared/world-conquest.js';
import { observe, think } from './shared/ai.js';
import { viewFor } from './shared/ai-view.js';

const map = generateWorldMap({ seed: 42, players: 2 });
const bridge = map.world.waterways.crossings.find(crossing => crossing.type === '=');
const at = { x: (bridge.x + 0.5) * 2, z: (bridge.y + 0.5) * 2 };
function fixture() {
  const g = createGame(map, ['One', 'Two'], false, [0, 1], [0, 1], { mode: 'world', logistics: false, weather: 'clear' });
  g.players[0].mp = 10000;
  for (const u of g.units.values()) {
    Object.assign(u, { auto: false, autoRetreat: false, holdFire: true, holdPos: true });
    if (u.owner < 0 && Math.hypot(u.x - at.x, u.z - at.z) < 60) g.units.delete(u.id);
  }
  return g;
}
function destroy(g) {
  const rifle = [...g.units.values()].find(u => u.type === 'rifle' && u.owner === 0);
  Object.assign(rifle, { x: at.x - 25, z: at.z, path: [], orders: [], amove: null, attackId: 0, targetId: 0, dig: null, entrench: null });
  damageCells(g, [...g.units.values()], at, 3, 99999, 0); step(g);
}

await test('World AI repairs a bridge first discovered after its initial decision', () => {
  const g = fixture(), memory = {}, commands = [];
  const plan = () => think(g, 0, { view: viewFor(g, 0, memory), memory, submit: cmd => { commands.push(cmd); return 'blocked'; } });
  plan();
  assert.equal(memory.bridges.length, 0, 'hidden bridges are never learned from the authoritative map');
  g.reveal = true; plan();
  destroy(g); commands.length = 0; plan();
  assert.equal(commands.filter(cmd => cmd.t === 'dig' && cmd.kind === 'bridge').length, 1, 'later discovery must permit one repair order after destruction');
});

await test('World bridge seen on an observation beat is remembered before the next decision', () => {
  const g = fixture(), commands = [];
  const submit = cmd => { commands.push(cmd); return 'blocked'; };
  think(g, 0, { view: observe(g, 0), submit });
  assert.equal(commands.some(cmd => cmd.t === 'dig' && cmd.kind === 'bridge'), false, 'unknown bridges produce no repair order');
  g.reveal = true; observe(g, 0);
  destroy(g); commands.length = 0;
  think(g, 0, { view: observe(g, 0), submit });
  assert.equal(commands.filter(cmd => cmd.t === 'dig' && cmd.kind === 'bridge').length, 1, 'an intact observed bridge remains remembered if destroyed before thinking');
});
