import assert from 'node:assert/strict';
import { createGame, command, step } from './shared/sim.js';
import { viewFor } from './shared/ai-view.js';
import { perceive } from './shared/ai-perception.js';
import { createHands, queueInspection, advanceHands } from './shared/ai-hands.js';
import { plan } from './shared/ai.js';
function fixture(variant = 'unknown') {
  const prior = Math.random; Math.random = () => .5;
  let game;
  try {
    game = createGame({ w: 80, h: 80, rows: Array(80).fill('.'.repeat(80)),
      spawns: [{ x: 5, y: 5 }, { x: 75, y: 75 }], points: [{ x: 25, y: 40 }] },
      ['AI', 'enemy'], false, [0, 1], [0, 1], { weather: false });
  } finally { Math.random = prior; }
  game.units.clear(); game.players.forEach(player => Object.assign(player, { mp: 5000, fuel: 5000 }));
  for (const [slot, unit] of [[0, 'rifle'], [0, 'rifle'], [1, variant === 'vehicle' ? 'medium' : variant === 'openRifle' ? 'rifle' : 'mg']])
    assert.equal(command(game, slot, { t: 'buy', unit }), undefined);
  const own = [...game.units.values()].find(unit => unit.owner === 0), enemy = [...game.units.values()].find(unit => unit.owner === 1);
  Object.assign(own, { x: 51, z: 81, auto: false, autoRetreat: false, holdFire: true });
  const companion = [...game.units.values()].find(unit => unit.owner === 0 && unit.id !== own.id);
  Object.assign(companion, { x: 54, z: 81, auto: false, autoRetreat: false, holdFire: true });
  Object.assign(enemy, { x: variant === 'outOfRange' ? 75 : 66, z: 81, auto: false, holdFire: true });
  game.points[0].owner = 0; game.tick = 100;
  game.players.forEach(player => Object.assign(player, { mp: 0, fuel: 0, mun: variant === 'freeConquest' ? 0 : 200 }));
  step(game);
  const camera = { x: 60, z: 75, yaw: 0, distance: 60 };
  const inputs = [], memory = { human: { camera, persona: { pressure: 1, opening: [] },
    hands: createHands({ slot: 0, seed: 42, level: 'hard', camera, log: inputs }) } };
  const look = () => perceive(viewFor(game, 0, {}), 0, memory.human, game.tick);
  let view = look();
  const event = view.events.find(event => event.kind === 'screen-contact' && event.targetId === enemy.id);
  assert.ok(event?.observedDanger?.idleOwnUnits.includes(own.id), 'the guard is actually idle beside a delivered hostile');
  if (variant === 'ready' || variant === 'cooling') {
    own.cd = variant === 'cooling' ? 30 : 0;
    assert.ok(queueInspection(memory.human.hands, [own.id], view, { concern: 'real-hud-read' }));
    for (let tick = game.tick; tick < game.tick + 160 && !memory.human.hands.ready; tick++)
      advanceHands(memory.human.hands, tick, view, () => { throw Error('inspection must not submit a command'); });
    assert.deepEqual(memory.human.hands.selected, [own.id], 'the actual hit-tested inspection selects the guard');
    assert.ok(inputs.some(input => input.inspection && input.inspectionAcquired));
    view = look(); assert.equal(view.units.get(own.id).cdKnown, true);
  }
  const inspections = [], commands = [];
  const concern = { kind: 'combat', event: 'screen-contact', eventId: event.id,
    targetId: event.targetId, x: event.x, z: event.z };
  plan(view, 0, { human: true, level: 'hard', concern,
    ...(variant === 'noHook' ? {} : { requestInspection: cmd => inspections.push(structuredClone(cmd)) }) }, memory,
    cmd => { commands.push(structuredClone(cmd)); return undefined; });
  return { own, enemy, inspections, commands, game, inputs };
}
for (const variant of ['unknown', 'ready', 'freeConquest']) {
  const f = fixture(variant);
  assert.ok(!f.commands.some(cmd => ['move', 'amove'].includes(cmd.t) && cmd.orders.some(row => row[0] === f.own.id)),
    'a useful stationary grenade choice keeps the objective reservation');
  if (variant !== 'ready') assert.ok(f.inspections.some(cmd => cmd.ids.includes(f.own.id)), 'unknown readiness requests a meaningful HUD read');
  else {
    const ability = f.commands.find(cmd => cmd.t === 'ability' && cmd.ids.includes(f.own.id));
    assert.ok(ability); assert.equal(command(f.game, 0, ability), undefined, 'the ready aimed ability passes the actual command gate');
  }
}
for (const variant of ['cooling', 'outOfRange', 'vehicle', 'openRifle', 'noHook']) {
  const f = fixture(variant);
  assert.ok(f.commands.some(cmd => cmd.t === 'amove' && cmd.orders.some(row => row[0] === f.own.id)),
    variant + ' does not treat grenade capability alone as a useful stationary choice');
  assert.ok(!f.inspections.some(cmd => cmd.ids.includes(f.own.id)), variant + ' does not create a meaningless HUD request');
}
{
  const rows = Array(80).fill('.'.repeat(80)); rows[3] = '.'.repeat(24) + 'T' + '.'.repeat(55);
  const prior = Math.random; Math.random = () => .5; let game;
  try { game = createGame({ w: 80, h: 80, rows, spawns: [{ x: 5, y: 5 }, { x: 75, y: 75 }], points: [] },
    ['AI', 'enemy'], false, [0, 1], [0, 1], { weather: false, mode: 'classic' }); } finally { Math.random = prior; }
  const engineer = [...game.units.values()].find(unit => unit.owner === 0 && unit.type === 'engineer');
  const node = game.nodes[0]; game.players[0].mp = 5000; Object.assign(engineer, { x: node.x, z: node.z });
  assert.equal(command(game, 0, { t: 'build', ids: [engineer.id], kind: 'depot', x: node.x, z: node.z }), undefined);
  for (let i = 0; i < 500; i++) step(game);
  const depot = [...game.units.values()].find(unit => unit.owner === 0 && unit.type === 'depot');
  assert.ok(depot?.built >= 1, 'the real Classic crew finishes its actual guarded depot');
  const own = [...game.units.values()].find(unit => unit.owner === 0 && unit.type === 'rifle');
  const enemy = [...game.units.values()].find(unit => unit.owner === 1 && unit.type === 'rifle');
  Object.assign(own, { x: 31, z: 5, holdFire: true, auto: false, autoRetreat: false });
  Object.assign(enemy, { x: 49, z: 7, holdFire: true, auto: false }); step(game);
  game.players.forEach(player => Object.assign(player, { mp: 0, fuel: 0, mun: 0 }));
  const memory = { human: { camera: { x: 34, z: 8, yaw: 0, distance: 60 }, persona: { pressure: 1, opening: [] } } };
  const view = perceive(viewFor(game, 0, {}), 0, memory.human, game.tick);
  const event = view.events.find(event => event.kind === 'screen-contact' && event.targetId === enemy.id);
  assert.ok(event?.observedDanger?.idleOwnUnits.includes(own.id)); assert.equal(view.units.get(enemy.id).cover, 2);
  const commands = [], inspections = [];
  plan(view, 0, { human: true, level: 'hard', concern: { kind: 'combat', event: 'screen-contact', eventId: event.id,
    targetId: enemy.id, x: event.x, z: event.z }, requestInspection: cmd => inspections.push(cmd) }, memory,
    cmd => { commands.push(structuredClone(cmd)); return undefined; });
  assert.ok(commands.some(cmd => cmd.t === 'amove' && cmd.orders.some(row => row[0] === own.id)),
    'a genuinely unaffordable Classic grenade keeps actual local depot defense eligible');
  assert.ok(!inspections.some(cmd => cmd.ids.includes(own.id)), 'the paid Classic ability cost cannot create an unaffordable inspection');
}
console.log('Useful ready and physically inspectable guard grenades preserve station; cooling, affordability, range, target and hook controls retain local defense.');
