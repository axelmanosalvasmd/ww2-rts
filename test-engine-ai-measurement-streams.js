import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { measurementScoringViews, summarizeSeat, aggregate, sourceCheckpoint, packageReport, bootstrapPrivateOracle } from './tools/ai-humanity.mjs';
import { perceive } from './shared/ai-perception.js';
import { perceive as oracle } from './tools/ai-screen-v1-oracle.js';
import * as frozenOracle from './tools/ai-screen-v1-oracle.js';
import { createGame, command, step } from './shared/sim.js';
import { viewFor } from './shared/ai-view.js';
import { think, aiDiagnostics, observe } from './shared/ai.js';

const map = { w: 80, h: 80, rows: Array(80).fill('.'.repeat(80)), spawns: [{ x: 20, y: 20 }, { x: 60, y: 60 }], points: [] };
function deterministicGame() {
  const old = Math.random; Math.random = () => .5;
  try { return createGame(map, ['AI', 'enemy'], false, [0, 1], [0, 1], { weather: false }); }
  finally { Math.random = old; }
}
const raw = (id, targetId, x = 210) => ({ id, tick: 2, observationTick: 2, kind: 'screen-contact', source: 'screen', onScreen: true,
  x, z: 210, targetId, responseRequired: true, responsePolicy: 'screen-v1', responseReason: 'idle-combat-contact', responseUnits: [1] });
const publicEvent = (event, id) => {
  const copy = { ...event, id, observedDanger: { idleOwnUnits: [1], nearbyOwnUnits: [1] } };
  for (const key of ['responseRequired', 'responsePolicy', 'responseReason', 'responseUnits']) delete copy[key];
  return copy;
};
const original = [raw('raw-a', 3), raw('raw-b', 4, 220), raw('raw-hidden', 5, 215)];
const runtime = original.slice(0, 2).map((event, index) => publicEvent(event, `runtime-${index}`));
const observed = runtime.map(event => ({ ...event, responseRequired: true, responsePolicy: 'screen-observed-v1', responseReason: 'idle-combat-contact', responseUnits: [1] }));
const attack = { t: 'attack', ids: [1], target: 3 };
const input = { tick: 10, queuedTick: 3, inputStartedTick: 4, kind: 'rightclick', ids: [1], selected: 1,
  responseActorIds: [1], responseTarget: { x: 215, z: 210 }, event: { id: runtime[0].id }, eventTick: 2,
  responseEvents: structuredClone(runtime), command: attack };
function fixture() {
  return { physicalInputsRecorded: true, events: structuredClone(runtime), inputs: [structuredClone(input)],
    commands: [{ tick: 10, command: structuredClone(attack), accepted: true, locations: [{ x: 215, z: 210 }] }],
    perceptionMeasurements: { schema: 'ww2-private-perception-measurements-v1', toolOnly: true, startedTick: 1, frames: [{ tick: 2, observationTick: 2,
      original: { policy: 'screen-v1', baselineTick: 0, events: structuredClone(original), newEvents: structuredClone(original) },
      observed: { policy: 'screen-observed-v1', events: structuredClone(observed), newEvents: structuredClone(observed) },
      links: runtime.map((event, index) => ({ runtimeId: event.id, originalIds: [original[index].id] })) }] } };
}
{
  const log = fixture(), before = structuredClone(log), views = measurementScoringViews(log, 60), metrics = summarizeSeat(log, 60);
  assert.equal(views.originalOracle.primaryOnly.requiredScreenPopulation.firstAction.answered, 1);
  assert.equal(views.originalOracle.explicitLinked.requiredScreenPopulation.firstAction.answered, 2);
  assert.equal(views.originalOracle.explicitLinked.requiredScreenPopulation.firstAction.unanswered, 1);
  assert.equal(views.observed.explicitLinked.requiredScreenPopulation.firstAction.answered, 2);
  assert.equal(views.originalOracle.explicitLinked.requiredScreenPopulation.acceptedCommand.answered, 2);
  assert.equal(metrics.requiredScreenPopulation.requiredEvents, 3, 'top-level gate retains every original oracle stimulus');
  assert.deepEqual(metrics.requiredScreenPopulation.policies, ['screen-v1']);
  assert.deepEqual(metrics.measurementPolicyComparison.observed.explicitLinked.requiredScreenPopulation.policies, ['screen-observed-v1']);
  assert.equal(metrics.physicalInputAPM.matchMean, 1, 'policy and linked views do not duplicate physical inputs');
  assert.equal(metrics.nativeReactionEvents.events, 2);
  assert.equal(views.coverage.originalEventsWithoutRuntimeAlias, 1);
  const pooled = aggregate([{ mode: 'conquest', level: 'hard', seed: 1, seconds: 60, seats: [{ faction: 'USA', metrics }] }])['conquest/hard'];
  assert.equal(pooled.requiredScreenPopulation.firstAction.censored, 1);
  assert.equal(pooled.measurementPolicyComparison.originalOracle.primaryOnly.requiredScreenPopulation.firstAction.censored, 2);
  assert.equal(pooled.measurementPolicyComparison.observed.explicitLinked.requiredScreenPopulation.firstAction.observed, 2);
  assert.deepEqual(log, before, 'all derived and pooled scoring preserves native log bytes and private creation facts');
}
{
  for (const change of [event => { event.tick = 1; }, event => { event.targetId = 999; }, event => { event.source = 'alert'; },
    event => { event.observationTick = 0; }, event => { event.x += 1; }, event => { event.responseRequired = false; },
    event => { event.responsePolicy = 'changed-policy'; }, event => { event.responseReason = 'monitoring-contact'; }, event => { event.responseUnits = [99]; }]) {
    const log = fixture(); change(log.perceptionMeasurements.frames[0].original.newEvents[0]);
    const views = measurementScoringViews(log, 60);
    assert.equal(views.originalOracle.explicitLinked.requiredScreenPopulation.firstAction.answered, 1);
    assert.equal(views.originalOracle.explicitLinked.requiredScreenPopulation.firstAction.unanswered, 2);
    assert.equal(views.audit.mismatchedCreationMappings, 1);
  }
  const fabricated = fixture(); fabricated.perceptionMeasurements.frames[0].links[0].originalIds = ['raw-hidden'];
  const unmapped = measurementScoringViews(fabricated, 60);
  assert.equal(unmapped.originalOracle.explicitLinked.requiredScreenPopulation.firstAction.answered, 1);
  assert.equal(unmapped.originalOracle.explicitLinked.requiredScreenPopulation.firstAction.unanswered, 2, 'an unrelated raw stimulus cannot be credited through a fabricated same-frame alias');
  const unrelated = fixture(); unrelated.inputs[0].responseActorIds = [99]; unrelated.inputs[0].command.ids = [99]; unrelated.commands[0].command.ids = [99];
  const actors = measurementScoringViews(unrelated, 60);
  assert.equal(actors.originalOracle.explicitLinked.requiredScreenPopulation.firstAction.answered, 0);
  assert.equal(actors.originalOracle.explicitLinked.requiredScreenPopulation.firstAction.unanswered, 3);
  assert.equal(actors.observed.explicitLinked.requiredScreenPopulation.firstAction.unanswered, 2);
  const wrongTarget = fixture(); wrongTarget.commands[0].locations = [{ x: 250, z: 210 }];
  const geometry = measurementScoringViews(wrongTarget, 60);
  assert.equal(geometry.originalOracle.explicitLinked.requiredScreenPopulation.acceptedCommand.answered, 0);
  assert.equal(geometry.originalOracle.explicitLinked.requiredScreenPopulation.acceptedCommand.unanswered, 3);
  assert.equal(geometry.observed.explicitLinked.requiredScreenPopulation.acceptedCommand.unanswered, 2);
  const unknown = fixture(); unknown.perceptionMeasurements.frames[0].original = null; unknown.perceptionMeasurements.frames[0].links = [];
  assert.equal(measurementScoringViews(unknown, 60).originalOracle.explicitLinked.population, null);
  assert.equal(summarizeSeat(unknown, 60).requiredScreenPopulation, null);
  const historical = fixture(); delete historical.perceptionMeasurements;
  assert.equal(measurementScoringViews(historical, 60), null);
  assert.equal(Object.hasOwn(summarizeSeat(historical, 60), 'measurementPolicyComparison'), false);
}
{
  const game = deterministicGame(); game.units.clear(); game.players[0].mp = 5000;
  command(game, 0, { t: 'buy', unit: 'mg' }); game.players[0].mp = 0;
  const unit = [...game.units.values()][0]; Object.assign(unit, { x: 210, z: 210, hp: 27, auto: false, autoRetreat: false, targetId: 0 });
  const state = { camera: { x: 210, z: 210, yaw: 0, distance: 60 }, hands: { selected: [] } };
  const log = { commands: [], inputs: [], events: [], perceptionMeasurements: { frames: [] } };
  for (const [tick, hp] of [[0, 27], [2, 26]]) {
    game.tick = tick; unit.hp = hp;
    const view = perceive(viewFor(game, 0, {}), 0, state, tick, { measureRaw: oracle, onMeasurements: frame => log.perceptionMeasurements.frames.push(structuredClone(frame)) });
    log.events.push(...structuredClone(view.newEvents));
  }
  assert.equal(log.events.length, 0, 'unselected subprecision risk crossing is not a runtime stimulus');
  const views = measurementScoringViews(log, 1);
  assert.equal(views.originalOracle.explicitLinked.requiredScreenPopulation.requiredEvents, 1);
  assert.equal(views.originalOracle.explicitLinked.requiredScreenPopulation.firstAction.unanswered, 1);
  assert.equal(views.coverage.originalEventsWithoutRuntimeAlias, 1);
  assert.equal(views.observed.explicitLinked.requiredScreenPopulation, null);
}
{
  const game = deterministicGame(); game.units.clear(); game.players[0].mp = 5000;
  command(game, 0, { t: 'buy', unit: 'mg' }); game.players[0].mp = 0;
  const unit = [...game.units.values()][0]; Object.assign(unit, { x: 210, z: 210, hp: 50, auto: false, autoRetreat: false, targetId: 0 });
  const state = { camera: { x: 210, z: 210, yaw: 0, distance: 60 }, hands: { selected: [] } };
  const log = { commands: [], inputs: [], events: [], perceptionMeasurements: { frames: [] } };
  for (const [tick, hp] of [[0, 50], [2, 30]]) {
    game.tick = tick; unit.hp = hp;
    const view = perceive(viewFor(game, 0, {}), 0, state, tick, { measureRaw: oracle, onMeasurements: frame => log.perceptionMeasurements.frames.push(structuredClone(frame)) });
    log.events.push(...structuredClone(view.newEvents));
  }
  const stimulus = log.events.find(event => event.kind === 'screen-damage'), retreat = { t: 'retreat', ids: [unit.id] };
  game.tick = 10;
  assert.ok(stimulus); assert.equal(command(game, 0, retreat), undefined, 'a real local response is accepted by the simulation');
  log.commands.push({ tick: 10, command: retreat, accepted: true, sourceLocations: [{ x: 210, z: 210 }] });
  log.inputs.push({ tick: 10, queuedTick: 3, inputStartedTick: 4, kind: 'key', event: { id: stimulus.id }, eventTick: 2,
    responseEvents: [structuredClone(stimulus)], responseActorIds: [unit.id], ids: [unit.id], command: retreat });
  const views = measurementScoringViews(log, 1);
  assert.equal(views.audit.validMappings, 1);
  assert.equal(views.originalOracle.explicitLinked.requiredScreenPopulation.acceptedCommand.answered, 1);
  assert.equal(views.observed.explicitLinked.requiredScreenPopulation.acceptedCommand.answered, 1);
  assert.notEqual(views.originalOracle.log.events[0].id, stimulus.id, 'original and runtime identities remain separate');
}

// The collector's frozen detector owns its history separately from runtime diagnostic state.
{
  const run = mutate => {
    const game = deterministicGame(); game.units.clear(); game.players[0].mp = 5000;
    assert.equal(command(game, 0, { t: 'buy', unit: 'mg' }), undefined);
    game.players[0].mp = 0;
    const unit = [...game.units.values()][0], spawn = game.players[0].spawn;
    Object.assign(unit, { x: spawn.x, z: spawn.z, hp: 27, auto: false, autoRetreat: false, targetId: 0 });
    const initial = viewFor(game, 0, {}), state = { camera: frozenOracle.startCamera(initial, 0), hands: { selected: [] } };
    const frames = [], events = [];
    const collector = bootstrapPrivateOracle(initial, 0, frame => {
      frames.push(structuredClone(frame));
      if (mutate) { frame.original.events.length = 0; frame.original.newEvents.length = 0; }
    }, frozenOracle);
    for (const [tick, hp] of [[2, 26], [4, 26], [6, 1], [8, 1]]) {
      game.tick = tick; unit.hp = hp;
      const view = perceive(viewFor(game, 0, {}), 0, state, tick, collector);
      events.push(...structuredClone(view.newEvents));
    }
    assert.equal(frames[1].original.newEvents.length, 1, 'native unselected damage crossing creates a real frozen-oracle stimulus');
    assert.equal(frames[1].original.newEvents[0].responseRequired, true);
    assert.equal(frames[1].observed.newEvents.length, 0, 'the unchanged fair pixel detector still cannot observe this subprecision crossing');
    assert.deepEqual(frames[1].original.events, frames[1].original.newEvents,
      'the external collector records the cumulative history owned by its actual private detector');
    assert.equal(frames[2].original.newEvents.length, 0, 'unchanged native damage creates no repeated stimulus');
    assert.deepEqual(frames[2].original.events, frames[1].original.events, 'original history persists on later frames without new creations');
    assert.equal(frames[3].original.newEvents.length, 1, 'a later native heavy hit creates a distinct real original stimulus');
    assert.equal(frames[3].original.newEvents[0].responseRequired, true);
    assert.equal(frames[3].original.events.length, 2, 'cumulative history retains both actual original creations');
    assert.equal(frames[4].original.newEvents.length, 0);
    assert.deepEqual(frames[4].original.events, frames[3].original.events);
    const log = { commands: [], inputs: [], events, perceptionMeasurements: { startedTick: 0, frames } };
    const score = measurementScoringViews(log, 1), nativeCreations = frames.flatMap(frame => frame.original.newEvents);
    assert.equal(new Set(nativeCreations.map(event => `${event.id}/${event.tick}`)).size, 2);
    assert.deepEqual(score.originalOracle.log.events, nativeCreations, 'cumulative frames score each original creation exactly once');
    assert.equal(score.originalOracle.explicitLinked.requiredScreenPopulation.requiredEvents, 2);
    assert.equal(score.originalOracle.explicitLinked.requiredScreenPopulation.firstAction.unanswered, 2);
    assert.equal(score.originalOracle.explicitLinked.requiredScreenPopulation.acceptedCommand.answered, 0);
    const broken = structuredClone(log);
    for (const frame of broken.perceptionMeasurements.frames) frame.original.events = [];
    assert.equal(measurementScoringViews(broken, 1).originalOracle.log.events.length, 0,
      'the historical empty cumulative arrays demonstrate the actual incomplete collector wiring');
    return { frames, events, units: structuredClone(game.units), players: structuredClone(game.players) };
  };
  const mutated = run(true), intact = run(false);
  assert.deepEqual(mutated, intact, 'mutating detached recorder payloads cannot erase private detector history or alter native observations');
  if (process.env.ORACLE_CUMULATIVE_EVIDENCE) await writeFile(process.env.ORACLE_CUMULATIVE_EVIDENCE, JSON.stringify({ frames: intact.frames, runtimeEvents: intact.events, callbackMutationIsolated: true }, null, 2) + '\n');
}

function replay(level, mode) {
  const game = deterministicGame(), inputs = [], commands = [], frames = [];
  let oracleCalls = 0, view = observe(game, 0);
  for (let tick = 0; tick < 260; tick++) {
    step(game); if (!(game.tick % 2)) view = observe(game, 0);
    const measurements = mode === 'off' ? undefined : { measureRaw: (...args) => { oracleCalls++; return oracle(...args); }, onMeasurements: payload => {
      frames.push(structuredClone(payload));
      if (mode === 'mutate') {
        payload.links.length = 0; payload.original?.events.splice(0); payload.original?.newEvents.splice(0);
        payload.observed.events.splice(0); payload.observed.newEvents.splice(0);
      }
    } };
    think(game, 0, { level, seed: 29, view, perceptionMeasurements: measurements,
      inputLog: entry => inputs.push(structuredClone(entry)), submit: cmd => { commands.push(structuredClone(cmd)); return command(game, 0, cmd); } });
  }
  return { inputs, commands, events: aiDiagnostics(game, 0).events, frames, oracleCalls };
}
for (const level of ['easy', 'normal', 'hard']) {
  const off = replay(level, 'off'), on = replay(level, 'on'), mutated = replay(level, 'mutate');
  assert.ok(off.inputs.length > 0 && off.commands.length > 0, `${level} has real paid inputs and commands`);
  assert.equal(on.oracleCalls > 0, true, 'commander must forward diagnostic options from match start');
  for (const result of [on, mutated]) {
    assert.equal(JSON.stringify(result.inputs), JSON.stringify(off.inputs), `${level}: private diagnostics cannot change native input bytes`);
    assert.deepEqual(result.commands, off.commands); assert.deepEqual(result.events, off.events);
  }
  assert.ok(on.inputs.every(entry => !(entry.responseEvents ?? []).some(event => Object.hasOwn(event, 'responseRequired'))), 'grading fields never enter hands');
  assert.ok(on.events.every(event => !Object.hasOwn(event, 'responseRequired')), 'public diagnostics contain runtime events only');
}
{
  const provenance = JSON.parse(readFileSync('./tools/ai-screen-v1-oracle-provenance.json', 'utf8'));
  const frozen = readFileSync('./tools/ai-screen-v1-oracle.js');
  const restored = frozen.toString().replace("from '../shared/sim.js'", "from './sim.js'").replace("from '../shared/alert-events.js'", "from './alert-events.js'");
  assert.equal(createHash('sha256').update(restored).digest('hex'), provenance.originalSHA256, 'oracle preserves the complete original detector, with only module paths changed');
  assert.equal(createHash('sha256').update(frozen).digest('hex'), provenance.frozenSHA256);
  assert.equal((await sourceCheckpoint(false)).files['tools/ai-screen-v1-oracle.js'], provenance.frozenSHA256);
}
{
  const directory = await mkdtemp(join(tmpdir(), 'human-ai-private-streams-'));
  try {
    const log = fixture(), metrics = summarizeSeat(log, 60);
    const report = { results: [{ mode: 'conquest', level: 'hard', seed: 1, seconds: 60, logs: [log], seats: [{ faction: 'USA', metrics }] }] };
    const bytes = Buffer.from(JSON.stringify(report) + '\n'), source = join(directory, 'full.json');
    await writeFile(source, bytes);
    const compact = await packageReport(source, join(directory, 'compact.json'), join(directory, 'raw.json.gz'));
    assert.deepEqual(gunzipSync(await readFile(join(directory, 'raw.json.gz'))), bytes, 'full raw archive retains exact native and private stream bytes');
    assert.deepEqual(compact.results[0].seats[0].metrics, metrics);
    assert.equal(compact.results[0].timelineDigests[0].measurementFrames, 1);
    assert.equal(compact.results[0].timelineDigests[0].measurementStreamSHA256,
      createHash('sha256').update(JSON.stringify(log.perceptionMeasurements)).digest('hex'));
    assert.equal(Object.hasOwn(compact.results[0], 'logs'), false);
  } finally { await rm(directory, { recursive: true, force: true }); }
}
console.log('Private measurement streams preserve original censored gates, separate observed scores, immutable mappings and native inputs at every level.');
