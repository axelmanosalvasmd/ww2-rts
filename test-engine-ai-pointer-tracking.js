import assert from 'node:assert/strict';
import * as handsAPI from './shared/ai-hands.js';
import { createGame, command, step, UNITS } from './shared/sim.js';
import { viewFor } from './shared/ai-view.js';
import { perceive } from './shared/ai-perception.js';
import { formation } from './shared/formation.js';

function fixture(api, level = 'normal', seed = 2, ownCount = 1) {
  const map = { w: 80, h: 80, rows: Array(80).fill('.'.repeat(80)),
    spawns: [{ x: 45, y: 45 }, { x: 55, y: 45 }], points: [] };
  map.rows[50] = '.'.repeat(53) + 'T' + '.'.repeat(26);
  const game = createGame(map, ['A', 'B'], false, [0, 1], [0, 1], { weather: false });
  game.units.clear(); game.players.forEach(player => player.mp = 5000);
  for (let i = 0; i < ownCount; i++) assert.equal(command(game, 0, { t: 'buy', unit: 'rifle' }), undefined);
  assert.equal(command(game, 1, { t: 'buy', unit: 'rifle' }), undefined);
  const own = [...game.units.values()].filter(unit => unit.owner === 0), enemy = [...game.units.values()].find(unit => unit.owner === 1);
  own.forEach((unit, i) => Object.assign(unit, { x: 100 + i * 4, z: 100, holdFire: true, auto: false }));
  Object.assign(enemy, { x: 116, z: 100, holdFire: true, auto: false });
  step(game); game.tick = 200;
  const camera = { x: 112, z: 100, distance: 60, yaw: 0 }, log = [];
  const hands = api.createHands({ slot: 0, level, seed, camera, log });
  hands.openingUntil = 0; hands.openingDone = true;
  Object.assign(hands.pointer, { x: 1800, y: 100, fromX: 1800, fromY: 100, toX: 1800, toY: 100 });
  const state = { camera, hands }, memory = { human: state };
  return { api, game, own, enemy, hands, state, memory, log, sent: [], trace: [], actions: [],
    deliver() { this.view = perceive(viewFor(game, 0, memory), 0, state); return this.view; },
    advance(until = 320, mutate = () => {}) {
      for (let tick = hands.tick < 200 ? 200 : hands.tick + 1; tick <= until; tick++) {
        if (!this.view || tick % 2 === 0) this.deliver();
        mutate(this, tick);
        api.advanceHands(hands, tick, this.view, cmd => {
          assert.equal(command(game, 0, cmd), undefined, 'the actual command passes the ordinary engine boundary');
          this.sent.push(structuredClone(cmd));
        });
        if (this.log.length && !this.firstInputTargets) this.firstInputTargets = new Map([...this.view.units]
          .map(([id, unit]) => [id, api.projectPointer(unit, camera, this.view, { elevation: 1 })]));
        const action = hands.active?.actions[hands.active.index];
        if (action?.motor && !this.actions.some(row => row.action === action)) this.actions.push({ action,
          originalEndpoint: { ...action.screenClick }, motor: structuredClone(action.motor), duration: action.duration,
          rng: hands.rng.state });
        this.trace.push({ tick, x: hands.pointer.x, y: hands.pointer.y,
          toX: hands.pointer.toX, toY: hands.pointer.toY, active: hands.active?.index,
          selected: [...hands.selected], due: hands.active?.due, rng: hands.rng.state });
        if (!hands.active && !hands.queue.length) break;
        step(game);
      }
    } };
}
function moving(api, level, seed, mode, stationary = false) {
  const f = fixture(api, level, seed), actor = mode === 'target' ? f.enemy : f.own[0];
  const view = f.deliver();
  assert.ok(view.screenIds.has(actor.id), 'tracking begins with a genuinely delivered screen actor');
  if (mode === 'target') f.hands.selected = [f.own[0].id];
  f.initialTarget = api.projectPointer(actor, f.hands.camera, view, { elevation: 1 });
  if (!stationary) assert.equal(command(f.game, actor.owner, { t: 'move', orders: [[actor.id, actor.x + 30, actor.z]] }), undefined);
  const cmd = mode === 'target' ? { t: 'attack', ids: [f.own[0].id], target: f.enemy.id }
    : { t: 'move', orders: [[f.own[0].id, 125, 105]] };
  assert.ok(api.enqueueDecision(f.hands, cmd, view, { concern: 'moving', event: {
    id: 'contact', kind: 'screen-contact', x: 100, z: 100, tick: 200 }, eventTick: 200, responseActorIds: [f.own[0].id] }));
  f.advance();
  const firstInput = f.log[0], final = f.firstInputTargets.get(actor.id);
  f.displacement = Math.hypot(final.x - f.initialTarget.x, final.y - f.initialTarget.y);
  f.success = mode === 'target' ? f.sent[0]?.t === 'attack' && f.sent[0]?.target === f.enemy.id : f.sent.length === 1;
  assert.equal(firstInput.motorTicks, f.actions[0].duration);
  return f;
}

const summary = [];
for (const mode of ['selection', 'target']) for (const level of ['easy', 'normal', 'hard']) {
  let successes = 0, maximumDisplacement = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const f = moving(handsAPI, level, seed, mode);
    successes += f.success; maximumDisplacement = Math.max(maximumDisplacement, f.displacement);
    const firstAction = f.actions[0].action, firstInput = f.log[0];
    assert.equal(firstInput.motorTicks, f.actions[0].duration, 'tracking preserves the prospectively paid motor duration');
    assert.equal(firstInput.motorTicks, Math.ceil(f.actions[0].motor.seconds * 20));
    assert.deepEqual(firstInput.pointer.plannedTo, f.actions[0].motor.to, 'tracking preserves the original noisy planned endpoint');
    assert.equal(firstInput.pointer.distance, f.actions[0].motor.distance, 'tracking preserves the authored Fitts distance');
    assert.equal(firstInput.pointer.seconds, f.actions[0].motor.seconds);
    assert.equal(firstInput.tick, firstAction.startedTick + firstAction.duration, 'bounded tracking does not extend or compress this uncapped native click');
    const completion = f.trace.find(row => row.tick === firstInput.tick);
    assert.deepEqual(firstInput.pointer.to, { x: completion.x, y: completion.y }, 'completed telemetry names the actual pixel pressed');
    assert.ok(Math.abs(firstInput.pointer.endpointDistance - Math.hypot(completion.x - firstInput.pointer.from.x,
      completion.y - firstInput.pointer.from.y)) < 1e-8);
    if (f.success) {
      const actor = mode === 'target' ? f.enemy : f.own[0], target = f.firstInputTargets.get(actor.id);
      assert.ok(Math.hypot(completion.x - target.x, completion.y - target.y) < 32,
        'successful native acquisition actually presses inside the delivered hit circle');
    }
    for (let i = 1; i < f.trace.length && f.trace[i].tick <= firstInput.tick; i++) {
      const prev = f.trace[i - 1], curr = f.trace[i];
      if (firstAction.startedTick >= curr.tick) continue;
      const bound = (f.actions[0].motor.distance + f.actions[0].motor.width) / firstAction.duration;
      assert.ok(Math.hypot(curr.x - prev.x, curr.y - prev.y) <= bound + 1e-8, 'no pointer teleport or unlimited final correction');
      if (curr.tick < firstInput.tick) assert.equal(curr.rng, f.actions[0].rng, 'tracking cannot consume extra random values');
    }
    for (const input of f.log) {
      assert.ok(f.log.filter(other => other.tick <= input.tick && input.tick - other.tick < 1200).length <= f.hands.skill.apm[1]);
      assert.ok(f.log.filter(other => other.tick <= input.tick && input.tick - other.tick < 200).length * 6 <= f.hands.skill.peak);
    }
  }
  assert.ok(successes >= 18, `${level}: the bounded native tracker can acquire genuinely visible moving ${mode} targets`);
  assert.ok(maximumDisplacement > 32, `${level}: actual targets move outside the original infantry hit radius before the click`);
  if (level !== 'hard') assert.ok(maximumDisplacement > 64, 'a delivered target crosses the full authored acquisition width');
  summary.push({ mode, level, seeds: 20, successes, maximumDisplacement });
  const one = moving(handsAPI, level, 2, mode), again = moving(handsAPI, level, 2, mode);
  assert.deepEqual(one.log, again.log, 'the same delivered sequence produces deterministic native inputs');
  assert.deepEqual(one.trace, again.trace, 'the same delivered sequence produces deterministic pointer travel');
  const stationary = moving(handsAPI, level, 2, mode, true), stationaryAgain = moving(handsAPI, level, 2, mode, true);
  assert.deepEqual(stationary.log, stationaryAgain.log);
  assert.deepEqual(stationary.log[0].pointer.to, stationary.actions[0].motor.to,
    'an unchanged target keeps its sampled endpoint error');
  assert.equal(stationary.log[0].pointer.plannedTo, undefined, 'stationary input needs no retargeting metadata');
}

// Only new delivered screen samples may move the aim. Mutating an undisclosed object is insufficient.
for (const unavailable of ['stale', 'offscreen', 'dead', 'removed', 'yaw', 'distance', 'height']) {
  const f = fixture(handsAPI), view = f.deliver(), id = f.own[0].id;
  assert.ok(handsAPI.enqueueDecision(f.hands, { t: 'move', orders: [[id, 125, 105]] }, view));
  let frozenEndpoint, startTick;
  f.advance(290, (f, tick) => {
    const active = f.hands.active, action = active?.actions[active.index];
    if (!action?.tracking || active.reacting) return;
    if (startTick === undefined) {
      startTick = tick; frozenEndpoint = { x: f.hands.pointer.toX, y: f.hands.pointer.toY };
      if (unavailable === 'yaw') f.hands.camera.yaw += .3;
      if (unavailable === 'distance') f.hands.camera.distance += 15;
      if (unavailable === 'height') f.hands.camera.y = 10;
    }
    if (unavailable === 'stale') {
      f.view.tick = 200;
      f.view.units.get(id).x += 8;
    } else if (unavailable === 'offscreen') { f.view.screenIds.delete(id); f.view.units.get(id).x = 140; }
    else if (unavailable === 'dead') { f.view.units.get(id).hp = 0; f.view.units.get(id).x = 140; }
    else if (unavailable === 'removed') f.view.units.delete(id);
  });
  const tracked = f.actions[0].action.tracking;
  assert.ok(startTick !== undefined);
  assert.deepEqual({ x: tracked.history.samples[0].point.x, y: tracked.history.samples[0].point.y },
    handsAPI.projectPointer(f.own[0], { x: 112, z: 100, distance: 60, yaw: 0 }, view, { elevation: 1 }));
  const trace = f.trace.filter(row => row.tick >= startTick && row.tick < f.log[0].tick);
  assert.ok(trace.every(row => Math.hypot(row.toX - frozenEndpoint.x, row.toY - frozenEndpoint.y) < 1e-8),
    `${unavailable}: aim remains at the last observable endpoint`);
  assert.ok(tracked.history.samples.length <= 32, 'target history is bounded');
  if (['yaw', 'distance', 'height'].includes(unavailable)) assert.equal(tracked.history.frozen, true, 'changed full pose freezes obsolete projection');
}

function partial(api, level, kind = 'move', namedMissing = false, ownCount = 2) {
  const f = fixture(api, level, 2, ownCount), [missing, selected] = f.own, view = f.deliver();
  const cmd = ['move', 'amove'].includes(kind) ? { t: kind, orders: f.own.map((unit, i) => [unit.id, 123 + i, 105]) }
    : kind === 'attack' ? { t: kind, ids: f.own.map(unit => unit.id), target: f.enemy.id }
    : ['dig', 'entrench'].includes(kind) ? { t: kind, ids: [missing.id, selected.id], x: 120, z: 104, kind: 'trench', pattern: 'line', x2: 124, z2: 104 }
    : kind === 'stance' ? { t: kind, ids: [missing.id, selected.id], key: 'holdPos', on: true }
    : { t: kind, ids: [missing.id, selected.id] };
  const damage = { id: 'damage-missing', kind: 'screen-damage', unitId: missing.id, x: missing.x, z: missing.z, tick: 200 };
  const survivingDamage = { id: 'damage-selected', kind: 'screen-damage', unitId: selected.id, x: selected.x, z: selected.z, tick: 200 };
  const context = { concern: 'split', operation: 'capture', event: damage, eventTick: 200,
    responseActorIds: f.own.map(unit => unit.id), responseEvents: [damage, survivingDamage],
    ...(namedMissing && { concernKind: 'idle', concernUnitId: missing.id }) };
  assert.equal(command(f.game, 0, { t: 'move', orders: [[missing.id, 70, 100]] }), undefined);
  assert.ok(api.enqueueDecision(f.hands, cmd, view, context));
  f.advance();
  assert.equal(f.log[0].kind, 'select-box', 'two adjacent actual squads begin with the native box drag');
  assert.deepEqual(f.hands.selected, f.own.slice(1).map(unit => unit.id), 'the moving squad leaves the original box and only its intended companions are acquired');
  return f;
}
for (const level of ['easy', 'normal', 'hard']) for (const kind of ['move', 'amove', 'attack', 'retreat', 'stop', 'cover']) {
  const a = partial(handsAPI, level, kind), selected = a.own[1];
  assert.equal(a.sent.length, 1, 'the handsAPI issues one ordinary legal subset order');
  assert.deepEqual(a.sent[0].ids ?? a.sent[0].orders.map(row => row[0]), [selected.id], 'only the actually selected intended squad is commanded');
  if (a.sent[0].orders) {
    const entry = a.log.find(row => row.command), at = entry.target;
    assert.deepEqual(a.sent[0].orders, formation([a.view.units.get(selected.id)], at,
      { defs: UNITS, cell: 2, width: 160, height: 160, face: a.sent[0].face,
        shape: 'line', spread: 1, snap: true, terrainAt: () => false }), 'the formation uses the actual subset');
  }
  assert.deepEqual(a.log[0].responseActorIds, a.own.map(unit => unit.id), 'the physical selection may retain the original intended actors');
  for (const row of a.log.slice(1)) {
    assert.deepEqual(row.responseActorIds, [selected.id], 'subsequent physical inputs name only actual selected actors');
    assert.ok(!row.event, 'the missing squad damage cannot become an answered primary event');
    assert.deepEqual(row.responseEvents.map(event => event.unitId), [selected.id], 'missing actor damage is removed from subsequent response links');
    assert.ok(row.kind !== 'group-set', 'a one-squad split does not create a synthetic multi-squad operation group');
  }
  const named = partial(handsAPI, level, kind, true);
  assert.equal(named.sent.length, 0, 'the companion cannot act in place of the named missing idle squad');
  assert.equal(named.log.length, 1, 'named missing actor cancels before any order key or click');
}
for (const level of ['easy', 'normal', 'hard']) {
  const f = partial(handsAPI, level, 'amove', false, 3), ids = f.own.slice(1).map(unit => unit.id);
  assert.deepEqual(f.sent[0].orders.map(row => row[0]).sort((a, b) => a - b), [...ids].sort((a, b) => a - b), 'a two-squad surviving subset receives the real formation');
  assert.ok(!f.log.some(row => row.kind === 'group-set'), 'first accepted surviving subset adds no setup key');
  assert.ok(f.hands.operationHistory.has([...ids].sort((a,b)=>a-b).join(',')), 'history records only the actual accepted two-squad subset');
  assert.ok(!f.hands.operationHistory.has(f.own.map(unit=>unit.id).sort((a,b)=>a-b).join(',')), 'the absent original actor is never credited');
  const begin=f.log.length;f.deliver();
  assert.ok(handsAPI.enqueueDecision(f.hands,{t:'amove',orders:ids.map((id,i)=>[id,127+i,107])},f.view,{operation:'capture',concern:'repeat-actual-subset',responseActorIds:ids}));
  f.advance(f.hands.tick+200);assert.equal(f.sent.length,2,'the repeated subset order is genuinely accepted');
  const rows=f.log.slice(begin),group=rows.find(row=>row.kind==='group-set'),issued=rows.find(row=>row.command);
  assert.ok(group&&issued&&group.tick>issued.tick,'binding follows the second accepted operation with a separate paid key');
  assert.deepEqual([...group.ids].sort((a,b)=>a-b),[...ids].sort((a,b)=>a-b));assert.deepEqual([...group.responseActorIds].sort((a,b)=>a-b),[...ids].sort((a,b)=>a-b));
  assert.ok([...f.hands.groups.values()].some(members=>members.length===ids.length&&members.every(id=>ids.includes(id))));
}

// Split command clusters must not carry actors from a different physical job into later telemetry.
for (const level of ['easy', 'normal', 'hard']) {
  const f = fixture(handsAPI, level, 2, 2), [a, b] = f.own, view = f.deliver();
  const damageA = { id: 'a-damage', kind: 'screen-damage', unitId: a.id, x: a.x, z: a.z, tick: 200 };
  const damageB = { id: 'b-damage', kind: 'screen-damage', unitId: b.id, x: b.x, z: b.z, tick: 200 };
  assert.ok(handsAPI.enqueueDecision(f.hands, { t: 'move', orders: [[a.id, 120, 105], [b.id, 90, 105]] }, view,
    { event: damageA, eventTick: 200, responseActorIds: [a.id, b.id], responseEvents: [damageA, damageB] }));
  f.advance(); assert.equal(f.sent.length, 2, 'spatially separate intentions execute as two ordinary physical jobs');
  for (const row of f.log) {
    const actual = row.command?.orders?.map(order => order[0]) ?? row.ids;
    assert.deepEqual(row.responseActorIds, actual, 'each selection and order input names only actors in its actual physical job');
    assert.deepEqual(row.responseEvents.map(event => event.unitId), actual, 'one cluster cannot answer damage to the other cluster');
    if (actual.includes(b.id)) assert.ok(!row.event && row.eventTick === undefined, 'unrelated primary damage is removed from the companion job');
  }
}

// A current ordinary hit on an unintended neighbour must never become a subset order.
for (const level of ['easy', 'normal', 'hard']) {
  const f = fixture(handsAPI, level, 2, 2), [intended, neighbour] = f.own, view = f.deliver();
  assert.ok(handsAPI.enqueueDecision(f.hands, { t: 'retreat', ids: [intended.id] }, view));
  f.advance(320, (f, tick) => {
    const active = f.hands.active;
    if (!active || active.reacting) return;
    Object.assign(intended, { x: 30, z: 100 }); Object.assign(neighbour, { x: 100, z: 100 });
    // The transition is delivered through ordinary two-tick seat observations.
    if (tick % 2 === 0) f.deliver();
  });
  assert.deepEqual(f.hands.selected, [neighbour.id], 'native selection really hits the unintended neighbour');
  assert.equal(f.sent.length, 0, 'the subset guard rejects the neighbour rather than retreating it');
  assert.equal(f.log.length, 1, 'the wrong actor cancels before any later order input');
}

for (const level of ['easy', 'normal', 'hard']) for (const kind of ['stance', 'dig', 'entrench']) {
  const f = partial(handsAPI, level, kind);
  assert.equal(f.sent.length, 0, `${kind} selection retains its original exact actor requirement`);
  assert.equal(f.log.length, 1);
}
console.log(JSON.stringify({ motion: summary, contracts: 'stationary endpoint error, deterministic travel, paid motor/RNG/deadline/caps, stale/offscreen/dead/full-pose privacy, actual subset formation/context, named actor, stance and engineering negatives' }, null, 2));
