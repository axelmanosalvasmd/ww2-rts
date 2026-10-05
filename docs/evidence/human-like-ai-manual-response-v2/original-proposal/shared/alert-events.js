// Shared alert rules consume delivered snapshots only. Presentation stays in client/alerts.js.
import { UNITS, SUPPORT } from './sim.js';
import { insideKnownRegion } from './world-territories.js';

const ATTACK_EVERY = 20, AREA = 30, MERGE = 2, AIR_MARGIN = 25, HOME_RADIUS = 20, BASE_RADIUS = 40;
const NOT_AIR = new Set(['artillery', 'smoke', 'cover']);
const near = (a, b, r) => Math.hypot(a.x - b.x, a.z - b.z) <= r;

// cluster spots that are within AREA of the first one in each group
function groups(list) {
  const out = [];
  for (const it of list) {
    const g = out.find(g => near(g[0], it, AREA));
    if (g) g.push(it); else out.push([it]);
  }
  return out;
}
const mid = (g) => ({ x: g.reduce((s, v) => s + v.x, 0) / g.length, z: g.reduce((s, v) => s + v.z, 0) / g.length });

// Compare this snapshot with the one before it and raise whatever alerts follow.
export function deriveAlertEvents(s, prev, hooks, state = {}) {
  if (!hooks || !Number.isFinite(s.tick) || s.tick <= (state.tick ?? -1)) return [];
  state.tick = s.tick;
  if (!prev) return [];
  const events = [], time = hooks.clock?.() ?? s.tick / 20;
  state.quiet = (state.quiet ?? []).filter(q => q.until > time);
  state.losses = (state.losses ?? []).filter(q => time - q.born < MERGE);
  const push = (kind, text, x, z, n = 1, extra = {}) => {
    const event = { id: `${s.tick}:${state.serial = (state.serial ?? 0) + 1}`, kind, text, x, z, n, tick: s.tick, onScreen: x != null && !!hooks.onScreen?.(x, z), ...extra };
    events.push(event); return event;
  };
  const underAttack = (at, text, kind = 'attack') => {
    if (state.quiet.some(q => near(q, at, AREA)) || hooks.onScreen?.(at.x, at.z)) return;
    state.quiet.push({ x: at.x, z: at.z, until: time + ATTACK_EVERY });
    push(kind, text, at.x, at.z);
  };
  const me = hooks.me(), friend = (slot) => slot >= 0 && hooks.friend(slot);
  if (s.winner != null || s.out?.[me]) return [];
  // the map's scripted events (triggers) speak to everyone
  for (const sh of s.shots ?? []) if (sh.k === 'say') push('event', sh.localized?.[hooks.language?.() ?? 'en'] ?? sh.text, sh.x, sh.z);
  const before = new Map(prev.units.map(u => [u[0], u]));
  const after = new Map(s.units.map(u => [u[0], u]));
  const shotsAt = new Map();
  for (const sh of s.shots ?? []) if (sh.t) { if (!shotsAt.has(sh.t)) shotsAt.set(sh.t, []); shotsAt.get(sh.t).push(sh); }
  const nameOf = (type, owner) => (owner === me ? '' : 'Allied ') + hooks.unitName(type, owner);

  // under attack: your units and buildings, an allied HQ or bunker, losing health to something that isn't friendly
  const hits = [];
  for (const [id, u] of after) {
    const p = before.get(id), [, type, owner, x, z, , , hp] = u, def = UNITS[type];
    if (!p || !def || p[2] !== owner || hp >= p[7]) continue;
    if (owner !== me && !(friend(owner) && (type === 'hq' || type === 'bunker'))) continue;
    const by = shotsAt.get(id) ?? [];
    if (by.length && by.every(q => q.fo != null && friend(q.fo))) continue; // your own side's fire
    if (!by.length && s.mode?.suddenDeath && def.produces) continue;         // Sudden Death crumbling, not an enemy
    hits.push({ type, owner, x, z });
  }
  for (const g of groups(hits)) {
    const big = g.find(h => UNITS[h.type].structure);
    const text = big ? `${nameOf(big.type, big.owner)} under attack`
      : g.length === 1 ? `${nameOf(g[0].type, g[0].owner)} under attack` : 'Units under attack';
    const at = big ?? mid(g), home = hooks.home();
    if (home && (near(at, home, BASE_RADIUS) || big?.owner === me)) underAttack(at, 'Our base is under attack!', 'base');
    else underAttack(at, text);
  }

  // points: captured, lost, or an enemy standing on one of yours
  s.points.forEach(([owner, , prog], i) => {
    const was = prev.points[i], at = hooks.pointPos(i);
    if (!was || !at) return;
    const had = friend(was[0]), has = friend(owner);
    if (had && !has) push('pointLost', 'Point lost', at.x, at.z);
    else if (!had && has) push('pointWon', owner === me ? 'Point captured' : `${hooks.playerName(owner)} captured a point`, at.x, at.z);
    else if (has && prog < was[2]) underAttack(at, 'Point under attack');
    else if (has && s.points[i][4] && !was[4]) push('pointLost', 'Point cut off: it pays nothing until the road to it is open', at.x, at.z);
  });

  // Region ownership is a team id. Compare only regions present in both received snapshots.
  if (s.world) {
    const oldRegions = new Map((prev.world?.regions ?? []).map(r => [r.id, r]));
    const home = s.world.home ?? s.home, oldHome = prev.world?.home ?? prev.home;
    const homeTeam = (regions, at) => at && regions.find(r => r.team >= 0 && insideKnownRegion(r,{x:at[0],z:at[1]}))?.team;
    const team = hooks.team?.() ?? homeTeam(s.world.regions ?? [], home) ?? homeTeam(prev.world?.regions ?? [], oldHome);
    for (const r of s.world.regions ?? []) {
      const was = oldRegions.get(r.id);
      if (!was || !Number.isFinite(r.x) || !Number.isFinite(r.z)) continue;
      const had = team !== undefined && was.team === team, has = team !== undefined && r.team === team;
      if (had && !has) push('pointLost', `Region lost: ${r.name}`, r.x, r.z);
      else if (!had && has) push('pointWon', `Region claimed: ${r.name}`, r.x, r.z);
      else if (r.contested && !was.contested && (has || friend(r.capper)))
        push('attack', `Claim contested: ${r.name}`, r.x, r.z);
      else if (has && (r.progress < was.progress || (r.capper >= 0 && !friend(r.capper))))
        underAttack(r, `Region under attack: ${r.name}`);
    }
  }

  // unit lost: one of yours left the snapshot (your units are always in it while they exist)
  const gone = [];
  for (const [id, p] of before) {
    if (after.has(id)) continue;
    const [, type, owner, x, z, , , , , , , , flags, , built] = p;
    if (owner !== me || !UNITS[type]) continue;
    if (!shotsAt.get(id)?.some(q => q.kill)) {
      if ((built ?? 1) < 1) continue; // a site you cancelled
      const home = hooks.home();
      if (flags & 1 && home && near({ x, z }, home, HOME_RADIUS)) continue; // retreated off the field, not killed
    }
    gone.push({ type, x, z });
  }
  for (const g of groups(gone)) {
    const at = mid(g), t = time;
    const recent = state.losses.find(a => a.kind === 'unitLost' && t - a.born < MERGE && near(a, at, AREA));
    const n = g.length + (recent?.n ?? 0);
    const text = n > 1 ? `${n} units lost` : UNITS[g[0].type].structure ? `${hooks.unitName(g[0].type, me)} destroyed` : `${hooks.unitName(g[0].type, me)} lost`;
    if (recent) state.losses.splice(state.losses.indexOf(recent), 1);
    const event = push('unitLost', text, at.x, at.z, n, { mergeId: recent?.id });
    state.losses.unshift({ ...event, born: t });
  }

  // enemy Air Support incoming: a new enemy strike mark (strikes are public) near anything of your side's
  const seen = new Set((prev.strikes ?? []).map(([kind, x, z]) => `${kind},${x},${z}`));
  for (const [kind, x, z, , , owner] of s.strikes ?? []) {
    if (seen.has(`${kind},${x},${z}`) || NOT_AIR.has(kind) || friend(owner)) continue;
    const sp = SUPPORT[kind], reach = (sp?.len ? sp.len / 2 : sp?.radius ?? 20) + AIR_MARGIN, at = { x, z };
    const mine = s.units.some(u => friend(u[2]) && near({ x: u[3], z: u[4] }, at, reach))
      || s.points.some(([o], i) => friend(o) && hooks.pointPos(i) && near(hooks.pointPos(i), at, reach))
      || (hooks.home() && near(hooks.home(), at, reach));
    if (mine) push('air', `Enemy ${sp?.name ?? kind} incoming`, x, z);
  }

  // Classic: a unit out of a Production Building's queue, a building finished
  const heads = [];
  for (const [id, , , , head] of prev.queues ?? []) if (head && after.has(id)) heads.push(head);
  for (const [id, u] of after) {
    const [, type, owner, x, z] = u;
    if (owner !== me || !UNITS[type]) continue;
    const p = before.get(id);
    if (!p) {
      const i = heads.indexOf(type);
      if (i >= 0 && !UNITS[type].structure) { heads.splice(i, 1); push('ready', `${hooks.unitName(type, me)} ready`, x, z); }
    } else if (UNITS[type].building && (p[14] ?? 1) < 1 && (u[14] ?? 1) >= 1) push('ready', `${hooks.unitName(type, me)} finished`, x, z);
  }
  return events;
}
