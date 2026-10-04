// The ground canvas supplies the paint. Relief adds world-sized rock, soil and dry brushing.
import * as THREE from 'three';
import { CFG } from '../shared/sim.js';

const VERT_PARS = /* glsl */`
attribute vec4 reliefPaint;
attribute float reliefScar;
varying vec3 vReliefPosition;
varying vec3 vReliefNormal;
varying vec4 vReliefPaint;
varying float vReliefScar;
`;

const VERT_MAIN = /* glsl */`
vReliefPosition = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
vReliefNormal = normalize( mat3( modelMatrix ) * objectNormal );
vReliefPaint = reliefPaint;
vReliefScar = reliefScar;
`;

const FRAG_PARS = /* glsl */`
varying vec3 vReliefPosition;
varying vec3 vReliefNormal;
varying vec4 vReliefPaint;
varying float vReliefScar;
uniform float uReliefStep;

#ifndef RELIEF_LOW
float reliefHash( vec3 p ) {
	p = fract( p * 0.1031 );
	p += dot( p, p.yzx + 33.33 );
	return fract( ( p.x + p.y ) * p.z );
}

float reliefNoise2( vec2 p ) {
	vec2 i = floor( p ), f = fract( p );
	f = f * f * ( 3.0 - 2.0 * f );
	return mix(
		mix( reliefHash( vec3( i, 0.0 ) ), reliefHash( vec3( i + vec2( 1.0, 0.0 ), 0.0 ) ), f.x ),
		mix( reliefHash( vec3( i + vec2( 0.0, 1.0 ), 0.0 ) ), reliefHash( vec3( i + vec2( 1.0, 1.0 ), 0.0 ) ), f.x ), f.y );
}

float reliefNoise( vec3 p ) {
	vec3 i = floor( p ), f = fract( p );
	f = f * f * ( 3.0 - 2.0 * f );
	return mix(
		mix( mix( reliefHash( i ), reliefHash( i + vec3( 1.0, 0.0, 0.0 ) ), f.x ),
			mix( reliefHash( i + vec3( 0.0, 1.0, 0.0 ) ), reliefHash( i + vec3( 1.0, 1.0, 0.0 ) ), f.x ), f.y ),
		mix( mix( reliefHash( i + vec3( 0.0, 0.0, 1.0 ) ), reliefHash( i + vec3( 1.0, 0.0, 1.0 ) ), f.x ),
			mix( reliefHash( i + vec3( 0.0, 1.0, 1.0 ) ), reliefHash( i + vec3( 1.0, 1.0, 1.0 ) ), f.x ), f.y ), f.z );
}
#endif
`;

const FRAG_PAINT = /* glsl */`
vec3 reliefN = normalize( vReliefNormal );
float reliefSteep = 1.0 - abs( reliefN.y );
float reliefRock = clamp( vReliefPaint.x, 0.0, 1.0 );
float reliefLip = clamp( vReliefPaint.y, 0.0, 1.0 );
float reliefFoot = clamp( vReliefPaint.z, 0.0, 1.0 );
float reliefDamp = clamp( vReliefPaint.w, 0.0, 1.0 );
float reliefPatch = 0.5;
#ifndef RELIEF_LOW
	reliefPatch = reliefNoise2( vReliefPosition.xz * 0.52 );
#endif
float reliefHeight = smoothstep( -5.0, 10.0, vReliefPosition.y );
vec3 reliefTint = mix( vec3( 1.01, 0.98, 0.92 ), vec3( 1.12, 1.05, 0.98 ), reliefHeight );
diffuseColor.rgb *= reliefTint;

// At 45 degrees the dry earth reaches its full coverage; patches leave grass showing through.
// Dug ground stays the paint colour. The tan slope mix was drawing a pale ring around each bomb.
float reliefSlope = smoothstep( 0.05, 0.2929, reliefSteep );
float reliefScarGate = 1.0 - clamp( vReliefScar, 0.0, 1.0 );
float reliefEarth = reliefSlope * 0.55 * reliefScarGate;
#ifndef RELIEF_LOW
	reliefEarth *= 0.5 + 0.5 * smoothstep( 0.20, 0.68, reliefPatch );
#endif
float reliefWetEarth = reliefDamp * 0.24;
vec3 reliefSoil = mix( vec3( 0.16, 0.115, 0.065 ), vec3( 0.14, 0.14, 0.075 ), reliefDamp );
diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.32, 0.24, 0.12 ), reliefEarth );
diffuseColor.rgb = mix( diffuseColor.rgb, reliefSoil, reliefWetEarth );
diffuseColor.rgb *= 1.0 - 0.16 * reliefSlope * ( 1.0 - reliefRock );
// Each raised level dries and lightens the painted ground, capped at three levels.
float reliefLevel = clamp( vReliefPosition.y / uReliefStep, 0.0, 3.0 );
float reliefPlateau = reliefLevel * ( 1.0 - reliefSlope ) * ( 1.0 - reliefRock )
	* ( 1.0 - reliefFoot ) * ( 1.0 - reliefDamp ) * ( 1.0 - clamp( vReliefScar, 0.0, 1.0 ) );
diffuseColor.rgb *= vec3( 1.0 ) + vec3( 0.13, 0.12, 0.10 ) * reliefPlateau;

// A warm rim follows actual cliff lips, without painting bands through ordinary hills.
float reliefCrest = smoothstep( 0.20, 0.38, reliefLip )
	* ( 1.0 - smoothstep( 0.38, 0.62, reliefLip ) )
	* ( 1.0 - reliefSlope ) * ( 1.0 - reliefRock ) * ( 1.0 - reliefFoot ) * ( 1.0 - reliefDamp );
diffuseColor.rgb *= vec3( 1.0 ) + vec3( 0.06, 0.05, 0.035 ) * reliefCrest;

if ( reliefRock > 0.001 ) {
	float reliefEdgeNoise = 0.5;
	float reliefStrata = step( 0.5, fract( vReliefPosition.y / 1.6 ) ) * 2.0 - 1.0;
	float reliefBandPaint = 1.0 + 0.25 * reliefStrata;
	float reliefDetail = 1.0;
	float reliefCrack = 0.0;
	#ifndef RELIEF_LOW
		float reliefWarp = reliefNoise2( vReliefPosition.xz * 0.18 + 3.7 );
		float reliefGrain = reliefNoise( vReliefPosition * vec3( 2.2, 3.6, 2.2 ) );
		// Each 1.7 m pair splits into two strata, both between 0.5 and 1.2 m tall.
		float reliefBandHeight = vReliefPosition.y + ( reliefWarp - 0.5 ) * 0.40;
		float reliefPair = floor( reliefBandHeight / 1.7 );
		float reliefWithinPair = reliefBandHeight - reliefPair * 1.7;
		float reliefSplit = 0.5 + 0.7 * reliefHash( vec3( reliefPair, 7.0, 11.0 ) );
		float reliefUpperBand = step( reliefSplit, reliefWithinPair );
		float reliefBandId = reliefPair * 2.0 + reliefUpperBand;
		float reliefBandBottom = mix( 0.0, reliefSplit, reliefUpperBand );
		float reliefBandTop = mix( reliefSplit, 1.7, reliefUpperBand );
		float reliefAboveEdge = reliefWithinPair - reliefBandBottom;
		float reliefBelowEdge = reliefBandTop - reliefWithinPair;
		float reliefBandHash = reliefHash( vec3( reliefBandId, 13.0, 5.0 ) );
		// Adjacent strata alternate dark and light with independent 22 to 30 percent amplitudes.
		reliefBandPaint = 1.0 + ( reliefUpperBand * 2.0 - 1.0 ) * ( 0.22 + 0.08 * reliefBandHash );
		float reliefEdgePixel = max( fwidth( reliefBandHeight ) * 0.5, 0.003 );
		float reliefSeamWidth = 0.03 + 0.02 * reliefBandHash;
		float reliefSeam = ( 1.0 - smoothstep( reliefSeamWidth - reliefEdgePixel, reliefSeamWidth + reliefEdgePixel, reliefAboveEdge ) )
			* step( 0.40, reliefBandHash );
		float reliefBrush = ( 1.0 - smoothstep( 0.02, 0.09, reliefBelowEdge ) )
			* step( 0.58, reliefHash( vec3( reliefBandId, 17.0, 31.0 ) ) )
			* smoothstep( 0.30, 0.65, reliefGrain );
		float reliefFine = clamp( ( reliefNoise( vReliefPosition * vec3( 8.0, 12.0, 8.0 ) ) - 0.5 ) * 4.0, -1.0, 1.0 );
		float reliefChip = smoothstep( 0.52, 0.65, reliefGrain ) * smoothstep( 0.0, 0.70, reliefFine );
		reliefDetail = ( 1.0 + 0.12 * reliefFine ) * ( 1.0 - 0.40 * reliefSeam )
			* ( 1.0 + 0.18 * reliefBrush + 0.22 * reliefChip );
		reliefEdgeNoise = reliefPatch * 0.6 + reliefGrain * 0.4;
		// Sparse cracks follow the face's horizontal axis, with a small sideways wander.
		float reliefAlong = dot( vReliefPosition.xz, vec2( abs( reliefN.z ), abs( reliefN.x ) ) );
		float reliefCrackCell = floor( reliefAlong / 3.8 );
		float reliefCrackCentre = 3.8 * ( 0.15 + 0.70 * reliefHash( vec3( reliefCrackCell, 0.0, 19.0 ) ) );
		float reliefCrackDistance = abs( reliefAlong - reliefCrackCell * 3.8 - reliefCrackCentre + ( reliefGrain - 0.5 ) * 0.18 );
		float reliefCrackWidth = max( 0.025, fwidth( reliefAlong ) * 0.5 );
		reliefCrack = ( 1.0 - smoothstep( reliefCrackWidth, reliefCrackWidth * 2.0, reliefCrackDistance ) )
			* step( 0.68, reliefHash( vec3( reliefCrackCell, 23.0, 2.0 ) ) );
		// Long, irregular streaks start under the lip and fade several metres down the face.
		float reliefStreakCell = floor( reliefAlong / 2.7 );
		float reliefStreakHash = reliefHash( vec3( reliefStreakCell, 29.0, 41.0 ) );
		float reliefStreakCentre = ( reliefStreakCell + 0.15 + 0.70 * reliefStreakHash ) * 2.7;
		float reliefStreakDistance = abs( reliefAlong - reliefStreakCentre
			+ 0.04 * sin( vReliefPosition.y * 0.65 + reliefStreakHash * 6.28 ) );
		float reliefStreakWidth = 0.05 + 0.10 * reliefStreakHash;
		float reliefStreakPixel = max( fwidth( reliefAlong ) * 0.5, 0.005 );
		float reliefBelowLip = vReliefPaint.y - vReliefPosition.y;
		float reliefStreakLength = 2.0 + 4.0 * reliefStreakHash;
		float reliefStreak = ( 1.0 - smoothstep( reliefStreakWidth - reliefStreakPixel, reliefStreakWidth + reliefStreakPixel, reliefStreakDistance ) )
			* smoothstep( 0.30, 0.55, reliefBelowLip )
			* ( 1.0 - smoothstep( reliefStreakLength * 0.65, reliefStreakLength, reliefBelowLip ) )
			* step( 0.45, reliefStreakHash );
		reliefDetail *= 1.0 - 0.25 * reliefStreak;
	#endif
	vec3 reliefStone = vec3( 0.35, 0.28, 0.185 ) * reliefBandPaint * reliefDetail;
	reliefStone *= 1.0 - reliefCrack * 0.32;
	float reliefLipWidth = 0.30 + ( reliefEdgeNoise - 0.5 ) * 0.16;
	float reliefFootWidth = 0.40 + ( reliefEdgeNoise - 0.5 ) * 0.16;
	float reliefWallLip = 1.0 - smoothstep( reliefLipWidth - 0.05, reliefLipWidth + 0.02,
		vReliefPaint.y - vReliefPosition.y );
	float reliefWallFoot = 1.0 - smoothstep( reliefFootWidth - 0.10, reliefFootWidth + 0.03,
		vReliefPosition.y - vReliefPaint.z );
	float reliefWallDamp = max( reliefDamp, 1.0 - smoothstep( -2.5, 0.75, vReliefPaint.z ) );
	vec3 reliefWallSoil = mix( vec3( 0.16, 0.115, 0.065 ), vec3( 0.14, 0.14, 0.075 ), reliefWallDamp );
	reliefStone = mix( reliefStone, reliefWallSoil * ( 0.93 + 0.14 * reliefEdgeNoise ), reliefWallFoot * 0.90 );
	reliefStone = mix( reliefStone, vec3( 0.62, 0.54, 0.38 ), reliefWallLip );
	diffuseColor.rgb = mix( diffuseColor.rgb, reliefStone, reliefRock );
} else {
	// The existing lip weights define a thin pale rim above the wall and soil along its foot.
	float reliefRim = smoothstep( 0.38, 0.62, reliefLip );
	diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.62, 0.54, 0.38 ), reliefRim * 0.90 );
	diffuseColor.rgb = mix( diffuseColor.rgb, reliefSoil, reliefFoot * 1.3 );
	// The interpolated foot paint gives nearby flat ground a soft contact shadow.
	diffuseColor.rgb *= 1.0 - 0.20 * smoothstep( 0.0, 0.35, reliefFoot );
}
`;

const FRAG_NORMAL = /* glsl */`
if ( vReliefScar > 0.5 ) {
	// The pit wall is still there. Flattening its shading stops the sun tracing an octagon.
	vec3 reliefViewUp = normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz );
	normal = normalize( mix( normal, reliefViewUp, 0.93 ) );
	reliefN = normalize( mix( reliefN, vec3( 0.0, 1.0, 0.0 ), 0.93 ) );
}
#ifndef RELIEF_LOW
	// Broad, tiny paint irregularities catch the low sun without moving the surface.
	vec3 reliefBump = vec3(
		0.054 * cos( vReliefPosition.x * 0.80 + vReliefPosition.z * 0.36 ),
		0.0,
		0.048 * sin( vReliefPosition.z * 0.74 - vReliefPosition.x * 0.23 )
	);
	reliefBump *= smoothstep( 0.3, 0.9, abs( reliefN.y ) ) * ( 1.0 - reliefRock );
	reliefBump -= reliefN * dot( reliefN, reliefBump );
	normal = normalize( normal + ( viewMatrix * vec4( reliefBump, 0.0 ) ).xyz );
#endif
`;

const FRAG_FILL = /* glsl */`
// A small terrain bounce keeps shaded rock and earth readable alongside the lit plateaus.
// The ramp mask reaches full strength at 45 degrees; the wall mask excludes gentle terrain.
float reliefWallFill = 0.30 * reliefRock * smoothstep( 0.35, 1.0, reliefSteep );
float reliefRampFill = 0.22 * ( 1.0 - reliefRock ) * reliefSlope * ( 1.0 - clamp( vReliefScar, 0.0, 1.0 ) );
totalEmissiveRadiance += diffuseColor.rgb * ( reliefWallFill + reliefRampFill );
`;

export function createReliefMaterial(texture, { low = false } = {}) {
  const material = new THREE.MeshLambertMaterial({ map: texture });
  // This is an open surface. Cast sun-facing tops, using the sun's existing normal and depth bias.
  material.shadowSide = THREE.FrontSide;
  material.defines = low ? { RELIEF_LOW: '' } : {};
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uReliefStep = { value: CFG.levelHeight };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${VERT_MAIN}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAG_PAINT}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${FRAG_NORMAL}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${FRAG_FILL}`);
  };
  material.customProgramCacheKey = () => `relief-painted-v9-${'RELIEF_LOW' in material.defines ? 'low' : 'high'}`;
  material.userData.setLow = (next) => {
    if (Boolean(next) === ('RELIEF_LOW' in material.defines)) return;
    if (next) material.defines.RELIEF_LOW = '';
    else delete material.defines.RELIEF_LOW;
    material.needsUpdate = true;
  };
  return material;
}
