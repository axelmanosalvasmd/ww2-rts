// Persistent preferences and remembered threats should survive repeated looks at the same situation.
import assert from 'node:assert/strict';
import { createGame, command, step } from './shared/sim.js';
import { think, plan } from './shared/ai.js';
import { viewFor } from './shared/ai-view.js';
import { perceive, startCamera } from './shared/ai-perception.js';
import { createRng } from './shared/ai-rng.js';
import { estimateSightings, optionBias, personaFor, openingBuy } from './shared/ai-persona.js';
import { runCommander } from './shared/ai-commander.js';

const map = points => ({ w: 80, h: 80, rows: Array(80).fill('.'.repeat(80)),
  spawns: [{ x: 25, y: 40 }, { x: 75, y: 40 }], points });
function fixture(points = []) {
  const g = createGame(map(points), ['AI', 'enemy'], false, [0, 1], [0, 1], { weather: false });
  g.units.clear(); g.players[0].mp = 5000;
  command(g, 0, { t: 'buy', unit: 'rifle' });
  const own = [...g.units.values()][0];
  Object.assign(own, { x: 50, z: 80, holdFire: true, auto: false, autoRetreat: false });
  g.players[0].mp = 0; g.players[0].mun = 0;
  return { g, own };
}

{
  const { g, own } = fixture(), projection = {}, state = {}, rng = createRng(27);
  const enemy = { ...structuredClone(own), id: g.nextId++, owner: 1, x: 60, z: 80 };
  g.units.set(enemy.id, enemy);
  step(g);
  const inspect = tick => {
    g.tick = tick;
    const view = perceive(viewFor(g, 0, projection), 0, state);
    return { view, sightings: estimateSightings(view, rng, 'normal', state) };
  };
  const first = inspect(1), value = first.sightings.find(s => s.id === enemy.id)?.val;
  assert.ok(value > 0, 'the estimate fixture actually sees and values an enemy');
  const initialFactor = state.estimateErrors.get(enemy.id).factor;
  const initialRng = rng.state;
  for (const tick of [2, 4, 6, 8]) {
    assert.equal(inspect(tick).sightings.find(s => s.id === enemy.id).val, value,
      'repeated inspection of unchanged health does not reroll its threat estimate');
    assert.equal(rng.state, initialRng, 'repeated inspection consumes no new estimate roll');
  }
  const home = { ...state.camera };
  Object.assign(state.camera, { x: 130, z: 130 });
  inspect(10); Object.assign(state.camera, home);
  const quickReturn = inspect(12);
  assert.equal(quickReturn.sightings.find(s => s.id === enemy.id).val, value,
    'a brief camera excursion retains the existing estimate');
  assert.equal(quickReturn.view.newEvents.filter(e => e.kind === 'screen-contact').length, 0,
    'the brief return does not manufacture a fresh contact');
  Object.assign(state.camera, { x: 130, z: 130 });
  inspect(14); enemy.hp *= .25;
  const hidden = inspect(220);
  assert.equal(hidden.sightings.find(s => s.id === enemy.id).val, value,
    'off-camera health changes do not update an already remembered threat');
  Object.assign(state.camera, home);
  const returned = inspect(224), renewed = returned.sightings.find(s => s.id === enemy.id);
  assert.ok(returned.view.newEvents.some(e => e.kind === 'screen-contact' && e.targetId === enemy.id),
    'a real camera return after ten seconds produces a new perception contact');
  assert.notEqual(rng.state, initialRng, 'the fresh contact can update the estimate');
  assert.notEqual(state.estimateErrors.get(enemy.id).factor, initialFactor,
    'the new contact renews the estimation error rather than merely scaling old health');
  assert.ok(renewed.val < value * .4, 'newly visible damage changes the remembered threat value');
  const updated = renewed.val;
  assert.equal(inspect(226).sightings.find(s => s.id === enemy.id).val, updated,
    'the reacquired estimate is stable on the next inspection');
}

{
  function rememberedTrace(damaged) {
    const { g, own } = fixture(), memory = {}, projection = {}, commands = [], knowledge = [], inputs = [];
    const enemy = { ...structuredClone(own), id: g.nextId++, owner: 1, x: 60, z: 80 };
    g.units.set(enemy.id, enemy); step(g);
    let view, home;
    for (let tick = 1; tick < 450; tick++) {
      g.tick = tick;
      if (tick === 140) { home = { ...memory.human.camera }; if (damaged) enemy.hp = 1; }
      // Supply the same operator camera pose to both commanders. Detailed enemy health changes only in one game.
      if (tick >= 140) Object.assign(memory.human.camera, tick < 380 ? { x: 130, z: 130 } : home);
      if (!view || tick % 2 === 0) view = viewFor(g, 0, projection);
      think(g, 0, { view, memory, seed: 27, inputLog: row => inputs.push(structuredClone(row)),
        submit: cmd => { commands.push({ tick, cmd: structuredClone(cmd) }); return 'blocked'; } });
      knowledge.push({ tick, sighting: structuredClone(memory.seen.get(enemy.id)) });
    }
    return { commands, knowledge, inputs };
  }
  const healthy = rememberedTrace(false), damaged = rememberedTrace(true);
  assert.ok(healthy.knowledge.some(row => row.tick < 140 && row.sighting?.val > 0),
    'default think establishes real knowledge of the threat before the camera leaves');
  assert.ok(healthy.commands.length > 0 && healthy.inputs.some(row => row.kind.startsWith('select-')),
    'the remembered-threat fixture exercises actual selection and issuing inputs');
  const hidden = rows => rows.filter(row => row.tick >= 140 && row.tick < 380);
  assert.deepEqual(hidden(damaged.knowledge), hidden(healthy.knowledge),
    'off-camera health changes cannot alter default commander knowledge of an inspected threat');
  assert.deepEqual(hidden(damaged.commands), hidden(healthy.commands),
    'off-camera health changes cannot alter the next commands from default think');
  assert.deepEqual(hidden(damaged.inputs), hidden(healthy.inputs),
    'off-camera health changes cannot alter the next physical inputs');
  assert.notDeepEqual(damaged.knowledge.filter(row => row.tick >= 400), healthy.knowledge.filter(row => row.tick >= 400),
    'returning the camera exposes the real damage and changes default commander knowledge');
}

{
  const { g } = fixture([{ x: 12, y: 40 }, { x: 37, y: 40 }]);
  const state = { pointCount: 2 }, rng = createRng(6);
  personaFor(state, createRng(27));
  const view = perceive(viewFor(g, 0, {}), 0, { camera: startCamera(viewFor(g, 0, {}), 0) });
  const objective = () => {
    const memory = { human: state, rng: createRng(27), seen: new Map(), node: new Map() }, commands = [];
    plan(view, 0, { human: true, level: 'normal', concern: { kind: 'combat', x: 50, z: 80 } }, memory,
      cmd => { commands.push(cmd); });
    assert.ok(commands.some(cmd => cmd.orders?.length), 'option preferences produce a real movement proposal');
    return memory.mind.aim.i;
  };
  const original = [...optionBias(state, rng, 'normal', 0)], roll = rng.state, chosen = objective();
  assert.deepEqual(optionBias(state, rng, 'normal', 9.9), original,
    'ordinary repeated decisions retain their option preferences for the current visit');
  assert.equal(rng.state, roll, 'the current option preference is not sampled repeatedly');
  assert.equal(objective(), chosen, 'stable preferences retain the chosen objective on equal terrain');
  assert.notDeepEqual(optionBias(state, rng, 'normal', 10), original,
    'a later visit can reconsider its option preferences');
  assert.notEqual(objective(), chosen, 'the changed preference affects the real planner objective');
}

{
  const { g, own } = fixture(), memory = {}, samples = [], inputs = [];
  g.players[0].mp = 5000;
  for (let i = 0; i < 7; i++) {
    command(g, 0, { t: 'buy', unit: 'rifle' });
    Object.assign([...g.units.values()].at(-1), { x: 48 + i, z: 80, holdFire: true, auto: false });
  }
  g.players[0].mp = 0;
  function run(from, until) {
    let view;
    for (let tick = from; tick < until; tick++) {
      g.tick = tick;
      if (!view || tick % 2 === 0) view = viewFor(g, 0, {});
      runCommander(view, 0, { tick, level: 'normal', seed: 27, inputLog: row => inputs.push(row) }, memory,
        () => 'blocked', (observed, slot, opts, mem, send) => {
          samples.push({ tick, mood: mem.human.mood, persona: structuredClone(mem.human.persona) });
          plan(observed, slot, opts, mem, send);
        });
    }
  }
  run(0, 160);
  assert.ok(samples.length >= 2 && memory.mind.roster.size === 8,
    'the mood fixture establishes a known roster through actual planner visits');
  const personality = structuredClone(memory.human.persona);
  assert.ok(samples.every(s => s.mood === 0), 'a healthy force with no VP lead starts without a mood adjustment');
  for (const unit of [...g.units.values()].filter(u => u.owner === 0 && u.id !== own.id).slice(0, 6)) g.units.delete(unit.id);
  run(160, 340);
  assert.ok(memory.mind.losses.length >= 6, 'disappeared known squads produce remembered losses');
  assert.ok(samples.some(s => s.tick >= 160 && Math.abs(s.mood - .3) < 1e-9),
    'recent losses make the planner cautious, bounded at 0.3');
  g.players[0].vp = 100; g.players[1].vp = 0; run(340, 430);
  assert.ok(samples.some(s => s.tick >= 340 && Math.abs(s.mood - .2) < 1e-9),
    'a clear VP lead adds the 0.1 greed adjustment without erasing recent losses');
  run(800, 920);
  assert.ok(samples.some(s => s.tick >= 800 && Math.abs(s.mood + .1) < 1e-9),
    'expired losses stop adding caution while the VP lead remains');
  g.players[1].vp = 100; run(920, 1030);
  assert.ok(samples.some(s => s.tick >= 920 && s.mood === 0), 'an equal opponent VP removes the greed adjustment');
  assert.ok(samples.every(s => s.mood >= -.1 && s.mood <= .3), 'mood remains bounded across losses and VP changes');
  assert.ok(samples.every(s => JSON.stringify(s.persona) === JSON.stringify(personality)),
    'loss adaptation, new attention visits and VP changes preserve the match persona');
  const view = viewFor(g, 0, {}), preferred = personality.opening[0], fallback = preferred === 'rifle' ? 'mg' : 'rifle';
  assert.equal(openingBuy({ persona: personality, buys: 0 }, view, 0, fallback, () => true), preferred,
    'an available opening purchase follows the persistent preference');
  assert.equal(openingBuy({ persona: personality, buys: 0 }, view, 0, fallback, type => type !== preferred), fallback,
    'an unavailable preferred unit yields to the legal tactical purchase');
}

console.log('Stable threat estimates, camera reacquisition, option choices, loss and VP mood, and persistent persona passed.');
