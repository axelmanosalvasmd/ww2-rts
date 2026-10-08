// Lasting crater marks for World Conquest. Every known crater cell ('+') keeps a crater picture on the ground, so a
// fought-over field still reads as cratered from far off (the painted ground has about two pixels a cell there).
// Blended like the fresh-shell decals in client/fx.js. A crater that floods or is filled in loses its mark; one beside
// another often goes without, so a crater field is not a grid of identical holes.
import * as THREE from 'three';
import { CELL } from '../shared/sim.js';

const CAPACITY = 1536, G = 5, V = G * G, I = (G - 1) * (G - 1) * 6;
function hash(c, salt) {
  let n = Math.imul(c ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(salt, 0xc2b2ae35);
  n ^= n >>> 16; n = Math.imul(n, 0x7feb352d); n ^= n >>> 15;
  return (n >>> 0) / 4294967296;
}

export function createCraterDecals({ parent, hAt, w, grid }) {
  const h = grid.length, positions = new Float32Array(CAPACITY * V * 3), uvs = new Float32Array(CAPACITY * V * 2), index = new Uint32Array(CAPACITY * I);
  for (let s = 0; s < CAPACITY; s++) {
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) uvs.set([i / (G - 1), j / (G - 1)], (s * V + j * G + i) * 2);
    let o = s * I;
    for (let j = 0; j < G - 1; j++) for (let i = 0; i < G - 1; i++) { const b = s * V + j * G + i; index.set([b, b + G, b + 1, b + 1, b + G, b + G + 1], o); o += 6; }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  geometry.setDrawRange(0, 0);
  const map = new THREE.TextureLoader().load(new URL('./textures/fx-crater.webp', import.meta.url).href);
  map.colorSpace = THREE.SRGBColorSpace;
  // ref: the picture's color that leaves the ground as it is (client/fx.js); an old crater is a little paler than a fresh one
  const material = new THREE.ShaderMaterial({
    uniforms: { ...THREE.UniformsUtils.merge([THREE.UniformsLib.fog]), map: { value: map }, ref: { value: new THREE.Vector3(0.146, 0.107, 0.06) } },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      #include <fog_pars_vertex>
      void main() { vUv = uv; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D map; uniform vec3 ref; varying vec2 vUv;
      #include <fog_pars_fragment>
      void main() {
        vec4 t = texture2D(map, vUv);
        vec3 c = mix(vec3(1.0), clamp(pow(t.rgb / ref, vec3(0.85)), 0.0, 2.0), t.a * 0.85);
        #ifdef USE_FOG
          #ifndef FOG_EXP2
            c = mix(c, vec3(1.0), smoothstep(fogNear, fogFar, vFogDepth));
          #endif
        #endif
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
        gl_FragColor.rgb *= 0.5; // blended as 2 x this x the ground
      }`,
    fog: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.DstColorFactor, blendDst: THREE.SrcColorFactor,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'crater-decals'; mesh.frustumCulled = false; mesh.renderOrder = 0.5; mesh.raycast = () => {}; // under the fog overlay (1)
  parent.add(mesh);
  const slots = new Map(), cells = [];
  const crater = (x, y) => grid[y]?.[x] === '+';
  // a crater beside an earlier one (in scan order) is left out about half the time
  const wanted = (c) => {
    const x = c % w, y = Math.floor(c / w);
    if (!crater(x, y)) return false;
    return !((crater(x - 1, y) || crater(x, y - 1)) && hash(c, 3) < 0.5);
  };
  function write(slot, c) {
    const x = c % w, y = Math.floor(c / w), r = 1.5 + 0.6 * hash(c, 1), turn = hash(c, 2) * Math.PI * 2, co = Math.cos(turn), si = Math.sin(turn);
    const cx = (x + 0.5 + (hash(c, 4) - 0.5) * 0.4) * CELL, cz = (y + 0.5 + (hash(c, 5) - 0.5) * 0.4) * CELL;
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
      const u = (i / (G - 1) - 0.5) * 2 * r, v = (j / (G - 1) - 0.5) * 2 * r, px = cx + u * co - v * si, pz = cz + u * si + v * co, k = (slot * V + j * G + i) * 3;
      positions[k] = px; positions[k + 1] = hAt(px, pz) + 0.05; positions[k + 2] = pz;
    }
  }
  return {
    mesh,
    // changed: cell indexes whose type or height may have moved (their neighbours are looked at too)
    update(changed) {
      const look = new Set();
      for (const c of changed ?? []) for (const n of [c, c - 1, c + 1, c - w, c + w]) if (n >= 0 && n < w * h) look.add(n);
      let dirty = false;
      for (const c of look) {
        let slot = slots.get(c);
        if (wanted(c)) {
          if (slot === undefined) { if (cells.length >= CAPACITY) continue; slot = cells.length; cells.push(c); slots.set(c, slot); }
          write(slot, c); dirty = true;
        } else if (slot !== undefined) {
          const last = cells.pop(); slots.delete(c);
          if (slot < cells.length) { cells[slot] = last; slots.set(last, slot); positions.copyWithin(slot * V * 3, cells.length * V * 3, (cells.length + 1) * V * 3); }
          dirty = true;
        }
      }
      if (dirty) { geometry.attributes.position.needsUpdate = true; geometry.setDrawRange(0, cells.length * I); }
    },
    dispose() { mesh.removeFromParent(); geometry.dispose(); material.dispose(); map.dispose(); slots.clear(); cells.length = 0; },
  };
}
