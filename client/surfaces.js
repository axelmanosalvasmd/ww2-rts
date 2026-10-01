// Textured materials for the 3D terrain pieces: house walls and roofs, hedges, stone walls, sandbags, rubble, bridges,
// wire posts and tank traps. Boxes take their texture coordinates from world position (top faces from x/z, walls from
// the side), so a texture keeps its real size on any box scale and the instanced meshes stay instanced.
import * as THREE from 'three';

const loader = new THREE.TextureLoader();
const textures = new Map(); // file name -> { tex, ready, waiting: [fn] }
function texture(name, onReady) {
  let t = textures.get(name);
  if (!t) {
    t = { tex: null, ready: false, waiting: [] };
    textures.set(name, t);
    const entry = t;
    entry.tex = loader.load(`/client/textures/${name}.jpg`, () => { entry.ready = true; entry.waiting.forEach(fn => fn(entry.tex)); entry.waiting = []; });
    entry.tex.wrapS = entry.tex.wrapT = THREE.RepeatWrapping;
    entry.tex.colorSpace = THREE.SRGBColorSpace;
    entry.tex.anisotropy = 4;
  }
  if (t.ready) onReady(t.tex); else t.waiting.push(onReady);
}

// size: metres per texture repeat. flat: the color before the texture arrives (the old untextured look).
// tint: linear color multiplier once textured. top: extra tint on faces that point up (flat roofs, wall tops).
const SURF = {
  plaster: { tex: 'plaster', size: 6, flat: 0xb8a888, tint: [0.78, 0.76, 0.74], top: [0.5, 0.47, 0.44] },
  hedge: { tex: 'hedge', size: 1.6, flat: 0x3f5a2a, tint: [1, 1.35, 1.15], top: [1.15, 1.15, 1] },
  stone: { tex: 'stone', size: 2, flat: 0x9a958a, tint: [1.1, 1.15, 1.2], top: [1.1, 1.1, 1.1] },
  sandbag: { tex: 'sandbag', size: 1, flat: 0x9c8a60, tint: [1.2, 1.3, 1.3], top: [1.1, 1.1, 1.1] },
  rubble: { tex: 'rubble', size: 2, flat: 0x8a8070, tint: [1, 1.15, 1.25], top: [1.05, 1.05, 1.05] },
  wood: { tex: 'planks', size: 1.2, flat: 0x7a5a3a, tint: [1, 0.85, 0.7], top: [1, 1, 1] },
  darkwood: { tex: 'planks', size: 1.2, flat: 0x5a4028, tint: [0.6, 0.48, 0.38], top: [1, 1, 1] },
  steel: { tex: 'steel', size: 1.5, flat: 0x4f4f4c, tint: [0.9, 1, 1.1], top: [1.1, 1.1, 1.1] },
  earth: { tex: 'earth', size: 2, flat: 0x6b5a3e, tint: [2, 2.3, 2.3], top: [1, 1, 1] },
};

// world-planar texture coordinates; one shared function, so every surface shares one shader program
function planar(shader) {
  shader.uniforms.uvScale = this.userData.uvScale;
  shader.uniforms.topTint = this.userData.topTint;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nuniform float uvScale;\nvarying float vTop;')
    .replace('#include <project_vertex>', `#include <project_vertex>
	vec4 gw = vec4( transformed, 1.0 );
	vec3 gn = objectNormal;
	#ifdef USE_INSTANCING
		gw = instanceMatrix * gw;
		gn = mat3( instanceMatrix ) * gn;
	#endif
	gw = modelMatrix * gw;
	gn = normalize( mat3( modelMatrix ) * gn );
	vec3 an = abs( gn );
	vTop = smoothstep( 0.5, 0.9, gn.y );
	#ifdef USE_MAP
		vMapUv = ( an.y > 0.5 ? gw.xz : an.x > an.z ? gw.zy : gw.xy ) * uvScale;
	#endif`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform vec3 topTint;\nvarying float vTop;')
    .replace('#include <color_fragment>', '#include <color_fragment>\n\tdiffuseColor.rgb *= mix( vec3( 1.0 ), topTint, vTop );');
}

const cache = new Map();
// a shared material for a kind of surface; per-instance colors still multiply it
export function surface(key) {
  if (cache.has(key)) return cache.get(key);
  const s = SURF[key], m = new THREE.MeshLambertMaterial({ color: s.flat });
  m.userData.uvScale = { value: 1 / s.size };
  m.userData.topTint = { value: new THREE.Color(1, 1, 1) };
  m.onBeforeCompile = planar;
  texture(s.tex, (tex) => {
    m.map = tex; m.color.setRGB(...s.tint); m.userData.topTint.value.setRGB(...s.top);
    m.needsUpdate = true;
  });
  cache.set(key, m);
  return m;
}

// gable roof: a triangle (span wide, 0.4 * span high) pushed len along z and centered. The caps are plaster; the
// slopes carry roof tiles, rows along the ridge, counted up from the eave.
const TAN = 0.8, SIN = TAN / Math.hypot(1, TAN), TILE_M = 1.6;
export function roofGeometry(span, len) {
  const shape = new THREE.Shape([new THREE.Vector2(-span / 2, 0), new THREE.Vector2(span / 2, 0), new THREE.Vector2(0, span * TAN / 2)]);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: false });
  geo.translate(0, 0, -len / 2);
  const pos = geo.attributes.position, uv = geo.attributes.uv, side = geo.groups.find(g => g.materialIndex === 1);
  for (let i = side.start; i < side.start + side.count; i++) uv.setXY(i, pos.getZ(i) / TILE_M, pos.getY(i) / SIN / TILE_M);
  uv.needsUpdate = true;
  return geo;
}

let roofTiles = null;
export function roofMaterials() {
  if (!roofTiles) {
    const m = roofTiles = new THREE.MeshLambertMaterial({ color: 0x7a3f2c });
    texture('roof', (tex) => { m.map = tex; m.color.setRGB(0.85, 0.85, 0.85); m.needsUpdate = true; });
  }
  return [surface('plaster'), roofTiles];
}
