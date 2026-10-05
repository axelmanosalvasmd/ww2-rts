import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { kaplanMeier, reactionMetrics, concernMetrics, summarizeSeat, aggregate, fitTiming, sourceCheckpoint, packageReport } from './tools/ai-humanity.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');

{
  const censored = kaplanMeier([{ seconds: .5, observed: true }, { seconds: 10, observed: false }, { seconds: 10, observed: false }]);
  assert.equal(censored.medianIdentifiable, false, 'a minority of observed answers cannot establish a population median');
  assert.equal(censored.medianSeconds, null);
  assert.equal(censored.curve[0].atRisk, 3);
  assert.equal(censored.curve[0].survival, .667);
  const tied = kaplanMeier([{ seconds: 1, observed: false }, { seconds: 1, observed: true }]);
  assert.equal(tied.curve[0].survival, .5, 'responses precede recording-end censoring at tied times');
  assert.equal(tied.medianSeconds, 1);
  assert.equal(kaplanMeier([]).medianIdentifiable, false);
}

const event = (id, required = true) => ({ id, tick: 0, kind: 'screen-contact', source: 'screen', onScreen: true, x: 0, z: 0,
  responseRequired: required, responsePolicy: 'screen-v1', responseReason: required ? 'idle-combat-contact' : 'monitoring-contact', responseUnits: [1] });

{
  const command = { t: 'move', orders: [[1, 1, 1]] };
  const log = { eventsRecorded: true, events: [event('a'), event('b'), event('c'), event('exempt', false)], inputs: [
    { tick: 3, kind: 'select-click', event: { id: 'a' }, eventTick: 0, ids: [2], selected: 1, responseActorIds: [2] },
    { tick: 6, kind: 'select-click', event: { id: 'a' }, eventTick: 0, ids: [2], selected: 1, responseActorIds: [1] },
    { tick: 10, kind: 'move-click', event: { id: 'a' }, eventTick: 0, ids: [1], selected: 1, responseActorIds: [1], command },
  ], commands: [{ tick: 10, command, accepted: true }] };
  const reaction = reactionMetrics(log, 10), required = reaction.requiredScreenPopulation;
  assert.equal(reaction.population.onScreen.firstAction.answered, 1);
  assert.equal(reaction.firstAction.onScreen.median, .15, 'all-stimulus statistics retain the earlier recorded input');
  assert.equal(required.requiredEvents, 3);
  assert.equal(required.exemptEvents, 1);
  assert.equal(required.firstAction.answered, 1);
  assert.equal(required.firstAction.unanswered, 2);
  assert.equal(required.firstAction.conditionalCompletedSeconds.median, .3, 'unrelated intended actors cannot answer the required population');
  assert.equal(required.firstAction.survival.medianIdentifiable, false);
  assert.equal(required.causalAlignment.firstActionSelectionDiffers, 1, 'an intended causal selection can miss, with actual mismatch recorded separately');
  assert.equal(required.attemptedCommand.conditionalCompletedSeconds.median, .5);
  assert.equal(required.acceptedCommand.answered, 1);
  const metric = summarizeSeat({ ...log, mp: [], physicalInputsRecorded: true }, 10);
  const summary = aggregate([{ mode: 'conquest', level: 'hard', seed: 1, seconds: 10, seats: [{ faction: 'USA', metrics: metric }] }]);
  assert.equal(summary['conquest/hard'].requiredScreenPopulation.firstAction.medianIdentifiable, false, 'aggregation retains censored population outcomes');

  for (const [metres, answered] of [[23, 1], [25, 0]]) {
    const support = reactionMetrics({ events: [event('support')], inputs: [
      { tick: 5, kind: 'support-key', event: { id: 'support' }, eventTick: 0, responseActorIds: [], responseTarget: { x: metres, z: 0 } },
    ], commands: [] }, 10);
    assert.equal(support.requiredScreenPopulation.firstAction.answered, answered, 'support must target the recorded threat vicinity');
  }
  const historical = reactionMetrics({ events: [{ id: 'old', tick: 0, kind: 'screen-contact', source: 'screen', onScreen: true }], inputs: [], commands: [] }, 10);
  assert.equal(historical.requiredScreenPopulation, null, 'historical events cannot receive retrospective eligibility');
  assert.equal(historical.population.onScreen.firstAction.unanswered, 1);
  const baseline = reactionMetrics({ inputs: [], commands: [] }, 10);
  assert.equal(baseline.population, null, 'missing event instrumentation is unknown, not a zero-event measurement');
  assert.equal(baseline.firstAction, null);
  assert.equal(baseline.requiredScreenPopulation, null);
}

// Capture dependency bytes before importing the commander dependencies used by the runtime fixture.
const checkpoint = await sourceCheckpoint(false);
assert.equal(checkpoint.files['client/keys.js'], sha(await readFile(new URL('./client/keys.js', import.meta.url))));
const { bindings } = await import('./client/keys.js');
const { createHands, enqueueDecision, advanceHands } = await import('./shared/ai-hands.js');
const { createGame, command: submitCommand, priceOf } = await import('./shared/sim.js');

{
  const rows = [], view = { tick: 0, w: 200, h: 200, winner: null, flags: Array(40000).fill(0), players: [{ out: false }],
    units: new Map([[1, { id: 1, type: 'rifle', owner: 0, x: 100, z: 100 }]]) };
  const hands = createHands({ slot: 0, seed: 31, level: 'hard', camera: { x: 100, z: 100 }, log: rows });
  hands.openingDone = true; hands.openingUntil = 0; hands.openingDeadline = 0; hands.selected = [1];
  assert.ok(enqueueDecision(hands, { t: 'amove', orders: [[1, 110, 110]] }, view));
  for (let tick = 0; tick <= 300; tick++) { view.tick = tick; advanceHands(hands, tick, view, () => true); }
  const binding = bindings.find(key => key.id === 'amove'), input = rows.find(row => row.kind === 'attack-key');
  assert.ok(binding);
  assert.ok(input, 'current hands emitted a physical attack key');
  assert.deepEqual(input.input, { code: binding.code, ctrl: binding.ctrl, shift: binding.shift, alt: binding.alt }, 'hands uses the loaded client binding');
  assert.equal(checkpoint.files['client/keys.js'], sha(await readFile(new URL('./client/keys.js', import.meta.url))), 'key source stayed unchanged during the runtime fixture');
}

{
  const cases = [
    ['point:0', { t: 'amove', orders: [[1, 0, 0], [2, 30, 0]] }, { x: 0, z: 0 }],
    ['idle:1', { t: 'move', orders: [[2, 0, 0]] }, null],
    ['idle:1', { t: 'move', orders: [[1, 0, 0]] }, null],
  ];
  const inputs = cases.map(([concern, command, concernTarget], cycle) => ({ tick: cycle + 1, kind: 'click', concern, cycle, command, concernTarget }));
  const commands = inputs.map(row => ({ tick: row.tick, command: row.command, accepted: true }));
  const map = { w: 20, h: 20, rows: Array(20).fill('.'.repeat(20)), spawns: [{ x: 2, y: 2 }, { x: 17, y: 17 }], points: [{ x: 10, y: 10 }] };
  const game = createGame(map, ['buyer', 'enemy'], false, [0, 1], [0, 1], { weather: false });
  const price = priceOf(game, 'rifle'), player = game.players[0];
  player.mp = price.mp; player.fuel = price.fuel ?? 0;
  for (let purchase = 0; purchase < 2; purchase++) {
    const command = { t: 'buy', unit: 'rifle' }, tick = inputs.length + 1;
    const before = { mp: player.mp, fuel: player.fuel }, rejection = submitCommand(game, 0, command);
    assert.equal(rejection, purchase === 0 ? undefined : 'mp', 'actual simulation accepts an affordable purchase and rejects the next for manpower');
    inputs.push({ tick, kind: 'buy-click', concern: 'production', cycle: tick, command });
    commands.push({ tick, command, accepted: rejection === undefined, rejectionReason: rejection ?? null,
      spend: { mp: before.mp - player.mp, fuel: before.fuel - player.fuel } });
  }
  const alignment = concernMetrics({ inputs, commands, productionDecisions: [{ id: 1, reason: 'unaffordable', mp: player.mp, price, proposedBuys: 0, queuedBuys: 0 }] });
  assert.equal(alignment.expansion.commandsToOther, 1, 'a mixed-target command is not fully aligned');
  assert.equal(alignment.expansion.targets, 2);
  assert.equal(alignment.expansion.alignedTargets, 1);
  assert.equal(alignment.idle.inputContextCycles, 2);
  assert.equal(alignment.idle.cyclesIncludingIdleUnit, 1);
  assert.equal(alignment.idle.cyclesWithCommandsForOtherUnitsOnly, 1);
  assert.equal(alignment.production.acceptedPurchases, 1);
  assert.equal(alignment.production.rejectedPurchases, 1);
  assert.equal(alignment.production.rejectionReasons.mp, 1);
  assert.equal(alignment.production.purchaseSpendMP, price.mp, 'spending follows the actual purchase price');
  assert.equal(alignment.production.purchaseSpendFuel, price.fuel ?? 0);
  assert.equal(alignment.production.planner.reasons.unaffordable, 1);
}

{
  const keys = Array.from({ length: 6 }, (_, i) => ({ tick: i * 2, kind: 'key', actor: 'human', seat: 0 }));
  const fit = fitTiming(keys);
  assert.equal(fit.keyIntervalSamples.count, 5);
  assert.deepEqual(fit.calibration, { key: [.1, .1] }, 'only measured key intervals become calibration');
  assert.equal(fit.reactions, null);
  assert.match(fit.reactionUnavailableReason, /independently recorded stimulus/);
  assert.deepEqual(fitTiming(keys.slice(0, 5)).calibration, {}, 'insufficient measured keys cannot produce a calibration');
  assert.deepEqual(fitTiming([{ tick: 0, kind: 'click' }, { tick: 2, kind: 'click' }]).calibration, {}, 'click gaps cannot invent pointer or reaction parameters');
}

{
  const dir = await mkdtemp(join(tmpdir(), 'ww2-ai-humanity-test-'));
  try {
    const input = join(dir, 'full.json'), output = join(dir, 'compact.json'), archive = join(dir, 'raw/full.json.gz');
    const log = { commands: [{ tick: 45, command: { t: 'amove', orders: [[1, 5, 7]] }, accepted: false }],
      inputs: [{ tick: 42, kind: 'select', ids: [1] }], events: [{ id: 's1', tick: 30, responseRequired: true }], extra: { nested: ['retain', 0, null] } };
    const report = { source: 'fixture', summary: { conditional: null }, sourceCheckpoints: { [checkpoint.sha256]: checkpoint },
      results: [{ mode: 'conquest', level: 'hard', seed: 1, seconds: 180, sourceCheckpointSHA256: checkpoint.sha256,
        seats: [{ slot: 0, metrics: { requiredScreenPopulation: { survival: { medianIdentifiable: false, curve: [{ seconds: 12, censored: 1 }] } } } }], logs: [log] }] };
    const bytes = Buffer.from(JSON.stringify(report, null, 2) + '\n');
    await writeFile(input, bytes);
    const compact = await packageReport(input, output, archive), compressed = await readFile(archive), full = gunzipSync(compressed);
    assert.deepEqual(await readFile(input), bytes, 'packaging never mutates its input');
    assert.deepEqual(full, bytes, 'gzip preserves the exact complete report bytes');
    assert.deepEqual(JSON.parse(full).results[0].logs[0], log);
    assert.deepEqual(compact.results[0].seats, report.results[0].seats);
    assert.deepEqual(compact.sourceCheckpoints, report.sourceCheckpoints);
    assert.deepEqual(compact.summary, report.summary);
    assert.equal(Object.hasOwn(compact.results[0], 'logs'), false);
    assert.equal(compact.evidenceArchive.sha256, sha(compressed));
    assert.equal(compact.evidenceArchive.uncompressedSHA256, sha(bytes));
    assert.equal(compact.evidenceArchive.bytes, compressed.length);
    assert.equal(compact.evidenceArchive.uncompressedBytes, bytes.length);
    assert.equal(compact.evidenceArchive.path, 'raw/full.json.gz');
    assert.equal(compact.results[0].timelineDigests[0].sha256, sha(JSON.stringify(log)));
    assert.equal(compact.results[0].timelinesSHA256, sha(JSON.stringify([log])));
    assert.deepEqual(JSON.parse(await readFile(output)), compact);
    await assert.rejects(packageReport(input, input, archive), /different paths/);
    const missing = join(dir, 'missing.json');
    await writeFile(missing, JSON.stringify({ results: [{ seats: [{}] }] }));
    await assert.rejects(packageReport(missing, output, archive), /full raw logs/);
  } finally { await rm(dir, { recursive: true, force: true }); }
}

console.log('AI humanity metrics: censored populations, causal actors, concerns, simulation spending, live bindings, measured key fits and evidence packaging passed.');
