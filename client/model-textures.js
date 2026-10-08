// Model textures: surface detail for the unit models (painted armor, gunmetal, rubber, wool, wood...) from one
// texture array, and the shader patch that puts it on the shared vertex-colored materials (PAINT in
// client/unit-models.js, the plane materials in client/aircraft.js).
//
// What each part is made of rides in the per-vertex 'matId' attribute (client/models/geom.js MATS; UNSET takes the
// material's default). The fragment shader samples that layer with triplanar mapping in the model's own space,
// after the posture morphs, so the pattern stays on a turning turret or a soldier lying down. The sample's
// brightness against the layer's mean scales the vertex color, so the vertex color still decides the hue (faction
// paint, markings, the owner color) and the texture adds wear, chips, weave and grain; some layers also bring a
// share of their own color (rust on the tracks, wood grain). Far away the mipmaps average out to the mean and the
// model keeps its painted color. Each layer also supplies roughness, metalness and fine surface relief for the
// shared Standard materials. Vehicles, guns and soldiers carry baked grime (the fraction of matId, see
// mergeParts in client/unit-models.js): a dust film and clumps of dried mud from the mud layer toward the ground.
// Until textures load, and on Graphics Low, texture sampling and surface relief are omitted. Material response
// still follows matId. Low caps metalness so the existing sky fill lights bare metal without environment sampling.
// Shadows use three's own depth materials, so they never see the surface patch.
import * as THREE from 'three';
import { MATS, UNSET, matId } from './models/geom.js';
import { gfx } from './gfx.js';

const SIZE = 512; // each layer is drawn into SIZE x SIZE texels
// Per layer: texels per metre (the 512 texels cover 512 / texels metres; a soldier's metre is 1 / 1.35 of the
// world's, he is scaled up), strength (0 leaves the vertex color alone, 1 the full texture detail), hue (0: the
// texture's light and dark on the vertex color; 1: the texture's own color at the vertex color's brightness, for
// rust and grain whose color is the point), fade (how much of the paint's saturation the weather took) and film (how
// much of the grime's dust film it holds; dark bare steel and rubber shed most of it, so it does not read as rust).
// roughness, metalness and relief describe the outer surface. Paint over steel is a dielectric; exposed metal
// reflects the surroundings. Relief is a small height variation from the existing texture sample, in model units.
export const LAYERS = {
  'armor-paint': { texels: 240, strength: 0.35, hue: 0, fade: 0.06, roughness: 0.68, metalness: 0, relief: 0.006, file: 'armor-paint-refined.jpg' },
  'cast-armor': { texels: 280, strength: 0.3, hue: 0.02, fade: 0.08, roughness: 0.8, metalness: 0, relief: 0.012 },
  gunmetal: { texels: 480, strength: 0.35, hue: 0.03, fade: 0.02, film: 0.35, roughness: 0.42, metalness: 0.85, relief: 0.002 },
  'track-steel': { texels: 420, strength: 0.65, hue: 0.12, fade: 0, film: 0.35, roughness: 0.73, metalness: 0.7, relief: 0.006 },
  rubber: { texels: 480, strength: 0.3, hue: 0, fade: 0.08, film: 0.35, roughness: 0.95, metalness: 0, relief: 0.004 },
  wood: { texels: 600, strength: 0.6, hue: 0.3, fade: 0.06, roughness: 0.84, metalness: 0, relief: 0.006 },
  canvas: { texels: 1400, strength: 0.25, hue: 0.05, fade: 0.06, roughness: 0.94, metalness: 0, relief: 0.004 },
  wool: { texels: 3000, strength: 0.18, hue: 0, fade: 0.06, roughness: 1, metalness: 0, relief: 0.002 },
  leather: { texels: 1600, strength: 0.18, hue: 0.12, fade: 0, film: 0.25, roughness: 0.8, metalness: 0, relief: 0.002 },
  aluminum: { texels: 280, strength: 0.28, hue: 0, fade: 0, roughness: 0.38, metalness: 1, relief: 0.001 },
  'aircraft-paint': { texels: 240, strength: 0.33, hue: 0, fade: 0.06, roughness: 0.6, metalness: 0, relief: 0.002 },
  mud: { texels: 380, strength: 1, hue: 1, fade: 0, roughness: 1, metalness: 0, relief: 0.015 },
  asphalt: { texels: 900, strength: 0.22, hue: 0, fade: 0, roughness: 0.96, metalness: 0, relief: 0.003, file: '../road.jpg' },
  concrete: { texels: 500, strength: 0.16, hue: 0, fade: 0, roughness: 0.92, metalness: 0, relief: 0.002, file: '../plaster.jpg' },
};
// the grime: the mud layer at these texels per metre
const MUD = { texels: 420 };

const shared = {
  uModelTex: { value: null },
  uModelLayer: { value: MATS.map((name) => { const l = LAYERS[name]; return new THREE.Vector4(l.texels / SIZE, l.strength, l.hue, l.fade); }) },
  uModelMean: { value: MATS.map(() => new THREE.Vector3(0.5, 0.5, 0.5)) },
  uModelFilm: { value: MATS.map((name) => LAYERS[name].film ?? 1) },
  uModelSurface: { value: MATS.map((name) => { const l = LAYERS[name]; return new THREE.Vector3(l.roughness, l.metalness, l.relief); }) },
  uModelMud: { value: new THREE.Vector2(MATS.indexOf('mud'), MUD.texels / SIZE) },
  uModelRim: { value: new THREE.Color(0.26, 0.29, 0.34) }, // the rim light: sky blue, linear
};
const patched = []; // [{ material, grime }]
let texture = null;

export const modelTexturesOn = () => !!texture && !gfx.low;

// sRGB byte to linear light: the vertex colors are linear, so the means are taken in linear too
const LINEAR = Float32Array.from({ length: 256 }, (_, i) => { const c = i / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });

// Load the layers (client/textures/models/<name>.jpg) and pack them into the texture array. Once, in a browser;
// through three's default loading manager, so the model viewer waits for them. A layer that fails to load stays
// a flat mid grey, which leaves its parts as they were.
let started = false;
export function loadModelTextures(base = '/client/textures/models/') {
  if (started || typeof document === 'undefined') return;
  started = true;
  const loader = new THREE.ImageLoader(), images = [];
  let left = MATS.length;
  const done = () => { if (--left === 0) pack(images); };
  MATS.forEach((name, i) => loader.load(`${base}${LAYERS[name].file ?? name + '.jpg'}`, (img) => { images[i] = img; done(); }, undefined, () => { console.warn(`model texture ${name} did not load`); done(); }));
}

function pack(images) {
  const layer = SIZE * SIZE * 4, data = new Uint8Array(layer * MATS.length).fill(128);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  MATS.forEach((name, i) => {
    if (images[i]) {
      ctx.clearRect(0, 0, SIZE, SIZE);
      ctx.drawImage(images[i], 0, 0, SIZE, SIZE);
      data.set(ctx.getImageData(0, 0, SIZE, SIZE).data, i * layer);
    }
    let r = 0, g = 0, b = 0;
    for (let k = i * layer, end = k + layer; k < end; k += 4) { r += LINEAR[data[k]]; g += LINEAR[data[k + 1]]; b += LINEAR[data[k + 2]]; }
    const n = SIZE * SIZE;
    shared.uModelMean.value[i].set(r / n, g / n, b / n);
  });
  const t = new THREE.DataArrayTexture(data, SIZE, SIZE, MATS.length);
  // three 0.186 uploads level 0 with texStorage3D for every mip level, then runs gl.generateMipmap on the
  // TEXTURE_2D_ARRAY when generateMipmaps is set (off by default on data array textures); sRGB with RGBA bytes
  // becomes SRGB8_ALPHA8, so sampling and the mipmaps work in linear light
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = 4; // three caps it at what the GPU allows
  t.needsUpdate = true;
  texture = t;
  shared.uModelTex.value = t;
  patched.forEach(defines);
}

// MODEL_TEX turns the sampling on (textures loaded, Graphics High); MODEL_GRIME adds the mud for materials that
// asked for it. MODEL_LOW keeps a cheap diffuse ambient response when the reflection environment is disabled.
// Changing them recompiles the material once; three keeps both programs.
function defines({ material, grime }) {
  const d = { ...material.defines };
  delete d.MODEL_TEX; delete d.MODEL_GRIME; delete d.MODEL_LOW;
  if (material.isMeshStandardMaterial) { d.MODEL_SURFACE = ''; if (gfx.low) d.MODEL_LOW = ''; }
  if (modelTexturesOn()) { d.MODEL_TEX = ''; if (grime) d.MODEL_GRIME = ''; }
  material.defines = d;
  material.needsUpdate = true;
}
gfx.onChange(() => patched.forEach(defines));

// Patch a vertex-colored material to take model textures and, for Standard, each layer's surface response.
// mat: the material of vertices whose
// matId is UNSET (meshes built outside mergeParts); grime: draw the baked grime.
// Every patched material compiles the same shader text and differs only in uniforms and defines, so they share
// programs (three keys programs by the onBeforeCompile source). A material that already patches its shader (the
// planes' paint, client/models/planes.js paintMaterial) keeps that patch: ours goes in first, so its color work
// lands right after the vertex colors and the texture on top of it, and its program key gains a prefix.
export function modelMaterial(material, { mat = 'armor-paint', grime = false } = {}) {
  const own = { uModelDefault: { value: matId(mat) } };
  const before = Object.hasOwn(material, 'onBeforeCompile') ? material.onBeforeCompile : null;
  if (before) {
    const key = material.customProgramCacheKey.bind(material);
    material.onBeforeCompile = (shader, renderer) => { patch(shader, own); before(shader, renderer); };
    material.customProgramCacheKey = () => `model-textures|${key()}`;
  } else material.onBeforeCompile = (shader) => patch(shader, own);
  // a geometry without the attribute reads UNSET (other attributes' defaults, like the planes' camo, stay)
  material.defaultAttributeValues = { ...material.defaultAttributeValues, matId: [UNSET] };
  const entry = { material, grime };
  patched.push(entry);
  defines(entry);
  return material;
}

function patch(shader, own) {
  Object.assign(shader.uniforms, shared, own);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>
#if defined( MODEL_TEX ) || defined( MODEL_SURFACE )
attribute float matId;
flat varying float vModelMat;
varying float vModelGrime;
#endif
#ifdef MODEL_TEX
varying vec3 vModelPos;
varying vec3 vModelNormal;
#endif`)
    .replace('#include <morphtarget_vertex>', `#include <morphtarget_vertex>
#if defined( MODEL_TEX ) || defined( MODEL_SURFACE )
	vModelMat = floor( matId + 0.25 );
	vModelGrime = ( matId - vModelMat ) * 2.0;
#endif
#ifdef MODEL_TEX
	vModelPos = transformed;
	vModelNormal = objectNormal;
#endif`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>
uniform vec3 uModelRim;
#if defined( MODEL_TEX ) || defined( MODEL_SURFACE )
uniform float uModelDefault;
flat varying float vModelMat;
varying float vModelGrime;
#endif
#ifdef MODEL_SURFACE
uniform vec3 uModelSurface[ ${MATS.length} ];
vec3 modelSurface = vec3( 0.8, 0.0, 0.0 );
float modelDetail = 0.0;
float modelHeight = 0.0;
#endif
#ifdef MODEL_TEX
uniform sampler2DArray uModelTex;
uniform vec4 uModelLayer[ ${MATS.length} ];
uniform vec3 uModelMean[ ${MATS.length} ];
uniform float uModelFilm[ ${MATS.length} ];
uniform vec2 uModelMud;
varying vec3 vModelPos;
varying vec3 vModelNormal;
// three planar projections blended by w; explicit gradients, so the branches that skip a zero weight stay safe
vec3 modelTriplanar( float layer, vec3 p, vec3 dx, vec3 dy, vec3 w ) {
	vec3 c = vec3( 0.0 );
	if ( w.x > 0.0 ) c += w.x * textureGrad( uModelTex, vec3( p.zy, layer ), dx.zy, dy.zy ).rgb;
	if ( w.y > 0.0 ) c += w.y * textureGrad( uModelTex, vec3( p.xz, layer ), dx.xz, dy.xz ).rgb;
	if ( w.z > 0.0 ) c += w.z * textureGrad( uModelTex, vec3( p.xy, layer ), dx.xy, dy.xy ).rgb;
	return c;
}
#ifdef MODEL_SURFACE
// Surface-gradient bump mapping, using the color sample already fetched for this fragment.
vec3 modelReliefNormal( vec3 p, vec3 n, vec2 heightGradient, float faceDirection ) {
	vec3 sx = normalize( dFdx( p ) ), sy = normalize( dFdy( p ) );
	vec3 rx = cross( sy, n ), ry = cross( n, sx );
	float det = dot( sx, rx ) * faceDirection;
	vec3 gradient = sign( det ) * ( heightGradient.x * rx + heightGradient.y * ry );
	return normalize( abs( det ) * n - gradient );
}
#endif
#endif`)
    .replace('#include <color_fragment>', `#include <color_fragment>
#ifdef MODEL_SURFACE
	float surfaceId = vModelMat < -1.5 ? uModelDefault : vModelMat;
	modelSurface = surfaceId > -0.5 ? uModelSurface[ int( max( surfaceId, 0.0 ) + 0.5 ) ] : vec3( roughness, metalness, 0.0 );
#endif
#ifdef MODEL_TEX
	{
		const vec3 LUMA = vec3( 0.2126, 0.7152, 0.0722 );
		float id = vModelMat < -1.5 ? uModelDefault : vModelMat;
		int layer = int( max( id, 0.0 ) + 0.5 );
		vec4 look = uModelLayer[ layer ];
		float strength = id > -0.5 ? look.y : 0.0;
		// blend weights from the model-space normal, sharpened, with the faint ones dropped
		vec3 w = pow( abs( vModelNormal ), vec3( 4.0 ) );
		w /= max( w.x + w.y + w.z, 1e-6 );
		w = max( w - 0.04, 0.0 );
		w /= max( w.x + w.y + w.z, 1e-6 );
		vec3 dx = dFdx( vModelPos ), dy = dFdy( vModelPos );
		// mip level the pixel lands on: from level 7 (a 4 x 4 image) up the sample is the layer's mean, so far-off
		// pixels (soldiers' wool at the game camera) skip the texture reads
		float px = min( length( dx ), length( dy ) ), lod = log2( max( px * look.x * ${SIZE}.0, 1e-6 ) );
		vec3 mean = uModelMean[ layer ];
		vec3 tex = lod < 7.0 ? mix( modelTriplanar( float( layer ), vModelPos * look.x, dx * look.x, dy * look.x, w ), mean, smoothstep( 6.0, 7.0, lod ) ) : mean;
		float lt = dot( tex, LUMA ), lm = dot( mean, LUMA ), lv = dot( diffuseColor.rgb, LUMA );
		// Restrained color variation keeps paint and cloth readable. Fine detail also changes roughness and relief.
		vec3 paint = mix( diffuseColor.rgb, vec3( lv ), look.w );
		vec3 detail = mix( paint * clamp( lt / max( lm, 1e-4 ), 0.55, 1.65 ), tex * ( lv / max( lm, 1e-4 ) ), look.z );
		diffuseColor.rgb = mix( diffuseColor.rgb, detail, strength );
	#ifdef MODEL_SURFACE
		modelDetail = clamp( lt / max( lm, 1e-4 ) - 1.0, -1.0, 1.0 ) * strength;
		modelHeight = modelDetail * modelSurface.z;
	#endif
	#ifdef MODEL_GRIME
		// a pale dust film that thickens toward the ground (patchy with the surface's own light and dark), then
		// clumps of dried mud where the grime is high: the mud's light and dark decide which spots take it first, so
		// it comes in as splashes, not a band. Only the clumps read the mud layer. Film and clumps are greyed and
		// never much brighter than the part under them, and each layer holds its own share (film), so dark tracks,
		// tires and gunmetal stay dark steel and rubber with dusty, earthy patches instead of an orange band.
		float g = vModelGrime, film = uModelFilm[ layer ];
		vec3 mm = uModelMean[ int( uModelMud.x + 0.5 ) ];
		float lmm = dot( mm, LUMA );
		vec3 dust = mix( mm, vec3( lmm ), 0.55 ) * 1.5;
		dust *= min( 1.0, ( lv * 2.0 + 0.015 ) / dot( dust, LUMA ) );
		diffuseColor.rgb = mix( diffuseColor.rgb, dust, clamp( g * ( 0.25 + 0.2 * lt / lm ), 0.0, 0.6 ) * film );
		if ( g > 0.3 && log2( max( px * uModelMud.y * ${SIZE}.0, 1e-6 ) ) < 7.0 ) {
			vec3 mud = modelTriplanar( uModelMud.x, vModelPos * uModelMud.y, dx * uModelMud.y, dy * uModelMud.y, w );
			float h = dot( mud, LUMA ) / lmm, edge = mix( 2.3, 0.9, g );
			float clump = smoothstep( edge - 0.2, edge + 0.2, h ) * smoothstep( 0.3, 0.55, g ) * ( 0.5 + 0.5 * film );
			vec3 caked = mix( mm * 1.1, mud, 0.6 );
			caked = mix( caked, vec3( dot( caked, LUMA ) ), 0.55 ) * 0.8;
			caked *= min( 1.0, ( lv * 2.5 + 0.02 ) / max( dot( caked, LUMA ), 1e-4 ) );
			diffuseColor.rgb = mix( diffuseColor.rgb, caked, clump );
		}
	#endif
	}
#endif`)
    .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
#ifdef MODEL_SURFACE
	roughnessFactor = clamp( modelSurface.x - modelDetail * 0.055 + max( vModelGrime, 0.0 ) * 0.12, 0.32, 1.0 );
#endif`)
    .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
#ifdef MODEL_SURFACE
	metalnessFactor = modelSurface.y * ( 1.0 - clamp( vModelGrime, 0.0, 0.85 ) );
	#ifdef MODEL_LOW
		// No reflection map on Low: retain diffuse sky fill on otherwise fully metallic parts.
		metalnessFactor = min( metalnessFactor, 0.25 );
	#endif
#endif`)
    .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
#if defined( MODEL_SURFACE ) && defined( MODEL_TEX )
	normal = modelReliefNormal( -vViewPosition, normal, vec2( dFdx( modelHeight ), dFdy( modelHeight ) ), faceDirection );
#endif`)
    // A thin sky-colored rim where a surface turns away from the camera, so units read against ground of their own
    // color (an olive tank on grass, a brown squad on dirt) at the game camera. Added after the lighting, so it also
    // shows on the shadowed side.
    .replace('#include <opaque_fragment>', `{
	float rim = 1.0 - clamp( dot( normal, normalize( vViewPosition ) ), 0.0, 1.0 );
	rim *= rim;
	outgoingLight += uModelRim * rim * rim * ( 0.2 + 0.8 * diffuseColor.rgb ); // in the paint's own hue, so a man stays brown
}
#include <opaque_fragment>`);
}
