import assert from 'node:assert/strict';
export function assertWorldReachable(map) {
  const { w, h } = map,
    N = w * h,
    seen = new Uint8Array(N),
    queue = new Int32Array(N),
    safe = new Uint8Array(N);
  // A 3-cell-wide clearance corridor, cliffs included. Broken bridges count as water.
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      let ok = true;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) if ('WB=RYQ'.includes(map.rows[y + dy][x + dx])) ok = false;
      safe[y * w + x] = ok ? 1 : 0;
    }
  const first = map.world.regions[0];
  let end = 1;
  queue[0] = first.y * w + first.x;
  seen[queue[0]] = 1;
  for (let i = 0; i < end; i++) {
    const c = queue[i],
      x = c % w,
      y = Math.floor(c / w);
    for (const [nx, ny] of [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ]) {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const k = ny * w + nx;
      if (!seen[k] && safe[k] && Math.abs(+map.heights[ny][nx] - +map.heights[y][x]) <= 1) {
        seen[k] = 1;
        queue[end++] = k;
      }
    }
  }
  for (const r of map.world.regions)
    assert.ok(seen[r.y * w + r.x], `seed ${map.world.seed}: region ${r.id} inaccessible with destroyed bridges`);
}
