import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import source from './client/models/infantry-authored-data.js';
import { soldier, rigOf } from './client/models/infantry.js';
import { authoredInfantry } from './client/models/infantry-authored.js';

const hash = createHash('sha256').update(readFileSync(new URL('./art/model-reference-2026-10-03/infantry-retopo-v3.glb', import.meta.url))).digest('hex');
assert.equal(source.sourceHash, hash, 'the runtime skin matches the retained Blender input');
assert.equal(source.bones.length, 15);
assert.ok(source.indices.length / 3 <= 6500);
for (let i = 0; i < source.attributes.position.length / 3; i++) {
  const weights = source.attributes.weights.slice(i * 4, i * 4 + 4);
  assert.ok(Math.abs(weights.reduce((a, b) => a + b, 0) - 1) < 1e-5, 'skin weights sum to one');
  for (let k = 0; k < 4; k++) assert.ok(source.attributes.joints[i * 4 + k] < source.bones.length);
}
for (let fac = 0; fac < 4; fac++) for (const type of ['rifle', 'engineer', 'sniper', 'flamer', 'mg', 'mortar']) {
  const model = soldier(type, fac, 0, { color: 0x3b73d6 });
  const near = model.near.children[0].userData.geo, far = model.far.children[0].userData.geo;
  const count = near.attributes.position.count;
  assert.equal(near.attributes.modelUV.count, count, 'atlas coordinates survive merging');
  assert.ok(near.index.count / 3 < 14000, `${type} keeps a bounded near mesh`);
  assert.ok(far.index.count / 3 < 1000, `${type} retains a small distant mesh`);
  for (const pose of [near.attributes, ...near.userData.poses, near.userData.fallen, ...near.userData.gait]) {
    assert.equal(pose.position.count, count, 'all animation frames share topology');
    for (const value of pose.position.array) assert.ok(Number.isFinite(value) && Math.abs(value) < 5, 'pose has finite local bounds');
    for (const value of pose.normal.array) assert.ok(Number.isFinite(value), 'pose normals are finite');
  }
}
// A tiny belt triangle previously followed a thigh and stretched by 20 cm in a crouch.
for (const posture of [0, 1, 2, 3, 'fallen']) {
  const geo = authoredInfantry(rigOf('rifle', 1, 0, posture), { fac: 1, F: { tunic: 0x5d6668 } });
  const p = geo.attributes.position.array, rest = source.attributes.position;
  for (let i = 0; i < geo.index.count; i += 3) for (let k = 0; k < 3; k++) {
    const a = geo.index.array[i + k], b = geo.index.array[i + (k + 1) % 3];
    const length = values => Math.hypot(...[0, 1, 2].map(axis => values[a * 3 + axis] - values[b * 3 + axis]));
    assert.ok(length(p) - length(rest) < .26, 'skin does not produce long detached spikes');
    if (length(rest) < .01) assert.ok(length(p) < .075, 'small surface details stay attached');
  }
}
console.log('PASS authored infantry source, four factions, atlas retention, poses, distant meshes and skin continuity');
