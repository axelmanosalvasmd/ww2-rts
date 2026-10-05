// Real matches must not use private grading labels to choose their next input.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createGame, command, step } from './shared/sim.js';
import { think } from './shared/ai.js';
import { viewFor } from './shared/ai-view.js';
import { perceive, cameraFootprint, onScreen, HUMAN_CAMERA } from './shared/ai-perception.js';
import { cameraTravelMode } from './shared/ai-commander.js';
import { chooseConcern } from './shared/ai-attention.js';
import { createHands, queueCamera, advanceHands } from './shared/ai-hands.js';

const diagnosticKeys = new Set(['responseRequired', 'responseReason', 'responsePolicy', 'responseUnits']);
const sources = ['shared/sim.js', 'shared/ai.js', 'shared/ai-attention.js', 'shared/ai-commander.js',
  'shared/ai-hands.js', 'shared/ai-perception.js', 'shared/ai-priority.js'];
const hash = value => createHash('sha256').update(value).digest('hex');
const checkpoint = () => Object.fromEntries(sources.map(path => [path, hash(readFileSync(new URL(path, import.meta.url)))]));
function clean(value) {
  if (value === undefined) return null;
  if (!value || typeof value !== 'object') return value;
  if (value instanceof Map) return [...value].map(([key, item]) => [key, clean(item)]);
  if (value instanceof Set) return [...value];
  if (Array.isArray(value)) return value.map(clean);
  return Object.fromEntries(Object.entries(value).filter(([key]) => !diagnosticKeys.has(key))
    .map(([key, item]) => [key, clean(item)]));
}
function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    let next = value += 0x6D2B79F5;
    next = Math.imul(next ^ next >>> 15, next | 1);
    next ^= next + Math.imul(next ^ next >>> 7, next | 61);
    return ((next ^ next >>> 14) >>> 0) / 4294967296;
  };
}

if (process.argv.includes('--diagnostic-worker')) {
  let current;
  globalThis.__aiBehaviorLabels = (view, state, slot) => {
    const unique = new Set([...(state.events ?? []), ...(view.events ?? []), ...(view.newEvents ?? [])]);
    for (const event of unique) {
      if (current.mode === 'absent') {
        for (const key of diagnosticKeys) assert.equal(Object.hasOwn(event, key), false,
          `public ${event.kind} event must omit private ${key}`);
      } else if (current.mode === 'stripped') {
        for (const key of diagnosticKeys) delete event[key];
      } else {
        Object.assign(event, current.mode === 'toggled'
          ? { responseRequired: !((view.tick + slot) % 4), responseReason: 'counterfactual',
            responsePolicy: 'screen-v1', responseUnits: view.tick % 4 ? [] : [999999] }
          : { responseRequired: { fabricated: true }, responseReason: ['invalid', 999],
            responsePolicy: null, responseUnits: 'not-an-actor-list' });
        current.modified++;
      }
    }
    for (const event of view.newEvents ?? []) current.events.push({ slot, ...clean(event) });
  };
  globalThis.__aiBehaviorProposal = (slot, tick, concern, cmd, result) => {
    current.choices.push(clean({ slot, tick, concern, command: cmd, result }));
  };
  function replay(level, mode) {
    const originalRandom = Math.random;
    Math.random = seededRandom(7331);
    current = { mode, modified: 0, inputs: [], commands: [], events: [], choices: [], clocks: [] };
    try {
      const map = JSON.parse(readFileSync(new URL('./maps/default.json', import.meta.url)));
      const game = createGame(map, ['AI 0', 'AI 1', 'AI 2'], true, [0, 1, 2], [0, 1, 2], { weather: false });
      const memories = game.players.map(() => ({})), projection = game.players.map(() => ({}));
      let delivered = game.players.map((_, slot) => viewFor(game, slot, projection[slot]));
      for (let tick = 0; tick < 1200; tick++) {
        step(game);
        assert.equal(game.winner, null, 'the native comparison must cover the full sixty seconds');
        if (!(game.tick % 2)) delivered = game.players.map((_, slot) => viewFor(game, slot, projection[slot]));
        game.players.forEach((player, slot) => {
          think(game, slot, { level, seed: 7331, memory: memories[slot], view: delivered[slot],
            inputLog: entry => current.inputs.push({ slot, ...clean(entry) }), submit: cmd => {
              const resourcesBefore = { mp: player.mp, mun: player.mun, fuel: player.fuel };
              const result = command(game, slot, cmd);
              current.commands.push(clean({ slot, tick: game.tick, command: cmd, result, resourcesBefore,
                resourcesAfter: { mp: player.mp, mun: player.mun, fuel: player.fuel } }));
              return result;
            } });
          const state = memories[slot].human, hands = state?.hands;
          current.clocks.push(clean({ tick: game.tick, slot, camera: state?.camera, concern: state?.concern,
            attention: state?.attention, cycle: state?.cycle, planned: state?.planned,
            deliberateUntil: state?.deliberateUntil, decisionStartedTick: state?.decisionStartedTick,
            noWorkUntil: state?.noWorkUntil, cameraVisit: state?.cameraVisit, pendingInspection: state?.pendingInspection,
            answeredEvents: state?.answeredEvents, selected: hands?.selected, rng: hands?.rng,
            active: hands?.active && { index: hands.active.index, start: hands.active.start,
              due: hands.active.due, reacting: hands.active.reacting }, queued: hands?.queue.length }));
        });
      }
      const timeline = clean({ inputs: current.inputs, commands: current.commands, events: current.events,
        choices: current.choices, clocks: current.clocks,
        finalUnits: [...game.units].map(([id, unit]) => [id, unit.owner, unit.type, unit.x, unit.z, unit.hp,
          unit.cd, unit.path, unit.targetId, unit.retreating]),
        players: game.players.map(player => [player.mp, player.mun, player.fuel, player.vp]) });
      const bytes = JSON.stringify(timeline);
      return { bytes, modified: current.modified, counts: { inputs: current.inputs.length,
        commands: current.commands.length, accepted: current.commands.filter(entry => entry.result === null).length,
        events: current.events.length, screenEvents: current.events.filter(event => event.source === 'screen').length,
        plannerChoices: current.choices.length }, hash: hash(bytes), byteLength: Buffer.byteLength(bytes) };
    } finally { Math.random = originalRandom; }
  }
  const summaries = [];
  for (const level of ['easy', 'normal', 'hard']) {
    const baseline = replay(level, 'absent');
    assert.ok(baseline.counts.inputs > 0 && baseline.counts.accepted > 0 && baseline.counts.events > 0
      && baseline.counts.screenEvents > 0 && baseline.counts.plannerChoices > 0,
    `${level}: actual inputs, accepted commands, screen stimuli and real planner choices are nonempty`);
    for (const mode of ['stripped', 'toggled', 'nonsense']) {
      const variant = replay(level, mode);
      if (mode !== 'stripped') assert.ok(variant.modified > 0, 'the mutation reaches actual runtime events');
      assert.equal(variant.hash, baseline.hash,
        `${level}/${mode}: native timeline SHA-256 differs`);
      assert.ok(variant.bytes === baseline.bytes,
        `${level}/${mode}: labels cannot change physical input, authoritative outcome, cue, camera, attention or planner bytes`);
    }
    summaries.push({ level, ...baseline.counts, bytes: baseline.byteLength, sha256: baseline.hash });
  }
  console.log(JSON.stringify(summaries));
} else {
  // The loader instruments the delivered runtime boundary in memory. Production files are never rewritten.
  const loader = `export async function load(url, context, nextLoad) {
    const result = await nextLoad(url, context);
    if (url.endsWith('/shared/ai-perception.js')) {
      const source = String(result.source), anchor = '  return view;\\n}';
      const index = source.lastIndexOf(anchor);
      if (index < 0) throw new Error('perceive return boundary changed');
      result.source = source.slice(0, index) +
        '  globalThis.__aiBehaviorLabels?.(view, state, slot);\\n' + source.slice(index);
    }
    if (url.endsWith('/shared/ai.js')) {
      const source = String(result.source), anchor = 'export function plan(observation, slot, opts, mem, send) {';
      if (!source.includes(anchor)) throw new Error('planner signature changed');
      result.source = source.replace(anchor, anchor +
        '\\n  const nativeSend = send; send = cmd => { const result = nativeSend(cmd); globalThis.__aiBehaviorProposal?.(slot, observation.tick, opts.concern, cmd, result); return result; };');
    }
    return result;
  }`;
  if (!process.argv.includes('--focused')) {
    const before = checkpoint();
    const child = spawnSync(process.execPath, ['--no-warnings', '--experimental-loader',
      `data:text/javascript,${encodeURIComponent(loader)}`, fileURLToPath(import.meta.url), '--diagnostic-worker'],
    { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
    assert.equal(child.status, 0, child.stderr || child.stdout || 'diagnostic worker failed');
    assert.deepEqual(checkpoint(), before, 'source bytes must remain stable throughout all twelve native matches');
    console.log('Sixty-second native diagnostic independence:', JSON.parse(child.stdout));
  }

  const map = { w: 80, h: 80, rows: Array(80).fill('.'.repeat(80)),
    spawns: [{ x: 20, y: 40 }, { x: 75, y: 40 }], points: [] };
  function fixture(points = []) {
    const game = createGame({ ...map, points }, ['AI', 'enemy'], false, [0, 1], [0, 1], { weather: false });
    game.units.clear();
    for (const slot of [0, 1]) {
      game.players[slot].mp = 5000;
      assert.equal(command(game, slot, { t: 'buy', unit: 'rifle' }), undefined);
    }
    const [own, enemy] = [...game.units.values()];
    Object.assign(own, { x: 75, z: 80, holdFire: true, auto: false, autoRetreat: false });
    Object.assign(enemy, { x: 95, z: 80, holdFire: true, auto: false, autoRetreat: false });
    game.players.forEach(player => { player.mp = 0; player.mun = 0; });
    return { game, own, enemy, state: { camera: { x: 80, z: 80, yaw: 0, distance: 60 } }, projection: {} };
  }
  for (const engaged of [false, true]) {
    const f = fixture();
    step(f.game);
    if (engaged) assert.equal(command(f.game, 0, { t: 'attack', ids: [f.own.id], target: f.enemy.id }), undefined);
    step(f.game);
    const view = perceive(viewFor(f.game, 0, f.projection), 0, f.state, f.game.tick);
    const contact = view.newEvents.find(event => event.kind === 'screen-contact');
    assert.ok(contact && view.screenIds.has(f.enemy.id), 'both controls observe the real contact');
    const concern = chooseConcern(view, 0, {}, 'normal', () => .5);
    if (engaged) {
      assert.equal(f.own.targetId, f.enemy.id, 'the negative control actually engages its hostile');
      assert.equal(concern.urgency < 90, true, 'a fight already being handled does not cause an urgent visit');
    } else {
      assert.equal(concern.eventId, contact.id, 'a real idle actor gives the actual contact attention');
      assert.ok(concern.urgency >= 90, 'the ready local actor creates contact urgency');
    }
    if (engaged) {
      step(f.game); f.own.hp *= .6;
      const hit = perceive(viewFor(f.game, 0, f.projection), 0, f.state, f.game.tick);
      const damage = hit.newEvents.find(event => event.kind === 'screen-damage');
      assert.ok(damage?.observedDanger.lossShare >= .25, 'the watched bar loses at least a quarter of full health');
      const urgent = chooseConcern(hit, 0, {}, 'normal', () => .5);
      assert.equal(urgent.eventId, damage.id, 'actual heavy observed loss takes attention from routine fighting');
      assert.ok(urgent.urgency >= 100);
    }
  }

  const camera = { x: 80, z: 80, yaw: 0, distance: 60 };
  assert.equal(cameraTravelMode(camera, { x: 115, z: 80 }), 'pan', 'a nearby trip uses the held camera key');
  assert.equal(cameraTravelMode(camera, { x: 230, z: 80 }), 'minimap', 'a distant trip uses the minimap');
  assert.equal(cameraTravelMode({ ...camera, distance: 30 }, { x: 155, z: 80 }), 'minimap',
    'zooming in makes the same destination a distant trip');
  assert.equal(cameraTravelMode({ ...camera, distance: 100 }, { x: 230, z: 80 }), 'pan',
    'zooming out makes the same destination reachable by a local pan');
  assert.equal(cameraTravelMode(camera, { x: 115, z: 80 }, true), 'alert', 'a delivered alert uses its physical alert key');
  const rotated = { ...camera, yaw: Math.PI / 2 }, footprint = cameraFootprint(camera);
  const turned = cameraFootprint(rotated);
  footprint.forEach((point, index) => {
    assert.ok(Math.abs(turned[index].x - camera.x - (point.z - camera.z)) < 1e-8);
    assert.ok(Math.abs(turned[index].z - camera.z + (point.x - camera.x)) < 1e-8,
      'yaw rotates the actual ground footprint without changing its span');
  });
  const f = fixture(), observation = viewFor(f.game, 0, f.projection);
  assert.equal(onScreen({ x: 105, z: 80 }, camera, observation), true);
  assert.equal(onScreen({ x: 105, z: 80 }, rotated, observation), false,
    'yaw changes which actual ground point lies in the physical viewport');
  for (const yaw of [0, Math.PI / 2]) {
    const inputs = [], pose = { ...camera, yaw }, hands = createHands({ slot: 0, seed: 27,
      level: 'normal', camera: pose, startedTick: 100, handover: true, log: entry => inputs.push(structuredClone(entry)) });
    const target = { x: 115, z: 80 }, samples = [];
    assert.ok(queueCamera(hands, target, { concern: 'nearby-trip' }, cameraTravelMode(pose, target)));
    for (let tick = 100; tick < 240; tick++) {
      advanceHands(hands, tick, observation, cmd => command(f.game, 0, cmd));
      samples.push({ tick, x: hands.camera.x, z: hands.camera.z });
      if (inputs.length && hands.ready) break;
    }
    const pan = inputs.find(input => input.kind === 'camera-pan');
    assert.ok(pan && hands.inputTicks.length === 1, 'a pan completes one actual paid physical input');
    const moving = samples.filter(sample => sample.x > camera.x && sample.x < hands.camera.x);
    assert.ok(moving.length >= 5, 'the camera actually moves through intermediate positions during its held key');
    assert.ok(Math.abs(hands.camera.x - target.x) <= HUMAN_CAMERA.panSpeed / 20
      && Math.abs(hands.camera.z - target.z) < 1e-8, 'arrival retains the actual whole-tick key hold distance');
    samples.slice(1).forEach((sample, index) => assert.ok(Math.hypot(sample.x - samples[index].x,
      sample.z - samples[index].z) <= HUMAN_CAMERA.panSpeed / 20 + 1e-8,
    'every intermediate camera step obeys the real pan speed'));
    assert.ok(pan.input.code === (yaw ? 'KeyS' : 'KeyD'), 'the paid key follows the rotated camera axes');
  }
  {
    const f = fixture([{ x: 65, y: 70 }]), inputs = [], accepted = [];
    f.game.units.delete(f.enemy.id);
    Object.assign(f.own, { x: 125, z: 130 });
    f.game.tick = 100;
    f.state.ownStill = new Map([[f.own.id, { x: 125, z: 130, since: -1000 }]]);
    f.state.concern = { id: 'production', kind: 'production', x: 40, z: 80, since: 0, until: 0 };
    const memory = { human: f.state };
    assert.equal(onScreen(f.own, f.state.camera, viewFor(f.game, 0, f.projection)), false,
      'the idle squad starts outside the actual viewport on both camera axes');
    let delivered;
    for (let elapsed = 0; elapsed < 350; elapsed++) {
      if (!delivered || !(f.game.tick % 2)) delivered = viewFor(f.game, 0, f.projection);
      think(f.game, 0, { memory, view: delivered, seed: 27, level: 'normal',
        inputLog: input => inputs.push(structuredClone(input)), submit: cmd => {
          const result = command(f.game, 0, cmd);
          if (result === undefined) accepted.push({ tick: f.game.tick, command: structuredClone(cmd) });
          return result;
        } });
      if (accepted.length) break;
      step(f.game);
    }
    const pans = inputs.filter(input => input.kind === 'camera-pan');
    assert.ok(pans.length >= 2 && new Set(pans.map(input => input.input.code)).size >= 2,
      'the native commander pays both orthogonal held pans before looking at the idle squad');
    const selection = inputs.find(input => input.kind.startsWith('select-'));
    assert.ok(selection && selection.tick > pans[1].tick,
      'the idle actor is physically selected only after the second camera leg finishes');
    assert.ok(accepted.some(entry => entry.command.orders?.some(row => row[0] === f.own.id)),
      'the native idle visit finishes with an ordinary accepted command for its actual squad');
  }
  console.log('Observed contact controls, watched heavy loss, camera zoom/yaw and paid continuous pan passed.');
}
