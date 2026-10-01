// Map editor (/?edit). Reuses the game's renderer: every change rebuilds the world through startGame.
import * as THREE from 'three';
import { CELL, CFG, validateMap, findPath, TERRAIN, levelOf, levelChar, MAX_PLAYERS, createGame, spawnsFor } from '/shared/sim.js';

const TOOLS = [
  ['sel', 'Select / move'], ['.', 'Ground'], ['B', 'Building'], ['H', 'Hedgerow'], ['#', 'Wall'], ['+', 'Crater'], ['T', 'Trench'], ['X', 'Barbed wire'], ['Y', 'Tank traps'],
  ['W', 'River'], ['F', 'Ford'], ['=', 'Bridge'], ['R', 'Rubble'],
  ['up', 'Raise ground'], ['down', 'Lower / dig'], ['pt', 'Capture point'],
  // spawns go in order around the map: the game seats teammates on neighbouring numbers
  ...Array.from({ length: MAX_PLAYERS }, (_, i) => ['s' + i, 'Spawn ' + (i + 1)]),
];
const HEIGHT_TOOLS = { up: 1, down: -1 };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const store = { get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { sessionStorage.setItem(k, v); } catch {} } };

export async function start(api) {
  let map, grid, heights, name = 'default', tool = 'sel', brush = 1, sel = -1, painting = 0, timer = 0;
  let stroke = new Set();   // cells a height stroke already changed (one step per cell per drag)
  let picked = null;        // select tool: { cells: [[x,y]], ch } structure, or { marker: 'spawn'|'point', i }
  let dragFrom = null, dragOffset = [0, 0];
  let previewMode = '';     // '' = editing; else the mode the map is shown as the game would set it up
  const hl = new THREE.Group(); api.scene.add(hl);
  const pv = new THREE.Group(); api.scene.add(pv); // preview markers: bunkers, resource nodes

  const ui = document.createElement('div');
  ui.id = 'editor'; ui.className = 'panel';
  ui.innerHTML = `
    <h2 class="stencil">Map editor</h2>
    <div class="row"><select id="edLoad"></select><button id="edOpen">Open</button></div>
    <div class="row"><select id="edSize"><option>60</option><option selected>80</option><option>100</option><option>150</option><option>200</option></select><button id="edNew">New blank</button></div>
    <div class="ed-tools">${TOOLS.map(([k, label], i) => `<button data-tool="${k}" title="${i < 10 ? `key ${(i + 1) % 10}` : ""}">${label}</button>`).join('')}</div>
    <div class="row">Brush <select id="edBrush"><option>1</option><option>2</option><option>3</option></select><span class="muted">right-drag erases / lowers</span></div>
    <div class="row">Preview <select id="edMode" title="Show the map as each mode sets it up (editing is paused)"><option value="">Editing</option><option value="conquest">Conquest</option><option value="assault">Assault</option><option value="annihilation">Annihilation</option><option value="classic">Classic</option></select>
      players <select id="edPlayers"></select></div>
    <div id="edModeInfo" class="muted"></div>
    <div id="edSel" class="muted"></div>
    <div id="edPoint"></div>
    <div id="edCheck" class="muted"></div>
    <label>Name <input id="edName" maxlength="32"></label>
    <label>Title <input id="edTitle" maxlength="40"></label>
    <label>Password <input id="edPw" type="password"></label>
    <div class="row"><button id="edSave" class="stencil">Save</button><button id="edFair">Fairness test</button></div>
    <div id="edMsg" class="muted"></div>
    <a href="/" class="muted">Back to the game</a>`;
  document.body.append(ui);
  const $ = (id) => document.getElementById(id);
  $('edPw').value = store.get('ww2-edit-pw') || '';

  // ---------- model ----------
  const snapshot = () => ({ name: $('edTitle').value || name, w: map.w, h: map.h, rows: grid.map(r => r.join('')), heights: heights.map(r => r.map(levelChar).join('')), spawns: map.spawns, points: map.points, ...(map.defend?.every(i => i < map.spawns.length) && { defend: map.defend }) });
  function load(m, n) {
    map = m; name = n; grid = m.rows.map(r => [...r]); sel = -1; picked = null;
    heights = (m.heights || m.rows.map(r => '0'.repeat(r.length))).map(r => [...r].map(levelOf));
    map.points.forEach(p => { p.vp ??= 1; p.mp ??= 1; });
    $('edName').value = n; $('edTitle').value = m.name || n;
    rebuild(true);
  }
  function blank(size) {
    const c = Math.floor(size / 2), r = Math.floor(size * 0.4);
    const spawns = [0, 1, 2].map(k => ({ x: Math.round(c + Math.cos(-Math.PI / 2 + k * 2.094) * r), y: Math.round(c + Math.sin(-Math.PI / 2 + k * 2.094) * r) }));
    load({ name: 'New map', w: size, h: size, rows: Array(size).fill('.'.repeat(size)), heights: Array(size).fill('0'.repeat(size)), spawns, points: [{ x: c, y: c, vp: 1, mp: 1 }] }, 'new-map');
  }

  // ---------- rendering ----------
  const toWorld = (p) => ({ x: (p.x + 0.5) * CELL, z: (p.y + 0.5) * CELL });
  function rebuild(first = false) {
    const cam = { ...api.cam }, m = snapshot();
    pv.clear();
    if (previewMode && validateMap(m) === null) showPreview(m);
    else api.startGame({ map: m, you: 0, spawn: toWorld(m.spawns[0]), spawns: m.spawns.map(toWorld), cells: [], names: m.spawns.map((_, i) => 'Spawn ' + (i + 1) + (m.spawns[i].assault ? ' (Assault only)' : '')) });
    if (!first) Object.assign(api.cam, cam);
    else { api.cam.x = m.w; api.cam.z = m.h; api.cam.dist = 120; api.cam.yaw = 0; }
    check(m);
    pointPanel();
    highlight();
  }
  const later = () => { clearTimeout(timer); timer = setTimeout(() => rebuild(), 60); };

  // ---------- mode preview: run the game's own setup for the mode and show what it builds ----------
  function playersSelect(m) {
    const max = spawnsFor(m, previewMode || 'conquest').length, cur = +$('edPlayers').value || max;
    $('edPlayers').innerHTML = Array.from({ length: max - 1 }, (_, i) => `<option ${i + 2 === Math.min(cur, max) ? 'selected' : ''}>${i + 2}</option>`).join('');
  }
  function showPreview(m) {
    playersSelect(m);
    const mode = previewMode, n = +$('edPlayers').value, assault = mode === 'assault';
    // Assault: the map's defend spawns (or spawn 1) defend, the rest attack; other modes: everyone for themselves
    const defenders = assault ? Math.max(1, Math.min(n - 1, m.defend?.length ?? 1)) : 0;
    const teams = Array.from({ length: n }, (_, i) => (assault ? (i < defenders ? 0 : 1) : i));
    const g = createGame(m, teams.map((_, i) => 'P' + (i + 1)), false, teams, teams.map((_, i) => i % 3), { mode, defenderTeam: 0 });
    const cellOf = (p) => ({ x: Math.floor(p.x / CELL), y: Math.floor(p.z / CELL) });
    // which spawn each player got
    const used = m.spawns.map(s => g.players.findIndex(p => { const c = cellOf(p.spawn); return c.x === s.x && c.y === s.y; }));
    const role = (i) => (used[i] < 0 ? `not used in ${mode}` : assault ? (g.players[used[i]].team === 0 ? 'defends' : 'attacks') : `player ${used[i] + 1}`);
    // building footprints show as buildings; everything Assault or Classic added is in the game's cells
    const rows = Array.from({ length: m.h }, (_, y) => g.chars.slice(y * m.w, (y + 1) * m.w).map(ch => (ch === 'K' ? 'B' : ch)).join(''));
    const shown = { ...m, rows, points: g.points.map(p => ({ ...cellOf(p), vp: p.vp, mp: p.mp })) };
    api.startGame({ map: shown, you: 0, spawn: toWorld(m.spawns[0]), spawns: m.spawns.map(toWorld), cells: [], names: m.spawns.map((_, i) => `Spawn ${i + 1}: ${role(i)}`) });
    const mark = (p, color, w, h, y = 0.4) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 })); b.position.set(p.x, api.hAt(p.x, p.z) + y + h / 2, p.z); pv.add(b); };
    for (const u of g.units.values()) if (u.type === 'bunker') mark(u, 0x9a9a92, 5, 2.6, 0);
    for (const nd of g.nodes ?? []) mark(nd, nd.fuel ? 0xe07a30 : 0xe8c860, 3.4, 0.5);
    const cut = m.points.length - g.points.length, added = g.cellLog.filter(([, ch]) => ch === 'T' || ch === '#').length;
    const unused = used.map((u, i) => (u < 0 ? i + 1 : 0)).filter(Boolean);
    $('edModeInfo').innerHTML = [
      `${spawnsFor(m, mode).length} spawns usable${unused.length ? `; spawn ${unused.join(', ')} not used here` : ''}`,
      assault && `${defenders} defend, ${n - defenders} attack · ${[...g.units.values()].filter(u => u.type === 'bunker').length} bunker(s) (grey) · ${added} trench/wall cells added · clock ${Math.round(g.mode.timeLeft / 60)} min${cut ? ` · ${cut} VP-only point(s) left out` : ''}`,
      mode === 'classic' && `an HQ on every player's spawn · ${g.nodes.filter(nd => !nd.fuel).length} MP nodes (yellow), ${g.nodes.filter(nd => nd.fuel).length} Fuel nodes (orange) · points pay Munitions`,
      mode === 'conquest' && `first to ${g.winVp} VP`,
      'Editing is paused: pick Editing to change the map.',
    ].filter(Boolean).join('<br>');
  }
  $('edMode').onchange = () => { previewMode = $('edMode').value; picked = null; sel = -1; if (!previewMode) $('edModeInfo').textContent = ''; rebuild(); };
  $('edPlayers').onchange = () => rebuild();

  // validity + every spawn can walk to every point
  function check(m) {
    let err = validateMap(m);
    if (!err) {
      const g = { w: m.w, h: m.h, flags: Uint8Array.from(m.rows.join(''), ch => TERRAIN[ch]), height: Int8Array.from(m.heights.join(''), levelOf) };
      const bad = [];
      m.spawns.forEach((s, i) => m.points.forEach((p, j) => {
        const a = toWorld(s), b = toWorld(p);
        if (Math.hypot(a.x - b.x, a.z - b.z) > CELL && !findPath(g, a, b).length) bad.push(`spawn ${i + 1} can't reach point ${j + 1}`);
      }));
      err = bad.slice(0, 3).join(', ');
    }
    $('edCheck').innerHTML = err ? `<span style="color:#e0704a">⚠ ${esc(err)}</span>` : '✓ playable';
    return !err;
  }

  function pointPanel() {
    const p = map.points[sel];
    $('edPoint').innerHTML = p ? `<div class="row">Point ${sel + 1}: VP/s <input id="edVp" type="number" min="0" max="5" step="0.5" value="${p.vp}" style="width:56px">
      MP/s <input id="edMp" type="number" min="0" max="5" step="0.5" value="${p.mp}" style="width:56px"><button id="edDel" title="Delete">✕</button></div>` : '<span class="muted">Capture point tool: click to add, click one to edit it</span>';
    if (!p) return;
    $('edVp').onchange = () => { p.vp = Math.max(0, Math.min(5, +$('edVp').value || 0)); rebuild(); };
    $('edMp').onchange = () => { p.mp = Math.max(0, Math.min(5, +$('edMp').value || 0)); rebuild(); };
    $('edDel').onclick = () => { map.points.splice(sel, 1); sel = -1; rebuild(); };
  }

  // ---------- tools ----------
  const pickTool = (k) => { tool = k; ui.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === k)); };
  ui.querySelectorAll('[data-tool]').forEach(b => (b.onclick = () => pickTool(b.dataset.tool)));
  pickTool(tool);
  $('edBrush').onchange = () => (brush = +$('edBrush').value);

  const cellAt = (e) => {
    const g = api.groundAt(e.clientX, e.clientY);
    if (!g) return null;
    const x = Math.floor(g.x / CELL), y = Math.floor(g.z / CELL);
    return x >= 0 && y >= 0 && x < map.w && y < map.h ? { x, y } : null;
  };
  function paint(c, ch) {
    const r = brush - 1;
    for (let y = c.y - r; y <= c.y + r; y++) for (let x = c.x - r; x <= c.x + r; x++) {
      if (grid[y]?.[x] === undefined) continue;
      if (typeof ch === 'number') { // height step, once per cell per stroke
        if (stroke.has(y * map.w + x)) continue;
        stroke.add(y * map.w + x);
        heights[y][x] = Math.max(CFG.minLevel, Math.min(CFG.maxLevel, heights[y][x] + ch));
      } else grid[y][x] = ch;
    }
    later();
  }

  // ---------- select / move / delete ----------
  function structureAt(c) {
    const ch = grid[c.y][c.x];
    if (ch === '.') return null;
    const cells = [], seen = new Set([c.y * map.w + c.x]), q = [[c.x, c.y]];
    while (q.length) {
      const [x, y] = q.pop(); cells.push([x, y]);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, k = ny * map.w + nx;
        if (grid[ny]?.[nx] === ch && !seen.has(k)) { seen.add(k); q.push([nx, ny]); }
      }
    }
    return { cells, ch };
  }
  const NAMES = { B: 'building', H: 'hedgerow', '#': 'wall', '+': 'craters', T: 'trench', X: 'barbed wire', Y: 'tank traps', W: 'river', F: 'ford', '=': 'bridge', R: 'rubble' };
  function highlight() {
    hl.clear();
    const sp = picked?.marker === 'spawn' && map.spawns[picked.i];
    $('edSel').innerHTML = sp ? `Spawn ${picked.i + 1} · drag to move · Delete removes it (later spawns renumber)<br><label style="display:flex;gap:6px"><input type="checkbox" id="edAssaultOnly" ${sp.assault ? 'checked' : ''}> Assault only (e.g. inside the defenders' fortress; other modes skip it)</label>` : '';
    if (sp) $('edAssaultOnly').onchange = (e) => { if (e.target.checked) sp.assault = true; else delete sp.assault; rebuild(); };
    if (!picked?.cells) return;
    const m = new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.45, depthTest: false });
    for (const [x, y] of picked.cells) {
      const cx = (x + 0.5 + dragOffset[0]) * CELL, cz = (y + 0.5 + dragOffset[1]) * CELL, box = new THREE.Mesh(new THREE.BoxGeometry(CELL, 0.4, CELL), m);
      box.position.set(cx, api.hAt(cx, cz) + 0.3, cz); box.renderOrder = 6; hl.add(box);
    }
    $('edSel').textContent = `Selected ${NAMES[picked.ch] || 'structure'} (${picked.cells.length} cells) · drag to move · Delete removes · Esc deselects`;
  }
  function commitMove() {
    const [ox, oy] = dragOffset;
    if (!picked?.cells || (!ox && !oy)) return;
    for (const [x, y] of picked.cells) grid[y][x] = '.';
    picked.cells = picked.cells.map(([x, y]) => [x + ox, y + oy]).filter(([x, y]) => grid[y]?.[x] !== undefined);
    for (const [x, y] of picked.cells) grid[y][x] = picked.ch;
  }
  function deletePicked() {
    if (picked?.marker === 'spawn' && map.spawns.length > 2) { map.spawns.splice(picked.i, 1); picked = null; rebuild(); return true; }
    if (!picked?.cells) return false;
    for (const [x, y] of picked.cells) grid[y][x] = '.';
    picked = null; rebuild(); return true;
  }
  function click(c) {
    if (tool[0] === 's') { map.spawns[Math.min(+tool[1], map.spawns.length)] = { x: c.x, y: c.y }; rebuild(); return; } // no gaps
    if (tool === 'pt') {
      const hit = map.points.findIndex(p => Math.hypot(p.x - c.x, p.y - c.y) <= 3);
      if (hit >= 0) sel = hit;
      else if (map.points.length < 9) { map.points.push({ x: c.x, y: c.y, vp: 1, mp: 1 }); sel = map.points.length - 1; }
      rebuild();
    }
  }
  const canvas = api.renderer.domElement;
  canvas.addEventListener('mousedown', (e) => {
    if (previewMode) return; // previews are read-only
    const c = cellAt(e); if (!c) return;
    stroke = new Set();
    if (HEIGHT_TOOLS[tool]) { painting = e.button === 2 ? 4 : 3; paint(c, e.button === 2 ? -HEIGHT_TOOLS[tool] : HEIGHT_TOOLS[tool]); return; }
    if (e.button === 2) { painting = 2; paint(c, '.'); return; }
    if (e.button !== 0) return;
    if (tool === 'sel') {
      // markers first (they sit on top of terrain), then whole structures
      const si = map.spawns.findIndex(p => Math.hypot(p.x - c.x, p.y - c.y) <= 2), pi = map.points.findIndex(p => Math.hypot(p.x - c.x, p.y - c.y) <= 3);
      picked = si >= 0 ? { marker: 'spawn', i: si } : pi >= 0 ? { marker: 'point', i: pi } : structureAt(c);
      if (picked?.marker === 'point') { sel = picked.i; pointPanel(); }
      dragFrom = picked ? c : null; dragOffset = [0, 0];
      highlight();
      return;
    }
    if (TERRAIN[tool] !== undefined) { painting = 1; paint(c, tool); } else click(c);
  });
  addEventListener('mousemove', (e) => {
    if (dragFrom && picked) {
      if (!(e.buttons & 1)) { dragFrom = null; return; }
      const c = cellAt(e); if (!c) return;
      if (picked.marker) { const list = picked.marker === 'spawn' ? map.spawns : map.points; Object.assign(list[picked.i], { x: c.x, y: c.y }); later(); }
      else { dragOffset = [c.x - dragFrom.x, c.y - dragFrom.y]; highlight(); }
      return;
    }
    if (!painting) return;
    if (!(e.buttons & 3)) { painting = 0; return; } // button released outside the window
    const c = cellAt(e); if (!c) return;
    paint(c, painting === 2 ? '.' : painting === 3 ? HEIGHT_TOOLS[tool] : painting === 4 ? -HEIGHT_TOOLS[tool] : tool);
  });
  addEventListener('mouseup', () => {
    painting = 0;
    if (dragFrom && picked?.cells) { commitMove(); dragOffset = [0, 0]; rebuild(); }
    dragFrom = null;
  });
  addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    const n = /^Digit(\d)$/.exec(e.code)?.[1];
    if (n) pickTool(TOOLS[(+n + 9) % 10][0]);
    if (previewMode) return;
    if (e.code === 'Delete' || e.code === 'Backspace') {
      if (deletePicked()) return;
      if (sel >= 0) { map.points.splice(sel, 1); sel = -1; picked = null; rebuild(); }
    }
    if (e.code === 'Escape') { picked = null; sel = -1; highlight(); pointPanel(); }
  });

  // ---------- files ----------
  async function refreshList() {
    const maps = await (await fetch('/maps')).json();
    $('edLoad').innerHTML = maps.map(m => `<option ${m === name ? 'selected' : ''}>${esc(m)}</option>`).join('');
  }
  $('edOpen').onclick = async () => { const n = $('edLoad').value; load(await (await fetch(`/maps/${n}.json`)).json(), n); };
  $('edNew').onclick = () => blank(+$('edSize').value);
  $('edSave').onclick = async () => {
    const n = $('edName').value.trim().toLowerCase(), m = snapshot();
    if (!/^[a-z0-9-]{1,32}$/.test(n)) return ($('edMsg').textContent = 'Name: lowercase letters, digits and dashes');
    if (!check(m)) return ($('edMsg').textContent = 'Fix the warnings first');
    store.set('ww2-edit-pw', $('edPw').value);
    const r = await fetch(`/maps/${n}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-edit-password': $('edPw').value }, body: JSON.stringify(m) });
    const body = await r.json().catch(() => ({}));
    $('edMsg').textContent = r.ok ? `Saved as "${n}". Pick it in the lobby.` : `Not saved: ${body.error || r.status}`;
    if (r.ok) { name = n; refreshList(); }
  };

  // ---------- fairness: AI matches in a worker ----------
  let worker = null;
  $('edFair').onclick = () => {
    const m = snapshot();
    if (!check(m)) return ($('edMsg').textContent = 'Fix the warnings first');
    worker?.terminate();
    worker = new Worker('/client/fairness.js', { type: 'module' });
    $('edMsg').textContent = 'Running AI matches...';
    worker.onmessage = ({ data: d }) => {
      const played = d.done - d.timeouts, pct = d.wins.map(w => (played ? Math.round(w / played * 100) : 0));
      const warn = (t) => `<br><span style="color:#e0704a">⚠ ${t}</span>`;
      // verdicts only at the end; fairness needs enough finished matches to beat the noise (±~10% per spawn)
      const verdict = d.done < d.n ? ''
        : d.timeouts > d.n * 0.2 ? warn('Matches too long: most hit the 30 min cap. Add capture points or raise their VP.')
        : played < 60 ? warn('Too few finished matches to judge fairness.')
        : pct.some(p => p < 60 / pct.length || p > 140 / pct.length) ? warn('Unfair: a spawn wins far more or less than its share.')
        : '<br>✓ Looks fair';
      $('edMsg').innerHTML = `${d.done}/${d.n} matches · spawn wins ${pct.map((p, i) => `<b>${i + 1}</b>: ${p}%`).join(' ')}<br>
        avg ${d.avgMin.toFixed(1)} min · 2nd place at ${Math.round(d.second * 100)}% of winner${d.timeouts ? ` · ${d.timeouts} timeouts` : ''}${verdict}`;
    };
    worker.postMessage({ map: m, n: 90 });
  };

  await refreshList();
  load(await (await fetch('/maps/default.json')).json(), 'default');
  window.__editor = { snapshot }; // debug handle, like window.__game
}
