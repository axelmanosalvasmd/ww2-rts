import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('./shared/sim.js', import.meta.url), 'utf8');
const start = source.indexOf('function updateObservedWalls(');
const end = source.indexOf('\nfunction setupClassic', start);
assert.ok(start >= 0 && end > start);
const update = vm.runInNewContext(`(${source.slice(start, end)})`, { MOVE: 1, SIGHT: 2 });
assert.match(source, /updateObservedWalls\(view, flags\.keys\(\), true\)/);

// Independent definition: a wall mask is true exactly when the clipped 3x3
// neighborhood contains a cell that blocks movement and sight.
function reference(flags, w, h) {
  return Uint8Array.from(flags, (_, cell) => {
    const x = cell % w, y = Math.floor(cell / w);
    for (let cy = Math.max(0, y - 1); cy <= Math.min(h - 1, y + 1); cy++)
      for (let cx = Math.max(0, x - 1); cx <= Math.min(w - 1, x + 1); cx++)
        if ((flags[cy * w + cx] & 3) === 3) return 1;
    return 0;
  });
}
let seed = 183;
const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
let cases = 0;
for (const [w, h] of [[1, 1], [1, 17], [19, 1], [2, 2], [3, 5], [7, 11], [31, 17], [128, 97]]) {
  const n = w * h;
  // Every single wall location, including corners and narrow map boundaries.
  const inputs = [new Uint16Array(n), new Uint16Array(n).fill(3)];
  if (n < 600) for (let cell = 0; cell < n; cell++) {
    const flags = new Uint16Array(n); flags[cell] = 3; inputs.push(flags);
  }
  for (let sample = 0; sample < 32; sample++) inputs.push(Uint16Array.from({ length: n }, () => random() & 2047));
  for (const flags of inputs) {
    const walls = new Uint8Array(n).fill(255), writes = new Uint16Array(n);
    const output = new Proxy(walls, { set(target, key, value) { if (/^\d+$/.test(key)) writes[Number(key)]++; target[key] = value; return true; } });
    const view = { w, h, flags, worldNearWalls: output };
    update(view, flags.keys(), true);
    assert.deepEqual(walls, reference(flags, w, h));
    assert.ok(writes.every(count => count === 1), 'initialization writes every cell exactly once');
    for (let pass = 0; pass < 4; pass++) {
      const changed = [...new Set(Array.from({ length: Math.min(n, 9) }, () => random() % n))];
      for (const cell of changed) flags[cell] = random() & 2047;
      update(view, changed);
      assert.deepEqual(walls, reference(flags, w, h), 'incremental edits preserve the complete mask');
    }
    cases++;
  }
}
console.log(`Observed terrain wall initialization and incremental boundaries: ${cases} cases passed`);
