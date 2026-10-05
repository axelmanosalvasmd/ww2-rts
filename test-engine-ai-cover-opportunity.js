import assert from 'node:assert/strict';
import { cp, readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createAIcase } from './tools/ai-lab-runner.mjs';
const source = import.meta.dirname, scratch = await mkdtemp(resolve(tmpdir(), 'ai-cover-control-'));
try {
  await cp(resolve(source, 'shared'), resolve(scratch, 'shared'), { recursive: true });
  await cp(resolve(source, 'client/keys.js'), resolve(scratch, 'client/keys.js'), { recursive: true });
  await writeFile(resolve(scratch, 'package.json'), '{"type":"module"}');
  const path = resolve(scratch, 'shared/ai.js'), text = await readFile(path, 'utf8');
  const guard = ' && (!opts.human || watchedCoverNear(view, u))';
  assert.equal(text.split(guard).length, 2, 'disable exactly the reviewed cover opportunity guard for the native control');
  await writeFile(path, text.replace(guard, ''));
  const engines = await Promise.all([source, scratch].map(async root => {
    const load = name => import(pathToFileURL(resolve(root, `shared/${name}.js`)).href);
    const [sim, ai, perception, hands, view] = await Promise.all(['sim', 'ai', 'ai-perception', 'ai-hands', 'ai-view'].map(load));
    return { sim, ai, perception, hands, view };
  }));
  const scene = (kind = 'bare') => {
    const rows = Array.from({ length: 96 }, () => Array(96).fill('.'));
    if (kind === 'trench') rows[39][41] = 'T';
    if (kind === 'wall') rows[40][41] = 'K';
    return { rows: rows.map(row => row.join('')), units: [{ owner: 0, type: 'mg', x: 78, z: 79, holdFire: true },
      { owner: 1, type: 'mg', x: kind === 'wall' ? 103 : 168, z: kind === 'wall' ? 79 : 168, holdFire: true }],
      points: [{ x: 80, z: 80, owner: 0 }], camera: { x: 80, z: 79, yaw: 0 }, resources: [{ mp: 0, fuel: 0, mun: 0 }, { mp: 0, fuel: 0, mun: 0 }] };
  };
  const run = (engine, authored, seconds = 45) => createAIcase(engine, { scenario: 'guard', level: 'hard', seed: 42, seconds }, authored).advance(seconds * 20);
  const before = run(engines[1], scene()), after = run(engines[0], scene());
  const proofs = { bare: { before, after } };
  assert(before.commands.filter(row => row.command.t === 'cover' && row.rejection === 'noCover').length >= 2, 'native objective holder repeatedly pays and refuses cover on bare ground');
  assert(!after.commands.some(row => row.command.t === 'cover'), 'known bare ground causes no cover attempt or input padding');
  // Later attention can spend the saved time on other work. Measure the removed cover gestures directly.
  const refusedCover = before.commands.filter(row => row.command.t === 'cover' && row.rejection === 'noCover');
  const coverKeys = report => report.inputs.filter(input => input.kind === 'cover-key');
  const oldKeys = coverKeys(before), currentKeys = coverKeys(after);
  assert.equal(oldKeys.length, refusedCover.length, 'each repeated native refusal pays a real cover key');
  for (const receipt of refusedCover) {
    const input = oldKeys.find(input => input.tick === receipt.tick);
    assert.deepEqual(input?.command, receipt.command, 'the actual paid key submits the refused native command');
    assert(input.motorTicks > 0 && input.tick >= input.inputStartedTick + input.motorTicks, 'the refusal follows its complete real motor delay');
    assert(receipt.command.ids.every(id => receipt.selected.includes(id)), 'the refused cover actor was physically selected');
  }
  const coverSelections = report => report.inputs.filter(input => input.kind.startsWith('select-')
    && coverKeys(report).some(key => key.queuedTick === input.queuedTick && key.ids.some(id => input.ids?.includes(id))));
  assert(coverSelections(before).length > 0, 'the refusal control also pays for its actual initial cover selection');
  assert.equal(currentKeys.length, 0, 'bare ground removes every repeated paid cover key');
  assert.equal(coverSelections(after).length, 0, 'bare ground needs no selection for an impossible cover gesture');
  for (const kind of ['trench', 'wall']) {
    const old = run(engines[1], scene(kind)), current = run(engines[0], scene(kind));
    proofs[kind] = { before: old, after: current };
    assert.deepEqual(current.inputs, old.inputs, `${kind}: retain the complete paid physical timeline`);
    assert.deepEqual(current.commands, old.commands, `${kind}: retain authoritative command receipts`);
    if (kind === 'trench') assert(current.commands.some(row => row.command.t === 'cover' && row.accepted), 'real nearby trench remains usable');
    for (const receipt of current.commands.filter(row => row.command.t === 'cover')) {
      const input = current.inputs.find(row => row.tick === receipt.tick && row.command?.t === 'cover');
      assert(input?.motorTicks > 0 && input.tick >= input.inputStartedTick + input.motorTicks, 'cover receipt follows its full real paid key');
    }
    if (kind === 'trench') assert(current.frames.some(frame => frame.units.some(unit => unit.owner === 0 && unit.cover > 0)), 'the unit actually gains trench cover in native engine state');
  }
  // This authored mutation is fog-visible from the squad but outside its camera. The original map
  // remains bare, so this specifically tests the camera tier rather than changing public map knowledge.
  const hiddenScene = scene(); hiddenScene.units[0].x = 116; hiddenScene.points[0] = { x: 116, z: 80, owner: 0 };
  let deliveredDynamicTrench = false;
  const hidden = engine => ({ ...engine, view: { ...engine.view, viewFor(...args) {
    const observation = engine.view.viewFor(...args);
    if (observation.chars[39 * observation.w + 61] === 'T') deliveredDynamicTrench = true;
    return observation;
  } }, sim: { ...engine.sim, createGame(...args) {
    const game = engine.sim.createGame(...args); assert(engine.sim.mutateWorldCell(game, 39 * game.w + 61, { object: 'T' }), 'authored dynamic trench is a real engine mutation'); return game;
  } } });
  const plain = run(engines[0], hiddenScene, 12), unseen = run(hidden(engines[0]), hiddenScene, 12);
  assert(deliveredDynamicTrench, 'the real fog-visible terrain update is delivered, so this probes the camera boundary');
  assert(!engines[0].perception.onScreen({ x: 123, z: 79 }, hiddenScene.camera), 'changed cover lies outside the actual camera');
  assert(unseen.frames[0].units.some(unit => unit.owner === 0), 'the actor itself is physically on screen');
  assert.deepEqual(unseen.inputs, plain.inputs, 'unwatched dynamic cover cannot change actual paid inputs');
  assert.deepEqual(unseen.commands, plain.commands, 'unwatched dynamic cover cannot change native orders');
  const watchedScene = structuredClone(hiddenScene); watchedScene.camera.x = 116;
  const watched = run(hidden(engines[0]), watchedScene, 12);
  assert(watched.commands.some(row => row.command.t === 'cover' && row.accepted), 'moving the authored camera onto the same changed terrain exposes a real usable opportunity');
  proofs.hidden = { scene: hiddenScene, plain, unseen }; proofs.watched = { scene: watchedScene, watched };
  if (process.env.AI_COVER_PROOF) await writeFile(process.env.AI_COVER_PROOF, JSON.stringify(proofs));
  console.log(`Cover opportunity: native bare refusal loop ${before.commands.filter(row => row.rejection === 'noCover').length}->0, legal trench and combat-wall control, hidden terrain and full physical timelines PASS`);
} finally { await rm(scratch, { recursive: true, force: true }); }
