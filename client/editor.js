// Map editor (/?edit). Reuses the game's renderer: every change rebuilds the world through startGame.
import { CELL, validateMap, findPath, TERRAIN } from '/shared/sim.js';

const TOOLS = [
  ['.', 'Ground'], ['B', 'Building'], ['H', 'Hedgerow'], ['#', 'Wall'], ['+', 'Crater'], ['T', 'Trench'],
  ['s0', 'Spawn 1'], ['s1', 'Spawn 2'], ['s2', 'Spawn 3'], ['pt', 'Capture point'],
];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const store = { get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { sessionStorage.setItem(k, v); } catch {} } };

export async function start(api) {
  let map, grid, name = 'default', tool = 'B', brush = 1, sel = -1, painting = 0, timer = 0;

  const ui = document.createElement('div');
  ui.id = 'editor'; ui.className = 'panel';
  ui.innerHTML = `
    <h2 class="stencil">Map editor</h2>
    <div class="row"><select id="edLoad"></select><button id="edOpen">Open</button></div>
    <div class="row"><select id="edSize"><option>60</option><option selected>80</option><option>100</option></select><button id="edNew">New blank</button></div>
    <div class="ed-tools">${TOOLS.map(([k, label], i) => `<button data-tool="${k}" title="key ${i < 9 ? i + 1 : 0}">${label}</button>`).join('')}</div>
    <div class="row">Brush <select id="edBrush"><option>1</option><option>2</option><option>3</option></select><span class="muted">right-drag erases</span></div>
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
  const snapshot = () => ({ name: $('edTitle').value || name, w: map.w, h: map.h, rows: grid.map(r => r.join('')), spawns: map.spawns, points: map.points });
  function load(m, n) {
    map = m; name = n; grid = m.rows.map(r => [...r]); sel = -1;
    map.points.forEach(p => { p.vp ??= 1; p.mp ??= 1; });
    $('edName').value = n; $('edTitle').value = m.name || n;
    rebuild(true);
  }
  function blank(size) {
    const c = Math.floor(size / 2), r = Math.floor(size * 0.4);
    const spawns = [0, 1, 2].map(k => ({ x: Math.round(c + Math.cos(-Math.PI / 2 + k * 2.094) * r), y: Math.round(c + Math.sin(-Math.PI / 2 + k * 2.094) * r) }));
    load({ name: 'New map', w: size, h: size, rows: Array(size).fill('.'.repeat(size)), spawns, points: [{ x: c, y: c, vp: 1, mp: 1 }] }, 'new-map');
  }

  // ---------- rendering ----------
  const toWorld = (p) => ({ x: (p.x + 0.5) * CELL, z: (p.y + 0.5) * CELL });
  function rebuild(first = false) {
    const cam = { ...api.cam }, m = snapshot();
    api.startGame({ map: m, you: 0, spawn: toWorld(m.spawns[0]), spawns: m.spawns.map(toWorld), cells: [], names: ['Spawn 1', 'Spawn 2', 'Spawn 3'] });
    if (!first) Object.assign(api.cam, cam);
    else { api.cam.x = m.w; api.cam.z = m.h; api.cam.dist = 120; api.cam.yaw = 0; }
    check(m);
    pointPanel();
  }
  const later = () => { clearTimeout(timer); timer = setTimeout(() => rebuild(), 60); };

  // validity + every spawn can walk to every point
  function check(m) {
    let err = validateMap(m);
    if (!err) {
      const g = { w: m.w, h: m.h, flags: Uint8Array.from(m.rows.join(''), ch => TERRAIN[ch]) };
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
    for (let y = c.y - r; y <= c.y + r; y++) for (let x = c.x - r; x <= c.x + r; x++) if (grid[y]?.[x] !== undefined) grid[y][x] = ch;
    later();
  }
  function click(c) {
    if (tool[0] === 's') { map.spawns[+tool[1]] = { x: c.x, y: c.y }; rebuild(); return; }
    if (tool === 'pt') {
      const hit = map.points.findIndex(p => Math.hypot(p.x - c.x, p.y - c.y) <= 3);
      if (hit >= 0) sel = hit;
      else if (map.points.length < 9) { map.points.push({ x: c.x, y: c.y, vp: 1, mp: 1 }); sel = map.points.length - 1; }
      rebuild();
    }
  }
  const canvas = api.renderer.domElement;
  canvas.addEventListener('mousedown', (e) => {
    const c = cellAt(e); if (!c) return;
    if (e.button === 2) { painting = 2; paint(c, '.'); return; }
    if (e.button !== 0) return;
    if (TERRAIN[tool] !== undefined) { painting = 1; paint(c, tool); } else click(c);
  });
  addEventListener('mousemove', (e) => {
    if (!painting) return;
    if (!(e.buttons & 3)) { painting = 0; return; } // button released outside the window
    const c = cellAt(e); if (c) paint(c, painting === 2 ? '.' : tool);
  });
  addEventListener('mouseup', () => (painting = 0));
  addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    const n = /^Digit(\d)$/.exec(e.code)?.[1];
    if (n) pickTool(TOOLS[(+n + 9) % 10][0]);
    if ((e.code === 'Delete' || e.code === 'Backspace') && sel >= 0) { map.points.splice(sel, 1); sel = -1; rebuild(); }
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
        : pct.some(p => p < 20 || p > 47) ? warn('Unfair: a spawn wins far more or less than a third.')
        : '<br>✓ Looks fair';
      $('edMsg').innerHTML = `${d.done}/${d.n} matches · spawn wins ${pct.map((p, i) => `<b>${i + 1}</b>: ${p}%`).join(' ')}<br>
        avg ${d.avgMin.toFixed(1)} min · 2nd place at ${Math.round(d.second * 100)}% of winner${d.timeouts ? ` · ${d.timeouts} timeouts` : ''}${verdict}`;
    };
    worker.postMessage({ map: m, n: 90 });
  };

  await refreshList();
  load(await (await fetch('/maps/default.json')).json(), 'default');
}
