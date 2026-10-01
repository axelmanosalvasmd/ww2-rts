// Textured materials for the 3D terrain pieces: house walls and roofs, hedges, stone walls, sandbags, rubble, bridges,
// wire posts and tank traps, and for the HQ tent, single burlap bags, haystacks and the props' rocks and timber. Boxes take their texture coordinates from world position (top faces from x/z, walls from
// the side), so a texture keeps its real size on any box scale and the instanced meshes stay instanced. Every material
// here also darkens itself where the fog of war is, the same way the fog overlay darkens the ground.
import * as THREE from 'three';

const loader = new THREE.TextureLoader();
const textures = new Map(); // file name -> { tex, ready, waiting: [fn] }
// name: a file in client/textures, '.jpg' unless it names its own extension
export function loadTexture(name, onReady) {
  let t = textures.get(name);
  if (!t) {
    t = { tex: null, ready: false, waiting: [] };
    textures.set(name, t);
    const entry = t;
    entry.tex = loader.load(`/client/textures/${name.includes('.') ? name : name + '.jpg'}`, () => { entry.ready = true; entry.waiting.forEach(fn => fn(entry.tex)); entry.waiting = []; });
    entry.tex.wrapS = entry.tex.wrapT = THREE.RepeatWrapping;
    entry.tex.colorSpace = THREE.SRGBColorSpace;
    entry.tex.anisotropy = 4;
  }
  if (t.ready) onReady(t.tex); else t.waiting.push(onReady);
}

// Fog of war on 3D pieces: the overlay mesh only covers the ground, so walls, roofs and props sample the same fog
// texture (client/fog.js: alpha 0 seen, about 0.47 explored, about 0.73 never seen) and mix toward the overlay's
// color. One set of uniforms, shared by every material.
const noFog = new THREE.DataTexture(new Uint8Array(4), 1, 1);
noFog.needsUpdate = true;
const FOW = { fowMap: { value: noFog }, fowSize: { value: new THREE.Vector2(1, 1) } };
// tex: the fog DataTexture (row 0 = the far edge, like the overlay) or null for none; w, h: map size in metres
export function setFogMap(tex, w, h) { FOW.fowMap.value = tex ?? noFog; FOW.fowSize.value.set(w || 1, h || 1); }
// patch a Lambert shader; call from any onBeforeCompile
export function fogShader(shader) {
  shader.uniforms.fowMap = FOW.fowMap;
  shader.uniforms.fowSize = FOW.fowSize;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nuniform vec2 fowSize;\nvarying vec2 vFowUv;')
    .replace('#include <project_vertex>', `#include <project_vertex>
	vec4 fowP = vec4( transformed, 1.0 );
	#ifdef USE_INSTANCING
		fowP = instanceMatrix * fowP;
	#endif
	fowP = modelMatrix * fowP;
	vFowUv = vec2( fowP.x / fowSize.x, 1.0 - fowP.z / fowSize.y );`);
  // The mix runs in the shader's linear working space, before tone mapping and the output conversion, toward the
  // overlay's own color (10 / 255, SHADE in client/fog.js). Both graphics levels then treat a piece like the ground:
  // High draws into a linear render target and converts in a later pass, Low converts here, so a constant placed after
  // the conversion fades pieces toward a much lighter grey on High.
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform sampler2D fowMap;\nvarying vec2 vFowUv;')
    .replace('#include <opaque_fragment>', '#include <opaque_fragment>\ngl_FragColor.rgb = mix( gl_FragColor.rgb, vec3( 0.0392 ), texture2D( fowMap, vFowUv ).a );');
}
function fogOnly(shader) { fogShader(shader); }
// a plain (untextured) material that still goes dark in the fog of war
export function fogged(material) { material.onBeforeCompile = fogOnly; return material; }

// size: metres per texture repeat. flat: the color before the texture arrives (the old untextured look).
// tint: linear color multiplier once textured. top: extra tint on faces that point up (flat roofs, wall tops).
const SURF = {
  plaster: { tex: 'plaster', size: 6, flat: 0xb8a888, tint: [0.78, 0.76, 0.74], top: [0.5, 0.47, 0.44] },
  hedge: { tex: 'hedge', size: 1.6, flat: 0x3f5a2a, tint: [1, 1.35, 1.15], top: [1.15, 1.15, 1] },
  stone: { tex: 'stone', size: 2, flat: 0x9a958a, tint: [1.1, 1.15, 1.2], top: [1.1, 1.1, 1.1] },
  sandbag: { tex: 'sandbag', size: 1, flat: 0x9c8a60, tint: [1.2, 1.3, 1.3], top: [1.1, 1.1, 1.1] }, // stacks drawn as one box
  burlap: { tex: 'burlap', size: 0.5, flat: 0x9c8a60, tint: [0.82, 0.78, 0.68], top: [1.05, 1.05, 1.05] }, // single bags
  canvas: { tex: 'canvas', size: 2.4, flat: 0x5f6440, tint: [0.8, 0.8, 0.7], top: [1.08, 1.08, 1.04] },
  straw: { tex: 'burlap', size: 1.4, flat: 0xa89060, tint: [0.92, 0.82, 0.58], top: [1.05, 1.05, 1.05] },
  rubble: { tex: 'rubble', size: 2, flat: 0x8a8070, tint: [1, 1.15, 1.25], top: [1.05, 1.05, 1.05] },
  wood: { tex: 'planks', size: 1.2, flat: 0x7a5a3a, tint: [1, 0.85, 0.7], top: [1, 1, 1] },
  darkwood: { tex: 'planks', size: 1.2, flat: 0x5a4028, tint: [0.6, 0.48, 0.38], top: [1, 1, 1] },
  steel: { tex: 'steel', size: 1.5, flat: 0x4f4f4c, tint: [0.9, 1, 1.1], top: [1.1, 1.1, 1.1] },
  earth: { tex: 'earth', size: 2, flat: 0x6b5a3e, tint: [2, 2.3, 2.3], top: [1, 1, 1] },
};

// world-planar texture coordinates; one shared function, so every surface shares one shader program
function planar(shader) {
  fogShader(shader);
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
// a shared material for a kind of surface; per-instance colors still multiply it, and with painted, vertex colors too
export function surface(key, painted = false) {
  const id = painted ? `${key}:painted` : key;
  if (cache.has(id)) return cache.get(id);
  const s = SURF[key], m = new THREE.MeshLambertMaterial({ color: s.flat, vertexColors: painted });
  m.userData.uvScale = { value: 1 / s.size };
  m.userData.topTint = { value: new THREE.Color(1, 1, 1) };
  m.onBeforeCompile = planar;
  loadTexture(s.tex, (tex) => {
    m.map = tex; m.color.setRGB(...s.tint); m.userData.topTint.value.setRGB(...s.top);
    m.needsUpdate = true;
  });
  cache.set(id, m);
  return m;
}
