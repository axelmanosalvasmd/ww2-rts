import * as THREE from 'three';
import { UNITS, UNIT_TYPES, CELL, CFG, SUPPORT, SUPPORT_TYPES, levelOf } from '/shared/sim.js';

// Factions are cosmetic: same stats, different names and colors. Slot index = faction.
const FACTIONS = [
  { name: 'USA', color: 0x3d7bd9, uniform: 0x6b7248, vehicle: 0x59623d, names: { rifle: 'Rifle Squad', mg: '.30 cal MG', at: '57mm AT Gun', tank: 'M5 Stuart' } },
  { name: 'Germany', color: 0xe0b23a, uniform: 0x5c6266, vehicle: 0x50565a, names: { rifle: 'Grenadiers', mg: 'MG 42 Team', at: 'PaK 40', tank: 'Panzer II' } },
  { name: 'USSR', color: 0xd94a3d, uniform: 0x7d7250, vehicle: 0x4e5a38, names: { rifle: 'Riflemen', mg: 'Maxim MG', at: '45mm AT Gun', tank: 'T-70' } },
];
const ROLE = { rifle: 'Captures, all-round', mg: 'Pins infantry, sets up', at: 'Kills tanks, sets up', tank: 'Kills infantry, weak rear' };
const css = (c) => '#' + c.toString(16).padStart(6, '0');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const $ = (id) => document.getElementById(id);
const tryStore = (fn) => { try { return fn(); } catch { return null; } };

// ---------- networking ----------

const EDIT = new URLSearchParams(location.search).has('edit'); // /?edit opens the map editor instead of a match

let room = location.hash.slice(1).toLowerCase();
if (!/^[a-z0-9]{3,12}$/.test(room)) { room = Math.random().toString(36).slice(2, 7); history.replaceState(null, '', '#' + room); }
// per-tab token so a refresh reclaims your slot, while two tabs can still play each other
let token = tryStore(() => sessionStorage.getItem('ww2-token'));
if (!token) { token = Math.random().toString(36).slice(2) + Date.now().toString(36); tryStore(() => sessionStorage.setItem('ww2-token', token)); }
$('name').value = tryStore(() => localStorage.getItem('ww2-name')) || 'Soldier' + Math.floor(Math.random() * 90 + 10);
$('link').value = location.href;

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
    else if (m.t === 'full') { refused = true; $('lobbyMsg').textContent = 'This room is full or already playing. Make a new one by removing the #code from the link.'; }
  };
  ws.onclose = () => { if (refused) return; $('status').textContent = 'Connection lost, reconnecting...'; setTimeout(connect, 2000); };
}
if (!EDIT) connect();

$('name').addEventListener('change', () => { tryStore(() => localStorage.setItem('ww2-name', $('name').value)); sendCmd({ t: 'name', name: $('name').value }); });
$('copy').onclick = () => { navigator.clipboard?.writeText($('link').value); $('copy').textContent = 'Copied'; setTimeout(() => ($('copy').textContent = 'Copy'), 1200); };
$('start').onclick = () => sendCmd({ t: 'start' });
$('mapSel').onchange = () => sendCmd({ t: 'map', name: $('mapSel').value });
$('addAi').onclick = () => sendCmd({ t: 'addAi' });

function renderLobby(m) {
  lobbyState = m; me = m.you;
  // opened via localhost? friends can't use that address: hand out the public (Tailscale) one
  const local = /^(localhost|127\.|\[::1\])/.test(location.hostname);
  $('link').value = local && m.publicUrl ? `${m.publicUrl}/#${room}` : location.href;
  $('overlay').classList.toggle('hidden', m.state === 'play');
  const n = m.players.length, host = m.you === m.host, lobby = m.state === 'lobby';
  $('roster').innerHTML = FACTIONS.map((f, i) => {
    const p = m.players[i];
    const kick = p?.ai && host && lobby ? `<button class="kick" data-slot="${i}" title="Remove AI">✕</button>` : '';
    return `<div class="slot"><span class="swatch" style="background:${css(f.color)}"></span>
      <span>${p ? esc(p.name) + (i === m.you ? ' (you)' : '') : '<span class="muted">open slot</span>'}</span>
      <span class="muted" style="margin-left:auto">${f.name}${p && !p.connected ? ' · offline' : ''}${i === m.host ? ' · host' : ''}</span>${kick}</div>`;
  }).join('');
  $('roster').querySelectorAll('.kick').forEach(b => (b.onclick = () => sendCmd({ t: 'kick', slot: +b.dataset.slot })));
  $('start').classList.toggle('hidden', !host || m.state === 'play');
  $('mapSel').innerHTML = (m.maps || []).map(n => `<option ${n === m.mapName ? 'selected' : ''}>${esc(n)}</option>`).join('');
  $('mapSel').disabled = !host || !lobby;
  $('addAi').classList.toggle('hidden', !host || !lobby || n >= 3);
  $('start').textContent = m.state === 'over' ? 'Rematch' : n === 1 ? 'Start solo test' : n === 2 ? 'Start 1v1' : 'Start 3-way FFA';
  $('lobbyMsg').textContent = host ? (n === 1 ? 'Send the invite link, or add an AI opponent.' : '') : 'Waiting for the host to start...';
  const w = lastSnap?.winner;
  $('result').classList.toggle('hidden', m.state !== 'over' || w == null);
  if (m.state === 'over' && w != null) $('result').textContent = w === me ? 'Victory' : `${names[w] ?? 'Enemy'} wins`;
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
};
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

function startGame(m) {
  me = m.you; names = m.names;
  const map = m.map;
  if (world) scene.remove(world);
  world = new THREE.Group(); scene.add(world);
  units.clear(); selected.clear(); fx.length = 0; lastSnap = null; smokes.clear(); strikeMarks.clear();
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
  for (const [cell, ch] of m.cells || []) terrain.grid[Math.floor(cell / map.w)][cell % map.w] = ch;
  buildField(map);
  const ground = new THREE.Mesh(terrainGeometry(), new THREE.MeshLambertMaterial({ map: tex }));
  ground.rotation.x = -Math.PI / 2; ground.position.set(MW / 2, 0, MH / 2); ground.receiveShadow = true;
  world.add(ground); groundMesh = ground;

  terrain.grid.forEach((row, y) => row.forEach((_, x) => paintCell(x, y)));
  buildStructures();

  // capture points
  points = map.points.map((p) => {
    const g = new THREE.Group(); g.position.set((p.x + 0.5) * CELL, hAt((p.x + 0.5) * CELL, (p.y + 0.5) * CELL), (p.y + 0.5) * CELL);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xdddddd, transparent: true, opacity: 0.7, depthWrite: false });
    const ring = new THREE.Mesh(new THREE.RingGeometry(CFG.pointRadius - 0.35, CFG.pointRadius, 64), ringMat);
    const progMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false });
    const prog = new THREE.Mesh(new THREE.RingGeometry(CFG.pointRadius - 1.6, CFG.pointRadius - 0.6, 64), progMat);
    ring.rotation.x = prog.rotation.x = -Math.PI / 2; ring.position.y = 0.3; prog.position.y = 0.32;
    ring.material.depthTest = prog.material.depthTest = false; ring.renderOrder = prog.renderOrder = 2; // stay visible on slopes
    const flagMat = new THREE.MeshLambertMaterial({ color: 0xdddddd, side: THREE.DoubleSide });
    const flag = mesh(GEO.plane, flagMat, 2.2, 1.4, 1, 1.1, 7.2, 0);
    g.add(ring, prog, mesh(GEO.cyl, mat(0x5a4a36), 0.07, 8, 0.07, 0, 4, 0), flag, label(p.vp > 1 ? `★ ${p.vp}× VP` : `+${p.mp ?? 1} MP/s`));
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
  aimMesh = null;

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
  else if (ch === 'T') { c.fillStyle = '#3e3222'; c.fillRect(X, Y, px, px); c.fillStyle = '#2c2418'; c.fillRect(X + 2, Y + 2, px - 4, px - 4); }
}

// all 3D terrain pieces, rebuilt from the grid whenever a cell changes
function buildStructures() {
  const { grid, group, w } = terrain;
  group.clear();
  const cells = { B: [], H: [], '#': [], '=': [], R: [] };
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
  for (const h of houses) {
    const xs = h.cells.map(c => c[0]), ys = h.cells.map(c => c[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs) + 1, y0 = Math.min(...ys), y1 = Math.max(...ys) + 1;
    if ((x1 - x0) * (y1 - y0) !== h.cells.length) continue; // flat roof for odd (or half-collapsed) shapes
    const along = x1 - x0 >= y1 - y0, span = (along ? y1 - y0 : x1 - x0) * CELL + 0.6, len = (along ? x1 - x0 : y1 - y0) * CELL + 0.6;
    const shape = new THREE.Shape([new THREE.Vector2(-span / 2, 0), new THREE.Vector2(span / 2, 0), new THREE.Vector2(0, span * 0.4)]);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: false }); geo.translate(0, 0, -len / 2);
    const roof = mesh(geo, mat(0x7a3f2c), 1, 1, 1, (x0 + x1) / 2 * CELL, h.base + h.height, (y0 + y1) / 2 * CELL);
    if (along) roof.rotation.y = Math.PI / 2;
    group.add(roof);
  }
  inst(cells.H, 0x3f5a2a, ([x, y]) => [CELL * 1.05, 1.7 + rnd(x, y) * 0.5, CELL * 1.05, 0.9, 0.8 + rnd(x, y, 1) * 0.4]);
  inst(cells['#'], 0x9a958a, ([x, y]) => [CELL * 0.9, 0.9, CELL * 0.9, 0.45, 0.85 + rnd(x, y) * 0.25]);
  // rubble: a few broken chunks per cell
  inst(cells.R, 0x8a8070, ([x, y], k) => { const s = 0.5 + rnd(x, y, k) * 0.7; return [s, s * 0.6, s, s * 0.3, 0.7 + rnd(x, y, k + 5) * 0.4, undefined, (rnd(x, y, k + 9) - 0.5) * 1.4, (rnd(x, y, k + 13) - 0.5) * 1.4]; }, 3);
  // bridges: a plank deck, with rails on the sides that face the water
  inst(cells['='], 0x7a5a3a, () => [CELL * 1.02, 0.35, CELL * 1.02, 0.35, 1]);
  const rails = [];
  for (const [x, y] of cells['=']) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (grid[y + dy]?.[x + dx] === 'W') rails.push([x, y, dx, dy]);
  inst(rails, 0x5a4028, ([, , dx, dy]) => [dx ? 0.2 : CELL, 0.8, dx ? CELL : 0.2, 0.75, 1, undefined, dx * 0.9, dy * 0.9]);
  // trench parapets on every side that isn't more trench
  const dirt = mat(0x6b5a3e);
  for (const [x, y] of grid.flatMap((row, y) => row.map((ch, x) => ch === 'T' && [x, y]).filter(Boolean))) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (grid[y + dy]?.[x + dx] === 'T') continue;
      const cx = (x + 0.5 + dx * 0.55) * CELL, cz = (y + 0.5 + dy * 0.55) * CELL;
      group.add(mesh(GEO.box, dirt, dx ? 0.5 : CELL, 0.35, dx ? CELL : 0.5, cx, 0.17 + hAt(cx, cz), cz));
    }
  }
}

function applyCells(cells) {
  if (!cells?.length || !terrain) return;
  for (const [cell, ch] of cells) {
    const x = cell % terrain.w, y = Math.floor(cell / terrain.w);
    terrain.grid[y][x] = ch;
    paintCell(x, y);
  }
  terrain.tex.needsUpdate = true;
  buildStructures();
}

// Each player's HQ: tinted reinforce zone, sandbag ring, command tent, tall flag, name.
function buildHQ(sp, slot) {
  const f = FACTIONS[slot], R = CFG.reinforceRadius, g = new THREE.Group();
  g.position.set(sp.x, hAt(sp.x, sp.z), sp.z);
  const flat = (geo, opacity, y) => { const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: f.color, transparent: true, opacity, depthWrite: false })); m.rotation.x = -Math.PI / 2; m.position.y = y; return m; };
  g.add(flat(new THREE.CircleGeometry(R, 48), 0.18, 0.05), flat(new THREE.RingGeometry(R - 0.5, R, 64), 0.85, 0.06));
  // sandbags with gaps for the exits
  for (let i = 0; i < 36; i++) {
    if (i % 9 < 2) continue;
    const a = i / 36 * Math.PI * 2, bag = mesh(GEO.box, mat(0x9c8a60), 2.4, 0.9, 1.1, Math.cos(a) * (R + 0.8), 0.45, Math.sin(a) * (R + 0.8));
    bag.rotation.y = -a + Math.PI / 2; g.add(bag);
  }
  // command tent + crates
  const tent = f.vehicle, shape = new THREE.Shape([new THREE.Vector2(-3, 0), new THREE.Vector2(3, 0), new THREE.Vector2(0, 3.2)]);
  const tg = new THREE.ExtrudeGeometry(shape, { depth: 7, bevelEnabled: false }); tg.translate(0, 0, -3.5);
  g.add(mesh(tg, mat(tent), 1, 1, 1, -4, 0, -3));
  g.add(mesh(GEO.box, mat(0x6e5836), 1.4, 1.2, 1.4, 3, 0.6, -5), mesh(GEO.box, mat(0x6e5836), 1.4, 1.2, 1.4, 4.6, 0.6, -4.4), mesh(GEO.box, mat(0x5f4c2f), 1.2, 1, 1.2, 3.8, 1.7, -4.7));
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
  at: [[-0.5, 0.7], [-0.5, -0.7], [-1.2, 0.4], [-1.2, -0.4]],
};

function makeUnit(id, type, owner) {
  const def = UNITS[type], f = FACTIONS[owner], root = new THREE.Group();
  const v = { id, type, owner, root, models: [], alive: def.models, x: 0, z: 0, rot: 0, aim: 0, turret: null };
  const base = new THREE.Mesh(GEO.ring, new THREE.MeshBasicMaterial({ color: f.color, transparent: true, opacity: 0.9, depthWrite: false }));
  base.rotation.x = -Math.PI / 2; base.position.y = 0.15; base.scale.setScalar(def.radius + 0.4); base.renderOrder = 2;
  v.sel = new THREE.Mesh(GEO.ring, new THREE.MeshBasicMaterial({ color: 0xfff6c8, depthWrite: false, transparent: true }));
  v.sel.rotation.x = -Math.PI / 2; v.sel.position.y = 0.16; v.sel.scale.setScalar(def.radius + 1); v.sel.visible = false; v.sel.renderOrder = 2;
  root.add(base, v.sel); v.base = base;
  if (type === 'tank') {
    const hull = mat(f.vehicle), dark = mat(0x2a2a24);
    root.add(mesh(GEO.box, hull, 4.2, 1.1, 2.4, 0, 1, 0), mesh(GEO.box, dark, 4.4, 0.8, 0.6, 0, 0.45, 1.1), mesh(GEO.box, dark, 4.4, 0.8, 0.6, 0, 0.45, -1.1));
    v.turret = new THREE.Group(); v.turret.position.set(-0.2, 1.55, 0);
    v.turret.add(mesh(GEO.box, hull, 1.8, 0.8, 1.6), mesh(GEO.cyl, dark, 0.1, 2.4, 0.1, 1.9, 0.05, 0).rotateZ(Math.PI / 2), mesh(GEO.box, mat(f.color), 0.5, 0.82, 1.62, -0.5, 0, 0));
    root.add(v.turret);
    v.models.push(root);
  } else {
    const helmet = mat(new THREE.Color(f.uniform).lerp(new THREE.Color(f.color), 0.55).getHex());
    for (const [x, z] of SLOTS[type]) {
      const man = new THREE.Group(); man.position.set(x * 1.3, 0, z * 1.3); man.scale.setScalar(1.35);
      man.add(mesh(GEO.body, mat(f.uniform), 1, 1, 1, 0, 0.72, 0), mesh(GEO.helmet, helmet, 1, 1, 1, 0, 1.28, 0));
      root.add(man); v.models.push(man);
    }
    const dark = mat(0x2c2b26);
    if (type === 'mg') root.add(mesh(GEO.cyl, dark, 0.07, 1.4, 0.07, 1.0, 0.45, 0).rotateZ(Math.PI / 2), mesh(GEO.box, dark, 0.4, 0.4, 0.5, 0.5, 0.3, 0));
    if (type === 'at') {
      v.turret = new THREE.Group(); v.turret.position.set(0.6, 0, 0);
      v.turret.add(mesh(GEO.box, mat(f.vehicle), 0.12, 1.1, 1.6, 0.3, 0.9, 0), mesh(GEO.cyl, dark, 0.08, 2.6, 0.08, 1.5, 0.95, 0).rotateZ(Math.PI / 2),
        mesh(GEO.cyl, dark, 0.45, 0.2, 0.45, 0, 0.45, 0.8).rotateX(Math.PI / 2), mesh(GEO.cyl, dark, 0.45, 0.2, 0.45, 0, 0.45, -0.8).rotateX(Math.PI / 2));
      root.add(v.turret);
    }
  }
  // billboarded health + suppression bars
  v.bars = new THREE.Group(); v.bars.position.y = type === 'tank' ? 3.4 : 2.4;
  const bg = new THREE.Mesh(GEO.plane, new THREE.MeshBasicMaterial({ color: 0x111111, depthTest: false })); bg.scale.set(2.4, 0.42, 1);
  v.hpBar = new THREE.Mesh(GEO.plane, new THREE.MeshBasicMaterial({ color: f.color, depthTest: false })); v.hpBar.scale.set(2.3, 0.2, 1); v.hpBar.position.set(0, 0.07, 0.01);
  v.suppBar = new THREE.Mesh(GEO.plane, new THREE.MeshBasicMaterial({ color: 0xffd23a, depthTest: false })); v.suppBar.scale.set(2.3, 0.1, 1); v.suppBar.position.set(0, -0.11, 0.01);
  bg.renderOrder = 3; v.hpBar.renderOrder = v.suppBar.renderOrder = 4;
  v.bars.add(bg, v.hpBar, v.suppBar);
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
  if (v.killed && v.type === 'tank') {
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
  const vol = Math.max(0, 1 - Math.hypot(x - cam.x, z - cam.z) / 160) * (kind === 'tank' || kind === 'at' ? 0.9 : 0.25);
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
  const seen = new Set();
  for (const [id, type, owner, x, z, rot, aim, hp, supp, , cover, cd, flags] of s.units) {
    seen.add(id);
    let v = units.get(id);
    if (!v) { v = makeUnit(id, type, owner); Object.assign(v, { x, z, rot, aim }); units.set(id, v); }
    Object.assign(v, { tx: x, tz: z, trot: rot, taim: aim, hp, supp, cover, cd, flags });
    v.base.material.color.set(flags & 1 ? 0xffffff : FACTIONS[owner].color);
    const def = UNITS[type], alive = Math.ceil(hp / def.hpPer);
    if (type !== 'tank') while (v.alive > alive) corpse(v, v.models[--v.alive]);
    if (type !== 'tank') v.models.forEach(man => (man.position.y = cover === 2 ? -0.6 : 0));
    const frac = Math.max(0, hp / (def.models * def.hpPer));
    v.hpBar.scale.x = 2.3 * frac; v.hpBar.position.x = -1.15 * (1 - frac);
    v.hpBar.material.color.set(frac > 0.5 ? FACTIONS[owner].color : frac > 0.25 ? 0xe08a2a : 0xd02a1a);
    v.suppBar.visible = supp > 0;
    v.suppBar.scale.x = 2.3 * supp / 100; v.suppBar.position.x = -1.15 * (1 - supp / 100);
    v.suppBar.material.color.set(supp >= 90 ? 0xff3b2a : 0xffd23a);
  }
  for (const sh of s.shots) {
    if (sh.k === 'throw') { const from = units.get(sh.f); if (from) lob(from, sh.x, sh.z); continue; }
    if (sh.k === 'boom') { boom(sh.x, sh.z, 2.4); sound('at', sh.x, sh.z); continue; }
    if (sh.k === 'shell') { boom(sh.x, sh.z, 2.8); sound('tank', sh.x, sh.z); continue; }
    if (sh.k === 'strafe' || sh.k === 'recon') { plane(sh); continue; }
    if (sh.k === 'collapse') { boom(sh.x, sh.z, 2); const d = new THREE.Mesh(GEO.ball, new THREE.MeshBasicMaterial({ color: 0x9a9080, transparent: true, depthWrite: false })); d.position.set(sh.x, hAt(sh.x, sh.z) + 2, sh.z); world.add(d); fx.push({ obj: d, life: 2.5, max: 2.5, update: (f) => { d.scale.setScalar(4 + (1 - f) * 4); d.material.opacity = f * 0.7; }, dispose: () => d.material.dispose() }); sound('tank', sh.x, sh.z); continue; }
    if (sh.k === 'smokeshells') { for (let i = 0; i < 5; i++) setTimeout(() => sound('at', sh.x, sh.z), i * 150); continue; }
    if (sh.k === 'hurt') { if (sh.kill && units.get(sh.t)) units.get(sh.t).killed = true; continue; }
    const from = units.get(sh.f), to = units.get(sh.t), heavy = sh.k === 'at' || sh.k === 'tank';
    const miss = sh.hit ? 0 : 3, tx = sh.x + (Math.random() - 0.5) * miss, tz = sh.z + (Math.random() - 0.5) * miss;
    const end = new THREE.Vector3(tx, hAt(tx, tz) + (to?.type === 'tank' ? 1.2 : 0.8), tz);
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

  s.points.forEach(([owner, capper, progress], i) => {
    const p = points[i]; if (!p) return;
    const oc = owner >= 0 ? FACTIONS[owner].color : 0xdddddd;
    p.ringMat.color.set(oc); p.flagMat.color.set(oc);
    p.progMat.color.set(owner >= 0 ? oc : capper >= 0 ? FACTIONS[capper].color : 0xffffff);
    p.prog.geometry.setDrawRange(0, Math.round(progress * 64) * 6);
  });
  syncSmoke(s.smokes);
  syncStrikes(s.strikes);
  applyCells(s.cells);
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
      m = aimShape(kind, owner === me ? FACTIONS[owner].color : 0xff3020);
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
  if (kind === 'grenade') {
    const r = UNITS.rifle.ab.radius;
    g.add(flat(new THREE.RingGeometry(r - 0.6, r, 64)));
  } else {
    const [len, width] = kind === 'dig' ? [CFG.digCells * CELL, CELL] : [SUPPORT[kind].len, SUPPORT[kind].width];
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
  const low = sh.k === 'strafe' ? 9 : 26, span = 140, life = 3;
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

// grenade in flight: a small arc from the thrower to the target
function lob(from, x, z) {
  const start = from.root.position.clone(), end = new THREE.Vector3(x, hAt(x, z), z), n = new THREE.Mesh(GEO.ball, mat(0x2a2a22));
  n.scale.setScalar(0.25); world.add(n);
  fx.push({ obj: n, life: 1.1, max: 1.1, update: (f) => { const t = 1 - f; n.position.lerpVectors(start, end, t); n.position.y += 1 + Math.sin(t * Math.PI) * 5; } });
}

// ---------- HUD ----------

const SUPPORT_KEYS = { recon: 'Z', artillery: 'C', strafe: 'V', smoke: 'B' };
const SUPPORT_TIP = { recon: 'Reveals a wide area for 15s', artillery: '10 shells on an area after a 5s warning', strafe: 'Plane rakes a line from your HQ outward', smoke: 'Smoke screen over an area for 20s: blocks sight both ways' };
function buildSupportBar() {
  $('support').innerHTML = SUPPORT_TYPES.map(k => `<button data-k="${k}" title="${SUPPORT_TIP[k]}">${SUPPORT[k].name} <kbd>${SUPPORT_KEYS[k]}</kbd><span></span></button>`).join('');
  $('support').querySelectorAll('button').forEach(b => (b.onclick = () => aimSupport(b.dataset.k)));
}
function aimSupport(k) {
  if (!lastSnap || lastSnap.sup[k] > 0 || lastSnap.mp < SUPPORT[k].cost) return;
  setAim(k); blip(700);
}

function buildBuyBar() {
  $('buy').innerHTML = UNIT_TYPES.map(t => `<button data-unit="${t}" title="${ROLE[t]}"><b>${FACTIONS[me].names[t]}</b><span>${UNITS[t].cost} MP</span><small class="muted">${ROLE[t]}</small></button>`).join('');
  $('buy').querySelectorAll('button').forEach(b => (b.onclick = () => { sendCmd({ t: 'buy', unit: b.dataset.unit }); blip(520); }));
}

function updateHud(s) {
  const held = (slot) => s.points.filter(p => p[0] === slot).length;
  $('scores').innerHTML = names.map((n, i) => `<div class="score"><div class="row"><span class="swatch" style="background:${css(FACTIONS[i].color)}"></span><span>${esc(n)}</span><span class="muted" style="margin-left:auto">${held(i)}⚑</span></div>
    <div class="muted" style="font-size:11px">${s.online?.[i] === false ? '<span class="tag pin">OFFLINE · clock paused</span>' : s.ping?.[i] === -1 ? 'AI' : s.ping?.[i] != null ? `${s.ping[i]} ms` : ''}</div>
    <div class="bar"><div style="width:${Math.min(100, s.vp[i] / CFG.vpToWin * 100)}%;background:${css(FACTIONS[i].color)}"></div></div><div class="muted">${s.vp[i]} / ${CFG.vpToWin} VP</div></div>`).join('');
  const pop = [...units.values()].filter(v => v.owner === me).length;
  $('mp').textContent = `${s.mp} MP`;
  $('support').querySelectorAll('button').forEach(b => {
    const k = b.dataset.k, cd = s.sup[k];
    b.disabled = cd > 0 || s.mp < SUPPORT[k].cost;
    b.querySelector('span').textContent = cd > 0 ? `${cd}s` : `${SUPPORT[k].cost} MP`;
  });
  $('income').textContent = `+${s.inc}/s · ${pop}/${CFG.popCap} units`;
  $('buy').querySelectorAll('button').forEach(b => (b.disabled = s.mp < UNITS[b.dataset.unit].cost || pop >= CFG.popCap));
  $('selection').innerHTML = [...selected].map(id => units.get(id)).filter(Boolean).map(v => {
    const def = UNITS[v.type], tags = [v.flags & 1 ? '<span class="tag">RETREAT</span>' : '', v.flags & 8 ? '<span class="tag cov">REINFORCING</span>' : '', v.flags & 2 ? '<span class="tag sup">SUPPRESSIVE</span>' : '', v.flags & 4 ? '<span class="tag pin">AP LOADED</span>' : '', v.supp >= 90 ? '<span class="tag pin">PINNED</span>' : v.supp >= 50 ? '<span class="tag sup">SUPPRESSED</span>' : '', v.cover === 2 ? '<span class="tag cov">TRENCH</span>' : v.cover ? '<span class="tag cov">COVER</span>' : '', v.flags & 16 ? '<span class="tag">DIGGING</span>' : ''].join(' ');
    return `<div class="sel"><span>${FACTIONS[v.owner].names[v.type]}</span><span>${tags} ${v.type === 'tank' ? Math.ceil(v.hp) + 'hp' : Math.ceil(v.hp / def.hpPer) + '/' + def.models}</span></div>`;
  }).join('');
  // ability bar for the current selection
  const sel = [...selected].map(id => units.get(id)).filter(Boolean);
  const types = [...new Set(sel.map(v => v.type))];
  const dig = types.includes('rifle') ? `<button data-a="dig" ${lastSnap?.mp >= CFG.digCost ? '' : 'disabled'}>Dig trench <kbd>T</kbd> ${CFG.digCost}</button>` : '';
  $('abil').innerHTML = sel.length ? `<button data-a="retreat">Retreat <kbd>R</kbd></button>` + dig + types.map(t => {
    const ready = sel.filter(v => v.type === t && !v.cd).length, cd = Math.min(...sel.filter(v => v.type === t).map(v => v.cd || 0));
    return `<button data-a="${t}" ${ready ? '' : 'disabled'}>${UNITS[t].ab.name} <kbd>F</kbd>${ready ? '' : ` ${cd}s`}</button>`;
  }).join('') : '';
  $('abil').querySelectorAll('button').forEach(b => (b.onclick = () => (b.dataset.a === 'retreat' ? retreat() : b.dataset.a === 'dig' ? startDig() : useAbility(b.dataset.a))));
}

// the squad nearest the clicked spot digs a line across its approach
const diggers = () => [...selected].map(id => units.get(id)).filter(v => v && v.type === 'rifle' && !(v.flags & 1));
function startDig() { if (diggers().length && lastSnap?.mp >= CFG.digCost) { setAim('dig'); blip(600); } }
function nearestDigger(g) { return diggers().sort((a, b) => Math.hypot(a.x - g.x, a.z - g.z) - Math.hypot(b.x - g.x, b.z - g.z))[0]; }

function retreat() { if (selected.size) { sendCmd({ t: 'retreat', ids: [...selected] }); blip(260); } }
// F: instant abilities fire now; grenades arm a targeting click
// targeting: null | 'grenade' | 'dig' | support kind. Directional ones take two clicks: center, then direction.
let targeting = null, aimCenter = null, aimMesh = null, home = null;
function cancelAim() { targeting = null; aimCenter = null; $('hint').textContent = ''; }
function setAim(kind) {
  targeting = kind; aimCenter = null;
  $('hint').textContent = kind === 'grenade' ? 'Click where to throw · right-click cancels' : 'Click to set the center · right-click cancels';
}
// direction before the second click: planes fly out from home, trenches run across the squad's approach
function defaultDir(kind, at) {
  if (kind === 'dig') { const v = nearestDigger(at); return v ? Math.atan2(at.z - v.z, at.x - v.x) + Math.PI / 2 : 0; }
  return home ? Math.atan2(at.z - home.z, at.x - home.x) : 0;
}
function useAbility(only) {
  const ready = [...selected].map(id => units.get(id)).filter(v => v && !v.cd && (!only || v.type === only));
  const instant = ready.filter(v => UNITS[v.type].ab.id !== 'grenade');
  if (instant.length) { sendCmd({ t: 'ability', ids: instant.map(v => v.id) }); blip(880); }
  if (ready.some(v => v.type === 'rifle')) setAim('grenade');
}
function throwAt(g) {
  const rifles = [...selected].map(id => units.get(id)).filter(v => v && v.type === 'rifle' && !v.cd);
  if (!rifles.length) return;
  rifles.sort((a, b) => Math.hypot(a.x - g.x, a.z - g.z) - Math.hypot(b.x - g.x, b.z - g.z));
  sendCmd({ t: 'ability', ids: [rifles[0].id], x: g.x, z: g.z }); marker(g.x, g.z, 0xffa030); blip(760);
}

// ---------- camera + input ----------

const cam = { x: 80, z: 80, yaw: 0, dist: 85 }, PITCH = 0.95, keys = new Set();
let mouse = { x: innerWidth / 2, y: innerHeight / 2, inside: false }, drag = null;

addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  keys.add(e.code);
  if (EDIT) return;
  const n = /^Digit([1-9])$/.exec(e.code)?.[1];
  if (n && e.shiftKey) groups[n] = [...selected];
  else if (n) { selected.clear(); (groups[n] || []).forEach(id => units.has(id) && selected.add(id)); }
  else if (e.code === 'KeyX') { sendCmd({ t: 'stop', ids: [...selected] }); blip(330); }
  else if (e.code === 'KeyR') retreat();
  else if (e.code === 'KeyF') useAbility();
  else if (e.code === 'Space') { const s = [...selected].map(id => units.get(id)).filter(Boolean); if (s.length) { cam.x = s.reduce((a, v) => a + v.x, 0) / s.length; cam.z = s.reduce((a, v) => a + v.z, 0) / s.length; } e.preventDefault(); }
  else if (e.code === 'Escape') { if (targeting) cancelAim(); else selected.clear(); }
  else if (e.code === 'KeyH' && home) { cam.x = home.x; cam.z = home.z; }
  else if (e.code === 'KeyZ') aimSupport('recon');
  else if (e.code === 'KeyC') aimSupport('artillery');
  else if (e.code === 'KeyV') aimSupport('strafe');
  else if (e.code === 'KeyB') aimSupport('smoke');
  else if (e.code === 'KeyT') startDig();
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

const screenOf = (v) => { const p = new THREE.Vector3(v.x, 1, v.z).project(camera); return { x: (p.x + 1) / 2 * innerWidth, y: (1 - p.y) / 2 * innerHeight, front: p.z < 1 }; };
function pick(mx, my, test) {
  let best = null, bd = Infinity;
  for (const v of units.values()) {
    if (!test(v)) continue;
    const s = screenOf(v), d = Math.hypot(s.x - mx, s.y - my);
    if (s.front && d < (v.type === 'tank' ? 45 : 32) && d < bd) { bd = d; best = v; }
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
    if (kind === 'grenade') { cancelAim(); throwAt(g); return; }
    // first click: pin the center, then the mouse rotates it
    if (!aimCenter) { aimCenter = g; $('hint').textContent = 'Move the mouse to rotate · click to launch'; blip(560); return; }
    const c = aimCenter, dir = Math.hypot(g.x - c.x, g.z - c.z) > 1.5 ? Math.atan2(g.z - c.z, g.x - c.x) : defaultDir(kind, c);
    cancelAim();
    if (kind === 'dig') { const v = nearestDigger(c); if (v) { sendCmd({ t: 'dig', ids: [v.id], x: c.x, z: c.z, dir }); marker(c.x, c.z, 0xc8a060); blip(600); } }
    else { sendCmd({ t: 'support', kind, x: c.x, z: c.z, dir }); blip(520); }
    return;
  }
  if (e.button === 0) drag = { x: e.clientX, y: e.clientY, moved: false };
  if (e.button !== 2 || !selected.size || !lastSnap) return;
  const enemy = pick(e.clientX, e.clientY, v => v.owner !== me);
  const sel = [...selected].map(id => units.get(id)).filter(Boolean);
  if (enemy) { sendCmd({ t: 'attack', ids: sel.map(v => v.id), target: enemy.id }); marker(enemy.x, enemy.z, 0xff4030); blip(440); return; }
  const g = groundAt(e.clientX, e.clientY); if (!g) return;
  // simple formation: rows perpendicular to the direction of travel
  const cx = sel.reduce((a, v) => a + v.x, 0) / sel.length, cz = sel.reduce((a, v) => a + v.z, 0) / sel.length;
  const len = Math.hypot(g.x - cx, g.z - cz) || 1, dx = (g.x - cx) / len, dz = (g.z - cz) / len, cols = Math.ceil(Math.sqrt(sel.length)), gap = 5;
  sel.sort((a, b) => (a.x - cx) * -dz + (a.z - cz) * dx - ((b.x - cx) * -dz + (b.z - cz) * dx));
  const orders = sel.map((v, i) => {
    const col = i % cols - (Math.min(cols, sel.length) - 1) / 2, row = Math.floor(i / cols);
    return [v.id, g.x - dz * col * gap - dx * row * gap, g.z + dx * col * gap - dz * row * gap];
  });
  sendCmd({ t: 'move', orders }); marker(g.x, g.z, 0x9dff7a); blip(660);
});
addEventListener('mouseup', (e) => {
  if (EDIT || e.button !== 0 || !drag) return;
  $('box').classList.add('hidden');
  if (!e.shiftKey) selected.clear();
  if (drag.moved) {
    const x0 = Math.min(drag.x, e.clientX), x1 = Math.max(drag.x, e.clientX), y0 = Math.min(drag.y, e.clientY), y1 = Math.max(drag.y, e.clientY);
    for (const v of units.values()) { const s = screenOf(v); if (v.owner === me && s.front && s.x >= x0 && s.x <= x1 && s.y >= y0 && s.y <= y1) selected.add(v.id); }
  } else {
    const v = pick(e.clientX, e.clientY, v => v.owner === me);
    if (v) selected.add(v.id);
  }
  drag = null;
  if (lastSnap) updateHud(lastSnap);
});

// ---------- frame loop ----------

let lastT = performance.now();
let fogTimer = 0;
const lerpAngle = (a, b, k) => a + (Math.atan2(Math.sin(b - a), Math.cos(b - a))) * k;

function updateFog() {
  if (!fogTex) return;
  const { w, h } = fogGrid, d = fogTex.image.data, vis = new Uint8Array(w * h);
  for (const v of units.values()) {
    if (v.owner !== me) continue;
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
    v.root.position.set(v.x, gy, v.z); v.root.rotation.y = -v.rot;
    if (v.turret) v.turret.rotation.y = -(v.aim - v.rot);
    v.bars.position.set(v.x, gy + (v.type === 'tank' ? 3.4 : 2.4), v.z); v.bars.quaternion.copy(camera.quaternion);
    v.sel.visible = selected.has(v.id);
  }
  for (let i = fx.length - 1; i >= 0; i--) {
    const e = fx[i]; e.life -= dt;
    if (e.life <= 0) { world.remove(e.obj); e.dispose?.(); fx.splice(i, 1); } else e.update(e.max ? e.life / e.max : 1);
  }
  if ((fogTimer -= dt) <= 0) { fogTimer = 0.2; updateFog(); }
  // aim preview follows the mouse while targeting
  if (targeting && world) {
    if (aimMesh?.userData.kind !== targeting) { if (aimMesh) world.remove(aimMesh); aimMesh = aimShape(targeting, 0xffe08a); aimMesh.userData.kind = targeting; world.add(aimMesh); }
    const g = groundAt(mouse.x, mouse.y);
    if (aimCenter) {
      aimMesh.position.set(aimCenter.x, hAt(aimCenter.x, aimCenter.z), aimCenter.z);
      if (g && Math.hypot(g.x - aimCenter.x, g.z - aimCenter.z) > 1.5) aimMesh.rotation.y = -Math.atan2(g.z - aimCenter.z, g.x - aimCenter.x);
    } else if (g) { aimMesh.position.set(g.x, hAt(g.x, g.z), g.z); aimMesh.rotation.y = -defaultDir(targeting, g); }
  } else if (aimMesh) { world.remove(aimMesh); aimMesh = null; }
  const pulse = 0.25 + 0.2 * Math.sin(now / 120);
  for (const m of strikeMarks.values()) m.userData.mat.opacity = m.userData.t > 0 ? pulse : 0.2;
  renderer.domElement.style.cursor = targeting ? 'cell' : selected.size && pick(mouse.x, mouse.y, v => v.owner !== me) ? 'crosshair' : 'default';
  renderer.render(scene, camera);
});

if (EDIT) { $('overlay').classList.add('hidden'); import('./editor.js').then(m => m.start({ startGame, cam, groundAt, renderer, scene, hAt })); }

// debug handle for poking at the game from devtools
window.__game = { renderer, scene, camera, cam, units, selected, sendCmd, get me() { return me; } };
