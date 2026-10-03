// Seeded authoritative geography. Live clients receive a discovery-filtered copy from the simulation.
export const WORLD_TUNING = Object.freeze({ regionCells: 64, regionMP: 0.65, regionCap: 2, capMax: 160, cityMP: 0.6, industrialFuel: 0.3, resourceMun: 0.5, recoverHQ: 200 });

export function generateWorldMap({ size = 'huge', seed = Math.floor(Math.random() * 4294967296), players = 2, teams = [] } = {}) {
  if (!['huge', 'massive'].includes(size)) throw new Error('invalid world size');
  const n = Array.isArray(players) ? players.length : players;
  if (!Number.isInteger(n) || n < 1 || n > 6) throw new Error('world needs 1-6 players');
  let state = Number(seed) >>> 0;
  const random = () => { let t = state = (state + 0x6D2B79F5) | 0; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const span = WORLD_TUNING.regionCells, cols = size === 'massive' ? 16 : 8, rows = 8, w = cols * span, h = rows * span;
  const ground = Array.from({ length: h }, () => Array(w).fill('.')), heights = Array.from({ length: h }, () => Array(w).fill('0'));
  const regions = [];
  for (let ry = 0; ry < rows; ry++) for (let rx = 0; rx < cols; rx++) {
    const id = ry * cols + rx, cx = rx * span + span / 2, cy = ry * span + span / 2;
    const kind = ['rural', 'city', 'industrial', 'resource'][Math.floor(random() * 4)];
    const x = cx + Math.floor(random() * 5) - 2, y = cy + Math.floor(random() * 5) - 2;
    regions.push({ id, name: `${kind === 'rural' ? 'Province' : kind === 'city' ? 'City' : kind === 'industrial' ? 'Works' : 'Resources'} ${id + 1}`, kind, x, y, bounds: [rx * span, ry * span, (rx + 1) * span, (ry + 1) * span] });
    // Roads are wide, continuous land routes. Woods, towns and shallow hills sit alongside them.
    for (let yy = ry * span; yy < (ry + 1) * span; yy++) for (let xx = rx * span; xx < (rx + 1) * span; xx++) {
      const away = Math.abs(xx - cx) > 4 && Math.abs(yy - cy) > 4;
      if (away && random() < 0.14) ground[yy][xx] = 'O';
      if (away && random() < 0.05) heights[yy][xx] = '1';
      if (kind === 'city' && away && random() < 0.055) ground[yy][xx] = 'B';
      if (Math.abs(xx - cx) <= 1 || Math.abs(yy - cy) <= 1) ground[yy][xx] = 'D';
    }
  }
  // A river has durable shallow crossings at every east-west road. Losing a bridge cannot sever the continent.
  const riverX = Math.floor(cols / 2) * span + 5 + Math.floor(random() * 5);
  for (let y = 0; y < h; y++) for (let dx = 0; dx < 2; dx++) {
    const ford = Math.abs(y % span - span / 2) <= 2;
    ground[y][riverX + dx] = ford ? 'F' : 'W'; heights[y][riverX + dx] = '0';
  }
  const rotation = Math.floor(random() * regions.length), candidates = [];
  // Farthest-point homes give every side the same cleared construction room and broad land approaches.
  for (let i = 0; i < n; i++) {
    let best = null, score = -1;
    for (let k = 0; k < regions.length; k++) {
      const r = regions[(k + rotation) % regions.length];
      if (candidates.includes(r)) continue;
      const d = candidates.length ? Math.min(...candidates.map(a => Math.hypot(a.x - r.x, a.y - r.y))) : 1;
      if (d > score) { score = d; best = r; }
    }
    candidates.push(best);
  }
  const spawns = candidates.map((r, slot) => { r.home = slot; r.team = teams[slot] ?? slot; return { x: r.x, y: r.y }; });
  for (const r of regions) {
    // A capture clearing and military-base footprint do not cut the connected road network.
    for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) { ground[r.y + dy][r.x + dx] = '.'; heights[r.y + dy][r.x + dx] = '0'; }
  }
  return { name: `World Conquest (${size === 'massive' ? 'Massive' : 'Huge'})`, w, h, rows: ground.map(r => r.join('')), heights: heights.map(r => r.join('')), spawns, points: [], world: { size, total: regions.length, seed: Number(seed) >>> 0, regionCells: span, regions } };
}
