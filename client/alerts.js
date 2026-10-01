// Alerts: short notices to your side that something needs attention (DESIGN.md, CONTEXT.md "Alert").
// Worked out here from two snapshots in a row, using only what the server already sends you (your own and
// allied units, shots that touch your side, public points and strikes), so nothing under fog leaks.
// Each alert is one line in a short list above the minimap (newest on top, gone after ~6 s), a ping on the
// minimap at the spot and a sound. Space jumps to the newest one; clicking a line does the same.
import { UNITS, SUPPORT } from '/shared/sim.js';
import { audio } from './audio.js';

const LIFE = 6;             // seconds a line stays up
const FADE = 0.6;           // last part of that it spends fading out
const MAX_LINES = 4;
const ATTACK_EVERY = 20;    // "under attack" at most once per this many seconds per area
const AREA = 30;            // metres: what counts as the same area (and what groups hits or losses into one line)
const MERGE = 2;            // seconds: a loss this soon after another nearby one joins its line
const SOUND_GAP = 1.5;      // seconds between two sounds of the same kind
const AIR_MARGIN = 25;      // metres beyond a strike's reach that still concern you
const HOME_RADIUS = 20;     // a retreating unit that vanishes this close to home went home, it didn't die
const QUIET_ON_SCREEN = true; // no "under attack" for a fight you are looking at (it can fire once you look away)
// support that is not an air threat: barrages are support but not aircraft (CONTEXT.md), fighter cover only defends
const NOT_AIR = new Set(['artillery', 'smoke', 'cover']);

// minimap ping color per kind: signal red for danger, brass for a point won, the HUD's text color for the rest
const RED = '#d4574a', BRASS = '#d6b25e', CHALK = '#e2dfd3';
const COLOR = { attack: RED, unitLost: RED, pointLost: RED, air: RED, pointWon: BRASS, ready: CHALK, ping: CHALK };

const now = () => performance.now() / 1000;
const near = (a, b, r) => Math.hypot(a.x - b.x, a.z - b.z) <= r;

let hooks = null, box = null;
let lines = [];        // newest first: { kind, text, x, z, born, el, n }
let quiet = [];        // areas that just had an "under attack": { x, z, until }
let lastSound = {};

// hooks from main.js:
//   me() my slot; friend(slot) true for me and teammates; unitName(type, owner); playerName(slot)
//   pointPos(i) world {x, z} of point i; home() my spawn {x, z}; onScreen(x, z); jump(x, z) moves the camera
function init(h) {
  hooks = h;
  box = document.getElementById('alerts');
  if (!box) { // the HUD markup lost it: put it back next to the minimap
    box = document.createElement('div'); box.id = 'alerts';
    const mm = document.getElementById('minimap');
    (mm?.parentNode ?? document.body).insertBefore(box, mm ?? null);
  }
  box.addEventListener('mousedown', (e) => {
    const el = e.target.closest?.('.alert'), a = el && lines.find(l => l.el === el);
    if (!a) return;
    e.stopPropagation(); e.preventDefault();
    hooks.jump(a.x, a.z);
  });
  addEventListener('resize', place);
}

function reset() {
  lines.forEach(a => a.el?.remove());
  lines = []; quiet = []; lastSound = {};
  hooks?.resetPings?.();
}

// sit just above the minimap, wherever the HUD puts it
function place() {
  const mm = document.getElementById('minimap'), r = mm?.getBoundingClientRect();
  if (!box || !r?.width) return;
  box.style.right = Math.max(0, Math.round(innerWidth - r.right)) + 'px';
  box.style.bottom = Math.max(0, Math.round(innerHeight - r.top + 5 + 8)) + 'px'; // clear the minimap's 5 px frame, then an 8 px gap
}

function sound(kind) {
  const t = now();
  if (t - (lastSound[kind] ?? -1e9) < SOUND_GAP) return;
  lastSound[kind] = t;
  audio.alert(kind);
}

function push(kind, text, x, z, n = 1) {
  const el = document.createElement('div');
  el.className = 'alert k-' + kind;
  el.textContent = text;
  el.title = 'Space or click: look there';
  const a = { kind, text, x, z, born: now(), el, n };
  lines.unshift(a);
  box?.prepend(el);
  while (lines.length > MAX_LINES) lines.pop().el.remove();
  place();
  if (kind !== 'ping') sound(kind);
  return a;
}

// cluster spots that are within AREA of the first one in each group
function groups(list) {
  const out = [];
  for (const it of list) {
    const g = out.find(g => near(g[0], it, AREA));
    if (g) g.push(it); else out.push([it]);
  }
  return out;
}
const mid = (g) => ({ x: g.reduce((s, v) => s + v.x, 0) / g.length, z: g.reduce((s, v) => s + v.z, 0) / g.length });

function underAttack(at, text) {
  const t = now();
  quiet = quiet.filter(q => q.until > t);
  if (quiet.some(q => near(q, at, AREA))) return;
  if (QUIET_ON_SCREEN && hooks.onScreen(at.x, at.z)) return; // you can see it; no cooldown, so it fires once you look away
  quiet.push({ x: at.x, z: at.z, until: t + ATTACK_EVERY });
  push('attack', text, at.x, at.z);
}

// Compare this snapshot with the one before it and raise whatever alerts follow.
function snapshot(s, prev) {
  if (!hooks) return;
  if (!prev) { reset(); return; } // first snapshot of a match (or after a reconnect): nothing to compare yet
  const me = hooks.me(), friend = (slot) => slot >= 0 && hooks.friend(slot);
  if (s.winner != null || s.out?.[me]) return;
  const before = new Map(prev.units.map(u => [u[0], u]));
  const after = new Map(s.units.map(u => [u[0], u]));
  const shotsAt = new Map();
  for (const sh of s.shots ?? []) if (sh.t) { if (!shotsAt.has(sh.t)) shotsAt.set(sh.t, []); shotsAt.get(sh.t).push(sh); }
  const nameOf = (type, owner) => (owner === me ? '' : 'Allied ') + hooks.unitName(type, owner);

  // under attack: your units and buildings, an allied HQ or bunker, losing health to something that isn't friendly
  const hits = [];
  for (const [id, u] of after) {
    const p = before.get(id), [, type, owner, x, z, , , hp] = u, def = UNITS[type];
    if (!p || !def || p[2] !== owner || hp >= p[7]) continue;
    if (owner !== me && !(friend(owner) && (type === 'hq' || type === 'bunker'))) continue;
    const by = shotsAt.get(id) ?? [];
    if (by.length && by.every(q => q.fo != null && friend(q.fo))) continue; // your own side's fire
    if (!by.length && s.mode?.suddenDeath && def.produces) continue;         // Sudden Death crumbling, not an enemy
    hits.push({ type, owner, x, z });
  }
  for (const g of groups(hits)) {
    const big = g.find(h => UNITS[h.type].structure);
    const text = big ? `${nameOf(big.type, big.owner)} under attack`
      : g.length === 1 ? `${nameOf(g[0].type, g[0].owner)} under attack` : 'Units under attack';
    underAttack(big ?? mid(g), text);
  }

  // points: captured, lost, or an enemy standing on one of yours
  s.points.forEach(([owner, , prog], i) => {
    const was = prev.points[i], at = hooks.pointPos(i);
    if (!was || !at) return;
    const had = friend(was[0]), has = friend(owner);
    if (had && !has) push('pointLost', 'Point lost', at.x, at.z);
    else if (!had && has) push('pointWon', owner === me ? 'Point captured' : `${hooks.playerName(owner)} captured a point`, at.x, at.z);
    else if (has && prog < was[2]) underAttack(at, 'Point under attack');
    else if (has && s.points[i][4] && !was[4]) push('pointLost', 'Point cut off: it pays nothing until the road to it is open', at.x, at.z);
  });

  // unit lost: one of yours left the snapshot (your units are always in it while they exist)
  const gone = [];
  for (const [id, p] of before) {
    if (after.has(id)) continue;
    const [, type, owner, x, z, , , , , , , , flags, , built] = p;
    if (owner !== me || !UNITS[type]) continue;
    if (!shotsAt.get(id)?.some(q => q.kill)) {
      if ((built ?? 1) < 1) continue; // a site you cancelled
      const home = hooks.home();
      if (flags & 1 && home && near({ x, z }, home, HOME_RADIUS)) continue; // retreated off the field, not killed
    }
    gone.push({ type, x, z });
  }
  for (const g of groups(gone)) {
    const at = mid(g), t = now();
    const recent = lines.find(a => a.kind === 'unitLost' && t - a.born < MERGE && near(a, at, AREA));
    const n = g.length + (recent?.n ?? 0);
    const text = n > 1 ? `${n} units lost` : UNITS[g[0].type].structure ? `${hooks.unitName(g[0].type, me)} destroyed` : `${hooks.unitName(g[0].type, me)} lost`;
    if (recent) { lines.splice(lines.indexOf(recent), 1); recent.el.remove(); }
    push('unitLost', text, at.x, at.z, n);
  }

  // enemy Air Support incoming: a new enemy strike mark (strikes are public) near anything of your side's
  const seen = new Set((prev.strikes ?? []).map(([kind, x, z]) => `${kind},${x},${z}`));
  for (const [kind, x, z, , , owner] of s.strikes ?? []) {
    if (seen.has(`${kind},${x},${z}`) || NOT_AIR.has(kind) || friend(owner)) continue;
    const sp = SUPPORT[kind], reach = (sp?.len ? sp.len / 2 : sp?.radius ?? 20) + AIR_MARGIN, at = { x, z };
    const mine = s.units.some(u => friend(u[2]) && near({ x: u[3], z: u[4] }, at, reach))
      || s.points.some(([o], i) => friend(o) && hooks.pointPos(i) && near(hooks.pointPos(i), at, reach))
      || (hooks.home() && near(hooks.home(), at, reach));
    if (mine) push('air', `Enemy ${sp?.name ?? kind} incoming`, x, z);
  }

  // Classic: a unit out of a Production Building's queue, a building finished
  const heads = [];
  for (const [id, , , , head] of prev.queues ?? []) if (head && after.has(id)) heads.push(head);
  for (const [id, u] of after) {
    const [, type, owner, x, z] = u;
    if (owner !== me || !UNITS[type]) continue;
    const p = before.get(id);
    if (!p) {
      const i = heads.indexOf(type);
      if (i >= 0 && !UNITS[type].structure) { heads.splice(i, 1); push('ready', `${hooks.unitName(type, me)} ready`, x, z); }
    } else if (UNITS[type].building && (p[14] ?? 1) < 1 && (u[14] ?? 1) >= 1) push('ready', `${hooks.unitName(type, me)} finished`, x, z);
  }
}

// every frame: fade and drop old lines
function frame() {
  if (!lines.length) return;
  const t = now();
  for (let i = lines.length - 1; i >= 0; i--) {
    const a = lines[i], left = LIFE - (t - a.born);
    if (left <= 0) { a.el.remove(); lines.splice(i, 1); }
    else if (left < FADE) a.el.style.opacity = (left / FADE).toFixed(2);
  }
}

// minimap pings, drawn while the world -> minimap transform is set; S = minimap px per metre
function drawPings(c, S) {
  if (!lines.length) return;
  const t = now();
  c.save();
  for (const a of lines) {
    if (a.kind === 'ping') continue;
    const age = t - a.born, fade = Math.max(0, Math.min(1, (LIFE - age) / FADE));
    const ring = (rpx, alpha) => {
      c.globalAlpha = fade * alpha;
      c.beginPath(); c.arc(a.x, a.z, rpx / S, 0, Math.PI * 2);
      c.strokeStyle = '#15160f'; c.lineWidth = 4 / S; c.stroke();
      c.strokeStyle = COLOR[a.kind]; c.lineWidth = 2 / S; c.stroke();
    };
    const ph = (age % 1.2) / 1.2;
    ring(4 + ph * 14, 1 - ph); // a ring that keeps spreading out from the spot
    ring(4, 1);                // and a steady mark on it
  }
  c.restore();
}

// the newest alert still showing, for Space
const newest = () => (lines[0] ? { x: lines[0].x, z: lines[0].z } : null);
const pinging = () => lines.length > 0;

// `lines` (the texts showing, newest first) is for poking at it from devtools via window.__game.alerts
export const alerts = { init, reset, snapshot, frame, drawPings, newest, pinging, push: (kind, x, z, text) => push(kind, text, x, z), get lines() { return lines.map(a => a.text); } };
