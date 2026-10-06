import * as sim from '/shared/sim.js';
import * as ai from '/shared/ai.js';
import * as perception from '/shared/ai-perception.js';
import * as hands from '/shared/ai-hands.js';
import * as view from '/shared/ai-view.js';
import { AI_LAB_SCENARIOS, createAIcase, defaultScene } from './ai-lab-runner.mjs';
const $ = id => document.getElementById(id), engine = { sim, ai, perception, hands, view };
let lab, draft, report, timer = null;
const options = () => ({ scenario: $('scenario').value, level: $('level').value, seed: Number($('seed').value) });
for (const scene of AI_LAB_SCENARIOS) $('scenario').add(new Option(scene.id, scene.id));
for (const type of sim.UNIT_TYPES.filter(type => !sim.UNITS[type].structure && sim.canBuild(type, 0))) $('type').add(new Option(type, type));
function pause() { if (timer) clearInterval(timer); timer = null; $('play').textContent = 'Run'; }
function guarded(fn) { try { return fn(); } catch (error) { pause(); if (report) for (const key of ['scenario', 'level', 'seed']) $(key).value = report.options[key]; $('status').textContent = error.message; console.error(error); } }
function syncEditor() {
  $('scene').value = JSON.stringify(draft, null, 2); const prior = $('unit').value; $('unit').replaceChildren();
  draft.units.forEach((unit, index) => $('unit').add(new Option(`#${lab.authorView().units[index]?.id}: owner ${unit.owner} ${unit.type}`, index)));
  $('unit').value = String(Math.min(Number(prior || 0), draft.units.length - 1)); selectUnit();
  for (const key of ['mp', 'fuel', 'mun']) $(key).value = draft.resources[0][key];
  $('cameraX').value = draft.camera.x; $('cameraZ').value = draft.camera.z; $('yaw').value = draft.camera.yaw;
}
function selectUnit() { $('cueUnit').value = lab.authorView().units[Number($('unit').value)]?.id ?? ''; const unit = draft.units[Number($('unit').value)]; if (!unit) return; for (const key of ['owner', 'type', 'x', 'z', 'hp', 'cooldown']) $(key).value = unit[key] ?? (key === 'hp' ? sim.UNITS[unit.type].models * sim.UNITS[unit.type].hpPer : 0); for (const key of ['holdPos', 'holdFire', 'autoRetreat']) $(key).checked = !!unit[key]; }
function reset(authored = draft) {
  authored = { ...defaultScene(options()), ...authored }; const next = createAIcase(engine, options(), authored);
  const previous = { lab, draft, report, max: $('history').max, tick: $('history').value, unit: $('unit').value };
  pause();
  try {
    lab = next; draft = structuredClone(authored); syncEditor(); report = lab.record(); $('history').max = 0; $('history').value = 0; render();
    $('status').textContent = 'Paused at tick 0. Authored edits reset all prior inputs and orders.';
  } catch (error) {
    ({ lab, draft, report } = previous); $('history').max = previous.max; $('history').value = previous.tick; $('unit').value = previous.unit;
    if (lab) { syncEditor(); render(); }
    throw error;
  }
}
function advance(ticks) { report = lab.advance(ticks); $('history').max = Math.max(0, report.frames.length - 1); $('history').value = $('history').max; render(); $('status').textContent = `Tick ${lab.tick} (${(lab.tick * sim.TICK).toFixed(2)} simulated seconds). ${report.inputs.length} completed inputs, ${report.commands.length} native orders. Session limit: 600 simulated seconds.`; if (lab.tick >= 12000) pause(); }
function render() {
  const frame = report.frames[Number($('history').value)], author = $('author').checked && (!report.frames.length || Number($('history').value) === report.frames.length - 1);
  const canvas = $('map'), ctx = canvas.getContext('2d'), scale = 720 / 192; ctx.clearRect(0, 0, 720, 720);
  const dots = frame?.minimap ?? []; ctx.fillStyle = '#95a6ab'; for (const dot of dots) { ctx.beginPath(); ctx.arc(dot.x * scale, dot.z * scale, 3, 0, Math.PI * 2); ctx.fill(); }
  const camera = frame?.camera ?? draft.camera, corners = frame?.corners ?? perception.cameraFootprint({ ...camera, distance: 60 });
  ctx.strokeStyle = '#70caff'; ctx.lineWidth = 2; ctx.beginPath(); corners.forEach((point, index) => ctx[index ? 'lineTo' : 'moveTo'](point.x * scale, point.z * scale)); ctx.closePath(); ctx.stroke();
  const units = author ? lab.authorView().units : frame?.units ?? [];
  for (const unit of units) { ctx.fillStyle = unit.owner === 0 ? '#8ee8af' : '#ff9b8a'; ctx.beginPath(); ctx.arc(unit.x * scale, unit.z * scale, 5, 0, Math.PI * 2); ctx.fill(); ctx.fillText(`${unit.type} #${unit.id}`, unit.x * scale + 7, unit.z * scale); }
  if (author) { ctx.fillStyle = '#ffe49b'; ctx.fillText(`AUTHOR DEBUG: actual world at tick ${lab.tick}`, 12, 20); }
  $('clock').textContent = `tick ${frame?.tick ?? 0}`;
  $('public').textContent = JSON.stringify(frame ? { camera: frame.camera, concern: frame.concern, active: frame.active, queued: frame.queued, selected: frame.selected, units: frame.units, selectedHUD: frame.selectedHUD } : { camera: draft.camera, notice: 'Advance one tick to deliver the first public view.' }, null, 2);
  const tick = frame?.tick ?? 0;
  const rows = [...report.events.map(row => ({ tick: row.tick, kind: 'public event', data: row })), ...report.inputStarts.map(row => ({ tick: row.tick, kind: 'input start', data: row })), ...report.inputs.map(row => ({ tick: row.tick, kind: 'input complete', data: row })), ...report.commands.map(row => ({ tick: row.tick, kind: row.accepted ? 'accepted order' : 'refused order', data: row }))].filter(row => Math.abs(row.tick - tick) <= 60).sort((a, b) => a.tick - b.tick);
  $('timeline').textContent = rows.map(row => `${row.tick}: ${row.kind}\n${JSON.stringify(row.data)}`).join('\n\n'); $('responses').textContent = JSON.stringify(report.responses, null, 2);
}
$('play').onclick = () => guarded(() => { if (timer) pause(); else { $('play').textContent = 'Pause'; timer = setInterval(() => guarded(() => advance(2)), 100); } });
$('step').onclick = () => guarded(() => advance(1));
for (const button of document.querySelectorAll('[data-seconds]')) button.onclick = () => guarded(() => { pause(); advance(Number(button.dataset.seconds) / sim.TICK); });
$('history').oninput = render; $('author').onchange = render; $('unit').onchange = selectUnit;
$('reset').onclick = () => guarded(() => reset(defaultScene(options())));
$('scenario').onchange = $('reset').onclick; $('level').onchange = () => guarded(() => reset()); $('seed').onchange = () => guarded(() => reset());
$('apply').onclick = () => guarded(() => reset(JSON.parse($('scene').value)));
$('saveUnit').onclick = () => guarded(() => { const next = structuredClone(draft), unit = next.units[Number($('unit').value)]; for (const key of ['owner', 'x', 'z', 'hp', 'cooldown']) unit[key] = Number($(key).value); unit.type = $('type').value; for (const key of ['holdPos', 'holdFire', 'autoRetreat']) unit[key] = $(key).checked; reset(next); });
$('add').onclick = () => guarded(() => { const next = structuredClone(draft); next.units.push({ owner: Number($('owner').value), type: $('type').value, x: 90, z: 90, holdFire: true }); reset(next); $('unit').value = String(draft.units.length - 1); selectUnit(); });
$('remove').onclick = () => guarded(() => { const next = structuredClone(draft); next.units.splice(Number($('unit').value), 1); reset(next); });
$('saveWorld').onclick = () => guarded(() => { const next = structuredClone(draft); next.resources[0] = Object.fromEntries(['mp', 'fuel', 'mun'].map(key => [key, Number($(key).value)])); next.camera = { x: Number($('cameraX').value), z: Number($('cameraZ').value), yaw: Number($('yaw').value) }; reset(next); });
for (const [id, kind] of [['hit', 'hit'], ['cue', 'hurt-cue']]) $(id).onclick = () => guarded(() => { const next = structuredClone(draft); next.cues.push({ kind, tick: Number($('cueTick').value), unitId: Number($('cueUnit').value), damage: Number($('damage').value) }); reset(next); });
$('map').onclick = event => guarded(() => { if (!$('author').checked) return; const rect = $('map').getBoundingClientRect(), next = structuredClone(draft), unit = next.units[Number($('unit').value)]; unit.x = Math.min(191, Math.max(1, (event.clientX - rect.left) / rect.width * 192)); unit.z = Math.min(191, Math.max(1, (event.clientY - rect.top) / rect.height * 192)); reset(next); });
$('export').onclick = () => { const blob = new Blob([JSON.stringify({ ...report, authoredScene: draft }, null, 2)], { type: 'application/json' }); const link = document.createElement('a'), url = URL.createObjectURL(blob); link.href = url; link.download = 'ai-lab-trace.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
window.aiLab = { advance: ticks => guarded(() => advance(ticks)), reset: scene => guarded(() => reset(scene)), record: () => structuredClone(report), authorView: () => lab.authorView() };
guarded(() => reset(defaultScene(options())));
