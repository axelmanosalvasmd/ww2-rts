// Bridge repairs use watched ground, an actual idle builder, and ordinary paid inputs.
import assert from 'node:assert/strict';
import { createGame, command, step, findPath, FORTS, SUPPORT } from './shared/sim.js';
import { think, plan } from './shared/ai.js';
import { viewFor } from './shared/ai-view.js';
import { perceive, onScreen } from './shared/ai-perception.js';
import { chooseConcern } from './shared/ai-attention.js';

function lcg(seed) {
  let state = seed;
  return () => { state = Math.imul(state, 1664525) + 1013904223 | 0; return (state >>> 0) / 4294967296; };
}
function withRandom(seed, run) {
  const original = Math.random; Math.random = lcg(seed);
  try { return run(); } finally { Math.random = original; }
}
const empty = Array(20).fill('.'.repeat(20));
const blank = rows => ({ w: rows[0].length, h: rows.length, rows,
  spawns: [{ x: 1, y: 1 }, { x: 18, y: 1 }, { x: 1, y: 18 }], points: [{ x: 10, y: 10 }] });
const fresh = rows => {
  const game = createGame(blank(rows), ['a', 'b'], false); game.units.clear();
  game.players.forEach(player => { player.spawn = { x: -1000, z: -1000 }; });
  return game;
};
const put = (game, owner, type, x, z) => {
  assert.equal(command(game, owner, { t: 'buy', unit: type }), undefined);
  const unit = [...game.units.values()].at(-1);
  Object.assign(unit, { x, z, autoRetreat: false }); return unit;
};
const summary = [];
for (let seed = 1; seed <= 40; seed++) withRandom(seed, () => {
  const rows = empty.map((row, y) => row.slice(0, 9)
    + (y >= 9 && y <= 11 ? '===' : 'WWW') + row.slice(12));
  const game = fresh(rows), memory = {}, inputs = [], commands = [];
  game.players.forEach((player, slot) => { player.spawn = { x: slot ? 37 : 3, z: 3 }; });
  game.players[0].mp = 5000; game.points = [];
  const sapper = put(game, 0, 'rifle', 13, 21), tank = { x: 5, z: 21, type: 'tank' };
  let delivered;
  const tickGameplayAI = () => {
    if (!delivered || !(game.tick % 2)) delivered = viewFor(game, 0, memory);
    think(game, 0, { memory, view: delivered, inputLog: input => inputs.push(structuredClone(input)),
      submit: cmd => {
        const mpBefore = game.players[0].mp, result = command(game, 0, cmd);
        commands.push({ tick: game.tick, command: structuredClone(cmd), result, mpBefore,
          mpAfter: game.players[0].mp, dig: cmd.t === 'dig' ? structuredClone(game.units.get(cmd.ids[0])?.dig) : null });
        return result;
      } });
  };
  tickGameplayAI();
  game.players[1].mp = 5000;
  assert.equal(command(game, 1, { t: 'support', kind: 'dive', x: 21, z: 21 }), undefined);
  for (let tick = 0; tick < 300 && game.chars[210] === '='; tick++) step(game);
  assert.equal(game.chars[210], 'W', `${seed}: the ordinary air strike actually blows the crossing`);
  const blownTick = game.tick;
  for (let tick = 0; tick < 1200 && !findPath(game, tank, { x: 35, z: 21 }).length; tick++) {
    tickGameplayAI(); step(game);
  }
  assert.ok(findPath(game, tank, { x: 35, z: 21 }).length,
    `${seed}: actual vehicle crossing is restored within the original sixty seconds`);
  assert.ok(sapper.hp > 0, `${seed}: the original builder survives its repair`);
  const repairs = commands.filter(entry => entry.command.t === 'dig' && entry.command.kind === 'bridge'
    && entry.result === undefined);
  assert.ok(repairs.length >= 2, `${seed}: multiple accepted jobs cover real repair work`);
  for (const entry of repairs) {
    assert.equal(entry.mpBefore - entry.mpAfter, FORTS.bridge.cost, 'an accepted native repair pays its ordinary eighty MP');
    assert.ok(entry.dig?.cells.length, 'the authoritative job owns actual repair cells');
    assert.ok(inputs.some(input => input.tick === entry.tick && input.command?.t === 'dig'
      && input.command.kind === 'bridge'), 'each accepted repair comes from a paid native placement input');
  }
  summary.push({ seed, matchSeed: game.matchSeed, secondsAfterBreak: (game.tick - blownTick) / 20,
    nativeInputs: inputs.length, acceptedRepairJobs: repairs.length,
    rejectedRepairJobs: commands.filter(entry => entry.command.t === 'dig' && entry.result !== undefined).length });
});

const map = { w: 80, h: 80, rows: Array.from({ length: 80 }, (_, y) => '.'.repeat(29)
  + (y >= 39 && y <= 41 ? '===' : 'WWW') + '.'.repeat(48)),
  spawns: [{ x: 5, y: 5 }, { x: 75, y: 75 }], points: [] };
function cueFixture(variant) {
  return withRandom(23, () => {
    const source = variant === 'invalid-original' ? { ...map, rows: map.rows.map(row => row.replaceAll('=', 'W')) } : map;
    const game = createGame(source, ['AI', 'enemy'], false, [0, 1], [0, 1],
      { weather: false, ...(variant === 'engineer' ? { mode: 'classic' } : {}) });
    const startingEngineer = variant === 'engineer'
      ? [...game.units.values()].find(unit => unit.owner === 0 && unit.type === 'engineer') : null;
    if (variant === 'engineer') for (const [id, unit] of game.units) {
      if (unit.type !== 'hq' && id !== startingEngineer.id) game.units.delete(id);
    } else game.units.clear();
    game.players[0].mp = 1000;
    const own = startingEngineer ?? put(game, 0, variant === 'wrong-type' ? 'at' : 'rifle', 49, 81);
    Object.assign(own, { x: 49, z: 81, auto: false, autoRetreat: false, holdFire: true });
    if (variant !== 'intact') {
      game.players[1].mp = 5000;
      game.players[1].mun = 5000;
      assert.equal(command(game, 1, { t: 'support', kind: 'dive', x: 61, z: 81 }), undefined);
      for (let tick = 0; tick < SUPPORT.dive.delay * 20 + 20; tick++) step(game);
      assert.equal(game.chars[40 * 80 + 30], 'W', 'the cue fixture uses an actual destroyed bridge');
    }
    own.x = 55;
    if (variant === 'hidden-span') own.x = 49;
    game.players.forEach(player => { player.mp = 0; player.mun = 0; });
    if (variant === 'moving') assert.equal(command(game, 0, { t: 'move', orders: [[own.id, 49, 89]] }), undefined);
    if (variant === 'hostile') {
      game.players[1].mp = 1000; const enemy = put(game, 1, 'rifle', 64, 81);
      Object.assign(enemy, { auto: false, holdFire: true });
    }
    if (variant === 'foreign') own.owner = 1;
    step(game);
    const state = { camera: variant === 'off-camera-cell' ? { x: 43, z: 81, yaw: 0, distance: 20 }
      : variant === 'off-camera-actor' ? { x: 61, z: 81, yaw: 0, distance: 15 }
        : { x: 55, z: 81, yaw: 0, distance: 60 } };
    const observation = viewFor(game, 0, {});
    if (variant === 'unseen') {
      const sees = observation.sees;
      observation.sees = at => !(at.x >= 58 && at.x <= 64 && at.z >= 78 && at.z <= 84) && sees(at);
    }
    const view = perceive(observation, 0, state, game.tick), attention = {};
    chooseConcern(view, 0, attention, 'normal', () => .5);
    return { game, own, view, attention };
  });
}
for (const variant of ['positive', 'engineer', 'intact', 'invalid-original', 'wrong-type', 'moving', 'foreign',
  'hostile', 'off-camera-cell', 'off-camera-actor', 'unseen']) {
  const f = cueFixture(variant), repairs = f.attention.concerns.filter(concern => concern.id.startsWith('repair:'));
  if (variant === 'off-camera-cell') {
    assert.ok(f.view.screenIds.has(f.own.id), 'off-camera ground control keeps its actual idle builder on screen');
    assert.ok(!onScreen({ x: 61, z: 81 }, f.view.camera, f.view));
  }
  if (['positive', 'engineer'].includes(variant)) {
    assert.equal(repairs.length, 1);
    assert.equal(repairs[0].unitId, f.own.id);
    assert.equal(repairs[0].urgency, 89); assert.equal(repairs[0].kind, 'idle');
    if (variant === 'engineer') {
      f.game.players[0].mp = 1000;
      const proposals = [], engineerMemory = { seen: new Map(), node: new Map(),
        human: { camera: f.view.camera, persona: { pressure: 1, opening: [] } } };
      const refreshed = perceive(viewFor(f.game, 0, {}), 0, engineerMemory.human, f.game.tick);
      plan(refreshed, 0, { human: true, level: 'normal', concern: repairs[0] }, engineerMemory, cmd => {
        const result = command(f.game, 0, cmd); proposals.push({ command: structuredClone(cmd), result }); return result;
      });
      assert.ok(proposals.some(entry => entry.command.t === 'dig' && entry.command.kind === 'bridge'
        && entry.command.ids.includes(f.own.id) && entry.result === undefined),
      'the watched named engineer actually receives an ordinary accepted bridge job');
      assert.ok(f.own.dig?.cells.length, 'the engineer owns real authoritative bridge repair cells');
    }
  } else assert.equal(repairs.length, 0, `${variant}: invalid repair conditions cannot earn extra attention`);
}

const actualHidden = cueFixture('hidden-span'); actualHidden.game.players[0].mp = 1000;
const mpBefore = actualHidden.game.players[0].mp, charsBefore = actualHidden.game.chars.join('');
assert.equal(command(actualHidden.game, 0, { t: 'dig', ids: [actualHidden.own.id], kind: 'bridge',
  x: 61, z: 79, dir: 0 }), 'notVisible', 'the authoritative command also rejects the actually unseen far span');
assert.equal(actualHidden.game.players[0].mp, mpBefore, 'the unseen authoritative span spends no repair MP');
assert.equal(actualHidden.game.chars.join(''), charsBefore, 'the unseen span changes no actual ground');
assert.equal(actualHidden.own.dig, null, 'the unseen span starts no authoritative job');

const hidden = cueFixture('positive'); hidden.game.players[0].mp = 1000;
const delivered = viewFor(hidden.game, 0, {}), actualSees = delivered.sees;
delivered.sees = at => at.x < 63 && actualSees(at);
const state = { camera: { x: 55, z: 81, yaw: 0, distance: 60 }, persona: { pressure: 1, opening: [] } };
const view = perceive(delivered, 0, state, hidden.game.tick), memory = { human: state }, sent = [], results = [];
plan(view, 0, { human: true, level: 'normal', concern: { id: `idle:${hidden.own.id}`, kind: 'idle',
  unitId: hidden.own.id, x: hidden.own.x, z: hidden.own.z } }, memory, cmd => {
  sent.push(structuredClone(cmd)); const result = command(hidden.game, 0, cmd); results.push(result); return result;
});
assert.ok(!sent.some(cmd => cmd.t === 'dig' && cmd.kind === 'bridge'),
  'the client preview still refuses a bridge whose full span is unseen');
const move = sent.find(cmd => cmd.t === 'move' && cmd.orders.some(row => row[0] === hidden.own.id));
assert.ok(move, 'the refused span offers actual closer inspection movement');
assert.equal(results[sent.indexOf(move)], undefined, 'that closer movement is an ordinary accepted command');
assert.ok(hidden.own.path.length, 'the authoritative builder actually receives a closer path');
console.log('Forty seeded native bridge repairs within sixty seconds:', { seeds: summary.length,
  maxSecondsAfterBreak: Math.max(...summary.map(row => row.secondsAfterBreak)),
  formerFailureSeeds: summary.filter(row => [11, 23, 39].includes(row.seed)) });
console.log('Watched repair cue boundaries and unseen full-span inspection passed.');
