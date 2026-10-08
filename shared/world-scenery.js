// Region looks for World Conquest: a biome per region, towns around city squares, works, mine heads and farms, and the
// few gameplay touches a biome brings (hedgerows, pine woods, marsh mud). Every draw comes from streams of its own and
// it runs after territories (which never read these cells), so a seed keeps its rivers, roads, regions, homes and names.
import { BIOMES } from './world-layers.js';

function randomFor(seed) {
  let state = seed >>> 0;
  return () => {
    let t = (state = (state + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Per-cell noise for feature shapes: no draws, so no order to keep.
function mix(x, y, salt) {
  let n = Math.imul(x ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(y ^ salt, 0xc2b2ae35);
  n ^= n >>> 16;
  n = Math.imul(n, 0x7feb352d);
  n ^= n >>> 15;
  return (n >>> 0) / 4294967296;
}
const BIOME = Object.fromEntries(BIOMES.map((b, i) => [b, i]));

// Returns the landmark list (map.buildings) and the per-cell biome index (255 on water).
export function dressWorld({ seed, ground, heights, regions, regionMap, roads }) {
  const h = ground.length,
    w = ground[0].length,
    s = Number(seed) >>> 0,
    pick = randomFor(s ^ 0x2545f491),
    town = randomFor(s ^ 0x68e31da4),
    salt = (s ^ 0x1b873593) >>> 0,
    phase = pick() * Math.PI * 2,
    buildings = [];
  const level = (x, y) => +heights[y][x];

  // Biomes follow the land (height, water, woods) and a few seeded provinces, so neighbours tend to share a look.
  const stats = regions.map(() => ({ n: 0, height: 0, wet: 0, wood: 0 }));
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const id = regionMap[y * w + x];
      if (id < 0) continue;
      const st = stats[id];
      st.n++;
      st.height += level(x, y);
      if (ground[y][x] === 'O') st.wood++;
      if (ground[y][x] === 'F' || ground[y - 1][x] === 'W' || ground[y + 1][x] === 'W' || ground[y][x - 1] === 'W' || ground[y][x + 1] === 'W') st.wet++;
    }
  const provinces = Array.from({ length: Math.max(3, Math.round(regions.length / 10)) }, () => ({
    x: pick() * w,
    y: pick() * h,
    r: 90 + pick() * 70,
    biome: BIOMES[Math.floor(pick() * BIOMES.length)],
  }));
  for (const r of regions) {
    const st = stats[r.id],
      mean = st.n ? st.height / st.n : 0,
      wet = st.n ? st.wet / st.n : 0,
      wood = st.n ? st.wood / st.n : 0,
      flat = Math.max(0, 1 - mean / 2);
    const weight = {
      farmland: 1.1 * flat + (r.kind === 'city' || r.kind === 'rural' ? 0.4 : 0),
      orchard: 0.7 * flat + (r.kind === 'rural' || r.kind === 'city' ? 0.3 : 0),
      steppe: 0.7 * flat * Math.max(0, 1 - wood * 3),
      pine: 0.25 + mean * 0.45 + wood * 4,
      highland: Math.max(0, mean - 1) * 1.6 + (r.kind === 'resource' ? 0.6 : 0),
      // no marsh at a home: mud around the first HQ only slows the opening
      marsh: r.home === undefined ? wet * 9 + (mean < 0.4 ? 0.25 : 0) : 0,
    };
    for (const p of provinces) weight[p.biome] *= 1 + 2.5 * Math.max(0, 1 - Math.hypot(p.x - r.x, p.y - r.y) / p.r);
    let total = 0;
    for (const b of BIOMES) total += weight[b];
    let roll = pick() * total;
    r.biome = BIOMES.find((b) => (roll -= weight[b]) < 0) ?? 'farmland';
  }

  // ---------- towns ----------
  // A lot: open dry ground in the region, off the roads and the objective clearing, level to within one step, with a
  // one-cell lane to every other house so blocks never merge by accident.
  const lot = (r, x0, y0, bw, bh) => {
    if (x0 < 3 || y0 < 3 || x0 + bw > w - 3 || y0 + bh > h - 3) return false;
    if (x0 <= r.x + 9 && x0 + bw - 1 >= r.x - 9 && y0 <= r.y + 9 && y0 + bh - 1 >= r.y - 9) return false;
    let lo = 9,
      hi = -1;
    for (let y = y0 - 1; y <= y0 + bh; y++)
      for (let x = x0 - 1; x <= x0 + bw; x++) {
        const ch = ground[y][x];
        if (ch === 'B' || ch === 'R') return false;
        if (x < x0 || y < y0 || x >= x0 + bw || y >= y0 + bh) continue;
        if ((ch !== '.' && ch !== 'O') || roads[y * w + x] || regionMap[y * w + x] !== r.id) return false;
        lo = Math.min(lo, level(x, y));
        hi = Math.max(hi, level(x, y));
      }
    return hi - lo <= 1;
  };
  const fronts = (x0, y0, bw, bh) => {
    for (let x = x0 - 1; x <= x0 + bw; x++) if (roads[(y0 - 1) * w + x] || roads[(y0 + bh) * w + x]) return true;
    for (let y = y0; y < y0 + bh; y++) if (roads[y * w + x0 - 1] || roads[y * w + x0 + bw]) return true;
    return false;
  };
  const build = (x0, y0, bw, bh, kind) => {
    for (let y = y0; y < y0 + bh; y++) for (let x = x0; x < x0 + bw; x++) ground[y][x] = 'B';
    if (kind) buildings.push({ x: x0, y: y0, kind });
    return { x0, y0, bw, bh };
  };
  // A random lot within `far` cells of the objective; the first tries want road frontage, like a real high street.
  const site = (r, size, far, kind = null, tries = 60) => {
    for (let k = 0; k < tries; k++) {
      const turn = town() < 0.5,
        bw = turn ? size[1] : size[0],
        bh = turn ? size[0] : size[1];
      const x0 = r.x + Math.floor(town() * (2 * far + 1)) - far - (bw >> 1),
        y0 = r.y + Math.floor(town() * (2 * far + 1)) - far - (bh >> 1);
      if (lot(r, x0, y0, bw, bh) && (k > tries * 0.6 || fronts(x0, y0, bw, bh))) return build(x0, y0, bw, bh, kind);
    }
    return null;
  };
  const HOUSES = [[3, 4], [3, 4], [3, 5], [4, 4], [3, 7], [4, 6], [2, 6]];
  const house = () => HOUSES[Math.floor(town() * HOUSES.length)];
  for (const r of regions) {
    if (r.kind === 'city') {
      // the church faces the square from one side, its long wall along the square's edge
      const sides = [0, 1, 2, 3];
      for (let i = 3; i > 0; i--) {
        const j = Math.floor(town() * (i + 1));
        [sides[i], sides[j]] = [sides[j], sides[i]];
      }
      let church = null;
      for (const back of [10, 11, 12])
        for (const side of sides)
          for (const shift of [0, -2, 2, -4, 4, -6, 6, -8, 8]) {
            if (church) break;
            const along = side & 1,
              bw = along ? 4 : 7,
              bh = along ? 7 : 4;
            const x0 = along ? (side === 1 ? r.x + back : r.x - back - 3) : r.x - 3 + shift,
              y0 = along ? r.y - 3 + shift : side === 0 ? r.y - back - 3 : r.y + back;
            if (lot(r, x0, y0, bw, bh)) church = build(x0, y0, bw, bh, 'church');
          }
      church ??= site(r, [4, 7], 22, 'church', 120);
      for (let i = 0, n = 10 + Math.floor(town() * 5); i < n; i++) site(r, house(), 22);
      for (let i = 0; i < 3; i++) site(r, [2, 2 + Math.floor(town() * 2)], 22);
    } else if (r.kind === 'industrial') {
      const works = site(r, [5, 8], 18, 'factory', 90) ?? site(r, [4, 6], 18, 'factory', 90);
      // warehouses in a row beside the works, two cells apart, as if along a siding
      if (works) {
        const across = works.bw < works.bh;
        for (let i = 1, gap = 2; i <= 3; i++) {
          const bw = across ? 3 : 6,
            bh = across ? 6 : 3,
            x0 = across ? works.x0 + works.bw + gap + (i - 1) * (bw + gap) : works.x0 + Math.floor(town() * 3),
            y0 = across ? works.y0 + Math.floor(town() * 3) : works.y0 + works.bh + gap + (i - 1) * (bh + gap);
          if (lot(r, x0, y0, bw, bh)) build(x0, y0, bw, bh);
        }
      }
      for (let i = 0; i < 2; i++) site(r, [2, 3], 20);
    } else if (r.kind === 'resource') {
      const head = site(r, [3, 6], 16, 'mine head', 90);
      // spoil heaps: low tips of mine waste beside the head (rubble cells: vehicles go round, infantry take cover)
      for (let i = 0, n = head ? 2 : 0; i < n; i++)
        for (let k = 0; k < 30; k++) {
          const a = town() * Math.PI * 2,
            d = 6 + town() * 5,
            cx = Math.round(head.x0 + head.bw / 2 + Math.cos(a) * d),
            cy = Math.round(head.y0 + head.bh / 2 + Math.sin(a) * d),
            cells = [];
          let ok = true;
          for (let dy = -2; dy <= 2 && ok; dy++)
            for (let dx = -2; dx <= 2; dx++) {
              if (dx * dx + dy * dy > 3.2 + mix(cx + dx, cy + dy, salt) * 1.6) continue;
              const x = cx + dx,
                y = cy + dy;
              if (!lot(r, x, y, 1, 1)) {
                ok = false;
                break;
              }
              cells.push([x, y]);
            }
          if (!ok) continue;
          for (const [x, y] of cells) ground[y][x] = 'R';
          break;
        }
      for (let i = 0; i < 2; i++) site(r, [2, 3], 18);
    }
    // every region has a farm or a hamlet; farmland and orchards the bigger ones
    const villages = r.biome === 'farmland' || r.biome === 'orchard';
    if (r.kind === 'rural' || villages) {
      for (let i = 0, n = villages ? 2 + Math.floor(town() * 2) : 1; i < n; i++) site(r, [3, 4], 20);
      for (let i = 0, n = villages ? 1 + Math.floor(town() * 2) : town() < 0.6 ? 1 : 0; i < n; i++) site(r, [3, 3], 20);
      if (villages) site(r, [2, 2], 20);
    }
  }
  // City squares: the objective clearing is paved (road ground), corners rounded off.
  for (const r of regions) {
    if (r.kind !== 'city') continue;
    for (let dy = -7; dy <= 7; dy++)
      for (let dx = -7; dx <= 7; dx++)
        if (Math.abs(dx) + Math.abs(dy) <= 12 && ground[r.y + dy][r.x + dx] === '.') ground[r.y + dy][r.x + dx] = 'D';
  }

  // ---------- biome ground ----------
  // A cell's biome is its region's, looked up at a wavy, jittered position so looks interleave across a border.
  const biomes = new Uint8Array(w * h).fill(255);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = y * w + x;
      if (regionMap[c] < 0) continue;
      const jx = Math.round(x + 5 * Math.sin(y / 9 + phase) + 4 * (mix(x, y, salt + 1) - 0.5)),
        jy = Math.round(y + 5 * Math.cos(x / 11 - phase) + 4 * (mix(x, y, salt + 2) - 0.5)),
        id = jx >= 0 && jy >= 0 && jx < w && jy < h && regionMap[jy * w + jx] >= 0 ? regionMap[jy * w + jx] : regionMap[c];
      biomes[c] = BIOME[regions[id].biome];
    }
  const near = (x, y, chars) => chars.includes(ground[y - 1][x]) || chars.includes(ground[y + 1][x]) || chars.includes(ground[y][x - 1]) || chars.includes(ground[y][x + 1]);
  const grid = regions.map((r) => ({ ox: Math.floor(pick() * 13), oy: Math.floor(pick() * 13), sx: 11 + Math.floor(pick() * 5), sy: 11 + Math.floor(pick() * 5) }));
  for (let y = 3; y < h - 3; y++)
    for (let x = 3; x < w - 3; x++) {
      const c = y * w + x,
        id = regionMap[c];
      if (id < 0 || ground[y][x] !== '.' || roads[c] || near(x, y, 'BR')) continue;
      const r = regions[id],
        keep = r.kind === 'city' ? 24 : 13;
      if (Math.max(Math.abs(x - r.x), Math.abs(y - r.y)) <= keep) continue;
      const b = biomes[c],
        wet = near(x, y, 'WF');
      if (b === BIOME.farmland && !wet) {
        // hedgerows on a field grid, in stretches with gates, like the bocage
        const f = grid[id],
          u = x - r.x + f.ox + 1300,
          v = y - r.y + f.oy + 1300,
          onX = v % f.sy === 0,
          onY = u % f.sx === 0;
        if (!onX && !onY) continue;
        const seg = onX ? Math.floor(u / f.sx) : Math.floor(v / f.sy),
          line = onX ? v : u,
          at = (onX ? u : v) % (onX ? f.sx : f.sy);
        if (mix(seg, line + (onX ? 0 : 7919), salt) > 0.55) continue;
        if (at >= 5 && at <= 6 && mix(seg, line, salt + 3) < 0.5) continue; // a gate
        ground[y][x] = 'H';
      } else if (b === BIOME.pine && !wet) {
        const d = Math.sin(x / 13 + phase) + Math.cos(y / 17 - phase) + 0.6 * Math.sin((x - y) / 9 + phase);
        if (d > 0.45 && mix(x, y, salt + 4) < 0.8) ground[y][x] = 'O';
      } else if (b === BIOME.marsh && level(x, y) === 0) {
        const m = Math.sin(x / 7 + phase) * Math.cos(y / 9 - phase) + 0.5 * Math.sin((x + y) / 5 + phase) + (wet ? 0.4 : 0);
        if (m > 0.55 && mix(x, y, salt + 5) < 0.85) ground[y][x] = 'M';
      }
    }
  return { buildings, biomes: Array.from(biomes) };
}
