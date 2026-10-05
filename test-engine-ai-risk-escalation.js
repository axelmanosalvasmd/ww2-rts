import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import * as sim from './shared/sim.js';
import * as ai from './shared/ai.js';
import * as perception from './shared/ai-perception.js';
import * as hands from './shared/ai-hands.js';
import * as view from './shared/ai-view.js';
import { createAIcase } from './tools/ai-lab-runner.mjs';

// Author two actual hits before observation delivery. The first includes pinned suppression.
// The second is triggered by the declared physical phase, never by a scoring label.
export function nativeEscalation(control = 'risk') {
  const rows = [{ owner: 0, type: 'rifle', x: 78, z: 79, holdFire: true, autoRetreat: false }];
  if (control === 'other-actor') rows.push({ owner: 0, type: 'rifle', x: 84, z: 85, holdFire: true });
  rows.push({ owner: 1, type: 'medium', x: 110, z: 79, holdFire: true });
  const scene = { units: rows, points: [{ x: 80, z: 80, owner: 0 }],
    camera: { x: 80, z: 79, yaw: 0 },
    resources: [{ mp: 20, fuel: 0, mun: 0 }, { mp: 0, fuel: 0, mun: 0 }],
    cues: [{ kind: 'hit', tick: 160, unitId: 7, damage: control === 'already-risk' ? 45 : 35 }] };
  let memory, cue;
  const phases = [];
  const engine = { sim, perception, hands,
    ai: { ...ai, think(game, slot, opts) {
      memory = opts.memory;
      const result = ai.think(game, slot, opts);
      if (game.tick >= 158 && game.tick <= 210) {
        const state = memory.human, active = state.hands.active;
        const action = active?.actions[active.index];
        phases.push({ tick: game.tick, concern: state.concern?.id,
          deliberateUntil: state.deliberateUntil, noWorkUntil: state.noWorkUntil,
          activeKind: action?.kind, reacting: active?.reacting ?? false,
          priority: active?.job.context.priority, selected: [...state.hands.selected],
          dueTick: active?.due, activeCommand: active?.job.command,
          responseEvents: active?.job.context.responseEvents });
      }
      return result;
    } },
    view: { ...view, viewFor(game, slot, cache) {
      if (game.tick === 160) game.units.get(7).supp = 99;
      const state = memory?.human, active = state?.hands?.active;
      const action = active?.actions[active.index];
      const matching = control === 'already-risk' ? active?.job.command?.t === 'retreat'
        : active?.job.command?.t === 'move' && action?.screenClick;
      if (!cue && game.tick > 160 && active && !active.reacting && matching && action?.fire
        && active.job.context.event?.kind === 'screen-damage' && active.due > game.tick) {
        const actor = game.units.get(control === 'other-actor' ? 8 : 7);
        const amount = control === 'not-risk' || control === 'already-risk' ? 5
          : control === 'automatic-covered' ? 45 : control === 'other-actor' ? 45 : 10;
        actor.hp = Math.max(1, actor.hp - amount);
        if (control === 'other-actor') actor.supp = 99;
        game.shots.push({ k: 'hurt', t: actor.id, to: 0, fo: 1, x: actor.x, z: actor.z, kill: false });
        cue = { tick: game.tick, actorId: actor.id, amount, health: actor.hp,
          suppression: actor.supp, selection: [...state.hands.selected],
          activeCommand: structuredClone(active.job.command), activePriority: active.job.context.priority,
          originalDueTick: active.due, pointer: structuredClone(state.hands.pointer),
          authorNote: 'Authored hit at the first uncompleted issuing gesture answering the first damage cue.' };
      }
      return view.viewFor(game, slot, cache);
    } } };
  const lab = createAIcase(engine, { scenario: 'guard', level: 'normal', seed: 27, seconds: 20 }, scene);
  lab.advance(400);
  return { scene, control, cue, phases, trace: lab.record() };
}
const baseline = process.env.AI_ESCALATION_BASELINE === '1';
const result = nativeEscalation();
assert.deepEqual(nativeEscalation(), result, 'the native authored scene and all actual actions are deterministic');
assert.ok(result.cue, 'the first default-planner escape really reached its unpressed right-click approach');
assert.deepEqual(result.cue.selection, [7], 'the threatened actor was selected by preceding real physical inputs');
assert.equal(result.cue.activePriority, 103, 'the queued previous damage task has the same urgency as the new cue');
const damage = result.trace.events.filter(event => event.kind === 'screen-damage');
assert.equal(damage.length, 2);
assert.equal(damage[0].observedDanger.retreatRisk, false);
assert.equal(damage[1].observedDanger.retreatRisk, true);
assert.equal(damage[1].observedDanger.autoRetreatCovered, false, 'this is manual work rather than automatic retreat');
assert.equal(damage[1].unitId, 7);
assert.ok(result.trace.frames.find(row => row.tick === 160).units.some(unit => unit.owner === 1 && unit.type === 'medium'),
  'the escape responds to an actually delivered screen threat rather than an unseen armor identity');
const response = result.trace.commands.find(row => row.command.t === 'retreat' && row.command.ids.includes(7));
if (baseline) {
  assert.equal(response, undefined, 'the baseline misses the short pinned-risk window after finishing the older movement');
  assert.ok(result.trace.commands.some(row => row.tick === result.cue.originalDueTick && row.command.t === 'move'),
    'the baseline first finishes its older escape click');
} else {
  assert.equal(response?.accepted, true, 'the native command gate accepts the useful retreat');
  const interrupted = result.phases.find(row => row.tick === result.cue.tick);
  assert.equal(interrupted.activeKind, undefined, 'the old approach is actually canceled at cue delivery');
  assert.deepEqual(interrupted.selected, [7], 'preemption preserves the real previous selection');
  assert.ok(!result.trace.inputs.some(row => row.tick === result.cue.tick), 'canceling an unpressed approach creates no completed input or APM entry');
  assert.ok(!result.trace.commands.some(row => row.tick >= result.cue.tick && row.command.t === 'move'),
    'the older unpressed issuing click is canceled without a synthetic command');
  const input = result.trace.inputs.find(row => row.tick === response.tick && row.command?.t === 'retreat');
  const start = result.trace.inputStarts.find(row => row.kind === 'retreat-key' && row.context.event?.id === damage[1].id);
  assert.ok(input && start, 'the actual retreat has a physical key start and completion receipt');
  assert.ok(input.tick - damage[1].tick >= 4, 'the new causal cue keeps the complete four-tick reaction floor');
  assert.ok(input.tick >= start.dueTick && input.tick > start.tick, 'the complete original key motor is paid');
  assert.equal(input.event.id, damage[1].id, 'the response retains the new actual public creation identity');
  assert.deepEqual(input.ids, [7]);
}
for (let tick = 0; tick <= 400; tick++) assert.ok(result.trace.commands.filter(row => row.tick === tick).length <= 1);
const controls = ['not-risk', 'other-actor', 'automatic-covered', 'already-risk'].map(nativeEscalation);
assert.ok(controls.every(row => row.cue), 'all negative controls reach an actual relevant issuing gesture');
const covered = controls.find(row => row.control === 'automatic-covered');
assert.ok(covered.trace.events.some(event => event.kind === 'screen-damage' && event.observedDanger.autoRetreatCovered),
  'the automatic-retreat control uses its delivered automatic coverage');
if (process.env.AI_ESCALATION_OUT) await writeFile(process.env.AI_ESCALATION_OUT, JSON.stringify({ result, controls }, null, 2));
console.log(`PASS native risk escalation ${baseline ? 'qualified baseline' : 'candidate'}: two watched cues, real approach/selection, native retreat motor, determinism and four controls.`);
