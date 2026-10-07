// Alerts: short notices to your side that something needs attention (DESIGN.md, CONTEXT.md "Alert").
// Worked out here from two snapshots in a row, using only what the server already sends you (your own and
// allied units, shots that touch your side, public points and strikes), so nothing under fog leaks.
// Routine alerts sit above the minimap for ~6 s. Prominent unit losses stay above them on the right.
// Each has a minimap ping and sound. Space prioritizes a visible loss; clicking a notice visits its spot.
import { UNITS, SUPPORT } from '/shared/sim.js';
import { audio } from './audio.js';
import { insideKnownRegion } from '/shared/world-territories.js';
import { t as tr } from './i18n.js';
import { createAlertHistory } from './alert-history.js';

const LIFE = 6;             // seconds a line stays up
const FADE = 0.6;           // last part of that it spends fading out
const MAX_LINES = 4;
const MAX_LOSSES = 2;
const ATTACK_EVERY = 20;    // "under attack" at most once per this many seconds per area
const AREA = 30;            // metres: what counts as the same area (and what groups hits or losses into one line)
const MERGE = 2;            // seconds: a loss this soon after another nearby one joins its line
const SOUND_GAP = 1.5;      // seconds between two sounds of the same kind
const AIR_MARGIN = 25;      // metres beyond a strike's reach that still concern you
const HOME_RADIUS = 20;     // a retreating unit that vanishes this close to home went home, it didn't die
const BASE_RADIUS = 40;     // a hit this close to your spawn, or on your own HQ or bunker, is "base under attack"
const QUIET_ON_SCREEN = true; // no "under attack" for a fight you are looking at (it can fire once you look away)
// support that is not an air threat: barrages are support but not aircraft (CONTEXT.md), fighter cover only defends
const NOT_AIR = new Set(['artillery', 'smoke', 'cover']);

// minimap ping color per kind: signal red for danger, brass for a point won, the HUD's text color for the rest
const RED = '#d4574a', BRASS = '#d6b25e', CHALK = '#e2dfd3';
const COLOR = { attack: RED, base: RED, unitLost: RED, pointLost: RED, air: RED, pointWon: BRASS, ready: CHALK, ping: CHALK, event: BRASS };
const LIVES = { event: 15, base: 10, unitLost: 12 };

const now = () => performance.now() / 1000;
const near = (a, b, r) => Math.hypot(a.x - b.x, a.z - b.z) <= r;

let hooks = null, box = null, lossBox = null, historyBox = null, historyList = null;
const history = createAlertHistory(100);
let matchTime = 0;
let lines = [];        // newest first: { kind, text, x, z, born, el, n }
let quiet = [];        // areas that just had an "under attack": { x, z, until }
let lastSound = {};

// hooks from main.js:
//   me() my slot; team() my team; friend(slot) true for me and teammates; unitName(type, owner); playerName(slot)
//   pointPos(i) world {x, z} of point i; home() my spawn {x, z}; onScreen(x, z); jump(x, z) moves the camera
function init(h) {
  hooks = h;
  box = document.getElementById('alerts');
  if (!box) { // the HUD markup lost it: put it back next to the minimap
    box = document.createElement('div'); box.id = 'alerts';
    const mm = document.getElementById('minimap');
    (mm?.parentNode ?? document.body).insertBefore(box, mm ?? null);
  }
  lossBox = document.createElement('div'); lossBox.id = 'lossAlerts';
  lossBox.setAttribute('aria-live', 'assertive');
  box.prepend(lossBox);
  historyBox = document.createElement('details'); historyBox.className = 'alert-history';
  const summary = document.createElement('summary'); summary.textContent = tr('Alert history'); summary.title = tr('Open or close Alert history (Alt+H)');
  const nav = document.createElement('div'); nav.className = 'alert-history-nav';
  for (const [text, direction] of [['Previous Alert', 1], ['Next Alert', -1]]) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = tr(text); button.onclick = () => navigate(direction); nav.append(button);
  }
  historyList = document.createElement('div'); historyList.className = 'alert-history-list'; historyList.setAttribute('aria-label', tr('Alert history'));
  historyBox.append(summary, nav, historyList); box.append(historyBox); renderHistory();
  for (const container of [box, lossBox]) container.addEventListener('mousedown', (e) => {
    const el = e.target.closest?.('.alert'), a = el && lines.find(l => l.el === el);
    if (!a) return;
    e.stopPropagation(); e.preventDefault();
    if (a.x != null) hooks.jump(a.x, a.z);
  });
  addEventListener('resize', place);
}

function reset() {
  lines.forEach(a => a.el?.remove());
  lines = []; quiet = []; lastSound = {}; history.reset(); matchTime = 0; renderHistory();
  hooks?.resetPings?.();
}

function startMatch(id) {
  if (!history.start(id)) return;
  lines.forEach(a => a.el?.remove()); lines = []; quiet = []; lastSound = {}; matchTime = 0;
  if (historyBox) historyBox.open = false;
  renderHistory();
}
const matchClock = time => `${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, '0')}`;
function renderHistory() {
  if (!historyList) return;
  const entries = history.entries, focused = document.activeElement?.dataset?.alertId;
  if (!entries.length) { historyList.textContent = tr('No Alerts yet'); return; }
  historyList.replaceChildren(...entries.map(a => {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'alert-history-entry k-' + a.kind;
    button.dataset.alertId = a.id;
    button.textContent = `${matchClock(a.time)} · ${a.text}`;
    button.setAttribute('aria-label', tr(`Alert at ${matchClock(a.time)}: ${a.text}`));
    button.setAttribute('aria-current', String(history.selected === a.id));
    button.title = a.x == null ? tr('No recorded location') : tr(`Recorded location: ${a.x.toFixed(1)}, ${a.z.toFixed(1)}`);
    button.onclick = () => { const entry = history.select(a.id); visit(entry); renderHistory(); };
    return button;
  }));
  if (focused) historyList.querySelector(`[data-alert-id="${focused}"]`)?.focus();
}
function visit(entry) { if (entry && Number.isFinite(entry.x) && Number.isFinite(entry.z)) hooks?.jump(entry.x, entry.z); }
function toggleHistory() { if (historyBox) { historyBox.open = !historyBox.open; place(); } }
function navigate(direction) {
  const entry = history.navigate(direction); visit(entry);
  if (historyBox) historyBox.open = true;
  renderHistory(); place(); return entry;
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
  text = tr(text);
  if (kind === 'unitLost') {
    const heading = document.createElement('span'); heading.className = 'loss-heading'; heading.textContent = tr('Unit lost');
    const detail = document.createElement('span'); detail.className = 'loss-detail'; detail.textContent = text;
    const hint = document.createElement('span'); hint.className = 'loss-hint'; hint.textContent = tr('Space or click: look there');
    el.append(heading, detail, hint);
  } else el.textContent = text;
  el.title = tr('Space or click: look there');
  el.tabIndex = 0; el.setAttribute('role', 'button');
  el.onkeydown = e => { if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); e.stopPropagation(); if (x != null) hooks?.jump(x, z); } };
  history.add({ kind, text, x, z, time: Math.max(matchTime, hooks?.matchTime?.() ?? 0) }); renderHistory();
  const a = { kind, text, x, z, born: now(), el, n };
  lines.unshift(a);
  const loss = kind === 'unitLost';
  if (loss) lossBox?.prepend(el);
  else if (box) box.insertBefore(el, lossBox?.nextSibling ?? null);
  const visible = lines.filter(a => (a.kind === 'unitLost') === loss), limit = loss ? MAX_LOSSES : MAX_LINES;
  while (visible.length > limit) {
    const old = visible.pop(); lines.splice(lines.indexOf(old), 1); old.el.remove();
  }
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

function underAttack(at, text, kind = 'attack') {
  const t = now();
  quiet = quiet.filter(q => q.until > t);
  if (quiet.some(q => near(q, at, AREA))) return;
  if (QUIET_ON_SCREEN && hooks.onScreen(at.x, at.z)) return; // you can see it; no cooldown, so it fires once you look away
  quiet.push({ x: at.x, z: at.z, until: t + ATTACK_EVERY });
  push(kind, text, at.x, at.z);
}

// Compare this snapshot with the one before it and raise whatever alerts follow.
function snapshot(s, prev) {
  if (!hooks) return;
  if (!history.acceptTick(s.tick)) return; // duplicate or old retained snapshots never redeliver Alerts
  matchTime = s.tick / 20;
  const me = hooks.me(), friend = (slot) => slot >= 0 && hooks.friend(slot);
  if (s.winner != null || s.out?.[me]) return;
  // the map's scripted events (triggers) speak to everyone
  for (const sh of s.shots ?? []) if (sh.k === 'say') push('event', sh.localized?.[document.documentElement?.lang ?? 'en'] ?? sh.text, sh.x, sh.z);
  if (!prev) return; // direct events need no baseline; reconnect begins a fresh comparison for state changes
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
    const at = big ?? mid(g), home = hooks.home();
    if (home && (near(at, home, BASE_RADIUS) || big?.owner === me)) underAttack(at, 'Our base is under attack!', 'base');
    else underAttack(at, text);
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

  // Region ownership is a team id. Compare only regions present in both received snapshots.
  if (s.world) {
    const oldRegions = new Map((prev.world?.regions ?? []).map(r => [r.id, r]));
    const home = s.world.home ?? s.home, oldHome = prev.world?.home ?? prev.home;
    const homeTeam = (regions, at) => at && regions.find(r => r.team >= 0 && insideKnownRegion(r,{x:at[0],z:at[1]}))?.team;
    const team = hooks.team?.() ?? homeTeam(s.world.regions ?? [], home) ?? homeTeam(prev.world?.regions ?? [], oldHome);
    for (const r of s.world.regions ?? []) {
      const was = oldRegions.get(r.id);
      if (!was || !Number.isFinite(r.x) || !Number.isFinite(r.z)) continue;
      const had = team !== undefined && was.team === team, has = team !== undefined && r.team === team;
      if (had && !has) push('pointLost', `Region lost: ${r.name}`, r.x, r.z);
      else if (!had && has) push('pointWon', `Region claimed: ${r.name}`, r.x, r.z);
      else if (r.contested && !was.contested && (has || friend(r.capper)))
        push('attack', `Claim contested: ${r.name}`, r.x, r.z);
      else if (has && (r.progress < was.progress || (r.capper >= 0 && !friend(r.capper))))
        underAttack(r, `Region under attack: ${r.name}`);
    }
  }

  // unit lost: one of yours left the snapshot (your units are always in it while they exist)
  const gone = [];
  for (const [id, p] of before) {
    if (after.has(id)) continue;
    const [, type, owner, x, z, , , , , , , , flags, , built] = p;
    if (owner !== me || !UNITS[type] || type === 'truck') continue;
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
    const a = lines[i], left = (LIVES[a.kind] ?? LIFE) - (t - a.born);
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
    if (a.kind === 'ping' || a.x == null) continue;
    const age = t - a.born, fade = Math.max(0, Math.min(1, ((LIVES[a.kind] ?? LIFE) - age) / FADE));
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

// Space gives a visible loss priority over routine tips, then visits the newest located alert.
const newest = () => { const a = lines.find(l => l.kind === 'unitLost' && l.x != null) ?? lines.find(l => l.x != null); return a ? { x: a.x, z: a.z } : null; };
const pinging = () => lines.length > 0;

// `lines` (the texts showing, newest first) is for poking at it from devtools via window.__game.alerts
export const alerts = { init, reset, startMatch, toggleHistory, navigate, get history() { return history.entries; }, snapshot, frame, drawPings, newest, pinging, push: (kind, x, z, text) => push(kind, text, x, z), get lines() { return lines.map(a => a.text); } };
