import { relief, waterways } from './world-landforms.js';
import { territories } from './world-territories.js';
import { roadNetwork } from './world-roads.js';
import { railNetwork } from './world-rails.js';
import { dressWorld } from './world-scenery.js';
// Authoritative seeded geography. Never send the seed or diagnostics to live clients.
export const WORLD_TUNING = Object.freeze({
  regionCells: 64,
  regionMP: 0.65,
  regionCap: 2,
  capMax: 160,
  cityMP: 0.6,
  industrialFuel: 0.3,
  resourceMun: 0.5,
  recoverHQ: 200,
  // victory: a team wins once every rival nation is out, or once it owns this share of all regions
  winShare: 0.6,
});
// 16 x 10 = 160 unique names, enough for a Massive map's 128 regions.
const NAME_HEADS = ['Alden', 'Bray', 'Carn', 'Dorn', 'Elm', 'Falk', 'Gram', 'Hart', 'Kessel', 'Lind', 'Mar', 'Nor', 'Ost', 'Ravel', 'Stein', 'Wald'];
const NAME_TAILS = ['burg', 'court', 'dorf', 'feld', 'ford', 'heim', 'mont', 'ville', 'wick', 'stadt'];
export function generateWorldMap({
  size = 'huge',
  seed = Math.floor(Math.random() * 4294967296),
  players = 2,
  teams = [],
  scenery = true, // false: the bare geography, for checking that scenery leaves it alone
} = {}) {
  if (!['huge', 'massive'].includes(size)) throw Error('invalid world size');
  const n = Array.isArray(players) ? players.length : players;
  if (!Number.isInteger(n) || n < 1 || n > 6) throw Error('world needs 1-6 players');
  let state = Number(seed) >>> 0;
  const random = () => {
    let t = (state = (state + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const span = 64,
    cols = size === 'massive' ? 16 : 8,
    w = cols * span,
    h = 512,
    levels = relief(w, h, seed);
  const ground = Array.from({ length: h }, () => Array(w).fill('.')),
    heights = Array.from({ length: h }, (_, y) => Array.from(levels.subarray(y * w, (y + 1) * w), String));
  const features = waterways(w, h, seed, ground, heights),
    regions = [];
  const clear = (x, y, r) => {
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (ground[y + dy][x + dx] !== 'D') ground[y + dy][x + dx] = '.';
        heights[y + dy][x + dx] = '0';
      }
  };
  for (let ry = 0; ry < 8; ry++)
    for (let rx = 0; rx < cols; rx++) {
      const id = ry * cols + rx,
        cx = rx * span + 32,
        cy = ry * span + 32;
      let best = null,
        bestScore = Infinity;
      // Reject shoreline and ridge sites; reserve the entire building/guard footprint.
      for (let attempt = 0; attempt < 140; attempt++) {
        const x = cx + Math.floor(random() * 33) - 16,
          y = cy + Math.floor(random() * 33) - 16;
        let safe = true;
        for (let dy = -10; dy <= 10 && safe; dy++)
          for (let dx = -10; dx <= 10; dx++)
            if (['W', 'F', '='].includes(ground[y + dy][x + dx])) {
              safe = false;
              break;
            }
        if (!safe) continue;
        const score = +heights[y][x] * 30 + Math.hypot(x - cx, y - cy) * 0.25;
        if (score < bestScore) {
          bestScore = score;
          best = { x, y };
        }
      }
      if (!best) {
        // Exhaustive deterministic search makes a narrow lake-adjacent province usable.
        for (let y = ry * span + 10; y < (ry + 1) * span - 10 && !best; y++)
          for (let x = rx * span + 10; x < (rx + 1) * span - 10 && !best; x++) {
            let safe = true;
            for (let dy = -8; dy <= 8 && safe; dy++)
              for (let dx = -8; dx <= 8; dx++)
                if (['W', 'F', '='].includes(ground[y + dy][x + dx])) {
                  safe = false;
                  break;
                }
            if (safe) best = { x, y };
          }
      }
      if (!best) {
        for (let radius = 24; radius <= 80 && !best; radius += 4)
          for (let a = 0; a < 32 && !best; a++) {
            const x = Math.round(cx + Math.cos((a * Math.PI) / 16) * radius),
              y = Math.round(cy + Math.sin((a * Math.PI) / 16) * radius);
            if (
              x < 12 ||
              y < 12 ||
              x >= w - 12 ||
              y >= h - 12 ||
              regions.some((r) => Math.hypot(r.x - x, r.y - y) < 26)
            )
              continue;
            let safe = true;
            for (let dy = -10; dy <= 10 && safe; dy++)
              for (let dx = -10; dx <= 10; dx++)
                if (['W', 'F', '='].includes(ground[y + dy][x + dx])) {
                  safe = false;
                  break;
                }
            if (safe) best = { x, y };
          }
      }
      if (!best) throw Error('no usable regional site');
      const kind = ['rural', 'city', 'industrial', 'resource'][Math.floor(random() * 4)];
      regions.push({
        id,
        kind,
        ...best,
        bounds: [rx * span, ry * span, (rx + 1) * span, (ry + 1) * span],
      });
      clear(best.x, best.y, 8);
    }
  const roads = roadNetwork(ground, heights, regions, features),
    phase = ((Number(seed) >>> 0) / 4294967296) * 6.283;
  // Coherent woodland stands with irregular edges, not independent salt-and-pepper trees.
  for (let y = 2; y < h - 2; y++)
    for (let x = 2; x < w - 2; x++) {
      if (ground[y][x] !== '.' || roads[y * w + x]) continue;
      const density = Math.sin(x / 19 + phase) + Math.cos(y / 23 - phase) + 0.6 * Math.sin((x + y) / 11);
      if (density > 0.9 && random() < 0.72) ground[y][x] = 'O';
    }
  for (const r of regions) {
    // Small town blocks beside, never across, the road corridors.
    if (r.kind === 'city')
      for (let dy = -17; dy <= 17; dy += 4)
        for (let dx = -17; dx <= 17; dx += 4) {
          if (Math.abs(dx) < 10 && Math.abs(dy) < 10) continue;
          const x = r.x + dx,
            y = r.y + dy;
          if (x < 3 || y < 3 || x >= w - 3 || y >= h - 3 || random() > 0.65) continue;
          if (
            [0, 1].every((yy) =>
              [0, 1].every((xx) => ['.', 'O'].includes(ground[y + yy][x + xx]) && !roads[(y + yy) * w + x + xx]),
            )
          )
            for (let yy = 0; yy < 2; yy++) for (let xx = 0; xx < 2; xx++) ground[y + yy][x + xx] = 'B';
        }
    // Preserve road grades around a flat, construction-capable objective clearing.
    clear(r.x, r.y, 8);
  }
  const homes = [],
    rotation = Math.floor(random() * regions.length);
  for (let i = 0; i < n; i++) {
    let best = null,
      score = -1;
    for (let k = 0; k < regions.length; k++) {
      const r = regions[(k + rotation) % regions.length];
      if (homes.includes(r)) continue;
      const expansion = Math.min(...regions.filter((a) => a !== r).map((a) => Math.hypot(a.x - r.x, a.y - r.y)));
      if (expansion < 50 || expansion > 70) continue;
      const d = homes.length ? Math.min(...homes.map((a) => Math.hypot(a.x - r.x, a.y - r.y))) : Math.hypot(r.x - w/2, r.y - h/2);
      if (d > score) {
        score = d;
        best = r;
      }
    }
    homes.push(best);
    best.home = i;
    best.team = teams[i] ?? i;
  }
  // Place names from their own seeded stream, so naming never shifts the geography of a seed.
  let nameState = (Number(seed) ^ 0x9e3779b9) >>> 0;
  const pool = NAME_HEADS.flatMap((a) => NAME_TAILS.map((b) => a + b));
  for (const r of regions) {
    nameState = (Math.imul(nameState, 1664525) + 1013904223) >>> 0;
    const base = pool.splice(nameState % pool.length, 1)[0];
    r.name = { rural: base, city: base, industrial: `${base} Works`, resource: `${base} Mines` }[r.kind];
  }
  const regionMap = territories(ground, heights, regions),
    { buildings, biomes } = scenery ? dressWorld({ seed, ground, heights, regions, regionMap, roads }) : {};
  return {
    name: `World Conquest (${size === 'massive' ? 'Massive' : 'Huge'})`,
    w,
    h,
    rows: ground.map((r) => r.join('')),
    heights: heights.map((r) => r.join('')),
    spawns: homes.map((r) => ({ x: r.x, y: r.y })),
    points: [],
    buildings,
    world: {
      size,
      total: regions.length,
      seed: Number(seed) >>> 0,
      generatorVersion: 3,
      waterways: { rivers: features.rivers, crossings: features.crossings, lake: features.lake },
      regionCells: span,
      regionMap,
      biomes,
      regions,
      rails: railNetwork(ground, heights, regions, regionMap),
    },
  };
}
