import * as THREE from 'three';
import { CFG } from '/shared/sim.js';
import { capturePoint, label } from './markers.js';

// This layer receives only regions already discovered by the player's team.
export function createWorldRegions({ parent, hAt, colorOf, slotColor, team }) {
  const group = new THREE.Group(), views = new Map(); parent.add(group);
  function snapshot(regions) {
    const present = new Set();
    for (const r of regions) {
      present.add(r.id);
      let v = views.get(r.id);
      const text = `${r.name} (${r.kind}): ${r.team === team() ? 'owned' : r.locked ? 'destroy military base' : 'infantry can claim'}`;
      if (!v || v.text !== text) {
        if (v) { group.remove(v.root); dispose(v); }
        const root = new THREE.Group(), cp = capturePoint(CFG.pointRadius, text);
        root.add(cp.group); root.position.set(r.x, hAt(r.x, r.z), r.z);
        const name = label(r.name); name.position.y = 12; root.add(name);
        group.add(root); v = { root, cp, text, border: null }; views.set(r.id, v);
      }
      const color = new THREE.Color(colorOf(r.team));
      v.cp.set(r.team >= 0 ? color.getHex() : null, r.capper >= 0 ? slotColor(r.capper) : null, r.progress ?? 0, !!r.contested);
      v.root.position.y = hAt(r.x, r.z);
      const borderKey = `${r.team}:${r.bounds?.join()}`;
      if (r.bounds && v.borderKey !== borderKey) {
        v.borderKey = borderKey;
        v.border?.geometry.dispose(); v.border?.material.dispose(); v.border?.removeFromParent();
        const [x0, z0, x1, z1] = r.bounds, coords = [];
        // Sample long borders so they remain on the discovered relief.
        const corners = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
        for (let k = 0; k < 4; k++) {
          const [ax, az] = corners[k], [bx, bz] = corners[(k + 1) % 4];
          const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 8));
          for (let i = 0; i < n; i++) { const x = ax + (bx - ax) * i / n, z = az + (bz - az) * i / n; coords.push(new THREE.Vector3(x, hAt(x, z) + 0.2, z)); }
        }
        v.border = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(coords), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.55, depthWrite: false }));
        group.add(v.border);
      }
    }
    for (const [id, v] of views) if (!present.has(id)) { group.remove(v.root); dispose(v); views.delete(id); }
  }
  function dispose(v) {
    v.border?.removeFromParent(); v.border?.geometry.dispose(); v.border?.material.dispose();
    v.root.traverse(o => { if (!o.castShadow) o.geometry?.dispose(); if (Array.isArray(o.material)) o.material.forEach(m => m.dispose()); else if (o.material?.map && o.isSprite) { o.material.map.dispose(); o.material.dispose(); } });
  }
  return { snapshot, frame(dt) { for (const v of views.values()) v.cp.frame(performance.now() / 1000); },
    dispose() { for (const v of views.values()) dispose(v); views.clear(); group.removeFromParent(); } };
}
