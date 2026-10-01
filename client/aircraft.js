// Aircraft look for the sand table: painted-miniature planes for each faction (a fighter, a ground-attack plane, a
// twin-engine bomber and a transport), spinning propellers, a soft ground shadow, damage smoke, shoot-downs, flak bursts
// and the Classic airfield. main.js creates one instance with createAviation() and calls the small API it returns.
//
// The plane models themselves are built in models/planes.js: ONE vertex-coloured mesh per aircraft and owner colour,
// shared by every plane of that kind (geometry and material), so a plane costs one draw call, one per propeller for
// the blades and one more for all its blur discs together.
// The owner's colour is on the wing tips, the whole fin and rudder, a band round the rear fuselage and the spinner or
// cowl lip, so you can tell whose plane it is from above. The body material draws the camouflage per pixel and a fill
// light in the paint's own colour (paintMaterial in models/planes.js); bare-metal planes get a shinier copy of it.
//
// Smoke and flak bursts are puffs from one pooled InstancedMesh (one draw call, a fixed number of puffs). Everything
// here only draws: the simulation decides what happens, and the shots it sends say when.
import * as THREE from 'three';
import { gfx } from './gfx.js';
import { plane, paintMaterial } from './models/planes.js';

const PI = Math.PI, TAU = Math.PI * 2;
const GLASS = 0x2f4452, DARK = 0x26241f, TIP = 0xd9b43a, WHITE = 0xece6d6, BLACK = 0x1c1b18, BLUE = 0x2a4a8f, RED = 0xc23a2a;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
let lastCamera = null;
const rememberCamera = (renderer, scene, camera) => { if (camera.isPerspectiveCamera) lastCamera = camera; };
const viewProjection = new THREE.Matrix4(), clipPoint = new THREE.Vector4(), heightBand = new THREE.Vector2();
function limitHeight(value, slope) {
  if (Math.abs(slope) < 1e-8) return value <= 0;
  if (slope > 0) heightBand.y = Math.min(heightBand.y, -value / slope);
  else heightBand.x = Math.max(heightBand.x, -value / slope);
  return heightBand.x <= heightBand.y;
}

// Lower support planes into the view, keeping at least 6 m of ground clearance.
function supportHeight(x, z, y, ground) {
  if (!lastCamera) return y;
  const floor = ground + 6, height = Math.max(0, y - floor);
  viewProjection.multiplyMatrices(lastCamera.projectionMatrix, lastCamera.matrixWorldInverse);
  clipPoint.set(x, floor, z, 1).applyMatrix4(viewProjection);
  const m = viewProjection.elements, p = clipPoint;
  heightBand.set(0, height);
  if (!limitHeight(p.y - 0.6 * p.w, m[5] - 0.6 * m[7]) || !limitHeight(0.001 - p.w, -m[7])) return floor;
  const top = heightBand.y;
  // Keep the horizontal margin too when a lower height can reach it.
  if (!limitHeight(p.x - 0.94 * p.w, m[4] - 0.94 * m[7]) || !limitHeight(-p.x - 0.94 * p.w, -m[4] - 0.94 * m[7])) return floor + top;
  return floor + heightBand.y;
}

// ---------- shared shapes (the airfield, bombs and propellers) ----------

const star = (R, r) => {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) { const a = PI / 2 + i * PI / 5, q = i % 2 ? r : R; (i ? s.lineTo : s.moveTo).call(s, Math.cos(a) * q, Math.sin(a) * q); }
  return new THREE.ShapeGeometry(s);
};
// shared source shapes; every part is a transformed copy of one of these
const SRC = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 10).rotateZ(PI / 2),      // axis along x
  cone: new THREE.ConeGeometry(1, 1, 10).rotateZ(-PI / 2),           // tip toward +x
  disc: new THREE.CircleGeometry(1, 16),
  star: star(1, 0.42),
};
const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3();
const xf = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) =>
  new THREE.Matrix4().compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));

// Merge parts ({ geo, color, m }) into one geometry with position, normal and (linear) vertex colour.
function merge(parts) {
  const pos = [], nor = [], col = [], c = new THREE.Color();
  for (const p of parts) {
    const g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
    if (p.m) g.applyMatrix4(p.m);
    const pa = g.attributes.position, na = g.attributes.normal;
    c.set(p.color);
    for (let i = 0; i < pa.count; i++) { pos.push(pa.getX(i), pa.getY(i), pa.getZ(i)); nor.push(na.getX(i), na.getY(i), na.getZ(i)); col.push(c.r, c.g, c.b); }
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return out;
}

// The faction's marking as flat parts in a unit frame (x across, y up the page, layers stacked in z).
function insignia(fac, r) {
  const F = (geo, color, layer, sx, sy, x = 0, y = 0) => ({ geo, color, m: xf(x, y, layer * 0.025, 0, 0, 0, sx, sy, 0.01) });
  if (fac === 0) return [F(SRC.box, BLUE, 0, 4.6 * r, 0.62 * r), F(SRC.disc, BLUE, 0, r, r), F(SRC.star, WHITE, 1, 0.8 * r, 0.8 * r), F(SRC.box, WHITE, 1, 0.9 * r, 0.34 * r, 1.55 * r), F(SRC.box, WHITE, 1, 0.9 * r, 0.34 * r, -1.55 * r)];
  if (fac === 1) return [F(SRC.box, WHITE, 0, 2.3 * r, 0.74 * r), F(SRC.box, WHITE, 0, 0.74 * r, 2.3 * r), F(SRC.box, BLACK, 1, 2 * r, 0.5 * r), F(SRC.box, BLACK, 1, 0.5 * r, 2 * r)];
  return [F(SRC.star, WHITE, 0, 1.2 * r, 1.2 * r), F(SRC.star, RED, 1, r, r)];
}
const FLAT = new THREE.Matrix4().makeRotationY(-PI / 2).multiply(new THREE.Matrix4().makeRotationX(-PI / 2)); // lies on a wing: x across, y forward

export const ROLE_OF_UNIT = { fighter: 'fighter', attacker: 'attacker', bomber: 'bomber', transport: 'transport' }; // the last two: the model viewer
// which plane each kind of air support flies
export const ROLE_OF_SUPPORT = { recon: 'fighter', strafe: 'attacker', dive: 'attacker', bombing: 'bomber', para: 'transport' };

// ---------- shared materials, built models, shadows ----------

const BODY_MAT = paintMaterial(new THREE.MeshLambertMaterial({ vertexColors: true }));
const METAL_MAT = paintMaterial(new THREE.MeshPhongMaterial({ vertexColors: true, specular: 0x3a3a3a, shininess: 26 }));
const FIELD_MAT = new THREE.MeshLambertMaterial({ vertexColors: true });
const BLADE_MAT = new THREE.MeshLambertMaterial({ vertexColors: true });
const DISC_MAT = new THREE.MeshBasicMaterial({ color: 0x30302a, transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide });
const BOMB_GEO = merge([{ geo: SRC.cyl, color: 0x34362a, m: xf(0, 0, 0, 0, 0, 0, 1.5, .26, .26) }, { geo: SRC.cyl, color: TIP, m: xf(.3, 0, 0, 0, 0, 0, .15, .27, .27) }, { geo: SRC.cone, color: 0x34362a, m: xf(.95, 0, 0, 0, 0, 0, .4, .26, .26) }]);

const built = new Map(), bladeGeo = new Map(), discGeo = new Map(), shadowMats = new Map();

function bladesFor(n, r, tip = TIP) {
  const key = n + ':' + r + ':' + tip;
  if (!bladeGeo.has(key)) {
    const parts = [];
    for (let i = 0; i < n; i++) {
      const a = i * TAU / n;
      parts.push({ geo: SRC.box, color: DARK, m: xf(0, 0, 0, a).multiply(xf(0, r * .42, 0, 0, 0, 0, .05, r * .84, .17)) },
        { geo: SRC.box, color: tip, m: xf(0, 0, 0, a).multiply(xf(0, r * .92, 0, 0, 0, 0, .055, r * .16, .17)) });
    }
    bladeGeo.set(key, merge(parts));
    discGeo.set(key, new THREE.CircleGeometry(r, 18).rotateY(PI / 2));
  }
  return key;
}

// the soft ground shadow: the plane's own outline, painted a few times slightly larger so the edge is soft
function shadowMat(key, polys, ext) {
  if (shadowMats.has(key)) return shadowMats.get(key);
  let tex = null;
  if (typeof document !== 'undefined') {
    const S = 128, cv = document.createElement('canvas'); cv.width = cv.height = S;
    const c = cv.getContext('2d'), k = S / 2 / ext;
    c.fillStyle = 'rgba(26, 20, 10, 0.1)';
    for (let pass = 0; pass < 7; pass++) {
      const grow = 1 + pass * 0.06;
      for (const poly of polys) {
        c.beginPath();
        poly.forEach(([x, z], i) => { const px = S / 2 + x * k * grow, py = S / 2 + z * k * grow; if (i) c.lineTo(px, py); else c.moveTo(px, py); });
        c.fill();
      }
    }
    tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  }
  const m = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  m.userData.ext = ext;
  shadowMats.set(key, m);
  return m;
}
const shadowGeos = new Map();
const shadowGeo = (ext) => { const k = ext.toFixed(2); if (!shadowGeos.has(k)) shadowGeos.set(k, new THREE.PlaneGeometry(ext * 2, ext * 2).rotateX(-PI / 2)); return shadowGeos.get(k); };

// build (once) the merged model for a faction, role and owner colour
function model(fac, role, ownerColor) {
  const key = `${fac}:${role}:${ownerColor}`;
  let m = built.get(key);
  if (m) return m;
  const spec = plane(fac, role, ownerColor);
  m = { key, ...spec, props: spec.props.map((p) => ({ ...p, blades: bladesFor(p.n, p.r, spec.tip ?? TIP) })) };
  // the blur discs of all the propellers as one mesh: a plain disc looks the same however far it has turned
  m.discs = merge(m.props.map((p) => ({ geo: discGeo.get(p.blades), m: new THREE.Matrix4().makeTranslation(p.x, p.y, p.z) })));
  const ext = Math.max(spec.span, spec.len) / 2 * 1.12;
  m.shadow = shadowMat(`${fac}:${role}`, spec.polys, ext);
  m.ext = ext;
  built.set(key, m);
  return m;
}

// ---------- the module ----------

export function createAviation(ctx) {
  const { hAt, UNITS } = ctx, alt = ctx.altitude ?? 20;
  const live = [];          // timed effects: { tick(dt) -> false when finished, kill() }
  const bombPool = [], bombAxis = new THREE.Vector3(1, 0, 0), bombVelocity = new THREE.Vector3();
  function takeBomb() {
    if (!bombPool.length) for (let i = 0; i < 8; i++) {
      const mesh = new THREE.Mesh(BOMB_GEO, BODY_MAT);
      mesh.scale.setScalar(1.4); mesh.visible = false; mesh.userData.busy = false;
      bombPool.push(mesh);
    }
    const mesh = bombPool.find((b) => !b.userData.busy);
    if (!mesh) return null;
    mesh.userData.busy = true; mesh.visible = true; ctx.world().add(mesh);
    return mesh;
  }
  const hideBomb = (mesh) => { if (mesh) { mesh.visible = false; mesh.userData.busy = false; } };
  let puffs = null;

  // ----- pooled smoke -----
  // Soft lumpy sprites (one canvas texture, tinted per puff) that always face the camera, drawn as one InstancedMesh.
  // Per puff the shader gets an alpha and a turn angle; the matrix carries position and size.
  const CAP = 220;
  function puffTexture() {
    if (typeof document === 'undefined') return null;
    const S = 64, cv = document.createElement('canvas'); cv.width = cv.height = S;
    const c = cv.getContext('2d');
    for (const [x, y, r, a] of [[0.5, 0.5, 0.42, 0.85], [0.36, 0.42, 0.26, 0.6], [0.64, 0.4, 0.27, 0.6], [0.44, 0.66, 0.26, 0.55], [0.67, 0.64, 0.24, 0.55]]) {
      const g = c.createRadialGradient(x * S, y * S, 0, x * S, y * S, r * S);
      g.addColorStop(0, `rgba(255,255,255,${a})`); g.addColorStop(0.55, `rgba(255,255,255,${a * 0.55})`); g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g; c.fillRect(0, 0, S, S);
    }
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  function makePuffs() {
    const geo = new THREE.PlaneGeometry(2, 2);
    const alpha = new THREE.InstancedBufferAttribute(new Float32Array(CAP).fill(1), 1), turn = new THREE.InstancedBufferAttribute(new Float32Array(CAP), 1);
    alpha.setUsage(THREE.DynamicDrawUsage); turn.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aAlpha', alpha); geo.setAttribute('aTurn', turn);
    const mat = new THREE.MeshBasicMaterial({ map: puffTexture(), transparent: true, depthWrite: false });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aAlpha;\nattribute float aTurn;\nvarying float vAlpha;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAlpha = aAlpha;')
        .replace('#include <project_vertex>', `vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
float bs = length(instanceMatrix[0].xyz), bc = cos(aTurn), bn = sin(aTurn);
mvPosition.xy += vec2(position.x * bc - position.y * bn, position.x * bn + position.y * bc) * bs;
gl_Position = projectionMatrix * mvPosition;`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vAlpha;').replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= vAlpha;');
    };
    const mesh = new THREE.InstancedMesh(geo, mat, CAP);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.setColorAt(0, new THREE.Color(1, 1, 1)); mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0; mesh.frustumCulled = false; mesh.renderOrder = 3;
    return { mesh, alpha, turn, list: [] };
  }
  const mtx = new THREE.Matrix4(), ZERO = new THREE.Quaternion(), tints = new Map();
  const tint = (hex) => { let c = tints.get(hex); if (!c) tints.set(hex, c = new THREE.Color(hex)); return c; };
  // one puff: from size s0 to s1 over its life, fading out; colour as 0xrrggbb; (vx, vy, vz) its drift
  function puff(x, y, z, s0, s1, life, color, a = 0.8, vx = 0, vy = 0.6, vz = 0) {
    puffs ??= makePuffs();
    if (puffs.list.length >= CAP) return;
    puffs.list.push({ x, y, z, s0, s1, life, age: 0, c: tint(color), a, vx, vy, vz, r0: Math.random() * TAU, spin: (Math.random() - 0.5) * 0.8 });
  }
  function tickPuffs(dt) {
    if (!puffs) return;
    const world = ctx.world();
    if (puffs.mesh.parent !== world && world) world.add(puffs.mesh);
    const L = puffs.list;
    let n = 0;
    for (let i = 0; i < L.length; i++) {
      const p = L[i]; p.age += dt;
      if (p.age >= p.life) continue;
      const t = p.age / p.life;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const s = p.s0 + (p.s1 - p.s0) * Math.sqrt(t);
      puffs.mesh.setMatrixAt(n, mtx.compose(_p.set(p.x, p.y, p.z), ZERO, _s.set(s, s, s)));
      puffs.mesh.instanceColor.setXYZ(n, p.c.r, p.c.g, p.c.b);
      puffs.alpha.setX(n, p.a * Math.min(1, (1 - t) * 2.4, t * 14 + 0.25));
      puffs.turn.setX(n, p.r0 + p.spin * p.age);
      L[n++] = p;
    }
    L.length = n;
    puffs.mesh.count = n;
    puffs.mesh.instanceMatrix.needsUpdate = puffs.mesh.instanceColor.needsUpdate = puffs.alpha.needsUpdate = puffs.turn.needsUpdate = true;
  }

  const rnd = (a, b) => a + Math.random() * (b - a), jit = (m) => (Math.random() - 0.5) * m;
  // a dark flak burst: a quick flash and a few chunky black puffs that hang and thin out
  function burst(x, y, z, big = 1) {
    puff(x, y, z, 1.4 * big, 3.6 * big, 0.16, 0xffd070, 1, 0, 0, 0);
    for (let i = 0, n = gfx.low ? 2 : 4; i < n; i++) {
      const a = Math.random() * TAU, d = Math.random() * 0.9 * big;
      puff(x + Math.cos(a) * d, y + jit(0.8 * big), z + Math.sin(a) * d, rnd(1.3, 1.9) * big, rnd(3, 4.6) * big, rnd(1.3, 2), i % 2 ? 0x2f2d2a : 0x58544c, 0.85, jit(0.8), rnd(0.4, 0.9), jit(0.8));
    }
  }
  // damage smoke: grey, or black when heavy; a flame flicker
  const smoke = (x, y, z, heavy) => puff(x + jit(0.5), y + jit(0.3), z + jit(0.5), heavy ? rnd(1.1, 1.6) : rnd(0.8, 1.2), heavy ? rnd(3.2, 4.2) : rnd(2.6, 3.4), gfx.low ? 1.1 : rnd(1.5, 2.1), heavy ? 0x38342f : 0x8d887d, heavy ? 0.9 : 0.7, jit(0.5), rnd(0.6, 1.2), jit(0.5));
  const flame = (x, y, z) => puff(x + jit(0.4), y, z + jit(0.4), 1.4, 0.4, 0.25, 0xff9430, 0.95, 0, 0.8, 0);

  // ----- plane instances -----
  // a plane Group (units: attached to the unit's root; effects: its own holder) with its propellers
  function instance(fac, role, owner, opts = {}) {
    const m = model(fac, role, ctx.colorOf(owner)), body = new THREE.Group(), props = [];
    body.rotation.order = 'ZXY';
    const mesh = new THREE.Mesh(m.geo, m.metal ? METAL_MAT : BODY_MAT); mesh.onBeforeRender = rememberCamera; body.add(mesh);
    for (const p of m.props) {
      const g = new THREE.Group(); g.position.set(p.x, p.y, p.z); g.rotation.x = Math.random() * TAU;
      g.add(new THREE.Mesh(bladeGeo.get(p.blades), BLADE_MAT));
      g.userData.spin = 22 + Math.random() * 4; body.add(g); props.push(g);
    }
    body.add(new THREE.Mesh(m.discs, DISC_MAT));
    if (opts.bomb && !m.belly) { const b = new THREE.Mesh(BOMB_GEO, BODY_MAT); b.position.set(0.3, -0.85, 0); body.add(b); }
    return { body, props, m };
  }
  const shadowOf = (m) => { const s = new THREE.Mesh(shadowGeo(m.ext), m.shadow); s.renderOrder = 1; s.visible = false; return s; };
  const place = (shadow, x, y, z, yaw, scale = 1) => { shadow.position.set(x, y + 0.3, z); shadow.rotation.y = yaw; shadow.scale.setScalar(scale); };
  const spin = (props, dt) => { for (const p of props) p.rotation.x += dt * p.userData.spin; };

  // ----- a plane falling out of the sky -----
  // pos in world; heading is the direction of travel in the ground plane (radians, atan2(z, x)); holder carries the model
  function fall(f) {
    const { holder, body, shadow, m } = f;
    f.age = 0; f.roll = body.rotation.x; f.pitch = body.rotation.z;
    f.rollRate = (f.rollRate ?? 0) + 2 * (Math.random() < 0.5 ? -1 : 1); f.yaw = (0.9 + Math.random() * 0.8) * (Math.random() < 0.5 ? -1 : 1);
    let drip = 0;
    const e = {
      tick(dt) {
        f.age += dt; f.vy -= 14 * dt; f.speed *= Math.exp(-0.45 * dt); f.heading += f.yaw * dt;
        f.x += Math.cos(f.heading) * f.speed * dt; f.z += Math.sin(f.heading) * f.speed * dt; f.y += f.vy * dt;
        f.roll += f.rollRate * dt; f.rollRate += Math.sign(f.rollRate) * 5 * dt; f.pitch += (-1.05 - f.pitch) * (1 - Math.exp(-2.4 * dt));
        holder.position.set(f.x, f.y, f.z); holder.rotation.y = -f.heading; body.rotation.set(f.roll, 0, f.pitch);
        for (const p of f.props) p.rotation.x += dt * 30;
        const g = hAt(f.x, f.z);
        if (shadow) place(shadow, f.x, g, f.z, -f.heading, 1 + (f.y - g) * 0.012);
        if ((drip -= dt) <= 0) {
          drip = gfx.low ? 0.07 : 0.035;
          const bx = Math.cos(f.heading), bz = Math.sin(f.heading);
          smoke(f.x - bx * 3, f.y + 0.3, f.z - bz * 3, true); flame(f.x + bx * 2.5, f.y, f.z + bz * 2.5);
        }
        if (f.y <= g + 0.6 || f.age > 3) { crash(f.x, g, f.z, f.heading, f.speed); detach(); return false; }
        return true;
      },
      kill: () => detach(),
    };
    function detach() { holder.parent?.remove(holder); shadow?.parent?.remove(shadow); }
    live.push(e);
    return e;
  }

  const DEBRIS = new THREE.MeshLambertMaterial({ color: 0x2b2a25 });
  function crash(x, g, z, heading, speed) {
    ctx.explode(x, z, 3.6, { smokeK: 1.2 }); ctx.play('vehicle_destroyed', x, z); ctx.play('fire_loop', x, z, { delay: 0.5, dur: 9 });
    const low = gfx.low;
    for (let i = 0; i < (low ? 3 : 6); i++) puff(x + jit(2), g + 0.8, z + jit(2), 2, rnd(5, 6.5), 0.5, i % 2 ? 0xff9430 : 0xffd070, 0.9, jit(3), rnd(1, 3), jit(3));
    // a column of black smoke that leans downwind and lingers a few seconds
    let t = 0, n = 0;
    live.push({
      tick(dt) {
        t += dt; n -= dt;
        if (n <= 0) { n = low ? 0.4 : 0.2; puff(x + jit(1), g + 0.6, z + jit(1), rnd(1.6, 2.2), rnd(4.6, 6), low ? 2 : 2.8, 0x3a3631, 0.7, 0.9, 2.4, 0.3); }
        return t < (low ? 3 : 6);
      },
      kill() {},
    });
    if (low) return;
    // a few chunks of the plane thrown about
    const world = ctx.world();
    for (let i = 0; i < 6; i++) {
      const c = new THREE.Mesh(SRC.box, DEBRIS), s = 0.3 + Math.random() * 0.5, a = heading + (Math.random() - 0.5) * 2.4, v = 3 + Math.random() * 7;
      c.scale.set(s * 1.6, s * 0.4, s); c.position.set(x, g + 0.5, z); c.castShadow = false; world.add(c);
      let vy = 6 + Math.random() * 6, vx = Math.cos(a) * (v + speed * 0.2), vz = Math.sin(a) * (v + speed * 0.2), life = 1.4;
      live.push({
        tick(dt) {
          life -= dt; vy -= 20 * dt; c.position.x += vx * dt; c.position.z += vz * dt; c.position.y += vy * dt; c.rotation.x += dt * 9; c.rotation.z += dt * 7;
          const gy = hAt(c.position.x, c.position.z) + 0.2;
          if (c.position.y < gy) { c.position.y = gy; vy = 0; vx *= 0.8; vz *= 0.8; }
          c.scale.multiplyScalar(life < 0.5 ? 0.94 : 1);
          if (life <= 0) { world.remove(c); return false; }
          return true;
        },
        kill() { world.remove(c); },
      });
    }
  }

  // ----- support planes crossing the map -----
  const LOW = { strafe: 9, bombing: 18, dive: 12, para: 24, recon: 26 }, RUN = 3, SPAN = 140, LEAD = 1, FALL = 0.45;
  const runs = [];          // support planes in the air, so flak and shoot-down shots find them by their target spot
  const drop = (r) => { const i = runs.indexOf(r); if (i >= 0) runs.splice(i, 1); };
  function supportPlane(sh) {
    const owner = sh.fo ?? ctx.me(), fac = ctx.facOf(owner), role = ROLE_OF_SUPPORT[sh.k] ?? 'fighter';
    const { body, props, m } = instance(fac, role, owner, { bomb: sh.k === 'dive' });
    const holder = new THREE.Group(); holder.add(body); holder.rotation.y = -sh.dir;
    const shadow = shadowOf(m), world = ctx.world(), dx = Math.cos(sh.dir), dz = Math.sin(sh.dir), low = LOW[sh.k] ?? 26, gy = hAt(sh.x, sh.z), speed = SPAN / RUN;
    world.add(holder, shadow);
    const bomber = sh.k === 'bombing', lead = bomber ? LEAD : 0;
    const r = { sh, flak: [], hit: null, events: [], t: 0, lead };
    const bombs = [];
    if (bomber) {
      const { len, shells, every } = ctx.SUPPORT.bombing;
      for (let i = 0; i < shells; i++) {
        const at = i * every, along = (i / Math.max(1, shells - 1) - 0.5) * len;
        bombs.push({ at, release: at - FALL, x: sh.x + dx * along, z: sh.z + dz * along, mesh: null, started: at <= 0 });
      }
    }
    const stopBombs = () => { for (const b of bombs) { hideBomb(b.mesh); b.mesh = null; } };
    if (sh.k === 'strafe') for (let i = 0; i < 10; i++) r.events.push({ at: 1.3 + i * 0.04, a: (i / 9 - 0.5) * ctx.SUPPORT.strafe.len });
    let dead = false;
    const e = {
      tick(dt) {
        r.t += dt;
        const u = (r.t + lead) / RUN, a = (u - 0.5) * SPAN, x = sh.x + dx * a, z = sh.z + dz * a, ground = hAt(x, z);
        const y = supportHeight(x, z, Math.max(gy, ground) + low + Math.abs(u - 0.5) * 30, ground);
        const appear = bomber ? 0.35 + 0.65 * clamp(r.t / 0.3, 0, 1) : 1;
        holder.scale.setScalar(appear);
        holder.position.set(x, y, z); body.rotation.set(0, 0, Math.atan2(u < 0.5 ? -10 : 10, speed)); spin(props, dt);
        place(shadow, x, ground, z, -sh.dir, (1 + (y - ground) * 0.012) * appear); shadow.visible = true;
        for (const b of bombs) {
          if (r.t >= b.at) { hideBomb(b.mesh); b.mesh = null; b.started = true; continue; }
          if (r.t < b.release) continue;
          if (!b.started) {
            b.started = true; b.mesh = takeBomb();
            const bu = (b.release + lead) / RUN, ba = (bu - 0.5) * SPAN;
            b.x0 = sh.x + dx * ba; b.z0 = sh.z + dz * ba;
            const bg = hAt(b.x0, b.z0);
            b.y0 = supportHeight(b.x0, b.z0, Math.max(gy, bg) + low + Math.abs(bu - 0.5) * 30, bg);
            b.g = hAt(b.x, b.z); b.gravity = 2 * (b.y0 - b.g) / (FALL * FALL);
          }
          if (!b.mesh) continue;
          const tau = r.t - b.release, fraction = tau / FALL;
          b.mesh.position.set(b.x0 + (b.x - b.x0) * fraction, b.y0 - 0.5 * b.gravity * tau * tau, b.z0 + (b.z - b.z0) * fraction);
          bombVelocity.set((b.x - b.x0) / FALL, -b.gravity * tau, (b.z - b.z0) / FALL).normalize();
          b.mesh.quaternion.setFromUnitVectors(bombAxis, bombVelocity);
        }
        while (r.events.length && r.events[0].at <= r.t) {
          const ev = r.events.shift(), bx = sh.x + dx * ev.a, bz = sh.z + dz * ev.a;
          if (!r.opened) { r.opened = true; ctx.play('strafe', bx, bz); } // one burst of the guns for the whole run
          ctx.explode(bx + (Math.random() - 0.5) * 3, bz + (Math.random() - 0.5) * 3, 0.8, { decal: false });
        }
        // flak bursts around the plane while it is in range
        while (r.flak.length && r.flak[0] <= r.t) {
          r.flak.shift();
          burst(x + dx * 3 + (Math.random() - 0.5) * 5, y + (Math.random() - 0.5) * 4, z + dz * 3 + (Math.random() - 0.5) * 5);
        }
        if (r.hit !== null && r.t >= r.hit) {
          // hit: leave the run and fall, carrying on along the same line with the same slope
          dead = true; r.events.length = 0; stopBombs(); drop(r);
          fall({ holder, body, shadow, m, props, x, y, z, heading: sh.dir, speed: speed * 0.75, vy: u < 0.5 ? -10 : 10 });
          burst(x + dx * 2, y + 0.5, z + dz * 2, 1.3);
          return false;
        }
        if (u >= 1) { stopBombs(); holder.parent?.remove(holder); shadow.parent?.remove(shadow); drop(r); return false; }
        return true;
      },
      kill() { stopBombs(); if (!dead) { holder.parent?.remove(holder); shadow.parent?.remove(shadow); } },
    };
    runs.push(Object.assign(r, { e }));
    live.push(e);
    e.tick(0);
  }
  const runAt = (sh, kind) => runs.find((r) => Math.hypot(r.sh.x - sh.x, r.sh.z - sh.z) < 1.5 && (!kind || r.sh.k === kind) && r.hit === null);

  return {
    // a new match: drop every effect from the last one
    reset() {
      for (const e of live) e.kill();
      live.length = 0; runs.length = 0;
      for (const b of bombPool) { hideBomb(b); b.parent?.remove(b); }
      lastCamera = null;
      if (puffs) { puffs.list.length = 0; puffs.mesh.count = 0; puffs.mesh.parent?.remove(puffs.mesh); }
    },
    // per frame, after the units moved
    update(dt) {
      for (let i = live.length - 1; i >= 0; i--) if (live[i].tick(dt) === false) live.splice(i, 1);
      tickPuffs(dt);
    },
    // a support plane crossing the map ('strafe', 'recon', 'bombing', 'dive' or 'para' shot)
    supportPlane,
    // flak shots at a support plane: bursts around it as it flies through; or over the spot if it can't be found
    flak(sh) {
      const r = runAt(sh);
      if (r) { for (let i = 0; i < 4; i++) r.flak.push(0.7 + i * 0.14 + Math.random() * 0.06); r.flak.sort((a, b) => a - b); return; }
      for (let i = 0; i < 4; i++) { const a = Math.random() * TAU, d = Math.random() * 7; live.push({ at: i * 0.12, tick(dt) { this.at -= dt; if (this.at <= 0) { burst(sh.x + Math.cos(a) * d, hAt(sh.x, sh.z) + alt + (Math.random() - 0.5) * 5, sh.z + Math.sin(a) * d); return false; } return true; }, kill() {} }); }
    },
    // a flak or cannon shot at a plane: a burst beside it
    aaBurst(from, to) {
      if (!ctx.flakTypes.has(from.type) || gfx.low && Math.random() < 0.5) return;
      const p = to.root.position;
      burst(p.x + (Math.random() - 0.5) * 6, p.y + (Math.random() - 0.5) * 4, p.z + (Math.random() - 0.5) * 6);
    },
    // a plane shot down: a support plane in flight (the 'shotdown' shot) or a commandable plane (the 'planedown' shot)
    shotDown(sh) {
      if (sh.kind) {
        const r = runAt(sh, sh.kind);
        if (r) { r.hit = Math.max(r.t + 0.05, 1.3 + Math.random() * 0.15 - r.lead); return; }
      }
      // a commandable plane: carry on from where it was
      const u = ctx.units.get(sh.t), owner = u?.owner ?? sh.to ?? ctx.me(), type = u?.type ?? 'fighter';
      const { body, props, m } = instance(ctx.facOf(owner), ROLE_OF_UNIT[type] ?? 'fighter', owner);
      const holder = new THREE.Group(), world = ctx.world(), shadow = shadowOf(m), g = hAt(sh.x, sh.z), speed = UNITS[type]?.speed ?? 20;
      holder.add(body); world.add(holder, shadow); shadow.visible = true;
      body.rotation.x = u?.bank ?? 0;
      fall({ holder, body, shadow, m, props, x: sh.x, y: g + alt, z: sh.z, heading: sh.dir ?? u?.rot ?? 0, speed, vy: 0 });
      burst(sh.x, g + alt, sh.z, 1.3);
    },

    // ----- units -----
    // the plane model for a unit (fighter or attacker), its shadow, and what tick() needs
    buildUnit(v, root, type, owner) {
      const { body, props, m } = instance(ctx.facOf(owner), ROLE_OF_UNIT[type] ?? 'fighter', owner);
      root.add(body);
      Object.assign(v, { body, props, plane: m, shadow: shadowOf(m), bank: 0, smokeT: 0 });
      v.models.push(root);
      ctx.world().add(v.shadow);
    },
    // per frame for a plane unit, after its root was placed: props, bank, shadow, smoke when damaged
    tick(v, dt) {
      const vis = v.root.visible;
      v.shadow.visible = vis;
      if (!vis) { v.prevRot = v.rot; return; }
      if (v.prevRot === undefined) v.prevRot = v.rot;
      const gy = hAt(v.x, v.z), yaw = angDiff(v.rot, v.prevRot) / Math.max(dt, 1e-3); v.prevRot = v.rot;
      v.bank += (clamp(yaw * 0.55, -0.65, 0.65) - v.bank) * (1 - Math.exp(-5 * dt));
      const wob = performance.now() / 1000 + v.id;
      v.body.rotation.set(v.bank + Math.sin(wob * 1.7) * 0.02, 0, Math.sin(wob * 1.1) * 0.015);
      spin(v.props, dt);
      place(v.shadow, v.x, gy, v.z, -v.rot);
      // damage: grey smoke at 60% health, black smoke and a flicker of fire at 30%
      const def = UNITS[v.type], frac = v.hp / (def.hpPer * def.models);
      if (frac < 0.6 && (v.smokeT -= dt) <= 0) {
        const bad = frac < 0.3;
        v.smokeT = (bad ? 0.055 : 0.13) * (gfx.low ? 2 : 1);
        const bx = Math.cos(v.rot), bz = Math.sin(v.rot), t = v.plane.tail * 0.8, y = gy + alt + 0.4;
        smoke(v.x + bx * t, y, v.z + bz * t, bad);
        if (bad) flame(v.x + bx * v.plane.nose * 0.5, y, v.z + bz * v.plane.nose * 0.5);
      }
    },
    release(v) { v.shadow?.parent?.remove(v.shadow); },

    // ----- the Classic airfield: a runway strip, an arched hangar, a control tower and a windsock -----
    buildAirfield(v, root, owner) {
      const fac = ctx.facOf(owner), own = ctx.colorOf(owner), roof = ctx.vehicleOf(owner), key = `af:${fac}:${own}:${roof}`;
      if (!built.has(key)) built.set(key, airfield(fac, own, roof));
      v.body = new THREE.Group();
      const mesh = new THREE.Mesh(built.get(key), FIELD_MAT); mesh.castShadow = true; mesh.receiveShadow = true;
      v.body.add(mesh); root.add(v.body); v.models.push(root);
    },

    // debug aid: put a plane of one kind in the world (see window.__game.aviation.preview)
    preview(role, owner, x, z, heading = 0, opts = {}) {
      const { body, props, m } = instance(opts.fac ?? ctx.facOf(owner), role, owner, opts), holder = new THREE.Group(), shadow = shadowOf(m);
      holder.add(body); holder.position.set(x, hAt(x, z) + alt, z); holder.rotation.y = -heading; place(shadow, x, hAt(x, z), z, -heading); shadow.visible = true;
      ctx.world().add(holder, shadow);
      live.push({ tick(dt) { spin(props, dt); return true; }, kill() { holder.parent?.remove(holder); shadow.parent?.remove(shadow); } });
      return { holder, body, props, shadow, m };
    },
    stats: () => ({ models: built.size, puffs: puffs?.list.length ?? 0, live: live.length, runs: runs.length }),
  };
}

// ---------- airfield model ----------

function airfield(fac, own, vehicle) {
  const parts = [], add = (geo, color, m) => parts.push({ geo, color, m });
  const box = (color, sx, sy, sz, x, y, z) => add(SRC.box, color, xf(x, y, z, 0, 0, 0, sx, sy, sz));
  // packed dirt apron and a pale grass-and-gravel strip with painted edges, centre dashes and threshold bars
  box(0x7a6e50, 6.6, 0.06, 6.2, 0, 0.03, 0); box(0x8a7d5c, 5.6, 0.07, 5.2, 0.2, 0.035, 0.2);
  box(0x9c937c, 8.6, 0.09, 2, 0, 0.045, -2);
  for (const z of [-3, -1]) box(WHITE, 8.4, 0.1, 0.07, 0, 0.05, z);
  for (let i = 0; i < 6; i++) box(WHITE, 0.7, 0.1, 0.12, -3.2 + i * 1.28, 0.05, -2);
  for (const x of [-4, 4]) for (let i = 0; i < 4; i++) box(WHITE, 0.45, 0.1, 0.1, x * 0.97, 0.05, -2.55 + i * 0.37);
  box(0x8a7d5c, 1.5, 0.08, 1.4, -1.4, 0.04, -0.4);
  // arched hangar, door end toward the strip: roof in the faction's vehicle colour, ribs, a door framed in the owner's colour
  const R = 1.45, arch = (r0, r1, depth, z, color, sy = 0.85) => {
    const s = new THREE.Shape(); s.moveTo(-r1, 0); s.absarc(0, 0, r1, PI, 0, true);
    if (r0 > 0) { s.lineTo(r0, 0); s.absarc(0, 0, r0, 0, PI, false); } else s.lineTo(-r1, 0);
    const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 10 }); g.scale(1, sy, 1);
    add(g, color, xf(-1.4, 0.06, z));
  };
  arch(0, R, 3.2, -0.1, vehicle);
  for (let i = 0; i < 6; i++) arch(R, R * 1.045, 0.09, 0.15 + i * 0.58, 0x2e3324);
  arch(R * 0.76, R * 0.96, 0.1, -0.13, own); arch(0, R * 0.76, 0.06, -0.14, 0x24241f);
  for (const p of insignia(fac, 0.45)) add(p.geo, p.color, xf(-1.4, 0.06 + R * 0.85 + 0.03, 1.5).multiply(FLAT).multiply(p.m));
  for (const p of insignia(fac, 0.5)) add(p.geo, p.color, xf(1.2, 0.1, 0.8).multiply(FLAT).multiply(p.m));      // roundel painted on the apron
  // control tower with a glass cab, a flat roof and a pennant in the owner's colour
  box(0xb8ab8a, 0.9, 1.1, 0.9, 1.9, 0.6, 1.9); box(vehicle, 1.2, 0.5, 1.2, 1.9, 1.4, 1.9); box(GLASS, 1.22, 0.26, 1.22, 1.9, 1.42, 1.9); box(0x6b6554, 1.4, 0.08, 1.4, 1.9, 1.72, 1.9);
  add(SRC.cyl, 0x4a3f30, xf(1.9, 2.25, 1.9, 0, 0, PI / 2, 1, 0.03, 0.03)); box(own, 0.5, 0.28, 0.03, 2.15, 2.5, 1.9);
  // fuel drums and crates by the hangar
  for (let i = 0; i < 3; i++) add(SRC.cyl, [0x4f5a38, 0x6e5836, 0x4f5a38][i], xf(1.3 + i * 0.5, 0.25, 2.9, 0, 0, PI / 2, 0.5, 0.22, 0.22));
  // windsock on a pole at the end of the strip: orange and white rings blowing along the strip
  add(SRC.cyl, 0x4a3f30, xf(3.6, 0.95, -3.35, 0, 0, PI / 2, 1.9, 0.03, 0.03));
  [[0xe07a30, 0.18], [WHITE, 0.16], [0xe07a30, 0.14]].forEach(([c, r], i) => {
    const g = new THREE.CylinderGeometry(r * 0.8, r, 0.34, 8).rotateZ(-PI / 2);
    add(g, c, xf(3.75 + i * 0.34, 1.82 - i * 0.03, -3.35));
  });
  return merge(parts);
}
