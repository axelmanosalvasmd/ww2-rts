// Simple AI player. Runs on the server every couple of seconds and plays through command(),
// exactly like a human would. It only reacts to enemies its own player can see.
import { UNITS, CELL, CFG, COVER, MOVE, command } from './sim.js';

const d = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

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

  const orders = [];
  for (const u of mine) {
    if (u.path.length || u.attackId) continue;
    const def = UNITS[u.type];
    // badly hurt and pinned: fall back to spawn
    if (u.hp < def.models * def.hpPer * 0.3 && u.supp >= 50 && d(u, me.spawn) > 15) { orders.push([u.id, me.spawn.x, me.spawn.z]); continue; }
    if (u.targetId) continue; // in a fight: hold
    const here = pointOf(u);
    // infantry stays to capture, and one squad stays behind to hold each captured point
    if (here >= 0 && def.infantry && (g.points[here].owner !== slot || holding[here]++ === 0)) continue;
    // otherwise go for the closest point we don't hold, spreading out across targets
    let best = -1, bestScore = Infinity;
    g.points.forEach((p, i) => {
      if (p.owner === slot) return;
      const score = d(u, p) + load[i] * 40;
      if (score < bestScore) { bestScore = score; best = i; }
    });
    if (best < 0) continue; // we hold everything: stay put
    load[best]++;
    const s = spotNear(g, g.points[best]);
    orders.push([u.id, s.x, s.z]);
  }
  if (orders.length) command(g, slot, { t: 'move', orders });
}
