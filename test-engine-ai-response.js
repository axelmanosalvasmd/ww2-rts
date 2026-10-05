// Inject decisions to test response acknowledgement through real perception, hands and authoritative commands.
import assert from 'node:assert/strict';
import { createGame, command, step, supCost } from './shared/sim.js';
import { viewFor } from './shared/ai-view.js';
import { runCommander } from './shared/ai-commander.js';
import { HUMAN_SKILLS, createHands } from './shared/ai-hands.js';
import { onScreen } from './shared/ai-perception.js';
import { perceive as originalOracle } from './tools/ai-screen-v1-oracle.js';
import { measurementScoringViews } from './tools/ai-humanity.mjs';

const map = points => ({ w: 80, h: 80, rows: Array(80).fill('.'.repeat(80)),
  spawns: [{ x: 20, y: 40 }, { x: 75, y: 40 }], points });
function fixture(points = []) {
  const g = createGame(map(points), ['AI', 'enemy'], false, [0, 1], [0, 1], { weather: false });
  g.units.clear(); g.players[0].mp = 5000; g.players[0].mun = 1000;
  for (let i = 0; i < 3; i++) assert.equal(command(g, 0, { t: 'buy', unit: 'rifle' }), undefined);
  const own = [...g.units.values()];
  own.forEach((unit, i) => Object.assign(unit, { x: i === 2 ? 135 : 75 + i * 6, z: i === 2 ? 135 : 80,
    holdFire: true, auto: false, autoRetreat: false }));
  g.players[0].mp = 500; step(g);
  return { g, own, memory: { human: { startedTick: g.tick, camera: { x: 80, z: 80, yaw: 0, distance: 60 } } }, inputs: [], results: [] };
}

function responseScene(kind, mode = 'accept', seed = 27) {
  const f = fixture(), ids = f.own.slice(0, 2).map(unit => unit.id);
  const frames = [], measurements = { measureRaw: originalOracle, onMeasurements: payload => frames.push(structuredClone(payload)) };
  if (mode === 'late-event') Object.assign(f.own[2], { x: 78, z: 82 });
  let view, proposed = false, context, altered = false, damageEvents;
  for (let tick = f.g.tick; tick < 600; tick++) {
    f.g.tick = tick;
    if (tick === 100) f.own.slice(0, 2).forEach(unit => { unit.hp *= .6; });
    const hands = f.memory.human.hands, active = hands?.active, action = active?.actions[active.index];
    if (!context) {
      const job = active?.job ?? hands?.queue.find(job => job.command?.t === kind);
      if (job?.context.responseEvents.some(event => event.kind === 'screen-damage')) {
        context = structuredClone(job.context);
        assert.ok(Object.isFrozen(job.context.responseEvents), 'the queued response descriptors are fixed before motor execution');
      }
    }
    if (mode === 'wrong-actor' && context && !altered && tick % 2 === 0 && action?.kind === 'select-box' && tick < active.due) {
      // Another real squad occupies the box while its intended recipient moves during the gesture.
      Object.assign(f.own[0], { x: 100, z: 100 }); Object.assign(f.own[2], { x: 75, z: 80 }); altered = true;
    }
    if (mode === 'late-event' && context && !altered && tick % 2 === 0 && active && tick < active.due) {
      // A new, noninterrupting damage cue appears after this support response was already enqueued.
      Object.assign(f.own[2], { x: 78, z: 82 }); f.own[2].hp -= 5; altered = true;
    }
    if (!view || tick % 2 === 0) view = viewFor(f.g, 0, {});
    runCommander(view, 0, { tick, level: 'normal', seed, perceptionMeasurements: measurements,
      inputLog: input => f.inputs.push(structuredClone(input)) }, f.memory,
      cmd => {
        if (mode === 'refuse') f.g.players[0][supCost(f.g, 'smoke').cur] = 0;
        const result = command(f.g, 0, cmd);
        const ids = cmd.ids ?? cmd.orders?.map(order => order[0]) ?? [];
        f.results.push({ tick, cmd: structuredClone(cmd), result,
          locations: Number.isFinite(cmd.x) ? [{ x: cmd.x, z: cmd.z }] : cmd.orders?.map(row => ({ x: row[1], z: row[2] })) ?? [],
          sourceLocations: ids.map(id => f.g.units.get(id)).filter(Boolean).map(unit => ({ x: unit.x, z: unit.z })) });
        return result;
      }, (_view, _slot, _opts, _memory, send) => {
        if (tick < 100 || proposed) return;
        const cmd = kind === 'retreat' ? { t: 'retreat', ids }
          : { t: 'support', kind: 'smoke', x: mode === 'wrong-target' ? 98.9 : 78, z: 80 };
        if (send(cmd) === undefined) proposed = true;
      });
    damageEvents ??= f.memory.human.events.filter(event => event.kind === 'screen-damage' && event.tick === 100).length === 2
      ? structuredClone(f.memory.human.events.filter(event => event.kind === 'screen-damage' && event.tick === 100)) : undefined;
    if (f.results.length || mode === 'wrong-actor' && altered && !hands.active) break;
  }
  assert.equal(damageEvents?.length, 2, 'two independently observed damage episodes exist before the response');
  assert.ok(damageEvents.every(event => event.source === 'screen' && event.observedDanger.lossShare >= .25
    && !Object.hasOwn(event, 'responseRequired')), 'actual runtime damage cues carry observed danger without grading labels');
  const scoring = measurementScoringViews({ events: f.memory.human.events, inputs: f.inputs,
    commands: f.results.map(row => ({ ...row, command: row.cmd, accepted: row.result === undefined })),
    perceptionMeasurements: { schema: 'ww2-private-perception-measurements-v1', toolOnly: true, startedTick: 1, frames } }, f.g.tick / 20);
  const originalDamage = scoring.originalOracle.log.events.filter(event => event.kind === 'screen-damage' && event.tick === 100);
  assert.equal(originalDamage.length, 2);
  assert.ok(originalDamage.every(event => event.responseRequired && event.source === 'screen'), 'both original oracle episodes require a screen response');
  assert.equal(scoring.originalOracle.explicitLinked.requiredScreenPopulation.requiredEvents, 2, 'the private original scored population remains unchanged');
  for (const key of ['unknownRuntimeMappings', 'unknownOriginalMappings', 'mismatchedCreationMappings', 'invalidRuntimeDescriptors'])
    assert.equal(scoring.audit[key], 0, 'only complete matching creation descriptors map native inputs to the original oracle');
  assert.ok(context, 'the commander enqueues a deliberate response to these episodes');
  assert.ok(damageEvents.every(event => context.responseEvents.some(link => link.id === event.id)),
    'the queued job links both independently causal events');
  return { ...f, context, damageEvents, originalDamage, scoring, altered };
}

for (const kind of ['retreat', 'support']) {
  const f = responseScene(kind), issued = f.inputs.find(input => input.command?.t === kind);
  assert.equal(f.results[0]?.result, undefined, 'the ordinary command accepts the response');
  assert.ok(issued, 'the accepted response has a real issuing input');
  assert.ok(f.context.responseEvents.every(event => f.memory.human.answeredEvents.has(event.id)),
    'the accepted action acknowledges every deliberately linked episode that it actually serves');
  for (const event of f.damageEvents) {
    assert.ok(f.memory.human.answeredEvents.has(event.id), 'one accepted action acknowledges each deliberately linked causal episode');
    assert.deepEqual(f.context.responseEvents.find(link => link.id === event.id), event,
      'enqueue retains the complete actual runtime creation descriptor');
    assert.deepEqual(issued.responseEvents.find(link => link.id === event.id), event,
      'the issuing input retains the complete original descriptor fixed at enqueue');
    assert.ok(issued.tick - event.tick >= 4, 'each independently linked episode respects the reaction floor');
  }
  const scoredInput = f.scoring.originalOracle.log.inputs.find(input => input.command?.t === kind);
  for (const event of f.originalDamage) assert.deepEqual(scoredInput.responseEvents.find(link => link.id === event.id), event,
    'the external original score retains complete original eligibility descriptors through native creation aliases');
  assert.equal(f.scoring.originalOracle.explicitLinked.requiredScreenPopulation.acceptedCommand.answered, 2);
  assert.equal(f.inputs.filter(input => input.tick >= 100 && input.kind.startsWith('camera-')).length, 0,
    'a currently on-screen damage response pays no unnecessary camera gesture');
  if (kind === 'retreat') assert.ok(f.own.slice(0, 2).every(unit => unit.retreating), 'the selected group actually enters retreat');
  else assert.ok(f.g.strikes.some(strike => strike.kind === 'smoke'), 'the physical support click creates the authoritative strike');
}

{
  const f = responseScene('support', 'refuse');
  assert.ok(f.results[0]?.result && f.inputs.some(input => input.command?.t === 'support'),
    'the ordinary command rejects a real issuing support click after the currency is exhausted');
  assert.ok(f.damageEvents.every(event => !f.memory.human.answeredEvents?.has(event.id)),
    'a refused actual command leaves every linked obligation unanswered');
  assert.equal(f.g.strikes.length, 0, 'the refused click creates no strike');
  assert.equal(f.scoring.originalOracle.explicitLinked.requiredScreenPopulation.acceptedCommand.answered, 0);
}

{
  const f = responseScene('retreat', 'wrong-actor');
  assert.ok(f.altered && f.inputs.some(input => input.kind === 'select-box' && input.ids?.includes(f.own[2].id)),
    'the real selection gesture hits the replacement actor');
  assert.equal(f.results.length, 0, 'a selection that hits the wrong squad cannot dispatch the intended retreat');
  assert.ok(f.damageEvents.every(event => !f.memory.human.answeredEvents?.has(event.id)),
    'the wrong actual selection cannot acknowledge its intended damage responses');
  assert.equal(f.scoring.originalOracle.explicitLinked.requiredScreenPopulation.acceptedCommand.answered, 0);
}

{
  // This seeded endpoint error crosses one episode's locality boundary while still serving its neighbor.
  const f = responseScene('support', 'wrong-target', 1), [missed, served] = f.damageEvents;
  const actual = f.results[0]?.cmd, at = event => Math.hypot(actual.x - event.x, actual.z - event.z);
  assert.equal(f.results[0]?.result, undefined, 'the misplaced physical click is an accepted ordinary support action');
  assert.ok(Math.hypot(98.9 - missed.x, 80 - missed.z) < 24 && at(missed) > 24,
    'the intended response was relevant but the actual endpoint missed that episode');
  assert.ok(!f.memory.human.answeredEvents.has(missed.id), 'an accepted click at the wrong actual target cannot acknowledge its intended episode');
  assert.ok(at(served) < 24 && f.memory.human.answeredEvents.has(served.id),
    'the same accepted click still acknowledges the independently causal neighboring episode');
  assert.equal(f.scoring.originalOracle.explicitLinked.requiredScreenPopulation.acceptedCommand.answered, 1);
}

{
  const f = responseScene('support', 'late-event'), late = f.memory.human.events.find(event => event.kind === 'screen-damage' && event.unitId === f.own[2].id);
  const originalLate = f.scoring.originalOracle.log.events.find(event => event.kind === 'screen-damage' && event.unitId === f.own[2].id);
  assert.ok(f.altered && late && late.observedDanger.lossShare === .05, 'the delivered late cue is visibly genuine and does not interrupt the earlier response');
  assert.ok(originalLate && originalLate.responseRequired === false, 'the independent original oracle preserves the late monitoring classification');
  assert.equal(f.results[0]?.result, undefined, 'the original support response still completes through the ordinary command');
  const issued = f.inputs.find(input => input.command?.t === 'support');
  assert.ok(!issued.responseEvents.some(event => event.id === late.id), 'a cue discovered after enqueue is not attached retrospectively');
  assert.ok(!f.memory.human.answeredEvents.has(late.id), 'the earlier command cannot acknowledge a later unlinked cue');
  assert.ok(f.damageEvents.every(event => f.memory.human.answeredEvents.has(event.id)), 'the existing links remain acknowledged');
}

{
  const f = fixture([{ x: 49, y: 40 }]), actor = f.own[0], other = f.own[1], point = f.g.points[0];
  let view;
  for (let tick = 0; tick < 1600; tick++) {
    if (!view || f.g.tick % 2 === 0) view = viewFor(f.g, 0, {});
    runCommander(view, 0, { tick: f.g.tick, level: 'normal', seed: 27, inputLog: input => f.inputs.push(structuredClone(input)) }, f.memory,
      cmd => {
        const result = command(f.g, 0, cmd);
        f.results.push({ tick: f.g.tick, cmd: structuredClone(cmd), result });
        return result;
      }, (_view, _slot, _opts, _memory, send) => {
        const movements = f.results.filter(row => row.result === undefined && row.cmd.orders?.some(order => order[0] === actor.id));
        const switched = f.results.some(row => row.result === undefined && row.cmd.t === 'stance' && row.cmd.ids.includes(other.id));
        if (!movements.length) send({ t: 'move', orders: [[actor.id, point.x, point.z]] });
        else if (point.owner === 0 && !switched) send({ t: 'stance', ids: [other.id], key: 'holdFire', on: false });
        else if (switched && movements.length === 1) send({ t: 'move', orders: [[actor.id, point.x + 7, point.z]] });
      });
    step(f.g);
    if (f.results.filter(row => row.result === undefined && row.cmd.orders?.some(order => order[0] === actor.id)).length >= 2) break;
  }
  assert.equal(point.owner, 0, 'the opening single-squad movement actually captures its neutral objective');
  const first = f.inputs.find(input => input.command?.orders?.some(order => order[0] === actor.id));
  const binding = f.inputs.find(input => input.kind === 'group-set' && input.ids?.length === 1 && input.ids[0] === actor.id);
  assert.ok(first && !binding, 'a useful single-squad opening does not automatically bind a group');
  assert.ok(first.tick - f.memory.human.startedTick <= HUMAN_SKILLS.normal.opening[1] * 20,
    'the useful movement fits within the ordinary opening look');
  const switchInput = f.inputs.find(input => input.command?.t === 'stance' && input.ids?.includes(other.id));
  const selected = f.inputs.find(input => input.kind === 'select-click' && input.tick > switchInput?.tick
    && input.ids?.length === 1 && input.ids[0] === actor.id);
  assert.ok(switchInput && selected, 'another actual selection is followed by a real click on the original single squad');
  assert.ok(!f.inputs.some(input => input.kind === 'group-recall'), 'a singleton assignment creates no phantom recall key');
  assert.ok(f.inputs.some(input => input.tick > selected.tick && input.command?.orders?.some(order => order[0] === actor.id)),
    'the paid selection is followed by the second accepted movement of that squad');
}

{
  const f = fixture(), actor = f.own[0], member = f.own[1], other = f.own[2];
  Object.assign(other, { x: 100, z: 95 });
  let view, died = false;
  for (let tick = 0; tick < 1200; tick++) {
    if (!view || f.g.tick % 2 === 0) view = viewFor(f.g, 0, {});
    runCommander(view, 0, { tick: f.g.tick, level: 'normal', seed: 27, inputLog: input => f.inputs.push(structuredClone(input)) }, f.memory,
      cmd => {
        const result = command(f.g, 0, cmd);
        f.results.push({ tick: f.g.tick, cmd: structuredClone(cmd), result }); return result;
      }, (observed, _slot, _opts, _memory, send) => {
        const moves = f.results.filter(row => row.result === undefined && row.cmd.orders?.some(order => order[0] === actor.id));
        const switched = f.results.some(row => row.result === undefined && row.cmd.t === 'stance' && row.cmd.ids.includes(other.id));
        if (!moves.length) send({ t: 'move', orders: [[actor.id, 95, 80], [member.id, 97, 80]] });
        else if (moves.length === 1 && moves[0].cmd.orders.every(order => {
          const unit = observed.units.get(order[0]);
          return unit?.screenSeen && Math.hypot(unit.x - order[1], unit.z - order[2]) <= 2;
        })) send({ t: 'move', orders: [[actor.id, 107, 80], [member.id, 109, 80]] });
        else if (died && !switched) send({ t: 'stance', ids: [other.id], key: 'holdFire', on: false });
        else if (switched && moves.length === 2) send({ t: 'move', orders: [[actor.id, 115, 80]] });
      });
    // Repeat the actual two-squad operation and finish its paid binding before removing a member.
    if (!died && f.inputs.some(input => input.kind === 'group-set' && input.ids?.length === 2)) {
      f.g.units.delete(member.id); died = true;
    }
    step(f.g);
    if (f.results.filter(row => row.result === undefined && row.cmd.orders?.some(order => order[0] === actor.id)).length >= 3) break;
  }
  const moves = f.results.filter(row => row.result === undefined && row.cmd.orders?.some(order => order[0] === actor.id));
  const binding = f.inputs.find(input => input.kind === 'group-set' && input.ids?.length === 2);
  assert.equal(moves.length, 3, 'two accepted group movements establish reuse before the surviving singleton moves');
  for (const move of moves.slice(0, 2)) assert.deepEqual(move.cmd.orders.map(order => order[0]).sort((a, b) => a - b), [actor.id, member.id],
    'both repeated native commands move the same actual two-squad selection');
  assert.ok(binding && binding.tick > moves[1].tick && binding.input.ctrl,
    'the second accepted operation is followed by a separate physical Ctrl plus digit binding');
  const switched = f.inputs.find(input => input.command?.t === 'stance' && input.ids.includes(other.id));
  const recall = f.inputs.find(input => input.kind === 'group-recall' && input.tick > switched?.tick && input.ids?.length === 1);
  assert.ok(died && binding && switched && recall, 'a genuine previously bound operation pays a recall after one member dies');
  assert.ok(switched.tick > binding.tick, 'another native selection is acquired only after the real group binding completes');
  assert.deepEqual(binding.ids, [actor.id, member.id]); assert.deepEqual(recall.ids, [actor.id]);
  assert.equal(recall.input.code, binding.input.code, 'the surviving singleton uses its physically assigned key');
  assert.ok(f.results.some(row => row.tick > recall.tick && row.result === undefined && row.cmd.orders?.some(order => order[0] === actor.id)),
    'the actual surviving selection receives a subsequent accepted movement');
  assert.equal(f.inputs.filter(input => input.kind === 'group-set').length, 1, 'pruning does not bind a replacement singleton');
  console.log(`Living group recall: accepted pair moves ${moves[0].tick}/${moves[1].tick}, binding ${binding.tick}, switch ${switched.tick}, recall ${recall.tick}, accepted survivor move ${moves[2].tick}.`);
}

for (const approach of ['normal', 'pending-emergency', 'expired-concern']) {
  const interrupted = approach !== 'normal';
  const f = fixture(), state = f.memory.human, remote = f.own[2], targetId = `idle:${remote.id}`, oldDeadline = 80;
  remote.hp *= .8;
  // A previously chosen visit is near its deadline when the hands become free to begin its camera trip.
  state.startedTick = 0;
  state.hands = createHands({ slot: 0, seed: 27, level: 'normal', camera: state.camera, startedTick: 0 });
  state.concern = { id: 'production', kind: 'production', x: 41, z: 81, since: 0, until: 74 };
  state.attention = { visits: new Map(), since: 0, until: oldDeadline,
    current: { id: targetId, kind: 'idle', unitId: remote.id, x: remote.x, z: remote.z, urgency: 35 } };
  state.ownStill = new Map(f.own.map(unit => [unit.id, { x: unit.x, z: unit.z, since: -100 }]));
  let view, emergencyTick, departure, proposed = false;
  const plans = [], cameraTimeline = []; let creation, expiredOnce = false;
  for (let tick = 75; tick < 400; tick++) {
    f.g.tick = tick;
    const active = state.hands.active;
    if (interrupted && emergencyTick == null && tick % 2 === 0 && active?.job.camera && tick < active.due
      && (!active.panKeys || active.panKeys.some(key => tick >= key.down && !key.released))) {
      emergencyTick = tick; f.own[0].hp *= .6;
    }
    if (!view || tick % 2 === 0) view = viewFor(f.g, 0, {});
    runCommander(view, 0, { tick, level: 'normal', seed: 27, inputLog: input => f.inputs.push(structuredClone(input)) }, f.memory,
      cmd => {
        const result = command(f.g, 0, cmd); f.results.push({ tick, cmd: structuredClone(cmd), result }); return result;
      }, (observed, _slot, opts, _memory, send) => {
        plans.push({ tick, concern: opts.concern.id, remote: structuredClone(observed.units.get(remote.id)),
          victim: structuredClone(observed.units.get(f.own[0].id)) });
        if (proposed) return;
        if (interrupted && emergencyTick != null) proposed = send({ t: 'retreat', ids: [f.own[0].id] }) === undefined;
        else if (opts.concern.id === targetId) proposed = send({ t: 'stance', ids: [remote.id], key: 'holdFire', on: false }) === undefined;
      });
    cameraTimeline.push({ tick, camera: { ...state.camera }, historicalOnScreen: state.concern?.eventOnScreen,
      currentlyOnScreen: onScreen(f.own[0], state.camera, view), pendingEmergency: !!state.pendingEmergency });
    creation ??= structuredClone(state.events?.find(event => event.kind === 'screen-damage' && event.tick === emergencyTick));
    if (approach === 'expired-concern' && !expiredOnce && f.inputs.some(input => input.kind === 'camera-pan') && !state.hands.active && !f.results.length)
      { state.concern.until = tick; expiredOnce = true; } // Reselect once after the same actual interrupted held input finishes.
    if (!departure && state.cameraVisit) departure = { tick, id: state.concern.id, until: state.concern.until };
    if (f.results.length) break;
  }
  assert.deepEqual(departure, { tick: 75, id: targetId, until: oldDeadline },
    'the commander actually departs for the established concern before its original deadline');
  if (interrupted) {
    assert.ok(emergencyTick != null, 'a stronger genuine damage cue interrupts the camera approach');
    assert.ok(!plans.some(row => row.concern === targetId), 'an interrupted visit does not inspect the remote concern afterward');
    assert.equal(f.results[0]?.cmd.t, 'retreat', 'the stronger emergency receives the actual physical response');
    assert.equal(f.results[0]?.result, undefined);
    assert.ok(f.results[0].tick - emergencyTick >= 4, 'the replacement emergency response respects the causal floor');
    const cameras = f.inputs.filter(input => input.kind.startsWith('camera-'));
    assert.equal(cameras[0].input.code, 'KeyD', 'the original held horizontal pan is still paid to completion');
    assert.equal(cameras[0].inputStartedTick, 76);
    assert.equal(cameras[0].panRelease.plannedUpTick, 96, 'the original full-target motor clock remains recorded');
    assert.ok(cameras[0].tick < cameras[0].panRelease.plannedUpTick && cameras[0].tick >= emergencyTick + 4);
    assert.equal(cameras[0].tick, cameras[0].inputStartedTick + cameras[0].motorTicks,
      'the paid gesture records all executed preparation and holding through its real early keyup');
    assert.equal(cameras[0].tick, cameras[0].panRelease.releaseStartTick + cameras[0].panRelease.releaseMotorTicks);
    assert.ok(cameras[0].panRelease.releaseMotorTicks > 0);
    assert.equal(cameras[0].panRelease.cause.id, creation.id, 'only the actually delivered emergency causes the release');
    assert.ok(cameraTimeline.some(frame => frame.historicalOnScreen === true && !frame.currentlyOnScreen),
      'a genuinely on-screen creation becomes off-screen after the paid held pan');
    assert.ok(cameras.some(input => input.tick > cameras[0].tick && onScreen(f.own[0], input.camera, view)),
      'a later paid camera return makes the intended victim currently clickable');
    assert.ok(creation?.onScreen && creation.source === 'screen' && creation.tick === emergencyTick,
      'the actual immutable creation descriptor keeps its historical screen truth and clock');
    assert.deepEqual(state.events.find(event => event.id === creation.id), creation,
      'returning the camera does not rewrite the creation descriptor');
    assert.ok(plans.every(plan => plan.victim.screenSeen && !plan.victim.inventoryOnly),
      'no emergency planning pass repeatedly proposes a physical response from an off-screen inventory actor');
    const returned = cameras.find(input => input.tick > cameras[0].tick && onScreen(f.own[0], input.camera, view));
    assert.ok(plans.some(plan => plan.tick > returned.tick), 'return arrival pays fresh deliberation before planning');
    console.log(`Interrupted camera ${approach}: cue ${emergencyTick}, held finish ${cameras[0].tick}, paid return ${returned.tick}, native accepted retreat ${f.results[0].tick}.`);

  } else {
    const cameras = f.inputs.filter(input => input.kind.startsWith('camera-'));
    assert.equal(cameras.length, 2, 'the diagonal visit pays each of its two held direction keys once without camera churn');
    assert.deepEqual(cameras.map(input => [input.kind, input.input.code]), [['camera-pan', 'KeyD'], ['camera-pan', 'KeyS']],
      'the human route pays separate horizontal and forward key motors');
    assert.ok(cameras[0].camera.z > 80); assert.equal(cameras[1].camera.x, cameras[0].camera.x);
    assert.ok(cameras[1].inputStartedTick < cameras[0].tick,
      'the second paid key preparation overlaps the first held direction');
    assert.ok(cameras.every(input => input.motorTicks > 0 && input.tick > input.inputStartedTick));
    assert.ok(onScreen(remote, cameras[1].camera, view), 'the completed diagonal trip reaches its intended actor');
    assert.ok(plans.every(row => row.remote.screenSeen && !row.remote.inventoryOnly),
      'no planning pass treats an incomplete camera trip as an inspected scene');
    assert.ok(cameras[0].tick > oldDeadline, 'the actual paid camera trip outlasts the original visit deadline');
    const fresh = plans.find(row => row.concern === targetId);
    assert.ok(fresh && fresh.tick > cameras.at(-1).tick, 'complete arrival is followed by fresh local deliberation and a planning pass at the original concern');
    assert.ok(fresh.remote.screenSeen && !fresh.remote.inventoryOnly && fresh.remote.hp === remote.hp,
      'that planning pass receives newly inspected health rather than the earlier off-camera inventory estimate');
    assert.ok(onScreen(remote, state.camera, view), 'the actual camera has reached the remote squad');
    assert.equal(f.results[0]?.cmd.t, 'stance');
    assert.equal(f.results[0]?.result, undefined, 'the arrived concern executes its command through real selection and hands');
    console.log(`Camera arrival: old deadline ${oldDeadline}, paid pans ${cameras.map(input => input.tick).join('/')}, fresh plan ${fresh.tick}, command ${f.results[0].tick}.`);
  }
}

console.log('Commander accepted multi-event responses, refusal, wrong actor and target, fixed links, direct singleton selection, living group recall and paid camera visits passed.');
