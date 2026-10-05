import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createGame, command } from './shared/sim.js';
import { viewFor } from './shared/ai-view.js';
import { perceive, onScreen } from './shared/ai-perception.js';
import { createHands, queueCamera, advanceHands, interruptHands } from './shared/ai-hands.js';
import { think } from './shared/ai.js';
import { perceive as frozenOracle } from './tools/ai-screen-v1-oracle.js';
import { createPublicAlertCapture, scorePublicAlerts, poolPublicAlerts, publicAlertKM, publicAlertOnScreen, classifyPublicAlert } from './tools/ai-public-alert-response.mjs';
const map = { w: 160, h: 160, rows: Array(160).fill('.'.repeat(160)), heights: Array(160).fill('0'.repeat(160)), spawns: [{ x: 20, y: 20 }, { x: 75, y: 75 }], points: [] };
function game() {
  const g = createGame(map, ['AI', 'enemy'], false, [0, 1], [0, 1], { weather: false });
  g.units.clear(); g.players[0].mp = 5000;
  for (let i = 0; i < 2; i++) assert.equal(command(g, 0, { t: 'buy', unit: 'rifle' }), undefined);
  const own = [...g.units.values()];
  own.forEach((u, i) => Object.assign(u, { x: i ? 280 : 190, z: i ? 45 : 200, holdFire: true, auto: false, autoRetreat: false }));
  return { g, own };
}
function hurt(f, i) {
  const u = f.own[i]; u.hp *= .6;
  f.g.shots = [{ t: u.id, to: 0, fo: 1, x: u.x, z: u.z, k: 'hurt', kill: false }];
}
function retain(log, state) {
  for (const e of state.events ?? []) if (!log.events.some(old => old.id === e.id && old.tick === e.tick)) log.events.push(structuredClone(e));
}
function cameraCase(mode = 'alert', control = 'normal', recording = true) {
  const oldRandom = Math.random; let f;
  try { Math.random = () => .25; f = game(); } finally { Math.random = oldRandom; }
  const log = { events: [], inputs: [] }, memory = { human: { camera: { x: 80, z: 80, yaw: 0, distance: 60 } } };
  if (control.startsWith('pan-axis')) f.own[0].x = 80;
  if (control === 'pan-axis-canceled') f.own[0].z = 150;
  if (control.endsWith('early-public-emergency')) {
    assert.equal(command(f.g, 0, { t: 'buy', unit: 'rifle' }), undefined);
    const actor = [...f.g.units.values()].at(-1); Object.assign(actor, { x: 80, z: 80, holdFire: true }); f.own.push(actor);
  }
  const state = memory.human, capture = recording ? createPublicAlertCapture({ slot: 0, log, memory }) : null;
  state.hands = createHands({ slot: 0, seed: 27, camera: state.camera,
    log: input => { log.inputs.push(structuredClone(input)); capture?.input(log.inputs.at(-1), log.inputs.length - 1); } });
  const measurements = capture?.wrapMeasurements();
  const motion = [];
  let view, original, retargeted = false, interrupted = false;
  for (let tick = 0; tick <= 140; tick++) {
    f.g.tick = tick;
    if (tick === 40 && control !== 'eventless') hurt(f, 0);
    if (tick === 48 && control.endsWith('early-public-emergency')) hurt(f, 2);
    if (control === 'retargeted' && state.hands.active && !retargeted) { hurt(f, 1); retargeted = true; }
    if (tick % 2 === 0 || retargeted && f.g.shots.length) {
      view = perceive(viewFor(f.g, 0, {}), 0, state, tick, measurements); retain(log, state); f.g.shots = [];
    }
    if (tick === 48 && control.endsWith('early-public-emergency')) {
      const emergency = view.events.find(e => e.kind === 'screen-damage' && e.unitId === f.own[2].id && e.tick === tick);
      assert.ok(emergency?.onScreen, 'the interrupt has an actual immutable public screen-damage cause');
      assert.equal(interruptHands(state.hands, tick, view, { event: emergency }), false);
    }
    advanceHands(state.hands, tick, view, cmd => command(f.g, 0, cmd));
    if (tick === 40 && control !== 'eventless') {
      original = log.events.find(e => e.source === 'alert');
      assert.equal(original?.onScreen, false, 'an authored enemy hurt-shot cue creates a native off-screen danger alert');
      assert.equal(onScreen(original, state.camera, view), false);
      const linked = control === 'wrong-cause' ? { ...original, id: 'unrelated' } : original;
      assert.equal(queueCamera(state.hands, control === 'outside' ? { x: 400, z: 400 } : original, { event: linked, eventTick: original.tick, concern: 'fixture' }, mode), true);
      if (control === 'pan-budget-refused') state.hands.inputTicks = Array(state.hands.skill.apm[1]).fill(tick);
    }
    capture?.afterThink(tick);
    if (mode === 'pan' && original && (state.camera.x !== 80 || state.camera.z !== 80)) {
      motion.push({ tick, camera: { ...state.camera }, onScreen: onScreen(original, state.camera, view), completions: log.inputs.length });
      if (['pan-axis-interrupted', 'pan-partial-interrupted', 'pan-both-held-interrupted'].includes(control) && state.hands.active && !interrupted
        && (control !== 'pan-both-held-interrupted' || state.hands.active.panKeys?.length === 2
          && state.hands.active.panKeys.every(key => tick >= key.down))) {
        interruptHands(state.hands, tick, view); interrupted = true;
      }
    }
    if (control === 'pan-axis-canceled' && state.hands.active?.reacting && !interrupted) {
      assert.equal(interruptHands(state.hands, tick, view), true, 'native interruption cancels a waiting pan before its motor starts'); interrupted = true;
    }
    if (control === 'interrupted' && state.hands.active && !interrupted) {
      interruptHands(state.hands, tick, view); interrupted = true;
    }
  }
  capture?.finish(f.g.tick);
  return { log, score: capture ? scorePublicAlerts(log) : null, original, state, motion };
}
const alert = cameraCase();
assert.equal(alert.score.evaluable, true);
assert.equal(alert.score.samples.filter(s => s.observed).length, 1);
assert.equal(alert.log.inputs[0].input.code, 'Space', 'the native alert recipe pays a Space key input');
assert.ok(alert.log.inputs[0].motorTicks > 0);
assert.ok(alert.log.inputs[0].tick > alert.log.inputs[0].inputStartedTick);
const minimap = cameraCase('minimap');
assert.equal(minimap.score.samples.filter(s => s.observed).length, 1);
assert.equal(minimap.log.inputs[0].input.button, 0, 'the native minimap recipe pays a left click');
const pan = cameraCase('pan', 'pan-axis');
assert.equal(pan.score.evaluable, true);
assert.equal(pan.score.samples[0].observed, true, 'a paid native axis pan can finish on the original alert');
assert.equal(pan.log.inputs[0].input.code, 'KeyS');
assert.equal(pan.score.requiredPopulation[0].completedTick, pan.log.inputs[0].tick);
assert.ok(pan.motion.some(row => row.onScreen && row.tick < pan.log.inputs[0].tick && row.completions === 0),
  'continuous native motion can expose the marker before its paid arrival completes, without an early answer');
const partialPan = cameraCase('pan');
assert.equal(partialPan.log.inputs.length, 2, 'the diagonal route pays both actual pan keys');
assert.ok(partialPan.log.alertMeasurements.completions.every(row => row.applied));
assert.equal(partialPan.log.alertMeasurements.panGestureVersion, 3);
assert.equal(partialPan.score.samples[0].observed, true, 'the paid concurrent diagonal route reaches the original marker');
assert.equal(partialPan.score.audit.rejectedReceipts, 0, 'actual overlapping hold intervals validate the native end pose');
assert.equal(partialPan.score.evaluable, true);
for (const field of ['axis', 'down']) {
  const changed = structuredClone(partialPan.log);
  const key = changed.alertMeasurements.completions[0].panMotion.keys[0];
  if (field === 'axis') key.axis.x += .25; else key.down--;
  assert.equal(scorePublicAlerts(changed).evaluable, false, 'copied or altered hold intervals lack native capture provenance');
}
assert.ok(partialPan.log.alertMeasurements.starts[1].startedTick < partialPan.log.inputs[0].tick,
  'both ordinary held directions overlap after separately paid preparation');
const interruptedPan = cameraCase('pan', 'pan-axis-interrupted');
assert.equal(interruptedPan.log.inputs.length, 1, 'native held pan motion finishes its gesture after an interruption request');
assert.equal(interruptedPan.log.alertMeasurements.completions[0].stopAfterInput, true);
assert.equal(interruptedPan.score.samples[0].observed, true, 'stopping after a useful completed held pan retains its actual response');
assert.equal(interruptedPan.score.requiredPopulation[0].completedTick, interruptedPan.log.inputs[0].tick);
const canceledPan = cameraCase('pan', 'pan-axis-canceled');
assert.equal(canceledPan.log.inputs.length, 0);
assert.equal(canceledPan.log.alertMeasurements.starts.length, 0);
assert.equal(canceledPan.score.samples[0].observed, false, 'a canceled native waiting pan has no completed response');
const interruptedPartialPan = cameraCase('pan', 'pan-partial-interrupted');
assert.equal(interruptedPartialPan.log.inputs.length, 1);
assert.equal(interruptedPartialPan.log.alertMeasurements.completions[0].stopAfterInput, true);
assert.equal(interruptedPartialPan.score.samples[0].observed, false, 'a completed interrupted diagonal pan still leaves its original marker off screen');
const bothHeldPan = cameraCase('pan', 'pan-both-held-interrupted');
assert.equal(bothHeldPan.log.inputs.length, 2, 'an interruption after both presses preserves both real releases');
assert.ok(bothHeldPan.log.alertMeasurements.completions.every(row => row.stopAfterInput));
assert.equal(bothHeldPan.score.evaluable, true);
assert.equal(bothHeldPan.score.samples[0].observed, true, 'the genuine completed arrival retains its original causal response');
const earlyPan = cameraCase('pan', 'pan-early-public-emergency');
assert.equal(earlyPan.log.inputs.length, 2);
assert.ok(earlyPan.log.inputs.every(row => row.panRelease && row.tick < row.panRelease.plannedUpTick));
assert.equal(earlyPan.log.alertMeasurements.interrupts.length, 2);
assert.ok(earlyPan.log.alertMeasurements.interrupts.every(row => row.registeredAtTick === row.release.requestedTick
  && row.actualDeliveredCause.kind === 'screen-damage'));
assert.equal(earlyPan.score.evaluable, true);
assert.equal(earlyPan.score.samples[0].observed, false, 'truthful early keyups do not answer an original off-screen marker that remains outside');
assert.equal(earlyPan.score.audit.rejectedReceipts, 2, 'paid releases are retained without manufacturing an arrival');
const earlyCardinalPan = cameraCase('pan', 'pan-axis-early-public-emergency');
assert.equal(earlyCardinalPan.log.inputs.length, 1);
assert.ok(earlyCardinalPan.log.inputs[0].panRelease);
assert.equal(earlyCardinalPan.score.evaluable, true);
assert.equal(earlyCardinalPan.score.samples[0].observed, false, 'an early cardinal release also preserves the unreached original alert censor');
if (process.env.AI_RELEASE_ALERT_PROOF) await writeFile(process.env.AI_RELEASE_ALERT_PROOF, JSON.stringify({ diagnosticOnly: true, earlyPan, earlyCardinalPan }, (_key, value) => typeof value === 'function' ? undefined : value instanceof Map ? [...value] : value instanceof Set ? [...value] : value, 2));
const budgetRefusedPan = cameraCase('pan', 'pan-budget-refused');
assert.equal(budgetRefusedPan.log.inputs.length, 0, 'an exhausted budget starts no held direction');
assert.equal(budgetRefusedPan.log.alertMeasurements.starts.length, 0);
assert.equal(budgetRefusedPan.score.samples[0].observed, false, 'a waiting budget cannot manufacture a completed alert response');
assert.equal(budgetRefusedPan.score.evaluable, true);
const unrecordedPan = cameraCase('pan', 'pan-axis', false);
const publicState = state => JSON.parse(JSON.stringify(state, (_key, value) => typeof value === 'function' ? undefined : value instanceof Map ? [...value] : value instanceof Set ? [...value] : value));
assert.deepEqual(publicState(pan.state), publicState(unrecordedPan.state), 'pan capture places no proof or altered native state into the commander');
assert.deepEqual(pan.log.inputs, unrecordedPan.log.inputs);
assert.deepEqual(pan.log.events, unrecordedPan.log.events);
assert.deepEqual(pan.motion, unrecordedPan.motion);
const retargeted = cameraCase('alert', 'retargeted');
assert.equal(retargeted.log.inputs[0].method, 'alert');
assert.ok(Math.hypot(retargeted.log.inputs[0].camera.x - retargeted.original.x, retargeted.log.inputs[0].camera.z - retargeted.original.z) > 100);
assert.equal(retargeted.score.samples.filter(s => s.observed).length, 0, 'retargeted Space cannot answer the original causal alert');
assert.equal(retargeted.score.samples.filter(s => !s.observed).length, 2);
const interrupted = cameraCase('minimap', 'interrupted');
assert.equal(interrupted.log.inputs.length, 0, 'interrupting the actual native approach produces no completion');
assert.equal(interrupted.score.samples[0].observed, false);
const outside = cameraCase('minimap', 'outside');
assert.equal(outside.log.inputs.length, 1, 'a failed native camera attempt still emits its input');
assert.equal(outside.log.alertMeasurements.completions[0].applied, false);
assert.equal(outside.score.samples[0].observed, false, 'a native completion log before camera application is not a response');
assert.equal(cameraCase('minimap', 'wrong-cause').score.samples[0].observed, false);
const eventless = cameraCase('alert', 'eventless');
assert.equal(eventless.score.evaluable, true);
assert.equal(poolPublicAlerts([eventless.score], 'normal').gate, 'unknown');
assert.equal(poolPublicAlerts([eventless.score], 'normal').eventlessSeats, 1);
const emptyLog = { events: [], inputs: [] }, emptyCapture = createPublicAlertCapture({ slot: 0, log: emptyLog, memory: {} });
emptyCapture.afterThink(0); emptyCapture.finish(0);
assert.equal(scorePublicAlerts(emptyLog).evaluable, false, 'absence of native perception cannot establish eventless coverage');
assert.equal(scorePublicAlerts(structuredClone(alert.log)).recorded, false, 'deserialized historical or fabricated logs cannot acquire live native provenance');
const altered = cameraCase();
altered.log.inputs[0].inputStartedTick = altered.log.inputs[0].tick;
assert.equal(scorePublicAlerts(altered.log).evaluable, false, 'a fabricated zero-duration endpoint cannot pass');
const damagedGeometry = structuredClone(alert.log.alertMeasurements.creations[0].geometry);
damagedGeometry.cells.pop();
assert.equal(publicAlertOnScreen(damagedGeometry), null, 'missing public terrain coverage stays unknown');
assert.equal(classifyPublicAlert({ ...alert.original, kind: 'ready' }), 'informational');
assert.equal(classifyPublicAlert({ ...alert.original, kind: 'pointWon' }), 'informational');
assert.equal(classifyPublicAlert({ ...alert.original, kind: 'event' }), 'unknown');
assert.equal(publicAlertKM([{ seconds: 1, observed: true }, { seconds: 1, observed: false }]).medianSeconds, 1);
assert.equal(publicAlertKM([{ seconds: 1, observed: false }, { seconds: 2, observed: false }]).medianSeconds, null);
assert.equal(poolPublicAlerts([alert.score, { recorded: false, evaluable: false, samples: [] }], 'normal').gate, 'unknown');
// The real default commander receives identical public scenes, independent of the tool observer.
function defaultCommander(recording) {
  const oldRandom = Math.random; let n = 777;
  Math.random = () => ((n = (Math.imul(n, 1664525) + 1013904223) >>> 0) / 4294967296);
  try {
    const f = game(), memory = { human: { startedTick: 0, camera: { x: 80, z: 80, yaw: 0, distance: 60 } } };
    const oracleFrames = [], baseMeasurements = { measureRaw: frozenOracle, onMeasurements: payload => oracleFrames.push(structuredClone(payload)) };
    const log = { events: [], inputs: [], commands: [] }, capture = recording ? createPublicAlertCapture({ slot: 0, log, memory }) : null;
    let view;
    for (let tick = 0; tick <= 180; tick++) {
      f.g.tick = tick;
      if (tick === 40) hurt(f, 0);
      if (tick % 2 === 0) view = viewFor(f.g, 0, {});
      think(f.g, 0, { memory, view, seed: 27, level: 'normal',
        perceptionMeasurements: capture ? capture.wrapMeasurements(baseMeasurements) : baseMeasurements,
        inputLog: input => { log.inputs.push(structuredClone(input)); capture?.input(log.inputs.at(-1), log.inputs.length - 1); },
        submit: cmd => { const result = command(f.g, 0, cmd); log.commands.push({ tick, cmd: structuredClone(cmd), result }); return result; } });
      retain(log, memory.human); capture?.afterThink(tick);
      if (tick % 2 === 0) f.g.shots = [];
    }
    capture?.finish(f.g.tick);
    const replacer = (_k, v) => typeof v === 'function' ? undefined : v instanceof Map ? [...v] : v instanceof Set ? [...v] : v;
    return { inputs: log.inputs, commands: log.commands, events: log.events, oracleFrames,
      memory: JSON.parse(JSON.stringify(memory, replacer)), game: JSON.parse(JSON.stringify(f.g, replacer)), rng: n,
      ...(capture ? { score: scorePublicAlerts(log) } : {}) };
  } finally { Math.random = oldRandom; }
}
const baseline = defaultCommander(false), measured = defaultCommander(true);
const { score: nativeScore, ...same } = measured;
assert.deepEqual(same, baseline, 'tool capture changes no native default input, command, perception graph, simulation state or RNG');
assert.ok(nativeScore.rawAlerts.some(e => e.source === 'alert' && e.onScreen === false));
console.log(JSON.stringify({ schema: 'ww2-public-alert-focused-proof-v1', nativeSpace: alert.log.inputs[0], nativeMinimap: minimap.log.inputs[0], nativePan: pan.log.inputs[0],
  panArrival: pan.score.requiredPopulation[0], concurrentPanArrival: partialPan.score.samples, completedInterruptedPan: interruptedPan.score.samples, canceledPanCensored: canceledPan.score.samples, interruptedPartialPanCensored: interruptedPartialPan.score.samples, panCaptureIsolation: true,
  retargeted: retargeted.score.audit, interruptedCensored: interrupted.score.samples, defaultCommander: { thinkCalls: 181, simulationSteps: 0, inputs: baseline.inputs.length,
    commands: baseline.commands.length, rawAlerts: nativeScore.rawAlerts.length, equality: true, score: nativeScore }, checks: 'PASS' }));
