import * as sim from '/shared/sim.js';
import * as motion from '/shared/vehicle-motion.js';
import { MOVEMENT_SCENARIOS, MOVEMENT_TYPES, createMovementCase } from './movement-lab-scenarios.js';
import { runMovementCase } from './movement-lab-runner.js';

const $ = id => document.getElementById(id), canvas = $('map'), ctx = canvas.getContext('2d');
const colors = ['#74d5f1', '#9de4a6', '#ffc486', '#d6b0ff'];
let fixture, selectedId, playing = false, lastFrame = 0, accumulator = 0, summary = null, trap = null;
let trails = new Map(), metrics = new Map(), view;
const params = new URLSearchParams(location.search);
for (const s of MOVEMENT_SCENARIOS) $('scenario').add(new Option(s.name, s.id));
for (const t of MOVEMENT_TYPES) $('type').add(new Option(sim.UNITS[t].name ?? t, t));
if (MOVEMENT_SCENARIOS.some(s => s.id === params.get('scenario'))) $('scenario').value = params.get('scenario');
if (MOVEMENT_TYPES.includes(params.get('type'))) $('type').value = params.get('type');
if (params.has('heading') && Number.isFinite(Number(params.get('heading')))) $('heading').value = params.get('heading');
const options = () => ({ type: $('type').value, heading: Number.isFinite(Number($('heading').value)) ? Number($('heading').value) : 0.15 });
const selected = () => fixture.g.units.get(selectedId) ?? fixture.unit;
const degrees = radians => radians * 180 / Math.PI;
const delta = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
const movementBad = m => m.hullViolations > 0 || m.stationaryTurn > Math.PI * 1.9
  || ['arrival', 'short', 'redirect'].includes(fixture.scenario.id) && m.orderTurn > Math.PI * 1.75;
const text = (id, value) => { $(id).textContent = value; };
function notice(value) { text('notice', value); }

function pause() { playing = false; $('play').textContent = 'Run'; accumulator = 0; draw(); }
function play() { playing = true; lastFrame = performance.now(); $('play').textContent = 'Pause'; }
function reset(id = $('scenario').value, opts = {}) {
  pause();
  $('scenario').value = id;
  if (opts.type) $('type').value = opts.type;
  if (Number.isFinite(opts.heading)) $('heading').value = opts.heading;
  fixture = createMovementCase(sim, id, { ...options(), ...opts }); selectedId = fixture.unit.id;
  trails = new Map(); metrics = new Map(); summary = null; trap = null;
  for (const u of fixture.g.units.values()) {
    trails.set(u.id, [{ x: u.x, z: u.z }]);
    metrics.set(u.id, { distance: 0, orderTurn: 0, maxOrderTurn: 0, stationaryTurn: 0, maxStationaryTurn: 0, hullViolations: 0 });
  }
  $('unit').replaceChildren(...[...fixture.g.units.values()].map(u => new Option(`${sim.UNITS[u.type].name} #${u.id}${fixture.anchors.has(u.id) ? ' (protected)' : ''}`, u.id)));
  $('unit').value = selectedId; text('description', fixture.scenario.description);
  text('summary', 'Run the full scenario check to inspect arrival, spin, and terrain failures.'); $('summary').className = '';
  text('trap', 'Add nearby tank trap'); notice('Manual orders and terrain changes stay in place while paused.');
  const url = new URL(location.href); url.searchParams.set('scenario', id); url.searchParams.set('type', fixture.type); url.searchParams.set('heading', fixture.heading); history.replaceState(null, '', url);
  draw(); return fixture;
}
function advanceTicks(count = 1) {
  count = Math.max(0, Math.min(100000, Math.floor(Number(count) || 0)));
  for (let n = 0; n < count; n++) {
    const before = new Map([...fixture.g.units.values()].map(u => [u.id, { x: u.x, z: u.z, rot: u.rot }]));
    fixture.advance();
    for (const u of fixture.g.units.values()) {
      const b = before.get(u.id), m = metrics.get(u.id);
      if (!b || !m) continue;
      const distance = Math.hypot(u.x - b.x, u.z - b.z);
      const orderKey = u.worldGoal && `${u.worldGoal.x}:${u.worldGoal.z}`;
      if (orderKey && orderKey !== m.orderKey) { m.orderKey = orderKey; m.orderTurn = 0; }
      m.orderTurn += Math.abs(delta(b.rot, u.rot)); m.maxOrderTurn = Math.max(m.maxOrderTurn, m.orderTurn);
      m.distance += distance; m.stationaryTurn = distance < 0.001 ? m.stationaryTurn + Math.abs(delta(b.rot, u.rot)) : 0;
      m.maxStationaryTurn = Math.max(m.maxStationaryTurn, m.stationaryTurn);
      if (motion.isGroundVehicle(sim.UNITS[u.type]) && !motion.vehiclePositionClear(fixture.g, u, sim.UNITS[u.type], sim.MOVE | sim.VBLOCK)) m.hullViolations++;
      const trail = trails.get(u.id), prior = trail.at(-1);
      if (Math.hypot(prior.x - u.x, prior.z - u.z) > 0.15) { trail.push({ x: u.x, z: u.z }); if (trail.length > 5000) trail.shift(); }
    }
  }
  draw(); return fixture;
}
function runCase(id = $('scenario').value, opts = {}) {
  summary = runMovementCase(sim, motion, id, { ...options(), ...opts });
  text('summary', summary.passed ? `PASS: ${summary.name}, ${summary.type}, ${summary.seconds.toFixed(1)} s. All movement checks passed.` : `FAIL: ${summary.failures.join('; ')}`);
  $('summary').className = summary.passed ? 'good' : 'bad'; return summary;
}
function command(t, target) {
  const u = selected(), g = fixture.g;
  const result = sim.command(g, u.owner, t === 'move' ? { t, orders: [[u.id, target.x, target.z]] } : { t, ids: [u.id] });
  if (result) notice(`Order denied: ${result}`);
  else {
    if (t === 'stop') fixture.goals.delete(u.id);
    else fixture.goals.set(u.id, t === 'retreat' ? { ...g.players[u.owner].spawn, retreat: true } : target);
    notice(`${t === 'move' ? 'New destination' : t === 'stop' ? 'Stop' : 'Retreat'} issued to #${u.id} at ${fixture.elapsed.toFixed(2)} s.`);
  }
  draw();
}
function toggleTrap() {
  const u = selected(), g = fixture.g;
  if (trap) { sim.mutateWorldCell(g, trap.cell, { object: trap.previous }); trap = null; text('trap', 'Add nearby tank trap'); notice('The manual tank trap was removed.'); }
  else {
    const distance = Math.max(6, sim.UNITS[u.type].radius * 2.5), angle = u.travelDir ?? u.rot;
    const x = Math.min(g.w - 1, Math.max(0, Math.floor((u.x + Math.cos(angle) * distance) / sim.CELL)));
    const z = Math.min(g.h - 1, Math.max(0, Math.floor((u.z + Math.sin(angle) * distance) / sim.CELL)));
    const cell = z * g.w + x; trap = { cell, previous: g.objects[cell] };
    sim.mutateWorldCell(g, cell, { object: 'Y' }); text('trap', 'Remove tank trap'); notice(`Tank trap added at cell ${x}, ${z}.`);
  }
  draw();
}
function line(points, color, width = 1, dash = []) {
  if (!points.length) return; ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash);
  points.forEach((p, i) => i ? ctx.lineTo(p.x, p.z) : ctx.moveTo(p.x, p.z)); ctx.stroke(); ctx.setLineDash([]);
}
function marker(p, color, shape = 'cross') {
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.z)) return;
  ctx.strokeStyle = color; ctx.lineWidth = 1.8 / view.scale;
  ctx.beginPath(); if (shape === 'circle') ctx.arc(p.x, p.z, 5 / view.scale, 0, Math.PI * 2);
  else { const r = 7 / view.scale; ctx.moveTo(p.x - r, p.z); ctx.lineTo(p.x + r, p.z); ctx.moveTo(p.x, p.z - r); ctx.lineTo(p.x, p.z + r); } ctx.stroke();
}
function draw() {
  if (!fixture) return;
  const g = fixture.g, u = selected(), zoom = Number($('zoom').value), span = g.w * sim.CELL / zoom;
  const vx = Math.max(0, Math.min(g.w * sim.CELL - span, u.x - span / 2)), vz = Math.max(0, Math.min(g.h * sim.CELL - span, u.z - span / 2));
  view = { x: vx, z: vz, scale: canvas.width / span };
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#243b33'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(view.scale, 0, 0, view.scale, -vx * view.scale, -vz * view.scale);
  const terrain = { W: '#264f69', B: '#73838b', K: '#73838b', '=': '#89765c', D: '#89765c', F: '#477279', Y: '#d49372', R: '#7e7772', Q: '#777c88' };
  for (let y = Math.floor(vz / sim.CELL); y < Math.min(g.h, (vz + span) / sim.CELL + 1); y++) for (let x = Math.floor(vx / sim.CELL); x < Math.min(g.w, (vx + span) / sim.CELL + 1); x++) {
    const c = y * g.w + x, char = g.chars[c], color = terrain[char] ?? terrain[g.ground[c]] ?? (g.height?.[c] > 1 ? '#605e46' : g.height?.[c] ? '#435747' : null);
    if (color) { ctx.fillStyle = color; ctx.fillRect(x * sim.CELL, y * sim.CELL, sim.CELL, sim.CELL); }
    if (g.objects[c] === 'Y') { ctx.strokeStyle = '#1f2528'; ctx.lineWidth = 0.3; ctx.beginPath(); ctx.moveTo(x * sim.CELL, y * sim.CELL); ctx.lineTo((x + 1) * sim.CELL, (y + 1) * sim.CELL); ctx.moveTo((x + 1) * sim.CELL, y * sim.CELL); ctx.lineTo(x * sim.CELL, (y + 1) * sim.CELL); ctx.stroke(); }
  }
  ctx.strokeStyle = '#ffffff0d'; ctx.lineWidth = 1 / view.scale;
  for (let c = 0; c <= g.w; c += 4) { ctx.beginPath(); ctx.moveTo(c * sim.CELL, 0); ctx.lineTo(c * sim.CELL, g.h * sim.CELL); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, c * sim.CELL); ctx.lineTo(g.w * sim.CELL, c * sim.CELL); ctx.stroke(); }
  let index = 0;
  for (const unit of g.units.values()) {
    const m = metrics.get(unit.id), def = sim.UNITS[unit.type], color = colors[index++ % colors.length];
    const bad = movementBad(m);
    line(trails.get(unit.id) ?? [], '#6cbb9c88', 1.5 / view.scale);
    line([unit, ...unit.path], '#8ba4bd', 1.3 / view.scale, [4 / view.scale, 3 / view.scale]);
    for (const p of unit.path) marker(p, '#8ba4bd', 'circle');
    marker(unit.worldGoal ?? fixture.goals.get(unit.id), '#fff08b'); marker(unit.traffic?.goal, '#efa6ff', 'circle'); marker(unit.motionClearance?.goal, '#ffa76e', 'circle');
    ctx.save(); ctx.translate(unit.x, unit.z); ctx.rotate(unit.rot);
    const long = motion.isGroundVehicle(def) ? motion.bodyRadius(def) : Math.max(0.8, def.radius * 0.7), wide = motion.isGroundVehicle(def) ? def.radius * 0.48 : long * 0.65;
    ctx.fillStyle = bad ? '#ff7272' : color; ctx.strokeStyle = unit.id === selectedId ? '#fff' : '#10212b'; ctx.lineWidth = (unit.id === selectedId ? 2.5 : 1) / view.scale;
    ctx.fillRect(-long, -wide, long * 2, wide * 2); ctx.strokeRect(-long, -wide, long * 2, wide * 2);
    line([{ x: 0, z: 0 }, { x: long + 1.8, z: 0 }], '#fff', 2 / view.scale); ctx.restore();
    ctx.fillStyle = '#eef8ff'; ctx.font = `${13 / view.scale}px system-ui`; ctx.fillText(`#${unit.id} ${unit.type}`, unit.x + 2, unit.z - wide - 1);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#eaf0f5'; ctx.font = '15px system-ui'; ctx.fillText(`${fixture.elapsed.toFixed(2)} s   |   ${span.toFixed(0)} m view   |   20 ticks/s`, 16, 26);
  const m = metrics.get(u.id), goal = u.worldGoal ?? fixture.goals.get(u.id); let remaining = 0, from = u;
  for (const p of u.path) { remaining += Math.hypot(p.x - from.x, p.z - from.z); from = p; }
  const bad = movementBad(m);
  text('status', `${playing ? 'Running' : 'Paused'}: ${bad ? 'movement failure detected' : u.moveOutcome ?? (u.path.length ? 'travelling' : 'idle')}`); $('status').className = bad ? 'bad' : '';
  const values = [ ['Time', `${fixture.elapsed.toFixed(2)} s / ${fixture.scenario.seconds} s`], ['Speed', `${(u.moveSpeed ?? 0).toFixed(3)} m/s`], ['Heading', `${degrees(u.rot).toFixed(1)}°`], ['Position', `${u.x.toFixed(2)}, ${u.z.toFixed(2)} m`], ['Path remaining', `${remaining.toFixed(2)} m (${u.path.length} points)`], ['Goal distance', goal ? `${Math.hypot(u.x - goal.x, u.z - goal.z).toFixed(3)} m` : 'None'], ['Travelled', `${m.distance.toFixed(2)} m`], ['Still turning', `${degrees(m.stationaryTurn).toFixed(1)}°`], ['Largest still turn', `${degrees(m.maxStationaryTurn).toFixed(1)}°`], ['Largest order turn', `${degrees(m.maxOrderTurn).toFixed(1)}°`], ['Blocked hull ticks', m.hullViolations], ['Local maneuver', u.motionClearance ? 'Hull clearance' : u.traffic ? 'Yield / pass' : 'None'], ['Queued orders', u.orders?.length ?? 0], ['Route result', String(u.moveResult?.[0] ?? 'None')] ];
  $('metrics').replaceChildren(...values.flatMap(([name, value]) => { const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = name; dd.textContent = value; return [dt, dd]; }));
  $('events').replaceChildren(...fixture.events.map(e => { const li = document.createElement('li'); li.textContent = `${(e.tick * sim.TICK).toFixed(2)} s: ${e.label}`; if (e.tick * sim.TICK < fixture.elapsed) li.style.color = '#87e0af'; return li; }));
}
$('play').onclick = () => playing ? pause() : play(); $('step').onclick = () => { pause(); advanceTicks(1); };
$('reset').onclick = () => reset(); $('check').onclick = () => runCase(); $('stop').onclick = () => command('stop'); $('retreat').onclick = () => command('retreat'); $('trap').onclick = toggleTrap;
for (const id of ['scenario', 'type', 'heading']) $(id).onchange = () => reset();
$('unit').onchange = () => { selectedId = Number($('unit').value); draw(); }; $('zoom').onchange = draw;
function pointer(event) { const r = canvas.getBoundingClientRect(); return { x: view.x + (event.clientX - r.left) / r.width * canvas.width / view.scale, z: view.z + (event.clientY - r.top) / r.height * canvas.height / view.scale }; }
canvas.oncontextmenu = event => { event.preventDefault(); command('move', pointer(event)); };
canvas.onclick = event => { const p = pointer(event), candidates = [...fixture.g.units.values()].sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z)); if (candidates[0] && Math.hypot(candidates[0].x - p.x, candidates[0].z - p.z) < Math.max(3, sim.UNITS[candidates[0].type].radius)) { selectedId = candidates[0].id; $('unit').value = selectedId; draw(); } };
window.movementLab = { get state() { return { fixture, g: fixture.g, playing, selectedId, metrics, summary }; }, get fixture() { return fixture; }, get g() { return fixture.g; }, reset, advanceTicks, runCase, play, pause };
reset();
function frame(now) {
  if (playing) {
    accumulator += Math.min(0.1, (now - lastFrame) / 1000) * Number($('speed').value);
    const ticks = Math.floor(accumulator / sim.TICK);
    if (ticks) { accumulator -= ticks * sim.TICK; advanceTicks(ticks); }
    if (fixture.elapsed >= fixture.scenario.seconds) pause();
  }
  lastFrame = now; requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
