// Atmosphere: the weather that goes with each map's light (client/moods.js is the table, client/light.js applies the
// sun and haze): slow cloud shadows drifting over the terrain and the land around it, river mist, falling snow or
// blowing dust, and a few birds circling low. main.js calls createAtmosphere() once, start() from startGame and
// update(dt) every frame.
//
// Cost in draw calls: cloud shade 2 (map and the land around it), river mist 1 (dawn maps), snow or dust 1 (those
// maps), four birds 1. Graphics Low turns off the cloud shade, the weather and the birds, and uses fewer mist sheets.
//
// Fog of war: everything over the map is transparent, writes no depth and draws before the fog overlay (renderOrder 1
// in main.js), so unseen ground darkens the cloud shade, mist, flakes and birds like the terrain they cover.
import * as THREE from 'three';
import { gfx } from './gfx.js';
import { setMood } from './light.js';
import { MOODS, moodFor } from './moods.js';

const TAU = Math.PI * 2;
const WL = Math.hypot(0.55, 0.25), WX = 0.55 / WL, WZ = 0.25 / WL; // the way smoke drifts in fx.js
const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const seeded = (s) => () => (s = (s * 16807) % 2147483647) / 2147483647;

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
      strength: { value: 0.15 }, tint: { value: new THREE.Color(0x1d1f22) }, fade: { value: new THREE.Vector4(0, 0, 1e4, 2e4) },
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

// ---------- the module ----------

export function createAtmosphere({ scene, renderer, camera, cam }) {
  const root = new THREE.Group(); root.name = 'atmosphere'; root.visible = false;
  scene.add(root);
  let enabled = true, on = false, moodName = 'day', M = MOODS.day, t = 0, ground = null, groundGeo = null, MW = 0, MH = 0;
  let hAt = () => 0;

  // one cloud pattern over the map and over the apron around it (client/apron.js shares its near rows)
  const cloudMat = cloudMaterial();
  const cloudMap = new THREE.Mesh(new THREE.BufferGeometry(), cloudMat);
  const cloudApron = new THREE.Mesh(new THREE.BufferGeometry(), cloudMat);
  for (const m of [cloudMap, cloudApron]) { m.renderOrder = 0.6; m.raycast = () => {}; m.frustumCulled = false; root.add(m); }

  const MIST_CAP = 36;
  const mist = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: wispTexture(), color: 0xf3f0ea, transparent: true, opacity: 0.28, depthWrite: false, fog: true }), MIST_CAP);
  mist.renderOrder = 0.7; mist.frustumCulled = false; mist.raycast = () => {}; mist.count = 0;
  root.add(mist);
  let sites = [];

  let weather = null;
  const BIRDS = 4, birds = birdMesh(BIRDS);
  root.add(birds);
  let flight = [];

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ'), p3 = new THREE.Vector3(), s3 = new THREE.Vector3(), v2 = new THREE.Vector2();
  const UP = new THREE.Vector3(0, 1, 0);

  function applyMood() {
    setMood(M); // sun, sky fill, haze, exposure, shadow softness (client/light.js)
    cloudMat.uniforms.strength.value = M.clouds;
  }

  function applyGfx() {
    const low = gfx.low;
    cloudMap.visible = cloudApron.visible = on && !low && M.clouds > 0;
    if (weather) weather.visible = on && !low && !reduceMotion && weather.userData.kind === M.weather;
    birds.visible = on && !low && !reduceMotion && flight.length > 0;
    mist.visible = on && !!M.mist && sites.length > 0;
    mist.count = Math.min(sites.length, low ? 18 : MIST_CAP);
  }
  gfx.onChange(applyGfx);

  // apron: client/apron.js's result, whose near rows carry the cloud shade past the map edge
  function start({ map, key, ground: g, hAt: h, apron }) {
    ground = g; hAt = h; groundGeo = g.geometry;
    // map size: client/relief.js gives its geometry fixed bounds (x and z from 0)
    const box = g.geometry.boundingBox;
    MW = box.max.x; MH = box.max.z;
    const cell = MW / map.w, hyp = Math.hypot(MW, MH) / 2;
    moodName = moodFor(map, key); M = MOODS[moodName];
    applyMood();

    cloudMap.geometry = g.geometry;
    cloudMap.position.copy(g.position); cloudMap.position.y += 0.06; cloudMap.rotation.copy(g.rotation);
    cloudApron.geometry = apron.overlayGeometry;
    cloudApron.position.y = 0.06;
    cloudMat.uniforms.fade.value.set(MW / 2, MH / 2, hyp + 180, hyp + 480);

    sites = M.mist ? mistSites(map, cell, hAt, MIST_CAP) : [];

    if (M.weather && weather?.userData.kind !== M.weather) {
      if (weather) { root.remove(weather); weather.geometry.dispose(); weather.material.dispose(); }
      weather = weatherPoints(M.weather); root.add(weather);
    }

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

  function update(dt) {
    if (!on || !ground) return;
    t = (t + dt) % 10000;
    // digging swaps the terrain geometry
    if (ground.geometry !== groundGeo) { groundGeo = ground.geometry; cloudMap.geometry = groundGeo; }
    if (cloudMap.visible) {
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
        const px = b.cx + Math.cos(a) * b.r, pz = b.cz + Math.sin(a) * b.r;
        p3.set(px, hAt(px, pz) + b.y + Math.sin(t * 0.4 + b.bob) * 0.8, pz);
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
