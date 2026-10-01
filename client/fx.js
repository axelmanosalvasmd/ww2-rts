// Combat effects: muzzle flashes, tracers, explosions sized by weapon, scorch marks, fire and smoke on wrecks,
// smoke screens, dust from collapsing houses, the support planes, flak bursts, planes going down in flames and a very
// small screen shake.
//
// Cost: every particle (flash, fire, smoke, dust, debris, spark, tracer) is one instance of a single billboard mesh
// (one draw call, one shared atlas texture), scorch marks share one decal mesh, and planes come from a small pool.
// Nothing is allocated per shot apart from what is handed to audio.play.
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

const TAU = Math.PI * 2, rand = Math.random, rr = (a, b) => a + (b - a) * rand();
const lin = (hex, k = 1) => { const c = new THREE.Color(hex); return [c.r * k, c.g * k, c.b * k]; };
const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const WIND_X = 0.55, WIND_Z = 0.25; // smoke drifts the same way everywhere

// ---------- textures, drawn once on canvases ----------

// 4x4 atlas of 128 px cells. 0-3 smoke puffs, 4 glow, 5 fireball, 6 tracer streak, 7 debris chunk, 8 dust,
// 9 muzzle star, 10 flame tongue, 11 spark.
function makeAtlas() {
  const S = 128, cv = document.createElement('canvas'); cv.width = cv.height = S * 4;
  const c = cv.getContext('2d');
  let seed = 11; const R = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const blob = (x, y, r, a, stops) => {
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    if (stops) for (const [at, al] of stops) g.addColorStop(at, `rgba(255,255,255,${al * a})`);
    else { g.addColorStop(0, `rgba(255,255,255,${a})`); g.addColorStop(1, 'rgba(255,255,255,0)'); }
    c.fillStyle = g; c.fillRect(x - r, y - r, 2 * r, 2 * r);
  };
  const shade = (top, bottom) => {
    c.globalCompositeOperation = 'source-atop';
    const g = c.createLinearGradient(0, S * 0.12, 0, S * 0.92);
    g.addColorStop(0, top); g.addColorStop(1, bottom);
    c.fillStyle = g; c.fillRect(0, 0, S, S);
    c.globalCompositeOperation = 'source-over';
  };
  const puff = (n, spread, rmin, rmax, a, squash = 0.85) => {
    const h = S / 2;
    for (let i = 0; i < n; i++) {
      const ang = R() * TAU, d = Math.sqrt(R()) * spread * S, r = (rmin + R() * (rmax - rmin)) * S;
      blob(h + Math.cos(ang) * d, h + Math.sin(ang) * d * squash, r, a);
    }
  };
  const cells = [
    () => { puff(34, 0.17, 0.12, 0.3, 0.3); shade('rgba(255,255,255,0)', 'rgba(105,100,95,0.6)'); },
    () => { puff(40, 0.18, 0.1, 0.28, 0.28); shade('rgba(255,255,255,0)', 'rgba(105,100,95,0.6)'); },
    () => { puff(26, 0.15, 0.16, 0.32, 0.32); shade('rgba(255,255,255,0)', 'rgba(105,100,95,0.6)'); },
    () => { puff(46, 0.19, 0.08, 0.26, 0.26); shade('rgba(255,255,255,0)', 'rgba(105,100,95,0.6)'); },
    () => blob(S / 2, S / 2, S / 2, 1, [[0, 1], [0.2, 0.75], [0.5, 0.25], [1, 0]]),
    () => { puff(30, 0.16, 0.1, 0.3, 0.45); blob(S / 2, S / 2, S * 0.28, 0.9); },
    () => {
      for (let y = 0; y < S; y++) { const d = (y - S / 2) / (S * 0.15); c.fillStyle = `rgba(255,255,255,${Math.exp(-d * d)})`; c.fillRect(0, y, S, 1); }
      c.globalCompositeOperation = 'destination-in';
      const g = c.createLinearGradient(0, 0, S, 0);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.7, 'rgba(0,0,0,0.75)'); g.addColorStop(0.93, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g; c.fillRect(0, 0, S, S); c.globalCompositeOperation = 'source-over';
    },
    () => {
      c.fillStyle = '#fff'; c.beginPath();
      for (let i = 0; i < 7; i++) { const a = i / 7 * TAU, r = S * (0.24 + R() * 0.2); c.lineTo(S / 2 + Math.cos(a) * r, S / 2 + Math.sin(a) * r); }
      c.fill();
      c.globalCompositeOperation = 'source-atop'; c.fillStyle = 'rgba(70,70,70,0.55)';
      c.beginPath(); c.moveTo(S / 2, S / 2); c.lineTo(S, S * 0.35); c.lineTo(S, S); c.lineTo(S * 0.25, S); c.fill();
      c.globalCompositeOperation = 'source-over';
    },
    () => { puff(40, 0.2, 0.12, 0.28, 0.2, 0.6); shade('rgba(255,255,255,0)', 'rgba(150,140,125,0.4)'); },
    () => {
      const h = S / 2; blob(h, h, S * 0.3, 0.9);
      c.fillStyle = 'rgba(255,255,255,0.85)';
      for (let i = 0; i < 6; i++) {
        const a = i / 6 * TAU + R() * 0.4, L = S * (0.3 + R() * 0.17), w = 0.16;
        c.beginPath(); c.moveTo(h + Math.cos(a - w) * S * 0.07, h + Math.sin(a - w) * S * 0.07);
        c.lineTo(h + Math.cos(a) * L, h + Math.sin(a) * L); c.lineTo(h + Math.cos(a + w) * S * 0.07, h + Math.sin(a + w) * S * 0.07); c.fill();
      }
      blob(h, h, S * 0.14, 1);
    },
    () => { for (let k = 0; k < 7; k++) blob(S / 2 + (R() - 0.5) * 6, S * (0.7 - k * 0.075), S * (0.24 - k * 0.026), 0.55); blob(S / 2, S * 0.7, S * 0.16, 0.8); },
    () => blob(S / 2, S / 2, S * 0.45, 1, [[0, 1], [0.25, 0.9], [0.5, 0.3], [1, 0]]),
  ];
  cells.forEach((draw, f) => {
    c.save(); c.translate((f % 4) * S, Math.floor(f / 4) * S);
    c.beginPath(); c.rect(0, 0, S, S); c.clip(); draw(); c.restore();
  });
  return new THREE.CanvasTexture(cv);
}

// scorch mark: alpha is how dark the ground gets
function makeScorch() {
  const S = 256, h = S / 2, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const c = cv.getContext('2d');
  let seed = 5; const R = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const g = c.createRadialGradient(h, h, 0, h, h, S * 0.42);
  g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(0.35, 'rgba(255,255,255,0.8)'); g.addColorStop(0.7, 'rgba(255,255,255,0.3)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g; c.fillRect(0, 0, S, S);
  for (let i = 0; i < 22; i++) {
    const a = R() * TAU, L = S * (0.24 + R() * 0.18), w = 0.05 + R() * 0.08;
    c.fillStyle = `rgba(255,255,255,${0.06 + R() * 0.14})`;
    c.beginPath(); c.moveTo(h + Math.cos(a - w) * S * 0.12, h + Math.sin(a - w) * S * 0.12);
    c.lineTo(h + Math.cos(a) * L, h + Math.sin(a) * L); c.lineTo(h + Math.cos(a + w) * S * 0.12, h + Math.sin(a + w) * S * 0.12); c.fill();
  }
  for (let i = 0; i < 70; i++) {
    const a = R() * TAU, d = S * (0.14 + R() * 0.3);
    c.fillStyle = `rgba(255,255,255,${0.12 + R() * 0.3})`;
    c.beginPath(); c.arc(h + Math.cos(a) * d, h + Math.sin(a) * d, 1 + R() * 3, 0, TAU); c.fill();
  }
  c.globalCompositeOperation = 'destination-in';
  const e = c.createRadialGradient(h, h, S * 0.34, h, h, S * 0.5);
  e.addColorStop(0, 'rgba(0,0,0,1)'); e.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = e; c.fillRect(0, 0, S, S);
  return new THREE.CanvasTexture(cv);
}

// ---------- particle presets (constant objects, shared by every emit) ----------
// c0 -> c1 color over life (linear, values above 1 glow), a peak alpha, add 1 = additive light, frame in the atlas
// (frames picks one of n frames), grow = end size / start size, drag pulls velocity toward the wind (times wind),
// grav pulls down (negative rises), pull moves the billboard toward the camera by pull * size so big puffs don't
// cut into the ground, len stretches the billboard along its velocity, fin fade-in share of life, k fade-out curve.
const pre = (o) => ({ c1: null, a: 1, add: 0, frame: 0, frames: 0, grow: 1, rv: 0, drag: 0, wind: 0, grav: 0, pull: 0, len: 0, fin: 0.02, k: 1, floor: 0, norot: 0, ...o, c1: o.c1 ?? o.c0 });
const FX = {
  flash: pre({ c0: [1.7, 1.35, 0.8], c1: [1.0, 0.4, 0.1], add: 1, frame: 4, grow: 1.3, k: 0.6, fin: 0 }),
  star: pre({ c0: [2.2, 1.8, 1.1], c1: [1.6, 0.8, 0.25], add: 1, frame: 9, grow: 1.15, k: 0.8, fin: 0 }),
  fire: pre({ c0: [1.25, 0.6, 0.18], c1: [0.22, 0.06, 0.02], a: 0.95, add: 0.55, frame: 5, grow: 1.6, rv: 1.5, drag: 2.5, grav: -3, k: 1.2, fin: 0.04 }),
  smoke: pre({ c0: lin(0x2a2621), c1: lin(0x6a655d), a: 0.74, frame: 0, frames: 4, grow: 1.9, rv: 0.35, drag: 1.1, wind: 1, grav: -0.9, pull: 0.45, fin: 0.1, k: 1.5 }),
  gunsmoke: pre({ c0: lin(0x8c8880), c1: lin(0xa29e96), a: 0.45, frame: 0, frames: 4, grow: 3, rv: 0.4, drag: 2.5, wind: 1, grav: -0.4, pull: 0.3, fin: 0.06, k: 1.4 }),
  dust: pre({ c0: lin(0x8a7a60), c1: lin(0x9c8f78), a: 0.6, frame: 8, grow: 2.3, rv: 0.3, drag: 2.6, wind: 0.6, grav: -0.25, pull: 0.3, fin: 0.08, k: 1.6 }),
  dirt: pre({ c0: lin(0x4a3c2a), c1: lin(0x6a5a44), a: 0.85, frame: 0, frames: 4, grow: 1.8, rv: 1, drag: 0.6, grav: 13, fin: 0.03, k: 2 }),
  debris: pre({ c0: lin(0x2a241c), a: 1, frame: 7, rv: 9, grav: 22, floor: 1, k: 8, fin: 0 }),
  masonry: pre({ c0: lin(0x7e6a54), a: 1, frame: 7, rv: 7, grav: 22, floor: 1, k: 8, fin: 0 }),
  spark: pre({ c0: [3, 2.2, 1.1], c1: [1.8, 0.45, 0.08], add: 1, frame: 11, grav: 14, drag: 0.8, len: 0.7, k: 1, fin: 0 }),
  ember: pre({ c0: [2.4, 1.1, 0.3], c1: [0.9, 0.15, 0.02], add: 1, frame: 11, grav: -1.6, drag: 0.6, wind: 1, k: 1.2, fin: 0 }),
  flame: pre({ c0: [1.45, 0.72, 0.2], c1: [0.6, 0.12, 0.02], add: 0.8, frame: 10, grow: 0.45, grav: -3.5, drag: 1.2, wind: 0.4, k: 1.3, fin: 0.12, norot: 1 }),
  wreckSmoke: pre({ c0: lin(0x161412), c1: lin(0x55524c), a: 0.72, frame: 0, frames: 4, grow: 3.6, rv: 0.25, drag: 0.6, wind: 1.3, grav: -0.7, pull: 0.45, fin: 0.12, k: 1.6 }),
  screen: pre({ c0: lin(0xbdbcb4), c1: lin(0xcfcec8), a: 0.66, frame: 0, frames: 4, grow: 1.35, rv: 0.06, drag: 0.4, wind: 0.35, grav: -0.04, pull: 0.55, fin: 0.22, k: 2.2 }),
  collapse: pre({ c0: lin(0x9d927e), c1: lin(0xb0a794), a: 0.7, frame: 8, grow: 2.2, rv: 0.2, drag: 0.9, wind: 0.6, grav: -0.15, pull: 0.5, fin: 0.1, k: 1.7 }),
  trail: pre({ c0: lin(0xa8a49c), c1: lin(0xc4c1ba), a: 0.42, frame: 0, frames: 4, grow: 3.5, rv: 0.5, drag: 1.5, wind: 1, grav: -0.3, pull: 0.2, fin: 0.05, k: 1.3 }),
  bomb: pre({ c0: lin(0x24241e), frame: 7, len: 1.1, grav: 0, k: 20, fin: 0 }),
  nade: pre({ c0: lin(0x2a2a22), frame: 7, rv: 10, k: 20, fin: 0 }),
  rocket: pre({ c0: [3.2, 2.2, 1.2], c1: [3, 1.8, 0.8], add: 1, frame: 6, len: 2.6, k: 20, fin: 0 }),
  tracer: pre({ c0: [2.4, 1.6, 0.75], add: 1, frame: 6, len: 2.4, k: 20, fin: 0 }),
  tracerHot: pre({ c0: [3, 2.4, 1.3], add: 1, frame: 6, len: 4.5, k: 20, fin: 0 }),
  tracerFaint: pre({ c0: [1.6, 1.4, 1.0], a: 0.6, add: 1, frame: 6, len: 5, k: 20, fin: 0 }),
};

// direct-fire weapons by shooter type: sound, tracers per shot, burst, speed, width, tracer preset, flash size,
// heavy = explosive shell of that size at the far end
const SMALL = { snd: 'rifle', n: 3, burst: 1, gap: 0, spd: 230, w: 0.13, tr: FX.tracer, flash: 0.32, heavy: 0, smoke: 0 };
const GUNS = {
  rifle: SMALL, conscript: SMALL,
  engineer: { ...SMALL, n: 2 },
  ranger: { ...SMALL, snd: 'smg', burst: 2, gap: 0.07, flash: 0.28 },
  mg: { ...SMALL, snd: 'mg', n: 1, burst: 4, gap: 0.065, spd: 210, w: 0.16, flash: 0.45 },
  bunker: { ...SMALL, snd: 'mg', n: 1, burst: 4, gap: 0.08, spd: 210, w: 0.16, flash: 0.5 },
  sniper: { ...SMALL, snd: 'sniper', n: 1, spd: 420, w: 0.08, tr: FX.tracerFaint, flash: 0.4 },
  at: { ...SMALL, snd: 'atgun', n: 1, spd: 150, w: 0.3, tr: FX.tracerHot, flash: 1.3, heavy: 1.2, smoke: 1 },
  tank: { ...SMALL, snd: 'tankgun', n: 1, spd: 150, w: 0.3, tr: FX.tracerHot, flash: 1.4, heavy: 1.2, smoke: 1 },
  medium: { ...SMALL, snd: 'tankgun', n: 1, spd: 150, w: 0.34, tr: FX.tracerHot, flash: 1.7, heavy: 1.5, smoke: 1 },
  tiger: { ...SMALL, snd: 'tankgun', n: 1, spd: 160, w: 0.38, tr: FX.tracerHot, flash: 2.1, heavy: 1.8, smoke: 1 },
  armoredcar: { ...SMALL, snd: 'tankgun', n: 1, burst: 2, gap: 0.12, spd: 170, w: 0.22, tr: FX.tracerHot, flash: 0.8, heavy: 0.7, smoke: 0.5 },
  // anti-air guns turned on the ground; planes (guns = wing guns firing together)
  flak: { ...SMALL, snd: 'flak', n: 1, burst: 2, gap: 0.1, spd: 240, w: 0.2, tr: FX.tracerHot, flash: 0.6 },
  flaktrack: { ...SMALL, snd: 'flak', n: 1, burst: 4, gap: 0.06, spd: 240, w: 0.2, tr: FX.tracerHot, flash: 0.6 },
  fighter: { ...SMALL, snd: 'mg', n: 2, guns: 2, burst: 4, gap: 0.05, spd: 280, w: 0.16, flash: 0.45 },
  attacker: { ...SMALL, snd: 'rockets', n: 1, spd: 110, w: 0.26, tr: FX.rocket, flash: 0.8, heavy: 1.3 },
};
const BAZOOKA = { ...SMALL, snd: 'atgun', n: 1, spd: 70, w: 0.22, tr: FX.rocket, flash: 0.7, heavy: 1.1, smoke: 1 };
const STYLES = [...new Set([...Object.values(GUNS), BAZOOKA])]; // index <-> style, for delayed events

// where each soldier's weapon ends, in the soldier's local space (+x forward)
const HAND = { rifle: [0.72, 1.1, 0.2], conscript: [0.72, 1.1, 0.2], engineer: [0.6, 1.0, 0.2], ranger: [0.62, 0.9, 0.2], sniper: [1.13, 1.08, 0.2] };
const BAZ = [0.63, 0.93, 0.25];

export function createEffects({ scene, camera, cam, hAt, units, colorOf = () => 0xdddddd, airAlt = 20, mapW = () => 0 }) {
  let clock = 0;
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
  const CAP = 4096, F = 30, S = new Float32Array(CAP * F);
  let n = 0;
  const cap = () => (gfx.low ? 1600 : CAP);
  const iPos = new Float32Array(CAP * 4), iCol = new Float32Array(CAP * 4), iMisc = new Float32Array(CAP * 4), iDir = new Float32Array(CAP * 4);
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  const attrs = [['iPos', iPos], ['iCol', iCol], ['iMisc', iMisc], ['iDir', iDir]].map(([name, arr]) => {
    const a = new THREE.InstancedBufferAttribute(arr, 4); a.setUsage(THREE.DynamicDrawUsage); geo.setAttribute(name, a); return a;
  });
  geo.instanceCount = 0;
  const pmat = new THREE.ShaderMaterial({
    uniforms: { ...THREE.UniformsUtils.merge([THREE.UniformsLib.fog]), map: { value: makeAtlas() } },
    vertexShader: /* glsl */`
      attribute vec4 iPos; attribute vec4 iCol; attribute vec4 iMisc; attribute vec4 iDir;
      varying vec2 vUv; varying vec4 vCol; varying float vAdd;
      #include <fog_pars_vertex>
      void main() {
        vec2 c = position.xy;
        float size = iPos.w;
        vec4 mvPosition = modelViewMatrix * vec4(iPos.xyz, 1.0);
        if (iDir.w > 0.0) {
          // stretched along its motion: tail to head in view space, width across
          vec3 tail = (modelViewMatrix * vec4(iPos.xyz - iDir.xyz * iDir.w, 1.0)).xyz;
          vec2 ax = mvPosition.xy - tail.xy; float l = length(ax);
          ax = l > 1e-4 ? ax / l : vec2(1.0, 0.0);
          mvPosition.xyz = mix(tail, mvPosition.xyz, c.x * 0.5 + 0.5);
          mvPosition.xy += ax * c.x * size + vec2(-ax.y, ax.x) * c.y * size;
        } else {
          float s = sin(iMisc.x), k = cos(iMisc.x);
          if (iMisc.w > 0.0) mvPosition.xyz += normalize(-mvPosition.xyz) * iMisc.w;
          mvPosition.xy += vec2(c.x * k - c.y * s, c.x * s + c.y * k) * size;
        }
        gl_Position = projectionMatrix * mvPosition;
        float f = iMisc.y;
        vUv = (vec2(mod(f, 4.0), 3.0 - floor(f / 4.0)) + (c * 0.49 + 0.5)) / 4.0;
        vCol = iCol; vAdd = iMisc.z;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D map;
      varying vec2 vUv; varying vec4 vCol; varying float vAdd;
      #include <fog_pars_fragment>
      void main() {
        vec4 t = texture2D(map, vUv);
        float a = t.a * vCol.a;
        if (a < 0.004) discard;
        gl_FragColor = vec4(t.rgb * vCol.rgb, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #ifdef USE_FOG
          #ifdef FOG_EXP2
            float fogFactor = 1.0 - exp(- fogDensity * fogDensity * vFogDepth * vFogDepth);
          #else
            float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
          #endif
          gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor * (1.0 - vAdd));
          a *= 1.0 - fogFactor * vAdd;
        #endif
        // premultiplied: additive particles write no alpha, so light and smoke share one blend mode
        gl_FragColor = vec4(gl_FragColor.rgb * a, a * (1.0 - vAdd));
      }`,
    fog: true, transparent: true, depthWrite: false,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  const pmesh = new THREE.Mesh(geo, pmat);
  pmesh.frustumCulled = false; pmesh.renderOrder = 1.5; pmesh.raycast = () => {}; // after the fog overlay, before unit rings
  scene.add(pmesh);

  // field offsets: 0-2 pos, 3-5 vel, 6 age, 7 life, 8 size0, 9 size1, 10-12 color0, 13-15 color1, 16 alpha, 17 additive,
  // 18 frame, 19 rot, 20 spin, 21 drag, 22 grav, 23 pull, 24 len, 25 fade-in, 26 fade curve, 27 floor, 28 wind, 29 group
  function emit(p, x, y, z, vx, vy, vz, size, life) {
    if (n >= cap()) return -1;
    const o = n++ * F;
    S[o] = x; S[o + 1] = y; S[o + 2] = z; S[o + 3] = vx; S[o + 4] = vy; S[o + 5] = vz; S[o + 6] = 0; S[o + 7] = life;
    S[o + 8] = size; S[o + 9] = size * p.grow;
    S[o + 10] = p.c0[0]; S[o + 11] = p.c0[1]; S[o + 12] = p.c0[2]; S[o + 13] = p.c1[0]; S[o + 14] = p.c1[1]; S[o + 15] = p.c1[2];
    S[o + 16] = p.a; S[o + 17] = p.add; S[o + 18] = p.frames ? p.frame + Math.floor(rand() * p.frames) : p.frame;
    S[o + 19] = p.norot ? 0 : rand() * TAU; S[o + 20] = p.rv ? (rand() - 0.5) * 2 * p.rv : 0;
    S[o + 21] = p.drag; S[o + 22] = p.grav; S[o + 23] = p.pull; S[o + 24] = p.len; S[o + 25] = p.fin; S[o + 26] = p.k; S[o + 27] = p.floor; S[o + 28] = p.wind; S[o + 29] = 0;
    return o;
  }
  // tint a just-emitted particle (lighter or darker variation)
  const tint = (o, k) => { if (o >= 0) for (let j = 10; j < 16; j++) S[o + j] *= k; };

  function simulate(dt) {
    let i = 0;
    while (i < n) {
      const o = i * F, age = S[o + 6] + dt, life = S[o + 7];
      if (age >= life) { n--; if (i < n) S.copyWithin(o, n * F, n * F + F); continue; }
      S[o + 6] = age;
      const drag = S[o + 21];
      if (drag > 0) {
        const kk = Math.min(1, drag * dt), wf = S[o + 28];
        S[o + 3] += (WIND_X * wf - S[o + 3]) * kk; S[o + 5] += (WIND_Z * wf - S[o + 5]) * kk; S[o + 4] -= S[o + 4] * kk;
      }
      const g = S[o + 22];
      S[o] += S[o + 3] * dt; S[o + 1] += (S[o + 4] - 0.5 * g * dt) * dt; S[o + 2] += S[o + 5] * dt; S[o + 4] -= g * dt;
      if (S[o + 27] > 0) {
        const gy = hAt(S[o], S[o + 2]) + 0.06;
        if (S[o + 1] < gy) { S[o + 1] = gy; S[o + 4] = S[o + 4] < -3 ? -S[o + 4] * 0.3 : 0; S[o + 3] *= 0.5; S[o + 5] *= 0.5; S[o + 20] *= 0.5; }
      }
      S[o + 19] += S[o + 20] * dt;
      const t = age / life, e = 1 - (1 - t) * (1 - t), fin = S[o + 25];
      const a = S[o + 16] * (fin > 0 ? Math.min(1, t / fin) : 1) * (1 - Math.pow(t, S[o + 26]));
      const q = i * 4;
      iPos[q] = S[o]; iPos[q + 1] = S[o + 1]; iPos[q + 2] = S[o + 2]; iPos[q + 3] = S[o + 8] + (S[o + 9] - S[o + 8]) * e;
      iCol[q] = S[o + 10] + (S[o + 13] - S[o + 10]) * t; iCol[q + 1] = S[o + 11] + (S[o + 14] - S[o + 11]) * t; iCol[q + 2] = S[o + 12] + (S[o + 15] - S[o + 12]) * t; iCol[q + 3] = a;
      iMisc[q] = S[o + 19]; iMisc[q + 1] = S[o + 18]; iMisc[q + 2] = S[o + 17]; iMisc[q + 3] = S[o + 23] * iPos[q + 3];
      const len = S[o + 24];
      if (len > 0) {
        const vx = S[o + 3], vy = S[o + 4], vz = S[o + 5], sp = Math.hypot(vx, vy, vz) || 1;
        iDir[q] = vx / sp; iDir[q + 1] = vy / sp; iDir[q + 2] = vz / sp; iDir[q + 3] = Math.min(len, age * sp + 0.01);
      } else iDir[q + 3] = 0;
      i++;
    }
    geo.instanceCount = n; pmesh.visible = n > 0;
    if (n) for (const a of attrs) { a.clearUpdateRanges(); a.addUpdateRange(0, n * 4); a.needsUpdate = true; }
  }

  // ---------- scorch decals: one mesh of small terrain-hugging grids ----------
  const DG = 5, DV = DG * DG, DCAP = 64;
  const dPos = new Float32Array(DCAP * DV * 3), dUv = new Float32Array(DCAP * DV * 2), dFade = new Float32Array(DCAP * DV), dIdx = [];
  for (let s = 0; s < DCAP; s++) for (let j = 0; j < DG - 1; j++) for (let i = 0; i < DG - 1; i++) {
    const b = s * DV + j * DG + i; dIdx.push(b, b + DG, b + 1, b + 1, b + DG, b + DG + 1);
  }
  for (let s = 0; s < DCAP; s++) for (let j = 0; j < DG; j++) for (let i = 0; i < DG; i++) { const v = s * DV + j * DG + i; dUv[v * 2] = i / (DG - 1); dUv[v * 2 + 1] = j / (DG - 1); }
  const dgeo = new THREE.BufferGeometry();
  const dPosA = new THREE.BufferAttribute(dPos, 3), dFadeA = new THREE.BufferAttribute(dFade, 1);
  dPosA.setUsage(THREE.DynamicDrawUsage); dFadeA.setUsage(THREE.DynamicDrawUsage);
  dgeo.setAttribute('position', dPosA); dgeo.setAttribute('uv', new THREE.BufferAttribute(dUv, 2)); dgeo.setAttribute('aFade', dFadeA); dgeo.setIndex(dIdx);
  const dmat = new THREE.ShaderMaterial({
    uniforms: { ...THREE.UniformsUtils.merge([THREE.UniformsLib.fog]), map: { value: makeScorch() }, tint: { value: new THREE.Vector3(0.22, 0.18, 0.14) } },
    vertexShader: /* glsl */`
      attribute float aFade; varying vec2 vUv; varying float vFade;
      #include <fog_pars_vertex>
      void main() { vUv = uv; vFade = aFade; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D map; uniform vec3 tint; varying vec2 vUv; varying float vFade;
      #include <fog_pars_fragment>
      void main() {
        float a = texture2D(map, vUv).a * vFade;
        vec3 c = mix(vec3(1.0), tint, a);
        #ifdef USE_FOG
          #ifndef FOG_EXP2
            c = mix(c, vec3(1.0), smoothstep(fogNear, fogFar, vFogDepth));
          #endif
        #endif
        gl_FragColor = vec4(c, 1.0); // multiplied into the ground below
      }`,
    fog: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.DstColorFactor, blendDst: THREE.ZeroFactor,
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
  function scorch(x, z, r) {
    const lim = gfx.low ? 24 : DCAP;
    let s = -1, oldest = -1;
    for (let k = 0; k < lim; k++) { if (!decals[k].on) { s = k; break; } if (oldest < 0 || decals[k].age > decals[oldest].age) oldest = k; }
    if (s < 0) s = oldest;
    Object.assign(decals[s], { on: true, x, z, r, rot: rand() * TAU, age: 0, life: gfx.low ? 60 : 150 });
    fitDecal(s); dPosA.needsUpdate = true;
  }
  function updateDecals(dt) {
    let any = false;
    if ((refitT -= dt) <= 0) { refitT = 2; for (let s = 0; s < DCAP; s++) if (decals[s].on) fitDecal(s); dPosA.needsUpdate = true; } // the ground can be dug or bombed
    for (let s = 0; s < DCAP; s++) {
      const d = decals[s];
      if (!d.on) continue;
      d.age += dt;
      if (d.age >= d.life || (gfx.low && s >= 24)) { d.on = false; dFade.fill(0, s * DV, s * DV + DV); any = true; continue; }
      const f = Math.min(1, d.age / 0.3) * Math.min(1, (d.life - d.age) / (d.life * 0.3)) * 0.9;
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
    if (low() || reduceMotion || size < 2.8) return;
    const a = size * 0.05 * Math.max(0, 1 - Math.hypot(x - cam.x, z - cam.z) / 70) * (cam.dist / 60);
    if (a > shake) shake = a;
  }

  // flash, fireball, smoke, dirt, dust ring and debris; size ~ blast radius in meters
  function explode(x, z, size, { decal = true, dirt = true, debris = FX.debris, smokeK = 1, y } = {}) {
    const lo = low(), q = lo ? 0.45 : 1, gy = y ?? hAt(x, z), s = size, rs = Math.sqrt(s);
    const ns = Math.round((3 + s * 1.8) * q * smokeK);
    for (let i = 0; i < ns; i++) {
      const a = rand() * TAU, r = rand() * 0.5 * s;
      tint(emit(FX.smoke, x + Math.cos(a) * r, gy + rr(0.3, 0.9) * s, z + Math.sin(a) * r, Math.cos(a) * rr(0.5, 1.5), rr(1, 2.2) + 0.3 * s, Math.sin(a) * rr(0.5, 1.5), rr(0.36, 0.56) * s, rr(1.8, 3) + 0.35 * s), rr(0.8, 1.2));
    }
    if (dirt) {
      const nd = Math.round((4 + s * 2) * q);
      for (let i = 0; i < nd; i++) {
        const a = rand() * TAU, h = rr(1, 3) * rs;
        emit(FX.dirt, x + Math.cos(a) * 0.3 * s, gy + 0.3, z + Math.sin(a) * 0.3 * s, Math.cos(a) * h, rr(6, 11) * rs, Math.sin(a) * h, rr(0.2, 0.34) * s, rr(0.6, 1.0));
      }
      if (!lo) {
        const nr = Math.round(6 + 2.5 * s);
        for (let i = 0; i < nr; i++) {
          const a = i / nr * TAU + rand() * 0.3, sp = rr(3, 5) + 1.5 * s;
          emit(FX.dust, x + Math.cos(a) * 0.5 * s, gy + 0.35, z + Math.sin(a) * 0.5 * s, Math.cos(a) * sp, rr(0.2, 0.8), Math.sin(a) * sp, rr(0.35, 0.55) * s, rr(1.0, 1.8));
        }
      }
    }
    if (debris) {
      const nb = Math.round((3 + 2.5 * s) * q);
      for (let i = 0; i < nb; i++) {
        const a = rand() * TAU, h = rr(1.5, 4) * rs * 0.6;
        emit(debris, x, gy + 0.4 * s, z, Math.cos(a) * h, rr(5, 9) * rs * 0.6, Math.sin(a) * h, rr(0.06, 0.15) * Math.min(2, rs), rr(1.3, 2.4));
      }
    }
    // fire and flash last so they draw over the dirt and smoke
    const nf = Math.round((2 + s * 1.3) * q);
    for (let i = 0; i < nf; i++) {
      const a = rand() * TAU, r = rand() * 0.45 * s;
      emit(FX.fire, x + Math.cos(a) * r, gy + rr(0.2, 0.7) * s, z + Math.sin(a) * r, Math.cos(a) * rr(1, 2.5) * rs, rr(1, 3) * rs, Math.sin(a) * rr(1, 2.5) * rs, rr(0.32, 0.5) * s, rr(0.28, 0.42) + 0.04 * s);
    }
    emit(FX.flash, x, gy + 0.5 * s, z, 0, 0, 0, 1.2 * s, 0.12 + 0.02 * s);
    if (!lo) {
      const nk = Math.round(2 + s * 1.5);
      for (let i = 0; i < nk; i++) { const a = rand() * TAU, h = rr(4, 9); emit(FX.spark, x, gy + 0.5 * s, z, Math.cos(a) * h, rr(5, 12), Math.sin(a) * h, 0.07, rr(0.4, 0.8)); }
    }
    if (decal) scorch(x, z, Math.min(6.5, 0.75 * s + 0.5));
    kick(x, z, s);
  }

  function muzzle(x, y, z, dx, dz, s, smoke) {
    emit(FX.star, x, y, z, 0, 0, 0, s, 0.05 + 0.02 * s);
    emit(FX.flash, x + dx * s * 0.6, y, z + dz * s * 0.6, dx * 3, 0, dz * 3, s * 1.1, 0.05 + 0.025 * s);
    if (smoke && !low()) {
      for (let i = 0; i < 3 + 2 * smoke; i++) emit(FX.gunsmoke, x + dx * rr(0.2, 1.2) * s, y + rr(-0.1, 0.2), z + dz * rr(0.2, 1.2) * s, dx * rr(2, 5) + rr(-1, 1), rr(0.2, 0.8), dz * rr(2, 5) + rr(-1, 1), 0.45 * s, rr(1.2, 2));
      const gy = hAt(x + dx * 2, z + dz * 2);
      for (let i = 0; i < 4; i++) { const a = rand() * TAU; emit(FX.dust, x + dx * 2, gy + 0.3, z + dz * 2, Math.cos(a) * 2.5 + dx * 2, 0.4, Math.sin(a) * 2.5 + dz * 2, 0.5 * s, rr(0.9, 1.4)); }
    }
  }

  // one round leaving the gun: flash at the muzzle, a glowing streak to the end point, impact on arrival
  function shotTracer(x, y, z, ex, ey, ez, st, flags) {
    const dx = ex - x, dy = ey - y, dz = ez - z, d = Math.hypot(dx, dy, dz) || 1, hd = Math.hypot(dx, dz) || 1, T = d / st.spd;
    muzzle(x, y, z, dx / hd, dz / hd, st.flash, st.smoke);
    if (st === BAZOOKA) emit(FX.gunsmoke, x - dx / hd * 1.3, y + 0.3, z - dz / hd * 1.3, -dx / hd * 4, 0.5, -dz / hd * 4, 0.6, 1.4); // back-blast
    emit(st.tr, x, y, z, dx / T, dy / T, dz / T, st.w, T);
    later(T, E_IMPACT, ex, ey, ez, STYLES.indexOf(st), flags);
  }

  // a round fired into the sky: flash and streak only, nothing lands
  function skyShot(x, y, z, ex, ey, ez, st) {
    const dx = ex - x, dy = ey - y, dz = ez - z, d = Math.hypot(dx, dy, dz) || 1, hd = Math.hypot(dx, dz) || 1, T = d / st.spd;
    muzzle(x, y, z, dx / hd, dz / hd, st.flash, 0);
    emit(st.tr, x, y, z, dx / T, dy / T, dz / T, st.w, T);
  }
  // a flak shell bursting in the air: a flash, a few sparks and a black puff that hangs and drifts
  function burst(x, y, z, s = 1) {
    const lo = low();
    emit(FX.flash, x, y, z, 0, 0, 0, 1.3 * s, 0.1);
    for (let i = 0; i < (lo ? 2 : 4); i++) tint(emit(FX.smoke, x + rr(-0.4, 0.4) * s, y + rr(-0.3, 0.3) * s, z + rr(-0.4, 0.4) * s, rr(-0.6, 0.6), rr(-0.2, 0.4), rr(-0.6, 0.6), rr(0.5, 0.8) * s, rr(1.4, 2.2)), 0.6);
    if (!lo) for (let i = 0; i < 3; i++) { const a = rand() * TAU, h = rr(3, 7); emit(FX.spark, x, y, z, Math.cos(a) * h, rr(-2, 4), Math.sin(a) * h, 0.06, rr(0.25, 0.5)); }
  }

  // flags: 1 hit, 2 vehicle target, 4 structure target
  function impact(x, y, z, st, flags) {
    const hit = flags & 1, veh = flags & 2, gy = hAt(x, z);
    if (st.heavy) {
      if (veh && hit) {
        emit(FX.flash, x, y, z, 0, 0, 0, 1.2 * st.heavy, 0.12);
        for (let i = 0; i < (low() ? 3 : 8); i++) { const a = rand() * TAU, h = rr(3, 8); emit(FX.spark, x, y, z, Math.cos(a) * h, rr(2, 8), Math.sin(a) * h, 0.08, rr(0.3, 0.7)); }
        for (let i = 0; i < 3; i++) emit(FX.smoke, x + rr(-0.4, 0.4), y + rr(0, 0.5), z + rr(-0.4, 0.4), rr(-0.5, 0.5), rr(1, 2), rr(-0.5, 0.5), 0.6 * st.heavy, rr(1.5, 2.5));
        play('blast_small', x, z);
      } else {
        explode(x, z, st.heavy * (hit ? 1.25 : 1), { debris: flags & 4 ? FX.masonry : FX.debris, smokeK: 0.7 });
        play('blast_small', x, z);
      }
      return;
    }
    if (veh && hit) {
      for (let i = 0; i < (low() ? 1 : 3); i++) { const a = rand() * TAU, h = rr(3, 7); emit(FX.spark, x, y, z, Math.cos(a) * h, rr(1, 5), Math.sin(a) * h, 0.05, rr(0.2, 0.4)); }
      play('ricochet', x, z, 0.3);
    } else {
      // bullets kicking up the ground around the target
      const k = low() ? 1 : 2;
      for (let i = 0; i < k; i++) emit(FX.dust, x + rr(-0.4, 0.4), gy + 0.25, z + rr(-0.4, 0.4), rr(-0.6, 0.6), rr(1.5, 3), rr(-0.6, 0.6), rr(0.18, 0.3), rr(0.5, 0.9));
      if (!low()) emit(FX.dirt, x, gy + 0.2, z, rr(-1, 1), rr(3, 5), rr(-1, 1), 0.12, 0.45);
    }
  }

  // rocket with a smoke trail on an arc; impacts come from the server separately
  const rockets = Array.from({ length: 48 }, () => ({ on: false }));
  function launchRocket(x0, y0, z0, x1, y1, z1, T, h) {
    const r = rockets.find(q => !q.on);
    if (!r) return;
    const g = h > 0 ? 8 * h / (T * T) : 0;
    Object.assign(r, { on: true, x0, y0, z0, vx: (x1 - x0) / T, vy: (y1 - y0 + 0.5 * g * T * T) / T, vz: (z1 - z0) / T, g, t: 0, T, acc: 0 });
    const o = emit(FX.rocket, x0, y0, z0, r.vx, r.vy, r.vz, 0.3, T * 0.97);
    if (o >= 0) S[o + 22] = g;
    emit(FX.flash, x0, y0, z0, 0, 0, 0, 0.9, 0.1);
    if (!low()) emit(FX.gunsmoke, x0 - r.vx * 0.03, y0, z0 - r.vz * 0.03, -r.vx * 0.05, 0.5, -r.vz * 0.05, 0.6, 1.5);
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
        emit(FX.trail, r.x0 + r.vx * t, r.y0 + r.vy * t - 0.5 * r.g * t * t, r.z0 + r.vz * t, 0, 0.3, 0, 0.22, rr(1, 1.6));
      }
    }
  }

  // ---------- shooters ----------
  const DIRT_IDX = STYLES.indexOf(SMALL);
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
        const ex = sh.x + rr(-0.5, 0.5) * spread, ez = sh.z + rr(-0.5, 0.5) * spread, ey = hAt(ex, ez) + (sh.hit ? ty : 0.1);
        later(t0 + b * st.gap, E_TRACER, mx, my, mz, ex, ey, ez, sti, flags & (b === 0 ? 7 : 6));
      }
    }
  }

  // ---------- smoke screens ----------
  const clouds = new Map();
  let cloudId = 0;
  function puffCloud(c, burst) {
    const lo = low(), r = c.r, a = rand() * TAU, d = Math.sqrt(rand()) * r * 0.78, size = r * (lo ? rr(0.62, 0.75) : rr(0.46, 0.6));
    const x = c.x + Math.cos(a) * d, z = c.z + Math.sin(a) * d, y = hAt(x, z) + size * 0.42 + rand() * r * 0.12;
    const out = burst ? rr(1.5, 3.5) : 0.25;
    const o = emit(FX.screen, x, y, z, Math.cos(a) * out, rr(0.05, 0.25), Math.sin(a) * out, burst ? size * 0.55 : size, burst ? rr(4, 8) : rr(5.5, 7.5));
    if (o < 0) return;
    S[o + 29] = c.id; tint(o, rr(0.9, 1.06));
    if (burst) { S[o + 9] = size * 1.35; S[o + 21] = 1.2; }
    if (lo) S[o + 20] = 0;
  }
  function syncClouds(list) {
    for (const c of clouds.values()) c.keep = false;
    for (const [x, z, r] of list) {
      const key = x * 100003 + z;
      let c = clouds.get(key);
      if (!c) {
        c = { id: ++cloudId, x, z, r, acc: 0, keep: true };
        clouds.set(key, c);
        const lo = low(), burst = Math.round((lo ? 7 : 16) * (r / 7) ** 2);
        for (let i = 0; i < burst; i++) puffCloud(c, true);
        for (let i = 0; i < (lo ? 2 : 5); i++) emit(FX.flash, x + rr(-2, 2), hAt(x, z) + 1, z + rr(-2, 2), 0, 0, 0, 1.4, 0.12);
        play('smoke', x, z, 0.15);
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
  function updateClouds(dt) {
    const lo = low();
    for (const c of clouds.values()) {
      const target = (lo ? 9 : 24) * (c.r / 7) ** 2, life = 6.5;
      c.acc += dt * target / life;
      while (c.acc >= 1) { c.acc -= 1; puffCloud(c, false); }
    }
  }

  // ---------- wrecks ----------
  const wrecks = [];
  function wreck(v) {
    const def = UNITS[v.type], gy = hAt(v.x, v.z);
    if (def?.structure) {
      collapse(v.x, v.z, def.size ? def.size * 2.5 : 4);
      wrecks.push({ x: v.x, y: gy + 1, z: v.z, t: 0, fire: 8, dur: 30, fa: 0, sa: 0, big: 1.4 });
      return;
    }
    const big = v.type === 'tiger' ? 1.3 : v.type === 'medium' ? 1.15 : 1;
    explode(v.x, v.z, 3 * big);
    wrecks.push({ x: v.x, y: gy + 1.4 * big, z: v.z, t: 0, fire: 20, dur: 38, fa: 0, sa: 0, big });
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
      const smokeK = 1 - 0.7 * (w.t / w.dur);
      w.fa += dt * fireK * (lo ? 6 : 14);
      w.sa += dt * smokeK * (lo ? 2.5 : 5.5);
      while (w.fa >= 1) {
        w.fa -= 1;
        emit(FX.flame, w.x + rr(-0.8, 0.8) * w.big, w.y + rr(-0.3, 0.3), w.z + rr(-0.8, 0.8) * w.big, 0, rr(1, 2), 0, rr(0.8, 1.3) * w.big, rr(0.5, 0.9));
        if (!lo && rand() < 0.12) emit(FX.ember, w.x + rr(-0.5, 0.5), w.y + 0.8, w.z + rr(-0.5, 0.5), rr(-1, 1), rr(2, 4), rr(-1, 1), 0.06, rr(1, 2));
      }
      while (w.sa >= 1) {
        w.sa -= 1;
        tint(emit(FX.wreckSmoke, w.x + rr(-0.6, 0.6), w.y + 1 + rand(), w.z + rr(-0.6, 0.6), rr(-0.3, 0.3), rr(1.8, 2.8), rr(-0.3, 0.3), rr(0.9, 1.3) * w.big, rr(3.5, 5.5)), 0.8 + 0.6 * (1 - fireK));
      }
    }
  }

  function collapse(x, z, r = 4, sndOpts) {
    const lo = low(), q = lo ? 0.45 : 1, gy = hAt(x, z);
    for (let i = 0; i < Math.round(16 * q); i++) {
      const a = rand() * TAU, d = rand() * r;
      emit(FX.collapse, x + Math.cos(a) * d, gy + rr(1, 3.5), z + Math.sin(a) * d, Math.cos(a) * rr(1, 3), rr(0.4, 1.2), Math.sin(a) * rr(1, 3), rr(1.6, 2.6), rr(3, 5.5));
    }
    for (let i = 0; i < Math.round(12 * q); i++) {
      const a = i / 12 * TAU, sp = rr(4, 7);
      emit(FX.collapse, x + Math.cos(a) * r * 0.7, gy + 0.6, z + Math.sin(a) * r * 0.7, Math.cos(a) * sp, 0.3, Math.sin(a) * sp, rr(1, 1.6), rr(2, 3.5));
    }
    for (let i = 0; i < Math.round(16 * q); i++) {
      const a = rand() * TAU, h = rr(1.5, 5);
      emit(FX.masonry, x + rr(-r, r) * 0.5, gy + rr(2, 5), z + rr(-r, r) * 0.5, Math.cos(a) * h, rr(3, 8), Math.sin(a) * h, rr(0.15, 0.35), rr(1.5, 2.6));
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
        explode(f.x, f.z, 3.6, { smokeK: 1.2 });
        wrecks.push({ x: f.x, y: gy + 0.8, z: f.z, t: 0, fire: 10, dur: 24, fa: 0, sa: 0, big: 0.9 });
        play('vehicle_destroyed', f.x, f.z); play('fire_loop', f.x, f.z, 0, { delay: 0.5, dur: 9 });
        f.done();
        continue;
      }
      f.obj.position.set(f.x, f.y, f.z);
      f.obj.rotation.set(f.t * f.roll, -f.dir, -Math.min(1.1, Math.atan2(-f.vy, f.sp)));
      for (f.acc += dt; f.acc >= every; f.acc -= every) {
        tint(emit(FX.wreckSmoke, f.x - f.dx * 1.5, f.y, f.z - f.dz * 1.5, rr(-0.3, 0.3), rr(0.3, 0.9), rr(-0.3, 0.3), rr(0.5, 0.8), rr(2.2, 3.4)), 0.8);
        emit(FX.flame, f.x + rr(-0.4, 0.4), f.y + rr(-0.2, 0.3), f.z + rr(-0.4, 0.4), 0, rr(0.5, 1.5), 0, rr(0.6, 1.0), rr(0.25, 0.4));
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
        const o = emit(FX.nade, from.x, gy + 1.5, from.z, (sh.x - from.x) / T, (ty - gy - 1.5 + 0.5 * G * T * T) / T, (sh.z - from.z) / T, satchel ? 0.3 : 0.2, T);
        if (o >= 0) S[o + 22] = G;
        continue;
      }
      if (k === 'boom') {
        const th = throws.find(q => clock - q.t < 6 && Math.abs(q.x - sh.x) < 0.5 && Math.abs(q.z - sh.z) < 0.5);
        explode(sh.x, sh.z, th?.satchel ? 3.4 : 2.3, { debris: th?.satchel ? FX.masonry : FX.debris });
        play(th?.satchel ? 'blast_large' : 'blast_small', sh.x, sh.z);
        continue;
      }
      if (k === 'shell') { explode(sh.x, sh.z, 3.2); play('blast_large', sh.x, sh.z); continue; }
      if (k === 'rocket') { explode(sh.x, sh.z, 2.3); play('blast_small', sh.x, sh.z, 0, ROCKET); continue; }
      if (k === 'bomb') { explode(sh.x, sh.z, 5.2, { smokeK: 1.3 }); play('bomb', sh.x, sh.z); continue; }
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
    syncClouds(s.smokes ?? []);
  }

  function salvo(sh, from) {
    const mortar = from ? from.type === 'mortar' : sh.n <= 4, n = sh.n ?? 8;
    const w = UNITS[mortar ? 'mortar' : 'rocket'].w, flight = w.flight ?? 1.2, every = w.every ?? 0.15;
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
    updateClouds(dt);
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
    n = 0; evn = 0; shake = 0; geo.instanceCount = 0; pmesh.visible = false;
    for (const d of decals) d.on = false;
    dFade.fill(0); dFadeA.needsUpdate = true;
    for (const r of rockets) r.on = false;
    wrecks.length = 0; clouds.clear(); flights.clear(); falls.length = 0; // fallen unit models went with the old world
    if (fleet) for (const p of fleet) { p.on = false; p.down = false; p.g.visible = false; }
  }

  // A roof-sized burst from one source. objectives.js owns its cadence and the number of active buildings.
  function plume(kind, x, y, z, radius = 3) {
    const spread = radius * 0.65;
    if (kind !== 'fire') {
      const dark = kind === 'dark', p = dark ? FX.wreckSmoke : FX.smoke;
      for (let i = 0, count = low() ? 1 : 2; i < count; i++) {
        emit(p, x + rr(-0.4, 0.4) * spread, y + rr(0, 0.6), z + rr(-0.4, 0.4) * spread,
          rr(-0.4, 0.4), rr(2.1, 2.8), rr(-0.4, 0.4), radius * (low() ? 0.78 : 0.72), dark ? 3 : 3.3);
      }
      return;
    }
    for (let i = 0, count = low() ? 2 : 4; i < count; i++) {
      emit(FX.flame, x + rr(-spread, spread), y + rr(0.2, 0.5), z + rr(-spread, spread),
        rr(-0.3, 0.3), rr(1.2, 1.8), rr(-0.3, 0.3), radius * (low() ? 0.64 : 0.55), rr(0.7, 0.95));
    }
    emit(FX.fire, x + rr(-0.3, 0.3) * spread, y + 0.6, z + rr(-0.3, 0.3) * spread,
      0, 1.5, 0, radius * 0.58, 0.7);
  }

  const aaFire = (sh, from, to) => antiAir(sh, from, to, false);
  return { update, snapshot, wreck, downPlane, aaFire, reset, explode, scorch, collapse, plume, get count() { return n; } };
}
