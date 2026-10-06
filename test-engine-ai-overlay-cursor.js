import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGame, command, step } from './shared/sim.js';
import { viewFor } from './shared/ai-view.js';
import { perceive } from './shared/ai-perception.js';
import * as current from './shared/ai-hands.js';
import { ghostCursor, spectatorHands } from './client/ai-overlay.js';

const handsURL = new URL('./shared/ai-hands.js', import.meta.url);
const handsSource = readFileSync(handsURL, 'utf8');
const sampleField = 'observedTick: hands.tick, ';
assert.equal(handsSource.split(sampleField).length, 2);
const markerLines = "    const marker = action.kind === 'select-box' && isPoint(hands.cursor) ? hands.cursor : action.at;\n    hands.clicks.push({ x: marker.x, z: marker.z, tick: hands.tick, kind: action.kind });";
assert.equal(handsSource.split(markerLines).length, 2);
const originalSource = handsSource.replace(sampleField, '').replace(markerLines,
  '    hands.clicks.push({ x: action.at.x, z: action.at.z, tick: hands.tick, kind: action.kind });').replace(/from (['"])(\.[^'"]+)\1/g,
  (_match, quote, path) => `from ${quote}${new URL(path, handsURL).href}${quote}`);
const original = await import(`data:text/javascript;base64,${Buffer.from(originalSource).toString('base64')}`);

function scene(api) {
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
  own.forEach((unit, i) => Object.assign(unit, { x: i ? 68 : 92, z: 68, holdFire: true, auto: false }));
  step(game); game.tick = 240;
  const camera = { x: 80, z: 80, yaw: 0, distance: 60 }, inputs = [], receipts = [], frames = [];
  const hands = api.createHands({ slot: 0, level: 'normal', seed: 1, camera, startedTick: game.tick, log: inputs });
  hands.openingUntil = game.tick; hands.openingDeadline = game.tick; hands.openingDone = true;
  const state = { camera, hands }, delivered = () => perceive(viewFor(game, 0, {}), 0, state);
  let view = delivered();
  const at = api.projectPointer(own[1], camera, view, { elevation: 1 });
  Object.assign(hands.pointer, { x: at.x - 2, y: at.y - 2,
    fromX: at.x - 2, fromY: at.y - 2, toX: at.x - 2, toY: at.y - 2 });
  assert.ok(api.enqueueDecision(hands, { t: 'stance', ids: own.map(unit => unit.id), key: 'holdFire', on: false },
    view, { concern: 'combat', eventTick: game.tick, reactionStartTick: game.tick }));
  for (let tick = 0; tick < 100 && !receipts.length; tick++) {
    view = delivered();
    api.advanceHands(hands, game.tick, view, cmd => {
      const result = command(game, 0, cmd);
      receipts.push({ tick: game.tick, command: structuredClone(cmd), result: result ?? null, selected: [...hands.selected] });
      return result;
    });
    const native = api.diagnostics(hands), publicRow = spectatorHands([native], { spectator: true })[0];
    frames.push({ tick: game.tick, actual: { x: native.cursor.x, z: native.cursor.z },
      displayed: ghostCursor(publicRow.cursor, game.tick), publicRow });
    step(game);
  }
  assert.equal(inputs[0].kind, 'select-box', 'the real native route uses a paid two-stage drag');
  assert.ok(inputs[0].motorTicks > 0);
  assert.ok(inputs.every(input => input.tick - input.inputStartedTick === input.motorTicks));
  assert.ok(inputs.every(input => input.tick - 240 >= 4), 'the actual response retains its causal floor');
  assert.equal(receipts.length, 1); assert.equal(receipts[0].result, null);
  assert.deepEqual(new Set(receipts[0].selected), new Set(own.map(unit => unit.id)));
  assert.ok(own.every(unit => unit.holdFire === false), 'the completed native command reaches both actors');
  return { inputs, receipts, frames };
}

const before = scene(original), after = scene(current);
assert.deepEqual(after.inputs, before.inputs, 'diagnostics never change the paid input route or any clock');
assert.deepEqual(after.receipts, before.receipts, 'diagnostics never change native command recipients or receipts');
assert.deepEqual(after.frames.map(frame => frame.actual), before.frames.map(frame => frame.actual),
  'the physical pointer follows the same native trajectory');
const error = frame => Math.hypot(frame.actual.x - frame.displayed.x, frame.actual.z - frame.displayed.z);
assert.ok(Math.max(...before.frames.map(error)) > 10, 'the old renderer visibly cuts across the actual drag');
assert.ok(after.frames.every(frame => error(frame) === 0), 'every native sample is displayed at the paid pointer');
const release = after.inputs[0].tick;
const beforeRelease = before.frames.find(frame => frame.tick === release);
const afterRelease = after.frames.find(frame => frame.tick === release);
const beforeMarker = beforeRelease.publicRow.clicks.find(click => click.tick === release);
const afterMarker = afterRelease.publicRow.clicks.find(click => click.tick === release);
assert.ok(Math.hypot(beforeMarker.x - beforeRelease.actual.x, beforeMarker.z - beforeRelease.actual.z) > 12,
  'the old box marker is visibly displaced from the native release point');
assert.deepEqual({ x: afterMarker.x, z: afterMarker.z }, afterRelease.actual,
  'the box release marker follows the actual public ground pointer');
assert.deepEqual(after.inputs[0].target, before.inputs[0].target, 'the semantic input target is unchanged');
assert.ok(after.frames.some(frame => frame.tick < release && frame.tick > after.inputs[0].inputStartedTick));
assert.ok(after.frames.some(frame => frame.tick === release));

const row = after.frames.find(frame => frame.tick === release - 1).publicRow;
assert.equal(row.cursor.observedTick, release - 1);
const poisoned = { ...row, selectedIds: [901], orders: ['private'],
  cursor: { ...row.cursor, pixelX: 123, pixelY: 234, unitIds: [901], executor: { private: true } } };
const sanitized = spectatorHands([poisoned], { spectator: true })[0];
assert.deepEqual(sanitized, row, 'only the public sample clock is added to the existing whitelist');
assert.deepEqual(spectatorHands([poisoned]), [], 'a playing seat still receives no hands');
assert.deepEqual(spectatorHands([poisoned], { spectator: true, world: true }), [], 'shared-fog spectators still receive no hands');
assert.equal(ghostCursor({ ...row.cursor, mode: 'ui' }, release - 1), null, 'UI pointers remain hidden');
const invalid = spectatorHands([{ ...row, cursor: { ...row.cursor, observedTick: Infinity } }], { spectator: true })[0];
assert.equal(Object.hasOwn(invalid.cursor, 'observedTick'), false, 'an invalid sample clock is not public');
const legacy = { x: 20, z: 30, fromX: 0, fromZ: 10, toX: 20, toZ: 30, startTick: 10, endTick: 20 };
assert.deepEqual(ghostCursor(legacy, 15), { x: 10, z: 20 }, 'legacy packets retain their interpolation');
console.log('AI overlay cursor: native drag trajectory, unchanged paid route and receipts, sample whitelist, privacy and legacy packets PASS.');
