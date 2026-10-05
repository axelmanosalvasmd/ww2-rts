// Multi-source weighted growth follows valleys and banks. Map membership stays authoritative.
export function territories(ground, heights, regions) {
  const h = ground.length,
    w = ground[0].length,
    N = w * h,
    owner = new Int16Array(N).fill(-1),
    dist = new Float64Array(N).fill(Infinity),
    heap = [];
  const push = (c, d, id) => {
    let i = heap.length;
    heap.push([c, d, id]);
    while (i) {
      const p = (i - 1) >> 1;
      if (heap[p][1] <= d) break;
      heap[i] = heap[p];
      i = p;
    }
    heap[i] = [c, d, id];
  };
  const pop = () => {
    const v = heap[0],
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
    return v;
  };
  // Reserve the complete objective, installation and construction clearing to its own region.
  for (const r of regions)
    for (let dy = -9; dy <= 9; dy++)
      for (let dx = -9; dx <= 9; dx++) {
        const x = r.x + dx,
          y = r.y + dy,
          c = y * w + x;
        if (ground[y][x] === 'W') continue;
        dist[c] = 0;
        owner[c] = r.id;
        push(c, 0, r.id);
      }
  while (heap.length) {
    const [c, d, id] = pop();
    if (d !== dist[c] || owner[c] !== id) continue;
    const x = c % w,
      y = Math.floor(c / w);
    for (const [nx, ny] of [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ]) {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h || ground[ny][nx] === 'W') continue;
      const k = ny * w + nx;
      const v = d + 1 + Math.abs(+heights[ny][nx] - +heights[y][x]) * 8 + (['F', '='].includes(ground[ny][nx]) ? 4 : 0);
      if (v < dist[k]) {
        dist[k] = v;
        owner[k] = id;
        push(k, v, id);
      }
    }
  }
  for (const r of regions) r.bounds = [w, h, 0, 0];
  for (let c = 0; c < N; c++)
    if (owner[c] >= 0) {
      const b = regions[owner[c]].bounds,
        x = c % w,
        y = Math.floor(c / w);
      b[0] = Math.min(b[0], x);
      b[1] = Math.min(b[1], y);
      b[2] = Math.max(b[2], x + 1);
      b[3] = Math.max(b[3], y + 1);
    }
  return Array.from(owner);
}

// Runs are [row, startColumn, exclusiveEndColumn] in cells, only for explored territory.
export function knownTerritoryRuns(regionMap, cells, w) {
  const ids = new Map();
  for (const c of cells) {
    const id = regionMap[c];
    if (id < 0) continue;
    let list = ids.get(id);
    if (!list) ids.set(id, (list = []));
    list.push(c);
  }
  const out = new Map();
  for (const [id, list] of ids) {
    list.sort((a, b) => a - b);
    const runs = [];
    for (const c of list) {
      const y = Math.floor(c / w),
        x = c % w,
        last = runs.at(-1);
      if (last && last[0] === y && last[2] === x) last[2]++;
      else runs.push([y, x, x + 1]);
    }
    out.set(id, runs);
  }
  return out;
}
export function territoryEdges(runs) {
  const rows = new Map(),
    edges = [];
  for (const [y, a, b] of runs) {
    if (!rows.has(y)) rows.set(y, []);
    rows.get(y).push([a, b]);
  }
  for (const [y, a, b] of runs) {
    edges.push([a, y, a, y + 1], [b, y, b, y + 1]);
    for (const side of [-1, 1]) {
      let x = a;
      const line = side < 0 ? y : y + 1;
      for (const [lo, hi] of rows.get(y + side) ?? []) {
        if (hi <= x || lo >= b) continue;
        if (lo > x) edges.push([x, line, Math.min(lo, b), line]);
        x = Math.max(x, hi);
        if (x >= b) break;
      }
      if (x < b) edges.push([x, line, b, line]);
    }
  }
  return edges;
}

export function insideKnownRegion(region, at, cell = 2) {
  if (region.runs) {
    const x = Math.floor(at.x / cell),
      y = Math.floor(at.z / cell);
    return region.runs.some((r) => r[0] === y && x >= r[1] && x < r[2]);
  }
  return (
    region.bounds &&
    at.x >= region.bounds[0] &&
    at.z >= region.bounds[1] &&
    at.x < region.bounds[2] &&
    at.z < region.bounds[3]
  );
}
