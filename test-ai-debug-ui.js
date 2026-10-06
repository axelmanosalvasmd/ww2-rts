// Run independently with node test-ai-debug-ui.js.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as sim from './shared/sim.js';
import * as ai from './shared/ai.js';
import * as perception from './shared/ai-perception.js';
import * as hands from './shared/ai-hands.js';
import * as view from './shared/ai-view.js';
import { AI_LAB_SCENARIOS, createAIcase, defaultScene } from './tools/ai-lab-runner.mjs';

class Element {
  constructor(value = '') { this.value = value; this.children = []; this.dataset = {}; this.listeners = {}; }
  set value(value) { this._value = String(value); }
  get value() { return this._value; }
  add(option) { this.children.push(option); if (!this.value) this.value = option.value; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  addEventListener(type, listener) { this.listeners[type] = listener; }
  setAttribute() {}
  querySelectorAll(tag) { return this.children.flatMap(child => [ ...(child.tag === tag ? [child] : []), ...child.querySelectorAll?.(tag) ?? [] ]); }
  getContext() {
    if (!this.context) {
      this.texts = [];
      this.context = new Proxy({}, { get: (_, key) => (...args) => { if (key === 'clearRect') this.texts.length = 0; if (key === 'fillText') this.texts.push(args[0]); } });
    }
    return this.context;
  }
  getBoundingClientRect() { return { left: 0, top: 0, width: 720, height: 720 }; }
}
function dom() {
  const elements = new Map(), seconds = [1, 10, 60].map(value => Object.assign(new Element(), { dataset: { seconds: String(value) } }));
  const get = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  return { get, seconds, document: { getElementById: get, querySelectorAll: () => seconds,
    createElement: tag => Object.assign(new Element(), { tag }), createDocumentFragment: () => new Element() } };
}
function timers() {
  const callbacks = new Map(); let serial = 0;
  return { callbacks, setInterval: callback => { callbacks.set(++serial, callback); return serial; }, clearInterval: id => callbacks.delete(id) };
}

{
  const ui = dom(), clock = timers(), errors = [];
  ui.get('level').value = 'normal'; ui.get('seed').value = 1;
  const context = vm.createContext({ ...clock, ...{ sim, ai, perception, hands, view, AI_LAB_SCENARIOS, createAIcase, defaultScene },
    document: ui.document, window: {}, structuredClone, console: { error: error => errors.push(error.message) },
    Option: class extends Element { constructor(text, value) { super(value); this.textContent = text; } } });
  const source = await readFile(new URL('./tools/ai-lab-browser.mjs', import.meta.url), 'utf8');
  vm.runInContext(source.replace(/^import .*;\n/gm, ''), context, { filename: 'tools/ai-lab-browser.mjs' });
  const lab = context.window.aiLab;
  const canvas = ui.get('map'), baselineScene = JSON.parse(ui.get('scene').value);
  assert.equal(canvas.texts.length, 0, 'the public canvas has no undelivered unit details at tick zero');
  ui.get('author').checked = true; ui.get('author').onchange();
  for (const unit of lab.authorView().units) assert(canvas.texts.includes(`${unit.type} #${unit.id}`), 'checked author view draws each actual unit at tick zero');
  assert(canvas.texts.some(text => text.includes('AUTHOR DEBUG: actual world at tick 0')));
  ui.get('author').checked = false; ui.get('author').onchange();
  assert.equal(canvas.texts.length, 0, 'turning author view off restores public tick-zero privacy');
  const hiddenScene = structuredClone(baselineScene), opponent = hiddenScene.units.find(unit => unit.owner === 1);
  opponent.x = 168; opponent.z = 168; lab.reset(hiddenScene); lab.advance(4);
  const hidden = lab.authorView().units.find(unit => unit.owner === 1), hiddenLabel = `${hidden.type} #${hidden.id}`;
  assert(!lab.record().frames[0].units.some(unit => unit.owner === 1), 'the native public frame excludes the unseen opponent');
  ui.get('author').checked = true; ui.get('history').value = 0; ui.get('history').oninput();
  assert(!canvas.texts.includes(hiddenLabel) && !canvas.texts.some(text => text.includes('AUTHOR DEBUG')), 'historical scrubbing keeps the recorded public view even with author checked');
  ui.get('history').value = lab.record().frames.length - 1; ui.get('history').oninput();
  assert(canvas.texts.includes(hiddenLabel), 'author view displays the actual opponent only at the current world');
  ui.get('author').checked = false; ui.get('author').onchange();
  assert(!canvas.texts.includes(hiddenLabel), 'current public view still excludes unseen actual units');
  lab.reset(baselineScene);
  ui.seconds[1].onclick();
  assert.equal(lab.record().completedTicks, 200, 'the actual case advances ten seconds');
  assert.equal(lab.record().options.seconds, 20, 'configured duration remains separate from completed ticks');
  assert(Number(ui.get('history').max) > 0, 'the recording can be scrubbed');
  ui.get('reset').onclick();
  assert.equal(Number(ui.get('history').max), 0, 'reset removes the previous scrub range');
  assert.equal(Number(ui.get('history').value), 0);
  assert.equal(lab.record().frames.length, 0);

  lab.advance(20);
  const accepted = lab.record();
  for (const [seed, control, value] of [[-1, 'scenario', 'armor-pressure'], [1.5, 'level', 'hard']]) {
    ui.get('seed').value = seed; ui.get(control).value = value; ui.get(control).onchange();
    assert.deepEqual(lab.record(), accepted, 'a rejected reset preserves the complete native trace');
    for (const key of ['scenario', 'level', 'seed']) assert.equal(ui.get(key).value, String(accepted.options[key]), `${key} shows the case that will run`);
    assert.match(ui.get('status').textContent, /Seed must be an unsigned 32-bit integer/);
    assert.equal(clock.callbacks.size, 0, 'validation failure leaves playback paused');
  }
  ui.get('play').onclick(); [...clock.callbacks.values()][0](); ui.get('play').onclick();
  assert.equal(lab.record().completedTicks, accepted.completedTicks + 2, 'Run resumes the retained case');
  for (const key of ['scenario', 'level', 'seed']) assert.equal(ui.get(key).value, String(lab.record().options[key]));

  ui.get('history').value = 3; ui.get('history').oninput(); ui.get('unit').value = 1; ui.get('unit').onchange();
  const retained = { report: lab.record(), world: lab.authorView(), max: ui.get('history').max, tick: ui.get('history').value,
    editor: Object.fromEntries(['scene', 'unit', 'type', 'x', 'z', 'mp', 'fuel', 'mun', 'cameraX', 'cameraZ', 'yaw'].map(key => [key, ui.get(key).value])) };
  const incomplete = JSON.parse(ui.get('scene').value); incomplete.resources = [];
  ui.get('level').value = 'hard'; lab.reset(incomplete);
  assert.deepEqual(lab.record(), retained.report, 'an editor failure after creating a new case preserves the complete native trace');
  assert.deepEqual(lab.authorView(), retained.world, 'the actual world and clock also remain on the retained case');
  assert.equal(ui.get('level').value, retained.report.options.level);
  assert.equal(ui.get('history').max, retained.max); assert.equal(ui.get('history').value, retained.tick, 'failed reset restores the scrub position');
  for (const [key, value] of Object.entries(retained.editor)) assert.equal(ui.get(key).value, value, `failed reset restores editor field ${key}`);
  assert.match(ui.get('status').textContent, /reading 'mp'/); assert.equal(clock.callbacks.size, 0);
  ui.get('play').onclick(); [...clock.callbacks.values()][0](); ui.get('play').onclick();
  assert.equal(lab.record().completedTicks, retained.report.completedTicks + 2, 'Run resumes the actual retained clock after an editor failure');
  assert.equal(lab.record().options.level, retained.report.options.level);

  const prior = lab.record();
  ui.get('scene').value = '{'; ui.get('level').value = 'hard'; ui.get('apply').onclick();
  assert.deepEqual(lab.record(), prior, 'invalid author JSON preserves the running case');
  assert.equal(ui.get('level').value, prior.options.level);
  ui.get('level').value = 'hard'; ui.get('level').onchange();
  assert.equal(lab.record().options.level, 'hard', 'a valid reset accepts the new difficulty');
  assert.equal(lab.record().completedTicks, 0);
  assert.equal(Number(ui.get('history').max), 0);
  ui.get('unit').value = 0; ui.get('unit').onchange();
  const unit = lab.authorView().units[0];
  ui.get('map').onclick({ clientX: 180, clientY: 360 });
  assert.deepEqual(lab.authorView().units[0], unit, 'public viewing does not edit the authored world');
  ui.get('author').checked = true; ui.get('map').onclick({ clientX: 180, clientY: 360 });
  assert.equal(lab.authorView().units[0].x, 48); assert.equal(lab.authorView().units[0].z, 96, 'author map clicks use the native scene reset');
  assert.equal(errors.length, 4, 'only deliberate invalid inputs were rejected');
  console.log('lab history, rejected reset, playback, author placement and public view privacy controls passed');
}

const main = await readFile(new URL('./client/main.js', import.meta.url), 'utf8');
// Execute the production room controls without creating a renderer or a game socket.
const controls = main.slice(main.indexOf('// Room box:'), main.indexOf('\nfunction positionRoomBanners()'));
function roomUI(search, seat = '') {
  const ui = dom(), assigned = [], browse = new Element('/');
  const context = vm.createContext({ $: ui.get, room: 'original', seat, entry: new URLSearchParams(search), URLSearchParams,
    document: { querySelector: selector => selector === '#overlay a[href="/"]' ? browse : null },
    location: { assign: url => assigned.push(new URL(url, 'http://local')) }, Math: Object.assign(Object.create(Math), { random: () => 0.123456789 }) });
  vm.runInContext(controls, context, { filename: 'client/main.js room controls' });
  return { ...ui, assigned, browse };
}
for (const search of ['', '?aiOverlay=1', '?humanInput=1', '?aiOverlay=1&humanInput=1&public=true&title=Old&name=Old&tutorial=1', '?aiOverlay=true&humanInput=01']) {
  for (const action of ['join', 'enter', 'new']) {
    const ui = roomUI(search, '2'); ui.get('roomCode').value = ' NeXt123 ';
    if (action === 'join') ui.get('joinRoom').onclick();
    else if (action === 'enter') ui.get('roomCode').listeners.keydown({ key: 'Enter' });
    else ui.get('newRoom').onclick();
    const url = ui.assigned[0], expected = new URLSearchParams();
    for (const key of ['aiOverlay', 'humanInput']) if (new URLSearchParams(search).get(key) === '1') expected.set(key, '1');
    assert.equal(url.searchParams.toString(), expected.toString(), `${action} preserves only explicit opt-ins`);
    assert.equal(new URL(ui.browse.href, 'http://local').searchParams.toString(), expected.toString(), 'Browse matches retains the same explicit opt-ins');
    assert.equal(url.pathname, '/play'); assert.match(url.hash, action === 'new' ? /^#[a-z0-9]{3,12}&seat=2$/ : /^#next123&seat=2$/);
  }
}
{
  const ui = roomUI('?aiOverlay=1'); ui.get('roomCode').value = '..'; ui.get('joinRoom').onclick();
  assert.equal(ui.assigned.length, 0); assert.equal(ui.get('roomCode').value, 'original', 'invalid room codes still restore the current room');
}

const directory = await readFile(new URL('./client/public-lobby.js', import.meta.url), 'utf8');
const listed = [ { code: 'listed', title: 'Listed', map: 'three-crossroads', mode: 'conquest', occupied: 1, capacity: 3, humans: 1, ai: 0, state: 'lobby', joinable: true } ];
async function directoryUI(search, rooms = listed, hash = '') {
  const ui = dom(), assigned = [], replaced = [], stored = new Map([['ww2-name', 'Stored']]);
  ui.get('visibility').value = 'public';
  const context = vm.createContext({ document: ui.document, URLSearchParams, Uint8Array, ...timers(),
    location: { search, hash, assign: url => assigned.push(new URL(url, 'http://local')), replace: url => replaced.push(url) },
    localStorage: { getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value) },
    crypto: { getRandomValues: bytes => bytes.fill(7) }, AbortSignal, fetch: async () => ({ ok: true, json: async () => ({ rooms }) }) });
  await vm.runInContext(`(async () => { ${directory}\n })()`, context, { filename: 'client/public-lobby.js' });
  return { ...ui, assigned, replaced, stored };
}
for (const search of ['', '?aiOverlay=1', '?humanInput=1', '?aiOverlay=1&humanInput=1&public=false&title=Old&tutorial=1', '?aiOverlay=0&humanInput=true']) {
  for (const action of ['join', 'listed', 'create', 'tutorial', 'quick', 'quick-empty']) {
    const ui = await directoryUI(search, action === 'quick-empty' ? [] : listed);
    ui.get('nickname').value = '  New Soldier  '; ui.get('roomCode').value = ' TaRget '; ui.get('matchTitle').value = ' New match ';
    if (action === 'join') ui.get('joinForm').onsubmit({ preventDefault() {} });
    else if (action === 'listed') ui.get('matches').querySelectorAll('button')[0].onclick();
    else if (action === 'create') ui.get('createForm').onsubmit({ preventDefault() {} });
    else if (action === 'tutorial') ui.get('tutorial').onclick();
    else await ui.get('quickPlay').onclick();
    const url = ui.assigned[0], expected = new URLSearchParams({ name: 'New Soldier' });
    for (const key of ['aiOverlay', 'humanInput']) if (new URLSearchParams(search).get(key) === '1') expected.set(key, '1');
    if (['create', 'tutorial', 'quick-empty'].includes(action)) {
      expected.set('public', String(action !== 'tutorial'));
      expected.set('title', action === 'create' ? 'New match' : action === 'tutorial' ? 'Tutorial' : 'Open skirmish');
    }
    if (action === 'tutorial') expected.set('tutorial', '1');
    assert.equal(url.searchParams.toString(), expected.toString(), `${action} preserves opt-ins and its own creation metadata`);
    assert.equal(url.pathname, '/play'); assert.equal(ui.stored.get('ww2-name'), 'New Soldier');
    assert.equal(url.hash, action === 'join' ? '#target' : ['listed', 'quick'].includes(action) ? '#listed' : '#070707070707');
  }
}
{
  const ui = await directoryUI('?aiOverlay=1&name=Legacy', [], '#old&seat=3');
  assert.deepEqual(ui.replaced, ['/play?aiOverlay=1&name=Legacy#old&seat=3'], 'legacy directory hashes still retain the exact search and seat');
}
console.log('room and directory navigation opt-ins, negative controls and existing metadata passed');
