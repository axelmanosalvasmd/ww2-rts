import * as THREE from 'three';
import { createHud } from './hud.js';
import { bindings, match } from './keys.js';
import { createSelection } from './selection.js';
import { createOrders } from './orders.js';
import { availability, denySentence, placementState } from './availability.js';
import { createFeedback } from './feedback.js';
import { UNITS, UNIT_TYPES, CELL, CFG, SUPPORT, SUPPORT_TYPES, BUILDABLE, levelOf, levelChar, canBuild, winVp, supCost, popCap, abCost, priceOf, FORTS, placementCheck } from '/shared/sim.js';
import { alerts } from './alerts.js';
import { rig, groundAt as marchGround } from './camera.js';
import { pings } from './pings.js';
import { label, symbolBadge, ownerRing, setOwnerRing, selectionRing, hqRing, flagMat, clickRing, capturePoint, planLayer, MOVE_COLOR } from './markers.js';
import { audio } from './audio.js';
import { battleShots, battleFrame, battleGone } from './battle-sound.js';
import { epilogue } from './epilogue.js';
import { createEffects } from './fx.js';
import { createObjectives } from './objectives.js';
import { endgame } from './endgame.js';
import { buildModel, animate, createBodies, mergeMeshes } from './unit-models.js';
import { perf, renderScale } from './perf.js';
import { renderReport } from './report.js';
import { createConnection } from './connection.js';
import { roomAddress, roomToken, matchStorage } from './room-session.js';

// Each player has a faction (names, uniforms, tanks, voice) and their own color (by slot).
const FACTIONS = [
  { name: 'USA', uniform: 0x6b7248, vehicle: 0x59623d, names: { rifle: 'Rifle Squad', mg: '.30 cal MG', at: '57mm AT Gun', tank: 'M5 Stuart', rocket: 'T34 Calliope', ranger: 'Ranger Squad', bunker: 'Command Bunker', mortar: '81mm Mortar', sniper: 'Sniper Team', armoredcar: 'M8 Greyhound', medium: 'M4 Sherman', flak: '40mm Bofors', flaktrack: 'M16 Half-track', fighter: 'P-51 Mustang', attacker: 'P-47 Thunderbolt' } },
  { name: 'Germany', uniform: 0x5c6266, vehicle: 0x50565a, names: { rifle: 'Grenadiers', mg: 'MG 42 Team', at: 'PaK 40', tank: 'Panzer II', rocket: 'Panzerwerfer', tiger: 'Tiger I', bunker: 'Command Bunker', mortar: 'GrW 34 Mortar', sniper: 'Scharfschützen', armoredcar: 'Sd.Kfz. 222', medium: 'Panzer IV', flak: 'Flak 38', flaktrack: 'Wirbelwind', fighter: 'Bf 109', attacker: 'Ju 87 Stuka' } },
  { name: 'USSR', uniform: 0x7d7250, vehicle: 0x4e5a38, names: { rifle: 'Riflemen', mg: 'Maxim MG', at: '45mm AT Gun', tank: 'T-70', rocket: 'Katyusha', conscript: 'Conscripts', bunker: 'Command Bunker', mortar: '82mm Mortar', sniper: 'Snipers', armoredcar: 'BA-64', medium: 'T-34', flak: '61-K AA Gun', flaktrack: 'ZSU-37', fighter: 'Yak-9', attacker: 'Il-2 Sturmovik' } },
];
const COLORS = [0x3b73d6, 0xcc3a2e, 0xece6d6, 0xe2832b, 0x9b5cd4, 0x35b6c0]; // grease-pencil palette: blue, red, chalk, orange, violet, cyan
let teams = [], factions = [];
const facOf = (slot) => factions[slot] ?? slot % 3;
const look = (slot) => ({ ...FACTIONS[facOf(slot)], color: COLORS[slot] ?? 0xdddddd });
const foe = (slot) => (teams[slot] ?? slot) !== (teams[me] ?? me);
// planes fly this high over the ground (one altitude for all)
const AIR_ALT = 20;
const isAir = (type) => !!UNITS[type]?.air;
const classicMode = () => lobbyState?.mode === 'classic';
const isVeh = (type) => !UNITS[type].infantry;
const barY = (type) => (isAir(type) ? AIR_ALT + 2.5 : type === 'bunker' || type === 'hq' || type === 'barracks' || type === 'motorpool' ? 7.5 : type === 'depot' ? 4.5 : type === 'tiger' || type === 'medium' ? 4.2 : isVeh(type) ? 3.4 : 2.4);
const css = (c) => '#' + c.toString(16).padStart(6, '0');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const $ = (id) => document.getElementById(id);
const tryStore = (fn) => { try { return fn(); } catch { return null; } };

// ---------- networking ----------

const EDIT = new URLSearchParams(location.search).has('edit'); // /?edit opens the map editor instead of a match

// the bare link always lands in the same room, so friends can keep one bookmark; #code picks any other room
const MAIN_ROOM = 'main';
const address = roomAddress(location.hash, MAIN_ROOM), { room, seat } = address;
if (location.hash !== address.hash) history.replaceState(null, '', location.pathname + location.search + address.hash);
const roomLink = (base) => base + (room === MAIN_ROOM ? '/' : '/#' + room);
addEventListener('hashchange', () => location.reload()); // edited the #code by hand: go to that room
// A room keeps its seat across tabs; an explicit seat suffix lets another person use this browser.
const local = tryStore(() => localStorage), session = tryStore(() => sessionStorage);
const token = roomToken({ room, seat, local, session, create: () => Math.random().toString(36).slice(2) + Date.now().toString(36) });
const matchMemory = matchStorage(token, local, session);
$('name').value = tryStore(() => localStorage.getItem('ww2-name')) || 'Soldier' + Math.floor(Math.random() * 90 + 10);
$('link').value = roomLink(location.origin);
$('roomCode').value = room;
// Room box: type a code to join (or make) that room; New room makes a private one
const goRoom = (code) => { code = code.trim().toLowerCase(); if (!/^[a-z0-9]{3,12}$/.test(code)) { $('roomCode').value = room; return; } location.hash = roomAddress('#' + code + (seat ? '&seat=' + seat : ''), MAIN_ROOM).hash; location.reload(); };
$('joinRoom').onclick = () => goRoom($('roomCode').value);
$('roomCode').addEventListener('keydown', (e) => e.key === 'Enter' && goRoom($('roomCode').value));
$('newRoom').onclick = () => goRoom(Math.random().toString(36).slice(2, 7));

function positionRoomBanners() {
  const top = $('hud').classList.contains('hidden') ? 16 : Math.ceil($('top').getBoundingClientRect().bottom + 8);
  $('roomBanners').style.setProperty('--room-banner-top', top + 'px');
}
if (typeof ResizeObserver === 'function') new ResizeObserver(positionRoomBanners).observe($('top'));
addEventListener('resize', positionRoomBanners);
positionRoomBanners();

let me = -1, names = [], lobbyState = null, lastSnap = null, rtt = null, paused = false, seatActive = true;
let snapshotAt = 0, snapshotGap = 100;
const connection = createConnection({
  url: `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?room=${room}`,
  hello: () => ({ t: 'hello', name: $('name').value, token }),
});
setInterval(() => sendCmd({ t: 'ping', c: performance.now(), rtt }), 2000);
const sendCmd = (m) => connection.send(m);
connection.on('lobby', renderLobby);
connection.on('start', receiveStart);
connection.on('s', (m, size) => { perf.net(size); applySnapshot(m); });
connection.on('ping', (m) => pings.receive(m));
connection.on('deny', (m) => feedback.show(denySentence(m.reason)));
connection.on('pong', (m) => { if (Number.isFinite(m.c)) rtt = Math.round(performance.now() - m.c); });
connection.on('pause', receivePause);
connection.on('retry', ({ left, reason }) => {
  $('connectionBanner').textContent = reason === 'full' ? `Trying this room again in ${left} s` : `Connection lost. Retrying in ${left} s`;
  $('connectionBanner').classList.remove('hidden');
});
connection.on('connected', () => $('connectionBanner').classList.add('hidden'));
connection.on('full', (m) => {
  $('overlay').classList.remove('hidden'); $('hud').classList.add('hidden');
  $('start').classList.add('hidden'); $('addAi').classList.add('hidden'); // no seat yet: the next lobby message shows them again for whoever is host
  positionRoomBanners();
  $('lobbyMsg').textContent = m.reason === 'started' ? 'A match is running in this room. You will join when it ends.' : 'This room is full. You will join when a seat opens.';
});
connection.on('replaced', () => { seatActive = false; $('connectionBanner').classList.add('hidden'); $('replacedSeat').classList.remove('hidden'); });
connection.on('left', () => {
  seatActive = false; connection.stop(); $('overlay').classList.remove('hidden'); $('hud').classList.add('hidden');
  positionRoomBanners();
  $('lobbyMsg').textContent = 'You left the match; an AI took over your army. Reload to rejoin the lobby when the match is over.';
});
$('useSeatHere').onclick = () => { seatActive = true; $('replacedSeat').classList.add('hidden'); connection.start(); };
if (!EDIT) connection.start();

function matchView() {
  return lastStart && { matchId: lastStart.matchId, camera: { ...cam }, selected: [...selected], groups: Object.fromEntries(Object.entries(groups).map(([n, ids]) => [n, [...ids]])) };
}
function saveMatchView() {
  if (seatActive && lobbyState?.state === 'play') matchMemory.write(matchView());
}
setInterval(saveMatchView, 1000);
addEventListener('pagehide', saveMatchView);
const normalTitle = document.title;
let titleFlash = null;
function stopTitleFlash() { if (titleFlash !== null) clearInterval(titleFlash); titleFlash = null; document.title = normalTitle; }
addEventListener('focus', stopTitleFlash);
document.addEventListener('visibilitychange', () => { if (!document.hidden) stopTitleFlash(); });
function receiveStart(m) {
  const saved = m.matchId != null && lastStart?.matchId === m.matchId ? matchView() : matchMemory.read();
  const resume = m.matchId != null && saved?.matchId === m.matchId;
  startGame({ ...m, resume }, resume ? saved : null);
  saveMatchView();
  if (document.hidden && !resume) { // a new match, not the same one coming back after a drop
    stopTitleFlash(); document.title = 'Match started';
    titleFlash = setInterval(() => { document.title = document.title === normalTitle ? 'Match started' : normalTitle; }, 1000);
  }
}
function receivePause(m) {
  paused = !!m.paused;
  $('pauseBanner').classList.toggle('hidden', !paused);
  if (paused) {
    const name = typeof m.by === 'string' ? m.by : lobbyState?.players?.[m.by]?.name || names[m.by] || 'the host';
    $('pauseBanner').textContent = m.reason === 'drop' ? `Waiting for ${name} (${Math.max(0, m.left || 0)} s)` : `Paused by ${name}`;
  }
  renderMatchMenu();
}

$('name').addEventListener('change', () => { tryStore(() => localStorage.setItem('ww2-name', $('name').value)); sendCmd({ t: 'name', name: $('name').value }); });
$('copy').onclick = async () => {
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
    await navigator.clipboard.writeText($('link').value);
    $('copy').textContent = 'Copied';
  } catch { $('link').focus(); $('link').select(); $('copy').textContent = 'Press Ctrl+C'; }
  setTimeout(() => ($('copy').textContent = 'Copy'), 3000);
};
$('start').onclick = () => sendCmd({ t: 'start' });
// Fullscreen + Keyboard Lock: the browser hands Ctrl+number to the game instead of switching tabs
$('fullscreen').onclick = async () => {
  try {
    if (document.fullscreenElement) return document.exitFullscreen();
    await document.documentElement.requestFullscreen();
    await navigator.keyboard?.lock?.(['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9']);
  } catch {}
};
$('mapSel').onchange = () => sendCmd({ t: 'map', name: $('mapSel').value });
$('modeSel').onchange = () => sendCmd({ t: 'mode', v: $('modeSel').value });
// army size labels come from CFG.armies, so they cannot drift from the real numbers
$('armySel').innerHTML = Object.entries(CFG.armies).map(([key, v]) => `<option value="${esc(key)}">${esc(key[0].toUpperCase() + key.slice(1))}${v.pop === 1 && v.income === 1 ? '' : `: ${v.pop}x units, ${v.income}x income`}</option>`).join('');
$('armySel').onchange = () => sendCmd({ t: 'army', v: $('armySel').value });
$('defSel').onchange = () => sendCmd({ t: 'defender', v: +$('defSel').value });
$('addAi').onclick = () => sendCmd({ t: 'addAi' });
// The host controls the match; leaving, restarting and ending need a second click.
const menuOpen = (on) => $('menu').classList.toggle('hidden', !on);
function renderMatchMenu() {
  const host = lobbyState && lobbyState.you === lobbyState.host;
  for (const id of ['restartBtn', 'endBtn', 'pauseBtn']) $(id).classList.toggle('hidden', !host);
  $('pauseBtn').textContent = paused ? 'Resume match' : 'Pause match';
  $('offlineSeats').innerHTML = host && lobbyState.state === 'play' ? lobbyState.players.map((p, i) => !p.ai && !p.connected ? `<button data-slot="${i}">Hand ${esc(p.name)} to AI</button>` : '').join('') : '';
  $('offlineSeats').querySelectorAll('button').forEach(b => (b.onclick = () => sendCmd({ t: 'handAi', slot: +b.dataset.slot })));
}
$('menuBtn').onclick = () => { renderMatchMenu(); menuOpen($('menu').classList.contains('hidden')); };
$('pauseBtn').onclick = () => { sendCmd({ t: paused ? 'resume' : 'pause' }); menuOpen(false); };
const confirmClick = (id, label, act) => {
  let armed = 0;
  $(id).onclick = () => { if (Date.now() - armed < 3000) { act(); menuOpen(false); $(id).textContent = label; armed = 0; return; } armed = Date.now(); $(id).textContent = 'Click again to confirm'; setTimeout(() => ($(id).textContent = label), 3000); };
};
confirmClick('restartBtn', 'Restart match', () => sendCmd({ t: 'restart' }));
confirmClick('endBtn', 'End match (back to lobby)', () => sendCmd({ t: 'end' }));
confirmClick('leaveBtn', 'Leave game', () => sendCmd({ t: 'leave' }));

const MODE_INFO = {
  conquest: 'Capture and hold points to earn victory points. First side to the VP goal wins.',
  assault: 'One team defends a fortified command bunker. Everyone else attacks and must destroy it before the clock runs out.',
  annihilation: 'Every side starts with a fortified command bunker. Destroy every enemy bunker: last side standing wins. No clock.',
  classic: 'Build a base with engineers and train an army. Destroy every enemy HQ, Barracks, Motor Pool and Airfield.',
};
const prettyMap = (n) => n.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).replace(/\bXl\b/, 'XL');
// lobby map preview: terrain shaded by height, capture points, and spawns (in Assault: red defend, blue attack)
const mapCache = new Map();
async function previewMap(name, mode) {
  let m = mapCache.get(name);
  if (!m) {
    try { m = await (await fetch(`/maps/${encodeURIComponent(name)}`)).json(); } catch { return; }
    mapCache.set(name, m);
  }
  if (lobbyState?.mapName !== name) return; // the host picked another map meanwhile
  const cv = $('mapCanvas'), c = cv.getContext('2d'), s = cv.width / Math.max(m.w, m.h), ox = (cv.width - m.w * s) / 2, oy = (cv.height - m.h * s) / 2;
  const img = new ImageData(m.w, m.h);
  m.rows.forEach((row, y) => [...row].forEach((ch, x) => {
    const [r, g, b] = MM_COLORS[ch] ?? MM_COLORS['.'], k = 1 + levelOf(m.heights?.[y]?.[x] ?? '0') * 0.12, i = (y * m.w + x) * 4;
    img.data.set([r * k, g * k, b * k, 255], i);
  }));
  const tmp = document.createElement('canvas'); tmp.width = m.w; tmp.height = m.h; tmp.getContext('2d').putImageData(img, 0, 0);
  c.fillStyle = '#11110d'; c.fillRect(0, 0, cv.width, cv.height);
  c.imageSmoothingEnabled = false; c.drawImage(tmp, ox, oy, m.w * s, m.h * s);
  const at = (p) => [ox + (p.x + 0.5) * s, oy + (p.y + 0.5) * s], assault = mode === 'assault', noVp = assault || mode === 'annihilation';
  const points = m.points.filter(p => !noVp || (p.mp ?? 1) > 0);
  for (const p of points) { c.beginPath(); c.arc(...at(p), Math.max(4, CFG.pointRadius / CELL * s), 0, 7); c.strokeStyle = '#f0d98a'; c.lineWidth = 2; c.stroke(); }
  const spawns = m.spawns.map((sp, i) => [sp, i]).filter(([sp]) => assault || !sp.assault);
  for (const [sp, i] of spawns) {
    c.beginPath(); c.arc(...at(sp), 6, 0, 7);
    c.fillStyle = assault && m.defend ? (m.defend.includes(i) ? '#d94a3d' : '#3d7bd9') : '#f2ecd8'; c.fill();
    c.strokeStyle = '#111'; c.lineWidth = 2; c.stroke();
  }
  const top = Math.max(0, ...(m.heights || []).flatMap(r => [...r].map(levelOf)));
  $('mapInfo').innerHTML = [`<b style="color:var(--ink)">${esc(m.name)}</b>`, `${m.w * CELL} × ${m.h * CELL} m`, `up to ${spawns.length} players`,
    `${points.length} capture point${points.length === 1 ? '' : 's'}`, top >= 3 ? 'hills and cliffs' : top > 0 ? 'rolling hills' : '',
    m.rows.some(r => r.includes('W')) ? 'rivers' : '', m.defend ? (assault ? '<span style="color:#d94a3d">●</span> defend · <span style="color:#3d7bd9">●</span> attack' : 'built for Assault') : '',
    assault && m.assaultTime ? `${Math.round(m.assaultTime / 60)} minute clock` : ''].filter(Boolean).map(t => `<div>${t}</div>`).join('');
}

function renderLobby(m) {
  lobbyState = m; me = m.you;
  renderMatchMenu();
  // opened via localhost? friends can't use that address: hand out the public (Tailscale) one
  const local = /^(localhost|127\.|\[::1\])/.test(location.hostname);
  $('link').value = roomLink(local && m.publicUrl ? m.publicUrl : location.origin);
  $('overlay').classList.toggle('hidden', m.state === 'play');
  const n = m.players.length, host = m.you === m.host, lobby = m.state === 'lobby';
  // host sets teams (and the AIs' factions), everyone picks their own faction
  const pick = (kind, i, v, opts, can) => `<select data-kind="${kind}" data-slot="${i}" ${can && lobby ? '' : 'disabled'}>${opts.map((o, k) => `<option value="${k}" ${k === v ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
  $('roster').innerHTML = m.players.map((p, i) => {
    const kick = host && lobby && (p.ai || !p.connected) ? `<button class="kick" data-slot="${i}" title="Remove ${p.ai ? 'AI' : 'offline player'}">✕</button>` : '';
    return `<div class="slot"><span class="swatch" style="background:${css(COLORS[i])}"></span>
      <span>${esc(p.name)}${i === m.you ? ' (you)' : ''}<span class="muted">${!p.connected ? ' · offline' : ''}${i === m.host ? ' · host' : ''}</span></span>
      <span style="margin-left:auto">${pick('team', i, p.team, COLORS.map((_, k) => 'Team ' + (k + 1)), host)} ${pick('faction', i, p.faction, FACTIONS.map(f => f.name), i === m.you || (host && p.ai))}</span>${kick}</div>`;
  }).join('') + (n < COLORS.length ? '<div class="slot muted">open slot</div>' : '');
  $('roster').querySelectorAll('.kick').forEach(b => (b.onclick = () => sendCmd({ t: 'kick', slot: +b.dataset.slot })));
  $('roster').querySelectorAll('select').forEach(el => (el.onchange = () => sendCmd({ t: el.dataset.kind, slot: +el.dataset.slot, v: +el.value })));
  $('start').classList.toggle('hidden', !host || m.state === 'play');
  $('mapSel').innerHTML = (m.maps || []).map(n => `<option value="${esc(n)}" ${n === m.mapName ? 'selected' : ''}>${esc(prettyMap(n))}</option>`).join('');
  previewMap(m.mapName, m.mode || 'conquest');
  $('mapSel').disabled = !host || !lobby;
  // Assault: the host picks which team defends; everyone else attacks
  const assault = m.mode === 'assault', teamIds = [...new Set(m.players.map(p => p.team))].sort((a, b) => a - b);
  $('modeSel').value = m.mode || 'conquest'; $('modeSel').disabled = !host || !lobby;
  $('armySel').value = m.army || 'standard'; $('armySel').disabled = !host || !lobby;
  $('modeInfo').textContent = MODE_INFO[m.mode || 'conquest'] ?? '';
  $('defSel').classList.toggle('hidden', !assault);
  $('defSel').innerHTML = teamIds.map(t => `<option value="${t}" ${t === m.defenderTeam ? 'selected' : ''}>Team ${t + 1} defends (${m.players.filter(p => p.team === t).map(p => esc(p.name)).join(', ')})</option>`).join('');
  $('defSel').disabled = !host || !lobby;
  const assaultOk = !assault || (m.players.some(p => p.team === m.defenderTeam) && m.players.some(p => p.team !== m.defenderTeam));
  $('addAi').classList.toggle('hidden', !host || !lobby || n >= COLORS.length);
  // "3v3", "2v2v2", "1v1", or FFA when nobody shares a team
  const sizes = [...new Set(m.players.map(p => p.team))].map(t => m.players.filter(p => p.team === t).length);
  const mode = n === 1 ? 'solo test' : sizes.length === 1 ? 'co-op' : sizes.every(k => k === 1) && n > 2 ? `${n}-way FFA` : sizes.join('v');
  $('start').textContent = `${m.result ? 'Play again' : 'Start'}: ${assault ? 'assault' : m.mode === 'classic' || m.mode === 'annihilation' ? m.mode + ' ' + mode : mode}`;
  const tooMany = n > (m.spawns ?? 3);
  $('start').disabled = tooMany || !assaultOk;
  $('lobbyMsg').textContent = tooMany ? `This map has ${m.spawns} spawns: pick a bigger map or remove players.` : !assaultOk ? 'Assault needs players on the defending team and on another team.' : host ? (n === 1 ? 'Send the invite link, or add an AI opponent.' : '') : 'Waiting for the host to start...';
  // the last match's result, until the next one starts (the room is back in the lobby: change map or mode freely)
  const r = m.result, w = r?.winner;
  $('result').classList.toggle('hidden', !r);
  if (r) $('result').textContent = r.ended ? 'Match ended by the host' : w === -1 ? 'Draw' : w === r.teams[me] ? 'Victory'
    : `${r.names.filter((_, i) => r.teams[i] === w).join(' & ') || 'Enemy'} win${r.teams.filter(t => t === w).length > 1 ? '' : 's'}`;
  renderReport(r, $('report'), { colors: COLORS.map(css), me: m.you }); // the chart and table under it (client/report.js)
  if (lobby) { lastStart = null; matchMemory.clear(); menuOpen(false); $('hud').classList.add('hidden'); receivePause({ paused: false }); audio.end(); epilogue.reset(); }
  positionRoomBanners();
}

// ---------- renderer / scene ----------

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderScale(renderer); // pixel ratio per graphics level (client/perf.js)
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xa9b4b0);
scene.fog = new THREE.Fog(0xa9b4b0, 160, 340);
const camera = new THREE.PerspectiveCamera(42, 1, 1, 1000);
scene.add(new THREE.HemisphereLight(0xe4ecf0, 0x4a4630, 1.4));
const sun = new THREE.DirectionalLight(0xfff0d0, 2.4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -120, right: 120, top: 120, bottom: -120, near: 1, far: 500 });
scene.add(sun, sun.target);
const resize = () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); };
addEventListener('resize', resize); resize();

const matCache = new Map();
const mat = (color) => matCache.get(color) || matCache.set(color, new THREE.MeshLambertMaterial({ color })).get(color);
const GEO = {
  box: new THREE.BoxGeometry(1, 1, 1), cyl: new THREE.CylinderGeometry(1, 1, 1, 12),
  body: new THREE.CapsuleGeometry(0.3, 0.8, 4, 8), helmet: new THREE.SphereGeometry(0.27, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2),
  ring: new THREE.RingGeometry(0.85, 1, 40), plane: new THREE.PlaneGeometry(1, 1), ball: new THREE.SphereGeometry(1, 12, 8),
  shield: new THREE.ShapeGeometry(new THREE.Shape([[-0.5, 0.5], [0.5, 0.5], [0.5, 0], [0, -0.6], [-0.5, 0]].map(([x, y]) => new THREE.Vector2(x, y)))),
};
// cover shield next to the health bar, by snapshot cover state: 1 cover, 2 trench, 3 cover on one side
const COVER_LOOK = { 1: [0x7fd06a, 1], 2: [0x3fe0ff, 1], 3: [0x7fd06a, 0.45] };
const mesh = (geo, material, sx = 1, sy = 1, sz = 1, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(geo, material); m.scale.set(sx, sy, sz); m.position.set(x, y, z); m.castShadow = true; return m;
};

// ---------- world ----------

let world, MW = 0, MH = 0, fogTex, fogGrid, points = [], groundMesh = null;

// Smooth ground height: vertex heights average the cells around them, sampled bilinearly.
let field = null;
function buildField(map) {
  const w = map.w, h = map.h, lv = (x, y) => levelOf(map.heights?.[y]?.[x] ?? '0') * CFG.levelHeight;
  const vert = new Float32Array((w + 1) * (h + 1));
  for (let y = 0; y <= h; y++) for (let x = 0; x <= w; x++) {
    let sum = 0, n = 0;
    for (const [cx, cy] of [[x - 1, y - 1], [x, y - 1], [x - 1, y], [x, y]]) if (cx >= 0 && cy >= 0 && cx < w && cy < h) { sum += lv(cx, cy); n++; }
    vert[y * (w + 1) + x] = sum / n;
  }
  field = { w, h, vert };
}
function hAt(x, z) {
  if (!field) return 0;
  const fx = Math.min(field.w, Math.max(0, x / CELL)), fz = Math.min(field.h, Math.max(0, z / CELL));
  const x0 = Math.min(field.w - 1, Math.floor(fx)), z0 = Math.min(field.h - 1, Math.floor(fz)), tx = fx - x0, tz = fz - z0, W = field.w + 1, v = field.vert;
  return (v[z0 * W + x0] * (1 - tx) + v[z0 * W + x0 + 1] * tx) * (1 - tz) + (v[(z0 + 1) * W + x0] * (1 - tx) + v[(z0 + 1) * W + x0 + 1] * tx) * tz;
}
// a flat plane bent over the height field (row 0 of vertices = map row 0)
function terrainGeometry() {
  const geo = new THREE.PlaneGeometry(MW, MH, field.w, field.h), pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setZ(i, field.vert[i]);
  geo.computeVertexNormals();
  return geo;
}
const units = new Map(), selected = new Set(), groups = {}, fx = [];

let lastStart = null;
function startGame(m, restored = null) {
  pings.reset();
  me = m.you; names = m.names; teams = m.teams ?? names.map((_, i) => i); factions = m.factions ?? []; lastStart = m; mmImage = null;
  if (!EDIT) audio.start({ faction: facOf(me), slot: me });
  const map = m.map;
  if (world) scene.remove(world);
  world = new THREE.Group(); scene.add(world);
  units.clear(); selected.clear(); selection.reset();
  if (m.resume && restored) {
    for (const id of restored.selected || []) if (Number.isSafeInteger(id)) selected.add(id);
    for (const [n, ids] of Object.entries(restored.groups || {})) if (/^[1-9]$/.test(n) && Array.isArray(ids)) groups[n] = ids.filter(Number.isSafeInteger);
  }
  fx.length = 0; lastSnap = null; effects.reset(); strikeMarks.clear(); epilogue.reset(); snapshotAt = 0; snapshotGap = 100;
  objectives.reset(); endgame.reset();
  MW = map.w * CELL; MH = map.h * CELL;
  sun.position.set(MW / 2 + 70, 130, MH / 2 - 50); sun.target.position.set(MW / 2, 0, MH / 2);

  // ground: painted canvas, 8px per cell
  const px = 8, cv = document.createElement('canvas'); cv.width = map.w * px; cv.height = map.h * px;
  const c = cv.getContext('2d');
  c.fillStyle = '#6c7645'; c.fillRect(0, 0, cv.width, cv.height);
  for (let i = 0; i < 5000; i++) {
    c.fillStyle = ['#66703f', '#737d4b', '#6d6a43', '#5f6a3c', '#7a7a50'][i % 5]; c.globalAlpha = 0.35;
    const s = 4 + Math.random() * 18; c.fillRect(Math.random() * cv.width, Math.random() * cv.height, s, s * 0.6);
  }
  c.globalAlpha = 1;
  // high ground reads at a glance: drier grass per level, contour lines where the level drops
  const lvl = (x, y) => levelOf(map.heights?.[y]?.[x] ?? '0');
  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
    const L = lvl(x, y);
    // hills dry out, hollows get dark and muddy; a contour on every edge where the ground drops
    if (L > 0) { c.fillStyle = `rgba(190, 180, 110, ${0.16 * L})`; c.fillRect(x * px, y * px, px, px); }
    if (L < 0) { c.fillStyle = `rgba(55, 50, 30, ${0.22 * -L})`; c.fillRect(x * px, y * px, px, px); }
    c.fillStyle = 'rgba(45, 40, 20, 0.45)';
    if (x > 0 && lvl(x - 1, y) < L) c.fillRect(x * px, y * px, 1.5, px);
    if (x < map.w - 1 && lvl(x + 1, y) < L) c.fillRect((x + 1) * px - 1.5, y * px, 1.5, px);
    if (y > 0 && lvl(x, y - 1) < L) c.fillRect(x * px, y * px, px, 1.5);
    if (y < map.h - 1 && lvl(x, y + 1) < L) c.fillRect(x * px, (y + 1) * px - 1.5, px, 1.5);
  }
  const base = document.createElement('canvas'); base.width = cv.width; base.height = cv.height; base.getContext('2d').drawImage(cv, 0, 0);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  terrain = { w: map.w, grid: map.rows.map(r => [...r]), ctx: c, base, tex, px, group: new THREE.Group() };
  world.add(terrain.group);
  for (const [cell, ch, lv] of m.cells || []) { terrain.grid[Math.floor(cell / map.w)][cell % map.w] = ch; if (lv !== undefined) setLevel(map, cell, lv); }
  buildField(map);
  const ground = new THREE.Mesh(terrainGeometry(), new THREE.MeshLambertMaterial({ map: tex }));
  ground.rotation.x = -Math.PI / 2; ground.position.set(MW / 2, 0, MH / 2); ground.receiveShadow = true;
  world.add(ground); groundMesh = ground;

  terrain.grid.forEach((row, y) => row.forEach((_, x) => paintCell(x, y)));
  buildStructures();

  // capture points
  const assault = lobbyState?.mode === 'assault' || lobbyState?.mode === 'annihilation'; // no VP in either
  points = map.points.filter(p => !assault || (p.mp ?? 1) > 0).map((p) => {
    const g = new THREE.Group(); g.position.set((p.x + 0.5) * CELL, hAt((p.x + 0.5) * CELL, (p.y + 0.5) * CELL), (p.y + 0.5) * CELL);
    const cp = capturePoint(CFG.pointRadius, classicMode() ? `+${(p.vp ?? 1) * CFG.classic.munPerVp} Mun/s` : p.vp > 1 && !assault ? `★ ${p.vp}× VP` : `+${p.mp ?? 1} MP/s`); // Classic: points pay Munitions
    g.add(cp.group, mesh(GEO.cyl, mat(0x5a4a36), 0.07, 8, 0.07, 0, 4, 0));
    world.add(g);
    return { g, set: cp.set, frame: cp.frame };
  });

  // fog of war overlay (client-side approximation; the server decides who you can actually see)
  fogGrid = { w: map.w, h: map.h };
  fogTex = new THREE.DataTexture(new Uint8Array(map.w * map.h * 4), map.w, map.h);
  fogTex.magFilter = fogTex.minFilter = THREE.LinearFilter;
  const fog = new THREE.Mesh(ground.geometry, new THREE.MeshBasicMaterial({ map: fogTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  fog.rotation.x = -Math.PI / 2; fog.position.set(MW / 2, 0.12, MH / 2); fog.renderOrder = 1; fog.visible = !EDIT;
  world.add(fog);

  m.spawns.forEach((sp, i) => world.add(buildHQ(sp, i)));
  aimMesh = null; nodeMarks = null; coverGroup = null; ghosts.clear();

  // camera: behind my spawn, looking at the map center
  const sx = m.spawn.x, sz = m.spawn.z;
  home = m.spawn;
  if (m.resume && restored) Object.assign(cam, restored.camera);
  else {
    cam.yaw = Math.atan2(sx - MW / 2, sz - MH / 2);
    cam.x = sx + (MW / 2 - sx) * 0.25; cam.z = sz + (MH / 2 - sz) * 0.25; cam.dist = 60;
  }
  rig.startIntro(EDIT || m.resume === true);

  buildBuyBar();
  buildSupportBar();
  $('hud').classList.toggle('hidden', EDIT);
  $('overlay').classList.add('hidden');
  positionRoomBanners();
}

// ---------- terrain that can change mid-match (digging, destruction) ----------
let terrain = null;
// stable pseudo-random per cell, so rebuilding after a change doesn't reshuffle everything
const rnd = (x, y, k = 0) => { const v = Math.sin(x * 127.1 + y * 311.7 + k * 74.7) * 43758.5453; return v - Math.floor(v); };

// ground texture for one cell: base grass, then whatever is painted on that cell
function paintCell(x, y) {
  const { ctx: c, base, px, grid } = terrain, ch = grid[y][x], X = x * px, Y = y * px;
  c.drawImage(base, X, Y, px, px, X, Y, px, px);
  if (ch === '+') {
    const gr = c.createRadialGradient(X + px / 2, Y + px / 2, 0.5, X + px / 2, Y + px / 2, px * 0.7);
    gr.addColorStop(0, '#3b3526'); gr.addColorStop(0.8, '#5a4f36'); gr.addColorStop(1, 'rgba(90,79,54,0)');
    c.fillStyle = gr; c.fillRect(X, Y, px, px);
  } else if (ch === 'B') { c.fillStyle = '#6e6048'; c.fillRect(X, Y, px, px); }
  else if (ch === 'R') { c.fillStyle = '#6f665a'; c.fillRect(X, Y, px, px); c.fillStyle = '#4f483f'; c.fillRect(X + 1, Y + 2, 3, 2); c.fillRect(X + 5, Y + 5, 2, 2); }
  else if (ch === 'W' || ch === '=') {
    c.fillStyle = '#3c5d70'; c.fillRect(X, Y, px, px);
    c.fillStyle = 'rgba(170, 200, 210, 0.35)'; c.fillRect(X + rnd(x, y) * 5, Y + 2 + rnd(x, y, 1) * 4, 3, 1);
  } else if (ch === 'F') { c.fillStyle = '#6a7f7a'; c.fillRect(X, Y, px, px); c.fillStyle = 'rgba(200,215,210,0.3)'; c.fillRect(X + 2, Y + 3, 4, 1); }
  else if (ch === 'X') { c.fillStyle = '#5d5a40'; c.fillRect(X, Y, px, px); }
  else if (ch === 'Y') { c.fillStyle = '#5e5d4c'; c.fillRect(X, Y, px, px); }
  else if (ch === 'T') { c.fillStyle = '#3e3222'; c.fillRect(X, Y, px, px); c.fillStyle = '#2c2418'; c.fillRect(X + 2, Y + 2, px - 4, px - 4); }
}

// all 3D terrain pieces, rebuilt from the grid whenever a cell changes
function buildStructures() {
  const { grid, group, w } = terrain;
  for (const o of group.children) if (o.userData.merged) o.geometry.dispose();
  group.clear();
  const cells = { B: [], H: [], '#': [], '=': [], R: [], X: [], Y: [] };
  grid.forEach((row, y) => row.forEach((ch, x) => cells[ch]?.push([x, y])));
  const inst = (list, color, fn, per = 1) => {
    const im = new THREE.InstancedMesh(GEO.box, new THREE.MeshLambertMaterial({ color: 0xffffff }), list.length * per);
    const m4 = new THREE.Matrix4(), col = new THREE.Color();
    list.forEach((cell, i) => {
      for (let k = 0; k < per; k++) {
        const [sx, sy, sz, y, tint, base, ox = 0, oz = 0] = fn(cell, k), cx = (cell[0] + 0.5) * CELL + ox, cz = (cell[1] + 0.5) * CELL + oz;
        m4.makeScale(sx, sy, sz).setPosition(cx, y + (base ?? hAt(cx, cz) - 0.2), cz);
        im.setMatrixAt(i * per + k, m4); im.setColorAt(i * per + k, col.set(color).multiplyScalar(tint));
      }
    });
    im.castShadow = im.receiveShadow = true; group.add(im);
  };
  // houses: flood-fill into components, one floor level + roof each
  const comp = new Map(), houses = [];
  for (const [x, y] of cells.B) {
    if (comp.has(y * w + x)) continue;
    const h = { cells: [], height: 4 + rnd(x, y, 2) * 3, tint: 0.8 + rnd(x, y, 3) * 0.35 }, q = [[x, y]];
    comp.set(y * w + x, h);
    while (q.length) {
      const [cx, cy] = q.pop(); h.cells.push([cx, cy]);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (grid[ny]?.[nx] === 'B' && !comp.has(ny * w + nx)) { comp.set(ny * w + nx, h); q.push([nx, ny]); }
      }
    }
    // the lowest corner, so nothing floats on a slope
    h.base = Math.min(...h.cells.map(([cx, cy]) => Math.min(hAt(cx * CELL, cy * CELL), hAt((cx + 1) * CELL, cy * CELL), hAt(cx * CELL, (cy + 1) * CELL), hAt((cx + 1) * CELL, (cy + 1) * CELL))));
    houses.push(h);
  }
  inst(cells.B, 0xb8a888, ([x, y]) => { const h = comp.get(y * w + x); return [CELL, h.height + 1, CELL, (h.height + 1) / 2, h.tint, h.base - 1]; });
  const roofs = [];
  for (const h of houses) {
    const xs = h.cells.map(c => c[0]), ys = h.cells.map(c => c[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs) + 1, y0 = Math.min(...ys), y1 = Math.max(...ys) + 1;
    if ((x1 - x0) * (y1 - y0) !== h.cells.length) continue; // flat roof for odd (or half-collapsed) shapes
    const along = x1 - x0 >= y1 - y0, span = (along ? y1 - y0 : x1 - x0) * CELL + 0.6, len = (along ? x1 - x0 : y1 - y0) * CELL + 0.6;
    const shape = new THREE.Shape([new THREE.Vector2(-span / 2, 0), new THREE.Vector2(span / 2, 0), new THREE.Vector2(0, span * 0.4)]);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: false }); geo.translate(0, 0, -len / 2);
    const roof = mesh(geo, mat(0x7a3f2c), 1, 1, 1, (x0 + x1) / 2 * CELL, h.base + h.height, (y0 + y1) / 2 * CELL);
    if (along) roof.rotation.y = Math.PI / 2;
    roofs.push(roof);
  }
  // roofs and parapets are static: one mesh each, not one per house or trench side
  if (roofs.length) { group.add(mergeMeshes(roofs)); for (const r of roofs) r.geometry.dispose(); }
  inst(cells.H, 0x3f5a2a, ([x, y]) => [CELL * 1.05, 1.7 + rnd(x, y) * 0.5, CELL * 1.05, 0.9, 0.8 + rnd(x, y, 1) * 0.4]);
  inst(cells['#'], 0x9a958a, ([x, y]) => [CELL * 0.9, 0.9, CELL * 0.9, 0.45, 0.85 + rnd(x, y) * 0.25]);
  // rubble: a few broken chunks per cell
  inst(cells.R, 0x8a8070, ([x, y], k) => { const s = 0.5 + rnd(x, y, k) * 0.7; return [s, s * 0.6, s, s * 0.3, 0.7 + rnd(x, y, k + 5) * 0.4, undefined, (rnd(x, y, k + 9) - 0.5) * 1.4, (rnd(x, y, k + 13) - 0.5) * 1.4]; }, 3);
  // barbed wire: two posts and a criss-cross of strands per cell
  inst(cells.X, 0x4a3c2a, ([x, y], k) => [[0.14, 1.1, 0.14, 0.55, 1, undefined, -0.6, -0.6], [0.14, 1.1, 0.14, 0.55, 1, undefined, 0.6, 0.6],
    [CELL, 0.05, 0.05, 0.85, 0.6], [CELL, 0.05, 0.05, 0.45, 0.6], [0.05, 0.05, CELL, 0.65, 0.6], [0.05, 0.05, CELL, 0.3, 0.6]][k], 6);
  // tank traps: two steel hedgehogs (three crossed beams each) per cell
  inst(cells.Y, 0x4f4f4c, ([x, y], k) => { const j = k % 3, o = k < 3 ? -0.45 : 0.45, L = 1.5; return [j === 0 ? L : 0.18, j === 1 ? L : 0.18, j === 2 ? L : 0.18, 0.75, 0.9 + rnd(x, y, k) * 0.2, undefined, o, -o]; }, 6);
  // bridges: a plank deck, with rails on the sides that face the water
  inst(cells['='], 0x7a5a3a, () => [CELL * 1.02, 0.35, CELL * 1.02, 0.35, 1]);
  const rails = [];
  for (const [x, y] of cells['=']) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (grid[y + dy]?.[x + dx] === 'W') rails.push([x, y, dx, dy]);
  inst(rails, 0x5a4028, ([, , dx, dy]) => [dx ? 0.2 : CELL, 0.8, dx ? CELL : 0.2, 0.75, 1, undefined, dx * 0.9, dy * 0.9]);
  // trench parapets on every side that isn't more trench
  const dirt = mat(0x6b5a3e), parapets = [];
  for (const [x, y] of grid.flatMap((row, y) => row.map((ch, x) => ch === 'T' && [x, y]).filter(Boolean))) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (grid[y + dy]?.[x + dx] === 'T') continue;
      const cx = (x + 0.5 + dx * 0.55) * CELL, cz = (y + 0.5 + dy * 0.55) * CELL;
      parapets.push(mesh(GEO.box, dirt, dx ? 0.5 : CELL, 0.35, dx ? CELL : 0.5, cx, 0.17 + hAt(cx, cz), cz));
    }
  }
  if (parapets.length) group.add(mergeMeshes(parapets));
}

// bombs and shells lower the ground: patch the map's height rows
function setLevel(map, cell, lv) {
  map.heights ??= map.rows.map(r => '0'.repeat(r.length));
  const x = cell % map.w, y = Math.floor(cell / map.w), r = map.heights[y];
  map.heights[y] = r.slice(0, x) + levelChar(lv) + r.slice(x + 1);
}

function applyCells(cells) {
  if (!cells?.length || !terrain) return;
  let dug = false;
  for (const [cell, ch, lv] of cells) {
    const x = cell % terrain.w, y = Math.floor(cell / terrain.w);
    terrain.grid[y][x] = ch;
    paintCell(x, y);
    if (lv !== undefined) { setLevel(lastStart.map, cell, lv); dug = true; }
  }
  if (dug) { buildField(lastStart.map); groundMesh.geometry.dispose(); groundMesh.geometry = terrainGeometry(); }
  terrain.tex.needsUpdate = true;
  buildStructures();
  mmImage = null;
}

// Each player's HQ: tinted reinforce zone, sandbag ring, command tent, tall flag, name.
function buildHQ(sp, slot) {
  const f = look(slot), R = CFG.reinforceRadius, g = new THREE.Group();
  g.position.set(sp.x, hAt(sp.x, sp.z), sp.z);
  const flat = (geo, opacity, y) => { const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: f.color, transparent: true, opacity, depthWrite: false })); m.rotation.x = -Math.PI / 2; m.position.y = y; return m; };
  g.add(flat(new THREE.CircleGeometry(R, 48), 0.18, 0.05), hqRing(R, f.color));
  // sandbags with gaps for the exits, merged into one mesh
  const bags = [];
  for (let i = 0; i < 36; i++) {
    if (i % 9 < 2) continue;
    const a = i / 36 * Math.PI * 2, bag = mesh(GEO.box, mat(0x9c8a60), 2.4, 0.9, 1.1, Math.cos(a) * (R + 0.8), 0.45, Math.sin(a) * (R + 0.8));
    bag.rotation.y = -a + Math.PI / 2; bags.push(bag);
  }
  g.add(mergeMeshes(bags));
  // command tent + crates
  const tent = f.vehicle, shape = new THREE.Shape([new THREE.Vector2(-3, 0), new THREE.Vector2(3, 0), new THREE.Vector2(0, 3.2)]);
  const tg = new THREE.ExtrudeGeometry(shape, { depth: 7, bevelEnabled: false }); tg.translate(0, 0, -3.5);
  if (!classicMode()) g.add(mesh(tg, mat(tent), 1, 1, 1, -4, 0, -3));
  if (!classicMode()) g.add(mesh(GEO.box, mat(0x6e5836), 1.4, 1.2, 1.4, 3, 0.6, -5), mesh(GEO.box, mat(0x6e5836), 1.4, 1.2, 1.4, 4.6, 0.6, -4.4), mesh(GEO.box, mat(0x5f4c2f), 1.2, 1, 1.2, 3.8, 1.7, -4.7));
  // tall flag you can spot from across the map
  const flag = mesh(GEO.plane, flagMat(f.color), 4.5, 2.8, 1, 2.3, 13, 0);
  g.add(mesh(GEO.cyl, mat(0x4a3f30), 0.12, 15, 0.12, 0, 7.5, 0), flag);
  const tag = label(`${names[slot] ?? f.name} HQ`, { style: 'hq', color: f.color }); tag.position.y = 17; g.add(tag);
  return g;
}

// ---------- units ----------

function makeUnit(id, type, owner) {
  const def = UNITS[type], f = look(owner), root = new THREE.Group();
  const v = { id, type, owner, root, models: [], alive: def.models, x: 0, z: 0, rot: 0, aim: 0, turret: null };
  // owner ring, then the selection ring (it carries the weapon range rings, and the minimum range of rocket salvos)
  const base = ownerRing(def.radius + 0.4, f.color);
  Object.assign(v, selectionRing(def.radius + 1, def.w ? [def.w.range, def.w.minRange].filter(Boolean) : []));
  root.add(base, v.sel); v.base = base;
  buildModel(v, root, f, facOf(owner), def); // soldiers, vehicles, guns and structures, merged per part (client/unit-models.js)
  // billboarded health + suppression bars
  v.bars = new THREE.Group(); v.bars.position.y = barY(type);
  const bg = new THREE.Mesh(GEO.plane, new THREE.MeshBasicMaterial({ color: 0x111111, depthTest: false })); bg.scale.set(2.4, 0.42, 1);
  v.hpBar = new THREE.Mesh(GEO.plane, new THREE.MeshBasicMaterial({ color: f.color, depthTest: false })); v.hpBar.scale.set(2.3, 0.2, 1); v.hpBar.position.set(0, 0.07, 0.01);
  v.suppBar = new THREE.Mesh(GEO.plane, new THREE.MeshBasicMaterial({ color: 0xffd23a, depthTest: false })); v.suppBar.scale.set(2.3, 0.1, 1); v.suppBar.position.set(0, -0.11, 0.01);
  bg.renderOrder = 3; v.hpBar.renderOrder = v.suppBar.renderOrder = 4;
  v.bars.add(bg, v.hpBar, v.suppBar);
  // veterancy: up to three gold stars above the bar
  v.stars = [-0.5, 0, 0.5].map(x => { const st = new THREE.Mesh(GEO.plane, new THREE.MeshBasicMaterial({ color: 0xffd24a, depthTest: false })); st.scale.set(0.32, 0.32, 1); st.position.set(x, 0.42, 0.01); st.rotation.z = Math.PI / 4; st.renderOrder = 4; st.visible = false; v.bars.add(st); return st; });
  v.shield = new THREE.Mesh(GEO.shield, new THREE.MeshBasicMaterial({ depthTest: false, transparent: true }));
  v.shield.scale.set(0.5, 0.5, 1); v.shield.position.set(1.55, 0, 0.01); v.shield.renderOrder = 4; v.shield.visible = false; v.bars.add(v.shield);
  v.bars.add(symbolBadge(type, f.color)); // military map symbol in the owner's color, left of the bar
  world.add(root, v.bars);
  return v;
}

// pooled and capped; the oldest fade out (client/unit-models.js)
const bodies = createBodies();
function corpse(v, man) {
  const p = man.getWorldPosition(new THREE.Vector3());
  bodies.add(world, p.x, hAt(p.x, p.z) + 0.3, p.z);
  man.visible = false;
}

function removeUnit(v) {
  battleGone(v);
  world.remove(v.bars);
  if (v.killed && isVeh(v.type)) {
    // leave a burnt-out wreck for a while
    v.root.traverse(o => { if (o.isMesh) { o.material = o.material.isMeshBasicMaterial ? o.material : mat(0x1d1b18); } });
    v.root.children.slice(0, 2).forEach(o => (o.visible = false));
    fx.push({ obj: v.root, life: 40, update: () => {} });
    effects.wreck(v);
  } else {
    if (v.killed) v.models.forEach(m => m.visible && corpse(v, m));
    world.remove(v.root);
  }
  units.delete(v.id); selected.delete(v.id);
}

// ---------- effects + sound ----------

// sound lives in audio.js and battle-sound.js; blip() is a UI sound ('click', 'recruit' or 'error', a number means click)
function blip(kind) { audio.ui(typeof kind === 'string' ? kind : 'click'); }

function marker(x, z, color) {
  const m = clickRing(color);
  m.position.set(x, hAt(x, z) + 0.3, z);
  world.add(m);
  fx.push({ obj: m, life: 0.6, max: 0.6, update: (f) => { m.scale.setScalar(0.5 + (1 - f) * 2); m.material.opacity = f; }, dispose: () => m.material.dispose() });
}

// ---------- snapshots ----------

function applySnapshot(s) {
  if (window.__freeze) return; // debug: hold the scene still (e.g. to inspect models)
  const arrived = performance.now();
  if (snapshotAt) snapshotGap += (Math.max(60, Math.min(400, arrived - snapshotAt)) - snapshotGap) * 0.2;
  snapshotAt = arrived;
  const seen = new Set();
  for (const [id, type, owner, x, z, rot, aim, hp, supp, tgt, cover, cd, flags, stars, built] of s.units) {
    seen.add(id);
    let v = units.get(id);
    if (!v) { v = makeUnit(id, type, owner); Object.assign(v, { x, z, rot, aim }); units.set(id, v); }
    Object.assign(v, { owner, tx: x, tz: z, trot: rot, taim: aim, hp, supp, tgt, cover, cd, flags, vet: stars || 0, garr: !!(flags & 32), built: built ?? 1, plan: null, orders: [] });
    if (owner !== me) { v.rally = null; v.queue = []; }
    if (v.body) v.body.scale.y = 0.15 + 0.85 * v.built; // a construction site rises as it's built
    v.stars.forEach((st, i) => (st.visible = i < v.vet));
    const cl = !v.garr && COVER_LOOK[cover];
    v.shield.visible = !!cl;
    if (cl) { v.shield.material.color.set(cl[0]); v.shield.material.opacity = cl[1]; }
    // inside a building: the squad disappears into it; its bars float above the roof
    setOwnerRing(v.base, flags & 1 ? 0xffffff : look(owner).color);
    const def = UNITS[type], alive = Math.ceil(hp / def.hpPer);
    if (!isVeh(type)) while (v.alive > alive) corpse(v, v.models[--v.alive]);
    if (!isVeh(type)) v.models.forEach((man, i) => { man.position.y = cover === 2 ? -0.6 : 0; man.visible = i < v.alive && !v.garr; });
    v.base.visible = !v.garr;
    if (UNITS[type].camo) v.models.forEach(man => man.traverse(o => { if (o.isMesh && !o.material.userData.camo) { o.material = o.material.clone(); o.material.userData.camo = true; o.material.transparent = true; } if (o.isMesh) o.material.opacity = flags & 256 ? 0.45 : 1; }));
    const frac = Math.max(0, hp / (def.models * def.hpPer));
    v.hpBar.scale.x = 2.3 * frac; v.hpBar.position.x = -1.15 * (1 - frac);
    v.hpBar.material.color.set(frac > 0.5 ? look(owner).color : frac > 0.25 ? 0xe08a2a : 0xd02a1a);
    v.suppBar.visible = supp > 0;
    v.suppBar.scale.x = 2.3 * supp / 100; v.suppBar.position.x = -1.15 * (1 - supp / 100);
    v.suppBar.material.color.set(supp >= 90 ? 0xff3b2a : 0xffd23a);
  }
  battleShots(s, units, terrain?.w); // their sounds (client/battle-sound.js)
  for (const sh of s.shots) if (sh.kill && units.get(sh.t)) units.get(sh.t).killed = true;
  effects.snapshot({ ...s, shots: s.shots.filter(sh => !AIR_SHOTS.has(sh.k)) }, seen); // flashes, tracers, blasts, smoke and planes (client/fx.js)
  airShots(s.shots); // aviation kinds fx.js does not draw yet (dive, para, chutes, shot-down planes, flak, aa)
  objectives.snapshot(s);
  for (const v of [...units.values()]) if (!seen.has(v.id)) removeUnit(v);
  for (const [id, kind, tx, tz, ...path] of s.plans ?? []) { const v = units.get(id); if (v) v.plan = { kind, tx, tz, path }; }
  for (const [id, n, ...points] of s.orders ?? []) {
    const v = units.get(id); if (v?.owner !== me) continue;
    for (let i = 0; i < n && i * 3 + 2 < points.length; i++) v.orders.push({ kind: points[i * 3], x: points[i * 3 + 1], z: points[i * 3 + 2] });
  }
  for (const [id, prog, rx, rz, ...queue] of s.queues ?? []) { const v = units.get(id); if (v) Object.assign(v, { prog, queue, rally: rx >= 0 ? { x: rx, z: rz } : null }); }
  applyGhosts(s.ghosts);
  coverGroup ??= (() => { const gp = new THREE.Group(); world.add(gp); return gp; })();
  coverGroup.children.forEach(o => { o.geometry.dispose(); o.material.dispose(); }); coverGroup.clear();
  for (const [x, z, r, t] of s.covers ?? []) { const m = new THREE.Mesh(new THREE.RingGeometry(r - 0.8, r, 64), new THREE.MeshBasicMaterial({ color: 0x9dd0ff, transparent: true, opacity: 0.2 + t / 150, depthTest: false })); m.rotation.x = -Math.PI / 2; m.position.set(x, hAt(x, z) + 0.4, z); m.renderOrder = 2; coverGroup.add(m); }
  if (s.nodes && !nodeMarks) nodeMarks = s.nodes.map(([x, z, rate, fuel]) => { const m = nodeMark(x, z, rate, fuel); world.add(m); return m; });

  syncStrikes(s.strikes);
  applyCells(s.cells);
  const ending = !epilogue.active();
  epilogue.snapshot(s, teams[me] ?? me); // the first one with a winner starts the ending (client/epilogue.js)
  if (ending && epilogue.active()) { rig.skipIntro(); rig.cancelFollow(); } // the ending's camera glide takes over the camera
  alerts.snapshot(s, lastSnap);
  lastSnap = s;
  updateHud(s);
  endgame.snapshot(s);
}

// public warnings for incoming support: everyone sees where it will land
const strikeMarks = new Map();
function syncStrikes(list) {
  const keep = new Set();
  for (const [kind, x, z, dir, t, owner] of list) {
    const key = `${kind},${x},${z}`; keep.add(key);
    let m = strikeMarks.get(key);
    if (!m) {
      m = aimShape(kind, !foe(owner) ? look(owner).color : 0xff3020);
      m.position.set(x, hAt(x, z), z); m.rotation.y = -dir;
      world.add(m); strikeMarks.set(key, m);
    }
    m.userData.t = t;
  }
  for (const [key, m] of strikeMarks) if (!keep.has(key)) { world.remove(m); strikeMarks.delete(key); }
}
// ring for area strikes, a long strip for a strafing run
function aimShape(kind, color) {
  const g = new THREE.Group(), matl = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false, depthTest: false, side: THREE.DoubleSide });
  const flat = (geo) => { const m = new THREE.Mesh(geo, matl); m.rotation.x = -Math.PI / 2; m.position.y = 0.2; m.renderOrder = 2; return m; };
  if (UNITS[kind]?.building) g.add(flat(new THREE.PlaneGeometry(UNITS[kind].size * CELL, UNITS[kind].size * CELL)));
  else if (SUPPORT[kind]?.point) { const r = SUPPORT[kind].radius ?? SUPPORT[kind].blast ?? 4; g.add(flat(new THREE.RingGeometry(r - 0.6, r, 64))); }
  else if (kind === 'grenade' || kind === 'barrage' || kind === 'satchel' || kind === 'amove' || kind === 'rally') {
    const r = kind === 'grenade' ? UNITS.rifle.ab.radius : kind === 'barrage' ? UNITS.rocket.w.spread : kind === 'satchel' ? UNITS.ranger.ab.radius : 2;
    g.add(flat(new THREE.RingGeometry(r - 0.6, r, 64)));
  } else {
    const [len, width] = kind === 'dig' ? (FORTS[fortKind].nest ? [3 * CELL, 2 * CELL] : [FORTS[fortKind].n * CELL, CELL]) : [SUPPORT[kind].len, SUPPORT[kind].width];
    g.add(flat(new THREE.PlaneGeometry(len, width)));
    // arrow past the far end shows which way it runs
    const tip = new THREE.Shape([new THREE.Vector2(len / 2 + 0.5, -2), new THREE.Vector2(len / 2 + 4, 0), new THREE.Vector2(len / 2 + 0.5, 2)]);
    const arrow = flat(new THREE.ShapeGeometry(tip)); arrow.material = matl.clone(); arrow.material.opacity = 0.8;
    g.add(arrow);
  }
  g.userData.mat = matl;
  return g;
}

// legacy blast and tracer, kept for the aviation visuals below (the rest of the match draws through fx.js)
const boom = (x, z, size) => effects.explode(x, z, size);
// aviation shots client/fx.js does not draw yet: airShots() below draws them, and fx.js never sees them ('flak' is also a unit type there)
const AIR_SHOTS = new Set(['dive', 'para', 'chutes', 'shotdown', 'planedown', 'flak', 'aa']);
function tracer(a, b, color, life) {
  const g = new THREE.BufferGeometry().setFromPoints([a, b]);
  const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true }));
  world.add(line);
  fx.push({ obj: line, life, max: life, update: (f) => (line.material.opacity = f), dispose: () => { g.dispose(); line.material.dispose(); } });
}
function airShots(shots) {
  for (const sh of shots) {
    if (sh.k === 'dive' || sh.k === 'para') plane(sh);
    else if (sh.k === 'chutes') chutes(sh.x, sh.z);
    else if (sh.k === 'shotdown' || sh.k === 'planedown') downed(sh);
    else if (sh.k === 'flak') { for (let i = 0; i < 5; i++) setTimeout(() => puff(sh.x + (Math.random() - 0.5) * 16, sh.z + (Math.random() - 0.5) * 16), i * 90); }
    else if (sh.k === 'aa') { const a = units.get(sh.f), b = units.get(sh.t); if (a && b) { const st = a.root.getWorldPosition(new THREE.Vector3()); st.y += isAir(a.type) ? 0 : 1.5; tracer(st, b.root.getWorldPosition(new THREE.Vector3()), 0xffe08a, 0.08); } }
  }
}
// a plane crossing the map along the run, coming in from the caller's side
function plane(sh) {
  const p = new THREE.Group(), c = mat(0x55594a), dx = Math.cos(sh.dir), dz = Math.sin(sh.dir);
  p.add(mesh(GEO.box, c, 6, 0.9, 0.9), mesh(GEO.box, c, 1.4, 0.2, 9), mesh(GEO.box, c, 0.8, 0.15, 3.2, -2.6, 0, 0), mesh(GEO.box, c, 0.8, 1.2, 0.15, -2.6, 0.6, 0));
  p.rotation.y = -sh.dir; world.add(p);
  const low = sh.k === 'strafe' ? 9 : sh.k === 'bombing' ? 18 : sh.k === 'dive' ? 12 : sh.k === 'para' ? 24 : 26, span = 140, life = 3;
  fx.push({ obj: p, life, max: life, update: (f) => { const t = 1 - f, a = (t - 0.5) * span; p.position.set(sh.x + dx * a, hAt(sh.x, sh.z) + low + Math.abs(t - 0.5) * 30, sh.z + dz * a); } });
  if (sh.k === 'strafe') {
    // guns rake the strip as it passes over
    for (let i = 0; i < 10; i++) {
      const a = (i / 9 - 0.5) * SUPPORT.strafe.len;
      setTimeout(() => boom(sh.x + dx * a + (Math.random() - 0.5) * 3, sh.z + dz * a + (Math.random() - 0.5) * 3, 0.8), 1300 + i * 40);
    }
  }
}

// a flak shell bursting in the sky over a spot
function puff(x, z) {
  const m = new THREE.Mesh(GEO.ball, new THREE.MeshBasicMaterial({ color: 0x5a5a52, transparent: true, depthWrite: false }));
  m.position.set(x, hAt(x, z) + AIR_ALT + (Math.random() - 0.5) * 6, z); world.add(m);
  fx.push({ obj: m, life: 1.2, max: 1.2, update: (f) => { m.scale.setScalar(0.6 + (1 - f) * 2.2); m.material.opacity = f * 0.8; }, dispose: () => m.material.dispose() });
}
// paratroopers: a few canopies drifting down onto the drop
function chutes(x, z) {
  for (let i = 0; i < 5; i++) {
    const g = new THREE.Group(), cx = x + (Math.random() - 0.5) * 8, cz = z + (Math.random() - 0.5) * 8;
    g.add(mesh(GEO.ball, mat(0xd8d2b8), 1.4, 0.6, 1.4, 0, 2, 0), mesh(GEO.box, mat(0x3c4128), 0.3, 1, 0.3, 0, 0.5, 0));
    world.add(g);
    fx.push({ obj: g, life: 3, max: 3, update: (f) => g.position.set(cx, hAt(cx, cz) + f * 22, cz) });
  }
}
// a plane shot down: it tips over, falls, and blows up where it hits the ground
function downed(sh) {
  const p = new THREE.Group(), c = mat(0x3a3a32), dir = sh.dir ?? 0, dx = Math.cos(dir), dz = Math.sin(dir);
  p.add(mesh(GEO.box, c, 6, 0.9, 0.9), mesh(GEO.box, c, 1.4, 0.2, 9));
  p.rotation.y = -dir; world.add(p);
  const life = 2.2, gy = hAt(sh.x, sh.z);
  fx.push({ obj: p, life, max: life, update: (f) => { const t = 1 - f; p.position.set(sh.x + dx * t * 25, gy + AIR_ALT * f + 1, sh.z + dz * t * 25); p.rotation.z = t * 2.5; } });
  setTimeout(() => { boom(sh.x + dx * 25, sh.z + dz * 25, 4); audio.play('vehicle_destroyed', { x: sh.x + dx * 25, z: sh.z + dz * 25 }); }, life * 1000);
  puff(sh.x, sh.z);
}

// ---------- HUD ----------

// client/hud.js draws the panels; it reads the match state and calls back into these actions
const feedback = createFeedback($('hint'), () => blip('error'));
const available = (action) => availability(lastSnap, CFG, { ...action, slot: me, ids: [...selected] });
const explainUnavailable = (result) => { if (!result.ok) feedback.show(result.reason); return !result.ok; };
let placementCache = null;
function placementView() {
  if (!terrain || !lastSnap || !lastStart) return null;
  if (placementCache?.snapshot !== lastSnap) placementCache = { snapshot: lastSnap, ...placementState(lastSnap, lastStart.map, terrain.grid, teams) };
  return placementCache;
}
const hud = createHud({
  get me() { return me; }, get teams() { return teams; }, get names() { return names; }, get PRIORITY() { return PRIORITY; },
  units, selected, look, facOf, color: (slot) => css(look(slot).color), classic: () => classicMode(), send: sendCmd, blip,
  retreat: () => retreat(), stop: () => { sendCmd({ t: 'stop', ids: [...selected] }); blip(330); }, amove: () => selected.size && setAim('amove'), rally: () => startRally(),
  dig: (k) => startDig(k), build: (k) => startBuild(k), ability: (t) => useAbility(t), support: (k) => aimSupport(k), fType: () => fKeyType(),
  builders: () => builders(), owns: (t) => owns(t), canPlace: (k) => canPlace(k), explain: (reason) => feedback.show(reason),
  select: (id) => { selected.clear(); selected.add(id); updateHud(lastSnap); },
  selectType: (type, e) => { selection.type(type, e); if (lastSnap) updateHud(lastSnap); },
  idleCount: () => selection.idle().length,
  findIdle: (all) => { selection.findIdle(all); if (lastSnap) updateHud(lastSnap); },
});
function buildSupportBar() { hud.buildSupport(); }
function aimSupport(k) {
  if (explainUnavailable(available({ t: 'support', kind: k }))) return;
  setAim(k); blip(700);
}
function buildBuyBar() { hud.buildCard(); }
function updateHud(s) { drawPlans(); hud.update(s); }

// the builder squad nearest the clicked spot puts the fortification across its approach
let fortKind = 'trench';
const diggers = () => [...selected].map(id => units.get(id)).filter(v => v && CFG.fortBuilders.includes(v.type) && !(v.flags & 1));
function startDig(kind) { if (explainUnavailable(available({ t: 'dig', kind }))) return; fortKind = kind; setAim('dig'); $('hint').textContent = `Click where to build the ${FORTS[kind].name.toLowerCase()} · right-click cancels`; blip(600); }
// Selected units show where they're going and what they're locked onto (sent by the server for your own units)
// one layer for every match: grease-pencil strokes rewritten in place each snapshot (see markers.js)
const plans = planLayer(hAt);
function drawPlans() {
  if (!world) return;
  if (plans.group.parent !== world) world.add(plans.group);
  const rally = lastSnap?.rally;
  plans.draw(selected, units, rally ? { x: rally[0], z: rally[1] } : null);
}

// Engineers put Supply Depots on resource nodes: J, then click near a node
const builders = () => [...selected].map(id => units.get(id)).filter(v => v && v.type === 'engineer' && !(v.flags & 1));
const owns = (type, done = true) => [...units.values()].some(v => v.owner === me && v.type === type && (!done || v.built >= 1));
function canPlace(k, at, dir) {
  if (!available({ t: 'build', kind: k }).ok) return false;
  return !at || footAt(k, at, dir).ok;
}
function startBuild(k) { if (explainUnavailable(available({ t: 'build', kind: k }))) return; if (canPlace(k)) { setAim(k); blip(600); } }
// Shared footprint, terrain, level and sight checks. The server decides again on arrival.
function footAt(k, at, dir) {
  const view = placementView();
  return view ? { x: at.x, z: at.z, ...placementCheck(view.game, { kind: k, x: at.x, z: at.z, dir }, (spot) => view.sees(me, spot)) } : { x: at.x, z: at.z, ok: false, reason: 'notVisible' };
}
let nodeMarks = null, coverGroup = null;
// Ghosts: enemy buildings you've seen, drawn faded where they were last seen until you look again
const ghosts = new Map();
function applyGhosts(list) {
  const keep = new Set();
  for (const [id, type, owner, x, z, built] of list ?? []) {
    if (units.has(id)) continue;
    keep.add(id);
    let gv = ghosts.get(id);
    if (!gv) {
      gv = makeUnit(id, type, owner); gv.bars.visible = false;
      gv.root.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); Object.assign(o.material, { transparent: true, opacity: 0.35, depthWrite: false }); } });
      ghosts.set(id, gv);
    }
    gv.root.position.set(x, hAt(x, z), z);
    if (gv.body) gv.body.scale.y = 0.15 + 0.85 * built;
  }
  for (const [id, gv] of ghosts) if (!keep.has(id)) { world.remove(gv.root, gv.bars); ghosts.delete(id); }
}
function nodeMark(x, z, rate, fuel) {
  const g = new THREE.Group(), m = new THREE.Mesh(new THREE.RingGeometry(2.4, 2.8, 4, 1, Math.PI / 4), new THREE.MeshBasicMaterial({ color: fuel ? 0xe07a30 : 0xe8c860, transparent: true, opacity: 0.6, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.y = 0.25; m.renderOrder = 2; m.material.depthTest = false;
  g.add(m, mesh(GEO.box, mat(0x6e5836), 0.8, 0.6, 0.8, 0, 0.3, 0));
  // what a depot here pays: the richer contested nodes are worth fighting for
  const tag = label(fuel ? `+${rate} Fuel/s` : `+${rate} MP/s`); tag.position.y = 3; tag.scale.multiplyScalar(0.6); g.add(tag);
  g.position.set(x, hAt(x, z), z);
  return g;
}
function nearestDigger(g) { return diggers().sort((a, b) => Math.hypot(a.x - g.x, a.z - g.z) - Math.hypot(b.x - g.x, b.z - g.z))[0]; }

// the player's faction voice answers orders (audio.js picks the voice and keeps lines 2.5 s apart)
function bark(kind) { audio.voice(kind); }
audio.bind($('volume')); // the volume slider in the menu (0 mutes); M toggles mute
// the speaker button in the corner mutes too, and shows when the sound is off
const muteIcon = () => ($('mute').textContent = audio.volume > 0 ? '🔊' : '🔇');
function toggleMute() { audio.toggleMute(); muteIcon(); }
$('mute').onclick = toggleMute;
$('volume').addEventListener('input', muteIcon);
muteIcon();

function retreat() { if (selected.size) { sendCmd({ t: 'retreat', ids: [...selected] }); blip(260); bark('retreat'); } }
// F: instant abilities fire now; grenades arm a targeting click
// targeting: null | 'grenade' | 'dig' | support kind. Directional ones take two clicks: center, then direction.
let targeting = null, aimCenter = null, aimMesh = null, home = null, aimedUnit = null;
function cancelAim() { feedback.reset(); targeting = null; aimedUnit = null; aimCenter = null; $('hint').textContent = ''; }
function setAim(kind, unit = null) {
  feedback.reset();
  targeting = kind; aimedUnit = unit; aimCenter = null;
  $('hint').textContent = { depot: 'Click a resource node', barracks: 'Click where to build', motorpool: 'Click where to build', grenade: 'Click where to throw', barrage: 'Click where to fire the salvo', satchel: 'Click where to plant the charge', amove: 'Click where to attack-move', rally: 'Click where recruits should gather' }[kind] ?? 'Click to set the center';
  $('hint').textContent += ' · right-click cancels';
}
function startRally() {
  if (!lastSnap) return;
  if (classicMode() && ![...selected].some(id => { const v = units.get(id); return v?.owner === me && UNITS[v.type].makes?.length; })) {
    $('hint').textContent = 'Select a Production Building to set its rally'; return;
  }
  setAim('rally'); blip(620);
}
function rallyAt(g) {
  const ids = classicMode() ? [...selected].filter(id => { const v = units.get(id); return v?.owner === me && UNITS[v.type].makes?.length; }) : [];
  sendCmd({ t: 'rally', ...(ids.length ? { ids } : {}), x: g.x, z: g.z });
  marker(g.x, g.z, 0x9dd0ff); blip(620); cancelAim();
}
// direction before the second click: planes fly out from home, trenches run across the squad's approach
function defaultDir(kind, at) {
  if (kind === 'dig') { const v = nearestDigger(at); return v ? Math.atan2(at.z - v.z, at.x - v.x) + Math.PI / 2 : 0; }
  return home ? Math.atan2(at.z - home.z, at.x - home.x) : 0;
}
// F fires exactly one ability: the first type in this order that has one ready (the others are click-only)
const PRIORITY = ['rifle', 'ranger', 'conscript', 'mg', 'mortar', 'at', 'armoredcar', 'tank', 'medium', 'tiger', 'rocket'];
function fKeyType() {
  const sel = [...selected].map(id => units.get(id)).filter(Boolean);
  return PRIORITY.find(t => sel.some(v => v.type === t) && available({ t: 'ability', unit: t }).ok) ?? PRIORITY.find(t => sel.some(v => v.type === t)) ?? null;
}
const AIMED = { grenade: 'rifle', barrage: 'rocket', satchel: 'ranger' }; // abilities that need a spot clicked
function useAbility(type) {
  if (!type) return;
  if (explainUnavailable(available({ t: 'ability', unit: type }))) return;
  const ready = [...selected].map(id => units.get(id)).filter(v => v && !v.cd && !(v.flags & 1) && v.type === type);
  if (!ready.length) return;
  const id = UNITS[type].ab.id;
  if (AIMED[id]) setAim(id, type);
  else { sendCmd({ t: 'ability', ids: ready.map(v => v.id) }); blip(880); }
}
function throwAt(g, kind, type) {
  if (explainUnavailable(available({ t: 'ability', unit: type }))) return;
  const who = [...selected].map(id => units.get(id)).filter(v => v && v.type === type && UNITS[v.type].ab.id === kind && !v.cd && !(v.flags & 1));
  if (!who.length) return;
  who.sort((a, b) => Math.hypot(a.x - g.x, a.z - g.z) - Math.hypot(b.x - g.x, b.z - g.z));
  sendCmd({ t: 'ability', ids: [who[0].id], x: g.x, z: g.z }); marker(g.x, g.z, 0xffa030); blip(760);
}
// rows perpendicular to the direction of travel
function formation(sel, g) {
  const cx = sel.reduce((a, v) => a + v.x, 0) / sel.length, cz = sel.reduce((a, v) => a + v.z, 0) / sel.length;
  const len = Math.hypot(g.x - cx, g.z - cz) || 1, dx = (g.x - cx) / len, dz = (g.z - cz) / len, cols = Math.ceil(Math.sqrt(sel.length)), gap = 5;
  sel.sort((a, b) => (a.x - cx) * -dz + (a.z - cz) * dx - ((b.x - cx) * -dz + (b.z - cz) * dx));
  return sel.map((v, i) => {
    const col = i % cols - (Math.min(cols, sel.length) - 1) / 2, row = Math.floor(i / cols);
    return [v.id, g.x - dz * col * gap - dx * row * gap, g.z + dx * col * gap - dz * row * gap];
  });
}
const orders = createOrders({
  units, selected, get me() { return me; }, defs: UNITS, formation, send: sendCmd, moveColor: MOVE_COLOR,
  feedback: (at, color, tone, voice) => { marker(at.x, at.z, color); blip(tone); if (voice) bark(voice); },
});

// ---------- camera + input ----------

const cam = { x: 80, z: 80, yaw: 0, dist: 85 }, PITCH = 0.95, keys = new Set();
let mouse = { x: innerWidth / 2, y: innerHeight / 2, inside: false }, drag = null;
rig.init({ cam, camera, pitch: PITCH, keys, mouse: () => mouse, dragging: () => drag, world: () => world,
  units, hAt, bounds: () => ({ w: MW, h: MH }), groundAt: (x, y) => groundAt(x, y), tryStore,
  chip: $('following'), top: $('top'), edgeButton: $('edgeBtn'), panButton: $('panBtn'),
  unitName: (v) => look(v.owner).names[v.type] ?? UNITS[v.type].name });
function followSelected() {
  if (rig.following != null) { rig.cancelFollow(); return; }
  let v = [...selected].map(id => units.get(id)).find(Boolean);
  if (!v && lastSnap?.out?.[me]) v = (mouse.inside && pick(mouse.x, mouse.y, () => true)) || pick(innerWidth / 2, innerHeight / 2, () => true, Infinity);
  if (v) rig.follow(v.id);
}
function cancelInput(clearKeys = true) {
  if (clearKeys) keys.clear();
  mouse.inside = false; drag = null; rig.stopDrag(); $('box').classList.add('hidden');
}
addEventListener('mousedown', (e) => { if (rig.skipIntro()) { e.preventDefault(); e.stopPropagation(); } }, { capture: true });

// Any shortcut that moves the camera ends follow mode (camera stream rule).
const centerSelection = (list) => {
  if (!list.length) return;
  rig.cancelFollow();
  cam.x = list.reduce((sum, v) => sum + v.x, 0) / list.length;
  cam.z = list.reduce((sum, v) => sum + v.z, 0) / list.length;
};
const selection = createSelection({ units, selected, groups, owner: () => me, definitions: UNITS,
  screenOf: (v) => screenOf(v), viewport: () => ({ width: innerWidth, height: innerHeight }), center: centerSelection });
const actions = {
  stop: () => { sendCmd({ t: 'stop', ids: [...selected] }); blip(330); },
  retreat, ability: () => useAbility(fKeyType()), amove: () => selected.size && setAim('amove'),
  mute: toggleMute,
  alert: () => { rig.cancelFollow(); const al = alerts.newest(); if (al) { cam.x = al.x; cam.z = al.z; } else centerSelection([...selected].map(id => units.get(id)).filter(Boolean)); },
  follow: followSelected, rally: startRally,
  home: () => {
    if (!home) return;
    rig.cancelFollow();
    cam.x = home.x; cam.z = home.z;
    const hq = classicMode() && [...units.values()].find(v => v.owner === me && v.type === 'hq');
    if (hq) { selected.clear(); selected.add(hq.id); }
  },
  clear: () => selected.clear(), cancelAim,
  army: () => selection.army(), idle: () => selection.findIdle(), idleAll: () => selection.findIdle(true),
  idleEngineer: () => selection.findIdle(false, true),
  panForward: () => {}, panBack: () => {}, panLeft: () => {}, panRight: () => {}, rotateLeft: () => {}, rotateRight: () => {},
};
for (const { id } of bindings) {
  const [kind, value, number] = id.split(':');
  if (kind === 'support') actions[id] = () => aimSupport(value);
  else if (kind === 'fort') actions[id] = () => startDig(value);
  else if (kind === 'build') actions[id] = () => startBuild(value);
  else if (kind === 'group') actions[id] = () => { selection.group(number, value, performance.now()); if (value !== 'recall') blip(990); };
}
addEventListener('keydown', (e) => {
  if (rig.skipIntro()) { e.preventDefault(); return; }
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName) || e.target.isContentEditable) return;
  keys.add(e.code);
  if (EDIT) return;
  const id = match(e, [classicMode() ? 'classic' : 'army', ...(targeting ? ['targeting'] : [])]);
  // Shortcuts that share camera codes must not also pan.
  if (id && !id.startsWith('pan') && !id.startsWith('rotate')) keys.delete(e.code);
  if (!id || !actions[id]) return;
  e.preventDefault();
  if (e.repeat) return;
  actions[id]();
  if (id.startsWith('pan') || id.startsWith('rotate')) return;
  if (lastSnap) updateHud(lastSnap);
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', cancelInput);
document.addEventListener('visibilitychange', () => { if (document.hidden) cancelInput(); });
addEventListener('mousemove', (e) => {
  mouse = { x: e.clientX, y: e.clientY, inside: !document.hidden };
  rig.moveMiddle(e);
  if (drag && !(e.buttons & 1)) { drag = null; $('box').classList.add('hidden'); }
  if (drag && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 6) {
    drag.moved = true; rig.cancelFollow();
    Object.assign($('box').style, { left: Math.min(drag.x, e.clientX) + 'px', top: Math.min(drag.y, e.clientY) + 'px', width: Math.abs(e.clientX - drag.x) + 'px', height: Math.abs(e.clientY - drag.y) + 'px' });
    $('box').classList.remove('hidden');
  }
});
document.addEventListener('mouseleave', () => cancelInput(false));
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
renderer.domElement.addEventListener('wheel', (e) => rig.wheel(e), { passive: false });

const screenOf = (v) => { const p = new THREE.Vector3(v.x, hAt(v.x, v.z) + 1 + (v.type && isAir(v.type) ? AIR_ALT : 0), v.z).project(camera); return { x: (p.x + 1) / 2 * innerWidth, y: (1 - p.y) / 2 * innerHeight, front: p.z < 1 }; };
function pick(mx, my, test, r) {
  let best = null, bd = Infinity;
  for (const v of units.values()) {
    if (!test(v)) continue;
    const s = screenOf(v), d = Math.hypot(s.x - mx, s.y - my);
    if (s.front && d < (r ?? (isVeh(v.type) ? 45 : 32)) && d < bd) { bd = d; best = v; }
  }
  return best;
}
const groundAt = (mx, my) => marchGround(camera, hAt, mx, my, innerWidth, innerHeight, MW || 160, MH || 160);

renderer.domElement.addEventListener('mousedown', (e) => {
  if (EDIT) return;
  if (e.button === 1) { rig.beginMiddle(e); return; }
  if (e.button === 0 && e.altKey && !targeting && !rig.intro) {
    e.preventDefault(); const g = groundAt(e.clientX, e.clientY); if (g) pings.send(g.x, g.z); return;
  }
  if (targeting) {
    if (e.button === 2) { cancelAim(); return; }
    if (e.button !== 0) return;
    const kind = targeting, g = groundAt(e.clientX, e.clientY);
    if (!g) { feedback.show(denySentence('blocked')); return; }
    if (kind === 'rally') { rallyAt(g); return; }
    if (UNITS[kind]?.building) {
      if (explainUnavailable(available({ t: 'build', kind }))) return;
      const f = footAt(kind, g);
      if (!canPlace(kind, g) || !f.ok) { feedback.show(denySentence(f.reason)); return; }
      if (!e.shiftKey) cancelAim();
      sendCmd({ t: 'build', ids: builders().map(v => v.id), kind, x: f.x, z: f.z, queue: e.shiftKey });
      marker(f.x, f.z, 0xe8c860); blip(600);
      return;
    }
    if (SUPPORT[kind]?.point) { if (explainUnavailable(available({ t: 'support', kind }))) return; cancelAim(); sendCmd({ t: 'support', kind, x: g.x, z: g.z }); marker(g.x, g.z, 0xffa030); blip(520); return; }
    if (AIMED[kind]) { const type = aimedUnit; if (explainUnavailable(available({ t: 'ability', unit: type }))) return; cancelAim(); throwAt(g, kind, type); return; }
    if (kind === 'amove') { cancelAim(); orders.dispatch({ ground: g }, e, { attack: true }); return; }
    // first click: pin the center, then the mouse rotates it
    if (!aimCenter) { aimCenter = g; $('hint').textContent = 'Move the mouse to rotate · click to launch'; blip(560); return; }
    const c = aimCenter, dir = Math.hypot(g.x - c.x, g.z - c.z) > 1.5 ? Math.atan2(g.z - c.z, g.x - c.x) : defaultDir(kind, c);
    if (kind === 'dig') {
      // Shift queues the dig behind the squad's orders (paid when it starts) and keeps the placement armed
      if (explainUnavailable(available({ t: 'dig', kind: fortKind, queue: e.shiftKey }))) return;
      const f = footAt(fortKind, c, dir);
      if (!f.ok) { feedback.show(denySentence(f.reason)); return; }
      const v = nearestDigger(c);
      if (e.shiftKey) setAim('dig'); else cancelAim();
      if (v) { sendCmd({ t: 'dig', ids: [v.id], kind: fortKind, x: c.x, z: c.z, dir, queue: e.shiftKey }); marker(c.x, c.z, 0xc8a060); blip(600); }
    } else {
      if (explainUnavailable(available({ t: 'support', kind }))) return;
      cancelAim(); sendCmd({ t: 'support', kind, x: c.x, z: c.z, dir }); blip(520);
    }
    return;
  }
  if (e.button === 0) drag = { x: e.clientX, y: e.clientY, moved: false };
  if (e.button !== 2 || !selected.size || !lastSnap) return;
  orders.dispatch({
    ground: groundAt(e.clientX, e.clientY), enemy: pick(e.clientX, e.clientY, v => foe(v.owner)),
    friend: pick(e.clientX, e.clientY, v => !foe(v.owner) && !UNITS[v.type].structure && !isAir(v.type)),
    building: pick(e.clientX, e.clientY, v => !foe(v.owner) && UNITS[v.type].building, 60), house: houseAt(e.clientX, e.clientY),
  }, e);
});

// the house under the cursor (walls and roofs count), as the center of its cell
function houseAt(mx, my) {
  if (!terrain) return null;
  const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2(mx / innerWidth * 2 - 1, -(my / innerHeight) * 2 + 1), camera);
  const hit = ray.intersectObjects([...terrain.group.children, groundMesh])[0];
  if (!hit || hit.object === groundMesh) return null;
  const p = hit.point.clone().addScaledVector(ray.ray.direction, 0.4), x = Math.floor(p.x / CELL), y = Math.floor(p.z / CELL);
  return terrain.grid[y]?.[x] === 'B' ? { x: (x + 0.5) * CELL, z: (y + 0.5) * CELL } : null;
}
addEventListener('mouseup', (e) => {
  if (e.button === 1) rig.stopDrag();
  if (EDIT || e.button !== 0 || !drag) return;
  $('box').classList.add('hidden');
  if (drag.moved) {
    const x0 = Math.min(drag.x, e.clientX), x1 = Math.max(drag.x, e.clientX), y0 = Math.min(drag.y, e.clientY), y1 = Math.max(drag.y, e.clientY);
    selection.box({ x0, x1, y0, y1 }, e);
  } else {
    const v = pick(e.clientX, e.clientY, v => v.owner === me && !UNITS[v.type].structure && !(v.flags & 512)) ?? pick(e.clientX, e.clientY, v => v.owner === me && UNITS[v.type].building, 60);
    selection.click(v, e);
  }
  drag = null;
  if (lastSnap) updateHud(lastSnap);
});

renderer.domElement.addEventListener('dblclick', (e) => {
  if (EDIT || targeting || e.button !== 0) return;
  const v = pick(e.clientX, e.clientY, v => v.owner === me && !UNITS[v.type].structure && !(v.flags & 512)) ?? pick(e.clientX, e.clientY, v => v.owner === me && UNITS[v.type].building, 60);
  if (!v) return;
  e.preventDefault(); selection.doubleClick(v, e);
  if (lastSnap) updateHud(lastSnap);
});

// ---------- frame loop ----------

let lastT = performance.now();

// ---------- minimap: rotated with the camera so "up" matches the screen ----------
const MM_COLORS = { '.': [108, 118, 69], B: [150, 132, 100], H: [47, 74, 34], '#': [154, 149, 138], '+': [90, 79, 54], T: [62, 50, 34], W: [60, 93, 112], '=': [122, 90, 58], F: [106, 127, 122], R: [122, 114, 102], X: [96, 90, 70], Y: [84, 84, 78] };
let mmImage = null, mmFog = null, mmTimer = 0;
function mmTerrain() {
  const w = terrain.w, h = terrain.grid.length, c = document.createElement('canvas'); c.width = w; c.height = h;
  const x2 = c.getContext('2d'), img = x2.createImageData(w, h);
  terrain.grid.forEach((row, y) => row.forEach((ch, x) => {
    const lv = field ? field.vert[y * (w + 1) + x] / CFG.levelHeight : 0, [r, g, b] = MM_COLORS[ch] ?? MM_COLORS['.'], k = 1 + lv * 0.12, i = (y * w + x) * 4;
    img.data[i] = r * k; img.data[i + 1] = g * k; img.data[i + 2] = b * k; img.data[i + 3] = 255;
  }));
  x2.putImageData(img, 0, 0);
  mmImage = c;
}
function mmBasis() {
  const W = $('minimap').width, S = W / Math.hypot(MW, MH), r = { x: Math.cos(cam.yaw), z: -Math.sin(cam.yaw) }, f = { x: -Math.sin(cam.yaw), z: -Math.cos(cam.yaw) };
  return { W, S, r, f };
}
function mmToWorld(px, py) {
  const { W, S, r, f } = mmBasis(), a = (px - W / 2) / S, b = -(py - W / 2) / S;
  return { x: MW / 2 + r.x * a + f.x * b, z: MH / 2 + r.z * a + f.z * b };
}
function minimapCursor(g) {
  const near = test => [...units.values()].filter(v => test(v) && Math.hypot(v.x - g.x, v.z - g.z) < 5 / mmBasis().S)
    .sort((a, b) => Math.hypot(a.x - g.x, a.z - g.z) - Math.hypot(b.x - g.x, b.z - g.z))[0];
  const x = Math.floor(g.x / CELL), z = Math.floor(g.z / CELL);
  return {
    ground: g, enemy: near(v => foe(v.owner)), friend: near(v => !foe(v.owner) && !UNITS[v.type].structure && !isAir(v.type)),
    building: near(v => !foe(v.owner) && UNITS[v.type].building),
    house: terrain?.grid[z]?.[x] === 'B' ? { x: (x + 0.5) * CELL, z: (z + 0.5) * CELL } : null,
  };
}
function drawMinimap() {
  const cv = $('minimap'), c = cv.getContext('2d');
  if (!terrain || !lastSnap) return;
  if (!mmImage) mmTerrain();
  const { W, S, r, f } = mmBasis();
  c.setTransform(1, 0, 0, 1, 0, 0); c.fillStyle = '#15160f'; c.fillRect(0, 0, W, W);
  // world (x, z) -> minimap, as one canvas transform
  const a = r.x * S, b = -f.x * S, cc = r.z * S, d = -f.z * S;
  c.setTransform(a, b, cc, d, W / 2 - (a * MW / 2 + cc * MH / 2), W / 2 - (b * MW / 2 + d * MH / 2));
  c.imageSmoothingEnabled = true; // nearest-neighbor shimmers once the map is rotated
  c.drawImage(mmImage, 0, 0, MW, MH);
  if (fogVis) {
    // one smooth image, not thousands of tiny squares (those leave a screen-door pattern)
    if (!mmFog || mmFog.width !== fogGrid.w) { mmFog = document.createElement('canvas'); mmFog.width = fogGrid.w; mmFog.height = fogGrid.h; }
    const fc = mmFog.getContext('2d'), img = fc.createImageData(fogGrid.w, fogGrid.h);
    for (let i = 0; i < fogVis.length; i++) { img.data[i * 4] = img.data[i * 4 + 1] = 10; img.data[i * 4 + 3] = fogVis[i] ? 0 : 130; }
    fc.putImageData(img, 0, 0);
    c.imageSmoothingEnabled = true; c.drawImage(mmFog, 0, 0, MW, MH);
  }
  const col = (slot) => css(look(slot).color);
  lastSnap.points.forEach(([owner], i) => { const p = points[i]?.g.position; if (!p) return; c.beginPath(); c.arc(p.x, p.z, CFG.pointRadius, 0, Math.PI * 2); c.fillStyle = owner >= 0 ? col(owner) + '99' : '#dddddd66'; c.fill(); c.strokeStyle = '#000'; c.lineWidth = 1 / S; c.stroke(); });
  (lastStart?.spawns || []).forEach((sp, i) => { c.fillStyle = col(i); c.fillRect(sp.x - 5, sp.z - 5, 10, 10); c.strokeStyle = '#000'; c.strokeRect(sp.x - 5, sp.z - 5, 10, 10); });
  for (const [kind, x, z, dir, , owner] of lastSnap.strikes || []) {
    const sp = SUPPORT[kind]; if (!sp) continue;
    c.save(); c.translate(x, z); c.rotate(dir); c.strokeStyle = !foe(owner) ? col(owner) : '#ff3020'; c.lineWidth = 2 / S; c.strokeRect(-sp.len / 2, -sp.width / 2, sp.len, sp.width); c.restore();
  }
  for (const v of units.values()) {
    c.beginPath(); c.arc(v.x, v.z, isVeh(v.type) ? 3.5 : 2.6, 0, Math.PI * 2); c.fillStyle = col(v.owner); c.fill();
    if (selected.has(v.id)) { c.strokeStyle = '#fff'; c.lineWidth = 1.5 / S; c.stroke(); }
  }
  alerts.drawPings(c, S);
  pings.drawMinimap(c, S);
  // what the camera sees
  const corners = rig.corners(field);
  if (corners.length === 4) { c.beginPath(); corners.forEach((p, i) => (i ? c.lineTo(p.x, p.z) : c.moveTo(p.x, p.z))); c.closePath(); c.strokeStyle = '#fff8'; c.lineWidth = 1.5 / S; c.stroke(); }
}
{
  const cv = $('minimap');
  let mmDrag = false;
  const at = (e) => { const b = cv.getBoundingClientRect(); return mmToWorld((e.clientX - b.left) * cv.width / b.width, (e.clientY - b.top) * cv.height / b.height); };
  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  cv.addEventListener('mousedown', (e) => {
    e.stopPropagation(); rig.cancelFollow();
    const p = at(e);
    if (e.button === 0 && e.altKey && !rig.intro) { e.preventDefault(); pings.send(p.x, p.z); return; }
    if (targeting === 'rally') { if (e.button === 0) rallyAt(p); else if (e.button === 2) cancelAim(); return; }
    if (targeting && e.button === 2) { cancelAim(); return; }
    if (e.button === 0) { mmDrag = true; cam.x = p.x; cam.z = p.z; }
    else if (e.button === 2 && selected.size && lastSnap) orders.dispatch(minimapCursor(p), e);
  });
  addEventListener('mousemove', (e) => { if (mmDrag && !(e.buttons & 1)) mmDrag = false; if (mmDrag) { rig.cancelFollow(); const p = at(e); cam.x = p.x; cam.z = p.z; } });
  addEventListener('blur', () => (mmDrag = false));
  document.addEventListener('mouseleave', () => (mmDrag = false));
  document.addEventListener('visibilitychange', () => { if (document.hidden) mmDrag = false; });
  addEventListener('mouseup', () => (mmDrag = false));
}
let fogTimer = 0;
const lerpAngle = (a, b, k) => a + (Math.atan2(Math.sin(b - a), Math.cos(b - a))) * k;

let fogVis = null;
function updateFog() {
  if (!fogTex) return;
  const { w, h } = fogGrid, d = fogTex.image.data, vis = fogVis = new Uint8Array(w * h);
  for (const v of units.values()) {
    if (foe(v.owner)) continue; // allies share vision
    const r = UNITS[v.type].vision / CELL, cx = v.x / CELL, cy = v.z / CELL;
    for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(h - 1, cy + r); y++)
      for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(w - 1, cx + r); x++)
        if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) vis[y * w + x] = 1;
  }
  if (epilogue.active()) vis.fill(1); // the match is decided: the fog lifts
  // DataTexture row 0 is the far (z = max) edge of the plane
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = ((h - 1 - y) * w + x) * 4; d[i] = d[i + 1] = d[i + 2] = 10; d[i + 3] = vis[y * w + x] ? 0 : 120; }
  fogTex.needsUpdate = true;
}

const effects = createEffects({ scene, camera, cam, hAt, units, sounds: false, colorOf: (slot) => look(slot).color });
const objectives = createObjectives({ points: () => points, units, effects, hAt, camera, cam, colorOf: (slot) => look(slot).color, me: () => me, friend: (slot) => !foe(slot) });
objectives.init();
endgame.init({ me: () => me, teams: () => teams });
renderer.setAnimationLoop(() => {
  const now = performance.now(), dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
  const sdt = epilogue.frame(dt, cam); // screen time: slower once the match is decided, and the camera glides there
  // camera
  rig.update(dt);

  // units: smooth toward the latest server state
  const k = 1 - Math.exp(-sdt * 1000 / snapshotGap);
  for (const v of units.values()) {
    v.x += (v.tx - v.x) * k; v.z += (v.tz - v.z) * k;
    v.rot = lerpAngle(v.rot, v.trot, k); v.aim = lerpAngle(v.aim, v.taim, k * 0.6);
    const gy = hAt(v.x, v.z);
    const air = isAir(v.type), up = air ? AIR_ALT : 0;
    v.root.position.set(v.x, gy + up, v.z); v.root.rotation.y = -v.rot;
    if (air) { v.root.visible = v.bars.visible = !(v.flags & 512); v.base.visible = false; }
    if (v.turret) v.turret.rotation.y = -(v.aim - v.rot);
    v.bars.position.set(v.x, gy + (v.garr ? 7.5 : barY(v.type)), v.z); v.bars.quaternion.copy(camera.quaternion);
    v.sel.visible = selected.has(v.id);
    if (v.range) v.range.visible = v.sel.visible;
    animate(v, sdt, camera.position); // posture from suppression and retreat, far-away soldiers (client/unit-models.js)
  }
  battleFrame(cam, units, me);
  bodies.update(sdt);
  for (let i = fx.length - 1; i >= 0; i--) {
    const e = fx[i]; e.life -= sdt;
    if (e.life <= 0) { world.remove(e.obj); e.dispose?.(); fx.splice(i, 1); } else e.update(e.max ? e.life / e.max : 1);
  }
  objectives.frame(sdt); effects.update(sdt);
  if ((fogTimer -= dt) <= 0) { fogTimer = 0.2; updateFog(); }
  alerts.frame();
  pings.frame();
  endgame.frame();
  if (!EDIT && (mmTimer -= dt) <= 0) { mmTimer = alerts.pinging() || pings.active() ? 0.05 : 0.15; drawMinimap(); }
  // aim preview follows the mouse while targeting
  if (targeting && world) {
    if (aimMesh?.userData.kind !== targeting) { if (aimMesh) world.remove(aimMesh); aimMesh = aimShape(targeting, 0xffe08a); aimMesh.userData.kind = targeting; world.add(aimMesh); }
    const g = groundAt(mouse.x, mouse.y);
    if (aimCenter) {
      aimMesh.position.set(aimCenter.x, hAt(aimCenter.x, aimCenter.z), aimCenter.z);
      if (g && Math.hypot(g.x - aimCenter.x, g.z - aimCenter.z) > 1.5) aimMesh.rotation.y = -Math.atan2(g.z - aimCenter.z, g.x - aimCenter.x);
    } else if (g && UNITS[targeting]?.building) {
      const f = footAt(targeting, g);
      aimMesh.position.set(f.x, hAt(f.x, f.z), f.z); aimMesh.userData.mat.color.set(f.ok ? 0x60e070 : 0xe04030);
    } else if (g) { aimMesh.position.set(g.x, hAt(g.x, g.z), g.z); aimMesh.rotation.y = -defaultDir(targeting, g); }
    if (targeting === 'dig' && (aimCenter || g)) {
      const at = aimCenter ?? g, dir = -aimMesh.rotation.y, f = footAt(fortKind, at, dir);
      aimMesh.userData.mat.color.set(f.ok ? 0x60e070 : 0xe04030);
    }
  } else if (aimMesh) { world.remove(aimMesh); aimMesh = null; }
  const pulse = 0.25 + 0.2 * Math.sin(now / 120);
  for (const m of strikeMarks.values()) m.userData.mat.opacity = m.userData.t > 0 ? pulse : 0.2;
  renderer.domElement.style.cursor = targeting ? 'cell' : selected.size && pick(mouse.x, mouse.y, v => foe(v.owner)) ? 'crosshair' : 'default';
  renderer.render(scene, camera);
  perf.frame(renderer, now, { units: units.size, fx: effects.count, corpses: bodies.count });
});

if (EDIT) { $('overlay').classList.add('hidden'); import('./editor.js').then(m => m.start({ startGame, cam, groundAt, renderer, scene, hAt })); }

// debug handle for poking at the game from devtools
window.__game = { renderer, scene, camera, cam, units, selected, sendCmd, makeUnit, hAt, groundAt, rig, pings, alerts, epilogue, effects, objectives, endgame, get groundMesh() { return groundMesh; }, get me() { return me; }, get snapshot() { return lastSnap; }, get points() { return points; } };
// the alerts list above the minimap (client/alerts.js) sees the match through these
alerts.init({ me: () => me, friend: (slot) => !foe(slot), unitName: (type, owner) => look(owner).names[type] ?? UNITS[type].name, playerName: (slot) => names[slot] ?? 'An ally',
  resetPings: pings.reset, pointPos: (i) => points[i]?.g.position, home: () => home, jump: (x, z) => { rig.cancelFollow(); cam.x = x; cam.z = z; },
  onScreen: (x, z) => { const p = screenOf({ x, z }); return p.front && p.x >= 0 && p.x <= innerWidth && p.y >= 0 && p.y <= innerHeight; } });

pings.init({ scene, hAt, send: sendCmd, playerName: (slot) => names[slot] ?? 'An ally' });
