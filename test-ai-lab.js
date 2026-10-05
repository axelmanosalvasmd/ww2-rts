import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { runAiLab } from './tools/ai-lab-node.mjs';
import { createAIcase, defaultScene } from './tools/ai-lab-runner.mjs';
import { serveAiLab } from './tools/ai-lab-server.mjs';
const start = performance.now(), root = process.env.AI_LAB_ROOT ?? import.meta.dirname;
const common = { root, level: 'hard', seed: 42, seconds: 20 };
const guard = await runAiLab({ ...common, scenario: 'guard' });
assert.deepEqual(await runAiLab({ ...common, scenario: 'guard' }), guard, 'same source and seed reproduce the complete native trace');
assert(guard.events.some(event => event.kind === 'screen-contact'));
assert(guard.commands.some(row => row.accepted && row.command.t === 'ability'), 'guard has a genuinely useful grenade order');
assert(!guard.commands.some(row => row.accepted && ['move', 'amove', 'attack', 'retreat'].includes(row.command.t)), 'static objective guard does not abandon its point');
// A visible wall offers a plausible cover opportunity. With no seen or recent threat, the
// native key cannot choose a protected side or an improving spot and legitimately refuses.
const refusalRows = Array.from({ length: 96 }, () => Array(96).fill('.'));
refusalRows[40][41] = 'K';
const refusal = await runAiLab({ ...common, scenario: 'guard', seconds: 8, scene: {
  rows: refusalRows.map(row => row.join('')), units: [{ owner: 0, type: 'mg', x: 78, z: 79, holdFire: true },
    { owner: 1, type: 'mg', x: 168, z: 168, holdFire: true }], points: [{ x: 80, z: 80, owner: 0 }],
  camera: { x: 80, z: 79, yaw: 0 }, resources: [{ mp: 0, fuel: 0, mun: 0 }, { mp: 0, fuel: 0, mun: 0 }],
} });
assert(refusal.commands.some(row => row.command.t === 'cover' && !row.accepted && row.rejection === 'noCover'), 'real native refusal receipts are retained');
for (const report of [guard, refusal]) {
  for (const command of report.commands) {
    const completion = report.inputs.find(input => input.tick === command.tick && JSON.stringify(input.command) === JSON.stringify(command.command));
    assert(completion, 'every native receipt follows an actual physical completion');
    assert(completion.motorTicks >= 1 && command.tick >= completion.inputStartedTick + completion.motorTicks, 'full paid motor time precedes the native receipt');
    assert(report.inputStarts.some(row => row.tick === completion.inputStartedTick && row.kind === completion.kind), 'the matching physical gesture start is recorded');
  }
  assert.equal(new Set(report.commands.map(row => row.tick)).size, report.commands.length, 'at most one native command per tick');
}
const hiddenA = await runAiLab({ ...common, scenario: 'guard', probeOnly: true, probeType: 'rifle', probeHP: 100, probeOnScreen: false });
const hiddenB = await runAiLab({ ...common, scenario: 'guard', probeOnly: true, probeType: 'mg', probeHP: 40, probeOnScreen: false });
assert(hiddenA.inputs.length && hiddenA.commands.length, 'privacy comparison has real activity');
assert.deepEqual(hiddenA.inputs, hiddenB.inputs, 'unseen enemy HP/type cannot change the actual physical inputs');
assert.deepEqual(hiddenA.commands, hiddenB.commands, 'unseen enemy HP/type cannot change the native orders');
const seenA = await runAiLab({ ...common, scenario: 'guard', probeOnly: true, probeType: 'rifle', probeHP: 100, probeOnScreen: true });
const seenB = await runAiLab({ ...common, scenario: 'guard', probeOnly: true, probeType: 'mg', probeHP: 40, probeOnScreen: true });
assert.notDeepEqual(seenA.commands, seenB.commands, 'the same perturbation changes native behavior when actually visible');
function observerScene(type, hp) {
  const scene = defaultScene({ scenario: 'guard' }); scene.units = scene.units.filter(unit => unit.owner === 0);
  const rows = Array.from({ length: 96 }, () => Array(96).fill('.')); rows[40][41] = 'T';
  scene.rows = rows.map(row => row.join('')); // Real shelter gives the watched guard useful work before inspecting the remote contact.
  scene.units.push({ owner: 0, type: 'rifle', x: 132, z: 79, holdFire: true });
  scene.units.push({ owner: 1, type, hp, x: 145, z: 79, holdFire: true }); return scene;
}
const mapOnlyA = await runAiLab({ ...common, scenario: 'guard', scene: observerScene('rifle', 100) });
const mapOnlyB = await runAiLab({ ...common, scenario: 'guard', scene: observerScene('mg', 40) });
assert(mapOnlyA.frames[0].minimap.some(dot => dot.owner === 1), 'allied offcamera observer reveals a real enemy minimap dot');
assert(!mapOnlyA.frames[0].units.some(unit => unit.owner === 1), 'that enemy is outside camera detail');
assert.deepEqual(mapOnlyA.frames[0].minimap, mapOnlyB.frames[0].minimap, 'minimap never exposes enemy type/HP/identity');
const revealTick = Math.min(...[mapOnlyA, mapOnlyB].map(report => report.frames.find(frame => frame.units.some(unit => unit.owner === 1)).tick));
const beforeReveal = rows => rows.filter(row => row.tick < revealTick);
assert(beforeReveal(mapOnlyA.commands).some(row => row.accepted), 'minimap-only comparison contains a real accepted native operation');
assert.deepEqual(beforeReveal(mapOnlyA.inputs), beforeReveal(mapOnlyB.inputs), 'minimap-only HP/type leaves paid inputs unchanged before actual camera inspection');
assert.deepEqual(beforeReveal(mapOnlyA.commands), beforeReveal(mapOnlyB.commands));
assert.notDeepEqual(mapOnlyA.commands, mapOnlyB.commands, 'camera arrival legitimately unlocks the detail-dependent response');
const contact = await runAiLab({ ...common, scenario: 'contact-threat' });
assert(contact.events.some(event => event.kind === 'screen-contact') && contact.commands.some(row => row.accepted), 'contact produces a delivered cue and native response');
const armorOptions = { ...common, scenario: 'armor-pressure', seed: 1, seconds: 30 };
const armor = await runAiLab(armorOptions), armorScene = defaultScene(armorOptions);
assert(armorScene.units.filter(unit => unit.owner === 0).every(unit => unit.holdFire === undefined && unit.cooldown === undefined), 'ordinary rifles use native firing and cooldown defaults');
assert(armorScene.cues.every(cue => cue.kind === 'weapon-release'), 'preset schedules only an actual opponent stance, never health subtraction or a synthetic hurt cue');
const armorDamage = armor.events.find(event => event.kind === 'screen-damage' && event.observedDanger?.lossShare >= .25);
assert.equal(armorDamage?.tick, 244, 'real medium projectile arrives after its scheduled native firing release');
const armorBefore = armor.frames.find(frame => frame.tick === 242), armorAtHit = armor.frames.find(frame => frame.tick === armorDamage.tick);
const armorVictim = frame => frame.units.find(unit => unit.id === armorDamage.unitId);
assert.equal(armorVictim(armorBefore).hp - armorVictim(armorAtHit).hp, 35, 'public damage is the actual native medium hit');
assert.equal(armorVictim(armorAtHit).holdFire, false, 'rifle fires ordinarily');
assert.ok(armorVictim(armorAtHit).targetId, 'native automatic targeting remains active when armor hits');
const armorRetreat = armor.commands.find(row => row.accepted && row.command.t === 'retreat' && row.command.ids.includes(armorDamage.unitId) && row.tick >= armorDamage.tick);
assert(armorRetreat, 'default human commander protects the damaged ordinary rifle through a real accepted retreat');
const armorPaid = armor.inputs.filter(row => row.tick >= armorDamage.tick && row.tick <= armorRetreat.tick);
assert(armorPaid.some(row => row.kind.startsWith('select-')) && armorPaid.some(row => row.input?.code === 'KeyR'), 'preset pays actual selection and retreat key');
assert(armorPaid.every(row => Number.isSafeInteger(row.inputStartedTick) && row.tick >= row.inputStartedTick + row.motorTicks), 'preset preserves full motor durations');
assert(armorPaid[0].tick >= armorDamage.tick + 4, 'preset preserves the ordinary causal floor');
const unseen = await runAiLab({ ...common, scenario: 'unseen-heavy-hit', seconds: 10 });
const damage = unseen.events.find(event => event.kind === 'screen-damage');
assert(damage, 'offcamera opponent deals real engine damage');
assert(!unseen.frames.find(frame => frame.tick >= damage.tick)?.units.some(unit => unit.owner === 1), 'shooter is outside the actual camera when the first hurt is delivered');
assert(unseen.frames.some(frame => frame.units.some(unit => unit.owner === 0 && unit.hp < 100)), 'hurt event corresponds to real loss of health');
const hold = await runAiLab({ ...common, scenario: 'hold' });
assert(hold.frames.every(frame => frame.units.filter(unit => unit.owner === 0).every(unit => unit.holdPos)), 'explicit hold remains enabled');
assert(!hold.commands.some(row => row.accepted && ['move', 'amove', 'retreat'].includes(row.command.t)));
const retreat = await runAiLab({ ...common, scenario: 'automatic-retreat' });
assert(retreat.frames[0].units.some(unit => unit.owner === 0 && unit.retreating), 'engine automatic retreat already starts before a commander order');
assert(!retreat.commands.some(row => row.command.t === 'retreat'), 'commander does not manufacture a manual retreat receipt');
const load = name => import(pathToFileURL(resolve(root, `shared/${name}.js`)).href);
const [sim, ai, perception, hands, view] = await Promise.all(['sim', 'ai', 'ai-perception', 'ai-hands', 'ai-view'].map(load));
const engine = { sim, ai, perception, hands, view }, options = { scenario: 'guard', level: 'hard', seed: 42 }, scene = defaultScene(options);
const lab = createAIcase(engine, options, scene);
lab.advance(1); lab.advance(199); const split = lab.advance(200);
assert.deepEqual(split.inputs, guard.inputs, 'incremental browser stepping shares the exact CLI physical sequence');
assert.deepEqual(split.commands, guard.commands);
const armorBrowser = createAIcase(engine, armorOptions, defaultScene(armorOptions));
armorBrowser.advance(200); const armorSplit = armorBrowser.advance(400);
for (const field of ['events', 'inputStarts', 'inputs', 'commands']) assert.deepEqual(armorSplit[field], armor[field], 'built-in browser stepping retains the CLI armor trace: ' + field);
const beforeCallerEdit = lab.authorView().units[0].x;
scene.units[0].x = 50;
assert.equal(lab.authorView().units[0].x, beforeCallerEdit, 'editing a caller graph cannot silently mutate a running case');
const reset = createAIcase(engine, options, scene);
assert.equal(reset.tick, 0); assert.equal(reset.record().inputs.length, 0); assert.equal(reset.authorView().units[0].x, 50, 'new authored scene resets history');
assert.throws(() => createAIcase(engine, options, { ...scene, units: [{ ...scene.units[0], hp: 100000 }] }), /between/);
const hitScene = defaultScene({ scenario: 'guard' }); hitScene.units = hitScene.units.filter(unit => unit.owner === 0); hitScene.cues = [{ kind: 'hit', tick: 10, unitId: reset.authorView().units[0].id, damage: 30 }];
const hitLab = createAIcase(engine, options, hitScene); const hit = hitLab.advance(20);
assert(hit.events.some(event => event.kind === 'screen-damage'), 'explicit author hit enters normal view/perception pipeline');
assert(hit.fixture.authorEdits.some(row => row.includes('Authored hit')), 'injected stimulus stays explicitly labeled');
assert.throws(() => hitLab.advance(1201), /Advance/);
const server = await serveAiLab({ root, port: 0 });
try {
  const base = `http://127.0.0.1:${server.address().port}`;
  const page = await fetch(base + '/'); assert.equal(page.status, 200); assert((await page.text()).includes('+60 seconds'));
  const module = await fetch(base + '/tools/ai-lab-runner.mjs'); assert.match(module.headers.get('content-type'), /javascript/); assert.equal(module.status, 200);
  assert.equal((await fetch(base + '/shared/sim.js')).status, 200);
  assert.equal((await fetch(base + '/client/keys.js')).status, 200);
  assert.equal((await fetch(base + '/client/main.js')).status, 404);
  assert.equal((await fetch(base + '/tools/ai-lab-node.mjs')).status, 404);
  assert.equal((await fetch(base + '/shared/%2e%2e%2fpackage.json.js')).status, 404);
  assert.equal((await fetch(base + '/', { method: 'POST' })).status, 405);
} finally { await new Promise(resolve => server.close(resolve)); }
assert(!(await readFile(new URL('./tools/ai-lab-runner.mjs', import.meta.url), 'utf8')).includes('node:'), 'shared runner is browser-neutral');
console.log(`AI lab: deterministic native scenes, privacy, physical causality, edits/reset, cue delivery and static server PASS (${(performance.now() - start).toFixed(1)}ms)`);
