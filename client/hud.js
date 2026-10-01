// HUD panels over the battlefield: score and clock (top center), resources and the support calls (top right), the
// selection list and its orders (bottom left) and the Command Card (bottom center). main.js hands over its state and
// actions once (createHud) and calls update(s) on every snapshot.
//
// Each panel builds its HTML only when what it shows changes shape (the teams, the selection, the selected building)
// and otherwise only updates text, widths and disabled states: rebuilding the buttons 10 times a second ate clicks.

import { UNITS, UNIT_TYPES, CFG, SUPPORT, SUPPORT_TYPES, FORTS, BUILDABLE, canBuild, winVp, supCost, popCap, abCost, priceOf, AUTO_FLAG } from '/shared/sim.js';
import { symbolSVG, icon } from './symbols.js';
import { portrait } from './portraits.js';
import { unitRole } from './unit-roles.js';
import { SUPPORT_KEYS, FORT_KEYS, FORT_BADGES, BUILD_KEYS, CARD_KEYS, label } from './keys.js';
import { availability, buyCount, cooldownSeconds } from './availability.js';
import { setAvailability, installTooltips } from './feedback.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const setText = (el, t) => { if (el && el.textContent !== t) el.textContent = t; };
const setHTML = (el, h) => { if (el && el._html !== h) { el._html = h; el.innerHTML = h; } };
const show = (el, on) => el && el.classList.toggle('hidden', !on);
const clock = (t) => `${Math.floor(t / 60)}:${String(Math.max(0, t) % 60).padStart(2, '0')}`;

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
const GROUP_ICONS = ['rifle', 'mg', 'medium', 'fighter']; // a silhouette before each group's name
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

// The support calls and the orders draw from the same silhouette set as the units (client/symbols.js icon()).
export { icon };

// ---------- the HUD ----------

// ctx: state getters (me, teams, names, units, selected, PRIORITY) and helpers/actions from main.js:
// look, facOf, color, classic, send, blip, retreat, stop, amove, rally, dig, build, ability, support, fType, builders, owns, canPlace, select
export function createHud(ctx) {
  // the placement hint sits just above the Command Card, whose height changes (the Classic build card is taller
  // than the recruit row), so --card-h follows the card's real height
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => {
    const h = $('buy').offsetHeight;
    if (h) $('hud').style.setProperty('--card-h', h + 'px'); else $('hud').style.removeProperty('--card-h');
  }).observe($('buy'));
  let snapshot = null;
  const tooltips = installTooltips($('hud'));
  const check = (action) => availability(snapshot, CFG, { ...action, slot: ctx.me, ids: [...ctx.selected] });
  const attempt = (action, run) => { const result = check(action); if (result.ok) run(); else ctx.explain(result.reason); };
  // A card purchase, by click or by letter: the same command and refusal either way. `many` (Shift+letter) sends the
  // command up to five times, as often as the limits allow; the server takes each one like a separate click.
  const buy = (action, many = false) => attempt(action, () => {
    const n = many ? Math.max(1, buyCount(snapshot, CFG, { ...action, slot: ctx.me }, 5)) : 1;
    for (let i = 0; i < n; i++) ctx.send(action);
    ctx.blip('recruit');
  });
  const name = (t, slot = ctx.me) => ctx.look(slot).names[t] ?? UNITS[t].name;
  const pc = (i) => `var(--p${i}, ${ctx.color(i)})`;
  const selUnits = () => [...ctx.selected].map((id) => ctx.units.get(id)).filter(Boolean);
  const unitTip = (t, slot, extra = '') => {
    const n = name(t, slot), base = UNITS[t].name, r = unitRole(t, base), role = r !== base ? r : '';
    return `${n}${n !== base ? ` (${base})` : ''}${role ? `: ${role}` : ''}${extra}`;
  };
  // a Command Card card: name, portrait of the unit (client/portraits.js), cost (and a second line in Classic)
  // (its card letter, if any, is added once the card is laid out: lettered())
  const unitCard = (t, attr, cost, sub, tip) => `<button class="uc" ${attr} title="${esc(tip)}" aria-label="${esc(name(t))}">` +
    `<span class="nm">${soft(name(t))}</span>${portrait(t, ctx.me)}<span class="cost">${cost}</span>${sub ? `<span class="sub">${sub}</span>` : ''}</button>`;
  const groupsHTML = (types, card) => GROUPS.map((_, g) => {
    const ts = types.filter((t) => groupOf(t) === g).sort((a, b) => rank(a) - rank(b));
    return ts.length ? `<div class="grp"><div class="hd">${icon(GROUP_ICONS[g])}${GROUPS[g]}</div><div class="cards">${ts.map(card).join('')}</div></div>` : '';
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
      const k = b.dataset.k, cd = s.sup?.[k] ?? 0, { cur, cost } = supCost(s, k);
      setAvailability(b, check({ t: 'support', kind: k }));
      setText(b.lastElementChild, cd > 0 ? `${cooldownSeconds(cd)}s` : `${cost ?? '?'} ${cur === 'mun' ? 'Mun' : 'MP'}`);
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
      el.style.setProperty('--n', tids.length); el.style.setProperty('--lead', !lead ? '0px' : kind === 'assault' ? '216px' : '150px');
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
        score.lead.title = s.mode.suddenDeath ? 'No building or training. Bases crumble: last one standing wins' : 'Destroy every enemy HQ, Barracks, Motor Pool and Airfield';
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
        setText(tm.held[k], kind === 'conquest' ? (pts ? `${s.vp?.[i] ?? 0} pts, ${held(i)} held` : `${held(i)} held`) : kind === 'assault' ? '' : out ? 'Out' : `${held(i)} held`);
        tm.held[k].classList.toggle('danger', !!out);
      });
      let frac = null, u0 = '', num = '', u = '', role = '', danger = false;
      if (kind === 'conquest') {
        const vp = tm.mem.reduce((a, i) => a + (s.vp?.[i] ?? 0), 0), goal = winVp(teams);
        frac = vp / goal; num = `${vp} / ${goal}`; u = 'VP';
      } else if (kind === 'assault') {
        const def = tm.t === s.mode.defenderTeam, own = units.filter((v) => UNITS[v.type]?.structure && v.hp > 0 && teams[v.owner] === tm.t);
        role = def ? 'Defending' : 'Attacking';
        if (def) { const hp = own.reduce((a, v) => a + v.hp, 0), total = s.mode.total ?? tm.mem.length, max = total * UNITS.bunker.hpPer; frac = max ? hp / max : 0; u0 = 'Structures left'; num = `${own.length} / ${total}`; }
      } else if (kind === 'annihilation') {
        const own = units.filter((v) => v.type === 'bunker' && v.hp > 0 && teams[v.owner] === tm.t), hp = own.reduce((a, v) => a + v.hp, 0), max = (s.mode.bunkers?.[tm.t] ?? tm.mem.length) * UNITS.bunker.hpPer;
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
  let selKey = null, selRows = [];
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
    const el = $('selection'), byType = new Map();
    for (const v of sel) {
      if (!byType.has(v.type)) byType.set(v.type, []);
      byType.get(v.type).push(v);
    }
    const grouped = [...byType.entries()].sort(([a], [b]) => rank(a) - rank(b));
    const key = grouped.map(([t, us]) => `${t}:${us.length}`).join(',');
    if (key !== selKey) {
      selKey = key;
      el.innerHTML = '<div class="hd" style="display:flex;align-items:center;gap:6px"><span data-selected style="min-width:0;overflow:hidden;text-overflow:ellipsis;flex:1"></span>' +
        '<button data-idle style="margin-left:auto;padding:2px 6px;font-size:13px;line-height:1.1;flex:none" title="Find the next idle unit. Shift+click selects all idle units"></button></div>' +
        `<div class="list">${grouped.map(([t, us]) => `<div class="srow" data-type="${t}" style="cursor:pointer" title="${esc(unitTip(t, us[0].owner))}. Click to keep this type; Shift+click removes it">` +
        `${portrait(t, us[0].owner)}<span class="nm"></span><span class="ct"></span><span class="tg"><span class="hp"></span><span class="status" style="display:contents"></span></span>` +
        `${UNITS[t].building ? '<span class="q"></span>' : ''}</div>`).join('')}</div>`;
      el.querySelector('[data-idle]').onclick = (e) => { ctx.findIdle(e.shiftKey); e.currentTarget.blur(); };
      selRows = [...el.querySelectorAll('.srow')].map((r) => {
        r.onclick = (e) => ctx.selectType(r.dataset.type, e);
        return { type: r.dataset.type, nm: r.querySelector('.nm'), ct: r.querySelector('.ct'), hp: r.querySelector('.hp'), tags: r.querySelector('.status'), q: r.querySelector('.q') };
      });
    }
    const idle = ctx.idleCount(), chip = el.querySelector('[data-idle]');
    setText(chip, `Idle ${idle}`); show(chip, idle > 0);
    show(el, sel.length > 0 || idle > 0); show(el.querySelector('.list'), sel.length > 0);
    setText(el.querySelector('[data-selected]'), sel.length === 1 && UNITS[sel[0].type].building ? name(sel[0].type, sel[0].owner) : sel.length ? `${sel.length} unit${sel.length > 1 ? 's' : ''} selected` : 'Selection');
    if (!sel.length) return;
    for (const r of selRows) {
      const us = byType.get(r.type), v = us[0], def = UNITS[r.type];
      const hp = Math.ceil(us.reduce((sum, u) => sum + u.hp, 0)), max = us.length * def.hpPer * (def.models ?? 1);
      const tags = [...new Set(us.flatMap((u) => tagsOf(u).match(/<span\b[^>]*>.*?<\/span>/g) ?? []))];
      setText(r.nm, name(r.type, v.owner)); setText(r.ct, `×${us.length}`);
      setText(r.hp, `${hp}/${max} hp`); setHTML(r.tags, tags.join(''));
      if (r.q) {
        const training = us.filter((u) => u.queue?.length);
        setText(r.q, training.length === 1 ? `Training ${name(training[0].queue[0], training[0].owner)} ${Math.round((training[0].prog ?? 0) * 100)}% (${training[0].queue.length}/5)` : training.length ? `${training.length} buildings training` : '');
      }
    }
  }

  // ---------- bottom left: orders ----------
  let ordKey = '';
  function drawOrders(s, sel) {
    const el = $('abil'), bld = sel.length > 0 && sel.every((v) => UNITS[v.type].building);
    // Fort buttons whenever a squad that can build them is selected, including Engineers.
    const types = ctx.PRIORITY.filter((t) => sel.some((v) => v.type === t)), dig = sel.some((v) => CFG.fortBuilders.includes(v.type));
    const key = bld || !sel.length ? '' : `${types.join()}|${dig}`;
    if (key !== ordKey) {
      ordKey = key;
      el.innerHTML = !key ? '' : '<div class="hd">Orders</div><div class="grid">' +
        orderBtn('data-a="retreat"', 'retreat', label('retreat'), `Retreat (${label('retreat')}): run back to base, heal and reinforce there`) +
        orderBtn('data-a="amove"', 'amove', label('amove'), `Attack-move (${label('amove')}, or Ctrl+right-click): move and fight anything met on the way`) +
        orderBtn('data-a="stop"', 'stop', label('stop'), `Stop (${label('stop')}): halt where they are`) +
        (dig ? Object.entries(FORTS).map(([k, f]) => orderBtn(`data-a="fort:${k}"`, k, FORT_BADGES[k], `${f.name}${FORT_KEYS[k] ? ` (${FORT_KEYS[k]})` : ''}: ${FORT_TIP[k] ?? ''}. Click where; the nearest builder squad puts it across its approach`)).join('') : '') +
        types.map((t) => { const ab = UNITS[t].ab; return orderBtn(`data-a="${t}"`, ab.id === 'smoke' ? 'smokeab' : ab.id, '', `${ab.name}: ${name(t)}${AIMED.has(ab.id) ? ', click where' : ''}. ${ab.cd}s cooldown. Right-click: autocast on/off`, t); }).join('') +
        '</div>';
      el.querySelectorAll('button').forEach((b) => {
        const a = b.dataset.a;
        b.onclick = () => {
          if (a === 'retreat') ctx.retreat(); else if (a === 'amove') ctx.amove(); else if (a === 'stop') ctx.stop();
          else if (a.startsWith('fort:')) ctx.dig(a.slice(5)); else ctx.ability(a);
        };
        if (UNITS[a]) b.oncontextmenu = (e) => { e.preventDefault(); ctx.autocast(a); };
      });
    }
    if (!key) return;
    const fType = ctx.fType();
    for (const b of el.querySelectorAll('button[data-a]')) {
      const a = b.dataset.a, val = b.lastElementChild;
      let result = { ok: true, reason: '' }, txt = '';
      if (a.startsWith('fort:')) { const kind = a.slice(5), f = FORTS[kind]; result = check({ t: 'dig', kind }); txt = `${f.cost} MP`; }
      else if (UNITS[a]) {
        // same squads the reason sentence counts: retreating squads cannot use the ability
        const all = sel.filter((v) => v.type === a), us = all.some((v) => !(v.flags & 1)) ? all.filter((v) => !(v.flags & 1)) : all;
        const ready = us.filter((v) => !v.cd).length, cd = cooldownSeconds(Math.min(...us.map((v) => v.cd || 0)));
        const mun = abCost(s, UNITS[a].ab);
        result = check({ t: 'ability', unit: a }); txt = !ready ? `${cd}s` : mun ? `${mun} Mun` : '';
        setText(b.querySelector('kbd'), a === fType ? label('ability') : '');
        b.classList.toggle('auto', all.every((v) => v.flags & AUTO_FLAG)); // autocast on for every selected one
      }
      setAvailability(b, result);
      setText(val, txt);
    }
  }

  // ---------- bottom center: Command Card ----------
  // Outside Classic: every unit you can recruit, always shown. In Classic: what the selection can make (a building's
  // units and its queue, or the Engineers' buildings), rebuilt only when the selected building or builder changes.
  let cardKey = '';
  // The card letters: Q W E R T, A S D F G, Z X C V B over the cards in reading order (across the groups). Each card
  // keeps its purchase in b._buy so a letter and a click run the same code. Cards past the 15th stay click-only.
  const slots = () => [...$('buy').querySelectorAll('[data-unit], [data-train]')];
  function lettered() {
    slots().forEach((b, i) => { if (CARD_KEYS[i]) b.insertAdjacentHTML('beforeend', `<kbd class="key">${CARD_KEYS[i]}</kbd>`); });
  }
  function pressCard(n, many) {
    const b = slots()[n - 1];
    if (!b) return false;
    b.classList.add('hit'); setTimeout(() => b.classList.remove('hit'), 140);
    b._buy(many);
    return true;
  }
  // A letter on a card belongs to the card, so the support and order badges that show the same letter go quiet.
  function quietBadges() {
    const used = $('buy').classList.contains('lettered') ? CARD_KEYS.slice(0, slots().length) : [];
    for (const k of document.querySelectorAll('#support kbd, #abil kbd')) k.classList.toggle('quiet', used.includes(k.textContent));
  }
  // Recruit mode (outside Classic): the letters show on the cards and the header tab reads "Recruiting".
  let recruiting = false;
  function setRecruit(on) {
    recruiting = !!on && !ctx.classic();
    const card = $('buy'), tab = card.querySelector('[data-recruit]');
    card.classList.toggle('lettered', recruiting);
    quietBadges();
    if (tab) {
      tab.setAttribute('aria-pressed', String(recruiting));
      tab.innerHTML = recruiting ? `Recruiting <kbd>${label('recruitOff')}</kbd>` : `Recruit <kbd>${label('recruitMode')}</kbd>`;
      tab.title = recruiting ? `Letters buy the cards; Shift+letter buys five. ${label('recruitMode')}, ${label('recruitOff')} or a right-click stops`
        : `Recruit by letter (${label('recruitMode')}): each card gets a key, Shift+key buys five. WASD pans again when you stop`;
    }
  }
  addEventListener('mousedown', (e) => { if (e.button === 2 && recruiting) setRecruit(false); }, { capture: true });
  function buildCard() {
    cardKey = '';
    const card = $('buy');
    card.classList.remove('lettered');
    recruiting = false;
    if (ctx.classic()) { card.innerHTML = ''; card.classList.add('hidden'); return; }
    card.classList.remove('hidden');
    const types = UNIT_TYPES.filter((t) => canBuild(t, ctx.facOf(ctx.me)) && !UNITS[t].classic);
    card.innerHTML = groupsHTML(types, (t) => unitCard(t, `data-unit="${t}"`, `${UNITS[t].cost}<span class="cu"> MP</span>`, '', unitTip(t, ctx.me, `. ${UNITS[t].cost} MP`)));
    // the stylesheet shares the room between the cards (14 since aviation); narrow cards drop the name and keep it in the tooltip
    card.classList.add('fit'); card.style.setProperty('--nc', types.length); card.style.setProperty('--ng', card.querySelectorAll('.grp').length);
    card.querySelectorAll('[data-unit]').forEach((b) => { b._buy = (many) => buy({ t: 'buy', unit: b.dataset.unit }, many); b.onclick = () => b._buy(false); });
    lettered();
    const tab = document.createElement('button');
    tab.dataset.recruit = ''; tab.className = 'tab';
    tab.onclick = (e) => { setRecruit(!recruiting); e.currentTarget.blur(); };
    card.append(tab); setRecruit(false);
  }
  function drawRecruit(s, pop, cap) {
    const card = $('buy');
    if (!card.querySelector('[data-rally]')) {
      const b = document.createElement('button');
      b.dataset.rally = ''; b.title = `Rally (${label('rally')}): choose where new recruits gather`;
      b.innerHTML = `Rally <kbd>${label('rally')}</kbd>`;
      Object.assign(b.style, { position: 'absolute', right: '8px', bottom: 'calc(100% + 6px)', padding: '4px 8px', font: '13px var(--type)', background: 'var(--strip)' });
      b.onclick = () => ctx.rally(); card.append(b);
    }
    for (const b of $('buy').querySelectorAll('[data-unit]')) {
      const broke = s.mp < UNITS[b.dataset.unit].cost;
      setAvailability(b, check({ t: 'buy', unit: b.dataset.unit }));
      b.classList.toggle('broke', broke);
    }
  }
  function drawClassicCard(s, pop, cap, sel) {
    const card = $('buy');
    const bld = sel.length === 1 && UNITS[sel[0].type].building && sel[0].owner === ctx.me ? sel[0] : null, eng = !bld && sel.some((v) => v.owner === ctx.me && v.type === 'engineer');
    const key = bld ? `b${bld.id}:${bld.built >= 1}` : eng ? 'e' : '';
    if (key !== cardKey) {
      cardKey = key;
      card.classList.toggle('hidden', !key);
      const info = (t, status, hint) => `<div class="cinfo"><div class="ci-t">${symbolSVG(t)}<b>${esc(UNITS[t].name)}</b></div><div class="ci-s">${status}</div><div class="ci-h">${hint}</div></div>`;
      if (bld && bld.built < 1) card.innerHTML = info(bld.type, 'Under construction <span data-built></span>', 'Right-click it with Engineers to help') +
        '<button class="cancel" data-cancel title="Cancel the building and get 75% of its cost back">Cancel<span>75% back</span></button>';
      else if (bld) card.innerHTML = info(bld.type, '<span data-queue></span>', 'Right-click the ground: rally point') +
        groupsHTML((UNITS[bld.type].makes ?? []).filter((t) => canBuild(t, ctx.facOf(ctx.me))), (t) => {
          const pr = priceOf(s, t), fuel = pr.fuel ? `${pr.fuel} Fuel, ` : '';
          return unitCard(t, `data-train="${t}"`, `${pr.mp} MP`, `${fuel}${UNITS[t].train}s`, unitTip(t, ctx.me, `. ${pr.mp} MP${pr.fuel ? ` + ${pr.fuel} Fuel` : ''}, trains in ${UNITS[t].train}s`));
        });
      else if (eng) card.innerHTML = '<div class="grp"><div class="hd">Build</div><div class="cards">' + BUILDABLE.map((k) =>
        `<button class="uc wide" data-build="${k}" title="${esc(`${UNITS[k].name}${BUILD_KEYS[k] ? ` (${BUILD_KEYS[k]})` : ''}: ${BUILD_ROLE[k] ?? ''}. ${UNITS[k].cost} MP, ${UNITS[k].buildTime}s`)}">` +
        `<span class="nm">${esc(UNITS[k].name)} <kbd>${BUILD_KEYS[k] ?? ''}</kbd></span>${portrait(k, ctx.me)}<span class="cost">${UNITS[k].cost} MP, ${UNITS[k].buildTime}s</span>` +
        `<span class="sub" data-note></span></button>`).join('') + '</div></div>';
      else card.innerHTML = '';
      const id = bld?.id;
      card.querySelectorAll('[data-train]').forEach((b) => { b._buy = (many) => buy({ t: 'buy', unit: b.dataset.train, from: id }, many); b.onclick = () => b._buy(false); });
      // a selected production building answers to the card letters without recruit mode
      lettered(); card.classList.toggle('lettered', !!card.querySelector('[data-train]'));
      card.querySelectorAll('[data-cancel]').forEach((b) => (b.onclick = () => { ctx.send({ t: 'cancel', id }); ctx.selected.clear(); ctx.blip(300); }));
      card.querySelectorAll('[data-build]').forEach((b) => (b.onclick = () => ctx.build(b.dataset.build)));
    }
    if (bld && bld.built < 1) setText(card.querySelector('[data-built]'), `${Math.round(bld.built * 100)}%`);
    if (bld && bld.built >= 1) {
      const q = bld.queue ?? [], nm = (t) => name(t);
      setText(card.querySelector('[data-queue]'), q.length ? `Training ${nm(q[0])} ${Math.round((bld.prog ?? 0) * 100)}%` + (q.length > 1 ? `, then ${q.slice(1).map(nm).join(', ')}` : '') : 'Idle');
      for (const b of card.querySelectorAll('[data-train]')) {
        const pr = priceOf(s, b.dataset.train), broke = s.mp < pr.mp || (s.fuel ?? 0) < pr.fuel;
        setAvailability(b, check({ t: 'buy', unit: b.dataset.train, from: bld.id }));
        b.classList.toggle('broke', broke);
      }
    }
    if (eng) for (const b of card.querySelectorAll('[data-build]')) {
      const k = b.dataset.build, need = UNITS[k].needs && !ctx.owns(UNITS[k].needs);
      const result = check({ t: 'build', kind: k });
      setAvailability(b, result);
      b.classList.toggle('broke', !(s.mp >= UNITS[k].cost));
      const note = b.querySelector('[data-note]');
      setText(note, result.ok ? BUILD_ROLE[k] ?? '' : result.reason);
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
    snapshot = s;
    const me = ctx.me, all = [...ctx.units.values()];
    const pop = all.filter((v) => v.owner === me && !UNITS[v.type].structure).length + all.reduce((a, v) => a + (v.owner === me && v.queue ? v.queue.length : 0), 0);
    const cap = popCap(s), sel = selUnits();
    drawScores(s);
    drawEcon(s, pop, cap);
    if (s.mode?.kind === 'classic') drawClassicCard(s, pop, cap, sel); else drawRecruit(s, pop, cap);
    drawSelection(sel);
    drawOrders(s, sel);
    drawAir(s);
    quietBadges();
    tooltips.update();
  }

  return { buildSupport, buildCard, update, pressCard, setRecruit, recruiting: () => recruiting,
    lettered: () => ctx.classic() && !!$('buy').querySelector('[data-train]'), hasCard: (n) => !!slots()[n - 1] };
}
