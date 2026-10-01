// Where each selected unit stands for a move order. Safe to import in Node.
export const FORMATIONS = ['block', 'line', 'column', 'wedge'];
export const GAP = 5;

// how many units stand in each row, front row first
function rowSizes(shape, n, cols) {
  if (!cols && shape === 'wedge') { const r = []; for (let k = 1, left = n; left > 0; left -= k++) r.push(Math.min(k, left)); return r; }
  cols ??= shape === 'line' ? Math.ceil(n / Math.ceil(n / 12)) : shape === 'column' ? (n > 6 ? 2 : 1) : Math.ceil(Math.sqrt(n));
  return Array.from({ length: Math.ceil(n / cols) }, (_, i) => Math.min(cols, n - i * cols));
}

// sel: units with id, x, z. at: the clicked spot. to: where a right-drag ended (the front runs from at to to,
// as wide as the drag, facing away from the units). back(v): rows to push a unit back (mortars behind riflemen).
// Returns [[id, x, z], ...] for a move order.
export function formation(sel, at, { shape = 'block', to = null, back = () => 0 } = {}) {
  const n = sel.length;
  if (!n) return [];
  const cx = sel.reduce((a, v) => a + v.x, 0) / n, cz = sel.reduce((a, v) => a + v.z, 0) / n;
  let mx = at.x, mz = at.z, fx, fz, cols, spread = GAP;
  const w = to ? Math.hypot(to.x - at.x, to.z - at.z) : 0;
  if (w > GAP) {
    mx = (at.x + to.x) / 2; mz = (at.z + to.z) / 2;
    fx = (to.z - at.z) / w; fz = -(to.x - at.x) / w;
    if ((mx - cx) * fx + (mz - cz) * fz < 0) { fx = -fx; fz = -fz; }
    cols = Math.min(n, Math.floor(w / GAP) + 1);
    spread = cols > 1 ? w / (cols - 1) : 0;
  } else {
    const len = Math.hypot(at.x - cx, at.z - cz) || 1;
    fx = (at.x - cx) / len; fz = (at.z - cz) / len;
  }
  // front rows go to the units already furthest forward, each row keeps its left-to-right order so paths do not cross
  const fwd = v => (v.x - cx) * fx + (v.z - cz) * fz, side = v => (v.x - cx) * -fz + (v.z - cz) * fx;
  const order = [...sel].sort((a, b) => back(a) - back(b) || fwd(b) - fwd(a));
  const out = [];
  let i = 0;
  rowSizes(shape, n, cols).forEach((k, row) => {
    order.slice(i, i += k).sort((a, b) => side(a) - side(b)).forEach((v, j) => {
      const col = (j - (k - 1) / 2) * spread;
      out.push([v.id, mx - fz * col - fx * row * GAP, mz + fx * col - fz * row * GAP]);
    });
  });
  return out;
}
