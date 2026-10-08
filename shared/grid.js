// The index stays live between rebuilds. Queries return Map insertion order.
// Heavy units (setHeavy: in the game, everything but infantry) also sit in buckets of their own, so a query that wants
// only them (vehicles shoving, traffic around a squad) skips the crowds of infantry. Their order is the full buckets' order.
let heavy = () => false;
export function setHeavy(test) { heavy = test; }
export class SpatialGrid {
  constructor(units, size = 16) {
    this.size = size; this.rebuild(units);
  }
  rebuild(units = this.units) {
    this.units = units; this.buckets = new Map(); this.heavyBuckets = new Map(); this.records = new Map(); this.owners = new Map(); this.nextOrder = 0;
    for (const u of units.values()) this.update(u);
    return this;
  }
  update(u) {
    const x = Math.floor(u.x / this.size), z = Math.floor(u.z / this.size), old = this.records.get(u.id);
    if (old?.x === x && old.z === z && old.unit === u && old.owner === u.owner) return;
    if (old) { this.buckets.get(old.z)?.get(old.x)?.delete(old); this.heavyBuckets.get(old.z)?.get(old.x)?.delete(old); this.owners.get(old.owner)?.delete(old); }
    const record = { x, z, unit: u, owner: u.owner, order: old?.unit === u ? old.order : this.nextOrder++ };
    this.records.set(u.id, record);
    let row = this.buckets.get(z);
    if (!row) this.buckets.set(z, row = new Map());
    let bucket = row.get(x);
    if (!bucket) row.set(x, bucket = new Set());
    bucket.add(record);
    if (heavy(u)) {
      let hrow = this.heavyBuckets.get(z);
      if (!hrow) this.heavyBuckets.set(z, hrow = new Map());
      let hb = hrow.get(x);
      if (!hb) hrow.set(x, hb = new Set());
      hb.add(record);
    }
    let own = this.owners.get(u.owner);
    if (!own) this.owners.set(u.owner, own = new Set());
    own.add(record);
  }
  ownedBy(owner) {
    return [...(this.owners.get(owner) ?? [])].filter(record => this.units.get(record.unit.id) === record.unit)
      .sort((a, b) => a.order - b.order).map(record => record.unit);
  }
  candidates(at, radius, ordered = true, match = () => true, heavyOnly = false) {
    const result = [], size = this.size, buckets = heavyOnly ? this.heavyBuckets : this.buckets;
    for (let z = Math.floor((at.z - radius) / size); z <= Math.floor((at.z + radius) / size); z++) {
      const row = buckets.get(z);
      if (!row) continue;
      for (let x = Math.floor((at.x - radius) / size); x <= Math.floor((at.x + radius) / size); x++) {
        const bucket = row.get(x);
        if (bucket) for (const record of bucket) if (this.units.get(record.unit.id) === record.unit && match(record.unit)) result.push(record);
      }
    }
    if (ordered && result.length > 1) result.sort((a, b) => a.order - b.order);
    return result.map(record => record.unit);
  }
  radius(at, radius, match = () => true) {
    return this.candidates(at, radius, true, u => Math.hypot(u.x - at.x, u.z - at.z) <= radius && match(u));
  }
  nearest(at, radius, match = () => true) {
    let best = null, distance = radius;
    for (const u of this.radius(at, radius)) {
      const d = Math.hypot(u.x - at.x, u.z - at.z);
      if (match(u) && (best === null || d < distance)) { best = u; distance = d; }
    }
    return best;
  }
}

const indexes = new WeakMap();
export function rebuildGrid(g) {
  let grid = indexes.get(g);
  if (grid) grid.rebuild(g.units);
  else indexes.set(g, grid = new SpatialGrid(g.units));
  return grid;
}
export function gridFor(g) { return indexes.get(g) ?? rebuildGrid(g); }
export function updateGrid(g, u) { indexes.get(g)?.update(u); }
