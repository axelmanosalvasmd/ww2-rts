import * as THREE from 'three';
import { createHud } from './hud.js';
import { createEffects } from './fx.js';
import { bindings, match } from './keys.js';
import { createSelection } from './selection.js';
import { createOrders } from './orders.js';
import { availability, denySentence, placementState } from './availability.js';
import { createFeedback } from './feedback.js';
import { UNITS, UNIT_TYPES, CELL, CFG, SUPPORT, SUPPORT_TYPES, BUILDABLE, levelOf, levelChar, startState, canBuild, winVp, supCost, popCap, abCost, priceOf, FORTS, placementCheck, ENTRENCH, entrenchPlan, segmentCost } from '/shared/sim.js';
import { alerts } from './alerts.js';
import { setupLight, renderFrame } from './light.js';
import { createAtmosphere } from './atmosphere.js';
import { createGround } from './ground.js';
import { setWind } from './wind.js';
import { surface, setFogMap } from './surfaces.js';
import { buildStructures as buildPieces, sandbagRing, hqCamp, buildingModel } from './structures.js';
import { createRelief } from './relief.js';
import { gfx } from './gfx.js';
import { rig, groundAt as marchGround } from './camera.js';
import { createPointer } from './pointer.js';
import { pings } from './pings.js';
import { label, symbolBadge, ownerRing, setOwnerRing, selectionRing, hqRing, flagMat, clickRing, capturePoint, planLayer, nodeSquare, strikeZone, MOVE_COLOR } from './markers.js';
import { disposeTree } from './upkeep.js';
import { audio } from './audio.js';
import { battleFrame } from './battle-sound.js';
import { createProps } from './props.js';
import { createWater } from './water.js';
import { createAviation } from './aircraft.js';
import { epilogue } from './epilogue.js';
import { createObjectives } from './objectives.js';
import { endgame } from './endgame.js';
import { buildModel, animate, createBodies, setSurfaces, setBuildings } from './unit-models.js';
import { perf, renderScale } from './perf.js';
import { renderReport } from './report.js';
import { createConnection } from './connection.js';
import { roomAddress, roomToken, matchStorage } from './room-session.js';
import { createAutocast } from './autocast.js';

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
const autocast = createAutocast({ storage: local, send: sendCmd }); // remembered per unit type (client/autocast.js)
connection.on('lobby', renderLobby);
connection.on('start', receiveStart);
connection.on('s', (m, size) => { perf.net(size); applySnapshot(m); });
connection.on('ping', (m) => pings.receive(m));
connection.on('deny', (m) => feedback.show(denySentence(m.reason, m.cmd)));
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
    pointer.beforeFullscreen();
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
  horde: 'Co-op: everyone shares one HQ and defends one command bunker against waves that keep growing. The next wave comes when the last one is dead. How far can you get?',
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
  const at = (p) => [ox + (p.x + 0.5) * s, oy + (p.y + 0.5) * s], horde = mode === 'horde', assault = mode === 'assault' || horde, noVp = assault || mode === 'annihilation';
  const points = m.points.filter(p => !noVp || (p.mp ?? 1) > 0);
  for (const p of points) { c.beginPath(); c.arc(...at(p), Math.max(4, CFG.pointRadius / CELL * s), 0, 7); c.strokeStyle = '#f0d98a'; c.lineWidth = 2; c.stroke(); }
  const spawns = m.spawns.map((sp, i) => [sp, i]).filter(([sp]) => mode === 'assault' || !sp.assault);
  for (const [sp, i] of spawns) {
    c.beginPath(); c.arc(...at(sp), 6, 0, 7);
    c.fillStyle = assault && m.defend ? (m.defend.includes(i) ? '#d94a3d' : '#3d7bd9') : '#f2ecd8'; c.fill();
    c.strokeStyle = '#111'; c.lineWidth = 2; c.stroke();
  }
  const top = Math.max(0, ...(m.heights || []).flatMap(r => [...r].map(levelOf)));
  $('mapInfo').innerHTML = [`<b style="color:var(--ink)">${esc(m.name)}</b>`, `${m.w * CELL} × ${m.h * CELL} m`, horde ? `up to ${COLORS.length - 1} defenders` : `up to ${spawns.length} players`,
    `${points.length} capture point${points.length === 1 ? '' : 's'}`, top >= 3 ? 'hills and cliffs' : top > 0 ? 'rolling hills' : '',
    m.rows.some(r => r.includes('W')) ? 'rivers' : '', m.defend ? (horde ? '<span style="color:#d94a3d">●</span> your HQ is one of these · <span style="color:#3d7bd9">●</span> the horde comes from here' : assault ? '<span style="color:#d94a3d">●</span> defend · <span style="color:#3d7bd9">●</span> attack' : 'built for Assault') : '',
    mode === 'assault' && m.assaultTime ? `${Math.round(m.assaultTime / 60)} minute clock` : ''].filter(Boolean).map(t => `<div>${t}</div>`).join('');
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
      <span class="who"><span class="nm">${esc(p.name)}</span><span class="muted">${[i === m.you && 'you', !p.connected && 'offline', i === m.host && 'host'].filter(Boolean).join(' · ')}</span></span>
      <span style="margin-left:auto">${pick('team', i, p.team, COLORS.map((_, k) => 'Team ' + (k + 1)), host && m.mode !== 'horde')} ${pick('faction', i, p.faction, FACTIONS.map(f => f.name), i === m.you || (host && p.ai))}</span>${kick}</div>`;
  }).join('') + (n < COLORS.length ? '<div class="slot muted">open slot</div>' : '');
  $('roster').querySelectorAll('.kick').forEach(b => (b.onclick = () => sendCmd({ t: 'kick', slot: +b.dataset.slot })));
  $('roster').querySelectorAll('select').forEach(el => (el.onchange = () => sendCmd({ t: el.dataset.kind, slot: +el.dataset.slot, v: +el.value })));
  $('start').classList.toggle('hidden', !host || m.state === 'play');
  const horde = m.mode === 'horde'; // Horde: only maps with defender spawns, never Endless
  $('mapSel').innerHTML = (m.maps || []).map(n => `<option value="${esc(n)}" ${n === m.mapName ? 'selected' : ''} ${horde && !m.hordeMaps?.includes(n) ? 'disabled' : ''}>${esc(prettyMap(n))}</option>`).join('');
  previewMap(m.mapName, m.mode || 'conquest');
  $('mapSel').disabled = !host || !lobby;
  // Assault: the host picks which team defends; everyone else attacks
  const assault = m.mode === 'assault', teamIds = [...new Set(m.players.map(p => p.team))].sort((a, b) => a - b);
  $('modeSel').value = m.mode || 'conquest'; $('modeSel').disabled = !host || !lobby;
  $('armySel').value = m.army || 'standard'; $('armySel').disabled = !host || !lobby;
  for (const o of $('armySel').options) if (o.value === 'endless') o.hidden = o.disabled = horde;
  const best = m.hordeBest, mins = (t) => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  $('modeInfo').textContent = (MODE_INFO[m.mode || 'conquest'] ?? '') + (!horde ? '' : best ? ` Record here with ${n} defender${n === 1 ? '' : 's'}: wave ${best.wave} in ${mins(best.time)} (${best.names.join(', ')}).` : ` No record yet here with ${n} defender${n === 1 ? '' : 's'}.`);
  $('defSel').classList.toggle('hidden', !assault);
  $('defSel').innerHTML = teamIds.map(t => `<option value="${t}" ${t === m.defenderTeam ? 'selected' : ''}>Team ${t + 1} defends (${m.players.filter(p => p.team === t).map(p => esc(p.name)).join(', ')})</option>`).join('');
  $('defSel').disabled = !host || !lobby;
  const assaultOk = !assault || (m.players.some(p => p.team === m.defenderTeam) && m.players.some(p => p.team !== m.defenderTeam));
  $('addAi').classList.toggle('hidden', !host || !lobby || n >= COLORS.length);
  // "3v3", "2v2v2", "1v1", or FFA when nobody shares a team
  const sizes = [...new Set(m.players.map(p => p.team))].map(t => m.players.filter(p => p.team === t).length);
  const mode = n === 1 ? 'solo test' : sizes.length === 1 ? 'co-op' : sizes.every(k => k === 1) && n > 2 ? `${n}-way FFA` : sizes.join('v');
  $('start').textContent = `${m.result ? 'Play again' : 'Start'}: ${horde ? `horde, ${n} defender${n === 1 ? '' : 's'}` : assault ? 'assault' : m.mode === 'classic' || m.mode === 'annihilation' ? m.mode + ' ' + mode : mode}`;
  const tooMany = n > (m.spawns ?? 3);
  $('start').disabled = tooMany || !assaultOk;
  $('lobbyMsg').textContent = tooMany ? (horde ? `Horde seats ${m.spawns} defenders: remove a player.` : `This map has ${m.spawns} spawns: pick a bigger map or remove players.`) : !assaultOk ? 'Assault needs players on the defending team and on another team.' : host ? (n === 1 ? `Send the invite link, or add an AI ${horde ? 'teammate' : 'opponent'}.` : '') : 'Waiting for the host to start...';
  // the last match's result, until the next one starts (the room is back in the lobby: change map or mode freely)
  const r = m.result, w = r?.winner;
  $('result').classList.toggle('hidden', !r);
  if (r) $('result').textContent = r.ended ? 'Match ended by the host' : r.horde ? `Overrun on wave ${r.horde.wave}: ${r.horde.kills} kills in ${mins(r.horde.time)}${r.horde.record ? ' · new record' : r.horde.best ? ` · record: wave ${r.horde.best.wave}` : ''}` : w === -1 ? 'Draw' : w === r.teams[me] ? 'Victory'
    : `${r.names.filter((_, i) => r.teams[i] === w).join(' & ') || 'Enemy'} win${r.teams.filter(t => t === w).length > 1 ? '' : 's'}`;
  renderReport(r, $('report'), { colors: COLORS.map(css), me: m.you }); // the chart and table under it (client/report.js)
  if (lobby) { lastStart = null; matchMemory.clear(); menuOpen(false); $('hud').classList.add('hidden'); receivePause({ paused: false }); audio.end(); epilogue.reset(); }
  positionRoomBanners();
}

// ---------- renderer / scene ----------

setSurfaces(surface); // structure models take the textured wood and sandbag (client/surfaces.js)
setBuildings(buildingModel); // HQ, barracks, motor pool, depot and command bunker: one merged model each (client/structures.js)
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.localClippingEnabled = true; // the HQ's ring and disc are cut at the board edge (buildHQ)
renderScale(renderer); // pixel ratio per graphics level (client/perf.js); shadows are set in client/light.js
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, 1, 1, 1000);
const lights = setupLight(renderer, scene, camera); // tone, sun + sky fill, haze, table, Graphics High/Low (client/light.js)
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

let world, MW = 0, MH = 0, fogTex, fogGrid, points = [], groundMesh = null, fogMesh = null, water = null;
const SHARED_GEOS = new Set(Object.values(GEO));

// Ground height and the board surface come from client/relief.js: cliffs, eased slopes, river beds and banks.
let relief = null;
function hAt(x, z) { return relief?.hAt(x, z) ?? 0; }
const units = new Map(), selected = new Set(), groups = {}, fx = [];

let lastStart = null;
function startGame(m, restored = null) {
  pings.reset(); autocast.reset();
  me = m.you; names = m.names; teams = m.teams ?? names.map((_, i) => i); factions = m.factions ?? []; lastStart = m; mmImage = null;
  if (!EDIT) audio.start({ faction: facOf(me), slot: me });
  const map = m.map;
  relief?.dispose(); fogMesh?.material.dispose(); fogMesh = null;
  if (world) { scene.remove(world); disposeTree(world, SHARED_GEOS); fogTex?.dispose(); } // Play again reuses the page
  world = new THREE.Group(); scene.add(world);
  units.clear(); selected.clear(); selection.reset();
  if (m.resume && restored) {
    for (const id of restored.selected || []) if (Number.isSafeInteger(id)) selected.add(id);
    for (const [n, ids] of Object.entries(restored.groups || {})) if (/^[1-9]$/.test(n) && Array.isArray(ids)) groups[n] = ids.filter(Number.isSafeInteger);
  }
  fx.length = 0; lastSnap = null; effects.reset(); for (const m of strikeMarks.values()) m.dispose(); strikeMarks.clear(); aviation.reset(); epilogue.reset(); snapshotAt = 0; snapshotGap = 100;
  objectives.reset(); endgame.reset();
  MW = map.w * CELL; MH = map.h * CELL;

  // ground: painted canvas (client/ground.js), reused across rebuilds of a same-sized map
  const gp = createGround(map, renderer);
  terrain = { w: map.w, grid: map.rows.map(r => [...r]), ctx: gp.ctx, tex: gp.tex, px: gp.px, ground: gp, group: new THREE.Group() };
  world.add(terrain.group);
  // what the server says about a cell besides its type: wear, burnt, damage stage (see startState in shared/sim.js)
  terrain.state = Uint8Array.from(map.rows.join(''), startState);
  for (const [cell, ch, lv, st] of m.cells || []) { terrain.grid[Math.floor(cell / map.w)][cell % map.w] = ch; terrain.state[cell] = st ?? 0; if (lv !== undefined) setLevel(map, cell, lv); }
  gp.paint(terrain.grid, terrain.state);
  // the fog overlay shares the relief's live geometry, which a crater replaces
  relief = createRelief(map, terrain.grid, { texture: gp.tex, isRoad: gp.isRoad, gfx, low: gfx.low,
    onGeometry: geometry => { if (fogMesh) fogMesh.geometry = geometry; } });
  const ground = relief.mesh;
  world.add(ground); groundMesh = ground;

  buildStructures();
  water?.dispose(); water = createWater(terrain.grid, map, hAt); if (water) world.add(water.mesh);

  props?.dispose(); props = EDIT ? null : createProps({ map, grid: terrain.grid, hAt, parent: world });

  // capture points
  const assault = ['assault', 'annihilation', 'horde'].includes(lobbyState?.mode); // no VP in these
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
  setFogMap(EDIT ? null : fogTex, MW, MH); // walls and roofs darken in the fog too
  const fog = fogMesh = new THREE.Mesh(ground.geometry, new THREE.MeshBasicMaterial({ map: fogTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  fog.position.y = 0.12; fog.renderOrder = 1; fog.visible = !EDIT;
  world.add(fog);
  atmos.start({ map, key: lobbyState?.mapName, ground, hAt }); // mood, cloud shadows, table props, mist, weather, birds

  m.spawns.forEach((sp, i) => world.add(buildHQ(sp, i)));
  aimMesh = null; nodeMarks = null; coverGroup = null; ghosts.clear();

  buildBuyBar();
  buildSupportBar();
  $('hud').classList.toggle('hidden', EDIT);
  $('overlay').classList.add('hidden');
  positionRoomBanners();

  // camera: behind my spawn, looking at the map center, the HQ framed between the top panels and the recruit bar
  // (after the HUD is shown, so the camera can measure it)
  const sx = m.spawn.x, sz = m.spawn.z;
  home = m.spawn;
  if (m.resume && restored) Object.assign(cam, restored.camera);
  else {
    cam.yaw = Math.atan2(sx - MW / 2, sz - MH / 2); cam.dist = 60;
    rig.frame(sx, sz);
  }
  rig.startIntro(EDIT || m.resume === true);
}

// ---------- terrain that can change mid-match (digging, destruction) ----------
let terrain = null;
let props = null;
// all 3D terrain pieces (client/structures.js), rebuilt from the grid whenever a cell changes
function buildStructures() { buildPieces(terrain.group, terrain.grid, lastStart.map.rows, hAt, terrain.state); }

// the weather line under the scores: only there when it matters
function showWeather(rain, wet) {
  const text = rain > 0.3 ? 'Rain: vehicles slow off the road, fords deeper, sight shorter' : wet > 0.15 ? `Wet ground (${Math.round(wet * 100)}%): vehicles slow off the road` : '';
  if ($('wx').textContent !== text) $('wx').textContent = text;
}

// bombs and shells lower the ground: patch the map's height rows
function setLevel(map, cell, lv) {
  map.heights ??= map.rows.map(r => '0'.repeat(r.length));
  const x = cell % map.w, y = Math.floor(cell / map.w), r = map.heights[y];
  map.heights[y] = r.slice(0, x) + levelChar(lv) + r.slice(x + 1);
}

function applyCells(cells) {
  if (!cells?.length || !terrain) return;
  // Ground wear and scorching only change the paint. The relief, the 3D pieces, the scenery and the water are redone
  // only for cells whose type, height or damage stage changed: traffic wears many cells in a big battle.
  const shaped = [];
  let pieces = false;
  for (const entry of cells) {
    const [cell, ch, lv, st = 0] = entry, x = cell % terrain.w, y = Math.floor(cell / terrain.w), heights = lastStart.map.heights;
    const moved = terrain.grid[y][x] !== ch || (lv !== undefined && levelOf(heights?.[y]?.[x] ?? '0') !== lv);
    if (moved) shaped.push(entry);
    pieces ||= moved || (terrain.state[cell] ^ st) >> 3 > 0;
    terrain.grid[y][x] = ch; terrain.state[cell] = st;
    if (lv !== undefined) setLevel(lastStart.map, cell, lv);
  }
  terrain.ground.paint(terrain.grid, terrain.state); // repaints only the tiles around changed cells
  if (shaped.length) { relief.update(shaped); props?.refresh(); water?.changed(shaped); mmImage = null; } // the fog overlay follows the relief through onGeometry
  if (pieces) buildStructures();
}

// Each player's HQ: tinted reinforce zone, sandbag ring, command tent, flagpole and flag, name.
// A spawn near the board edge would hang its ring over the table: the zone and ring are cut at the edge and the
// bags past it are left out (the reinforce zone itself is unchanged).
function buildHQ(sp, slot) {
  const f = look(slot), R = CFG.reinforceRadius, g = new THREE.Group();
  g.position.set(sp.x, hAt(sp.x, sp.z), sp.z);
  const edge = [[1, 0, 0, 0], [-1, 0, 0, MW], [0, 0, 1, 0], [0, 0, -1, MH]].map(([x, y, z, d]) => new THREE.Plane(new THREE.Vector3(x, y, z), d));
  const flat = (geo, opacity, y) => { const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: f.color, transparent: true, opacity, depthWrite: false, clippingPlanes: edge })); m.rotation.x = -Math.PI / 2; m.position.y = y; return m; };
  const zone = flat(new THREE.CircleGeometry(R - 0.75, 48), 0.07, 0.05); zone.material.color.set(f.color).lerp(new THREE.Color(0xf2ecdc), 0.6);
  const ring = hqRing(R, f.color, edge);
  g.add(zone, ring);
  g.add(onBoard(sandbagRing(R + 0.8), sp.x, sp.z, 0.75)); // sandbags with gaps for the exits (client/structures.js)
  // command tent, crates and the flagpole (client/structures.js); Classic's HQ is a building, so only the pole
  g.add(hqCamp(f, !classicMode()));
  // tall flag you can spot from across the map
  g.add(mesh(GEO.plane, flagMat(f.color), 4.5, 2.8, 1, 2.3, 13, 0));
  const tag = label(`${names[slot] ?? f.name} HQ`, { style: 'hq', color: f.color }); tag.position.y = 17; g.add(tag);
  return g;
}

// Keep the instances of an HQ piece at (ox, oz) whose center is at least pad inside the board.
function onBoard(im, ox, oz, pad) {
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), c = new THREE.Color();
  let n = 0;
  for (let i = 0; i < im.count; i++) {
    im.getMatrixAt(i, m); p.setFromMatrixPosition(m);
    const x = ox + p.x, z = oz + p.z;
    if (x < pad || z < pad || x > MW - pad || z > MH - pad) continue;
    if (n !== i) { im.setMatrixAt(n, m); if (im.instanceColor) { im.getColorAt(i, c); im.setColorAt(n, c); } }
    n++;
  }
  if (n < im.count) { im.count = n; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; im.computeBoundingSphere(); }
  return im;
}

// ---------- units ----------

function makeUnit(id, type, owner) {
  const def = UNITS[type], f = look(owner), root = new THREE.Group();
  const v = { id, type, owner, root, models: [], alive: def.models, x: 0, z: 0, rot: 0, aim: 0, turret: null };
  // owner ring, then the selection ring (it carries the weapon range rings, and the minimum range of rocket salvos)
  const base = ownerRing(def.radius + 0.4, f.color);
  Object.assign(v, selectionRing(def.radius + 1, def.w ? [def.w.range, def.w.minRange].filter(Boolean) : []));
  root.add(base, v.sel); v.base = base;
  if (isAir(type)) aviation.buildUnit(v, root, type, owner);   // per-faction plane, propellers, shadow (client/aircraft.js)
  else if (type === 'airfield') aviation.buildAirfield(v, root, owner);
  else buildModel(v, root, f, facOf(owner), def); // soldiers, vehicles, guns and structures, merged per part (client/unit-models.js)
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
  world.remove(v.bars);
  if (isAir(v.type)) {
    // a plane shot down falls as its own copy, drawn from the 'planedown' shot (client/aircraft.js); this one just goes
    aviation.release(v); world.remove(v.root);
  } else if (v.killed && isVeh(v.type)) {
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

// sound: audio.js plays it, fx.js and battle-sound.js call it; blip() is a UI sound ('click', 'recruit' or 'error', a number means click)
function blip(kind) { audio.ui(typeof kind === 'string' ? kind : 'click'); }

function marker(x, z, color) {
  const m = clickRing(color);
  m.position.set(x, hAt(x, z) + 0.3, z);
  world.add(m);
  fx.push({ obj: m, life: 0.6, max: 0.6, update: (f) => { m.scale.setScalar(0.5 + (1 - f) * 2); m.material.opacity = f; }, dispose: () => m.material.dispose() });
}

// planes, airfields, flak bursts and shoot-downs (client/aircraft.js)
// effects is made further down; explode and play only run once a match is on
const aviation = createAviation({ hAt, UNITS, SUPPORT, units, altitude: AIR_ALT, world: () => world, facOf, colorOf: (slot) => look(slot).color, vehicleOf: (slot) => look(slot).vehicle, me: () => me,
  explode: (x, z, size, opts) => effects.explode(x, z, size, opts), play: (name, x, z, opts) => audio.play(name, { x, z }, opts), flakTypes: new Set(['flak', 'flaktrack', 'flakpos']) });
// shots aircraft.js draws instead of fx.js; a support plane's value is the engine sound it comes in with
const SUPPORT_PLANES = { strafe: 'plane_flyby', recon: 'plane_flyby', dive: 'plane_flyby', bombing: 'bomber', para: 'bomber' };
// ('flak' with a target or a hit flag is a flak gun firing at the ground, which stays with fx.js)
const AIR_SHOTS = new Set([...Object.keys(SUPPORT_PLANES), 'chutes', 'shotdown', 'planedown', 'flak', 'aa']);
const airShot = (sh) => AIR_SHOTS.has(sh.k) && !(sh.k === 'flak' && (sh.t !== undefined || sh.hit !== undefined));

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
  autocast.adopt(s.units, me, classicMode()); // new units of a type take the player's remembered autocast choice
  for (const sh of s.shots) {
    if (sh.kill && units.get(sh.t)) units.get(sh.t).killed = true;
    if (!airShot(sh)) continue;
    // planes, parachutes, flak and shoot-downs are drawn by client/aircraft.js; their sounds go through client/audio.js
    const at = { x: sh.x, z: sh.z };
    if (SUPPORT_PLANES[sh.k]) { aviation.supportPlane(sh); audio.play(SUPPORT_PLANES[sh.k], at); }
    else if (sh.k === 'chutes') chutes(sh.x, sh.z);
    else if (sh.k === 'shotdown' || sh.k === 'planedown') { aviation.shotDown(sh); audio.play('flak', at); }
    else if (sh.k === 'flak') { aviation.flak(sh); audio.play('flak', at); }
    else if (sh.k === 'aa') {
      const a = seen.has(sh.f) ? units.get(sh.f) : null, b = seen.has(sh.t) ? units.get(sh.t) : null;
      if (a && b) aviation.aaBurst(a, b);
      effects.aaFire(sh, a, b); // the guns' tracers and their sound (client/fx.js); aircraft.js draws the bursts
    }
  }
  // flashes, tracers, blasts and smoke for the ground war and their sounds (client/fx.js); the air shots and the
  // planes' strike warnings are left out so nothing is drawn twice
  // the wind first: it carries this snapshot's smoke, dust and flames
  if (s.wx) { setWind(s.wx[2], s.wx[3]); atmos.setWeather(s.wx[0], s.wx[1]); showWeather(s.wx[0], s.wx[1]); }
  const fires = (s.fires ?? []).map(c => [(c % terrain.w + 0.5) * CELL, (Math.floor(c / terrain.w) + 0.5) * CELL]);
  effects.snapshot({ ...s, fires, shots: s.shots.filter(sh => !airShot(sh)), strikes: (s.strikes ?? []).filter(([k]) => !SUPPORT_PLANES[k]) }, seen);
  objectives.snapshot(s); // capture point rings, flips, building smoke and collapse banners (client/objectives.js)
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
  if (s.nodes && !nodeMarks) { props?.setNodes(s.nodes); nodeMarks = s.nodes.map(([x, z, rate, fuel]) => { const m = nodeMark(x, z, rate, fuel); world.add(m); return m; }); }

  syncStrikes(s.strikes);
  applyCells(s.cells);
  const ending = !epilogue.active();
  epilogue.snapshot(s, teams[me] ?? me); // the first one with a winner starts the ending (client/epilogue.js)
  if (ending && epilogue.active()) { rig.skipIntro(); rig.cancelFollow(); } // the ending's camera glide takes over the camera
  alerts.snapshot(s, lastSnap);
  lastSnap = s; drawWorks(s.works);
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
      // grease-pencil outline, hatching and a faint wash on the ground (client/markers.js): red for the enemy's
      m = strikeZone(strikeShape(kind), !foe(owner) ? look(owner).color : 0xd2321e, { x, z, rot: -dir, hAt });
      world.add(m.group); strikeMarks.set(key, m);
    }
    m.t = t;
  }
  for (const [key, m] of strikeMarks) if (!keep.has(key)) { world.remove(m.group); m.dispose(); strikeMarks.delete(key); }
}
function strikeShape(kind) {
  if (UNITS[kind]?.building) { const size = UNITS[kind].size * CELL; return { len: size, width: size, arrow: false }; }
  if (SUPPORT[kind]?.point) return { r: SUPPORT[kind].radius ?? SUPPORT[kind].blast ?? 4 };
  if (kind === 'grenade') return { r: UNITS.rifle.ab.radius };
  if (kind === 'barrage') return { r: UNITS.rocket.w.spread };
  if (kind === 'satchel') return { r: UNITS.ranger.ab.radius };
  if (SUPPORT[kind]?.len) return { len: SUPPORT[kind].len, width: SUPPORT[kind].width };
  return { r: 4 };
}
// ring for area strikes, a long strip for a strafing run
function aimShape(kind, color) {
  const g = new THREE.Group(), matl = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false, depthTest: false, side: THREE.DoubleSide });
  const flat = (geo) => { const m = new THREE.Mesh(geo, matl); m.rotation.x = -Math.PI / 2; m.position.y = 0.2; m.renderOrder = 2; return m; };
  if (kind === 'entrench') g.userData.tiles = []; // filled by entrenchPreview
  else if (UNITS[kind]?.building) g.add(flat(new THREE.PlaneGeometry(UNITS[kind].size * CELL, UNITS[kind].size * CELL)));
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
// paratroopers: a few canopies drifting down onto the drop
function chutes(x, z) {
  for (let i = 0; i < 5; i++) {
    const g = new THREE.Group(), cx = x + (Math.random() - 0.5) * 8, cz = z + (Math.random() - 0.5) * 8;
    g.add(mesh(GEO.ball, mat(0xd8d2b8), 1.4, 0.6, 1.4, 0, 2, 0), mesh(GEO.box, mat(0x3c4128), 0.3, 1, 0.3, 0, 0.5, 0));
    world.add(g);
    fx.push({ obj: g, life: 3, max: 3, update: (f) => g.position.set(cx, hAt(cx, cz) + f * 22, cz) });
  }
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
  get me() { return me; }, get teams() { return teams; }, get names() { return names; }, get PRIORITY() { return PRIORITY; }, get host() { return lobbyState?.host === me; },
  units, selected, look, facOf, color: (slot) => css(look(slot).color), classic: () => classicMode(), send: sendCmd, blip,
  retreat: () => retreat(), takeCover: (q) => takeCover(q), stance: (k) => toggleStance(k), entrench: (k) => startEntrench(k), stop: () => { sendCmd({ t: 'stop', ids: [...selected] }); blip(330); }, amove: () => selected.size && setAim('amove'), rally: () => startRally(),
  dig: (k) => startDig(k), build: (k) => startBuild(k), ability: (t) => useAbility(t), support: (k) => aimSupport(k), fType: () => fKeyType(),
  autocast: (t) => { const on = autocast.toggle(t, [...selected].map(id => units.get(id)).filter(v => v?.type === t && v.owner === me), classicMode()); if (on !== null) blip(); },
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
// Mass entrenchment: two clicks give the pattern its two points, and every selected builder squad digs it.
let entrenchKind = 'line', entrenchHint = '';
function startEntrench(kind) { if (explainUnavailable(available({ t: 'entrench' }))) return; entrenchKind = kind; entrenchHint = ''; setAim('entrench'); $('hint').textContent = `${ENTRENCH[kind]}: click where it starts · right-click cancels`; blip(600); }
// the segments of the armed pattern that can be built, with their cells, as the server will judge them
function entrenchSegments(a, b) {
  const crew = diggers(), view = placementView();
  if (!crew.length || !view) return [];
  const back = { x: crew.reduce((s, v) => s + v.x, 0) / crew.length, z: crew.reduce((s, v) => s + v.z, 0) / crew.length };
  return entrenchPlan(entrenchKind, a, b, back).map(j => ({ ...j, place: placementCheck(view.game, j, (spot) => view.sees(me, spot)) })).filter(j => j.place.ok);
}
// what the armed pattern costs, and how much of it starts right away with the squads and manpower at hand
function entrenchSummary(segs) {
  const costs = segs.map(j => segmentCost(j.kind, j.place.cells.length)), total = costs.reduce((s, c) => s + c, 0);
  let mp = lastSnap?.mp ?? 0, now = 0;
  for (const c of costs.slice(0, diggers().length)) { if (mp < c) break; mp -= c; now++; }
  return !segs.length ? `${ENTRENCH[entrenchKind]}: nothing can be dug there`
    : `${ENTRENCH[entrenchKind]}: ${segs.length} segment${segs.length > 1 ? 's' : ''}, ${total} MP${now < segs.length ? ` · ${now} of ${segs.length} start now, the rest as squads and manpower free up` : ''}`;
}
// a square on every cell the segments would dig (trench green, wire brass); the tiles are pooled on the group
function paintTiles(group, segs, opacity) {
  const w = placementView()?.game.w ?? 1, tiles = group.userData.tiles ??= [];
  let n = 0;
  for (const j of segs) for (const [c] of j.place.cells) {
    let t = tiles[n];
    if (!t) { t = new THREE.Mesh(new THREE.PlaneGeometry(CELL * 0.86, CELL * 0.86), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide })); t.rotation.x = -Math.PI / 2; t.renderOrder = 2; tiles.push(t); group.add(t); }
    const x = (c % w + 0.5) * CELL, z = (Math.floor(c / w) + 0.5) * CELL;
    t.visible = true; t.position.set(x, hAt(x, z) + 0.2, z); t.material.color.set(j.kind === 'wire' ? 0xd2a849 : 0x60e070); t.material.opacity = opacity;
    n++;
  }
  for (let i = n; i < tiles.length; i++) tiles[i].visible = false;
}
// The ghost of your side's ordered entrenchments: what is still to dig, fainter than the placement preview. Redrawn
// when the list changes. works: [project id, 1 for wire, x, z, dir] from the snapshot.
let works = [], worksKey = '', worksGroup = null;
function drawWorks(list = []) {
  works = list;
  const key = list.join(';'), view = placementView();
  if (!world || !view || (key === worksKey && worksGroup?.parent === world)) return;
  worksKey = key;
  if (worksGroup?.parent !== world) { worksGroup = new THREE.Group(); world.add(worksGroup); }
  paintTiles(worksGroup, list.map(([, wire, x, z, dir]) => { const j = { kind: wire ? 'wire' : 'trench', x, z, dir }; return { ...j, place: placementCheck(view.game, j) }; }).filter(j => j.place.ok), 0.26);
}
// the planned entrenchment under a ground click (a segment within 5 m), for sending more squads to it
function worksAt(g) {
  let best = null, bd = 5;
  if (g) for (const [id, , x, z] of works) { const d = Math.hypot(x - g.x, z - g.z); if (d < bd) { bd = d; best = id; } }
  return best;
}
// the placement preview, redrawn as the mouse moves
function entrenchPreview(group, a, b) {
  const segs = entrenchSegments(a, b);
  paintTiles(group, segs, 0.5);
  const text = `${entrenchSummary(segs)} · click ${aimCenter ? 'to dig' : 'where it starts'} · right-click cancels`;
  if (text !== entrenchHint) { entrenchHint = text; $('hint').textContent = text; }
}
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
  const g = new THREE.Group();
  g.add(nodeSquare(fuel ? 0xe07a30 : 0xd2a849), mesh(GEO.box, surface('wood'), 0.8, 0.6, 0.8, 0, 0.3, 0));
  // what a depot here pays: the richer contested nodes are worth fighting for
  const tag = label(fuel ? `+${rate} Fuel/s` : `+${rate} MP/s`); tag.position.y = 3; g.add(tag);
  g.position.set(x, hAt(x, z), z);
  return g;
}
function nearestDigger(g) { return diggers().sort((a, b) => Math.hypot(a.x - g.x, a.z - g.z) - Math.hypot(b.x - g.x, b.z - g.z))[0]; }

// the player's faction voice answers orders (audio.js picks the voice and keeps lines 2.5 s apart)
function bark(kind) { audio.voice(kind); }
audio.bind($('volume')); // the volume slider in the menu (0 mutes); M toggles mute
function toggleMute() { audio.toggleMute(); } // the M key (client/keys.js); the slider follows

function retreat() { if (selected.size) { sendCmd({ t: 'retreat', ids: [...selected] }); blip(260); bark('retreat'); } }
// stance switches: on for the whole selection unless every selected unit already has it
const STANCE_BIT = { holdFire: 2048, holdPos: 4096, autoRetreat: 8192 };
function toggleStance(key) {
  const us = [...selected].map(id => units.get(id)).filter(v => v && v.owner === me && !UNITS[v.type].structure);
  if (!us.length) return;
  sendCmd({ t: 'stance', ids: us.map(v => v.id), key, on: !us.every(v => v.flags & STANCE_BIT[key]) }); blip(480);
}
function takeCover(queue = false) { if (!selected.size || explainUnavailable(available({ t: 'cover' }))) return; sendCmd({ t: 'cover', ids: [...selected], queue: queue === true }); blip(420); }
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
  if (kind === 'dig') { const v = nearestDigger(at); return v ? Math.atan2(at.z - v.z, at.x - v.x) + (FORTS[fortKind].along ? 0 : Math.PI / 2) : 0; }
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
  const id = UNITS[type].ab.id;
  if (explainUnavailable(available({ t: 'ability', unit: type, queue: !!AIMED[id] }))) return;
  const ready = [...selected].map(id => units.get(id)).filter(v => v && (AIMED[id] || !v.cd) && !(v.flags & 1) && v.type === type);
  if (!ready.length) return;
  if (AIMED[id]) setAim(id, type);
  else { sendCmd({ t: 'ability', ids: ready.map(v => v.id) }); blip(880); }
}
function throwAt(g, kind, type, queue = false) {
  if (explainUnavailable(available({ t: 'ability', unit: type, queue }))) return;
  const who = [...selected].map(id => units.get(id)).filter(v => v && v.type === type && UNITS[v.type].ab.id === kind && (queue || !v.cd) && !(v.flags & 1));
  if (!who.length) return;
  who.sort((a, b) => Math.hypot(a.x - g.x, a.z - g.z) - Math.hypot(b.x - g.x, b.z - g.z));
  sendCmd({ t: 'ability', ids: [who[0].id], x: g.x, z: g.z, queue }); marker(g.x, g.z, 0xffa030); blip(760);
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
  units, selected, get me() { return me; }, defs: UNITS, diggers: CFG.fortBuilders, formation, send: sendCmd, moveColor: MOVE_COLOR,
  feedback: (at, color, tone, voice) => { marker(at.x, at.z, color); blip(tone); if (voice) bark(voice); },
});

// ---------- camera + input ----------

const cam = { x: 80, z: 80, yaw: 0, dist: 85 }, PITCH = 0.95, keys = new Set();
let mouse = { x: innerWidth / 2, y: innerHeight / 2, inside: false }, drag = null;
// created before the mouse listeners below: while Capture mouse is on, its window listeners must run first
const pointer = createPointer({ view: renderer.domElement, tryStore, captureButton: $('captureBtn'), captureNow: $('captureNow'),
  playing: () => !EDIT && !$('hud').classList.contains('hidden') && $('overlay').classList.contains('hidden') });
rig.init({ cam, camera, pitch: PITCH, keys, pointer, dragging: () => drag, world: () => world,
  blocked: () => !$('menu').classList.contains('hidden') || !$('overlay').classList.contains('hidden') || !$('replacedSeat').classList.contains('hidden'),
  units, hAt, bounds: () => ({ w: MW, h: MH }), groundAt: (x, y) => groundAt(x, y), tryStore,
  // the clear band for framing: below the score and status panels, above the recruit bar
  band: () => { const t = $('top').getBoundingClientRect(), b = $('buy').getBoundingClientRect(); return { top: t.height ? t.bottom : 0, bottom: b.height ? b.top : innerHeight }; },
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
addEventListener('mousedown', rig.introPress, { capture: true });

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
  retreat, cover: () => takeCover(), ability: () => useAbility(fKeyType()), amove: () => selected.size && setAim('amove'),
  mute: toggleMute,
  alert: () => { rig.cancelFollow(); const al = alerts.newest(); if (al) { cam.x = al.x; cam.z = al.z; } else centerSelection([...selected].map(id => units.get(id)).filter(Boolean)); },
  follow: followSelected, rally: startRally,
  home: () => {
    if (!home) return;
    rig.cancelFollow();
    rig.frame(home.x, home.z);
    const hq = classicMode() && [...units.values()].find(v => v.owner === me && v.type === 'hq');
    if (hq) { selected.clear(); selected.add(hq.id); }
  },
  clear: () => selected.clear(), cancelAim,
  recruitMode: () => classicMode() ? feedback.show('In Classic, select a Production Building and press the letters on its cards') : hud.setRecruit(!hud.recruiting()),
  recruitOff: () => hud.setRecruit(false),
  army: () => selection.army(), idle: () => selection.findIdle(), idleAll: () => selection.findIdle(true),
  idleEngineer: () => selection.findIdle(false, true),
  panForward: () => {}, panBack: () => {}, panLeft: () => {}, panRight: () => {}, rotateLeft: () => {}, rotateRight: () => {},
};
for (const { id } of bindings) {
  const [kind, value, number] = id.split(':');
  if (kind === 'support') actions[id] = () => aimSupport(value);
  else if (kind === 'fort') actions[id] = () => startDig(value);
  else if (kind === 'entrench') actions[id] = () => startEntrench(value);
  else if (kind === 'stance') actions[id] = () => toggleStance(value);
  else if (kind === 'build') actions[id] = () => startBuild(value);
  else if (kind === 'group') actions[id] = () => { selection.group(number, value, performance.now()); if (value !== 'recall') blip(990); };
  else if (kind === 'card' || kind === 'cardMany') actions[id] = () => hud.pressCard(+value, kind === 'cardMany');
}
// In a match (not the lobby or the open menu) Tab belongs to the game: it toggles recruit mode and never moves focus.
const inMatch = () => lobbyState?.state === 'play' && !$('hud').classList.contains('hidden') && $('menu').classList.contains('hidden');
const keyContexts = () => [classicMode() ? 'classic' : 'army', ...(!inMatch() ? [] : hud.recruiting() ? ['recruit'] : hud.lettered() ? ['building'] : []), ...(targeting ? ['targeting'] : [])];
addEventListener('keydown', (e) => {
  if (rig.skipIntro()) { e.preventDefault(); return; }
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName) || e.target.isContentEditable) return;
  keys.add(e.code);
  if (EDIT) return;
  if (e.code === 'Tab' && inMatch()) e.preventDefault();
  const contexts = keyContexts();
  let id = match(e, contexts);
  if (id === 'recruitMode' && !inMatch()) return;
  // a letter with no card under it (a Classic HQ has two, Conquest has 14 of the 15) keeps its usual meaning, camera keys included
  if (id?.startsWith('card') && !hud.hasCard(+id.split(':')[1])) id = match(e, contexts.filter((c) => c !== 'building' && c !== 'recruit'));
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
    if (AIMED[kind]) { const type = aimedUnit; if (explainUnavailable(available({ t: 'ability', unit: type, queue: e.shiftKey }))) return; cancelAim(); throwAt(g, kind, type, e.shiftKey); return; }
    if (kind === 'amove') { cancelAim(); orders.dispatch({ ground: g }, e, { attack: true }); return; }
    // first click: pin the center, then the mouse rotates it
    if (!aimCenter) { aimCenter = g; if (kind !== 'entrench') $('hint').textContent = `Move the mouse to rotate · click to ${kind === 'dig' ? 'place' : 'launch'}`; blip(560); return; }
    if (kind === 'entrench') {
      if (explainUnavailable(available({ t: 'entrench' }))) return;
      const a = aimCenter, segs = entrenchSegments(a, g);
      if (!segs.length) { feedback.show(denySentence('blocked')); return; }
      cancelAim();
      sendCmd({ t: 'entrench', ids: diggers().map(v => v.id), pattern: entrenchKind, x: a.x, z: a.z, x2: g.x, z2: g.z, queue: e.shiftKey });
      marker(a.x, a.z, 0xc8a060); blip(600); bark('move');
      return;
    }
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
    works: worksAt(groundAt(e.clientX, e.clientY)),
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
const MM_COLORS = { '.': [108, 118, 69], B: [150, 132, 100], H: [47, 74, 34], '#': [154, 149, 138], '+': [90, 79, 54], T: [62, 50, 34], W: [60, 93, 112], '=': [122, 90, 58], F: [106, 127, 122], R: [122, 114, 102], X: [96, 90, 70], Y: [84, 84, 78], D: [150, 128, 100], M: [92, 80, 58], N: [120, 96, 60] };
let mmImage = null, mmFog = null, mmFogImg = null, mmFogOf = null, mmTimer = 0;
function mmTerrain() {
  const w = terrain.w, h = terrain.grid.length, c = document.createElement('canvas'); c.width = w; c.height = h;
  const x2 = c.getContext('2d'), img = x2.createImageData(w, h);
  terrain.grid.forEach((row, y) => row.forEach((ch, x) => {
    const lv = hAt((x + 0.5) * CELL, (y + 0.5) * CELL) / CFG.levelHeight, [r, g, b] = MM_COLORS[ch] ?? MM_COLORS['.'], k = 1 + lv * 0.12, i = (y * w + x) * 4;
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
    if (!mmFog || mmFog.width !== fogGrid.w || mmFog.height !== fogGrid.h) { mmFog = document.createElement('canvas'); mmFog.width = fogGrid.w; mmFog.height = fogGrid.h; mmFogOf = null; }
    // refilled only when updateFog made a new visibility grid (every 0.2 s), into one reused ImageData
    if (mmFogOf !== fogVis) {
      const fc = mmFog.getContext('2d');
      if (mmFogImg?.width !== fogGrid.w || mmFogImg.height !== fogGrid.h) mmFogImg = fc.createImageData(fogGrid.w, fogGrid.h);
      const img = mmFogImg;
      for (let i = 0; i < fogVis.length; i++) { img.data[i * 4] = img.data[i * 4 + 1] = 10; img.data[i * 4 + 3] = fogVis[i] ? 0 : 130; }
      fc.putImageData(img, 0, 0); mmFogOf = fogVis;
    }
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
  const corners = rig.corners(relief?.geometry);
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
// weapon range rings only for a small selection (two units, or up to four of one type), so a big group's dashed
// rings do not bury the fight
function rangeRings() {
  if (selected.size <= 2) return true;
  if (selected.size > 4) return false;
  let t = null;
  for (const id of selected) { const ty = units.get(id)?.type; if (t && ty !== t) return false; t = ty; }
  return true;
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

const effects = createEffects({ scene, camera, cam, hAt, units, colorOf: (slot) => look(slot).color, airAlt: AIR_ALT, mapW: () => terrain?.w ?? 0 });
const objectives = createObjectives({ points: () => points, units, effects, hAt, camera, cam, colorOf: (slot) => look(slot).color, me: () => me, friend: (slot) => !foe(slot) });
objectives.init();
const atmos = createAtmosphere({ scene, renderer, camera, cam, ...lights }); // client/atmosphere.js
endgame.init({ me: () => me, teams: () => teams });
renderer.setAnimationLoop(() => {
  const now = performance.now(), dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
  const sdt = epilogue.frame(dt, cam); // screen time: slower once the match is decided, and the camera glides there
  water?.tick(now);
  // camera
  rig.update(dt);

  // units: smooth toward the latest server state
  const k = 1 - Math.exp(-sdt * 1000 / snapshotGap), ranges = rangeRings();
  for (const v of units.values()) {
    v.x += (v.tx - v.x) * k; v.z += (v.tz - v.z) * k;
    v.rot = lerpAngle(v.rot, v.trot, k); v.aim = lerpAngle(v.aim, v.taim, k * 0.6);
    const gy = hAt(v.x, v.z);
    const air = isAir(v.type), up = air ? AIR_ALT : 0;
    v.root.position.set(v.x, gy + up, v.z); v.root.rotation.y = -v.rot;
    if (air) { v.root.visible = v.bars.visible = !(v.flags & 512); v.base.visible = false; aviation.tick(v, dt); }
    if (v.turret) v.turret.rotation.y = -(v.aim - v.rot);
    v.bars.position.set(v.x, gy + (v.garr ? 7.5 : barY(v.type)), v.z); v.bars.quaternion.copy(camera.quaternion);
    v.sel.visible = selected.has(v.id);
    if (v.range) v.range.visible = ranges && v.sel.visible;
    animate(v, sdt, camera.position); // posture from suppression and retreat, far-away soldiers (client/unit-models.js)
  }
  battleFrame(cam, units, me);
  bodies.update(sdt);
  for (let i = fx.length - 1; i >= 0; i--) {
    const e = fx[i]; e.life -= sdt;
    if (e.life <= 0) { world.remove(e.obj); e.dispose?.(); fx.splice(i, 1); } else e.update(e.max ? e.life / e.max : 1);
  }
  objectives.frame(sdt); effects.update(sdt); atmos.update(sdt);
  aviation.update(sdt);
  if ((fogTimer -= dt) <= 0) { fogTimer = 0.2; updateFog(); }
  alerts.frame();
  pings.frame();
  endgame.frame();
  if (!EDIT && (mmTimer -= dt) <= 0) { mmTimer = alerts.pinging() || pings.active() ? 0.05 : 0.15; drawMinimap(); }
  // aim preview follows the mouse while targeting
  if (targeting && world) {
    if (aimMesh?.userData.kind !== targeting) { if (aimMesh) world.remove(aimMesh); aimMesh = aimShape(targeting, 0xffe08a); aimMesh.userData.kind = targeting; world.add(aimMesh); }
    const g = groundAt(mouse.x, mouse.y);
    if (targeting === 'entrench') { if (aimCenter || g) entrenchPreview(aimMesh, aimCenter ?? g, g ?? aimCenter); }
    else if (aimCenter) {
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
  for (const m of strikeMarks.values()) m.frame(m.t > 0, now);
  renderer.domElement.style.cursor = targeting ? 'cell' : selected.size && pick(mouse.x, mouse.y, v => foe(v.owner)) ? 'crosshair' : 'default';
  renderFrame(cam, groundMesh); // shadows follow the view, board edge, far-edge blur on High
  perf.frame(renderer, now, { units: units.size, fx: effects.count, corpses: bodies.count });
});

if (EDIT) { $('overlay').classList.add('hidden'); import('./editor.js').then(m => m.start({ startGame, cam, groundAt, renderer, scene, hAt })); }

// debug handle for poking at the game from devtools
window.__game = { renderer, scene, camera, cam, units, selected, sendCmd, makeUnit, hAt, groundAt, rig, pointer, pings, alerts, epilogue, effects, atmos, aviation, objectives, endgame, get groundMesh() { return groundMesh; }, get me() { return me; }, get water() { return water; }, get relief() { return relief; }, get snapshot() { return lastSnap; }, get points() { return points; } };
// the alerts list above the minimap (client/alerts.js) sees the match through these
alerts.init({ me: () => me, friend: (slot) => !foe(slot), unitName: (type, owner) => look(owner).names[type] ?? UNITS[type].name, playerName: (slot) => names[slot] ?? 'An ally',
  resetPings: pings.reset, pointPos: (i) => points[i]?.g.position, home: () => home, jump: (x, z) => { rig.cancelFollow(); cam.x = x; cam.z = z; },
  onScreen: (x, z) => { const p = screenOf({ x, z }); return p.front && p.x >= 0 && p.x <= innerWidth && p.y >= 0 && p.y <= innerHeight; } });

pings.init({ scene, hAt, send: sendCmd, playerName: (slot) => names[slot] ?? 'An ally' });
