import * as THREE from 'three';
import { createHud } from './hud.js';
import { UNITS, UNIT_TYPES, CELL, CFG, SUPPORT, SUPPORT_TYPES, TERRAIN, MOVE, BUILDABLE, levelOf, levelChar, canBuild, winVp, supCost, popCap, abCost, priceOf, FORTS } from '/shared/sim.js';
import { alerts } from './alerts.js';
import { unitRole } from './unit-roles.js';
import { createGround } from './ground.js';
import { surface, roofGeometry, roofMaterials } from './surfaces.js';

// Each player has a faction (names, uniforms, tanks, voice) and their own color (by slot).
const FACTIONS = [
  { name: 'USA', uniform: 0x6b7248, vehicle: 0x59623d, names: { rifle: 'Rifle Squad', mg: '.30 cal MG', at: '57mm AT Gun', tank: 'M5 Stuart', rocket: 'T34 Calliope', ranger: 'Ranger Squad', bunker: 'Command Bunker', mortar: '81mm Mortar', sniper: 'Sniper Team', armoredcar: 'M8 Greyhound', medium: 'M4 Sherman', flak: '40mm Bofors', flaktrack: 'M16 Half-track', fighter: 'P-51 Mustang', attacker: 'P-47 Thunderbolt' } },
  { name: 'Germany', uniform: 0x5c6266, vehicle: 0x50565a, names: { rifle: 'Grenadiers', mg: 'MG 42 Team', at: 'PaK 40', tank: 'Panzer II', rocket: 'Panzerwerfer', tiger: 'Tiger I', bunker: 'Command Bunker', mortar: 'GrW 34 Mortar', sniper: 'Scharfschützen', armoredcar: 'Sd.Kfz. 222', medium: 'Panzer IV', flak: 'Flak 38', flaktrack: 'Wirbelwind', fighter: 'Bf 109', attacker: 'Ju 87 Stuka' } },
  { name: 'USSR', uniform: 0x7d7250, vehicle: 0x4e5a38, names: { rifle: 'Riflemen', mg: 'Maxim MG', at: '45mm AT Gun', tank: 'T-70', rocket: 'Katyusha', conscript: 'Conscripts', bunker: 'Command Bunker', mortar: '82mm Mortar', sniper: 'Snipers', armoredcar: 'BA-64', medium: 'T-34', flak: '61-K AA Gun', flaktrack: 'ZSU-37', fighter: 'Yak-9', attacker: 'Il-2 Sturmovik' } },
];
const COLORS = [0x3d7bd9, 0xe0b23a, 0xd94a3d, 0x4cae4c, 0xa35ad8, 0xe07a2a];
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
let room = location.hash.slice(1).toLowerCase();
if (!/^[a-z0-9]{3,12}$/.test(room)) { room = MAIN_ROOM; if (location.hash) history.replaceState(null, '', location.pathname + location.search); }
const roomLink = (base) => base + (room === MAIN_ROOM ? '/' : '/#' + room);
addEventListener('hashchange', () => location.reload()); // edited the #code by hand: go to that room
// per-tab token so a refresh reclaims your slot, while two tabs can still play each other
let token = tryStore(() => sessionStorage.getItem('ww2-token'));
if (!token) { token = Math.random().toString(36).slice(2) + Date.now().toString(36); tryStore(() => sessionStorage.setItem('ww2-token', token)); }
$('name').value = tryStore(() => localStorage.getItem('ww2-name')) || 'Soldier' + Math.floor(Math.random() * 90 + 10);
$('link').value = roomLink(location.origin);
$('roomCode').value = room;
// Room box: type a code to join (or make) that room; New room makes a private one
const goRoom = (code) => { code = code.trim().toLowerCase(); if (!/^[a-z0-9]{3,12}$/.test(code)) { $('roomCode').value = room; return; } location.hash = code === MAIN_ROOM ? '' : code; location.reload(); };
$('joinRoom').onclick = () => goRoom($('roomCode').value);
$('roomCode').addEventListener('keydown', (e) => e.key === 'Enter' && goRoom($('roomCode').value));
$('newRoom').onclick = () => goRoom(Math.random().toString(36).slice(2, 7));

let ws, me = -1, names = [], lobbyState = null, lastSnap = null, refused = false, rtt = null;
setInterval(() => sendCmd({ t: 'ping', c: performance.now(), rtt }), 2000);
const sendCmd = (m) => ws?.readyState === 1 && ws.send(JSON.stringify(m));
function connect() {
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?room=${room}`);
  ws.onopen = () => { sendCmd({ t: 'hello', name: $('name').value, token }); $('status').textContent = ''; };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.t === 'lobby') renderLobby(m);
    else if (m.t === 'start') startGame(m);
    else if (m.t === 's') applySnapshot(m);
    else if (m.t === 'pong' && Number.isFinite(m.c)) rtt = Math.round(performance.now() - m.c);
    else if (m.t === 'full') { refused = true; $('lobbyMsg').textContent = 'A match is going on in this room (or it is full). It opens again when the match ends: reload then, or make a New room.'; }
    else if (m.t === 'left') { refused = true; $('overlay').classList.remove('hidden'); $('hud').classList.add('hidden'); $('lobbyMsg').textContent = 'You left the match; an AI took over your army. Reload to rejoin the lobby when the match is over.'; }
  };
  ws.onclose = () => { if (refused) return; $('status').textContent = 'Connection lost, reconnecting...'; setTimeout(connect, 2000); };
}
if (!EDIT) connect();

$('name').addEventListener('change', () => { tryStore(() => localStorage.setItem('ww2-name', $('name').value)); sendCmd({ t: 'name', name: $('name').value }); });
$('copy').onclick = () => { navigator.clipboard?.writeText($('link').value); $('copy').textContent = 'Copied'; setTimeout(() => ($('copy').textContent = 'Copy'), 1200); };
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
$('armySel').onchange = () => sendCmd({ t: 'army', v: $('armySel').value });
$('defSel').onchange = () => sendCmd({ t: 'defender', v: +$('defSel').value });
$('addAi').onclick = () => sendCmd({ t: 'addAi' });
// in-game menu: the host can restart or end the match, anyone can leave (an AI takes over). Each needs a second click.
const menuOpen = (on) => $('menu').classList.toggle('hidden', !on);
$('menuBtn').onclick = () => { const host = lobbyState && lobbyState.you === lobbyState.host; $('restartBtn').classList.toggle('hidden', !host); $('endBtn').classList.toggle('hidden', !host); menuOpen($('menu').classList.contains('hidden')); };
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
  classic: 'Build a base with engineers and train an army. Destroy every enemy HQ, Barracks and Motor Pool.',
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
  // opened via localhost? friends can't use that address: hand out the public (Tailscale) one
  const local = /^(localhost|127\.|\[::1\])/.test(location.hostname);
  $('link').value = roomLink(local && m.publicUrl ? m.publicUrl : location.origin);
  $('overlay').classList.toggle('hidden', m.state === 'play');
  const n = m.players.length, host = m.you === m.host, lobby = m.state === 'lobby';
  // host sets teams (and the AIs' factions), everyone picks their own faction
  const pick = (kind, i, v, opts, can) => `<select data-kind="${kind}" data-slot="${i}" ${can && lobby ? '' : 'disabled'}>${opts.map((o, k) => `<option value="${k}" ${k === v ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
  $('roster').innerHTML = m.players.map((p, i) => {
    const kick = p.ai && host && lobby ? `<button class="kick" data-slot="${i}" title="Remove AI">✕</button>` : '';
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
  if (lobby) { menuOpen(false); $('hud').classList.add('hidden'); }
}

// ---------- renderer / scene ----------

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
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
function startGame(m) {
  me = m.you; names = m.names; teams = m.teams ?? names.map((_, i) => i); factions = m.factions ?? []; lastStart = m; mmImage = null;
  const map = m.map;
  if (world) scene.remove(world);
  world = new THREE.Group(); scene.add(world);
  units.clear(); selected.clear(); fx.length = 0; lastSnap = null; smokes.clear(); strikeMarks.clear();
  MW = map.w * CELL; MH = map.h * CELL;
  sun.position.set(MW / 2 + 70, 130, MH / 2 - 50); sun.target.position.set(MW / 2, 0, MH / 2);

  // ground: painted canvas (client/ground.js), reused across rebuilds of a same-sized map
  const gp = createGround(map, renderer);
  terrain = { w: map.w, grid: map.rows.map(r => [...r]), ctx: gp.ctx, tex: gp.tex, px: gp.px, ground: gp, group: new THREE.Group() };
  world.add(terrain.group);
  for (const [cell, ch, lv] of m.cells || []) { terrain.grid[Math.floor(cell / map.w)][cell % map.w] = ch; if (lv !== undefined) setLevel(map, cell, lv); }
  buildField(map);
  const ground = new THREE.Mesh(terrainGeometry(), gp.material);
  ground.rotation.x = -Math.PI / 2; ground.position.set(MW / 2, 0, MH / 2); ground.receiveShadow = true;
  world.add(ground); groundMesh = ground;

  gp.paint(terrain.grid);
  buildStructures();

  // capture points
  const assault = lobbyState?.mode === 'assault' || lobbyState?.mode === 'annihilation'; // no VP in either
  points = map.points.filter(p => !assault || (p.mp ?? 1) > 0).map((p) => {
    const g = new THREE.Group(); g.position.set((p.x + 0.5) * CELL, hAt((p.x + 0.5) * CELL, (p.y + 0.5) * CELL), (p.y + 0.5) * CELL);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xdddddd, transparent: true, opacity: 0.7, depthWrite: false });
    const ring = new THREE.Mesh(new THREE.RingGeometry(CFG.pointRadius - 0.35, CFG.pointRadius, 64), ringMat);
    const progMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false });
    const prog = new THREE.Mesh(new THREE.RingGeometry(CFG.pointRadius - 1.6, CFG.pointRadius - 0.6, 64), progMat);
    ring.rotation.x = prog.rotation.x = -Math.PI / 2; ring.position.y = 0.3; prog.position.y = 0.32;
    ring.material.depthTest = prog.material.depthTest = false; ring.renderOrder = prog.renderOrder = 2; // stay visible on slopes
    const flagMat = new THREE.MeshLambertMaterial({ color: 0xdddddd, side: THREE.DoubleSide });
    const flag = mesh(GEO.plane, flagMat, 2.2, 1.4, 1, 1.1, 7.2, 0);
    g.add(ring, prog, mesh(GEO.cyl, mat(0x5a4a36), 0.07, 8, 0.07, 0, 4, 0), flag, label(classicMode() ? `+${(p.vp ?? 1) * CFG.classic.munPerVp} Mun/s` : p.vp > 1 && !assault ? `★ ${p.vp}× VP` : `+${p.mp ?? 1} MP/s`)); // Classic: points pay Munitions
    world.add(g);
    return { g, ringMat, prog, progMat, flagMat };
  });

  // fog of war overlay (client-side approximation; the server decides who you can actually see)
  fogGrid = { w: map.w, h: map.h };
  fogTex = new THREE.DataTexture(new Uint8Array(map.w * map.h * 4), map.w, map.h);
  fogTex.magFilter = fogTex.minFilter = THREE.LinearFilter;
  const fog = new THREE.Mesh(ground.geometry, new THREE.MeshBasicMaterial({ map: fogTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  fog.rotation.x = -Math.PI / 2; fog.position.set(MW / 2, 0.12, MH / 2); fog.renderOrder = 1; fog.visible = !EDIT;
  world.add(fog);

  m.spawns.forEach((sp, i) => world.add(buildHQ(sp, i)));
  aimMesh = null; nodeMarks = null; planGroup = null; coverGroup = null; ghosts.clear();

  // camera: behind my spawn, looking at the map center
  const sx = m.spawn.x, sz = m.spawn.z;
  home = m.spawn;
  cam.yaw = Math.atan2(sx - MW / 2, sz - MH / 2);
  cam.x = sx + (MW / 2 - sx) * 0.25; cam.z = sz + (MH / 2 - sz) * 0.25; cam.dist = 60;

  buildBuyBar();
  buildSupportBar();
  $('hud').classList.toggle('hidden', EDIT);
  $('overlay').classList.add('hidden');
}

function label(text) {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64;
  const c = cv.getContext('2d');
  c.font = 'bold 34px "IBM Plex Mono", monospace'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillStyle = 'rgba(20,20,15,0.75)'; c.fillRect(8, 6, 240, 52);
  c.fillStyle = '#f0d98a'; c.fillText(text, 128, 33);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  sp.scale.set(8, 2, 1); sp.position.y = 10; sp.renderOrder = 5;
  return sp;
}

// ---------- terrain that can change mid-match (digging, destruction) ----------
let terrain = null;
// stable pseudo-random per cell, so rebuilding after a change doesn't reshuffle everything
const rnd = (x, y, k = 0) => { const v = Math.sin(x * 127.1 + y * 311.7 + k * 74.7) * 43758.5453; return v - Math.floor(v); };

// all 3D terrain pieces, rebuilt from the grid whenever a cell changes
function buildStructures() {
  const { grid, group, w } = terrain;
  group.clear();
  const cells = { B: [], H: [], '#': [], '=': [], R: [], X: [], Y: [] };
  grid.forEach((row, y) => row.forEach((ch, x) => cells[ch]?.push([x, y])));
  // kind: a textured surface from client/surfaces.js (world-planar texture, so instancing still works)
  const inst = (list, kind, fn, per = 1) => {
    const im = new THREE.InstancedMesh(GEO.box, surface(kind), list.length * per);
    const m4 = new THREE.Matrix4(), col = new THREE.Color();
    list.forEach((cell, i) => {
      for (let k = 0; k < per; k++) {
        const [sx, sy, sz, y, tint, base, ox = 0, oz = 0] = fn(cell, k), cx = (cell[0] + 0.5) * CELL + ox, cz = (cell[1] + 0.5) * CELL + oz;
        m4.makeScale(sx, sy, sz).setPosition(cx, y + (base ?? hAt(cx, cz) - 0.2), cz);
        im.setMatrixAt(i * per + k, m4); im.setColorAt(i * per + k, col.setScalar(tint));
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
  inst(cells.B, 'plaster', ([x, y]) => { const h = comp.get(y * w + x); return [CELL, h.height + 1, CELL, (h.height + 1) / 2, h.tint, h.base - 1]; });
  for (const h of houses) {
    const xs = h.cells.map(c => c[0]), ys = h.cells.map(c => c[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs) + 1, y0 = Math.min(...ys), y1 = Math.max(...ys) + 1;
    if ((x1 - x0) * (y1 - y0) !== h.cells.length) continue; // flat roof for odd (or half-collapsed) shapes
    const along = x1 - x0 >= y1 - y0, span = (along ? y1 - y0 : x1 - x0) * CELL + 0.6, len = (along ? x1 - x0 : y1 - y0) * CELL + 0.6;
    const roof = mesh(roofGeometry(span, len), roofMaterials(), 1, 1, 1, (x0 + x1) / 2 * CELL, h.base + h.height, (y0 + y1) / 2 * CELL);
    if (along) roof.rotation.y = Math.PI / 2;
    group.add(roof);
  }
  inst(cells.H, 'hedge', ([x, y]) => [CELL * 1.05, 1.7 + rnd(x, y) * 0.5, CELL * 1.05, 0.9, 0.8 + rnd(x, y, 1) * 0.4]);
  // '#' from the map file is a stone wall; '#' added in play (Assault, Fortify) is a sandbag wall
  const wall = ([x, y]) => [CELL * 0.9, 0.9, CELL * 0.9, 0.45, 0.85 + rnd(x, y) * 0.25], stone = ([x, y]) => lastStart.map.rows[y]?.[x] === '#';
  inst(cells['#'].filter(stone), 'stone', wall);
  inst(cells['#'].filter(c => !stone(c)), 'sandbag', wall);
  // rubble: a few broken chunks per cell
  inst(cells.R, 'rubble', ([x, y], k) => { const s = 0.5 + rnd(x, y, k) * 0.7; return [s, s * 0.6, s, s * 0.3, 0.7 + rnd(x, y, k + 5) * 0.4, undefined, (rnd(x, y, k + 9) - 0.5) * 1.4, (rnd(x, y, k + 13) - 0.5) * 1.4]; }, 3);
  // barbed wire: two posts and a criss-cross of strands per cell
  inst(cells.X, 'darkwood', ([x, y], k) => [[0.14, 1.1, 0.14, 0.55, 1, undefined, -0.6, -0.6], [0.14, 1.1, 0.14, 0.55, 1, undefined, 0.6, 0.6],
    [CELL, 0.05, 0.05, 0.85, 0.6], [CELL, 0.05, 0.05, 0.45, 0.6], [0.05, 0.05, CELL, 0.65, 0.6], [0.05, 0.05, CELL, 0.3, 0.6]][k], 6);
  // tank traps: two steel hedgehogs (three crossed beams each) per cell
  inst(cells.Y, 'steel', ([x, y], k) => { const j = k % 3, o = k < 3 ? -0.45 : 0.45, L = 1.5; return [j === 0 ? L : 0.18, j === 1 ? L : 0.18, j === 2 ? L : 0.18, 0.75, 0.9 + rnd(x, y, k) * 0.2, undefined, o, -o]; }, 6);
  // bridges: a plank deck, with rails on the sides that face the water
  inst(cells['='], 'wood', () => [CELL * 1.02, 0.35, CELL * 1.02, 0.35, 1]);
  const rails = [];
  for (const [x, y] of cells['=']) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (grid[y + dy]?.[x + dx] === 'W') rails.push([x, y, dx, dy]);
  inst(rails, 'darkwood', ([, , dx, dy]) => [dx ? 0.2 : CELL, 0.8, dx ? CELL : 0.2, 0.75, 1, undefined, dx * 0.9, dy * 0.9]);
  // trench parapets on every side that isn't more trench
  const dirt = surface('earth');
  for (const [x, y] of grid.flatMap((row, y) => row.map((ch, x) => ch === 'T' && [x, y]).filter(Boolean))) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (grid[y + dy]?.[x + dx] === 'T') continue;
      const cx = (x + 0.5 + dx * 0.55) * CELL, cz = (y + 0.5 + dy * 0.55) * CELL;
      group.add(mesh(GEO.box, dirt, dx ? 0.5 : CELL, 0.35, dx ? CELL : 0.5, cx, 0.17 + hAt(cx, cz), cz));
    }
  }
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
    if (lv !== undefined) { setLevel(lastStart.map, cell, lv); dug = true; }
  }
  if (dug) { buildField(lastStart.map); groundMesh.geometry.dispose(); groundMesh.geometry = terrainGeometry(); }
  terrain.ground.paint(terrain.grid); // repaints only the tiles around changed cells
  buildStructures();
  mmImage = null;
}

// Each player's HQ: tinted reinforce zone, sandbag ring, command tent, tall flag, name.
function buildHQ(sp, slot) {
  const f = look(slot), R = CFG.reinforceRadius, g = new THREE.Group();
  g.position.set(sp.x, hAt(sp.x, sp.z), sp.z);
  const flat = (geo, opacity, y) => { const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: f.color, transparent: true, opacity, depthWrite: false })); m.rotation.x = -Math.PI / 2; m.position.y = y; return m; };
  g.add(flat(new THREE.CircleGeometry(R, 48), 0.18, 0.05), flat(new THREE.RingGeometry(R - 0.5, R, 64), 0.85, 0.06));
  // sandbags with gaps for the exits
  for (let i = 0; i < 36; i++) {
    if (i % 9 < 2) continue;
    const a = i / 36 * Math.PI * 2, bag = mesh(GEO.box, surface('sandbag'), 2.4, 0.9, 1.1, Math.cos(a) * (R + 0.8), 0.45, Math.sin(a) * (R + 0.8));
    bag.rotation.y = -a + Math.PI / 2; g.add(bag);
  }
  // command tent + crates
  const tent = f.vehicle, shape = new THREE.Shape([new THREE.Vector2(-3, 0), new THREE.Vector2(3, 0), new THREE.Vector2(0, 3.2)]);
  const tg = new THREE.ExtrudeGeometry(shape, { depth: 7, bevelEnabled: false }); tg.translate(0, 0, -3.5);
  if (!classicMode()) g.add(mesh(tg, mat(tent), 1, 1, 1, -4, 0, -3));
  if (!classicMode()) g.add(mesh(GEO.box, mat(0x6e5836), 1.4, 1.2, 1.4, 3, 0.6, -5), mesh(GEO.box, mat(0x6e5836), 1.4, 1.2, 1.4, 4.6, 0.6, -4.4), mesh(GEO.box, mat(0x5f4c2f), 1.2, 1, 1.2, 3.8, 1.7, -4.7));
  // tall flag you can spot from across the map
  const flag = mesh(GEO.plane, new THREE.MeshLambertMaterial({ color: f.color, side: THREE.DoubleSide }), 4.5, 2.8, 1, 2.3, 13, 0);
  g.add(mesh(GEO.cyl, mat(0x4a3f30), 0.12, 15, 0.12, 0, 7.5, 0), flag);
  const tag = label(`${names[slot] ?? f.name} HQ`); tag.position.y = 17; g.add(tag);
  return g;
}

// ---------- units ----------

// Formation slots in local space (+x = forward). Gun crews stand behind the gun.
const SLOTS = {
  rifle: [[0.9, 0], [0, 1], [0, -1], [-0.9, 0.55], [-0.9, -0.55]],
  mg: [[0.2, 0], [-0.5, 0.7], [-0.5, -0.7]],
  mortar: [[0.2, 0.6], [0.2, -0.6], [-0.6, 0]],
  flak: [[-0.6, 0.8], [-0.6, -0.8], [-1.2, 0]],
  sniper: [[0.4, 0], [-0.5, 0.6]],
  engineer: [[0.6, 0], [-0.4, 0.7], [-0.4, -0.7]],
  at: [[-0.5, 0.7], [-0.5, -0.7], [-1.2, 0.4], [-1.2, -0.4]],
  ranger: [[0.9, 0], [0.3, 1], [0.3, -1], [-0.6, 0.6], [-0.6, -0.6], [-1.2, 0]],
  conscript: [[1, 0], [0.4, 0.9], [0.4, -0.9], [-0.3, 1.5], [-0.3, -1.5], [-0.9, 0.5], [-0.9, -0.5]],
};

// headgear per faction: round M1 (USA), flared Stahlhelm (Germany), tall SSh-40 (USSR); conscripts wear a pilotka cap
function headgear(man, owner, type, m) {
  if (type === 'conscript') { man.add(mesh(GEO.box, m, 0.38, 0.13, 0.22, 0, 1.2, 0)); return; }
  const fac = facOf(owner);
  if (fac === 1) man.add(mesh(GEO.helmet, m, 1.05, 1, 1.05, 0, 1.28, 0), mesh(GEO.cyl, m, 0.33, 0.07, 0.33, 0, 1.25, 0));
  else if (fac === 2) man.add(mesh(GEO.helmet, m, 1, 1.3, 1, 0, 1.26, 0));
  else man.add(mesh(GEO.helmet, m, 1.12, 0.95, 1.12, 0, 1.28, 0));
}

// what each class carries, so squads read apart even without their badges (+x = forward)
function gear(man, type, i, f, dark) {
  const wood = mat(0x5e4226);
  if (type === 'rifle' || type === 'conscript') man.add(mesh(GEO.box, wood, 1.0, 0.07, 0.07, 0.28, 0.85, 0.2).rotateZ(0.6));
  else if (type === 'ranger' && i % 3 !== 1) man.add(mesh(GEO.box, dark, 0.6, 0.1, 0.08, 0.32, 0.82, 0.2).rotateZ(0.3)); // SMG
  else if (type === 'sniper') {
    man.add(mesh(GEO.box, mat(0x3c4a26), 0.75, 0.55, 0.85, -0.1, 0.95, 0)); // ghillie cape
    if (i === 0) man.add(mesh(GEO.box, wood, 1.5, 0.06, 0.06, 0.4, 0.9, 0.2).rotateZ(0.25), mesh(GEO.box, dark, 0.35, 0.09, 0.09, 0.42, 1.0, 0.2).rotateZ(0.25)); // long rifle and scope
  } else if (type === 'engineer') {
    // pack and a shovel on the back
    man.add(mesh(GEO.box, mat(f.vehicle), 0.3, 0.45, 0.5, -0.32, 0.95, 0), mesh(GEO.cyl, wood, 0.03, 1.1, 0.03, -0.4, 1.05, 0.2), mesh(GEO.box, dark, 0.06, 0.3, 0.22, -0.4, 1.65, 0.2));
  } else if ((type === 'mg' || type === 'mortar') && i > 0) man.add(mesh(GEO.box, mat(0x4a5030), 0.3, 0.25, 0.22, -0.05, 0.55, 0.32)); // ammo box
}

// Class badge: a pictogram on a dark disc ringed in the owner's color, left of the health bar.
const badgeTex = new Map();
function badge(type, color) {
  const key = type + ':' + color;
  if (badgeTex.has(key)) return badgeTex.get(key);
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const c = cv.getContext('2d');
  c.beginPath(); c.arc(32, 32, 28, 0, 7); c.fillStyle = '#16170f'; c.fill(); c.lineWidth = 6; c.strokeStyle = css(color); c.stroke();
  c.strokeStyle = c.fillStyle = '#f2ecd8'; c.lineWidth = 4; c.lineCap = 'round'; c.lineJoin = 'round';
  const L = (...p) => { c.beginPath(); c.moveTo(p[0], p[1]); for (let k = 2; k < p.length; k += 2) c.lineTo(p[k], p[k + 1]); c.stroke(); };
  const dot = (x, y, r) => { c.beginPath(); c.arc(x, y, r, 0, 7); c.fill(); };
  // tanks: hull, turret and gun; pips underneath for light / medium / heavy
  const tank = (gun, pips) => { c.fillRect(16, 31, 32, 9); c.fillRect(25, 25, 12, 6); L(36, 28, 36 + gun, 28); c.fillRect(14, 40, 36, 4); for (let k = 0; k < pips; k++) dot(32 + (k - (pips - 1) / 2) * 8, 51, 2.8); };
  const draw = {
    rifle: () => { L(17, 46, 47, 18); L(27, 37, 31, 42); },
    ranger: () => { c.beginPath(); for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5, r = k % 2 ? 7 : 17; c.lineTo(32 + Math.cos(a) * r, 33 + Math.sin(a) * r); } c.fill(); },
    conscript: () => { dot(22, 39, 6); dot(42, 39, 6); dot(32, 22, 6); },
    mg: () => { L(13, 26, 51, 26); L(30, 26, 21, 46); L(30, 26, 39, 46); },
    mortar: () => { L(17, 48, 47, 48); c.lineWidth = 7; L(26, 45, 40, 19); },
    sniper: () => { c.beginPath(); c.arc(32, 32, 12, 0, 7); c.stroke(); L(32, 13, 32, 51); L(13, 32, 51, 32); },
    engineer: () => { L(22, 48, 37, 25); c.lineWidth = 8; L(28, 19, 45, 30); },
    at: () => { c.lineWidth = 5; L(16, 35, 50, 25); c.lineWidth = 4; c.beginPath(); c.arc(25, 40, 7, 0, 7); c.stroke(); },
    armoredcar: () => { c.fillRect(14, 27, 36, 11); c.fillRect(26, 21, 12, 6); dot(20, 42, 5); dot(32, 42, 5); dot(44, 42, 5); },
    tank: () => tank(10, 1),
    medium: () => tank(15, 2),
    tiger: () => tank(17, 3),
    flak: () => { L(18, 47, 46, 47); L(26, 44, 42, 16); L(32, 44, 48, 16); },
    flaktrack: () => { c.fillRect(12, 32, 40, 9); dot(20, 45, 5); dot(44, 45, 5); L(26, 30, 40, 12); L(31, 30, 45, 12); },
    fighter: () => { c.fillRect(29, 12, 6, 40); c.fillRect(12, 26, 40, 7); c.fillRect(24, 46, 16, 4); },
    attacker: () => { c.fillRect(29, 12, 6, 40); c.fillRect(10, 26, 44, 8); dot(18, 40, 3.5); dot(46, 40, 3.5); c.fillRect(24, 46, 16, 4); },
    rocket: () => { for (let k = 0; k < 3; k++) { L(16 + k * 9, 47, 26 + k * 9, 19); dot(26 + k * 9, 19, 3.5); } },
  }[type];
  const tex = draw ? (draw(), new THREE.CanvasTexture(cv)) : null;
  if (tex) tex.colorSpace = THREE.SRGBColorSpace;
  badgeTex.set(key, tex);
  return tex;
}

// tank silhouettes: [hull l,h,w], [turret l,h,w, x, z], barrel [length, thickness], sloped glacis
const TANKS = {
  tank: [
    { hull: [3.8, 1.3, 2.3], turret: [1.6, 0.9, 1.5, -0.1, 0], gun: [2.0, 0.09] },               // M5 Stuart: tall and boxy
    { hull: [4.0, 1.0, 2.2], turret: [1.3, 0.75, 1.2, 0.2, 0.3], gun: [1.6, 0.07] },             // Panzer II: small offset turret
    { hull: [4.2, 1.0, 2.3], turret: [1.6, 0.8, 1.5, -0.3, 0.2], gun: [2.2, 0.09], slope: 1 },   // T-70: sloped front
  ],
  tiger: [null, { hull: [5.4, 1.4, 3.2], turret: [2.6, 1.1, 2.2, -0.2, 0], gun: [3.8, 0.14], brake: 1 }, null],
  medium: [
    { hull: [4.8, 1.5, 2.7], turret: [2.0, 1.0, 1.9, -0.1, 0], gun: [2.6, 0.11], slope: 1 },           // M4 Sherman: tall, rounded
    { hull: [5.0, 1.2, 2.7], turret: [2.3, 0.95, 1.9, -0.2, 0], gun: [3.0, 0.11] },                    // Panzer IV: boxy, long gun
    { hull: [5.0, 1.1, 2.9], turret: [2.0, 0.9, 1.9, 0.3, 0], gun: [2.9, 0.11], slope: 1 },             // T-34: sloped, turret forward
  ],
  // mobile flak: M16 half-track (quad MGs), Wirbelwind (flak turret on a Panzer IV), ZSU-37 (on a light tank)
  flaktrack: [
    { hull: [4.2, 1.1, 2.2], turret: [1.2, 0.6, 1.4, -0.8, 0], gun: [1.2, 0.07], wheels: 2, twin: 1 },
    { hull: [5.0, 1.2, 2.7], turret: [1.8, 1.0, 1.8, -0.2, 0], gun: [1.6, 0.07], twin: 1 },
    { hull: [4.4, 1.1, 2.4], turret: [1.8, 0.8, 1.7, -0.6, 0], gun: [2.2, 0.08], twin: 1 },
  ],
  armoredcar: [
    { hull: [3.8, 1.0, 2.1], turret: [1.3, 0.6, 1.3, 0, 0], gun: [1.0, 0.06], wheels: 3 },             // M8 Greyhound: six wheels
    { hull: [3.6, 0.9, 1.9], turret: [1.1, 0.5, 1.2, 0, 0], gun: [0.8, 0.05], wheels: 2 },             // Sd.Kfz. 222
    { hull: [3.2, 1.1, 1.7], turret: [0.9, 0.5, 0.9, 0, 0], gun: [0.7, 0.05], wheels: 2, slope: 1 },   // BA-64: small, sloped
  ],
};
function buildTank(v, root, spec, f) {
  const hull = mat(f.vehicle), dark = mat(0x2a2a24), [hl, hh, hw] = spec.hull, y = hh / 2 + 0.5;
  root.add(mesh(GEO.box, hull, hl, hh, hw, 0, y, 0));
  if (spec.wheels) for (let i = 0; i < spec.wheels; i++) for (const side of [1, -1]) root.add(mesh(GEO.cyl, dark, 0.45, 0.35, 0.45, (i / (spec.wheels - 1) - 0.5) * hl * 0.7, 0.45, side * hw / 2).rotateX(Math.PI / 2));
  else root.add(mesh(GEO.box, dark, hl + 0.2, 0.8, 0.6, 0, 0.45, hw / 2), mesh(GEO.box, dark, hl + 0.2, 0.8, 0.6, 0, 0.45, -hw / 2));
  if (spec.slope) root.add(mesh(GEO.box, hull, 1.2, 0.2, hw, hl / 2 - 0.2, y + 0.25, 0).rotateZ(-0.5));
  const [tl, th, tw, tx, tz] = spec.turret, [gl, gt] = spec.gun;
  v.turret = new THREE.Group(); v.turret.position.set(tx, y + hh / 2 + th / 2, tz);
  v.turret.add(mesh(GEO.box, hull, tl, th, tw), mesh(GEO.cyl, dark, gt, gl, gt, tl / 2 + gl / 2, 0.05, 0).rotateZ(Math.PI / 2), mesh(GEO.box, mat(f.color), 0.4, th + 0.02, tw + 0.02, -tl / 2 + 0.3, 0, 0));
  if (spec.twin) v.turret.add(mesh(GEO.cyl, dark, spec.gun[1], spec.gun[0], spec.gun[1], tl / 2 + spec.gun[0] / 2, 0.25, 0.3).rotateZ(Math.PI / 2 - 0.6), mesh(GEO.cyl, dark, spec.gun[1], spec.gun[0], spec.gun[1], tl / 2 + spec.gun[0] / 2, 0.25, -0.3).rotateZ(Math.PI / 2 - 0.6));
  if (spec.brake) v.turret.add(mesh(GEO.box, dark, 0.35, 0.3, 0.35, tl / 2 + gl, 0.05, 0));
  root.add(v.turret);
}

function makeUnit(id, type, owner) {
  const def = UNITS[type], f = look(owner), root = new THREE.Group();
  const v = { id, type, owner, root, models: [], alive: def.models, x: 0, z: 0, rot: 0, aim: 0, turret: null };
  const base = new THREE.Mesh(GEO.ring, new THREE.MeshBasicMaterial({ color: f.color, transparent: true, opacity: 0.9, depthWrite: false }));
  base.rotation.x = -Math.PI / 2; base.position.y = 0.15; base.scale.setScalar(def.radius + 0.4); base.renderOrder = 2;
  v.sel = new THREE.Mesh(GEO.ring, new THREE.MeshBasicMaterial({ color: 0xfff6c8, depthWrite: false, transparent: true }));
  v.sel.rotation.x = -Math.PI / 2; v.sel.position.y = 0.16; v.sel.scale.setScalar(def.radius + 1); v.sel.visible = false; v.sel.renderOrder = 2;
  root.add(base, v.sel); v.base = base;
  if (def.w) {
    // weapon range (and the minimum range of rocket salvos), shown while selected
    const rm = new THREE.MeshBasicMaterial({ color: 0xfff6c8, transparent: true, opacity: 0.35, depthTest: false, depthWrite: false });
    v.range = new THREE.Group(); v.range.visible = false;
    for (const r of [def.w.range, def.w.minRange].filter(Boolean)) { const m = new THREE.Mesh(new THREE.RingGeometry(r - 0.25, r, 96), rm); m.rotation.x = -Math.PI / 2; m.position.y = 0.2; m.renderOrder = 2; v.range.add(m); }
    root.add(v.range);
  }
  if (isAir(type)) {
    // fighter: slim, long nose; ground-attack plane: bigger, rockets and a bomb under the wings
    const big = type === 'attacker', c = mat(f.vehicle), dark = mat(0x2a2a24);
    v.body = new THREE.Group();
    v.body.add(mesh(GEO.box, c, big ? 7 : 6, big ? 1.1 : 0.9, big ? 1.1 : 0.9), mesh(GEO.box, c, big ? 1.8 : 1.4, 0.2, big ? 11 : 9.5, big ? 0.4 : 0.6, -0.1, 0),
      mesh(GEO.box, c, 0.9, 0.15, 3.4, big ? -3 : -2.6, 0.1, 0), mesh(GEO.box, c, 0.9, 1.3, 0.15, big ? -3 : -2.6, 0.7, 0),
      mesh(GEO.box, mat(f.color), 0.5, 0.22, big ? 11.2 : 9.7, big ? 0.4 : 0.6, -0.05, 0), mesh(GEO.cyl, dark, 0.15, 0.4, 0.15, big ? 3.7 : 3.2, 0, 0).rotateZ(Math.PI / 2));
    if (big) for (const z of [-3.5, -2.5, 2.5, 3.5]) v.body.add(mesh(GEO.cyl, dark, 0.12, 1.2, 0.12, 0.6, -0.4, z).rotateZ(Math.PI / 2));
    if (big) v.body.add(mesh(GEO.box, dark, 1.4, 0.4, 0.4, 0.3, -0.7, 0));
    root.add(v.body); v.models.push(root);
  } else if (type === 'airfield') {
    // a dirt strip, a hangar and a windsock
    v.body = new THREE.Group();
    v.body.add(mesh(GEO.box, mat(0x6a5e44), 6, 0.1, 2.2, 0, 0.05, 0), mesh(GEO.box, mat(f.vehicle), 2.6, 2.2, 3, -1.5, 1.1, 1.6), mesh(GEO.cyl, mat(0x4a3f30), 0.06, 3, 0.06, 2.6, 1.5, -2.4),
      mesh(GEO.box, new THREE.MeshLambertMaterial({ color: 0xe07a30 }), 0.9, 0.3, 0.3, 3, 2.8, -2.4));
    root.add(v.body); v.models.push(root);
  } else if (type === 'flakpos') {
    // a sandbagged ring with a twin gun pointing up
    const dark = mat(0x2a2a24);
    v.body = new THREE.Group();
    for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; if (i === 7) continue; v.body.add(mesh(GEO.box, mat(0x9c8a60), 1.2, 0.7, 0.6, Math.cos(a) * 1.7, 0.35, Math.sin(a) * 1.7).rotateY(-a + Math.PI / 2)); }
    v.body.add(mesh(GEO.cyl, dark, 0.5, 0.6, 0.5, 0, 0.3, 0), mesh(GEO.cyl, dark, 0.08, 2, 0.08, 0.4, 1.3, 0.2).rotateZ(-0.6), mesh(GEO.cyl, dark, 0.08, 2, 0.08, 0.4, 1.3, -0.2).rotateZ(-0.6));
    root.add(v.body); v.models.push(root);
  } else if (type === 'hq') {
    // command post: sandbagged timber block with a radio mast
    const wood = mat(0x7a6446), roof = mat(0x5a4a34);
    v.body = new THREE.Group();
    v.body.add(mesh(GEO.box, wood, 5.4, 3, 5.4, 0, 1.5, 0), mesh(GEO.box, roof, 6, 0.4, 6, 0, 3.2, 0), mesh(GEO.box, mat(f.vehicle), 5.6, 0.5, 1.2, 0, 1.2, 2.5),
      mesh(GEO.cyl, mat(0x2a2a24), 0.06, 5, 0.06, 2, 5.6, 2), mesh(GEO.plane, new THREE.MeshLambertMaterial({ color: f.color, side: THREE.DoubleSide }), 1.8, 1.1, 1, 0.9, 7.4, 2));
    root.add(v.body); v.models.push(root);
  } else if (type === 'barracks') {
    // long timber hut with a pitched roof
    const wood = mat(0x8a7050), roofM = mat(f.vehicle);
    v.body = new THREE.Group();
    const shape = new THREE.Shape([new THREE.Vector2(-3, 0), new THREE.Vector2(3, 0), new THREE.Vector2(0, 1.8)]), rg = new THREE.ExtrudeGeometry(shape, { depth: 5.6, bevelEnabled: false }); rg.translate(0, 0, -2.8);
    v.body.add(mesh(GEO.box, wood, 5.6, 2.6, 5.2, 0, 1.3, 0), mesh(rg, roofM, 1, 1, 1, 0, 2.6, 0).rotateY(Math.PI / 2), mesh(GEO.box, mat(0x3a2e20), 1.2, 1.8, 0.2, 0, 0.9, 2.62));
    root.add(v.body); v.models.push(root);
  } else if (type === 'motorpool') {
    // open vehicle shed: posts, a flat roof, oil drums
    const post = mat(0x5a4a34);
    v.body = new THREE.Group();
    for (const [x, z] of [[-2.7, -2.7], [2.7, -2.7], [-2.7, 2.7], [2.7, 2.7]]) v.body.add(mesh(GEO.box, post, 0.35, 3.2, 0.35, x, 1.6, z));
    v.body.add(mesh(GEO.box, mat(f.vehicle), 6, 0.3, 6, 0, 3.3, 0), mesh(GEO.box, mat(0x4a4a44), 5.6, 0.1, 5.6, 0, 0.05, 0), mesh(GEO.box, post, 5.6, 1.4, 0.3, 0, 0.7, -2.7));
    for (let i = 0; i < 3; i++) v.body.add(mesh(GEO.cyl, mat(0x3a4a30), 0.4, 1.1, 0.4, 2.2, 0.55, -1.6 + i * 0.85));
    root.add(v.body); v.models.push(root);
  } else if (type === 'depot') {
    // supply dump: stacked crates and fuel drums
    const crate = mat(0x6e5836), drum = mat(f.vehicle);
    v.body = new THREE.Group();
    v.body.add(mesh(GEO.box, mat(0x5a4a34), 3.8, 0.2, 3.8, 0, 0.1, 0), mesh(GEO.box, crate, 1.4, 1.2, 1.4, -0.9, 0.7, -0.9), mesh(GEO.box, crate, 1.4, 1.2, 1.4, 0.7, 0.7, -0.9),
      mesh(GEO.box, crate, 1.2, 1, 1.2, -0.1, 1.8, -0.9));
    for (let i = 0; i < 4; i++) v.body.add(mesh(GEO.cyl, drum, 0.4, 1.1, 0.4, -1.1 + i * 0.75, 0.65, 1));
    root.add(v.body); v.models.push(root);
  } else if (type === 'bunker') {
    const conc = mat(0x8a8a82), dark = mat(0x1e1e1a);
    root.add(mesh(GEO.box, conc, 5.2, 2.4, 5.2, 0, 1.2, 0), mesh(GEO.box, mat(0x74746c), 6, 0.5, 6, 0, 2.6, 0), mesh(GEO.box, dark, 0.3, 0.4, 3, 2.62, 1.6, 0));
    for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; if (i % 4 === 0) continue; root.add(mesh(GEO.box, mat(0x9c8a60), 1.6, 0.7, 0.8, Math.cos(a) * 4.6, 0.35, Math.sin(a) * 4.6).rotateY(-a + Math.PI / 2)); }
    root.add(mesh(GEO.cyl, mat(0x4a3f30), 0.08, 4, 0.08, -1.8, 4.6, -1.8), mesh(GEO.plane, new THREE.MeshLambertMaterial({ color: f.color, side: THREE.DoubleSide }), 1.8, 1.1, 1, -0.9, 6, -1.8));
    v.models.push(root);
  } else if (TANKS[type]) {
    buildTank(v, root, TANKS[type][facOf(owner)] ?? TANKS[type].find(Boolean), f);
    v.models.push(root);
  } else if (type === 'rocket') {
    const body = mat(f.vehicle), dark = mat(0x2a2a24);
    v.turret = new THREE.Group();
    const tube = (x, y, z, len = 2.6) => mesh(GEO.cyl, dark, 0.12, len, 0.12, x, y, z).rotateZ(Math.PI / 2);
    if (facOf(owner) === 0) {
      // T34 Calliope: a Sherman with a box of tubes above the turret
      buildTank(v, root, { hull: [4.4, 1.3, 2.5], turret: [1.8, 0.9, 1.6, -0.2, 0], gun: [2.0, 0.1] }, f);
      const rack = new THREE.Group(); rack.position.set(0, 1.1, 0); rack.rotation.z = 0.25;
      for (let i = 0; i < 12; i++) rack.add(tube(0.3, (i % 3) * 0.26, (Math.floor(i / 3) - 1.5) * 0.3, 2.8));
      v.turret.add(rack);
    } else if (facOf(owner) === 1) {
      // Panzerwerfer: half-track, wheels up front, tracks behind, ten tubes in two rows
      root.add(mesh(GEO.box, body, 4.4, 1.0, 2.1, 0, 1.2, 0), mesh(GEO.box, body, 1.4, 0.9, 2.0, 1.6, 1.9, 0));
      for (const wz of [-1.0, 1.0]) root.add(mesh(GEO.cyl, dark, 0.45, 0.3, 0.45, 1.6, 0.45, wz).rotateX(Math.PI / 2), mesh(GEO.box, dark, 2.8, 0.8, 0.5, -0.8, 0.45, wz));
      v.turret.position.set(-0.8, 1.9, 0);
      const rack = new THREE.Group(); rack.rotation.z = 0.45;
      for (let i = 0; i < 10; i++) rack.add(tube(0, (i % 2) * 0.3, (Math.floor(i / 2) - 2) * 0.28, 1.8));
      v.turret.add(rack);
    } else {
      // Katyusha: truck with long launch rails
      root.add(mesh(GEO.box, body, 4.4, 0.7, 2.1, 0, 1.0, 0), mesh(GEO.box, body, 1.3, 1.2, 2.0, 1.6, 1.8, 0), mesh(GEO.box, mat(f.color), 0.5, 0.3, 2.02, 1.6, 2.45, 0));
      for (const wx of [-1.4, 0, 1.4]) for (const wz of [-1.05, 1.05]) root.add(mesh(GEO.cyl, dark, 0.45, 0.3, 0.45, wx, 0.45, wz).rotateX(Math.PI / 2));
      v.turret.position.set(-0.8, 1.7, 0);
      const rack = new THREE.Group(); rack.rotation.z = 0.5;
      for (let i = 0; i < 8; i++) rack.add(mesh(GEO.box, dark, 3.4, 0.08, 0.14, 0, (i % 2) * 0.24, (Math.floor(i / 2) - 1.5) * 0.3));
      v.turret.add(rack);
    }
    root.add(v.turret);
    v.models.push(root);
  } else {
    const helmet = mat(new THREE.Color(f.uniform).lerp(new THREE.Color(f.color), 0.55).getHex()), dark = mat(0x2c2b26);
    SLOTS[type].forEach(([x, z], i) => {
      const man = new THREE.Group(); man.position.set(x * 1.3, 0, z * 1.3); man.scale.setScalar(type === 'conscript' ? 1.25 : 1.35);
      man.add(mesh(GEO.body, mat(f.uniform), 1, 1, 1, 0, 0.72, 0), mesh(GEO.ball, mat(0xc8a07a), 0.19, 0.19, 0.19, 0, 1.24, 0));
      headgear(man, owner, type, helmet);
      gear(man, type, i, f, dark);
      if (type === 'ranger' && i % 3 === 1) man.add(mesh(GEO.cyl, dark, 0.07, 1.3, 0.07, 0, 1.1, 0.25).rotateZ(1.3)); // bazooka on the shoulder
      root.add(man); v.models.push(man);
    });
    if (type === 'flak') root.add(mesh(GEO.box, mat(0x2a2a24), 1.0, 0.5, 1.0, 0.4, 0.3, 0), mesh(GEO.cyl, mat(0x2a2a24), 0.07, 2.2, 0.07, 1.0, 1.2, 0.15).rotateZ(-0.7), mesh(GEO.cyl, mat(0x2a2a24), 0.07, 2.2, 0.07, 1.0, 1.2, -0.15).rotateZ(-0.7));
    if (type === 'mortar') root.add(mesh(GEO.cyl, dark, 0.09, 1.1, 0.09, 0.7, 0.45, 0).rotateZ(-0.7), mesh(GEO.box, dark, 0.5, 0.06, 0.5, 0.45, 0.05, 0));
    if (type === 'mg') root.add(mesh(GEO.cyl, dark, 0.07, 1.4, 0.07, 1.0, 0.45, 0).rotateZ(Math.PI / 2), mesh(GEO.box, dark, 0.4, 0.4, 0.5, 0.5, 0.3, 0));
    if (type === 'at') {
      v.turret = new THREE.Group(); v.turret.position.set(0.6, 0, 0);
      v.turret.add(mesh(GEO.box, mat(f.vehicle), 0.12, 1.1, 1.6, 0.3, 0.9, 0), mesh(GEO.cyl, dark, 0.08, 2.6, 0.08, 1.5, 0.95, 0).rotateZ(Math.PI / 2),
        mesh(GEO.cyl, dark, 0.45, 0.2, 0.45, 0, 0.45, 0.8).rotateX(Math.PI / 2), mesh(GEO.cyl, dark, 0.45, 0.2, 0.45, 0, 0.45, -0.8).rotateX(Math.PI / 2));
      root.add(v.turret);
    }
  }
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
  const icon = badge(type, f.color);
  if (icon) { const b = new THREE.Mesh(GEO.plane, new THREE.MeshBasicMaterial({ map: icon, transparent: true, depthTest: false })); b.scale.set(1, 1, 1); b.position.set(-1.8, 0.05, 0.02); b.renderOrder = 5; v.bars.add(b); }
  world.add(root, v.bars);
  return v;
}

function corpse(v, man) {
  const p = man.getWorldPosition(new THREE.Vector3());
  const body = mesh(GEO.body, mat(0x3a372c), 1, 1, 1, p.x, hAt(p.x, p.z) + 0.3, p.z);
  body.rotation.set(0, Math.random() * 6, Math.PI / 2);
  world.add(body);
  fx.push({ obj: body, life: 25, update: () => {} });
  man.visible = false;
}

function removeUnit(v) {
  world.remove(v.bars);
  if (v.killed && isVeh(v.type)) {
    // leave a burnt-out wreck for a while
    v.root.traverse(o => { if (o.isMesh) { o.material = o.material.isMeshBasicMaterial ? o.material : mat(0x1d1b18); } });
    v.root.children.slice(0, 2).forEach(o => (o.visible = false));
    fx.push({ obj: v.root, life: 40, update: () => {} });
    boom(v.x, v.z, 3);
  } else {
    if (v.killed) v.models.forEach(m => m.visible && corpse(v, m));
    world.remove(v.root);
  }
  units.delete(v.id); selected.delete(v.id);
}

// ---------- effects + sound ----------

function tracer(a, b, color, life) {
  const g = new THREE.BufferGeometry().setFromPoints([a, b]);
  const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true }));
  world.add(line);
  fx.push({ obj: line, life, max: life, update: (f) => (line.material.opacity = f), dispose: () => { g.dispose(); line.material.dispose(); } });
}

function boom(x, z, size) {
  for (const [color, grow, life] of [[0xffb040, 1, 0.35], [0x6d655a, 1.8, 1.4]]) {
    const m = new THREE.Mesh(GEO.ball, new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false }));
    m.position.set(x, hAt(x, z) + 0.5, z);
    world.add(m);
    fx.push({ obj: m, life, max: life, update: (f) => { m.scale.setScalar(size * grow * (1.2 - f)); m.material.opacity = f * 0.8; }, dispose: () => m.material.dispose() });
  }
}

let audio = null, noise = null, voices = 0;
addEventListener('pointerdown', () => {
  if (audio) return;
  audio = new AudioContext();
  noise = audio.createBuffer(1, audio.sampleRate, audio.sampleRate);
  const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}, { once: true });
function sound(kind, x, z) {
  if (!audio || voices > 20) return;
  const vol = Math.max(0, 1 - Math.hypot(x - cam.x, z - cam.z) / 160) * (kind === 'tank' || kind === 'at' || kind === 'rocket' ? 0.9 : 0.25);
  if (vol <= 0.01) return;
  const src = audio.createBufferSource(), filt = audio.createBiquadFilter(), gain = audio.createGain(), t = audio.currentTime;
  const heavy = kind === 'tank' || kind === 'at', len = heavy ? 0.7 : kind === 'mg' ? 0.06 : 0.12;
  src.buffer = noise; src.playbackRate.value = heavy ? 0.5 : 1;
  filt.type = heavy ? 'lowpass' : 'bandpass'; filt.frequency.value = heavy ? 380 : kind === 'mg' ? 1400 : 1900;
  gain.gain.setValueAtTime(vol, t); gain.gain.exponentialRampToValueAtTime(0.001, t + len);
  src.connect(filt).connect(gain).connect(audio.destination);
  src.start(t, Math.random() * 0.5, len); voices++; src.onended = () => voices--;
}
function blip(freq) {
  if (!audio) return;
  const o = audio.createOscillator(), gn = audio.createGain(), t = audio.currentTime;
  o.frequency.value = freq; o.type = 'square';
  gn.gain.setValueAtTime(0.04, t); gn.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
  o.connect(gn).connect(audio.destination); o.start(t); o.stop(t + 0.08);
}

function marker(x, z, color) {
  const m = new THREE.Mesh(GEO.ring, new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.set(x, hAt(x, z) + 0.3, z); m.material.depthTest = false;
  world.add(m);
  fx.push({ obj: m, life: 0.6, max: 0.6, update: (f) => { m.scale.setScalar(0.5 + (1 - f) * 2); m.material.opacity = f; }, dispose: () => m.material.dispose() });
}

// ---------- snapshots ----------

function applySnapshot(s) {
  if (window.__freeze) return; // debug: hold the scene still (e.g. to inspect models)
  const seen = new Set();
  for (const [id, type, owner, x, z, rot, aim, hp, supp, tgt, cover, cd, flags, stars, built] of s.units) {
    seen.add(id);
    let v = units.get(id);
    if (!v) { v = makeUnit(id, type, owner); Object.assign(v, { x, z, rot, aim }); units.set(id, v); }
    Object.assign(v, { tx: x, tz: z, trot: rot, taim: aim, hp, supp, tgt, cover, cd, flags, vet: stars || 0, garr: !!(flags & 32), built: built ?? 1 });
    if (v.body) v.body.scale.y = 0.15 + 0.85 * v.built; // a construction site rises as it's built
    v.stars.forEach((st, i) => (st.visible = i < v.vet));
    const cl = !v.garr && COVER_LOOK[cover];
    v.shield.visible = !!cl;
    if (cl) { v.shield.material.color.set(cl[0]); v.shield.material.opacity = cl[1]; }
    // inside a building: the squad disappears into it; its bars float above the roof
    v.base.material.color.set(flags & 1 ? 0xffffff : look(owner).color);
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
  for (const sh of s.shots) {
    if (sh.k === 'throw') { const from = units.get(sh.f); if (from) lob(from, sh.x, sh.z); continue; }
    if (sh.k === 'boom') { boom(sh.x, sh.z, 2.4); sound('at', sh.x, sh.z); continue; }
    if (sh.k === 'shell') { boom(sh.x, sh.z, 2.8); sound('tank', sh.x, sh.z); continue; }
    if (sh.k === 'rocket') { boom(sh.x, sh.z, 1.8); sound('at', sh.x, sh.z); continue; }
    if (sh.k === 'bomb') { boom(sh.x, sh.z, 5); sound('tank', sh.x, sh.z); sound('tank', sh.x, sh.z); continue; }
    if (sh.k === 'salvo') { const from = units.get(sh.f); if (from) salvo(from, sh.x, sh.z, sh.n); sound('tank', from?.x ?? sh.x, from?.z ?? sh.z); continue; }
    if (sh.k === 'strafe' || sh.k === 'recon' || sh.k === 'bombing' || sh.k === 'dive' || sh.k === 'para') { plane(sh); continue; }
    if (sh.k === 'chutes') { chutes(sh.x, sh.z); continue; }
    if (sh.k === 'shotdown' || sh.k === 'planedown') { downed(sh); continue; }
    if (sh.k === 'flak') { for (let i = 0; i < 5; i++) setTimeout(() => puff(sh.x + (Math.random() - 0.5) * 16, sh.z + (Math.random() - 0.5) * 16), i * 90); sound('at', sh.x, sh.z); continue; }
    if (sh.k === 'aa') { const a = units.get(sh.f), b = units.get(sh.t); if (a && b) { const st = a.root.getWorldPosition(new THREE.Vector3()); st.y += isAir(a.type) ? 0 : 1.5; tracer(st, b.root.getWorldPosition(new THREE.Vector3()), 0xffe08a, 0.08); sound('mg', a.x, a.z); } continue; }
    if (sh.k === 'collapse') { boom(sh.x, sh.z, 2); const d = new THREE.Mesh(GEO.ball, new THREE.MeshBasicMaterial({ color: 0x9a9080, transparent: true, depthWrite: false })); d.position.set(sh.x, hAt(sh.x, sh.z) + 2, sh.z); world.add(d); fx.push({ obj: d, life: 2.5, max: 2.5, update: (f) => { d.scale.setScalar(4 + (1 - f) * 4); d.material.opacity = f * 0.7; }, dispose: () => d.material.dispose() }); sound('tank', sh.x, sh.z); continue; }
    if (sh.k === 'smokeshells') { for (let i = 0; i < 5; i++) setTimeout(() => sound('at', sh.x, sh.z), i * 150); continue; }
    if (sh.k === 'hurt') { if (sh.kill && units.get(sh.t)) units.get(sh.t).killed = true; continue; }
    const from = units.get(sh.f), to = units.get(sh.t), heavy = sh.k === 'at' || sh.k === 'tank' || sh.k === 'attacker';
    const miss = sh.hit ? 0 : 3, tx = sh.x + (Math.random() - 0.5) * miss, tz = sh.z + (Math.random() - 0.5) * miss;
    const end = new THREE.Vector3(tx, hAt(tx, tz) + (to && isVeh(to.type) ? 1.2 : 0.8), tz);
    if (from) {
      const n = sh.k === 'rifle' ? Math.min(3, from.alive) : 1;
      for (let i = 0; i < n; i++) {
        const src = from.type === 'tank' || from.type === 'at' ? from.turret : from.models.filter(m => m.visible)[i] || from.root;
        const start = src.getWorldPosition(new THREE.Vector3()); start.y += from.type === 'tank' ? 0.1 : 1;
        tracer(start, end, heavy ? 0xfff0b0 : 0xffd27a, heavy ? 0.18 : 0.09);
      }
    }
    if (heavy) boom(tx, tz, sh.hit ? 1.6 : 1);
    sound(sh.k, sh.x, sh.z);
    if (sh.kill && to) to.killed = true;
  }
  for (const v of [...units.values()]) if (!seen.has(v.id)) removeUnit(v);
  for (const [id, kind, tx, tz, ...path] of s.plans ?? []) { const v = units.get(id); if (v) v.plan = { kind, tx, tz, path }; }
  for (const [id, prog, rx, rz, ...queue] of s.queues ?? []) { const v = units.get(id); if (v) Object.assign(v, { prog, queue, rally: rx >= 0 ? { x: rx, z: rz } : null }); }
  applyGhosts(s.ghosts);
  coverGroup ??= (() => { const gp = new THREE.Group(); world.add(gp); return gp; })();
  coverGroup.children.forEach(o => { o.geometry.dispose(); o.material.dispose(); }); coverGroup.clear();
  for (const [x, z, r, t] of s.covers ?? []) { const m = new THREE.Mesh(new THREE.RingGeometry(r - 0.8, r, 64), new THREE.MeshBasicMaterial({ color: 0x9dd0ff, transparent: true, opacity: 0.2 + t / 150, depthTest: false })); m.rotation.x = -Math.PI / 2; m.position.set(x, hAt(x, z) + 0.4, z); m.renderOrder = 2; coverGroup.add(m); }
  if (s.nodes && !nodeMarks) nodeMarks = s.nodes.map(([x, z, rate, fuel]) => { const m = nodeMark(x, z, rate, fuel); world.add(m); return m; });

  s.points.forEach(([owner, capper, progress], i) => {
    const p = points[i]; if (!p) return;
    const oc = owner >= 0 ? look(owner).color : 0xdddddd;
    p.ringMat.color.set(oc); p.flagMat.color.set(oc);
    p.progMat.color.set(owner >= 0 ? oc : capper >= 0 ? look(capper).color : 0xffffff);
    p.prog.geometry.setDrawRange(0, Math.round(progress * 64) * 6);
  });
  syncSmoke(s.smokes);
  syncStrikes(s.strikes);
  applyCells(s.cells);
  alerts.snapshot(s, lastSnap);
  lastSnap = s;
  updateHud(s);
}

const smokes = new Map();
function syncSmoke(list) {
  const keep = new Set();
  for (const [x, z, r] of list) {
    const key = x + ',' + z; keep.add(key);
    if (smokes.has(key)) continue;
    const cloud = new THREE.Group(), m = new THREE.MeshLambertMaterial({ color: 0xd8d8d0, transparent: true, opacity: 0.5, depthWrite: false });
    for (let i = 0; i < 9; i++) {
      const a = i * 0.7, d = i ? r * 0.55 : 0, sz = r * (0.45 + Math.random() * 0.2);
      const cx = x + Math.cos(a) * d, cz = z + Math.sin(a) * d;
      cloud.add(mesh(GEO.ball, m, sz, sz * 0.7, sz, cx, sz * 0.5 + hAt(cx, cz), cz));
    }
    cloud.traverse(o => (o.castShadow = false));
    world.add(cloud); smokes.set(key, cloud);
  }
  for (const [key, cloud] of smokes) if (!keep.has(key)) { world.remove(cloud); smokes.delete(key); }
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
  else if (kind === 'grenade' || kind === 'barrage' || kind === 'satchel' || kind === 'amove') {
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
      setTimeout(() => { boom(sh.x + dx * a + (Math.random() - 0.5) * 3, sh.z + dz * a + (Math.random() - 0.5) * 3, 0.8); sound('mg', sh.x + dx * a, sh.z + dz * a); }, 1300 + i * 40);
    }
  }
  sound('tank', sh.x, sh.z);
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
  setTimeout(() => { boom(sh.x + dx * 25, sh.z + dz * 25, 4); sound('tank', sh.x, sh.z); }, life * 1000);
  puff(sh.x, sh.z);
}

// rocket salvo: eight streaks arcing from the launcher onto the target area
function salvo(from, x, z, n = 8) {
  const start = from.root.position.clone(); start.y += 2.5;
  for (let i = 0; i < n; i++) {
    const end = new THREE.Vector3(x + (Math.random() - 0.5) * 8, hAt(x, z), z + (Math.random() - 0.5) * 8), r = new THREE.Mesh(GEO.ball, new THREE.MeshBasicMaterial({ color: 0xffc070 }));
    r.scale.setScalar(0.3); r.visible = false; world.add(r);
    const life = 1.2 + i * 0.15;
    fx.push({ obj: r, life, max: life, update: (f) => { const t = Math.min(1, (1 - f) * life / 1.2 - i * 0.15 / 1.2); r.visible = t > 0; if (t > 0) { r.position.lerpVectors(start, end, t); r.position.y += Math.sin(t * Math.PI) * 18; } }, dispose: () => r.material.dispose() });
  }
}

// grenade in flight: a small arc from the thrower to the target
function lob(from, x, z) {
  const start = from.root.position.clone(), end = new THREE.Vector3(x, hAt(x, z), z), n = new THREE.Mesh(GEO.ball, mat(0x2a2a22));
  n.scale.setScalar(0.25); world.add(n);
  fx.push({ obj: n, life: 1.1, max: 1.1, update: (f) => { const t = 1 - f; n.position.lerpVectors(start, end, t); n.position.y += 1 + Math.sin(t * Math.PI) * 5; } });
}

// ---------- HUD ----------

// client/hud.js draws the panels; it reads the match state and calls back into these actions
const hud = createHud({
  get me() { return me; }, get teams() { return teams; }, get names() { return names; }, get PRIORITY() { return PRIORITY; },
  units, selected, look, facOf, color: (slot) => css(look(slot).color), classic: () => classicMode(), send: sendCmd, blip,
  retreat: () => retreat(), stop: () => { sendCmd({ t: 'stop', ids: [...selected] }); blip(330); }, amove: () => selected.size && setAim('amove'),
  dig: (k) => startDig(k), build: (k) => startBuild(k), ability: (t) => useAbility(t), support: (k) => aimSupport(k), fType: () => fKeyType(),
  builders: () => builders(), owns: (t) => owns(t), canPlace: (k) => canPlace(k),
  select: (id) => { selected.clear(); selected.add(id); updateHud(lastSnap); },
});
function buildSupportBar() { hud.buildSupport(); }
function aimSupport(k) {
  const { cur, cost } = supCost(lastSnap ?? {}, k);
  if (!lastSnap || lastSnap.sup[k] > 0 || !(lastSnap[cur] >= cost)) return;
  setAim(k); blip(700);
}
function buildBuyBar() { hud.buildCard(); }
function updateHud(s) { drawPlans(); hud.update(s); }

// the builder squad nearest the clicked spot puts the fortification across its approach
let fortKind = 'trench';
const diggers = () => [...selected].map(id => units.get(id)).filter(v => v && CFG.fortBuilders.includes(v.type) && !(v.flags & 1));
function startDig(kind) { if (diggers().length && lastSnap?.mp >= FORTS[kind].cost) { fortKind = kind; setAim('dig'); $('hint').textContent = `Click where to build the ${FORTS[kind].name.toLowerCase()} · right-click cancels`; blip(600); } }
// Selected units show where they're going and what they're locked onto (sent by the server for your own units)
const PLAN_LOOK = { 1: 0x9dd0ff, 2: 0xffa030, 3: 0xffffff, 4: 0xff4030, 5: 0xff4030, 6: 0xff4030, 7: 0xe8c860, 8: 0xe8c860, 9: 0x9dd0ff };
let planGroup = null;
function drawPlans() {
  if (!world) return;
  if (!planGroup) { planGroup = new THREE.Group(); world.add(planGroup); }
  planGroup.children.forEach(o => { o.geometry.dispose(); o.material.dispose(); });
  planGroup.clear();
  const at = (x, z) => ({ x, z, y: hAt(x, z) + 0.3 });
  const flat = (geo, color, opacity) => { const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false, side: THREE.DoubleSide })); m.renderOrder = 3; planGroup.add(m); return m; };
  // a flat band on the ground through the points (WebGL lines are 1px, too thin to read)
  const ribbon = (pts, width, color, opacity) => {
    const pos = [], idx = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1], l = Math.hypot(b.x - a.x, b.z - a.z) || 1, ox = -(b.z - a.z) / l * width / 2, oz = (b.x - a.x) / l * width / 2, k = pos.length / 3;
      pos.push(a.x + ox, a.y, a.z + oz, a.x - ox, a.y, a.z - oz, b.x + ox, b.y, b.z + oz, b.x - ox, b.y, b.z - oz);
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
    if (!idx.length) return;
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx);
    flat(geo, color, opacity);
  };
  const ring = (p, r, color) => { const m = flat(new THREE.RingGeometry(r - 0.4, r, 32), color, 0.85); m.rotation.x = -Math.PI / 2; m.position.set(p.x, p.y, p.z); };
  for (const id of selected) {
    const v = units.get(id);
    if (!v) continue;
    const p = v.plan, me3 = at(v.x, v.z);
    if (v.rally) { ribbon([me3, at(v.rally.x, v.rally.z)], 0.4, 0x9dd0ff, 0.5); ring(at(v.rally.x, v.rally.z), 1.1, 0x9dd0ff); }
    if (p?.kind) {
      const color = PLAN_LOOK[p.kind], pts = [me3];
      for (let i = 0; i < p.path.length; i += 2) pts.push(at(p.path[i], p.path[i + 1]));
      // the route, then a straight leg to whatever it's set on (plain moves end at their last waypoint)
      ribbon(pts, 0.5, color, 0.55);
      if (p.kind > 4) ribbon([pts.at(-1), at(p.tx, p.tz)], 0.3, color, 0.4);
      if (p.kind !== 4) ring(at(p.tx, p.tz), 1.1, color);
    }
    // what it's shooting at right now (ordered or picked by itself), or the enemy it was told to attack
    const t = units.get(v.tgt) ?? (p?.kind === 4 ? { x: p.tx, z: p.tz, type: 'rifle' } : null);
    if (t) { ribbon([me3, at(t.x, t.z)], 0.25, 0xff4030, 0.6); ring(at(t.x, t.z), UNITS[t.type].radius + 1.2, 0xff4030); }
  }
}

// Engineers put Supply Depots on resource nodes: J, then click near a node
const builders = () => [...selected].map(id => units.get(id)).filter(v => v && v.type === 'engineer' && !(v.flags & 1));
const owns = (type, done = true) => [...units.values()].some(v => v.owner === me && v.type === type && (!done || v.built >= 1));
const canPlace = (k) => lastSnap?.mp >= UNITS[k].cost && (!UNITS[k].needs || owns(UNITS[k].needs));
function startBuild(k) { if (builders().length && canPlace(k)) { setAim(k); blip(600); } }
// where a building would go for a cursor spot: grid-snapped center, and whether the ground looks clear
// (the server has the final say, including whether your side can see the spot)
function footAt(k, g) {
  const n = UNITS[k].size, cx = Math.round(g.x / CELL - n / 2), cy = Math.round(g.z / CELL - n / 2);
  const nodes = (lastSnap?.nodes ?? []).map(([x, z]) => [Math.floor(x / CELL) - 1, Math.floor(z / CELL) - 1]);
  let ok = !!terrain;
  for (let y = cy; y < cy + n && ok; y++) for (let x = cx; x < cx + n && ok; x++) {
    const ch = terrain.grid[y]?.[x];
    ok = ch !== undefined && !(TERRAIN[ch] & MOVE) && !'WF=K'.includes(ch) && !nodes.some(([nx, ny]) => x >= nx && x <= nx + 1 && y >= ny && y <= ny + 1);
  }
  return { x: (cx + n / 2) * CELL, z: (cy + n / 2) * CELL, ok };
}
// the free node nearest a spot (within 8 m), or null. A node is taken when a depot stands on it.
function nodeNear(g) {
  const free = (lastSnap?.nodes ?? []).filter(([x, z]) => ![...units.values()].some(v => v.type === 'depot' && Math.hypot(v.x - x, v.z - z) < 1));
  const [n] = free.sort((a, b) => Math.hypot(a[0] - g.x, a[1] - g.z) - Math.hypot(b[0] - g.x, b[1] - g.z));
  return n && Math.hypot(n[0] - g.x, n[1] - g.z) <= 8 ? { x: n[0], z: n[1] } : null;
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

const VOICES = [
  { lang: 'en-US', move: ['Yes sir!', 'Moving out!', 'On our way!', 'Roger that!'], attack: ['Engaging!', 'Give em hell!', 'Open fire!'], retreat: ['Fall back!', 'Pull back!'] },
  { lang: 'de-DE', move: ['Jawohl!', 'Vorwärts!', 'Verstanden!'], attack: ['Feuer frei!', 'Angriff!'], retreat: ['Zurück!', 'Rückzug!'] },
  { lang: 'ru-RU', move: ['Есть!', 'Вперёд!', 'Так точно!'], attack: ['Огонь!', 'В атаку!'], retreat: ['Отходим!', 'Назад!'] },
];
let muted = tryStore(() => localStorage.getItem('ww2-muted')) === '1', lastBark = 0;
function bark(kind) {
  if (muted || !window.speechSynthesis || performance.now() - lastBark < 2500 || me < 0) return;
  lastBark = performance.now();
  const v = VOICES[facOf(me)], lines = v[kind], u = new SpeechSynthesisUtterance(lines[Math.floor(Math.random() * lines.length)]);
  u.lang = v.lang; u.rate = 1.15; u.volume = 0.7;
  const voice = speechSynthesis.getVoices().find(x => x.lang.replace('_', '-').startsWith(v.lang.slice(0, 2)));
  if (voice) u.voice = voice;
  speechSynthesis.speak(u);
}
function setMuted(m) { muted = m; tryStore(() => localStorage.setItem('ww2-muted', m ? '1' : '0')); $('mute').textContent = m ? '🔇' : '🔊'; }
$('mute').onclick = () => setMuted(!muted);
setMuted(muted);

function retreat() { if (selected.size) { sendCmd({ t: 'retreat', ids: [...selected] }); blip(260); bark('retreat'); } }
// F: instant abilities fire now; grenades arm a targeting click
// targeting: null | 'grenade' | 'dig' | support kind. Directional ones take two clicks: center, then direction.
let targeting = null, aimCenter = null, aimMesh = null, home = null;
function cancelAim() { targeting = null; aimCenter = null; $('hint').textContent = ''; }
function setAim(kind) {
  targeting = kind; aimCenter = null;
  $('hint').textContent = { depot: 'Click a resource node', barracks: 'Click where to build', motorpool: 'Click where to build', grenade: 'Click where to throw', barrage: 'Click where to fire the salvo', satchel: 'Click where to plant the charge', amove: 'Click where to attack-move' }[kind] ?? 'Click to set the center';
  $('hint').textContent += ' · right-click cancels';
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
  return PRIORITY.find(t => sel.some(v => v.type === t && !v.cd)) ?? null;
}
const AIMED = { grenade: 'rifle', barrage: 'rocket', satchel: 'ranger' }; // abilities that need a spot clicked
function useAbility(type) {
  if (!type) return;
  const ready = [...selected].map(id => units.get(id)).filter(v => v && !v.cd && v.type === type);
  if (!ready.length) return;
  const id = UNITS[type].ab.id;
  if (AIMED[id]) setAim(id);
  else { sendCmd({ t: 'ability', ids: ready.map(v => v.id) }); blip(880); }
}
function throwAt(g, kind) {
  const who = [...selected].map(id => units.get(id)).filter(v => v && UNITS[v.type].ab.id === kind && !v.cd);
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
function moveTo(g, attack) {
  const sel = [...selected].map(id => units.get(id)).filter(Boolean);
  if (!sel.length) return;
  sendCmd({ t: attack ? 'amove' : 'move', orders: formation(sel, g) }); marker(g.x, g.z, attack ? 0xff9a40 : 0x9dff7a); blip(attack ? 500 : 660);
  bark(attack ? 'attack' : 'move');
}

// ---------- camera + input ----------

const cam = { x: 80, z: 80, yaw: 0, dist: 85 }, PITCH = 0.95, keys = new Set();
let mouse = { x: innerWidth / 2, y: innerHeight / 2, inside: false }, drag = null;

addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  keys.add(e.code);
  if (EDIT) return;
  const n = /^Digit([1-9])$/.exec(e.code)?.[1];
  // Ctrl+number sets a group (Shift+number too: in a plain browser tab Ctrl+1-8 switches tabs and pages can't stop it)
  if (n && (e.ctrlKey || e.metaKey || e.shiftKey)) { e.preventDefault(); groups[n] = [...selected]; blip(990); }
  else if (n) { selected.clear(); (groups[n] || []).forEach(id => units.has(id) && selected.add(id)); }
  else if (e.code === 'KeyX') { sendCmd({ t: 'stop', ids: [...selected] }); blip(330); }
  else if (e.code === 'KeyR') retreat();
  else if (e.code === 'KeyF') useAbility(fKeyType());
  else if (e.code === 'KeyG' && selected.size) setAim('amove');
  else if (e.code === 'KeyN') aimSupport('bombing');
  else if (e.code === 'KeyU') aimSupport('dive');
  else if (e.code === 'KeyP') aimSupport('para');
  else if (e.code === 'KeyI') aimSupport('cover');
  else if (e.code === 'KeyO') startBuild('airfield');
  else if (e.code === 'KeyY') startBuild('flakpos');
  else if (e.code === 'KeyM') setMuted(!muted);
  else if (e.code === 'Space') { const s = [...selected].map(id => units.get(id)).filter(Boolean), al = alerts.newest(); if (al) { cam.x = al.x; cam.z = al.z; } else if (s.length) { cam.x = s.reduce((a, v) => a + v.x, 0) / s.length; cam.z = s.reduce((a, v) => a + v.z, 0) / s.length; } e.preventDefault(); }
  else if (e.code === 'Escape') { if (targeting) cancelAim(); else selected.clear(); }
  else if (e.code === 'KeyH' && home) {
    cam.x = home.x; cam.z = home.z;
    const hq = classicMode() && [...units.values()].find(v => v.owner === me && v.type === 'hq');
    if (hq) { selected.clear(); selected.add(hq.id); if (lastSnap) updateHud(lastSnap); }
  }
  else if (e.code === 'KeyZ') aimSupport('recon');
  else if (e.code === 'KeyC') aimSupport('artillery');
  else if (e.code === 'KeyV') aimSupport('strafe');
  else if (e.code === 'KeyB') aimSupport('smoke');
  else if (e.code === 'KeyT') startDig('trench');
  else if (e.code === 'KeyY') startDig('sandbags');
  else if (e.code === 'KeyU') startDig('wire');
  else if (e.code === 'KeyI') startDig('traps');
  else if (e.code === 'KeyO') startDig('nest');
  else if (e.code === 'KeyJ') startBuild('depot');
  else if (e.code === 'KeyK') startBuild('barracks');
  else if (e.code === 'KeyL') startBuild('motorpool');
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
addEventListener('mousemove', (e) => {
  mouse = { x: e.clientX, y: e.clientY, inside: true };
  if (drag && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 6) {
    drag.moved = true;
    Object.assign($('box').style, { left: Math.min(drag.x, e.clientX) + 'px', top: Math.min(drag.y, e.clientY) + 'px', width: Math.abs(e.clientX - drag.x) + 'px', height: Math.abs(e.clientY - drag.y) + 'px' });
    $('box').classList.remove('hidden');
  }
});
document.addEventListener('mouseleave', () => (mouse.inside = false));
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
renderer.domElement.addEventListener('wheel', (e) => { cam.dist = Math.min(150, Math.max(25, cam.dist * (1 + Math.sign(e.deltaY) * 0.1))); }, { passive: true });

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
const groundAt = (mx, my) => {
  const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2(mx / innerWidth * 2 - 1, -(my / innerHeight) * 2 + 1), camera);
  const hit = groundMesh && ray.intersectObject(groundMesh)[0];
  return hit ? hit.point : ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
};

renderer.domElement.addEventListener('mousedown', (e) => {
  if (EDIT) return;
  if (targeting) {
    const kind = targeting, g = e.button === 0 && groundAt(e.clientX, e.clientY);
    if (!g) { cancelAim(); return; }
    if (kind === 'depot') {
      const n = nodeNear(g); cancelAim();
      if (n) { sendCmd({ t: 'build', ids: builders().map(v => v.id), kind: 'depot', x: n.x, z: n.z }); marker(n.x, n.z, 0xe8c860); blip(600); }
      return;
    }
    if (UNITS[kind]?.building) {
      const f = footAt(kind, g);
      if (!e.shiftKey) cancelAim(); // Shift-click keeps placing
      if (f.ok) { sendCmd({ t: 'build', ids: builders().map(v => v.id), kind, x: f.x, z: f.z }); marker(f.x, f.z, 0xe8c860); blip(600); }
      return;
    }
    if (SUPPORT[kind]?.point) { cancelAim(); sendCmd({ t: 'support', kind, x: g.x, z: g.z }); marker(g.x, g.z, 0xffa030); blip(520); return; }
    if (AIMED[kind]) { cancelAim(); throwAt(g, kind); return; }
    if (kind === 'amove') { cancelAim(); moveTo(g, true); return; }
    // first click: pin the center, then the mouse rotates it
    if (!aimCenter) { aimCenter = g; $('hint').textContent = 'Move the mouse to rotate · click to launch'; blip(560); return; }
    const c = aimCenter, dir = Math.hypot(g.x - c.x, g.z - c.z) > 1.5 ? Math.atan2(g.z - c.z, g.x - c.x) : defaultDir(kind, c);
    cancelAim();
    if (kind === 'dig') { const v = nearestDigger(c); if (v) { sendCmd({ t: 'dig', ids: [v.id], kind: fortKind, x: c.x, z: c.z, dir }); marker(c.x, c.z, 0xc8a060); blip(600); } }
    else { sendCmd({ t: 'support', kind, x: c.x, z: c.z, dir }); blip(520); }
    return;
  }
  if (e.button === 0) drag = { x: e.clientX, y: e.clientY, moved: false };
  if (e.button !== 2 || !selected.size || !lastSnap) return;
  const enemy = pick(e.clientX, e.clientY, v => foe(v.owner));
  const sel = [...selected].map(id => units.get(id)).filter(Boolean);
  if (sel.length && sel.every(v => UNITS[v.type].building)) {
    const g = groundAt(e.clientX, e.clientY);
    if (g) { for (const v of sel) sendCmd({ t: 'rally', id: v.id, x: g.x, z: g.z }); marker(g.x, g.z, 0x9dd0ff); blip(620); }
    return;
  }
  const planes = sel.filter(v => isAir(v.type)), friend = planes.length && pick(e.clientX, e.clientY, v => !foe(v.owner) && !UNITS[v.type].structure && !isAir(v.type));
  if (friend && planes.length === sel.length) { sendCmd({ t: 'escort', ids: planes.map(v => v.id), target: friend.id }); marker(friend.x, friend.z, 0x9dd0ff); blip(600); return; }
  const ownB = pick(e.clientX, e.clientY, v => !foe(v.owner) && UNITS[v.type].building, 60), eng = sel.filter(v => v.type === 'engineer');
  if (ownB && eng.length && (ownB.built < 1 || ownB.hp < UNITS[ownB.type].hpPer)) { sendCmd({ t: 'assist', ids: eng.map(v => v.id), id: ownB.id }); marker(ownB.x, ownB.z, 0xe8c860); blip(600); return; }
  if (enemy) { sendCmd({ t: 'attack', ids: sel.map(v => v.id), target: enemy.id }); marker(enemy.x, enemy.z, 0xff4030); blip(440); bark('attack'); return; }
  // a house: squads go inside, tanks and rocket trucks shell it, anything else walks up to it
  const house = houseAt(e.clientX, e.clientY);
  if (house) {
    const inf = sel.filter(v => UNITS[v.type].garrisons).map(v => v.id), guns = sel.filter(v => UNITS[v.type].w.shellTerrain || UNITS[v.type].w.salvo).map(v => v.id);
    if (inf.length) sendCmd({ t: 'garrison', ids: inf, x: house.x, z: house.z });
    if (guns.length) sendCmd({ t: 'fireat', ids: guns, x: house.x, z: house.z });
    const rest = sel.filter(v => !inf.includes(v.id) && !guns.includes(v.id));
    if (rest.length) sendCmd({ t: 'move', orders: formation(rest, house) });
    marker(house.x, house.z, guns.length && !inf.length ? 0xff4030 : 0x9dd0ff); blip(560);
    return;
  }
  const g = groundAt(e.clientX, e.clientY); if (!g) return;
  moveTo(g, e.ctrlKey); // Ctrl + right-click = attack-move
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
  if (EDIT || e.button !== 0 || !drag) return;
  $('box').classList.add('hidden');
  if (!e.shiftKey) selected.clear();
  if (drag.moved) {
    const x0 = Math.min(drag.x, e.clientX), x1 = Math.max(drag.x, e.clientX), y0 = Math.min(drag.y, e.clientY), y1 = Math.max(drag.y, e.clientY);
    for (const v of units.values()) { const s = screenOf(v); if (v.owner === me && !UNITS[v.type].structure && !(v.flags & 512) && s.front && s.x >= x0 && s.x <= x1 && s.y >= y0 && s.y <= y1) selected.add(v.id); }
  } else {
    const v = pick(e.clientX, e.clientY, v => v.owner === me && !UNITS[v.type].structure && !(v.flags & 512)) ?? pick(e.clientX, e.clientY, v => v.owner === me && UNITS[v.type].building, 60);
    if (v) selected.add(v.id);
  }
  drag = null;
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
  // what the camera sees
  const corners = [[0, 0], [innerWidth, 0], [innerWidth, innerHeight], [0, innerHeight]].map(([x, y]) => groundAt(x, y)).filter(Boolean);
  if (corners.length === 4) { c.beginPath(); corners.forEach((p, i) => (i ? c.lineTo(p.x, p.z) : c.moveTo(p.x, p.z))); c.closePath(); c.strokeStyle = '#fff8'; c.lineWidth = 1.5 / S; c.stroke(); }
}
{
  const cv = $('minimap');
  let mmDrag = false;
  const at = (e) => { const b = cv.getBoundingClientRect(); return mmToWorld((e.clientX - b.left) * cv.width / b.width, (e.clientY - b.top) * cv.height / b.height); };
  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  cv.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    const p = at(e);
    if (e.button === 0) { mmDrag = true; cam.x = p.x; cam.z = p.z; }
    else if (e.button === 2 && selected.size) moveTo(p, e.ctrlKey);
  });
  addEventListener('mousemove', (e) => { if (mmDrag) { const p = at(e); cam.x = p.x; cam.z = p.z; } });
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
  // DataTexture row 0 is the far (z = max) edge of the plane
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = ((h - 1 - y) * w + x) * 4; d[i] = d[i + 1] = d[i + 2] = 10; d[i + 3] = vis[y * w + x] ? 0 : 120; }
  fogTex.needsUpdate = true;
}

renderer.setAnimationLoop(() => {
  const now = performance.now(), dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
  // camera
  const pan = cam.dist * 1.1 * dt, f = { x: -Math.sin(cam.yaw), z: -Math.cos(cam.yaw) }, r = { x: Math.cos(cam.yaw), z: -Math.sin(cam.yaw) };
  let fw = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  let rt = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  if (mouse.inside && !drag && world) { if (mouse.x < 8) rt = -1; if (mouse.x > innerWidth - 8) rt = 1; if (mouse.y < 8) fw = 1; if (mouse.y > innerHeight - 8) fw = -1; }
  cam.x = Math.min(MW || 160, Math.max(0, cam.x + (f.x * fw + r.x * rt) * pan));
  cam.z = Math.min(MH || 160, Math.max(0, cam.z + (f.z * fw + r.z * rt) * pan));
  cam.yaw += ((keys.has('KeyE') ? 1 : 0) - (keys.has('KeyQ') ? 1 : 0)) * 1.6 * dt;
  const hd = cam.dist * Math.cos(PITCH);
  cam.y = (cam.y ?? 0) + (hAt(cam.x, cam.z) - (cam.y ?? 0)) * Math.min(1, dt * 4); // glide over hills
  camera.position.set(cam.x + Math.sin(cam.yaw) * hd, cam.y + cam.dist * Math.sin(PITCH), cam.z + Math.cos(cam.yaw) * hd);
  camera.lookAt(cam.x, cam.y, cam.z);

  // units: smooth toward the latest server state
  const k = 1 - Math.exp(-dt * 10);
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
  }
  for (let i = fx.length - 1; i >= 0; i--) {
    const e = fx[i]; e.life -= dt;
    if (e.life <= 0) { world.remove(e.obj); e.dispose?.(); fx.splice(i, 1); } else e.update(e.max ? e.life / e.max : 1);
  }
  if ((fogTimer -= dt) <= 0) { fogTimer = 0.2; updateFog(); }
  alerts.frame();
  if (!EDIT && (mmTimer -= dt) <= 0) { mmTimer = alerts.pinging() ? 0.05 : 0.15; drawMinimap(); }
  // aim preview follows the mouse while targeting
  if (targeting && world) {
    if (aimMesh?.userData.kind !== targeting) { if (aimMesh) world.remove(aimMesh); aimMesh = aimShape(targeting, 0xffe08a); aimMesh.userData.kind = targeting; world.add(aimMesh); }
    const g = groundAt(mouse.x, mouse.y);
    if (aimCenter) {
      aimMesh.position.set(aimCenter.x, hAt(aimCenter.x, aimCenter.z), aimCenter.z);
      if (g && Math.hypot(g.x - aimCenter.x, g.z - aimCenter.z) > 1.5) aimMesh.rotation.y = -Math.atan2(g.z - aimCenter.z, g.x - aimCenter.x);
    } else if (g && targeting === 'depot') {
      const n = nodeNear(g), at = n ?? g;
      aimMesh.position.set(at.x, hAt(at.x, at.z), at.z); aimMesh.userData.mat.color.set(n ? 0x60e070 : 0xe04030);
    } else if (g && UNITS[targeting]?.building) {
      const f = footAt(targeting, g);
      aimMesh.position.set(f.x, hAt(f.x, f.z), f.z); aimMesh.userData.mat.color.set(f.ok ? 0x60e070 : 0xe04030);
    } else if (g) { aimMesh.position.set(g.x, hAt(g.x, g.z), g.z); aimMesh.rotation.y = -defaultDir(targeting, g); }
  } else if (aimMesh) { world.remove(aimMesh); aimMesh = null; }
  const pulse = 0.25 + 0.2 * Math.sin(now / 120);
  for (const m of strikeMarks.values()) m.userData.mat.opacity = m.userData.t > 0 ? pulse : 0.2;
  renderer.domElement.style.cursor = targeting ? 'cell' : selected.size && pick(mouse.x, mouse.y, v => foe(v.owner)) ? 'crosshair' : 'default';
  renderer.render(scene, camera);
});

if (EDIT) { $('overlay').classList.add('hidden'); import('./editor.js').then(m => m.start({ startGame, cam, groundAt, renderer, scene, hAt })); }

// debug handle for poking at the game from devtools
window.__game = { renderer, scene, camera, cam, units, selected, sendCmd, makeUnit, hAt, alerts, get me() { return me; } };
// the alerts list above the minimap (client/alerts.js) sees the match through these
alerts.init({ me: () => me, friend: (slot) => !foe(slot), unitName: (type, owner) => look(owner).names[type] ?? UNITS[type].name, playerName: (slot) => names[slot] ?? 'An ally',
  pointPos: (i) => points[i]?.g.position, home: () => home, jump: (x, z) => { cam.x = x; cam.z = z; },
  onScreen: (x, z) => { const p = screenOf({ x, z }); return p.front && p.x >= 0 && p.x <= innerWidth && p.y >= 0 && p.y <= innerHeight; } });
