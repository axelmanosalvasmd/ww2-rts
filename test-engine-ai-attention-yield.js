// A protected fight can hold its ground while the commander visits other useful work.
import assert from 'node:assert/strict';
import { createGame, command, step } from './shared/sim.js';
import { plan } from './shared/ai.js';
import { viewFor } from './shared/ai-view.js';
import { perceive, onScreen } from './shared/ai-perception.js';
import { chooseConcern, deferEmptyCombat, emptyCombatDeferred } from './shared/ai-attention.js';
import { runCommander } from './shared/ai-commander.js';
import { createHands } from './shared/ai-hands.js';

function protectedFight(level) {
  const rows = Array(80).fill('.'.repeat(80));
  rows[40] = '.'.repeat(65) + 'B' + '.'.repeat(14);
  const game = createGame({ w: 80, h: 80, rows,
    spawns: [{ x: 25, y: 40 }, { x: 75, y: 40 }], points: [{ x: 65, y: 40 }] },
  ['AI', 'enemy'], false, [0, 1], [0, 1], { weather: false });
  game.units.clear();
  game.players.forEach(player => { player.mp = 5000; });
  assert.equal(command(game, 0, { t: 'buy', unit: 'rifle' }), undefined);
  assert.equal(command(game, 1, { t: 'buy', unit: 'rifle' }), undefined);
  const [holder, enemy] = game.units.values();
  Object.assign(holder, { x: 129, z: 81, holdFire: true, auto: true, autoRetreat: true });
  Object.assign(enemy, { x: 145, z: 85, holdFire: true });
  step(game);
  assert.equal(command(game, 0, { t: 'garrison', ids: [holder.id], x: 131, z: 81 }), undefined);
  for (let i = 0; i < 40; i++) step(game);
  assert.ok(holder.garrison >= 0, 'the ordinary garrison command puts the real squad inside the house');
  Object.assign(holder, { targetId: enemy.id, holdFire: false });
  game.points[0].owner = 0; game.points[0].vp = 1;
  game.players[0].mp = 300; game.players[0].mun = 0;
  for (const kind of Object.keys(game.players[0].sup)) game.players[0].sup[kind] = 1000;
  game.tick = 200;
  const camera = { x: 131, z: 81, distance: 60, yaw: 0 }, inputs = [];
  const state = { camera, startedTick: 0,
    hands: createHands({ slot: 0, level, seed: 27, camera, startedTick: 0 }),
    persona: { family: 'support', pressure: 1, opening: ['mg'] }, buys: 0, cycle: 1 };
  const memory = { human: state }, view = perceive(viewFor(game, 0, memory), 0, state);
  assert.ok(view.screenIds.has(holder.id) && view.players[0].visible.has(enemy.id),
    'both the protected squad and its opponent are genuinely delivered on camera');
  assert.equal(view.units.get(holder.id).targetId, enemy.id);
  assert.ok(!onScreen(game.players[0].spawn, camera, view), 'production is outside the combat camera');
  state.concern = chooseConcern(view, 0, state, level, () => .5);
  assert.equal(state.concern.kind, 'combat', 'the delivered fight wins the initial attention competition');
  return { game, holder, enemy, memory, state, view, inputs };
}

for (const level of ['easy', 'normal', 'hard']) {
  const f = protectedFight(level), calls = [], accepted = [], yields = [];
  const protectedCell = f.holder.garrison, originalMP = f.game.players[0].mp;
  let observation;
  // The engine state stays unchanged between delivered beats, isolating repeated empty inspections.
  for (let tick = 200; tick < 1400 && !accepted.some(entry => entry.command.t === 'buy'); tick++) {
    f.game.tick = tick;
    if (!observation || tick % 2 === 0) observation = viewFor(f.game, 0, f.memory);
    runCommander(observation, 0, { tick, level, seed: 27,
      inputLog: input => f.inputs.push(structuredClone(input)) }, f.memory, cmd => {
      const result = command(f.game, 0, cmd);
      assert.equal(result, undefined, `${level}: a physical command must pass the ordinary engine boundary`);
      accepted.push({ tick, command: structuredClone(cmd), camera: { ...f.state.camera } });
      return result;
    }, (view, slot, opts, memory, submit) => {
      const commands = [], inspections = [];
      plan(view, slot, { ...opts, requestInspection: cmd => {
        inspections.push(structuredClone(cmd)); opts.requestInspection?.(cmd);
      } }, memory, cmd => { commands.push(structuredClone(cmd)); return submit(cmd); });
      calls.push({ tick, concern: structuredClone(opts.concern), commands, inspections });
    });
    for (const [id, visit] of f.state.emptyCombatVisits ?? []) if (visit.count >= 2)
      yields.push({ tick, id, count: visit.count });
  }
  const combats = calls.filter(call => call.concern.kind === 'combat');
  assert.ok(combats.length >= 2, `${level}: the real planner inspects the unchanged fight twice`);
  assert.ok(combats.slice(0, 2).every(call => !call.commands.length && !call.inspections.length),
    `${level}: holding safely needs neither a dummy command nor an unnecessary HUD inspection`);
  assert.ok(yields.length, `${level}: unchanged empty plans actually trigger the yield state`);
  const buy = accepted.find(entry => entry.command.t === 'buy');
  assert.ok(buy, `${level}: the commander resumes a real ordinary purchase instead of watching forever`);
  assert.ok(buy.tick > yields[0].tick, `${level}: production follows the empty-fight yield`);
  assert.ok(Math.hypot(buy.camera.x - 131, buy.camera.z - 81) > 40,
    `${level}: the camera physically leaves the fight before purchasing`);
  assert.ok(f.inputs.some(input => input.kind.startsWith('camera') && input.tick < buy.tick),
    `${level}: the trip to production pays a physical camera input`);
  assert.ok(f.inputs.some(input => input.kind === 'buy-click' && input.command?.t === 'buy'),
    `${level}: production pays its ordinary issuing click`);
  assert.ok(f.game.players[0].mp < originalMP, `${level}: the accepted purchase spends authoritative manpower`);
  assert.equal([...f.game.units.values()].filter(unit => unit.owner === 0).length, 2,
    `${level}: production creates a real additional unit`);
  assert.ok(accepted.every(entry => entry.command.t === 'buy'), `${level}: the safe holder receives no dummy orders`);
  assert.equal(f.holder.garrison, protectedCell, `${level}: the holder remains in its protected position`);
  assert.equal(f.holder.targetId, f.enemy.id, `${level}: the existing fight continues while attention leaves`);
}

for (const level of ['easy', 'normal', 'hard']) {
  const f = protectedFight(level), concern = { ...f.state.concern };
  const inspect = () => perceive(viewFor(f.game, 0, f.memory), 0, f.state);
  const emptyPlan = view => plan(view, 0, { human: true, level, concern,
    requestInspection: () => assert.fail('the unchanged protected fight needs no ability inspection') },
  f.memory, () => assert.fail('the unchanged protected fight needs no dummy order'));
  emptyPlan(f.view);
  assert.equal(deferEmptyCombat(f.view, 0, f.state, concern, f.game.tick, level), false,
    `${level}: one empty look still permits another inspection`);
  assert.equal(emptyCombatDeferred(f.view, 0, f.state, concern), false);
  f.game.tick += 2;
  const unchanged = inspect(); emptyPlan(unchanged);
  assert.equal(deferEmptyCombat(unchanged, 0, f.state, concern, f.game.tick, level), true);
  assert.equal(emptyCombatDeferred(unchanged, 0, f.state, concern), true);
  f.state.attention.until = f.game.tick;
  const elsewhere = chooseConcern(unchanged, 0, f.state, level, () => .5);
  assert.notEqual(elsewhere.id, concern.id, `${level}: the suppressed fight cannot win the next visit`);
  assert.ok(!f.state.concerns.some(candidate => candidate.id === concern.id),
    `${level}: deferred combat is removed from the remembered competition, not only its current rank`);
  const retryAt = f.state.emptyCombatVisits.get(concern.id).retryAt;
  assert.equal(emptyCombatDeferred({ ...unchanged, tick: retryAt }, 0, f.state, concern), false,
    `${level}: bounded retry time permits a fresh inspection even if the fight remains unchanged`);

  // A visible health-bar change arrives through the same public projection as an ordinary client.
  f.enemy.hp = 50; f.game.tick += 2;
  const changed = inspect();
  assert.equal(changed.units.get(f.enemy.id).hp, 50);
  assert.ok(f.game.tick < retryAt, 'the new observation precedes the deferred retry');
  assert.equal(emptyCombatDeferred(changed, 0, f.state, concern), false,
    `${level}: a newly watched combat fact cancels the unchanged-fight suppression`);
  f.state.attention.until = f.game.tick;
  chooseConcern(changed, 0, f.state, level, () => .5);
  assert.ok(f.state.concerns.some(candidate => candidate.id === concern.id)
    || f.state.attention.waiting.has(concern.id),
    `${level}: the changed fight reenters actual attention competition`);

  const eventFixture = protectedFight(level), old = { ...eventFixture.state.concern };
  deferEmptyCombat(eventFixture.view, 0, eventFixture.state, old, 200, level);
  deferEmptyCombat(eventFixture.view, 0, eventFixture.state, old, 202, level);
  eventFixture.game.points[0].owner = 1; eventFixture.game.tick = 204;
  const eventView = perceive(viewFor(eventFixture.game, 0, eventFixture.memory), 0, eventFixture.state);
  const alert = eventView.newEvents.find(event => event.kind === 'pointLost');
  assert.ok(alert, `${level}: losing the real owned point produces a delivered semantic alert`);
  assert.equal(emptyCombatDeferred(eventView, 0, eventFixture.state, old), false,
    `${level}: a genuine nearby point loss reopens the inspected area before its retry`);
  eventFixture.state.attention.until = eventView.tick;
  const revisit = chooseConcern(eventView, 0, eventFixture.state, level, () => .5);
  assert.equal(revisit.kind, 'combat');
  assert.equal(revisit.eventId, alert.id,
    `${level}: a new delivered alert permits attention to revisit without waiting for the old cluster`);
}

console.log('Empty combat attention yields to physical production and revisits changed observations across all difficulties.');
