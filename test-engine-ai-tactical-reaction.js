// Watched danger changes an unsafe march, while point guards retain useful combat inputs.
import assert from 'node:assert/strict';
import { createGame, command, step, UNITS } from './shared/sim.js';
import { viewFor } from './shared/ai-view.js';
import { perceive } from './shared/ai-perception.js';
import { plan, think } from './shared/ai.js';

function fixture(types = ['rifle', 'tank'], guard = false) {
  const game = createGame({ w: 80, h: 80, rows: Array(80).fill('.'.repeat(80)),
    spawns: [{ x: 5, y: 5 }, { x: 75, y: 75 }], points: guard ? [{ x: 25, y: 40 }] : [] },
  ['AI', 'enemy'], false, [0, 1], [0, 1], { weather: false });
  game.units.clear();
  types.forEach((type, index) => {
    const slot = index === types.length - 1 ? 1 : 0;
    Object.assign(game.players[slot], { mp: 5000, fuel: 5000 });
    assert.equal(command(game, slot, { t: 'buy', unit: type }), undefined);
  });
  const own = [...game.units.values()].filter(unit => unit.owner === 0);
  const enemy = [...game.units.values()].find(unit => unit.owner === 1);
  own.forEach((unit, index) => Object.assign(unit,
    { x: 45 + index * 3, z: 79, auto: false, autoRetreat: true, holdFire: true }));
  Object.assign(enemy, { x: 75, z: 77, auto: false, holdFire: true });
  game.players.forEach(player => Object.assign(player, { mp: 0, mun: 200, fuel: 0 }));
  if (guard) game.points[0].owner = 0;
  const memory = { human: { camera: { x: 55, z: 75, yaw: 0, distance: 60 },
    persona: { pressure: 1, opening: [] } } }, projection = {}, inspections = [];
  const look = () => perceive(viewFor(game, 0, projection), 0, memory.human, game.tick);
  // These calls test the production decision layer; physical dispatch is exercised separately below.
  const decide = (view = look(), concern = { kind: 'combat', x: 55, z: 75 }) => {
    const decisions = [];
    plan(view, 0, { human: true, level: 'hard', concern,
      requestInspection: cmd => inspections.push(cmd) }, memory, cmd => {
      decisions.push(structuredClone(cmd));
      return undefined;
    });
    return decisions;
  };
  return { game, own, enemy, memory, look, decide, inspections };
}
const ownMoves = (commands, id) => commands.filter(cmd => cmd.t === 'move'
  && cmd.orders.some(row => row[0] === id));

for (const variant of ['danger', 'diagnostic-fields', 'attacker-marker', 'healthy', 'safe-goal',
  'not-in-reach', 'remembered', 'off-camera', 'garrison', 'reacquired']) {
  const f = fixture(), unit = f.own[0];
  assert.equal(command(f.game, 0, { t: 'amove', orders: [[unit.id, 53, 63]] }), undefined);
  step(f.game); f.decide();
  f.game.tick += 8; unit.hp = 70;
  if (variant === 'healthy') unit.hp = 100;
  if (variant === 'not-in-reach') { f.enemy.x = 84; step(f.game); }
  if (variant === 'reacquired') {
    f.memory.human.camera.x = 130; f.look(); f.game.tick++; f.memory.human.camera.x = 55;
  }
  if (variant === 'safe-goal')
    assert.equal(command(f.game, 0, { t: 'amove', orders: [[unit.id, 20, 79]] }), undefined);
  if (variant === 'off-camera') f.memory.human.camera.x = 30;
  const view = f.look();
  if (variant === 'off-camera') {
    assert.ok(view.screenIds.has(unit.id), 'the affected rifle stays on camera');
    assert.ok(!view.screenIds.has(f.enemy.id), 'the armor is truly outside the physical camera');
  }
  if (variant === 'remembered') view.screenIds.delete(f.enemy.id);
  if (variant === 'not-in-reach')
    assert.ok(view.screenIds.has(f.enemy.id), 'the armor outside reach is still actually visible');
  if (variant === 'diagnostic-fields') for (const event of view.events)
    Object.assign(event, { amount: 0, responseRequired: false, responseUnits: [999],
      responseReason: 'test', responsePolicy: 'counterfactual' });
  if (variant === 'attacker-marker') view.units.get(f.enemy.id).targetId = 999;
  if (variant === 'garrison') Object.assign(view.units.get(unit.id), { garrison: 0, path: [], cover: 3 });
  const moves = ownMoves(f.decide(view), unit.id);
  if (['danger', 'diagnostic-fields', 'attacker-marker'].includes(variant)) {
    assert.equal(moves.length, 1, 'one recent watched heavy hit replaces the unsafe current march');
    const row = moves[0].orders.find(order => order[0] === unit.id);
    assert.ok(Math.hypot(row[1] - f.enemy.x, row[2] - f.enemy.z) >= UNITS.tank.w.range + 4,
      'the replacement lies beyond observed armor reach');
    assert.ok(Math.hypot(row[1] - unit.x, row[2] - unit.z) <= 24, 'the pullback stays local');
    assert.ok(!('target' in moves[0]), 'visible armor geometry does not invent a targeted attacker');
    assert.equal(command(f.game, 0, moves[0]), undefined); f.game.tick += 8;
    assert.equal(ownMoves(f.decide(), unit.id).length, 0, 'the accepted safe destination is not reissued');
  } else assert.equal(moves.length, 0, `${variant} does not cause a danger pullback`);
}

{
  const f = fixture(['rifle', 'rifle', 'mg'], true);
  Object.assign(f.enemy, { x: 64, z: 79, cover: 1 }); step(f.game);
  const decisions = f.decide();
  assert.ok(f.inspections.some(cmd => f.own.some(unit => cmd.ids.includes(unit.id))),
    'a stationary point guard can inspect its grenade against a watched covered hostile');
  assert.equal(decisions.filter(cmd => ['move', 'amove'].includes(cmd.t)
    && cmd.orders.some(row => f.own.some(unit => unit.id === row[0]))).length, 0,
  'guards already on their point retain their movement reservation');
}

// Contact defense follows actual observations, including when diagnostics label that contact differently.
{
  const f = fixture(['rifle', 'rifle']); step(f.game);
  const view = f.look();
  const contact = view.events.find(event => event.kind === 'screen-contact' && event.targetId === f.enemy.id);
  assert.ok(contact?.onScreen && contact.observedDanger.idleOwnUnits.length,
    'the delivered contact has a genuinely observed idle actor');
  const concern = { kind: 'combat', event: 'screen-contact', eventId: contact.id,
    targetId: f.enemy.id, x: contact.x, z: contact.z };
  let expected;
  for (const responseRequired of [false, true, undefined]) {
    const labels = { responseRequired, responseUnits: [999], responsePolicy: 'test', responseReason: 'counterfactual' };
    Object.assign(contact, labels);
    const decisions = f.decide(view, { ...concern, ...labels });
    assert.ok(decisions.some(cmd => cmd.t === 'amove' && cmd.orders.some(row => row[0] === f.own[0].id)),
      'a watched contact with a real idle actor produces a useful local defensive order');
    expected ??= decisions;
    assert.deepEqual(decisions, expected, 'diagnostic eligibility labels cannot change contact defense');
  }
  assert.equal(command(f.game, 0, expected.find(cmd => cmd.t === 'amove')), undefined,
    'the chosen contact response is an ordinary legal command');
}
{
  const f = fixture(['rifle', 'rifle']);
  assert.equal(command(f.game, 0, { t: 'move', orders: [[f.own[0].id, 46, 79]] }), undefined);
  step(f.game);
  const view = f.look(), contact = view.events.find(event => event.kind === 'screen-contact');
  assert.ok(contact?.onScreen, 'the neighbor control still has an actual watched hostile');
  assert.deepEqual(contact.observedDanger.idleOwnUnits, [], 'the actual actor is already moving at contact creation');
  const decisions = f.decide(view, { kind: 'combat', event: 'screen-contact', eventId: contact.id,
    targetId: contact.targetId, x: contact.x, z: contact.z, responseRequired: true });
  assert.ok(!decisions.some(cmd => ['move', 'amove'].includes(cmd.t)),
    'a diagnostic positive cannot invent an idle actor or replace the current march');
}

function advanceCommander(f, limit, done) {
  const inputs = [], accepted = [], projection = {};
  let delivered;
  for (let tick = 0; tick < limit; tick++) {
    if (!delivered || f.game.tick % 2 === 0) delivered = viewFor(f.game, 0, projection);
    think(f.game, 0, { memory: f.memory, view: delivered, seed: 42, level: 'hard',
      inputLog: entry => inputs.push(structuredClone(entry)), submit: cmd => {
        const result = command(f.game, 0, cmd);
        if (result === undefined) accepted.push({ tick: f.game.tick, command: structuredClone(cmd) });
        return result;
      } });
    step(f.game);
    if (done(accepted)) break;
  }
  return { inputs, accepted };
}
{
  const f = fixture(['rifle', 'rifle', 'mg'], true);
  Object.assign(f.enemy, { x: 64, z: 79, cover: 1 });
  const result = advanceCommander(f, 500, accepted => accepted.some(entry => entry.command.t === 'ability')
    && f.own.some(unit => unit.cd > 0));
  assert.ok(result.inputs.some(input => input.kind.startsWith('select-')),
    'the guard really selects an actor to read its HUD');
  assert.ok(result.accepted.some(entry => entry.command.t === 'ability'),
    'the inspected guard executes an ordinary accepted aimed ability');
  assert.ok(f.own.some(unit => unit.cd > 0), 'the grenade starts its cooldown after throwing');
  const actors = new Set(result.accepted.filter(entry => entry.command.t === 'ability')
    .flatMap(entry => entry.command.ids));
  assert.equal(result.accepted.filter(entry => ['move', 'amove'].includes(entry.command.t)
    && entry.command.orders.some(row => actors.has(row[0]))).length, 0,
  'the static guard ability does not reorder its point defense');
}
for (const hurt of [false, true]) {
  const f = fixture(['rifle', 'rifle']), unit = f.own[0];
  if (hurt) Object.assign(unit, { hp: 30, autoRetreat: false });
  const result = advanceCommander(f, 240, accepted => accepted.some(entry => hurt
    ? entry.command.t === 'retreat' : entry.command.t === 'amove'));
  assert.ok(result.inputs.some(input => input.kind.startsWith('select-')),
    'both healthy defense and hurt retreat execute a real physical selection');
  if (hurt) {
    assert.ok(result.accepted.some(entry => entry.command.t === 'retreat' && entry.command.ids.includes(unit.id)),
      'an idle hurt squad under watched contact executes an ordinary accepted retreat');
    assert.ok(unit.retreating, 'the real hurt squad starts retreating');
    assert.ok(!result.accepted.some(entry => ['move', 'amove'].includes(entry.command.t)
      && entry.command.orders.some(row => row[0] === unit.id)),
    'the defensive reservation does not override the hurt squad with an advance');
  } else assert.ok(result.accepted.some(entry => entry.command.t === 'amove'
    && entry.command.orders.some(row => row[0] === unit.id)),
  'the healthy control retains its paid ordinary defensive advance');
}

{
  const f = fixture(), unit = f.own[0];
  assert.equal(command(f.game, 0, { t: 'amove', orders: [[unit.id, 53, 63]] }), undefined);
  step(f.game); f.decide(); f.game.tick += 8; unit.hp = 70;
  const hitTick = f.game.tick;
  const result = advanceCommander(f, 240, accepted => accepted.some(entry => entry.command.t === 'move'));
  const move = result.accepted.find(entry => entry.command.t === 'move');
  assert.ok(move, 'the default commander executes the actual local danger move with ordinary hands');
  assert.ok(result.inputs.some(input => input.kind.startsWith('select-')),
    'the danger response actually selects its actor before clicking');
  assert.ok(move.tick >= hitTick + 4, 'the observed hit retains its minimum physical reaction floor');
  for (let tick = 0; tick < 400 && Math.hypot(unit.x - f.enemy.x, unit.z - f.enemy.z) <= UNITS.tank.w.range; tick++)
    step(f.game);
  assert.ok(Math.hypot(unit.x - f.enemy.x, unit.z - f.enemy.z) > UNITS.tank.w.range,
    'the accepted move actually carries the squad beyond watched tank reach');
}
console.log('Watched armor danger, safe holding, diagnostic independence and paid point-guard abilities passed.');
