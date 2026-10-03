// Chunk-local connected ground and legal directed crossings between those regions.
// This module reads only the flags/height supplied by its caller. Remembered views
// must carry their own versions; hidden mines and live terrain are never consulted.
const graphs = new WeakMap();
const MOVE_MASK = 1, LAND_MASK = 1 << 10;
const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const portalDirections = [[1, 0], [0, 1], [1, 1], [-1, 1]];
const allDirections = [...directions, [-1, -1], [1, -1], [-1, 1], [1, 1]];

function versionFor(g, block) {
  return block & LAND_MASK ? g.navalRegionVersion ?? 0
    : block === MOVE_MASK ? g.infantryRegionVersion ?? 0 : g.vehicleRegionVersion ?? 0;
}

function changesSince(g, from, to) {
  if (from === g.navigationChangedFromVersion && g.navigationChangedCells) return g.navigationChangedCells;
  if (!Array.isArray(g.navigationChanges)) return null;
  const cells = new Set();
  let version = from;
  for (const change of g.navigationChanges.slice(-32)) {
    if (change.from !== version || change.to === version || !change.cells) continue;
    for (const cell of change.cells) cells.add(cell);
    version = change.to;
    if (version === to) return cells;
  }
  return null;
}

function graphFor(g, block, chunkSize) {
  let entries = graphs.get(g);
  if (!entries) { entries = new Map(); graphs.set(g, entries); }
  const key = `${block}:${chunkSize}`, old = entries.get(key);
  const version = versionFor(g, block), obstruction = g.obstructionVersion ?? 0;
  const knowledge = g.navigationKnowledge;
  const knowledgeVersion = g.navigationKnowledgeVersion ?? knowledge?.version ?? (g.worldKnown ? g.terrainVersion ?? 0 : 0);
  if (old && old.w === g.w && old.h === g.h && old.flags === g.flags && old.height === g.height
    && old.version === version && old.obstruction === obstruction
    && old.knowledge === knowledge && old.knowledgeVersion === knowledgeVersion) return old;
  if (old && old.w === g.w && old.h === g.h && old.flags === g.flags && old.height === g.height
    && old.knowledge === knowledge && knowledgeVersion !== old.knowledgeVersion) {
    const changed = changesSince(g, old.knowledgeVersion, knowledgeVersion);
    if (changed) {
      updateChunks(old, changed, block, chunkSize);
      Object.assign(old, { version, obstruction, knowledgeVersion });
      return old;
    }
  }
  const W = g.w, H = g.h, N = W * H, flags = g.flags, height = g.height;
  const labels = new Int32Array(N), queue = new Int32Array(N), regions = [null], chunks = new Map(), openChunks = new Set();
  let minHeight = Infinity, maxHeight = -Infinity;
  for (let c = 0; c < N; c++) {
    if (flags[c] & block) labels[c] = -1;
    const lv = height?.[c] ?? 0;
    minHeight = Math.min(minHeight, lv); maxHeight = Math.max(maxHeight, lv);
  }
  const noCliffs = maxHeight - minHeight <= 1;
  const level = c => height?.[c] ?? 0;
  // Cardinal connectivity is symmetric. Legal diagonals that bridge two such
  // regions become directed portals, including those within the same chunk.
  for (let cy = 0; cy < H; cy += chunkSize) for (let cx = 0; cx < W; cx += chunkSize) {
    const xmax = Math.min(W, cx + chunkSize), ymax = Math.min(H, cy + chunkSize);
    const ids = [], chunk = cy / chunkSize * Math.ceil(W / chunkSize) + cx / chunkSize;
    chunks.set(chunk, ids);
    // Most remembered continent chunks are still open, level unknown ground.
    // Any entirely open chunk with a height range of one level is one cardinal
    // region, so fill its labels directly instead of visiting four edges/cell.
    let open = true, low = Infinity, high = -Infinity;
    scan: for (let y = cy; y < ymax; y++) for (let x = cx; x < xmax; x++) {
      const c = y * W + x;
      if (labels[c] < 0) { open = false; break scan; }
      if (!noCliffs) {
        low = Math.min(low, level(c)); high = Math.max(high, level(c));
        if (high - low > 1) { open = false; break scan; }
      }
    }
    if (open) {
      openChunks.add(chunk);
      const id = regions.length;
      regions.push({ edges: new Map(), incoming: new Set(), x: (cx + xmax - 1) / 2, y: (cy + ymax - 1) / 2 }); ids.push(id);
      for (let y = cy; y < ymax; y++) labels.fill(id, y * W + cx, y * W + xmax);
      continue;
    }
    for (let y = cy; y < ymax; y++) for (let x = cx; x < xmax; x++) {
      const seed = y * W + x;
      if (labels[seed]) continue;
      const id = regions.length;
      regions.push({ edges: new Map(), incoming: new Set() }); ids.push(id);
      labels[seed] = id; queue[0] = seed;
      let sumX = 0, sumY = 0, count = 0;
      for (let head = 0, tail = 1; head < tail; head++) {
        const c = queue[head], px = c % W, py = Math.floor(c / W), lv = level(c);
        sumX += px; sumY += py; count++;
        for (let k = 0; k < directions.length; k++) {
          const dx = directions[k][0], dy = directions[k][1];
          const nx = px + dx, ny = py + dy;
          if (nx < cx || nx >= xmax || ny < cy || ny >= ymax) continue;
          const n = ny * W + nx;
          if (labels[n] || Math.abs(level(n) - lv) > 1) continue;
          labels[n] = id; queue[tail++] = n;
        }
      }
      regions[id].x = sumX / count; regions[id].y = sumY / count;
    }
  }
  function add(from, to) {
    const a = labels[from], b = labels[to];
    let edge = regions[a].edges.get(b);
    if (!edge) {
      edge = { region: b, crossings: [] }; regions[a].edges.set(b, edge); regions[b].incoming.add(a);
    }
    edge.crossings.push(from, to);
  }
  // Visit each undirected neighboring pair once, then test both directions.
  function connectAt(x, y) {
    const c = y * W + x;
    if (labels[c] < 0) return;
    for (let k = 0; k < portalDirections.length; k++) {
      const dx = portalDirections[k][0], dy = portalDirections[k][1];
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= W || ny >= H) continue;
      const n = ny * W + nx;
      if (labels[n] < 0 || labels[n] === labels[c] || Math.abs(level(n) - level(c)) > 1) continue;
      if (dx && dy) {
        const a = y * W + nx, b = ny * W + x;
        if (labels[a] < 0 || labels[b] < 0) continue;
        if (Math.abs(level(a) - level(c)) <= 1 && Math.abs(level(b) - level(c)) <= 1) add(c, n);
        if (Math.abs(level(a) - level(n)) <= 1 && Math.abs(level(b) - level(n)) <= 1) add(n, c);
      } else { add(c, n); add(n, c); }
    }
  }
  if (noCliffs) {
    // Without cliffs, an open diagonal corner connects cardinally inside a
    // chunk. Visit boundary rows/columns directly rather than scan every cell.
    for (let y = 0; y < H; y++) {
      if (y % chunkSize === chunkSize - 1) for (let x = 0; x < W; x++) connectAt(x, y);
      else for (let x = 0; x < W; x += chunkSize) {
        connectAt(x, y);
        const end = Math.min(W - 1, x + chunkSize - 1);
        if (end !== x) connectAt(end, y);
      }
    }
  } else for (let cy = 0; cy < H; cy += chunkSize) for (let cx = 0; cx < W; cx += chunkSize) {
    const xmax = Math.min(W, cx + chunkSize), ymax = Math.min(H, cy + chunkSize);
    const chunk = cy / chunkSize * Math.ceil(W / chunkSize) + cx / chunkSize;
    for (let y = cy; y < ymax; y++) {
      if (!openChunks.has(chunk) || y === ymax - 1) for (let x = cx; x < xmax; x++) connectAt(x, y);
      else { connectAt(cx, y); if (xmax - 1 !== cx) connectAt(xmax - 1, y); }
    }
  }
  const graph = { w: W, h: H, flags, height, version, obstruction, knowledge, knowledgeVersion,
    labels, regions, chunks, freeRegions: [], queue, depth: new Uint32Array(Math.min(N, chunkSize * chunkSize)),
    routes: new Map(), seen: new Uint32Array(N), came: new Int32Array(N), generation: 0 };
  entries.set(key, graph);
  return graph;
}

function updateChunks(graph, changedCells, block, chunkSize) {
  const { w: W, h: H, flags, height, labels, queue, regions, chunks, freeRegions } = graph;
  const cw = Math.ceil(W / chunkSize), ch = Math.ceil(H / chunkSize), dirty = new Set();
  const chunkAt = c => Math.floor(Math.floor(c / W) / chunkSize) * cw + Math.floor(c % W / chunkSize);
  for (const c of changedCells) {
    if (!Number.isInteger(c) || c < 0 || c >= labels.length) continue;
    const x = Math.floor(c % W / chunkSize), y = Math.floor(Math.floor(c / W) / chunkSize);
    // Include adjacent chunks because a changed diagonal corner can invalidate
    // a portal whose two endpoints belong to other chunks.
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (x + dx >= 0 && x + dx < cw && y + dy >= 0 && y + dy < ch) dirty.add((y + dy) * cw + x + dx);
    }
  }
  for (const chunk of dirty) for (const id of chunks.get(chunk) ?? []) {
    const region = regions[id];
    for (const from of region.incoming) regions[from]?.edges.delete(id);
    for (const to of region.edges.keys()) regions[to]?.incoming.delete(id);
    regions[id] = null; freeRegions.push(id);
  }
  const bounds = chunk => {
    const x = chunk % cw * chunkSize, y = Math.floor(chunk / cw) * chunkSize;
    return [x, y, Math.min(W, x + chunkSize), Math.min(H, y + chunkSize)];
  };
  const level = c => height?.[c] ?? 0;
  for (const chunk of dirty) {
    const [cx, cy, xmax, ymax] = bounds(chunk), ids = [];
    chunks.set(chunk, ids);
    for (let y = cy; y < ymax; y++) for (let x = cx; x < xmax; x++) {
      const c = y * W + x; labels[c] = flags[c] & block ? -1 : 0;
    }
    for (let y = cy; y < ymax; y++) for (let x = cx; x < xmax; x++) {
      const seed = y * W + x;
      if (labels[seed]) continue;
      const id = freeRegions.length ? freeRegions.pop() : regions.length;
      regions[id] = { edges: new Map(), incoming: new Set() }; ids.push(id);
      labels[seed] = id; queue[0] = seed;
      let sumX = 0, sumY = 0, count = 0;
      for (let head = 0, tail = 1; head < tail; head++) {
        const c = queue[head], px = c % W, py = Math.floor(c / W), lv = level(c);
        sumX += px; sumY += py; count++;
        for (let k = 0; k < directions.length; k++) {
          const dx = directions[k][0], dy = directions[k][1];
          const nx = px + dx, ny = py + dy;
          if (nx < cx || nx >= xmax || ny < cy || ny >= ymax) continue;
          const n = ny * W + nx;
          if (labels[n] || Math.abs(level(n) - lv) > 1) continue;
          labels[n] = id; queue[tail++] = n;
        }
      }
      regions[id].x = sumX / count; regions[id].y = sumY / count;
    }
  }
  function add(from, to) {
    const a = labels[from], b = labels[to];
    let edge = regions[a].edges.get(b);
    if (!edge) {
      edge = { region: b, crossings: [] }; regions[a].edges.set(b, edge); regions[b].incoming.add(a);
    }
    edge.crossings.push(from, to);
  }
  for (const chunk of dirty) {
    const [cx, cy, xmax, ymax] = bounds(chunk);
    for (let y = cy; y < ymax; y++) for (let x = cx; x < xmax; x++) {
      const c = y * W + x;
      if (labels[c] < 0) continue;
      for (let k = 0; k < allDirections.length; k++) {
        const dx = allDirections[k][0], dy = allDirections[k][1];
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
        const n = ny * W + nx;
        if (n < c && dirty.has(chunkAt(n))) continue;
        if (labels[n] < 0 || labels[n] === labels[c] || Math.abs(level(n) - level(c)) > 1) continue;
        if (dx && dy) {
          const a = y * W + nx, b = ny * W + x;
          if (labels[a] < 0 || labels[b] < 0) continue;
          if (Math.abs(level(a) - level(c)) <= 1 && Math.abs(level(b) - level(c)) <= 1) add(c, n);
          if (Math.abs(level(a) - level(n)) <= 1 && Math.abs(level(b) - level(n)) <= 1) add(n, c);
        } else { add(c, n); add(n, c); }
      }
    }
  }
  graph.routes.clear();
}

function routeFor(graph, start, goal) {
  const key = `${start}:${goal}`;
  if (graph.routes.has(key)) return graph.routes.get(key);
  const { regions } = graph, came = new Int32Array(regions.length).fill(-1);
  const costs = new Float64Array(regions.length).fill(Infinity), heap = [];
  const metric = (a, b) => Math.hypot(regions[a].x - regions[b].x, regions[a].y - regions[b].y);
  const before = (a, b) => a.score < b.score || a.score === b.score && a.region < b.region;
  function push(entry) {
    let i = heap.length; heap.push(entry);
    while (i > 0) { const p = (i - 1) >> 1; if (!before(entry, heap[p])) break; heap[i] = heap[p]; i = p; }
    heap[i] = entry;
  }
  function pop() {
    const first = heap[0], last = heap.pop();
    if (heap.length) {
      let i = 0;
      for (;;) {
        const left = i * 2 + 1, right = left + 1;
        if (left >= heap.length) break;
        const child = right < heap.length && before(heap[right], heap[left]) ? right : left;
        if (!before(heap[child], last)) break;
        heap[i] = heap[child]; i = child;
      }
      heap[i] = last;
    }
    return first;
  }
  came[start] = start; costs[start] = 0; push({ region: start, cost: 0, score: metric(start, goal) });
  let reached = false;
  // Geographic cost distinguishes diagonal hops and narrow split regions from
  // full chunk crossings. Euclidean center distance is a consistent heuristic.
  while (heap.length) {
    const entry = pop(), r = entry.region;
    if (entry.cost !== costs[r]) continue;
    if (r === goal) { reached = true; break; }
    for (const n of regions[r].edges.keys()) {
      const cost = entry.cost + Math.max(1, metric(r, n));
      if (cost >= costs[n]) continue;
      costs[n] = cost; came[n] = r;
      push({ region: n, cost, score: cost + metric(n, goal) });
    }
  }
  let route = null;
  if (reached) {
    route = [goal];
    for (let r = goal; r !== start;) { r = came[r]; route.push(r); }
    route.reverse();
  }
  // Keep route storage bounded even when many units receive distinct destinations.
  if (graph.routes.size >= 128) graph.routes.delete(graph.routes.keys().next().value);
  graph.routes.set(key, route);
  return route;
}

function distance(graph, a, b) {
  return Math.hypot(a % graph.w - b % graph.w, Math.floor(a / graph.w) - Math.floor(b / graph.w));
}

function localPath(graph, from, goal, edge) {
  const { labels, seen, came, queue, depth, w: W, h: H } = graph, region = labels[from];
  const candidates = new Map();
  if (edge) for (let i = 0; i < edge.crossings.length; i += 2) {
    const cell = edge.crossings[i], next = edge.crossings[i + 1], cost = distance(graph, next, goal);
    if (!candidates.has(cell) || cost < candidates.get(cell).cost) candidates.set(cell, { next, cost });
  }
  else candidates.set(goal, { next: null, cost: 0 });
  graph.generation = (graph.generation + 1) >>> 0;
  if (!graph.generation) { seen.fill(0); graph.generation = 1; }
  const generation = graph.generation;
  seen[from] = generation; queue[0] = from; depth[0] = 0;
  let target = -1, crossing = null, best = Infinity;
  for (let head = 0, tail = 1; head < tail; head++) {
    const c = queue[head], x = c % W, y = Math.floor(c / W);
    if (depth[head] > best) break;
    const candidate = candidates.get(c);
    if (candidate && depth[head] + candidate.cost < best) {
      target = c; best = depth[head] + candidate.cost;
      crossing = candidate.next === null ? null : [c, candidate.next];
    }
    for (let k = 0; k < directions.length; k++) {
      const dx = directions[k][0], dy = directions[k][1];
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const n = ny * W + nx;
      if (labels[n] !== region || seen[n] === generation || Math.abs((graph.height?.[n] ?? 0) - (graph.height?.[c] ?? 0)) > 1) continue;
      seen[n] = generation; came[n] = c; depth[tail] = depth[head] + 1; queue[tail++] = n;
    }
  }
  if (target < 0) return null;
  const path = [];
  for (let c = target; c !== from; c = came[c]) path.push(c);
  return { path: path.reverse(), crossing };
}

/**
 * Return a reachable local target for fine A*, preserving the caller's full goal.
 * `allowed` contains coarse region IDs; `contains(cell)` is the fine-search filter.
 * `connected` means a full coarse route exists. `limited` means this is a route leg.
 * Supply recipient-local flags, heights and versions for any observed route.
 * For incremental updates, navigationChangedCells lists every changed cell since
 * navigationChangedFromVersion; navigationKnowledgeVersion names the new version.
 * Missing version continuity triggers a full rebuild. Use the filter immediately,
 * before another version update can reuse its region IDs.
 * A bounded navigationChanges log of { from, to, cells } can bridge up to 32
 * refreshes skipped by a movement class. The caller owns and caps that log.
 */
export function navigationLeg(g, startCell, goalCell, block, { maxLegCells = 32, chunkSize = 16 } = {}) {
  chunkSize = Math.max(2, Math.floor(chunkSize) || 16);
  maxLegCells = Math.max(1, Math.floor(maxLegCells) || 32);
  const graph = graphFor(g, block, chunkSize), { labels, regions } = graph;
  const start = labels[startCell], goal = labels[goalCell], allowed = new Set();
  const result = (cell, connected, limited) => ({ goal: cell, allowed,
    contains: c => allowed.has(labels[c]), connected, limited });
  // A unit caught in a newly blocked cell needs its fine search to find an exit.
  // Do not assert coarse disconnection when its starting cell has no region.
  if (start < 0 && goal > 0) {
    return { goal: goalCell, allowed, contains: () => true, connected: true, limited: false };
  }
  if (!(start > 0 && goal > 0)) return result(goalCell, false, false);
  const route = routeFor(graph, start, goal);
  if (!route) return result(goalCell, false, false);
  if (!g.worldKnown && g.w <= 128 && g.h <= 128) {
    // Preserve ordinary small-map cost choices rather than choosing one corridor.
    const pending = [start]; allowed.add(start);
    for (let i = 0; i < pending.length; i++) for (const next of regions[pending[i]].edges.keys()) {
      if (!allowed.has(next)) { allowed.add(next); pending.push(next); }
    }
    return result(goalCell, true, false);
  }
  let at = startCell, steps = 0;
  allowed.add(start);
  for (let i = 0; i < route.length; i++) {
    const edge = i + 1 < route.length ? regions[route[i]].edges.get(route[i + 1]) : null;
    const local = localPath(graph, at, goalCell, edge);
    // Cardinal local regions guarantee this path. Keep a safe fallback if callers
    // mutate terrain during a query without advancing their version.
    if (!local) return { goal: goalCell, allowed, contains: () => true, connected: true, limited: false };
    const { path, crossing } = local;
    for (const cell of path) {
      at = cell;
      if (++steps >= maxLegCells) return result(at, true, at !== goalCell);
    }
    if (crossing) {
      at = crossing[1]; allowed.add(route[i + 1]);
      if (++steps >= maxLegCells) return result(at, true, at !== goalCell);
    }
  }
  return result(goalCell, true, false);
}
