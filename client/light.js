// World light and frame: tone mapping, a warm low sun whose shadow box follows the view, sky fill, haze, the planning
// table and the terrain board's cut earth edge, and (Graphics High only) a soft blur along the far, top edge of the
// screen. main.js calls setupLight() once and renderFrame() in place of renderer.render().
import * as THREE from 'three';
import { gfx, watchFps } from './gfx.js';

// "Painted miniature": every lit material gets slightly richer color before lighting. Patching ShaderLib before the
// first compile reaches every Lambert / Phong / Toon / Standard material in one place.
const SAT = 1.1;
for (const id of ['lambert', 'phong', 'toon', 'standard', 'physical']) {
  const lib = THREE.ShaderLib[id];
  if (!lib || lib.fragmentShader.includes('miniature')) continue;
  lib.fragmentShader = lib.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
	// painted miniature: a little more saturation
	diffuseColor.rgb = max( mix( vec3( dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) ) ), diffuseColor.rgb, ${SAT.toFixed(2)} ), 0.0 );`);
}

// The sun sits up and to the right of each player's opening view, so shadows fall toward the lower left of the screen
// (as in the concept) whichever spawn you get. It stays put in the world when you rotate.
const SUN_SIDE = 60 * Math.PI / 180;
const SUN_DIR = new THREE.Vector3(); // from the ground toward the sun
const HAZE = 0xbcae96;
export const BOARD = 9; // board thickness below its lowest point, in meters (deep enough that the soil layers read)
// The map's mood (client/atmosphere.js) sets these: sun height in degrees (read when a match starts) and how much
// closer the haze sits (1 = the default distances).
export const sky = { sunUp: 37, haze: 1 };
const WOOD_TILE = 44; // meters per wood texture repeat (four planks)
const SOIL_PROFILE = 8, SOIL_DEEP = 2.5; // the full soil profile spans 8 m; below it dark soil repeats every 2.5 m
const SOIL_U = (SOIL_PROFILE / 0.8) * 3.17; // horizontal meters per soil repeat (texture is 3.17:1, profile = top 80%)
const BLUR_START = 0.75; // blur fades in from 75% of the screen height up to the top edge
const BLUR_SIGMA = 1.6; // Gaussian sigma at the very top, in pixels at 1080 lines
const EDIT = new URLSearchParams(location.search).has('edit');

let renderer, scene, camera, sun, hemi, gfxBtn = null, lastT = performance.now();
const v3 = new THREE.Vector3(), v3b = new THREE.Vector3();

// ---------- setup ----------

export function setupLight(r, s, c) {
  renderer = r; scene = s; camera = c;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.info.autoReset = false; // renderFrame resets once, so renderer.info covers every pass of a frame

  scene.background = new THREE.Color(HAZE);
  scene.fog = new THREE.Fog(HAZE, 50, 300);
  hemi = new THREE.HemisphereLight(0xc9d6e4, 0x5a4a32, 0.9);
  sun = new THREE.DirectionalLight(0xffd6a8, 3.2);
  sun.castShadow = true;
  sun.shadow.bias = -0.0003;
  scene.add(hemi, sun, sun.target);

  const menu = document.getElementById('menu');
  if (menu) {
    gfxBtn = document.createElement('button');
    gfxBtn.id = 'gfxBtn';
    gfxBtn.title = 'Low turns off the far-edge blur and uses cheaper shadows';
    gfxBtn.onclick = () => gfx.set(gfx.low ? 'high' : 'low');
    menu.insertBefore(gfxBtn, document.getElementById('leaveBtn'));
  }
  applyGfx();
  gfx.onChange(applyGfx);
  return { sun, hemi };
}

function applyGfx() {
  const low = gfx.low;
  renderer.shadowMap.type = low ? THREE.BasicShadowMap : THREE.PCFShadowMap; // three rebuilds the map on a type change
  sun.shadow.mapSize.set(low ? 1024 : 2048, low ? 1024 : 2048);
  sun.shadow.radius = low ? 1 : 2.5;
  if (low) dropTargets();
  if (gfxBtn) gfxBtn.textContent = `Graphics: ${low ? 'Low' : 'High'}`;
}

function notice(msg) {
  const el = document.getElementById('status');
  if (!el) return;
  el.textContent = msg;
  setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 6000);
}

// ---------- per frame ----------

// cam is main.js's camera rig ({ x, z, y, dist }); ground is the terrain mesh (or null before a match).
export function renderFrame(cam, ground) {
  const now = performance.now(), dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
  renderer.info.reset();
  if (ground) {
    watchFps(dt, notice);
    // a new match (new ground mesh) re-aims the sun for this player's view; the editor keeps one sun per map size
    if (ground !== board.mesh) {
      const prm = ground.geometry.parameters, box = ground.geometry.boundingBox;
      const key = prm ? `${prm.width}x${prm.height}` : `${box?.max.x}x${box?.max.z}`;
      if (!EDIT || key !== board.key) aimSun(cam?.yaw ?? 0);
      board.mesh = ground; board.key = key;
    }
    if (ground.geometry !== board.geo) buildBoard(ground);
  }
  followView(cam);
  if (gfx.low) renderer.render(scene, camera);
  else renderBlurred();
}

// Haze scales with zoom, and the sun's shadow box covers just what the camera sees, so shadows stay crisp.
const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]], foot = corners.map(() => new THREE.Vector3());
const center = new THREE.Vector3(), lx = new THREE.Vector3(), ly = new THREE.Vector3();
function aimSun(yaw) {
  const az = yaw + Math.PI - SUN_SIDE; // the camera looks along -(sin yaw, cos yaw); turn right of that by SUN_SIDE
  const up = sky.sunUp * Math.PI / 180;
  SUN_DIR.set(Math.sin(az) * Math.cos(up), Math.sin(up), Math.cos(az) * Math.cos(up));
  lx.crossVectors(new THREE.Vector3(0, 1, 0), SUN_DIR).normalize(); ly.crossVectors(SUN_DIR, lx); // shadow camera axes
}
aimSun(0);
function followView(cam) {
  const dist = cam?.dist ?? 85, gy = cam?.y ?? 0;
  scene.fog.near = dist * 0.7 / sky.haze; scene.fog.far = dist * 4.5 / sky.haze;

  camera.updateMatrixWorld();
  center.set(0, 0, 0);
  corners.forEach(([sx, sy], i) => {
    const dir = v3.set(sx, sy, 0.5).unproject(camera).sub(camera.position).normalize();
    const t = dir.y < -0.02 ? Math.min(600, (gy - camera.position.y) / dir.y) : 600;
    foot[i].copy(camera.position).addScaledVector(dir, t);
    center.add(foot[i]);
  });
  center.multiplyScalar(0.25);
  let rad = 0;
  for (const p of foot) rad = Math.max(rad, p.distanceTo(center));
  rad = Math.ceil((rad + 10) / 8) * 8; // steps of 8 m, so panning doesn't resize the shadow map

  // snap the box center to whole shadow texels in light space: shadow edges don't crawl while panning
  const texel = (2 * rad) / sun.shadow.mapSize.x;
  const a = Math.round(center.dot(lx) / texel) * texel, b = Math.round(center.dot(ly) / texel) * texel, c = center.dot(SUN_DIR);
  sun.target.position.copy(lx).multiplyScalar(a).addScaledVector(ly, b).addScaledVector(SUN_DIR, c);
  sun.position.copy(sun.target.position).addScaledVector(SUN_DIR, rad + 120);
  sun.target.updateMatrixWorld();
  const sc = sun.shadow.camera;
  if (sc.right !== rad) {
    Object.assign(sc, { left: -rad, right: rad, top: rad, bottom: -rad, near: 1, far: 2 * rad + 240 });
    sc.updateProjectionMatrix();
  }
  sun.shadow.normalBias = texel * 0.8;
}

// ---------- planning table and the board's cut earth edge ----------

const loader = new THREE.TextureLoader();
const texture = (file, wrapT) => {
  const t = loader.load(new URL(`./textures/${file}`, import.meta.url).href);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.wrapT = wrapT; t.anisotropy = 8;
  return t;
};
const board = { mesh: null, key: '', geo: null, table: null, skirt: null, contact: null, woodTex: null, soilTex: null };

function buildBoard(ground) {
  board.geo = ground.geometry;
  const prm = board.geo.parameters, pos = board.geo.attributes.position, edge = ground.userData.edge;
  const plane = prm?.widthSegments !== undefined;
  if (!plane && !edge) return; // neither a PlaneGeometry nor the relief (client/relief.js): nothing to frame
  board.woodTex ??= texture('table-wood.jpg', THREE.RepeatWrapping);
  board.soilTex ??= texture('board-soil.jpg', THREE.ClampToEdgeWrapping);
  board.woodTex.anisotropy = board.soilTex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  ground.updateWorldMatrix(true, false);
  let low = Infinity, high = -Infinity;
  for (let i = 0; i < pos.count; i++) { const y = v3.fromBufferAttribute(pos, i).applyMatrix4(ground.matrixWorld).y; low = Math.min(low, y); high = Math.max(high, y); }
  const bottom = low - BOARD;

  // four sides walked around the edge; each side is a strip of columns from the ground edge down to the table
  let c00, c11, sides;
  if (plane) {
    const W = prm.widthSegments, H = prm.heightSegments, world = (ix, iy) => new THREE.Vector3().fromBufferAttribute(pos, iy * (W + 1) + ix).applyMatrix4(ground.matrixWorld);
    const range = (n, rev) => Array.from({ length: n + 1 }, (_, i) => (rev ? n - i : i));
    c00 = world(0, 0); c11 = world(W, H);
    sides = [
      range(W).map(ix => world(ix, 0)), range(H).map(iy => world(W, iy)),
      range(W, true).map(ix => world(ix, H)), range(H, true).map(iy => world(0, iy)),
    ];
  } else {
    // the relief's geometry is in world space over x 0..w, z 0..h: sample its exact surface at every vertex step,
    // twice where a cliff meets the edge (the heights just before and just after the cell boundary)
    const box = board.geo.boundingBox, x0 = box.min.x, z0 = box.min.z, x1 = box.max.x, z1 = box.max.z, E = 1e-4;
    const walk = (ax, az, bx, bz) => {
      const len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(len / edge.step)), dx = (bx - ax) / len, dz = (bz - az) / len, pts = [];
      for (let i = 0; i <= n; i++) {
        const t = len * i / n, x = ax + dx * t, z = az + dz * t;
        const before = edge.hAt(x - dx * E, z - dz * E), after = edge.hAt(x + dx * E, z + dz * E);
        if (i > 0) pts.push(new THREE.Vector3(x, before, z));
        if (i === 0 || (i < n && Math.abs(after - before) > 1e-3)) pts.push(new THREE.Vector3(x, after, z));
      }
      return pts;
    };
    c00 = new THREE.Vector3(x0, 0, z0); c11 = new THREE.Vector3(x1, 0, z1);
    sides = [walk(x0, z0, x1, z0), walk(x1, z0, x1, z1), walk(x1, z1, x0, z1), walk(x0, z1, x0, z0)];
  }
  const mid = c00.clone().add(c11).multiplyScalar(0.5);
  // rows at fixed depths below each column's top: the soil profile first, then repeating deep soil
  const rows = [0, SOIL_PROFILE];
  for (let d = SOIL_PROFILE + SOIL_DEEP; d < high - bottom + SOIL_DEEP; d += SOIL_DEEP) rows.push(d);
  const vAt = (d) => {
    if (d <= SOIL_PROFILE) return 1 - 0.8 * (d / SOIL_PROFILE);
    const m = (d - SOIL_PROFILE) / SOIL_DEEP, f = m - Math.floor(m);
    return Math.floor(m) % 2 ? 0.2 * f : 0.2 * (1 - f); // mirrored, so the deep band repeats without a seam
  };
  const P = [], N = [], UV = [], I = [];
  let u = 0;
  for (const pts of sides) {
    const t = v3b.subVectors(pts[pts.length - 1], pts[0]).setY(0).normalize();
    const out = new THREE.Vector3(t.z, 0, -t.x);
    if (out.dot(v3.subVectors(pts[0], mid).add(pts[pts.length - 1]).sub(mid)) < 0) out.negate();
    const flip = new THREE.Vector3(0, -1, 0).cross(t).dot(out) < 0; // wind the triangles to face outward
    const base = P.length / 3, R = rows.length;
    pts.forEach((p, j) => {
      if (j) u += p.distanceTo(pts[j - 1]) / SOIL_U;
      for (const d of rows) {
        const dd = Math.min(d, p.y - bottom);
        P.push(p.x, p.y - dd, p.z); N.push(out.x, 0, out.z); UV.push(u, vAt(dd));
      }
    });
    for (let j = 0; j < pts.length - 1; j++) for (let k = 0; k < R - 1; k++) {
      const a = base + j * R + k, b = a + R, c = a + 1, d = b + 1;
      if (flip) I.push(a, b, c, b, d, c); else I.push(a, c, b, b, c, d);
    }
  }
  const skirtGeo = new THREE.BufferGeometry();
  skirtGeo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  skirtGeo.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  skirtGeo.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  skirtGeo.setIndex(I);
  if (!board.skirt) {
    // a small emissive lift (through the soil texture) keeps the layers readable on the side away from the sun
    board.skirt = new THREE.Mesh(skirtGeo, new THREE.MeshLambertMaterial({ map: board.soilTex, color: 0xe8ddd0, emissive: 0x5a5044, emissiveMap: board.soilTex }));
    board.skirt.castShadow = board.skirt.receiveShadow = true;
    scene.add(board.skirt);
  } else { board.skirt.geometry.dispose(); board.skirt.geometry = skirtGeo; }

  // the planning table: one big plane far past every edge the camera can reach
  const size = Math.max(Math.abs(c11.x - c00.x), Math.abs(c11.z - c00.z)) + 1400;
  if (!board.table) {
    board.table = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshLambertMaterial({ map: board.woodTex, color: 0xc8b8a8 }));
    // no shadow-map shadow on the table: the board's would end in stair steps along its foot. A soft painted
    // contact shadow grounds the board instead.
    board.table.rotation.x = -Math.PI / 2; board.table.receiveShadow = false;
    scene.add(board.table);
  }
  const contactGeo = contactShadow(Math.min(c00.x, c11.x), Math.min(c00.z, c11.z), Math.max(c00.x, c11.x), Math.max(c00.z, c11.z), bottom + 0.01);
  if (!board.contact) {
    board.contact = new THREE.Mesh(contactGeo, new THREE.MeshBasicMaterial({ color: 0x1a140c, vertexColors: true, transparent: true, depthWrite: false }));
    scene.add(board.contact);
  } else { board.contact.geometry.dispose(); board.contact.geometry = contactGeo; }
  board.table.scale.set(size, size, 1);
  board.table.position.set(mid.x, bottom - 0.02, mid.z);
  board.woodTex.repeat.set(size / WOOD_TILE, size / WOOD_TILE);
  board.woodTex.offset.set(((mid.x - size / 2 - Math.min(c00.x, c11.x)) / WOOD_TILE) % 1, 0); // a plank joint at the board's west edge
}

// rings around the board's footprint, from its foot outward: [distance m, shadow alpha], with mitered corners
const CONTACT = [[0, 0.5], [1.2, 0.26], [5.5, 0]];
function contactShadow(x0, z0, x1, z1, y) {
  const P = [], C = [], I = [], n = CONTACT.length;
  for (const [d, a] of CONTACT) for (const [x, z] of [[x0 - d, z0 - d], [x1 + d, z0 - d], [x1 + d, z1 + d], [x0 - d, z1 + d]]) { P.push(x, y, z); C.push(1, 1, 1, a); }
  for (let r = 0; r < n - 1; r++) for (let k = 0; k < 4; k++) {
    const a = r * 4 + k, b = r * 4 + (k + 1) % 4, c = a + 4, d = b + 4;
    I.push(a, b, c, b, d, c); // counter-clockwise from above, so the strip faces up
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 4));
  g.setIndex(I);
  return g;
}

// ---------- far-edge blur (High only) ----------

// scene -> sceneRT (MSAA, half float, still linear) -> horizontal blur of the top rows -> vertical blur to the screen,
// where tone mapping and the sRGB conversion happen.
let sceneRT = null, blurRT = null;
const size = new THREE.Vector2();
const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const tri = new THREE.BufferGeometry();
tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
tri.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
const vert = /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }`;
const blurBody = (axis) => /* glsl */`
  float w = smoothstep( start, 1.0, vUv.y ), s = w * sigma;
  vec4 sum = vec4( 0.0 ); float tot = 0.0;
  for ( int k = -4; k <= 4; k ++ ) {
    float x = float( k ) * 0.6, g = exp( -0.5 * x * x );
    sum += texture2D( tBlur, vUv + ${axis} * x * s * texel ) * g; tot += g;
  }`;
const uniforms = { tScene: { value: null }, tBlur: { value: null }, texel: { value: new THREE.Vector2() }, sigma: { value: BLUR_SIGMA }, start: { value: BLUR_START } };
const head = 'uniform sampler2D tScene, tBlur; uniform vec2 texel; uniform float sigma, start; varying vec2 vUv;';
const passH = new THREE.Mesh(tri, new THREE.ShaderMaterial({
  uniforms, vertexShader: vert, depthTest: false, depthWrite: false,
  fragmentShader: `${head}\nvoid main() {\n${blurBody('vec2( 1.0, 0.0 )')}\n  gl_FragColor = sum / tot;\n}`,
}));
const passV = new THREE.Mesh(tri, new THREE.ShaderMaterial({
  uniforms, vertexShader: vert, depthTest: false, depthWrite: false,
  fragmentShader: `${head}\nvoid main() {\n  if ( vUv.y < start ) { gl_FragColor = texture2D( tScene, vUv ); } else {\n${blurBody('vec2( 0.0, 1.0 )')}\n  gl_FragColor = sum / tot; }\n  #include <tonemapping_fragment>\n  #include <colorspace_fragment>\n}`,
}));
passH.frustumCulled = passV.frustumCulled = false;
const sceneH = new THREE.Scene().add(passH), sceneV = new THREE.Scene().add(passV);

function dropTargets() {
  sceneRT?.dispose(); blurRT?.dispose(); sceneRT = blurRT = null;
}

function renderBlurred() {
  renderer.getDrawingBufferSize(size);
  const w = Math.max(1, size.x), h = Math.max(1, size.y);
  if (!sceneRT || sceneRT.width !== w || sceneRT.height !== h) {
    dropTargets();
    // 4x MSAA like the canvas; on high-density screens the extra pixels already smooth edges
    sceneRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: renderer.getPixelRatio() > 1.25 ? 0 : 4, resolveDepthBuffer: false });
    blurRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: false });
    // the horizontal pass only needs the top rows (plus a margin for the vertical taps)
    const y0 = Math.max(0, Math.floor(h * BLUR_START) - 24);
    blurRT.scissor.set(0, y0, w, h - y0); blurRT.scissorTest = true;
    uniforms.tScene.value = sceneRT.texture;
    uniforms.texel.value.set(1 / w, 1 / h);
    uniforms.sigma.value = BLUR_SIGMA * h / 1080;
  }
  renderer.setRenderTarget(sceneRT);
  renderer.render(scene, camera);
  uniforms.tBlur.value = sceneRT.texture;
  renderer.setRenderTarget(blurRT);
  renderer.render(sceneH, quadCam);
  uniforms.tBlur.value = blurRT.texture;
  renderer.setRenderTarget(null);
  renderer.render(sceneV, quadCam);
}
