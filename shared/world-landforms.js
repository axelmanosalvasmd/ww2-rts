// Seeded low-frequency relief. Ridges use existing cliffs, with wide saddles for armor.
export function relief(w, h, seed) {
  const phase = ((seed >>> 0) / 4294967296) * Math.PI * 2;
  const heights = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const ridge = h * (0.36 + 0.08 * Math.sin(x / 93 + phase));
      const d = Math.abs(y - ridge);
      const pass = Math.min(Math.abs(x - w * 0.22), Math.abs(x - w * 0.71));
      const crest = d < 7 ? 4 : d < 17 ? 2 : d < 30 ? 1 : 0;
      const hills = Math.max(0, Math.sin(x / 47 + phase) * Math.cos(y / 53 - phase));
      heights[y * w + x] = Math.min(
        4,
        Math.max(Math.floor(hills * 3), Math.min(crest, Math.max(0, Math.floor((pass - 10) / 5)))),
      );
    }
  return heights;
}

// Separate hydrology random stream, so foliage and settlement changes cannot move rivers.
function randomFor(seed) {
  let state = seed >>> 0;
  return () => {
    let t = (state = (state + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Bounded dynamic programming prefers low terrain inside a meandering valley envelope.
// One row per step prevents self-intersections and gives every channel an outlet.
function valleyPath(w, heights, targets, startY = 0, fixedEnds = false) {
  const previous = new Int16Array(w * targets.length).fill(-1);
  let costs = new Float64Array(w).fill(Infinity);
  for (let i = 0; i < targets.length; i++) {
    const next = new Float64Array(w).fill(Infinity);
    const radius = fixedEnds && (i === 0 || i === targets.length - 1) ? 0 : 16;
    for (
      let x = Math.max(4, Math.round(targets[i]) - radius);
      x <= Math.min(w - 5, Math.round(targets[i]) + radius);
      x++
    ) {
      const local = Number(heights[startY + i][x]) * 0.8 + Math.abs(x - targets[i]) * 0.08;
      if (!i) {
        next[x] = local;
        continue;
      }
      for (let dx = -1; dx <= 1; dx++) {
        const px = x + dx,
          candidate = costs[px] + local + Math.abs(dx) * 0.12;
        if (candidate < next[x]) {
          next[x] = candidate;
          previous[i * w + x] = px;
        }
      }
    }
    costs = next;
  }
  let x = 0;
  for (let k = 1; k < w; k++) if (costs[k] < costs[x]) x = k;
  if (!Number.isFinite(costs[x])) throw Error('no downhill channel route');
  const path = Array(targets.length);
  for (let i = targets.length - 1; i >= 0; i--) {
    path[i] = { x, y: startY + i };
    x = previous[i * w + x];
  }
  return path;
}

export function waterways(w, h, seed, ground, heights) {
  const random = randomFor(seed),
    count = 1 + Math.floor(random() * 3);
  const phase = random() * Math.PI * 2,
    rivers = [],
    crossings = [];
  // Preserve the original terrain for routing. Carving one river must not attract every other river.
  const original = heights.map((row) => row.slice());
  function carve(x, y, radius, type) {
    for (let dy = -radius - 6; dy <= radius + 6; dy++)
      for (let dx = -radius - 6; dx <= radius + 6; dx++) {
        const xx = x + dx,
          yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const distance = Math.hypot(dx, dy);
        if (distance > radius + 6) continue;
        heights[yy][xx] = String(Math.min(+heights[yy][xx], Math.max(0, Math.floor((distance - radius) / 3))));
        if (distance <= radius && (type === 'W' || ground[yy][xx] !== 'W')) ground[yy][xx] = type;
      }
  }
  for (let id = 0; id < count; id++) {
    const center = w * (0.12 + (0.76 * (id + 0.5)) / count);
    const angle = phase + id * 2.1;
    const targets = Array.from(
      { length: h },
      (_, y) => center + Math.sin(y / 77 + angle) * 18 + Math.sin(y / 31 + angle) * 5,
    );
    const path = valleyPath(w, original, targets);
    rivers.push({ id, kind: 'main', parent: null, path });
    for (const p of path) p.radius = 4;
  }
  const branchCount = Math.floor(random() * 4);
  const firstSide = random() < 0.5 ? -1 : 1;
  for (let i = 0; i < branchCount; i++) {
    const parent = rivers[i % count],
      ordinal = Math.floor(i / count);
    const joinY = Math.round(h * [0.4, 0.6, 0.79][ordinal]) + Math.floor(random() * 21) - 10;
    const joinX = parent.path[joinY].x;
    const side = i % 2 ? -firstSide : firstSide;
    const reach = Math.min(78, ((w * 0.76) / count) * 0.35);
    const length = 96 + Math.floor(random() * 21);
    const startY = joinY - length,
      startX = Math.round(joinX + side * reach);
    const targets = Array.from({ length: length + 1 }, (_, j) => {
      const t = j / length;
      return startX + (joinX - startX) * t + Math.sin(t * Math.PI * 2) * 6;
    });
    const path = valleyPath(w, original, targets, startY, true);
    for (const p of path) {
      p.radius = 2;
      carve(p.x, p.y, p.radius, 'F');
    }
    rivers.push({ id: count + i, kind: 'tributary', parent: parent.id, path });
    for (const p of parent.path) if (p.y >= joinY) p.radius = Math.min(6, p.radius + 1);
  }
  // Main channels stay deep at confluences; shallow branches remain fordable along their length.
  for (const river of rivers.filter((r) => r.kind === 'main'))
    for (const p of river.path) carve(p.x, p.y, p.radius, 'W');
  // The lake belongs to the first river and drains continuously to the map edge.
  const lakeY = Math.round(h * 0.68),
    lakeX = rivers[0].path[lakeY].x;
  for (let y = lakeY - 28; y <= lakeY + 28; y++)
    for (let x = lakeX - 32; x <= lakeX + 32; x++) {
      const dx = (x - lakeX) / 27,
        dy = (y - lakeY) / 24;
      if (dx * dx + dy * dy < 1 + 0.1 * Math.sin(Math.atan2(dy, dx) * 5 + phase)) {
        ground[y][x] = 'W';
        heights[y][x] = '0';
      }
    }
  for (const river of rivers.filter((r) => r.kind === 'main')) {
    for (const [i, f] of [0.12, 0.29, 0.51, 0.87].entries()) {
      const y = Math.round(h * f) + Math.floor(random() * 9) - 4,
        type = i % 2 ? 'F' : '=';
      crossings.push({ x: river.path[y].x, y, type, river: river.id });
      for (let yy = y - 4; yy <= y + 4; yy++) {
        const cx = river.path[yy].x;
        for (let x = cx - 12; x <= cx + 12; x++) {
          ground[yy][x] = ground[yy][x] === 'W' ? type : ground[yy][x] === 'F' ? 'F' : 'D';
          heights[yy][x] = '0';
        }
      }
    }
  }
  return {
    rivers,
    crossings,
    lake: { x: lakeX, y: lakeY },
    passes: [0.22, 0.71].map((f) => ({
      x: Math.round(w * f),
      y: Math.round(h * (0.36 + 0.08 * Math.sin((w * f) / 93 + ((seed >>> 0) / 4294967296) * Math.PI * 2))),
    })),
  };
}
