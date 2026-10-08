// HUD panels over the battlefield: score and clock (top center), resources and the support calls (top right), the
// selection list and its orders (bottom left) and the Command Card (bottom center). main.js hands over its state and
// actions once (createHud) and calls update(s) on every snapshot.
//
// Each panel builds its HTML only when what it shows changes shape (the teams, the selection, the selected building)
// and otherwise only updates text, widths and disabled states: rebuilding the buttons 10 times a second ate clicks.

import { UNITS, UNIT_TYPES, CFG, SUPPORT, SUPPORT_TYPES, FORTS, lineFort, ENTRENCH, ENTRENCH_TYPES, BUILDABLE, buildKinds, isSkirmishBaseMode, canBuild, winVp, supCost, popCap, popUse, abCost, priceOf, AUTO_FLAG, RIDING_FLAG, CARGO_FLAG } from '/shared/sim.js';
import { symbolSVG, icon } from './symbols.js';
import { portrait } from './portraits.js';
import { unitRole } from './unit-roles.js';
import { SHAPES } from '/shared/formation.js';
import { SUPPORT_KEYS, FORT_KEYS, FORT_BADGES, BUILD_KEYS, CARD_KEYS, label, badge } from './keys.js';
import { availability, buyCount, cooldownSeconds, recruitAction } from './availability.js';
import { setAvailability, installTooltips } from './feedback.js';
import { TECH, TIER_NAMES, techCost } from '/shared/tech.js';
import { t as tr } from './i18n.js';
import { reserveLabels, truckLabels, storeLabels, storeForUnit, logisticsIndicator } from './logistics.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const setText = (el, t) => { t = tr(t); if (el && el.textContent !== t) el.textContent = t; }; // tr: compare in the shown language
const setHTML = (el, h) => { if (el && el._html !== h) { el._html = h; el.innerHTML = h; } };
const show = (el, on) => el && el.classList.toggle('hidden', !on);
const clock = (t) => `${Math.floor(t / 60)}:${String(Math.max(0, t) % 60).padStart(2, '0')}`;

const SUPPORT_TIP = { recon: 'Reveals a wide area for 15s', artillery: '10 shells on an area after a 5s warning (UK: 15, the 25-pounder doctrine)', strafe: 'Plane rakes a line from your HQ outward',
  smoke: 'Smoke screen over an area for 20s: blocks sight both ways', bombing: 'A stick of heavy bombs along the line: flattens houses, kills tanks',
  dive: 'One heavy bomb, right on the spot: tanks, guns, houses', para: 'Drops two rifle squads and an MG team where your side can see (3 toward pop)',
  cover: 'Fighters intercept the next enemy air strike over the area for 60s (not recon)' };
const FORT_TIP = { trench: 'Heavy cover for infantry', sandbags: 'Cover for infantry', wire: 'Slows infantry; tanks flatten it', traps: 'Stops vehicles; cover for infantry',
  nest: 'A trench pit behind a horseshoe of sandbags', mines: 'Hidden from the enemy; goes off under the first enemy squad or vehicle',
  bridge: 'Across a river, up to 5 cells; aim it along the crossing',
  fill: 'Shovels craters, flooded craters and sunken ground back to open ground, and clears rubble (a road gets its road back)',
  demine: `Lifts the mines your side knows about: your own, and enemy ones a builder squad found by standing within ${CFG.mine.detect} m`,
  aid: `Infantry within ${CFG.aid.radius} m reinforce for manpower, at half the HQ's pace. One per player` };
const ENTRENCH_TIP = { line: 'One straight trench from the first click to the second', zigzag: 'A sawtooth trench: more room on the same frontage',
  double: 'Two rows, the second 6 m behind the first', arc: 'A crescent around the first click, bowed toward the second',
  ring: 'A circle around the first click, out to the second', strongpoint: 'A trench square with barbed wire on the side of the second click' };
// the per-unit switches: [flag bit, name, what it does]
const STANCE = { holdFire: [2048, 'Hold fire', 'shoot only when given an attack order (snipers and guns stay hidden)'],
  holdPos: [4096, 'Hold position', 'never move without an order, not even to cover'],
  autoRetreat: [8192, 'Auto-retreat', `run for home when below ${Math.round(CFG.autoRetreat * 100)}% strength`] };
const BUILD_ROLE = { hq: 'Forward HQ: retreat point, trains Engineers', supplycache: 'Stores delivered supplies', armory: 'Researches weapon and armor upgrades', depot: 'On a resource node: +1.5 MP/s', barracks: 'Trains MGs and elite infantry', motorpool: 'Trains AT guns, tanks, rockets',
  airfield: 'Trains planes; their base', flakpos: 'Shoots down planes over your base', shipyard: 'On the coast: trains landing craft' };
const AIR_STATE = ['Ready', 'Flying out', 'On station', 'Heading home', 'Rearming'];
const AIMED = new Set(['grenade', 'barrage', 'satchel']); // abilities that need a spot clicked

// Command Card groups, and the order of the cards inside them (types not listed go last, in table order)
const GROUPS = ['Infantry', 'Support weapons', 'Vehicles', 'Aircraft', 'Naval'];
const GROUP_ICONS = ['rifle', 'mg', 'medium', 'fighter', 'destroyer']; // a silhouette before each group's name
const SUPPORT_WEAPONS = new Set(['mg', 'mortar', 'at', 'flak', 'howitzer']);
const ORDER = ['rifle', 'conscript', 'ranger', 'commando', 'flamer', 'sniper', 'medic', 'engineer', 'mg', 'mortar', 'at', 'howitzer', 'flak', 'halftrack', 'armoredcar', 'flaktrack', 'tank', 'medium', 'tankdestroyer', 'tiger', 'churchill', 'rocket', 'lcvp', 'gunboat', 'destroyer', 'fighter', 'attacker', 'bomber'];
const groupOf = (t) => (UNITS[t].naval ? 4 : UNITS[t].air ? 3 : SUPPORT_WEAPONS.has(t) ? 1 : UNITS[t].infantry ? 0 : 2);
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
// faction markings next to player names: US star, German cross, Soviet star, RAF roundel
const MARKS = [
  `<circle cx="12" cy="12" r="10.5" fill="#24427a" stroke="#e6dcc0" stroke-width="1.2"/><path d="${star(12, 12.6, 8.2, 3.3)}" fill="#f3efe2"/>`,
  `<path d="M8.5 1.5h7v7h7v7h-7v7h-7v-7h-7v-7h7z" fill="#f3efe2"/><path d="M10.3 3.3h3.4v7h7v3.4h-7v7h-3.4v-7h-7v-3.4h7z" fill="#151512"/>`,
  `<path d="${star(12, 12.8, 11, 4.4)}" fill="#c4302b" stroke="#f0dca6" stroke-width="1" stroke-linejoin="round"/>`,
  `<circle cx="12" cy="12" r="10.5" fill="#24427a" stroke="#e6dcc0" stroke-width="1.2"/><circle cx="12" cy="12" r="6.6" fill="#f3efe2"/><circle cx="12" cy="12" r="3.4" fill="#c4302b"/>`,
];
const FACTION_NAME = ['USA', 'Germany', 'USSR', 'UK'];
const mark = (f) => (MARKS[f] ? `<svg class="mark" viewBox="0 0 24 24" role="img"><title>${FACTION_NAME[f]}</title>${MARKS[f]}</svg>` : '');

// The support calls and the orders draw from the same silhouette set as the units (client/symbols.js icon()).
export { icon };

// ---------- the HUD ----------

// ctx: state getters (me, teams, names, units, selected, PRIORITY) and helpers/actions from main.js:
// look, facOf, color, classic, send, blip, retreat, stop, amove, rally, dig, build, ability, support, fType, builders, owns, canPlace, select
export function createHud(ctx) {
  const logisticsControls = document.createElement('span');
  logisticsControls.style.display = 'flex';
  logisticsControls.innerHTML = '<button data-logistics-overlay aria-label="Logistics overlay" title="Show supply territory, known supply stores and selected truck routes">' + icon('supplycache') + '</button>' +
    '<button data-logistics-selection aria-label="Logistics selection" title="Select supply trucks with a drag box">' + icon('truck') + '</button>';
  $('util').append(logisticsControls);
  logisticsControls.querySelector('[data-logistics-overlay]').onclick = () => ctx.toggleLogisticsOverlay();
  logisticsControls.querySelector('[data-logistics-selection]').onclick = () => ctx.toggleLogisticsSelection();
  // the placement hint sits just above the Command Card, whose height changes (the Classic build card is taller
  // than the recruit row), so --card-h follows the card's real height
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => {
    const h = $('buy').offsetHeight;
    if (h) $('hud').style.setProperty('--card-h', h + 'px'); else $('hud').style.removeProperty('--card-h');
  }).observe($('buy'));
  let snapshot = null;
  const tooltips = installTooltips($('hud'));
  const check = (action) => availability(snapshot, CFG, { ...action, slot: ctx.me, teams: ctx.teams, naval: ctx.naval(), watching: ctx.watching, ids: [...ctx.selected] });
  const attempt = (action, run) => { const result = check(action); if (result.ok) run(); else ctx.explain(result.reason); };
  // A card purchase, by click or by letter: the same command and refusal either way. `many` (Shift+letter) sends the
  // command up to five times, as often as the limits allow; the server takes each one like a separate click.
  const buy = (action, many = false) => attempt(action, () => {
    const n = many ? Math.max(1, buyCount(snapshot, CFG, { ...action, slot: ctx.me, teams: ctx.teams, naval: ctx.naval() }, 5)) : 1;
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
  // a Command Card card: name, the unit's silhouette (client/symbols.js), cost (and a second line in Classic).
  // A flat symbol tells the types apart at a glance; the small 3D renders all looked alike.
  const cardSymbol = (t) => `<span class="pt">${symbolSVG(t)}</span>`;
  // (its card letter, if any, is added once the card is laid out: lettered())
  const unitCard = (t, attr, cost, sub, tip) => `<button class="uc" ${attr} title="${esc(tip)}" aria-label="${esc(name(t))}">` +
    `<span class="nm">${soft(name(t))}</span>${cardSymbol(t)}<span class="cost">${cost}</span>${sub ? `<span class="sub">${sub}</span>` : ''}</button>`;
  const groupsHTML = (types, card) => GROUPS.map((_, g) => {
    const ts = types.filter((t) => groupOf(t) === g).sort((a, b) => rank(a) - rank(b));
    return ts.length ? `<div class="grp"><button class="hd" aria-expanded="false">${icon(GROUP_ICONS[g])}${GROUPS[g]}</button><div class="cards">${ts.map(card).join('')}</div></div>` : '';
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
      const lead = kind === 'conquest' ? '' : `<div class="sc-lead"><div class="sc-mode"></div><div class="num sc-clock"></div>${kind === 'horde' ? '<button class="sc-next hidden" title="Skip the break">Send next wave</button>' : ''}</div>`;
      el.innerHTML = lead + tids.map((t) => {
        const mem = members(t);
        return `<div class="sc-team">${mem.map((i) => `<div class="sc-p"><span class="swatch" style="background:${pc(i)}"></span>${mark(ctx.facOf(i))}` +
          `<span class="sc-name">${esc(names[i])}</span>${i === ctx.me && !ctx.watching ? '<span class="you">you</span>' : ''}</div>` +
          `<div class="sc-sub"><span class="sc-held"></span><span class="sc-net"></span></div>`).join('')}` +
          `<div class="sc-role"></div><div class="bar"><div style="background:${pc(mem[0])}"></div></div>` +
          `<div class="sc-val"><span class="u0"></span><span class="num"></span><span class="u"></span></div></div>`;
      }).join('');
      // the stylesheet sizes each team block from the team count (and the clock block, if any)
      el.style.setProperty('--n', tids.length); el.style.setProperty('--lead', !lead ? '0px' : kind === 'assault' || kind === 'horde' ? '216px' : '150px');
      el.querySelector('.sc-next')?.addEventListener('click', () => ctx.send({ t: 'nextwave' }));
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
      const mode = score.lead.firstChild, clk = score.lead.children[1];
      if (kind === 'horde') {
        // a wave on the map: how many are left (reserve included). Between waves: the break's countdown
        const on = !!s.mode.active;
        setText(mode, on ? `Wave ${s.mode.wave}` : `Wave ${s.mode.wave + 1} in`); setText(clk, on ? `${s.mode.left} left` : clock(s.mode.timeLeft));
        let threat = score.lead.querySelector('[data-wave-threat]');
        if (!threat) { threat = document.createElement('span'); threat.dataset.waveThreat = ''; threat.className = 'wave-threat'; score.lead.append(threat); }
        const profile = { mixed: 'Mixed forces', infantry: 'Infantry assault', armor: 'Armored assault', siege: 'Siege weapons' }[s.mode.nextProfile];
        setText(threat, !on && profile ? `Next Wave: ${profile}` : ''); show(threat, !on && !!profile);
        score.lead.title = 'Hold the bunker. The next wave comes 45 seconds after this one is dead';
        show(score.lead.querySelector('button'), !on && ctx.host);
      } else if (kind === 'assault') {
        setText(mode, mine === s.mode.defenderTeam ? 'Assault: hold out' : 'Assault: take the bunker'); setText(clk, clock(s.mode.timeLeft));
        score.lead.title = mine === s.mode.defenderTeam ? 'Hold out until the clock runs out' : 'Destroy the command bunker before the clock runs out';
      } else if (kind === 'tutorial') {
        setText(mode, 'Tutorial'); setText(clk, `${s.mode.step + 1} / ${s.mode.steps}`); score.lead.title = s.mode.goal ?? '';
      } else if (kind === 'world') {
        setText(mode, 'World Conquest'); setText(clk, `${s.world?.owned ?? 0}/${s.world?.total ?? 0} regions`);
        score.lead.title = 'Your team must own every region. Destroy military bases, then claim with infantry';
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
        const why = tr(cls && kind === 'conquest' ? 'Offline: the clock is paused until they return' : '');
        if (tm.net[k].title !== why) tm.net[k].title = why;
        const out = s.out?.[i];
        setText(tm.held[k], kind === 'conquest' ? (pts ? `${s.vp?.[i] ?? 0} pts, ${held(i)} held` : `${held(i)} held`) : kind === 'world' ? (out ? 'Out' : '') : kind === 'assault' || i === s.mode?.slot ? '' : out ? 'Out' : `${held(i)} held`);
        tm.held[k].classList.toggle('danger', !!out);
      });
      let frac = null, u0 = '', num = '', u = '', role = '', danger = false;
      if (kind === 'conquest') {
        const vp = tm.mem.reduce((a, i) => a + (s.vp?.[i] ?? 0), 0), goal = winVp(teams);
        frac = vp / goal; num = `${vp} / ${goal}`; u = 'VP';
      } else if (kind === 'assault') {
        const def = tm.t === s.mode.defenderTeam, own = units.filter((v) => v.type === 'bunker' && v.hp > 0 && teams[v.owner] === tm.t);
        role = def ? 'Defending' : 'Attacking';
        if (def) { const hp = own.reduce((a, v) => a + v.hp, 0), total = s.mode.total ?? tm.mem.length, max = total * UNITS.bunker.hpPer; frac = max ? hp / max : 0; u0 = 'Structures left'; num = `${own.length} / ${total}`; }
      } else if (kind === 'horde') {
        const b = units.find((v) => v.type === 'bunker' && v.hp > 0);
        if (tm.t !== s.mode.defenderTeam) role = 'Horde';
        else if (b) { frac = b.hp / UNITS.bunker.hpPer; u0 = 'Bunker'; num = `${Math.ceil(frac * 100)}%`; } else { u0 = 'Bunker lost'; danger = true; }
      } else if (kind === 'annihilation') {
        const own = units.filter((v) => v.type === 'bunker' && v.hp > 0 && teams[v.owner] === tm.t), hp = own.reduce((a, v) => a + v.hp, 0), max = (s.mode.bunkers?.[tm.t] ?? tm.mem.length) * UNITS.bunker.hpPer;
        if (own.length) { frac = hp / max; u0 = own.length > 1 ? `${own.length} bunkers` : 'Bunker'; num = `${Math.ceil(hp)} / ${max}`; } else { u0 = 'Out'; danger = true; }
      } else if (kind === 'world') {
        const count = tm.t === mine ? s.world?.owned ?? 0 : (s.world?.regions ?? []).filter(r => r.team === tm.t).length;
        const total = s.world?.total ?? 0;
        frac = total ? count / total : 0; num = `${count} / ${total}`; u = 'regions';
        u0 = tm.t === mine ? 'Owned' : 'Discovered';
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
    const supply = logisticsIndicator(ctx.logistics().units.get(v.id));
    if (supply) t.push(['pin', supply]);
    if (v.flags & 256) t.push(['cov', 'Hidden']);
    if (v.flags & RIDING_FLAG) t.push(['cov', 'Riding']);
    if (v.flags & CARGO_FLAG) t.push(['', 'Carrying a squad']);
    if (v.flags & 1) t.push(['', 'Retreating']);
    if (v.flags & 8) t.push(['cov', 'Reinforcing']);
    if (v.flags & 2) t.push(['sup', 'Suppressive fire']);
    if (v.flags & 4) t.push(['pin', 'AP round loaded']);
    if (v.supp >= 90) t.push(['pin', 'Pinned']); else if (v.supp >= 50) t.push(['sup', 'Suppressed']);
    if (!v.garr) { if (v.cover === 2) t.push(['cov', 'In trench']); else if (v.cover === 3) t.push(['cov', 'By cover']); else if (v.cover) t.push(['cov', 'In cover']); }
    if (v.flags & 16) t.push(['', 'Digging']); else if (v.flags & 1024) t.push(['', 'Waiting for MP to dig']);
    if (v.flags & 32) t.push(['cov', `Garrisoned: ${CFG.houses[v.flags >> 20 & 7].name}`]);
    if (v.flags & 64) t.push(['', 'Attack-move']);
    for (const [bit, nm] of Object.values(STANCE)) if (v.flags & bit) t.push(['', nm]);
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
  // Formation, Build and Trenches are submenus: their buttons open a second grid under the orders, which stays open
  // until clicked again. The hotkeys work with the menus closed.
  let ordKey = '', menu = null;
  const SHAPE_TIP = { line: 'ranks of up to ten across the facing; a longer right-drag fits more side by side',
    block: 'a square, widened by a longer right-drag', column: 'two files deep, for roads and gaps', wedge: 'an arrowhead, one unit at the tip' };
  const MENUS = { form: ['f_wedge', 'Form', 'Formation'], build: ['sandbags', 'Build', 'Build'], trench: ['e_zigzag', 'Trench', 'Trench patterns'] };
  const menuBtn = (m, tip) => `<button class="ob${menu === m ? ' on' : ''}" data-m="${m}" title="${esc(tip)}" aria-label="${MENUS[m][2]}" aria-expanded="${menu === m}">` +
    icon(MENUS[m][0]) + `<kbd></kbd><span class="val">${MENUS[m][1]} ${menu === m ? '▾' : '▸'}</span></button>`;
  function menuHTML(m) {
    if (m === 'form') return SHAPES.map((k) => orderBtn(`data-f="shape:${k}"`, `f_${k}`, '', `${k[0].toUpperCase() + k.slice(1)} (${label('formation')} cycles): ${SHAPE_TIP[k]}`)).join('') +
      orderBtn('data-f="tighten"', 'f_tight', label('tighten'), `Tighten (${label('tighten')}): closer spacing; the selection re-forms where it stands`) +
      orderBtn('data-f="spread"', 'f_spread', label('spread'), `Spread (${label('spread')}): wider spacing; the selection re-forms where it stands`) +
      orderBtn('data-f="together"', 'f_together', '', 'March together: the group moves at the pace of its slowest unit and arrives in one piece') +
      orderBtn('data-f="snap"', 'f_snap', '', 'Snap to trenches: infantry placed within 3 m of a trench step into it');
    // outside Classic the Build menu also puts up a Flak Emplacement (in Classic the Engineers' card has it)
    if (m === 'build') return (ctx.logistics().enabled && UNITS.supplycache ? orderBtn('data-a="bld:supplycache"', 'supplycache', '', 'Supply Cache: stores delivered supplies. 60 MP, 12 s') : '') +
      (ctx.classic() ? '' : buildKinds(false, isSkirmishBaseMode(snapshot)).filter(k => k !== 'supplycache' && (k !== 'shipyard' || ctx.naval()) && (k !== 'armory' || snapshot?.tech)).map(k => orderBtn(`data-a="bld:${k}"`, k, '', `${UNITS[k].name}: ${UNITS[k].cost} MP, ${UNITS[k].buildTime}s. Click where; selected builder squads construct it. Right-click a damaged building to repair it`, k)).join('')) +
      Object.entries(FORTS).map(([k, f]) => orderBtn(`data-a="fort:${k}"`, k, FORT_BADGES[k], `${f.name}${FORT_KEYS[k] ? ` (${FORT_KEYS[k]})` : ''}: ${FORT_TIP[k] ?? ''}. ${lineFort(k) && k !== 'trench' ? 'Click where it starts, then where it ends: one piece, or a continuous line that every selected builder squad works on. Price per piece' : 'Click where; the nearest builder squad puts it across its approach'}`)).join('');
    return ENTRENCH_TYPES.map((k) => orderBtn(`data-a="ent:${k}"`, `e_${k}`, k === 'line' ? badge('entrench:line') : '',
      `${ENTRENCH[k]}${k === 'line' ? ` (${label('entrench:line')})` : ''}: ${ENTRENCH_TIP[k]}. Every selected builder squad digs; each segment is paid as it is started. Shift on the second click queues it. Right-click a planned pattern with other squads to send them to help`)).join('');
  }
  function drawOrders(s, sel) {
    const el = $('abil'), bld = sel.length > 0 && sel.every((v) => UNITS[v.type].building);
    if (sel.length && sel.every(v => v.type === 'truck')) {
      if (ordKey !== 'trucks') {
        ordKey = 'trucks';
        el.innerHTML = '<div class="hd">Orders</div><div class="grid">' +
          orderBtn('data-truck-stop', 'stop', label('stop'), 'Stop selected units') +
          orderBtn('data-truck-resume', 'truck', '', 'Resume deliveries') + '</div>';
        el.querySelector('[data-truck-stop]').onclick = () => ctx.stop();
        el.querySelector('[data-truck-resume]').onclick = () => ctx.send({ t: 'logisticsResume', ids: selUnits().filter(v => v.type === 'truck' && v.owner === ctx.me).map(v => v.id) });
        setText(el.querySelector('[data-truck-resume] .val'), 'Resume deliveries');
      }
      return;
    }
    // Fort buttons whenever a squad that can build them is selected, including Engineers.
    const types = ctx.PRIORITY.filter((t) => sel.some((v) => v.type === t)), dig = sel.some((v) => CFG.fortBuilders.includes(v.type));
    const inf = sel.some((v) => UNITS[v.type].infantry), carry = sel.some((v) => UNITS[v.type].carries), shell = sel.some((v) => UNITS[v.type].w?.salvo);
    if (menu && menu !== 'form' && !dig) menu = null;
    const key = bld || !sel.length ? '' : `${types.join()}|${dig}|${inf}|${carry}|${shell}|${menu}`;
    if (key !== ordKey) {
      ordKey = key;
      el.innerHTML = !key ? '' : '<div class="hd">Orders</div><div class="grid">' +
        orderBtn('data-a="retreat"', 'retreat', label('retreat'), `Retreat (${label('retreat')}): run back to base, heal and reinforce there`) +
        orderBtn('data-a="amove"', 'amove', label('amove'), `Attack-move (${label('amove')}, or Ctrl+right-click): move and fight anything met on the way`) +
        orderBtn('data-a="stop"', 'stop', label('stop'), `Stop (${label('stop')}): halt where they are`) +
        (shell ? orderBtn('data-a="area"', 'barrage', badge('area'), `Shell area (${label('area')}): click any ground, seen or not; mortars, howitzers, rocket trucks and ships move into range and keep firing on it until given another order, bombers drop every stick on it. Shift+click queues it`) : '') +
        Object.entries(STANCE).map(([k, [, nm, tip]]) => orderBtn(`data-a="st:${k}"`, k, badge(`stance:${k}`), `${nm} (${label(`stance:${k}`)}): ${tip}. Click to switch it on or off for the selection`)).join('') +
        (inf ? orderBtn('data-a="cover"', 'takecover', badge('cover'), `Take cover (${label('cover')}): infantry run to the nearest trench, wall or rubble within ${CFG.coverSeek} m. Shift+click queues it`) : '') +
        (carry ? orderBtn('data-a="unload"', 'unload', badge('unload'), `Unload (${label('unload')}): the squad inside gets out beside the halftrack. To board, right-click the halftrack with infantry selected`) : '') +
        menuBtn('form', 'Formation: shape, spacing, marching together and snapping to trenches. Right-drag sets the facing and the width; double right-click turns to face a spot') +
        (dig ? menuBtn('build', 'Build: sandbags, wire, traps, nests, mines, bridges and more') + menuBtn('trench', 'Trench patterns: lines, zigzags, rings and strongpoints the builder squads dig together') : '') +
        types.map((t) => { const ab = UNITS[t].ab; return orderBtn(`data-a="${t}"`, ab.id === 'smoke' ? 'smokeab' : ab.id, '', `${ab.name}: ${name(t)}${AIMED.has(ab.id) ? ', click where' : ''}. ${ab.cd}s cooldown. Right-click: autocast on/off`, t); }).join('') +
        '</div><div class="control-transfer"><label>Control group <select data-group-destination aria-label="Destination control group">' + Array.from({ length: 9 }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join('') + '</select></label><button data-group-transfer title="Alt+1 to Alt+9 moves selected units and removes them from other groups">Move to group</button></div>' + (menu ? `<div class="hd sub">${MENUS[menu][2]}</div><div class="grid">${menuHTML(menu)}</div>` : '');
      el.querySelector('[data-group-transfer]')?.addEventListener('click', () => ctx.transferGroup(el.querySelector('[data-group-destination]').value));
      el.querySelectorAll('button[data-a]').forEach((b) => {
        const a = b.dataset.a;
        b.onclick = (e) => {
          if (a === 'retreat') ctx.retreat(); else if (a === 'amove') ctx.amove(); else if (a === 'stop') ctx.stop(); else if (a === 'area') ctx.area();
          else if (a === 'unload') ctx.unload(); else if (a === 'cover') ctx.takeCover(e.shiftKey); else if (a.startsWith('st:')) ctx.stance(a.slice(3)); else if (a.startsWith('ent:')) ctx.entrench(a.slice(4));
          else if (a.startsWith('fort:')) ctx.dig(a.slice(5)); else if (a.startsWith('bld:')) ctx.build(a.slice(4)); else ctx.ability(a);
        };
        if (UNITS[a]) b.oncontextmenu = (e) => { e.preventDefault(); ctx.autocast(a); };
      });
      el.querySelectorAll('button[data-m]').forEach((b) => (b.onclick = () => { menu = menu === b.dataset.m ? null : b.dataset.m; drawOrders(s, sel); }));
      el.querySelectorAll('button[data-f]').forEach((b) => (b.onclick = () => {
        const f = b.dataset.f;
        if (f.startsWith('shape:')) ctx.setForm({ shape: f.slice(6) });
        else if (f === 'tighten' || f === 'spread') ctx.reform(f === 'spread' ? 0.25 : -0.25);
        else ctx.setForm({ [f]: !ctx.form()[f] });
        drawOrders(s, sel);
      }));
    }
    if (!key) return;
    const form = ctx.form();
    for (const b of el.querySelectorAll('button[data-f]')) {
      const f = b.dataset.f, toggle = f === 'together' || f === 'snap', on = f.startsWith('shape:') ? form.shape === f.slice(6) : toggle && form[f];
      b.classList.toggle('on', on);
      setText(b.lastElementChild, toggle ? (on ? 'On' : 'Off') : f === 'spread' ? `${form.spread}x` : '');
    }
    const fType = ctx.fType();
    for (const b of el.querySelectorAll('button[data-a]')) {
      const a = b.dataset.a, val = b.lastElementChild;
      let result = { ok: true, reason: '' }, txt = '';
      if (a.startsWith('fort:')) { const kind = a.slice(5), f = FORTS[kind]; result = check({ t: 'dig', kind }); txt = `${f.cost} MP`; }
      else if (a.startsWith('bld:')) { const kind = a.slice(4); result = check({ t: 'build', kind }); txt = `${UNITS[kind].cost} MP`; }
      else if (a === 'cover') result = check({ t: 'cover' });
      else if (a === 'unload') { const n = sel.filter((v) => v.flags & CARGO_FLAG).length; result = n ? result : { ok: false, reason: 'No squad on board' }; txt = n ? 'full' : 'empty'; }
      else if (a.startsWith('st:')) {
        const bit = STANCE[a.slice(3)][0], on = sel.filter((v) => v.flags & bit).length;
        txt = !on ? 'Off' : on === sel.length ? 'On' : `${on}/${sel.length}`; b.classList.toggle('on', on > 0);
      }
      else if (a.startsWith('ent:')) { result = check({ t: 'entrench' }); txt = `${FORTS.trench.cost}/seg`; }
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
  // The card letters: Q W E R T, A S D F G, Z X C V B in reading order. In recruit mode they go on the groups first
  // (Q Infantry, W Support weapons, ...), and once a group is picked, on its cards: Q Q buys Rifles. A Classic
  // building's cards are lettered straight away. Each card keeps its purchase in b._buy so a letter and a click run
  // the same code. Cards past the 15th stay click-only.
  let grp = -1; // recruit mode: the picked group, -1 while the letters are on the groups
  const slots = () => {
    const card = $('buy'), groups = [...card.querySelectorAll('.grp')];
    if (ctx.classic()) return [...card.querySelectorAll('[data-train]')];
    return grp < 0 ? groups : [...(groups[grp]?.querySelectorAll('[data-unit]') ?? [])];
  };
  function lettered() {
    const card = $('buy');
    card.querySelectorAll('.key').forEach((k) => k.remove());
    slots().forEach((b, i) => { if (CARD_KEYS[i]) (b.querySelector(':scope > .hd') ?? b).insertAdjacentHTML('beforeend', `<kbd class="key">${CARD_KEYS[i]}</kbd>`); });
    card.querySelectorAll('.grp').forEach((g, i) => { g.classList.toggle('open', i === grp); g.querySelector('.hd')?.setAttribute('aria-expanded', String(i === grp)); });
    card.classList.toggle('picked', grp >= 0);
  }
  function pressCard(n, many) {
    const b = slots()[n - 1];
    if (!b) return false;
    if (b.classList.contains('grp')) { grp = n - 1; lettered(); quietBadges(); return true; }
    b.classList.add('hit'); setTimeout(() => b.classList.remove('hit'), 140);
    b._buy(many);
    return true;
  }
  // Esc in recruit mode: back from a group to the groups, then out
  function recruitBack() {
    if (grp < 0) return setRecruit(false);
    grp = -1; lettered(); quietBadges();
  }
  // A letter on a card belongs to the card, so the support and order badges that show the same letter go quiet.
  function quietBadges() {
    const used = $('buy').classList.contains('lettered') ? CARD_KEYS.slice(0, slots().length) : []; // the letters in use right now
    for (const k of document.querySelectorAll('#support kbd, #abil kbd')) k.classList.toggle('quiet', used.includes(k.textContent));
  }
  // Recruit mode (outside Classic): the letters show on the cards and the header tab reads "Recruiting".
  let recruiting = false, autoOpened = false; // autoOpened: recruit mode came from selecting a production building
  function setRecruit(on) {
    recruiting = !!on && !ctx.classic(); grp = -1;
    const card = $('buy'), tab = card.querySelector('[data-recruit]');
    card.classList.toggle('lettered', recruiting);
    if (!ctx.classic()) lettered();
    quietBadges();
    if (tab) {
      tab.setAttribute('aria-pressed', String(recruiting));
      tab.innerHTML = recruiting ? `Recruiting <kbd>${label('recruitOff')}</kbd>` : `Recruit <kbd>${label('recruitMode')}</kbd>`;
      tab.title = recruiting ? `A letter opens a group, a second letter buys from it (Q Q: Rifles); Shift+letter buys five. ${label('recruitOff')} goes back a step, ${label('recruitMode')} or a right-click stops`
        : `Recruit by letter (${label('recruitMode')}): a letter opens a group, a second buys from it, Shift buys five. WASD pans again when you stop`;
    }
  }
  addEventListener('mousedown', (e) => { if (e.button === 2 && recruiting) setRecruit(false); }, { capture: true });
  function buildCard() {
    cardKey = '';
    const card = $('buy');
    card.classList.remove('lettered');
    recruiting = false;
    // drop the recruit bar's tab layout a previous Conquest match left behind: 'fit' hides every closed group's cards
    if (ctx.classic()) { card.innerHTML = ''; card.classList.add('hidden'); card.classList.remove('fit', 'picked', 'lettered'); return; }
    card.classList.remove('hidden');
    const types = UNIT_TYPES.filter((t) => t !== 'truck' && t !== 'supplycache' && canBuild(t, ctx.facOf(ctx.me)) && !UNITS[t].classic && (!UNITS[t].naval || ctx.naval()));
    card.innerHTML = groupsHTML(types, (t) => unitCard(t, `data-unit="${t}"`, `${UNITS[t].cost}<span class="cu"> MP</span>`, '', unitTip(t, ctx.me, `. ${UNITS[t].cost} MP`)));
    // Each group is a tab: a click shows its cards and hides the rest, so only one type's cards fill the screen.
    // The stylesheet shares the room between the widest group's cards; narrow cards drop the name for the tooltip.
    const sizes = GROUPS.map((_, g) => types.filter((t) => groupOf(t) === g).length).filter(Boolean);
    card.classList.add('fit'); card.style.setProperty('--nc', Math.max(...sizes, 1)); card.style.setProperty('--ng', sizes.length);
    card.querySelectorAll('.grp').forEach((g, i) => { g.querySelector('.hd').onclick = (e) => { grp = grp === i ? -1 : i; lettered(); quietBadges(); e.currentTarget.blur(); }; });
    card.querySelectorAll('[data-unit]').forEach((b) => { b._buy = (many) => buy(recruitAction(snapshot, ctx.me, b.dataset.unit, [...ctx.selected], ctx.teams), many); b.onclick = () => b._buy(false); });
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
    let info = card.querySelector('[data-facility]');
    if (!info) { info = document.createElement('div'); info.dataset.facility = ''; Object.assign(info.style, {position:'absolute',left:'8px',bottom:'calc(100% + 6px)',background:'var(--strip)',padding:'4px 8px'}); card.append(info); }
    const selected = selUnits(), bld = selected.length === 1 && UNITS[selected[0].type].building ? selected[0] : null;
    const key = bld ? `${bld.id}:${bld.built >= 1}:${bld.owner === ctx.me}` : '';
    if (info.dataset.key !== key) {
      info.dataset.key = key;
      info.innerHTML = bld ? `<span data-facility-text></span>` + (bld.built < 1 && bld.owner === ctx.me ? ' <button data-cancel-site>Cancel (75% back)</button>' : '') : '';
      info.querySelector('[data-cancel-site]')?.addEventListener('click', () => ctx.send({t:'cancel',id:bld.id}));
      // selecting one of my finished production buildings opens recruit mode on the group it makes most of
      const makes = bld && bld.built >= 1 && bld.owner === ctx.me ? UNITS[bld.type].makes ?? [] : [];
      const counts = [...card.querySelectorAll('.grp')].map((g) => [...g.querySelectorAll('[data-unit]')].filter((b) => makes.includes(b.dataset.unit)).length);
      const best = counts.indexOf(Math.max(0, ...counts));
      if (makes.length && best >= 0 && counts[best]) { setRecruit(true); grp = best; lettered(); quietBadges(); autoOpened = true; }
      else if (autoOpened) { autoOpened = false; setRecruit(false); }
    }
    info.style.display = bld ? '' : 'none';
    if (bld) setText(info.querySelector('[data-facility-text]'), `${UNITS[bld.type].name}: ${bld.built < 1 ? Math.round(bld.built*100)+'% built' : 'Ready'} . ${Math.ceil(bld.hp)} HP. ${bld.built < 1 ? 'Right-click with builders to assist' : 'Right-click with builders to repair'}`);
    for (const b of $('buy').querySelectorAll('[data-unit]')) {
      const broke = s.mp < UNITS[b.dataset.unit].cost;
      setAvailability(b, check(recruitAction(s, ctx.me, b.dataset.unit, [...ctx.selected], ctx.teams)));
      b.classList.toggle('broke', broke);
    }
  }
  function drawClassicCard(s, pop, cap, sel) {
    const card = $('buy');
    const bld = sel.length === 1 && UNITS[sel[0].type].building && sel[0].owner === ctx.me ? sel[0] : null, eng = !bld && sel.some((v) => v.owner === ctx.me && v.type === 'engineer');
    const recovery = s.world?.recovery?.available && !bld && !eng;
    const missingHQ = ![...ctx.units.values()].some(v => v.owner === ctx.me && v.type === 'hq');
    const recoveryCost = missingHQ ? s.world?.recovery?.hq : s.world?.recovery?.engineer;
    const key = bld ? `b${bld.id}:${bld.built >= 1}` : eng ? `e:${ctx.logistics().enabled}` : recovery ? `recover:${missingHQ}:${recoveryCost}` : '';
    if (key !== cardKey) {
      cardKey = key;
      card.classList.toggle('hidden', !key);
      const info = (t, status, hint) => `<div class="cinfo"><div class="ci-t">${symbolSVG(t)}<b>${esc(UNITS[t].name)}</b></div><div class="ci-s">${status}</div><div class="ci-h">${hint}</div></div>`;
      if (bld && bld.built < 1) card.innerHTML = info(bld.type, 'Under construction <span data-built></span>', 'Right-click it with Engineers to help') +
        '<button class="cancel" data-cancel title="Cancel the building and get 75% of its cost back">Cancel<span>75% back</span></button>';
      else if (bld) card.innerHTML = info(bld.type, '<span data-queue></span><div data-production-jobs class="production-jobs"></div>', 'Right-click the ground: rally point') +
        groupsHTML((UNITS[bld.type].makes ?? []).filter((t) => canBuild(t, ctx.facOf(ctx.me))), (t) => {
          const pr = priceOf(s, t), fuel = pr.fuel ? `${pr.fuel} Fuel, ` : '';
          return unitCard(t, `data-train="${t}"`, `${pr.mp} MP`, `${fuel}${UNITS[t].train}s`, unitTip(t, ctx.me, `. ${pr.mp} MP${pr.fuel ? ` + ${pr.fuel} Fuel` : ''}, trains in ${UNITS[t].train}s`));
        });
      else if (eng) card.innerHTML = '<div class="grp"><div class="hd">Build</div><div class="cards">' + buildKinds(true, false, s.mode?.kind === 'world').filter(k => (k !== 'supplycache' || ctx.logistics().enabled) && (k !== 'armory' || s.tech)).map((k) =>
        `<button class="uc wide" data-build="${k}" title="${esc(`${UNITS[k].name}${BUILD_KEYS[k] ? ` (${BUILD_KEYS[k]})` : ''}: ${BUILD_ROLE[k] ?? ''}. ${UNITS[k].cost} MP, ${UNITS[k].buildTime}s`)}">` +
        `<span class="nm">${esc(UNITS[k].name)} <kbd>${BUILD_KEYS[k] ?? ''}</kbd></span>${cardSymbol(k)}<span class="cost">${UNITS[k].cost} MP, ${UNITS[k].buildTime}s</span>` +
        `<span class="sub" data-note></span></button>`).join('') + '</div></div>';
      else if (recovery) card.innerHTML = `<button class="uc wide" data-recover><span class="nm">Restore ${missingHQ ? 'HQ' : 'Engineer'}</span><span class="cost">${recoveryCost} MP</span><span class="sub">Deploys in friendly territory</span></button>`;
      else card.innerHTML = '';
      card.querySelector('[data-recover]')?.addEventListener('click', () => ctx.send({ t: 'recover' }));
      const id = bld?.id;
      card.querySelectorAll('[data-train]').forEach((b) => { b._buy = (many) => buy({ t: 'buy', unit: b.dataset.train, from: id }, many); b.onclick = () => b._buy(false); });
      // a selected production building answers to the card letters without recruit mode
      lettered(); card.classList.toggle('lettered', !!card.querySelector('[data-train]'));
      card.querySelectorAll('[data-cancel]').forEach((b) => (b.onclick = () => { ctx.send({ t: 'cancel', id }); ctx.selected.clear(); ctx.blip(300); }));
      card.querySelectorAll('[data-build]').forEach((b) => (b.onclick = () => ctx.build(b.dataset.build)));
    }
    if (recovery) { const button = card.querySelector('[data-recover]'); if (button) button.disabled = s.mp < recoveryCost; }
    if (bld && bld.built < 1) setText(card.querySelector('[data-built]'), `${Math.round(bld.built * 100)}%`);
    if (bld && bld.built >= 1) {
      const q = bld.queue ?? [], nm = (t) => name(t);
      setText(card.querySelector('[data-queue]'), q.length ? `Training ${nm(q[0])} ${Math.round((bld.prog ?? 0) * 100)}%` + (q.length > 1 ? `, then ${q.slice(1).map(nm).join(', ')}` : '') : 'Idle');
      const jobs = bld.productionJobs ?? [], list = card.querySelector('[data-production-jobs]');
      if (list) {
        const key = jobs.map(job => `${job.id}:${job.status}`).join(',');
        if (list.dataset.jobs !== key) {
          list.dataset.jobs = key;
          list.replaceChildren(...jobs.map(job => {
            const row = document.createElement('div'), text = document.createElement('span');
            row.className = 'production-job';
            text.textContent = tr(`${job.status === 'active' ? 'Training' : 'Waiting'}: ${name(job.type)}`);
            row.append(text);
            if (job.status === 'waiting') {
              const button = document.createElement('button');
              button.type = 'button'; button.dataset.job = job.id;
              button.textContent = tr(`Cancel: refund ${job.mp} MP, ${job.fuel} Fuel`);
              button.title = tr(`Cancel ${name(job.type)}: refund ${job.mp} MP, ${job.fuel} Fuel`);
              button.setAttribute('aria-label', button.title);
              button.onclick = () => attempt({ t: 'cancelProduction', id: bld.id, job: job.id }, () => { button.disabled = true; ctx.send({ t: 'cancelProduction', id: bld.id, job: job.id }); });
              row.append(button);
            }
            return row;
          }));
        }
        for (const button of list.querySelectorAll('[data-job]')) setAvailability(button, check({ t: 'cancelProduction', id: bld.id, job: +button.dataset.job }));
      }
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
  // rebuilt only when the planes change; a click selects that plane, Shift/Ctrl-click adds or drops it, a double-click
  // selects every plane
  let airKey = '';
  function drawAir(s) {
    const el = $('airPanel'); if (!el) return;
    const air = (s.air ?? []).filter(([id]) => ctx.units.has(id)), key = air.map(([id]) => id).join();
    if (key !== airKey) {
      airKey = key;
      el.innerHTML = air.map(([id]) => `<button data-plane="${id}"><span class="nm">${esc(name(ctx.units.get(id).type))}</span><span class="st"></span></button>`).join('');
      el.querySelectorAll('[data-plane]').forEach((b) => {
        b.onclick = (e) => ctx.select(+b.dataset.plane, e.shiftKey || e.ctrlKey);
        b.ondblclick = () => ctx.selectMany(air.map(([id]) => id));
      });
    }
    air.forEach(([id, st, fuel, , timer], k) => {
      const b = el.children[k];
      b.classList.toggle('on', ctx.selected.has(id));
      setText(b.lastElementChild, `${AIR_STATE[st] ?? ''}${st === 2 ? ` ${fuel}s` : st === 4 ? ` ${timer}s` : ''}`);
    });
  }

  // Horde boss bar: the Kaiju's hp (all of them, on a later boss wave) while any is on the map
  function drawBoss(s) {
    const b = s.mode?.boss, el = $('boss');
    show(el, !!b);
    if (!b) return;
    setText(el.firstChild, `KAIJU  ${Math.ceil(b[0] / b[1] * 100)}%`);
    el.lastChild.firstChild.style.width = `${b[0] / b[1] * 100}%`;
  }

  function update(s) {
    snapshot = s;
    const me = ctx.me, all = [...ctx.units.values()];
    const pop = all.reduce((a, v) => a + (v.owner !== me ? 0 : UNITS[v.type].structure ? (v.queue ?? []).reduce((n, t) => n + popUse(t), 0) : popUse(v.type)), 0);
    const cap = s.world?.cap ?? popCap(s), sel = selUnits();
    drawScores(s);
    drawBoss(s);
    drawEcon(s, pop, cap);
    if (!sel.length || !sel.every(v => v.type === 'truck')) {
      if (['classic', 'world'].includes(s.mode?.kind)) drawClassicCard(s, pop, cap, sel); else drawRecruit(s, pop, cap);
    }
    drawLogistics(sel);
    drawTech(s, sel);
    drawSelection(sel);
    drawOrders(s, sel);
    drawAir(s);
    quietBadges();
    tooltips.update();
  }

  // HQ tiers and the Armory (shared/tech.js): a selected finished HQ offers the next tier, an Armory its three lines.
  // Finished research is announced once.
  let techKey = '', techSeen = null;
  function drawTech(s, sel) {
    const card = $('buy'), t = s.tech;
    if (t && techSeen) {
      if (t.tier > techSeen.tier) ctx.explain(`${TIER_NAMES[t.tier]} ready`);
      for (const k of Object.keys(TECH.lines)) if (t.armory[k] > techSeen.armory[k]) ctx.explain(`${TECH.lines[k]} ${t.armory[k]} researched`);
    }
    techSeen = t && { tier: t.tier, armory: { ...t.armory } };
    const bld = t && sel.length === 1 && ['hq', 'armory'].includes(sel[0].type) && sel[0].owner === ctx.me && sel[0].built >= 1 ? sel[0] : null;
    const kinds = !bld ? [] : bld.type === 'hq' ? ['tier'] : Object.keys(TECH.lines);
    let panel = card.querySelector('[data-tech]');
    if (!kinds.length) { panel?.remove(); techKey = ''; return; }
    if (!panel || techKey !== bld.type) {
      techKey = bld.type; panel?.remove();
      panel = document.createElement('div'); panel.dataset.tech = '';
      Object.assign(panel.style, { position: 'absolute', left: '8px', bottom: 'calc(100% + 40px)', display: 'flex', gap: '6px', alignItems: 'center', background: 'var(--strip)', padding: '4px 8px', font: '13px var(--type)' });
      panel.innerHTML = `<b data-tier></b>` + kinds.map(k => `<button data-research="${k}"></button>`).join('');
      panel.querySelectorAll('[data-research]').forEach(b => { b.onclick = (e) => { const action = { t: 'tech', kind: b.dataset.research }; attempt(action, () => { ctx.send(action); ctx.blip('recruit'); }); e.currentTarget.blur(); }; });
      card.append(panel);
    }
    card.classList.remove('hidden');
    setText(panel.querySelector('[data-tier]'), TIER_NAMES[t.tier]);
    const classic = s.mun !== undefined;
    for (const b of panel.querySelectorAll('[data-research]')) {
      const k = b.dataset.research, cost = techCost(t, k, classic), job = t.lab.find(([kind]) => kind === k);
      const what = k === 'tier' ? `Upgrade to ${TIER_NAMES[t.tier + 1]}` : `${TECH.lines[k]} ${t.armory[k] + 1}`;
      setText(b, !cost ? (k === 'tier' ? 'Top tier' : `${TECH.lines[k]} 3/3`) : job ? `${what}: ${Math.round(job[1] * 100)}%`
        : `${what}: ${cost.mp} MP${cost.mun ? ` + ${cost.mun} Mun` : ''}, ${cost.time}s`);
      b.title = k === 'tier' ? 'The next HQ tier unlocks new buildings and units. Research pauses while you have no finished HQ'
        : `${k === 'armor' ? `${TECH.step * 100}% less damage taken by vehicles` : `+${TECH.step * 100}% damage for ${k === 'guns' ? 'vehicles, planes and boats' : 'infantry and their guns'}`} per level, for units already in the field too`;
      setAvailability(b, check({ t: 'tech', kind: k }));
    }
  }

  let truckCard = false;
  function drawLogistics(sel) {
    const data = ctx.logistics(), card = $('buy');
    show(logisticsControls, data.enabled && !ctx.watching);
    logisticsControls.querySelector('[data-logistics-overlay]').setAttribute('aria-pressed', String(ctx.logisticsOverlay()));
    logisticsControls.querySelector('[data-logistics-selection]').setAttribute('aria-pressed', String(ctx.logisticsSelection()));
    const trucks = sel.length && sel.every(v => v.type === 'truck');
    if (trucks && data.enabled) {
      if (!truckCard) {
        truckCard = true; card.innerHTML = ''; cardKey = null;
        card.classList.remove('hidden', 'lettered', 'fit'); recruiting = false;
      }
    } else if (truckCard) {
      truckCard = false;
      if (!ctx.classic()) { buildCard(); drawRecruit(snapshot); }
      else { cardKey = null; drawClassicCard(snapshot, 0, 0, sel); }
    }
    let detail = card.querySelector('[data-logistics-detail]');
    const entries = sel.map(v => ({ v, lines: v.type === 'truck' ? truckLabels(data.trucks.get(v.id)) :
      data.units.has(v.id) ? reserveLabels(data.units.get(v.id)) : storeLabels(storeForUnit(data,v)) })).filter(entry => entry.lines.length);
    if (!entries.length) { detail?.remove(); if (ctx.classic() && !cardKey) card.classList.add('hidden'); return; }
    if (!detail) { detail = document.createElement('div'); detail.dataset.logisticsDetail = ''; detail.className = 'logistics-card'; card.append(detail); }
    card.classList.remove('hidden');
    const shape = entries.map(({ v, lines }) => `${v.id}:${lines.length}`).join(',') + `|${trucks}`;
    if (detail.dataset.shape !== shape) {
      detail.dataset.shape = shape;
      detail.innerHTML = `<div class="hd">Logistics</div><div class="logistics-reserves">${entries.map(({ v, lines }) =>
        `<div><b>${esc(tr(name(v.type, v.owner)))} #${v.id}</b>${lines.map(() => '<span data-logistics-value></span>').join('')}</div>`).join('')}</div>` +
        (trucks ? '<div class="ci-h">Right-click an allied unit or Supply Cache to deliver carried cargo</div><button data-logistics-resume>Resume deliveries</button>' : '');
      detail.querySelector('[data-logistics-resume]')?.addEventListener('click', () => ctx.send({ t: 'logisticsResume', ids: selUnits().filter(v => v.type === 'truck' && v.owner === ctx.me).map(v => v.id) }));
    }
    const values = detail.querySelectorAll('[data-logistics-value]');
    entries.flatMap(entry => entry.lines).forEach((line, i) => setText(values[i], line));
  }

  return { buildSupport, buildCard, update, pressCard, setRecruit, recruitBack, recruiting: () => recruiting,
    lettered: () => ctx.classic() && !!$('buy').querySelector('[data-train]'), hasCard: (n) => !!slots()[n - 1] };
}
