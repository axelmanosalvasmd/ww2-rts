// Shared by the order preview and the sim so both place the same formation.
export function normalizeFace(a) {
  if (!Number.isFinite(a)) return null;
  const f = Math.atan2(Math.sin(a), Math.cos(a));
  return f === -Math.PI ? Math.PI : f;
}

export function slotSize(def) {
  // The diameter plus 1.5 m leaves room between hulls and squads. Match the sim's 3 m infantry and 5 m vehicle minimums.
  return Math.max(def.infantry ? 3 : 5, 2 * def.radius + 1.5);
}

// The shapes the Formation menu offers. line: ranks of up to ten, or as many as fit the drag; block: a square, also
// widened by a drag; column: two files deep; wedge: an arrowhead, one unit at the tip.
export const SHAPES = ['line', 'block', 'column', 'wedge'];
// how many stand in each rank, front first; fit is how many the drag has room for side by side
function rankSizes(shape, n, fit) {
  if (shape === 'wedge') { const r = []; for (let k = 1, left = n; left > 0; left -= k++) r.push(Math.min(k, left)); return r; }
  const base = shape === 'column' ? Math.min(n, 2) : shape === 'block' ? Math.ceil(Math.sqrt(n)) : Math.ceil(n / Math.ceil(n / 10));
  const cols = shape === 'column' ? base : Math.max(base, Math.min(n, fit));
  return Array.from({ length: Math.ceil(n / cols) }, (_, i) => Math.min(cols, n - i * cols));
}

// items: { id, x, z, size, back? }. Ranks run across the facing, the first one through `at`, later ones behind it.
// reach (the drag's length) widens the frontage: a line or block takes as many side by side as fit, and a single rank
// spreads out to at most three times its natural width. spread scales every gap (Tighten / Spread).
// Units marked back (mortars, medics) take the rear ranks; otherwise those already furthest forward stand in front,
// and each rank keeps its units' left to right order so their paths do not cross.
export function facingSpots(items, at, face, reach, { shape = 'line', spread = 1 } = {}) {
  if (!items.length) return [];
  const dx = Math.cos(face), dz = Math.sin(face), ax = -dz, az = dx, side = u => u.x * ax + u.z * az;
  const avg = items.reduce((s, u) => s + u.size, 0) / items.length * spread;
  const fixed = shape === 'column' || shape === 'wedge', far = Number.isFinite(reach) && !fixed ? reach : 0;
  const sizes = rankSizes(shape, items.length, Math.floor(far / avg));
  const order = items.map((u, i) => ({ u, i })).sort((a, b) => (a.u.back ? 1 : 0) - (b.u.back ? 1 : 0)
    || Math.round((b.u.x - a.u.x) * dx * 100 + (b.u.z - a.u.z) * dz * 100) || a.i - b.i);
  const out = [];
  let back = 0, start = 0;
  for (const k of sizes) {
    const rank = order.slice(start, start += k).sort((a, b) => side(a.u) - side(b.u) || a.i - b.i);
    const natural = rank.reduce((s, p) => s + p.u.size, 0), tight = natural * spread;
    const width = rank.length > 1 ? Math.max(tight, Math.min(3 * tight, far)) : natural, gap = rank.length > 1 ? (width - natural) / (rank.length - 1) : 0;
    let along = -width / 2;
    for (const { u } of rank) {
      along += u.size / 2;
      out.push([u.id, at.x + ax * along - dx * back, at.z + az * along - dz * back]);
      along += u.size / 2 + gap;
    }
    // A later rank leaves the deepest slot above it clear, with another 1.5 m between ranks.
    back += (Math.max(...rank.map(p => p.u.size)) + 1.5) * spread;
  }
  return out;
}
