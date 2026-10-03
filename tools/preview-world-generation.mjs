// Export actual generated terrain as a dependency-free PPM diagnostic, plus authoritative JSON.
// Usage: node tools/preview-world-generation.mjs [seed] [huge|massive] [output-prefix]
import fs from 'node:fs';
import { generateWorldMap } from '../shared/world-conquest.js';
const seed = Number(process.argv[2] ?? 20261003),
  size = process.argv[3] ?? 'huge',
  out = process.argv[4] ?? '/tmp/world-generation';
const m = generateWorldMap({ seed, size, players: 4 });
const pixels = Buffer.alloc(m.w * m.h * 3),
  palette = {
    '.': [122, 139, 92],
    O: [48, 78, 44],
    D: [199, 179, 128],
    B: [173, 142, 115],
    W: [56, 111, 146],
    F: [119, 177, 181],
    '=': [224, 189, 97],
  };
for (let y = 0; y < m.h; y++)
  for (let x = 0; x < m.w; x++) {
    const c = y * m.w + x,
      ch = m.rows[y][x],
      level = +m.heights[y][x],
      base = palette[ch] ?? palette['.'];
    const slope = level - (x ? +m.heights[y][x - 1] : level),
      light = 1 + level * 0.13 - slope * 0.14;
    let rgb = base.map((v) => Math.min(255, Math.max(0, Math.round(v * light))));
    if (level >= 3 && ch === '.') rgb = [143 + level * 8, 140 + level * 8, 117 + level * 8];
    if (
      m.world.regionMap[c] >= 0 &&
      ((x && m.world.regionMap[c - 1] >= 0 && m.world.regionMap[c] !== m.world.regionMap[c - 1]) ||
        (y && m.world.regionMap[c - m.w] >= 0 && m.world.regionMap[c] !== m.world.regionMap[c - m.w]))
    )
      rgb = rgb.map((v) => Math.round(v * 0.65));
    pixels.set(rgb, c * 3);
  }
fs.writeFileSync(out + '.ppm', Buffer.concat([Buffer.from(`P6\n${m.w} ${m.h}\n255\n`), pixels]));
fs.writeFileSync(out + '.json', JSON.stringify(m));
console.log(JSON.stringify({ seed, size, regions: m.world.total, image: out + '.ppm', data: out + '.json' }));
