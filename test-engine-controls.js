// Queue acceptance uses normal room commands and recipient-filtered WebSocket payloads.
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { readFileSync } from 'node:fs';
import { createGame, command, step, snapshotFor, snapshotCache, priceOf, popOf, popUse, UNITS } from './shared/sim.js';
import { storyResult } from './shared/story.js';
import { viewFor } from './shared/ai-view.js';
import { createSelection } from './client/selection.js';
import { createAlertHistory } from './client/alert-history.js';
import { match, bindings, rank } from './client/keys.js';
import { spanish } from './client/i18n.js';

const map = { w: 80, h: 80, rows: Array(80).fill('.'.repeat(80)), spawns: [{ x: 10, y: 10 }, { x: 70, y: 70 }], points: [] };
const own = (g, owner, type) => [...g.units.values()].find(u => u.owner === owner && u.type === type);
const fresh = () => { const g = createGame(map, ['a', 'b'], false, [0, 1], [0, 1], { mode: 'classic', weather: 'clear' }); g.players[0].mp = 10000; g.players[0].fuel = 10000; return g; };
const jobsOf = (s, id) => s.productionJobs.find(row => row[0] === id)?.[1] ?? [];

// Destroy scuttles only your own units and buildings, with no bounty for the enemy.
{
  const g = fresh(), hq = own(g, 0, 'hq'), rival = own(g, 1, 'hq');
  assert.equal(command(g, 0, { t: 'destroy', ids: [rival.id] }), 'unseen');
  assert.equal(command(g, 0, { t: 'destroy', ids: [hq.id] }), undefined);
  step(g);
  assert.ok(!g.units.has(hq.id) && g.units.has(rival.id), 'own HQ gone, rival HQ untouched');
  assert.equal(match({ code: 'Delete' }, 'army'), 'destroy');
}

// Tanks made in a crowded Horde base step out clear of their building and of each other, and drive away.
{
  const map = { w: 60, h: 60, rows: Array(60).fill('.'.repeat(60)), spawns: [{ x: 30, y: 5 }, { x: 10, y: 54 }, { x: 50, y: 54 }], defend: [0], points: [{ x: 30, y: 30 }] };
  const g = createGame(map, ['a'], false, [0], [0], { mode: 'horde' }), b = own(g, 0, 'barracks');
  b.type = 'motorpool'; g.players[0].mp = 1e5; g.players[0].fuel = 1e5;
  for (let i = 0; i < 6; i++) assert.equal(command(g, 0, { t: 'buy', unit: 'tank', from: b.id }), undefined);
  const tanks = [...g.units.values()].filter(u => u.type === 'tank'), start = tanks.map(u => ({ x: u.x, z: u.z }));
  command(g, 0, { t: 'move', orders: tanks.map(u => [u.id, 60, 90]) });
  for (let t = 0; t < 600; t++) step(g);
  assert.ok(tanks.every((u, i) => Math.hypot(u.x - start[i].x, u.z - start[i].z) > 30), 'every new tank leaves the base');
}

// Exact charge reversal, population release, no head reset, now-active races and stable owner views.
{
  const g = fresh(), b = own(g, 0, 'hq'); b.type = 'motorpool';
  const types = ['tank', 'tank', 'tank', 'at'];
  for (const type of types) assert.equal(command(g, 0, { t: 'buy', unit: type, from: b.id }), undefined);
  const before = snapshotFor(g, 0, []), jobs = jobsOf(before, b.id), charge = priceOf(g, 'tank');
  assert.equal(new Set(jobs.map(job => job.id)).size, 4);
  assert.equal(jobs[0].status, 'active', 'a head at zero progress is already active');
  assert.deepEqual(jobs.slice(1).map(j => j.status), ['waiting', 'waiting', 'waiting']);
  assert.deepEqual([jobs[2].mp, jobs[2].fuel], [charge.mp, charge.fuel]);
  assert.deepEqual(jobsOf(snapshotFor(g, 0, [], [], snapshotCache(g)), b.id), jobs);
  assert.deepEqual(viewFor(g, 0).units.get(b.id).productionJobs, jobs);
  assert.equal(jobsOf(snapshotFor(g, 1, []), b.id).length, 0, 'rivals receive no private paid jobs');
  const saved = { mp: g.players[0].mp, fuel: g.players[0].fuel, spent: storyResult(g).story[0].mpSpent, pop: popOf(g, 0) };
  b.prog = 3.25;
  assert.equal(command(g, 1, { t: 'cancelProduction', id: b.id, job: jobs[2].id }), 'unseen');
  assert.equal(command(g, 0, { t: 'cancelProduction', id: b.id, job: jobs[0].id }), 'notWaiting');
  assert.equal(command(g, 0, { t: 'cancelProduction', id: b.id, job: jobs[2].id }), undefined);
  assert.equal(g.players[0].mp, saved.mp + charge.mp);
  assert.equal(g.players[0].fuel, saved.fuel + charge.fuel);
  assert.equal(storyResult(g).story[0].mpSpent, saved.spent - charge.mp);
  assert.equal(popOf(g, 0), saved.pop - popUse('tank'));
  assert.equal(b.prog, 3.25);
  assert.deepEqual(snapshotFor(g, 0, []).queues.find(row => row[0] === b.id).slice(4), ['tank', 'tank', 'at']);
  const remaining = jobsOf(snapshotFor(g, 0, []), b.id).map(j => j.id);
  assert.deepEqual(remaining, [jobs[0].id, jobs[1].id, jobs[3].id]);
  assert.equal(command(g, 0, { t: 'cancelProduction', id: b.id, job: jobs[2].id }), 'notWaiting');
  assert.equal(g.players[0].mp, saved.mp + charge.mp, 'duplicate cancellation has no refund');
  b.prog = UNITS.tank.train - 0.01; step(g, 0.05);
  assert.equal(jobsOf(snapshotFor(g, 0, []), b.id)[0].id, jobs[1].id);
  assert.equal(command(g, 0, { t: 'cancelProduction', id: b.id, job: jobs[1].id }), 'notWaiting', 'waiting request loses the race to promotion');
  for (const state of ['out', 'away', 'winner', 'suddenDeath', 'dead']) {
    const value = state === 'winner' ? g.winner : state === 'suddenDeath' ? g.mode.suddenDeath : state === 'dead' ? b.hp : g.players[0][state];
    if (state === 'winner') g.winner = 1; else if (state === 'suddenDeath') g.mode.suddenDeath = true; else if (state === 'dead') b.hp = 0; else g.players[0][state] = true;
    const mp = g.players[0].mp;
    assert.ok(command(g, 0, { t: 'cancelProduction', id: b.id, job: jobs[3].id }));
    assert.equal(g.players[0].mp, mp);
    if (state === 'winner') g.winner = value; else if (state === 'suddenDeath') g.mode.suddenDeath = value; else if (state === 'dead') b.hp = value; else g.players[0][state] = value;
  }
  g.mode.timeLeft = 0; step(g, 0.05);
  assert.equal(jobsOf(snapshotFor(g, 0, []), b.id).length, 0, 'Sudden Death clears metadata and reservations');
}

// Ordinary groups may overlap. Transfer appends eligible own ground units, cleans other groups and keeps recall behavior.
{
  const units = new Map([
    [1, { id: 1, owner: 0, type: 'at', hp: 100 }], [2, { id: 2, owner: 0, type: 'rifle', hp: 100 }],
    [3, { id: 3, owner: 0, type: 'rifle', hp: 100 }], [4, { id: 4, owner: 1, type: 'rifle', hp: 100 }],
    [5, { id: 5, owner: 0, type: 'hq', hp: 100 }], [6, { id: 6, owner: 0, type: 'fighter', hp: 100, flags: 512 }],
    [7, { id: 7, owner: 0, type: 'rifle', hp: 0 }]
  ]), selected = new Set([1, 2]), groups = {}, centered = [];
  const selection = createSelection({ units, selected, groups, owner: () => 0, definitions: UNITS, screenOf: () => ({ front: true, x: 0, y: 0 }), viewport: () => ({ width: 10, height: 10 }), center: rows => centered.push(rows.map(v => v.id)) });
  selection.group('1', 'set'); selection.group('2', 'append');
  assert.deepEqual(groups['1'], [1, 2]); assert.deepEqual(groups['2'], [1, 2]);
  selected.clear(); selected.add(3); selection.group('3', 'set');
  for (const id of [1, 4, 5, 6, 7]) selected.add(id);
  selection.group('3', 'transfer');
  assert.deepEqual(groups['3'], [3, 1]); assert.deepEqual(groups['1'], [2]); assert.deepEqual(groups['2'], [2]);
  selection.group('3', 'recall', 100); selection.group('3', 'recall', 200);
  assert.deepEqual(centered, [[3, 1]]);
  units.delete(1); selection.group('3', 'recall', 900); assert.deepEqual(groups['3'], [3]);
}

// History keeps delivered localized text, time and original coordinates; reconnect ticks cannot replay an entry.
{
  const h = createAlertHistory(100); assert.equal(h.start('match-a'), true);
  const entry = h.add({ kind: 'pointLost', text: spanish('Point lost'), x: 12, z: 34, time: 71 });
  assert.equal(h.acceptTick(1420), true); assert.equal(h.acceptTick(1420), false); assert.equal(h.acceptTick(1419), false);
  assert.equal(h.start('match-a'), false); assert.deepEqual(h.navigate(1), entry); assert.deepEqual(h.select(entry.id), entry);
  assert.equal(entry.text, 'Punto perdido'); assert.deepEqual([entry.time, entry.x, entry.z], [71, 12, 34]);
  for (let n = 0; n < 101; n++) h.add({ kind: 'ping', text: `Ping ${n}`, x: n, z: n, time: n });
  assert.equal(h.entries.length, 100); assert.equal(h.entries.at(-1).text, 'Ping 1');
  assert.equal(h.start('match-b'), true); assert.equal(h.entries.length, 0); assert.equal(h.acceptTick(1), true);
  for (const text of ['Alert history', 'Previous Alert', 'Next Alert', 'Move to group', 'Destination control group', 'Waiting: Rifle squad', 'Cancel: refund 40 MP, 0 Fuel']) assert.notEqual(spanish(text), text);
  assert.equal(match({ code: 'Digit3', altKey: true }, 'army'), 'group:transfer:3');
  assert.equal(match({ code: 'Digit3', shiftKey: true }, 'army'), 'group:append:3');
  assert.equal(match({ code: 'KeyH', altKey: true }, 'army'), 'alertHistory');
  const chords = new Map();
  for (const b of bindings.filter(b => ['global', 'army'].includes(b.context))) {
    const chord = `${b.code}:${b.shift}:${b.ctrl}:${b.alt}:${rank(b.context)}`;
    assert.equal(chords.has(chord), false, `duplicate key chord ${chord}`); chords.set(chord, b);
  }
}

// Small DOM adapter exercises the actual Alert module, including expiration, revisits and sound isolation.
{
  class Element {
    constructor() { this.children = []; this.style = {}; this.attrs = {}; this.dataset = {}; this.events = {}; }
    append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } }
    prepend(child) { child.parent = this; this.children.unshift(child); }
    insertBefore(child, before) { child.parent = this; const i = this.children.indexOf(before); if (i < 0) this.children.push(child); else this.children.splice(i, 0, child); }
    get nextSibling() { return this.parent?.children[this.parent.children.indexOf(this) + 1] ?? null; }
    replaceChildren(...children) { this.children = []; this.append(...children); }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
    setAttribute(key, value) { this.attrs[key] = value; }
    addEventListener(key, fn) { this.events[key] = fn; }
    getBoundingClientRect() { return { width: 200, right: 1000, top: 500 }; }
  }
  const saved = Object.fromEntries(['document', 'performance', 'addEventListener', 'innerWidth', 'innerHeight'].map(key => [key, globalThis[key]]));
  const box = new Element(), mm = new Element(), top = new Element(), jumps = []; let clockMs = 0, sounds = 0;
  Object.assign(globalThis, { document: { getElementById: id => ({ alerts: box, minimap: mm, top })[id] ?? null, createElement: () => new Element() }, performance: { now: () => clockMs }, addEventListener() {}, innerWidth: 1200, innerHeight: 800 });
  const { audio } = await import('./client/audio.js'), savedAlert = audio.alert; audio.alert = () => sounds++;
  try {
    const source = readFileSync(new URL('./client/alerts.js', import.meta.url), 'utf8').replace(/from '([^']+)'/g, (_, path) => `from '${path.startsWith('/shared/') ? new URL('.' + path, import.meta.url) : new URL('./client/' + path.slice(2), import.meta.url)}'`);
    const { alerts } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
    alerts.init({ me: () => 0, friend: slot => slot === 0, jump: (x, z) => jumps.push([x, z]), pointPos: () => ({ x: 90, z: 100 }), onScreen: () => false, home: () => ({ x: 0, z: 50 }), unitName: type => UNITS[type].name });
    alerts.startMatch('adapter-a'); alerts.push('pointLost', 20, 30, 'Point lost');
    assert.equal(sounds, 1); clockMs = 9000; alerts.frame(); assert.deepEqual(alerts.lines, []);
    alerts.navigate(1); assert.deepEqual(jumps, [[20, 30]]); assert.equal(sounds, 1, 'history revisit never repeats sound');
    alerts.startMatch('adapter-a'); assert.equal(alerts.history.length, 1, 'same-tab reconnect keeps history');
    const prev = { tick: 20, units: [], points: [[0, 0, 1]] }, next = { tick: 40, units: [], points: [[1, 0, 1]] };
    alerts.snapshot(next, prev); assert.equal(alerts.history.length, 2);
    alerts.snapshot(next, prev); assert.equal(alerts.history.length, 2, 'duplicate snapshot cannot repeat retained events');
    alerts.snapshot({ ...next, tick: 80 }, null); assert.equal(alerts.history.length, 2, 'reconnect baseline cannot clear delivered entries');
    alerts.startMatch('adapter-b'); assert.equal(alerts.history.length, 0);
    alerts.push('unitLost', 40, 50, 'Light Tank lost');
    const lossBox = box.children.find(el => el.id === 'lossAlerts');
    assert.ok(lossBox?.children.length, 'a unit loss appears in the right-side alert stack');
    assert.equal(top.children.length, 0, 'loss notices leave the center HUD clear');
    const notice = lossBox.children[0];
    assert.equal(notice.children[0].textContent, 'Unit lost');
    assert.equal(notice.children[1].textContent, 'Light Tank lost');
    for (let n = 0; n < 6; n++) alerts.push('event', 80 + n, 90, `Tip ${n}`);
    assert.equal(box.children[0], lossBox, 'loss notices remain above routine tips on the right');
    assert.ok(alerts.lines.includes('Light Tank lost'), 'routine messages cannot evict a loss notice');
    assert.deepEqual(alerts.newest(), { x: 40, z: 50 }, 'Space prioritizes the visible unit loss over tips');
    notice.onkeydown({ code: 'Enter', preventDefault() {}, stopPropagation() {} });
    assert.deepEqual(jumps.at(-1), [40, 50], 'keyboard activation jumps to the loss location');
    clockMs += 9000; alerts.frame();
    assert.ok(alerts.lines.includes('Light Tank lost'), 'a loss stays readable longer than six seconds');
    clockMs += 3100; alerts.frame();
    assert.ok(!alerts.lines.includes('Light Tank lost'), 'loss notices expire after twelve seconds');
    assert.deepEqual(alerts.newest(), { x: 85, z: 90 }, 'Space returns to routine alerts when the loss expires');
    alerts.push('unitLost', 10, 20, 'Rifle Squad lost');
    alerts.push('unitLost', 30, 40, 'Medium Tank lost');
    alerts.push('unitLost', 50, 60, 'Churchill lost');
    assert.equal(lossBox.children.length, 2, 'separate losses cannot cover the battlefield with notices');
    alerts.startMatch('adapter-c');
    assert.equal(lossBox.children.length, 0, 'a new match clears prominent loss notices too');
    const unit = (id, x, flags = 0) => [id, 'tank', 0, x, 50, 0, 0, 100, 0, 0, 0, 0, flags];
    const row = (tick, units, shots = []) => ({ tick, units, points: [], shots });
    alerts.snapshot(row(40, []), row(20, [unit(1, 40)]));
    alerts.snapshot(row(60, []), row(40, [unit(2, 45)]));
    assert.deepEqual(alerts.lines, ['2 units lost'], 'nearby deaths still merge into one prominent notice');
    assert.equal(lossBox.children.length, 1);
    alerts.startMatch('adapter-d');
    alerts.snapshot(row(40, []), row(20, [unit(1, 2, 1)]));
    assert.deepEqual(alerts.lines, [], 'a retreating unit reaching home is not reported destroyed');
    alerts.snapshot(row(60, [], [{ t: 2, kill: true }]), row(40, [unit(2, 2, 1)]));
    assert.equal(lossBox.children.length, 1, 'a confirmed kill still raises a loss notice near home');
  } finally {
    audio.alert = savedAlert;
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
  }
}

Object.assign(process.env, { PORT: '0', EDIT_PASSWORD: 'test', PUBLIC_URL: 'http://test' });
const server = await import('./server.js'); clearInterval(server.loop);
if (!server.server.listening) await new Promise(resolve => server.server.once('listening', resolve));
let clockNow = Date.now(); server.clock.now = () => clockNow;
const clients = [], settle = () => new Promise(resolve => setTimeout(resolve, 15));
async function waitFor(fn) { for (let n = 0; n < 500; n++) { const result = fn(); if (result) return result; await settle(); } assert.fail('missing server message'); }
async function connect(token) {
  const ws = new WebSocket(`ws://127.0.0.1:${server.server.address().port}/ws?room=jobtest`), messages = [], rows = new Map();
  const c = { ws, messages, latest: t => messages.filter(m => m.t === t).at(-1), async send(m) { ws.send(JSON.stringify(m)); await settle(); } }; clients.push(c);
  ws.on('message', raw => { const m = JSON.parse(raw); if (m.t === 'start' || m.all) rows.clear(); if (m.t === 's') { for (const id of m.gone ?? []) rows.delete(id); for (const row of m.units) rows.set(row[0], row); m.units = [...rows.values()]; } messages.push(m); });
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  await c.send({ t: 'hello', name: token, token }); await waitFor(() => c.latest('lobby')); return c;
}
async function tick(n = 4) { for (let i = 0; i < n; i++) server.tickRooms(); await settle(); }
async function deny(c, command, reason) { clockNow += 1100; const before = c.messages.length; await c.send(command); assert.equal((await waitFor(() => c.messages.slice(before).find(m => m.t === 'deny'))).reason, reason); }
try {
  let host = await connect('host'), rival = await connect('rival');
  await host.send({ t: 'mode', v: 'classic' }); await host.send({ t: 'weather', v: 'clear' }); await host.send({ t: 'start' }); await waitFor(() => host.latest('start'));
  const g = server.rooms.get('jobtest').game, b = own(g, 0, 'hq');
  // Exercise the fuel producer without waiting on unrelated construction in this queue acceptance fixture.
  b.type = 'motorpool'; g.players[0].mp = 10000; g.players[0].fuel = 10000;
  for (const u of g.units.values()) Object.assign(u, { holdFire: true, auto: false });
  for (const type of ['tank', 'tank', 'tank', 'at']) await host.send({ t: 'buy', unit: type, from: b.id });
  await tick();
  const before = host.latest('s'), jobs = jobsOf(before, b.id), q = before.queues.find(row => row[0] === b.id);
  assert.equal(jobs.length, 4); assert.equal(jobsOf(rival.latest('s'), b.id).length, 0);
  await deny(rival, { t: 'cancelProduction', id: b.id, job: jobs[2].id }, 'unseen');
  await deny(host, { t: 'cancelProduction', id: b.id, job: jobs[0].id }, 'notWaiting');
  await host.send({ t: 'cancelProduction', id: b.id, job: jobs[2].id }); await tick();
  const after = host.latest('s');
  assert.deepEqual(jobsOf(after, b.id).map(job => job.id), [jobs[0].id, jobs[1].id, jobs[3].id]);
  assert.ok(after.queues.find(row => row[0] === b.id)[1] >= q[1], 'cancellation preserves delivered head progress');
  assert.ok(Math.abs(after.mp - before.mp - jobs[2].mp) <= 1); assert.ok(Math.abs(after.fuel - before.fuel - jobs[2].fuel) <= 1);
  await deny(host, { t: 'cancelProduction', id: b.id, job: jobs[2].id }, 'notWaiting'); await tick();
  assert.ok(host.latest('s').mp - after.mp < 2, 'duplicate request cannot refund again');
  const retained = jobsOf(host.latest('s'), b.id);
  host = await connect('host'); await waitFor(() => host.latest('start')); await tick();
  assert.deepEqual(jobsOf(host.latest('s'), b.id), retained, 'reconnect delivers the same authoritative IDs and charges');
  b.prog = UNITS.tank.train - 0.01; await tick();
  await deny(host, { t: 'cancelProduction', id: b.id, job: jobs[1].id }, 'notWaiting');
  g.players[0].out = true; await deny(host, { t: 'cancelProduction', id: b.id, job: jobs[3].id }, 'blocked'); g.players[0].out = false;
  g.mode.suddenDeath = true; await deny(host, { t: 'cancelProduction', id: b.id, job: jobs[3].id }, 'suddenDeath');
} finally {
  server.clock.setTimeout = () => null;
  for (const c of clients) c.ws.terminate(); for (const ws of server.wss.clients) ws.terminate();
  server.rooms.clear(); await new Promise(resolve => server.wss.close(resolve)); await new Promise(resolve => server.server.close(resolve));
}
console.log('Engine controls acceptance passed: paid queue identity/refunds, guards/reconnect, Alert history, group transfer and key chords');
