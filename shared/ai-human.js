// Human-like seat commander. The planner in ai.js still decides what to do; this module decides when the seat may
// look and how fast its orders reach command(). Each seat has a private camera. It notices damage to its own units
// on screen after a reaction delay and off screen after an alert delay, and it turns every order into the camera
// moves, clicks and keys a player would make. Difficulty sets speed and attention only: every level plans from the
// same view, with the same economy and the same command rules.
import { UNITS, command } from './sim.js';
import { think, AI_LEVELS } from './ai.js';

const TPS = 20;
// The ground the default battle camera shows (85 m away, pitched 0.95 rad, 42 degree lens, 16:9), as a box around
// its focus. A minimap right-click can send a move anywhere; everything else needs the place on screen.
export const SCREEN = { x: 55, z: 40 };
// Enemies the camera has shown stay in the planner's view this long while the fog still shows them (as dots).
export const SCREEN_MEMORY = 30;
// react   median seconds from damage on screen to the first input
// notice  median seconds from an off-screen damage alert to the first input
// input   median seconds between two inputs (camera move, selection, key, click)
// scan    median idle seconds before the camera moves to the next concern
// opening seconds spent looking at the base before the first decision
// peak, minute  input caps per 10 s and per 60 s
export const HUMAN_SKILLS = {
  easy: { react: 0.65, notice: 3.4, input: 0.62, scan: 3.6, opening: 4.6, peak: 10, minute: 34 },
  normal: { react: 0.45, notice: 1.7, input: 0.32, scan: 1.7, opening: 3.2, peak: 20, minute: 68 },
  hard: { react: 0.21, notice: 0.9, input: 0.14, scan: 0.6, opening: 2.1, peak: 33, minute: 118 },
};
const REACTION_FLOOR = 0.2, LOCAL_GAP = 5; // ticks between orders more than a screen apart
// A new fight is one damage alert per 30 m area per 20 s, the client's rule for its "under attack" line.
const AREA = 30, ATTACK_EVERY = 20 * TPS;

// Key presses each order needs before its click; orders without a click are keys only.
const KEYED = new Set(['amove', 'ability', 'dig', 'entrench', 'build', 'support', 'fireat', 'garrison', 'assist', 'stance', 'retreat', 'stop', 'cover']);
const NO_CLICK = new Set(['stance', 'retreat', 'stop', 'cover']);
const MINIMAP = new Set(['move', 'amove']);

const STATE = new WeakMap();
const skillOf = level => HUMAN_SKILLS[level] ?? HUMAN_SKILLS.normal;
const onScreen = (camera, at) => Math.abs(at.x - camera.x) <= SCREEN.x && Math.abs(at.z - camera.z) <= SCREEN.z;
const ticks = seconds => Math.max(1, Math.round(seconds * TPS));

function seeded(seed) {
  let value = seed >>> 0;
  return () => {
    let t = value += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
// Human timings are right-skewed: a log-normal around the median, clipped to a quarter and four times it.
function sample(s, median, spread = 0.35) {
  const gauss = Math.sqrt(-2 * Math.log(1 - s.rng())) * Math.cos(2 * Math.PI * s.rng());
  return median * Math.exp(Math.max(-4 * spread, Math.min(4 * spread, gauss * spread)));
}

function stateOf(g, slot, level) {
  let seats = STATE.get(g);
  if (!seats) STATE.set(g, seats = []);
  let s = seats[slot];
  if (!s) {
    const spawn = g.players[slot].spawn ?? { x: g.w * 2, z: g.h * 2 };
    s = seats[slot] = { rng: seeded((g.seed ?? 0) ^ Math.imul(slot + 1, 0x9E3779B1)), camera: { x: spawn.x, z: spawn.z },
      selection: '', inputs: [], nextInput: 0, recent: [], seen: new Map(), areas: [], pending: [], shots: null, shotsRead: 0,
      lastPlace: null, lastPlaceTick: -1e9, scan: 0, look: null, viewTick: -1 };
    s.skill = skillOf(level);
    s.look = { at: g.tick + ticks(sample(s, s.skill.opening, 0.2)), target: null, causes: [] };
  }
  s.skill = skillOf(level);
  return s;
}

// A human resumes this seat or leaves it: the next AI starts with a fresh look.
export function resetCommander(g, slot) { const seats = STATE.get(g); if (seats) delete seats[slot]; }
export const commanderCamera = (g, slot) => STATE.get(g)?.[slot]?.camera ?? null;
// Building a view copies terrain memory, so callers observe only when a look is about to plan.
export function commanderNeedsView(g, slot) {
  const s = STATE.get(g)?.[slot];
  return !s || (!!s.look && s.look.at <= g.tick + 1) || s.inputs[0]?.kind === 'plan';
}

// Call every tick for each AI seat. opts.view is the latest delivered observation; opts.onInput(input) sees each input.
export function tickCommander(g, slot, opts = {}) {
  if (g.players[slot]?.out || g.winner !== null) return;
  const s = stateOf(g, slot, opts.level);
  if (opts.view && opts.view.tick !== s.viewTick) remember(s, opts.view, slot);
  readAlerts(g, slot, s, opts);
  scheduleAlerts(s);
  if (!s.inputs.length && !s.look && opts.view) s.look = scanLook(s, opts.view, slot, g.tick);
  if (s.look && g.tick >= s.look.at) startLook(g, slot, s, opts);
  if (s.inputs.length) runInput(g, slot, s, opts);
}

// Enemies count as seen once they have been on this camera.
function remember(s, view, slot) {
  s.viewTick = view.tick;
  for (const id of view.players[slot].visible) {
    const u = view.units.get(id);
    if (u && onScreen(s.camera, u)) s.seen.set(id, view.tick);
  }
  for (const [id, t] of s.seen) if (view.tick - t > SCREEN_MEMORY * TPS) s.seen.delete(id);
}

// The damage alerts a player gets: on screen it is seen at once, off screen it is a ping to notice and look at.
function readAlerts(g, slot, s, opts) {
  if (g.shots !== s.shots) { s.shots = g.shots; s.shotsRead = 0; }
  for (; s.shotsRead < g.shots.length; s.shotsRead++) {
    const e = g.shots[s.shotsRead];
    if (e.k !== 'hurt' || e.to !== slot || !e.t || !Number.isFinite(e.x)) continue;
    s.areas = s.areas.filter(a => g.tick - a.tick < ATTACK_EVERY);
    if (s.areas.some(a => Math.hypot(a.x - e.x, a.z - e.z) <= AREA)) continue;
    s.areas.push({ x: e.x, z: e.z, tick: g.tick });
    // Each alert is noticed at its own sampled time (due). The first input decided at or after that answers it.
    const seen = onScreen(s.camera, e), due = g.tick + ticks(Math.max(REACTION_FLOOR, sample(s, seen ? s.skill.react : s.skill.notice)));
    const alert = { tick: g.tick, id: e.t, x: e.x, z: e.z, onScreen: seen, due, answered: null };
    s.pending.push(alert);
    opts.onAlert?.(alert);
  }
}

// The earliest noticed alert interrupts whatever the commander was about to do.
function scheduleAlerts(s) {
  if (!s.pending.length) return;
  const first = s.pending.reduce((a, b) => b.due < a.due ? b : a);
  if (s.look?.urgent && s.look.at <= first.due) return;
  s.look = { at: first.due, urgent: true, target: onScreen(s.camera, first) ? null : { x: first.x, z: first.z }, causes: [] };
}

// With nothing to answer, look at unidentified dots near the army first, then each army group and the base in turn.
function scanLook(s, view, slot, now) {
  const me = view.players[slot], own = [...view.units.values()].filter(u => u.owner === slot && !u.air && u.hp > 0);
  const near = p => Math.min(...own.map(u => Math.abs(u.x - p.x) + Math.abs(u.z - p.z)), Infinity);
  const dots = [...me.visible].map(id => view.units.get(id)).filter(u => u && !s.seen.has(u.id)).sort((a, b) => near(a) - near(b));
  let target = dots[0];
  if (!target) {
    const groups = new Map();
    for (const u of own) {
      const key = `${Math.floor(u.x / (2 * SCREEN.x))},${Math.floor(u.z / (2 * SCREEN.z))}`;
      const group = groups.get(key) ?? groups.set(key, { x: 0, z: 0, n: 0 }).get(key);
      group.x += u.x; group.z += u.z; group.n++;
    }
    const places = [...groups.values()].sort((a, b) => b.n - a.n).map(p => ({ x: p.x / p.n, z: p.z / p.n }));
    if (me.spawn) places.push(me.spawn);
    target = places[s.scan++ % Math.max(1, places.length)];
  }
  return { at: now + ticks(sample(s, s.skill.scan, 0.5)), target: target ? { x: target.x, z: target.z } : null, causes: [] };
}

// A due look moves the camera if it has to, then plans. An urgent look drops what the hands were still doing.
function startLook(g, slot, s, opts) {
  const look = s.look;
  s.look = null;
  if (look.urgent) {
    look.causes = s.pending.filter(a => a.due <= g.tick);
    s.pending = s.pending.filter(a => a.due > g.tick);
    for (const input of s.inputs) for (const alert of input.causes ?? []) if (alert.answered === null && !look.causes.includes(alert)) look.causes.push(alert);
    // The interrupted orders resume after the answer, like a player going back to what they were doing.
    look.resume = s.inputs.filter(input => input.cmd).map(input => ({ cmd: input.cmd, origin: input.origin }));
    s.inputs = [];
  }
  if (look.target && !onScreen(s.camera, look.target)) s.inputs.push({ kind: 'camera', x: look.target.x, z: look.target.z, origin: g.tick, causes: look.causes });
  s.inputs.push({ kind: 'plan', causes: look.causes, resume: look.resume ?? [] });
}

function planNow(g, slot, s, opts, { causes, resume }) {
  if (!opts.view) return;
  const orders = [], view = screenView(s, opts.view, slot);
  think(g, slot, { view, level: opts.level, submit: cmd => { orders.push(cmd); } });
  for (const alert of causes ?? []) if (onScreen(s.camera, alert)) { const answer = fightResponse(view, slot, alert, opts.level, orders); if (answer) orders.push(answer); }
  const cursor = { camera: s.camera, selection: s.selection };
  const start = s.inputs.length;
  for (const cmd of orders) for (const input of inputsFor(cursor, cmd, opts.view)) s.inputs.push({ ...input, origin: g.tick });
  if (s.inputs.length > start) s.inputs[start].causes = causes;
  // Interrupted orders for units the new decision did not touch go back on the queue.
  const ordered = new Set(orders.flatMap(unitsOf));
  for (const { cmd, origin } of resume) if (!unitsOf(cmd).some(id => ordered.has(id)))
    for (const input of inputsFor(cursor, cmd, opts.view)) s.inputs.push({ ...input, origin });
}

// The planner sees its own side whole, but enemy units only once this camera has shown them.
function screenView(s, view, slot) {
  const me = view.players[slot], units = new Map();
  for (const [id, u] of view.units) if (!me.visible.has(id) || s.seen.has(id)) units.set(id, u);
  const visible = new Set([...me.visible].filter(id => s.seen.has(id)));
  const players = view.players.map((p, i) => i === slot ? { ...p, visible } : p);
  if (view.players[-1]) players[-1] = view.players[-1];
  return { ...view, units, players, sightings: (view.sightings ?? []).filter(e => s.seen.has(e.id)) };
}

// What a player does about a new fight in view that the plan left alone: pull a badly hurt unit back, or send the
// units on that screen that are not fighting (idle or on a plain move) at the nearest enemy the camera has shown.
// A fight already being fought needs no input.
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
function fightResponse(view, slot, alert, level, orders) {
  const u = view.units.get(alert.id), def = u && UNITS[u.type], ordered = new Set(orders.flatMap(unitsOf));
  if (!u || u.owner !== slot || u.hp <= 0) return null;
  const retreat = (AI_LEVELS[level] ?? AI_LEVELS.normal).retreat;
  if (!def.structure && !u.air && !u.retreating && !ordered.has(u.id) && u.hp / (def.models * def.hpPer) < retreat) return { t: 'retreat', ids: [u.id] };
  const visible = view.players[slot].visible;
  const foe = [...visible].map(id => view.units.get(id)).filter(e => e && e.hp > 0 && !e.air && distance(e, u) <= AREA * 2)
    .sort((a, b) => distance(a, u) - distance(b, u))[0];
  if (!foe) return null;
  const idle = [...view.units.values()].filter(o => o.owner === slot && o.hp > 0 && UNITS[o.type].w && !UNITS[o.type].structure && !o.air
    && !o.retreating && !o.targetId && !o.amove && !o.build && !o.dig && !o.entrench && o.garrison < 0
    && !ordered.has(o.id) && distance(o, u) <= SCREEN.x);
  return idle.length ? { t: 'attack', ids: idle.map(o => o.id), target: foe.id } : null;
}

const unitsOf = cmd => cmd.ids ?? (Array.isArray(cmd.orders) ? cmd.orders.map(o => o[0]) : []);
const centroid = points => points.length ? { x: points.reduce((a, p) => a + p.x, 0) / points.length, z: points.reduce((a, p) => a + p.z, 0) / points.length } : null;
function placeOf(cmd, view) {
  if (Number.isFinite(cmd.x) && Number.isFinite(cmd.z)) return { x: cmd.x, z: cmd.z };
  if (Array.isArray(cmd.orders)) return centroid(cmd.orders.map(o => ({ x: o[1], z: o[2] })));
  const target = view.units.get(cmd.target ?? cmd.id);
  return target ? { x: target.x, z: target.z } : null;
}

// The inputs one order takes: look at and select its units, then the key and the click on its place.
function inputsFor(cursor, cmd, view) {
  const out = [], ids = unitsOf(cmd), place = placeOf(cmd, view);
  const look = at => { if (at && !onScreen(cursor.camera, at)) { out.push({ kind: 'camera', x: at.x, z: at.z }); cursor.camera = at; } };
  if (ids.length) {
    const key = [...ids].sort((a, b) => a - b).join(','), at = centroid(ids.map(id => view.units.get(id)).filter(Boolean));
    if (key !== cursor.selection) {
      look(at);
      out.push({ kind: 'select', ids, ...(at ?? cursor.camera) });
      cursor.selection = key;
    }
  }
  if (place && !MINIMAP.has(cmd.t)) look(place);
  if (KEYED.has(cmd.t)) out.push({ kind: 'key', ...(place ?? cursor.camera) });
  if (!NO_CLICK.has(cmd.t)) out.push({ kind: 'click', minimap: !!place && !onScreen(cursor.camera, place), ...(place ?? cursor.camera) });
  out[out.length - 1].cmd = cmd;
  return out;
}

// One input at most per tick, spaced by the motor time and held under the 10 s and 60 s caps.
function runInput(g, slot, s, opts) {
  const now = g.tick;
  // A look plans from a view delivered after it began, never from older news.
  while (s.inputs[0]?.kind === 'plan') {
    const marker = s.inputs[0];
    if (!opts.view || opts.view.tick < (marker.ready ??= now)) return;
    s.inputs.shift(); planNow(g, slot, s, opts, marker);
  }
  if (!s.inputs.length || now < s.nextInput) return;
  while (s.recent.length && now - s.recent[0] >= 60 * TPS) s.recent.shift();
  let peak = 0;
  for (let i = s.recent.length - 1; i >= 0 && now - s.recent[i] < 10 * TPS; i--) peak++;
  if (peak >= s.skill.peak || s.recent.length >= s.skill.minute) return;
  const input = s.inputs[0], place = input.cmd && placeOf(input.cmd, opts.view ?? g);
  if (place && s.lastPlace && !onScreen(s.lastPlace, place) && now - s.lastPlaceTick < LOCAL_GAP) return;
  s.inputs.shift();
  if (input.kind === 'camera') s.camera = { x: input.x, z: input.z };
  else if (input.kind === 'select') s.selection = [...input.ids].sort((a, b) => a - b).join(',');
  let reason;
  if (input.cmd) {
    reason = command(g, slot, input.cmd);
    if (place) { s.lastPlace = place; s.lastPlaceTick = now; }
  }
  for (const alert of input.causes ?? []) if (input.origin >= alert.due) alert.answered ??= now;
  s.recent.push(now);
  s.nextInput = now + ticks(sample(s, s.skill.input));
  opts.onInput?.({ tick: now, origin: input.origin, kind: input.kind, x: input.x, z: input.z, ids: input.ids, cmd: input.cmd, accepted: input.cmd ? !reason : undefined, camera: { ...s.camera } });
}
