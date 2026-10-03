import * as THREE from 'three';
import { gfx } from './gfx.js';

// The authored character keeps its UVs through every baked pose and crowd instance.
// A zero third coordinate marks weapons and other parts without an atlas.
const white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
const flat = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1);
white.needsUpdate = flat.needsUpdate = true;
const uniforms = {
  uInfantryColor: { value: white }, uInfantryNormal: { value: flat },
  uInfantryReady: { value: 0 }, uInfantryDetail: { value: gfx.low ? 0 : 1 },
};
gfx.onChange(() => { uniforms.uInfantryDetail.value = gfx.low ? 0 : 1; });
let started = false;
export function loadInfantryTextures() {
  if (started || typeof document === 'undefined') return;
  started = true;
  const loader = new THREE.TextureLoader();
  loader.load('/client/textures/models/infantry-v3-color.jpg', texture => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.flipY = false;
    texture.anisotropy = 4;
    uniforms.uInfantryColor.value = texture;
    uniforms.uInfantryReady.value = 1;
  });
  loader.load('/client/textures/models/infantry-v3-normal.jpg', texture => {
    texture.flipY = false;
    texture.anisotropy = 4;
    uniforms.uInfantryNormal.value = texture;
  });
}

export function infantryMaterial(material) {
  const before = material.onBeforeCompile;
  const key = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    before.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 modelUV;\nvarying vec3 vInfantryUV;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvInfantryUV = modelUV;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vInfantryUV;
uniform sampler2D uInfantryColor;
uniform sampler2D uInfantryNormal;
uniform float uInfantryReady;
uniform float uInfantryDetail;
vec3 infantryNormal(vec3 n) {
  vec3 p = -vViewPosition;
  vec3 q0 = dFdx(p), q1 = dFdy(p);
  vec2 st0 = dFdx(vInfantryUV.xy), st1 = dFdy(vInfantryUV.xy);
  vec3 q1perp = cross(q1, n), q0perp = cross(n, q0);
  vec3 t = q1perp * st0.x + q0perp * st1.x;
  vec3 b = q1perp * st0.y + q0perp * st1.y;
  float scale = inversesqrt(max(max(dot(t, t), dot(b, b)), 1e-12));
  vec3 mapN = texture2D(uInfantryNormal, vInfantryUV.xy).xyz * 2.0 - 1.0;
  mapN.xy *= 0.65;
  return normalize(mat3(t * scale, b * scale, n) * mapN);
}`)
      .replace('#include <roughnessmap_fragment>', `
if (vInfantryUV.z > 0.5 && uInfantryReady > 0.5) {
  vec3 albedo = texture2D(uInfantryColor, vInfantryUV.xy).rgb;
  float cloth = clamp(vInfantryUV.z - 1.0, 0.0, 1.0);
  float peak = max(albedo.r, max(albedo.g, albedo.b));
  // Remove the strongest baked highlights from cloth so scene lighting supplies them.
  albedo /= 1.0 + cloth * max(0.0, peak - 0.20) * 3.0;
  diffuseColor.rgb *= albedo;
}
#include <roughnessmap_fragment>`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
if (vInfantryUV.z > 0.5 && uInfantryReady > 0.5 && uInfantryDetail > 0.5) {
  normal = infantryNormal(normal);
}`);
  };
  material.customProgramCacheKey = () => `infantry-atlas-v3|${key()}`;
  material.defaultAttributeValues = { ...material.defaultAttributeValues, modelUV: [0, 0, 0] };
  return material;
}
