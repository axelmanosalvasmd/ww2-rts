// Useful work resumes from delivered readiness, without speculative off-camera queue progress.
import assert from 'node:assert/strict';
import { createGame, command, step, SUPPORT, supCost } from './shared/sim.js';
import { think, plan, observe, AI_LEVELS } from './shared/ai.js';
import { viewFor } from './shared/ai-view.js';
import { perceive } from './shared/ai-perception.js';
import { chooseConcern, productionStatus, productionDeferred, affordableSupport } from './shared/ai-attention.js';
import { runCommander } from './shared/ai-commander.js';
import { createHands, queueInspection, advanceHands } from './shared/ai-hands.js';

const open = points => ({ w: 80, h: 80, rows: Array(80).fill('.'.repeat(80)),
  spawns: [{ x: 25, y: 40 }, { x: 75, y: 40 }], points: points ?? [] });
const productionConcern = { id: 'production', kind: 'production', x: 51, z: 81 };
function empty() {
  const game = createGame(open(), ['AI', 'enemy'], false, [0, 1], [0, 1], { weather: false });
  game.units.clear(); game.players[0].mp = 0; game.players[1].out = true; game.tick = 200;
  const memory = { seen: new Map(), node: new Map(), human: { startedTick: 0,
    persona: { family: 'support', pressure: 1, opening: ['mg'] }, buys: 0, cycle: 1,
    camera: { x: 90, z: 80, distance: 60, yaw: 0 } } };
  return { game, memory };
}
function inspect(game, memory) { return perceive(viewFor(game, 0, memory), 0, memory.human); }
function blocked() {
  const fixture = empty(), view = inspect(fixture.game, fixture.memory);
  plan(view, 0, { human: true, level: 'hard', concern: productionConcern }, fixture.memory,
    () => assert.fail('a penniless production inspection cannot submit a purchase'));
  assert.equal(fixture.memory.human.production.reason, 'unaffordable');
  assert.equal(fixture.memory.human.production.proposedBuys, 0);
  return { ...fixture, view, production: fixture.memory.human.production };
}

{
  const { game, memory, view, production } = blocked();
  assert.equal(production.want, 'mg');
  assert.equal(production.requiredMP, production.price.mp);
  for (const mp of [0, 67, 69, production.requiredMP - 1]) {
    view.players[0].mp = mp; view.tick = 250;
    assert.ok(productionDeferred(view, 0, production), 'income below the actual desired price keeps the optional HQ visit deferred');
    const state = { production, camera: view.camera };
    const concern = chooseConcern(view, 0, state, 'hard', () => 0.5);
    assert.equal(concern.id, 'observe', 'an empty concern list cannot reintroduce a deferred HQ visit');
    assert.deepEqual([concern.x, concern.z], [view.camera.x, view.camera.z]);
  }
  view.players[0].mp = production.requiredMP;
  assert.equal(productionDeferred(view, 0, production), false, 'reaching the observed purchase threshold resumes production');
  view.players[0].mp = 0; view.tick = production.tick + 600;
  assert.equal(productionDeferred(view, 0, production), false, 'blocked production receives a bounded 30-second inspection');
  view.tick = 250;
  view.events = [{ id: 'ready:test', kind: 'ready', source: 'alert', tick: 250, ...game.players[0].spawn }];
  assert.equal(chooseConcern(view, 0, { production }, 'hard', () => 0.5).kind, 'production',
    'a genuinely delivered ready alert still receives a production look');
  delete view.events;
  for (const field of ['proposedBuys', 'queuedBuys']) assert.equal(productionDeferred(view, 0, { ...production, [field]: 1 }), false,
    'pending useful purchases are not classified as a blocked visit');
  assert.equal(memory.human.production, production, 'readiness checks do not rewrite the last actual inspection');
}

{
  const { view, production } = blocked();
  for (const reason of ['pop', 'max', 'needs', 'queueFull']) {
    const record = { ...production, reason, mpReady: true, requiredMP: 0 };
    assert.ok(productionDeferred(view, 0, record), `${reason} remains blocked without a relevant delivered change`);
    assert.equal(productionDeferred({ ...view, army: { pop: 2 } }, 0, record), false, 'a delivered cap change permits reassessment');
  }
  const fuel = { ...production, reason: 'fuel', requiredMP: 0, mpReady: true, fuelReady: false, price: { mp: 0, fuel: 20 } };
  view.players[0].fuel = 19;
  assert.ok(productionDeferred(view, 0, fuel));
  view.players[0].fuel = 20;
  assert.equal(productionDeferred(view, 0, fuel), false, 'meeting the inspected fuel requirement resumes production');
  view.players[0].fuel = 0;
  const rifle = { id: 100, owner: 0, type: 'rifle' };
  view.units.set(rifle.id, rifle);
  assert.equal(productionDeferred(view, 0, production), false, 'a known new or lost squad changes the production decision');
  view.units.delete(rifle.id);
  const maker = { id: 101, owner: 0, type: 'barracks', built: 1, queue: ['rifle'], inventoryOnly: false };
  view.units.set(maker.id, maker);
  const queueBlock = { ...production, reason: 'queueFull', readiness: productionStatus(view, 0) };
  assert.ok(productionDeferred(view, 0, queueBlock));
  view.tick += 100;
  assert.ok(productionDeferred(view, 0, queueBlock), 'time alone cannot invent off-camera training completion');
  maker.queue = [];
  assert.equal(productionDeferred(view, 0, queueBlock), false, 'a delivered producer queue change allows a fresh decision');
  maker.built = 0.9;
  const site = { ...queueBlock, readiness: productionStatus(view, 0) };
  maker.built = 0.95;
  assert.ok(productionDeferred(view, 0, site), 'unfinished construction increments do not pretend the producer is ready');
  maker.built = 1;
  assert.equal(productionDeferred(view, 0, site), false, 'an observed finished producer permits reassessment');
}

{
  const { game, memory, view, production } = blocked(), inputs = [], accepted = [];
  memory.human.concern = chooseConcern(view, 0, memory.human, 'hard', () => 0.5);
  let delivered;
  for (let tick = 201; tick < 800 && !accepted.length; tick++) {
    game.tick = tick;
    if (tick === 300) game.players[0].mp = production.requiredMP;
    if (!delivered || tick % 2 === 0) delivered = viewFor(game, 0, memory);
    think(game, 0, { memory, view: delivered, level: 'hard', seed: 27,
      inputLog: input => inputs.push(structuredClone(input)), submit: cmd => {
        const result = command(game, 0, cmd);
        if (result === undefined) accepted.push({ tick, cmd: structuredClone(cmd) });
        return result;
      } });
    if (tick < 300) {
      assert.equal(accepted.length, 0, 'no unaffordable production command crosses the ordinary submission boundary');
      assert.notEqual(memory.human.concern.id, 'production', 'optional production stays deferred before resources arrive');
    }
  }
  assert.ok(accepted.some(entry => entry.tick >= 300 && entry.cmd.t === 'buy'),
    'newly delivered resources resume a real accepted purchase through the commander');
  assert.ok(inputs.some(input => input.command?.t === 'buy'), 'the resumed purchase has its physical production click');
  assert.equal([...game.units.values()].filter(unit => unit.owner === 0).length, 1, 'the accepted purchase creates a real unit');
}

for (const mode of ['conquest', 'classic', 'world']) for (const level of ['easy', 'normal', 'hard']) {
  const { view } = blocked(); view.mode = { kind: mode };
  const me = view.players[0]; me.sup = Object.fromEntries(Object.keys(SUPPORT).map(kind => [kind, 1]));
  me.sup.smoke = 0;
  const { cur, cost } = supCost(view, 'smoke'), reserve = cur === 'mp' ? AI_LEVELS[level].supReserve : AI_LEVELS[level].munReserve;
  me[cur] = cost + reserve - 1;
  assert.equal(affordableSupport(view, 0, level), false, `${mode}/${level}: a ready support still needs its ordinary price and existing reserve`);
  view.minimap = [{ owner: 1, x: 135, z: 140 }]; view.tick = 250;
  const poor = {};
  chooseConcern(view, 0, poor, level, () => 0.5);
  assert.ok(!poor.concerns.some(concern => concern.kind === 'support'), 'unaffordable support cannot enter the remembered camera concerns');
  me[cur]++;
  assert.equal(affordableSupport(view, 0, level), true, `${mode}/${level}: the exact delivered currency threshold permits support attention`);
  const funded = {};
  chooseConcern(view, 0, funded, level, () => 0.5);
  assert.ok(funded.concerns.some(concern => concern.kind === 'support'), 'newly affordable support enters the actual concern competition');
  me.sup.smoke = 1;
  assert.equal(affordableSupport(view, 0, level), false, 'affordable support on cooldown cannot request attention');
}

// The root dispatch gate permits local maintenance only for the named idle actor.
function maintenance(control = 'local', actorIndex = 0) {
  const game = createGame(open([{ x: 35, y: 40 }]), ['AI', 'enemy'], false, [0, 1], [0, 1], { weather: false });
  for (const [id, unit] of game.units) if (unit.owner !== 0) game.units.delete(id);
  const own = [...game.units.values()], actor = own[actorIndex];
  own.forEach((unit, i) => Object.assign(unit, { x: 71 + i * 3, z: 81, auto: false, autoRetreat: false }));
  game.points[0].owner = 0; game.points[0].vp = 1; game.players[0].mp = control === 'poor' ? 0 : 250;
  const concern = { id: `idle:${actor.id}`, kind: 'idle', unitId: actor.id, x: actor.x, z: actor.z, since: 0, until: 10000 };
  const memory = { human: { concern, startedTick: 0 } }, accepted = [], inputs = [];
  let delivered;
  for (let tick = 0; tick < 300; tick++) {
    game.tick = tick;
    if (!delivered || tick % 2 === 0) delivered = viewFor(game, 0, memory);
    const planner = control === 'local' || control === 'poor' ? plan : (_view, _slot, opts, _mem, submit) => {
      if (opts.concern.unitId !== actor.id || opts.concern.kind !== 'idle') return;
      submit({ t: 'dig', ids: [control === 'other' ? own[1].id : actor.id], kind: 'mines',
        x: actor.x + (control === 'far' ? 30 : 8), z: actor.z, dir: 0 });
    };
    runCommander(delivered, 0, { tick, level: 'hard', seed: 27, inputLog: input => inputs.push(structuredClone(input)) }, memory, cmd => {
      const result = command(game, 0, cmd);
      if (result === undefined) accepted.push(structuredClone(cmd));
      return result;
    }, planner);
    if (accepted.some(cmd => ['dig', 'entrench'].includes(cmd.t))) break;
  }
  return { game, actor, accepted, inputs };
}
{
  const local = maintenance();
  assert.ok(local.accepted.some(cmd => ['dig', 'entrench'].includes(cmd.t) && cmd.ids.includes(local.actor.id)),
    'an idle owned-point visit executes ordinary accepted maintenance by its named actor');
  assert.ok(local.actor.dig || local.actor.entrench, 'the accepted physical order creates authoritative pending work');
  assert.ok(local.accepted.filter(cmd => ['dig', 'entrench'].includes(cmd.t)).every(cmd =>
    Math.hypot(cmd.x - local.actor.x, cmd.z - local.actor.z) <= 24), 'the accepted maintenance target remains local to its named worker');
  assert.ok(local.inputs.some(input => ['dig', 'entrench'].includes(input.command?.t)), 'maintenance follows an issuing physical input');
  const second = maintenance('local', 1);
  assert.ok(second.accepted.some(cmd => ['dig', 'entrench'].includes(cmd.t) && cmd.ids.includes(second.actor.id)),
    'a companion listed first in the roster cannot consume the named holder maintenance opportunity');
  for (const control of ['poor', 'other', 'far']) assert.ok(!maintenance(control).accepted.some(cmd => ['dig', 'entrench'].includes(cmd.t)),
    `${control} maintenance cannot bypass funds, named actor, or local destination checks`);
}
console.log('Human commander delivered production readiness, affordable support and actual local maintenance passed.');

function abilityFixture(cooldown = 0) {
  const game = createGame(open(), ['AI', 'enemy'], false, [0, 1], [0, 1], { weather: false });
  game.seed = 7; game.matchSeed = 7;
  game.units.clear(); game.players.forEach(player => { player.mp = 5000; });
  assert.equal(command(game, 0, { t: 'buy', unit: 'rifle' }), undefined);
  assert.equal(command(game, 1, { t: 'buy', unit: 'mg' }), undefined);
  const actor = [...game.units.values()].find(unit => unit.owner === 0), enemy = [...game.units.values()].find(unit => unit.owner === 1);
  Object.assign(actor, { x: 80, z: 80, auto: false, autoRetreat: false });
  Object.assign(enemy, { x: 96, z: 80, holdFire: true, auto: false, autoRetreat: false });
  step(game); game.tick = 200; actor.cd = cooldown; game.players[0].mp = 0;
  const camera = { x: 80, z: 80, yaw: 0, distance: 60 }, inputs = [];
  const hands = createHands({ slot: 0, level: 'hard', seed: 27, camera, startedTick: 0, log: entry => inputs.push(structuredClone(entry)) });
  const memory = { seen: new Map(), node: new Map(), human: { camera, hands,
    persona: { pressure: 1, opening: [] }, buys: 0, cycle: 1 } };
  return { game, actor, enemy, memory, hands, inputs };
}
function abilityPlan(fixture, { hook = true, perturb, poor = false, far = false } = {}) {
  const { game, memory, actor, enemy } = fixture;
  if (far) enemy.x = 110;
  const view = inspect(game, memory);
  assert.ok(view.screenIds.has(actor.id) && view.units.has(enemy.id), 'the tactical candidate is genuinely delivered on camera');
  if (perturb !== undefined) view.units.get(actor.id).cd = perturb;
  if (poor) { view.mode = { kind: 'classic' }; view.players[0].mun = 0; }
  const requests = [], commands = [];
  const before = structuredClone(view.units.get(actor.id));
  plan(view, 0, { human: true, level: 'hard', concern: { id: 'ability-test', kind: 'combat', x: 80, z: 80 },
    ...(hook && { requestInspection: cmd => requests.push(structuredClone(cmd)) }) }, memory, cmd => {
    commands.push(structuredClone(cmd)); return command(game, 0, cmd);
  });
  assert.deepEqual(view.units.get(actor.id), before, 'inspection planning cannot mutate the delivered actor or its cooldown');
  return { view, requests, commands };
}
{
  const unknown = [0, 17, 99].map(cooldown => abilityPlan(abilityFixture(cooldown)));
  const request = unknown[0].requests;
  assert.equal(request.length, 1, 'one meaningful watched grenade target requests a readiness inspection');
  assert.equal(request[0].t, 'ability');
  for (const result of unknown) {
    assert.equal(result.view.units.get(request[0].ids[0]).cdKnown, false);
    assert.deepEqual(result.requests, request, 'unselected actual cooldown perturbations cannot change the tactical inspection request');
    assert.ok(!result.commands.some(cmd => cmd.t === 'ability'), 'unknown readiness emits no ability or reserves its economy');
    assert.deepEqual(result.commands, unknown[0].commands, 'unknown readiness leaves ordinary nonability inputs unchanged');
  }
  for (const perturb of [0, 99, Infinity]) {
    const result = abilityPlan(abilityFixture(), { perturb });
    assert.deepEqual(result.requests, request, 'unknown delivered cooldown fields cannot influence the proposed inspection');
    assert.ok(!result.commands.some(cmd => cmd.t === 'ability'));
    const absent = abilityPlan(abilityFixture(), { hook: false, perturb });
    assert.deepEqual(absent.requests, []);
    assert.ok(!absent.commands.some(cmd => cmd.t === 'ability'), 'a missing inspection hook cannot turn unknown readiness into a cast');
  }
  assert.deepEqual(abilityPlan(abilityFixture(), { poor: true }).requests, [], 'unaffordable grenades do not spend inspection inputs');
  assert.deepEqual(abilityPlan(abilityFixture(), { far: true }).requests, [], 'a target outside the existing tactical range does not request inspection');
}
for (const cooldown of [0, 13.2]) {
  const fixture = abilityFixture(cooldown), view = inspect(fixture.game, fixture.memory);
  assert.ok(queueInspection(fixture.hands, [fixture.actor.id], view, { concern: 'ability-test', concernKind: 'combat' }));
  for (let tick = 200; tick < 400 && !fixture.hands.selected.includes(fixture.actor.id); tick++) {
    fixture.game.tick = tick;
    advanceHands(fixture.hands, tick, view, () => assert.fail('a readiness inspection cannot issue an order'));
  }
  assert.deepEqual(fixture.hands.selected, [fixture.actor.id], 'the selected HUD comes from an actual paid singleton click');
  assert.ok(fixture.inputs.some(input => input.kind === 'select-click' && input.ids.includes(fixture.actor.id)));
  const result = abilityPlan(fixture);
  assert.equal(result.view.units.get(fixture.actor.id).cdKnown, true, 'the current physical singleton selection exposes HUD readiness');
  assert.deepEqual(result.requests, [], 'known selected readiness needs no additional inspection');
  const abilities = result.commands.filter(cmd => cmd.t === 'ability');
  assert.equal(abilities.length, cooldown === 0 ? 1 : 0, 'a selected ready actor casts, while a selected cooling actor does not');
  if (cooldown === 0) assert.ok(fixture.actor.nade, 'the selected ready grenade is an ordinary accepted authoritative ability');
}

{
  const fixture = abilityFixture(), view = inspect(fixture.game, fixture.memory);
  assert.ok(queueInspection(fixture.hands, [fixture.actor.id], view, { concern: 'ability-budget', concernKind: 'combat' }));
  for (let tick = 200; tick < 400 && !fixture.hands.selected.includes(fixture.actor.id); tick++) {
    fixture.game.tick = tick;
    advanceHands(fixture.hands, tick, view, () => assert.fail('inspection cannot issue an order'));
  }
  assert.deepEqual(fixture.hands.selected, [fixture.actor.id]);
  fixture.game.players[0].mp = 5000;
  assert.equal(command(fixture.game, 0, { t: 'buy', unit: 'rifle' }), undefined);
  const buddy = [...fixture.game.units.values()].filter(unit => unit.owner === 0 && unit.id !== fixture.actor.id)[0];
  Object.assign(buddy, { x: 80, z: 82, auto: false, autoRetreat: false });
  fixture.game.players[0].mp = 0;
  const result = abilityPlan(fixture);
  assert.ok(result.view.screenIds.has(buddy.id) && result.view.units.get(buddy.id).cdKnown === false,
    'the budget negative control includes a genuinely observed unknown nearby candidate');
  assert.equal(result.commands.filter(cmd => cmd.t === 'ability').length, 1, 'the first selected ready squad consumes the existing human cast budget');
  assert.deepEqual(result.requests, [], 'an unknown nearby squad cannot spend inspection inputs after this look exhausted its cast budget');
}

// Projection memory is owned privately by ai.js, outside every object supplied to the planner.
{
  const fixture = empty(), memory = fixture.memory;
  const previous = Object.getOwnPropertyDescriptor(Object.prototype, 'projection');
  Object.defineProperty(Object.prototype, 'projection', { configurable: true,
    get: () => assert.fail('observe and human think must not read raw projection memory from planner-reachable objects'),
    set: () => assert.fail('observe and human think must not attach raw projection memory to planner-reachable objects') });
  try {
    observe(fixture.game, 0);
    think(fixture.game, 0, { memory, level: 'hard', seed: 27 });
  } finally {
    if (previous) Object.defineProperty(Object.prototype, 'projection', previous);
    else delete Object.prototype.projection;
  }
  assert.equal(Object.hasOwn(memory, 'projection'), false, 'the planner memory has no raw projection property after a default observation');
}
function offCameraAction(type, hp) {
  const game = createGame(open([{ x: 55, y: 40 }]), ['AI', 'enemy'], false, [0, 1], [0, 1], { weather: false });
  game.seed = 7; game.matchSeed = 7; game.units.clear(); game.players.forEach(player => { player.mp = 5000; });
  for (let i = 0; i < 2; i++) assert.equal(command(game, 0, { t: 'buy', unit: 'rifle' }), undefined);
  assert.equal(command(game, 1, { t: 'buy', unit: type }), undefined);
  const own = [...game.units.values()].filter(unit => unit.owner === 0), enemy = [...game.units.values()].find(unit => unit.owner === 1);
  own.forEach((unit, i) => Object.assign(unit, { x: i ? 130 : 80, z: 80, holdFire: true, auto: false, autoRetreat: false }));
  Object.assign(enemy, { x: 145, z: 80, hp, holdFire: true, auto: false, autoRetreat: false });
  step(game); game.tick = 200; game.players[0].mp = 0;
  const actor = own[0], memory = { human: { startedTick: 0, camera: { x: 80, z: 80, yaw: 0, distance: 60 },
    concern: { id: `idle:${actor.id}`, kind: 'idle', unitId: actor.id, x: actor.x, z: actor.z, since: 200, until: 10000 } } };
  const observed = observe(game, 0);
  assert.ok(observed.units.has(enemy.id), 'the regression places the distant enemy in the full delivered fog observation');
  const sensor = perceive(observed, 0, { camera: { ...memory.human.camera } });
  assert.ok(!sensor.units.has(enemy.id) && sensor.minimap.some(dot => dot.owner === 1),
    'the commander may see the distant anonymous dot while its type and health remain outside the camera');
  const actions = [], inputs = [];
  for (let tick = 200; tick < 600 && !actions.length; tick++) {
    game.tick = tick;
    think(game, 0, { memory, level: 'hard', seed: 27, inputLog: input => inputs.push(structuredClone(input)), submit: cmd => {
      const result = command(game, 0, cmd);
      if (result === undefined && cmd.orders) actions.push(structuredClone(cmd));
      return result;
    } });
  }
  assert.ok(actions.length && inputs.some(input => input.command?.orders), 'the default projection path executes a real movement through physical inputs');
  const seen = new Set(), values = [];
  const visit = value => {
    if (!value || typeof value !== 'object') { if (typeof value === 'number') values.push(value); return; }
    if (seen.has(value)) return; seen.add(value);
    if (value instanceof Map) for (const [key, item] of value) { visit(key); visit(item); }
    else if (value instanceof Set) for (const item of value) visit(item);
    else for (const key of Object.keys(value)) visit(value[key]);
  };
  visit(memory);
  assert.ok(!values.includes(hp), 'a planner traversing its entire reachable memory cannot recover off-camera exact enemy health');
  assert.equal(Object.hasOwn(memory, 'projection'), false);
  return { actions, inputs };
}
assert.deepEqual(offCameraAction('rifle', 37.23), offCameraAction('mg', 93.67),
  'changing only off-camera enemy type and health preserves the actual command and physical input timeline');
console.log('Planner unknown ability readiness inspection, paid selected HUD and private projection ownership passed.');
