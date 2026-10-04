import assert from 'node:assert/strict';
import { CELL, CFG, UNITS, TRENCH } from './shared/sim.js';
import { PerspectiveCamera, Vector3 } from 'three';
import { createHands, enqueueDecision, queueCamera, advanceHands, HUMAN_SKILLS, diagnostics, projectPointer, unprojectPointer, fittsMovement, groundClickable, interruptHands } from './shared/ai-hands.js';
import { HUMAN_CAMERA } from './shared/ai-perception.js';
import { formation } from './shared/formation.js';
import { createRng, random } from './shared/ai-rng.js';

const fixture = () => ({ tick: 0, w: 200, h: 200, winner: null, flags: Array(40000).fill(0),
  players: [{ out: false }], units: new Map([
    [1, { id: 1, type: 'rifle', owner: 0, x: 100, z: 100 }],
    [2, { id: 2, type: 'mg', owner: 0, x: 104, z: 100 }],
    [3, { id: 3, type: 'tank', owner: 0, x: 350, z: 350 }],
    [4, { id: 4, type: 'rifle', owner: 1, x: 105, z: 103 }],
  ]) });
const run = (hands, view, until, send = () => {}) => {
  for (let tick = hands.tick; tick <= until; tick++) {
    view.tick = tick; advanceHands(hands, tick, view, send);
  }
};

{
  const view = fixture();
  for (const yaw of [0, 0.7, -1.2]) for (const level of [0, 2]) for (const dist of [HUMAN_CAMERA.distance, 85]) {
    view.height = Array(view.w * view.h).fill(level);
    const camera = { x: 100, z: 100, yaw, distance: dist }, pitch = 0.95;
    const rendererCamera = new PerspectiveCamera(42, 1920 / 1080, 1, 2200);
    rendererCamera.position.set(camera.x + Math.sin(yaw) * dist * Math.cos(pitch), level * CFG.levelHeight + dist * Math.sin(pitch),
      camera.z + Math.cos(yaw) * dist * Math.cos(pitch));
    rendererCamera.lookAt(camera.x, level * CFG.levelHeight, camera.z); rendererCamera.updateMatrixWorld();
    for (const at of [{ x: 100, z: 100 }, { x: 112, z: 115 }, { x: 80, z: 73 }]) {
      for (const elevation of [0, 1]) {
        const actual = new Vector3(at.x, level * CFG.levelHeight + elevation, at.z).project(rendererCamera);
        const pointer = projectPointer(at, camera, view, { elevation });
        assert.ok(Math.abs(pointer.x - (actual.x + 1) * 1920 / 2) < 1e-8, 'pointer projection matches the client Three camera in CSS pixels');
        assert.ok(Math.abs(pointer.y - (1 - actual.y) * 1080 / 2) < 1e-8);
      }
      const click = projectPointer(at, camera, view), ground = unprojectPointer(click, camera, view);
      assert.ok(Math.hypot(ground.x - at.x, ground.z - at.z) < 1e-8, 'a ground screen click round trips through camera projection');
      const minimapClick = projectPointer(at, camera, view, { minimap: true });
      const minimapGround = unprojectPointer(minimapClick, camera, view, { minimap: true });
      assert.ok(Math.hypot(minimapGround.x - at.x, minimapGround.z - at.z) < 1e-8, 'rotated minimap CSS pixels round trip to world coordinates');
    }
  }
  const skill = HUMAN_SKILLS.normal, from = { x: 960, y: 540 };
  assert.ok(fittsMovement(skill, from, { x: 1660, y: 540 }, 32).seconds > fittsMovement(skill, from, { x: 1060, y: 540 }, 32).seconds, 'longer pixel travel takes more motor time');
  assert.ok(fittsMovement(skill, from, { x: 1660, y: 540 }, 8).seconds > fittsMovement(skill, from, { x: 1660, y: 540 }, 80).seconds, 'a smaller pixel target takes more motor time');
}

for (const level of ['easy', 'normal', 'hard']) {
  const openingTimes = [];
  for (let seed = 0; seed < 100; seed++) {
    const view = fixture(), log = [], hands = createHands({ slot: 0, seed, level, camera: { x: 100, z: 100 }, log });
    const firstCommand = seed % 2 ? { t: 'amove', orders: [[1, 120, 120], [2, 122, 120]] } : { t: 'buy', unit: 'rifle' };
    assert.ok(enqueueDecision(hands, firstCommand, view, { concern: 'production', event: 'opening', eventTick: 0 }));
    run(hands, view, 250);
    const first = log.find(input => input.command);
    assert.ok(first, `${level} makes its first order`);
    assert.ok(first.tick >= HUMAN_SKILLS[level].opening[0] * 20, `${level} looks before ordering`);
    assert.ok(first.tick <= HUMAN_SKILLS[level].opening[1] * 20, `${level} first order is inside its opening range`);
    assert.ok(log.every(input => input.tick >= hands.openingUntil), 'no physical action before the opening look');
    openingTimes.push(first.tick / 20);
  }
  assert.ok(Math.max(...openingTimes) - Math.min(...openingTimes) >= (HUMAN_SKILLS[level].opening[1] - HUMAN_SKILLS[level].opening[0]) * 0.7,
    'prospectively sampled total deadlines create opening variety across the authored interval');
}

{
  const view = fixture(), log = [], sent = [], hands = createHands({ slot: 0, seed: 10, level: 'hard', camera: { x: 100, z: 100 }, log });
  assert.equal(enqueueDecision(hands, { t: 'move', orders: [[3, 115, 110]] }, view), false, 'remote unit cannot be selected by an arbitrary id');
  assert.equal(enqueueDecision(hands, { t: 'attack', ids: [1], target: 3 }, view), false, 'targeted click needs a target on screen');
  assert.ok(enqueueDecision(hands, { t: 'amove', orders: [[1, 350, 340], [2, 352, 341]] }, view, { concern: 'expansion', operation: 'capture', eventTick: 0 }));
  run(hands, view, 240, cmd => sent.push(cmd));
  assert.equal(sent.length, 1, 'nearby computed destinations become one formation command');
  assert.equal(sent[0].orders.length, 2);
  assert.ok(log.some(input => input.kind === 'select-box'));
  assert.ok(log.some(input => input.kind === 'group-set'));
  assert.ok(log.some(input => input.kind === 'attack-key'));
  assert.ok(log.some(input => input.kind === 'minimap-rightclick'));
  assert.equal(log.find(input => input.kind === 'attack-key').input.code, 'ControlLeft', 'minimap attack-move uses the actual Ctrl modifier');
  assert.deepEqual(log.find(input => input.kind === 'minimap-rightclick').input, { button: 2, ctrl: true });
  assert.ok(log.find(input => input.kind === 'minimap-rightclick').pointer.distance > 500, 'minimap travel pays for moving across the screen');
  assert.equal(log.find(input => input.kind === 'minimap-rightclick').pointer.width, 9.5, 'minimap target width uses CSS pixels rather than world metres');
  assert.notDeepEqual(sent[0].orders, [[1, 350, 340], [2, 352, 341]], 'ground click scatters and uses a real formation');
  Object.assign(hands.camera, { x: 350, z: 350 }); view.tick = hands.tick;
  hands.selected = [];
  assert.ok(enqueueDecision(hands, { t: 'move', orders: [[1, 330, 335], [2, 332, 336]] }, view));
  run(hands, view, 400, cmd => sent.push(cmd));
  assert.ok(log.some(input => input.kind === 'group-recall'), 'assigned group can be recalled away from the units');
  assert.equal(new Set(log.filter(input => input.command).map(input => input.tick)).size, sent.length, 'at most one command per tick');
  const publicState = diagnostics(hands);
  assert.ok(publicState.camera.corners.length === 4);
  assert.equal(publicState.selected, 2);
  assert.ok(!JSON.stringify(publicState).includes('ids'), 'public overlay does not expose private unit identities');
}

{
  const view = fixture(), log = [], sent = [], hands = createHands({ slot: 0, seed: 0, level: 'hard', camera: { x: 100, z: 100 }, log });
  hands.openingUntil = 0; hands.openingDone = true;
  view.minimap = [{ owner: 1, x: 350, z: 350, vehicle: false }];
  hands.resolveMinimap = (at, radius) => Math.hypot(at.x - 350, at.z - 350) < radius ? 8 : null;
  assert.equal(enqueueDecision(hands, { t: 'attack', ids: [1], target: 8 }, view), false, 'an anonymous remote dot cannot be looked up by remembered enemy id');
  assert.ok(enqueueDecision(hands, { t: 'move', orders: [[1, 350, 350]] }, view), 'planning chooses a position on the anonymous minimap');
  run(hands, view, 150, cmd => sent.push(cmd));
  assert.ok(log.some(input => input.kind === 'minimap-rightclick'));
  assert.equal(sent[0].t, 'attack'); assert.equal(sent[0].target, 8, 'the physical dispatcher alone resolves the closest raw delivered hostile dot');
  hands.resolveMinimap = () => null;
  assert.ok(enqueueDecision(hands, { t: 'move', orders: [[1, 350, 350]] }, view));
  run(hands, view, 250, cmd => sent.push(cmd));
  assert.equal(sent[1].t, 'move', 'a missing delivered dot leaves the actual ground order');
}

{
  const view = fixture(), log = [], sent = [], hands = createHands({ slot: 0, seed: 14, level: 'hard', camera: { x: 100, z: 100 }, log });
  hands.openingUntil = 0; hands.openingDone = true;
  enqueueDecision(hands, { t: 'amove', orders: [[1, 120, 120]] }, view);
  run(hands, view, 150, cmd => sent.push(cmd));
  assert.equal(log.find(input => input.kind === 'attack-key').input.code, 'KeyG');
  const order = log.find(input => input.command);
  assert.equal(order.kind, 'place-click'); assert.equal(order.input.button, 0, 'G targeting ends with a left-click because right-click would cancel');
  assert.equal(sent[0].t, 'amove');
  const pixels = { x: hands.pointer.x, y: hands.pointer.y }, before = { x: hands.cursor.x, z: hands.cursor.z };
  assert.ok(queueCamera(hands, { x: 130, z: 100 }, {}, 'pan'));
  run(hands, view, 250);
  assert.deepEqual({ x: hands.pointer.x, y: hands.pointer.y }, pixels, 'keyboard camera movement does not teleport the physical screen pointer');
  assert.ok(Math.hypot(hands.cursor.x - before.x, hands.cursor.z - before.z) > 10, 'the fixed pixel pointer now looks at different terrain');
}

{
  const view = fixture(), log = [], sent = [], hands = createHands({ slot: 0, seed: 22, level: 'hard', camera: { x: 100, z: 100 }, log });
  hands.openingUntil = 0; hands.openingDone = true;
  enqueueDecision(hands, { t: 'support', kind: 'dive', x: 112, z: 108 }, view);
  run(hands, view, 150, cmd => sent.push(cmd));
  assert.deepEqual(log.map(input => input.kind), ['support-key', 'place-click'], 'point support uses the client one-click gesture');
  assert.equal(log[0].input.code, 'KeyU'); assert.equal(log[1].input.button, 0);
  assert.equal(sent[0].t, 'support'); assert.ok(!Object.hasOwn(sent[0], 'dir'));
}

{
  const view = fixture(), log = [], sent = [], hands = createHands({ slot: 0, seed: 25, level: 'hard', camera: { x: 100, z: 100 }, log });
  hands.openingUntil = 0; hands.openingDone = true;
  view.units.get(1).type = 'tank';
  enqueueDecision(hands, { t: 'ability', ids: [1, 2] }, view);
  run(hands, view, 150, cmd => sent.push(cmd));
  assert.equal(sent.length, 2, 'one F key cannot activate two different selected unit types');
  assert.deepEqual(sent.map(cmd => cmd.ids), [[1], [2]]);
  assert.equal(log.filter(input => input.kind === 'ability-key').length, 2);
}

{
  const view = fixture(), log = [], sent = [], hands = createHands({ slot: 0, seed: 30, level: 'hard', camera: { x: 100, z: 100 }, log });
  hands.openingUntil = 0; hands.openingDone = true;
  enqueueDecision(hands, { t: 'ability', ids: [2] }, view);
  for (let tick = 0; !hands.selected.length && tick < 100; tick++) {
    view.tick = tick; advanceHands(hands, tick, view, cmd => sent.push(cmd));
  }
  Object.assign(view.units.get(2), { x: 300, z: 300 });
  run(hands, view, 150, cmd => sent.push(cmd));
  assert.equal(sent.length, 0, 'the strict commander locality rule wastes a hotkey when the selected unit walks off screen');
  assert.ok(log.some(input => input.kind === 'ability-key' && !input.command));
  assert.deepEqual(hands.selected, [2], 'a wasted key does not erase the real persistent selection');
}

{
  const view = fixture(), log = [], hands = createHands({ slot: 0, seed: 7, level: 'hard', camera: { x: 100, z: 100 }, log });
  hands.openingUntil = 0; hands.openingDone = true;
  enqueueDecision(hands, { t: 'ability', ids: [1], x: 106, z: 108 }, view, { event: 'threat', eventTick: 0 });
  run(hands, view, 150);
  assert.ok(log.every(input => input.tick >= 4), 'reaction floor applies to the first input');
  assert.ok(log.filter(input => input.command).every(input => input.latency >= 0.2));
  assert.ok(log.some(input => input.kind === 'ability-key'));
  assert.ok(log.some(input => input.kind === 'place-click'));
}

for (const level of ['easy', 'normal', 'hard']) {
  const view = fixture(), log = [], hands = createHands({ slot: 0, seed: 31, level, camera: { x: 100, z: 100 }, log });
  hands.openingUntil = 0; hands.openingDone = true;
  for (let tick = 0; tick < 3600; tick++) {
    view.tick = tick;
    enqueueDecision(hands, { t: 'buy', unit: tick % 2 ? 'mg' : 'rifle' }, view);
    advanceHands(hands, tick, view, () => {});
  }
  assert.ok(log.length > HUMAN_SKILLS[level].apm[0], 'sustained real work generates inputs');
  for (const input of log) {
    assert.ok(log.filter(other => other.tick <= input.tick && input.tick - other.tick < 1200).length <= HUMAN_SKILLS[level].apm[1], `${level} 60-second cap`);
    assert.ok(log.filter(other => other.tick <= input.tick && input.tick - other.tick < 200).length * 6 <= HUMAN_SKILLS[level].peak, `${level} 10-second burst cap`);
  }
}

{
  const inputLog = seed => {
    const view = fixture(), log = [], hands = createHands({ slot: 0, seed, level: 'hard', camera: { x: 100, z: 100 }, log });
    enqueueDecision(hands, { t: 'move', orders: [[1, 115, 110], [2, 118, 112]] }, view, { concern: 'scout' });
    queueCamera(hands, { x: 250, z: 250 }, { concern: 'fight' });
    run(hands, view, 400);
    return log;
  };
  assert.deepEqual(inputLog(45), inputLog(45), 'same seed has identical physical inputs');
  assert.notDeepEqual(inputLog(45), inputLog(46), 'different seeds vary click and timing choices');
  const a = createRng(6, 0), b = createRng(6, 0), c = createRng(6, 1);
  assert.equal(random(a), random(b)); assert.notEqual(random(a), random(c));
}

{
  const view = fixture(), log = [], hands = createHands({ slot: 0, seed: 1, level: 'hard', camera: { x: 100, z: 100 }, log, handover: true });
  enqueueDecision(hands, { t: 'buy', unit: 'rifle' }, view);
  run(hands, view, 29);
  assert.equal(log.length, 0, 'handover pauses for at least 1.5 seconds');
  run(hands, view, 160);
  assert.ok(log[0].tick >= 30);
}

{
  const view = fixture(), log = [], hands = createHands({ slot: 0, seed: 3, level: 'hard', camera: { x: 100, z: 100 }, log });
  hands.openingUntil = 0; hands.openingDone = true;
  queueCamera(hands, { x: 190, z: 100 }, {}, 'pan');
  let last = hands.camera.x;
  for (let tick = 0; tick <= 120; tick++) {
    advanceHands(hands, tick, view, () => {});
    assert.ok(Math.abs(hands.camera.x - last) <= HUMAN_CAMERA.panSpeed / 20 + 1e-9, 'continuous pan never exceeds client speed');
    last = hands.camera.x;
  }
  assert.ok(Math.abs(hands.camera.x - 190) <= HUMAN_CAMERA.panSpeed / 20, 'keyboard release is quantized to one simulation tick rather than snapping to an exact world coordinate');
  assert.equal(hands.camera.z, 100);
  assert.equal(log.filter(input => input.kind === 'camera-pan').length, 1);
  assert.equal(log.find(input => input.kind === 'camera-pan').input.code, 'KeyD');
}

{
  const view = fixture(), log = [], hands = createHands({ slot: 0, seed: 12, level: 'hard', camera: { x: 100, z: 100 }, log });
  hands.openingUntil = 0; hands.openingDone = true;
  assert.equal(queueCamera(hands, { x: 200, z: 200 }, {}, 'group'), false, 'a camera group jump requires an assigned control group');
  enqueueDecision(hands, { t: 'move', orders: [[1, 120, 120], [2, 122, 120]] }, view, { operation: 'advance' });
  run(hands, view, 150);
  Object.assign(hands.camera, { x: 300, z: 300 });
  assert.ok(queueCamera(hands, { x: 102, z: 100 }, {}, 'group'));
  run(hands, view, 300);
  assert.deepEqual(hands.camera, { x: 102, z: 100 });
  const second = log.findIndex(input => input.kind === 'camera-group');
  assert.equal(log[second - 1].kind, 'group-recall', 'centering a control group pays for the first key tap');
  assert.ok(log[second].tick - log[second - 1].tick <= 6, 'group centering requires a real double tap');
}

{
  const view = fixture(), log = [], sent = [], hands = createHands({ slot: 0, seed: 15, level: 'hard', camera: { x: 100, z: 100 }, log });
  hands.openingUntil = 0; hands.openingDone = true;
  enqueueDecision(hands, { t: 'support', kind: 'smoke', x: 112, z: 108, dir: 0 }, view);
  run(hands, view, 150, cmd => sent.push(cmd));
  assert.equal(sent.length, 1);
  assert.deepEqual(log.map(input => input.kind), ['support-key', 'place-anchor', 'place-click'], 'aimed support pays both client clicks');
  assert.ok(Number.isFinite(sent[0].dir));
}

{
  const view = fixture(), log = [], sent = [], hands = createHands({ slot: 0, seed: 16, level: 'hard', camera: { x: 100, z: 100 }, log });
  hands.openingUntil = 0; hands.openingDone = true;
  Object.assign(view.units.get(2), { x: 115, z: 100 });
  view.units.set(7, { id: 7, owner: 0, type: 'rifle', x: 108, z: 100 });
  enqueueDecision(hands, { t: 'move', orders: [[1, 120, 120], [2, 122, 120]] }, view);
  run(hands, view, 150, cmd => sent.push(cmd));
  assert.ok(!log.some(input => input.kind === 'select-box'), 'a box cannot omit another troop inside its drag rectangle');
  assert.ok(log.some(input => input.kind === 'select-add-click'), 'a precise subset pays for individual Shift selections');
  assert.deepEqual(sent[0].orders.map(order => order[0]).sort(), [1, 2]);
}

{
  const view = fixture(), log = [], sent = [], hands = createHands({ slot: 0, seed: 11, level: 'normal', camera: { x: 100, z: 100 }, log });
  view.mode = { kind: 'classic' };
  view.units.set(5, { id: 5, owner: 0, type: 'barracks', x: 110, z: 110, built: 1, queue: [] });
  view.units.set(6, { id: 6, owner: 0, type: 'motorpool', x: 350, z: 350, built: 1, queue: [] });
  assert.equal(enqueueDecision(hands, { t: 'buy', unit: 'tank' }, view), false, 'Classic cannot buy at an unseen production building');
  assert.ok(enqueueDecision(hands, { t: 'buy', unit: 'mg' }, view));
  run(hands, view, 200, cmd => sent.push(cmd));
  assert.equal(sent[0].from, 5, 'Classic buys from the producer physically selected');
  assert.ok(log.some(input => input.kind === 'select-click' && input.ids.includes(5)), 'select the factory before its buy click');
  assert.ok(log.findIndex(input => input.kind === 'select-click') < log.findIndex(input => input.kind === 'buy-click'));
}

{
  const calibratedLog = calibration => {
    const view = fixture(), log = [], hands = createHands({ slot: 0, seed: 71, level: 'hard', camera: { x: 100, z: 100 }, log, calibration });
    hands.openingUntil = 0; hands.openingDone = true;
    enqueueDecision(hands, { t: 'amove', orders: [[1, 120, 120], [2, 122, 120]] }, view, { eventTick: 0 });
    run(hands, view, 200);
    return { hands, log };
  };
  const normal = calibratedLog(), slow = calibratedLog({ calibration: { key: [0.35, 0.4], apm: [2000, 4000] } });
  assert.notDeepEqual(normal.log, slow.log, 'fitted motor timing changes the physical timeline');
  assert.deepEqual(slow.hands.skill.apm, HUMAN_SKILLS.hard.apm, 'calibration cannot remove the input budget');
  const floor = calibratedLog({ reaction: [0, 0], key: [0, 0], pointer: [0, 0], error: -3 });
  assert.ok(floor.log.every(input => input.tick >= 4), 'calibration preserves the reaction floor');
  assert.deepEqual(floor.hands.skill.reaction, [0.2, 0.2]);
  assert.ok(floor.hands.skill.error >= 0.2);
  assert.deepEqual(calibratedLog({ key: [Infinity, NaN], reaction: [1, 0] }).log, normal.log, 'malformed fit values leave the defaults intact');
}

{
  const view = fixture(), log = [], hands = createHands({ slot: 0, seed: 18, level: 'hard', camera: { x: 100, z: 100 }, log });
  hands.openingUntil = 0; hands.openingDone = true;
  enqueueDecision(hands, { t: 'move', orders: [[1, 115, 110]] }, view);
  advanceHands(hands, 0, view, () => {});
  Object.assign(view.units.get(1), { x: 350, z: 350 });
  run(hands, view, 150);
  assert.ok(log.some(input => input.kind === 'select-click'), 'a stale screen click is still a physical action');
  assert.ok(log.every(input => !input.command), 'a unit that left the camera cannot be remotely selected by its stale id');
  view.units.get(1).flags = 262144;
  Object.assign(view.units.get(1), { x: 100, z: 100 });
  assert.equal(enqueueDecision(hands, { t: 'move', orders: [[1, 115, 110]] }, view), false, 'squad riding inside a carrier is not clickable');
}

{
  const sel = [...fixture().units.values()].slice(0, 2), flags = Array(40000).fill(0);
  flags[54 * 200 + 58] = TRENCH;
  const opts = { defs: UNITS, width: 400, height: 400, cell: CELL, terrainAt: (x, z) => !!(flags[z * 200 + x] & TRENCH) };
  const snapped = formation(sel, { x: 115, z: 110 }, opts);
  assert.ok(snapped.some(([, x, z]) => x === 117 && z === 109), 'shared human formation snaps infantry to a trench');
  assert.deepEqual(formation(sel, { x: 115, z: 110 }, opts), snapped);
  const view = fixture(), hands = createHands({ slot: 0, seed: 8, level: 'hard', camera: { x: 100, z: 100 } });
  hands.openingUntil = 0; hands.openingDone = true;
  enqueueDecision(hands, { t: 'move', orders: [[1, 110, 110]] }, view);
  for (let tick = 0; !hands.selected.length && tick < 80; tick++) {
    view.tick = tick; advanceHands(hands, tick, view, () => {});
  }
  view.units.delete(1);
  const sent = [];
  run(hands, view, 150, cmd => sent.push(cmd));
  assert.ok(sent[0].orders.some(([id]) => id === 1), 'stale input still clicks and leaves rejection to the command gate');
}

{
  const view = fixture(), log = [], sent = [], hands = createHands({ slot: 0, seed: 6, level: 'hard', camera: { x: 100, z: 100 }, log });
  hands.openingUntil = 0; hands.openingDone = true;
  enqueueDecision(hands, { t: 'move', orders: [[1, 120, 120], [2, 122, 120]] }, view);
  run(hands, view, 100);
  assert.equal(hands.groups.size, 0, 'generic movement selections do not invent an operation group');
  for (let number = 1; number <= 9; number++) {
    const ids = [20 + number * 2, 21 + number * 2];
    for (const id of ids) view.units.set(id, { id, owner: 0, type: 'rifle', x: 350, z: 350 });
    hands.groups.set(number, ids); hands.groupUse.set(number, number);
  }
  hands.selected = [];
  enqueueDecision(hands, { t: 'amove', orders: [[1, 125, 125], [2, 127, 125]] }, view, { operation: 'assault' });
  run(hands, view, 200);
  assert.equal(hands.groups.size, 9, 'operation groups reuse the nine physical number keys');
  assert.deepEqual(hands.groups.get(1), [1, 2], 'the least recently used number is rebound');
  view.units.delete(2); hands.selected = [];
  Object.assign(hands.camera, { x: 350, z: 350 });
  assert.ok(enqueueDecision(hands, { t: 'move', orders: [[1, 330, 335]] }, view));
  run(hands, view, 300, cmd => sent.push(cmd));
  assert.deepEqual(hands.groups.get(1), [1], 'a dead operation member no longer prevents the living group recall');
  assert.deepEqual(sent[0].orders.map(order => order[0]), [1]);
  assert.ok(log.some(input => input.kind === 'group-recall' && input.ids.length === 1));
  view.units.set(2, { id: 2, owner: 0, type: 'rifle', x: 104, z: 100 });
  hands.groups.set(1, [1, 2]); hands.selected = [];
  assert.equal(enqueueDecision(hands, { t: 'move', orders: [[1, 330, 335]] }, view), false,
    'a remote subset cannot recall a larger group and silently exclude its other living troop');
}

{
  const view = fixture(), log = [], hands = createHands({ slot: 0, seed: 20, level: 'normal', camera: { x: 100, z: 100 }, log });
  hands.openingUntil = 0; hands.openingDone = true;
  const context = { concern: 'production', cycle: 1, event: { id: 'ready:1' }, eventTick: 0 };
  enqueueDecision(hands, { t: 'buy', unit: 'rifle' }, view, context);
  enqueueDecision(hands, { t: 'buy', unit: 'mg' }, view, context);
  enqueueDecision(hands, { t: 'buy', unit: 'tank' }, view, { ...context, event: { id: 'ready:2' } });
  enqueueDecision(hands, { t: 'buy', unit: 'mortar' }, view, context);
  enqueueDecision(hands, { t: 'buy', unit: 'howitzer' }, view, { ...context, cycle: 2 });
  run(hands, view, 150);
  const intervals = log.map((input, i) => (input.tick - (log[i - 1]?.tick ?? 0)) / 20);
  assert.equal(intervals.length, 5);
  assert.ok(intervals[0] >= 0.5 && intervals[0] <= 0.8 && intervals[1] <= 0.4 && intervals[2] >= 0.5
    && intervals[3] <= 0.4 && intervals[4] >= 0.5,
    'observable first inputs include their motor time; practiced jobs and noticed events avoid another full response interval');
  const samples = [];
  for (let seed = 0; seed < 400; seed++) {
    const sample = createHands({ slot: 0, seed, level: 'normal', camera: { x: 100, z: 100 } });
    sample.openingUntil = 0; sample.openingDone = true; enqueueDecision(sample, { t: 'buy', unit: 'rifle' }, view, context);
    let first;
    run(sample, view, 30, () => { first ??= sample.tick / 20; }); samples.push(first);
  }
  samples.sort((a, b) => a - b);
  assert.ok(samples[200] >= 0.5 && samples[200] <= 0.8, 'the seeded lognormal median stays in the authored table range');
  assert.ok(samples.some(value => value > HUMAN_SKILLS.normal.reaction[1]), 'slow responses can exceed the median range');
  assert.ok(samples[360] - samples[200] > samples[200] - samples[40], 'the authored reaction component has a right tail rather than a flat range');
}

{
  const view = fixture(), log = [], hands = createHands({ slot: 0, seed: 40, level: 'hard', camera: { x: 100, z: 100 }, log });
  hands.openingUntil = 0; hands.openingDone = true;
  view.alerts = [{ id: 'older', kind: 'attack', tick: 0, x: 300, z: 300 },
    { id: 'latest', kind: 'base', tick: 1, x: 350, z: 350 }];
  assert.ok(queueCamera(hands, { x: 300, z: 300 }, { event: { id: 'older' } }, 'alert'));
  run(hands, view, 100);
  assert.equal(log[0].kind, 'camera-minimap', 'an older alert costs a real minimap pointer jump instead of a fictitious alert-line click');
  assert.equal(log[0].input.button, 0);
  assert.ok(queueCamera(hands, { x: 350, z: 350 }, { event: { id: 'latest' } }, 'alert'));
  run(hands, view, 125);
  assert.equal(log[1].kind, 'camera-alert'); assert.equal(log[1].input.code, 'Space');
  assert.deepEqual(hands.camera, { x: 350, z: 350 }, 'Space reaches only the newest current alert');
}

{
  const view = fixture(), log = [], sent = [], hands = createHands({ slot: 0, seed: 13, level: 'hard', camera: { x: 100, z: 100 }, log });
  hands.openingUntil = 0; hands.openingDone = true;
  enqueueDecision(hands, { t: 'move', orders: [[1, 115, 110]] }, view);
  advanceHands(hands, 0, view, () => {});
  Object.assign(view.units.get(1), { x: 109, z: 100 });
  run(hands, view, 100, cmd => sent.push(cmd));
  assert.equal(sent.length, 0, 'a moving unit still on screen cannot be selected by its old queued id');
  assert.equal(log[0].kind, 'select-click'); assert.equal(log[0].selected, 0);
  const queuedPixel = projectPointer({ x: 100, z: 100 }, hands.camera, view, { elevation: 1 });
  assert.notDeepEqual(log[0].pointer.to, queuedPixel, 'selection endpoints have seeded pixel error');
}

{
  const view = fixture(), log = [], sent = [], hands = createHands({ slot: 0, seed: 13, level: 'hard', camera: { x: 100, z: 100 }, log });
  hands.openingUntil = 0; hands.openingDone = true;
  enqueueDecision(hands, { t: 'move', orders: [[1, 115, 110]] }, view);
  advanceHands(hands, 0, view, () => {});
  Object.assign(view.units.get(1), { x: 109, z: 100 });
  Object.assign(view.units.get(2), { x: 100, z: 100 });
  hands.selectionOrigin = 'group';
  run(hands, view, 100, cmd => sent.push(cmd));
  assert.deepEqual(hands.selected, [2], 'a click at the old squad position selects the different troop actually under its pixel endpoint');
  assert.equal(hands.selectionOrigin, 'screen', 'a missed group replacement click removes the prior group-recall privilege');
  assert.equal(sent.length, 0, 'the queued order is canceled rather than issued to either an invented selection or the wrong troop');
}

{
  for (const level of ['easy', 'normal', 'hard']) {
    const samples = [];
    for (let seed = 0; seed < 100; seed++) {
      const view = fixture(), log = [], hands = createHands({ slot: 0, seed, level, camera: { x: 100, z: 100 }, log });
      hands.openingUntil = 0; hands.openingDone = true; hands.selected = [1]; hands.selectionOrigin = 'screen';
      view.tick = 4;
      enqueueDecision(hands, { t: 'stop', ids: [1] }, view, { concern: 'damage', cycle: 1,
        event: { id: 'damage:1', source: 'screen', onScreen: true }, eventTick: 0, reactionStartTick: 0 });
      for (let tick = 4; tick < 50; tick++) advanceHands(hands, tick, view, () => {});
      assert.ok(log[0].tick >= 4, 'the total newly observed event interval never beats the 0.2 second floor');
      samples.push(log[0].tick / 20);
    }
    samples.sort((a, b) => a - b);
    assert.ok(samples[50] >= HUMAN_SKILLS[level].reaction[0] && samples[50] <= HUMAN_SKILLS[level].reaction[1],
      `${level} observable practiced response includes the already paid choice and full key motor in the table interval`);
  }
  const view = fixture(), log = [], hands = createHands({ slot: 0, seed: 70, level: 'hard', camera: { x: 100, z: 100 }, log });
  hands.openingUntil = 0; hands.openingDone = true; hands.selected = [1]; hands.selectionOrigin = 'screen';
  enqueueDecision(hands, { t: 'stop', ids: [1] }, view, { event: { id: 'old-damage', source: 'screen', onScreen: true }, eventTick: 0 });
  for (let tick = 20; tick < 50; tick++) advanceHands(hands, tick, view, () => {});
  assert.ok(log[0].tick <= 23, 'a response already delayed by backlog starts the motor without another full reaction pause');
}

{
  const view = fixture(), log = [], hands = createHands({ slot: 0, seed: 5, level: 'hard', camera: { x: 100, z: 100 }, log });
  hands.openingUntil = 0; hands.openingDone = true; Object.assign(hands.pointer, { x: 0, y: 0, fromX: 0, fromY: 0, toX: 0, toY: 0 });
  enqueueDecision(hands, { t: 'move', orders: [[1, 115, 110]] }, view, { event: { id: 'contact', source: 'screen', onScreen: true }, eventTick: 0 });
  for (let tick = 4; tick < 70; tick++) advanceHands(hands, tick, view, () => {});
  assert.equal(log[0].kind, 'select-click');
  assert.ok(log[0].tick >= 4 + Math.ceil(log[0].pointer.seconds * 20), 'a long pointer response retains its full physical travel after choice time');
  assert.ok(log[0].tick / 20 > HUMAN_SKILLS.hard.reaction[1], 'complex travel is reported as a slower response instead of compressing motor time to match the target');
}

{
  const view = fixture(), log = [], hands = createHands({ slot: 0, seed: 7, level: 'hard', camera: { x: 100, z: 100 }, log });
  hands.openingUntil = 0; hands.openingDone = true; view.alerts = [{ id: 'danger', kind: 'attack', tick: 0, x: 350, z: 350 }];
  queueCamera(hands, { x: 350, z: 350 }, { event: { id: 'danger', source: 'alert', onScreen: false }, eventTick: 0 }, 'alert');
  for (let tick = 4; tick < 60; tick++) advanceHands(hands, tick, view, () => {});
  assert.equal(log[0].input.code, 'Space');
  assert.ok(log[0].tick / 20 >= HUMAN_SKILLS.hard.offscreen[0] && log[0].tick / 20 <= HUMAN_SKILLS.hard.offscreen[1],
    'the off-screen alert response uses the full alert interval with motor and elapsed choice included');
}

{
  const view = fixture(), log = [], hands = createHands({ slot: 0, seed: 3, level: 'hard', camera: { x: 100, z: 100 }, log });
  hands.openingUntil = 0; hands.openingDone = true;
  enqueueDecision(hands, { t: 'move', orders: [[1, 115, 110]] }, view);
  advanceHands(hands, 0, view, () => {});
  assert.ok(hands.active.reacting);
  hands.interruptAfterInput = true;
  advanceHands(hands, 1, view, () => {});
  assert.equal(hands.active, null); assert.equal(log.length, 0, 'an unstarted gesture can be canceled during its remaining choice pause');
  assert.equal(hands.interruptAfterInput, false);
}

{
  const view = fixture(), log = [], sent = [], hands = createHands({ slot: 0, seed: 9, level: 'hard', camera: { x: 100, z: 100 }, log });
  hands.openingUntil = 0; hands.openingDone = true;
  enqueueDecision(hands, { t: 'move', orders: [[1, 115, 110]] }, view, { concern: 'old-work' });
  let tick = 0;
  for (; tick < 100; tick++) {
    advanceHands(hands, tick, view, cmd => sent.push(cmd));
    if (hands.active && !hands.active.reacting) break;
  }
  hands.interruptAfterInput = true;
  for (tick++; tick < 100 && hands.active; tick++) advanceHands(hands, tick, view, cmd => sent.push(cmd));
  assert.equal(log.length, 1); assert.equal(log[0].kind, 'select-click'); assert.equal(log[0].concern, 'old-work');
  assert.deepEqual(hands.selected, [1], 'interrupting after the in-flight selection preserves that physical selection');
  assert.equal(sent.length, 0, 'the unfinished order after selection is discarded');
}

{
  const view = fixture(), log = [], sent = [], hands = createHands({ slot: 0, seed: 9, level: 'hard', camera: { x: 100, z: 100 }, log });
  hands.openingUntil = 0; hands.openingDone = true; hands.selected = [1]; hands.selectionOrigin = 'screen';
  enqueueDecision(hands, { t: 'move', orders: [[1, 115, 110]] }, view);
  let tick = 0;
  for (; tick < 100; tick++) {
    advanceHands(hands, tick, view, cmd => sent.push(cmd));
    if (hands.active && !hands.active.reacting) break;
  }
  hands.interruptAfterInput = true;
  for (tick++; tick < 100 && hands.active; tick++) advanceHands(hands, tick, view, cmd => sent.push(cmd));
  assert.equal(sent.length, 1, 'an issuing click already in flight finishes and submits its original command');
  assert.equal(hands.interruptAfterInput, false);
}

{
  const view = fixture(), log = [], sent = [], hands = createHands({ slot: 0, seed: 9, level: 'hard', camera: { x: 100, z: 100 }, log });
  hands.openingUntil = 0; hands.openingDone = true; hands.selected = [1]; hands.selectionOrigin = 'screen';
  enqueueDecision(hands, { t: 'amove', orders: [[1, 115, 110]] }, view, { concern: 'old-work' });
  let tick = 0;
  for (; tick < 100; tick++) {
    advanceHands(hands, tick, view, cmd => sent.push(cmd));
    if (hands.active && !hands.active.reacting) break;
  }
  const eventTick = tick;
  hands.interruptAfterInput = true;
  for (tick++; tick < 100 && hands.active; tick++) advanceHands(hands, tick, view, cmd => sent.push(cmd));
  assert.equal(log[0].kind, 'attack-key'); assert.equal(log[0].concern, 'old-work');
  assert.ok(hands.cancelTargeting, 'the real G targeting mode persists after its remaining click was discarded');
  enqueueDecision(hands, { t: 'stop', ids: [1] }, view, { concern: 'danger', event: { id: 'damage', source: 'screen', onScreen: true }, eventTick });
  run(hands, view, 100, cmd => sent.push(cmd));
  assert.equal(log[1].kind, 'cancel-key'); assert.equal(log[1].input.code, 'Escape'); assert.equal(log[1].concern, 'danger');
  assert.ok(log[1].tick - eventTick >= 4, 'the new emergency cancellation respects the event floor');
  assert.equal(sent[0].t, 'stop'); assert.deepEqual(hands.selected, [1], 'Esc cancels targeting without clearing the selection');
  assert.equal(log.filter(input => input.command?.t === 'amove').length, 0);
}

{
  const view = fixture(), log = [], sent = [], camera = { x: 100, z: 100 };
  const plane = { id: 5, owner: 0, type: 'fighter', flags: 512, x: -1000, z: -1000 };
  view.units.set(5, plane);
  const hands = createHands({ slot: 0, seed: 90, level: 'hard', camera, log,
    resolveMinimap: () => ({ friendId: 3, enemyId: 4 }) });
  hands.openingUntil = 0; hands.openingDone = true;
  assert.equal(enqueueDecision(hands, { t: 'move', orders: [[5, 350, 350]] }, view), false,
    'a parked aircraft id alone cannot authorize off-map selection');
  view.airPanel = [{ id: 5, type: 'fighter', state: 'base' }];
  const context = { concern: 'air:5', concernKind: 'production', concernUnitId: 5,
    concernTarget: { x: 100, z: 100 }, responseActorIds: [5], responseTarget: { x: 350, z: 350 } };
  assert.ok(enqueueDecision(hands, { t: 'move', orders: [[5, 350, 350]] }, view, context));
  run(hands, view, 100, cmd => sent.push(cmd));
  assert.deepEqual(sent, [{ t: 'escort', ids: [5], target: 3 }], 'the actual minimap friendly dot takes aircraft escort priority over a hostile dot');
  assert.equal(log[0].kind, 'select-air-panel'); assert.equal(log[0].input.button, 0);
  assert.equal(log[0].pointer.width, 25.546875, 'air panel precision uses the measured narrow row height');
  assert.ok(log[0].pointer.distance > 700, 'the air panel selection pays actual pointer travel from screen centre');
  assert.deepEqual(log[0].responseActorIds, [5]); assert.deepEqual(log[0].responseTarget, context.responseTarget);
  assert.equal(log[0].target, undefined, 'a UI selection does not create a false world click');
  assert.ok(!log.some(input => input.kind.startsWith('camera-')), 'parked aircraft missions do not visit their off-map parked coordinates');
  assert.deepEqual(camera, { x: 100, z: 100 });
}

{
  const view = fixture(), log = [], sent = [];
  for (const id of [5, 6]) view.units.set(id, { id, owner: 0, type: 'fighter', flags: 512, x: -1000, z: -1000 });
  view.airPanel = [5, 6].map(id => ({ id, type: 'fighter', state: 'base' }));
  const hands = createHands({ slot: 0, seed: 90, level: 'hard', camera: { x: 100, z: 100 }, log });
  hands.openingUntil = 0; hands.openingDone = true;
  enqueueDecision(hands, { t: 'move', orders: [[5, 115, 110]] }, view);
  advanceHands(hands, 0, view, () => {});
  view.airPanel.shift(); view.units.delete(5);
  run(hands, view, 100, cmd => sent.push(cmd));
  assert.deepEqual(hands.selected, [6], 'an air row click hits the currently displayed row after its old plane disappears');
  assert.equal(sent.length, 0, 'a row shifting during pointer travel wastes the intended mission click');
  assert.equal(log[0].kind, 'select-air-panel');
}

{
  const view = fixture(); view.w = view.h = 20; view.height = Array(400).fill(0);
  for (let z = 9; z <= 11; z++) for (let x = 13; x <= 15; x++) view.height[z * 20 + x] = -2;
  const camera = { x: 3, z: 3, yaw: -Math.PI * 0.75, distance: 60 }, at = { x: 27, z: 19 };
  assert.equal(groundClickable(at, camera, view), false, 'projected crater detail can be hidden behind its nearer rim');
  const hands = createHands({ slot: 0, seed: 1, camera });
  view.units.set(1, { id: 1, owner: 0, type: 'rifle', x: 20, z: 17 });
  assert.equal(enqueueDecision(hands, { t: 'dig', ids: [1], kind: 'fill', ...at }, view), false,
    'detailed ground placement cannot silently click the nearer terrain rim');
  Object.assign(camera, { x: 30, z: 22 });
  assert.equal(groundClickable(at, camera, view), true, 'a real nearby camera change makes the crater target reachable');
  assert.ok(enqueueDecision(hands, { t: 'dig', ids: [1], kind: 'fill', ...at }, view));
  const click = projectPointer(at, camera, view), result = unprojectPointer(click, camera, view);
  assert.ok(Math.hypot(result.x - at.x, result.z - at.z) < 1e-5, 'the crater click intersects the intended continuous terrain after the camera change');
}

{
  const view = fixture(), log = [], sent = [];
  for (const id of [5, 6]) view.units.set(id, { id, owner: 0, type: 'fighter', flags: 512, x: -1000, z: -1000 });
  view.airPanel = [5, 6].map(id => ({ id, type: 'fighter', state: 'base' }));
  const hands = createHands({ slot: 0, seed: 90, level: 'hard', camera: { x: 100, z: 100 }, log });
  hands.openingUntil = 0; hands.openingDone = true;
  enqueueDecision(hands, { t: 'move', orders: [[5, 115, 110], [6, 117, 110]] }, view, { operation: 'air-mission' });
  run(hands, view, 100, cmd => sent.push(cmd));
  assert.deepEqual(log.filter(input => input.kind === 'select-air-panel').map(input => input.ids), [[5], [5, 6]]);
  assert.equal(log.filter(input => input.kind === 'select-air-panel')[1].input.shift, true);
  assert.equal(sent[0].orders.length, 2, 'a multi-plane mission includes the entire real Shift selection');
  assert.equal(hands.groups.size, 0, 'air inventory clicks do not bind generic ground operation groups');
}

{
  const view = fixture(), log = [], sent = [];
  view.units.set(5, { id: 5, owner: 0, type: 'fighter', flags: 512, x: -1000, z: -1000 });
  view.airPanel = [{ id: 5, type: 'fighter', state: 'base' }];
  const hands = createHands({ slot: 0, seed: 90, level: 'hard', camera: { x: 100, z: 100 }, log });
  hands.openingUntil = 0; hands.openingDone = true;
  enqueueDecision(hands, { t: 'escort', ids: [5], target: 1 }, view);
  let moved = false;
  for (let tick = 0; tick <= 100; tick++) {
    advanceHands(hands, tick, view, cmd => sent.push(cmd));
    if (!moved && hands.active?.actions[hands.active.index]?.fire) {
      Object.assign(view.units.get(1), { x: 125, z: 110 }); moved = true;
    }
  }
  assert.equal(sent[0].t, 'move', 'an escort click misses a friend that moved away during pointer travel');
  assert.equal(sent[0].target, undefined, 'the missed escort never invents a lock on its old queued friend id');
}

{
  const view = fixture(), log = [], sent = [], hands = createHands({ slot: 0, seed: 3, level: 'hard', camera: { x: 100, z: 100 }, log });
  hands.openingUntil = 0; hands.openingDone = true; hands.selected = [1]; hands.selectionOrigin = 'screen';
  Object.assign(hands.pointer, { x: 0, y: 0, fromX: 0, fromY: 0, toX: 0, toY: 0 });
  enqueueDecision(hands, { t: 'move', orders: [[1, 120, 120]] }, view, { concern: 'old-work' });
  advanceHands(hands, 0, view, () => {});
  const action = hands.active.actions[0], interruptedTick = hands.active.start + 2;
  const expected = { x: action.screenClick.x * 2 / action.duration, y: action.screenClick.y * 2 / action.duration };
  assert.equal(interruptHands(hands, interruptedTick, view), true, 'a pending right-click approach can stop before its mouse press');
  assert.ok(Math.hypot(hands.pointer.x - expected.x, hands.pointer.y - expected.y) < 1e-8,
    'interruption preserves the actual interpolated pointer instead of snapping to either endpoint');
  assert.deepEqual(hands.selected, [1]); assert.equal(log.length, 0, 'unfinished pointer motion does not invent an APM input');
  enqueueDecision(hands, { t: 'stop', ids: [1] }, view, { concern: 'danger', event: { id: 'hit', source: 'screen', onScreen: true }, eventTick: interruptedTick });
  for (let tick = interruptedTick; tick < 100; tick++) advanceHands(hands, tick, view, cmd => sent.push(cmd));
  assert.deepEqual(sent, [{ t: 'stop', ids: [1] }]); assert.ok(log[0].tick >= interruptedTick + 4);
  assert.ok(Math.hypot(hands.pointer.x - expected.x, hands.pointer.y - expected.y) < 1e-8, 'the response key leaves the stopped pointer in place');
}

{
  const view = fixture(), log = [], sent = [], hands = createHands({ slot: 0, seed: 3, level: 'hard', camera: { x: 100, z: 100 }, log });
  hands.openingUntil = 0; hands.openingDone = true; hands.selected = [1]; hands.selectionOrigin = 'screen';
  Object.assign(hands.pointer, { x: 0, y: 0, fromX: 0, fromY: 0, toX: 0, toY: 0 });
  enqueueDecision(hands, { t: 'amove', orders: [[1, 120, 120]] }, view, { concern: 'old-work' });
  let tick = 0;
  for (; tick < 100; tick++) {
    advanceHands(hands, tick, view, cmd => sent.push(cmd));
    if (log.some(input => input.kind === 'attack-key')) break;
  }
  const interruptedTick = tick + 1;
  assert.equal(interruptHands(hands, interruptedTick, view), true);
  assert.ok(hands.cancelTargeting, 'aborting the mouse approach preserves the already entered G mode until real Escape');
  enqueueDecision(hands, { t: 'stop', ids: [1] }, view, { concern: 'danger', event: { id: 'hit', source: 'screen', onScreen: true }, eventTick: interruptedTick });
  for (tick = interruptedTick; tick < 100; tick++) advanceHands(hands, tick, view, cmd => sent.push(cmd));
  assert.deepEqual(log.map(input => input.kind), ['attack-key', 'cancel-key', 'stop-key']);
  assert.equal(log[1].input.code, 'Escape'); assert.ok(log[1].tick >= interruptedTick + 4);
  assert.equal(log[1].concern, 'danger'); assert.equal(sent[0].t, 'stop'); assert.equal(sent.length, 1);
}

for (const held of [false, true]) {
  const view = fixture(), log = [], sent = [], hands = createHands({ slot: 0, seed: 3, level: 'hard', camera: { x: 100, z: 100 }, log });
  hands.openingUntil = 0; hands.openingDone = true; hands.selected = [3];
  Object.assign(hands.pointer, { x: 0, y: 0, fromX: 0, fromY: 0, toX: 0, toY: 0 });
  enqueueDecision(hands, { t: 'move', orders: [[1, 120, 120], [2, 122, 120]] }, view);
  advanceHands(hands, 0, view, () => {});
  const active = hands.active, action = active.actions[0]; assert.equal(action.kind, 'select-box');
  const tick = held ? Math.ceil(active.start + action.duration * action.motor.approachFraction) : active.start + 1;
  assert.equal(interruptHands(hands, tick, view), !held, 'only the box approach before its physical press may be discarded');
  if (held) {
    assert.equal(hands.active, active, 'the held selection drag remains active through mouse release');
    run(hands, view, 100, cmd => sent.push(cmd));
    assert.equal(log[0].kind, 'select-box'); assert.deepEqual(hands.selected, [1, 2]);
  } else { assert.equal(log.length, 0); assert.deepEqual(hands.selected, [3]); }
  assert.equal(sent.length, 0);
}

{
  const view = fixture(), log = [], hands = createHands({ slot: 0, seed: 3, level: 'hard', camera: { x: 100, z: 100 }, log });
  hands.openingUntil = 0; hands.openingDone = true;
  queueCamera(hands, { x: 130, z: 100 }, {}, 'pan');
  advanceHands(hands, 0, view, () => {});
  while (hands.active.reacting) advanceHands(hands, hands.tick + 1, view, () => {});
  const tick = hands.active.start + hands.active.actions[0].panPrep + 1;
  assert.equal(interruptHands(hands, tick, view), false, 'a held pan key is not silently dropped before release');
  run(hands, view, 100);
  assert.equal(log[0].kind, 'camera-pan'); assert.ok(hands.camera.x >= 130);
}

{
  const view = fixture(), log = [], hands = createHands({ slot: 0, seed: 3, level: 'normal', camera: { x: 100, z: 100 }, log });
  hands.openingUntil = 0; hands.openingDone = true;
  for (let i = 0; i < 3; i++) assert.ok(enqueueDecision(hands, { t: 'buy', unit: 'rifle' }, view, { concern: 'production', cycle: 1 }));
  assert.ok(enqueueDecision(hands, { t: 'stop', ids: [1] }, view));
  assert.equal(enqueueDecision(hands, { t: 'stop', ids: [1] }, view), false, 'unintended duplicate orders remain deduplicated');
  run(hands, view, 100);
  assert.equal(log.filter(input => input.kind === 'buy-click').length, 3, 'three purchase intentions require three actual card clicks');
}

for (const held of [false, true]) {
  const view = fixture(), log = [], sent = [], hands = createHands({ slot: 0, seed: 3, level: 'hard', camera: { x: 100, z: 100 }, log });
  hands.openingUntil = 0; hands.openingDone = true; hands.selected = [1]; hands.selectionOrigin = 'screen';
  enqueueDecision(hands, { t: 'amove', orders: [[1, 350, 340]] }, view, { concern: 'old-work' });
  let tick = 0;
  for (; tick < 100; tick++) {
    advanceHands(hands, tick, view, cmd => sent.push(cmd));
    if (held ? hands.active?.modifierHeld : hands.active && !hands.active.reacting) break;
  }
  assert.equal(interruptHands(hands, tick + 1, view), false, 'Ctrl+click cannot leave its held modifier behind during either press or pointer approach');
  for (tick++; tick < 100; tick++) advanceHands(hands, tick, view, cmd => sent.push(cmd));
  assert.deepEqual(log.map(input => input.kind), ['attack-key', 'minimap-rightclick']);
  assert.equal(log[0].input.code, 'ControlLeft'); assert.equal(sent[0].t, 'amove');
  assert.equal(sent.length, 1); assert.equal(hands.active, null); assert.equal(hands.interruptAfterInput, false);
}

{
  const view = fixture(), log = [], hands = createHands({ slot: 0, seed: 3, level: 'hard', camera: { x: 100, z: 100 }, log });
  hands.openingUntil = 0; hands.openingDone = true; hands.selected = [1];
  enqueueDecision(hands, { t: 'amove', orders: [[1, 350, 340]] }, view);
  advanceHands(hands, 0, view, () => {});
  assert.ok(hands.active.reacting);
  assert.equal(interruptHands(hands, 1, view), true, 'a reaction wait before Ctrl starts remains interruptible');
  assert.equal(hands.active, null); assert.equal(log.length, 0);
}

console.log('AI hands: opening, motor inputs, locality, formation, reaction, APM, deterministic logs and handover passed');
