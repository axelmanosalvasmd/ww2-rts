// Full commander integration: decisions use delivered views and actual commands pass through the hands.
import assert from 'node:assert/strict';
import { createGame, step, command, UNITS } from './shared/sim.js';
import { think } from './shared/ai.js';
import { viewFor } from './shared/ai-view.js';
import { onScreen } from './shared/ai-perception.js';
import { HUMAN_SKILLS } from './shared/ai-hands.js';
import { commandServesObservedEvent } from './shared/ai-priority.js';

const map = { w: 80, h: 80, rows: Array(80).fill('.'.repeat(80)),
  spawns: [{ x: 5, y: 5 }, { x: 75, y: 75 }], points: [{ x: 30, y: 30 }, { x: 50, y: 50 }] };
const initial = createGame(map, ['AI', 'enemy'], false, [0, 1], [0, 1], { weather: false });
initial.players[0].mp = 5000;
initial.players[1].mp = 5000;
for (const unit of ['mg', 'tank']) assert.equal(command(initial, 1, { t: 'buy', unit }), undefined);
for (const u of initial.units.values()) if (u.owner === 1) Object.assign(u, { holdFire: true, auto: false, autoRetreat: false });

function run(level, seed, ticks = 2400, startedTick = 0, handoff = false) {
  const g = structuredClone(initial), memory = {}, inputs = [], commands = [], groups = new Map();
  g.seed = seed; g.matchSeed = seed; g.tick = startedTick;
  let combatSeed = seed;
  const simulate = run => {
    const original = Math.random;
    Math.random = () => { combatSeed = (Math.imul(combatSeed, 1664525) + 1013904223) >>> 0; return combatSeed / 2 ** 32; };
    try { return run(); } finally { Math.random = original; }
  };
  const queuedFrames = new Map();
  let delivered = null, lastSelection = null, lastCommandTick = -1;
  const record = entry => {
    inputs.push(structuredClone(entry));
    assert.ok(entry.tick >= startedTick, 'input timeline uses the authoritative simulation clock');
    if (['select-click', 'select-box', 'select-add-click'].includes(entry.kind)) {
      // A noisy click can miss or toggle a previously selected unit. Record the actual resulting selection.
      const ids = entry.ids ?? [];
      assert.equal(entry.selected, ids.length, 'selection telemetry reports its actual selected count');
      assert.ok(ids.every(id => delivered.units.get(id)?.owner === 0), 'a direct selection contains only own units');
      const added = entry.kind === 'select-add-click' ? ids.filter(id => !lastSelection?.ids.includes(id)) : ids;
      assert.ok(added.every(id => {
        const u = delivered.units.get(id);
        return u?.owner === 0 && onScreen(u, entry.camera, delivered);
      }), `${level}: a direct selection can reach only own units inside the camera`);
      if (entry.kind === 'select-add-click') {
        assert.ok(lastSelection, 'a Shift click follows an existing physical selection');
        const removed = lastSelection.ids.filter(id => !ids.includes(id));
        assert.ok(added.length + removed.length <= 1, 'one Shift click can change at most one selected unit');
      }
      lastSelection = { kind: entry.kind, ids: [...ids] };
    }
    if (entry.kind === 'select-air-panel') {
      const ids = entry.ids ?? [], rows = new Set((delivered.snapshot.air ?? []).map(row => row[0]));
      assert.equal(entry.input.button, 0, 'the aircraft panel uses a physical left click');
      assert.equal(entry.selected, ids.length, 'aircraft panel telemetry reports its actual selection');
      assert.ok(ids.every(id => rows.has(id) && delivered.units.get(id)?.owner === 0
        && UNITS[delivered.units.get(id).type].air), 'a HUD selection contains only own aircraft in the delivered panel');
      lastSelection = { kind: entry.kind, ids: [...ids] };
    }
    if (entry.kind === 'group-set') groups.set(entry.input.code, [...(entry.ids ?? [])]);
    if (entry.kind === 'group-recall') {
      const ids = entry.ids ?? [], assigned = groups.get(entry.input.code);
      assert.ok(assigned && ids.every(id => assigned.includes(id)), 'a recalled living group was previously created through that real hotkey');
      lastSelection = { kind: entry.kind, ids: [...ids] };
    }
    if (entry.command) {
      assert.notEqual(entry.tick, lastCommandTick, `${level}: no second command on a simulation tick`);
      lastCommandTick = entry.tick;
      const ids = entry.command.orders?.map(order => order[0]) ?? entry.command.ids ?? [];
      if (ids.length) {
        assert.ok(lastSelection, 'an issuing command follows a physical selection');
        assert.deepEqual(new Set(ids), new Set(lastSelection.ids), 'one issuing command belongs to its real selection');
        const local = ids.every(id => onScreen(delivered.units.get(id), entry.camera, delivered));
        const airPanel = lastSelection.kind === 'select-air-panel' && ids.every(id => UNITS[delivered.units.get(id)?.type]?.air);
        assert.ok(local || lastSelection.kind === 'group-recall' || entry.kind === 'minimap-rightclick' || airPanel,
          `${level}: off-camera orders require a group recall or minimap click (${JSON.stringify({ tick: entry.tick,
            kind: entry.kind, camera: entry.camera, selection: lastSelection, command: entry.command,
            units: ids.map(id => { const u = delivered.units.get(id); return { id, x: u?.x, z: u?.z }; }) })})`);
      }
      if (Number.isFinite(entry.eventTick)) assert.ok(entry.tick - entry.eventTick >= 4,
        `${level}: an event cannot receive a command in less than 0.2 seconds`);
    }
  };
  for (let i = 0; i < ticks && g.winner === null; i++) {
    // Author a camera-local idle contact after the opening, using native stop and stance commands.
    if (i === 200) {
      g.players[0].mp = 600;
      const enemies = [...g.units.values()].filter(u => u.owner === 1);
      const observers = [...g.units.values()].filter(u => u.owner === 0 && u.type === 'rifle');
      // Place this authored contact inside the actual camera for every difficulty and handover.
      const observer = observers.filter(u => onScreen(u, memory.human.camera, delivered))
        .sort((a, b) => Math.hypot(a.x - memory.human.camera.x, a.z - memory.human.camera.z)
          - Math.hypot(b.x - memory.human.camera.x, b.z - memory.human.camera.z))
        .find(u => enemies.every((enemy, j) => onScreen({ x: Math.min(map.w * 2 - 2, u.x + 12 + j), z: u.z }, memory.human.camera, delivered)));
      assert.ok(observer, 'contact fixture retains an own observer');
      // This authored camera scene pauses local rifles so the contact requires a new useful response.
      const local = observers.filter(u => onScreen(u, memory.human.camera, delivered)).map(u => u.id);
      assert.ok(local.length, 'the authored cue has actual camera-local rifles');
      assert.equal(command(g, 0, { t: 'stop', ids: local }), undefined);
      assert.equal(command(g, 0, { t: 'stance', ids: local, key: 'holdFire', on: true }), undefined);
      enemies.forEach((u, j) => Object.assign(u, {
        x: Math.min(map.w * 2 - 2, observer.x + 12 + j), z: observer.z, path: [], orders: [],
        amove: null, holdFire: true, holdPos: true, auto: false, autoRetreat: false,
      }));
    }
    if (!delivered || g.tick % 2 === 0) delivered = viewFor(g, 0, memory);
    const original = Math.random;
    Math.random = () => assert.fail('the commander must use its own seeded RNG');
    try {
      think(g, 0, { memory, view: delivered, level, seed, inputLog: record, ...(handoff && i === 0 ? { handoff: true } : {}),
        submit: cmd => { const result=simulate(() => command(g,0,cmd)); commands.push({tick:g.tick,command:structuredClone(cmd),accepted:result===undefined});return result; } });
    } finally { Math.random = original; }
    const screen = memory.human.view;
    queuedFrames.set(g.tick, Object.freeze({ w: screen.w, h: screen.h, tick: screen.tick,
      flags: structuredClone(screen.flags), height: structuredClone(screen.height), smokes: structuredClone(screen.smokes),
      units: structuredClone(screen.units), players: structuredClone(screen.players),
      screenIds: new Set(screen.screenIds), events: structuredClone(memory.human.events) }));
    simulate(() => step(g));
  }
  assert.ok(commands.length > 0 && inputs.some(entry => entry.command), `${level}: the integration fixture executes real commands`);
  assert.equal(inputs.filter(entry => entry.command).length, commands.length, 'every submitted command has a physical input record');
  const causalInputs = inputs.filter(entry => entry.command && commands.some(cmd=>cmd.tick===entry.tick&&cmd.accepted) && (Number.isFinite(entry.eventTick)
    || entry.responseEvents?.some(event => Number.isFinite(event.tick))));
  assert.ok(causalInputs.length, 'reaction-floor proof includes an actual command tied to a primary or explicit secondary observed event');
  for (const input of causalInputs) {
    assert.ok(commands.some(entry => entry.tick === input.tick && JSON.stringify(entry.command) === JSON.stringify(input.command)),
      'causal proof uses a command actually submitted through the native hands');
    const frame = queuedFrames.get(input.queuedTick);
    assert.ok(frame, 'the actual delivered planning frame is retained for causal verification');
    const events = [...(input.responseEvents ?? []), ...(input.event ? [{...input.event,tick:input.eventTick}] : [])];
    assert.ok(events.length, 'finite event creation metadata accompanies an actual source event');
    for (const event of events) {
      const source = frame.events.find(candidate => candidate.id === event.id);
      assert.ok(source && source.tick === event.tick && source.kind === event.kind, `every linked event exists in its queued delivered frame: ${JSON.stringify({input:input.tick,queued:input.queuedTick,event,ids:frame.events.map(e=>e.id)})}`);
      assert.ok(commandServesObservedEvent(input.command, source, frame, 0), 'the actual physical command serves each linked event under the strict shared predicate');
      assert.ok(input.tick - source.tick >= 4, 'every linked source event respects the physical reaction floor');
    }
  }
  assert.ok(memory.human.events.some(event => event.kind === 'screen-contact' && event.tick >= startedTick + 200
    && event.observedDanger.idleOwnUnits.length > 0), 'the authored contact exposes a genuine idle response opportunity');
  if (handoff) assert.ok(memory.human.events.some(event => event.kind === 'screen-contact' && event.tick >= startedTick + 200),
    'the handover reaction proof includes a genuinely delivered camera contact');
  assert.ok(commands.every(entry => entry.tick >= memory.human.hands.openingUntil), 'no command precedes the opening look');
  const first = (commands[0].tick - startedTick) / 20;
  if (handoff) assert.ok(first >= 1.5, 'handover spends at least 1.5 seconds reading the seat');
  else {
    assert.ok(first >= HUMAN_SKILLS[level].opening[0], `${level}: the first command respects the opening lower bound`);
    assert.ok(first <= HUMAN_SKILLS[level].opening[1], `${level}: the first command arrives inside its published opening range (${first}s)`);
  }
  for (const entry of inputs) {
    const minute = inputs.filter(other => other.tick <= entry.tick && entry.tick - other.tick < 1200).length;
    const burst = inputs.filter(other => other.tick <= entry.tick && entry.tick - other.tick < 200).length;
    assert.ok(minute <= HUMAN_SKILLS[level].apm[1], `${level}: the rolling minute counts all physical inputs`);
    assert.ok(burst <= Math.floor(HUMAN_SKILLS[level].peak / 6), `${level}: the rolling ten-second burst counts all physical inputs`);
  }
  return { inputs, commands, first, tick: g.tick };
}

for (const level of ['easy', 'normal', 'hard']) {
  const result = run(level, 183);
  console.log(`${level}: first command ${result.first}s, ${result.commands.length} commands, ${result.inputs.length} physical inputs over ${result.tick / 20}s`);
}
const a = run('normal', 907, 900), b = run('normal', 907, 900);
assert.deepEqual(b, a, 'the same match seed and delivered history reproduce the entire commander input timeline');
const c = run('normal', 908, 900);
assert.notDeepEqual(c.inputs, a.inputs, 'a different match seed changes the human input timeline');
run('hard', 911, 300, 600, true);

// Compare actual hands input sequences, not just projected perception, before remote detail is inspected.
function detailProbe(screen, change = 'none') {
  const g = structuredClone(initial), memory = {}, inputs = [], commands = [];
  // Two real anti-tank teams let the on-camera control answer either vehicle instead of waiting for a counter.
  for (let i = 0; i < 2; i++) assert.equal(command(g, 0, { t: 'buy', unit: 'at' }), undefined);
  const enemy = [...g.units.values()].find(u => u.owner === 1 && u.type === 'tank');
  for (const u of [...g.units.values()]) if (u.owner === 1 && u !== enemy) g.units.delete(u.id);
  Object.assign(enemy, screen ? { x: 29, z: 11 } : { x: 139, z: 139 });
  enemy.hp = UNITS.tank.models * UNITS.tank.hpPer;
  if (change === 'type' || change === 'both') enemy.type = 'armoredcar';
  if (change === 'health' || change === 'both') enemy.hp = 1;
  g.players[0].visible = new Set([enemy.id]);
  const seed = 715;
  let delivered;
  for (let tick = 0; tick < 200; tick++) {
    g.tick = tick;
    if (!delivered || tick % 2 === 0) delivered = viewFor(g, 0, memory);
    think(g, 0, { memory, view: delivered, seed, level: 'hard', inputLog: entry => {
      if (!screen) assert.equal(onScreen(enemy, entry.camera, delivered), false,
        'the off-camera action comparison stops before the remote detail is inspected');
      inputs.push(structuredClone(entry));
    }, submit: cmd => { commands.push({ tick, command: structuredClone(cmd) }); return undefined; } });
  }
  assert.ok(commands.length > 0 && inputs.some(input => input.kind.startsWith('select-')),
    'the detail proof exercises real selection inputs and issuing commands');
  return { inputs, commands };
}
const offscreenDetail = detailProbe(false);
for (const change of ['health', 'type', 'both']) assert.deepEqual(detailProbe(false, change), offscreenDetail,
  `changing off-camera enemy ${change} within the same minimap class does not change the next inputs or commands`);
const onscreenDetail = detailProbe(true), onscreenAltered = detailProbe(true, 'both');
assert.notDeepEqual(onscreenAltered.commands, onscreenDetail.commands,
  'the same enemy health and exact-type changes on camera can change the next issuing commands');
console.log('Default commander action-level camera detail invariance and on-camera negative control passed.');

console.log('Full human commander opening, physical inputs, reaction floor, locality, APM, determinism and handover passed.');
