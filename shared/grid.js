// The index stays live between rebuilds. Ordered queries return Map insertion order.
// Heavy units (setHeavy: in the game, everything but infantry) also sit in buckets of their own, so a query that wants
// only them (vehicles shoving, traffic around a squad) skips the crowds of infantry. Their order is the full buckets' order.
let heavy = () => false;
export function setHeavy(test) { heavy = test; }
// Buckets are arrays under one numeric key. After rebuild() every bucket lists its units in the order of the units
// Map, as a fresh index would; update() between rebuilds puts a moved unit at its new bucket's end. rebuild() keeps the
// index and only redoes what moved, so a tick no longer allocates the whole index (#58).
const KEY = 65536, keyOf = (x, z) => z * KEY + x;
const byOrder = (a, b) => a.order - b.order;
function remove(bucket, record) { const i = bucket?.indexOf(record) ?? -1; if (i >= 0) bucket.splice(i, 1); }
export class SpatialGrid {
  constructor(units, size = 16) {
    this.size = size; this.rebuild(units);
  }
  rebuild(units = this.units) {
    if (units !== this.units || !this.records) {
      this.units = units; this.buckets = new Map(); this.heavyBuckets = new Map(); this.records = new Map(); this.owners = new Map(); this.nextOrder = 0;
      this.moved = new Set();
      for (const u of units.values()) this.update(u);
    } else {
      for (const [id, record] of this.records) if (units.get(id) !== record.unit) this.drop(id, record);
      for (const u of units.values()) this.update(u);
    }
    for (const bucket of this.moved) bucket.sort(byOrder);
    this.moved.clear();
    return this;
  }
  drop(id, record) {
    const key = keyOf(record.x, record.z), bucket = this.buckets.get(key), heavyBucket = this.heavyBuckets.get(key);
    remove(bucket, record); remove(heavyBucket, record); this.owners.get(record.owner)?.delete(record); this.records.delete(id);
  }
  update(u) {
    const x = Math.floor(u.x / this.size), z = Math.floor(u.z / this.size), old = this.records.get(u.id);
    if (old?.x === x && old.z === z && old.unit === u && old.owner === u.owner) return;
    if (old) { const key = keyOf(old.x, old.z); remove(this.buckets.get(key), old); remove(this.heavyBuckets.get(key), old); this.owners.get(old.owner)?.delete(old); }
    const record = { x, z, unit: u, owner: u.owner, order: old?.unit === u ? old.order : this.nextOrder++ }, key = keyOf(x, z);
    this.records.set(u.id, record);
    let bucket = this.buckets.get(key);
    if (!bucket) this.buckets.set(key, bucket = []);
    bucket.push(record); this.moved.add(bucket);
    if (heavy(u)) {
      let hb = this.heavyBuckets.get(key);
      if (!hb) this.heavyBuckets.set(key, hb = []);
      hb.push(record); this.moved.add(hb);
    }
    let own = this.owners.get(u.owner);
    if (!own) this.owners.set(u.owner, own = new Set());
    own.add(record);
  }
  ownedBy(owner) {
    return [...(this.owners.get(owner) ?? [])].filter(record => this.units.get(record.unit.id) === record.unit)
      .sort(byOrder).map(record => record.unit);
  }
  candidates(at, radius, ordered = true, match = () => true, heavyOnly = false) {
    const size = this.size, buckets = heavyOnly ? this.heavyBuckets : this.buckets, units = this.units;
    let result = null, runs = null, sorted = true;
    for (let z = Math.floor((at.z - radius) / size); z <= Math.floor((at.z + radius) / size); z++) {
      for (let x = Math.floor((at.x - radius) / size); x <= Math.floor((at.x + radius) / size); x++) {
        const bucket = buckets.get(keyOf(x, z));
        if (!bucket?.length) continue;
        let run = null, last = -1;
        for (const record of bucket) {
          if (units.get(record.unit.id) !== record.unit || !match(record.unit)) continue;
          if (record.order < last) sorted = false;
          last = record.order;
          (run ??= []).push(record);
        }
        if (!run) continue;
        if (!result) result = run; else (runs ??= [result]).push(run);
      }
    }
    if (!result) return [];
    if (runs) {
      // each bucket's matches are in order unless a unit moved since the last rebuild: merge them, else sort
      if (!ordered) result = runs.flat();
      else if (!sorted) result = runs.flat().sort(byOrder);
      else {
        while (runs.length > 1) {
          const next = [];
          for (let i = 0; i < runs.length; i += 2) next.push(i + 1 < runs.length ? merge(runs[i], runs[i + 1]) : runs[i]);
          runs = next;
        }
        result = runs[0];
      }
    } else if (ordered && !sorted) result.sort(byOrder);
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
function merge(a, b) {
  const out = new Array(a.length + b.length);
  let i = 0, j = 0, k = 0;
  while (i < a.length && j < b.length) out[k++] = a[i].order <= b[j].order ? a[i++] : b[j++];
  while (i < a.length) out[k++] = a[i++];
  while (j < b.length) out[k++] = b[j++];
  return out;
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
