// What one seat has decided and what it has learned this match.
// Fed only from that seat's view (the same facts a player in the seat would have) and from its private memory.
// Nothing here reads hidden units, hidden mines, or another seat's economy.
import { UNITS, CFG, CELL, COVER, blockOf, los } from '../../shared/sim.js';

const dist = (a, b) => Math.hypot((a.x ?? 0) - (b.x ?? 0), (a.z ?? 0) - (b.z ?? 0));
const RIFLES = new Set(['rifle', 'conscript', 'ranger', 'mg']);

export function beginMind(view, slot, mem, learn) {
  const now = view.tick / 20;
  const me = view.players[slot];
  const mind = mem.mind ??= { roster: new Map(), respect: {}, points: [], owned: [], noticed: new Map(), lastSeen: new Map(), pointSeen: [], aim: null, decision: null };
  const enemies = [...me.visible].map(id => view.units.get(id)).filter(Boolean);
  const seenNow = new Set(enemies.map(e => e.id));
  for (const e of enemies) {
    if (!mind.noticed.has(e.id)) mind.noticed.set(e.id, now);
    mind.lastSeen.set(e.id, now);
  }
  for (const [id, at] of mind.lastSeen) if (now - at > 60) { mind.lastSeen.delete(id); mind.noticed.delete(id); }

  const own = [...view.units.values()].filter(u => u.owner === slot && !UNITS[u.type].structure);
  const alive = new Set(own.map(u => u.id));
  for (const [id, prev] of mind.roster) {
    if (alive.has(id)) continue;
    const near = (view.sightings ?? []).filter(s => {
      const p = view.players[s.owner];
      return p && p.team !== me.team && now - s.t <= 25 && dist(s, prev) <= 28;
    }).sort((a, b) => dist(a, prev) - dist(b, prev) || a.id - b.id);
    if (near.length && learn) {
      const type = near[0].type;
      mind.respect[type] = Math.min(6, (mind.respect[type] ?? 0) + learn);
    }
    const pi = view.points.findIndex(p => dist(p, prev) <= CFG.pointRadius + 12);
    if (pi >= 0) {
      const rec = mind.points[pi] ??= { failed: 0 };
      rec.failed = Math.min(4, rec.failed + 1);
      if (mind.aim?.i === pi) mind.aim = null;
    }
    (mind.losses ??= []).push({ ...prev, t: now, id });
    mind.roster.delete(id);
  }
  mind.losses = (mind.losses ?? []).filter(l => now - l.t <= 30);
  for (const u of own) mind.roster.set(u.id, { x: u.x, z: u.z });

  view.points.forEach((p, i) => {
    const owner = view.players[p.owner];
    const held = !!owner && owner.team === me.team;
    if (held && mind.owned[i] === false) {
      if (mind.points[i]) mind.points[i].failed = Math.max(0, mind.points[i].failed - 1);
      for (const k of Object.keys(mind.respect)) {
        mind.respect[k] = Math.max(0, mind.respect[k] - 1);
        if (!mind.respect[k]) delete mind.respect[k];
      }
    }
    mind.owned[i] = held;
    if (owner && owner.team !== me.team && mind.pointSeen[i] === undefined) mind.pointSeen[i] = now;
  });
  if (mind.aim) {
    const p = view.points[mind.aim.i];
    const owner = p && view.players[p.owner];
    if (!p || now >= mind.aim.until || (owner && owner.team === me.team && !p.cut)) mind.aim = null;
  }
  return mind;
}

// True once this contact has been on the table long enough to act on. A brand-new glimpse is not enough.
export function knownSince(mind, id, now, notice) {
  if (id === undefined || id === null) return false;
  const at = mind.noticed.get(id);
  return at !== undefined && now - at + 1e-9 >= notice;
}

export function pointReady(mind, index, now, notice) {
  if (index < 0) return false;
  const at = mind.pointSeen[index];
  return at !== undefined && now - at + 1e-9 >= notice;
}

// What the losses say to buy, when the live battlefield is no longer showing it.
// Armor that killed a squad pulls anti-tank. An infantry crowd pulls machine guns.
// A capture spends one point of that respect, so a lesson can fade.
export function lesson(mind, buy, haveAt, haveMg) {
  if (!mind) return null;
  const armor = (mind.respect.tank ?? 0) + (mind.respect.medium ?? 0) + (mind.respect.tiger ?? 0);
  const crowd = (mind.respect.rifle ?? 0) + (mind.respect.conscript ?? 0) + (mind.respect.ranger ?? 0) + (mind.respect.mg ?? 0);
  if (armor >= 1 && haveAt < 2 && RIFLES.has(buy)) return 'at';
  if (crowd >= 2 && haveMg < 3 && (buy === 'rifle' || buy === 'conscript' || buy === 'ranger')) return 'mg';
  return null;
}

// How many times squads have already died on this point, capped so one bad field cannot veto the map.
export function pointExtra(mind, index) {
  return Math.min(3, mind.points[index]?.failed ?? 0);
}

// Armor the seat has actually seen. Anti-armor is what it can send against that, instead of rifles.
export const ARMOR = new Set(['tank', 'medium', 'tiger', 'churchill']);
export const ANTI_ARMOR = new Set(['at', 'tank', 'medium', 'tiger', 'churchill', 'rocket']);

// A sighting that has left vision still stands until it is a minute old, or until this seat looks at that ground and it is empty.
export function dropEmptyGround(mem, view, slot, now) {
  if (!mem.seen) return;
  const visible = view.players[slot].visible;
  for (const [id, sighting] of [...mem.seen]) {
    if (now - sighting.t > 60) { mem.seen.delete(id); continue; }
    if (visible.has(id)) continue;
    if (typeof view.sees === 'function' && view.sees(sighting)) mem.seen.delete(id);
  }
}

export function liveSightings(mem, view, slot, now) {
  const me = view.players[slot];
  return [...(mem.seen?.values() ?? [])].filter(sighting => {
    const owner = view.players[sighting.owner];
    return owner && owner.team !== me.team && now - sighting.t <= 60;
  }).sort((a, b) => a.id - b.id);
}

// The operation from the last look, while its reason is still on the table.
// A brand-new contact is not a reason to drop it. That check stays with the caller.
export function operationHolds(op, view, slot, mind, now, sightings) {
  if (!op || !(now + 1e-9 < op.until)) return false;
  const me = view.players[slot];
  if (op.kind === 'wait') return op.threatId != null && sightings.some(s => s.id === op.threatId);
  if (op.kind !== 'push' || op.point == null) return op.kind === 'push';
  const point = view.points[op.point];
  if (!point) return false;
  const owner = point.owner >= 0 ? view.players[point.owner] : null;
  if (owner && owner.team === me.team && !point.cut) return false;
  return (mind.points[op.point]?.failed ?? 0) <= (op.failedAt ?? 0);
}


export const ASSAULT_TUNING = Object.freeze({ assemble: 12, regroup: 8, blocked: 10, lifetime: 100,
  withdraw: 1.25, resume: 0.75, cooldown: 18, supportRear: 8, searchCells: 2048 });
const SUPPORT_ROLES = new Set(['mg', 'at', 'mortar', 'howitzer', 'rocket', 'tankdestroyer']);
const valueOf = u => UNITS[u.type].cost * u.hp / (UNITS[u.type].models * UNITS[u.type].hpPer);
const mean = units => ({ x: units.reduce((n, u) => n + u.x, 0) / units.length, z: units.reduce((n, u) => n + u.z, 0) / units.length });
const backFrom = (at, home, metres) => { const range = dist(at, home) || 1, k = Math.min(range, metres) / range;
  return { x: at.x + (home.x - at.x) * k, z: at.z + (home.z - at.z) * k }; };
const regionHas = (r, at) => !r?.bounds || (at.x >= r.bounds[0] && at.z >= r.bounds[1] && at.x < r.bounds[2] && at.z < r.bounds[3]);

// A short, bounded search over delivered terrain. It never asks the live game for a route.
export function operationPosition(view, u, desired, threats = [], safe = false, region = null, supportTarget = null) {
  const start = Math.floor(u.z / CELL) * view.w + Math.floor(u.x / CELL), mask = blockOf(UNITS[u.type]);
  if (start < 0 || start >= view.w * view.h || view.chars[start] === '?') return null;
  const queue = [start], seen = new Set(queue); let best = null, bestScore = Infinity;
  for (let i = 0; i < queue.length && i < ASSAULT_TUNING.searchCells; i++) {
    const c = queue[i], x = c % view.w, y = Math.floor(c / view.w), at = { x: (x + 0.5) * CELL, z: (y + 0.5) * CELL };
    const danger = threats.some(e => dist(at, e) < Math.min(26, UNITS[e.type]?.w?.range ?? 20));
    if (regionHas(region, at) && !(view.flags[c] & mask) && (!safe || !danger)
      && (!supportTarget || (dist(at, supportTarget) <= UNITS[u.type].w.range * 0.9 && los(view, at, supportTarget)))) {
      const score = dist(at, desired) + dist(at, u) * 0.08 - ((view.flags[c] & COVER) ? 5 : 0) + (danger ? 8 : 0);
      if (score < bestScore) { best = at; bestScore = score; }
    }
    for (const [nx, ny] of [[x-1,y], [x+1,y], [x,y-1], [x,y+1]]) {
      if (nx < 0 || ny < 0 || nx >= view.w || ny >= view.h) continue;
      const n = ny * view.w + nx;
      if (seen.has(n) || view.chars[n] === '?' || (view.flags[n] & mask) || !regionHas(region, { x: (nx + 0.5) * CELL, z: (ny + 0.5) * CELL })
        || Math.abs((view.height?.[n] ?? 0) - (view.height?.[c] ?? 0)) > 1) continue;
      seen.add(n); if (queue.length < ASSAULT_TUNING.searchCells) queue.push(n);
    }
  }
  return best;
}

export function clearAssault(mind, reason = 'handoff') {
  if (mind.assault) { mind.assault.state = 'abandon'; mind.assault.reason = reason; mind.assault.members = []; }
}

// Membership survives each planning look. All returned orders go through the ordinary seat command handle.
export function planAssault(view, slot, mind, situation, level, now, options = {}) {
  const tuning = ASSAULT_TUNING, commands = [], claims = new Set(), me = view.players[slot];
  mind.assaultReleased ??= new Map();
  for (const [id, until] of mind.assaultReleased) if (now >= until) mind.assaultReleased.delete(id);
  const watched = [...me.visible].map(id => view.units.get(id)).filter(e => e && e.hp > 0 && !e.air
    && !UNITS[e.type].structure && knownSince(mind, e.id, now, level.notice));
  let op = mind.assault;
  if (options.handoff) { clearAssault(mind); return { commands, claims }; }
  if (op && !['complete', 'abandon'].includes(op.state)) {
    op.members = op.members.filter(member => {
      const u = view.units.get(member.id);
      if (!u || u.owner !== slot || u.hp <= 0 || u.retreating || options.recovering?.has(u.id) || u.holdPos || u.dig || u.entrench || u.build || u.garrison >= 0 || u.orders.length) return false;
      const goal = u.amove ?? u.path.at(-1);
      if (goal && member.order) {
        if (dist(goal, member.order) > 8) { mind.assaultReleased.set(u.id, now + tuning.cooldown); return false; }
        member.acknowledged = true;
      } else if (member.acknowledged && member.order && dist(u, member.order) > 6 && !u.targetId) { mind.assaultReleased.set(u.id, now + tuning.cooldown); return false; }
      if (dist(u, member.last) > 1 || u.targetId || (member.order && dist(u, member.order) <= 6)) member.progressAt = now;
      member.last = { x: u.x, z: u.z };
      return now - member.progressAt <= tuning.blocked;
    });
    if (!op.members.length) { op.state = 'abandon'; op.reason = 'members-unavailable'; }
    else if (now - op.started > tuning.lifetime) { op.state = 'abandon'; op.reason = 'timeout'; op.members = []; }
    else if (op.point != null && view.points[op.point]?.owner >= 0 && view.players[view.points[op.point].owner]?.team === me.team && !view.points[op.point].cut) {
      op.state = 'complete'; op.members = [];
    } else if (situation?.kind === 'defense' && op.state !== 'withdraw') { clearAssault(mind, 'defense'); }
  }
  const active = op && !['complete', 'abandon'].includes(op.state);
  const objective = situation?.point == null ? null : view.points[situation.point];
  const taken = objective && view.players[objective.owner]?.team === me.team && !objective.cut;
  const defended = !objective || objective.owner >= 0 || watched.some(e => dist(e, objective) < 32);
  // Opening scouts finish neutral captures before a staged assault takes the main force.
  const opening = (!view.mode || view.mode.kind === 'conquest') && now < 180 && view.points.some(p => p.owner < 0);
  if (!active && now >= (mind.assaultCooldown ?? 0) && !opening && !taken && defended && situation?.kind === 'push' && situation.at && now >= level.firstAssault) {
    const candidates = [...view.units.values()].filter(u => u.owner === slot && !UNITS[u.type].structure && !u.air && !UNITS[u.type].naval
      && u.type !== 'engineer' && !UNITS[u.type].medic && !u.retreating && !u.holdPos && !u.dig && !u.entrench && !u.build
      && u.garrison < 0 && !u.orders.length && !u.targetId && valueOf(u) >= UNITS[u.type].cost * 0.65
      && !options.busy?.has(u.id) && !options.recovering?.has(u.id) && !mind.assaultReleased.has(u.id) && !view.points.some(p => view.players[p.owner]?.team === me.team && !p.cut && dist(u, p) < CFG.pointRadius))
      .sort((a,b) => dist(a,situation.at)-dist(b,situation.at) || a.id-b.id);
    const line = candidates.filter(u => !SUPPORT_ROLES.has(u.type)).slice(0, Math.max(2, level.wave));
    const support = candidates.filter(u => SUPPORT_ROLES.has(u.type) && line.length && dist(u, mean(line)) <= 60);
    // Single scouts and unsupported capture squads keep the existing quick orders.
    if (support.length && line.length >= 2) {
      const picked = [...line.slice(0, Math.max(2, level.wave)), ...support.slice(0, 2)], center = mean(picked);
      const range = dist(center, situation.at), step = Math.min(18, Math.max(0, range - 22)), k = step / (range || 1);
      const stage = { x: center.x + (situation.at.x-center.x)*k, z: center.z + (situation.at.z-center.z)*k };
      op = mind.assault = { id: (mind.assaultSerial = (mind.assaultSerial ?? 0) + 1), state: 'assemble', started: now, stateAt: now,
        point: situation.point ?? null, at: { ...situation.at }, stage, initial: picked.length, members: picked.map(u => ({ id: u.id,
          role: SUPPORT_ROLES.has(u.type) ? 'support' : 'line', last: { x: u.x, z: u.z }, progressAt: now, order: null })) };
    }
  }
  if (!op || ['complete', 'abandon'].includes(op.state)) return { commands, claims };
  let members = op.members.map(m => view.units.get(m.id)), center = mean(members);
  const contacts = new Map(watched.map(e => [e.id, e]));
  for (const s of options.sightings ?? view.sightings ?? []) if (!contacts.has(s.id) && now-s.t <= 20 && knownSince(mind,s.id,now,level.notice))
    contacts.set(s.id, { ...s, hp: (s.val ?? UNITS[s.type].cost) / UNITS[s.type].cost * UNITS[s.type].models * UNITS[s.type].hpPer });
  const threats = [...contacts.values()].filter(e => dist(e, center) < 48 || dist(e, op.at) < 32);
  const ownValue = members.reduce((n, u) => n + valueOf(u), 0), enemyValue = threats.reduce((n, u) => n + valueOf(u), 0);
  const anti = members.filter(u => ANTI_ARMOR.has(u.type)).reduce((n, u) => n + valueOf(u), 0);
  const armor = threats.filter(e => ARMOR.has(e.type)).reduce((n, u) => n + valueOf(u), 0);
  const recentlySupported = now - (options.supportAt ?? -Infinity) < 8;
  const mg = threats.some(e => e.type === 'mg'), hasAnswer = recentlySupported || members.some(u => ARMOR.has(u.type) || ['mortar', 'howitzer', 'rocket', 'sniper'].includes(u.type));
  const pressure = enemyValue / Math.max(1, ownValue) * (recentlySupported ? 0.7 : 1);
  const lost = op.initial - members.length, losses = (mind.losses ?? []).filter(l => now - l.t < 12 && dist(l, center) < 40).length;
  const untenable = threats.length && (pressure > tuning.withdraw || armor > anti * 1.4 + (recentlySupported ? ownValue * 0.8 : 0) + 1
    || (mg && !hasAnswer && enemyValue > ownValue * 0.65) || (lost + losses >= Math.ceil(op.initial / 3) && pressure > 0.75));
  const change = state => { op.state = state; op.stateAt = now; for (const m of op.members) m.progressAt = now; };
  if (op.state !== 'withdraw' && untenable) {
    change('withdraw'); op.reason = armor > anti * 1.4 + 1 ? 'armor' : mg && !hasAnswer ? 'machine-gun' : 'losses';
    mind.assaultCooldown = now + tuning.cooldown;
  }
  if (op.state === 'assemble' && (now-op.stateAt >= tuning.assemble || op.members.every(m => m.order && dist(view.units.get(m.id), m.order) < 6))) change('advance');
  if (op.state === 'advance' && (threats.some(e => dist(e, center) < 36) || dist(center, op.at) < 18)) change('engage');
  if (op.state === 'engage' && !threats.length && dist(center, op.at) > 18) change('advance');
  if (op.state === 'engage' && members.some(u => dist(u, center) > 22) && now-op.stateAt > 4) { op.stage = backFrom(center, me.spawn, 12); change('regroup'); }
  if (op.state === 'regroup' && now-op.stateAt >= tuning.regroup) {
    op.members = op.members.filter(m => dist(view.units.get(m.id), op.stage) < 22);
    if (!op.members.length) { clearAssault(mind, 'regroup-blocked'); return { commands, claims }; }
    change('advance'); members = op.members.map(m => view.units.get(m.id)); center = mean(members);
  }
  if (op.state === 'withdraw' && now >= mind.assaultCooldown) {
    if (pressure < tuning.resume && !untenable) { op.stage = center; change('regroup'); }
    else { clearAssault(mind, 'withdrawn'); mind.assaultCooldown = now + tuning.cooldown; return { commands, claims }; }
  }
  for (const member of op.members) {
    const u = view.units.get(member.id); claims.add(u.id);
    const withdrawing = op.state === 'withdraw', staging = op.state === 'assemble' || op.state === 'regroup';
    const desired = withdrawing ? backFrom(center, me.spawn, 24) : staging ? (member.role === 'support' ? backFrom(op.stage, me.spawn, tuning.supportRear) : op.stage)
      : member.role === 'support' ? backFrom(op.at, center, Math.max(tuning.supportRear, Math.min(24, UNITS[u.type].w.range * 0.55))) : op.at;
    const roleTarget = !withdrawing && !staging && member.role === 'support' && threats[0];
    const at = operationPosition(view, u, desired, threats, withdrawing, options.region, roleTarget);
    if (!at) { if (withdrawing) commands.push({ t: 'retreat', ids: [u.id] }); continue; }
    const kind = withdrawing || staging || member.role === 'support' ? 'move' : 'amove';
    if (dist(u, at) <= 3 || (member.order && dist(member.order, at) < 3 && (u.path.length || u.amove))) continue;
    member.order = { ...at }; member.placement = { ...at }; member.acknowledged = true;
    commands.push({ t: kind, orders: [[u.id, at.x, at.z]] });
  }
  return { commands, claims };
}
