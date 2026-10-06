import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGame, command, step } from './shared/sim.js';
import { viewFor } from './shared/ai-view.js';
import { perceive } from './shared/ai-perception.js';
import * as current from './shared/ai-hands.js';

const sourceURL = new URL('./shared/ai-hands.js', import.meta.url);
const source = readFileSync(sourceURL, 'utf8');
const condition = '\n          && boxSelectionFaster(box, job.units, hands, view)';
assert.equal(source.split(condition).length, 2, 'the control removes only the new gesture choice');
const baselineSource = source.replace(condition, '').replace(/from (['"])(\.[^'"]+)\1/g,
  (_match, quote, path) => `from ${quote}${new URL(path, sourceURL).href}${quote}`);
const original = await import(`data:text/javascript;base64,${Buffer.from(baselineSource).toString('base64')}`);

function scene(api, level, route, seed = 1) {
  const prior = Math.random; Math.random = () => .5;
  let game;
  try {
    game = createGame({ w: 80, h: 80, rows: Array(80).fill('.'.repeat(80)),
      spawns: [{ x: 5, y: 5 }, { x: 75, y: 75 }], points: [] }, ['own', 'enemy'],
    false, [0, 1], [0, 1], { weather: false });
  } finally { Math.random = prior; }
  game.units.clear(); game.players.forEach(player => { player.mp = 5000; });
  for (const type of ['rifle', 'mg']) assert.equal(command(game, 0, { t: 'buy', unit: type }), undefined);
  const own = [...game.units.values()];
  own.forEach((unit, i) => Object.assign(unit, { x: route === 'box' ? i ? 68 : 92 : 78 + i * 4,
    z: route === 'box' ? 68 : 79, holdFire: true, auto: false }));
  assert.equal(command(game, 1, { t: 'buy', unit: 'rifle' }), undefined);
  const enemy = [...game.units.values()].at(-1);
  Object.assign(enemy, { x: 94, z: 79, holdFire: true, auto: false });
  game.players[0].mp = 0; step(game); game.tick = 240;
  const camera = { x: 80, z: 80, yaw: 0, distance: 60 }, inputs = [], receipts = [];
  const hands = api.createHands({ slot: 0, level, seed, camera, startedTick: game.tick, log: inputs });
  hands.openingUntil = game.tick; hands.openingDeadline = game.tick; hands.openingDone = true;
  const state = { camera, hands }, delivered = () => perceive(viewFor(game, 0, {}), 0, state);
  let view = delivered();
  if (route === 'box') {
    const at = api.projectPointer(own[1], camera, view, { elevation: 1 });
    Object.assign(hands.pointer, { x: at.x - 2, y: at.y - 2,
      fromX: at.x - 2, fromY: at.y - 2, toX: at.x - 2, toY: at.y - 2 });
  }
  const created = game.tick, event = view.events.find(event => event.kind === 'screen-contact' && event.targetId === enemy.id);
  assert.ok(event?.onScreen && event.observedDanger.idleOwnUnits.length === 2,
    'both real idle actors witness the native public contact');
  assert.ok(api.enqueueDecision(hands, { t: 'stance', ids: own.map(unit => unit.id), key: 'holdFire', on: false },
    view, { concern: 'combat', event, eventTick: created, reactionStartTick: created }));
  for (let tick = 0; tick < 300 && !receipts.length; tick++) {
    view = delivered();
    api.advanceHands(hands, game.tick, view, cmd => {
      const result = command(game, 0, cmd);
      receipts.push({ tick: game.tick, command: structuredClone(cmd), result: result ?? null,
        selected: [...hands.selected] });
      return result;
    });
    step(game);
  }
  assert.equal(receipts.length, 1); assert.equal(receipts[0].result, null);
  assert.deepEqual(new Set(receipts[0].selected), new Set(own.map(unit => unit.id)));
  assert.ok(own.every(unit => unit.holdFire === false), 'the paid native stance reaches both actual actors');
  assert.ok(inputs.every(input => input.tick - created >= 4), 'every response retains the causal floor');
  assert.ok(inputs.every(input => input.tick - input.inputStartedTick === input.motorTicks),
    'each gesture pays its complete motor duration');
  return { inputs, receipt: receipts[0], created };
}

for (const level of ['easy', 'normal', 'hard']) {
  const before = scene(original, level, 'click'), after = scene(current, level, 'click');
  assert.equal(before.inputs[0].kind, 'select-box');
  assert.deepEqual(after.inputs.slice(0, 2).map(input => input.kind), ['select-click', 'select-add-click']);
  assert.equal(after.inputs[0].input.shift, false); assert.equal(after.inputs[1].input.shift, true);
  assert.deepEqual(after.receipt.command, before.receipt.command, 'both routes deliver the same complete native command');
  const selectionMotor = result => result.inputs.filter(input => input.kind.startsWith('select-'))
    .reduce((total, input) => total + input.motorTicks, 0);
  assert.ok(selectionMotor(after) < selectionMotor(before), `${level} pays less total selection motor time`);
  const boxBefore = scene(original, level, 'box'), boxAfter = scene(current, level, 'box');
  assert.equal(boxAfter.inputs[0].kind, 'select-box');
  assert.deepEqual(boxAfter, boxBefore, 'a cheaper box retains its complete native timeline');
  assert.deepEqual(scene(current, level, 'click'), after, 'the real click sequence replays exactly');
}
console.log('Selection cost: native cheaper click and box routes, full actors, paid motor, reaction floors and seeded replay PASS.');
