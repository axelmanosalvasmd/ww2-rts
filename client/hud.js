// HUD panels over the battlefield: score and clock (top center), resources and the support calls (top right), the
// selection list and its orders (bottom left) and the Command Card (bottom center). main.js hands over its state and
// actions once (createHud) and calls update(s) on every snapshot.
//
// Each panel builds its HTML only when what it shows changes shape (the teams, the selection, the selected building)
// and otherwise only updates text, widths and disabled states: rebuilding the buttons 10 times a second ate clicks.

import { UNITS, UNIT_TYPES, CFG, SUPPORT, SUPPORT_TYPES, FORTS, BUILDABLE, canBuild, winVp, supCost, popCap, abCost, priceOf } from '/shared/sim.js';
import { symbolSVG } from './symbols.js';
import { unitRole } from './unit-roles.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const setText = (el, t) => { if (el && el.textContent !== t) el.textContent = t; };
const setHTML = (el, h) => { if (el && el._html !== h) { el._html = h; el.innerHTML = h; } };
const show = (el, on) => el && el.classList.toggle('hidden', !on);
const clock = (t) => `${Math.floor(t / 60)}:${String(Math.max(0, t) % 60).padStart(2, '0')}`;

// hotkeys (main.js binds the keys; these only label the buttons)
const SUPPORT_KEYS = { recon: 'Z', artillery: 'C', strafe: 'V', smoke: 'B', bombing: 'N', dive: 'U', para: 'P', cover: 'I' };
// only T digs by key: Y, U, I and O went to the air calls and air buildings, which main.js checks first
const FORT_KEYS = { trench: 'T' };
const BUILD_KEYS = { depot: 'J', barracks: 'K', motorpool: 'L', airfield: 'O', flakpos: 'Y' };
const SUPPORT_TIP = { recon: 'Reveals a wide area for 15s', artillery: '10 shells on an area after a 5s warning', strafe: 'Plane rakes a line from your HQ outward',
  smoke: 'Smoke screen over an area for 20s: blocks sight both ways', bombing: 'A stick of heavy bombs along the line: flattens houses, kills tanks',
  dive: 'One heavy bomb, right on the spot: tanks, guns, houses', para: 'Drops a rifle squad where your side can see (counts toward pop)',
  cover: 'Fighters intercept the next enemy air strike over the area for 60s (not recon)' };
const FORT_TIP = { trench: 'Heavy cover for infantry', sandbags: 'Cover for infantry', wire: 'Slows infantry; tanks flatten it', traps: 'Stops vehicles; cover for infantry',
  nest: 'A trench pit behind a horseshoe of sandbags' };
const BUILD_ROLE = { depot: 'On a resource node: +1.5 MP/s', barracks: 'Trains MGs and elite infantry', motorpool: 'Trains AT guns, tanks, rockets',
  airfield: 'Trains planes; their base', flakpos: 'Shoots down planes over your base' };
const AIR_STATE = ['Ready', 'Flying out', 'On station', 'Heading home', 'Rearming'];
const AIMED = new Set(['grenade', 'barrage', 'satchel']); // abilities that need a spot clicked

// Command Card groups, and the order of the cards inside them (types not listed go last, in table order)
const GROUPS = ['Infantry', 'Support weapons', 'Vehicles', 'Aircraft'];
const SUPPORT_WEAPONS = new Set(['mg', 'mortar', 'at', 'flak']);
const ORDER = ['rifle', 'conscript', 'ranger', 'sniper', 'engineer', 'mg', 'mortar', 'at', 'flak', 'armoredcar', 'flaktrack', 'tank', 'medium', 'tiger', 'rocket', 'fighter', 'attacker'];
const groupOf = (t) => (UNITS[t].air ? 3 : SUPPORT_WEAPONS.has(t) ? 1 : UNITS[t].infantry ? 0 : 2);
const rank = (t) => { const i = ORDER.indexOf(t); return i < 0 ? ORDER.length + UNIT_TYPES.indexOf(t) : i; };
// long one-word names get a soft hyphen so they break cleanly on a narrow card
const BREAKS = { 'Scharfschützen': 'Scharf­schützen', 'Panzerwerfer': 'Panzer­werfer' };
const soft = (n) => esc(n).split(' ').map((w) => BREAKS[w] ?? w).join(' ');

// ---------- icons ----------

// a five-pointed star as path data, centered on (cx, cy)
const star = (cx, cy, R, r) => 'M' + Array.from({ length: 10 }, (_, k) => {
  const a = -Math.PI / 2 + (k * Math.PI) / 5, d = k % 2 ? r : R;
  return `${(cx + Math.cos(a) * d).toFixed(2)} ${(cy + Math.sin(a) * d).toFixed(2)}`;
}).join('L') + 'Z';
// faction markings next to player names: US star, German cross, Soviet star
const MARKS = [
  `<circle cx="12" cy="12" r="10.5" fill="#24427a" stroke="#e6dcc0" stroke-width="1.2"/><path d="${star(12, 12.6, 8.2, 3.3)}" fill="#f3efe2"/>`,
  `<path d="M8.5 1.5h7v7h7v7h-7v7h-7v-7h-7v-7h7z" fill="#f3efe2"/><path d="M10.3 3.3h3.4v7h7v3.4h-7v7h-3.4v-7h-7v-3.4h7z" fill="#151512"/>`,
  `<path d="${star(12, 12.8, 11, 4.4)}" fill="#c4302b" stroke="#f0dca6" stroke-width="1" stroke-linejoin="round"/>`,
];
const FACTION_NAME = ['USA', 'Germany', 'USSR'];
const mark = (f) => (MARKS[f] ? `<svg class="mark" viewBox="0 0 24 24" role="img"><title>${FACTION_NAME[f]}</title>${MARKS[f]}</svg>` : '');

// Line icons for the support calls and the orders, in a 32 box, drawn with the current text color.
const ICON = {
  recon: '<circle cx="9.5" cy="20.5" r="5.5"/><circle cx="22.5" cy="20.5" r="5.5"/><path d="M14.5 20h3M5.5 16 8.5 7.5h4.5L14 15M26.5 16 23.5 7.5H19L18 15"/>',
  artillery: '<path d="M4 27C7 9 20 6 25 19"/><path d="M20.6 17.4 25 19.6l1.6-4.6"/><path d="M25 24v5M22.5 26.5h5"/>',
  strafe: '<path d="M16 12v17M5 19.5l11-3 11 3M11.5 28h9"/><path d="M10 3v5M16 2v6M22 3v5"/>',
  smoke: '<path d="M9 25h15a5 5 0 0 0 .6-10A7.5 7.5 0 0 0 10.4 13 6 6 0 0 0 9 25z"/><path d="M6 9.5a3 3 0 0 1 5-2"/>',
  bombing: '<path d="M16 9c3.4 0 5.4 4 5.4 9s-2 10-5.4 10-5.4-5-5.4-10 2-9 5.4-9z"/><path d="M12.5 3h7l-1.6 6h-3.8z"/>',
  dive: '<path d="M4 4l11 11M9.5 15H15V9.5"/><path d="M22 14c2.6 0 4.2 3.2 4.2 7s-1.6 7.5-4.2 7.5-4.2-3.7-4.2-7.5 1.6-7 4.2-7z"/>',
  para: '<path d="M4 14a12 10 0 0 1 24 0z"/><path d="M4 14l12 10 12-10M16 14v10"/><circle cx="16" cy="27" r="2"/>',
  cover: '<path d="M16 3l11 4v8c0 7-5 11.5-11 14C10 26.5 5 22 5 15V7z"/><path d="M16 10v11M10 15.5l6-1.5 6 1.5M13 20h6"/>',
  retreat: '<path d="M24 27V14a7 7 0 0 0-14 0v6"/><path d="M5.5 15.5 10 21l4.5-5.5"/>',
  amove: '<circle cx="21" cy="11" r="6"/><path d="M21 2.5v4M21 15.5v4M12.5 11h4M25.5 11h4"/><path d="M4 28l12.5-12.5"/>',
  stop: '<path d="M11 4h10l7 7v10l-7 7H11l-7-7V11z"/><path d="M11 16h10"/>',
  trench: '<path d="M3 12h6v8h7v-8h7v8h6"/>',
  sandbags: '<rect x="3.5" y="19" width="12" height="7" rx="3.5"/><rect x="16.5" y="19" width="12" height="7" rx="3.5"/><rect x="10" y="11" width="12" height="7" rx="3.5"/>',
  wire: '<path d="M2 21h28"/><circle cx="8" cy="15.5" r="4.5"/><circle cx="16" cy="15.5" r="4.5"/><circle cx="24" cy="15.5" r="4.5"/>',
  traps: '<path d="M6 27 22 5M10 5l16 22M4 17.5h24"/>',
  nest: '<path d="M4.5 26a11.5 11.5 0 0 1 23 0"/><path d="M16 22V8"/><circle cx="16" cy="22.5" r="2.2"/>',
  grenade: '<ellipse cx="15" cy="19.5" rx="7" ry="8.5"/><path d="M12 11V7.5h6V11M18 8.5l6-3.5M15 15v9M11 19.5h8"/>',
  suppress: '<path d="M3 16h7M13 10l13-5M13 16h16M13 22l13 5"/>',
  ap: '<path d="M10 27V14l6-10 6 10v13z"/><path d="M10 21h12"/>',
  barrage: '<path d="M6 3v13M16 3v13M26 3v13"/><path d="M3 13.5 6 18l3-4.5M13 13.5l3 4.5 3-4.5M23 13.5l3 4.5 3-4.5"/><path d="M3 27h26"/>',
  satchel: '<rect x="6" y="13" width="20" height="14" rx="2"/><path d="M11 13V9.5a5 5 0 0 1 10 0V13M16 18v4"/>',
  ura: '<path d="M5 7l9 9-9 9M16 7l9 9-9 9"/>',
  menu: '<path d="M6 9h20M6 16h20M6 23h20"/>',
  fullscreen: '<path d="M5 12V5h7M20 5h7v7M27 20v7h-7M12 27H5v-7"/>',
  unknown: '<circle cx="16" cy="16" r="8"/><path d="M16 3v6M16 23v6M3 16h6M23 16h6"/>',
};
ICON.smokeab = ICON.smoke;
export const icon = (k) => `<svg class="ico" viewBox="0 0 32 32" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${ICON[k] ?? ICON.unknown}</svg>`;

// ---------- the HUD ----------

// ctx: state getters (me, teams, names, units, selected, PRIORITY) and helpers/actions from main.js:
// look, facOf, color, classic, send, blip, retreat, stop, amove, rally, dig, build, ability, support, fType, builders, owns, canPlace, select
export function createHud(ctx) {
  const name = (t, slot = ctx.me) => ctx.look(slot).names[t] ?? UNITS[t].name;
  const pc = (i) => `var(--p${i}, ${ctx.color(i)})`;
  const selUnits = () => [...ctx.selected].map((id) => ctx.units.get(id)).filter(Boolean);
  const unitTip = (t, slot, extra = '') => {
    const n = name(t, slot), base = UNITS[t].name, r = unitRole(t, base), role = r !== base ? r : '';
    return `${n}${n !== base ? ` (${base})` : ''}${role ? `: ${role}` : ''}${extra}`;
  };
  // a manila Command Card card: name, map symbol, cost chip (and a second line in Classic)
  const unitCard = (t, attr, cost, sub, tip) => `<button class="uc" ${attr} title="${esc(tip)}" aria-label="${esc(name(t))}">` +
    `<span class="nm">${soft(name(t))}</span>${symbolSVG(t)}<span class="cost">${cost}</span>${sub ? `<span class="sub">${sub}</span>` : ''}</button>`;
  const groupsHTML = (types, card) => GROUPS.map((_, g) => {
    const ts = types.filter((t) => groupOf(t) === g).sort((a, b) => rank(a) - rank(b));
    return ts.length ? `<div class="grp"><div class="hd">${GROUPS[g]}</div><div class="cards">${ts.map(card).join('')}</div></div>` : '';
  }).join('');
  // an order or support button: icon, hotkey badge, cost or cooldown underneath
  const orderBtn = (data, ico, key, tip, sym) => `<button class="ob" ${data} title="${esc(tip)}" aria-label="${esc(tip.split(/[:(]/)[0].trim())}">` +
    (sym ? `<span class="usym">${symbolSVG(sym)}</span>` : '') + icon(ico) + `<kbd>${key ?? ''}</kbd><span class="val"></span></button>`;

  // ---------- top right: support calls ----------
  function buildSupport() {
    const el = $('support');
    el.innerHTML = SUPPORT_TYPES.map((k) => orderBtn(`data-k="${k}"`, k, SUPPORT_KEYS[k],
      `${SUPPORT[k].name}${SUPPORT_KEYS[k] ? ` (${SUPPORT_KEYS[k]})` : ''}: ${SUPPORT_TIP[k] ?? 'Off-map support'}. ${SUPPORT[k].point ? 'Click the spot to call it in' : 'Aim: click the center, move to turn, click to call it in'}`)).join('');
    el.querySelectorAll('button').forEach((b) => (b.onclick = () => ctx.support(b.dataset.k)));
  }
  function drawEcon(s, pop, cap) {
    setText($('mp'), String(s.mp));
    const classic = s.mun !== undefined;
    show($('munRes'), classic); show($('fuelRes'), classic);
    if (classic) { setText($('mun'), String(s.mun)); setText($('fuel'), String(s.fuel ?? 0)); }
    setText($('incRate'), `+${s.inc}/s${s.upkeep ? ` (upkeep −${s.upkeep})` : ''}`);
    setText($('popCount'), `${pop}/${cap} units`);
    $('popCount').classList.toggle('danger', pop >= cap);
    for (const b of $('support').children) {
      const k = b.dataset.k, cd = s.sup?.[k] ?? 0, { cur, cost } = supCost(s, k), off = cd > 0 || !(s[cur] >= cost);
      if (b.disabled !== off) b.disabled = off;
      setText(b.lastElementChild, cd > 0 ? `${cd}s` : `${cost ?? '?'} ${cur === 'mun' ? 'Mun' : 'MP'}`);
    }
  }

  // ---------- top center: score and clock ----------
  let scoreKey = '', score = null;
  function drawScores(s) {
    const kind = s.mode?.kind ?? 'conquest', teams = ctx.teams, names = ctx.names, el = $('scores');
    const tids = [...new Set(teams)], members = (t) => names.map((_, i) => i).filter((i) => teams[i] === t);
    const key = [kind, ctx.me, teams.join(), names.join('\u0001')].join('|');
    if (key !== scoreKey) {
      scoreKey = key;
      const lead = kind === 'conquest' ? '' : '<div class="sc-lead"><div class="sc-mode"></div><div class="num sc-clock"></div></div>';
      el.innerHTML = lead + tids.map((t) => {
        const mem = members(t);
        return `<div class="sc-team">${mem.map((i) => `<div class="sc-p"><span class="swatch" style="background:${pc(i)}"></span>${mark(ctx.facOf(i))}` +
          `<span class="sc-name">${esc(names[i])}</span>${i === ctx.me ? '<span class="you">you</span>' : ''}</div>` +
          `<div class="sc-sub"><span class="sc-held"></span><span class="sc-net"></span></div>`).join('')}` +
          `<div class="sc-role"></div><div class="bar"><div style="background:${pc(mem[0])}"></div></div>` +
          `<div class="sc-val"><span class="u0"></span><span class="num"></span><span class="u"></span></div></div>`;
      }).join('');
      // the stylesheet sizes each team block from the team count (and the clock block, if any)
      el.style.setProperty('--n', tids.length); el.style.setProperty('--lead', lead ? '150px' : '0px');
      score = { lead: el.querySelector('.sc-lead'), teams: [...el.querySelectorAll('.sc-team')].map((b, k) => ({
        t: tids[k], mem: members(tids[k]), role: b.querySelector('.sc-role'), bar: b.querySelector('.bar'), fill: b.querySelector('.bar > div'),
        u0: b.querySelector('.u0'), num: b.querySelector('.sc-val .num'), u: b.querySelector('.sc-val .u'),
        held: [...b.querySelectorAll('.sc-held')], net: [...b.querySelectorAll('.sc-net')],
      })) };
    }
    const held = (slot) => s.points.filter((p) => p[0] === slot).length;
    const mine = teams[ctx.me] ?? ctx.me, units = [...ctx.units.values()];
    const net = (i) => (s.online?.[i] === false ? ['danger', 'Offline'] : s.ping?.[i] === -1 ? ['', 'AI'] : s.ping?.[i] != null ? ['', `${s.ping[i]} ms`] : ['', '']);
    if (score.lead) {
      const mode = score.lead.firstChild, clk = score.lead.lastChild;
      if (kind === 'assault') {
        setText(mode, mine === s.mode.defenderTeam ? 'Assault: hold out' : 'Assault: take the bunker'); setText(clk, clock(s.mode.timeLeft));
        score.lead.title = mine === s.mode.defenderTeam ? 'Hold out until the clock runs out' : 'Destroy the command bunker before the clock runs out';
      } else if (kind === 'classic') {
        setText(mode, s.mode.suddenDeath ? 'Sudden death' : 'Sudden death in'); setText(clk, s.mode.suddenDeath ? '' : clock(s.mode.timeLeft));
        mode.classList.toggle('danger', !!s.mode.suddenDeath);
        score.lead.title = s.mode.suddenDeath ? 'No building or training. Bases crumble: last one standing wins' : 'Destroy every enemy HQ, Barracks and Motor Pool';
      } else {
        setText(mode, 'Annihilation'); setText(clk, ''); score.lead.title = 'Destroy every enemy bunker. Last side standing wins';
      }
      show(clk, !!clk.textContent);
    }
    for (const tm of score.teams) {
      // a lone player's points repeat the team VP below, so narrow blocks (four or more teams) drop them
      const pts = tm.mem.length > 1 || score.teams.length <= 3;
      tm.mem.forEach((i, k) => {
        const [cls, txt] = net(i);
        setText(tm.net[k], txt); tm.net[k].classList.toggle('danger', !!cls);
        const why = cls && kind === 'conquest' ? 'Offline: the clock is paused until they return' : '';
        if (tm.net[k].title !== why) tm.net[k].title = why;
        const out = kind === 'classic' && s.out?.[i];
        setText(tm.held[k], kind === 'conquest' ? (pts ? `${s.vp?.[i] ?? 0} pts · ${held(i)} held` : `${held(i)} held`) : kind === 'assault' ? '' : out ? 'Out' : `${held(i)} held`);
        tm.held[k].classList.toggle('danger', !!out);
      });
      let frac = null, u0 = '', num = '', u = '', role = '', danger = false;
      if (kind === 'conquest') {
        const vp = tm.mem.reduce((a, i) => a + (s.vp?.[i] ?? 0), 0), goal = winVp(teams);
        frac = vp / goal; num = `${vp} / ${goal}`; u = 'VP';
      } else if (kind === 'assault') {
        const def = tm.t === s.mode.defenderTeam, own = units.filter((v) => v.type === 'bunker' && teams[v.owner] === tm.t);
        role = def ? 'Defending' : 'Attacking';
        if (def) { const hp = own.reduce((a, v) => a + v.hp, 0), max = own.length * UNITS.bunker.hpPer; frac = max ? hp / max : 0; u0 = 'Bunker'; num = `${Math.ceil(hp)} / ${max}`; }
      } else if (kind === 'annihilation') {
        const own = units.filter((v) => v.type === 'bunker' && teams[v.owner] === tm.t), hp = own.reduce((a, v) => a + v.hp, 0), max = tm.mem.length * UNITS.bunker.hpPer;
        if (own.length) { frac = hp / max; u0 = own.length > 1 ? `${own.length} bunkers` : 'Bunker'; num = `${Math.ceil(hp)} / ${max}`; } else { u0 = 'Out'; danger = true; }
      } else if (kind === 'classic') {
        const own = units.filter((v) => v.type === 'hq' && teams[v.owner] === tm.t), hp = own.reduce((a, v) => a + v.hp, 0), max = own.length * UNITS.hq.hpPer;
        if (!own.length && tm.mem.some((i) => !s.out?.[i])) u0 = 'HQ out of sight';
        else if (own.length) { frac = hp / max; u0 = 'HQ'; num = `${Math.ceil(hp)} / ${max}`; } else { u0 = 'Out'; danger = true; }
      }
      setText(tm.role, role); show(tm.role, !!role);
      show(tm.bar, frac !== null);
      if (frac !== null) { const w = `${Math.max(0, Math.min(100, frac * 100)).toFixed(1)}%`; if (tm.fill.style.width !== w) tm.fill.style.width = w; }
      setText(tm.u0, u0); setText(tm.num, num); setText(tm.u, u); tm.u0.classList.toggle('danger', danger);
    }
  }

  // ---------- bottom left: selection list ----------
  let selKey = '', selRows = [];
  const tagsOf = (v) => {
    const t = [];
    if (v.flags & 256) t.push(['cov', 'Hidden']);
    if (v.flags & 1) t.push(['', 'Retreating']);
    if (v.flags & 8) t.push(['cov', 'Reinforcing']);
    if (v.flags & 2) t.push(['sup', 'Suppressive fire']);
    if (v.flags & 4) t.push(['pin', 'AP round loaded']);
    if (v.supp >= 90) t.push(['pin', 'Pinned']); else if (v.supp >= 50) t.push(['sup', 'Suppressed']);
    if (!v.garr) { if (v.cover === 2) t.push(['cov', 'In trench']); else if (v.cover === 3) t.push(['cov', 'By cover']); else if (v.cover) t.push(['cov', 'In cover']); }
    if (v.flags & 16) t.push(['', 'Digging']);
    if (v.flags & 32) t.push(['cov', 'Garrisoned']);
    if (v.flags & 64) t.push(['', 'Attack-move']);
    if (UNITS[v.type].building && v.built < 1) t.push(['', `Building ${Math.round(v.built * 100)}%`]);
    return t.map(([c, s]) => `<span class="tag ${c}">${s}</span>`).join('') + (v.vet ? `<span class="vet" title="Veteran: ${v.vet} star${v.vet > 1 ? 's' : ''}">${'★'.repeat(v.vet)}</span>` : '');
  };
  function drawSelection(sel) {
    const el = $('selection'), key = sel.map((v) => v.id).join(',');
    if (key !== selKey) {
      selKey = key;
      el.innerHTML = sel.length ? `<div class="hd"></div><div class="list">${sel.map((v) => `<div class="srow" title="${esc(unitTip(v.type, v.owner))}">` +
        `${symbolSVG(v.type)}<span class="nm">${esc(name(v.type, v.owner))}</span><span class="ct"></span><span class="tg"></span>` +
        `${UNITS[v.type].building ? '<span class="q"></span>' : ''}</div>`).join('')}</div>` : '';
      selRows = [...el.querySelectorAll('.srow')].map((r, k) => ({ id: sel[k].id, ct: r.querySelector('.ct'), tg: r.querySelector('.tg'), q: r.querySelector('.q') }));
    }
    if (!sel.length) return;
    setText(el.firstChild, sel.length === 1 && UNITS[sel[0].type].building ? name(sel[0].type, sel[0].owner) : `${sel.length} unit${sel.length > 1 ? 's' : ''} selected`);
    for (const r of selRows) {
      const v = ctx.units.get(r.id); if (!v) continue;
      const def = UNITS[v.type];
      setText(r.ct, def.building || !def.infantry ? `${Math.ceil(v.hp)} hp` : `${Math.ceil(v.hp / def.hpPer)}/${def.models}`);
      setHTML(r.tg, tagsOf(v));
      if (r.q) setText(r.q, v.queue?.length ? `Training ${name(v.queue[0], v.owner)} ${Math.round((v.prog ?? 0) * 100)}% (${v.queue.length}/5)` : '');
    }
  }

  // ---------- bottom left: orders ----------
  let ordKey = '';
  function drawOrders(s, sel) {
    const el = $('abil'), bld = sel.some((v) => UNITS[v.type].building);
    // fort buttons whenever a squad that can build them is selected (Engineers too, as the T-O keys allow)
    const types = ctx.PRIORITY.filter((t) => sel.some((v) => v.type === t)), dig = sel.some((v) => CFG.fortBuilders.includes(v.type));
    const key = bld || !sel.length ? '' : `${types.join()}|${dig}`;
    if (key !== ordKey) {
      ordKey = key;
      el.innerHTML = !key ? '' : '<div class="hd">Orders</div><div class="grid">' +
        orderBtn('data-a="retreat"', 'retreat', 'R', 'Retreat (R): run back to base, heal and reinforce there') +
        orderBtn('data-a="amove"', 'amove', 'G', 'Attack-move (G, or Ctrl+right-click): move and fight anything met on the way') +
        orderBtn('data-a="stop"', 'stop', 'X', 'Stop (X): halt where they are') +
        (dig ? Object.entries(FORTS).map(([k, f]) => orderBtn(`data-a="fort:${k}"`, k, FORT_KEYS[k], `${f.name}${FORT_KEYS[k] ? ` (${FORT_KEYS[k]})` : ''}: ${FORT_TIP[k] ?? ''}. Click where; the nearest builder squad puts it across its approach`)).join('') : '') +
        types.map((t) => { const ab = UNITS[t].ab; return orderBtn(`data-a="${t}"`, ab.id === 'smoke' ? 'smokeab' : ab.id, '', `${ab.name}: ${name(t)}${AIMED.has(ab.id) ? ', click where' : ''}. ${ab.cd}s cooldown`, t); }).join('') +
        '</div>';
      el.querySelectorAll('button').forEach((b) => (b.onclick = () => {
        const a = b.dataset.a;
        if (a === 'retreat') ctx.retreat(); else if (a === 'amove') ctx.amove(); else if (a === 'stop') ctx.stop();
        else if (a.startsWith('fort:')) ctx.dig(a.slice(5)); else ctx.ability(a);
      }));
    }
    if (!key) return;
    const fType = ctx.fType();
    for (const b of el.querySelectorAll('button[data-a]')) {
      const a = b.dataset.a, val = b.lastElementChild;
      let off = false, txt = '';
      if (a.startsWith('fort:')) { const f = FORTS[a.slice(5)]; off = !(s.mp >= f.cost); txt = `${f.cost} MP`; }
      else if (UNITS[a]) {
        const us = sel.filter((v) => v.type === a), ready = us.filter((v) => !v.cd).length, cd = Math.min(...us.map((v) => v.cd || 0));
        const mun = abCost(s, UNITS[a].ab), broke = mun && !(s.mun >= mun);
        off = !ready || !!broke; txt = !ready ? `${cd}s` : mun ? `${mun} Mun` : '';
        setText(b.querySelector('kbd'), a === fType ? 'F' : '');
      }
      if (b.disabled !== off) b.disabled = off;
      setText(val, txt);
    }
  }

  // ---------- bottom center: Command Card ----------
  // Outside Classic: every unit you can recruit, always shown. In Classic: what the selection can make (a building's
  // units and its queue, or the Engineers' buildings), rebuilt only when the selected building or builder changes.
  let cardKey = '';
  function buildCard() {
    cardKey = '';
    const card = $('buy');
    if (ctx.classic()) { card.innerHTML = ''; card.classList.add('hidden'); return; }
    card.classList.remove('hidden');
    const types = UNIT_TYPES.filter((t) => canBuild(t, ctx.facOf(ctx.me)) && !UNITS[t].classic);
    card.innerHTML = groupsHTML(types, (t) => unitCard(t, `data-unit="${t}"`, `${UNITS[t].cost}<span class="cu"> MP</span>`, '', unitTip(t, ctx.me, `. ${UNITS[t].cost} MP`)));
    // the stylesheet shares the room between the cards (14 since aviation); narrow cards drop the name and keep it in the tooltip
    card.classList.add('fit'); card.style.setProperty('--nc', types.length); card.style.setProperty('--ng', card.querySelectorAll('.grp').length);
    card.querySelectorAll('[data-unit]').forEach((b) => (b.onclick = () => { ctx.send({ t: 'buy', unit: b.dataset.unit }); ctx.blip(520); }));
  }
  function drawRecruit(s, pop, cap) {
    const card = $('buy');
    if (!card.querySelector('[data-rally]')) {
      const b = document.createElement('button');
      b.dataset.rally = ''; b.title = 'Rally (Shift+H): choose where new recruits gather';
      b.innerHTML = 'Rally <kbd>Shift+H</kbd>';
      Object.assign(b.style, { position: 'absolute', right: '8px', bottom: 'calc(100% + 6px)', padding: '4px 8px', font: '13px var(--type)', background: 'var(--strip)' });
      b.onclick = () => ctx.rally(); card.append(b);
    }
    for (const b of $('buy').querySelectorAll('[data-unit]')) {
      const broke = s.mp < UNITS[b.dataset.unit].cost, off = broke || pop >= cap;
      if (b.disabled !== off) b.disabled = off;
      b.classList.toggle('broke', broke);
    }
  }
  function drawClassicCard(s, pop, cap, sel) {
    const card = $('buy');
    const bld = sel.length === 1 && UNITS[sel[0].type].building && sel[0].owner === ctx.me ? sel[0] : null, eng = !bld && ctx.builders().length > 0;
    const key = bld ? `b${bld.id}:${bld.built >= 1}` : eng ? 'e' : '';
    if (key !== cardKey) {
      cardKey = key;
      card.classList.toggle('hidden', !key);
      const info = (t, status, hint) => `<div class="cinfo"><div class="ci-t">${symbolSVG(t)}<b>${esc(UNITS[t].name)}</b></div><div class="ci-s">${status}</div><div class="ci-h">${hint}</div></div>`;
      if (bld && bld.built < 1) card.innerHTML = info(bld.type, 'Under construction <span data-built></span>', 'Right-click it with Engineers to help') +
        '<button class="cancel" data-cancel title="Cancel the building and get 75% of its cost back">Cancel<span>75% back</span></button>';
      else if (bld) card.innerHTML = info(bld.type, '<span data-queue></span>', 'Right-click the ground: rally point') +
        groupsHTML((UNITS[bld.type].makes ?? []).filter((t) => canBuild(t, ctx.facOf(ctx.me))), (t) => {
          const pr = priceOf(s, t), fuel = pr.fuel ? `${pr.fuel} Fuel · ` : '';
          return unitCard(t, `data-train="${t}"`, `${pr.mp} MP`, `${fuel}${UNITS[t].train}s`, unitTip(t, ctx.me, `. ${pr.mp} MP${pr.fuel ? ` + ${pr.fuel} Fuel` : ''}, trains in ${UNITS[t].train}s`));
        });
      else if (eng) card.innerHTML = '<div class="grp"><div class="hd">Build</div><div class="cards">' + BUILDABLE.map((k) =>
        `<button class="uc wide" data-build="${k}" title="${esc(`${UNITS[k].name}${BUILD_KEYS[k] ? ` (${BUILD_KEYS[k]})` : ''}: ${BUILD_ROLE[k] ?? ''}. ${UNITS[k].cost} MP, ${UNITS[k].buildTime}s`)}">` +
        `<span class="nm">${esc(UNITS[k].name)} <kbd>${BUILD_KEYS[k] ?? ''}</kbd></span>${symbolSVG(k)}<span class="cost">${UNITS[k].cost} MP · ${UNITS[k].buildTime}s</span>` +
        `<span class="sub" data-note></span></button>`).join('') + '</div></div>';
      else card.innerHTML = '';
      const id = bld?.id;
      card.querySelectorAll('[data-train]').forEach((b) => (b.onclick = () => { ctx.send({ t: 'buy', unit: b.dataset.train, from: id }); ctx.blip(520); }));
      card.querySelectorAll('[data-cancel]').forEach((b) => (b.onclick = () => { ctx.send({ t: 'cancel', id }); ctx.selected.clear(); ctx.blip(300); }));
      card.querySelectorAll('[data-build]').forEach((b) => (b.onclick = () => ctx.build(b.dataset.build)));
    }
    if (bld && bld.built < 1) setText(card.querySelector('[data-built]'), `${Math.round(bld.built * 100)}%`);
    if (bld && bld.built >= 1) {
      const q = bld.queue ?? [], nm = (t) => name(t);
      setText(card.querySelector('[data-queue]'), q.length ? `Training ${nm(q[0])} ${Math.round((bld.prog ?? 0) * 100)}%` + (q.length > 1 ? `, then ${q.slice(1).map(nm).join(', ')}` : '') : 'Idle');
      for (const b of card.querySelectorAll('[data-train]')) {
        const pr = priceOf(s, b.dataset.train), broke = s.mp < pr.mp || (s.fuel ?? 0) < pr.fuel, off = broke || pop >= cap || q.length >= 5;
        if (b.disabled !== off) b.disabled = off;
        b.classList.toggle('broke', broke);
      }
    }
    if (eng) for (const b of card.querySelectorAll('[data-build]')) {
      const k = b.dataset.build, need = UNITS[k].needs && !ctx.owns(UNITS[k].needs), off = !ctx.canPlace(k);
      if (b.disabled !== off) b.disabled = off;
      b.classList.toggle('broke', !(s.mp >= UNITS[k].cost));
      const note = b.querySelector('[data-note]');
      setText(note, need ? `Needs a ${UNITS[UNITS[k].needs].name}` : BUILD_ROLE[k] ?? '');
      note.classList.toggle('danger', !!need);
    }
  }

  // ---------- top right, under the support calls: your planes and what each is doing ----------
  // rebuilt only when the planes change; a click selects that plane
  let airKey = '';
  function drawAir(s) {
    const el = $('airPanel'); if (!el) return;
    const air = (s.air ?? []).filter(([id]) => ctx.units.has(id)), key = air.map(([id]) => id).join();
    if (key !== airKey) {
      airKey = key;
      el.innerHTML = air.map(([id]) => `<button data-plane="${id}"><span class="nm">${esc(name(ctx.units.get(id).type))}</span><span class="st"></span></button>`).join('');
      el.querySelectorAll('[data-plane]').forEach((b) => (b.onclick = () => ctx.select(+b.dataset.plane)));
    }
    air.forEach(([id, st, fuel, , timer], k) => {
      const b = el.children[k];
      b.classList.toggle('on', ctx.selected.has(id));
      setText(b.lastElementChild, `${AIR_STATE[st] ?? ''}${st === 2 ? ` ${fuel}s` : st === 4 ? ` ${timer}s` : ''}`);
    });
  }

  function update(s) {
    const me = ctx.me, all = [...ctx.units.values()];
    const pop = all.filter((v) => v.owner === me && !UNITS[v.type].structure).length + all.reduce((a, v) => a + (v.owner === me && v.queue ? v.queue.length : 0), 0);
    const cap = popCap(s), sel = selUnits();
    drawScores(s);
    drawEcon(s, pop, cap);
    if (s.mode?.kind === 'classic') drawClassicCard(s, pop, cap, sel); else drawRecruit(s, pop, cap);
    drawSelection(sel);
    drawOrders(s, sel);
    drawAir(s);
  }

  return { buildSupport, buildCard, update };
}
