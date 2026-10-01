// Atmosphere: a mood per map (sun height and color, sky fill, haze, river mist, falling snow or blowing dust), slow
// cloud shadows drifting over the board and table, the planning-table props around the board, and a few birds
// circling high above it. main.js calls createAtmosphere() once, start() from startGame and update(dt) every frame.
//
// Cost in draw calls: cloud shade 2 (board and table), props 1 (plus 1 in the shadow pass), lamp light pool 1,
// river mist 1 (dawn maps), snow or dust 1 (those maps), birds 1. Graphics Low turns off the cloud shade, the weather
// and the birds, keeps the props, the lamp pool and fewer mist sheets.
//
// Fog of war: everything over the board is transparent, writes no depth and draws before the fog overlay
// (renderOrder 1 in main.js), so unseen ground darkens the cloud shade, mist, flakes and birds like the terrain they
// cover. Props stand on the table outside the board, low enough that they never hide a cell, a unit or a marker.
import * as THREE from 'three';
import { gfx } from './gfx.js';
import { sky, BOARD } from './light.js';

const TAU = Math.PI * 2;
const WL = Math.hypot(0.55, 0.25), WX = 0.55 / WL, WZ = 0.25 / WL; // the way smoke drifts in fx.js
const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const seeded = (s) => () => (s = (s * 16807) % 2147483647) / 2147483647;

// ---------- moods ----------

// sunUp: sun height in degrees. sun, top, bottom (sky fill), haze: colors. hazeK > 1 pulls the haze closer.
// shadow: how dark sun shadows get (1 = full). soft: wider shadow blur on High. clouds: cloud shade strength.
// lamp: strength of the desk lamp's pool of light. mist: sheets over rivers. weather: 'snow' or 'dust'.
export const MOODS = {
  warm: { sunUp: 37, sun: 0xffd6a8, sunI: 3.2, top: 0xc9d6e4, bottom: 0x5a4a32, hemiI: 0.9, haze: 0xbcae96, hazeK: 1, shadow: 1, soft: 1, clouds: 0.2, lamp: 0.2 },
  dawn: { sunUp: 21, sun: 0xffc690, sunI: 3.6, top: 0xccd3dd, bottom: 0x5e5040, hemiI: 1.15, haze: 0xcfc8ba, hazeK: 1.35, shadow: 0.85, soft: 1.5, clouds: 0.07, lamp: 0.3, mist: true },
  overcast: { sunUp: 52, sun: 0xe9e6dc, sunI: 1.7, top: 0xc3cad1, bottom: 0x5b554b, hemiI: 1.5, haze: 0xa8aba5, hazeK: 1.25, shadow: 0.55, soft: 2.6, clouds: 0.1, lamp: 0.32 },
  snow: { sunUp: 30, sun: 0xeef0f5, sunI: 1.9, top: 0xd2dae4, bottom: 0x67645e, hemiI: 1.45, haze: 0xb9bfc5, hazeK: 1.4, shadow: 0.6, soft: 2.2, clouds: 0.08, lamp: 0.32, weather: 'snow' },
  dust: { sunUp: 48, sun: 0xffe1ad, sunI: 3.3, top: 0xd5cdb9, bottom: 0x6b5536, hemiI: 0.95, haze: 0xd0b78f, hazeK: 1.3, shadow: 1, soft: 1.2, clouds: 0.12, lamp: 0.18, weather: 'dust' },
};
const RULES = [
  ['snow', /ardennes|bastogne|bulge|winter|snow/i],
  ['dust', /kasserine|desert|tobruk|alamein|africa|tunis/i],
  ['dawn', /pegasus|polder|river|canal|marsh/i],
  ['overcast', /bocage|cassino|stalingrad|seawall|rain|storm/i],
];
// ?mood=snow in the URL or a "mood" field in the map file wins; otherwise the map's name picks; warm by default
export function moodFor(map, key) {
  const pick = new URLSearchParams(location.search).get('mood') || map?.mood;
  if (MOODS[pick]) return pick;
  const text = `${map?.name ?? ''} ${key ?? ''}`;
  return RULES.find(([, re]) => re.test(text))?.[0] ?? 'warm';
}

// ---------- shared shader bits ----------

const fogUniforms = () => THREE.UniformsUtils.clone(THREE.UniformsLib.fog);
const FOG_FADE = /* glsl */`
  #ifdef USE_FOG
    float fogF = smoothstep( fogNear, fogFar, vFogDepth );
  #else
    float fogF = 0.0;
  #endif`;
const OUT = /* glsl */`
  #include <tonemapping_fragment>
  #include <colorspace_fragment>`;

// ---------- cloud shade ----------

// 128 px tileable value noise (four octaves), so the cloud pattern repeats seamlessly as it drifts
function noiseTexture() {
  const N = 128, data = new Uint8Array(N * N * 4), rnd = seeded(77);
  const octave = (g) => {
    const v = Float32Array.from({ length: g * g }, rnd), at = (i, j) => v[(j % g) * g + (i % g)], s = (t) => t * t * (3 - 2 * t);
    return (x, y) => {
      const fx = (x / N) * g, fy = (y / N) * g, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = s(fx - x0), ty = s(fy - y0);
      return (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty;
    };
  };
  const oct = [[4, 0.5], [8, 0.27], [16, 0.15], [32, 0.08]].map(([g, w]) => [octave(g), w]);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let n = 0;
    for (const [f, w] of oct) n += f(x, y) * w;
    data.fill(Math.round(n * 255), (y * N + x) * 4, (y * N + x) * 4 + 4);
  }
  const t = new THREE.DataTexture(data, N, N);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

const CLOUD_SCALE = 260, CLOUD_SPEED = 2.2; // meters per noise tile, meters per second
function cloudMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...fogUniforms(), tNoise: { value: noiseTexture() }, drift: { value: new THREE.Vector4() },
      strength: { value: 0.15 }, tint: { value: new THREE.Color(0x1c2230) }, fade: { value: new THREE.Vector4(0, 0, 1e4, 2e4) },
    },
    vertexShader: /* glsl */`
      #include <common>
      #include <fog_pars_vertex>
      varying vec2 vXZ;
      void main() {
        vec4 wp = modelMatrix * vec4( position, 1.0 );
        vXZ = wp.xz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D tNoise;
      uniform vec4 drift, fade;
      uniform float strength;
      uniform vec3 tint;
      varying vec2 vXZ;
      #include <common>
      #include <fog_pars_fragment>
      void main() {
        float a = texture2D( tNoise, vXZ / ${CLOUD_SCALE.toFixed(1)} + drift.xy ).r;
        float b = texture2D( tNoise, vXZ / ${(CLOUD_SCALE * 0.53).toFixed(1)} + drift.zw ).r;
        float cover = smoothstep( 0.5, 0.64, a * 0.72 + b * 0.28 );
        ${FOG_FADE}
        float alpha = cover * strength * ( 1.0 - smoothstep( fade.z, fade.w, length( vXZ - fade.xy ) ) ) * ( 1.0 - fogF );
        gl_FragColor = vec4( tint, alpha );
        ${OUT}
      }`,
    transparent: true, depthWrite: false, fog: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  });
}

// ---------- river mist ----------

function wispTexture() {
  const W = 128, H = 64, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const c = cv.getContext('2d'), rnd = seeded(31);
  for (let i = 0; i < 26; i++) {
    const x = W * (0.2 + rnd() * 0.6), y = H * (0.3 + rnd() * 0.4), r = H * (0.16 + rnd() * 0.18);
    const g = c.createRadialGradient(0, 0, 0, 0, 0, r);
    g.addColorStop(0, 'rgba(255,255,255,0.22)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    c.save(); c.translate(x, y); c.scale(2.2, 1); c.fillStyle = g; c.fillRect(-r, -r, 2 * r, 2 * r); c.restore();
  }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// sheets over water cells, spaced out, kept off fords and bridges (where units cross); low ground if there is no water
function mistSites(map, cell, hAt, cap) {
  const water = [], cross = [], low = [], rnd = seeded(4021);
  map.rows.forEach((row, y) => [...row].forEach((ch, x) => {
    const p = { x: (x + 0.5) * cell, z: (y + 0.5) * cell };
    if (ch === 'W') water.push(p); else if (ch === 'F' || ch === '=') cross.push(p);
    else if (hAt(p.x, p.z) < -0.5) low.push(p);
  }));
  const cand = water.length ? water : low;
  for (let i = cand.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [cand[i], cand[j]] = [cand[j], cand[i]]; }
  const out = [], near = (a, b, r) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2 < r * r;
  for (const p of cand) {
    if (out.length >= cap) break;
    if (out.some(s => near(s, p, 14)) || cross.some(s => near(s, p, 12))) continue;
    const yaw = (water.length ? flowAngle(water, p, cell * 4) : rnd() * Math.PI) + (rnd() - 0.5) * 0.3;
    out.push({ ...p, y: hAt(p.x, p.z) + 0.35, yaw, sx: 15 + rnd() * 8, sz: 7 + rnd() * 4, ph: rnd() * TAU });
  }
  return out;
}

// the yaw that lays a sheet's long side along the river: the main axis of the water cells around p
function flowAngle(water, p, r) {
  let n = 0, xx = 0, zz = 0, xz = 0;
  for (const w of water) {
    const dx = w.x - p.x, dz = w.z - p.z;
    if (dx * dx + dz * dz > r * r) continue;
    n++; xx += dx * dx; zz += dz * dz; xz += dx * dz;
  }
  return n < 3 ? 0 : -0.5 * Math.atan2(2 * xz, xx - zz);
}

// ---------- snow and dust ----------

// Points live in a world-space box that follows the camera target; each one wraps around inside the box, so panning
// never moves the flakes already on screen. They fade toward the box edges, near the camera and in the haze.
function weatherPoints(kind) {
  const snow = kind === 'snow', n = snow ? 2600 : 800, rnd = seeded(snow ? 5 : 9);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(Float32Array.from({ length: n * 3 }, rnd), 3));
  geo.setAttribute('aRand', new THREE.Float32BufferAttribute(Float32Array.from({ length: n * 4 }, rnd), 4));
  const u = {
    ...fogUniforms(), uTime: { value: 0 }, uScale: { value: 1000 }, uAlpha: { value: snow ? 0.9 : 0.13 },
    uSway: { value: snow ? 0.7 : 1.2 }, uBoxMin: { value: new THREE.Vector3() },
    uBox: { value: snow ? new THREE.Vector3(200, 60, 200) : new THREE.Vector3(220, 9, 220) },
    uVel: { value: snow ? new THREE.Vector3(WX * 1.4, -2.0, WZ * 1.4) : new THREE.Vector3(WX * 7, 0.25, WZ * 7) },
    uSizeM: { value: snow ? new THREE.Vector2(0.16, 0.3) : new THREE.Vector2(1.4, 3.2) },
    uPx: { value: new THREE.Vector2() }, uPxMax: { value: snow ? 5 : 30 },
    uFade: { value: new THREE.Vector4(0, 0, snow ? 55 : 50, snow ? 98 : 100) },
    uColor: { value: new THREE.Color(snow ? 0xf7f8fb : 0xcaa879) },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: u, transparent: true, depthWrite: false, fog: true,
    vertexShader: /* glsl */`
      uniform float uTime, uScale, uSway, uAlpha;
      uniform vec3 uBoxMin, uBox, uVel;
      uniform vec2 uSizeM, uPx;
      uniform vec4 uFade;
      attribute vec4 aRand;
      varying float vAlpha;
      #include <common>
      #include <fog_pars_vertex>
      void main() {
        vec3 p = position * uBox + uVel * uTime * ( 0.75 + 0.5 * aRand.x );
        p.x += sin( uTime * ( 0.5 + aRand.y ) + aRand.z * 6.283 ) * uSway;
        p.z += cos( uTime * ( 0.4 + aRand.x ) + aRand.w * 6.283 ) * uSway;
        vec3 local = mod( p - uBoxMin, uBox );
        vec3 wp = uBoxMin + local;
        vec4 mvPosition = viewMatrix * vec4( wp, 1.0 );
        gl_Position = projectionMatrix * mvPosition;
        float h = local.y / uBox.y;
        vAlpha = uAlpha * smoothstep( 0.0, 0.12, h ) * ( 1.0 - smoothstep( 0.8, 1.0, h ) )
          * ( 1.0 - smoothstep( uFade.z, uFade.w, length( wp.xz - uFade.xy ) ) )
          * smoothstep( 4.0, 14.0, -mvPosition.z );
        gl_PointSize = clamp( mix( uSizeM.x, uSizeM.y, aRand.w ) * uScale / -mvPosition.z, uPx.x, uPx.y );
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor;
      varying float vAlpha;
      #include <common>
      #include <fog_pars_fragment>
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float a = vAlpha * ( 1.0 - smoothstep( 0.06, 0.25, dot( c, c ) ) );
        if ( a < 0.01 ) discard;
        ${FOG_FADE}
        gl_FragColor = vec4( mix( uColor, fogColor, fogF ), a * ( 1.0 - 0.6 * fogF ) );
        ${OUT}
      }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false; pts.renderOrder = 0.8; pts.raycast = () => {};
  pts.userData.kind = kind;
  return pts;
}

// ---------- birds ----------

function birdMesh(n) {
  // a thin body and two wings in two panels each; the vertex shader flaps the wings by |x|
  const v = [
    0, 0, 0.55, -0.09, 0, 0.05, 0, 0, -0.42, 0, 0, 0.55, 0, 0, -0.42, 0.09, 0, 0.05,
    0, 0, -0.38, -0.16, 0, -0.62, 0.16, 0, -0.62,
    -0.07, 0, 0.16, -0.07, 0, -0.14, -0.42, 0, 0.1, -0.42, 0, 0.1, -0.07, 0, -0.14, -0.8, 0, -0.16,
    0.07, 0, 0.16, 0.42, 0, 0.1, 0.07, 0, -0.14, 0.42, 0, 0.1, 0.8, 0, -0.16, 0.07, 0, -0.14,
  ];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(Float32Array.from({ length: n }, seeded(123)), 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...fogUniforms(), uTime: { value: 0 }, uColor: { value: new THREE.Color(0x2b2622) } },
    side: THREE.DoubleSide, transparent: true, depthWrite: false, fog: true,
    vertexShader: /* glsl */`
      uniform float uTime;
      attribute float aPhase;
      varying float vAlpha;
      #include <common>
      #include <fog_pars_vertex>
      void main() {
        vec3 p = position;
        float glide = smoothstep( 0.3, 0.7, 0.5 + 0.5 * sin( uTime * 0.31 + aPhase * 17.0 ) );
        p.y += pow( abs( p.x ), 1.2 ) * sin( uTime * 6.5 + aPhase * 6.283 ) * mix( 0.95, 0.1, glide );
        vec4 mvPosition = viewMatrix * modelMatrix * instanceMatrix * vec4( p, 1.0 );
        gl_Position = projectionMatrix * mvPosition;
        vAlpha = smoothstep( 10.0, 22.0, -mvPosition.z );
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor;
      varying float vAlpha;
      #include <common>
      #include <fog_pars_fragment>
      void main() {
        ${FOG_FADE}
        gl_FragColor = vec4( mix( uColor, fogColor, fogF ), vAlpha );
        ${OUT}
      }`,
  });
  const m = new THREE.InstancedMesh(geo, mat, n);
  m.frustumCulled = false; m.renderOrder = 0.9; m.raycast = () => {};
  return m;
}

// ---------- planning-table props ----------

// One 512 px atlas for every printed surface; everything else samples its white block and uses vertex colors.
const ATLAS = 512;
const AREA = { map: [0, 0, 320, 240], ruler: [0, 248, 512, 40], dial: [320, 0, 128, 128], label: [320, 128, 192, 64], white: [448, 0, 64, 64] };
const rect = ([x, y, w, h]) => [x / ATLAS, 1 - (y + h) / ATLAS, w / ATLAS, h / ATLAS];

function drawAtlas() {
  const cv = document.createElement('canvas'); cv.width = cv.height = ATLAS;
  const c = cv.getContext('2d'), rnd = seeded(1944);
  c.fillStyle = '#fff'; c.fillRect(...AREA.white);

  // the field map: paper, woods, contours, a river, roads, villages, grid, two plan arrows, a margin
  c.save(); c.beginPath(); c.rect(...AREA.map); c.clip();
  c.fillStyle = '#e8dcc0'; c.fillRect(...AREA.map);
  for (let i = 0; i < 500; i++) { c.fillStyle = `rgba(150,120,70,${0.03 + rnd() * 0.05})`; c.fillRect(rnd() * 320, rnd() * 240, 2 + rnd() * 12, 1 + rnd() * 6); }
  c.fillStyle = 'rgba(118,146,88,0.42)';
  for (let i = 0; i < 10; i++) {
    const x = rnd() * 320, y = rnd() * 240;
    for (let k = 0; k < 6; k++) { c.beginPath(); c.arc(x + rnd() * 26 - 13, y + rnd() * 18 - 9, 8 + rnd() * 9, 0, TAU); c.fill(); }
  }
  c.strokeStyle = 'rgba(150,100,60,0.6)'; c.lineWidth = 1;
  for (const [hx, hy, n] of [[92, 78, 5], [232, 168, 4]]) for (let k = 1; k <= n; k++) {
    c.beginPath();
    for (let a = 0; a <= 32; a++) {
      const t = (a / 32) * TAU, r = k * 11 * (1 + 0.14 * Math.sin(t * 3 + k) + 0.06 * Math.sin(t * 5 + hx));
      c[a ? 'lineTo' : 'moveTo'](hx + Math.cos(t) * r * 1.3, hy + Math.sin(t) * r);
    }
    c.stroke();
  }
  c.strokeStyle = '#6a8bb0'; c.lineWidth = 5; c.lineCap = 'round';
  c.beginPath(); c.moveTo(20, 240); c.bezierCurveTo(90, 170, 60, 120, 160, 110); c.bezierCurveTo(250, 100, 230, 40, 320, 10); c.stroke();
  c.strokeStyle = '#9c4a3a'; c.lineWidth = 2.2;
  c.beginPath(); c.moveTo(0, 60); c.bezierCurveTo(120, 80, 200, 150, 320, 140); c.stroke();
  c.beginPath(); c.moveTo(170, 0); c.bezierCurveTo(150, 90, 190, 160, 140, 240); c.stroke();
  c.fillStyle = '#3c342a';
  for (const [x, y] of [[164, 118], [70, 66], [262, 140]]) for (let k = 0; k < 7; k++) c.fillRect(x + rnd() * 18 - 9, y + rnd() * 14 - 7, 3 + rnd() * 3, 3 + rnd() * 3);
  c.strokeStyle = 'rgba(60,80,110,0.28)'; c.lineWidth = 1;
  for (let x = 40; x < 320; x += 40) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, 240); c.stroke(); }
  for (let y = 40; y < 240; y += 40) { c.beginPath(); c.moveTo(0, y); c.lineTo(320, y); c.stroke(); }
  const arrow = (pts, color) => {
    c.strokeStyle = c.fillStyle = color; c.lineWidth = 5; c.lineCap = 'round';
    c.beginPath(); c.moveTo(...pts[0]); c.quadraticCurveTo(...pts[1], ...pts[2]); c.stroke();
    const [ex, ey] = pts[2], a = Math.atan2(ey - pts[1][1], ex - pts[1][0]);
    c.beginPath(); c.moveTo(ex + Math.cos(a) * 12, ey + Math.sin(a) * 12);
    c.lineTo(ex + Math.cos(a + 2.4) * 12, ey + Math.sin(a + 2.4) * 12); c.lineTo(ex + Math.cos(a - 2.4) * 12, ey + Math.sin(a - 2.4) * 12); c.fill();
  };
  arrow([[40, 200], [70, 120], [140, 104]], 'rgba(176,58,46,0.85)');
  arrow([[290, 60], [250, 120], [190, 126]], 'rgba(52,85,139,0.85)');
  c.strokeStyle = '#4a4030'; c.lineWidth = 1.5; c.strokeRect(6, 6, 308, 228);
  c.fillStyle = '#3a3226'; c.font = 'bold 12px serif'; c.fillText('SHEET 7F   1:25,000', 14, 226); c.fillText('HILL 112', 70, 46);
  c.restore();

  // the ruler: boxwood with half-centimeter ticks and numbers along one edge
  const [rx, ry, rw, rh] = AREA.ruler;
  c.fillStyle = '#e6cf98'; c.fillRect(rx, ry, rw, rh);
  c.fillStyle = '#2e2a22'; c.font = '9px sans-serif'; c.textAlign = 'center';
  for (let k = 0; k <= 60; k++) {
    const x = rx + 8 + (k * (rw - 16)) / 60;
    c.fillRect(x - 0.6, ry, 1.2, k % 2 ? 8 : 14);
    if (!(k % 2)) c.fillText(String(k / 2), x, ry + 25);
  }

  // the compass dial: cream card, ticks, N E S W, a red and black needle
  const [dx, dy, ds] = AREA.dial, cx = dx + ds / 2, cy = dy + ds / 2;
  c.fillStyle = '#b58a3c'; c.fillRect(dx, dy, ds, ds);
  c.fillStyle = '#efe5c8'; c.beginPath(); c.arc(cx, cy, ds / 2 - 1, 0, TAU); c.fill();
  c.strokeStyle = '#3a3226';
  for (let k = 0; k < 36; k++) {
    const a = (k / 36) * TAU, r0 = k % 3 ? 54 : 48;
    c.lineWidth = k % 3 ? 1 : 2;
    c.beginPath(); c.moveTo(cx + Math.sin(a) * r0, cy - Math.cos(a) * r0); c.lineTo(cx + Math.sin(a) * 60, cy - Math.cos(a) * 60); c.stroke();
  }
  c.font = 'bold 15px serif'; c.textBaseline = 'middle';
  [['N', 0, '#a8352a'], ['E', 1, '#3a3226'], ['S', 2, '#3a3226'], ['W', 3, '#3a3226']].forEach(([s, k, col]) => {
    const a = (k * TAU) / 4; c.fillStyle = col; c.fillText(s, cx + Math.sin(a) * 37, cy - Math.cos(a) * 37);
  });
  const needle = (sign, col) => { c.fillStyle = col; c.beginPath(); c.moveTo(cx, cy - sign * 30); c.lineTo(cx + 5, cy); c.lineTo(cx - 5, cy); c.fill(); };
  needle(1, '#b23a2c'); needle(-1, '#2a2622');
  c.fillStyle = '#c9a24a'; c.beginPath(); c.arc(cx, cy, 3, 0, TAU); c.fill();

  // the enamel mug's band: "HQ 1944" stenciled on the front third (squeezed, since the band wraps all the way round)
  const [lx, ly, lw, lh] = AREA.label;
  c.fillStyle = '#ece4d2'; c.fillRect(lx, ly, lw, lh);
  c.save(); c.translate(lx + lw / 2, ly + lh / 2); c.scale(0.4, 1);
  c.fillStyle = '#2b3d63'; c.font = '900 34px "Arial Black", Arial, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText('HQ 1944', 0, 2);
  c.restore();

  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// Merges posed parts into one geometry: positions and normals transformed, vertex colors (with an optional darkening
// toward the table, a cheap contact shade) and uvs remapped into an atlas area or onto its white block.
function makeBuilder(tableY) {
  const P = [], N = [], C = [], U = [], I = [];
  const v = new THREE.Vector3(), nm = new THREE.Matrix3(), col = new THREE.Color();
  const W = rect(AREA.white), wu = W[0] + W[2] / 2, wv = W[1] + W[3] / 2;
  return {
    P,
    add(geo, m, color, { uv = null, ao = 0 } = {}) {
      const pos = geo.attributes.position, nor = geo.attributes.normal, tuv = geo.attributes.uv, first = P.length / 3;
      nm.getNormalMatrix(m); col.setHex(color);
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m); P.push(v.x, v.y, v.z);
        const k = 1 - ao * (1 - Math.min(1, Math.max(0, (v.y - tableY) / 2)));
        C.push(col.r * k, col.g * k, col.b * k);
        v.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize(); N.push(v.x, v.y, v.z);
        if (uv && tuv) U.push(uv[0] + tuv.getX(i) * uv[2], uv[1] + tuv.getY(i) * uv[3]); else U.push(wu, wv);
      }
      if (geo.index) for (let i = 0; i < geo.index.count; i++) I.push(first + geo.index.getX(i));
      else for (let i = 0; i < pos.count; i++) I.push(first + i);
      geo.dispose();
    },
    build() {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
      g.setIndex(I);
      g.computeBoundingSphere();
      return g;
    },
  };
}

const mx = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) => new THREE.Matrix4().compose(
  new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(sx, sy, sz));
const yawTo = (dx, dz) => Math.atan2(-dz, dx); // the yaw that turns local +x toward (dx, dz)
const UP = new THREE.Vector3(0, 1, 0);
// a cylinder from a to b (local coordinates), for lamp arms
const rod = (a, b, r, seg = 6) => {
  const d = new THREE.Vector3().subVectors(b, a), len = d.length();
  return [new THREE.CylinderGeometry(r, r, len, seg), new THREE.Matrix4().compose(
    a.clone().addScaledVector(d, 0.5), new THREE.Quaternion().setFromUnitVectors(UP, d.normalize()), new THREE.Vector3(1, 1, 1))];
};
// the same surface seen from the inside: reversed triangles, flipped normals (the lamp shade's lining)
const inside = (geo) => {
  const ix = geo.index.array;
  for (let i = 0; i < ix.length; i += 3) [ix[i + 1], ix[i + 2]] = [ix[i + 2], ix[i + 1]];
  const n = geo.attributes.normal.array;
  for (let i = 0; i < n.length; i++) n[i] = -n[i];
  return geo;
};

const BRASS = 0xc9a24a, STEEL = 0x9c9a94, PAPER = 0xe9dfc4, RED = 0xb8483a, BLUE = 0x46689a, CREAM = 0xe9e1cf, NAVY = 0x2b3d63;

// a brass map pin with a paper flag, its point at (x, y0, z) in the prop's frame
function pin(add, x, y0, z, flag, tilt, yaw) {
  const F = mx(x, y0, z, tilt, yaw, 0, 1.5), L = 3.2, part = (m) => F.clone().multiply(m); // 1.5x: readable from afar
  add(new THREE.CylinderGeometry(0.07, 0.07, L, 5), part(mx(0, L / 2, 0)), STEEL);
  add(new THREE.SphereGeometry(0.5, 8, 6), part(mx(0, L + 0.3, 0)), BRASS);
  add(new THREE.BoxGeometry(1.9, 1.15, 0.05), part(mx(0.98, L - 0.75, 0)), flag);
}

// Lays out every prop around a board of MW x MH meters. Each prop is posed in its own frame (origin on the table),
// then pushed outward until its footprint clears the board by 3 m and nothing on it rises above a line 1.4 m up per
// meter out from the board edge (the steepest view never sees past it onto the board).
function buildProps(MW, MH, tableY, edgeAt) {
  const B = makeBuilder(tableY);
  const prop = (x, z, yaw, out, make) => {
    const start = B.P.length, F = mx(x, tableY, z, 0, yaw, 0);
    make((geo, m, color, o) => B.add(geo, F.clone().multiply(m), color, o));
    const P = B.P, [ox, oz] = out;
    const bad = () => {
      for (let i = start; i < P.length; i += 3) {
        const px = P[i], pz = P[i + 2];
        const ex = Math.max(-px, px - MW, 0), ez = Math.max(-pz, pz - MH, 0), d = Math.hypot(ex, ez);
        if (Math.max(-px - 3, px - MW - 3, -pz - 3, pz - MH - 3) < 0) return true; // within 3 m of the board
        if (P[i + 1] - edgeAt(Math.min(MW, Math.max(0, px)), Math.min(MH, Math.max(0, pz))) > 1.4 * d) return true;
      }
      return false;
    };
    let k = 0;
    for (; k < 80 && bad(); k++) for (let i = start; i < P.length; i += 3) { P[i] += ox * 1.5; P[i + 2] += oz * 1.5; }
    return [ox * 1.5 * k, oz * 1.5 * k]; // how far it moved
  };

  // folded field map off the west edge, top of the sheet away from the board, three pins in it
  prop(-26, MH * 0.6, Math.PI / 2 + 0.1, [-1, 0], (add) => {
    const g = new THREE.PlaneGeometry(40, 30, 4, 2); g.rotateX(-Math.PI / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const ix = Math.round((p.getX(i) + 20) / 10), iz = Math.round((p.getZ(i) + 15) / 15);
      p.setY(i, 0.12 + (ix % 2 ? 0.7 : 0) + (iz === 1 ? 0.3 : 0));
    }
    const flat = g.toNonIndexed(); g.dispose(); flat.computeVertexNormals();
    add(flat, mx(), 0xffffff, { uv: rect(AREA.map) });
    pin(add, -9, 0.6, 4, RED, 0.12, 0.4);
    pin(add, 7, 0.6, -6, BLUE, -0.1, 2.2);
    pin(add, 13, 0.5, 8, RED, 0.15, -0.6);
  });

  // ruler along the south edge, its numbers upright when seen from across the board
  prop(MW * 0.3, -6.5, 0.04, [0, -1], (add) => {
    add(new THREE.BoxGeometry(30, 0.32, 3.2), mx(0, 0.16, 0), 0xcfa868, { ao: 0.25 });
    add(new THREE.PlaneGeometry(30, 3.2), mx(0, 0.325, 0, -Math.PI / 2), 0xffffff, { uv: rect(AREA.ruler) });
    add(new THREE.BoxGeometry(30, 0.1, 0.25), mx(0, 0.36, -1.47), 0xb8913f);
  });

  // pencil beside the ruler, lying on a flat face
  prop(MW * 0.3 + 24, -13, 0.5, [0, -1], (add) => {
    const r = 0.42, y = r * 0.87;
    add(new THREE.CylinderGeometry(r, r, 13.5, 6), mx(0, y, 0, 0, 0, Math.PI / 2), 0xd8a420);
    add(new THREE.CylinderGeometry(0.1, r, 2.4, 6), mx(7.95, y, 0, 0, 0, -Math.PI / 2), 0xe0bb8a);
    add(new THREE.CylinderGeometry(0.01, 0.1, 0.5, 6), mx(9.4, y, 0, 0, 0, -Math.PI / 2), 0x34312e);
    add(new THREE.CylinderGeometry(r * 1.03, r * 1.03, 1.2, 10), mx(-7.35, y, 0, 0, 0, Math.PI / 2), 0xb9ad8c);
    add(new THREE.CylinderGeometry(r * 0.95, r * 0.95, 1.0, 10), mx(-8.45, y, 0, 0, 0, Math.PI / 2), 0xc77a72);
  });

  // enamel mug off the north-west corner, its "HQ 1944" turned toward the board
  const mugX = -15, mugZ = MH + 14;
  prop(mugX, mugZ, 0, [-0.7, 0.7], (add) => {
    const prof = [[0, 0], [3.75, 0], [3.95, 0.3], [4.0, 9.15], [4.12, 9.42], [3.96, 9.58], [3.8, 9.4], [3.78, 1.0], [0, 1.0]];
    add(new THREE.LatheGeometry(prof.map(([x, y]) => new THREE.Vector2(x, y)), 24), mx(), CREAM, { ao: 0.3 });
    add(new THREE.CircleGeometry(3.78, 24), mx(0, 7.4, 0, -Math.PI / 2), 0x3a2416);
    add(new THREE.TorusGeometry(3.98, 0.17, 6, 24), mx(0, 9.45, 0, Math.PI / 2), NAVY);
    const tx = MW / 2 - mugX, tz = MH / 2 - mugZ, n = Math.hypot(tx, tz);
    add(new THREE.CylinderGeometry(4.04, 4.04, 3.4, 24, 1, true), mx(0, 4.6, 0, 0, Math.atan2(-tx / n, -tz / n)), 0xffffff, { uv: rect(AREA.label) });
    const side = Math.atan2(tx, tz) + Math.PI / 2; // handle off to one side of the label
    add(new THREE.TorusGeometry(2.3, 0.42, 6, 12, Math.PI), mx(Math.sin(side) * 3.9, 5.2, Math.cos(side) * 3.9, 0, side - Math.PI / 2, -Math.PI / 2), CREAM);
  });

  // brass compass off the east edge, lid open behind it, dial north pointing away from the board
  prop(MW + 11, MH * 0.4, -Math.PI / 2, [1, 0], (add) => {
    add(new THREE.CylinderGeometry(2.8, 2.9, 1.1, 24), mx(0, 0.55, 0), 0xb58a3c, { ao: 0.3 });
    add(new THREE.CircleGeometry(2.45, 24), mx(0, 1.12, 0, -Math.PI / 2), 0xffffff, { uv: rect(AREA.dial) });
    add(new THREE.TorusGeometry(2.62, 0.18, 5, 24), mx(0, 1.1, 0, Math.PI / 2), 0xc89a48);
    const lid = mx(0, 1.1, -2.85, -105 * Math.PI / 180);
    add(new THREE.CylinderGeometry(2.8, 2.8, 0.35, 24), lid.clone().multiply(mx(0, 0.175, 2.8)), 0xb58a3c);
    add(new THREE.CircleGeometry(2.3, 20), lid.clone().multiply(mx(0, -0.01, 2.8, Math.PI / 2)), 0xc5ccd0);
    add(new THREE.TorusGeometry(0.6, 0.14, 5, 12), mx(0, 0.7, 3.35), 0xc89a48);
  });

  // pins stuck in the table along the north, east and south edges
  for (const [x, z, flag, out] of [[MW * 0.58, MH + 7, RED, [0, 1]], [MW + 7, MH * 0.8, BLUE, [1, 0]], [MW * 0.8, -8, PAPER, [0, -1]]]) {
    prop(x, z, 0, out, (add) => pin(add, 0, -0.3, 0, flag, 0.1, x * 0.7));
  }

  // desk lamp off the south-east corner, reaching toward it; local +x points at the corner
  const o = [Math.SQRT1_2, -Math.SQRT1_2], baseD = 62;
  const lamp = { x: MW + o[0] * baseD, z: o[1] * baseD };
  const H = new THREE.Vector3(21, 31, 0), d = new THREE.Vector3(0.55, -1, 0).normalize(); // shade pivot, beam direction
  const moved = prop(lamp.x, lamp.z, yawTo(-o[0], -o[1]), o, (add) => {
    const GREEN = 0x2e4436, ARM = 0x2b2b29, V = (x, y, z) => new THREE.Vector3(x, y, z);
    add(new THREE.CylinderGeometry(6.5, 7, 1.5, 28), mx(0, 0.75, 0), GREEN, { ao: 0.3 });
    add(new THREE.CylinderGeometry(1.3, 1.5, 1.4, 12), mx(0, 2.1, 0), GREEN);
    const A = V(0, 2.8, 0), E = V(-3, 25, 0);
    for (const s of [-0.5, 0.5]) {
      add(...rod(A.clone().setZ(s), E.clone().setZ(s), 0.32), ARM);
      add(...rod(E.clone().setZ(s), H.clone().setZ(s), 0.3), ARM);
    }
    for (const p of [A, E, H]) add(new THREE.SphereGeometry(0.9, 10, 8), mx(p.x, p.y, p.z), BRASS);
    const q = new THREE.Quaternion().setFromUnitVectors(UP, d.clone().negate()); // the shade's wide mouth faces d
    const at = (k, g, color) => add(g, new THREE.Matrix4().compose(H.clone().addScaledVector(d, k), q, V(1, 1, 1)), color);
    at(2.4, new THREE.CylinderGeometry(1.6, 5.6, 6.5, 20, 1, true), GREEN);
    at(2.4, inside(new THREE.CylinderGeometry(1.55, 5.5, 6.45, 20, 1, true)), 0xf1e6c8);
    at(-0.85, new THREE.CylinderGeometry(1.0, 1.6, 0.8, 12), GREEN);
    at(3.6, new THREE.SphereGeometry(1.35, 10, 8), 0xfff2d2);
  });
  // where the beam meets the table, in world space (after any push outward)
  const reach = H.x + (H.y / -d.y) * d.x;
  const pool = { x: lamp.x + moved[0] - o[0] * reach, z: lamp.z + moved[1] - o[1] * reach, yaw: yawTo(-o[0], -o[1]) };
  return { geometry: B.build(), pool };
}

function poolTexture() {
  const S = 64, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const c = cv.getContext('2d'), g = c.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.45, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g; c.fillRect(0, 0, S, S);
  return new THREE.CanvasTexture(cv);
}

// ---------- the module ----------

export function createAtmosphere({ scene, renderer, camera, cam, sun, hemi }) {
  const root = new THREE.Group(); root.name = 'atmosphere'; root.visible = false;
  scene.add(root);
  let enabled = true, on = false, moodName = 'warm', M = MOODS.warm, t = 0, ground = null, groundGeo = null, MW = 0, MH = 0, tableY = 0, builtTableY = 0;
  let hAt = () => 0, propsKey = '';

  const cloudMat = cloudMaterial();
  const cloudBoard = new THREE.Mesh(new THREE.BufferGeometry(), cloudMat);
  const cloudTable = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), cloudMat);
  for (const m of [cloudBoard, cloudTable]) { m.renderOrder = 0.6; m.raycast = () => {}; m.frustumCulled = false; root.add(m); }

  const propsMat = new THREE.MeshLambertMaterial({ vertexColors: true, map: drawAtlas() });
  const props = new THREE.Mesh(new THREE.BufferGeometry(), propsMat);
  props.castShadow = props.receiveShadow = true; props.raycast = () => {};
  const poolMat = new THREE.MeshBasicMaterial({ map: poolTexture(), color: 0xffbb66, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), poolMat);
  pool.renderOrder = 0.55; pool.raycast = () => {};
  root.add(props, pool);

  const MIST_CAP = 36;
  const mist = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: wispTexture(), color: 0xf3f0ea, transparent: true, opacity: 0.28, depthWrite: false, fog: true }), MIST_CAP);
  mist.renderOrder = 0.7; mist.frustumCulled = false; mist.raycast = () => {}; mist.count = 0;
  root.add(mist);
  let sites = [];

  let weather = null;
  const BIRDS = 7, birds = birdMesh(BIRDS);
  root.add(birds);
  let flight = [];

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ'), p3 = new THREE.Vector3(), s3 = new THREE.Vector3(), v2 = new THREE.Vector2();

  function applyMood() {
    sky.sunUp = M.sunUp; sky.haze = M.hazeK;
    sun.color.setHex(M.sun); sun.intensity = M.sunI; sun.shadow.intensity = M.shadow;
    hemi.color.setHex(M.top); hemi.groundColor.setHex(M.bottom); hemi.intensity = M.hemiI;
    if (scene.background?.isColor) scene.background.setHex(M.haze);
    scene.fog?.color.setHex(M.haze);
    cloudMat.uniforms.strength.value = M.clouds;
    poolMat.opacity = M.lamp;
  }

  // light.js's Graphics handler runs first (subscribed earlier) and sets its radius; this widens it per mood
  function applyGfx() {
    const low = gfx.low;
    sun.shadow.radius = low ? 1 : 2.5 * M.soft;
    cloudBoard.visible = cloudTable.visible = on && !low && M.clouds > 0;
    if (weather) weather.visible = on && !low && !reduceMotion && weather.userData.kind === M.weather;
    birds.visible = on && !low && !reduceMotion && flight.length > 0;
    mist.visible = on && !!M.mist && sites.length > 0;
    mist.count = Math.min(sites.length, low ? 18 : MIST_CAP);
  }
  gfx.onChange(applyGfx);

  function measureGround() {
    groundGeo = ground.geometry;
    // a PlaneGeometry lies rotated (its local z is up); client/relief.js builds its geometry in world space (y up)
    const pos = groundGeo.attributes.position, up = groundGeo.parameters ? 'getZ' : 'getY';
    let low = Infinity, high = -Infinity;
    for (let i = 0; i < pos.count; i++) { const z = pos[up](i); low = Math.min(low, z); high = Math.max(high, z); }
    tableY = low - BOARD - 0.02; // where light.js puts the table top
    return high;
  }

  function placeTable() {
    const hyp = Math.hypot(MW, MH) / 2;
    cloudTable.position.set(MW / 2, tableY + 0.04, MH / 2);
    cloudTable.scale.set(2 * (hyp + 500), 1, 2 * (hyp + 500));
    cloudMat.uniforms.fade.value.set(MW / 2, MH / 2, hyp + 180, hyp + 480);
    props.position.y = tableY - builtTableY;
    pool.position.y = tableY + 0.05;
  }

  function start({ map, key, ground: g, hAt: h }) {
    ground = g; hAt = h;
    // board size: a PlaneGeometry's own, or the fixed bounds client/relief.js gives its geometry (x and z from 0)
    const prm = g.geometry.parameters, box = g.geometry.boundingBox;
    MW = prm ? prm.width : box.max.x; MH = prm ? prm.height : box.max.z;
    const cell = MW / map.w, high = measureGround();
    moodName = moodFor(map, key); M = MOODS[moodName];
    applyMood();

    cloudBoard.geometry = g.geometry;
    cloudBoard.position.copy(g.position); cloudBoard.position.y += 0.06; cloudBoard.rotation.copy(g.rotation);

    // the editor rebuilds the world on every change; the props only depend on the board's size and table height
    const pk = `${MW}x${MH}@${tableY.toFixed(2)}`;
    if (pk !== propsKey) {
      propsKey = pk; builtTableY = tableY;
      const built = buildProps(MW, MH, tableY, hAt);
      props.geometry.dispose(); props.geometry = built.geometry;
      pool.position.set(built.pool.x, 0, built.pool.z); pool.rotation.y = built.pool.yaw; pool.scale.set(78, 1, 60);
    }
    placeTable();

    sites = M.mist ? mistSites(map, cell, hAt, MIST_CAP) : [];

    if (M.weather && weather?.userData.kind !== M.weather) {
      if (weather) { root.remove(weather); weather.geometry.dispose(); weather.material.dispose(); }
      weather = weatherPoints(M.weather); root.add(weather);
    }

    // two loose flocks circling over different parts of the board, well above the planes (20 m)
    const rnd = seeded(Math.round(MW * 7 + MH * 13));
    flight = Array.from({ length: BIRDS }, (_, i) => {
      const c = i < 4 ? [0.36, 0.6] : [0.68, 0.32], r = 16 + rnd() * 14;
      return { cx: MW * c[0], cz: MH * c[1], r, w: (i < 4 ? 1 : -1) * 5.5 / r, a0: rnd() * TAU, y: high + 26 + rnd() * 7, bob: rnd() * TAU };
    });

    on = true; root.visible = enabled;
    applyGfx();
    update(0);
  }

  function update(dt) {
    if (!on || !ground) return;
    t = (t + dt) % 10000;
    // digging swaps the terrain geometry (and can lower the table)
    if (ground.geometry !== groundGeo) {
      cloudBoard.geometry = ground.geometry;
      const before = tableY; measureGround();
      if (tableY !== before) placeTable();
    }
    if (cloudBoard.visible) {
      const k = (CLOUD_SPEED * t) / CLOUD_SCALE;
      cloudMat.uniforms.drift.value.set(-WX * k % 1, -WZ * k % 1, (-WX * k * 1.6 + 0.37) % 1, (-WZ * k * 1.9 + 0.61) % 1);
    }
    if (mist.visible) {
      for (let i = 0; i < mist.count; i++) {
        const s = sites[i], w = Math.sin(t * 0.05 + s.ph) * 3, br = 1 + 0.08 * Math.sin(t * 0.11 + s.ph * 2);
        p3.set(s.x + WX * w, s.y, s.z + WZ * w); q.setFromAxisAngle(UP, s.yaw + 0.05 * Math.sin(t * 0.03 + s.ph));
        mist.setMatrixAt(i, m4.compose(p3, q, s3.set(s.sx * br, 1, s.sz * br)));
      }
      mist.instanceMatrix.needsUpdate = true;
    }
    if (weather?.visible) {
      const u = weather.material.uniforms, box = u.uBox.value, gy = cam.y ?? hAt(cam.x, cam.z), snow = weather.userData.kind === 'snow';
      u.uTime.value = t;
      u.uBoxMin.value.set(cam.x - box.x / 2, gy - (snow ? 4 : 1.5), cam.z - box.z / 2);
      u.uFade.value.x = cam.x; u.uFade.value.y = cam.z;
      renderer.getDrawingBufferSize(v2);
      u.uScale.value = v2.y / (2 * Math.tan((camera.fov * Math.PI) / 360));
      const pr = renderer.getPixelRatio();
      u.uPx.value.set(1 * pr, u.uPxMax.value * pr);
    }
    if (birds.visible) {
      birds.material.uniforms.uTime.value = t;
      flight.forEach((b, i) => {
        const a = b.a0 + b.w * t, dir = Math.sign(b.w);
        p3.set(b.cx + Math.cos(a) * b.r, b.y + Math.sin(t * 0.4 + b.bob) * 0.8, b.cz + Math.sin(a) * b.r);
        e.set(0, Math.atan2(-Math.sin(a) * dir, Math.cos(a) * dir), 0.3 * dir);
        birds.setMatrixAt(i, m4.compose(p3, q.setFromEuler(e), s3.set(1.3, 1.3, 1.3)));
      });
      birds.instanceMatrix.needsUpdate = true;
    }
  }

  return {
    start, update,
    get mood() { return moodName; },
    // debug: hide everything this module draws (for measuring its cost)
    setEnabled(v) { enabled = !!v; root.visible = on && enabled; },
  };
}
