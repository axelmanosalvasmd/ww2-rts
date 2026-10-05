import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createAIcase } from './tools/ai-lab-runner.mjs';
const source = import.meta.dirname, scratch = await mkdtemp(resolve(tmpdir(), 'ai-fort-cover-control-'));
try {
  await cp(resolve(source, 'shared'), resolve(scratch, 'shared'), { recursive: true });
  await cp(resolve(source, 'client/keys.js'), resolve(scratch, 'client/keys.js'), { recursive: true });
  await writeFile(resolve(scratch, 'package.json'), '{"type":"module"}');
  const path = resolve(scratch, 'shared/ai-commander.js'), text = await readFile(path, 'utf8');
  const guard = "\n    || cmd.t === 'cover' && ['dig', 'entrench'].includes(entry.t) && entry.ids.some(id => idsOf(cmd).includes(id))";
  assert.equal(text.split(guard).length, 2, 'disable exactly the accepted fortification receipt guard for the native control');
  await writeFile(path, text.replace(guard, ''));
  const engines = await Promise.all([scratch, source].map(async root => {
    const load = name => import(pathToFileURL(resolve(root, `shared/${name}.js`)).href);
    const [sim, ai, perception, hands, view] = await Promise.all(['sim', 'ai', 'ai-perception', 'ai-hands', 'ai-view'].map(load));
    return { sim, ai, perception, hands, view };
  }));
  const scene = mp => {
    const rows = Array.from({ length: 96 }, () => Array(96).fill('.')); rows[39][41] = 'T';
    return { rows: rows.map(row => row.join('')), units: [{ owner: 0, type: 'rifle', x: 78, z: 79, holdFire: true },
      { owner: 1, type: 'mg', x: 168, z: 168, holdFire: true }], points: [{ x: 80, z: 80, owner: 0 }],
      camera: { x: 80, z: 79, yaw: 0 }, resources: [{ mp, fuel: 0, mun: 0 }, { mp: 0, fuel: 0, mun: 0 }] };
  };
  function run(engine, authored, options = {}) {
    const states = [], wrapped = { ...engine, ai: { ...engine.ai, think(game, slot, opts) {
      engine.ai.think(game, slot, opts);
      const own = [...game.units.values()].filter(unit => unit.owner === slot);
      states.push({ tick: game.tick, trenches: [...game.chars].filter(ch => ch === 'T').length,
        units: own.map(unit => ({ id: unit.id, dig: !!unit.dig, entrench: !!unit.entrench, retreating: unit.retreating })),
        viewTick: opts.memory.human.view?.tick,
        publicUnits: [...(opts.memory.human.view?.units.values() ?? [])].filter(unit => unit.owner === slot).map(unit => ({ id: unit.id, dig: !!unit.dig, entrench: !!unit.entrench })),
        queued: opts.memory.human.hands.queue.filter(job => job.command).map(job => ({ command: structuredClone(job.command), queuedTick: job.queuedTick })) });
    } } };
    const lab = createAIcase(wrapped, { scenario: 'guard', level: 'hard', seed: 1, seconds: 20, ...options }, authored);
    return { report: lab.advance((options.seconds ?? 20) * 20), states, end: lab.authorView() };
  }
  const before = run(engines[0], scene(90)), after = run(engines[1], scene(90));
  const fort = before.report.commands.find(row => row.accepted && row.command.t === 'entrench');
  assert(fort, 'native default planner accepts real unfinished entrench work');
  assert.deepEqual(after.report.commands.filter(row => row.tick <= fort.tick), before.report.commands.filter(row => row.tick <= fort.tick), 'complete native command prefix through the actual accepted fortification is unchanged');
  assert.deepEqual(after.report.inputs.filter(row => row.tick <= fort.tick), before.report.inputs.filter(row => row.tick <= fort.tick), 'complete paid physical prefix through the actual accepted fortification is unchanged');
  const actor = fort.command.ids[0], cover = before.report.commands.find(row => row.accepted && row.command.t === 'cover' && row.tick > fort.tick && row.command.ids.includes(actor));
  assert(cover, 'native stale cross-type follow-up actually reaches existing cover');
  const beforeCover = before.states.find(row => row.tick === cover.tick - 1), atCover = before.states.find(row => row.tick === cover.tick);
  assert(beforeCover.units.find(unit => unit.id === actor).entrench && !atCover.units.find(unit => unit.id === actor).entrench, 'actual cover command cancels unfinished native work');
  const queued = before.states.find(row => row.queued.some(job => job.command.t === 'cover'));
  assert(queued.viewTick <= fort.tick && !queued.publicUnits.find(unit => unit.id === actor).entrench, 'follow-up was planned from the pre-receipt delivered snapshot');
  assert(before.states.some(row => row.tick > queued.tick && row.tick < cover.tick && row.publicUnits.some(unit => unit.id === actor && unit.entrench)), 'later real delivery shows the work after the stale cover was already queued');
  assert(!after.report.commands.some(row => row.command.t === 'cover' && row.command.ids.includes(actor)), 'receipt guard prevents that actor cancelling its own unfinished work');
  assert(after.states.at(-1).trenches > before.states.at(-1).trenches, 'preserved native project actually builds more trench cells');
  assert(after.states.find(row => row.tick === cover.tick).units.find(unit => unit.id === actor).entrench, 'same native deadline retains the unfinished project');
  for (const row of after.report.inputs) assert(row.tick >= row.inputStartedTick + row.motorTicks, 'all executed physical gestures pay their original full motor');
  const idleBefore = run(engines[0], scene(0)), idleAfter = run(engines[1], scene(0));
  assert(idleAfter.report.commands.some(row => row.command.t === 'cover' && row.accepted), 'idle actor still takes real nearby cover');
  assert.deepEqual(idleAfter, idleBefore, 'idle useful-cover full native scene remains unchanged');
  const heavy = [];
  for (const level of ['easy', 'normal', 'hard']) {
    const old = run(engines[0], null, { scenario: 'armor-pressure', level, seconds: 30 });
    const current = run(engines[1], null, { scenario: 'armor-pressure', level, seconds: 30 });
    assert(current.report.commands.some(row => row.command.t === 'retreat' && row.accepted), `${level}: actual watched heavy armor hit still receives paid useful protection`);
    assert.deepEqual(current, old, `${level}: full heavy-hit native scene is unchanged by the cover-only receipt guard`);
    heavy.push({ level, before: old, after: current });
  }
  if (process.env.AI_FORT_COVER_PROOF) await writeFile(process.env.AI_FORT_COVER_PROOF, JSON.stringify({ before, after, idleBefore, idleAfter, heavy }));
  console.log(`Accepted fortification cover: native accepted work ${fort.tick}, stale cover cancellation ${cover.tick} prevented, real trench completion, unchanged idle cover and E/N/H paid heavy-hit scenes PASS`);
} finally { await rm(scratch, { recursive: true, force: true }); }
