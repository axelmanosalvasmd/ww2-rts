import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { soldier } from './client/models/infantry.js';
import { buildModel } from './client/unit-models.js';
import { UNITS } from './shared/sim.js';

const diggers = ['rifle', 'conscript', 'engineer'];
test('digging figures retain all poses and strokes inside the existing far LOD budget', () => {
  for (const fac of [0, 1, 2, 3]) for (const type of diggers) for (const i of [0, 1]) {
    const figure = soldier(type, fac, i, { color: 0xff00ff });
    for (const [lod, budget] of [['near', 14000], ['far', 150]]) {
      assert.equal(figure[lod].children.length, 1, `${type}/${fac}/${i}: one ${lod} body`);
      const g = figure[lod].children[0].userData.geo, n = g.attributes.position.count;
      assert.ok(g.index.count / 3 <= budget, `${type}/${fac}/${i}: ${lod} fits ${budget} triangles (actual ${g.index.count / 3})`);
      assert.equal(g.userData.poses.length, 3, 'suppression and retreat posture targets stay separate from gait');
      assert.equal(g.userData.gait.length, 24, 'twenty movement frames and four shovel strokes remain');
      for (const frame of [...g.userData.poses, ...g.userData.gait, g.userData.fallen]) {
        assert.equal(frame.position.count, n, 'every frame keeps the base topology');
        assert.equal(frame.normal.count, n, 'every frame keeps its normals');
        assert.ok(frame.position.array.every(Number.isFinite) && frame.normal.array.every(Number.isFinite));
      }
      const dig = g.userData.gait.slice(20);
      for (let j = 0; j < dig.length; j++) {
        const next = dig[(j + 1) % dig.length];
        assert.ok(dig[j].position.array.some((v, k) => Math.abs(v - next.position.array[k]) > 1e-4), 'each shovel stroke has a distinct body/tool pose');
      }
      if (lod === 'far') {
        // The four tool faces precede the twelve faces of the far kit bag.
        const faces = [], edges = new Map(), vertices = new Map(), p = g.attributes.position;
        for (let t = g.index.count / 3 - 16; t < g.index.count / 3 - 12; t++) {
          const face = [];
          for (let k = 0; k < 3; k++) {
            const v = new THREE.Vector3().fromBufferAttribute(p, g.index.getX(t * 3 + k));
            const key = v.toArray().map(x => x.toFixed(8)).join(',');
            vertices.set(key, v); face.push({ key, v });
          }
          faces.push(face);
          for (let k = 0; k < 3; k++) {
            const key = [face[k].key, face[(k + 1) % 3].key].sort().join('|');
            edges.set(key, (edges.get(key) ?? 0) + 1);
          }
        }
        assert.equal(vertices.size, 4, 'the far shovel is one tetrahedron');
        assert.equal(edges.size, 6);
        assert.ok([...edges.values()].every(count => count === 2), 'the tool is closed for the existing FrontSide material');
        const center = [...vertices.values()].reduce((sum, v) => sum.add(v), new THREE.Vector3()).multiplyScalar(0.25);
        for (const face of faces) {
          const [a, b, c] = face.map(x => x.v), normal = b.clone().sub(a).cross(c.clone().sub(a));
          const outside = a.clone().add(b).add(c).multiplyScalar(1 / 3).sub(center);
          assert.ok(normal.dot(outside) > 0, 'every tool face points outward');
        }
      }
    }
  }
});

test('baked digger morphs keep three postures plus twenty movement and four work frames', () => {
  for (const type of [...diggers, 'sniper']) {
    const view = { type, owner: 0, models: [] }, root = new THREE.Group();
    buildModel(view, root, { color: 0xff00ff, uniform: 0x777755, vehicle: 0x555544 }, 0, UNITS[type]);
    for (const man of view.models) for (const lod of ['hi', 'lo']) {
      assert.equal(man.userData[lod].length, 1, 'one draw per figure and LOD');
      const g = man.userData[lod][0].geometry, expected = type === 'sniper' ? 23 : 27;
      assert.equal(g.morphAttributes.position.length, expected);
      assert.equal(g.morphAttributes.normal.length, expected);
      assert.ok(g.morphAttributes.position.every(frame => frame.count === g.attributes.position.count));
    }
  }
});
