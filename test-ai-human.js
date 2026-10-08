// The human-like commander (shared/ai-human.js): human pace, one command per tick, a camera it must use, and
// timed answers to damage alerts.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { playMatch } from './shared/ai-schedule.js';
import { HUMAN_SKILLS, SCREEN } from './shared/ai-human.js';
import { runDrill } from './drills/drill.js';
import * as flank from './drills/flank-answer.js';

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

// A hit on two squads (drills/flank-answer.js): on screen the commander answers after its reaction time and sends the
// squads at the attacker; off screen it notices later and answers by moving the camera onto the fight.
for (const level of ['easy', 'normal', 'hard']) {
  const seen = runDrill(flank, { level, seed: 3 });
  assert.ok(seen.alerted && seen.onScreen && seen.answered, `${level}: the hit in view is an on-screen alert and is answered`);
  assert.ok(seen.seconds >= 0.2, `${level}: no answer under 0.2 s`);
  assert.ok(seen.attackedFoe, `${level}: the squads are sent at the enemy that fired`);
}
for (const level of ['easy', 'hard']) {
  const away = runDrill(flank, { level, seed: 3, params: { offScreen: true } });
  assert.ok(away.alerted && away.onScreen === false && away.answered, `${level}: the hit out of view is an off-screen alert and is answered`);
  assert.equal(away.firstInput, 'camera', `${level}: the answer starts with a camera move`);
  assert.ok(away.cameraOnFight, `${level}: the camera moves onto the fight`);
  assert.ok(away.seconds >= 0.2, `${level}: no answer under 0.2 s`);
}
{
  const median = level => { const t = [1, 2, 3, 4, 5].map(seed => runDrill(flank, { level, seed, params: { offScreen: true } }).seconds).sort((a, b) => a - b); return t[2]; };
  assert.ok(median('hard') < median('easy'), 'Hard notices an off-screen alert sooner than Easy');
}

console.log('human commander: pace, input caps, camera use, determinism and alert answers passed');
