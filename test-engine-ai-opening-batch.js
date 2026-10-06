// Opening batches buy their intended mix, while only native receipts advance the persistent count.
import assert from 'node:assert/strict';
import { createGame, command, step, priceOf } from './shared/sim.js';
import { think } from './shared/ai.js';
import { viewFor } from './shared/ai-view.js';

const map = { w: 80, h: 80, rows: Array(80).fill('.'.repeat(80)),
  spawns: [{ x: 25, y: 40 }, { x: 75, y: 40 }], points: [] };

function purchases({ level = 'hard', count = 3, refused = false, refuseRifleOnce = false, completed = false, classic = false } = {}) {
  const game = createGame(map, ['AI', 'enemy'], false, [0, 1], [0, 1],
    { weather: false, ...(classic ? { mode: 'classic' } : {}) });
  if (classic) for (const unit of [...game.units.values()])
    if (unit.owner === 0 && unit.type === 'engineer') game.units.delete(unit.id);
  game.players[0].mp = 5000;
  const initialCount = completed ? 3 : 0;
  const memory = { human: { startedTick: 0, buys: initialCount,
    persona: { family: 'armour', opening: ['mg', 'rifle', 'at'], economy: 'motorpool', pressure: 1 } } };
  const projection = {}, inputs = [], receipts = [];
  let delivered, rifleRefused = false;
  for (let ticks = 0; ticks < 800 && receipts.length < count; ticks++) {
    step(game);
    if (!delivered || game.tick % 2 === 0) delivered = viewFor(game, 0, projection);
    think(game, 0, { memory, view: delivered, level, seed: 12,
      inputLog: input => inputs.push(structuredClone(input)), submit: cmd => {
        // Author a real budget loss after planning, before the paid purchase reaches command().
        const resources = game.players[0].mp;
        const once = refuseRifleOnce && !rifleRefused && cmd.t === 'buy' && cmd.unit === 'rifle';
        if (once || refused && cmd.t === 'buy') game.players[0].mp = 0;
        const before = game.players[0].mp, ids = new Set(game.units.keys());
        const result = command(game, 0, cmd);
        if (cmd.t === 'buy') receipts.push({ tick: game.tick, unit: cmd.unit,
          accepted: result === undefined, reason: result, spent: before - game.players[0].mp,
          price: priceOf(game, cmd.unit).mp,
          created: [...game.units.values()].filter(unit => !ids.has(unit.id)),
          producer: cmd.from == null ? null : game.units.get(cmd.from) });
        if (once) { game.players[0].mp = resources; rifleRefused = true; }
        return result;
      } });
    assert.equal(memory.human.buys, initialCount + receipts.filter(row => row.accepted).length,
      'only accepted native purchase receipts advance the persistent opening count');
  }
  assert.equal(receipts.length, count, 'the scene actually completes the requested paid purchase inputs');
  const clicks = inputs.filter(input => input.command?.t === 'buy');
  assert.equal(clicks.length, count, 'every purchase attempt pays for its own physical production click');
  assert.ok(clicks.every(input => input.tick >= input.inputStartedTick + input.motorTicks),
    'purchase clicks complete their full ordinary motor duration');
  for (const receipt of receipts) if (receipt.accepted) {
    assert.equal(receipt.spent, receipt.price, 'native purchases pay the ordinary unit price');
    if (classic) assert.ok(receipt.producer?.queue.includes(receipt.unit),
      'the native Classic producer contains the accepted queued unit');
    else {
      assert.equal(receipt.created.length, 1, 'each native Conquest purchase creates one real unit');
      assert.equal(receipt.created[0].type, receipt.unit, 'the new unit has the requested type');
    }
  }
  return { receipts, clicks, memory };
}

for (const [level, expected] of [['normal', ['mg', 'rifle']], ['hard', ['mg', 'rifle', 'at']]]) {
  const result = purchases({ level, count: expected.length });
  assert.deepEqual(result.receipts.map(row => row.unit), expected,
    `${level} executes the opening family in order within an affordable batch`);
  assert.ok(result.receipts.every(row => row.accepted), 'every varied opening purchase is accepted natively');
  assert.equal(new Set(result.clicks.map(input => input.cycle)).size, 1,
    'the varied purchases complete in the same attended production cycle');
}

const refusal = purchases({ refused: true, count: 1 });
assert.ok(refusal.receipts.every(row => !row.accepted && row.reason === 'mp' && row.spent === 0),
  'the native budget loss refuses every pending purchase without spending');
assert.equal(refusal.memory.human.buys, 0, 'refused physical purchases leave the opening count unchanged');

const ordinary = purchases({ completed: true, count: 1 });
assert.equal(ordinary.receipts[0].unit, 'ranger',
  'after the family ends, the ordinary USA purchase replaces the exhausted preference');
assert.equal(ordinary.receipts[0].accepted, true, 'the ordinary purchase is actually accepted');

const engineer = purchases({ classic: true, count: 1 });
assert.equal(engineer.receipts[0].unit, 'engineer',
  'a real Classic engineer shortage takes priority over an available persona purchase');
assert.equal(engineer.receipts[0].accepted, true, 'the Classic engineer purchase is actually queued');

const partial = purchases({ refuseRifleOnce: true, count: 4 });
assert.deepEqual(partial.receipts.filter(row => row.accepted).map(row => row.unit), ['mg', 'rifle', 'at'],
  'a refused family member is retried before later queued family members can be accepted');
assert.ok(partial.receipts.some(row => row.unit === 'rifle' && !row.accepted && row.reason === 'mp'),
  'the partial-refusal control contains an actual native manpower rejection');

console.log('Native varied opening batches, refused receipts, completed families and Classic engineer priority passed.');
