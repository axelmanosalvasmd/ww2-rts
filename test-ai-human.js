// The human-like commander (shared/ai-human.js): human pace, one command per tick, a camera it must use, and
// timed answers to damage alerts.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGame, step, snapshotCache, UNITS } from './shared/sim.js';
import { playMatch } from './shared/ai-schedule.js';
import { observe } from './shared/ai.js';
import { tickCommander, commanderCamera, HUMAN_SKILLS, SCREEN } from './shared/ai-human.js';

const seeded = seed => () => { let t = seed += 0x6D2B79F5; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const onScreen = (camera, at) => Math.abs(at.x - camera.x) <= SCREEN.x && Math.abs(at.z - camera.z) <= SCREEN.z;

// Plays all seats as commanders on the server's schedule (shared/ai-schedule.js).
function play(map, level, ticks, seed, record) {
  const seats = [0, 1, 2].map(slot => ({ slot, level, options: { onInput: input => record(slot, input) } }));
  return playMatch({ map, names: ['A', 'B', 'C'], teams: [0, 1, 2], factions: [0, 1, 2], options: { mode: 'conquest' }, seats, seed, maxTicks: ticks });
}

// Pace, input caps, camera use and determinism over three minutes of a real Conquest match, at every level.
for (const level of ['easy', 'normal', 'hard']) {
  const logs = [];
  const map = JSON.parse(readFileSync('maps/default.json', 'utf8'));
  for (let run = 0; run < 2; run++) {
    const log = [];
    play(map, level, 3 * 60 * 20, 7, (slot, input) => log.push({ slot, ...input }));
    logs.push(log);
  }
  const [log] = logs, skill = HUMAN_SKILLS[level];
  assert.deepEqual(logs[1].map(i => [i.slot, i.tick, i.kind]), log.map(i => [i.slot, i.tick, i.kind]), `${level}: same seed, same inputs`);
  for (const slot of [0, 1, 2]) {
    const mine = log.filter(i => i.slot === slot), orders = mine.filter(i => i.cmd);
    const first = orders.find(i => i.accepted);
    assert.ok(first, `${level} seat ${slot} gives an accepted order`);
    assert.ok(first.tick >= skill.opening * 0.5 * 20, `${level} seat ${slot} looks before its first order (${first.tick / 20} s)`);
    const perTick = new Map();
    for (const i of mine) perTick.set(i.tick, (perTick.get(i.tick) ?? 0) + 1);
    assert.ok(Math.max(...perTick.values()) <= 1, `${level} seat ${slot}: at most one input, so one command, per tick`);
    for (let k = 0; k < mine.length; k++) {
      const tenSeconds = mine.filter(i => i.tick > mine[k].tick - 200 && i.tick <= mine[k].tick).length;
      assert.ok(tenSeconds <= skill.peak, `${level} seat ${slot}: ${tenSeconds} inputs in 10 s exceeds ${skill.peak}`);
    }
    for (const i of mine) {
      if (i.kind === 'select') assert.ok(onScreen(i.camera, i), `${level}: selects only units on its screen`);
      if (i.cmd && !['move', 'amove'].includes(i.cmd.t) && Number.isFinite(i.cmd.x)) assert.ok(onScreen(i.camera, i.cmd), `${level}: ${i.cmd.t} placed on its screen`);
    }
  }
}

// A small fight: two own squads at (190, 200) and an enemy squad next to them, all holding fire, and a hit on the first
// squad. Holding fire keeps the squads from answering by themselves, so only the commander can.
function skirmish() {
  const map = { w: 160, h: 160, rows: Array(160).fill('.'.repeat(160)), heights: Array(160).fill('0'.repeat(160)), spawns: [{ x: 20, y: 20 }, { x: 140, y: 140 }], points: [] };
  const g = createGame(map, ['AI', 'enemy'], true, [0, 1], [0, 1], { weather: false });
  const squads = owner => [...g.units.values()].filter(u => u.owner === owner && UNITS[u.type].infantry && UNITS[u.type].w);
  const [a, b] = squads(0), [foe] = squads(1);
  for (const id of g.units.keys()) if (![a.id, b.id, foe.id].includes(id)) g.units.delete(id);
  return { g, a, b, foe };
}
function answer(level, cameraOnFight) {
  const random = Math.random;
  Math.random = seeded(3);
  try {
    const f = skirmish(), inputs = [], alerts = [], view = () => observe(f.g, 0, snapshotCache(f.g));
    let v = view();
    // Let the opening look pass, then park the camera.
    for (let n = 0; n < 200; n++) { step(f.g); if (f.g.tick % 2 === 0) v = view(); tickCommander(f.g, 0, { view: v, level }); f.g.shots = []; }
    for (const [u, x, z] of [[f.a, 190, 200], [f.b, 196, 204], [f.foe, 205, 215]]) Object.assign(u, { x, z, path: [], targetId: 0, holdFire: true });
    Object.assign(commanderCamera(f.g, 0), cameraOnFight ? { x: 195, z: 205 } : { x: 40, z: 40 });
    f.g.shots = [{ k: 'hurt', t: f.a.id, fo: 1, to: 0, x: f.a.x, z: f.a.z, kill: false }];
    const start = f.g.tick;
    for (let n = 0; n < 200; n++) {
      if (n) step(f.g);
      if (f.g.tick % 2 === 0) v = view();
      tickCommander(f.g, 0, { view: v, level, onInput: i => inputs.push(i), onAlert: a => alerts.push(a) });
      if (n) f.g.shots = [];
    }
    return { f, start, inputs, alert: alerts[0] };
  } finally { Math.random = random; }
}

// On screen: the commander sees the fight and answers after its reaction time, sending idle squads at the enemy.
for (const level of ['easy', 'normal', 'hard']) {
  const { f, start, inputs, alert } = answer(level, true);
  assert.ok(alert?.onScreen, `${level}: damage in view is an on-screen alert`);
  assert.ok(alert.answered !== null, `${level}: the fight in view is answered`);
  assert.ok(alert.answered - start >= 4, `${level}: no answer under 0.2 s`);
  assert.ok(inputs.some(i => i.cmd?.t === 'attack' && i.cmd.target === f.foe.id && i.accepted), `${level}: idle squads are sent at the enemy that fired`);
}

// Off screen: the alert is noticed later and answered by moving the camera to it first.
for (const level of ['easy', 'hard']) {
  const { start, inputs, alert } = answer(level, false);
  assert.equal(alert?.onScreen, false, `${level}: damage out of view is an off-screen alert`);
  assert.ok(alert.answered !== null, `${level}: the off-screen alert is answered`);
  const first = inputs.find(i => i.tick === alert.answered);
  assert.equal(first.kind, 'camera', `${level}: the answer starts with a camera move`);
  assert.ok(onScreen(first.camera, alert), `${level}: the camera moves onto the fight`);
  assert.ok(alert.answered - start >= 4, `${level}: no answer under 0.2 s`);
}
{
  const easy = answer('easy', false), hard = answer('hard', false);
  assert.ok(hard.alert.answered - hard.start < easy.alert.answered - easy.start, 'Hard notices an off-screen alert sooner than Easy');
}

console.log('human commander: pace, input caps, camera use, determinism and alert answers passed');
