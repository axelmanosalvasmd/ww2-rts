// Combat effects: muzzle flashes, tracers, bullet impacts, explosions sized by weapon, craters, fire and smoke on
// wrecks, smoke screens, dust from collapsing houses, the support planes, flak bursts, planes going down in flames and
// a very small screen shake.
//
// Look (a realistic modern RTS): every sprite comes from one atlas, client/textures/fx-atlas.webp, built by
// tools/build-fx-atlas.mjs from generated photos. Smoke, dust, dirt and debris are lit like the world: each of those
// cells carries a surface normal, so a puff is bright on its sun side and darker underneath, and its ambient comes
// from the sky above and the ground below. Fire, fireballs and muzzle flashes are flipbooks or photos that glow; a
// fireball cools from yellow-white through orange into dark smoke. Every sprite fades out where it meets the ground
// (a soft edge against the terrain height, so no depth texture is needed), and smoke, dust and flames drift with the
// game's wind (client/wind.js, which the server sets).
//
// Cost: every particle is one instance of a single billboard mesh (one draw call, one atlas), sorted back to front each
// frame with an allocation-free radix sort; craters share one decal mesh (a second draw call); planes come from a
// small pool. Nothing is allocated per shot apart from what is handed to audio.play. Graphics Low (gfx.low) emits
// about half the particles, caps them at 1600 instead of 4096, keeps fewer craters and skips flipbook frame blending.
//
// Sound: every effect plays its recorded sound through audio.js at the moment it shows (a gun as it flashes, a
// whistle that ends as the round lands, a fire that burns as long as the wreck does). battle-sound.js adds what
// is not tied to a shot: the listener, tank engines, digging and building.
//
// Fog of war: effects at a shooter (flash, tracer, launch, thrown grenade) only play when the shooter is in this
// snapshot's visible set. Impacts only play for shots the server already sent us, so they show what the game shows.
import * as THREE from 'three';
import { UNITS, SUPPORT, CELL } from '/shared/sim.js';
import { gfx } from './gfx.js';
import { audio } from './audio.js';
import { wind } from './wind.js';

const TAU = Math.PI * 2, rand = Math.random, rr = (a, b) => a + (b - a) * rand();
const lin = (hex, k = 1) => { const c = new THREE.Color(hex); return [c.r * k, c.g * k, c.b * k]; };
const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- the atlas: 8 x 8 cells, numbered row by row from the top left (tools/build-fx-atlas.mjs) ----------
const AT = { smoke: 0, wisp: 4, fire: 8, flame: 12, fireball: 24, glow: 39, plume: 40, kick: 44, soil: 48, brick: 50, stone: 52, wood: 54, metal: 55, muzzle: 56, tracer: 60, spark: 61, puff: 62, ember: 63 };
const texture = (file, srgb) => {
  const t = new THREE.TextureLoader().load(new URL(`./textures/${file}`, import.meta.url).href);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  else t.premultiplyAlpha = true; // the atlas: color is never read from fully clear pixels, and mipmaps stay clean
  return t;
};

// ---------- particle presets (constant objects, shared by every emit) ----------
// lit 1 = smoke, dust, dirt and debris lit by the sun and sky (c0 -> c1 is its color over life, linear); otherwise it
// glows: c0 -> c1 multiplies the picture (values above 1 are brighter than white) and add -> add1 is how much of its
// hot part adds light instead of covering what is behind. cell = first atlas cell, cells = pick one of n at random,
// flip = a flipbook of n cells (played once over the particle's life, or looped at fps). a = peak alpha, grow = end
// size / start size (curve 1 grows like a square root, else fast then slow), drag pulls velocity toward the wind
// (times wind), grav pulls down (negative rises), pull moves the sprite toward the camera by pull * size so it doesn't
// cut into the ground, len stretches it along its velocity (fixlen: always that long), anchor 1 stands the sprite on
// its point (flames, dirt plumes, dust kicks), fin = fade-in share of life, k = fade-out curve, floor = bounces.
const pre = (o) => ({ c1: null, a: 1, lit: 0, add: 0, add1: null, cell: 0, cells: 1, flip: 0, fps: 0, grow: 1, curve: 0, rv: 0, drag: 0, wind: 0, grav: 0, pull: 0, len: 0, fixlen: 0, anchor: 0, fin: 0.02, k: 1, floor: 0, norot: 0, ...o, c1: o.c1 ?? o.c0, add1: o.add1 ?? o.add ?? 0 });
const FX = {
  // light: a brief soft flash (no rays), a fireball flipbook, flames, muzzle flashes, tracers, sparks, embers
  flash: pre({ c0: [3.2, 2.7, 2.1], c1: [2.2, 1.3, 0.6], add: 1, cell: AT.glow, grow: 1.35, pull: 0.6, k: 0.8, fin: 0 }),
  fireball: pre({ c0: [1.9, 1.5, 1.15], c1: [1.1, 0.75, 0.55], add: 0.55, add1: 0.1, cell: AT.fireball, flip: 15, grow: 1.7, curve: 1, rv: 0.3, drag: 1.4, wind: 0.3, grav: -0.9, pull: 0.4, fin: 0, k: 2.4 }),
  flame: pre({ c0: [2.0, 1.55, 1.2], c1: [1.7, 1.2, 0.85], add: 0.55, cell: AT.flame, flip: 12, fps: 15, grow: 1.12, grav: -0.25, drag: 1, wind: 0.25, pull: 0.3, anchor: 1, norot: 1, fin: 0.2, k: 2 }),
  burn: pre({ c0: [2.3, 1.7, 1.2], c1: [1.3, 0.65, 0.35], add: 0.6, cell: AT.fireball + 1, cells: 4, grow: 0.7, rv: 1.5, k: 1.3, fin: 0 }),
  muzzle: pre({ c0: [2.4, 1.95, 1.45], add: 0.85, cell: AT.muzzle, cells: 4, fixlen: 1, k: 1.4, fin: 0 }),
  tracer: pre({ c0: [2.7, 1.35, 0.5], add: 1, cell: AT.tracer, len: 3.2, k: 20, fin: 0 }),
  tracerHot: pre({ c0: [3.0, 2.3, 1.3], add: 1, cell: AT.tracer, len: 4.5, k: 20, fin: 0 }),
  tracerFaint: pre({ c0: [1.7, 1.4, 0.9], a: 0.45, add: 1, cell: AT.tracer, len: 2.2, k: 20, fin: 0 }),
  rocket: pre({ c0: [3.2, 2.2, 1.2], c1: [3, 1.8, 0.8], add: 1, cell: AT.tracer, len: 1.8, k: 20, fin: 0 }),
  spark: pre({ c0: [3, 2.2, 1.1], c1: [1.8, 0.45, 0.08], add: 1, cell: AT.spark, grav: 14, drag: 0.8, len: 0.45, k: 1, fin: 0 }),
  ember: pre({ c0: [2.4, 1.1, 0.3], c1: [0.9, 0.15, 0.02], add: 1, cell: AT.ember, grav: -1.4, drag: 0.6, wind: 1, k: 1.2, fin: 0 }),
  // lit: smoke (dark brown-grey from a blast, black from burning fuel, grey from guns, white from smoke shells)
  smoke: pre({ lit: 1, c0: lin(0x5f574d), c1: lin(0x8a857d), a: 0.72, cell: AT.smoke, cells: 4, grow: 2.8, curve: 1, rv: 0.22, drag: 0.8, wind: 1, grav: -0.8, pull: 0.45, fin: 0.12, k: 1.7 }),
  wreckSmoke: pre({ lit: 1, c0: lin(0x2a2622), c1: lin(0x5c5750), a: 0.78, cell: AT.smoke, cells: 4, grow: 4.2, curve: 1, rv: 0.12, drag: 0.5, wind: 1.5, grav: -0.9, pull: 0.45, fin: 0.1, k: 1.4 }),
  gunsmoke: pre({ lit: 1, c0: lin(0xa8a49c), c1: lin(0xbab6ae), a: 0.42, cell: AT.wisp, cells: 4, grow: 3, curve: 1, rv: 0.3, drag: 2.2, wind: 1, grav: -0.35, pull: 0.3, fin: 0.05, k: 1.4 }),
  screen: pre({ lit: 1, cover: 1, c0: lin(0xcfcdc5), c1: lin(0xdad8d2), a: 0.9, cell: AT.smoke, cells: 4, grow: 1.3, curve: 1, rv: 0.07, drag: 0.4, wind: 1, grav: -0.04, pull: 0.55, fin: 0.22, k: 2.2 }),
  fireSmoke: pre({ lit: 1, cover: 1, c0: lin(0x2e2a26), c1: lin(0x6a655e), a: 0.86, cell: AT.smoke, cells: 4, grow: 1.9, curve: 1, rv: 0.1, drag: 0.5, wind: 1.2, grav: -0.35, pull: 0.5, fin: 0.15, k: 1.8 }),
  trail: pre({ lit: 1, c0: lin(0xb4b0a8), c1: lin(0xc4c0b8), a: 0.5, cell: AT.wisp, cells: 4, grow: 3.5, curve: 1, rv: 0.4, drag: 1.5, wind: 1, grav: -0.3, pull: 0.2, fin: 0.05, k: 1.3 }),
  flak: pre({ lit: 1, c0: lin(0x1c1a18), c1: lin(0x3a3632), a: 0.92, cell: AT.smoke, cells: 4, grow: 2.2, curve: 1, rv: 0.2, drag: 1.2, wind: 1, grav: -0.05, fin: 0.03, k: 1.6 }),
  airSmoke: pre({ lit: 1, c0: lin(0x8d887d), c1: lin(0xa29e96), a: 0.7, cell: AT.smoke, cells: 4, grow: 2.6, curve: 1, rv: 0.3, drag: 0.8, wind: 1, grav: -0.3, fin: 0.05, k: 1.5 }),
  airSmokeDark: pre({ lit: 1, c0: lin(0x24211e), c1: lin(0x48443e), a: 0.88, cell: AT.smoke, cells: 4, grow: 2.8, curve: 1, rv: 0.3, drag: 0.8, wind: 1, grav: -0.3, fin: 0.05, k: 1.5 }),
  // lit: dust and dirt
  dust: pre({ lit: 1, c0: lin(0x7e705c), c1: lin(0x8e8270), a: 0.5, cell: AT.smoke, cells: 4, grow: 1.9, curve: 1, rv: 0.2, drag: 1.6, wind: 0.6, grav: -0.12, pull: 0.35, fin: 0.06, k: 1.5 }),
  // the plume a vehicle raises on dry ground: thin, low and quick to spread
  roadDust: pre({ lit: 1, c0: lin(0x9c8c70), c1: lin(0xac9f88), a: 0.3, cell: AT.smoke, cells: 4, grow: 3.2, curve: 1, rv: 0.25, drag: 2.2, wind: 1, grav: -0.3, pull: 0.3, fin: 0.12, k: 1.5 }),
  collapse: pre({ lit: 1, c0: lin(0x9a8e7a), c1: lin(0xb0a692), a: 0.78, cell: AT.smoke, cells: 4, grow: 2.3, curve: 1, rv: 0.15, drag: 0.9, wind: 0.6, grav: -0.15, pull: 0.5, fin: 0.1, k: 1.7 }),
  plume: pre({ lit: 1, c0: lin(0x5c4b38), c1: lin(0x8a7a64), a: 0.95, cell: AT.plume, cells: 4, grow: 1.45, grav: 1.2, pull: 0.3, anchor: 1, norot: 1, fin: 0.02, k: 1.8 }),
  kick: pre({ lit: 1, c0: lin(0x8a7860), c1: lin(0x9c8c74), a: 0.85, cell: AT.kick, cells: 4, grow: 1.35, grav: 0.4, pull: 0.25, anchor: 1, norot: 1, fin: 0.03, k: 1.6 }),
  // lit: debris with gravity that bounces on the ground
  clod: pre({ lit: 1, c0: lin(0x4a3b2c), cell: AT.soil, cells: 2, rv: 9, grav: 22, floor: 1, k: 8, fin: 0 }),
  masonry: pre({ lit: 1, c0: lin(0xa89888), cell: AT.brick, cells: 4, rv: 8, grav: 22, floor: 1, k: 8, fin: 0 }),
  wood: pre({ lit: 1, c0: lin(0x8a6a4a), cell: AT.wood, rv: 9, grav: 22, floor: 1, k: 8, fin: 0 }),
  metal: pre({ lit: 1, c0: lin(0x34302c), cell: AT.metal, rv: 11, grav: 22, floor: 1, k: 8, fin: 0 }),
  bomb: pre({ lit: 1, c0: lin(0x2a2a24), cell: AT.metal, len: 1.1, k: 20, fin: 0 }),
  nade: pre({ lit: 1, c0: lin(0x34342a), cell: AT.metal, rv: 10, k: 20, fin: 0 }),
};

// direct-fire weapons by shooter type: sound, tracers per shot (tr null = no tracer), burst, speed, width, flash
// length, heavy = explosive shell of that blast size at the far end (37 mm about 1.5, 75 mm 2.6, 88 mm 3.4)
const SMALL = { snd: 'rifle', n: 3, burst: 1, gap: 0, spd: 230, w: 0.05, tr: FX.tracerFaint, trOdds: 0.45, flash: 0.32, heavy: 0, smoke: 0 };
const GUNS = {
  rifle: SMALL, conscript: SMALL,
  engineer: { ...SMALL, n: 2 },
  ranger: { ...SMALL, snd: 'smg', burst: 2, gap: 0.07, flash: 0.28 },
  mg: { ...SMALL, snd: 'mg', n: 1, burst: 4, gap: 0.065, spd: 210, w: 0.085, tr: FX.tracer, trOdds: 1, flash: 0.45 },
  bunker: { ...SMALL, snd: 'mg', n: 1, burst: 4, gap: 0.08, spd: 210, w: 0.085, tr: FX.tracer, trOdds: 1, flash: 0.5 },
  sniper: { ...SMALL, snd: 'sniper', n: 1, spd: 420, w: 0.035, trOdds: 0.6, flash: 0.4 },
  at: { ...SMALL, snd: 'atgun', n: 1, spd: 150, w: 0.16, tr: FX.tracerHot, trOdds: 1, flash: 1.3, heavy: 2.4, smoke: 1, blast: 1 },
  tank: { ...SMALL, snd: 'tankgun', n: 1, spd: 150, w: 0.16, tr: FX.tracerHot, trOdds: 1, flash: 1.4, heavy: 2.6, smoke: 1, blast: 1 },
  medium: { ...SMALL, snd: 'tankgun', n: 1, spd: 150, w: 0.18, tr: FX.tracerHot, trOdds: 1, flash: 1.7, heavy: 3, smoke: 1, blast: 1.2 },
  tiger: { ...SMALL, snd: 'tankgun', n: 1, spd: 160, w: 0.2, tr: FX.tracerHot, trOdds: 1, flash: 2.1, heavy: 3.4, smoke: 1, blast: 1.4 },
  armoredcar: { ...SMALL, snd: 'tankgun', n: 1, burst: 2, gap: 0.12, spd: 170, w: 0.12, tr: FX.tracerHot, trOdds: 1, flash: 0.8, heavy: 1.5, smoke: 0.5 },
  // anti-air guns turned on the ground; planes (guns = wing guns firing together)
  flak: { ...SMALL, snd: 'flak', n: 1, burst: 2, gap: 0.1, spd: 240, w: 0.11, tr: FX.tracerHot, trOdds: 1, flash: 0.6 },
  flaktrack: { ...SMALL, snd: 'flak', n: 1, burst: 4, gap: 0.06, spd: 240, w: 0.11, tr: FX.tracerHot, trOdds: 1, flash: 0.6 },
  fighter: { ...SMALL, snd: 'mg', n: 2, guns: 2, burst: 4, gap: 0.05, spd: 280, w: 0.085, tr: FX.tracer, trOdds: 1, flash: 0.45 },
  attacker: { ...SMALL, snd: 'rockets', n: 1, spd: 110, w: 0.2, tr: FX.rocket, trOdds: 1, flash: 0.8, heavy: 2.6 },
};
const BAZOOKA = { ...SMALL, snd: 'atgun', n: 1, spd: 70, w: 0.18, tr: FX.rocket, trOdds: 1, flash: 0.7, heavy: 2.2, smoke: 1, back: 1 };
const STYLES = [...new Set([...Object.values(GUNS), BAZOOKA])]; // index <-> style, for delayed events

// where each soldier's weapon ends, in the soldier's local space (+x forward)
const HAND = { rifle: [0.72, 1.1, 0.2], conscript: [0.72, 1.1, 0.2], engineer: [0.6, 1.0, 0.2], ranger: [0.62, 0.9, 0.2], sniper: [1.13, 1.08, 0.2] };
const BAZ = [0.63, 0.93, 0.25];

const VERT = /* glsl */`
  attribute vec4 iPos; attribute vec4 iCol; attribute vec4 iMisc; attribute vec4 iDir; attribute vec4 iExt;
  uniform vec3 upView;
  varying vec2 vUv0; varying vec2 vUv1; varying vec4 vCol;
  varying vec4 vInfo;  // frame blend, -1 lit or the additive share, height above the ground, soft-edge distance
  varying vec4 vShape; // the sprite's turn (cos, sin) and the position on the quad
  #include <fog_pars_vertex>
  vec2 cellUv(float f, vec2 q) { return (vec2(mod(f, 8.0), 7.0 - floor(f / 8.0)) + q) / 8.0; }
  void main() {
    vec2 c = position.xy;
    float size = iPos.w;
    vec4 center = modelViewMatrix * vec4(iPos.xyz, 1.0);
    vec4 mvPosition = center;
    vec2 rot;
    if (iDir.w > 0.0) {
      // stretched along its motion: tail to head in view space, width across
      vec3 tail = (modelViewMatrix * vec4(iPos.xyz - iDir.xyz * iDir.w, 1.0)).xyz;
      vec2 ax = mvPosition.xy - tail.xy; float l = length(ax);
      ax = l > 1e-4 ? ax / l : vec2(1.0, 0.0);
      mvPosition.xyz = mix(tail, mvPosition.xyz, c.x * 0.5 + 0.5);
      mvPosition.xy += ax * c.x * size + vec2(-ax.y, ax.x) * c.y * size;
      rot = ax;
    } else {
      rot = vec2(cos(iMisc.x), sin(iMisc.x));
      vec2 cc = vec2(c.x, c.y + iExt.z); // anchored sprites stand on their point
      mvPosition.xy += vec2(cc.x * rot.x - cc.y * rot.y, cc.x * rot.y + cc.y * rot.x) * size;
      mvPosition.xyz += normalize(-center.xyz) * iExt.y;
    }
    gl_Position = projectionMatrix * mvPosition;
    vec2 q = c * 0.49 + 0.5;
    vUv0 = cellUv(iMisc.y, q); vUv1 = cellUv(iMisc.z, q);
    vCol = iCol;
    float above = iPos.y + dot(mvPosition.xyz - center.xyz, upView) - iExt.x;
    vInfo = vec4(iMisc.w, iExt.w, above, max(0.12, size * (iExt.z > 0.0 ? 0.22 : 0.5)));
    vShape = vec4(rot, c);
    #include <fog_vertex>
  }`;
const FRAG = /* glsl */`
  uniform sampler2D map;
  uniform vec3 sunView; uniform vec3 sunCol; uniform vec3 skyCol; uniform vec3 groundCol; uniform vec3 upView;
  varying vec2 vUv0; varying vec2 vUv1; varying vec4 vCol; varying vec4 vInfo; varying vec4 vShape;
  #include <fog_pars_fragment>
  void main() {
    vec4 t = texture2D(map, vUv0);
    if (vInfo.x > 0.0) t = mix(t, texture2D(map, vUv1), vInfo.x);
    // soft edge where the sprite meets the ground
    float a = t.a * vCol.a * clamp(vInfo.z / vInfo.w, 0.0, 1.0);
    if (a < 0.004) discard;
    float ta = max(t.a, 0.004), add;
    vec3 rgb;
    if (vInfo.y < 0.0) {
      // lit: the cell's normal (R, B) turned with the sprite, rounded like a ball, lit by the sun with a soft
      // terminator (smoke scatters light), sky from above and ground bounce from below; darker low down
      vec2 r = vShape.xy, ns = t.rb / ta * 2.0 - 1.0;
      vec2 nv = vec2(ns.x * r.x - ns.y * r.y, ns.x * r.y + ns.y * r.x);
      vec2 sp = vec2(vShape.z * r.x - vShape.w * r.y, vShape.z * r.y + vShape.w * r.x);
      vec3 n = normalize(vec3(nv + sp * 0.6, 0.75));
      float diff = clamp(dot(n, sunView) * 0.55 + 0.45, 0.0, 1.0);
      vec3 amb = mix(groundCol, skyCol, clamp(dot(n, upView) * 0.5 + 0.5, 0.0, 1.0));
      float low = clamp(vInfo.z / (vInfo.w * 6.0), 0.0, 1.0);
      // thin edges glow when the sun is behind the smoke (light scattered toward the eye)
      float back = clamp(-sunView.z, 0.0, 1.0), thin = 1.0 - clamp(t.a * 1.3, 0.0, 1.0);
      rgb = vCol.rgb * ((t.g / ta * 2.0) * (amb + sunCol * diff) * (0.72 + 0.28 * low) + sunCol * back * back * thin * 1.5);
      add = 0.0;
    } else {
      // glowing: the hot part of the picture shines (tinted), its cooled part (soot, smoke) is lit like smoke
      vec3 c = t.rgb / ta; c *= c;
      float hot = smoothstep(0.06, 0.45, max(c.r, max(c.g, c.b)));
      vec3 cold = c * 2.2 * (mix(groundCol, skyCol, 0.8) + sunCol * 0.6);
      rgb = mix(cold, c * vCol.rgb, hot);
      add = hot * vInfo.y;
    }
    gl_FragColor = vec4(rgb, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #ifdef USE_FOG
      #ifdef FOG_EXP2
        float fogFactor = 1.0 - exp(- fogDensity * fogDensity * vFogDepth * vFogDepth);
      #else
        float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
      #endif
      gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor * (1.0 - add));
      a *= 1.0 - fogFactor * add;
    #endif
    // premultiplied: the additive part writes no alpha, so light and smoke share one blend mode
    gl_FragColor = vec4(gl_FragColor.rgb * a, a * (1.0 - add));
  }`;

export function createEffects({ scene, camera, cam, hAt, units, colorOf = () => 0xdddddd, airAlt = 20, mapW = () => 0 }) {
  let clock = 0, tick = 0;
  const v3 = new THREE.Vector3();
  const play = (() => {
    const last = new Map();
    // opts go to audio.play: gain, rate, delay, offset (seconds into the file), dur (loops)
    return (name, x, z, gap = 0, opts) => {
      if (gap) { if (clock - (last.get(name) ?? -1e9) < gap) return; last.set(name, clock); }
      try { audio.play(name, { x, z }, opts); } catch { /* sound must never break the frame */ }
    };
  })();

  // ---------- particles ----------
  const CAP = 4096, F = 40, S = new Float32Array(CAP * F);
  let n = 0, shown = 0;
  const cap = () => (gfx.low ? 1600 : CAP);
  const iPos = new Float32Array(CAP * 4), iCol = new Float32Array(CAP * 4), iMisc = new Float32Array(CAP * 4), iDir = new Float32Array(CAP * 4), iExt = new Float32Array(CAP * 4);
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  const attrs = [['iPos', iPos], ['iCol', iCol], ['iMisc', iMisc], ['iDir', iDir], ['iExt', iExt]].map(([name, arr]) => {
    const a = new THREE.InstancedBufferAttribute(arr, 4); a.setUsage(THREE.DynamicDrawUsage); geo.setAttribute(name, a); return a;
  });
  geo.instanceCount = 0;
  const U = {
    map: { value: texture('fx-atlas.webp') }, upView: { value: new THREE.Vector3(0, 1, 0) }, sunView: { value: new THREE.Vector3(0, 1, 0) },
    sunCol: { value: new THREE.Vector3(1, 0.85, 0.66) }, skyCol: { value: new THREE.Vector3(0.17, 0.19, 0.22) }, groundCol: { value: new THREE.Vector3(0.05, 0.04, 0.02) },
  };
  const pmat = new THREE.ShaderMaterial({
    uniforms: { ...THREE.UniformsUtils.merge([THREE.UniformsLib.fog]), ...U }, vertexShader: VERT, fragmentShader: FRAG,
    fog: true, transparent: true, depthWrite: false,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  const pmesh = new THREE.Mesh(geo, pmat);
  pmesh.frustumCulled = false; pmesh.renderOrder = 1.5; pmesh.raycast = () => {}; // after the fog overlay, before unit rings
  scene.add(pmesh);

  // the sun and sky light the smoke like the rest of the world (client/light.js owns them; this only reads them)
  let sun = null, hemi = null;
  function light() {
    if ((!sun?.parent || !hemi?.parent) && tick % 120 === 0) { sun = hemi = null; scene.traverse(o => { if (o.isDirectionalLight) sun ??= o; if (o.isHemisphereLight) hemi ??= o; }); }
    camera.updateMatrixWorld();
    const vm = camera.matrixWorldInverse, k = 1 / Math.PI; // Lambert: what a white surface facing the light gets
    U.upView.value.set(0, 1, 0).transformDirection(vm);
    if (sun) {
      U.sunView.value.copy(sun.position).sub(sun.target.position).normalize().transformDirection(vm);
      U.sunCol.value.set(sun.color.r, sun.color.g, sun.color.b).multiplyScalar(sun.intensity * k);
    }
    if (hemi) {
      U.skyCol.value.set(hemi.color.r, hemi.color.g, hemi.color.b).multiplyScalar(hemi.intensity * k);
      U.groundCol.value.set(hemi.groundColor.r, hemi.groundColor.g, hemi.groundColor.b).multiplyScalar(hemi.intensity * k);
    }
  }

  // field offsets: 0-2 pos, 3-5 vel, 6 age (negative: not shown yet), 7 life, 8 size0, 9 size1, 10-12 color0,
  // 13-15 color1, 16 alpha, 17 add0, 18 add1, 19 rot, 20 spin, 21 drag, 22 grav, 23 pull, 24 len, 25 fade-in,
  // 26 fade curve, 27 floor, 28 wind, 29 group, 30 lit, 31 cell, 32 flipbook frames, 33 fps, 34 phase,
  // 35 ground height, 36 anchor, 37 growth curve, 38 fixed length, 39 spare
  function emit(p, x, y, z, vx, vy, vz, size, life) {
    if (n >= cap()) return -1;
    const o = n++ * F;
    S[o] = x; S[o + 1] = y; S[o + 2] = z; S[o + 3] = vx; S[o + 4] = vy; S[o + 5] = vz; S[o + 6] = 0; S[o + 7] = life;
    if (gfx.low && p.lit && !p.cover) size *= 0.85; // Low: smaller smoke and dust (less to fill); screens keep their cover
    S[o + 8] = size; S[o + 9] = size * p.grow;
    S[o + 10] = p.c0[0]; S[o + 11] = p.c0[1]; S[o + 12] = p.c0[2]; S[o + 13] = p.c1[0]; S[o + 14] = p.c1[1]; S[o + 15] = p.c1[2];
    S[o + 16] = p.a; S[o + 17] = p.add; S[o + 18] = p.add1;
    S[o + 19] = p.norot ? 0 : rand() * TAU; S[o + 20] = p.rv ? (rand() - 0.5) * 2 * p.rv : 0;
    S[o + 21] = p.drag; S[o + 22] = p.grav; S[o + 23] = p.pull; S[o + 24] = p.len; S[o + 25] = p.fin; S[o + 26] = p.k; S[o + 27] = p.floor; S[o + 28] = p.wind; S[o + 29] = 0;
    S[o + 30] = p.lit; S[o + 31] = p.flip || p.cells < 2 ? p.cell : p.cell + Math.floor(rand() * p.cells);
    S[o + 32] = p.flip; S[o + 33] = p.fps; S[o + 34] = p.fps ? rand() * p.flip : 0;
    S[o + 35] = hAt(x, z); S[o + 36] = p.anchor; S[o + 37] = p.curve; S[o + 38] = p.fixlen;
    return o;
  }
  // adjust a just-emitted particle: tint (lighter or darker), hold it back a while, set its streak length
  const tint = (o, k) => { if (o >= 0) for (let j = 10; j < 16; j++) S[o + j] *= k; };
  const hold = (o, d) => { if (o >= 0) S[o + 6] = -d; };
  const stretch = (o, len) => { if (o >= 0) S[o + 24] = len; };

  // back to front: depth (16 bits, 1/64 m) and index (12 bits) in one key, radix sorted without allocating
  const keys = new Uint32Array(CAP), keyTmp = new Uint32Array(CAP), bins = new Uint32Array(256);
  function sortKeys(m) {
    let a = keys, b = keyTmp;
    for (let shift = 0; shift < 32; shift += 8) {
      bins.fill(0);
      for (let i = 0; i < m; i++) bins[(a[i] >>> shift) & 255]++;
      for (let j = 0, sum = 0; j < 256; j++) { const c = bins[j]; bins[j] = sum; sum += c; }
      for (let i = 0; i < m; i++) { const v = a[i]; b[bins[(v >>> shift) & 255]++] = v; }
      const t = a; a = b; b = t;
    }
  }
  function simulate(dt) {
    const cm = camera.matrixWorld.elements, cx = cm[12], cy = cm[13], cz = cm[14], fx = -cm[8], fy = -cm[9], fz = -cm[10];
    const lo = low();
    tick++;
    let m = 0, i = 0;
    while (i < n) {
      const o = i * F, age = S[o + 6] + dt;
      if (age >= S[o + 7]) { n--; if (i < n) S.copyWithin(o, n * F, n * F + F); continue; }
      S[o + 6] = age;
      if (age < 0) { i++; continue; } // held back: not out yet
      const drag = S[o + 21];
      if (drag > 0) {
        const kk = Math.min(1, drag * dt), wf = S[o + 28];
        S[o + 3] += (wind.x * wf - S[o + 3]) * kk; S[o + 5] += (wind.z * wf - S[o + 5]) * kk; S[o + 4] -= S[o + 4] * kk; // smoke drifts with the game's wind
      }
      const g = S[o + 22];
      S[o] += S[o + 3] * dt; S[o + 1] += (S[o + 4] - 0.5 * g * dt) * dt; S[o + 2] += S[o + 5] * dt; S[o + 4] -= g * dt;
      if (S[o + 27] > 0) {
        const gy = hAt(S[o], S[o + 2]) + 0.06;
        if (S[o + 1] < gy) { S[o + 1] = gy; S[o + 4] = S[o + 4] < -3 ? -S[o + 4] * 0.3 : 0; S[o + 3] *= 0.5; S[o + 5] *= 0.5; S[o + 20] *= 0.5; }
      }
      if (((i + tick) & 7) === 0) S[o + 35] = hAt(S[o], S[o + 2]); // drifting smoke keeps its soft edge on the ground below
      S[o + 19] += S[o + 20] * dt;
      // glowing sprites sort a little nearer, so flames show through the foot of their own smoke
      const d = (S[o] - cx) * fx + (S[o + 1] - cy) * fy + (S[o + 2] - cz) * fz - (S[o + 30] ? 0 : 1.5);
      keys[m++] = (65535 - Math.max(0, Math.min(65535, Math.round(d * 64)))) * 4096 + i;
      i++;
    }
    if (m > 1) sortKeys(m);
    for (let j = 0; j < m; j++) {
      const o = (keys[j] & 4095) * F, q = j * 4, t = S[o + 6] / S[o + 7];
      const e = S[o + 37] ? Math.sqrt(t) : 1 - (1 - t) * (1 - t), fin = S[o + 25];
      iPos[q] = S[o]; iPos[q + 1] = S[o + 1]; iPos[q + 2] = S[o + 2]; iPos[q + 3] = S[o + 8] + (S[o + 9] - S[o + 8]) * e;
      iCol[q] = S[o + 10] + (S[o + 13] - S[o + 10]) * t; iCol[q + 1] = S[o + 11] + (S[o + 14] - S[o + 11]) * t; iCol[q + 2] = S[o + 12] + (S[o + 15] - S[o + 12]) * t;
      iCol[q + 3] = S[o + 16] * (fin > 0 ? Math.min(1, t / fin) : 1) * (1 - Math.pow(t, S[o + 26]));
      // flipbook: played once over its life, or looped at its own pace from a random frame
      const frames = S[o + 32], cell = S[o + 31];
      if (frames > 0) {
        const f = S[o + 33] > 0 ? S[o + 34] + S[o + 6] * S[o + 33] : t * (frames - 1), fl = Math.floor(f), loop = S[o + 33] > 0;
        iMisc[q + 1] = cell + (loop ? fl % frames : Math.min(frames - 1, fl));
        iMisc[q + 2] = cell + (loop ? (fl + 1) % frames : Math.min(frames - 1, fl + 1));
        iMisc[q + 3] = lo ? 0 : f - fl;
      } else { iMisc[q + 1] = iMisc[q + 2] = cell; iMisc[q + 3] = 0; }
      iMisc[q] = S[o + 19];
      const len = S[o + 24];
      if (len > 0) {
        const vx = S[o + 3], vy = S[o + 4], vz = S[o + 5], sp = Math.hypot(vx, vy, vz) || 1;
        iDir[q] = vx / sp; iDir[q + 1] = vy / sp; iDir[q + 2] = vz / sp; iDir[q + 3] = S[o + 38] ? len : Math.min(len, S[o + 6] * sp + 0.01);
      } else iDir[q + 3] = 0;
      iExt[q] = S[o + 35]; iExt[q + 1] = S[o + 23] * iPos[q + 3]; iExt[q + 2] = S[o + 36];
      iExt[q + 3] = S[o + 30] ? -1 : S[o + 17] + (S[o + 18] - S[o + 17]) * t;
    }
    shown = m;
    geo.instanceCount = m; pmesh.visible = m > 0;
    if (m) for (const a of attrs) { a.clearUpdateRanges(); a.addUpdateRange(0, m * 4); a.needsUpdate = true; }
  }

  // ---------- craters: one mesh of small terrain-hugging grids, multiplied into the ground ----------
  const DG = 5, DV = DG * DG, DCAP = 64;
  const dPos = new Float32Array(DCAP * DV * 3), dUv = new Float32Array(DCAP * DV * 2), dFade = new Float32Array(DCAP * DV), dKind = new Float32Array(DCAP * DV), dIdx = [];
  for (let s = 0; s < DCAP; s++) for (let j = 0; j < DG - 1; j++) for (let i = 0; i < DG - 1; i++) {
    const b = s * DV + j * DG + i; dIdx.push(b, b + DG, b + 1, b + 1, b + DG, b + DG + 1);
  }
  for (let s = 0; s < DCAP; s++) for (let j = 0; j < DG; j++) for (let i = 0; i < DG; i++) { const v = s * DV + j * DG + i; dUv[v * 2] = i / (DG - 1); dUv[v * 2 + 1] = j / (DG - 1); }
  const dgeo = new THREE.BufferGeometry();
  const dPosA = new THREE.BufferAttribute(dPos, 3), dFadeA = new THREE.BufferAttribute(dFade, 1), dKindA = new THREE.BufferAttribute(dKind, 1);
  dPosA.setUsage(THREE.DynamicDrawUsage); dFadeA.setUsage(THREE.DynamicDrawUsage); dKindA.setUsage(THREE.DynamicDrawUsage);
  dgeo.setAttribute('position', dPosA); dgeo.setAttribute('uv', new THREE.BufferAttribute(dUv, 2)); dgeo.setAttribute('aFade', dFadeA); dgeo.setAttribute('aKind', dKindA); dgeo.setIndex(dIdx);
  // ref: the crater picture's color that leaves the ground as it is; its rim soil (about 0.18, 0.09, 0.05 linear)
  // makes the ground a little browner, the burnt center nearly black. A burn mark (kind 1) only darkens, in the
  // crater's ragged outline.
  const dmat = new THREE.ShaderMaterial({
    uniforms: { ...THREE.UniformsUtils.merge([THREE.UniformsLib.fog]), map: { value: texture('fx-crater.webp', true) }, ref: { value: new THREE.Vector3(0.146, 0.107, 0.06) } },
    vertexShader: /* glsl */`
      attribute float aFade; attribute float aKind; varying vec2 vUv; varying float vFade; varying float vKind;
      #include <fog_pars_vertex>
      void main() { vUv = uv; vFade = aFade; vKind = aKind; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D map; uniform vec3 ref; varying vec2 vUv; varying float vFade; varying float vKind;
      #include <fog_pars_fragment>
      void main() {
        vec4 t = texture2D(map, vUv);
        vec3 m = vKind > 0.5 ? vec3(0.36, 0.33, 0.3) : clamp(pow(t.rgb / ref, vec3(0.85)), 0.0, 2.0);
        vec3 c = mix(vec3(1.0), m, t.a * vFade);
        #ifdef USE_FOG
          #ifndef FOG_EXP2
            c = mix(c, vec3(1.0), smoothstep(fogNear, fogFar, vFogDepth));
          #endif
        #endif
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
        gl_FragColor.rgb *= 0.5; // blended as 2 x this x the ground: lighter or darker than the ground
      }`,
    fog: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.DstColorFactor, blendDst: THREE.SrcColorFactor,
  });
  const dmesh = new THREE.Mesh(dgeo, dmat);
  dmesh.frustumCulled = false; dmesh.renderOrder = 0.5; dmesh.raycast = () => {}; // under the fog overlay (1)
  scene.add(dmesh);
  const decals = Array.from({ length: DCAP }, () => ({ on: false, x: 0, z: 0, r: 0, rot: 0, age: 0, life: 0 }));
  let decalOn = 0, refitT = 0;
  function fitDecal(s) {
    const d = decals[s], c = Math.cos(d.rot), sn = Math.sin(d.rot);
    for (let j = 0; j < DG; j++) for (let i = 0; i < DG; i++) {
      const u = (i / (DG - 1) - 0.5) * 2 * d.r, w = (j / (DG - 1) - 0.5) * 2 * d.r, x = d.x + u * c - w * sn, z = d.z + u * sn + w * c, v = (s * DV + j * DG + i) * 3;
      dPos[v] = x; dPos[v + 1] = hAt(x, z) + 0.05; dPos[v + 2] = z;
    }
  }
  function scorch(x, z, r, kind = 0) {
    const lim = gfx.low ? 24 : DCAP;
    let s = -1, oldest = -1;
    for (let k = 0; k < lim; k++) { if (!decals[k].on) { s = k; break; } if (oldest < 0 || decals[k].age > decals[oldest].age) oldest = k; }
    if (s < 0) s = oldest;
    Object.assign(decals[s], { on: true, x, z, r, rot: rand() * TAU, age: 0, life: gfx.low ? 60 : 150 });
    fitDecal(s); dPosA.needsUpdate = true;
    dKind.fill(kind, s * DV, s * DV + DV); dKindA.needsUpdate = true;
  }
  function updateDecals(dt) {
    let any = false;
    if ((refitT -= dt) <= 0) { refitT = 2; for (let s = 0; s < DCAP; s++) if (decals[s].on) fitDecal(s); dPosA.needsUpdate = true; } // the ground can be dug or bombed
    for (let s = 0; s < DCAP; s++) {
      const d = decals[s];
      if (!d.on) continue;
      d.age += dt;
      if (d.age >= d.life || (gfx.low && s >= 24)) { d.on = false; dFade.fill(0, s * DV, s * DV + DV); any = true; continue; }
      const f = Math.min(1, d.age / 0.3) * Math.min(1, (d.life - d.age) / (d.life * 0.3));
      dFade.fill(f, s * DV, s * DV + DV); any = true;
    }
    if (any || decalOn) dFadeA.needsUpdate = true;
    decalOn = any;
  }

  // ---------- delayed events (typed, pooled) ----------
  const EVN = 768, evT = new Float32Array(EVN), evK = new Uint8Array(EVN), evA = new Float32Array(EVN * 8), ARG = new Float32Array(8);
  let evn = 0;
  function later(delay, kind, a = 0, b = 0, c = 0, d = 0, e = 0, f = 0, g = 0, h = 0) {
    if (evn >= EVN) return;
    const i = evn++, o = i * 8;
    evT[i] = delay; evK[i] = kind; evA[o] = a; evA[o + 1] = b; evA[o + 2] = c; evA[o + 3] = d; evA[o + 4] = e; evA[o + 5] = f; evA[o + 6] = g; evA[o + 7] = h;
  }
  const NAMES = ['rifle', 'smg', 'mg', 'sniper', 'atgun', 'tankgun', 'mortar', 'whistle', 'blast_small', 'blast_large', 'bomb', 'rockets', 'plane_flyby', 'strafe', 'bomber', 'flak', 'collapse', 'smoke', 'dig', 'build', 'vehicle_destroyed', 'ricochet'];
  const E_TRACER = 1, E_IMPACT = 2, E_SOUND = 3, E_ROCKET = 5, E_BOMB = 6, E_SKY = 7, E_FLAK = 8; // 0 = cancelled
  function runEvents(dt) {
    for (let i = 0; i < evn;) {
      if ((evT[i] -= dt) > 0) { i++; continue; }
      const kind = evK[i];
      for (let j = 0; j < 8; j++) ARG[j] = evA[i * 8 + j];
      evn--; if (i < evn) { evT[i] = evT[evn]; evK[i] = evK[evn]; evA.copyWithin(i * 8, evn * 8, evn * 8 + 8); }
      const A = ARG;
      if (kind === E_TRACER) shotTracer(A[0], A[1], A[2], A[3], A[4], A[5], STYLES[A[6]], A[7]);
      else if (kind === E_IMPACT) impact(A[0], A[1], A[2], STYLES[A[3]], A[4]);
      else if (kind === E_SOUND) play(NAMES[A[0]], A[1], A[2], 0, A[3] || A[4] ? { offset: A[3], gain: A[4] || 1 } : undefined);
      else if (kind === E_ROCKET) launchRocket(A[0], A[1], A[2], A[3], A[4], A[5], A[6], A[7]);
      else if (kind === E_BOMB) { const o = emit(FX.bomb, A[0], A[1], A[2], A[3], 0, A[4], 0.32, A[6]); if (o >= 0) S[o + 22] = A[5]; }
      else if (kind === E_SKY) skyShot(A[0], A[1], A[2], A[3], A[4], A[5], STYLES[A[6]]);
      else if (kind === E_FLAK) burst(A[0], A[1], A[2], A[3]);
    }
  }
  const snd = (name, delay, x, z, offset = 0, gain = 0) => later(delay, E_SOUND, NAMES.indexOf(name), x, z, offset, gain);
  // a falling round's whistle (1.8 s) starts early or part way in, so that it ends as the round lands
  const whistle = (delay, flight, x, z, gain = 0) => { const len = audio.length('whistle') || 1.76; snd('whistle', delay + Math.max(0, flight - len), x, z, Math.max(0, len - flight), gain); };

  // ---------- building blocks ----------
  const low = () => gfx.low;
  let shake = 0;
  function kick(x, z, size) {
    if (low() || reduceMotion || size < 3.2) return;
    const a = size * 0.035 * Math.max(0, 1 - Math.hypot(x - cam.x, z - cam.z) / 70) * (cam.dist / 60);
    if (a > shake) shake = a;
  }

  // smoke columns: after a big blast the smoke keeps rising from the crater for a couple of seconds
  const columns = Array.from({ length: 24 }, () => ({ on: false, x: 0, y: 0, z: 0, s: 0, t: 0, dur: 0, acc: 0 }));
  function column(x, y, z, s, dur) {
    const c = columns.find(q => !q.on) ?? columns[0];
    Object.assign(c, { on: true, x, y, z, s, t: 0, dur, acc: 0 });
  }
  function updateColumns(dt) {
    const rate = low() ? 2.5 : 5;
    for (const c of columns) {
      if (!c.on) continue;
      if ((c.t += dt) >= c.dur) { c.on = false; continue; }
      const k = 1 - c.t / c.dur;
      for (c.acc += dt * rate * k; c.acc >= 1; c.acc -= 1) {
        const a = rand() * TAU, r = rand() * 0.25 * c.s;
        tint(emit(FX.smoke, c.x + Math.cos(a) * r, c.y + rr(0.3, 0.8) * c.s, c.z + Math.sin(a) * r, Math.cos(a) * 0.4, rr(2, 3.2) + 0.2 * c.s, Math.sin(a) * 0.4, rr(0.32, 0.42) * c.s, rr(7, 10) + c.s), rr(0.8, 1.1));
      }
    }
  }

  // An explosion; size ~ blast radius in meters (grenade 2, mortar 2.6, 75 mm 2.6 to 3, rocket 3, 105/150 mm shell
  // 4.2, bomb 6). A brief flash, a fireball that cools through orange into dark smoke, a plume of dirt thrown up and
  // clods raining back, dust rolling out along the ground, then a dark brown-grey smoke column that drifts downwind
  // and fades slowly, and a crater.
  function explode(x, z, size, { decal = true, dirt = true, debris = FX.clod, smokeK = 1, y, fire = 1 } = {}) {
    const lo = low(), q = lo ? 0.5 : 1, gy = y ?? hAt(x, z), s = size, rs = Math.sqrt(s);
    emit(FX.flash, x, gy + 0.35 * s, z, 0, 0, 0, 0.85 * s, 0.05 + 0.012 * s);
    const nf = s >= 4 ? 3 : s >= 2.5 ? 2 : 1;
    for (let i = 0; i < nf; i++) {
      const a = rand() * TAU, r = i ? rr(0.15, 0.32) * s : 0;
      emit(FX.fireball, x + Math.cos(a) * r, gy + rr(0.28, 0.4) * s, z + Math.sin(a) * r, Math.cos(a) * r * 0.5, rr(0.8, 1.5) * rs, Math.sin(a) * r * 0.5,
        rr(0.4, 0.52) * s * fire * (i ? 0.8 : 1), (0.5 + 0.1 * s) * rr(0.9, 1.15));
    }
    if (dirt) {
      for (let i = 0, np = s >= 3.6 ? 2 : 1; i < np; i++) emit(FX.plume, x + rr(-0.12, 0.12) * s, gy - 0.1, z + rr(-0.12, 0.12) * s, 0, 0, 0, rr(0.5, 0.62) * s, rr(1.1, 1.5) + 0.12 * s);
      const nd = Math.round((5 + s * 3) * q);
      for (let i = 0; i < nd; i++) {
        const a = rand() * TAU, h = rr(1.5, 4.5) * rs;
        emit(FX.clod, x + Math.cos(a) * 0.2 * s, gy + 0.3, z + Math.sin(a) * 0.2 * s, Math.cos(a) * h, rr(5, 10) * rs, Math.sin(a) * h, rr(0.05, 0.13) * Math.min(2, rs), rr(1.2, 2.2));
      }
      if (!lo || s >= 3) {
        const nr = Math.round((4 + 1.2 * s) * q);
        for (let i = 0; i < nr; i++) {
          const a = i / nr * TAU + rand() * 0.4, sp = rr(2.5, 4.5) + 0.8 * s;
          tint(emit(FX.dust, x + Math.cos(a) * 0.35 * s, gy + 0.2 * rs, z + Math.sin(a) * 0.35 * s, Math.cos(a) * sp, rr(0.2, 0.6), Math.sin(a) * sp, rr(0.22, 0.32) * s, rr(1.8, 2.8) + 0.15 * s), rr(0.85, 1.1));
        }
      }
    }
    if (debris && debris !== FX.clod) {
      const nb = Math.round((3 + 2 * s) * q);
      for (let i = 0; i < nb; i++) {
        const a = rand() * TAU, h = rr(1.5, 4) * rs * 0.7;
        emit(debris, x, gy + 0.4 * s, z, Math.cos(a) * h, rr(5, 9) * rs * 0.6, Math.sin(a) * h, rr(0.1, 0.22) * Math.min(2, rs), rr(1.3, 2.4));
      }
    }
    const ns = Math.round((2 + s * 1.3) * q * smokeK);
    for (let i = 0; i < ns; i++) {
      const a = rand() * TAU, r = rand() * 0.35 * s, o = emit(FX.smoke, x + Math.cos(a) * r, gy + rr(0.25, 0.6) * s, z + Math.sin(a) * r,
        Math.cos(a) * rr(0.3, 1), rr(1.2, 2.4) + 0.25 * s, Math.sin(a) * rr(0.3, 1), rr(0.3, 0.42) * s, rr(5, 8) + 1.2 * s);
      hold(o, rr(0.12, 0.4)); tint(o, rr(0.85, 1.15));
    }
    if (s >= 4 && smokeK > 0) column(x, gy, z, s, 1.2 + 0.25 * s);
    if (!lo) for (let i = 0, nk = Math.round(1 + s * 0.6); i < nk; i++) { const a = rand() * TAU, h = rr(4, 9); emit(FX.spark, x, gy + 0.4 * s, z, Math.cos(a) * h, rr(5, 12), Math.sin(a) * h, 0.05, rr(0.3, 0.6)); }
    if (decal) scorch(x, z, Math.min(6.5, 0.7 * s + 0.4));
    kick(x, z, s);
  }

  // muzzle flash: a short flame out of the barrel seen from the side, a little glow at the muzzle; heavy guns blow a
  // ring of dust off the ground and leave a cloud of gun smoke
  function muzzle(x, y, z, dx, dz, s, st) {
    const L = s * (s > 1 ? 1.6 : 1.2);
    stretch(emit(FX.muzzle, x + dx * L, y, z + dz * L, dx * 0.5, 0, dz * 0.5, s * (s > 1 ? 0.75 : 0.5), 0.045 + 0.03 * s), L);
    emit(FX.flash, x + dx * 0.3 * s, y, z + dz * 0.3 * s, 0, 0, 0, s * 0.6, 0.035 + 0.02 * s);
    if (low()) return;
    if (st.smoke) for (let i = 0; i < 2 + 3 * st.smoke; i++) emit(FX.gunsmoke, x + dx * rr(0.3, 1.4) * s, y + rr(-0.1, 0.2), z + dz * rr(0.3, 1.4) * s, dx * rr(1.5, 4) + rr(-0.6, 0.6), rr(0.2, 0.6), dz * rr(1.5, 4) + rr(-0.6, 0.6), 0.4 * s, rr(1.6, 2.6));
    else if (rand() < 0.35) emit(FX.gunsmoke, x + dx * 0.3, y, z + dz * 0.3, dx * 0.8, 0.3, dz * 0.8, 0.22 + 0.2 * s, rr(0.9, 1.4));
    if (st.blast) {
      // the blast ring: dust pushed out radially from under the muzzle
      const bx = x + dx * 1.6, bz = z + dz * 1.6, gy = hAt(bx, bz), nr = 9;
      for (let i = 0; i < nr; i++) {
        const a = i / nr * TAU + rand() * 0.3, sp = rr(4, 6.5) * st.blast;
        emit(FX.dust, bx + Math.cos(a) * 0.6, gy + 0.3, bz + Math.sin(a) * 0.6, Math.cos(a) * sp + dx * 2, rr(0.2, 0.6), Math.sin(a) * sp + dz * 2, 0.55 * st.blast, rr(1.2, 1.9));
      }
    }
    if (st.back) {
      // a rocket launcher's back-blast: flame and a cone of smoke and dust out behind the tube
      stretch(emit(FX.muzzle, x - dx * 1.6, y, z - dz * 1.6, -dx * 0.5, 0, -dz * 0.5, 0.45, 0.06), 1.4);
      for (let i = 0; i < 5; i++) emit(FX.gunsmoke, x - dx * rr(0.6, 2), y + rr(-0.2, 0.3), z - dz * rr(0.6, 2), -dx * rr(3, 6) + rr(-1, 1), rr(0.2, 0.8), -dz * rr(3, 6) + rr(-1, 1), 0.55, rr(1.4, 2.2));
      const gy = hAt(x - dx * 2, z - dz * 2);
      for (let i = 0; i < 4; i++) emit(FX.dust, x - dx * 2, gy + 0.3, z - dz * 2, -dx * rr(3, 5) + rr(-1.5, 1.5), 0.4, -dz * rr(3, 5) + rr(-1.5, 1.5), 0.5, rr(1, 1.6));
    }
  }

  // one round leaving the gun: flash at the muzzle, a tracer to the end point (MGs every round, rifles now and
  // then, faintly), impact on arrival
  function shotTracer(x, y, z, ex, ey, ez, st, flags) {
    const dx = ex - x, dy = ey - y, dz = ez - z, d = Math.hypot(dx, dy, dz) || 1, hd = Math.hypot(dx, dz) || 1, T = d / st.spd;
    muzzle(x, y, z, dx / hd, dz / hd, st.flash, st);
    if (st.tr && rand() < st.trOdds) emit(st.tr, x, y, z, dx / T, dy / T, dz / T, st.w, T);
    later(T, E_IMPACT, ex, ey, ez, STYLES.indexOf(st), flags);
  }

  // a round fired into the sky: flash and streak only, nothing lands
  function skyShot(x, y, z, ex, ey, ez, st) {
    const dx = ex - x, dy = ey - y, dz = ez - z, d = Math.hypot(dx, dy, dz) || 1, hd = Math.hypot(dx, dz) || 1, T = d / st.spd;
    muzzle(x, y, z, dx / hd, dz / hd, st.flash, SMALL);
    if (st.tr) emit(st.tr, x, y, z, dx / T, dy / T, dz / T, st.w, T);
  }
  // a flak shell bursting in the air: a sharp flash, a few sparks and a black puff that swells, hangs and drifts
  function burst(x, y, z, s = 1) {
    const lo = low();
    emit(FX.flash, x, y, z, 0, 0, 0, 0.9 * s, 0.06);
    for (let i = 0; i < (lo ? 2 : 4); i++) emit(FX.flak, x + rr(-0.4, 0.4) * s, y + rr(-0.3, 0.3) * s, z + rr(-0.4, 0.4) * s, rr(-0.8, 0.8), rr(-0.2, 0.4), rr(-0.8, 0.8), rr(0.6, 0.9) * s, rr(2.5, 4));
    if (!lo) for (let i = 0; i < 3; i++) { const a = rand() * TAU, h = rr(3, 7); emit(FX.spark, x, y, z, Math.cos(a) * h, rr(-2, 4), Math.sin(a) * h, 0.05, rr(0.25, 0.5)); }
  }

  // flags: 1 hit, 2 vehicle target, 4 structure target
  function impact(x, y, z, st, flags) {
    const hit = flags & 1, veh = flags & 2, wall = flags & 4, gy = hAt(x, z), lo = low();
    if (st.heavy) {
      if (veh && hit && !wall) {
        // a shell striking armor: a hard flash, sparks, a puff of black smoke and a few torn bits of metal
        emit(FX.flash, x, y, z, 0, 0, 0, 0.7 * st.heavy, 0.07);
        emit(FX.fireball, x, y, z, 0, 0.8, 0, 0.3 * st.heavy, 0.45);
        for (let i = 0; i < (lo ? 3 : 8); i++) { const a = rand() * TAU, h = rr(3, 8); emit(FX.spark, x, y, z, Math.cos(a) * h, rr(2, 8), Math.sin(a) * h, 0.06, rr(0.3, 0.7)); }
        for (let i = 0; i < (lo ? 1 : 3); i++) emit(FX.wreckSmoke, x + rr(-0.4, 0.4), y + rr(0, 0.5), z + rr(-0.4, 0.4), rr(-0.5, 0.5), rr(1, 2), rr(-0.5, 0.5), 0.35 * st.heavy, rr(2.5, 4));
        if (!lo) for (let i = 0; i < 3; i++) { const a = rand() * TAU, h = rr(2, 5); emit(FX.metal, x, y, z, Math.cos(a) * h, rr(3, 6), Math.sin(a) * h, rr(0.06, 0.12), rr(1, 1.8)); }
        play('blast_small', x, z);
      } else {
        explode(x, z, st.heavy * (hit ? 1.1 : 1), { debris: wall ? FX.masonry : FX.clod, smokeK: 0.6 });
        play('blast_small', x, z);
      }
      return;
    }
    if (veh && hit && !wall) {
      for (let i = 0; i < (lo ? 1 : 3); i++) { const a = rand() * TAU, h = rr(3, 7); emit(FX.spark, x, y, z, Math.cos(a) * h, rr(1, 5), Math.sin(a) * h, 0.04, rr(0.15, 0.35)); }
      play('ricochet', x, z, 0.3);
    } else if (wall && hit) {
      // chips off a wall: a few bits of brick and stone and a puff of pale dust
      for (let i = 0; i < (lo ? 1 : 3); i++) { const a = rand() * TAU, h = rr(1.5, 3.5); emit(FX.masonry, x, y, z, Math.cos(a) * h, rr(1, 4), Math.sin(a) * h, rr(0.04, 0.08), rr(0.8, 1.4)); }
      tint(emit(FX.dust, x, y, z, rr(-0.4, 0.4), rr(0.2, 0.6), rr(-0.4, 0.4), rr(0.25, 0.4), rr(0.9, 1.5)), 1.25);
    } else {
      // a bullet kicking up the dirt: a little spurt of dust and grit standing on the ground
      emit(FX.kick, x + rr(-0.3, 0.3), gy - 0.05, z + rr(-0.3, 0.3), 0, 0, 0, rr(0.32, 0.48), rr(0.55, 0.85));
      if (!lo) emit(FX.clod, x, gy + 0.1, z, rr(-1, 1), rr(2.5, 4.5), rr(-1, 1), rr(0.03, 0.05), rr(0.5, 0.8));
    }
  }

  // strafing fire walking along the ground: heavy rounds throwing up spurts of dirt
  function strafeHit(x, z) {
    const gy = hAt(x, z);
    for (let i = 0; i < (low() ? 2 : 4); i++) emit(FX.kick, x + rr(-1.2, 1.2), gy - 0.05, z + rr(-1.2, 1.2), 0, 0, 0, rr(0.5, 0.8), rr(0.7, 1.1));
    if (!low()) for (let i = 0; i < 3; i++) emit(FX.clod, x, gy + 0.1, z, rr(-2, 2), rr(3, 6), rr(-2, 2), rr(0.04, 0.08), rr(0.6, 1));
  }

  // rocket with a smoke trail on an arc; impacts come from the server separately
  const rockets = Array.from({ length: 48 }, () => ({ on: false }));
  function launchRocket(x0, y0, z0, x1, y1, z1, T, h) {
    const r = rockets.find(q => !q.on);
    if (!r) return;
    const g = h > 0 ? 8 * h / (T * T) : 0;
    Object.assign(r, { on: true, x0, y0, z0, vx: (x1 - x0) / T, vy: (y1 - y0 + 0.5 * g * T * T) / T, vz: (z1 - z0) / T, g, t: 0, T, acc: 0 });
    const o = emit(FX.rocket, x0, y0, z0, r.vx, r.vy, r.vz, 0.22, T * 0.97);
    if (o >= 0) S[o + 22] = g;
    emit(FX.flash, x0, y0, z0, 0, 0, 0, 0.8, 0.07);
    if (!low()) {
      const sp = Math.hypot(r.vx, r.vy, r.vz) || 1;
      for (let i = 0; i < 3; i++) emit(FX.gunsmoke, x0, y0, z0, -r.vx / sp * rr(2, 4) + rr(-0.8, 0.8), rr(0.3, 0.9), -r.vz / sp * rr(2, 4) + rr(-0.8, 0.8), 0.5, rr(1.4, 2.2));
    }
  }
  function updateRockets(dt) {
    const every = low() ? 0.07 : 0.03;
    for (const r of rockets) {
      if (!r.on) continue;
      r.t += dt; r.acc += dt;
      if (r.t >= r.T) { r.on = false; continue; }
      while (r.acc >= every) {
        r.acc -= every;
        const t = r.t - r.acc;
        emit(FX.trail, r.x0 + r.vx * t, r.y0 + r.vy * t - 0.5 * r.g * t * t, r.z0 + r.vz * t, 0, 0.3, 0, 0.2, rr(1.2, 1.8));
      }
    }
  }

  // ---------- shooters ----------
  function nthVisible(v, i, pick) {
    let k = 0;
    for (let m = 0; m < v.models.length; m++) { const man = v.models[m]; if (!man.visible || (pick && !pick(m))) continue; if (k++ === i) return man; }
    return null;
  }
  function barrelTip(v) {
    if (v.fxTip !== undefined) return v.fxTip;
    let tip = null;
    if (v.turret) for (const m of v.turret.children) if (m.isMesh && m.geometry.type === 'CylinderGeometry' && Math.abs(m.rotation.z - Math.PI / 2) < 0.01) { tip = [m.position.x + m.scale.y / 2, m.position.y, m.position.z]; break; }
    return (v.fxTip = tip);
  }
  // fixed gun tips in the unit's local space (+x forward, z mirrored for the second barrel or wing)
  const TIPS = { fighter: [1.1, -0.15, 2.4], attacker: [1.2, -0.4, 3], flak: [1.7, 2.0, 0.15], flakpos: [0.95, 2.1, 0.2] };
  // world position of the k-th weapon of unit v into v3; false if it has none showing
  function muzzleAt(v, k, tx, tz, bazooka) {
    const type = v.type, fixed = TIPS[type];
    if (fixed) {
      // left and right barrels (wings): the first one alternates shot to shot, the second is the other side
      if (k === 0) v.fxGun = ((v.fxGun ?? 0) + 1) % 2;
      v.root.updateWorldMatrix(true, false); v3.set(fixed[0], fixed[1], (k + v.fxGun) % 2 ? fixed[2] : -fixed[2]).applyMatrix4(v.root.matrixWorld); return true;
    }
    if (type === 'bunker') {
      const dx = tx - v.x, dz = tz - v.z, d = Math.hypot(dx, dz) || 1;
      v3.set(v.x + dx / d * 2.8, hAt(v.x, v.z) + 1.6, v.z + dz / d * 2.8); return true;
    }
    const tip = barrelTip(v);
    if (tip) { v.turret.updateWorldMatrix(true, false); v3.set(tip[0], tip[1], tip[2]).applyMatrix4(v.turret.matrixWorld); return true; }
    if (type === 'mg') { v.root.updateWorldMatrix(true, false); v3.set(1.72, 0.45, 0).applyMatrix4(v.root.matrixWorld); return true; }
    const man = bazooka ? nthVisible(v, k, (m) => m % 3 === 1) : nthVisible(v, k, type === 'ranger' ? (m) => m % 3 !== 1 : null);
    if (!man) return false;
    man.updateWorldMatrix(true, false);
    const p = bazooka ? BAZ : HAND[type] ?? HAND.rifle;
    v3.set(p[0], p[1], p[2]).applyMatrix4(man.matrixWorld);
    return true;
  }

  const BURST_SND = { mg: 1.25, smg: 0.7 }, lastBurst = new Map(), TIGER = { rate: 0.85 };
  function directFire(sh, from, seenTarget) {
    const to = seenTarget ? units.get(sh.t) : null, tdef = UNITS[to?.type], veh = tdef ? !tdef.infantry : false;
    const bazooka = sh.k === 'ranger' && veh;
    const st = bazooka ? BAZOOKA : GUNS[sh.k] ?? SMALL, sti = STYLES.indexOf(st);
    const flags = (sh.hit ? 1 : 0) | (veh ? 2 : 0) | (tdef?.structure ? 4 : 0);
    const ty = veh ? (tdef.structure ? 1.6 : 1.2) : 0.8;
    // gun sound at the shooter if we can see it, else where the rounds land. An MG fires every 0.3 s but its
    // recording is a whole burst, so one plays per burst; rifles crack once per soldier, with his flash (below)
    const sx = from ? from.x : sh.x, sz = from ? from.z : sh.z, burstGap = BURST_SND[st.snd];
    if (burstGap) { if (clock - (lastBurst.get(sh.f) ?? -1e9) >= burstGap) { lastBurst.set(sh.f, clock); play(st.snd, sx, sz); } }
    else if (st.snd !== 'rifle' || !from) play(st.snd, sx, sz, 0, sh.k === 'tiger' ? TIGER : undefined);
    if (lastBurst.size > 400) lastBurst.clear();
    if (!from) {
      // shooter hidden: only the arrival shows
      const ex = sh.x + rr(-1, 1) * (sh.hit ? 0.6 : 2.5), ez = sh.z + rr(-1, 1) * (sh.hit ? 0.6 : 2.5);
      impact(ex, hAt(ex, ez) + ty, ez, st, flags);
      return;
    }
    const spread = sh.hit ? (veh ? 0.6 : 1.4) : 3, men = st.n > 1 ? Math.min(st.n, st.guns ?? from.alive ?? 1) : 1;
    for (let i = 0; i < men; i++) {
      if (!muzzleAt(from, i, sh.x, sh.z, bazooka)) break;
      const mx = v3.x, my = v3.y, mz = v3.z;
      const shots = bazooka ? 1 : st.burst, t0 = st.n > 1 ? rand() * 0.18 : 0;
      if (st.snd === 'rifle') snd('rifle', t0, sx, sz, 0, i ? 0.8 : 0);
      for (let b = 0; b < shots; b++) {
        let ex = sh.x + rr(-0.5, 0.5) * spread, ez = sh.z + rr(-0.5, 0.5) * spread;
        if (sh.hit && veh) { const ddx = ex - mx, ddz = ez - mz, dd = Math.hypot(ddx, ddz) || 1, r = Math.min(dd * 0.5, (tdef.radius ?? 1.4) * 0.9); ex -= ddx / dd * r; ez -= ddz / dd * r; }
        const ey = hAt(ex, ez) + (sh.hit ? ty : 0.1);
        later(t0 + b * st.gap, E_TRACER, mx, my, mz, ex, ey, ez, sti, flags & (b === 0 ? 7 : 6));
      }
    }
  }

  // ---------- smoke screens ----------
  // thick white smoke that rolls slowly in place: big, slowly turning puffs layered up to a few meters, renewed as
  // they fade, so the cloud reads as solid for as long as the server keeps it
  const clouds = new Map();
  let cloudId = 0;
  function puffCloud(c, burst) {
    const lo = low(), r = c.r, a = rand() * TAU, d = Math.sqrt(rand()) * r * 0.8, size = r * (lo ? rr(0.6, 0.72) : rr(0.46, 0.62));
    const x = c.x + Math.cos(a) * d, z = c.z + Math.sin(a) * d, y = hAt(x, z) + size * rr(0.35, 0.75) + rand() * r * 0.18;
    const out = burst ? rr(1.5, 3.5) : 0.25;
    // the smoke over a burning hedge or house is grey-black and rises; a smoke screen is white and hangs
    const o = emit(c.fire ? FX.fireSmoke : FX.screen, x, y, z, Math.cos(a) * out, rr(0.05, 0.25) + (c.fire ? rr(0.6, 1.2) : 0), Math.sin(a) * out, burst ? size * 0.55 : size, burst ? rr(4, 8) : rr(6, 8.5));
    if (o < 0) return;
    S[o + 29] = c.id; tint(o, rr(0.88, 1.05));
    if (burst) { S[o + 9] = size * 1.35; S[o + 21] = 1.2; }
    if (lo) S[o + 20] = 0;
  }
  function syncClouds(list) {
    for (const c of clouds.values()) c.keep = false;
    for (const [x, z, r, id] of list) {
      const key = id ?? x * 100003 + z;
      let c = clouds.get(key);
      if (c) { c.x = x; c.z = z; } // the wind carries it
      if (!c) {
        // a cloud that rises over fire the server just lit is that fire's smoke (shared/sim.js ignite)
        let fire = false;
        for (const f of fires.values()) if (f.kind !== '.' && Math.hypot(f.x - x, f.z - z) < r * 1.5) { fire = true; break; }
        c = { id: ++cloudId, x, z, r, acc: 0, keep: true, fire };
        clouds.set(key, c);
        const lo = low(), burst = Math.round((lo ? 7 : 16) * (r / 7) ** 2 * (fire ? 0.4 : 1));
        for (let i = 0; i < burst; i++) puffCloud(c, true);
        if (!fire) {
          // the smoke shells popping: small flashes low on the ground
          for (let i = 0; i < (lo ? 2 : 4); i++) emit(FX.flash, x + rr(-2.5, 2.5), hAt(x, z) + 0.6, z + rr(-2.5, 2.5), 0, 0, 0, 0.9, 0.07);
          play('smoke', x, z, 0.15);
        }
      }
      c.keep = true;
    }
    for (const [key, c] of clouds) {
      if (c.keep) continue;
      clouds.delete(key);
      // the screen is gone on the server: thin it out quickly so it doesn't look like it still blocks sight
      for (let i = 0; i < n; i++) { const o = i * F; if (S[o + 29] === c.id) S[o + 7] = Math.min(S[o + 7], S[o + 6] + rr(1, 2.2)); }
    }
  }
  // ---------- fires: burning grass, hedges and houses (snapshot.fires: [x, z, cell type]) ----------
  // Grass burns in low flames, a hedge in a wall of flame with dark smoke, a house in tall flames at its windows and
  // roof. A fire that goes out leaves a burn mark (a house leaves rubble instead).
  const fires = new Map();
  const FIRE = { '.': { h: 0, size: 0.6, rate: 2.5, smoke: 0.15 }, H: { h: 0.4, size: 1.1, rate: 3.5, smoke: 0.5 }, B: { h: 1.6, size: 1.6, rate: 3, smoke: 0.7 } };
  function syncFires(list) {
    for (const f of fires.values()) f.keep = false;
    for (const [x, z, ch] of list) {
      const key = x * 100003 + z;
      let f = fires.get(key);
      if (!f) fires.set(key, f = { x, z, y: hAt(x, z), kind: FIRE[ch] ? ch : '.', acc: rand(), sa: rand() });
      f.keep = true;
    }
    for (const [key, f] of fires) if (!f.keep) { fires.delete(key); if (f.kind !== 'B') scorch(f.x, f.z, 1.7, 1); }
  }
  function updateFires(dt) {
    if (!fires.size) return;
    // many fires share the particle budget
    const lo = low(), share = (lo ? 0.5 : 1) * Math.min(1, 50 / fires.size);
    for (const f of fires.values()) {
      const F = FIRE[f.kind];
      for (f.acc += dt * F.rate * share; f.acc >= 1; f.acc--) {
        const o = emit(FX.flame, f.x + rr(-0.8, 0.8), f.y + F.h * rr(0.6, 1.8), f.z + rr(-0.8, 0.8), 0, rr(0.1, 0.3), 0, F.size * rr(0.8, 1.2), rr(0.9, 1.4));
        if (o >= 0) S[o + 23] = f.kind === 'B' ? 0.8 : 0.4; // in front of the walls and the hedge it burns in
        if (!lo && rand() < 0.15) emit(FX.ember, f.x + rr(-0.6, 0.6), f.y + F.h + 0.8, f.z + rr(-0.6, 0.6), rr(-1, 1), rr(2, 4), rr(-1, 1), 0.05, rr(1, 2));
      }
      for (f.sa += dt * F.smoke * share; f.sa >= 1; f.sa--) {
        tint(emit(f.kind === '.' ? FX.smoke : FX.wreckSmoke, f.x + rr(-0.6, 0.6), f.y + F.h + 1, f.z + rr(-0.6, 0.6), rr(-0.3, 0.3), rr(1.2, 2), rr(-0.3, 0.3), F.size * rr(0.8, 1.1), rr(5, 8)), f.kind === '.' ? 1.2 : 1);
      }
    }
  }
  // a vehicle moving over dry ground trails dust (unit flag 32768)
  function dustTrails(rows, seen) {
    for (const r of rows ?? []) {
      if (!(r[12] & 32768) || !seen.has(r[0]) || rand() > (low() ? 0.3 : 0.6)) continue;
      const x = r[3] - Math.cos(r[5]) * 1.6 + rr(-0.7, 0.7), z = r[4] - Math.sin(r[5]) * 1.6 + rr(-0.7, 0.7);
      emit(FX.roadDust, x, hAt(x, z) + 0.3, z, rr(-0.3, 0.3), rr(0.3, 0.8), rr(-0.3, 0.3), rr(0.7, 1.2), rr(1.4, 2.4));
    }
  }
  function updateClouds(dt) {
    const lo = low();
    for (const c of clouds.values()) {
      const target = (lo ? 10 : 26) * (c.r / 7) ** 2, life = 7.2;
      c.acc += dt * target / life;
      while (c.acc >= 1) { c.acc -= 1; puffCloud(c, false); }
    }
  }

  // ---------- wrecks: flames that flicker for a while, then a long trail of black smoke leaning downwind ----------
  const wrecks = [];
  function burning(x, y, z, big, fire, dur) {
    wrecks.push({ x, y, z, t: 0, fire, dur, fa: 0, sa: 0, ea: 0, big });
  }
  function wreck(v) {
    const def = UNITS[v.type], gy = hAt(v.x, v.z);
    if (def?.structure) {
      collapse(v.x, v.z, def.size ? def.size * 2.5 : 4);
      burning(v.x, gy + 1, v.z, 1.4, 8, 30);
      return;
    }
    const big = v.type === 'tiger' ? 1.3 : v.type === 'medium' ? 1.15 : 1;
    explode(v.x, v.z, 3.2 * big, { debris: FX.metal, smokeK: 0.7 });
    burning(v.x, gy + 1.3 * big, v.z, big, 20, 38);
    play('vehicle_destroyed', v.x, v.z);
    play('fire_loop', v.x, v.z, 0, { delay: 0.8, dur: 14 });
  }
  function updateWrecks(dt) {
    const lo = low();
    for (let i = wrecks.length - 1; i >= 0; i--) {
      const w = wrecks[i];
      w.t += dt;
      if (w.t >= w.dur) { wrecks.splice(i, 1); continue; }
      const fireK = w.t < w.fire * 0.5 ? 1 : Math.max(0, 1 - (w.t - w.fire * 0.5) / (w.fire * 0.5));
      const smokeK = 1 - 0.65 * (w.t / w.dur);
      w.fa += dt * fireK * (lo ? 3 : 6);
      w.sa += dt * smokeK * (lo ? 2.2 : 4.5);
      w.ea += dt * fireK * (lo ? 0 : 3);
      while (w.fa >= 1) {
        w.fa -= 1;
        const o = emit(FX.flame, w.x + rr(-0.8, 0.8) * w.big, w.y - 0.4 * w.big, w.z + rr(-0.8, 0.8) * w.big, 0, rr(0.1, 0.4), 0, rr(0.95, 1.4) * w.big * (0.5 + 0.5 * fireK), rr(1, 1.6));
        tint(o, rr(0.85, 1.1));
      }
      while (w.ea >= 1) { w.ea -= 1; emit(FX.ember, w.x + rr(-0.5, 0.5), w.y + 0.6, w.z + rr(-0.5, 0.5), rr(-1, 1), rr(2, 4), rr(-1, 1), 0.05, rr(1, 2)); }
      while (w.sa >= 1) {
        w.sa -= 1;
        // black while the fuel burns, browner and thinner as it smolders
        tint(emit(FX.wreckSmoke, w.x + rr(-0.6, 0.6), w.y + (1 + rand()) * w.big, w.z + rr(-0.6, 0.6), rr(-0.3, 0.3), rr(1.6, 2.6), rr(-0.3, 0.3), rr(0.8, 1.1) * w.big, rr(9, 13)), 0.85 + 0.9 * (1 - fireK));
      }
    }
  }

  // a house or bunker coming down: rolling pale dust, chunks of brick, stone and timber
  function collapse(x, z, r = 4, sndOpts) {
    const lo = low(), q = lo ? 0.45 : 1, gy = hAt(x, z);
    for (let i = 0; i < Math.round(16 * q); i++) {
      const a = rand() * TAU, d = rand() * r;
      emit(FX.collapse, x + Math.cos(a) * d, gy + rr(1, 3.5), z + Math.sin(a) * d, Math.cos(a) * rr(1, 3), rr(0.4, 1.2), Math.sin(a) * rr(1, 3), rr(1.6, 2.6), rr(5, 8));
    }
    for (let i = 0; i < Math.round(12 * q); i++) {
      const a = i / 12 * TAU, sp = rr(4, 7);
      emit(FX.collapse, x + Math.cos(a) * r * 0.7, gy + 0.6, z + Math.sin(a) * r * 0.7, Math.cos(a) * sp, 0.3, Math.sin(a) * sp, rr(1, 1.6), rr(3, 5));
    }
    for (let i = 0; i < Math.round(18 * q); i++) {
      const a = rand() * TAU, h = rr(1.5, 5);
      emit(i % 5 === 4 ? FX.wood : FX.masonry, x + rr(-r, r) * 0.5, gy + rr(2, 5), z + rr(-r, r) * 0.5, Math.cos(a) * h, rr(3, 8), Math.sin(a) * h, rr(0.15, 0.32), rr(1.5, 2.6));
    }
    play('collapse', x, z, 0, sndOpts);
  }

  // ---------- planes ----------
  let fleet = null;
  function buildFleet() {
    const body = new THREE.MeshLambertMaterial({ color: 0x5d6349 }), dark = new THREE.MeshLambertMaterial({ color: 0x2b2c26 });
    const glass = new THREE.MeshLambertMaterial({ color: 0x8fa3a8 }), prop = new THREE.MeshBasicMaterial({ color: 0x1e1e1a, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide });
    const box = new THREE.BoxGeometry(1, 1, 1), disc = new THREE.CircleGeometry(1, 20).rotateY(Math.PI / 2);
    const part = (geo, m, sx, sy, sz, x, y, z) => { const o = new THREE.Mesh(geo, m); o.scale.set(sx, sy, sz); o.position.set(x, y, z); o.castShadow = true; return o; };
    const fuseF = new THREE.CylinderGeometry(0.46, 0.24, 6.2, 10).rotateZ(-Math.PI / 2), fuseB = new THREE.CylinderGeometry(0.8, 0.42, 11, 12).rotateZ(-Math.PI / 2);
    const nose = new THREE.ConeGeometry(0.24, 0.6, 10).rotateZ(-Math.PI / 2), nacelle = new THREE.CylinderGeometry(0.42, 0.3, 2.6, 10).rotateZ(-Math.PI / 2);
    const canopy = new THREE.SphereGeometry(1, 10, 6);
    const make = (bomber) => {
      const g = new THREE.Group(), stripe = new THREE.MeshLambertMaterial({ color: 0xdddddd });
      if (!bomber) {
        g.add(part(fuseF, body, 1, 1, 1, 0, 0, 0), part(nose, dark, 1, 1, 1, 3.4, 0, 0), part(box, body, 1.7, 0.16, 10, 0.7, -0.15, 0),
          part(box, stripe, 1.72, 0.17, 0.7, 0.7, -0.15, 3.6), part(box, stripe, 1.72, 0.17, 0.7, 0.7, -0.15, -3.6),
          part(box, body, 0.9, 0.1, 3.4, -2.75, 0.05, 0), part(box, body, 1.0, 1.15, 0.1, -2.8, 0.55, 0), part(canopy, glass, 0.75, 0.38, 0.36, 0.5, 0.36, 0));
        const p = new THREE.Mesh(disc, prop); p.scale.setScalar(1.35); p.position.x = 3.2; g.add(p);
        g.userData.guns = [[1.0, -0.2, 2.6], [1.0, -0.2, -2.6]];
      } else {
        g.add(part(fuseB, body, 1, 1, 1, 0, 0, 0), part(canopy, glass, 1.1, 0.6, 0.6, 3.8, 0.35, 0), part(box, body, 2.6, 0.22, 19, 0.8, 0.1, 0),
          part(box, stripe, 2.62, 0.23, 1.1, 0.8, 0.1, 7.2), part(box, stripe, 2.62, 0.23, 1.1, 0.8, 0.1, -7.2),
          part(box, body, 1.5, 0.14, 6.4, -4.9, 0.2, 0), part(box, body, 1.7, 2.0, 0.14, -5.0, 1.0, 0));
        for (const z of [-3.4, 3.4]) {
          g.add(part(nacelle, dark, 1, 1, 1, 1.6, 0, z));
          const p = new THREE.Mesh(disc, prop); p.scale.setScalar(1.6); p.position.set(2.95, 0, z); g.add(p);
        }
        g.userData.guns = [];
      }
      g.rotation.order = 'YZX'; g.visible = false; scene.add(g);
      return { g, stripe, bomber, on: false };
    };
    fleet = [make(false), make(false), make(true), make(true)];
  }
  // path along the strike line: s = distance along it (0 = center); the plane is over s0 at tArr. It comes in down a
  // slope (approach height gained per meter before s0) and climbs away past the end of its run.
  const PLANE = {
    strafe: { speed: 55, alt: 8, s0: () => -SUPPORT.strafe.len / 2 - 14, snd: 'plane_flyby' },
    bombing: { speed: 40, alt: 18, s0: () => -SUPPORT.bombing.len / 2, snd: 'bomber' },
    recon: { speed: 50, alt: 26, s0: () => 0, snd: 'plane_flyby' },
    dive: { speed: 46, alt: 10, s0: () => 0, snd: 'plane_flyby', slope: 0.55, climb: 0.5 },
    para: { speed: 36, alt: 24, s0: () => 0, snd: 'bomber' },
  };
  const BIG = { bombing: 1, para: 1 }; // flown by the twin-engine model
  const flights = new Map();
  // put plane p where its path has it now; returns how far along the line it is
  function place(p) {
    const P = p.P, s = p.s0 + (clock - p.tArr) * P.speed, end = p.kind === 'recon' ? 0 : -p.s0;
    const climb = s > end ? (s - end) * (P.climb ?? 0.22) : 0, dive = s < p.s0 ? (p.s0 - s) * (P.slope ?? 0.1) : 0;
    p.g.position.set(p.x + p.dx * s, p.gy + P.alt + climb + dive, p.z + p.dz * s);
    const bank = s > end ? Math.min(0.75, (s - end) * 0.012) * p.side : Math.sin(clock * 1.4) * 0.04;
    p.g.rotation.set(bank, -p.dir, s > end ? (P.climb ? Math.atan(P.climb) : 0.2) : s < p.s0 ? (P.slope ? -Math.atan(P.slope) : -0.08) : 0);
    return s;
  }
  function launchPlane(kind, x, z, dir, owner, inT, key) {
    if (!fleet) buildFleet();
    const bomber = !!BIG[kind], p = fleet.find(f => f.bomber === bomber && !f.on);
    flights.set(key, p ?? null);
    if (!p) return;
    const P = PLANE[kind], dx = Math.cos(dir), dz = Math.sin(dir), tag = fleet.indexOf(p) + 1;
    Object.assign(p, { on: true, down: false, kind, x, z, dx, dz, dir, gy: hAt(x, z), tArr: clock + inT, P, s0: P.s0(), side: rand() < 0.5 ? -1 : 1, gunT: 0, opened: false, drops: 0 });
    p.stripe.color.set(colorOf(owner));
    p.g.visible = true; place(p);
    play(P.snd, x, z);
    if (kind === 'bombing') {
      // bombs leave the plane so they land where and when the server's bombs do (one every 0.2 s along the line)
      const sp = SUPPORT.bombing, fall = 0.9, G = 2 * P.alt / (fall * fall);
      for (let i = 0; i < sp.shells; i++) {
        const t = inT + i * sp.every - fall;
        if (t < 0) continue;
        const s = (i / (sp.shells - 1) - 0.5) * sp.len - P.speed * fall;
        later(t, E_BOMB, x + dx * s, p.gy + P.alt - 0.8, z + dz * s, dx * P.speed, dz * P.speed, G, fall, tag);
      }
    } else if (kind === 'dive') {
      // one heavy bomb let go in the dive, landing on the spot as the server's does
      const fall = 0.7, s = -P.speed * fall, h = P.alt + (p.s0 - s) * P.slope - 0.8, t = inT - fall;
      if (t >= 0) later(t, E_BOMB, x + dx * s, p.gy + h, z + dz * s, dx * P.speed, dz * P.speed, 2 * h / (fall * fall), fall, tag);
    }
  }
  function updatePlanes(dt) {
    if (!fleet) return;
    for (const p of fleet) {
      if (!p.on || p.down) continue;
      const s = place(p);
      if (s > 170) { p.on = false; p.g.visible = false; continue; }
      for (const c of p.g.children) if (c.material?.opacity < 1) c.rotation.x += dt * 30;
      if (p.kind !== 'strafe') continue;
      // the guns walk a line of hits down the strip, 14 m ahead of the plane
      const hitS = s + 14, half = SUPPORT.strafe.len / 2;
      if (hitS < -half || hitS > half) continue;
      if (!p.opened) { p.opened = true; play('strafe', p.x, p.z); }
      if ((p.gunT -= dt) > 0) continue;
      p.gunT = low() ? 0.09 : 0.045;
      p.g.updateWorldMatrix(true, false);
      const px = -p.dz, pz = p.dx;
      for (const gun of p.g.userData.guns) {
        v3.set(gun[0], gun[1], gun[2]).applyMatrix4(p.g.matrixWorld);
        const off = Math.sign(gun[2]) * rr(0.6, 2.6), ex = p.x + p.dx * hitS + px * off, ez = p.z + p.dz * hitS + pz * off;
        later(0, E_TRACER, v3.x, v3.y, v3.z, ex, hAt(ex, ez) + 0.1, ez, STYLES.indexOf(GUNS.mg), 0);
      }
    }
  }

  // ---------- planes going down ----------
  // hit by flak or fighters: a burst where it was hit, then it rolls over and falls on, trailing fire and smoke, and
  // blows up where it hits the ground. obj is a support plane from the pool or the model of a unit that was shot down.
  const falls = [];
  function fall(obj, x, y, z, dir, speed, done) {
    obj.rotation.order = 'YZX';
    falls.push({ obj, x, y, z, dx: Math.cos(dir), dz: Math.sin(dir), dir, sp: speed, vy: 0, roll: (rand() < 0.5 ? -1 : 1) * rr(1.5, 3), t: 0, acc: 0, done });
    burst(x, y, z, 1.5);
    play('flak', x, z);
  }
  function updateFalls(dt) {
    const every = low() ? 0.08 : 0.035;
    for (let i = falls.length - 1; i >= 0; i--) {
      const f = falls[i];
      f.t += dt; f.vy -= 10 * dt; f.sp *= Math.exp(-0.3 * dt);
      f.x += f.dx * f.sp * dt; f.z += f.dz * f.sp * dt; f.y += f.vy * dt;
      const gy = hAt(f.x, f.z);
      if (f.y <= gy + 0.6 || f.t > 8) {
        falls.splice(i, 1);
        explode(f.x, f.z, 3.6, { smokeK: 1.2, debris: FX.metal });
        burning(f.x, gy + 0.8, f.z, 0.9, 10, 24);
        play('vehicle_destroyed', f.x, f.z); play('fire_loop', f.x, f.z, 0, { delay: 0.5, dur: 9 });
        f.done();
        continue;
      }
      f.obj.position.set(f.x, f.y, f.z);
      f.obj.rotation.set(f.t * f.roll, -f.dir, -Math.min(1.1, Math.atan2(-f.vy, f.sp)));
      for (f.acc += dt; f.acc >= every; f.acc -= every) {
        tint(emit(FX.wreckSmoke, f.x - f.dx * 1.5, f.y, f.z - f.dz * 1.5, rr(-0.3, 0.3), rr(0.3, 0.9), rr(-0.3, 0.3), rr(0.5, 0.8), rr(2.2, 3.4)), 0.8);
        emit(FX.burn, f.x + rr(-0.4, 0.4), f.y + rr(-0.2, 0.3), f.z + rr(-0.4, 0.4), 0, rr(0.5, 1.5), 0, rr(0.6, 1.0), rr(0.25, 0.4));
      }
    }
  }
  // a support plane shot down on its way in: the flight drawn for it if there is one, else a free plane at the spot
  function downFleet(p, x, y, z, dir, speed) {
    p.on = true; p.down = true; p.g.visible = true;
    const tag = fleet.indexOf(p) + 1;
    for (let i = 0; i < evn; i++) if (evK[i] === E_BOMB && evA[i * 8 + 7] === tag) evK[i] = 0; // the rest of its bombs stay on board
    fall(p.g, x, y, z, dir, speed, () => { p.on = false; p.down = false; p.g.visible = false; });
  }
  function shotDown(sh) {
    const P = PLANE[sh.kind], dir = sh.dir ?? 0;
    const p = flights.get(`${sh.kind},${Math.round(sh.x * 10) / 10},${Math.round(sh.z * 10) / 10}`);
    if (p && p.on && !p.down) { place(p); downFleet(p, p.g.position.x, p.g.position.y, p.g.position.z, dir, (P?.speed ?? 40) * 0.6); return; }
    spare(!!BIG[sh.kind], sh.x, sh.z, P?.alt ?? airAlt, dir, (P?.speed ?? 40) * 0.6, sh.fo);
  }
  // a plane falling with no flight or unit drawn for it (all pool planes busy, or the unit was never in sight)
  function spare(bomber, x, z, alt, dir, speed, owner) {
    if (!fleet) buildFleet();
    const p = fleet.find(f => f.bomber === bomber && !f.on);
    if (!p) { burst(x, hAt(x, z) + alt, z, 1.5); return; }
    Object.assign(p, { kind: 'down', P: null });
    if (owner !== undefined) p.stripe.color.set(colorOf(owner));
    downFleet(p, x, hAt(x, z) + alt, z, dir, speed);
  }
  // a fighter or ground-attack plane (a unit) shot out of the sky by anti-air: its own model goes down
  function downPlane(v) {
    v.sel.visible = false; if (v.range) v.range.visible = false;
    v.root.updateWorldMatrix(true, false); v3.setFromMatrixPosition(v.root.matrixWorld);
    fall(v.root, v3.x, v3.y, v3.z, v.rot, Math.max(12, UNITS[v.type].speed ?? 15), () => v.root.removeFromParent());
  }

  // anti-air fire: flak at a support plane passing over (no target unit), or anti-air at a plane on station
  function flakAt(sh, from) {
    let px = sh.x, py = hAt(sh.x, sh.z) + airAlt, pz = sh.z;
    const p = fleet?.find(q => q.on && !q.down && Math.abs(q.x - sh.x) < 1 && Math.abs(q.z - sh.z) < 1);
    if (p) { px = p.g.position.x; py = p.g.position.y; pz = p.g.position.z; }
    for (let i = 0; i < 5; i++) later(i * 0.09 + rr(0, 0.05), E_FLAK, px + rr(-7, 7), py + rr(-3, 4), pz + rr(-7, 7), 1);
    if (from && muzzleAt(from, 0, px, pz)) skyShot(v3.x, v3.y, v3.z, px + rr(-3, 3), py, pz + rr(-3, 3), GUNS.flak);
    play('flak', from ? from.x : px, from ? from.z : pz, 0.1);
  }
  // bursts = false: only the guns' tracers and their sound (main.js has client/aircraft.js draw the bursts)
  function antiAir(sh, from, to, bursts = true) {
    let ex = sh.x, ey = hAt(sh.x, sh.z) + airAlt, ez = sh.z;
    if (to) { to.root.updateWorldMatrix(true, false); v3.setFromMatrixPosition(to.root.matrixWorld); ex = v3.x; ey = v3.y; ez = v3.z; }
    // style by shooter: flak guns burst shells around the plane; an MG (or a shooter out of sight) is plain tracer fire
    const t = from?.type, flak = t === 'flak' || t === 'flaktrack' || t === 'flakpos';
    const st = t === 'fighter' ? GUNS.fighter : t === 'flaktrack' ? GUNS.flaktrack : flak ? GUNS.flak : GUNS.mg, sti = STYLES.indexOf(st);
    let T = 0.15;
    if (from) for (let i = 0; i < (st.guns ?? 1); i++) {
      if (!muzzleAt(from, i, ex, ez)) break;
      const mx = v3.x, my = v3.y, mz = v3.z;
      T = Math.hypot(ex - mx, ey - my, ez - mz) / st.spd;
      for (let b = 0; b < st.burst; b++) later(b * st.gap, E_SKY, mx, my, mz, ex + rr(-2.5, 2.5), ey + rr(-1.5, 1.5), ez + rr(-2.5, 2.5), sti);
    }
    if (flak && bursts) later(T, E_FLAK, ex + rr(-4, 4), ey + rr(-2, 3), ez + rr(-4, 4), 0.7); // shells bursting around it
    play(st.snd, from ? from.x : ex, from ? from.z : ez, 0.1);
  }

  function syncStrikes(list) {
    const keep = new Set();
    for (const [kind, x, z, dir, t, owner] of list ?? []) {
      const key = `${kind},${x},${z}`; keep.add(key);
      if (kind === 'artillery' && t <= 1.4 && !flights.has(key)) { flights.set(key, null); whistle(0, t, x, z); }
      const P = PLANE[kind];
      if (P && !flights.has(key) && t <= (P.s0() + 150) / P.speed) launchPlane(kind, x, z, dir, owner, t, key);
    }
    for (const key of flights.keys()) if (!keep.has(key)) flights.delete(key);
  }

  // ---------- snapshot ----------
  const throws = Array.from({ length: 12 }, () => ({ x: 0, z: 0, satchel: false, t: -1e9 })); let throwI = 0;
  // salvos fired lately, so their impacts know whether they are mortar bombs (81 mm) or rockets
  const salvos = Array.from({ length: 8 }, () => ({ x: 0, z: 0, r: 0, mortar: false, t: -1e9 })); let salvoI = 0;
  const ROCKET = { gain: 0.8 }, LIGHT = { gain: 0.3, rate: 1.3 };
  function openCell(s, x, z) {
    const w = mapW(), c = Math.floor(z / CELL) * w + Math.floor(x / CELL);
    if (w) for (const [cell, ch] of s.cells ?? []) if (cell === c && ch === '.') return true;
    return false;
  }
  function snapshot(s, seen) {
    syncStrikes(s.strikes);
    for (const sh of s.shots) {
      const k = sh.k, from = sh.f !== undefined && seen.has(sh.f) ? units.get(sh.f) : null;
      if (k === 'hurt') continue;
      if (k === 'throw') {
        if (!from) continue;
        const satchel = from.type === 'ranger', gy = hAt(from.x, from.z), T = satchel ? 0.8 : 1.1, G = 25, ty = hAt(sh.x, sh.z) + 0.2;
        Object.assign(throws[throwI++ % throws.length], { x: sh.x, z: sh.z, satchel, t: clock });
        const o = emit(FX.nade, from.x, gy + 1.5, from.z, (sh.x - from.x) / T, (ty - gy - 1.5 + 0.5 * G * T * T) / T, (sh.z - from.z) / T, satchel ? 0.2 : 0.12, T);
        if (o >= 0) S[o + 22] = G;
        continue;
      }
      if (k === 'boom') {
        const th = throws.find(q => clock - q.t < 6 && Math.abs(q.x - sh.x) < 0.5 && Math.abs(q.z - sh.z) < 0.5);
        explode(sh.x, sh.z, th?.satchel ? 3.2 : 2, { debris: th?.satchel ? FX.masonry : FX.clod, fire: th?.satchel ? 1 : 0.8 });
        play(th?.satchel ? 'blast_large' : 'blast_small', sh.x, sh.z);
        continue;
      }
      if (k === 'shell') { explode(sh.x, sh.z, 4.2); play('blast_large', sh.x, sh.z); continue; }
      if (k === 'rocket') {
        const sv = salvos.find(q => clock - q.t < 12 && Math.hypot(q.x - sh.x, q.z - sh.z) <= q.r + 2);
        explode(sh.x, sh.z, sv?.mortar ? 2.6 : 3); play('blast_small', sh.x, sh.z, 0, ROCKET); continue;
      }
      if (k === 'bomb') { explode(sh.x, sh.z, 6, { smokeK: 1.3 }); play('bomb', sh.x, sh.z); continue; }
      if (k === 'salvo') { salvo(sh, from); continue; }
      if (PLANE[k]) {
        const key = `${k},${Math.round(sh.x * 10) / 10},${Math.round(sh.z * 10) / 10}`; // same rounding as the strike list
        if (!flights.has(key)) launchPlane(k, sh.x, sh.z, sh.dir, sh.fo, 0, key);
        continue;
      }
      if (k === 'shotdown') { shotDown(sh); continue; }
      // a fighter or ground-attack plane killed by anti-air: removing the unit brings its model down (downPlane);
      // one we never saw still shows falling, the server makes it public
      if (k === 'planedown') { if (!units.has(sh.t)) spare(false, sh.x, sh.z, airAlt, sh.dir ?? 0, 15, sh.to); continue; }
      if (k === 'flak' && sh.t === undefined) { flakAt(sh, from); continue; }
      if (k === 'aa') { antiAir(sh, from, sh.t !== undefined && seen.has(sh.t) ? units.get(sh.t) : null); continue; }
      // every wrecked map cell is a collapse; hedges, wire and trees (they turn to open ground '.') only crunch
      if (k === 'collapse') { collapse(sh.x, sh.z, 4, openCell(s, sh.x, sh.z) ? LIGHT : undefined); continue; }
      if (k === 'smokeshells') { for (let i = 0; i < 3; i++) snd('smoke', i * 0.25, sh.x + rr(-6, 6), sh.z + rr(-6, 6)); continue; }
      if (UNITS[k]) directFire(sh, from, sh.t !== undefined && seen.has(sh.t));
    }
    syncFires(s.fires ?? []); // before the clouds: a new cloud over a new fire is its smoke
    syncClouds(s.smokes ?? []);
    dustTrails(s.units, seen);
  }

  function salvo(sh, from) {
    const mortar = from ? from.type === 'mortar' : sh.n <= 4, n = sh.n ?? 8;
    const w = UNITS[mortar ? 'mortar' : 'rocket'].w, flight = w.flight ?? 1.2, every = w.every ?? 0.15;
    Object.assign(salvos[salvoI++ % salvos.length], { x: sh.x, z: sh.z, r: w.spread ?? 6, mortar, t: clock });
    if (mortar) {
      for (let i = 0; i < n; i++) {
        const d = i * (w.every ?? 0.5);
        if (from) {
          from.root.updateWorldMatrix(true, false);
          v3.set(1.05, 0.87, 0).applyMatrix4(from.root.matrixWorld);
          later(d, E_ROCKET, v3.x, v3.y, v3.z, v3.x + (sh.x - from.x) * 0.15, v3.y + 40, v3.z + (sh.z - from.z) * 0.15, 0.6, 0);
          snd('mortar', d, from.x, from.z);
        }
        whistle(d, flight, sh.x, sh.z, 0.7);
      }
      return;
    }
    if (from) {
      const top = from.turret ?? from.root;
      top.updateWorldMatrix(true, false); v3.setFromMatrixPosition(top.matrixWorld);
      const h = 10 + Math.hypot(sh.x - from.x, sh.z - from.z) * 0.12;
      for (let i = 0; i < n; i++) {
        const a = rand() * TAU, r = Math.sqrt(rand()) * w.spread;
        const ex = sh.x + Math.cos(a) * r, ez = sh.z + Math.sin(a) * r;
        later(i * every, E_ROCKET, v3.x + rr(-0.4, 0.4), v3.y + 1, v3.z + rr(-0.4, 0.4), ex, hAt(ex, ez), ez, flight, h);
      }
      play('rockets', from.x, from.z);
    } else {
      // launcher out of sight: rockets drop in from the sky, from no telltale direction
      for (let i = 0; i < n; i++) {
        const a = rand() * TAU, r = Math.sqrt(rand()) * w.spread, ex = sh.x + Math.cos(a) * r, ez = sh.z + Math.sin(a) * r;
        later(flight + i * every - 0.4, E_ROCKET, ex + rr(-3, 3), hAt(ex, ez) + 30, ez + rr(-3, 3), ex, hAt(ex, ez), ez, 0.4, 0);
      }
      whistle(0, flight, sh.x, sh.z);
    }
  }

  // ---------- per frame ----------
  function update(dt) {
    clock += dt;
    runEvents(dt);
    updatePlanes(dt);
    updateFalls(dt);
    updateRockets(dt);
    updateWrecks(dt);
    updateColumns(dt);
    updateClouds(dt);
    updateFires(dt);
    light();
    simulate(dt);
    updateDecals(dt);
    if (shake > 0.004) {
      camera.position.x += (Math.sin(clock * 71.3) + Math.sin(clock * 43.7)) * 0.5 * shake;
      camera.position.y += Math.sin(clock * 57.9) * 0.5 * shake;
      camera.position.z += (Math.sin(clock * 63.1) + Math.sin(clock * 39.3)) * 0.5 * shake;
      shake *= Math.exp(-dt * 7);
    } else shake = 0;
  }

  function reset() {
    n = 0; shown = 0; evn = 0; shake = 0; geo.instanceCount = 0; pmesh.visible = false;
    for (const d of decals) d.on = false;
    dFade.fill(0); dFadeA.needsUpdate = true;
    for (const r of rockets) r.on = false;
    for (const c of columns) c.on = false;
    for (const s of salvos) s.t = -1e9;
    wrecks.length = 0; clouds.clear(); fires.clear(); flights.clear(); falls.length = 0; // fallen unit models went with the old world
    if (fleet) for (const p of fleet) { p.on = false; p.down = false; p.g.visible = false; }
  }

  // A roof-sized burst from one source. objectives.js owns its cadence and the number of active buildings.
  function plume(kind, x, y, z, radius = 3) {
    const spread = radius * 0.65;
    if (kind !== 'fire') {
      const dark = kind === 'dark', p = dark ? FX.wreckSmoke : FX.smoke;
      for (let i = 0, count = low() ? 1 : 2; i < count; i++) {
        emit(p, x + rr(-0.4, 0.4) * spread, y + rr(0, 0.6), z + rr(-0.4, 0.4) * spread,
          rr(-0.4, 0.4), rr(2.1, 2.8), rr(-0.4, 0.4), radius * (low() ? 0.5 : 0.45), dark ? 4 : 4.5);
      }
      return;
    }
    for (let i = 0, count = low() ? 1 : 3; i < count; i++) {
      emit(FX.flame, x + rr(-spread, spread), y - 0.2, z + rr(-spread, spread), 0, rr(0.1, 0.3), 0, radius * (low() ? 0.42 : 0.36), rr(0.8, 1.1));
    }
  }

  // effects for client/aircraft.js: 'flak' burst (k = size), damage 'smoke' (k = 1 heavy and black), a 'flame' puff,
  // 'strafe' hits along the ground, and the 'crash' fire left where a plane came down
  function air(kind, x, y, z, k = 1) {
    if (kind === 'flak') burst(x, y, z, k);
    else if (kind === 'smoke') emit(k ? FX.airSmokeDark : FX.airSmoke, x + rr(-0.25, 0.25), y + rr(-0.15, 0.15), z + rr(-0.25, 0.25), rr(-0.25, 0.25), rr(0.6, 1.2), rr(-0.25, 0.25), k ? rr(0.55, 0.8) : rr(0.4, 0.6), low() ? 1.1 : rr(1.5, 2.1));
    else if (kind === 'flame') emit(FX.burn, x + rr(-0.2, 0.2), y, z + rr(-0.2, 0.2), 0, 0.8, 0, rr(0.6, 0.8), rr(0.2, 0.3));
    else if (kind === 'strafe') strafeHit(x, z);
    else if (kind === 'crash') burning(x, hAt(x, z) + 0.8, z, 0.9, 10, 24);
  }

  const aaFire = (sh, from, to) => antiAir(sh, from, to, false);
  return { update, snapshot, wreck, downPlane, aaFire, reset, explode, scorch, collapse, plume, air, get count() { return n; }, get shown() { return shown; } };
}
