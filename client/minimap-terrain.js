// The minimap's terrain: one pixel per cell, its colour by cell type, lighter on higher ground, the railway dark.
// Painted whole once, then only around changed cells: a cell's pixel reads its own type and the ground height at its
// centre, which moves up to reach cells from a changed cell (relief.groundReach in client/relief.js). Repainted pixels
// go to the canvas in 64-cell tiles. The result is the same as a whole repaint of the current terrain.
export const MM_COLORS = { '.': [108, 118, 69], B: [150, 132, 100], H: [47, 74, 34], '#': [154, 149, 138], '+': [90, 79, 54], T: [62, 50, 34], W: [60, 93, 112], '=': [122, 90, 58], F: [106, 127, 122], R: [122, 114, 102], X: [96, 90, 70], Y: [84, 84, 78], D: [150, 128, 100], M: [92, 80, 58], N: [120, 96, 60], O: [38, 62, 30], A: [226, 220, 204] };
const TILE = 64;

// grid: rows of cell chars (read live); height(x, y): the ground height at a cell's centre in levels; onTrack(c): a
// railway runs through cell c; canvas: a w x h canvas to paint
export function createMinimapTerrain({ w, h, grid, height, onTrack = () => false, reach, canvas }) {
  const context = canvas.getContext('2d'), img = context.createImageData(w, h), data = img.data;
  const tw = Math.ceil(w / TILE), stats = { cells: 0, tiles: 0 };
  function pixel(x, y) {
    const c = y * w + x, i = c * 4;
    if (onTrack(c)) { data[i] = 46; data[i + 1] = 40; data[i + 2] = 36; data[i + 3] = 255; return; }
    const [r, g, b] = MM_COLORS[grid[y][x]] ?? MM_COLORS['.'], k = 1 + height(x, y) * 0.12;
    data[i] = r * k; data[i + 1] = g * k; data[i + 2] = b * k; data[i + 3] = 255;
  }
  function paint() {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) pixel(x, y);
    context.putImageData(img, 0, 0);
  }
  // shaped: cells whose type or height changed, or whose ground moved; own: cells whose pixel alone may change (a
  // railway found on them)
  function update(shaped = [], own = []) {
    const tiles = new Set(), seen = new Set();
    const one = (x, y) => { const c = y * w + x; if (seen.has(c)) return; seen.add(c); pixel(x, y); tiles.add(Math.floor(y / TILE) * tw + Math.floor(x / TILE)); };
    for (const c of shaped) {
      const x = c % w, y = (c - x) / w;
      for (let j = Math.max(0, y - reach); j <= Math.min(h - 1, y + reach); j++) for (let i = Math.max(0, x - reach); i <= Math.min(w - 1, x + reach); i++) one(i, j);
    }
    for (const c of own) one(c % w, Math.floor(c / w));
    for (const t of tiles) { const x = (t % tw) * TILE, y = Math.floor(t / tw) * TILE; context.putImageData(img, 0, 0, x, y, Math.min(TILE, w - x), Math.min(TILE, h - y)); }
    stats.cells = seen.size; stats.tiles = tiles.size;
  }
  paint();
  return { canvas, update, paint, stats, image: img };
}
