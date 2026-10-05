// Measures a map's layout the way RTS map makers do: node tools/mapstats.mjs [map names...] (default: all)
// Walking distances by infantry (8 directions; houses, water, cliffs block; a ford cell costs 3), over the spawns every mode uses,
// each player for themselves.
//   rush     shortest spawn-to-enemy-spawn walk (cells), and max/min over spawns: 1.00 is perfectly even
//   home     points per side that are safely its own (Liapis safety s > 0.35: the enemy walks 2x further): min-max
//   contest  points no side owns (every side's safety under 0.1): the ones the fight should be about
//   share    VP each spawn would hold if every point went to whoever walks there first (within 5% is a tie, split): min-max %
//   lanes    separate routes between enemy spawns at most 1.35x the shortest (a route blocks a 4-cell band for the next)
//   choke    narrowest gap along the shortest route between enemy spawns, in cells: at each cell of the route the
//            shortest passable run through it across 4 axes (Togelius et al.); under 6 is a funnel a few guns can hold
//   dead     share of walkable ground more than a quarter of the rush walk from every point and spawn
//   bare     longest stretch of the shortest route with no cover within 2 cells (a killing field), in cells, past
//            8 cells from either HQ
//   cover    share of cells that give cover, sight blockers, impassable, open
import { readFileSync, readdirSync } from 'node:fs';
import { TERRAIN, MOVE, COVER, SIGHT, FORD, levelOf, spawnsFor, spawnSlots } from '../shared/sim.js';

// Walking over a map: walk(cells) gives each cell's distance from the nearest of them and the way back (from)
export function walker(m) {
  const { w, h } = m, N = w * h, chars = m.rows.join(''), lv = m.heights ? [...m.heights.join('')].map(levelOf) : null;
  const flag = (c) => TERRAIN[chars[c]] ?? 0;
  // ponytail: Dijkstra with a bucket queue on tenths of a cell, 8 directions like the game's pathfinder; fine up to 512x512
  const open = (c, n, blocked) => !(flag(n) & MOVE) && !blocked?.[n] && !(lv && Math.abs(lv[n] - lv[c]) > 1);
  const walk = (src, blocked = null) => {
    const d = new Float64Array(N).fill(Infinity), from = new Int32Array(N).fill(-1), q = [[].concat(src)];
    for (const c of q[0]) d[c] = 0;
    for (let k = 0; k < q.length; k++) for (const c of q[k] ?? []) {
      if (d[c] * 10 !== k) continue;
      const x = c % w, y = (c - x) / w;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy, n = ny * w + nx;
        if ((!dx && !dy) || nx < 0 || ny < 0 || nx >= w || ny >= h || !open(c, n, blocked)) continue;
        if (dx && dy && (!open(c, c + dx, blocked) || !open(c, c + dy * w, blocked))) continue; // no corner cutting
        const nd = k + (dx && dy ? 14 : 10) * (flag(n) & FORD ? 3 : 1);
        if (nd < d[n] * 10) { d[n] = nd / 10; from[n] = c; (q[nd] ??= []).push(n); }
      }
    }
    return { d, from };
  };
  const cellOf = (p) => p.y * w + p.x, path = (from, c) => { const out = []; for (; c >= 0; c = from[c]) out.push(c); return out; };
  const near = (c, r, test) => { const x0 = c % w, y0 = (c - x0) / w; for (let y = y0 - r; y <= y0 + r; y++) for (let x = x0 - r; x <= x0 + r; x++) if (x >= 0 && y >= 0 && x < w && y < h && test(y * w + x)) return true; return false; };
  // cover within 2 cells: anything that gives it, or a house or cliff-free wall to get behind (water and fords don't)
  const covered = (c) => near(c, 2, n => flag(n) & (COVER | MOVE) && !(flag(n) & FORD) && chars[n] !== 'W');
  return { w, h, N, chars, lv, flag, open, walk, cellOf, path, near, covered };
}

// teams: 0 = each spawn for itself, 2 = two teams seated the way the game seats them
export function stats(m, teams = 0) {
  const { w, h, N, chars, flag, open, walk, cellOf, path, covered } = walker(m);
  const sp = spawnsFor(m, 'conquest').map(i => m.spawns[i]), fields = sp.map(s => walk(cellOf(s)));
  const side = sp.map((_, i) => i);
  if (teams) {
    const seats = spawnSlots(sp.length, sp.map((_, i) => i % teams), false, sp.map((_, i) => sp.map(t => fields[i].d[cellOf(t)])));
    seats.forEach((s, player) => { side[s] = player % teams; });
  }
  const sides = [...new Set(side)], foe = (i, j) => side[i] !== side[j];
  const rushes = sp.map((s, i) => Math.min(...sp.map((t, j) => (!foe(i, j) ? Infinity : fields[i].d[cellOf(t)]))));
  const home = sides.map(() => 0); let contest = 0;
  const share = sides.map(() => 0), vpAll = m.points.reduce((a, p) => a + (p.vp ?? 1), 0);
  for (const p of m.points) {
    const ds = sides.map(t => Math.min(...fields.filter((_, i) => side[i] === t).map(f => f.d[cellOf(p)])));
    const best = Math.min(...ds), tie = (v) => v <= best * 1.05 + 1, win = ds.filter(tie).length;
    const safety = ds.map((v, i) => Math.min(...ds.filter((_, j) => j !== i).map(e => Math.max(0, (e - v) / (e + v)))));
    safety.forEach((s, i) => { if (s > 0.35) home[i]++; });
    if (Math.max(...safety) < 0.1) contest++;
    ds.forEach((v, i) => { if (tie(v)) share[i] += (p.vp ?? 1) / win; });
  }
  // routes and bare stretches between the two spawns that are furthest apart by walk, and every nearest pair
  // the passable run through c along (dx, dy), stopping at whatever stops a walk (a cliff step included), capped at 30
  const span = (c, dx, dy) => {
    let n = 1;
    for (const sgn of [1, -1]) for (let x = c % w, y = (c - x) / w, k = 0; k < 15; k++) {
      const nx = x + sgn * dx, ny = y + sgn * dy, nc = ny * w + nx;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h || !open(y * w + x, nc)) break;
      x = nx; y = ny; n++;
    }
    return n;
  };
  let lanes = Infinity, bare = 0, choke = Infinity;
  sp.forEach((s, i) => {
    const j = sp.findIndex((t, k) => foe(i, k) && fields[i].d[cellOf(t)] === rushes[i]);
    if (j < i) return;
    const first = path(fields[i].from, cellOf(sp[j])), blocked = new Uint8Array(N);
    let run = 0;
    const home = (c) => sp.some(q => Math.hypot(q.x - c % w, q.y - Math.floor(c / w)) < 8); // an HQ's doorstep stays clear
    for (const c of first) { run = covered(c) || home(c) ? 0 : run + 1; bare = Math.max(bare, run); }
    const width = (c) => Math.min(...[[1, 0], [0, 1], [1, 1], [1, -1]].map(([dx, dy]) => Math.round(span(c, dx, dy) * (dx && dy ? 1.41 : 1))));
    first.forEach((c, k) => { if (k > 8 && k < first.length - 8) choke = Math.min(choke, width(c)); });
    let count = 0, route = first;
    for (; count < 4 && route.length && route.length <= 1.35 * first.length; count++) {
      // block the route except near both ends, so the next route has to leave it
      route.forEach((c, k) => { if (k > 6 && k < route.length - 6) for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) { const n = c + y * w + x; if (n >= 0 && n < N) blocked[n] = 1; } });
      const f = walk(cellOf(s), blocked), t = cellOf(sp[j]);
      route = f.d[t] < Infinity ? path(f.from, t) : [];
    }
    lanes = Math.min(lanes, count);
  });
  const reach = walk([...sp, ...m.points].map(cellOf)).d, quarter = 0.25 * Math.min(...rushes);
  let deadN = 0, walkN = 0;
  for (let c = 0; c < N; c++) if (fields[0].d[c] < Infinity) { walkN++; if (reach[c] > quarter) deadN++; }
  let cov = 0, sight = 0, wall = 0;
  for (let c = 0; c < N; c++) { const f = flag(c); if (f & COVER) cov++; if (f & SIGHT || chars[c] === 'O') sight++; if (f & MOVE) wall++; }
  const pct = (v) => Math.round(100 * v / N), even = (a) => (Math.max(...a) / Math.min(...a)).toFixed(2);
  return {
    size: `${w}x${h}`, spawns: teams ? `${sp.length} in ${teams}` : sp.length, points: m.points.length,
    rush: Math.min(...rushes), rushEven: even(rushes),
    home: `${Math.min(...home)}-${Math.max(...home)}`, contest,
    share: `${Math.round(100 * Math.min(...share) / vpAll)}-${Math.round(100 * Math.max(...share) / vpAll)}`,
    lanes, choke, dead: Math.round(100 * deadN / walkN), bare, cover: pct(cov), sight: pct(sight), blocked: pct(wall), open: pct(N - cov - wall),
  };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  const dir = new URL('../maps/', import.meta.url), names = process.argv.slice(2);
  const files = names.length ? names.map(n => n + '.json') : readdirSync(dir).filter(f => f.endsWith('.json') && f !== 'three-islands.json');
  const rows = {};
  for (const f of files) {
    const m = JSON.parse(readFileSync(new URL(f, dir), 'utf8')), n = spawnsFor(m, 'conquest').length, name = f.replace('.json', '');
    if (n !== 4) rows[name] = stats(m); // 4 spawns play as 2v2; 2, 3, 5 and 6 as a free-for-all too
    if (n % 2 === 0 && n > 2) rows[name + (n === 4 ? '' : ' (teams)')] = stats(m, 2);
  }
  console.table(rows);
}
