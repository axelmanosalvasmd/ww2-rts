// Actual commander and planner acquire readiness through physical selection before choosing an ability.
import assert from 'node:assert/strict';
import { createGame, command, step, UNITS } from './shared/sim.js';
import { think, plan } from './shared/ai.js';
import { viewFor } from './shared/ai-view.js';
import { perceive, readinessFor, needsInspection } from './shared/ai-perception.js';
import { createHands, enqueueDecision, advanceHands, HUMAN_SKILLS } from './shared/ai-hands.js';
import { personaFor } from './shared/ai-persona.js';

const map = { w: 80, h: 80, rows: Array(80).fill('.'.repeat(80)),
  spawns: [{ x: 5, y: 5 }, { x: 75, y: 75 }], points: [] };
function fixture({ type = 'mg', cooldown = 0, start = 400, replacement = false, busy = false } = {}) {
  const original = Math.random;
  let game;
  Math.random = () => .5;
  try { game = createGame(map, ['AI', 'enemy'], false, [0, 1], [0, 1], { weather: false }); }
  finally { Math.random = original; }
  game.units.clear(); game.players[0].mp = game.players[1].mp = 5000;
  game.players[0].mun = 1000; game.players[0].sp = 0;
  assert.equal(command(game, 0, { t: 'buy', unit: type }), undefined);
  assert.equal(command(game, 1, { t: 'buy', unit: type === 'rifle' ? 'mg' : 'rifle' }), undefined);
  if (replacement) assert.equal(command(game, 0, { t: 'buy', unit: 'mg' }), undefined);
  const [own, enemy, other] = [...game.units.values()];
  Object.assign(own, { x: 80, z: 80, auto: false, autoRetreat: false });
  Object.assign(enemy, { x: 140, z: 140, auto: false, autoRetreat: false, holdFire: true });
  if (other) Object.assign(other, { x: 140, z: 120, auto: false, autoRetreat: false, cd: 30 });
  // The seat takes over a squad already travelling. This is an actual prior move, not a virtual AI selection.
  if (!busy) assert.equal(command(game, 0, { t: 'move', orders: [[own.id, 130, 80]] }), undefined);
  step(game); game.players[0].mp = 0; own.cd = cooldown; game.tick = start;
  const memory = { human: { camera: { x: 80, z: 80, yaw: 0, distance: 60 }, startedTick: start } };
  perceive(viewFor(game, 0, {}), 0, memory.human, start);
  return { game, own, enemy, other, memory, inputs: [], commands: [], readings: [], start };
}

function scene({ type = 'mg', cooldown = 0, start = 400, level = 'hard', seed = 27,
  outcome = 'correct', retreat = false, busy = false } = {}) {
  const f = fixture({ type, cooldown, start, replacement: outcome === 'wrong', busy });
  let delivered, altered = false, firstProposal;
  for (let tick = start + 1; tick < start + 221; tick++) {
    f.game.tick = tick;
    if (tick === start + 1) {
      Object.assign(f.enemy, { x: type === 'rifle' ? 96 : 98, z: 80 });
      if (type === 'mg') f.own.targetId = f.enemy.id;
      const full = UNITS[type].hpPer * UNITS[type].models;
      if (!busy) f.own.hp = full * (retreat ? .2 : .7);
      f.game.players[0].visible.add(f.enemy.id);
    }
    const hands = f.memory.human.hands, active = hands?.active, action = active?.actions[active.index];
    if (outcome !== 'correct' && !altered && active?.job.inspect && !active.reacting
      && action?.kind === 'select-click' && tick <= active.due) {
      const old = { x: f.own.x, z: f.own.z };
      Object.assign(f.own, { x: 140, z: 140 });
      if (f.other) Object.assign(f.other, old);
      altered = true;
    }
    // Normal cases deliberately complete selection between delivered snapshots.
    // Miss controls deliver the moved actors before the physical click, as the real hit test requires.
    const beat = outcome === 'correct' ? 4 : 2;
    if (!delivered || tick % beat === 0) delivered = viewFor(f.game, 0, {});
    think(f.game, 0, { memory: f.memory, view: delivered, level, seed,
      inputLog: input => f.inputs.push(structuredClone(input)), submit: cmd => {
        const result = command(f.game, 0, cmd);
        f.commands.push({ tick, cmd: structuredClone(cmd), result }); return result;
      } });
    const current = f.memory.human.hands;
    const job = current.active?.job?.inspect ? current.active.job : current.queue.find(job => job.inspect);
    if (job && !firstProposal) {
      assert.ok(Object.isFrozen(job.context.responseEvents));
      firstProposal = { tick, ids: [...job.ids], context: structuredClone(job.context), units: structuredClone(job.units) };
    }
    const view = f.memory.human.view;
    f.readings.push({ tick, deliveredTick: delivered.tick, hud: structuredClone(view.selectedHUD),
      answeredIds: [...(f.memory.human.answeredEvents ?? [])],
      own: { cd: view.units.get(f.own.id)?.cd, cdKnown: view.units.get(f.own.id)?.cdKnown,
        readiness: readinessFor(view, f.own.id) },
      other: f.other && { cdKnown: view.units.get(f.other.id)?.cdKnown, readiness: readinessFor(view, f.other.id) } });
    const inspection = f.inputs.find(input => input.inspection);
    if (f.commands.some(row => row.cmd.t === 'ability' || row.cmd.t === 'retreat')) break;
    if (busy && f.commands.some(row => row.cmd.orders)) break;
    if (outcome !== 'correct' && inspection && tick >= inspection.tick + 24) break;
  }
  return { ...f, firstProposal, altered };
}

function inspected(f) {
  const input = f.inputs.find(input => input.inspection);
  assert.ok(input && f.firstProposal, 'the actual planner requests and completes a physical inspection');
  assert.equal(input.kind, 'select-click'); assert.equal(input.command, undefined);
  assert.ok(input.tick >= f.start + 1 + 30, 'inspection pays the global opening or handover look');
  assert.equal(input.tick - input.inputStartedTick, input.motorTicks, 'full selection motor remains intact');
  assert.equal(input.inspectionAcquired, true); assert.deepEqual(input.ids, [f.own.id]);
  const required = f.memory.human.events.find(event => event.kind === 'screen-damage' && event.responseRequired);
  assert.ok(required, 'a real heavy-damage episode requires this actor to respond');
  assert.deepEqual(input.responseEvents.find(event => event.id === required.id), required,
    'inspection retains the original immutable causal descriptor');
  assert.ok(input.tick - required.tick >= 4);
  assert.ok(!f.readings.find(row => row.tick === input.tick).answeredIds.includes(required.id),
    'physical inspection alone does not acknowledge an accepted command');
  assert.equal(f.memory.human.hands.inputTicks.length, f.inputs.length, 'multiple links count each physical input once');
  return input;
}

for (const level of ['easy', 'normal', 'hard']) {
  const ready = scene({ level }), cooling = scene({ level, cooldown: 30 });
  const selected = inspected(ready); inspected(cooling);
  assert.deepEqual(cooling.firstProposal, ready.firstProposal, 'raw unselected cooldown cannot change the real inspection proposal');
  assert.deepEqual(cooling.inputs.filter(input => input.tick <= selected.tick), ready.inputs.filter(input => input.tick <= selected.tick),
    'ready and cooling squads have identical physical inputs before acquisition');
  const cast = ready.commands.find(row => row.cmd.t === 'ability');
  assert.ok(cast); assert.equal(cast.result, undefined, 'the real readiness decision produces an authoritative accepted ability');
  assert.deepEqual(cast.cmd.ids, [ready.own.id]); assert.ok(ready.own.buff > 0, 'MG suppression is active in the engine');
  assert.ok(cast.tick >= selected.tick + ({ easy: 10, normal: 6, hard: 4 }[level]), 'the acquired HUD receives paid reading time before the next decision');
  assert.ok(!cooling.commands.some(row => row.cmd.t === 'ability'), 'a genuinely cooling selected squad casts no ability');
  assert.equal(cooling.inputs.filter(input => input.inspection).length, 1, 'a still-selected known cooldown causes no repeated inspection clicks');
  const fresh = ready.readings.find(row => row.tick > selected.tick && row.hud.ids.includes(ready.own.id));
  assert.ok(fresh?.own.readiness.known && fresh.own.readiness.anyReady);
  assert.ok(ready.readings.filter(row => row.tick <= selected.tick).every(row => !row.own.readiness.known),
    'intended selection has no virtual readiness before its physical completion');
  assert.deepEqual(scene({ level }).inputs, ready.inputs, 'identical seeded scenes produce identical complete input logs');
}

{
  const ready = scene(), input = inspected(ready);
  const refreshed = ready.readings.find(row => row.tick === input.tick + 1);
  assert.equal(refreshed.deliveredTick, ready.readings.find(row => row.tick === input.tick).deliveredTick,
    'this selection proof spans the same delivered snapshot');
  assert.equal(refreshed.hud.observedTick, refreshed.deliveredTick);
  assert.ok(refreshed.own.readiness.known, 'actual selection invalidates perception and exposes its HUD before the next snapshot');
  const grenade = scene({ type: 'rifle' }); inspected(grenade);
  assert.ok(grenade.commands.some(row => row.cmd.t === 'ability' && row.result === undefined));
  assert.ok(grenade.own.nade, 'the actual selected rifle receives an aimed grenade order');
  const opening = scene({ start: 0 });
  const first = opening.inputs.find(input => input.command);
  assert.ok(first && first.tick >= 1 + HUMAN_SKILLS.hard.opening[0] * 20, 'inspection preserves the sampled first-order opening contract');
}

for (const outcome of ['wrong', 'miss']) {
  const f = scene({ outcome }), input = f.inputs.find(input => input.inspection);
  assert.ok(f.altered && input, 'the target changes during an actual pointer gesture');
  assert.equal(input.inspectionAcquired, false);
  assert.deepEqual(input.ids ?? [], outcome === 'wrong' ? [f.other.id] : []);
  assert.ok(f.readings.filter(row => row.tick > input.tick).every(row => !row.own.readiness.known),
    'a wrong or empty selection cannot reveal the intended actor cooldown');
  if (outcome === 'wrong') assert.ok(f.readings.some(row => row.other?.readiness.known && row.other.readiness.cooldownSeconds === 30),
    'a wrong hit reads only its actual selected squad HUD');
  assert.ok(!f.commands.some(row => row.cmd.t === 'ability' && row.cmd.ids.includes(f.own.id)));
  const required = f.memory.human.events.find(event => event.responseRequired && event.unitId === f.own.id);
  assert.ok(required && !f.memory.human.answeredEvents?.has(required.id), 'an inspection miss creates no accepted-command acknowledgement');
}

{
  const f = scene({ retreat: true });
  assert.ok(f.commands.some(row => row.cmd.t === 'retreat' && row.result === undefined));
  assert.ok(f.own.retreating, 'critical health causes a real authoritative retreat');
  assert.ok(!f.inputs.some(input => input.inspection), 'urgent retreat does not wait for unknown ability inspection');
  const busy = scene({ type: 'rifle', busy: true });
  assert.ok(busy.commands.some(row => row.cmd.orders?.some(order => order[0] === busy.own.id) && row.result === undefined));
  assert.ok(!busy.inputs.some(input => input.inspection), 'a squad already reserved by the defense decision acquires no irrelevant ability HUD');
}

{
  const f = fixture({ replacement: true }); Object.assign(f.other, { x: 88, z: 80 });
  f.game.players[0].visible.add(f.enemy.id); Object.assign(f.enemy, { x: 98, z: 80 });
  f.own.targetId = f.other.targetId = f.enemy.id;
  const hands = f.memory.human.hands = createHands({ slot: 0, level: 'hard', seed: 27,
    camera: f.memory.human.camera, startedTick: f.start, handover: true });
  const raw = viewFor(f.game, 0, {});
  assert.ok(enqueueDecision(hands, { t: 'move', orders: [[f.own.id, 120, 80], [f.other.id, 122, 80]] }, raw, { operation: 'advance' }));
  const sent = [];
  for (let tick = f.start; tick < f.start + 150 && !sent.length; tick++)
    advanceHands(hands, tick, raw, cmd => { assert.equal(command(f.game, 0, cmd), undefined); sent.push(cmd); });
  assert.ok(sent.length); assert.deepEqual(new Set(hands.selected), new Set([f.own.id, f.other.id]), 'a real formation physically selects both same-type squads');
  f.own.targetId = f.other.targetId = f.enemy.id;
  const view = perceive(viewFor(f.game, 0, {}), 0, f.memory.human, hands.tick);
  assert.equal(view.selectedHUD.types[0].count, 2); assert.equal(view.selectedHUD.types[0].ability.anyReady, true);
  assert.equal(readinessFor(view, f.own.id).known, false); assert.equal(readinessFor(view, f.other.id).known, false);
  assert.ok(needsInspection(view, f.own.id) && needsInspection(view, f.other.id), 'aggregate readiness does not disclose which same-type member is ready');
  f.memory.rng = hands.rng; personaFor(f.memory.human, hands.rng);
  const requests = [], orders = [];
  plan(view, 0, { human: true, level: 'hard', concern: { kind: 'combat', x: 80, z: 80 }, requestInspection: cmd => requests.push(cmd) }, f.memory,
    cmd => { orders.push(cmd); return undefined; });
  assert.ok(requests.some(cmd => cmd.t === 'ability')); assert.ok(!orders.some(cmd => cmd.t === 'ability'), 'the default planner requests a precise actual HUD selection before choosing an aggregate member');
}

console.log('Real commander inspection: cooldown privacy, physical HUD acquisition, same-snapshot refresh, ready/cooling abilities, misses, aggregation, retreat priority, opening and determinism passed.');
