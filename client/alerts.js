// Alerts: short notices to your side that something needs attention (DESIGN.md, CONTEXT.md "Alert").
// Worked out here from two snapshots in a row, using only what the server already sends you (your own and
// allied units, shots that touch your side, public points and strikes), so nothing under fog leaks.
// Each alert is one line in a short list above the minimap (newest on top, gone after ~6 s), a ping on the
// minimap at the spot and a sound. Space jumps to the newest one; clicking a line does the same.
import { deriveAlertEvents } from '/shared/alert-events.js';
import { audio } from './audio.js';
import { t as tr } from './i18n.js';
import { createAlertHistory } from './alert-history.js';

const LIFE = 6;             // seconds a line stays up
const FADE = 0.6;           // last part of that it spends fading out
const MAX_LINES = 4;
const SOUND_GAP = 1.5;      // seconds between two sounds of the same kind

// minimap ping color per kind: signal red for danger, brass for a point won, the HUD's text color for the rest
const RED = '#d4574a', BRASS = '#d6b25e', CHALK = '#e2dfd3';
const COLOR = { attack: RED, base: RED, unitLost: RED, pointLost: RED, air: RED, pointWon: BRASS, ready: CHALK, ping: CHALK, event: BRASS };
const LIVES = { event: 15, base: 10 }; // a map's scripted message stays up long enough to read, a base alert to notice

const now = () => performance.now() / 1000;

let hooks = null, box = null, historyBox = null, historyList = null;
const history = createAlertHistory(100);
let matchTime = 0;
let lines = [];        // newest first: { kind, text, x, z, born, el, n }
let detector = {};
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
  historyBox = document.createElement('details'); historyBox.className = 'alert-history';
  const summary = document.createElement('summary'); summary.textContent = tr('Alert history'); summary.title = tr('Open or close Alert history (Alt+H)');
  const nav = document.createElement('div'); nav.className = 'alert-history-nav';
  for (const [text, direction] of [['Previous Alert', 1], ['Next Alert', -1]]) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = tr(text); button.onclick = () => navigate(direction); nav.append(button);
  }
  historyList = document.createElement('div'); historyList.className = 'alert-history-list'; historyList.setAttribute('aria-label', tr('Alert history'));
  historyBox.append(summary, nav, historyList); box.append(historyBox); renderHistory();
  box.addEventListener('mousedown', (e) => {
    const el = e.target.closest?.('.alert'), a = el && lines.find(l => l.el === el);
    if (!a) return;
    e.stopPropagation(); e.preventDefault();
    if (a.x != null) hooks.jump(a.x, a.z);
  });
  addEventListener('resize', place);
}

function reset() {
  lines.forEach(a => a.el?.remove());
  lines = []; detector = {}; lastSound = {}; history.reset(); matchTime = 0; renderHistory();
  hooks?.resetPings?.();
}

function startMatch(id) {
  if (!history.start(id)) return;
  lines.forEach(a => a.el?.remove()); lines = []; detector = {}; lastSound = {}; matchTime = 0;
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
  text = tr(text); el.textContent = text;
  el.title = tr('Space or click: look there');
  el.tabIndex = 0; el.setAttribute('role', 'button');
  el.onkeydown = e => { if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); e.stopPropagation(); if (x != null) hooks?.jump(x, z); } };
  history.add({ kind, text, x, z, time: Math.max(matchTime, hooks?.matchTime?.() ?? 0) }); renderHistory();
  const a = { kind, text, x, z, born: now(), el, n };
  lines.unshift(a);
  box?.prepend(el);
  while (lines.length > MAX_LINES) lines.pop().el.remove();
  place();
  if (kind !== 'ping') sound(kind);
  return a;
}

// The shared detector supplies the same semantic events to the UI and AI.
function snapshot(s, prev) {
  if (!hooks || !history.acceptTick(s.tick)) return;
  matchTime = s.tick / 20;
  const events = deriveAlertEvents(s, prev, { ...hooks, clock: now,
    language: () => document.documentElement?.lang ?? 'en' }, detector);
  for (const event of events) {
    if (event.mergeId) {
      const recent = lines.find(a => a.eventId === event.mergeId);
      if (recent) { lines.splice(lines.indexOf(recent), 1); recent.el.remove(); }
    }
    const line = push(event.kind, event.text, event.x, event.z, event.n);
    line.eventId = event.id;
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

// the newest alert still showing, for Space
const newest = () => { const a = lines.find(l => l.x != null); return a ? { x: a.x, z: a.z } : null; };
const pinging = () => lines.length > 0;

// `lines` (the texts showing, newest first) is for poking at it from devtools via window.__game.alerts
export const alerts = { init, reset, startMatch, toggleHistory, navigate, get history() { return history.entries; }, snapshot, frame, drawPings, newest, pinging, push: (kind, x, z, text) => push(kind, text, x, z), get lines() { return lines.map(a => a.text); } };
