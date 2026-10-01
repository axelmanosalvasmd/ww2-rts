// The match report on the lobby card after a match played to the end: a chart of the race (victory points in Conquest,
// points held in the other modes) with a text legend, and a table of what each player did (shared/story.js counts it on
// the server). main.js calls renderReport(result, el, colors) from renderLobby; the one-line result above it stays.
// A match the host ended (no story) hides the report.
const PALETTE = ['#3b73d6', '#cc3a2e', '#ece6d6', '#e2832b', '#9b5cd4', '#35b6c0']; // player colors by slot
const COLUMNS = [['kills', 'Kills'], ['losses', 'Losses'], ['built', 'Built'], ['captures', 'Captures'],
  ['mpSpent', 'Manpower spent'], ['supportCalls', 'Support calls'], ['planesDowned', 'Planes downed']];
const DECIDED = { vp: 'on victory points', bunkers: 'when the last bunker fell', structures: 'when the last defending structure fell',
  timer: 'when the clock ran out', hq: 'when the last Production Building fell', draw: 'in a draw' };
const STRIP = '#15181a', LIGHT = '#e2dfd3', FONT = "500 13px 'Barlow Semi Condensed', 'Arial Narrow', sans-serif";

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const clock = (secs) => { const m = Math.floor(secs / 60), s = Math.round(secs % 60); return m ? `${m} min${s ? ` ${s} s` : ''}` : `${s} s`; };
let styled = false;

function style() {
  if (styled) return;
  styled = true;
  const st = document.createElement('style');
  st.textContent = `
    .rp { color: var(--text); }
    .rp > summary { cursor: pointer; font: 600 17px/1.2 var(--type); }
    .rp .rp-sub { margin-left: 8px; font: 500 14px/1.3 var(--type); color: var(--dim); }
    .rp-top { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); gap: 14px; align-items: start; margin: 8px 0 10px; }
    .rp canvas { display: block; width: 100%; height: 132px; background: ${STRIP}; border: 1px solid var(--line-soft); border-radius: 2px; }
    .rp-legend { margin: 0; padding: 0; list-style: none; display: grid; gap: 5px; font-size: 14px; line-height: 1.25; }
    .rp-legend li { display: flex; gap: 8px; align-items: baseline; }
    .rp-sw { flex: none; display: inline-block; width: 12px; height: 12px; border-radius: 2px; box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.45); transform: translateY(1px); }
    .rp table { width: 100%; border-collapse: collapse; font-size: 14px; line-height: 1.2; }
    .rp th { padding: 4px 6px; text-align: right; vertical-align: bottom; font-weight: 600; color: var(--dim); border-bottom: 1px solid var(--line-soft); }
    .rp td { padding: 4px 6px; text-align: right; font-variant-numeric: tabular-nums; }
    .rp tbody tr + tr td { border-top: 1px solid rgba(176, 164, 122, 0.12); }
    .rp th:first-child, .rp td:first-child { text-align: left; }
    .rp-name { display: inline-flex; gap: 8px; align-items: baseline; max-width: 190px; white-space: nowrap; }
    .rp-name span:last-child { overflow: hidden; text-overflow: ellipsis; }
    .rp tr.me td { background: rgba(214, 178, 94, 0.08); font-weight: 600; }`;
  document.head.append(st);
}

// the sides that played: team id, its players' slots, its color (its first player's) and a name for it
function sides(r, colors) {
  const ids = [...new Set(r.teams)].sort((a, b) => a - b);
  return ids.map(team => {
    const slots = r.teams.map((t, i) => (t === team ? i : -1)).filter(i => i >= 0);
    return { team, slots, color: colors[slots[0]] ?? '#888', name: slots.map(i => r.names[i] ?? `Player ${i + 1}`).join(' & ') };
  });
}

// the race: one line per side over the 10 s samples
function draw(cv, r, list) {
  const w = Math.max(240, cv.clientWidth), h = cv.clientHeight || 132, dpr = Math.min(2, devicePixelRatio || 1);
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  const c = cv.getContext('2d'), tl = r.timeline, vp = r.mode === 'conquest';
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.fillStyle = STRIP; c.fillRect(0, 0, w, h);
  const val = (s, team) => (vp ? s.vp : s.points)?.[team] ?? 0;
  const top = vp ? Math.max(r.winVp || 0, ...tl.flatMap(s => s.vp ?? [])) : Math.max(1, ...tl.flatMap(s => s.points ?? []));
  const end = Math.max(1, tl.at(-1)?.t ?? 1);
  c.font = FONT;
  const L = Math.ceil(c.measureText(String(top)).width) + 12, R = 10, T = 10, B = 22, pw = w - L - R, ph = h - T - B;
  const X = (t) => L + (t / end) * pw, Y = (v) => T + ph - (v / top) * ph;
  // frame and labels
  c.strokeStyle = 'rgba(226, 223, 211, 0.14)'; c.lineWidth = 1;
  for (const v of [0, top / 2, top]) { c.beginPath(); c.moveTo(L, Math.round(Y(v)) + 0.5); c.lineTo(L + pw, Math.round(Y(v)) + 0.5); c.stroke(); }
  c.fillStyle = LIGHT; c.textBaseline = 'middle'; c.textAlign = 'right';
  c.fillText('0', L - 6, Y(0)); c.fillText(String(top), L - 6, Y(top) + 2);
  c.textBaseline = 'alphabetic'; c.textAlign = 'left'; c.fillText('0 min', L, h - 6);
  c.textAlign = 'right'; c.fillText(clock(end), L + pw, h - 6);
  // the sides, the winners drawn last (on top)
  const order = [...list].sort((a, b) => (a.team === r.winner) - (b.team === r.winner));
  c.lineJoin = 'round'; c.lineCap = 'round';
  for (const s of order) {
    c.strokeStyle = s.color; c.lineWidth = s.team === r.winner ? 3 : 2;
    c.beginPath();
    tl.forEach((p, i) => (i ? c.lineTo(X(p.t), Y(val(p, s.team))) : c.moveTo(X(p.t), Y(val(p, s.team)))));
    c.stroke();
  }
}

// r: the lobby's result. colors: the player colors by slot. me: this player's slot (their row is marked when they played).
export function renderReport(r, el, { colors = PALETTE, me = -1 } = {}) {
  if (!el) return;
  const has = !!(r && r.story && r.timeline?.length);
  el.classList.toggle('hidden', !has);
  if (!has) { el.innerHTML = ''; el.dataset.key = el.dataset.tick = ''; return; }
  const key = JSON.stringify([r.endTick, r.names, r.you, colors, me]);
  if (el.dataset.key === key) return; // the lobby re-renders often; keep the card (and whether it is open) as it is
  el.dataset.key = key;
  // a new report: show the lobby card from its top (it keeps its scroll from the Play button otherwise)
  if (el.dataset.tick !== String(r.endTick)) { el.dataset.tick = String(r.endTick); el.closest('.card')?.scrollTo(0, 0); }
  style();
  const list = sides(r, colors), last = r.timeline.at(-1), vp = r.mode === 'conquest', what = vp ? 'Victory points' : 'Points held';
  const final = (team) => (vp ? `${last.vp?.[team] ?? 0} victory points` : `${last.points?.[team] ?? 0} points held`);
  const legend = list.map(s => `<li><span class="rp-sw" style="background:${s.color}"></span><span>${esc(s.name)}: ${final(s.team)}${s.team === r.winner ? ' (won)' : ''}</span></li>`).join('');
  const rows = r.names.map((name, i) => `<tr class="${r.you && i === me ? 'me' : ''}"><td><span class="rp-name" title="${esc(name)}"><span class="rp-sw" style="background:${colors[i] ?? '#888'}"></span><span>${esc(name)}</span></span></td>${
    COLUMNS.map(([k]) => `<td>${r.story[i]?.[k] ?? 0}</td>`).join('')}</tr>`).join('');
  el.innerHTML = `<details class="rp" open>
    <summary>Match report<span class="rp-sub">${r.horde ? `overrun on wave ${r.horde.wave}` : `decided ${DECIDED[r.reason] ?? ''}`} after ${clock((r.endTick ?? 0) / 20)}</span></summary>
    <div class="rp-top">
      <canvas role="img" aria-label="${what} over time for each side"></canvas>
      <div><div class="muted" style="margin-bottom:4px">${what} over time</div><ul class="rp-legend">${legend}</ul></div>
    </div>
    <table><thead><tr><th>Player</th>${COLUMNS.map(([, label]) => `<th>${label}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>
  </details>`;
  const cv = el.querySelector('canvas'), redraw = () => cv.isConnected && draw(cv, r, list);
  redraw();
  document.fonts?.ready.then(redraw);
}
