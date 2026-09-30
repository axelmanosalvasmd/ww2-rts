// Simple AI player. Runs on the server every couple of seconds and plays through command(),
// exactly like a human would. It only reacts to enemies its own player can see.
import { UNITS, SUPPORT, CELL, CFG, COVER, MOVE, TRENCH, command, inCover } from './sim.js';

const d = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

function trenchesNear(g, p, r) {
  let n = 0;
  for (let y = Math.floor((p.z - r) / CELL); y <= (p.z + r) / CELL; y++)
    for (let x = Math.floor((p.x - r) / CELL); x <= (p.x + r) / CELL; x++)
      if (x >= 0 && y >= 0 && x < g.w && y < g.h && g.flags[y * g.w + x] & TRENCH) n++;
  return n;
}

// a random cover cell near the point, so squads dig in instead of standing in the open
function spotNear(g, p) {
  const r = Math.floor((CFG.pointRadius - 2) / CELL), cx = Math.floor(p.x / CELL), cy = Math.floor(p.z / CELL), cover = [];
  for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
    const f = g.flags[y * g.w + x];
    if (x >= 0 && y >= 0 && x < g.w && y < g.h && f & COVER && !(f & MOVE)) cover.push({ x: (x + 0.5) * CELL, z: (y + 0.5) * CELL });
  }
  if (cover.length) return cover[Math.floor(Math.random() * cover.length)];
  const a = Math.random() * Math.PI * 2;
  return { x: p.x + Math.cos(a) * 4, z: p.z + Math.sin(a) * 4 };
}

export function think(g, slot) {
  const me = g.players[slot];
  const mine = [...g.units.values()].filter(u => u.owner === slot);
  const count = (t) => mine.filter(u => u.type === t).length;
  const seenTanks = [...me.visible].filter(id => g.units.get(id)?.type === 'tank').length;

  // shopping: counter tanks it has seen, get one tank once the infantry is out, else 2 rifles per MG
  const want = seenTanks > count('at') ? 'at' : count('tank') < 1 && mine.length >= 4 ? 'tank' : count('mg') * 2 < count('rifle') ? 'mg' : 'rifle';
  if (me.mp >= UNITS[want].cost) command(g, slot, { t: 'buy', unit: want });

  // how many of my units are at or heading to each point
  const pointOf = (pos) => g.points.findIndex(p => d(pos, p) <= CFG.pointRadius);
  const load = g.points.map(() => 0), holding = g.points.map(() => 0);
  for (const u of mine) {
    const i = pointOf(u.path.length ? u.path.at(-1) : u);
    if (i >= 0) load[i]++;
  }

  const orders = [], retreat = [], pending = g.points.map(() => []), heading = [...load];
  const enemies = [...me.visible].map(id => g.units.get(id)).filter(Boolean);

  // off-map support, keeping 100 MP back so reinforcing never stalls
  const can = (k) => me.sup[k] <= 0 && me.mp >= SUPPORT[k].cost + 100;
  const cluster = (min, r, test = () => true) => {
    for (const e of enemies) {
      const near = enemies.filter(o => test(o) && d(o, e) <= r);
      if (near.length >= min) return { x: near.reduce((a, o) => a + o.x, 0) / near.length, z: near.reduce((a, o) => a + o.z, 0) / near.length };
    }
  };
  const call = (kind, at, dir) => at && command(g, slot, { t: 'support', kind, x: at.x, z: at.z, dir });
  if (can('artillery')) call('artillery', cluster(2, 8) || enemies.find(e => (e.type === 'mg' || e.type === 'at') && e.still > 3));
  else if (can('strafe')) call('strafe', cluster(2, 10, o => UNITS[o.type].infantry));
  if (can('recon') && !enemies.length && me.mp > 250) call('recon', g.points.find(p => p.owner >= 0 && p.owner !== slot));
  for (const u of mine) {
    const def = UNITS[u.type], frac = u.hp / (def.models * def.hpPer), home = d(u, me.spawn) <= CFG.reinforceRadius;
    if (u.retreating) continue;

    // abilities
    const target = g.units.get(u.targetId);
    if (u.cd <= 0) {
      if (def.ab.id === 'grenade') {
        // lob it at a dug-in MG or AT gun, or any squad sitting in cover
        const t = enemies.find(e => UNITS[e.type].infantry && d(u, e) <= def.ab.range + 4 && (e.type !== 'rifle' || inCover(g, e)));
        if (t) command(g, slot, { t: 'ability', ids: [u.id], x: t.x, z: t.z });
      } else if (def.ab.id === 'suppress' && target) command(g, slot, { t: 'ability', ids: [u.id] });
      else if (def.ab.id === 'ap' && target?.type === 'tank') command(g, slot, { t: 'ability', ids: [u.id] });
      else if (def.ab.id === 'smoke' && frac < 0.5 && !home) command(g, slot, { t: 'ability', ids: [u.id] });
    }
    // save hurt units instead of letting them die: retreat, get reinforced, come back
    if (!home && (frac < 0.35 || (u.supp >= 90 && frac < 0.6))) { retreat.push(u.id); continue; }
    if (home && frac < 1 && me.mp >= 20) continue; // wait for reinforcements
    if (u.path.length || u.attackId || u.nade || u.dig) continue;
    if (u.targetId) continue; // in a fight: hold
    const here = pointOf(u);
    // infantry stays to capture, and one squad stays behind to hold each captured point (and digs in)
    if (here >= 0 && def.infantry) {
      const p = g.points[here];
      if (p.owner !== slot) continue;
      if (holding[here]++ === 0) {
        if (u.type === 'rifle' && !u.dig && me.mp >= CFG.digCost + 150 && trenchesNear(g, p, CFG.pointRadius + 4) < 6) {
          // dig a line between the point and the closest enemy HQ
          const foe = g.players.filter(q => q.slot !== slot).sort((a, b) => d(a.spawn, p) - d(b.spawn, p))[0].spawn, l = d(foe, p) || 1;
          command(g, slot, { t: 'dig', ids: [u.id], x: p.x + (foe.x - p.x) / l * 5, z: p.z + (foe.z - p.z) / l * 5, dir: Math.atan2(foe.z - p.z, foe.x - p.x) + Math.PI / 2 });
        }
        continue;
      }
    }
    // otherwise go for the closest point we don't hold, spreading out across targets
    let best = -1, bestScore = Infinity;
    g.points.forEach((p, i) => {
      if (p.owner === slot) return;
      // the center is worth double VP, villages feed manpower
      const score = d(u, p) + load[i] * 40 - (p.vp - 1) * 25 - p.mp * 10;
      if (score < bestScore) { bestScore = score; best = i; }
    });
    if (best < 0) continue; // we hold everything: stay put
    load[best]++;
    pending[best].push(u);
  }
  // grab neutral points with whoever is free, but only hit enemy-held points as a group
  const need = Math.min(3, mine.length);
  pending.forEach((group, i) => {
    const p = g.points[i];
    if (p.owner >= 0 && p.owner !== slot && group.length + heading[i] < need) return;
    // screen the assault on a held point with smoke, 60% of the way in
    if (p.owner >= 0 && p.owner !== slot && group.length && can('smoke')) {
      const cx = group.reduce((a, u) => a + u.x, 0) / group.length, cz = group.reduce((a, u) => a + u.z, 0) / group.length;
      call('smoke', { x: cx + (p.x - cx) * 0.6, z: cz + (p.z - cz) * 0.6 }, Math.atan2(p.z - cz, p.x - cx) + Math.PI / 2); // wall across the approach
    }
    for (const u of group) { const s = spotNear(g, p); orders.push([u.id, s.x, s.z]); }
  });
  if (retreat.length) command(g, slot, { t: 'retreat', ids: retreat });
  if (orders.length) command(g, slot, { t: 'move', orders });
}
