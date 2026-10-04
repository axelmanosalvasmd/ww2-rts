// Inject decisions to test response acknowledgement through real perception, hands and authoritative commands.
import assert from 'node:assert/strict';
import { createGame, command, step, supCost } from './shared/sim.js';
import { viewFor } from './shared/ai-view.js';
import { runCommander } from './shared/ai-commander.js';
import { HUMAN_SKILLS, createHands } from './shared/ai-hands.js';
import { onScreen } from './shared/ai-perception.js';

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
      Object.assign(f.own[2], { x: 78, z: 82 }); f.own[2].hp -= 1; altered = true;
    }
    if (!view || tick % 2 === 0) view = viewFor(f.g, 0, {});
    runCommander(view, 0, { tick, level: 'normal', seed, inputLog: input => f.inputs.push(structuredClone(input)) }, f.memory,
      cmd => {
        if (mode === 'refuse') f.g.players[0][supCost(f.g, 'smoke').cur] = 0;
        const result = command(f.g, 0, cmd);
        f.results.push({ tick, cmd: structuredClone(cmd), result });
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
  assert.ok(damageEvents.every(event => event.responseRequired && event.source === 'screen'), 'both original episodes require a screen response');
  assert.ok(context, 'the commander enqueues a deliberate response to these episodes');
  assert.ok(damageEvents.every(event => context.responseEvents.some(link => link.id === event.id)),
    'the queued job links both independently causal events');
  return { ...f, context, damageEvents, altered };
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
      'enqueue retains the original perception descriptor, including its eligibility policy and creation tick');
    assert.deepEqual(issued.responseEvents.find(link => link.id === event.id), event,
      'the issuing input retains the complete original descriptor fixed at enqueue');
    assert.ok(issued.tick - event.tick >= 4, 'each independently linked episode respects the reaction floor');
  }
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
}

{
  const f = responseScene('retreat', 'wrong-actor');
  assert.ok(f.altered && f.inputs.some(input => input.kind === 'select-box' && input.ids?.includes(f.own[2].id)),
    'the real selection gesture hits the replacement actor');
  assert.equal(f.results.length, 0, 'a selection that hits the wrong squad cannot dispatch the intended retreat');
  assert.ok(f.damageEvents.every(event => !f.memory.human.answeredEvents?.has(event.id)),
    'the wrong actual selection cannot acknowledge its intended damage responses');
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
}

{
  const f = responseScene('support', 'late-event'), late = f.memory.human.events.find(event => event.kind === 'screen-damage' && event.unitId === f.own[2].id);
  assert.ok(f.altered && late && late.responseRequired === false, 'the delivered late cue is genuine and does not interrupt the earlier response');
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
  assert.ok(first && binding && binding.tick <= first.tick, 'the useful opening single-unit operation creates a real physical binding');
  assert.ok(first.tick - f.memory.human.startedTick <= HUMAN_SKILLS.normal.opening[1] * 20,
    'the useful binding fits within the ordinary opening look rather than extending it');
  const switchInput = f.inputs.find(input => input.command?.t === 'stance' && input.ids?.includes(other.id));
  const recall = f.inputs.find(input => input.kind === 'group-recall' && input.tick > switchInput?.tick
    && input.ids?.length === 1 && input.ids[0] === actor.id);
  assert.ok(switchInput && recall, 'another real selection is followed by recall of the previously bound single squad');
  assert.equal(recall.input.code, binding.input.code, 'the repeat recall uses the physically assigned number key');
  assert.ok(f.inputs.some(input => input.tick > recall.tick && input.command?.orders?.some(order => order[0] === actor.id)),
    'the real recall is followed by the second accepted movement of that squad');
}

for (const interrupted of [false, true]) {
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
  const plans = [];
  for (let tick = 75; tick < 400; tick++) {
    f.g.tick = tick;
    const active = state.hands.active;
    if (interrupted && emergencyTick == null && tick % 2 === 0 && active?.job.camera && tick < active.due) {
      emergencyTick = tick; f.own[0].hp *= .6;
    }
    if (!view || tick % 2 === 0) view = viewFor(f.g, 0, {});
    runCommander(view, 0, { tick, level: 'normal', seed: 27, inputLog: input => f.inputs.push(structuredClone(input)) }, f.memory,
      cmd => {
        const result = command(f.g, 0, cmd); f.results.push({ tick, cmd: structuredClone(cmd), result }); return result;
      }, (observed, _slot, opts, _memory, send) => {
        plans.push({ tick, concern: opts.concern.id, remote: structuredClone(observed.units.get(remote.id)) });
        if (proposed) return;
        if (interrupted && emergencyTick != null) proposed = send({ t: 'retreat', ids: [f.own[0].id] }) === undefined;
        else if (opts.concern.id === targetId) proposed = send({ t: 'stance', ids: [remote.id], key: 'holdFire', on: false }) === undefined;
      });
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
  } else {
    const cameras = f.inputs.filter(input => input.kind.startsWith('camera-'));
    assert.equal(cameras.length, 1, 'the expired travel deadline does not produce camera churn');
    assert.ok(cameras[0].tick > oldDeadline, 'the actual paid camera trip outlasts the original visit deadline');
    const fresh = plans.find(row => row.concern === targetId);
    assert.ok(fresh && fresh.tick > cameras[0].tick, 'arrival is followed by fresh local deliberation and a planning pass at the original concern');
    assert.ok(fresh.remote.screenSeen && !fresh.remote.inventoryOnly && fresh.remote.hp === remote.hp,
      'that planning pass receives newly inspected health rather than the earlier off-camera inventory estimate');
    assert.ok(onScreen(remote, state.camera, view), 'the actual camera has reached the remote squad');
    assert.equal(f.results[0]?.cmd.t, 'stance');
    assert.equal(f.results[0]?.result, undefined, 'the arrived concern executes its command through real selection and hands');
    console.log(`Camera arrival: old deadline ${oldDeadline}, physical arrival ${cameras[0].tick}, fresh plan ${fresh.tick}, command ${f.results[0].tick}.`);
  }
}

console.log('Commander accepted multi-event responses, refusal, wrong actor and target, fixed links, single-unit recall and paid camera visits passed.');
