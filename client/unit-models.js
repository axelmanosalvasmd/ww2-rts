// Unit models: soldiers, vehicles, guns and the structures units build, plus how squads stand (posture), the cheap
// far-away soldier, and the pooled corpses.
//
// Models are put together from boxes, cylinders and capsules like before, then baked: every part with a plain color
// becomes part of one mesh that carries its colors per vertex and shares one material, so a soldier, a hull or a
// turret is one draw call. Parts with a special material (two-sided flags) merge with the other parts that use it.
// Baked geometry is cached per look, so the second rifle squad of a color reuses the first one's geometry.
import * as THREE from 'three';
import { gfx } from './gfx.js';

// unit-sized shapes, scaled per part
const GEO = {
  box: new THREE.BoxGeometry(1, 1, 1), cyl: new THREE.CylinderGeometry(1, 1, 1, 12),
  body: new THREE.CapsuleGeometry(0.3, 0.8, 4, 8), helmet: new THREE.SphereGeometry(0.27, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2),
  plane: new THREE.PlaneGeometry(1, 1), ball: new THREE.SphereGeometry(1, 12, 8),
};
// the far-away soldier: the same shapes with far fewer faces
const LOW = {
  box: GEO.box, cyl: new THREE.CylinderGeometry(1, 1, 1, 6),
  body: new THREE.CapsuleGeometry(0.3, 0.8, 1, 6), helmet: new THREE.SphereGeometry(0.27, 6, 2, 0, Math.PI * 2, 0, Math.PI / 2),
  ball: new THREE.SphereGeometry(1, 6, 4),
};

// barracks roof: a triangle pushed out along the hut
const ROOF = (() => {
  const shape = new THREE.Shape([new THREE.Vector2(-3, 0), new THREE.Vector2(3, 0), new THREE.Vector2(0, 1.8)]), g = new THREE.ExtrudeGeometry(shape, { depth: 5.6, bevelEnabled: false });
  g.translate(0, 0, -2.8);
  return g;
})();

const DARK = 0x2a2a24, GEAR = 0x2c2b26, WOOD = 0x5e4226, SKIN = 0xc8a07a;
// one material for every plain-colored part; the color sits in the geometry
export const PAINT = new THREE.MeshLambertMaterial({ vertexColors: true });
const colors = new Map();
const colorOf = (hex) => colors.get(hex) || colors.set(hex, new THREE.Color(hex)).get(hex);
const cloths = new Map();
const cloth = (color) => cloths.get(color) || cloths.set(color, new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide })).get(color);

// a part before baking: shape, color (a number) or material, then scale and position like the old mesh() helper
function part(geo, paint, sx = 1, sy = 1, sz = 1, x = 0, y = 0, z = 0) {
  const o = new THREE.Object3D();
  o.userData.geo = geo; o.userData.paint = paint;
  o.scale.set(sx, sy, sz); o.position.set(x, y, z);
  return o;
}

// Concatenate the parts' attributes into one geometry: transforms baked in, normals through the normal matrix,
// indices offset by the vertices before them. Colors per vertex when the parts share PAINT.
export function mergeParts(parts, withColor) {
  let nv = 0, ni = 0;
  for (const p of parts) { const n = p.geo.attributes.position.count; nv += n; ni += p.geo.index ? p.geo.index.count : n; }
  const uv = !withColor && parts.every((p) => p.geo.attributes.uv); // texture coordinates only for textured materials
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = withColor ? new Float32Array(nv * 3) : null, uvs = uv ? new Float32Array(nv * 2) : null;
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni), nm = new THREE.Matrix3(), t = new THREE.Vector3();
  let vo = 0, io = 0;
  for (const p of parts) {
    const P = p.geo.attributes.position, N = p.geo.attributes.normal, U = p.geo.attributes.uv, I = p.geo.index;
    nm.getNormalMatrix(p.matrix);
    for (let i = 0; i < P.count; i++) {
      t.fromBufferAttribute(P, i).applyMatrix4(p.matrix).toArray(pos, (vo + i) * 3);
      t.fromBufferAttribute(N, i).applyMatrix3(nm).normalize().toArray(nor, (vo + i) * 3);
      if (col) p.color.toArray(col, (vo + i) * 3);
      if (uvs) { uvs[(vo + i) * 2] = U.getX(i); uvs[(vo + i) * 2 + 1] = U.getY(i); }
    }
    const flip = p.matrix.determinant() < 0, n = I ? I.count : P.count;
    for (let i = 0; i < n; i += 3) {
      const a = I ? I.getX(i) : i, b = I ? I.getX(i + 1) : i + 1, c = I ? I.getX(i + 2) : i + 2;
      idx[io++] = vo + a; idx[io++] = vo + (flip ? c : b); idx[io++] = vo + (flip ? b : c);
    }
    vo += P.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  if (col) g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (uvs) g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return g;
}

// Static scenery built from many plain meshes with one material (HQ sandbags, trench parapets, roofs): the same
// shapes as one mesh, marked so a rebuild can free its geometry.
export function mergeMeshes(meshes) {
  const parts = meshes.map((m) => { m.updateMatrix(); return { geo: m.geometry, matrix: m.matrix }; });
  const out = new THREE.Mesh(mergeParts(parts, false), meshes[0].material);
  out.castShadow = meshes[0].castShadow; out.receiveShadow = meshes[0].receiveShadow; out.userData.merged = true;
  return out;
}

// the part's transform relative to the group being baked
function relative(o, top) {
  const m = new THREE.Matrix4();
  for (let p = o; p && p !== top; p = p.parent) { p.updateMatrix(); m.premultiply(p.matrix); }
  return m;
}

// Bake the parts under group into meshes (one per material), cached under key. Returns the meshes.
const baked = new Map();
function bakeMeshes(group, key, shadow) {
  let list = baked.get(key);
  if (!list) {
    const buckets = new Map();
    group.traverse((o) => {
      const d = o.userData;
      if (!d.geo) return;
      const material = d.paint.isMaterial ? d.paint : PAINT;
      if (!buckets.has(material)) buckets.set(material, []);
      buckets.get(material).push({ geo: d.geo, matrix: relative(o, group), color: material === PAINT ? colorOf(d.paint) : null });
    });
    list = [...buckets].map(([material, parts]) => ({ material, geometry: mergeParts(parts, material === PAINT) }));
    baked.set(key, list);
  }
  return list.map(({ material, geometry }) => { const m = new THREE.Mesh(geometry, material); m.castShadow = shadow; return m; });
}
// bake in place: the group keeps its transform and gets the baked meshes as its only children
function bake(group, key, shadow) {
  const meshes = bakeMeshes(group, key, shadow);
  group.clear(); group.add(...meshes);
  return group;
}
// the first barrel lying along +x in a turret, as client/fx.js finds it on unbaked models (muzzle flashes)
function barrelTip(turret) {
  for (const m of turret.children) if (m.userData.geo === GEO.cyl && Math.abs(m.rotation.z - Math.PI / 2) < 0.01) return [m.position.x + m.scale.y / 2, m.position.y, m.position.z];
  return null;
}

// Formation slots in local space (+x = forward). Gun crews stand behind the gun.
const SLOTS = {
  rifle: [[0.9, 0], [0, 1], [0, -1], [-0.9, 0.55], [-0.9, -0.55]],
  mg: [[0.2, 0], [-0.5, 0.7], [-0.5, -0.7]],
  mortar: [[0.2, 0.6], [0.2, -0.6], [-0.6, 0]],
  flak: [[-0.6, 0.8], [-0.6, -0.8], [-1.2, 0]],
  sniper: [[0.4, 0], [-0.5, 0.6]],
  engineer: [[0.6, 0], [-0.4, 0.7], [-0.4, -0.7]],
  at: [[-0.5, 0.7], [-0.5, -0.7], [-1.2, 0.4], [-1.2, -0.4]],
  ranger: [[0.9, 0], [0.3, 1], [0.3, -1], [-0.6, 0.6], [-0.6, -0.6], [-1.2, 0]],
  conscript: [[1, 0], [0.4, 0.9], [0.4, -0.9], [-0.3, 1.5], [-0.3, -1.5], [-0.9, 0.5], [-0.9, -0.5]],
};

// headgear per faction: round M1 (USA), flared Stahlhelm (Germany), tall SSh-40 (USSR); conscripts wear a pilotka cap
function headgear(man, fac, type, c, G = GEO) {
  if (type === 'conscript') { man.add(part(G.box, c, 0.38, 0.13, 0.22, 0, 1.2, 0)); return; }
  if (fac === 1) man.add(part(G.helmet, c, 1.05, 1, 1.05, 0, 1.28, 0), part(G.cyl, c, 0.33, 0.07, 0.33, 0, 1.25, 0));
  else if (fac === 2) man.add(part(G.helmet, c, 1, 1.3, 1, 0, 1.26, 0));
  else man.add(part(G.helmet, c, 1.12, 0.95, 1.12, 0, 1.28, 0));
}

// what each class carries, so squads read apart even without their badges (+x = forward)
function gear(man, type, i, f) {
  if (type === 'rifle' || type === 'conscript') man.add(part(GEO.box, WOOD, 1.0, 0.07, 0.07, 0.28, 0.85, 0.2).rotateZ(0.6));
  else if (type === 'ranger' && i % 3 !== 1) man.add(part(GEO.box, GEAR, 0.6, 0.1, 0.08, 0.32, 0.82, 0.2).rotateZ(0.3)); // SMG
  else if (type === 'sniper') {
    man.add(part(GEO.box, 0x3c4a26, 0.75, 0.55, 0.85, -0.1, 0.95, 0)); // ghillie cape
    if (i === 0) man.add(part(GEO.box, WOOD, 1.5, 0.06, 0.06, 0.4, 0.9, 0.2).rotateZ(0.25), part(GEO.box, GEAR, 0.35, 0.09, 0.09, 0.42, 1.0, 0.2).rotateZ(0.25)); // long rifle and scope
  } else if (type === 'engineer') {
    // pack and a shovel on the back
    man.add(part(GEO.box, f.vehicle, 0.3, 0.45, 0.5, -0.32, 0.95, 0), part(GEO.cyl, WOOD, 0.03, 1.1, 0.03, -0.4, 1.05, 0.2), part(GEO.box, GEAR, 0.06, 0.3, 0.22, -0.4, 1.65, 0.2));
  } else if ((type === 'mg' || type === 'mortar') && i > 0) man.add(part(GEO.box, 0x4a5030, 0.3, 0.25, 0.22, -0.05, 0.55, 0.32)); // ammo box
  if (type === 'ranger' && i % 3 === 1) man.add(part(GEO.cyl, GEAR, 0.07, 1.3, 0.07, 0, 1.1, 0.25).rotateZ(1.3)); // bazooka on the shoulder
}
// which gear a soldier carries, for the bake cache
const kit = (type, i) => (type === 'ranger' ? i % 3 === 1 : type === 'sniper' ? i === 0 : type === 'mg' || type === 'mortar' ? i > 0 : false);

// tank silhouettes: [hull l,h,w], [turret l,h,w, x, z], barrel [length, thickness], sloped glacis
const TANKS = {
  tank: [
    { hull: [3.8, 1.3, 2.3], turret: [1.6, 0.9, 1.5, -0.1, 0], gun: [2.0, 0.09] },               // M5 Stuart: tall and boxy
    { hull: [4.0, 1.0, 2.2], turret: [1.3, 0.75, 1.2, 0.2, 0.3], gun: [1.6, 0.07] },             // Panzer II: small offset turret
    { hull: [4.2, 1.0, 2.3], turret: [1.6, 0.8, 1.5, -0.3, 0.2], gun: [2.2, 0.09], slope: 1 },   // T-70: sloped front
  ],
  tiger: [null, { hull: [5.4, 1.4, 3.2], turret: [2.6, 1.1, 2.2, -0.2, 0], gun: [3.8, 0.14], brake: 1 }, null],
  medium: [
    { hull: [4.8, 1.5, 2.7], turret: [2.0, 1.0, 1.9, -0.1, 0], gun: [2.6, 0.11], slope: 1 },           // M4 Sherman: tall, rounded
    { hull: [5.0, 1.2, 2.7], turret: [2.3, 0.95, 1.9, -0.2, 0], gun: [3.0, 0.11] },                    // Panzer IV: boxy, long gun
    { hull: [5.0, 1.1, 2.9], turret: [2.0, 0.9, 1.9, 0.3, 0], gun: [2.9, 0.11], slope: 1 },             // T-34: sloped, turret forward
  ],
  // mobile flak: M16 half-track (quad MGs), Wirbelwind (flak turret on a Panzer IV), ZSU-37 (on a light tank)
  flaktrack: [
    { hull: [4.2, 1.1, 2.2], turret: [1.2, 0.6, 1.4, -0.8, 0], gun: [1.2, 0.07], wheels: 2, twin: 1 },
    { hull: [5.0, 1.2, 2.7], turret: [1.8, 1.0, 1.8, -0.2, 0], gun: [1.6, 0.07], twin: 1 },
    { hull: [4.4, 1.1, 2.4], turret: [1.8, 0.8, 1.7, -0.6, 0], gun: [2.2, 0.08], twin: 1 },
  ],
  armoredcar: [
    { hull: [3.8, 1.0, 2.1], turret: [1.3, 0.6, 1.3, 0, 0], gun: [1.0, 0.06], wheels: 3 },             // M8 Greyhound: six wheels
    { hull: [3.6, 0.9, 1.9], turret: [1.1, 0.5, 1.2, 0, 0], gun: [0.8, 0.05], wheels: 2 },             // Sd.Kfz. 222
    { hull: [3.2, 1.1, 1.7], turret: [0.9, 0.5, 0.9, 0, 0], gun: [0.7, 0.05], wheels: 2, slope: 1 },   // BA-64: small, sloped
  ],
};
// hull parts go into the returned group; the turret becomes v.turret (both baked by the caller)
function buildTank(v, root, spec, f) {
  const hull = f.vehicle, [hl, hh, hw] = spec.hull, y = hh / 2 + 0.5, g = new THREE.Group();
  g.add(part(GEO.box, hull, hl, hh, hw, 0, y, 0));
  if (spec.wheels) for (let i = 0; i < spec.wheels; i++) for (const side of [1, -1]) g.add(part(GEO.cyl, DARK, 0.45, 0.35, 0.45, (i / (spec.wheels - 1) - 0.5) * hl * 0.7, 0.45, side * hw / 2).rotateX(Math.PI / 2));
  else g.add(part(GEO.box, DARK, hl + 0.2, 0.8, 0.6, 0, 0.45, hw / 2), part(GEO.box, DARK, hl + 0.2, 0.8, 0.6, 0, 0.45, -hw / 2));
  if (spec.slope) g.add(part(GEO.box, hull, 1.2, 0.2, hw, hl / 2 - 0.2, y + 0.25, 0).rotateZ(-0.5));
  const [tl, th, tw, tx, tz] = spec.turret, [gl, gt] = spec.gun;
  v.turret = new THREE.Group(); v.turret.position.set(tx, y + hh / 2 + th / 2, tz);
  v.turret.add(part(GEO.box, hull, tl, th, tw), part(GEO.cyl, DARK, gt, gl, gt, tl / 2 + gl / 2, 0.05, 0).rotateZ(Math.PI / 2), part(GEO.box, f.color, 0.4, th + 0.02, tw + 0.02, -tl / 2 + 0.3, 0, 0));
  if (spec.twin) v.turret.add(part(GEO.cyl, DARK, gt, gl, gt, tl / 2 + gl / 2, 0.25, 0.3).rotateZ(Math.PI / 2 - 0.6), part(GEO.cyl, DARK, gt, gl, gt, tl / 2 + gl / 2, 0.25, -0.3).rotateZ(Math.PI / 2 - 0.6));
  if (spec.brake) v.turret.add(part(GEO.box, DARK, 0.35, 0.3, 0.35, tl / 2 + gl, 0.05, 0));
  root.add(g, v.turret);
  return g;
}

// soldier posture, blended by weight: [lean (rad, + = back), height scale, shift x, shift y, weapon x, weapon y]
// in the soldier's own units (+x forward, feet at 0). The weapon point is where muzzle flashes start
// (client/fx.js uses about (0.7, 1.05) on a standing man); the soldier node moves so it lands there.
const HAND = [0.7, 1.05];
const posed = (lean, sy, tx, ty, hand) => {
  const c = Math.cos(lean), s = Math.sin(lean), [hx, hy] = hand ?? [HAND[0] * c - HAND[1] * sy * s + tx, HAND[0] * s + HAND[1] * sy * c + ty];
  return [lean, sy, tx, ty, hx, hy];
};
const PRONE_LEAN = -1.49, PRONE_X = -0.72, PRONE_Y = 0.26;
const POSES = [
  posed(0, 1, 0, 0),                                   // standing
  posed(-0.3, 0.74, 0, 0),                             // crouched (suppressed, supp >= 50)
  // prone (pinned, supp >= 90): lying head forward; the weapon sits just in front of the head
  posed(PRONE_LEAN, 1, PRONE_X, PRONE_Y, [1.24 * Math.sin(-PRONE_LEAN) + PRONE_X + 0.32, 1.24 * Math.cos(PRONE_LEAN) + PRONE_Y + 0.1]),
  posed(-0.38, 0.96, 0, 0),                            // leaning forward (retreating)
];
export const POSTURE = { crouch: 50, prone: 90, blend: 0.3 };
// retreating wins over suppression; in a trench (cover 2) a pinned squad crouches, since lying down there would
// sink it out of sight below the ground
export const postureOf = (supp, flags, cover) => (flags & 1 ? 3 : supp >= POSTURE.prone && cover !== 2 ? 2 : supp >= POSTURE.crouch ? 1 : 0);
// beyond this camera distance soldiers swap to the far-away model (closer on Low graphics)
export const LOD = { high: 110, low: 80 };

// Builds the model of unit v under root: v.models (soldiers, or the root for vehicles and structures), v.turret,
// v.body (structures and planes; it scales up while built), v.fxTip (barrel tip for client/fx.js).
// f is the owner's look (uniform, vehicle and player colors), fac the faction, def the unit's stats.
export function buildModel(v, root, f, fac, def) {
  const type = v.type, key = `${type}|${fac}|${f.color}`;
  if (def.air) {
    // fighter: slim, long nose; ground-attack plane: bigger, rockets and a bomb under the wings
    const big = type === 'attacker', c = f.vehicle;
    v.body = new THREE.Group();
    v.body.add(part(GEO.box, c, big ? 7 : 6, big ? 1.1 : 0.9, big ? 1.1 : 0.9), part(GEO.box, c, big ? 1.8 : 1.4, 0.2, big ? 11 : 9.5, big ? 0.4 : 0.6, -0.1, 0),
      part(GEO.box, c, 0.9, 0.15, 3.4, big ? -3 : -2.6, 0.1, 0), part(GEO.box, c, 0.9, 1.3, 0.15, big ? -3 : -2.6, 0.7, 0),
      part(GEO.box, f.color, 0.5, 0.22, big ? 11.2 : 9.7, big ? 0.4 : 0.6, -0.05, 0), part(GEO.cyl, DARK, 0.15, 0.4, 0.15, big ? 3.7 : 3.2, 0, 0).rotateZ(Math.PI / 2));
    if (big) for (const z of [-3.5, -2.5, 2.5, 3.5]) v.body.add(part(GEO.cyl, DARK, 0.12, 1.2, 0.12, 0.6, -0.4, z).rotateZ(Math.PI / 2));
    if (big) v.body.add(part(GEO.box, DARK, 1.4, 0.4, 0.4, 0.3, -0.7, 0));
    root.add(bake(v.body, key, true)); v.models.push(root);
  } else if (type === 'airfield') {
    // a dirt strip, a hangar and a windsock
    v.body = new THREE.Group();
    v.body.add(part(GEO.box, 0x6a5e44, 6, 0.1, 2.2, 0, 0.05, 0), part(GEO.box, f.vehicle, 2.6, 2.2, 3, -1.5, 1.1, 1.6), part(GEO.cyl, 0x4a3f30, 0.06, 3, 0.06, 2.6, 1.5, -2.4),
      part(GEO.box, 0xe07a30, 0.9, 0.3, 0.3, 3, 2.8, -2.4));
    root.add(bake(v.body, key, true)); v.models.push(root);
  } else if (type === 'flakpos') {
    // a sandbagged ring with a twin gun pointing up
    v.body = new THREE.Group();
    for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; if (i === 7) continue; v.body.add(part(GEO.box, 0x9c8a60, 1.2, 0.7, 0.6, Math.cos(a) * 1.7, 0.35, Math.sin(a) * 1.7).rotateY(-a + Math.PI / 2)); }
    v.body.add(part(GEO.cyl, DARK, 0.5, 0.6, 0.5, 0, 0.3, 0), part(GEO.cyl, DARK, 0.08, 2, 0.08, 0.4, 1.3, 0.2).rotateZ(-0.6), part(GEO.cyl, DARK, 0.08, 2, 0.08, 0.4, 1.3, -0.2).rotateZ(-0.6));
    root.add(bake(v.body, key, true)); v.models.push(root);
  } else if (type === 'hq') {
    // command post: sandbagged timber block with a radio mast
    v.body = new THREE.Group();
    v.body.add(part(GEO.box, 0x7a6446, 5.4, 3, 5.4, 0, 1.5, 0), part(GEO.box, 0x5a4a34, 6, 0.4, 6, 0, 3.2, 0), part(GEO.box, f.vehicle, 5.6, 0.5, 1.2, 0, 1.2, 2.5),
      part(GEO.cyl, DARK, 0.06, 5, 0.06, 2, 5.6, 2), part(GEO.plane, cloth(f.color), 1.8, 1.1, 1, 0.9, 7.4, 2));
    root.add(bake(v.body, key, true)); v.models.push(root);
  } else if (type === 'barracks') {
    // long timber hut with a pitched roof
    v.body = new THREE.Group();
    v.body.add(part(GEO.box, 0x8a7050, 5.6, 2.6, 5.2, 0, 1.3, 0), part(ROOF, f.vehicle, 1, 1, 1, 0, 2.6, 0).rotateY(Math.PI / 2), part(GEO.box, 0x3a2e20, 1.2, 1.8, 0.2, 0, 0.9, 2.62));
    root.add(bake(v.body, key, true)); v.models.push(root);
  } else if (type === 'motorpool') {
    // open vehicle shed: posts, a flat roof, oil drums
    const post = 0x5a4a34;
    v.body = new THREE.Group();
    for (const [x, z] of [[-2.7, -2.7], [2.7, -2.7], [-2.7, 2.7], [2.7, 2.7]]) v.body.add(part(GEO.box, post, 0.35, 3.2, 0.35, x, 1.6, z));
    v.body.add(part(GEO.box, f.vehicle, 6, 0.3, 6, 0, 3.3, 0), part(GEO.box, 0x4a4a44, 5.6, 0.1, 5.6, 0, 0.05, 0), part(GEO.box, post, 5.6, 1.4, 0.3, 0, 0.7, -2.7));
    for (let i = 0; i < 3; i++) v.body.add(part(GEO.cyl, 0x3a4a30, 0.4, 1.1, 0.4, 2.2, 0.55, -1.6 + i * 0.85));
    root.add(bake(v.body, key, true)); v.models.push(root);
  } else if (type === 'depot') {
    // supply dump: stacked crates and fuel drums
    const crate = 0x6e5836;
    v.body = new THREE.Group();
    v.body.add(part(GEO.box, 0x5a4a34, 3.8, 0.2, 3.8, 0, 0.1, 0), part(GEO.box, crate, 1.4, 1.2, 1.4, -0.9, 0.7, -0.9), part(GEO.box, crate, 1.4, 1.2, 1.4, 0.7, 0.7, -0.9),
      part(GEO.box, crate, 1.2, 1, 1.2, -0.1, 1.8, -0.9));
    for (let i = 0; i < 4; i++) v.body.add(part(GEO.cyl, f.vehicle, 0.4, 1.1, 0.4, -1.1 + i * 0.75, 0.65, 1));
    root.add(bake(v.body, key, true)); v.models.push(root);
  } else if (type === 'bunker') {
    const shell = new THREE.Group();
    shell.add(part(GEO.box, 0x8a8a82, 5.2, 2.4, 5.2, 0, 1.2, 0), part(GEO.box, 0x74746c, 6, 0.5, 6, 0, 2.6, 0), part(GEO.box, 0x1e1e1a, 0.3, 0.4, 3, 2.62, 1.6, 0));
    for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; if (i % 4 === 0) continue; shell.add(part(GEO.box, 0x9c8a60, 1.6, 0.7, 0.8, Math.cos(a) * 4.6, 0.35, Math.sin(a) * 4.6).rotateY(-a + Math.PI / 2)); }
    shell.add(part(GEO.cyl, 0x4a3f30, 0.08, 4, 0.08, -1.8, 4.6, -1.8), part(GEO.plane, cloth(f.color), 1.8, 1.1, 1, -0.9, 6, -1.8));
    root.add(bake(shell, key, true));
    v.models.push(root);
  } else if (TANKS[type]) {
    const hull = buildTank(v, root, TANKS[type][fac] ?? TANKS[type].find(Boolean), f);
    v.fxTip = barrelTip(v.turret);
    bake(hull, key + '|hull', true); bake(v.turret, key + '|turret', true);
    v.models.push(root);
  } else if (type === 'rocket') {
    const body = f.vehicle;
    const tube = (x, y, z, len = 2.6) => part(GEO.cyl, DARK, 0.12, len, 0.12, x, y, z).rotateZ(Math.PI / 2);
    let hull;
    if (fac === 0) {
      // T34 Calliope: a Sherman with a box of tubes above the turret
      hull = buildTank(v, root, { hull: [4.4, 1.3, 2.5], turret: [1.8, 0.9, 1.6, -0.2, 0], gun: [2.0, 0.1] }, f);
      const rack = new THREE.Group(); rack.position.set(0, 1.1, 0); rack.rotation.z = 0.25;
      for (let i = 0; i < 12; i++) rack.add(tube(0.3, (i % 3) * 0.26, (Math.floor(i / 3) - 1.5) * 0.3, 2.8));
      v.turret.add(rack);
    } else if (fac === 1) {
      // Panzerwerfer: half-track, wheels up front, tracks behind, ten tubes in two rows
      hull = new THREE.Group(); v.turret = new THREE.Group();
      hull.add(part(GEO.box, body, 4.4, 1.0, 2.1, 0, 1.2, 0), part(GEO.box, body, 1.4, 0.9, 2.0, 1.6, 1.9, 0));
      for (const wz of [-1.0, 1.0]) hull.add(part(GEO.cyl, DARK, 0.45, 0.3, 0.45, 1.6, 0.45, wz).rotateX(Math.PI / 2), part(GEO.box, DARK, 2.8, 0.8, 0.5, -0.8, 0.45, wz));
      v.turret.position.set(-0.8, 1.9, 0);
      const rack = new THREE.Group(); rack.rotation.z = 0.45;
      for (let i = 0; i < 10; i++) rack.add(tube(0, (i % 2) * 0.3, (Math.floor(i / 2) - 2) * 0.28, 1.8));
      v.turret.add(rack);
      root.add(hull, v.turret);
    } else {
      // Katyusha: truck with long launch rails
      hull = new THREE.Group(); v.turret = new THREE.Group();
      hull.add(part(GEO.box, body, 4.4, 0.7, 2.1, 0, 1.0, 0), part(GEO.box, body, 1.3, 1.2, 2.0, 1.6, 1.8, 0), part(GEO.box, f.color, 0.5, 0.3, 2.02, 1.6, 2.45, 0));
      for (const wx of [-1.4, 0, 1.4]) for (const wz of [-1.05, 1.05]) hull.add(part(GEO.cyl, DARK, 0.45, 0.3, 0.45, wx, 0.45, wz).rotateX(Math.PI / 2));
      v.turret.position.set(-0.8, 1.7, 0);
      const rack = new THREE.Group(); rack.rotation.z = 0.5;
      for (let i = 0; i < 8; i++) rack.add(part(GEO.box, DARK, 3.4, 0.08, 0.14, 0, (i % 2) * 0.24, (Math.floor(i / 2) - 1.5) * 0.3));
      v.turret.add(rack);
      root.add(hull, v.turret);
    }
    v.fxTip = barrelTip(v.turret);
    bake(hull, key + '|hull', true); bake(v.turret, key + '|turret', true);
    v.models.push(root);
  } else {
    const helmet = new THREE.Color(f.uniform).lerp(new THREE.Color(f.color), 0.55).getHex(), scale = type === 'conscript' ? 1.25 : 1.35;
    SLOTS[type].forEach(([x, z], i) => {
      const raw = new THREE.Group(), far = new THREE.Group();
      raw.add(part(GEO.body, f.uniform, 1, 1, 1, 0, 0.72, 0), part(GEO.ball, SKIN, 0.19, 0.19, 0.19, 0, 1.24, 0));
      headgear(raw, fac, type, helmet);
      gear(raw, type, i, f);
      // far away: body, head and helmet only
      far.add(part(LOW.body, f.uniform, 1, 1, 1, 0, 0.72, 0), part(LOW.ball, SKIN, 0.19, 0.19, 0.19, 0, 1.24, 0));
      headgear(far, fac, type, helmet, LOW);
      const hi = bakeMeshes(raw, `${key}|man|${kit(type, i)}`, false), lo = bakeMeshes(far, `${key}|far`, false);
      lo.forEach((m) => (m.visible = false));
      // man: the node client/fx.js and the corpses use; pose: the body inside it that crouches and lies down
      const man = new THREE.Group(), pose = new THREE.Group();
      man.position.set(x * 1.3, 0, z * 1.3); man.scale.setScalar(scale);
      pose.add(...hi, ...lo); man.add(pose);
      man.userData = { slot: [x * 1.3, z * 1.3], pose, hi, lo };
      root.add(man); v.models.push(man);
    });
    v.squad = { w: [1, 0, 0, 0], far: false };
    const gun = new THREE.Group();
    if (type === 'flak') gun.add(part(GEO.box, DARK, 1.0, 0.5, 1.0, 0.4, 0.3, 0), part(GEO.cyl, DARK, 0.07, 2.2, 0.07, 1.0, 1.2, 0.15).rotateZ(-0.7), part(GEO.cyl, DARK, 0.07, 2.2, 0.07, 1.0, 1.2, -0.15).rotateZ(-0.7));
    if (type === 'mortar') gun.add(part(GEO.cyl, GEAR, 0.09, 1.1, 0.09, 0.7, 0.45, 0).rotateZ(-0.7), part(GEO.box, GEAR, 0.5, 0.06, 0.5, 0.45, 0.05, 0));
    if (type === 'mg') gun.add(part(GEO.cyl, GEAR, 0.07, 1.4, 0.07, 1.0, 0.45, 0).rotateZ(Math.PI / 2), part(GEO.box, GEAR, 0.4, 0.4, 0.5, 0.5, 0.3, 0));
    if (gun.children.length) root.add(bake(gun, key + '|gun', true));
    if (type === 'at') {
      v.turret = new THREE.Group(); v.turret.position.set(0.6, 0, 0);
      v.turret.add(part(GEO.box, f.vehicle, 0.12, 1.1, 1.6, 0.3, 0.9, 0), part(GEO.cyl, GEAR, 0.08, 2.6, 0.08, 1.5, 0.95, 0).rotateZ(Math.PI / 2),
        part(GEO.cyl, GEAR, 0.45, 0.2, 0.45, 0, 0.45, 0.8).rotateX(Math.PI / 2), part(GEO.cyl, GEAR, 0.45, 0.2, 0.45, 0, 0.45, -0.8).rotateX(Math.PI / 2));
      v.fxTip = barrelTip(v.turret);
      root.add(bake(v.turret, key + '|turret', true));
    }
  }
}

// Per frame for each unit: soldiers blend toward the posture the snapshot asks for (over POSTURE.blend seconds) and
// swap to the far-away model beyond the LOD distance. eye is the camera position.
export function animate(v, dt, eye) {
  const sq = v.squad;
  if (!sq) return;
  const lim = gfx.low ? LOD.low : LOD.high, dx = eye.x - v.x, dy = eye.y - v.root.position.y, dz = eye.z - v.z, d2 = dx * dx + dy * dy + dz * dz;
  const far = sq.far ? d2 > (lim - 4) ** 2 : d2 > (lim + 4) ** 2;
  if (far !== sq.far) {
    sq.far = far;
    for (const man of v.models) { for (const m of man.userData.hi) m.visible = !far; for (const m of man.userData.lo) m.visible = far; }
  }
  const goal = postureOf(v.supp ?? 0, v.flags ?? 0, v.cover), w = sq.w, step = dt / POSTURE.blend;
  let moved = false;
  for (let i = 0; i < 4; i++) {
    const d = (i === goal ? 1 : 0) - w[i];
    if (d) { w[i] += Math.max(-step, Math.min(step, d)); moved = true; }
  }
  if (!moved && goal === 0) return; // standing: the height applySnapshot sets is right
  const p = [0, 0, 0, 0, 0, 0];
  let sum = 0;
  for (let i = 0; i < 4; i++) if (w[i]) { sum += w[i]; for (let k = 0; k < 6; k++) p[k] += w[i] * POSES[i][k]; }
  for (let k = 0; k < 6; k++) p[k] /= sum;
  const ox = p[4] - HAND[0], oy = p[5] - HAND[1], sink = v.cover === 2 ? -0.6 : 0;
  for (const man of v.models) {
    const u = man.userData, s = man.scale.x;
    man.position.set(u.slot[0] + ox * s, sink + oy * s, u.slot[1]);
    u.pose.rotation.z = p[0]; u.pose.scale.y = p[1]; u.pose.position.set(p[2] - ox, p[3] - oy, 0);
  }
}

// Corpses: one instanced mesh (one draw call) holding up to CAP bodies. Past SOFT bodies the oldest starts to fade;
// a body also fades once it is LIFE seconds old; faded bodies leave the pool.
export const CORPSES = { cap: 200, soft: 184, life: 25, fade: 1.5 };
export function createBodies() {
  const { cap, soft, life, fade: FADE } = CORPSES;
  const geo = GEO.body.clone(), fade = new THREE.InstancedBufferAttribute(new Float32Array(cap).fill(1), 1);
  geo.setAttribute('fade', fade);
  const material = new THREE.MeshLambertMaterial({ color: 0x3a372c, transparent: true });
  material.onBeforeCompile = (sh) => {
    sh.vertexShader = 'attribute float fade;\nvarying float vFade;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvFade = fade;');
    sh.fragmentShader = 'varying float vFade;\n' + sh.fragmentShader.replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( diffuse, opacity * vFade );');
  };
  const mesh = new THREE.InstancedMesh(geo, material, cap);
  mesh.count = 0; mesh.frustumCulled = false;
  const list = [], m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), at = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  const changed = () => { mesh.instanceMatrix.needsUpdate = true; fade.needsUpdate = true; };
  function drop(i) {
    const last = list.length - 1;
    if (i !== last) { mesh.getMatrixAt(last, m4); mesh.setMatrixAt(i, m4); fade.array[i] = fade.array[last]; list[i] = list[last]; }
    list.pop(); mesh.count = list.length; changed();
  }
  function clear() { list.length = 0; mesh.count = 0; }
  return {
    get count() { return list.length; },
    // a body lying where a soldier fell; world is the match's scene group
    add(world, x, y, z) {
      if (mesh.parent !== world) { world.add(mesh); clear(); }
      let live = 0, oldest = -1, most = -1;
      list.forEach((b, i) => {
        if (b.out === undefined) { live++; if (oldest < 0 || b.age > list[oldest].age) oldest = i; }
        else if (most < 0 || b.out < list[most].out) most = i;
      });
      if (live >= soft && oldest >= 0) list[oldest].out = FADE;
      if (list.length >= cap) drop(most >= 0 ? most : oldest);
      e.set(0, Math.random() * 6, Math.PI / 2); q.setFromEuler(e); at.set(x, y, z);
      mesh.setMatrixAt(list.length, m4.compose(at, q, one)); fade.array[list.length] = 1;
      list.push({ age: 0 }); mesh.count = list.length; changed();
    },
    update(dt) {
      if (list.length && !mesh.parent?.parent) clear(); // the match ended: its world left the scene
      for (let i = list.length - 1; i >= 0; i--) {
        const b = list[i];
        b.age += dt;
        if (b.out === undefined && b.age >= life) b.out = FADE;
        if (b.out === undefined) continue;
        b.out -= dt;
        if (b.out <= 0) drop(i); else { fade.array[i] = b.out / FADE; fade.needsUpdate = true; }
      }
    },
  };
}
