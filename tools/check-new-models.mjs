// builds the newest models in Node and prints their triangle counts
import { gunModel } from '../client/models/guns.js';
import * as AM from '../client/models/armor-medium.js';
import * as THREE from 'three';
const looks = [{ vehicle: 0x59623d, color: 0x3b73d6, uniform: 0x6b7248 }, { vehicle: 0x50565a, color: 0xcc3a2e, uniform: 0x5c6266 }, { vehicle: 0x4e5a38, color: 0xece6d6, uniform: 0x7d7250 }];
const tris = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;
for (let f = 0; f < 3; f++) {
  const h = gunModel('howitzer', f, looks[f]);
  console.log('howitzer', f, tris(h.geo), 'far', tris(h.far), 'tip', h.tip.map((v) => v.toFixed(2)).join(','));
  const v = { models: [] }, root = new THREE.Group();
  AM.buildArmorMedium(v, root, 'tankdestroyer', f, looks[f]);
  let n = 0; root.traverse((o) => { if (o.userData.geo) n += tris(o.userData.geo); });
  console.log('td', f, n, 'traverse', v.traverse);
}
import { soldier } from '../client/models/infantry.js';
for (let f = 0; f < 3; f++) for (let i = 0; i < 3; i++) { const s = soldier('flamer', f, i, looks[f]); console.log('flamer', f, i, s.kit, tris(s.near.children[0].userData.geo)); }
for (let f = 0; f < 3; f++) for (let i = 0; i < 4; i++) { const s = soldier('howitzer', f, i, looks[f]); console.log('howcrew', f, i, s.kit); }
