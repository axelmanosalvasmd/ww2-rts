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

export function facingSpots(items, at, face, reach) {
  if (!items.length) return [];
  const dx = Math.cos(face), dz = Math.sin(face), ax = -dz, az = dx;
  const sorted = items.map((u, i) => ({ u, i })).sort((a, b) => a.u.x * ax + a.u.z * az - (b.u.x * ax + b.u.z * az) || a.i - b.i);
  const ranks = Math.ceil(items.length / 10), cols = Math.ceil(items.length / ranks), out = [];
  let back = 0;
  for (let start = 0; start < sorted.length; start += cols) {
    const rank = sorted.slice(start, start + cols), natural = rank.reduce((s, p) => s + p.u.size, 0);
    const width = rank.length > 1 ? Math.max(natural, Math.min(3 * natural, Number.isFinite(reach) ? reach : natural)) : natural, gap = rank.length > 1 ? (width - natural) / (rank.length - 1) : 0;
    let along = -width / 2;
    for (const { u } of rank) {
      along += u.size / 2;
      out.push([u.id, at.x + ax * along - dx * back, at.z + az * along - dz * back]);
      along += u.size / 2 + gap;
    }
    // A later rank leaves the deepest slot above it clear, with another 1.5 m between ranks.
    back += Math.max(...rank.map(p => p.u.size)) + 1.5;
  }
  return out;
}
