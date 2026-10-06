import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { createGame, command, step } from './shared/sim.js';
import { viewFor } from './shared/ai-view.js';
import { perceive, onScreen } from './shared/ai-perception.js';
import { createHands, queueCamera, advanceHands, enqueueDecision, cameraTravelCost, projectPointer } from './shared/ai-hands.js';
import { cameraTravelMode } from './shared/ai-commander.js';

// These short authored scenes compare native paid routes to the same useful attack-move.
// Their flat terrain and stationary actors do not reproduce a full recorded match.
export function nativeCameraRoute(scene, mode, engine = { createGame, command, step, viewFor, perceive, onScreen,
  createHands, queueCamera, advanceHands, enqueueDecision, cameraTravelCost, cameraTravelMode }) {
  const { createGame, command, step, viewFor, perceive, onScreen, createHands, queueCamera, advanceHands,
    enqueueDecision, cameraTravelCost, cameraTravelMode } = engine;
  const saved = Math.random; let rng = 1, game;
  const size = scene.mapSize ?? 200;
  try {
    Math.random = () => ((rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0) / 4294967296);
    game = createGame({ w: size, h: size, rows: Array(size).fill('.'.repeat(size)),
      spawns: [{ x: 20, y: 20 }, { x: size - 10, y: size - 10 }], points: [] },
    ['AI', 'enemy'], false, [0, 1], [0, 1], { weather: false });
  } finally { Math.random = saved; }
  game.units.clear(); game.players.forEach(p => p.mp = 500);
  for (const slot of [0, 1]) assert.equal(command(game, slot, { t: 'buy', unit: 'rifle' }), undefined);
  const [own, enemy] = [...game.units.values()];
  Object.assign(own, { x: scene.target.x, z: scene.target.z, holdFire: true, autoRetreat: false, auto: false });
  Object.assign(enemy, { x: scene.target.x + 15, z: scene.target.z, holdFire: true, autoRetreat: false, auto: false });
  game.tick = 1000;
  const state = { camera: { ...scene.camera } }, inputs = [], commands = [], frames = [];
  const hands = createHands({ slot: 0, level: 'hard', seed: 27, startedTick: 1000, camera: state.camera,
    log: inputs, calibration: scene.calibration });
  state.hands = hands; hands.openingDone = true; hands.openingUntil = 0;
  hands.cancelTargeting = scene.cancelTargeting === true;
  hands.inputTicks = [...(scene.paidHistory ?? [])];
  assert.equal(new Set(hands.inputTicks).size, hands.inputTicks.length, 'authored prior inputs have distinct paid ticks');
  for (const tick of hands.inputTicks) {
    assert.ok(tick <= 1000 && hands.inputTicks.filter(at => at <= tick && tick - at < 1200).length <= hands.skill.apm[1]);
    assert.ok(hands.inputTicks.filter(at => at <= tick && tick - at < 200).length <= Math.floor(hands.skill.peak / 6));
  }
  if (scene.pointer) Object.assign(hands.pointer, { ...scene.pointer, fromX: scene.pointer.x, fromY: scene.pointer.y,
    toX: scene.pointer.x, toY: scene.pointer.y });
  let observation = perceive(viewFor(game, 0, {}), 0, state, 1000);
  const rngBefore = structuredClone(hands.rng), before = structuredClone(hands.pointer);
  const estimate = cameraTravelCost(hands, scene.target, observation);
  const selectedMode = cameraTravelMode(state.camera, scene.target, false, hands, observation);
  assert.deepEqual(hands.rng, rngBefore, 'route comparison draws no timing or endpoint-error samples');
  assert.deepEqual(hands.pointer, before, 'route comparison leaves the native pointer where it was');
  const context = { concern: 'authored-visible-contact-return', concernKind: 'combat', cycle: 1,
    event: { id: 'authored-contact', kind: 'screen-contact', source: 'screen', onScreen: true,
      x: enemy.x, z: enemy.z, targetId: enemy.id },
    eventTick: 990, reactionStartTick: 990, responseActorIds: [own.id], responseTarget: scene.target };
  assert.equal(queueCamera(hands, scene.target, context, mode ?? selectedMode), true);
  let queued = false, cameraDoneTick = null;
  for (let tick = 1000; tick <= (scene.until ?? 1120); tick++) {
    game.tick = tick;
    if (tick % 2 === 0) observation = perceive(viewFor(game, 0, {}), 0, state, tick);
    advanceHands(hands, tick, observation, cmd => {
      const rejection = command(game, 0, cmd);
      commands.push({ tick, command: structuredClone(cmd), rejection: rejection ?? null,
        actualSelected: [...hands.selected], camera: { ...hands.camera },
        actorOnScreen: onScreen(own, hands.camera, observation), enemyOnScreen: onScreen(enemy, hands.camera, observation) });
      return rejection;
    });
    frames.push({ tick, camera: { ...hands.camera }, active: hands.active?.actions[hands.active.index]?.kind ?? null,
      screenIds: [...observation.screenIds] });
    if (!queued && hands.ready && inputs.length) {
      cameraDoneTick = tick;
      assert.ok(onScreen(own, hands.camera, observation) && onScreen(enemy, hands.camera, observation),
        'the real completed camera placement frames both intended actor and observed contact');
      assert.ok(enqueueDecision(hands, { t: 'amove', orders: [[own.id, enemy.x, enemy.z]] }, observation, context));
      queued = true;
    }
    if (commands.length) break;
    step(game);
  }
  assert.equal(commands.length, 1, 'one native physical response dispatches one command');
  assert.equal(commands[0].rejection, null);
  assert.deepEqual(commands[0].actualSelected, [own.id], 'the noisy physical selection hits the real actor');
  assert.ok(commands[0].actorOnScreen && commands[0].enemyOnScreen);
  assert.ok(own.path.length && own.amove, 'the accepted attack-move changes the actor path towards the contact');
  for (const input of inputs) assert.ok(input.tick >= input.inputStartedTick + input.motorTicks,
    'every physical selection, key, pointer and camera gesture pays its full motor before any cap-delayed dispatch');
  const allPaidTicks = [...(scene.paidHistory ?? []), ...inputs.map(input => input.tick)];
  for (const input of inputs) {
    assert.ok(allPaidTicks.filter(at => at <= input.tick && input.tick - at < 1200).length <= hands.skill.apm[1]);
    assert.ok(allPaidTicks.filter(at => at <= input.tick && input.tick - at < 200).length <= Math.floor(hands.skill.peak / 6));
  }
  assert.deepEqual(hands.inputTicks, [...(scene.paidHistory ?? []), ...inputs.map(input => input.tick)]
    .filter(at => hands.tick - at < 1200), 'every completed actual input retains its native rolling APM accounting');
  const cameraInputs = inputs.filter(row => row.kind.startsWith('camera-'));
  if (cameraInputs[0].method === 'minimap') {
    assert.equal(cameraInputs.length, 1);
    assert.equal(cameraInputs[0].input.button, 0, 'the camera arrives through the actual left-click path');
    assert.ok(Math.hypot(hands.camera.x - scene.target.x, hands.camera.z - scene.target.z) > 1e-6,
      'native minimap endpoint noise survives route selection');
  }
  return { scene, requestedMode: mode ?? null, selectedMode, estimate, cameraDoneTick, inputs, commands, frames };
}

const close = { name: 'close-pan', camera: { x: 100, z: 100, yaw: 0, distance: 60 }, target: { x: 112, z: 100 } };
const moderate = { name: 'moderate-cardinal', camera: { x: 100, z: 100, yaw: 0, distance: 60 }, target: { x: 190, z: 100 } };
const diagonal = { name: 'moderate-rotated', camera: { x: 105.89822946627363, z: 78.03875718572421, yaw: 3.1266683885997084, distance: 60 },
  target: { x: 71.2, z: 39.1 } };
// Original Hard180 seed1/slot1 queue2188 supplied these public coordinates and last paid pointer.
// This comparison authors stationary actors there and uses seed27, rather than replaying that match's RNG state.
const recorded = { name: 'recorded-geometry-fight-return', mapSize: 80,
  camera: { x: 23.436302526756975, z: 118.38179962373302, yaw: -1.0201207758826454, distance: 60 },
  target: { x: 101.96666666666665, z: 58.800000000000004 },
  pointer: { x: 619.4472306226171, y: 182.80849189869753 } };
const near = nativeCameraRoute(close), before = nativeCameraRoute(moderate, 'pan'), after = nativeCameraRoute(moderate),
  diagonalBefore = nativeCameraRoute(diagonal, 'pan'), diagonalAfter = nativeCameraRoute(diagonal),
  recordedBefore = nativeCameraRoute(recorded, 'pan'), recordedAfter = nativeCameraRoute(recorded);
assert.equal(near.selectedMode, 'pan');
for (const scene of [moderate, diagonal, recorded]) assert.equal(cameraTravelMode(scene.camera, scene.target), 'pan',
  'these comparisons exercise destinations reached by pan under the original distance-based API');
assert.equal(after.selectedMode, 'minimap');
assert.equal(diagonalAfter.selectedMode, 'minimap');
for (const [pan, click] of [[before, after], [diagonalBefore, diagonalAfter], [recordedBefore, recordedAfter]]) {
  assert.deepEqual(pan.scene, click.scene, 'both native alternatives receive exactly the same scene and destination');
  assert.ok(click.cameraDoneTick < pan.cameraDoneTick, 'the actual minimap click completes a useful frame sooner');
  assert.ok(click.commands[0].tick <= pan.commands[0].tick,
    'full pointer return and actor selection remain included when comparing the useful accepted order');
}
assert.ok(after.commands[0].tick < before.commands[0].tick,
  'the longer native pan loses time through an earlier useful accepted order');
assert.deepEqual(nativeCameraRoute(moderate), after, 'the native route remains deterministic for the same scene and seed');
const geometryOnly = { w: 200, h: 200 };
for (const name of ['units', 'players', 'events', 'height', 'flags']) Object.defineProperty(geometryOnly, name,
  { get: () => assert.fail(`route cost cannot read ${name}`) });
const publicHands = createHands({ slot: 0, level: 'hard', seed: 27, camera: { ...close.camera } });
assert.equal(cameraTravelMode(publicHands.camera, close.target, false, publicHands, geometryOnly), 'pan');
Object.assign(publicHands.pointer, projectPointer(close.target, publicHands.camera, geometryOnly, { minimap: true }));
assert.equal(cameraTravelMode(publicHands.camera, close.target, false, publicHands, geometryOnly), 'minimap',
  'the same nearby destination can use the click when the actual pointer is already there');
assert.equal(cameraTravelMode(close.camera, close.target, true, null, null), 'alert',
  'public alerts retain the current native Space path');
const budgetScene = { name: 'one-minute-slot', camera: { x: 100, z: 100, yaw: 0, distance: 60 },
  target: { x: 190, z: 190 }, calibration: { pointer: [.3, .3] },
  paidHistory: Array.from({ length: 119 }, (_, index) => index * 8), until: 1500 };
const budget = nativeCameraRoute(budgetScene), budgetMinimap = nativeCameraRoute(budgetScene, 'minimap');
assert.equal(budget.selectedMode, 'minimap', 'a pending second key is compared with the actual minute-slot wait');
assert.equal(budget.estimate.panMotorTicks, 32); assert.equal(budget.estimate.minimapMotorTicks, 46);
assert.equal(budget.estimate.panTicks, 230); assert.equal(budget.estimate.minimapTicks, 46);
assert.deepEqual(budget.inputs, budgetMinimap.inputs, 'budget-aware choice preserves the complete ordinary minimap timeline');
assert.deepEqual(budget.commands, budgetMinimap.commands, 'the same actual useful accepted order survives the route correction');
const peakScene = { ...budgetScene, name: 'second-key-peak-expiry',
  paidHistory: Array.from({ length: 32 }, (_, index) => 810 + index * 5) };
const peak = nativeCameraRoute(peakScene), peakPan = nativeCameraRoute(peakScene, 'pan');
assert.equal(peak.selectedMode, 'pan', 'a soon-expiring peak slot can still make the actual held route cheaper');
assert.equal(peak.estimate.panTicks, 40);
assert.deepEqual(peak.inputs, peakPan.inputs);
assert.equal(peak.inputs.filter(input => input.kind === 'camera-pan')[1].inputStartedTick, 1010,
  'the actual second key waits for the same public input-history expiry projected by the estimate');
const fullScene = { ...budgetScene, name: 'full-minute-budget',
  paidHistory: Array.from({ length: 120 }, (_, index) => index * 8) };
const full = nativeCameraRoute(fullScene), fullMinimap = nativeCameraRoute(fullScene, 'minimap');
assert.equal(full.selectedMode, 'minimap');
assert.equal(full.estimate.panTicks, 238); assert.equal(full.estimate.minimapTicks, 200);
assert.equal(full.cameraDoneTick, 1200, 'a completed click still waits for a real input slot before camera arrival');
assert.deepEqual(full.inputs, fullMinimap.inputs);
assert.deepEqual(full.commands, fullMinimap.commands);
const cancelScene = { ...budgetScene, name: 'cancel-then-one-minute-slot', cancelTargeting: true,
  paidHistory: Array.from({ length: 118 }, (_, index) => index * 8) };
const cancel = nativeCameraRoute(cancelScene), cancelMinimap = nativeCameraRoute(cancelScene, 'minimap');
assert.equal(cancel.selectedMode, 'minimap', 'the shared paid Escape consumes its real slot before camera comparison');
assert.equal(cancel.inputs[0].input.code, 'Escape');
assert.equal(cancel.estimate.panTicks, 230); assert.equal(cancel.estimate.minimapTicks, 48);
assert.deepEqual(cancel.inputs, cancelMinimap.inputs);
assert.deepEqual(cancel.commands, cancelMinimap.commands);
const cancelEmptyScene = { ...budgetScene, name: 'cancel-then-diagonal-empty-budget', cancelTargeting: true, paidHistory: [] };
const cancelEmpty = nativeCameraRoute(cancelEmptyScene), cancelEmptyMinimap = nativeCameraRoute(cancelEmptyScene, 'minimap');
assert.equal(cancelEmpty.selectedMode, 'pan', 'the real empty-budget held route remains cheaper after its paid Escape');
assert.deepEqual(cancelEmpty.inputs.slice(0, 3).map(input => input.input.code), ['Escape', 'KeyD', 'KeyS'],
  'the paid cancel prefix neither repeats nor skips a held direction');
assert.equal(cancelEmpty.cameraDoneTick, 1034);
assert.ok(Math.hypot(cancelEmpty.commands[0].camera.x - cancelEmpty.scene.target.x,
  cancelEmpty.commands[0].camera.z - cancelEmpty.scene.target.z) < 3.5,
  'both native quantized axes finish at the intended destination after the cancel prefix');
assert.ok(cancelEmpty.cameraDoneTick < cancelEmptyMinimap.cameraDoneTick);
assert.ok(cancelEmpty.commands[0].tick < cancelEmptyMinimap.commands[0].tick,
  'the corrected native held route also completes the same useful accepted response sooner');
const cancelReservedScene = { ...budgetScene, name: 'cancel-then-first-key-reservation', cancelTargeting: true };
const cancelReservedPan = nativeCameraRoute(cancelReservedScene, 'pan');
assert.deepEqual(cancelReservedPan.inputs.slice(0, 3).map(input => input.input.code), ['Escape', 'KeyD', 'KeyS']);
assert.equal(cancelReservedPan.inputs[1].inputStartedTick, 1200,
  'Escape fills the last slot, so the first held key waits for a real minute-slot expiry');
assert.equal(cancelReservedPan.inputs[2].inputStartedTick, 1208,
  'the second held key reserves its own ordinary slot while the first remains held');
assert.equal(cancelReservedPan.cameraDoneTick, 1238);
assert.equal(cancelReservedPan.estimate.panTicks, cancelReservedPan.cameraDoneTick - 1000);
const cancelPeakScene = { ...peakScene, name: 'cancel-then-peak-expiry', cancelTargeting: true };
const cancelPeak = nativeCameraRoute(cancelPeakScene), cancelPeakMinimap = nativeCameraRoute(cancelPeakScene, 'minimap');
assert.equal(cancelPeak.selectedMode, 'pan');
assert.equal(cancelPeak.inputs[1].inputStartedTick, 1010);
assert.equal(cancelPeak.inputs[2].inputStartedTick, 1015);
assert.equal(cancelPeak.cameraDoneTick, 1045);
assert.equal(cancelPeak.estimate.panTicks, 45);
assert.ok(cancelPeak.cameraDoneTick < cancelPeakMinimap.cameraDoneTick);
const cancelFullScene = { ...fullScene, name: 'cancel-then-full-minute-budget', cancelTargeting: true };
const cancelFull = nativeCameraRoute(cancelFullScene), cancelFullMinimap = nativeCameraRoute(cancelFullScene, 'minimap');
assert.equal(cancelFull.selectedMode, 'pan', 'an equal-cost route keeps the ordinary held-gesture tie preference');
assert.equal(cancelFull.inputs[0].tick, 1200);
assert.equal(cancelFull.inputs[1].inputStartedTick, 1208);
assert.equal(cancelFull.inputs[2].inputStartedTick, 1216);
assert.equal(cancelFull.cameraDoneTick, 1246);
assert.equal(cancelFull.estimate.panTicks, 246);
assert.equal(cancelFull.estimate.minimapTicks, 246);
assert.equal(cancelFull.cameraDoneTick, cancelFullMinimap.cameraDoneTick);
if (process.env.AI_CAMERA_COST_PROOF) await writeFile(process.env.AI_CAMERA_COST_PROOF,
  JSON.stringify({ schema: 'ai-camera-route-cost-native-proof-v1', diagnosticOnly: true,
    near, before, after, diagonalBefore, diagonalAfter, recordedBefore, recordedAfter,
    budget, budgetMinimap, peak, peakPan, full, fullMinimap, cancel, cancelMinimap,
    cancelEmpty, cancelEmptyMinimap, cancelReservedPan, cancelPeak, cancelPeakMinimap, cancelFull, cancelFullMinimap }, null, 2));
console.log(JSON.stringify({ closePan: near.cameraDoneTick,
  cardinal: { panCamera: before.cameraDoneTick, minimapCamera: after.cameraDoneTick,
    panOrder: before.commands[0].tick, minimapOrder: after.commands[0].tick },
  diagonal: { panCamera: diagonalBefore.cameraDoneTick, minimapCamera: diagonalAfter.cameraDoneTick,
    panOrder: diagonalBefore.commands[0].tick, minimapOrder: diagonalAfter.commands[0].tick },
  recordedGeometry: { panCamera: recordedBefore.cameraDoneTick, minimapCamera: recordedAfter.cameraDoneTick,
    panOrder: recordedBefore.commands[0].tick, minimapOrder: recordedAfter.commands[0].tick },
  minuteBudget: { mode: budget.selectedMode, estimate: budget.estimate,
    camera: budget.cameraDoneTick, order: budget.commands[0].tick },
  peakBudget: { mode: peak.selectedMode, camera: peak.cameraDoneTick, order: peak.commands[0].tick },
  fullBudget: { mode: full.selectedMode, camera: full.cameraDoneTick, order: full.commands[0].tick },
  cancelBudget: { mode: cancel.selectedMode, camera: cancel.cameraDoneTick, order: cancel.commands[0].tick },
  cancelEmpty: { mode: cancelEmpty.selectedMode, camera: cancelEmpty.cameraDoneTick, order: cancelEmpty.commands[0].tick,
    minimapCamera: cancelEmptyMinimap.cameraDoneTick, minimapOrder: cancelEmptyMinimap.commands[0].tick },
  cancelReservedPan: { camera: cancelReservedPan.cameraDoneTick, order: cancelReservedPan.commands[0].tick } }));
