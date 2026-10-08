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
import { infantryMaterial, loadInfantryTextures } from './infantry-material.js';
import { moveSquad, gaitWeights } from './squad-motion.js';
import { moveModel } from './model-motion.js';
import { wheelMaterial, wheelMesh, moveWheels } from './wheel-motion.js';
import { mergeTracks, applyTracks } from './models/track-data.js';
import { isArmorMedium, buildArmorMedium } from './models/armor-medium.js';
import { lightHeavy } from './models/armor-lightheavy.js';
import { churchill } from './models/churchill.js';
import { cromwell } from './models/cromwell.js';
import { isWheeled, wheeledModel } from './models/wheeled.js';
import { bakedNavalModel } from './models/blender-baked.js';
import navalFinished from './models/naval-finished-data.js';
import { gunModel, GUN_SLOTS, sandbagRing } from './models/guns.js'; // the crew-served weapons (machine guns, mortars, AT guns, flak) and the flak position's sandbags

// unit-sized shapes, scaled per part. Soldiers, including the fallen ones, come from client/models/infantry.js.
const GEO = {
  box: new THREE.BoxGeometry(1, 1, 1), cyl: new THREE.CylinderGeometry(1, 1, 1, 12),
  plane: new THREE.PlaneGeometry(1, 1),
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
export const PAINT = modelMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 }), { mat: 'armor-paint', grime: true });
export const INFANTRY_PAINT = infantryMaterial(modelMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 }), { mat: 'wool', grime: true }));
// Painted steel, exposed tracks, tires and canvas share one draw while keeping separate surface responses.
export const VEHICLE_PAINT = wheelMaterial(modelMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.68, metalness: 0 }), { mat: 'armor-paint', grime: true }));
const colors = new Map();
const colorOf = (hex) => colors.get(hex) || colors.set(hex, new THREE.Color(hex)).get(hex);
const cloths = new Map();
const cloth = (color) => cloths.get(color) || cloths.set(color, new THREE.MeshStandardMaterial({ color, roughness: 1, metalness: 0, side: THREE.DoubleSide })).get(color);
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
  naval: { mat: 'armor-paint', mud: 0, dust: 0.03, most: 0.1 },
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
  const mud = L.mud > 0 ? 1 - smooth01((y - L.mud * 0.1) / (L.mud * 0.9)) : 0, dust = L.dust ? L.dust + 0.12 * Math.max(0, ny) : 0;
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
  const atlas = parts.some(p => p.geo.attributes.modelUV) ? new Float32Array(nv * 3) : null;
  const wheels = parts.some(p => p.geo.attributes.wheelPivot) ? new Float32Array(nv * 4) : null;
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni), nm = new THREE.Matrix3(), t = new THREE.Vector3(), wheelPoint = new THREE.Vector3();
  let vo = 0, io = 0;
  for (const p of parts) {
    const P = p.geo.attributes.position, N = p.geo.attributes.normal, U = p.geo.attributes.uv, I = p.geo.index;
    // a shape that brings its own vertex colors (client/models/geom.js wheels, tracks, markings) is tinted by the paint
    const G = col ? p.geo.attributes.color : null, M = p.geo.attributes.matId, A = p.geo.attributes.modelUV;
    const fill = mat ? (p.mat != null ? matId(p.mat) : !G && darkSteel(p.color) ? GUNMETAL : matId(L.mat)) : 0;
    nm.getNormalMatrix(p.matrix);
    const W = p.geo.attributes.wheelPivot, wheelScale = Math.hypot(...p.matrix.elements.slice(0, 3));
    for (let i = 0; i < P.count; i++) {
      t.fromBufferAttribute(P, i).applyMatrix4(p.matrix).toArray(pos, (vo + i) * 3);
      const y = t.y;
      t.fromBufferAttribute(N, i).applyMatrix3(nm).normalize().toArray(nor, (vo + i) * 3);
      if (col) p.color.toArray(col, (vo + i) * 3);
      if (G) { const o = (vo + i) * 3; col[o] *= G.getX(i); col[o + 1] *= G.getY(i); col[o + 2] *= G.getZ(i); }
      if (atlas && A) { atlas[(vo + i) * 3] = A.getX(i); atlas[(vo + i) * 3 + 1] = A.getY(i); atlas[(vo + i) * 3 + 2] = A.getZ(i); }
      if (wheels && W && W.getW(i) > 0) {
        wheelPoint.set(W.getX(i), W.getY(i), W.getZ(i)).applyMatrix4(p.matrix).toArray(wheels, (vo + i) * 4);
        wheels[(vo + i) * 4 + 3] = W.getW(i) * wheelScale;
      }
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
  if (atlas) g.setAttribute('modelUV', new THREE.BufferAttribute(atlas, 3));
  if (wheels) g.setAttribute('wheelPivot', new THREE.BufferAttribute(wheels, 4));
  applyTracks(g, mergeTracks(parts));
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
      const material = d.paint.isMaterial ? d.paint : look === 'soldier' ? INFANTRY_PAINT : look === 'vehicle' || look === 'naval' ? VEHICLE_PAINT : PAINT;
      if (!buckets.has(material)) buckets.set(material, []);
      buckets.get(material).push({ geo: d.geo, matrix: relative(o, group), color: material === PAINT || material === VEHICLE_PAINT || material === INFANTRY_PAINT ? colorOf(d.paint) : null, mat: d.mat });
    });
    list = [...buckets].map(([material, parts]) => ({ material, geometry: mergeParts(parts, material === PAINT || material === VEHICLE_PAINT || material === INFANTRY_PAINT, look, group.position.y) }));
    if (poses) poseMorphs(list[0].geometry, poses.poses, poses.gait, poses.muzzle, poses.fallen);
    baked.set(key, list);
  }
  return list.map(({ material, geometry }) => { const m = wheelMesh(geometry, material); m.castShadow = shadow; m.userData.baked = material; return m; });
}
// bake in place: the group keeps its transform and gets the baked meshes as its only children
function bake(group, key, shadow, look = 'vehicle') {
  const meshes = bakeMeshes(group, key, shadow, null, look);
  group.clear(); group.add(...meshes);
  return group;
}

// ---------- the Kaiju (Horde boss) ----------
// A giant atomic lizard, 17 m tall and 22 m nose to tail: charcoal hide (the rough cast-armor texture), a pale banded belly, three
// rows of bone plates down its back with a glow inside them, a head that turns to its target (v.turret, so the breath
// comes out of its mouth), and legs and a tail that move (stride() below). Every part is a scaled sphere, cone or
// cylinder, baked to one mesh per moving group.
const SPH = new THREE.SphereGeometry(1, 16, 12), CONE = new THREE.ConeGeometry(1, 1, 10);
const HIDE = 0x3b3f38, HIDE_DARK = 0x2a2d28, BELLY = 0x76705a, BONE = 0xcfe0e2, CLAW = 0xe2d9c0, TOOTH = 0xf0eadb, GUM = 0x5a1e18;
const GLOW = new THREE.MeshBasicMaterial({ color: 0x8fe8ff }), EYE = new THREE.MeshBasicMaterial({ color: 0xffcc40 });
const UP = new THREE.Vector3(0, 1, 0);
// a cylinder (or a sphere drawn out, round: true) from point a to point b, radius r
function seg(a, b, r, paint, round = false, mat = 'cast-armor') {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), d = B.clone().sub(A), len = d.length();
  const o = part(round ? SPH : GEO.cyl, paint, r, round ? len / 2 + r * 0.4 : len, r, ...A.add(B).multiplyScalar(0.5).toArray(), mat);
  o.quaternion.setFromUnitVectors(UP, d.normalize());
  return o;
}
// a spike, claw or tooth: a cone from a to its tip b, base radius r (flat < 1 squashes it sideways into a plate)
function spike(a, b, r, paint, flat = 1) {
  const o = seg(a, b, r, paint, false, 'plain');
  o.userData.geo = CONE; o.scale.z *= flat;
  return o;
}
// a fixed scatter, so every Kaiju wears the same bumps
const bumpRng = (n) => { let x = n; return () => (x = (x * 9301 + 49297) % 233280) / 233280; };
function kaiju(v, root, key) {
  // the body, from the hips up (the legs, tail and head are their own groups so they can move)
  const body = new THREE.Group(), L = 'cast-armor';
  body.add(part(SPH, HIDE, 3.3, 3, 3.5, 0, 7.6, 0, L), part(SPH, HIDE, 3, 4.3, 3.2, 0.6, 10.2, 0, L), part(SPH, HIDE, 2.6, 3, 2.9, 1.3, 12.8, 0, L),
    part(SPH, HIDE, 1.9, 2.3, 2, 2.3, 14.4, 0, L));
  // the belly, banded like a crocodile's
  body.add(part(SPH, BELLY, 2.3, 4.6, 2.6, 1.6, 9.8, 0, L));
  for (let y = 6.2; y <= 13.4; y += 0.75) {
    const k = (y - 9.8) / 4.6, w = Math.sqrt(Math.max(0.1, 1 - k * k));
    body.add(part(GEO.box, 0x5e5946, 0.3, 0.14, 1.9 * w, 1.5 + 2.3 * w, y, 0, L));
  }
  // arms: short and clawed, held forward
  for (const z of [-1, 1]) {
    const sh = [2.4, 12.4, z * 2.5], el = [3.6, 10.6, z * 2.9], wr = [5, 10.4, z * 2.5];
    body.add(part(SPH, HIDE, 1.2, 1.2, 1.2, ...sh, L), seg(sh, el, 0.7, HIDE, true), seg(el, wr, 0.55, HIDE, true));
    for (const dz of [-0.45, 0, 0.45]) body.add(spike([5.3, 10.4, z * 2.5 + dz], [6.2, 9.7, z * 2.5 + dz * 1.4], 0.16, CLAW));
  }
  // knobbly hide: bumps over the back and flanks
  const r = bumpRng(7);
  for (let i = 0; i < 60; i++) {
    const a = Math.PI * (0.55 + r() * 0.9), y = 6.5 + r() * 7.5, k = (y - 10.2) / 4.6, rad = Math.sqrt(Math.max(0.15, 1 - k * k)), side = r() < 0.5 ? 1 : -1;
    body.add(part(SPH, r() < 0.5 ? HIDE_DARK : HIDE, 0.35 + r() * 0.3, 0.3 + r() * 0.25, 0.35 + r() * 0.3, 0.6 + Math.cos(a) * 3 * rad, y, Math.sin(a) * 3.2 * rad * side, L));
  }
  // dorsal plates: bone outside and the glow inside, a tall middle row and two lower rows splayed out
  const plates = (g, spine) => spine.forEach(([x, y, h, lean = 0.5], i) => {
    for (const [z, s, tilt] of [[0, 1, 0], [-0.7, 0.62, -0.35], [0.7, 0.62, 0.35]]) {
      const H = h * s * (i % 2 ? 0.8 : 1);
      g.add(spike([x, y, z], [x - H * lean, y + H, z + tilt * H], H * 0.42, BONE, 0.2),
        spike([x, y + 0.1, z], [x - H * lean * 0.9, y + H * 0.9, z + tilt * H * 0.9], H * 0.36, GLOW, 0.34));
    }
  });
  plates(body, [[1.2, 15.6, 1.4], [0.4, 14.9, 1.9], [-0.5, 14, 2.3], [-1.4, 12.8, 2.6], [-2.1, 11.5, 2.8], [-2.6, 10.1, 2.7], [-3, 8.7, 2.5], [-3.3, 7.4, 2.2, 0.7]]);
  // the head (v.turret): skull, snout, jaw hanging open, two rows of teeth, glowing eyes under heavy brows, horns
  const head = new THREE.Group(); head.position.set(3, 15.4, 0);
  head.add(part(SPH, HIDE, 1.9, 1.4, 1.5, 0.5, 0.3, 0, L), part(SPH, HIDE, 1.7, 0.8, 1.05, 2.1, 0.05, 0, L), part(SPH, HIDE_DARK, 0.9, 0.5, 0.9, -0.6, 0.6, 0, L),
    part(SPH, GUM, 1.5, 0.45, 0.85, 2, -0.45, 0, 'plain'));
  const jaw = part(SPH, HIDE, 1.65, 0.45, 0.95, 1.9, -0.95, 0, L); jaw.rotation.z = -0.22; head.add(jaw);
  for (let x = 1; x <= 3.3; x += 0.32) for (const z of [-1, 1]) {
    const w = 0.78 - (x - 1) * 0.12, low = (x - 1) * 0.12;
    head.add(spike([x, -0.35, z * w], [x + 0.05, -0.85, z * w], 0.1, TOOTH), spike([x - 0.1, -0.95 - low, z * w * 0.95], [x - 0.08, -0.55 - low, z * w * 0.95], 0.08, TOOTH));
  }
  for (const z of [-1, 1]) {
    head.add(part(SPH, EYE, 0.24, 0.17, 0.2, 1.45, 0.55, z * 0.92, 'plain'), part(GEO.box, HIDE_DARK, 1, 0.28, 0.4, 1.45, 0.82, z * 0.82, L).rotateX(z * 0.3),
      part(SPH, HIDE_DARK, 0.12, 0.08, 0.12, 3.55, 0.35, z * 0.3, 'plain'), spike([-0.3, 0.9, z * 0.7], [-1.5, 1.3, z * 1.1], 0.22, BONE));
  }
  // the tail, from the hips to a tip on the ground 15 m back, plated along its top
  const tail = new THREE.Group(); tail.position.set(-3, 7, 0);
  const pts = Array.from({ length: 11 }, (_, i) => { const t = i / 10; return [-t * 15, -6.2 * Math.sqrt(t) + Math.sin(t * Math.PI) * 0.8, Math.sin(t * 2.6) * 1.2 * t]; });
  for (let i = 0; i < 10; i++) tail.add(seg(pts[i], pts[i + 1], 2.5 * (1 - i / 10) + 0.25, HIDE, true));
  plates(tail, pts.slice(0, 9).map(([x, y], i) => [x - 0.6, y + 2.3 * (1 - i / 10) + 0.1, 1.9 * (1 - i / 11), 0.6]));
  // legs: thick thighs, a backward ankle, splayed clawed feet; each pivots at the hip
  v.legs = [-1, 1].map((z) => {
    const leg = new THREE.Group(); leg.position.set(0, 7, z * 2.4);
    leg.add(part(SPH, HIDE, 2, 2.8, 1.7, 0.3, -1.4, z * 0.2, L), seg([0.7, -3.2, z * 0.2], [-0.4, -5.6, z * 0.3], 1.05, HIDE, true), part(SPH, HIDE, 1, 1, 1, -0.4, -5.7, z * 0.3, L),
      part(SPH, HIDE, 1.9, 0.75, 1.4, 0.5, -6.55, z * 0.3, L), part(SPH, HIDE_DARK, 0.9, 0.6, 0.9, -0.7, -6.3, z * 0.3, L));
    for (const dz of [-0.75, 0, 0.75]) leg.add(spike([2, -6.7, z * 0.3 + dz], [3.1, -6.9, z * 0.3 + dz * 1.3], 0.22, CLAW));
    for (let i = 0; i < 6; i++) leg.add(part(SPH, HIDE_DARK, 0.4, 0.35, 0.4, -1.2 + (i % 3) * 0.5, -0.6 - Math.floor(i / 3) * 1.1, z * 1.5, L));
    return bake(leg, key + '|leg' + z, true);
  });
  bake(body, key + '|body', true); bake(head, key + '|head', true); bake(tail, key + '|tail', true);
  Object.assign(v, { turret: head, traverse: 1, fxTip: [3.6, -0.5, 0], tail, hull: body, walk: { phase: 0, t: 0, x: null, z: 0 } });
  root.add(body, head, tail, ...v.legs);
  v.models.push(root);
}
// the Kaiju walks: legs swing with the ground it covers, the body bobs, the tail swishes even standing still
function stride(v, dt) {
  const w = v.walk, moved = w.x === null ? 0 : Math.hypot(v.x - w.x, v.z - w.z);
  w.x = v.x; w.z = v.z; w.phase += moved / 3.2; w.t += dt;
  const s = Math.sin(w.phase), bob = Math.abs(Math.cos(w.phase)) * 0.35 * Math.min(1, moved * 20);
  v.legs[0].rotation.z = s * 0.5; v.legs[1].rotation.z = -s * 0.5;
  v.legs[0].position.y = 7 + Math.max(0, -s) * 0.4; v.legs[1].position.y = 7 + Math.max(0, s) * 0.4;
  v.hull.position.y = bob; v.hull.rotation.x = s * 0.04; v.turret.position.y = 15.4 + bob;
  v.tail.position.y = 7 + bob; v.tail.rotation.y = Math.sin(w.t * 0.9 + w.phase * 0.5) * 0.18;
}

// Formation slots in local space (+x = forward). Gun crews stand behind the gun.
// Line infantry is drawn as a battalion: a block of ranks with more men than the sim counts (def.models), front rank
// first so the rear ranks thin out as the squad loses health. Purely a look; main.js maps health onto the men drawn.
// Each man is his own mesh here; drawSoldiers() below draws all men of one figure as one instanced draw call.
const block = (cols, rows, gap = 0.65) => Array.from({ length: cols * rows }, (_, i) => [((rows - 1) / 2 - Math.floor(i / cols)) * gap, (i % cols - (cols - 1) / 2) * gap]);
const SLOTS = {
  rifle: block(5, 3),
  ...GUN_SLOTS, // mg, mortar, at, flak: around the weapons of client/models/guns.js
  sniper: [[0.4, 0], [-0.5, 0.6]],
  medic: [[0.3, 0.4], [-0.3, -0.4]],
  flamer: [[0.45, 0], [-0.25, 0.75], [-0.35, -0.7]], // the flamethrower ahead, a rifleman either side behind him
  engineer: block(3, 2),
  ranger: block(6, 2),
  commando: block(5, 3),
  conscript: block(7, 3),
};
const BLOCKS = new Set(['rifle', 'engineer', 'ranger', 'conscript', 'commando']); // smaller men, so the ranks stand shoulder to shoulder

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
function poseMorphs(g, poses, gait = [], muzzle, fallen = null) {
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
    // the idle aiming prone, before this undo. Corpses do not use it; they use userData.fallen.
    if (k === 2 && !g.userData.prone) g.userData.prone = { position: P, normal: N };
    if (tips) {
      const tip = frame.muzzle ?? muzzle, x = tip.x - tx, y = tip.y - ty;
      tips.push(new THREE.Vector3(x * c + y * s, (y * c - x * s) / sy, tip.z));
    }
  }
  g.userData.muzzles = tips;
  if (fallen) g.userData.fallen = fallen;
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
  if (!m.turret) { root.add(hull); bake(hull, key + '|hull', true); v.models.push(root); return; }
  v.turret = new THREE.Group(); v.turret.position.set(...m.turretAt); v.turret.add(part(m.turret, 0xffffff));
  v.fxTip = m.tip;
  root.add(hull, v.turret);
  bake(hull, key + '|hull', true); bake(v.turret, key + '|turret', true);
  v.models.push(root);
}

// Builds the model of unit v under root: v.models (soldiers, or the root for vehicles and structures), v.turret,
// v.body (structures and planes; it scales up while built), v.fxTip (barrel tip for client/fx.js).
// f is the owner's look (uniform, vehicle and player colors), fac the faction, def the unit's stats.
const UK_MODELS = new Set(['churchill', 'armoredcar', 'halftrack', 'medium', 'mg', 'at', 'mortar', 'flak', 'truck']);
const UK_TANKS = { churchill, medium: cromwell };
export function buildModel(v, root, f, fac, def) {
  const type = v.type, key = `${type}|${fac}|${f.color}`;
  if (def.air || type === 'airfield') return; // client/aircraft.js builds these
  // ponytail: a UK vehicle or gun without a model of its own yet borrows the American one in British paint (late-war
  // British vehicles wore the same Allied white star); UK_MODELS lists the ones that have their own. Soldiers always
  // wear their own faction's kit (own).
  const own = fac;
  if (fac === 3 && !UK_MODELS.has(type)) fac = 0;
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
  } else if (type === 'depot' || type === 'supplycache') {
    // supply dump: stacked crates and fuel drums
    const crate = skin('wood', 0x6e5836);
    v.body = new THREE.Group();
    v.body.add(part(GEO.box, skin('darkwood', 0x5a4a34), 3.8, 0.2, 3.8, 0, 0.1, 0), part(GEO.box, crate, 1.4, 1.2, 1.4, -0.9, 0.7, -0.9), part(GEO.box, crate, 1.4, 1.2, 1.4, 0.7, 0.7, -0.9),
      part(GEO.box, crate, 1.2, 1, 1.2, -0.1, 1.8, -0.9));
    for (let i = 0; i < 4; i++) v.body.add(part(GEO.cyl, f.vehicle, 0.4, 1.1, 0.4, -1.1 + i * 0.75, 0.65, 1));
    if (type === 'supplycache') {
      v.body.add(part(GEO.box, skin('canvas', 0x81795a), 3.7, 0.18, 3.7, 0, 2.55, 0));
      for (const x of [-1.7, 1.7]) for (const z of [-1.7, 1.7]) v.body.add(part(GEO.box, crate, 0.12, 2.5, 0.12, x, 1.25, z));
      v.body.add(part(GEO.box, f.color, 0.95, 0.65, 0.08, 0, 2.08, 1.82));
    }
    root.add(bake(v.body, key, true, 'structure')); v.models.push(root);
  } else if (type === 'shipyard') {
    // a timber slipway running down to the water, a shed over its head and a crane
    const post = skin('darkwood', 0x5a4a34);
    v.body = new THREE.Group();
    v.body.add(part(GEO.box, skin('wood', 0x7a6446), 5.8, 0.25, 3.6, 0, 0.12, 0), part(GEO.box, post, 5.8, 0.3, 0.3, 0, 0.3, -1.5), part(GEO.box, post, 5.8, 0.3, 0.3, 0, 0.3, 1.5),
      part(GEO.box, f.vehicle, 2.4, 0.2, 4, -1.8, 3.1, 0), part(GEO.box, post, 0.3, 3, 0.3, -2.8, 1.5, -1.8), part(GEO.box, post, 0.3, 3, 0.3, -2.8, 1.5, 1.8),
      part(GEO.box, post, 0.3, 3, 0.3, -0.8, 1.5, -1.8), part(GEO.box, post, 0.3, 3, 0.3, -0.8, 1.5, 1.8),
      part(GEO.box, DARK, 0.3, 5.5, 0.3, 2.2, 2.75, 2.4), part(GEO.box, DARK, 3, 0.25, 0.25, 1.1, 5.4, 2.4), part(GEO.cyl, DARK, 0.03, 2, 0.03, 0, 4.4, 2.4));
    root.add(bake(v.body, key, true, 'structure')); v.models.push(root);
  } else if (type === 'lcvp' || type === 'gunboat' || type === 'destroyer') {
    const model = bakedNavalModel(navalFinished, type, own, f), hull = new THREE.Group();
    hull.add(part(model.hull, 0xffffff));
    root.add(bake(hull, key + '|hull', true, 'naval'));
    if (model.turret) {
      const mounts = model.mounts.map((at) => {
        const mount = new THREE.Group(); mount.position.set(...at);
        mount.add(part(model.turret, 0xffffff));
        return bake(mount, key + '|mount', true, 'naval');
      });
      root.add(...mounts); v.turret = mounts[0]; v.fxTip = model.tip;
      if (type === 'destroyer') v.mounts = mounts;
    }
    v.models.push(root);
  } else if (type === 'kaiju') {
    kaiju(v, root, key);
  } else if (type === 'bunker' || type === 'worldbase') {
    const shell = new THREE.Group();
    shell.add(part(GEO.box, 0x8a8a82, 5.2, 2.4, 5.2, 0, 1.2, 0), part(GEO.box, 0x74746c, 6, 0.5, 6, 0, 2.6, 0), part(GEO.box, 0x1e1e1a, 0.3, 0.4, 3, 2.62, 1.6, 0));
    for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; if (i % 4 === 0) continue; shell.add(part(GEO.box, skin('sandbag', 0x9c8a60), 1.6, 0.7, 0.8, Math.cos(a) * 4.6, 0.35, Math.sin(a) * 4.6).rotateY(-a + Math.PI / 2)); }
    shell.add(part(GEO.cyl, 0x4a3f30, 0.08, 4, 0.08, -1.8, 4.6, -1.8), part(GEO.plane, cloth(f.color), 1.8, 1.1, 1, -0.9, 6, -1.8));
    root.add(bake(shell, key, true, 'structure'));
    v.models.push(root);
  } else if (isArmorMedium(type, fac) && !((fac === 3 || type === 'churchill') && UK_TANKS[type])) {
    // M4 Sherman, Panzer IV, T-34, T34 Calliope and Wirbelwind: client/models/armor-medium.js
    const hull = buildArmorMedium(v, root, type, fac, f);
    bake(hull, key + '|hull', true); bake(v.turret, key + '|turret', true);
    v.models.push(root);
  } else if (((fac === 3 || type === 'churchill') && UK_TANKS[type]?.(f)) || lightHeavy(type, fac, f)) {
    // the light tanks, the Tiger and the ZSU-37: client/models/armor-lightheavy.js; the Churchill and the Cromwell:
    // client/models/churchill.js and cromwell.js. Two painted geometries each (cached)
    const lh = ((fac === 3 || type === 'churchill') && UK_TANKS[type]?.(f)) || lightHeavy(type, fac, f), hull = new THREE.Group();
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
      loadInfantryTextures();
      const s = soldier(figure, own, i, f), poses = (g) => g.children[0].userData.geo.userData;
      // the near figure has no owner color (client/models/infantry.js), so all players share its bake; keyed by own
      // faction, since fac may have been swapped for a UK vehicle stand-in
      const hi = bakeMeshes(s.near, `${type}|${own}|man|${s.kit}`, false, poses(s.near), 'soldier'), lo = bakeMeshes(s.far, `${key}|far|${s.kit}`, false, poses(s.far), 'soldier');
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
export function animate(v, dt, eye, groundAt, detailed = true) {
  if (v.legs) { stride(v, dt); return; }
  const sq = v.squad;
  if (!sq) { moveModel(v, dt); moveWheels(v, dt); return; }
  const px = v.root.position.x, pz = v.root.position.z;
  const distance = sq.poseX === undefined ? 0 : Math.hypot(px - sq.poseX, pz - sq.poseZ);
  const travel = distance > 8 ? 0 : distance;
  sq.poseX = px; sq.poseZ = pz;
  sq.poseTravel = (sq.poseTravel ?? 0) + travel;
  sq.poseSpeed = dt > 0 ? travel / dt : 0;
  if (!detailed || !v.root.visible) { sq.suspended = true; return; }
  const returned = !!sq.suspended;
  sq.suspended = false;
  const lim = gfx.low ? LOD.low : LOD.high, dx = eye.x - v.x, dy = eye.y - v.root.position.y, dz = eye.z - v.z, d2 = dx * dx + dy * dy + dz * dz;
  const far = sq.far ? d2 > (lim - 4) ** 2 : d2 > (lim + 4) ** 2;
  if (far !== sq.far) {
    sq.far = far;
    for (const man of v.models) { for (const m of man.userData.hi) m.visible = !far; for (const m of man.userData.lo) m.visible = far; }
    if (sq.guns) { sq.guns.hi.visible = !far; sq.guns.lo.visible = far; }
  }
  const goal = postureOf(v.supp ?? 0, v.flags ?? 0, v.cover), w = sq.w, step = dt / POSTURE.blend;
  // digging (flag 16) or building (128) where it stands, not pinned down: the men play the spade stroke built into
  // their figure (client/models/infantry.js DIG), each on his own beat, at about one stroke every 1.6 seconds
  const working = (v.flags & 144) && goal < 2 && sq.poseSpeed < 0.3;
  sq.work = Math.max(0, Math.min(1, (sq.work ?? 0) + (working ? step : -step)));
  if (sq.work) sq.workT = (sq.workT ?? 0) + dt * 0.62;
  if (returned) for (let i = 0; i < 4; i++) w[i] = i === goal ? 1 : 0;
  for (let i = 0; i < 4; i++) {
    const d = (i === goal ? 1 : 0) - w[i];
    if (d) { w[i] += Math.max(-step, Math.min(step, d)); }
  }
  const aimGoal = sq.moveFire && v.tgt && !(v.flags & 1) ? 1 : 0;
  const aimBlend = sq.aimBlend ?? 0;
  sq.aimBlend = aimBlend + Math.max(-step, Math.min(step, aimGoal - aimBlend));
  if (returned) {
    sq.aimBlend = aimGoal;
    sq.lastX = undefined;
    moveSquad(v, 0);
    const stride = v.flags & 1 ? 1.24 : goal === 2 ? 0.48 : goal === 1 ? 0.76 : 1.24;
    for (const man of v.models) {
      const m = man.userData.motion;
      m.speed = sq.poseSpeed;
      m.blend = v.trench || !man.visible ? 0 : Math.min(1, m.speed / 0.7);
      m.phase = (m.seed + sq.poseTravel / (stride * man.scale.x)) % 1;
    }
  } else moveSquad(v, dt);
  const sum = w.reduce((a, b) => a + b, 0);
  const sink = v.cover === 2 && !v.trench ? -0.6 : 0; // men seated in a trench stand on its carved floor instead
  for (const man of v.models) {
    const u = man.userData, s = man.scale.x, motion = u.motion;
    const blend = motion.blend;
    const aim = sq.aimBlend * blend * w[0] / sum;
    const upright = blend * (w[0] + w[3]) / sum - aim, crouch = blend * w[1] / sum, crawl = blend * w[2] / sum;
    // the dig frames (24-27) exist only on the figures of squads that dig
    const frames = u.hi[0].morphTargetInfluences.length - 3, dig = frames > 20 ? sq.work * (1 - blend) : 0;
    const gait = u.gait ??= new Float64Array(frames), pw = u.postureWeights ??= new Float64Array(4), mp = u.poseValues ??= new Float64Array(6);
    gait.fill(0); mp.fill(0);
    gaitWeights(motion.phase, upright, 8, gait, 0); gaitWeights(motion.phase, aim, 4, gait, 8);
    gaitWeights(motion.phase, crouch, 4, gait, 12); gaitWeights(motion.phase, crawl, 4, gait, 16);
    if (dig) gaitWeights((sq.workT ?? 0) + motion.seed, dig, 4, gait, 20);
    for (let i = 0; i < 4; i++) pw[i] = w[i] / sum * (1 - blend) * (1 - dig);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 6; j++) mp[j] += pw[i] * POSES[i][j];
    for (let j = 0; j < 6; j++) mp[j] += upright * POSES[3][j] + (aim + dig) * POSES[0][j] + crouch * POSES[1][j] + crawl * POSES[2][j];
    const ox = mp[4] - HAND[0], oy = mp[5] - HAND[1];
    const tips = u.hi[0].geometry.userData.muzzles;
    if (tips) {
      const tip = u.muzzle ??= new THREE.Vector3();
      tip.copy(tips[0]).multiplyScalar(pw[0]);
      for (let j = 0; j < tips.length - 1; j++) tip.addScaledVector(tips[j + 1], j < 3 ? pw[j + 1] : gait[j - 3]);
      const c = Math.cos(mp[0]), sn = Math.sin(mp[0]), x = tip.x, y = tip.y * mp[1];
      tip.set(x * c - y * sn + mp[2] - ox, x * sn + y * c + mp[3] - oy, tip.z);
    }
    const floor = groundAt ? groundAt(motion.x, motion.z) - v.root.position.y : 0;
    man.position.set(motion.localX + ox * s, floor + sink + oy * s, motion.localZ);
    man.rotation.y = motion.localYaw;
    u.pose.rotation.z = mp[0]; u.pose.scale.y = mp[1]; u.pose.position.set(mp[2] - ox, mp[3] - oy, 0);
    for (const m of sq.far ? u.lo : u.hi) { // the hidden level of detail keeps its last weights
      for (let j = 0; j < 3; j++) m.morphTargetInfluences[j] = pw[j + 1];
      for (let j = 0; j < gait.length; j++) m.morphTargetInfluences[j + 3] = gait[j];
    }
  }
}

// Soldiers drawn instanced: every man keeps his own mesh (animate() poses it; the level of detail, picking, selection
// and the corpses read it), but drawSoldiers() hides those meshes from the camera and draws every visible man of one
// baked figure (type, faction, color, kit, near or far) in one InstancedMesh under crowd, posture weights included.
// Squads off screen are left out. Without drawSoldiers (the viewer, portraits, the tests) each man draws himself.
// A man whose material was swapped (main.js clones it for see-through camouflage) still draws himself.
export const crowd = new THREE.Group();
const pools = new Map(), HIDDEN = 1 << 31, frustum = new THREE.Frustum(), clip = new THREE.Matrix4(), ball = new THREE.Sphere();
function grow(p) {
  const cap = Math.max(64, p.cap * 2), mesh = new THREE.InstancedMesh(p.geometry, p.material, cap), n = p.geometry.morphAttributes.position.length + 1;
  mesh.morphTexture = new THREE.DataTexture(new Float32Array(n * cap), n, cap, THREE.RedFormat, THREE.FloatType);
  mesh.frustumCulled = false; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  if (p.mesh) { mesh.instanceMatrix.array.set(p.mesh.instanceMatrix.array); mesh.morphTexture.image.data.set(p.mesh.morphTexture.image.data); p.mesh.removeFromParent(); p.mesh.dispose(); }
  crowd.add(mesh); p.mesh = mesh; p.cap = cap;
}
// Prepare once after the camera moves, before any detailed squad work. The same 25 m margin covers draw packing.
export function animationInterest(camera) {
  camera.updateMatrixWorld();
  frustum.setFromProjectionMatrix(clip.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  return (v, selected = false) => v.root.visible && (selected || frustum.intersectsSphere(ball.set(v.root.position, 25)));
}
// The men also leave the scene's own matrix pass, which walked some 40 objects a squad every frame on or off screen:
// drawSoldiers updates the men it draws, and a squad off screen has its meshes hidden so none is drawn where it once
// stood. Code that reads a man's position updates it first (updateWorldMatrix, getWorldPosition).
const updateMan = THREE.Object3D.prototype.updateMatrixWorld, skipMan = () => {};
function hideMen(v) {
  for (const man of v.models) { man.updateMatrixWorld = skipMan; for (const m of man.userData.meshes) m.layers.mask = HIDDEN; }
}
// once per frame, after animate(), before rendering; units: the units to draw, camera: the view
export function drawSoldiers(units, camera) {
  camera.updateMatrixWorld();
  frustum.setFromProjectionMatrix(clip.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  for (const p of pools.values()) p.n = 0;
  for (const v of units) {
    if (!v.squad) continue;
    // ponytail: a 25 m ball around the squad covers its spread-out men; widen it if men pop at the screen edge
    if (!v.root.visible || !frustum.intersectsSphere(ball.set(v.root.position, 25))) {
      if (v.squad.shown !== false) { hideMen(v); v.squad.shown = false; }
      continue;
    }
    if (v.squad.shown === undefined) hideMen(v);
    v.squad.shown = true;
    v.root.updateMatrixWorld();
    for (const man of v.models) {
      if (!man.visible) continue;
      updateMan.call(man, true);
      for (const m of man.userData.meshes) {
        if (!m.visible) continue;
        if (m.material !== m.userData.baked) { m.layers.mask = 1; continue; }
        let p = pools.get(m.geometry);
        if (!p) pools.set(m.geometry, p = { geometry: m.geometry, material: m.material, cap: 0, n: 0, mesh: null });
        if (p.n === p.cap) grow(p);
        m.layers.mask = HIDDEN;
        p.mesh.setMatrixAt(p.n, m.matrixWorld); p.mesh.setMorphAt(p.n++, m);
      }
    }
  }
  for (const p of pools.values()) { p.mesh.count = p.n; p.mesh.instanceMatrix.needsUpdate = true; p.mesh.morphTexture.needsUpdate = true; }
}

// Corpses: the soldier's own fallen build, instanced, up to CAP bodies in all. One mesh per uniform, so a battle
// still draws a handful of corpse batches instead of one mesh per man. With a camera, distant bodies use the
// simplified fallen build and off-screen bodies are omitted. Past SOFT bodies the oldest starts to fade
// and sink; a body also fades once it is LIFE seconds old; faded bodies leave the pool. The aiming prone stays on
// the living morphs; a body is the slack pose, not a man still sighting from the dirt.
export const CORPSES = { cap: 200, soft: 184, life: 25, fade: 1.5, sink: 0.45 };
// The fallen build, scaled like the living man and resting on y = 0. Colors and materials stay with the vertices.
function fallenGeometry(src, scale) {
  const pose = src?.userData.fallen;
  if (!pose) throw new Error('a corpse needs the soldier\'s fallen build');
  const n = pose.position.count, pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  const P = pose.position, N = pose.normal;
  let minY = Infinity;
  for (let i = 0; i < n; i++) {
    const y = P.getY(i) * scale;
    if (y < minY) minY = y;
  }
  for (let i = 0; i < n; i++) {
    pos[i * 3] = P.getX(i) * scale; pos[i * 3 + 1] = P.getY(i) * scale - minY; pos[i * 3 + 2] = P.getZ(i) * scale;
    nor[i * 3] = N.getX(i); nor[i * 3 + 1] = N.getY(i); nor[i * 3 + 2] = N.getZ(i);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  if (src.attributes.color) geo.setAttribute('color', src.attributes.color.clone());
  if (src.attributes.matId) geo.setAttribute('matId', src.attributes.matId.clone());
  if (src.attributes.modelUV) geo.setAttribute('modelUV', src.attributes.modelUV.clone());
  if (src.index) geo.setIndex(src.index.clone());
  geo.computeBoundingSphere();
  return geo;
}
function corpseMaterial() {
  // same textured paint as a living soldier, plus a per-body fade. Registered with the texture loader so a corpse
  // picks up wool and steel when the textures arrive, not only the paint it had at startup.
  const material = infantryMaterial(modelMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, transparent: true, depthWrite: true }), { mat: 'wool', grime: true }));
  const prev = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey?.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    prev.call(material, shader, renderer);
    shader.vertexShader = 'attribute float fade;\nvarying float vFade;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvFade = fade;');
    shader.fragmentShader = 'varying float vFade;\n' + shader.fragmentShader.replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( diffuse, opacity * vFade );');
  };
  material.customProgramCacheKey = () => `corpse-fade|${prevKey ? prevKey() : 'paint'}`;
  return material;
}
// All body managers reuse one textured fade material. Geometry and instance buffers belong to the manager.
let sharedCorpseMaterial = null;
export function createBodies() {
  const { cap, soft, life, fade: FADE, sink } = CORPSES;
  const material = sharedCorpseMaterial ??= corpseMaterial();
  const looks = new Map(), bodies = [];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), at = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  const clip = new THREE.Matrix4(), frustum = new THREE.Frustum(), ball = new THREE.Sphere(), eye = new THREE.Vector3();
  let worldRef = null, fallback = null, view = null;
  function lookFor(man) {
    const hi = man.userData.hi?.[0]?.geometry ?? man.userData.lo?.[0]?.geometry;
    const lo = man.userData.lo?.[0]?.geometry ?? hi, scale = man.scale?.x || 1, key = `${hi.uuid}|${scale}`;
    let look = looks.get(key);
    if (!look) {
      look = { key, refs: 0, hi, lo, scale, pools: new Map() };
      looks.set(key, look);
    }
    return look;
  }
  function poolFor(look, far) {
    const src = far ? look.lo : look.hi;
    let pool = look.pools.get(src);
    if (!pool) {
      const geometry = fallenGeometry(src, look.scale);
      pool = { geometry, mesh: null, fade: null, cap: 0, n: 0, list: [] };
      look.pools.set(src, pool);
    }
    return pool;
  }
  function grow(pool) {
    const capacity = Math.min(cap, Math.max(16, pool.cap * 2));
    const fade = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    if (pool.fade) fade.array.set(pool.fade.array);
    // Free the old uploaded fade attribute before replacing it. CPU geometry stays reusable after disposal.
    if (pool.mesh) pool.geometry.dispose();
    pool.geometry.setAttribute('fade', fade);
    const mesh = new THREE.InstancedMesh(pool.geometry, material, capacity);
    mesh.count = 0; mesh.castShadow = false; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    fade.setUsage(THREE.DynamicDrawUsage);
    if (pool.mesh) {
      mesh.instanceMatrix.array.set(pool.mesh.instanceMatrix.array);
      mesh.boundingSphere = pool.mesh.boundingSphere?.clone() ?? null;
      pool.mesh.removeFromParent(); pool.mesh.dispose();
    }
    worldRef.add(mesh); pool.mesh = mesh; pool.fade = fade; pool.cap = capacity;
  }
  function release(look) {
    for (const pool of look.pools.values()) {
      pool.mesh?.removeFromParent(); pool.mesh?.dispose(); pool.geometry.dispose();
    }
    look.pools.clear(); looks.delete(look.key);
  }
  function place(b) {
    e.set(b.fly?.rx ?? 0, b.yaw, b.fly?.rz ?? 0, 'YXZ'); q.setFromEuler(e);
    const yOff = b.fly || b.out === undefined ? 0 : -(1 - b.out / FADE) * sink;
    at.set(b.x, b.y + yOff, b.z); m4.compose(at, q, one);
  }
  function append(pool, b) {
    if (pool.n === pool.cap) grow(pool);
    b.pool = pool; b.slot = pool.n;
    pool.mesh.setMatrixAt(pool.n, m4);
    pool.fade.array[pool.n] = b.out === undefined ? 1 : b.out / FADE;
    pool.list[pool.n++] = b;
    pool.mesh.count = pool.n;
    // Incremental bounds enclose the placed spheres without rescanning the whole pool for each new death.
    ball.copy(pool.geometry.boundingSphere).applyMatrix4(m4);
    pool.mesh.boundingSphere ??= new THREE.Sphere();
    if (pool.n === 1) pool.mesh.boundingSphere.copy(ball);
    else pool.mesh.boundingSphere.union(ball);
  }
  function changed(pool) { pool.mesh.instanceMatrix.needsUpdate = true; pool.fade.needsUpdate = true; }
  function draw() {
    if (!worldRef) return;
    if (view) {
      view.updateWorldMatrix(true, false); worldRef.updateWorldMatrix(true, false);
      view.getWorldPosition(eye);
      frustum.setFromProjectionMatrix(clip.multiplyMatrices(view.projectionMatrix, view.matrixWorldInverse));
    }
    for (const look of looks.values()) for (const pool of look.pools.values()) { pool.n = 0; pool.list.length = 0; }
    const lim = gfx.low ? LOD.low : LOD.high;
    for (const b of bodies) {
      b.pool = null;
      place(b);
      if (view) {
        at.setFromMatrixPosition(m4).applyMatrix4(worldRef.matrixWorld);
        const distance2 = at.distanceToSquared(eye);
        b.far = b.far ? distance2 > (lim - 4) ** 2 : distance2 > (lim + 4) ** 2;
      } else b.far = false;
      const pool = poolFor(b.look, b.far);
      // Use the fallen pose's sphere and the full instance/world transform, including blast tumbles and sinking.
      if (view && !frustum.intersectsSphere(ball.copy(pool.geometry.boundingSphere).applyMatrix4(m4).applyMatrix4(worldRef.matrixWorld))) continue;
      append(pool, b);
    }
    for (const look of looks.values()) for (const pool of look.pools.values()) {
      if (!pool.mesh) continue;
      pool.mesh.count = pool.n;
      if (pool.n) changed(pool);
    }
  }
  function drop(i) {
    const b = bodies[i], pool = b.pool;
    if (pool) {
      const last = --pool.n;
      if (b.slot !== last) {
        const moved = pool.list[last];
        pool.mesh.getMatrixAt(last, m4); pool.mesh.setMatrixAt(b.slot, m4);
        pool.fade.array[b.slot] = pool.fade.array[last];
        pool.list[b.slot] = moved; moved.slot = b.slot;
      }
      pool.list.pop(); pool.mesh.count = pool.n; changed(pool);
    }
    if (--b.look.refs === 0) release(b.look);
    const end = bodies.length - 1;
    if (i !== end) bodies[i] = bodies[end];
    bodies.pop();
  }
  function clear() {
    bodies.length = 0;
    for (const look of [...looks.values()]) release(look);
  }
  function soldierOf(man) {
    if (man) return man;
    if (!fallback) {
      const root = new THREE.Group(), v = { type: 'rifle', root, models: [], turret: null };
      buildModel(v, root, { uniform: 0x6b7248, vehicle: 0x59623d, color: 0x3b73d6 }, 0, { w: null });
      fallback = v.models[0];
    }
    return fallback;
  }
  return {
    get count() { return bodies.length; },
    // a soldier lying where he fell. man is that man (his prone build and scale); yaw is the direction he faces.
    // without a man, a rifleman stands in, so a caller that only has a place still gets a soldier rather than a capsule.
    add(world, x, y, z, man = null, yaw = null) {
      if (worldRef !== world) { clear(); worldRef = world; view = null; }
      let live = 0, oldest = -1, most = -1;
      bodies.forEach((b, i) => {
        if (b.out === undefined) { live++; if (oldest < 0 || b.age > bodies[oldest].age) oldest = i; }
        else if (most < 0 || b.out < bodies[most].out) most = i;
      });
      if (live >= soft && oldest >= 0) bodies[oldest].out = FADE;
      if (bodies.length >= cap) drop(most >= 0 ? most : oldest);
      const look = lookFor(soldierOf(man));
      const b = { age: 0, x, y, z, yaw: yaw ?? Math.random() * Math.PI * 2, look, far: false };
      look.refs++; bodies.push(b);
      // The game already has a camera after its first frame. Pack all deaths once in update(), not once per death.
      // Viewers without a camera keep immediate placement through a touched-pool append.
      if (!view) { const pool = poolFor(look, false); place(b); append(pool, b); changed(pool); }
    },
    // fx (client/fx.js effects, optional): a man who died beside a blast in the last moment is thrown away from it,
    // tumbling, and lands where he comes down (ground(x, z) is the height there). fx.gore adds the blood.
    // camera is optional for viewers/tests. The game supplies it after camera movement each frame.
    update(dt, fx = null, ground = null, camera = null) {
      view = camera;
      if (worldRef && !worldRef.parent) { clear(); worldRef = null; } // the match ended: its world left the scene
      for (let i = bodies.length - 1; i >= 0; i--) {
        const b = bodies[i];
        b.age += dt;
        if (fx && ground && !b.tossed && b.age < 0.6) {
          const hit = fx.blastNear(b.x, b.z);
          if (hit) {
            const dx = b.x - hit.x, dz = b.z - hit.z, d = Math.hypot(dx, dz) || 0.01, k = Math.max(0.15, 1 - d / (hit.s + 0.5));
            const p = Math.sqrt(hit.s / 3), h = (2 + 6 * k) * p * (0.8 + 0.4 * Math.random()), sp = () => (Math.random() - 0.5) * 16 * k;
            b.tossed = true;
            b.fly = { vx: dx / d * h, vy: (3 + 7 * k) * p, vz: dz / d * h, rx: 0, rz: 0, wx: sp(), wz: sp() };
            fx.gore(b.x, b.z, k);
          }
        }
        if (b.fly) {
          const f = b.fly;
          f.vy -= 18 * dt;
          b.x += f.vx * dt; b.y += f.vy * dt; b.z += f.vz * dt; f.rx += f.wx * dt; f.rz += f.wz * dt;
          const g = ground(b.x, b.z);
          if (f.vy < 0 && b.y <= g) { b.y = g; b.fly = null; } // ponytail: snaps flat on landing; a settle roll if it looks off
          continue;
        }
        if (b.out === undefined && b.age >= life) b.out = FADE;
        if (b.out === undefined) continue;
        b.out -= dt;
        if (b.out <= 0) drop(i);
      }
      draw();
    },
    // Release this manager's geometry and instance buffers when its owner is discarded. It can be reused.
    dispose() { clear(); worldRef = null; view = null; fallback = null; },
  };
}

// Clip surfaces inside failed recipient-known section columns. Shared baked meshes stay intact in their cache.
function clipPolygon(poly, axis, boundary, greater) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const da = greater ? a[axis] - boundary : boundary - a[axis];
    const db = greater ? b[axis] - boundary : boundary - b[axis];
    if (da >= 0) out.push(a);
    if ((da >= 0) !== (db >= 0)) {
      const t = da / (da - db);
      out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t,
        values: a.values.map((value, k) => value + (b.values[k] - value) * t) });
    }
  }
  return out;
}
function subtractColumn(poly, hole) {
  if (poly.every(p => p.x <= hole.x0) || poly.every(p => p.x >= hole.x1)
    || poly.every(p => p.z <= hole.z0) || poly.every(p => p.z >= hole.z1)) return [poly];
  const outside = [];
  let remaining = poly;
  for (const [axis, boundary, greater] of [['x', hole.x0, true], ['x', hole.x1, false], ['z', hole.z0, true], ['z', hole.z1, false]]) {
    const piece = clipPolygon(remaining, axis, boundary, !greater);
    if (piece.length >= 3) outside.push(piece);
    remaining = clipPolygon(remaining, axis, boundary, greater);
    if (remaining.length < 3) break;
  }
  return outside;
}
function breachGeometry(source, columns, worldMatrix) {
  const layout = Object.entries(source.attributes).map(([name, attr]) => ({ name, attr, size: attr.itemSize, values: [] }));
  const position = source.attributes.position, index = source.index, count = index?.count ?? position.count;
  const at = new THREE.Vector3();
  for (let i = 0; i < count; i += 3) {
    let pieces = [Array.from({ length: 3 }, (_, corner) => {
      const vertex = index ? index.getX(i + corner) : i + corner, values = [];
      for (const { attr, size } of layout) for (let k = 0; k < size; k++) values.push(attr.getComponent(vertex, k));
      at.fromBufferAttribute(position, vertex).applyMatrix4(worldMatrix);
      return { x: at.x, z: at.z, values };
    })];
    for (const column of columns) pieces = pieces.flatMap(poly => subtractColumn(poly, column));
    for (const poly of pieces) for (let k = 1; k < poly.length - 1; k++) {
      // Plane clipping may leave coincident edge vertices. Those do not need a degenerate triangle.
      const triangle = [poly[0], poly[k], poly[k + 1]], a = triangle[0].values, b = triangle[1].values, c = triangle[2].values;
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      if (Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) < 1e-9) continue;
      for (const vertex of triangle) {
        let offset = 0;
        for (const entry of layout) {
          for (let n = 0; n < entry.size; n++) entry.values.push(vertex.values[offset++]);
        }
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  for (const { name, size, values } of layout) geometry.setAttribute(name, new THREE.Float32BufferAttribute(values, size));
  if (geometry.attributes.position.count) { geometry.computeBoundingBox(); geometry.computeBoundingSphere(); }
  else { geometry.boundingBox = new THREE.Box3(new THREE.Vector3(), new THREE.Vector3()); geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 0); }
  geometry.userData.breach = true;
  return geometry;
}

// Apply to a live building or its last-seen Ghost after delivered section changes. No impact is replayed here.
export function updateBuildingBreach(v, sections, width, cell) {
  if (!sections || !width || !cell) return false;
  const id = `building:${v.id}`, failed = [];
  for (const [c, section] of sections) if (section.structureId === id && section.state === 'failed') failed.push(c);
  failed.sort((a, b) => a - b);
  failed.length = Math.min(failed.length, 9);
  const key = failed.join(',');
  if (v.breach?.key === key) return false;
  if (!failed.length && !v.breach) return false;
  const state = v.breach ??= { key: '', meshes: [] };
  if (!state.meshes.length) {
    for (const child of v.root.children) if (child !== v.base && child !== v.sel) child.traverse(mesh => {
      if (mesh.isMesh && !mesh.isInstancedMesh) state.meshes.push({ mesh, base: mesh.geometry });
    });
  }
  const columns = failed.map(c => ({ x0: c % width * cell, x1: (c % width + 1) * cell, z0: Math.floor(c / width) * cell, z1: (Math.floor(c / width) + 1) * cell }));
  const worldMatrix = new THREE.Matrix4().makeRotationY(-(v.trot ?? v.rot ?? 0));
  worldMatrix.setPosition(v.tx ?? v.x ?? v.root.position.x, 0, v.tz ?? v.z ?? v.root.position.z);
  for (const entry of state.meshes) {
    if (entry.mesh.geometry !== entry.base) entry.mesh.geometry.dispose();
    entry.mesh.geometry = failed.length ? breachGeometry(entry.base, columns, worldMatrix.clone().multiply(relative(entry.mesh, v.root))) : entry.base;
  }
  state.key = key;
  return true;
}

export function releaseBuildingBreach(v) {
  for (const { mesh, base } of v.breach?.meshes ?? []) {
    if (mesh.geometry !== base) mesh.geometry.dispose();
    mesh.geometry = base;
  }
  v.breach = null;
}


// Hull parts and the independently traversing turret tilt together. Owner and selection rings remain level.
export function vehicleBody(v) {
  if (v.visualChassis) return v.visualChassis;
  const body = new THREE.Group();
  body.name = 'vehicle-chassis';
  for (const child of [...v.root.children]) if (child !== v.base && child !== v.sel) body.add(child);
  v.root.add(body);
  v.visualChassis = body;
  // Measure the native track or tire footprint once, excluding barrels and raised equipment.
  const vertices = [], point = new THREE.Vector3();
  let bottom = Infinity;
  const visit = node => {
    if (node === v.turret || v.mounts?.includes(node)) return;
    if (node.isMesh && node.geometry?.attributes.position) {
      const positions = node.geometry.attributes.position, tracks = node.geometry.attributes.trackData, transform = relative(node, body);
      for (let i = 0; i < positions.count; i++) {
        if (tracks && tracks.getY(i) >= 0) continue;
        point.fromBufferAttribute(positions, i).applyMatrix4(transform);
        bottom = Math.min(bottom, point.y);
        vertices.push(point.x, point.y, point.z);
      }
      const support = node.geometry.userData.trackSupport ?? [];
      for (let i = 0; i < support.length; i += 3) {
        point.fromArray(support, i).applyMatrix4(transform);
        bottom = Math.min(bottom, point.y); vertices.push(point.x, point.y, point.z);
      }
    }
    for (const child of node.children) visit(child);
  };
  for (const child of body.children) visit(child);
  if (Number.isFinite(bottom)) {
    const bounds = new THREE.Box3();
    for (let i = 0; i < vertices.length; i += 3) if (vertices[i + 1] <= bottom + 0.15) {
      bounds.expandByPoint(point.set(vertices[i], bottom, vertices[i + 2]));
    }
    if (bounds.max.x - bounds.min.x > 0.1 && bounds.max.z - bounds.min.z > 0.1) {
      v.groundContact = { minX: bounds.min.x, maxX: bounds.max.x, minZ: bounds.min.z, maxZ: bounds.max.z, y: bottom, band: 0.15 };
    }
  }
  return body;
}

// Cache a rear engine-deck point above the native hull, excluding the independently traversing gun and UI.
export function vehicleDamageAnchor(v, target) {
  const body = vehicleBody(v);
  if (!v.damageAnchorLocal) {
    const bounds = new THREE.Box3(), partBounds = new THREE.Box3();
    const visit = node => {
      if (node === v.turret || node === v.base || node === v.sel || v.mounts?.includes(node)) return;
      if (node.isMesh && node.geometry) {
        node.geometry.computeBoundingBox();
        partBounds.copy(node.geometry.boundingBox).applyMatrix4(relative(node, body));
        bounds.union(partBounds);
      }
      for (const child of node.children) visit(child);
    };
    for (const child of body.children) visit(child);
    const extent = bounds.isEmpty() ? null : bounds.getSize(new THREE.Vector3());
    v.damageAnchorLocal = extent
      ? new THREE.Vector3(bounds.min.x + extent.x * 0.15, bounds.max.y + 0.18, (bounds.min.z + bounds.max.z) / 2)
      : new THREE.Vector3(-1, 1.8, 0);
  }
  target.copy(v.damageAnchorLocal);
  return body.localToWorld(target);
}
