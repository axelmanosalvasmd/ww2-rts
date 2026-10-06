// Commander arbitration uses real hands and authoritative commands with deliberately conflicting decisions.
import assert from 'node:assert/strict';
import { createGame, command, step } from './shared/sim.js';
import { viewFor } from './shared/ai-view.js';
import { runCommander } from './shared/ai-commander.js';
import { onScreen } from './shared/ai-perception.js';
import { perceive as screenV1Oracle } from './tools/ai-screen-v1-oracle.js';
import { queueCamera, createHands, enqueueDecision } from './shared/ai-hands.js';

const mapOf = rows => ({ w: 80, h: 80, rows, spawns: [{ x: 20, y: 40 }, { x: 75, y: 40 }], points: [] });
const fixture = (rows = Array(80).fill('.'.repeat(80))) => {
  const g = createGame(mapOf(rows), ['AI', 'enemy'], false, [0, 1], [0, 1], { weather: false });
  g.units.clear(); g.players[0].mp = 5000;
  assert.equal(command(g, 0, { t: 'buy', unit: 'rifle' }), undefined);
  const unit = [...g.units.values()][0];
  Object.assign(unit, { x: 50, z: 80, holdFire: true, auto: false, autoRetreat: false });
  g.players[0].mun = 1000;
  const frames = [], measurements = { measureRaw: screenV1Oracle, onMeasurements: frame => frames.push(frame) };
  return { g, unit, memory: {}, inputs: [], accepted: [], frames, measurements };
};
function advance(f, ticks, plan, simulate = false) {
  let view;
  for (let tick = 0; tick < ticks; tick++) {
    if (!simulate) f.g.tick = tick;
    f.beforeTick?.();
    if (!view || f.g.tick % 2 === 0) view = viewFor(f.g, 0, f.memory);
    runCommander(view, 0, { tick: f.g.tick, level: 'normal', seed: 27, perceptionMeasurements: f.measurements, inputLog: input => f.inputs.push(structuredClone(input)) },
      f.memory, cmd => {
        const result = command(f.g, 0, cmd);
        if (result === undefined) f.accepted.push({ tick: f.g.tick, command: structuredClone(cmd) });
        return result;
      }, plan);
    if (simulate) step(f.g);
  }
}
{
  const f = fixture();
  advance(f, 240, (_view, _slot, _opts, _memory, send) => {
    send({ t: 'move', orders: [[f.unit.id, 70, 80]] });
    send({ t: 'amove', orders: [[f.unit.id, 20, 80]] });
  });
  const issued = f.inputs.filter(input => input.command?.orders?.some(row => row[0] === f.unit.id));
  assert.ok(issued.length > 0 && f.accepted.length > 0, 'the conflict fixture executes an accepted physical movement command');
  const byCycle = new Map();
  for (const input of issued) {
    assert.ok(!byCycle.has(input.cycle), 'one planning cycle cannot issue opposing movement commands to the same squad');
    byCycle.set(input.cycle, input.command);
  }
}
{
  const f = fixture();
  advance(f, 480, (_view, _slot, _opts, _memory, send) => {
    const previous = f.accepted[0]?.command.orders[0];
    send({ t: 'move', orders: [[f.unit.id, previous ? previous[1] > 50 ? 20 : 80 : 70, 80]] });
  });
  assert.ok(f.accepted.length > 0, 'the commitment fixture issues its first real movement');
  const first = f.accepted[0], target = first.command.orders[0];
  assert.ok(f.unit.path.length > 0, 'the authoritative squad is still travelling instead of having reached its target');
  const opposite = f.accepted.slice(1).filter(entry => Math.hypot(entry.command.orders[0][1] - target[1], entry.command.orders[0][2] - target[2]) > 20);
  const reversals = opposite.filter(entry => entry.tick - first.tick < 240
    && Math.hypot(entry.command.orders[0][1] - target[1], entry.command.orders[0][2] - target[2]) > 20);
  assert.deepEqual(reversals, [], 'a later concern cannot reverse an unfinished move within twelve seconds');
  assert.ok(opposite.some(entry => entry.tick - first.tick >= 240), 'a new destination becomes possible after commitment expires');
}
{
  // Deep water makes this accepted throw impossible to finish, so a retry must observe its missing cooldown.
  const rows = Array(80).fill('.'.repeat(28) + 'W'.repeat(9) + '.'.repeat(43)), f = fixture(rows);
  const enemy = { ...structuredClone(f.unit), id: f.g.nextId++, owner: 1, x: 78, z: 80, holdPos: true };
  f.g.units.set(enemy.id, enemy); f.g.players[0].visible.add(enemy.id); f.g.players[0].mp = 0;
  advance(f, 700, (_view, _slot, _opts, _memory, send) => {
    send({ t: 'ability', ids: [f.unit.id], x: 78, z: 80 });
  }, true);
  const throws = f.accepted.filter(entry => entry.command.t === 'ability');
  assert.ok(throws.length >= 2, 'the failed-effect fixture covers two actually accepted aimed commands');
  assert.ok(f.unit.cd <= 0, 'no accepted throw has started its cooldown');
  assert.equal(f.g.nades.length, 0, 'the unreachable throws produced no grenade');
  const second = throws[1];
  assert.ok(!throws.slice(2).some(entry => entry.tick - second.tick < 300),
    'two accepted aimed commands without a cooldown trigger at least fifteen seconds of backoff');
}
console.log('Commander movement conflicts, unfinished-move commitment and accepted failed-effect ability backoff passed.');

for (const phase of ['approach', 'held']) {
  const f = fixture();
  for (let i = 0; i < 5; i++) assert.equal(command(f.g, 0, { t: 'buy', unit: 'rifle' }), undefined);
  const own = [...f.g.units.values()], front = own.slice(0, 5), home = own[5];
  front.forEach((u, i) => Object.assign(u, { x: 100 + i * 4, z: 140, holdFire: true, auto: false }));
  if (phase === 'held') {
    // The prior selection leaves the pointer beside the box's first corner, making the drag cheaper.
    [[117, 128], [93, 128], [90, 142], [118, 142], [91, 126]]
      .forEach(([x, z], i) => Object.assign(front[i], { x, z }));
  }
  Object.assign(home, { x: 50, z: 80, holdFire: true, auto: false });
  f.g.players[0].mp = 0;
  f.memory.human = { camera: { x: 105, z: 140, ...(phase === 'held' && { yaw: 0 }) }, startedTick: 0,
    concern: { id: 'front', kind: 'expansion', x: 105, z: 140, since: 0, until: 100000 } };
  const state = f.memory.human;
  state.hands = createHands({ slot: 0, seed: 27, level: 'normal', camera: state.camera });
  assert.ok(enqueueDecision(state.hands, { t: 'stance', ids: [front[4].id], key: 'holdFire', on: false }, viewFor(f.g, 0, f.memory)),
    'the fixture establishes a prior selection through a real click and stance key');
  let view, emergencyTick = null, originalJob = null, queuedIds = null, selectionAtEmergency = null, pointerAtEmergency = null;
  for (let tick = 0; tick < 600; tick++) {
    f.g.tick = tick;
    const hands = state.hands, active = hands.active, action = active?.actions[active.index];
    const interruptible = phase === 'approach' ? action?.fire && action.screenClick && active.due > tick
      : action?.kind === 'select-box' && tick >= active.start + action.duration * action.motor.approachFraction && tick < active.due;
    if (emergencyTick === null && tick % 2 === 0 && interruptible && hands.queue.length >= 2) {
      assert.ok(hands.selected.length > 0, 'the interruption fixture has a previous actual physical selection');
      assert.equal(onScreen(home, hands.camera, view), false, 'home damage is genuinely off camera');
      emergencyTick = tick; originalJob = active.job; queuedIds = hands.queue.flatMap(job => job.ids);
      selectionAtEmergency = [...hands.selected];
      const pointer = hands.pointer, fraction = Math.min(1, Math.max(0, (tick - pointer.startTick) / Math.max(1, pointer.endTick - pointer.startTick)));
      pointerAtEmergency = { x: pointer.fromX + (pointer.toX - pointer.fromX) * fraction,
        y: pointer.fromY + (pointer.toY - pointer.fromY) * fraction, inputCount: hands.inputTicks.length, logs: f.inputs.length };
      home.hp *= .8;
    }
    if (!view || tick % 2 === 0) view = viewFor(f.g, 0, f.memory);
    runCommander(view, 0, { tick, level: 'normal', seed: 27, perceptionMeasurements: f.measurements, inputLog: input => f.inputs.push(structuredClone(input)) },
      f.memory, cmd => {
        const result = command(f.g, 0, cmd);
        if (result === undefined) f.accepted.push({ tick, command: structuredClone(cmd) });
        return result;
      }, (perceived, _slot, _opts, _memory, send) => {
        if (emergencyTick !== null) {
          if (perceived.screenIds.has(home.id)) send({ t: 'move', orders: [[home.id, 53, 83]] });
        } else {
          for (const u of front.slice(0, 2)) send({ t: 'move', orders: [[u.id, 100, 130]] });
          send({ t: 'move', orders: [[front[2].id, 75, 130]] });
          send({ t: 'move', orders: [[front[3].id, 125, 130]] });
        }
      });
    if (tick === emergencyTick) {
      assert.deepEqual(hands.selected, selectionAtEmergency, 'preemption retains the previous actual selection until a held drag releases');
      assert.ok(hands.queue.every(job => !job.ids?.some(id => queuedIds.includes(id))), 'an emergency discards old unstarted movement jobs');
      if (phase === 'approach') {
        assert.equal(hands.active, null, 'the pointer approach is canceled before the mouse press');
        assert.ok(Math.abs(hands.pointer.x - pointerAtEmergency.x) < 1e-6 && Math.abs(hands.pointer.y - pointerAtEmergency.y) < 1e-6,
          'the canceled approach retains its actual interpolated pointer position');
        assert.equal(hands.inputTicks.length, pointerAtEmergency.inputCount, 'canceling before the press consumes no input budget');
        assert.equal(f.inputs.length, pointerAtEmergency.logs, 'canceling before the press emits no completed-input record');
      } else assert.equal(hands.active.job, originalJob, 'the held drag remains active through its physical release');
    }
  }
  assert.ok(emergencyTick !== null && queuedIds.length >= 2, `${phase}: the fixture interrupts a real gesture with two queued jobs`);
  assert.ok(!f.accepted.some(entry => entry.tick >= emergencyTick && entry.command.orders?.some(row => [...queuedIds, ...originalJob.ids].includes(row[0]))),
    'interruption never issues discarded movement or the unpressed issuing click');
  if (phase === 'held') assert.ok(f.inputs.some(input => input.tick > emergencyTick && input.kind === 'select-box'
    && originalJob.ids.every(id => input.ids?.includes(id))), 'the held drag finishes with a real release and the resulting selection');
  const response = f.inputs.find(input => input.command?.orders?.some(row => row[0] === home.id));
  assert.ok(response?.event && Number.isFinite(response.eventTick), 'the home response answers the recorded emergency');
  assert.ok(response.tick - emergencyTick >= 4 && response.tick - response.eventTick >= 4, 'the emergency response retains the causal reaction floor');
}
console.log('Emergency interruption cancels an unpressed approach, completes a held drag, and preserves selection and reaction latency.');

{
  const f = fixture();
  let arrivedAtB = null;
  advance(f, 1000, (_view, _slot, _opts, _memory, send) => {
    if (!f.accepted.length) return send({ t: 'move', orders: [[f.unit.id, 70, 80]] });
    const first = f.accepted[0];
    if (f.accepted.length === 1) {
      if (f.g.tick - first.tick < 260) return;
      assert.equal(f.unit.path.length, 0, 'the first destination was reached before the second order');
      return send({ t: 'move', orders: [[f.unit.id, 20, 80]] });
    }
    if (f.unit.path.length) return;
    arrivedAtB ??= f.g.tick;
    send({ t: 'move', orders: [[f.unit.id, 70, 80]] });
  }, true);
  const [first, second, returned] = f.accepted;
  assert.ok(first && second && returned && arrivedAtB !== null, 'the A-B-A probe reaches both destinations and eventually accepts its return');
  assert.ok(second.tick - first.tick >= 260, 'the second destination follows the full ordinary commitment');
  assert.ok(arrivedAtB - first.tick < 600, 'arrival at B leaves time to exercise the thirty-second return guard');
  assert.ok(returned.tick - first.tick >= 600, 'arrival and expired ordinary commitment do not permit an A-B-A return within thirty seconds');
}

{
  const f = fixture();
  assert.equal(command(f.g, 0, { t: 'buy', unit: 'rifle' }), undefined);
  const victim = [...f.g.units.values()].at(-1);
  Object.assign(victim, { x: 55, z: 80, auto: false, autoRetreat: false, holdFire: true });
  f.g.players[0].mp = 0;
  let damagedAt = null;
  f.beforeTick = () => {
    const first = f.accepted.find(entry => entry.command.orders?.some(row => row[0] === f.unit.id));
    if (first && damagedAt === null && f.g.tick >= first.tick + 10 && f.g.tick % 2 === 0) {
      damagedAt = f.g.tick; victim.hp *= .6;
    }
  };
  advance(f, 280, (_view, _slot, _opts, _memory, send) => {
    if (damagedAt === null) send({ t: 'move', orders: [[f.unit.id, 70, 80]] });
    else {
      send({ t: 'move', orders: [[f.unit.id, 20, 80]] });
      if (!f.accepted.some(entry => entry.command.orders?.some(row => row[0] === victim.id)))
        send({ t: 'move', orders: [[victim.id, 55, 84]] });
    }
  });
  const first = f.accepted.find(entry => entry.command.orders?.some(row => row[0] === f.unit.id));
  assert.ok(first && damagedAt !== null && f.unit.path.length, 'heavy damage arrives while a different squad has an unfinished accepted move');
  assert.ok(f.frames.flatMap(frame => frame.original.events).some(event => event.kind === 'screen-damage' && event.unitId === victim.id && event.responseRequired),
    'the fixture observes real heavy screen damage requiring a response');
  assert.ok(f.inputs.some(input => input.command?.orders?.some(row => row[0] === victim.id) && input.event?.kind === 'screen-damage'),
    'the damaged squad receives a causal physical response');
  assert.ok(!f.accepted.some(entry => entry.tick - first.tick < 240
    && entry.command.orders?.some(row => row[0] === f.unit.id && row[1] < 40)),
  'heavy damage to one squad cannot reverse an unrelated unfinished move');
}

{
  const f = fixture();
  for (const type of ['rifle', 'mg', 'mg']) assert.equal(command(f.g, 0, { t: 'buy', unit: type }), undefined);
  const own = [...f.g.units.values()];
  own.forEach((u, i) => Object.assign(u, { x: 48 + i * 3, z: 80, holdFire: true, auto: false }));
  const line = own.filter(u => u.type === 'rifle'), support = own.filter(u => u.type === 'mg');
  advance(f, 240, (_view, _slot, _opts, _memory, send) => {
    for (const u of [line[0], support[0], line[1], support[1]]) send({ t: 'move', orders: [[u.id, 70, 80]] });
  });
  const issued = f.accepted.filter(entry => entry.command.orders);
  assert.ok(issued.some(entry => entry.command.orders.length === line.length
    && entry.command.orders.every(row => line.some(u => u.id === row[0]))), 'nearby line intents become one accepted formation');
  assert.ok(issued.some(entry => entry.command.orders.length === support.length
    && entry.command.orders.every(row => support.some(u => u.id === row[0]))), 'support intents become their own accepted formation');
  assert.ok(issued.every(entry => entry.command.together && (entry.command.orders.every(row => line.some(u => u.id === row[0]))
    || entry.command.orders.every(row => support.some(u => u.id === row[0])))), 'physical formation commands never merge the line with its support');
}
console.log('Arrived A-B-A return guard, local damage response and separate line/support formations passed.');

{
  const f = fixture();
  f.g.players[0].mp = 0;
  let cameraQueued = false, damagedAt = null;
  f.beforeTick = () => {
    const hands = f.memory.human?.hands;
    if (f.accepted.length && !cameraQueued) {
      queueCamera(hands, { x: 105, z: 140 }, { concern: 'remote-front', priority: 27 }, 'minimap');
      f.memory.human.concern = { id: 'remote-front', kind: 'expansion', x: 105, z: 140, until: 10000 };
      cameraQueued = true;
    }
    if (cameraQueued && damagedAt === null && f.g.tick % 2 === 0
      && !onScreen(f.unit, hands.camera, f.memory.human.view)) {
      assert.ok(f.unit.path.length, 'the local defender still has its accepted unfinished move');
      f.unit.hp *= .6; damagedAt = f.g.tick;
    }
  };
  advance(f, 300, (_view, _slot, _opts, _memory, send) => {
    if (!f.accepted.length) send({ t: 'move', orders: [[f.unit.id, 90, 130]] });
    else if (damagedAt !== null) send({ t: 'move', orders: [[f.unit.id, 48, 82]] });
  });
  const first = f.accepted[0], response = f.inputs.find(input => input.command?.orders && input.event?.kind === 'base');
  assert.ok(cameraQueued && f.inputs.some(input => input.kind === 'camera-minimap'), 'the defender leaves the camera through a real minimap gesture');
  assert.ok(damagedAt !== null && response, 'off-camera home damage produces a physically dispatched local defense response');
  assert.ok(response.tick - first.tick < 240, 'a local base emergency can redirect its defender before ordinary commitment expires');
  assert.ok(response.tick - damagedAt >= 4, 'the base response keeps the causal reaction floor');
  assert.ok(response.command.orders.every(row => row[0] === f.unit.id
    && Math.hypot(row[1] - f.g.players[0].spawn.x, row[2] - f.g.players[0].spawn.z) < 24),
  'the exceptional destination actually defends the local base');
}

{
  const f = fixture();
  let damagedAt = null;
  f.beforeTick = () => {
    const hands = f.memory.human?.hands, action = hands?.active?.actions[hands.active.index];
    if (damagedAt === null && f.g.tick % 2 === 0 && action?.fire && hands.active.due > f.g.tick) {
      damagedAt = f.g.tick; f.unit.hp -= 1;
    }
  };
  advance(f, 200, (_view, _slot, _opts, _memory, send) => {
    send({ t: 'dig', ids: [f.unit.id], kind: 'mines', x: 52, z: 80, dir: 0 });
  });
  const damage = f.frames.flatMap(frame => frame.original.events).find(event => event.kind === 'screen-damage' && event.tick >= damagedAt);
  const fort = f.inputs.find(input => input.command?.t === 'dig' && input.tick > damagedAt);
  const observedDamage = f.memory.human.events.find(event => event.kind === 'screen-damage' && event.tick >= damagedAt);
  assert.ok(f.memory.human.hands.selected.includes(f.unit.id), 'the fortification gesture actually selected this singleton before its 1 HP loss');
  assert.equal(f.memory.human.view.units.get(f.unit.id).hpSource, 'selected-hud');
  assert.equal(observedDamage.amount, 1, 'the actual selected HUD exposes this 1 HP change despite an unchanged world-bar estimate');
  assert.equal(observedDamage.observedDanger.lossShare, .01);
  assert.equal(Object.hasOwn(observedDamage, 'responseRequired'), false);
  assert.ok(damagedAt !== null && damage && damage.responseRequired === false, 'routine damage is observed while a fortification click is in progress');
  assert.equal(damage.amount, 1, 'the original oracle retains the exact routine damage amount');
  assert.ok(fort && f.accepted.some(entry => entry.command.t === 'dig'), 'the unrelated fortification completes through the command handle');
  assert.equal(fort.event, undefined, 'routine damage is not attached to unrelated fortification work');
  assert.equal(fort.eventTick, undefined, 'unrelated fortification work has no damage reaction timestamp');
}
console.log('Local base emergency override and noncausal fortification provenance passed.');
