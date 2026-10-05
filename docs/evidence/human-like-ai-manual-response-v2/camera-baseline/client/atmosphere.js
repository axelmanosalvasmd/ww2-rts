// Atmosphere: clouds, mist, birds and the match's weather over the map and surrounding land.
// Light settings and weather modifiers come from client/moods.js. Fog of war draws over these effects.
import * as THREE from 'three';
import { gfx } from './gfx.js';
import { setMood } from './light.js';
import { MOODS, DEFAULT_MOOD, moodFor, WEATHER_LOOK as LOOK } from './moods.js';
import { mapMood, roadMask } from '/shared/weather.js';
import { wind } from './wind.js';

const TAU = Math.PI * 2;
const WL = Math.hypot(0.55, 0.25), WX = 0.55 / WL, WZ = 0.25 / WL; // the wind before the server reports one (client/wind.js)
const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const seeded = (s) => () => (s = (s * 16807) % 2147483647) / 2147483647;

const FALL = { rain: 'rain', snow: 'snow' }; // weather that falls as particles

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
        float cover = smoothstep( 0.46, 0.7, a * 0.72 + b * 0.28 );
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

// The same instanced sheets, with a small distortion inside the texture instead of more overlapping geometry.
// Fade near the eye so a low camera does not cut through a bright sheet. Weather supplies the mist's tint.
function mistMaterial(tWisp, opacity) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...fogUniforms(), tWisp: { value: tWisp }, uTime: { value: 0 }, uOpacity: { value: opacity },
      uTint: { value: new THREE.Color(0xeceeea) },
    },
    vertexShader: /* glsl */`
      #include <common>
      #include <fog_pars_vertex>
      varying vec2 vUv, vXZ;
      varying float vNear;
      void main() {
        vec4 wp = modelMatrix * instanceMatrix * vec4( position, 1.0 );
        vUv = uv;
        vXZ = wp.xz;
        vec4 mvPosition = viewMatrix * wp;
        vNear = smoothstep( 6.0, 18.0, -mvPosition.z );
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D tWisp;
      uniform float uTime, uOpacity;
      uniform vec3 uTint;
      varying vec2 vUv, vXZ;
      varying float vNear;
      #include <common>
      #include <fog_pars_fragment>
      void main() {
        vec2 uv = vUv + 0.018 * vec2( sin( vXZ.y * 0.2 + uTime * 0.13 ), sin( vXZ.x * 0.17 - uTime * 0.11 ) );
        float a = texture2D( tWisp, uv ).a * uOpacity * vNear;
        if ( a < 0.004 ) discard;
        ${FOG_FADE}
        gl_FragColor = vec4( mix( uTint, fogColor, fogF ), a * ( 1.0 - 0.65 * fogF ) );
        ${OUT}
      }`,
    transparent: true, depthWrite: false, fog: true,
  });
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

// ---------- rain, snow and dust ----------

// n: points (Graphics Low draws a third). alpha, sway (m), box (m), vel (m/s), size (m), pxMax, fade (m), color.
// Rain draws each point as a short slanted streak; snow and dust as soft dots.
const FALLS = {
  rain: { n: 3600, seed: 3, alpha: 0.42, sway: 0.1, box: [150, 36, 150], vel: [WX * 3, -21, WZ * 3], size: [0.55, 1.0], pxMax: 16, fade: [50, 90], color: 0xc4ccd4, streak: 1 },
  snow: { n: 2600, seed: 5, alpha: 0.9, sway: 0.7, box: [200, 60, 200], vel: [WX * 1.4, -2.0, WZ * 1.4], size: [0.16, 0.3], pxMax: 5, fade: [55, 98], color: 0xf7f8fb, streak: 0 },
  dust: { n: 800, seed: 9, alpha: 0.13, sway: 1.2, box: [220, 9, 220], vel: [WX * 7, 0.25, WZ * 7], size: [1.4, 3.2], pxMax: 30, fade: [50, 100], color: 0xcaa879, streak: 0 },
};

// Points live in a world-space box that follows the camera target; each one wraps around inside the box, so panning
// never moves the flakes already on screen. They fade toward the box edges, near the camera and in the haze.
// Rain falls in the Rain weather and in the showers of the others (snapshot.wx), as strong as it rains.
function weatherPoints(kind) {
  const F = FALLS[kind], n = F.n, rnd = seeded(F.seed);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(Float32Array.from({ length: n * 3 }, rnd), 3));
  geo.setAttribute('aRand', new THREE.Float32BufferAttribute(Float32Array.from({ length: n * 4 }, rnd), 4));
  const u = {
    ...fogUniforms(), uTime: { value: 0 }, uScale: { value: 1000 }, uAlpha: { value: F.alpha }, uStreak: { value: F.streak },
    uSway: { value: F.sway }, uBoxMin: { value: new THREE.Vector3() }, uBox: { value: new THREE.Vector3(...F.box) },
    uVel: { value: new THREE.Vector3(...F.vel) }, uSizeM: { value: new THREE.Vector2(...F.size) },
    uPx: { value: new THREE.Vector2() }, uPxMax: { value: F.pxMax },
    uFade: { value: new THREE.Vector4(0, 0, ...F.fade) },
    uColor: { value: new THREE.Color(F.color) },
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
      uniform float uStreak;
      varying float vAlpha;
      #include <common>
      #include <fog_pars_fragment>
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float soft = 1.0 - smoothstep( 0.06, 0.25, dot( c, c ) );
        float streak = ( 1.0 - smoothstep( 0.02, 0.07, abs( c.x - c.y * 0.18 ) ) ) * ( 1.0 - smoothstep( 0.2, 0.5, abs( c.y ) ) );
        float a = vAlpha * mix( soft, streak, uStreak );
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

// ---------- wet ground, mud and lying snow ----------

// Per map cell: r how close a road is (1 on it, fading over 3 cells), g water (nothing settles there), b the road
// itself. Linear filtering softens the cell edges. Roads and village streets are where client/ground.js paints them
// (roadMask in shared/weather.js).
function groundMask(map) {
  const { w, h, rows } = map, road = roadMask(map), data = new Uint8Array(w * h * 4), R = 3;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let near = 0;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < w && yy < h && road[yy * w + xx]) near = Math.max(near, 1 - Math.hypot(dx, dy) / (R + 0.5));
    }
    const ch = rows[y][x], i = (y * w + x) * 4;
    data[i] = Math.round(near * 255); data[i + 1] = ch === 'W' || ch === 'F' ? 255 : 0; data[i + 2] = road[y * w + x] ? 255 : 0; data[i + 3] = 255;
  }
  const t = new THREE.DataTexture(data, w, h);
  t.magFilter = t.minFilter = THREE.LinearFilter; t.needsUpdate = true;
  return t;
}

// One transparent layer over the map in the ground's own shape: wet ground darkens, puddles catch the sky (more at
// a glancing view), mud spreads from the roads, snow lies on flat ground and thinner on the roads.
function coverMaterial(tNoise) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...fogUniforms(), tNoise: { value: tNoise }, tMask: { value: null }, uSize: { value: new THREE.Vector2(1, 1) },
      uWet: { value: 0 }, uSheen: { value: 0 }, uMud: { value: 0 }, uCover: { value: 0 }, uTime: { value: 0 },
      uSky: { value: new THREE.Color() }, uMudColor: { value: new THREE.Color(0x4b3a26) }, uSnow: { value: new THREE.Color(0xeef1f4) },
    },
    vertexShader: /* glsl */`
      #include <common>
      #include <fog_pars_vertex>
      varying vec2 vXZ;
      varying vec3 vN, vView;
      void main() {
        vec4 wp = modelMatrix * vec4( position, 1.0 );
        vXZ = wp.xz;
        vN = normalize( mat3( modelMatrix ) * normal );
        vView = cameraPosition - wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D tNoise, tMask;
      uniform vec2 uSize;
      uniform float uWet, uSheen, uMud, uCover, uTime;
      uniform vec3 uSky, uMudColor, uSnow;
      varying vec2 vXZ;
      varying vec3 vN, vView;
      #include <common>
      #include <fog_pars_fragment>
      vec4 over( vec4 dst, vec3 c, float a ) { return vec4( c * a + dst.rgb * ( 1.0 - a ), a + dst.a * ( 1.0 - a ) ); }
      void main() {
        vec4 m = texture2D( tMask, vXZ / uSize );
        float dry = 1.0 - m.g, flat_ = smoothstep( 0.82, 0.97, vN.y );
        float big = texture2D( tNoise, vXZ / 41.0 ).r, small = texture2D( tNoise, vXZ / 9.0 + 0.37 ).r;
        vec4 acc = vec4( 0.0 );
        acc = over( acc, vec3( 0.05, 0.045, 0.04 ), uWet * 0.3 * dry );
        float mud = uMud * smoothstep( 0.1, 0.75, m.r ) * smoothstep( 0.3, 0.55, big * 0.65 + small * 0.35 + m.b * 0.2 ) * dry;
        acc = over( acc, uMudColor, mud * 0.62 );
        // puddles: in the ruts by the roads and in low patches, shining more when seen at a slant
        float pud = uSheen * smoothstep( 0.6, 0.66, big * 0.55 + small * 0.3 + m.r * 0.22 ) * dry * flat_;
        float glance = pow( 1.0 - clamp( normalize( vView ).y, 0.0, 1.0 ), 2.0 );
        float ripple = 0.85 + 0.15 * sin( uTime * 3.1 + small * 40.0 );
        acc = over( acc, mix( uSky, vec3( 1.0 ), 0.25 ) * ripple, pud * ( 0.3 + 0.55 * glance ) );
        float snow = uCover * dry * smoothstep( 0.55, 0.9, vN.y ) * ( 0.72 + 0.28 * small ) * ( 1.0 - 0.45 * m.b );
        acc = over( acc, uSnow, snow * 0.82 );
        ${FOG_FADE}
        float a = acc.a * ( 1.0 - fogF );
        if ( a < 0.004 ) discard;
        gl_FragColor = vec4( acc.rgb / max( acc.a, 1e-4 ), a );
        ${OUT}
      }`,
    transparent: true, depthWrite: false, fog: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  });
}

// fog banks: low sheets scattered over the whole map, away from nothing in particular
function bankSites(MW, MH, hAt, cap) {
  const rnd = seeded(Math.round(MW * 3 + MH * 5) + 17), out = [];
  for (let i = 0; i < cap; i++) {
    const x = rnd() * MW, z = rnd() * MH;
    out.push({ x, z, y: hAt(x, z) + 0.8 + rnd() * 1.8, yaw: Math.atan2(WZ, WX) + (rnd() - 0.5) * 0.6, sx: 30 + rnd() * 22, sz: 13 + rnd() * 8, ph: rnd() * TAU });
  }
  return out;
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

const UP = new THREE.Vector3(0, 1, 0);

// ---------- the module ----------

export function createAtmosphere({ scene, renderer, camera, cam }) {
  const root = new THREE.Group(); root.name = 'atmosphere'; root.visible = false;
  scene.add(root);
  let enabled = true, on = false, moodName = DEFAULT_MOOD, M = MOODS[DEFAULT_MOOD], t = 0, ground = null, groundGeo = null, MW = 0, MH = 0;
  let hAt = () => 0;

  const cloudMat = cloudMaterial();
  const cloudBoard = new THREE.Mesh(new THREE.BufferGeometry(), cloudMat);
  const cloudApron = new THREE.Mesh(new THREE.BufferGeometry(), cloudMat);
  for (const m of [cloudBoard, cloudApron]) { m.renderOrder = 0.6; m.raycast = () => {}; m.frustumCulled = false; root.add(m); }

  // wet ground, mud and lying snow, under the cloud shade
  const coverMat = coverMaterial(cloudMat.uniforms.tNoise.value);
  const cover = new THREE.Mesh(new THREE.BufferGeometry(), coverMat);
  cover.renderOrder = 0.58; cover.raycast = () => {}; cover.frustumCulled = false;
  root.add(cover);

  const coverApron = new THREE.Mesh(new THREE.BufferGeometry(), coverMat);
  coverApron.renderOrder = 0.58; coverApron.raycast = () => {}; coverApron.frustumCulled = false;
  root.add(coverApron);

  const MIST_CAP = 36, wisp = wispTexture();
  const mist = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    mistMaterial(wisp, 0.28), MIST_CAP);
  mist.renderOrder = 0.7; mist.frustumCulled = false; mist.raycast = () => {}; mist.count = 0;
  root.add(mist);
  let sites = [];

  // ground fog: wide low sheets over the whole map
  const BANK_CAP = 64;
  const banks = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    mistMaterial(wisp, 0), BANK_CAP);
  banks.renderOrder = 0.72; banks.frustumCulled = false; banks.raycast = () => {}; banks.count = 0;
  root.add(banks);
  let bankAt = [];

  let fall = null, fallA = 0; // rain, snow or dust in the air, and how far it has faded in (0-1)
  // showers and the wet ground they leave (the living ground, snapshot.wx), 0-1 each
  let shower = { rain: 0, wet: 0 };
  const drift = new THREE.Vector2();
  const BIRDS = 4, birds = birdMesh(BIRDS);
  root.add(birds);
  let flight = [];

  // the weather: what it looks like now (cur) eases toward what it should look like (goal), so fog lifts slowly
  let wxNow = 'clear';
  const cur = { ...LOOK.clear }, goal = { ...LOOK.clear }, hazeNow = new THREE.Color(), hazeGoal = new THREE.Color();

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ'), p3 = new THREE.Vector3(), s3 = new THREE.Vector3(), v2 = new THREE.Vector2();

  function aim(kind) {
    wxNow = LOOK[kind] ? kind : 'clear';
    blend();
  }
  // The look to ease toward: the match weather, moved toward rain's look as hard as a shower rains (the server keeps
  // showers out of Snow, and in Rain it rains all match), with the ground as wet as the shower left it.
  const hazeBase = new THREE.Color(), hazeTmp = new THREE.Color();
  function blend() {
    const base = LOOK[wxNow], r = LOOK.rain, k = shower.rain, wet = wxNow === 'mud' ? 0 : shower.wet; // Mud's look is its soaked ground
    Object.assign(goal, base);
    for (const key of ['haze', 'sun', 'shadow', 'clouds', 'banks']) goal[key] = base[key] + (r[key] - base[key]) * k;
    for (const key of ['wet', 'sheen', 'mud']) goal[key] = Math.max(base[key], r[key] * wet);
    hazeBase.setHex(M.haze).lerp(hazeTmp.setHex(base.hazeTo), base.hazeMix);
    hazeGoal.setHex(M.haze).lerp(hazeTmp.setHex(r.hazeTo), r.hazeMix).lerp(hazeBase, 1 - k);
  }

  const EASED = ['haze', 'sun', 'shadow', 'clouds', 'wet', 'sheen', 'mud', 'cover', 'banks'];
  function applyMood() {
    setMood({ ...M, sunI: M.sunI * cur.sun, shadow: M.shadow * cur.shadow,
      hazeK: M.hazeK * cur.haze, haze: hazeNow.getHex() });
    cloudMat.uniforms.strength.value = Math.min(0.32, M.clouds * cur.clouds);
    const u = coverMat.uniforms;
    u.uWet.value = cur.wet; u.uSheen.value = cur.sheen; u.uMud.value = cur.mud; u.uCover.value = cur.cover; u.uSky.value.copy(hazeNow);
    mist.material.uniforms.uTint.value.setHex(M.top).lerp(hazeNow, 0.65);
    banks.material.uniforms.uTint.value.copy(mist.material.uniforms.uTint.value);
    banks.material.uniforms.uOpacity.value = 0.34 * cur.banks;
  }

  // Graphics Low keeps rain and snow with fewer particles and hides clouds and birds.
  function applyGfx() {
    const low = gfx.low;
    cloudBoard.visible = cloudApron.visible = on && !low && M.clouds > 0;
    if (fall) {
      const kind = fall.userData.kind, n = FALLS[kind].n;
      fall.visible = on && !reduceMotion && !(low && kind === 'dust'); // rain and snow stay on Low, thinner
      fall.geometry.setDrawRange(0, low ? Math.ceil(n / 3) : n);
    }
    birds.visible = on && !low && !reduceMotion && flight.length > 0;
    mist.visible = on && !!M.mist && sites.length > 0;
    mist.count = Math.min(sites.length, low ? 18 : MIST_CAP);
    banks.count = Math.min(bankAt.length, low ? 26 : BANK_CAP);
  }
  gfx.onChange(applyGfx);

  // what should be in the air: the weather's rain or snow, a shower's rain, else the mood's dust on a clear day
  const fallKind = () => FALL[wxNow] ?? (shower.rain > 0.02 ? 'rain' : M.weather === 'dust' && wxNow === 'clear' ? 'dust' : null);
  function swapFall(kind) {
    if (fall) { root.remove(fall); fall.geometry.dispose(); fall.material.dispose(); fall = null; }
    if (kind) {
      fall = weatherPoints(kind); root.add(fall);
      // it falls on the wind it started in (client/wind.js): positions follow from speed times the clock, so the slant
      // never changes under a fall that is already on screen
      const F = FALLS[kind], h = Math.hypot(F.vel[0], F.vel[2]) / WL;
      fall.material.uniforms.uVel.value.set(wind.x * h, F.vel[1], wind.z * h);
    }
    fallA = 0;
    applyGfx();
  }

  // weather: the match's weather row from the server ([now] or [now, next, seconds]); none in the editor
  function start({ map, key, ground: g, hAt: h, weather, apron }) {
    ground = g; hAt = h;
    // map size: a PlaneGeometry's own, or the fixed bounds client/relief.js gives its geometry (x and z from 0)
    const prm = g.geometry.parameters, box = g.geometry.boundingBox;
    MW = prm ? prm.width : box.max.x; MH = prm ? prm.height : box.max.z;
    const cell = MW / map.w;
    groundGeo = g.geometry;
    // the editor has no match weather: a winter map still snows there, as it always has
    const kind = weather?.[0] ?? (mapMood(map, key) === 'snow' ? 'snow' : 'clear');
    moodName = moodFor(map, key, kind); M = MOODS[moodName];
    shower = { rain: 0, wet: 0 };
    aim(kind);
    Object.assign(cur, goal); hazeNow.copy(hazeGoal); // a match starts in its weather, no easing in
    applyMood();

    cloudBoard.geometry = g.geometry;
    cloudBoard.position.copy(g.position); cloudBoard.position.y += 0.06; cloudBoard.rotation.copy(g.rotation);
    cover.geometry = g.geometry;
    cover.position.copy(g.position); cover.position.y += 0.05; cover.rotation.copy(g.rotation);
    coverMat.uniforms.tMask.value?.dispose();
    coverMat.uniforms.tMask.value = groundMask(map);
    coverMat.uniforms.uSize.value.set(MW, MH);

    cloudApron.geometry = apron.overlayGeometry; cloudApron.position.set(0, 0.06, 0);
    coverApron.geometry = apron.mesh.geometry; coverApron.position.set(0, 0.05, 0);
    const hyp = Math.hypot(MW, MH) / 2;
    cloudMat.uniforms.fade.value.set(MW / 2, MH / 2, hyp + 180, hyp + 480);

    sites = M.mist ? mistSites(map, cell, hAt, MIST_CAP) : [];
    bankAt = bankSites(MW, MH, hAt, BANK_CAP);

    const want = fallKind();
    if (fall?.userData.kind !== want) swapFall(want);
    fallA = 1;

    // two pairs circling over different parts of the map, 10 to 16 m above the local ground
    const rnd = seeded(Math.round(MW * 7 + MH * 13));
    flight = Array.from({ length: BIRDS }, (_, i) => {
      const c = i < 2 ? [0.36, 0.6] : [0.68, 0.32], r = 20 + rnd() * 18;
      return { cx: MW * c[0], cz: MH * c[1], r, w: (i < 2 ? 1 : -1) * 5.5 / r, a0: rnd() * TAU, y: 10 + rnd() * 6, bob: rnd() * TAU };
    });

    on = true; root.visible = enabled;
    applyGfx();
    update(0);
  }

  // the weather turned (fog lifting, rain stopping): the picture eases into the new one over a few seconds
  function setWeather(row) {
    if (!on || !Array.isArray(row) || row[0] === wxNow) return;
    aim(row[0]);
  }

  function update(dt) {
    if (!on || !ground) return;
    t = (t + dt) % 10000;
    // Digging swaps the terrain geometry; the apron keeps its shared position buffers.
    if (ground.geometry !== groundGeo) {
      cloudBoard.geometry = cover.geometry = ground.geometry;
      groundGeo = ground.geometry;
    }
    // ease toward the weather (about 8 s to settle), then fade the rain or snow out and the next one in
    // once settled (every value within 0.0005 and the haze color the same) the light is left alone
    const k = 1 - Math.exp(-dt / 2.5);
    if (k > 0 && (EASED.some((key) => Math.abs(goal[key] - cur[key]) > 5e-4) || hazeNow.getHex() !== hazeGoal.getHex())) {
      for (const key of EASED) cur[key] += (goal[key] - cur[key]) * k;
      hazeNow.lerp(hazeGoal, k);
      applyMood();
    }
    const want = fallKind();
    if (fall && fall.userData.kind !== want) { fallA = Math.max(0, fallA - dt / 3); if (fallA === 0) swapFall(want); }
    else if (!fall && want) swapFall(want);
    else fallA = Math.min(1, fallA + dt / 3);
    cover.visible = coverApron.visible = on && cur.wet + cur.sheen + cur.mud + cur.cover > 0.004;
    banks.visible = on && cur.banks > 0.004 && banks.count > 0;
    if (cloudBoard.visible) {
      // cloud shade moves with the wind; summed up frame by frame so a change of wind does not make it jump
      const k = (CLOUD_SPEED * dt) / CLOUD_SCALE / WL;
      drift.x = (drift.x - wind.x * k) % 1; drift.y = (drift.y - wind.z * k) % 1;
      cloudMat.uniforms.drift.value.set(drift.x, drift.y, (drift.x * 1.6 + 0.37) % 1, (drift.y * 1.9 + 0.61) % 1);
    }
    if (cover.visible) coverMat.uniforms.uTime.value = t;
    const mistT = reduceMotion ? 0 : t;
    if (mist.visible) {
      mist.material.uniforms.uTime.value = mistT;
      for (let i = 0; i < mist.count; i++) {
        const s = sites[i], w = Math.sin(mistT * 0.05 + s.ph) * 3, br = 1 + 0.08 * Math.sin(mistT * 0.11 + s.ph * 2);
        p3.set(s.x + WX * w, s.y, s.z + WZ * w); q.setFromAxisAngle(UP, s.yaw + 0.05 * Math.sin(mistT * 0.03 + s.ph));
        mist.setMatrixAt(i, m4.compose(p3, q, s3.set(s.sx * br, 1, s.sz * br)));
      }
      mist.instanceMatrix.needsUpdate = true;
    }
    if (banks.visible) {
      banks.material.uniforms.uTime.value = mistT;
      // the banks drift with the wind and rise a little as they thin out
      const lift = (1 - cur.banks) * 3;
      for (let i = 0; i < banks.count; i++) {
        const s = bankAt[i], w = Math.sin(mistT * 0.03 + s.ph) * 6, br = 1 + 0.1 * Math.sin(mistT * 0.07 + s.ph * 2);
        p3.set(s.x + WX * w, s.y + lift, s.z + WZ * w); q.setFromAxisAngle(UP, s.yaw);
        banks.setMatrixAt(i, m4.compose(p3, q, s3.set(s.sx * br, 1, s.sz * br)));
      }
      banks.instanceMatrix.needsUpdate = true;
    }
    if (fall?.visible) {
      const u = fall.material.uniforms, box = u.uBox.value, gy = cam.y ?? hAt(cam.x, cam.z), kind = fall.userData.kind;
      u.uTime.value = t;
      u.uAlpha.value = FALLS[kind].alpha * fallA * (FALL[wxNow] || kind !== 'rain' ? 1 : shower.rain);
      u.uBoxMin.value.set(cam.x - box.x / 2, gy - (kind === 'dust' ? 1.5 : 4), cam.z - box.z / 2);
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
        const px = b.cx + Math.cos(a) * b.r, pz = b.cz + Math.sin(a) * b.r;
        p3.set(px, hAt(px, pz) + b.y + Math.sin(t * 0.4 + b.bob) * 0.8, pz);
        e.set(0, Math.atan2(-Math.sin(a) * dir, Math.cos(a) * dir), 0.3 * dir);
        birds.setMatrixAt(i, m4.compose(p3, q.setFromEuler(e), s3.set(1.3, 1.3, 1.3)));
      });
      birds.instanceMatrix.needsUpdate = true;
    }
  }

  return {
    start, update, setWeather,
    // showers and the wet ground they leave, 0-1 each (snapshot.wx)
    setRain(rain, wet) {
      if (rain === shower.rain && wet === shower.wet) return;
      shower = { rain, wet };
      if (on) blend();
    },
    get mood() { return moodName; },
    get weather() { return wxNow; },
    // debug: hide everything this module draws (for measuring its cost)
    setEnabled(v) { enabled = !!v; root.visible = on && enabled; },
  };
}
