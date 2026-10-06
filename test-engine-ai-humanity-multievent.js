import assert from 'node:assert/strict';
import { reactionMetrics, reactionScoringComparison, summarizeSeat, aggregate } from './tools/ai-humanity.mjs';
import { createGame, command } from './shared/sim.js';
import { createHands, enqueueDecision, advanceHands } from './shared/ai-hands.js';

const event = (id, x, ids = [1], tick = 0) => ({ id, tick, kind: 'screen-contact', source: 'screen', onScreen: true, x, z: 100,
  targetId: 3, responseRequired: true, responsePolicy: 'screen-v1', responseReason: 'idle-combat-contact', responseUnits: ids });
const events = [event('near-a', 100), event('near-b', 110)];
const input = (changes = {}) => ({ tick: 10, kind: 'select-click', queuedTick: 2, inputStartedTick: 3, responseActorIds: [1],
  ids: [1], selected: 1, responseEvents: structuredClone(events), event: { id: events[0].id }, eventTick: 0, ...changes });
const check = (inputs, commands = [], population = events) => reactionMetrics({ events: population, inputs, commands }, 10);

{
  const result = check([input(), input({ tick: 20 })]);
  assert.equal(result.population.version, 3);
  assert.equal(result.requiredScreenPopulation.firstAction.answered, 2);
  assert.equal(result.requiredScreenPopulation.firstAction.conditionalCompletedSeconds.count, 2, 'each event deduplicates its first answer');
  const metrics = summarizeSeat({ events, inputs: [input()], commands: [], physicalInputsRecorded: true }, 60);
  assert.equal(metrics.physicalInputAPM.matchMean, 1, 'two event links remain one physical input');
  assert.equal(metrics.physicalInputAPM.windows60.mean, 1);
  assert.equal(metrics.requiredScreenPopulation.firstAction.answered, 2);
  assert.equal(metrics.reactionScoringComparison.primaryOnly.requiredScreenPopulation.firstAction.answered, 1);
  assert.equal(metrics.reactionScoringComparison.primaryOnly.requiredScreenPopulation.firstAction.unanswered, 1);
  assert.equal(metrics.reactionScoringComparison.explicitLinked.requiredScreenPopulation.firstAction.answered, 2);
  assert.equal(metrics.reactionMeasurementVersion, 3);
  const pooled = aggregate([{ mode: 'conquest', level: 'hard', seed: 1, seconds: 60, seats: [{ faction: 'USA', metrics }] }]);
  assert.equal(pooled['conquest/hard'].reactionMeasurementVersion, 3);
  const compared = pooled['conquest/hard'].reactionScoringComparison;
  assert.equal(compared.primaryOnly.requiredScreenPopulation.firstAction.samples, 2);
  assert.equal(compared.explicitLinked.requiredScreenPopulation.firstAction.samples, 2);
  assert.equal(compared.primaryOnly.requiredScreenPopulation.firstAction.observed, 1);
  assert.equal(compared.primaryOnly.requiredScreenPopulation.firstAction.censored, 1);
  assert.equal(compared.explicitLinked.requiredScreenPopulation.firstAction.observed, 2);
  assert.equal(compared.primaryOnly.reactionEventPopulation.byType.screenNewContact.events, 2);
  assert.equal(compared.explicitLinked.reactionEventPopulation.byType.screenNewContact.events, 2);
  const duplicate = check([input({ responseEvents: [events[0], events[0]] })]);
  assert.equal(duplicate.requiredScreenPopulation.firstAction.answered, 1);
  assert.equal(duplicate.population.linkage.duplicateLinks, 1);
}
{
  for (const [queuedTick, answered] of [[240, 1], [241, 0], [3000, 0]]) {
    const row = input({ queuedTick, inputStartedTick: queuedTick + 1, tick: queuedTick + 10, responseEvents: [events[0]] });
    const result = reactionMetrics({ events, inputs: [row], commands: [] }, 180);
    assert.equal(result.requiredScreenPopulation.firstAction.answered, answered, 'the attention horizon is measured at enqueue');
    assert.equal(result.population.linkage.staleLinks, answered ? 0 : 1);
    assert.equal(result.requiredScreenPopulation.firstAction.unanswered, 2 - answered, 'stale links retain the original censored population');
  }
  const attack = { t: 'attack', ids: [1], target: 3 };
  const delayed = input({ queuedTick: 240, inputStartedTick: 241, tick: 3000, kind: 'rightclick', command: attack, responseEvents: [events[0]] });
  const log = { events, inputs: [delayed], commands: [{ tick: 3000, command: attack, accepted: true, locations: [{ x: 100, z: 100 }] }] };
  const before = structuredClone(log), result = reactionMetrics(log, 180);
  assert.equal(result.population.linkage.staleLinks, 0, 'a timely plan remains attributable after a later completion or cap wait');
  assert.equal(result.requiredScreenPopulation.firstAction.answered, 1);
  assert.equal(result.requiredScreenPopulation.acceptedCommand.answered, 1);
  assert.equal(result.requiredScreenPopulation.firstAction.conditionalCompletedSeconds.median, 150);
  summarizeSeat(log, 180);
  assert.deepEqual(log, before, 'dual scoring must not mutate raw production logs');
  const historical = { ...delayed, queuedTick: 3000, inputStartedTick: 3001, tick: 3010 }; delete historical.responseEvents;
  assert.equal(reactionMetrics({ events, inputs: [historical], commands: [] }, 180).requiredScreenPopulation.firstAction.answered, 1, 'historical primary-only attribution remains unchanged');
  assert.equal(reactionScoringComparison({ events, inputs: [historical], commands: [] }, 180), null);
}
{
  const miss = check([input({ ids: [2], selected: 1 })]);
  assert.equal(miss.requiredScreenPopulation.firstAction.answered, 2, 'an intended causal selection can miss');
  assert.equal(miss.requiredScreenPopulation.causalAlignment.firstActionSelectionDiffers, 2);
  assert.equal(miss.requiredScreenPopulation.acceptedCommand.answered, 0);
  const unrelated = check([input({ responseActorIds: [2], ids: [2] })]);
  assert.equal(unrelated.requiredScreenPopulation.firstAction.answered, 0);
  assert.equal(unrelated.population.linkage.unrelatedActorLinks, 2);
}
{
  const unseen = event('not-delivered', 100), row = input({ responseEvents: [unseen] });
  assert.equal(check([row]).requiredScreenPopulation.firstAction.answered, 0);
  assert.equal(check([row]).population.linkage.unknownPopulationLinks, 1);
  for (const changes of [{ queuedTick: undefined }, { inputStartedTick: undefined }, { queuedTick: 2.5 }, { inputStartedTick: 1 }])
    assert.equal(check([input(changes)]).requiredScreenPopulation.firstAction.answered, 0);
  const arrival = event('future', 100, [1], 5);
  assert.equal(check([input({ responseEvents: [arrival], queuedTick: 4, inputStartedTick: 6 })], [], [arrival]).requiredScreenPopulation.firstAction.answered, 0);
  assert.equal(check([input({ responseEvents: [arrival], queuedTick: 6, inputStartedTick: 4 })], [], [arrival]).requiredScreenPopulation.firstAction.answered, 0);
  const tampered = { ...events[0], responseUnits: [2] };
  assert.equal(check([input({ responseEvents: [tampered] })]).requiredScreenPopulation.firstAction.answered, 0);
  for (const changes of [{ responsePolicy: 'screen-v2' }, { responsePolicy: undefined },
    { responseReason: 'monitoring-contact' }, { responseReason: undefined }]) {
    const result = check([input({ responseEvents: [{ ...events[0], ...changes }] })]);
    assert.equal(result.requiredScreenPopulation.firstAction.answered, 0, 'links must retain the complete creation policy and reason');
    assert.equal(result.requiredScreenPopulation.firstAction.unanswered, 2, 'metadata mismatch retains every censored event');
    assert.equal(result.population.linkage.descriptorMismatchLinks, 1);
  }
  const wrongAttack = { t: 'attack', ids: [1], target: 3 };
  const wrongAttackResult = check([input({ kind: 'rightclick', command: wrongAttack })], [{ tick: 10, command: wrongAttack, accepted: true, locations: [{ x: 135, z: 100 }] }]);
  assert.equal(wrongAttackResult.requiredScreenPopulation.acceptedCommand.answered, 0, 'a claimed target identity cannot conceal an actual target outside the local24metre scope');
  for (const [x, answered] of [[148, 1], [149, 0]]) {
    const move = { t: 'move', orders: [[1, 100, 100]] };
    const result = check([input({ command: move, responseEvents: [events[0]] })], [{ tick: 10, command: move, accepted: true, sourceLocations: [{ x, z: 100 }] }]);
    assert.equal(result.requiredScreenPopulation.acceptedCommand.answered, answered, 'actual movement requires the eligible actor in the48metre source scope');
  }
  const unknownPolicy = { ...events[0] }; delete unknownPolicy.responseRequired; delete unknownPolicy.responsePolicy; delete unknownPolicy.responseReason;
  assert.equal(check([input({ responseEvents: [unknownPolicy] })], [], [unknownPolicy]).requiredScreenPopulation, null);
  const unknownComparison = reactionScoringComparison({ events: [unknownPolicy], inputs: [input({ responseEvents: [unknownPolicy] })], commands: [] }, 10);
  assert.equal(unknownComparison.primaryOnly.requiredScreenPopulation, null);
  assert.equal(unknownComparison.explicitLinked.requiredScreenPopulation, null);
  assert.equal(reactionMetrics({ inputs: [input()], commands: [] }, 10).population, null, 'links cannot manufacture a missing event population');
}
{
  for (const [x, answered] of [[123, 2], [125, 1]])
    assert.equal(check([input({ kind: 'support-key', responseActorIds: [], responseTarget: { x, z: 100 } })]).requiredScreenPopulation.firstAction.answered, answered);
  const wrongActor = { t: 'attack', ids: [2], target: 3 };
  const actorResult = check([input({ kind: 'rightclick', command: wrongActor })], [{ tick: 10, command: wrongActor, accepted: true, locations: [{ x: 105, z: 100 }] }]);
  assert.equal(actorResult.requiredScreenPopulation.firstAction.answered, 2);
  assert.equal(actorResult.requiredScreenPopulation.acceptedCommand.answered, 0, 'intended metadata cannot certify an unrelated actual actor');
  const wrongTarget = { t: 'support', kind: 'artillery', x: 135, z: 100 };
  const targetResult = check([input({ kind: 'support-key', responseActorIds: [], responseTarget: { x: 110, z: 100 }, command: wrongTarget })], [{ tick: 10, command: wrongTarget, accepted: true }]);
  assert.equal(targetResult.requiredScreenPopulation.firstAction.answered, 2);
  assert.equal(targetResult.requiredScreenPopulation.acceptedCommand.answered, 0, 'actual support35/25metres away cannot pass by claiming an intended nearer target');
}
{
  const map = { w: 80, h: 80, rows: Array(80).fill('.'.repeat(80)), spawns: [{ x: 5, y: 5 }, { x: 75, y: 75 }], points: [{ x: 40, y: 40 }] };
  const game = createGame(map, ['own', 'enemy'], false, [0, 1], [0, 1], { weather: false });
  const own = [...game.units.values()].filter(u => u.owner === 0).slice(0, 2), enemies = [...game.units.values()].filter(u => u.owner === 1).slice(0, 2);
  assert.equal(own.length, 2); assert.equal(enemies.length, 2);
  own.forEach((u, i) => Object.assign(u, { x: 100 + i * 4, z: 100 }));
  enemies.forEach((u, i) => { Object.assign(u, { x: 112 + i * 3, z: 100 }); game.players[0].visible.add(u.id); });
  const population = enemies.map((u, i) => ({ ...event(`actual-${i}`, u.x, own.map(u => u.id)), targetId: u.id }));
  const inputs = [], commands = [], context = { responseActorIds: own.map(u => u.id), responseTarget: { x: enemies[0].x, z: enemies[0].z }, responseEvents: structuredClone(population) };
  const view = { tick: 0, w: game.w, h: game.h, winner: null, flags: game.flags, players: game.players, units: game.units };
  const hands = createHands({ slot: 0, seed: 31, level: 'hard', camera: { x: 100, z: 100 }, log: inputs });
  hands.openingDone = true; hands.openingUntil = 0; hands.openingDeadline = 0;
  assert.ok(enqueueDecision(hands, { t: 'attack', ids: own.map(u => u.id), target: enemies[0].id }, view, context));
  context.responseEvents[0].responsePolicy = 'caller-mutated-after-enqueue';
  context.responseEvents[0].responseReason = 'caller-mutated-after-enqueue';
  context.responseEvents[0].responseUnits.length = 0;
  for (let tick = 0; tick <= 200; tick++) {
    view.tick = tick;
    advanceHands(hands, tick, view, cmd => { const result = command(game, 0, cmd); commands.push({ tick, command: cmd, accepted: result === undefined,
      locations: [{ x: game.units.get(cmd.target).x, z: game.units.get(cmd.target).z }], sourceLocations: own.map(u => ({ x: u.x, z: u.z })) }); return result; });
  }
  assert.deepEqual(inputs.filter(input => input.kind.startsWith('select-')).map(input => input.kind),
    ['select-click', 'select-add-click'], 'the cheaper paid click sequence acquires the complete group');
  assert.deepEqual(new Set(hands.selected), new Set(own.map(unit => unit.id)));
  assert.ok(inputs.length > 0);
  for (const row of inputs) {
    assert.deepEqual(row.responseEvents, population, 'hands natively emits detached creation descriptors from the queued job');
    assert.notEqual(row.responseEvents, context.responseEvents);
    assert.ok(Number.isSafeInteger(row.queuedTick));
    assert.ok(Number.isSafeInteger(row.inputStartedTick));
  }
  assert.equal(commands.length, 1); assert.equal(commands[0].accepted, true);
  const result = reactionMetrics({ events: population, inputs, commands }, 10);
  assert.equal(result.requiredScreenPopulation.firstAction.answered, 2);
  assert.equal(result.requiredScreenPopulation.acceptedCommand.answered, 2, 'one actual local group attack answers two already-delivered stimuli');
  assert.equal(summarizeSeat({ events: population, inputs, commands, physicalInputsRecorded: true }, 60).physicalInputAPM.matchMean, inputs.length);
  game.players[0].mp = 5000; game.players[0].sup.artillery = 0;
  const support = { t: 'support', kind: 'artillery', x: 113, z: 100 };
  assert.equal(command(game, 0, support), undefined);
  const supportInput = input({ kind: 'support-key', responseActorIds: [], responseTarget: { x: 113, z: 100 }, command: support, responseEvents: population });
  assert.equal(reactionMetrics({ events: population, inputs: [supportInput], commands: [{ tick: 10, command: support, accepted: true }] }, 10).requiredScreenPopulation.acceptedCommand.answered, 2);
}
console.log('Prospective multi-event fixtures passed: actual group attack/support, independent dedup, intended miss, actor/target/timing/population rejection and one-input APM.');
