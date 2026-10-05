import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import * as sim from './shared/sim.js';
import * as ai from './shared/ai.js';
import * as perception from './shared/ai-perception.js';
import * as hands from './shared/ai-hands.js';
import * as view from './shared/ai-view.js';
import { createAIcase } from './tools/ai-lab-runner.mjs';

export function nativeReadiness(control = 'medium') {
  const scene = { units: [{ owner: 0, type: 'at', x: 78, z: 79, autoRetreat: false, cooldown: control === 'cooling' ? 20 : control === 'unknown-ready' ? 0 : 5 },
    { owner: 1, type: control === 'light-tank' ? 'tank' : control === 'infantry' ? 'mg' : 'medium', x: 106, z: 79, holdFire: true }],
    points: [], camera: { x: control === 'offscreen' ? 55 : 80, z: 79, yaw: 0 },
    resources: [{ mp: 0, fuel: 0, mun: 100 }, { mp: 0, fuel: 0, mun: 0 }], cues: [] };
  const phases = [], receipts = [];
  const engine = { sim, perception, hands, view, ai: { ...ai, think(game, slot, opts) {
    const submit = opts.submit;
    const result = ai.think(game, slot, { ...opts, submit: command => {
      const paidCost = sim.abCost(game, sim.UNITS.at.ab);
      const error = submit(command);
      if (command.t === 'ability') receipts.push({ tick: game.tick, accepted: error === undefined,
        ownAPEnabled: game.units.get(7)?.ap, ownCooldown: game.units.get(7)?.cd, munitions: game.players[slot].mun, paidCost });
      return error;
    } });
    if (game.tick % 2 === 0) {
      const state = opts.memory.human, actor = state.view.units.get(7), active = state.hands.active;
      phases.push({ tick: game.tick, concern: state.concern?.id, noWorkUntil: state.noWorkUntil,
        deliberateUntil: state.deliberateUntil, selected: [...state.hands.selected],
        activeKind: active?.actions[active.index]?.kind, activeDue: active?.due,
        cooldownKnown: actor?.cdKnown, cooldown: actor?.cdKnown ? actor.cd : null, targetId: actor?.targetId,
        empty: [...(state.emptyCombatAreas?.values() ?? [])].map(area => ({ tick: area.tick, retryAt: area.retryAt, facts: area.facts })) });
    }
    return result;
  } } };
  const lab = createAIcase(engine, { scenario: 'contact-threat', level: 'hard', seed: 27, seconds: 12 }, scene);
  lab.advance(240);
  return { control, scene, phases, receipts, trace: lab.record() };
}
const baseline = process.env.AI_AP_BASELINE === '1', result = nativeReadiness();
assert.deepEqual(nativeReadiness(), result, 'the full actual native episode is deterministic');
const firstReady = result.phases.find(row => row.cooldownKnown && row.cooldown === 0);
assert.ok(firstReady, 'only an actual physical selection reveals the ready ability');
assert.deepEqual(firstReady.selected, [7]);
assert.ok(result.trace.inputs.some(input => input.kind === 'select-click' && input.ids.includes(7)
  && input.tick < firstReady.tick), 'the ready HUD follows an actual paid click');
const readyFrame = result.trace.frames.find(frame => frame.tick === firstReady.tick);
assert.equal(readyFrame.selectedHUD.types[0].ability.anyReady, true);
assert.equal(readyFrame.units.find(unit => unit.id === 8)?.type, 'medium', 'the vehicle type is actually on screen');
assert.ok(firstReady.empty.some(area => area.retryAt > firstReady.tick), 'readiness changes during a deferred combat visit');
const cast = result.trace.commands.find(row => row.command.t === 'ability');
assert.equal(cast?.accepted, true, 'the real native gate accepts AP');
assert.deepEqual(cast.command.ids, [7]);
assert.equal(result.receipts[0].ownAPEnabled, true, 'the accepted key really arms the native AP shot');
assert.equal(result.receipts[0].ownCooldown, sim.UNITS.at.ab.cd);
assert.equal(result.receipts[0].munitions, 100 - result.receipts[0].paidCost);
const firstInput = result.trace.inputs.find(input => input.command?.t === 'ability');
const start = result.trace.inputStarts.find(input => input.kind === 'ability-key');
assert.ok(firstInput && start && firstInput.tick >= start.dueTick && firstInput.tick > start.tick,
  'the whole original physical key motor completes before issuing the ability');
if (baseline) assert.ok(cast.tick >= firstReady.tick + 40, 'baseline ignores usable ready AP through repeated empty work');
else {
  assert.ok(cast.tick < firstReady.tick + 24, 'a real readiness change reopens the existing useful combat visit');
  const stance = result.trace.commands.find(row => row.command.t === 'stance');
  assert.ok(stance.tick >= 40 && stance.tick <= 80, 'the physical first-order opening contract remains');
}
assert.equal(result.trace.inputs.length, 3, 'the fix adds no artificial inputs or duplicate selection');
assert.equal(result.trace.commands.length, 2, 'the only commands are the useful stance and AP');
assert.ok(result.trace.commands.every(row => row.accepted));
for (let tick = 0; tick <= 240; tick++) assert.ok(result.trace.commands.filter(row => row.tick === tick).length <= 1);
const controls = ['cooling', 'light-tank', 'infantry', 'offscreen', 'unknown-ready'].map(nativeReadiness);
for (const name of ['cooling', 'infantry']) {
  assert.ok(!controls.find(row => row.control === name).trace.commands.some(row => row.command.t === 'ability'),
    `${name}: no unusable or irrelevant AP key is padded into the input budget`);
}
const offscreen = controls.find(row => row.control === 'offscreen'), firstFrame = offscreen.trace.frames[0];
assert.ok(firstFrame.units.some(unit => unit.id === 7) && !firstFrame.units.some(unit => unit.id === 8),
  'the neighboring-camera control actually keeps the gun visible and the foe off screen');
assert.ok(firstFrame.minimap.some(dot => dot.owner === 1 && dot.vehicle), 'the unseen vehicle is a delivered anonymous minimap dot');
const appears = offscreen.trace.frames.find(frame => frame.units.some(unit => unit.id === 8));
assert.ok(appears && !offscreen.trace.commands.some(row => row.command.t === 'ability' && row.tick < appears.tick),
  'remembered or minimap-only vehicle information cannot create an AP command');
const unknown = controls.find(row => row.control === 'unknown-ready');
const selectedAt = result.trace.inputs.find(input => input.kind === 'select-click').tick;
for (const key of ['inputs', 'inputStarts', 'commands', 'events', 'frames']) {
  assert.deepEqual(unknown.trace[key].filter(row => row.tick < selectedAt), result.trace[key].filter(row => row.tick < selectedAt),
    `${key}: changing private unselected cooldown cannot alter the actual pre-HUD trace`);
}
if (process.env.AI_AP_OUT) await writeFile(process.env.AI_AP_OUT, JSON.stringify({ result, controls }, null, 2));
console.log(`PASS AP readiness ${baseline ? 'qualified baseline' : 'candidate'}: actual selected HUD, deferred combat, native effect/motor, determinism and five controls.`);
