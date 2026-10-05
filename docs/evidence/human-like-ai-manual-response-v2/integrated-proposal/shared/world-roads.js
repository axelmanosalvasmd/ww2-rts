// Coarse terrain-cost routing keeps generation bounded. Corridors are rasterized with tank clearance.
export function roadNetwork(ground, heights, sites, features) {
  const h = ground.length,
    w = ground[0].length,
    step = 4,
    cw = w / step,
    ch = h / step,
    N = cw * ch;
  const cost = new Float32Array(N),
    road = new Uint8Array(w * h);
  for (let y = 0; y < ch; y++)
    for (let x = 0; x < cw; x++) {
      let blocked = false,
        level = 0;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const xx = Math.min(w - 1, Math.max(0, x * step + dx)),
            yy = Math.min(h - 1, Math.max(0, y * step + dy));
          blocked ||= ground[yy][xx] === 'W';
          level = Math.max(level, +heights[yy][xx]);
        }
      cost[y * cw + x] = blocked ? Infinity : 1 + level * 7;
    }
  const heap = [];
  function push(c, s) {
    let i = heap.length;
    heap.push([c, s]);
    while (i) {
      const p = (i - 1) >> 1;
      if (heap[p][1] <= s) break;
      heap[i] = heap[p];
      i = p;
    }
    heap[i] = [c, s];
  }
  function pop() {
    const top = heap[0],
      last = heap.pop();
    if (heap.length) {
      let i = 0;
      while (i * 2 + 1 < heap.length) {
        let j = i * 2 + 1;
        if (j + 1 < heap.length && heap[j + 1][1] < heap[j][1]) j++;
        if (heap[j][1] >= last[1]) break;
        heap[i] = heap[j];
        i = j;
      }
      heap[i] = last;
    }
    return top;
  }
  const nearest = (p) => {
    let best = -1,
      d = Infinity;
    for (let y = Math.max(0, Math.floor(p.y / step) - 6); y < Math.min(ch, Math.floor(p.y / step) + 7); y++)
      for (let x = Math.max(0, Math.floor(p.x / step) - 6); x < Math.min(cw, Math.floor(p.x / step) + 7); x++) {
        const k = y * cw + x,
          dd = (x * step - p.x) ** 2 + (y * step - p.y) ** 2;
        if (Number.isFinite(cost[k]) && dd < d) {
          best = k;
          d = dd;
        }
      }
    if (best < 0) throw Error('no road access');
    return best;
  };
  function paint(x, y) {
    for (let dy = -3; dy <= 3; dy++)
      for (let dx = -3; dx <= 3; dx++) {
        const xx = Math.round(x) + dx,
          yy = Math.round(y) + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h || ground[yy][xx] === 'W') continue;
        road[yy * w + xx] = 1;
        if (!['F', '='].includes(ground[yy][xx]))
          ground[yy][xx] = Math.abs(dx) <= 1 && Math.abs(dy) <= 1 ? 'D' : ground[yy][xx] === 'D' ? 'D' : '.';
        heights[yy][xx] = '0';
      }
  }
  function segment(a, b) {
    const n = Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), 1);
    for (let i = 0; i <= n; i++) paint(a.x + ((b.x - a.x) * i) / n, a.y + ((b.y - a.y) * i) / n);
  }
  function route(a, b) {
    const start = nearest(a),
      end = nearest(b),
      g = new Float64Array(N).fill(Infinity),
      prev = new Int32Array(N).fill(-1),
      done = new Uint8Array(N);
    heap.length = 0;
    g[start] = 0;
    push(start, 0);
    while (heap.length) {
      const [c] = pop();
      if (done[c]) continue;
      done[c] = 1;
      if (c === end) break;
      const x = c % cw,
        y = Math.floor(c / cw);
      for (const [nx, ny] of [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
        [x - 1, y - 1],
        [x + 1, y - 1],
        [x - 1, y + 1],
        [x + 1, y + 1],
      ]) {
        if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue;
        const k = ny * cw + nx;
        if (nx !== x && ny !== y && (!Number.isFinite(cost[y * cw + nx]) || !Number.isFinite(cost[ny * cw + x])))
          continue;
        const v = g[c] + cost[k] * Math.hypot(nx - x, ny - y);
        if (v < g[k]) {
          g[k] = v;
          prev[k] = c;
          push(k, v + 0.8 * Math.hypot(nx - (end % cw), ny - Math.floor(end / cw)));
        }
      }
    }
    if (!Number.isFinite(g[end])) throw Error('disconnected road graph');
    let last = b;
    for (let c = end; c >= 0; c = prev[c]) {
      const p = { x: (c % cw) * step, y: Math.floor(c / cw) * step };
      segment(last, p);
      cost[c] = 0.8;
      last = p;
      if (c === start) break;
    }
    segment(last, a);
  }
  // A proximity backbone plus local loops, rather than a periodic street grid.
  const linked = new Set([0]),
    edges = new Set();
  const connect = (i, j) => {
    const key = [Math.min(i, j), Math.max(i, j)].join(':');
    if (!edges.has(key)) {
      route(sites[i], sites[j]);
      edges.add(key);
    }
  };
  while (linked.size < sites.length) {
    let best = null,
      d = Infinity;
    for (const i of linked)
      for (let j = 0; j < sites.length; j++)
        if (!linked.has(j)) {
          const dd = (sites[i].x - sites[j].x) ** 2 + (sites[i].y - sites[j].y) ** 2;
          if (dd < d) {
            d = dd;
            best = [i, j];
          }
        }
    connect(...best);
    linked.add(best[1]);
  }
  for (let i = 0; i < sites.length; i++) {
    const near = sites
      .map((p, j) => ({ j, d: Math.hypot(p.x - sites[i].x, p.y - sites[i].y) }))
      .filter((p) => p.j !== i)
      .sort((a, b) => a.d - b.d);
    for (const { j } of near.slice(0, 2)) connect(i, j);
  }
  // Bring both banks of every crossing and both ridge saddles into the same network.
  for (const p of [
    ...features.crossings.flatMap((c) => [
      { x: c.x - 18, y: c.y },
      { x: c.x + 18, y: c.y },
    ]),
    ...features.passes,
  ]) {
    const site = sites.reduce((a, b) => (Math.hypot(a.x - p.x, a.y - p.y) < Math.hypot(b.x - p.x, b.y - p.y) ? a : b));
    route(p, site);
  }
  // Terraced verges avoid sheer cliffs along excavated roads and settlement clearings.
  const dist = new Uint8Array(w * h).fill(255),
    queue = new Int32Array(w * h);
  let end = 0;
  for (let c = 0; c < road.length; c++)
    if (road[c]) {
      dist[c] = 0;
      queue[end++] = c;
    }
  for (let i = 0; i < end; i++) {
    const c = queue[i],
      x = c % w,
      y = Math.floor(c / w);
    if (dist[c] >= 12) continue;
    for (const [nx, ny] of [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ]) {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const k = ny * w + nx;
      if (dist[k] <= dist[c] + 1) continue;
      dist[k] = dist[c] + 1;
      queue[end++] = k;
    }
  }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) heights[y][x] = String(Math.min(+heights[y][x], Math.floor(dist[y * w + x] / 3)));
  return road;
}
