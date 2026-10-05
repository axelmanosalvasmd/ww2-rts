// Delayed inputs must preserve the operation that planned them and the time spent doing nothing.
import assert from 'node:assert/strict';
import { createGame, command, step, priceOf, mutateWorldCell } from './shared/sim.js';
import { think } from './shared/ai.js';
import { viewFor } from './shared/ai-view.js';

const open = (points = []) => ({ w: 80, h: 80, rows: Array(80).fill('.'.repeat(80)),
  spawns: [{ x: 25, y: 40 }, { x: 75, y: 40 }], points });
for (const [level, pause] of [['easy', 30], ['normal', 16], ['hard', 8]]) {
  const g = createGame(open(), ['AI', 'enemy'], false, [0, 1], [0, 1], { weather: false });
  g.units.clear(); g.players[0].mp = 0;
  const memory = {};
  let firstCycle = null, cycle = 0, resumed = false;
  for (let tick = 0; tick < 400; tick++) {
    g.tick = tick;
    think(g, 0, { memory, view: viewFor(g, 0, memory), seed: 19, level, submit: () => assert.fail('the empty fixture has no actions') });
    const current = memory.human.cycle ?? 0;
    if (firstCycle === null && current > 0) { firstCycle = tick; cycle = current; }
    if (firstCycle !== null && tick < firstCycle + pause) assert.equal(current, cycle,
      `${level}: an empty cycle keeps its full ${pause}-tick pause across subsequent ticks`);
    if (firstCycle !== null && current > cycle) { resumed = true; break; }
  }
  assert.ok(firstCycle !== null && resumed, `${level}: the empty-cycle probe plans, pauses, then plans again`);
}

const g = createGame(open([{ x: 55, y: 40 }]), ['AI', 'enemy'], false, [0, 1], [0, 1], { weather: false });
g.units.clear(); g.players[0].mp = 5000;
for (const unit of ['rifle', 'rifle', 'rifle', 'mg', 'mg']) assert.equal(command(g, 0, { t: 'buy', unit }), undefined);
const own = [...g.units.values()];
// Keep the support pair visibly separate from the line so its real drag can acquire both teams.
own.forEach((u, i) => Object.assign(u, { x: u.type === 'mg' ? 45 + (i - 3) * 8 : 45 + i * 2,
  z: u.type === 'mg' ? 88 : 80, holdFire: true, auto: false }));
g.players[0].mp = 0; g.points[0].owner = 1;
const memory = {}, accepted = [], rejected = [], supportIds = new Set(own.filter(u => u.type === 'mg').map(u => u.id));
let delivered, plannedAt = null, initialIds = null, selected = false;
for (let i = 0; i < 300; i++) {
  if (!delivered || g.tick % 2 === 0) delivered = viewFor(g, 0, memory);
  think(g, 0, { memory, view: delivered, seed: 12, level: 'normal', inputLog: entry => {
    if (entry.kind.startsWith('select-')) selected = true;
  }, submit: cmd => {
    const ids = cmd.orders?.map(row => row[0]) ?? [];
    if (ids.some(id => supportIds.has(id))) { rejected.push({ tick: g.tick, cmd: structuredClone(cmd) }); return 'blocked'; }
    const result = command(g, 0, cmd);
    if (result === undefined && ids.length) accepted.push({ tick: g.tick, cmd: structuredClone(cmd) });
    return result;
  } });
  const op = memory.mind?.assault;
  if (op && plannedAt === null) {
    plannedAt = g.tick; initialIds = op.members.map(member => member.id);
    assert.equal(initialIds.length, 5, 'the integration fixture forms a line with two support teams');
    assert.ok(op.members.every(member => !member.acknowledged), 'proposed orders remain unacknowledged while the hands are still selecting');
    assert.equal(accepted.length, 0, 'operation proposal precedes actual command dispatch');
  }
  if (accepted.length && rejected.length) {
    assert.ok(selected, 'accepted movement follows real selection inputs');
    assert.ok(accepted.some(entry => entry.cmd.orders.length === 3), 'the line is sent as one formation command');
    assert.ok(rejected.some(entry => entry.cmd.orders.length === 2), 'the delayed support formation reaches the ordinary submission boundary');
    assert.deepEqual(op.members.map(member => member.id), initialIds, 'undispatched support is not released as a manual replacement');
    for (const member of op.members) {
      if (supportIds.has(member.id)) assert.ok(!member.acknowledged, 'a rejected support command does not acknowledge its proposed destination');
      else {
        assert.equal(member.acknowledged, true, 'accepted line commands acknowledge their members');
        const actual = accepted.toReversed().flatMap(entry => entry.cmd.orders).find(row => row[0] === member.id);
        assert.deepEqual(member.order, { x: actual[1], z: actual[2] }, 'the acknowledgement stores the clicked formation destination');
      }
    }
    if (g.tick >= rejected[0].tick + 30) break;
  }
  step(g);
}
assert.ok(plannedAt !== null && accepted.length && rejected.length, 'the regression covers planning, delayed accepted orders and refused support');
assert.ok(g.tick >= rejected[0].tick + 30, 'a later planning cycle observes the refused support without silently losing its members');
console.log('Human commander empty-cycle pause, delayed formation acknowledgement and refused support commitment passed.');

// A global army count cannot turn an isolated or busy capture squad into a base assault.
function basePush(buddy) {
  const map = { ...open(), spawns: [{ x: 5, y: 5 }, { x: 75, y: 75 }] };
  const game = createGame(map, ['AI', 'enemy'], false, [0, 1], [0, 1], { mode: 'classic', weather: false });
  const rifle = [...game.units.values()].find(u => u.owner === 0 && u.type === 'rifle');
  Object.assign(rifle, { x: 11, z: 11 });
  let buddyId;
  for (let i = 0; i < 5; i++) {
    const u = { ...structuredClone(rifle), id: game.nextId++, x: i === 0 && buddy !== 'far' ? 18 : 135 + i, z: 20 };
    if (i === 0) { buddyId = u.id; if (buddy === 'busy') u.dig = { x: 18, z: 20 }; }
    game.units.set(u.id, u);
  }
  game.players[0].mp = game.players[0].mun = game.players[0].fuel = 0;
  const memory = {}, attacks = [], issued = [];
  let view;
  for (let tick = 0; tick < 240; tick++) {
    game.tick = tick;
    if (!view || tick % 2 === 0) view = viewFor(game, 0, memory);
    think(game, 0, { memory, view, seed: 7, level: 'hard', submit: cmd => {
      const result = command(game, 0, cmd);
      if (result === undefined) {
        issued.push(cmd);
        if (cmd.orders?.some(row => row[0] === rifle.id && row[1] > 120 && row[2] > 120)) attacks.push(cmd);
      }
      return result;
    } });
  }
  assert.ok(issued.length > 0, 'the base-push fixture executes ordinary accepted commands');
  return { attacks, rifle: rifle.id, buddy: buddyId };
}
for (const buddy of ['far', 'busy']) assert.deepEqual(basePush(buddy).attacks, [],
  `a rifle with a ${buddy} buddy cannot use five other inventory units to authorize a solo base advance`);
const ready = basePush('ready');
assert.ok(ready.attacks.length > 0, 'two ready local rifles can form a real base advance');
assert.ok(ready.attacks.every(cmd => cmd.orders.some(row => row[0] === ready.buddy) && cmd.orders.length >= 2),
  'the local buddy joins the same formation command instead of merely authorizing a lone advance');
console.log('Base advances require an available local formation, with isolated and busy-buddy negative controls.');

function firstVisit(concern, companion = 'ready') {
  const game = createGame(open([{ x: 35, y: 40 }, { x: 55, y: 40 }]), ['AI', 'enemy'], false, [0, 1], [0, 1], { weather: false });
  for (const [id, unit] of game.units) if (unit.owner !== 0) game.units.delete(id);
  const own = [...game.units.values()];
  own.forEach((unit, i) => Object.assign(unit, { x: 48 + i * 8, z: 80, auto: false, autoRetreat: false }));
  if (companion === 'busy') own.slice(1).forEach(unit => { unit.dig = { kind: 'trench', x: unit.x, z: unit.z }; });
  if (companion === 'far') own.slice(1).forEach(unit => { unit.x = 76; });
  game.players[0].mp = 0;
  const memory = { human: { concern: { ...concern, ...(concern.kind === 'idle' && { unitId: own[0].id }),
    since: 0, until: 10000 }, startedTick: 0 } }, inputs = [];
  let view, issued;
  for (let tick = 0; tick < 400 && !issued; tick++) {
    game.tick = tick;
    if (!view || tick % 2 === 0) view = viewFor(game, 0, memory);
    think(game, 0, { memory, view, level: 'normal', seed: 10, inputLog: input => inputs.push(structuredClone(input)), submit: cmd => {
      const result = command(game, 0, cmd);
      if (result === undefined && cmd.orders) issued = structuredClone(cmd);
      return result;
    } });
  }
  assert.ok(issued && inputs.some(input => input.command?.orders), 'the attended visit executes a movement through physical inputs');
  return { game, own, issued, inputs, screenIds: new Set(memory.human.view.screenIds) };
}
{
  const visit = firstVisit({ id: 'idle:first', kind: 'idle', x: 48, z: 80 });
  assert.ok(visit.issued.orders.some(row => row[0] === visit.own[0].id),
    'an idle formation includes the named squad receiving attention');
  assert.ok(visit.issued.orders.length >= 2 && visit.inputs.some(input => input.command?.orders?.length >= 2),
    'ready local companions join one physically issued formation command');
  assert.ok(visit.issued.orders.every(row => visit.screenIds.has(row[0]) && visit.own.some(unit => unit.id === row[0]
    && Math.hypot(unit.x - visit.own[0].x, unit.z - visit.own[0].z) <= 24)),
    'every formation member was observed within 24 metres of the named actor');
  for (const companion of ['busy', 'far']) {
    const isolated = firstVisit({ id: 'idle:first', kind: 'idle', x: 48, z: 80 }, companion);
    assert.ok(isolated.own.every(unit => isolated.screenIds.has(unit.id)),
      `${companion} negative control keeps companions observed so their work or distance excludes them`);
    assert.deepEqual(isolated.issued.orders.map(row => row[0]), [isolated.own[0].id],
      `an idle visit excludes ${companion} companions from its actual orders`);
    assert.ok(isolated.own.slice(1).every(unit => !unit.path.length),
      `${companion} companions keep their existing work or position`);
  }
}
{
  const visit = firstVisit({ id: 'point:1', kind: 'expansion', point: 1, x: 111, z: 81 });
  const selected = visit.game.points[1], other = visit.game.points[0];
  assert.ok(visit.issued.orders.every(row => Math.hypot(row[1] - selected.x, row[2] - selected.z) < 12),
    'the physical capture destination serves the point currently receiving attention');
  assert.ok(visit.issued.orders.every(row => Math.hypot(row[1] - other.x, row[2] - other.z) > 24),
    'a closer competing point cannot replace the attended expansion destination');
}

{
  const map = { w: 20, h: 20, rows: Array(20).fill('.'.repeat(20)),
    spawns: [{ x: 1, y: 1 }, { x: 18, y: 1 }], points: [{ x: 10, y: 10 }] };
  const game = createGame(map, ['AI', 'enemy'], false, [0, 1], [0, 1], { weather: false });
  game.units.clear(); game.players[0].mp = 5000;
  assert.equal(command(game, 0, { t: 'buy', unit: 'rifle' }), undefined);
  const holder = [...game.units.values()][0], cell = 10 * game.w + 13;
  Object.assign(holder, { x: 27, z: 19, autoRetreat: false });
  game.points[0].owner = 0; game.points[0].progress = 1;
  mutateWorldCell(game, cell, { ground: '+', height: -1 });
  const memory = {}, inputs = [];
  let view, preDispatchView, acceptedAt = null, staleTurn = false, finished = false;
  for (let tick = 0; tick < 1000 && !finished; tick++) {
    const deliverStale = acceptedAt !== null && game.tick === acceptedAt + 1;
    // One delivery after acceptance still contains the observation received before the physical command.
    if (deliverStale) view = preDispatchView;
    else if (!view || game.tick % 2 === 0) view = viewFor(game, 0, memory);
    if (deliverStale) {
      assert.equal(view.units.get(holder.id).dig, null, 'the delayed observation still reports an idle repair worker');
      assert.equal(holder.dig?.kind, 'fill', 'the authoritative worker is already performing the accepted repair');
      assert.ok(view.tick <= acceptedAt && game.tick > acceptedAt, 'the stale delivery precedes dispatch on a later commander tick');
    }
    think(game, 0, { memory, view, level: 'normal', seed: 27, inputLog: input => inputs.push(structuredClone(input)), submit: cmd => {
      const result = command(game, 0, cmd);
      if (acceptedAt === null && result === undefined && cmd.t === 'dig' && cmd.kind === 'fill' && cmd.ids.includes(holder.id)) {
        acceptedAt = game.tick;
        preDispatchView = view;
      }
      return result;
    } });
    if (deliverStale) staleTurn = true;
    if (acceptedAt !== null && game.height[cell] < 0) assert.equal(holder.dig?.kind, 'fill',
      'an actually accepted repair remains reserved while the latest delivered view can still show the worker idle');
    step(game);
    finished = acceptedAt !== null && game.height[cell] >= 0;
  }
  assert.ok(acceptedAt !== null && staleTurn, 'the reservation proof includes accepted repair and a later turn using its pre-dispatch observation');
  assert.ok(finished && inputs.some(input => input.command?.kind === 'fill'), 'the reserved repair physically dispatches and restores the crater');
}

for (const [level, count] of [['normal', 2], ['hard', 3]]) {
  const game = createGame(open(), ['AI', 'enemy'], false, [0, 1], [0, 1], { weather: false });
  const memory = {}, inputs = [], buys = [];
  const startingIds = new Set(game.units.keys()), spent = game.story?.[0]?.mpSpent ?? 0;
  game.players[0].mp = 5000;
  let view;
  for (let tick = 0; tick < 400 && buys.length < count; tick++) {
    game.tick = tick;
    if (!view || tick % 2 === 0) view = viewFor(game, 0, memory);
    think(game, 0, { memory, view, level, seed: 12, inputLog: input => inputs.push(structuredClone(input)), submit: cmd => {
      const price = cmd.t === 'buy' ? priceOf(game, cmd.unit).mp : 0;
      const nextId = game.nextId, result = command(game, 0, cmd);
      if (result === undefined && cmd.t === 'buy') buys.push({ id: nextId, unit: cmd.unit, price });
      return result;
    } });
  }
  assert.equal(buys.length, count, `${level}: an affordable production visit executes ${count} useful purchases`);
  const clicks = inputs.filter(input => input.command?.t === 'buy');
  assert.equal(clicks.length, count, 'each purchase uses its own physical production click');
  assert.equal(new Set(clicks.map(input => input.cycle)).size, 1,
    `${level}: the purchases finish in the same attended production cycle (${JSON.stringify(clicks.map(input => ({ tick: input.tick, cycle: input.cycle, command: input.command })))})`);
  assert.ok(buys.every(buy => !startingIds.has(buy.id) && game.units.get(buy.id)?.type === buy.unit),
    'every production click creates the requested real unit instead of filler activity');
  assert.equal(game.story[0].mpSpent - spent, buys.reduce((sum, buy) => sum + buy.price, 0),
    'the purchase batch pays its full ordinary manpower cost');
}
console.log('Idle and expansion visits act on their actual destinations; affordable production visits execute useful purchase batches.');

{
  const game = createGame(open(), ['AI', 'enemy'], false, [0, 1], [0, 1], { weather: false });
  game.units.clear(); game.players[0].mp = 5000;
  for (let i = 0; i < 4; i++) command(game, 0, { t: 'buy', unit: 'rifle' });
  const own = [...game.units.values()], local = own.slice(0, 3), remote = own[3];
  local.forEach((unit, i) => Object.assign(unit, { x: 90 + i * 3, z: 80, holdFire: true, auto: false, autoRetreat: false }));
  Object.assign(remote, { x: 140, z: 140, holdFire: true, auto: false, autoRetreat: false });
  const foe = { ...structuredClone(local[0]), id: game.nextId++, owner: 1, x: 111, z: 80 };
  game.units.set(foe.id, foe); game.players[0].mp = 0; game.players[0].mun = 0;
  step(game);
  const memory = { human: { camera: { x: 93, z: 80, yaw: 0, distance: 60 } } }, inputs = [], accepted = [];
  let view, damageTick;
  for (let tick = game.tick; tick < 700; tick++) {
    game.tick = tick;
    if (tick === 130) {
      damageTick = tick;
      command(game, 0, { t: 'stance', ids: local.map(unit => unit.id), key: 'autoRetreat', on: false });
      local.forEach(unit => { unit.hp *= .25; });
    }
    if (!view || tick % 2 === 0) view = viewFor(game, 0, memory);
    think(game, 0, { view, memory, seed: 27, level: 'normal', inputLog: input => inputs.push(structuredClone(input)), submit: cmd => {
      const result = command(game, 0, cmd);
      if (result === undefined) accepted.push({ tick, cmd: structuredClone(cmd) });
      return result;
    } });
    if (accepted.some(row => row.cmd.t === 'retreat' && row.cmd.ids.length === 3)) break;
  }
  const retreat = accepted.find(row => row.cmd.t === 'retreat' && row.cmd.ids.length === 3);
  assert.ok(retreat && retreat.tick >= damageTick + 4, 'observed heavy losses cause an actual group retreat after the reaction floor');
  assert.deepEqual(new Set(retreat.cmd.ids), new Set(local.map(unit => unit.id)), 'the physical retreat affects the damaged local formation');
  const retreatInput = inputs.find(input => input.command?.t === 'retreat' && input.command.ids.length === 3);
  assert.ok(retreatInput, 'the group retreat is issued through a real selected command');
  assert.equal(retreatInput.event?.kind, 'screen-damage', 'the retreat responds to the damage observed in this fight');
  assert.ok(retreatInput.tick - retreatInput.eventTick >= 4, 'the causal retreat input respects the reaction floor');
  assert.ok(local.every(unit => unit.retreating), 'the authoritative command puts every affected squad into retreat');
  assert.ok(!accepted.some(row => (row.cmd.ids ?? row.cmd.orders?.map(order => order[0]) ?? []).includes(remote.id)),
    'the distant squad receives no command from the local fight');
  assert.equal(remote.path.length, 0, 'the distant squad stays in place');
}
console.log('Observed damage triggers a physical group retreat while the remote squad remains untouched.');
