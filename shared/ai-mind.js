// What one seat has decided and what it has learned this match.
// Fed only from that seat's view (the same facts a player in the seat would have) and from its private memory.
// Nothing here reads hidden units, hidden mines, or another seat's economy.
import { UNITS, CFG } from './sim.js';

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
    mind.roster.delete(id);
  }
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
export const ARMOR = new Set(['tank', 'medium', 'tiger']);
export const ANTI_ARMOR = new Set(['at', 'tank', 'medium', 'tiger', 'rocket']);

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
