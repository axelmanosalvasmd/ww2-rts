// Railways for World Conquest: stations in the home, city and industrial regions, joined by lines laid on a 2-cell
// grid that prefers flat ground, never fords or swims, and crosses rivers only on the existing bridges (blow the bridge
// and the line is cut). The rails are an overlay: generating them never changes a seed's terrain, regions or names.
// Server-only data (lines, stations); clients learn the parts they have explored.
const STEP = 2;
const BLOCK = new Set(['W', 'F', 'B']);

export function railNetwork(ground, heights, regions, regionMap) {
  const h = ground.length, w = ground[0].length, cw = Math.floor(w / STEP), ch = Math.floor(h / STEP), N = cw * ch;
  const cost = new Float32Array(N);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const gx = x * STEP, gy = y * STEP, ch0 = ground[gy][gx];
    if (BLOCK.has(ch0)) { cost[y * cw + x] = Infinity; continue; }
    // grades: a level step nearby costs a lot (trains climb badly), woods a little (they are cut through)
    let lo = 9, hi = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const yy = Math.min(h - 1, Math.max(0, gy + dy)), xx = Math.min(w - 1, Math.max(0, gx + dx)), l = +heights[yy][xx];
      lo = Math.min(lo, l); hi = Math.max(hi, l);
    }
    cost[y * cw + x] = 1 + (hi - lo) * 12 + +heights[gy][gx] * 2 + (ch0 === 'O' ? 1.5 : 0) + (ch0 === '=' ? -0.5 : 0);
  }
  // track keeps off a home's building ground around its HQ (a fair start: every home has the same room to build)
  for (const r of regions) if (r.home !== undefined) for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) if (Math.hypot(x * STEP - r.x, y * STEP - r.y) < 13) cost[y * cw + x] += 50;
  // a station: a flat, clear 5 x 5 spot 9 to 16 cells from the objective (16 to 23 in a home region, so its yard stays
  // clear of the HQ's building ground), on the side facing the map centre
  const clear = (x, y) => { for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const c = ground[y + dy]?.[x + dx]; if (c === undefined || !['.', 'O', 'D'].includes(c) || +heights[y + dy][x + dx] !== +heights[y][x]) return false; } return true; };
  const stations = [];
  for (const r of regions) {
    if (r.home === undefined && r.kind !== 'city' && r.kind !== 'industrial') continue;
    const toward = Math.atan2(h / 2 - r.y, w / 2 - r.x);
    let best = null;
    for (let radius = r.home === undefined ? 9 : 16, last = radius + 7; radius <= last && !best; radius++) for (let k = 0; k < 24 && !best; k++) {
      const a = toward + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * Math.PI / 12, x = Math.round(r.x + Math.cos(a) * radius), y = Math.round(r.y + Math.sin(a) * radius);
      const node = Math.floor(y / STEP) * cw + Math.floor(x / STEP);
      if (x > 4 && y > 4 && x < w - 5 && y < h - 5 && clear(x, y) && regionMap[y * w + x] === r.id && Number.isFinite(cost[node])) best = { x, y };
    }
    if (best) stations.push({ region: r.id, ...best });
  }
  // lines: a proximity spanning tree over the stations plus each station's two nearest neighbours when close (loops)
  const lines = [], edges = new Set();
  const link = (i, j) => {
    const key = Math.min(i, j) + ':' + Math.max(i, j);
    if (edges.has(key)) return;
    edges.add(key);
    const cells = route(stations[i], stations[j]);
    if (cells) lines.push({ a: stations[i].region, b: stations[j].region, cells, regions: [...new Set(cells.map(c => regionMap[c]).filter(id => id >= 0))] });
  };
  const d2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
  const joined = new Set(stations.length ? [0] : []);
  while (joined.size < stations.length) {
    let best = null, bd = Infinity;
    for (const i of joined) for (let j = 0; j < stations.length; j++) if (!joined.has(j) && d2(stations[i], stations[j]) < bd) { bd = d2(stations[i], stations[j]); best = [i, j]; }
    link(...best); joined.add(best[1]);
  }
  for (let i = 0; i < stations.length; i++) {
    for (const [j, d] of stations.map((s, j) => [j, d2(s, stations[i])]).filter(([j]) => j !== i).sort((a, b) => a[1] - b[1]).slice(0, 2)) if (d < 110 ** 2) link(i, j);
  }
  return { stations, lines };

  // A* on the coarse grid, then the polyline rasterized to full cells (a 1-cell track)
  function route(a, b) {
    const start = Math.floor(a.y / STEP) * cw + Math.floor(a.x / STEP), end = Math.floor(b.y / STEP) * cw + Math.floor(b.x / STEP);
    const g = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1), done = new Uint8Array(N), heap = [];
    const push = (c, s) => { let i = heap.length; heap.push(null); while (i) { const p = (i - 1) >> 1; if (heap[p][1] <= s) break; heap[i] = heap[p]; i = p; } heap[i] = [c, s]; };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { let i = 0; while (i * 2 + 1 < heap.length) { let j = i * 2 + 1; if (j + 1 < heap.length && heap[j + 1][1] < heap[j][1]) j++; if (heap[j][1] >= last[1]) break; heap[i] = heap[j]; i = j; } heap[i] = last; } return top; };
    g[start] = 0; push(start, 0);
    const ex = end % cw, ey = Math.floor(end / cw);
    while (heap.length) {
      const [c] = pop();
      if (done[c]) continue;
      done[c] = 1;
      if (c === end) break;
      const x = c % cw, y = Math.floor(c / cw);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if ((!dx && !dy) || nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue;
        const k = ny * cw + nx;
        if (!Number.isFinite(cost[k]) || (dx && dy && (!Number.isFinite(cost[y * cw + nx]) || !Number.isFinite(cost[ny * cw + x])))) continue;
        const v = g[c] + Math.max(0.3, cost[k]) * Math.hypot(dx, dy);
        if (v < g[k]) { g[k] = v; prev[k] = c; push(k, v + 0.9 * Math.hypot(nx - ex, ny - ey)); }
      }
    }
    if (!Number.isFinite(g[end])) return null;
    const nodes = [];
    for (let c = end; c >= 0; c = prev[c]) { nodes.push(c); if (c === start) break; }
    nodes.reverse();
    // existing track is cheaper, so later lines share it into towns
    for (const c of nodes) cost[c] = Math.min(cost[c], 0.6);
    const pts = [{ x: a.x, y: a.y }, ...nodes.slice(1, -1).map(c => ({ x: (c % cw) * STEP, y: Math.floor(c / cw) * STEP })), { x: b.x, y: b.y }], cells = [];
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i - 1], q = pts[i], n = Math.max(Math.abs(q.x - p.x), Math.abs(q.y - p.y), 1);
      for (let s = i === 1 ? 0 : 1; s <= n; s++) { const c = Math.round(p.y + (q.y - p.y) * s / n) * w + Math.round(p.x + (q.x - p.x) * s / n); if (c !== cells.at(-1)) cells.push(c); }
    }
    return cells;
  }
}
