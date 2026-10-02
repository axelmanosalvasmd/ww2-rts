// Reworks finished maps by the RTS map-design rules measured in tools/mapstats.mjs: node tools/mapwork.mjs default ...
// 1. Killing fields: along every walk from a spawn to each point and enemy spawn, and from each point to its nearest,
//    a stretch of 12+ cells with no cover within 2 gets a pair of shell holes (+) on both sides of the route, every
//    third pair a pair of bushes (H) that also breaks the sight line. Nothing goes within 8 cells of a spawn (an HQ's
//    doorstep stays clear), and shell holes only on flat ground away from water.
// 2. Home points: on Conquest maps without defenders that have room (at most 9 points), each spawn gets a point of its
//    own (vp 0, mp 1) about a third of the way to the nearest enemy, where the enemy walks over twice as far
//    (Liapis safety > 0.35), toward the front (own walk + enemy walk at most 1.2x the rush walk, 6+ cells in from the edge) but off the main
//    route, so a raid on it is a choice.
// Everything placed is copied through the map's own symmetry (point mirror, or rotation about the spawns' center), so
// a fair map stays fair. Run it once per map after the generators and tools/roads.mjs; running it again adds little.
import { readFileSync, writeFileSync } from 'node:fs';
import { validateMap, spawnsFor, spawnSlots, MOVE } from '../shared/sim.js';
import { walker, stats } from './mapstats.mjs';

const GAP = 12, KEEP = 8;

// the map's symmetries: transforms (x, y) -> [x, y] that send spawns to spawns and most features onto the same feature
function symmetries(m, sp) {
  const cx = sp.reduce((a, s) => a + s.x, 0) / sp.length, cy = sp.reduce((a, s) => a + s.y, 0) / sp.length;
  const rot = (deg) => { const c = Math.cos(deg * Math.PI / 180), s = Math.sin(deg * Math.PI / 180); return (x, y) => [Math.round(cx + (x - cx) * c - (y - cy) * s), Math.round(cy + (x - cx) * s + (y - cy) * c)]; };
  const candidates = [(x, y) => [m.w - 1 - x, m.h - 1 - y], (x, y) => [m.w - 1 - x, y], (x, y) => [x, m.h - 1 - y], ...[2, 3, 4, 6].flatMap(n => Array.from({ length: n - 1 }, (_, k) => rot(360 * (k + 1) / n)))];
  const fits = (t) => {
    if (!sp.every(s => { const [x, y] = t(s.x, s.y); return sp.some(o => Math.hypot(o.x - x, o.y - y) <= 2); })) return false;
    let same = 0, all = 0;
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (m.rows[y][x] !== '.') {
      const [tx, ty] = t(x, y); all++;
      if (m.rows[ty]?.[tx] === m.rows[y][x]) same++;
    }
    return same >= 0.6 * all;
  };
  return [(x, y) => [x, y], ...candidates.filter(fits)];
}

export function rework(m) {
  const sp = spawnsFor(m, 'conquest').map(i => m.spawns[i]), sym = symmetries(m, sp), g = m.rows.map(r => [...r]);
  let W = walker(m);
  const live = () => { m.rows = g.map(r => r.join('')); W = walker(m); };
  const nearSpawn = (x, y) => sp.some(s => Math.hypot(s.x - x, s.y - y) < KEEP);
  const onPoint = (x, y) => m.points.some(p => Math.abs(p.x - x) <= 1 && Math.abs(p.y - y) <= 1);
  // a shell hole is dug into the ground mesh, so it only goes on flat ground away from banks (else the relief tears)
  const lvAt = (x, y) => (m.heights ? m.heights[y]?.[x] : '0');
  const flat = (x, y) => [-1, 0, 1].every(dy => [-1, 0, 1].every(dx => lvAt(x + dx, y + dy) === lvAt(x, y) && !'WF='.includes(g[y + dy]?.[x + dx] ?? 'W')));
  const put = (x, y, ch) => sym.forEach(t => { const [tx, ty] = t(x, y); if (g[ty]?.[tx] === '.' && !nearSpawn(tx, ty) && !onPoint(tx, ty) && (ch !== '+' || flat(tx, ty))) g[ty][tx] = ch; });

  // 2. home points first, so the cover pass also covers the walks to them
  const added = [];
  if (!m.defend && sp.length <= 4 && m.points.length + sp.length <= 9) {
    const teams = sp.length === 4 ? 2 : 0, fields = sp.map(s => W.walk(W.cellOf(s)));
    const side = sp.map((_, i) => i);
    if (teams) spawnSlots(4, [0, 1, 0, 1], false, sp.map((_, i) => sp.map(t => fields[i].d[W.cellOf(t)]))).forEach((s, p) => { side[s] = p % 2; });
    const homes = sp.map(() => null);
    sp.forEach((s, i) => {
      if (homes[i]) return;
      const foes = fields.filter((_, j) => side[j] !== side[i]), D = Math.min(...foes.map(f => f.d[W.cellOf(s)]));
      const enemyWalk = (c) => Math.min(...foes.map(f => f.d[c]));
      const route = new Set(W.path(foes.find(f => f.d[W.cellOf(s)] === D).from, W.cellOf(s)));
      const off = W.walk([...route]).d;
      const clear = (x, y) => { for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const c = (y + dy) * m.w + x + dx; if (x + dx < 0 || y + dy < 0 || x + dx >= m.w || y + dy >= m.h || W.flag(c) & MOVE || W.chars[c] === 'F') return false; } return true; };
      const free = (x, y) => [...m.points, ...sp, ...added].every(p => Math.hypot(p.x - x, p.y - y) >= 14);
      const ok = (x, y) => { const c = y * m.w + x, d = fields[i].d[c], e = enemyWalk(c); return d < Infinity && (e - d) / (e + d) > 0.35 && d + e <= 1.2 * D && x >= 6 && y >= 6 && x < m.w - 6 && y < m.h - 6 && clear(x, y) && free(x, y); };
      let best = null, bestScore = Infinity;
      for (let y = 2; y < m.h - 2; y++) for (let x = 2; x < m.w - 2; x++) {
        const c = y * m.w + x, d = fields[i].d[c];
        if (Math.abs(d - 0.35 * D) > 0.1 * D || !ok(x, y)) continue;
        const score = Math.abs(d - 0.35 * D) - 0.5 * Math.min(off[c], 6);
        if (score < bestScore) { bestScore = score; best = { x, y }; }
      }
      if (!best) return;
      // copy it to every spawn the symmetry sends this one to, nudged onto valid ground if rounding missed
      sym.forEach(t => {
        const [sx, sy] = t(s.x, s.y), j = sp.findIndex(o => Math.hypot(o.x - sx, o.y - sy) <= 2);
        if (homes[j]) return;
        const [hx, hy] = t(best.x, best.y);
        const spot = [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]].map(([dx, dy]) => ({ x: hx + dx, y: hy + dy })).find(p => ok(p.x, p.y) || (j !== i && clear(p.x, p.y) && free(p.x, p.y)));
        if (spot) { homes[j] = spot; added.push(spot); }
      });
    });
    for (const p of added) m.points.push({ x: p.x, y: p.y, vp: 0, mp: 1 });
  }

  // 1. cover along the walks
  let n = 0;
  const routes = [];
  const fields = sp.map(s => W.walk(W.cellOf(s))), pointFields = m.points.map(p => W.walk(W.cellOf(p)));
  sp.forEach((s, i) => {
    for (const p of m.points) routes.push(W.path(fields[i].from, W.cellOf(p)));
    sp.forEach((t, j) => { if (j !== i) routes.push(W.path(fields[i].from, W.cellOf(t))); });
  });
  m.points.forEach((p, i) => {
    const others = m.points.map((q, j) => (j === i ? Infinity : pointFields[i].d[W.cellOf(q)])), min = Math.min(...others);
    others.forEach((v, j) => { if (v <= min * 1.1 && v < Infinity) routes.push(W.path(pointFields[i].from, W.cellOf(m.points[j]))); });
  });
  for (const route of routes) {
    let run = 0;
    for (let k = 0; k < route.length; k++) {
      const c = route[k], x = c % m.w, y = (c - x) / m.w;
      if (nearSpawn(x, y) || W.covered(c)) { run = 0; continue; }
      if (++run < GAP) continue;
      const a = route[Math.max(0, k - 2)], b = route[Math.min(route.length - 1, k + 2)];
      let dx = b % m.w - a % m.w, dy = Math.floor(b / m.w) - Math.floor(a / m.w);
      const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
      const ch = n++ % 3 === 2 ? 'H' : '+';
      for (const sgn of [1, -1]) for (const along of [0, 1]) put(Math.round(x - sgn * dy * 2 + dx * along), Math.round(y + sgn * dx * 2 + dy * along), ch);
      live();
      run = 0;
    }
  }
  live();
  return { added: added.length, sym: sym.length };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  for (const name of process.argv.slice(2)) {
    const file = new URL(`../maps/${name}.json`, import.meta.url), m = JSON.parse(readFileSync(file, 'utf8'));
    const teams = spawnsFor(m, 'conquest').length === 4 ? 2 : 0, before = stats(m, teams), cells = m.rows.join('');
    const { added, sym } = rework(m);
    const err = validateMap(m);
    if (err) throw new Error(`${name}: ${err}`);
    writeFileSync(file, JSON.stringify(m, null, 1));
    const after = stats(m, teams), changed = [...m.rows.join('')].filter((ch, i) => ch !== cells[i]).length;
    console.log(`${name}: ${sym} symmetries, +${added} home points, ${changed} cells of cover; bare ${before.bare} -> ${after.bare}, home ${before.home} -> ${after.home}, share ${before.share} -> ${after.share}`);
  }
}
