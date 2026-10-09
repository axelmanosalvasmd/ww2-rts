// The stats overlay: performance and network numbers from client/perf.js in a small box over the HUD, and the sheet
// (Menu > Stats overlay, F2 shows or hides) where the player picks which numbers, where the box sits, its layout,
// size and background, and whether bad numbers turn amber and red. Saved per browser; '?perf' in the URL shows every
// number for that visit without changing what is saved.
import { perf } from './perf.js';
import { t as tr } from './i18n.js';

const KEY = 'ww2-stats';
const k = (n) => (n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n));
const ms = (n) => (n == null ? 'n/a' : `${n} ms`);
// amber at the first number, red at the second; low marks numbers where less is worse
const band = (v, amber, red, low = false) => (v == null ? 0 : low ? (v < red ? 2 : v < amber ? 1 : 0) : v > red ? 2 : v > amber ? 1 : 0);

// tag: the short name in the box. warn(s) returns 0 fine, 1 amber, 2 red.
const STATS = [
  { group: 'Performance', id: 'fps', tag: 'FPS', label: 'Frame rate', show: (s) => String(s.fps), warn: (s) => band(s.fps, 50, 30, true) },
  { group: 'Performance', id: 'frame', tag: 'Frame', label: 'Frame time', hint: 'Average over the last second', show: (s) => ms(s.ms), warn: (s) => band(s.ms, 20, 33) },
  { group: 'Performance', id: 'worst', tag: 'Worst', label: 'Worst frame', hint: 'Longest in the last second: hitches', show: (s) => ms(s.worst), warn: (s) => band(s.worst, 33, 66) },
  { group: 'Performance', id: 'cpu', tag: 'JS', label: 'Script time', hint: 'Game code per frame', show: (s) => ms(s.cpu), warn: (s) => band(s.cpu, 12, 20) },
  { group: 'Performance', id: 'calls', tag: 'Draws', label: 'Draw calls', show: (s) => String(s.calls) },
  { group: 'Performance', id: 'tris', tag: 'Tris', label: 'Triangles', show: (s) => k(s.tris) },
  { group: 'Performance', id: 'scale', tag: 'Res', label: 'Render scale and graphics', show: (s) => `${s.scale}x ${s.gfx}` },
  { group: 'Performance', id: 'mem', tag: 'Mem', label: 'Memory', hint: 'Chrome and Edge only', show: (s) => (s.mem == null ? 'n/a' : `${s.mem} MB`) },
  { group: 'Network', id: 'ping', tag: 'Ping', label: 'Ping', hint: 'Round trip to the server', show: (s) => ms(s.ping), warn: (s) => band(s.ping, 80, 150) },
  { group: 'Network', id: 'jitter', tag: 'Jitter', label: 'Jitter', hint: 'How much the ping swings', show: (s) => ms(s.jitter), warn: (s) => band(s.jitter, 15, 40) },
  { group: 'Network', id: 'loss', tag: 'Loss', label: 'Loss', hint: 'Pings unanswered after 3 s, last minute', show: (s) => (s.loss == null ? 'n/a' : `${s.loss}%`), warn: (s) => band(s.loss, 0, 5) },
  { group: 'Network', id: 'snaps', tag: 'Upd', label: 'Updates per second', hint: 'Game state messages received', show: (s) => `${s.snaps}/s`, warn: (s) => band(s.snaps, 7, 4, true) },
  { group: 'Network', id: 'gap', tag: 'Gap', label: 'Longest update gap', hint: 'Longest wait in the last second: stalls', show: (s) => ms(s.gap), warn: (s) => band(s.gap, 200, 400) },
  { group: 'Network', id: 'size', tag: 'Size', label: 'Update size', show: (s) => `${(s.bytes / 1000).toFixed(1)} kB` },
  { group: 'Network', id: 'kbs', tag: 'Down', label: 'Download rate', show: (s) => `${s.kbs} kB/s` },
  { group: 'Network', id: 'server', tag: 'Server', label: 'Server tick', hint: 'Slowest 5% of ticks that send an update; over 40 ms it sends fewer', show: (s) => (s.srvTick == null ? 'n/a' : `${s.srvTick} ms`), warn: (s) => band(s.srvTick, 25, 40) },
  { group: 'Game', id: 'units', tag: 'Units', label: 'Units', show: (s) => String(s.units) },
  { group: 'Game', id: 'fx', tag: 'FX', label: 'Effect particles', show: (s) => k(s.fx) },
  { group: 'Game', id: 'corpses', tag: 'Bodies', label: 'Bodies', show: (s) => String(s.corpses) },
];
const IDS = STATS.map((d) => d.id);
const PRESETS = {
  Basic: ['fps', 'ping', 'loss'],
  Performance: ['fps', 'frame', 'worst', 'cpu', 'calls', 'tris', 'mem'],
  Network: ['ping', 'jitter', 'loss', 'snaps', 'gap', 'kbs', 'server'],
  Everything: IDS,
};
const CHOICES = {
  pos: { tl: 'Top left', tc: 'Top center', tr: 'Top right' },
  layout: { list: 'List', line: 'One line' },
  size: { s: 'Small', m: 'Medium', l: 'Large' },
  bg: { panel: 'Panel', clear: 'See-through', none: 'None' },
};
const DEFAULTS = { show: false, stats: PRESETS.Basic, pos: 'tl', layout: 'list', size: 'm', bg: 'panel', warn: true };

function load(storage) {
  let saved = null;
  try { saved = JSON.parse(storage?.getItem(KEY) ?? 'null'); } catch {}
  const s = { ...DEFAULTS };
  if (!saved || typeof saved !== 'object') return s;
  if (typeof saved.show === 'boolean') s.show = saved.show;
  if (typeof saved.warn === 'boolean') s.warn = saved.warn;
  if (Array.isArray(saved.stats)) s.stats = IDS.filter((id) => saved.stats.includes(id));
  for (const key of Object.keys(CHOICES)) if (saved[key] in CHOICES[key]) s[key] = saved[key];
  return s;
}

// box: the overlay element (inside the HUD), sheet: the <dialog>, menuButton opens it from the match menu.
// under: the HUD panel each position sits below; clear: the score strip, which a wide box drops below.
// beforeOpen runs before the sheet opens (drop any drag or aim in progress).
export function createStats({ box, sheet, menuButton, under, clear, storage, beforeOpen = () => {} }) {
  const settings = load(storage);
  const forced = new URLSearchParams(location.search).has('perf');
  if (forced) Object.assign(settings, { show: true, stats: IDS });
  const save = () => { if (!forced) try { storage?.setItem(KEY, JSON.stringify(settings)); } catch {} };
  let rows = [];

  function build() {
    const on = STATS.filter((d) => settings.stats.includes(d.id));
    box.className = `pos-${settings.pos} layout-${settings.layout} size-${settings.size} bg-${settings.bg}`;
    box.classList.toggle('hidden', !settings.show);
    box.replaceChildren();
    rows = on.map((d) => {
      const row = document.createElement('div'), tag = document.createElement('span'), val = document.createElement('span');
      row.className = 'stat'; tag.className = 'stat-name'; val.className = 'stat-val';
      tag.textContent = d.tag;
      row.append(tag, val); box.append(row);
      return { d, val };
    });
    if (!rows.length) box.textContent = 'No stats picked. Menu > Stats overlay';
    render(window.__perf);
  }
  function render(s) {
    if (!settings.show || !s) return;
    for (const { d, val } of rows) {
      const text = tr(d.show(s)), level = settings.warn && d.warn ? d.warn(s) : 0;
      if (val.textContent !== text) val.textContent = text;
      val.dataset.warn = level ? (level === 2 ? 'red' : 'amber') : '';
    }
    place();
  }
  // below the panel the position belongs to (those grow and shrink during a match). A one-line box wraps before the
  // menu buttons and the resources at its sides, and a box that would run into the score strip goes below it.
  function place() {
    const W = innerWidth, util = under.tl?.()?.getBoundingClientRect(), econ = under.tr?.()?.getBoundingClientRect();
    const z = document.getElementById('hud')?.currentCSSZoom || 1; // the UI scale zooms the HUD: screen pixels in, HUD pixels out
    if (settings.layout === 'line') {
      const left = util ? util.right : 0, right = econ ? econ.left : W, room = { tl: right, tr: W - left, tc: 2 * Math.min(W / 2 - left, right - W / 2) };
      box.style.maxWidth = Math.max(160, (room[settings.pos] - 16) / z) + 'px';
    } else box.style.maxWidth = '';
    const panel = under[settings.pos]?.(), strip = clear?.()?.getBoundingClientRect();
    let top = panel ? panel.getBoundingClientRect().bottom + 6 * z : 52 * z;
    box.style.top = Math.round(top / z) + 'px';
    const r = box.getBoundingClientRect();
    if (strip && settings.pos !== 'tc' && r.left < strip.right && r.right > strip.left && r.top < strip.bottom) top = strip.bottom + 6 * z;
    box.style.top = Math.round(top / z) + 'px';
  }
  perf.onUpdate(render);
  addEventListener('resize', place);

  // the sheet: the stat checkboxes come from STATS, the rest is in index.html
  const $ = (sel) => sheet.querySelector(sel);
  const groups = [...new Set(STATS.map((d) => d.group))];
  $('.stat-picks').innerHTML = groups.map((g) => `<fieldset><legend>${g}</legend>${STATS.filter((d) => d.group === g).map((d) =>
    `<label${d.hint ? ` title="${d.hint}"` : ''}><input type="checkbox" value="${d.id}"><span>${d.label}</span>${d.hint ? `<small>${d.hint}</small>` : ''}</label>`).join('')}</fieldset>`).join('');
  $('.stat-presets').innerHTML = Object.keys(PRESETS).map((name) => `<button type="button" data-preset="${name}">${name}</button>`).join('');
  for (const [key, opts] of Object.entries(CHOICES)) $(`select[name="${key}"]`).innerHTML = Object.entries(opts).map(([v, t]) => `<option value="${v}">${t}</option>`).join('');

  function sync() {
    $('input[name="show"]').checked = settings.show;
    $('input[name="warn"]').checked = settings.warn;
    for (const key of Object.keys(CHOICES)) $(`select[name="${key}"]`).value = settings[key];
    sheet.querySelectorAll('.stat-picks input').forEach((c) => { c.checked = settings.stats.includes(c.value); });
    menuButton.textContent = `Stats overlay: ${settings.show ? 'On' : 'Off'}`;
  }
  const changed = () => { save(); sync(); build(); };
  $('input[name="show"]').onchange = (e) => { settings.show = e.target.checked; changed(); };
  $('input[name="warn"]').onchange = (e) => { settings.warn = e.target.checked; changed(); };
  for (const key of Object.keys(CHOICES)) $(`select[name="${key}"]`).onchange = (e) => { settings[key] = e.target.value; changed(); };
  $('.stat-picks').onchange = () => {
    const picked = [...sheet.querySelectorAll('.stat-picks input:checked')].map((c) => c.value);
    settings.stats = IDS.filter((id) => picked.includes(id));
    if (settings.stats.length) settings.show = true; // picking a number means you want to see it
    changed();
  };
  $('.stat-presets').onclick = (e) => {
    const name = e.target.closest('[data-preset]')?.dataset.preset;
    if (!name) return;
    settings.stats = [...PRESETS[name]]; settings.show = true; changed();
  };
  $('.stat-close').onclick = () => sheet.close();
  // a click on the dimmed backdrop (the dialog's own box, outside the sheet) closes it
  sheet.addEventListener('click', (e) => { if (e.target === sheet) sheet.close(); });

  sync(); build();
  return {
    open() { if (sheet.open) return; beforeOpen(); sync(); sheet.showModal(); },
    isOpen: () => sheet.open,
    toggle() { settings.show = !settings.show; changed(); },
  };
}
