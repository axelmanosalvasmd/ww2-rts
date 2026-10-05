// Opening preferences must use a completed delivered producer and ordinary paid input.
import assert from 'node:assert/strict';
import { createGame, command, step, snapshotCache, UNITS, placementCheck, priceOf } from './shared/sim.js';
import { observe } from './shared/ai.js';
import { perceive, startCamera } from './shared/ai-perception.js';
import { openingBuy } from './shared/ai-persona.js';
import { createHands, enqueueDecision, advanceHands, HUMAN_SKILLS } from './shared/ai-hands.js';

const map = { w: 80, h: 80, rows: Array(80).fill('.'.repeat(80)),
  spawns: [{ x: 10, y: 10 }, { x: 70, y: 70 }], points: [] };
function fixture(faction, barracks = 'absent') {
  const random = Math.random;
  let game;
  Math.random = () => .5;
  try { game = createGame(map, ['buyer', 'enemy'], false, [0, 1], [faction, 0],
    { mode: 'world', worldSeed: 1, weather: false, supply: false }); }
  finally { Math.random = random; }
  const own = [...game.units.values()].filter(u => u.owner === 0);
  const hq = own.find(u => u.type === 'hq'), engineer = own.find(u => u.type === 'engineer');
  assert.ok(hq?.built === 1 && engineer, 'actual World starts with a completed HQ and engineer');
  game.players[0].mp = 1000;
  let site;
  if (barracks !== 'absent') {
    const positions = [];
    for (let dx = -24; dx <= 24; dx += 4) for (let dz = -24; dz <= 24; dz += 4)
      if (Math.hypot(dx, dz) >= 12) positions.push({ x: hq.x + dx, z: hq.z + dz });
    const position = positions.find(at => placementCheck(game, { kind: 'barracks', ...at,
      team: game.players[0].team }).ok && command(game, 0, { t: 'build', ids: [engineer.id], kind: 'barracks', ...at }) === undefined);
    assert.ok(position, 'a legal authoritative build starts an actual barracks site');
    site = [...game.units.values()].find(u => u.owner === 0 && u.type === 'barracks');
    assert.equal(site.built, 0, 'unfinished control uses an actual construction site');
    if (barracks === 'finished') {
      for (let ticks = 0; site.built < 1 && ticks < 1600; ticks++) step(game);
      assert.equal(site.built, 1, 'simulation construction completes the producer');
    }
  }
  // Isolate building clicks from mobile overlap. This changes fixture positions, not selection or readiness.
  for (const unit of own.filter(u => !UNITS[u.type].structure)) {
    unit.x = hq.x + 70; unit.z = hq.z + 70;
    unit.path = []; unit.orders = []; unit.build = 0; unit.auto = false; unit.autoRetreat = false;
  }
  step(game);
  const inputs = [], sent = [], camera = startCamera(observe(game, 0, snapshotCache(game)), 0);
  const hands = createHands({ slot: 0, level: 'hard', seed: 27, camera, log: inputs, startedTick: game.tick });
  hands.openingUntil = 0; hands.openingDone = true;
  const state = { hands, camera, skill: hands.skill };
  const refresh = () => perceive(observe(game, 0, snapshotCache(game)), 0, state, game.tick);
  let view = refresh();
  assert.ok(view.screenIds.has(hq.id), 'the real camera can inspect its HQ');
  if (site) assert.ok(view.screenIds.has(site.id), 'the producer fixture is delivered in the actual screen tier');
  const trains = type => [...view.units.values()].some(u => u.owner === 0 && u.built >= 1
    && UNITS[u.type].makes?.includes(type));
  const selected = openingBuy({ persona: { opening: ['rifle'] }, buys: 0 }, view, 0, 'rifle', trains);
  const before = game.players[0].mp;
  const queued = enqueueDecision(hands, { t: 'buy', unit: selected }, view, { concern: 'production', concernKind: 'production' });
  if (queued) for (let ticks = 0; (hands.active || hands.queue.length) && ticks < 300; ticks++) {
    step(game); view = refresh();
    advanceHands(hands, game.tick, view, cmd => {
      const beforeMP = game.players[0].mp, price = priceOf(game, cmd.unit).mp;
      const result = command(game, 0, cmd);
      sent.push({ tick: game.tick, command: structuredClone(cmd), result, price, spentMP: beforeMP - game.players[0].mp }); return result;
    });
  }
  return { game, hq, site, selected, queued, inputs, sent, hands, before, view };
}
function acceptedPurchase(f, unit, producer) {
  assert.equal(f.selected, unit, 'the preference picks a trainable type');
  assert.equal(f.queued, true, 'ordinary hands find the delivered completed producer');
  assert.equal(f.sent.length, 1, 'one useful recruitment request issues one command');
  assert.equal(f.sent[0].result, undefined, 'authoritative engine accepts the physical purchase');
  assert.deepEqual(f.sent[0].command, { t: 'buy', unit, from: producer.id });
  assert.deepEqual(producer.queue, [unit], 'the actual producer queues the purchased unit');
  assert.equal(f.sent[0].spentMP, f.sent[0].price, 'accepted recruitment pays its exact authoritative price');
  assert.equal(f.inputs.filter(row => row.kind === 'select-click').length, 1, 'producer acquisition pays a real click');
  assert.equal(f.inputs.filter(row => row.command).length, 1, 'purchase uses one completed issuing input');
  assert.ok(f.inputs.every(row => row.motorTicks > 0 && row.tick >= row.inputStartedTick + row.motorTicks),
    'selection and purchase complete their ordinary positive motor durations');
  assert.deepEqual(f.hands.skill, HUMAN_SKILLS.hard, 'default timing and input caps remain unchanged');
  assert.equal(f.inputs.length, 2, 'no quota inputs or duplicate recruitment gestures are introduced');
}
const ussr = fixture(2);
acceptedPurchase(ussr, 'rifle', ussr.hq);
assert.equal(command(ussr.game, 0, { t: 'buy', unit: 'conscript', from: ussr.hq.id }), 'needs',
  'HQ-only negative control proves the rejected preferred substitute is actually unavailable');
const unfinished = fixture(2, 'unfinished');
acceptedPurchase(unfinished, 'rifle', unfinished.hq);
assert.ok(unfinished.site.built < 1, 'the negative producer remains unfinished throughout the input');
assert.equal(command(unfinished.game, 0, { t: 'buy', unit: 'conscript', from: unfinished.site.id }), 'needs',
  'a real unfinished barracks cannot produce conscripts');
const finished = fixture(2, 'finished');
acceptedPurchase(finished, 'conscript', finished.site);
for (const faction of [0, 1, 3]) {
  const other = fixture(faction);
  acceptedPurchase(other, 'rifle', other.hq);
  assert.deepEqual(other.inputs.map(row => ({ kind: row.kind, motorTicks: row.motorTicks, input: row.input })),
    ussr.inputs.map(row => ({ kind: row.kind, motorTicks: row.motorTicks, input: row.input })),
    'other factions retain the same ordinary rifle gesture and motor program');
}
console.log('Producer substitution: real World HQ, unfinished and completed barracks, factions, native motor and caps passed.');
