// Unit models: soldiers, vehicles, guns and the structures units build, plus how squads stand (posture), the cheap
// far-away soldier, and the pooled corpses.
//
// Models come from the families in client/models/ (infantry, armor-medium, armor-lightheavy, wheeled, guns) or, for
// the stand-in structures, from boxes, cylinders and capsules, and are then baked: every part with a plain color
// becomes part of one mesh that carries its colors per vertex and shares one material, so a soldier, a hull or a
// turret is one draw call. Parts with a special material (two-sided flags, the textured wood and sandbag surfaces
// main.js hands in through setSurfaces) merge with the other parts that use it. Planes and the airfield are not built here:
// client/aircraft.js builds them (main.js sends those types there).
// Baked geometry is cached per look, so the second rifle squad of a color reuses the first one's geometry.
// The shared material takes the model textures (client/model-textures.js): each vertex also says what it is made of
// (part(..., mat), see MATS in client/models/geom.js) and how much grime it has gathered (baked here, by height).
import * as THREE from 'three';
import { gfx } from './gfx.js';
import { modelMaterial } from './model-textures.js';
import { MATS, UNSET, matId, baseMat } from './models/geom.js';
import { soldier, AIM_SHIFT } from './models/infantry.js';
import { moveSquad, gaitWeights } from './squad-motion.js';
import { isArmorMedium, buildArmorMedium } from './models/armor-medium.js';
import { lightHeavy } from './models/armor-lightheavy.js';
import { isWheeled, wheeledModel } from './models/wheeled.js';
import { gunModel, GUN_SLOTS, sandbagRing } from './models/guns.js'; // the crew-served weapons (machine guns, mortars, AT guns, flak) and the flak position's sandbags

// unit-sized shapes, scaled per part (body: the corpses; client/models/infantry.js builds the soldiers)
const GEO = {
  box: new THREE.BoxGeometry(1, 1, 1), cyl: new THREE.CylinderGeometry(1, 1, 1, 12),
  body: new THREE.CapsuleGeometry(0.3, 0.8, 4, 8), plane: new THREE.PlaneGeometry(1, 1),
};

// barracks roof: a triangle pushed out along the hut
const ROOF = (() => {
  const shape = new THREE.Shape([new THREE.Vector2(-3, 0), new THREE.Vector2(3, 0), new THREE.Vector2(0, 1.8)]), g = new THREE.ExtrudeGeometry(shape, { depth: 5.6, bevelEnabled: false });
  g.translate(0, 0, -2.8);
  return g;
})();

const DARK = 0x2a2a24;
// one material for every plain-colored part; the color sits in the geometry, the texture detail comes from what each
// vertex is made of (painted armor where a mesh built outside mergeParts does not say)
export const PAINT = modelMaterial(new THREE.MeshLambertMaterial({ vertexColors: true }), { mat: 'armor-paint', grime: true });
// Neutral tone mapping removes most of the low, neutral sky fill. Keep shaded vehicle paint readable with a
// diffuse-colored bounce fill, strongest away from the sun. It follows the textured paint, including dark tires.
const vehiclePaint = new THREE.MeshLambertMaterial({ vertexColors: true });
vehiclePaint.onBeforeCompile = (shader) => {
  shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  #if NUM_DIR_LIGHTS > 0
    totalEmissiveRadiance += diffuseColor.rgb * (0.08 + 0.45 * (1.0 - max(dot(normal, directionalLights[0].direction), 0.0)));
  #else
    totalEmissiveRadiance += diffuseColor.rgb * 0.3;
  #endif`);
};
vehiclePaint.customProgramCacheKey = () => 'vehicle-bounce-fill';
export const VEHICLE_PAINT = modelMaterial(vehiclePaint, { mat: 'armor-paint', grime: true });
const colors = new Map();
const colorOf = (hex) => colors.get(hex) || colors.set(hex, new THREE.Color(hex)).get(hex);
const cloths = new Map();
const cloth = (color) => cloths.get(color) || cloths.set(color, new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide })).get(color);
// textured structure materials (sandbag, wood, darkwood): main.js passes client/surfaces.js surface(); without it
// (the tests run in Node, where textures cannot load) each part keeps its plain color
let skin = (_key, color) => color;
export function setSurfaces(surface) { skin = (key) => surface(key); }
// base buildings (HQ, barracks, motor pool, depot, command bunker): main.js passes client/structures.js buildingModel(),
// one merged miniature per type and team; without it (the Node tests) the box models below stand in
const BUILDINGS = new Set(['hq', 'barracks', 'motorpool', 'depot', 'bunker']);
let building = null;
export function setBuildings(model) { building = model; }

// a part before baking: shape, color (a number) or material, then scale and position like the old mesh() helper, and
// what it is made of (a MATS name from client/models/geom.js, or 'plain' for no texture; left out, the shape's own
// material ids or the model's default)
function part(geo, paint, sx = 1, sy = 1, sz = 1, x = 0, y = 0, z = 0, mat) {
  const o = new THREE.Object3D();
  o.userData.geo = geo; o.userData.paint = paint; o.userData.mat = mat;
  o.scale.set(sx, sy, sz); o.position.set(x, y, z);
  return o;
}

// What a model is made of where its parts do not say, and how it gathers grime: mat is the default material; below
// mud (in the model's own units above its feet) the mud builds up, dust is the light grime everywhere above, most
// the most anywhere. Planes have none (client/aircraft.js).
export const LOOKS = {
  vehicle: { mat: 'armor-paint', mud: 0.75, dust: 0.18, most: 0.9 },
  gun: { mat: 'armor-paint', mud: 0.22, dust: 0.12, most: 0.7 },
  soldier: { mat: 'wool', mud: 0.3, dust: 0.2, most: 0.6 },
  structure: { mat: 'armor-paint', mud: 0.6, dust: 0.1, most: 0.8 },
};
const GUNMETAL = MATS.indexOf('gunmetal');
// near-black, colorless paint (the DARK parts) is bare dark steel unless the part says otherwise
const darkSteel = (c) => c && Math.max(c.r, c.g, c.b) < 0.032 && Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b) < 0.012;
const smooth01 = (t) => { const k = Math.min(1, Math.max(0, t)); return k * k * (3 - 2 * k); };
// grime at a height y above the model's feet (normal ny): mud low down, dust above it (a bit more on top faces)
function grimeAt(L, y, ny) {
  const mud = 1 - smooth01((y - L.mud * 0.1) / (L.mud * 0.9)), dust = L.dust ? L.dust + 0.12 * Math.max(0, ny) : 0;
  return Math.min(L.most, Math.max(mud, dust), 0.98);
}

// Concatenate the parts' attributes into one geometry: transforms baked in, normals through the normal matrix,
// indices offset by the vertices before them. Colors per vertex when the parts share PAINT (the part's color times
// the shape's own vertex colors when it has them), and with them a material id per vertex ('matId': the shape's own
// id, else the part's mat, else near-black paint as gunmetal, else the look's default) carrying the grime in its
// fraction (id + grime / 2). look: a LOOKS name; lift: how high the model's feet sit (a turret on its hull).
export function mergeParts(parts, withColor, look = 'vehicle', lift = 0) {
  let nv = 0, ni = 0;
  for (const p of parts) { const n = p.geo.attributes.position.count; nv += n; ni += p.geo.index ? p.geo.index.count : n; }
  const uv = !withColor && parts.every((p) => p.geo.attributes.uv); // texture coordinates only for textured materials
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = withColor ? new Float32Array(nv * 3) : null, uvs = uv ? new Float32Array(nv * 2) : null;
  const mat = withColor ? new Float32Array(nv) : null, L = LOOKS[look] ?? LOOKS.vehicle;
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni), nm = new THREE.Matrix3(), t = new THREE.Vector3();
  let vo = 0, io = 0;
  for (const p of parts) {
    const P = p.geo.attributes.position, N = p.geo.attributes.normal, U = p.geo.attributes.uv, I = p.geo.index;
    // a shape that brings its own vertex colors (client/models/geom.js wheels, tracks, markings) is tinted by the paint
    const G = col ? p.geo.attributes.color : null, M = p.geo.attributes.matId;
    const fill = mat ? (p.mat != null ? matId(p.mat) : !G && darkSteel(p.color) ? GUNMETAL : matId(L.mat)) : 0;
    nm.getNormalMatrix(p.matrix);
    for (let i = 0; i < P.count; i++) {
      t.fromBufferAttribute(P, i).applyMatrix4(p.matrix).toArray(pos, (vo + i) * 3);
      const y = t.y;
      t.fromBufferAttribute(N, i).applyMatrix3(nm).normalize().toArray(nor, (vo + i) * 3);
      if (col) p.color.toArray(col, (vo + i) * 3);
      if (G) { const o = (vo + i) * 3; col[o] *= G.getX(i); col[o + 1] *= G.getY(i); col[o + 2] *= G.getZ(i); }
      if (uvs) { uvs[(vo + i) * 2] = U.getX(i); uvs[(vo + i) * 2 + 1] = U.getY(i); }
      if (mat) {
        const own = M ? baseMat(M.getX(i)) : UNSET;
        mat[vo + i] = (own === UNSET ? fill : own) + grimeAt(L, y + lift, t.y) / 2;
      }
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
  if (mat) g.setAttribute('matId', new THREE.BufferAttribute(mat, 1));
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

// Bake the parts under group into meshes (one per material), cached under key. Returns the meshes. look: a LOOKS
// name, for the default material and the grime (which counts the group's own height, so a turret starts clean).
const baked = new Map();
function bakeMeshes(group, key, shadow, poses = null, look = 'vehicle') {
  let list = baked.get(key);
  if (!list) {
    const buckets = new Map();
    group.traverse((o) => {
      const d = o.userData;
      if (!d.geo) return;
      const material = d.paint.isMaterial ? d.paint : look === 'vehicle' ? VEHICLE_PAINT : PAINT;
      if (!buckets.has(material)) buckets.set(material, []);
      buckets.get(material).push({ geo: d.geo, matrix: relative(o, group), color: material === PAINT || material === VEHICLE_PAINT ? colorOf(d.paint) : null, mat: d.mat });
    });
    list = [...buckets].map(([material, parts]) => ({ material, geometry: mergeParts(parts, material === PAINT || material === VEHICLE_PAINT, look, group.position.y) }));
    if (poses) poseMorphs(list[0].geometry, poses.poses, poses.gait, poses.muzzle);
    baked.set(key, list);
  }
  return list.map(({ material, geometry }) => { const m = new THREE.Mesh(geometry, material); m.castShadow = shadow; return m; });
}
// bake in place: the group keeps its transform and gets the baked meshes as its only children
function bake(group, key, shadow, look = 'vehicle') {
  const meshes = bakeMeshes(group, key, shadow, null, look);
  group.clear(); group.add(...meshes);
  return group;
}

// Formation slots in local space (+x = forward). Gun crews stand behind the gun.
// Line infantry is drawn as a battalion: a block of ranks with more men than the sim counts (def.models), front rank
// first so the rear ranks thin out as the squad loses health. Purely a look; main.js maps health onto the men drawn.
// ponytail: one mesh per man, so about 3x the draw calls for these squads; instance the men if big armies drop frames
const block = (cols, rows, gap = 0.65) => Array.from({ length: cols * rows }, (_, i) => [((rows - 1) / 2 - Math.floor(i / cols)) * gap, (i % cols - (cols - 1) / 2) * gap]);
const SLOTS = {
  rifle: block(5, 3),
  ...GUN_SLOTS, // mg, mortar, at, flak: around the weapons of client/models/guns.js
  sniper: [[0.4, 0], [-0.5, 0.6]],
  medic: [[0.3, 0.4], [-0.3, -0.4]],
  engineer: block(3, 2),
  ranger: block(6, 2),
  conscript: block(7, 3),
};
const BLOCKS = new Set(['rifle', 'engineer', 'ranger', 'conscript']); // smaller men, so the ranks stand shoulder to shoulder

// soldier posture, blended by weight: [lean (rad, + = back), height scale, shift x, shift y, weapon x, weapon y]
// in the soldier's own units (+x forward, feet at 0). The weapon point is where muzzle flashes start (client/fx.js
// uses about (0.7, 1.05) on a standing man); the soldier node moves by AIM_SHIFT (client/models/infantry.js) so it
// lands on the muzzle the figure aims in each posture. The lean, squash and shift only shape the blend between
// postures: client/models/infantry.js builds every posture as its own morph target, and poseMorphs() stores each one
// undone by its pose transform, so at full weight a soldier stands, kneels or lies exactly as built.
const HAND = [0.7, 1.05];
const PRONE_LEAN = -1.49, PRONE_X = -0.95, PRONE_Y = 0.12;
const POSES = [
  [0, 1, 0, 0],                       // standing
  [0, 1, 0, 0],                       // kneeling (suppressed, supp >= 50)
  [PRONE_LEAN, 1, PRONE_X, PRONE_Y],  // lying down (pinned, supp >= 90): the body tips over as it goes down
  [0, 1, 0, 0],                       // running back (retreating)
].map((p, k) => [...p, HAND[0] + AIM_SHIFT[k][0], HAND[1] + AIM_SHIFT[k][1]]);
export const POSTURE = { crouch: 50, prone: 90, blend: 0.3 };
// retreating wins over suppression; in a trench (cover 2) a pinned squad crouches, since lying down there would
// sink it out of sight below the ground
export const postureOf = (supp, flags, cover) => (flags & 1 ? 3 : supp >= POSTURE.prone && cover !== 2 ? 2 : supp >= POSTURE.crouch ? 1 : 0);
// The posture morph targets: poses holds the figure's kneeling, prone and running builds ({position, normal}, the
// same vertices as the standing one). Each is stored undone by its pose's lean, squash and shift, which animate()
// applies to the whole body, so the two cancel at full weight.
function poseMorphs(g, poses, gait = [], muzzle) {
  const n = g.attributes.position.count, pos = [], nor = [], tips = muzzle ? [muzzle.clone()] : null;
  const frames = [...poses.map((p, i) => ({ ...p, posture: i + 1 })), ...gait];
  for (const frame of frames) {
    const k = frame.posture, [lean, sy, tx, ty] = POSES[k], c = Math.cos(lean), s = Math.sin(lean), P = frame.position, N = frame.normal;
    if (P.count !== n) throw new Error(`posture ${k}: ${P.count} vertices, not ${n}`);
    const p = new THREE.BufferAttribute(new Float32Array(n * 3), 3), q = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
    for (let i = 0; i < n; i++) {
      const x = P.getX(i) - tx, y = P.getY(i) - ty, nx = N.getX(i), ny = N.getY(i);
      p.setXYZ(i, x * c + y * s, (y * c - x * s) / sy, P.getZ(i));
      const mx = nx * c + ny * s, my = (ny * c - nx * s) * sy, len = Math.hypot(mx, my, N.getZ(i)) || 1;
      q.setXYZ(i, mx / len, my / len, N.getZ(i) / len);
    }
    pos.push(p); nor.push(q);
    if (tips) {
      const tip = frame.muzzle ?? muzzle, x = tip.x - tx, y = tip.y - ty;
      tips.push(new THREE.Vector3(x * c + y * s, (y * c - x * s) / sy, tip.z));
    }
  }
  g.userData.muzzles = tips;
  g.morphAttributes.position = pos; g.morphAttributes.normal = nor;
  g.computeBoundingSphere();
}
// beyond this camera distance soldiers swap to the far-away model (closer on Low graphics)
export const LOD = { high: 110, low: 80 };

// Armored cars, the M16, the Panzerwerfer and the Katyusha: client/models/wheeled.js builds the hull and the traversing
// part as two vertex-colored geometries (shared per look); baked like the tanks, so they carry their materials and grime.
function wheeledUnit(v, root, f, fac, key) {
  const m = wheeledModel(v.type, fac, f), hull = new THREE.Group();
  hull.add(part(m.hull, 0xffffff));
  v.turret = new THREE.Group(); v.turret.position.set(...m.turretAt); v.turret.add(part(m.turret, 0xffffff));
  v.fxTip = m.tip;
  root.add(hull, v.turret);
  bake(hull, key + '|hull', true); bake(v.turret, key + '|turret', true);
  v.models.push(root);
}

// Builds the model of unit v under root: v.models (soldiers, or the root for vehicles and structures), v.turret,
// v.body (structures and planes; it scales up while built), v.fxTip (barrel tip for client/fx.js).
// f is the owner's look (uniform, vehicle and player colors), fac the faction, def the unit's stats.
export function buildModel(v, root, f, fac, def) {
  const type = v.type, key = `${type}|${fac}|${f.color}`;
  if (def.air || type === 'airfield') return; // client/aircraft.js builds these
  if (isWheeled(type, fac)) { wheeledUnit(v, root, f, fac, key); return; }
  if (type === 'flakpos') {
    // a sandbagged ring with a twin gun pointing up
    v.body = new THREE.Group();
    v.body.add(part(sandbagRing(), skin('sandbag', 0x9c8a60))); // two staggered courses of rounded bags with a gap for the entrance
    v.body.add(part(gunModel('flakpos', fac, f).geo, 0xffffff)); // the twin gun on its pedestal
    root.add(bake(v.body, key, true, 'structure')); v.models.push(root);
  } else if (building && BUILDINGS.has(type)) {
    // the command bunker stands from the first second (never built), so it keeps no v.body to scale
    const model = building(type, f);
    if (type !== 'bunker') v.body = model;
    root.add(model); v.models.push(root);
  } else if (type === 'hq') {
    // command post: sandbagged timber block with a radio mast
    v.body = new THREE.Group();
    v.body.add(part(GEO.box, skin('wood', 0x7a6446), 5.4, 3, 5.4, 0, 1.5, 0), part(GEO.box, skin('darkwood', 0x5a4a34), 6, 0.4, 6, 0, 3.2, 0), part(GEO.box, f.vehicle, 5.6, 0.5, 1.2, 0, 1.2, 2.5),
      part(GEO.cyl, DARK, 0.06, 5, 0.06, 2, 5.6, 2), part(GEO.plane, cloth(f.color), 1.8, 1.1, 1, 0.9, 7.4, 2));
    root.add(bake(v.body, key, true, 'structure')); v.models.push(root);
  } else if (type === 'barracks') {
    // long timber hut with a pitched roof
    v.body = new THREE.Group();
    v.body.add(part(GEO.box, skin('wood', 0x8a7050), 5.6, 2.6, 5.2, 0, 1.3, 0), part(ROOF, f.vehicle, 1, 1, 1, 0, 2.6, 0).rotateY(Math.PI / 2), part(GEO.box, skin('darkwood', 0x3a2e20), 1.2, 1.8, 0.2, 0, 0.9, 2.62));
    root.add(bake(v.body, key, true, 'structure')); v.models.push(root);
  } else if (type === 'motorpool') {
    // open vehicle shed: posts, a flat roof, oil drums
    const post = skin('darkwood', 0x5a4a34);
    v.body = new THREE.Group();
    for (const [x, z] of [[-2.7, -2.7], [2.7, -2.7], [-2.7, 2.7], [2.7, 2.7]]) v.body.add(part(GEO.box, post, 0.35, 3.2, 0.35, x, 1.6, z));
    v.body.add(part(GEO.box, f.vehicle, 6, 0.3, 6, 0, 3.3, 0), part(GEO.box, 0x4a4a44, 5.6, 0.1, 5.6, 0, 0.05, 0), part(GEO.box, post, 5.6, 1.4, 0.3, 0, 0.7, -2.7));
    for (let i = 0; i < 3; i++) v.body.add(part(GEO.cyl, 0x3a4a30, 0.4, 1.1, 0.4, 2.2, 0.55, -1.6 + i * 0.85));
    root.add(bake(v.body, key, true, 'structure')); v.models.push(root);
  } else if (type === 'depot') {
    // supply dump: stacked crates and fuel drums
    const crate = skin('wood', 0x6e5836);
    v.body = new THREE.Group();
    v.body.add(part(GEO.box, skin('darkwood', 0x5a4a34), 3.8, 0.2, 3.8, 0, 0.1, 0), part(GEO.box, crate, 1.4, 1.2, 1.4, -0.9, 0.7, -0.9), part(GEO.box, crate, 1.4, 1.2, 1.4, 0.7, 0.7, -0.9),
      part(GEO.box, crate, 1.2, 1, 1.2, -0.1, 1.8, -0.9));
    for (let i = 0; i < 4; i++) v.body.add(part(GEO.cyl, f.vehicle, 0.4, 1.1, 0.4, -1.1 + i * 0.75, 0.65, 1));
    root.add(bake(v.body, key, true, 'structure')); v.models.push(root);
  } else if (type === 'bunker') {
    const shell = new THREE.Group();
    shell.add(part(GEO.box, 0x8a8a82, 5.2, 2.4, 5.2, 0, 1.2, 0), part(GEO.box, 0x74746c, 6, 0.5, 6, 0, 2.6, 0), part(GEO.box, 0x1e1e1a, 0.3, 0.4, 3, 2.62, 1.6, 0));
    for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; if (i % 4 === 0) continue; shell.add(part(GEO.box, skin('sandbag', 0x9c8a60), 1.6, 0.7, 0.8, Math.cos(a) * 4.6, 0.35, Math.sin(a) * 4.6).rotateY(-a + Math.PI / 2)); }
    shell.add(part(GEO.cyl, 0x4a3f30, 0.08, 4, 0.08, -1.8, 4.6, -1.8), part(GEO.plane, cloth(f.color), 1.8, 1.1, 1, -0.9, 6, -1.8));
    root.add(bake(shell, key, true, 'structure'));
    v.models.push(root);
  } else if (isArmorMedium(type, fac)) {
    // M4 Sherman, Panzer IV, T-34, T34 Calliope and Wirbelwind: client/models/armor-medium.js
    const hull = buildArmorMedium(v, root, type, fac, f);
    bake(hull, key + '|hull', true); bake(v.turret, key + '|turret', true);
    v.models.push(root);
  } else if (lightHeavy(type, fac, f)) {
    // the light tanks, the Tiger and the ZSU-37: client/models/armor-lightheavy.js, two painted geometries (cached)
    const lh = lightHeavy(type, fac, f), hull = new THREE.Group();
    hull.add(part(lh.hull, 0xffffff));
    v.turret = new THREE.Group(); v.turret.position.set(...lh.ring); v.turret.add(part(lh.turret, 0xffffff));
    root.add(hull, v.turret); v.fxTip = lh.tip;
    bake(hull, key + '|hull', true); bake(v.turret, key + '|turret', true);
    v.models.push(root);
  } else {
    const scale = BLOCKS.has(type) ? 1.1 : 1.35;
    const figure = type === 'medic' ? 'engineer' : type; // ponytail: medics borrow the engineer figure until they get their own
    SLOTS[type].forEach(([x, z], i) => {
      // client/models/infantry.js builds the figure, near and far, with its kneeling, prone and running builds in
      // userData.poses for the posture morph targets
      const s = soldier(figure, fac, i, f), poses = (g) => g.children[0].userData.geo.userData;
      const hi = bakeMeshes(s.near, `${key}|man|${s.kit}`, false, poses(s.near), 'soldier'), lo = bakeMeshes(s.far, `${key}|far|${s.kit}`, false, poses(s.far), 'soldier');
      lo.forEach((m) => (m.visible = false));
      // man: the node client/fx.js and the corpses use; pose: the body inside it that crouches and lies down
      const man = new THREE.Group(), pose = new THREE.Group();
      man.position.set(x * 1.3, 0, z * 1.3); man.scale.setScalar(scale);
      pose.add(...hi, ...lo); man.add(pose);
      man.userData = { slot: [x * 1.3, z * 1.3], pose, hi, lo, meshes: [...hi, ...lo], index: i };
      root.add(man); v.models.push(man);
    });
    v.squad = { w: [1, 0, 0, 0], far: false, moveFire: def.w?.moveFire !== undefined };
    // the weapon of a gun squad: one merged mesh. Guns that traverse (at, flak) are the whole of v.turret, with the muzzle in v.fxTip
    // Each also has a cheap far version, shown with the far-away soldiers (animate swaps them).
    const gm = gunModel(type, fac, f);
    if (gm) {
      const near = new THREE.Group(), far = gm.far ? new THREE.Group() : null, name = gm.pivot ? '|turret' : '|gun';
      near.add(part(gm.geo, 0xffffff)); bake(near, key + name, true, 'gun');
      if (far) { far.add(part(gm.far, 0xffffff)); bake(far, key + name + 'far', true, 'gun'); far.visible = false; v.squad.guns = { hi: near, lo: far }; }
      if (gm.pivot) { v.turret = new THREE.Group(); v.turret.position.set(...gm.pivot); v.turret.add(near, ...(far ? [far] : [])); v.fxTip = gm.tip; root.add(v.turret); }
      else { const both = new THREE.Group(); both.add(near, ...(far ? [far] : [])); root.add(both); } // one child of the root, so the viewer's solo switch leaves the swap alone
    }
  }
}

// Per frame for each unit: soldiers blend toward the posture the snapshot asks for (over POSTURE.blend seconds) and
// swap to the far-away model beyond the LOD distance. eye is the camera position.
export function animate(v, dt, eye, groundAt) {
  const sq = v.squad;
  if (!sq) return;
  const lim = gfx.low ? LOD.low : LOD.high, dx = eye.x - v.x, dy = eye.y - v.root.position.y, dz = eye.z - v.z, d2 = dx * dx + dy * dy + dz * dz;
  const far = sq.far ? d2 > (lim - 4) ** 2 : d2 > (lim + 4) ** 2;
  if (far !== sq.far) {
    sq.far = far;
    for (const man of v.models) { for (const m of man.userData.hi) m.visible = !far; for (const m of man.userData.lo) m.visible = far; }
    if (sq.guns) { sq.guns.hi.visible = !far; sq.guns.lo.visible = far; }
  }
  const goal = postureOf(v.supp ?? 0, v.flags ?? 0, v.cover), w = sq.w, step = dt / POSTURE.blend;
  for (let i = 0; i < 4; i++) {
    const d = (i === goal ? 1 : 0) - w[i];
    if (d) { w[i] += Math.max(-step, Math.min(step, d)); }
  }
  const aimGoal = sq.moveFire && v.tgt && !(v.flags & 1) ? 1 : 0;
  const aimBlend = sq.aimBlend ?? 0;
  sq.aimBlend = aimBlend + Math.max(-step, Math.min(step, aimGoal - aimBlend));
  moveSquad(v, dt);
  const sum = w.reduce((a, b) => a + b, 0);
  const sink = v.cover === 2 ? -0.6 : 0;
  for (const man of v.models) {
    const u = man.userData, s = man.scale.x, motion = u.motion;
    const blend = motion.blend;
    const aim = sq.aimBlend * blend * w[0] / sum;
    const upright = blend * (w[0] + w[3]) / sum - aim, crouch = blend * w[1] / sum, crawl = blend * w[2] / sum;
    const gait = u.gait ??= new Float64Array(20), pw = u.postureWeights ??= new Float64Array(4), mp = u.poseValues ??= new Float64Array(6);
    gait.fill(0); mp.fill(0);
    gaitWeights(motion.phase, upright, 8, gait, 0); gaitWeights(motion.phase, aim, 4, gait, 8);
    gaitWeights(motion.phase, crouch, 4, gait, 12); gaitWeights(motion.phase, crawl, 4, gait, 16);
    for (let i = 0; i < 4; i++) pw[i] = w[i] / sum * (1 - blend);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 6; j++) mp[j] += pw[i] * POSES[i][j];
    for (let j = 0; j < 6; j++) mp[j] += upright * POSES[3][j] + aim * POSES[0][j] + crouch * POSES[1][j] + crawl * POSES[2][j];
    const ox = mp[4] - HAND[0], oy = mp[5] - HAND[1];
    const tips = u.hi[0].geometry.userData.muzzles;
    if (tips) {
      const tip = u.muzzle ??= new THREE.Vector3();
      tip.copy(tips[0]).multiplyScalar(pw[0]);
      for (let j = 0; j < tips.length - 1; j++) tip.addScaledVector(tips[j + 1], j < 3 ? pw[j + 1] : gait[j - 3]);
      const c = Math.cos(mp[0]), sn = Math.sin(mp[0]), x = tip.x, y = tip.y * mp[1];
      tip.set(x * c - y * sn + mp[2] - ox, x * sn + y * c + mp[3] - oy, tip.z);
    }
    const floor = groundAt && !v.trench ? groundAt(motion.x, motion.z) - v.root.position.y : 0;
    man.position.set(motion.localX + ox * s, floor + sink + oy * s, motion.localZ);
    man.rotation.y = motion.localYaw;
    u.pose.rotation.z = mp[0]; u.pose.scale.y = mp[1]; u.pose.position.set(mp[2] - ox, mp[3] - oy, 0);
    for (const m of u.meshes) {
      for (let j = 0; j < 3; j++) m.morphTargetInfluences[j] = pw[j + 1];
      for (let j = 0; j < gait.length; j++) m.morphTargetInfluences[j + 3] = gait[j];
    }
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
