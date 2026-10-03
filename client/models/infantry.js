// Infantry figures: every soldier of every squad (riflemen, rangers, conscripts, engineers, snipers, flamethrowers and
// the crews of the MG, mortar, AT gun, howitzer and flak), near and far, ready for client/unit-models.js to bake. The guns themselves are
// built in client/models/guns.js.
//
// A figure is a real-proportioned man (about 7.5 heads tall, true-size hands, head and weapon) in his faction's
// uniform, kit and helmet. A small rig places the hips, knees, ankles, shoulders and hands for each job, the spine
// bends and turns between the hips and the chest, and the arms reach the weapon by two-bone IK. Each soldier is built
// four times, once per posture (standing, kneeling, lying down and running back), with the same parts in the same
// order: the standing build is the geometry, and the other three ride along in geo.userData.poses for unit-models.js
// to turn into morph targets. A fifth build, the fallen pose, is stored apart from those morphs and is used only
// for corpses. Everything merges into one vertex-colored geometry with every part tagged with what
// it is made of (wool, leather, canvas, wood, gunmetal, helmet paint, plain skin), so each soldier is one draw.
// The owner's color is a narrow band on the left upper arm. The far model comes from the same rig with far fewer faces.
//
// Axes: +x forward, +y up (feet on y = 0), +z the soldier's right. Units are the soldier's own (unit-models.js scales
// a man by 1.35, conscripts by 1.25). An aimed weapon's muzzle sits where client/fx.js HAND (BAZ for the bazooka)
// puts the muzzle flash, moved by AIM_SHIFT in the other postures.
import * as THREE from 'three';
import { merge, extrudeProfile, ao } from './geom.js';

const TAU = Math.PI * 2;
const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const V = (p) => (p.isVector3 ? p.clone() : v3(p[0], p[1], p[2]));
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smooth = (t) => { const k = clamp(t, 0, 1); return k * k * (3 - 2 * k); };
// a steady pseudo-random number in [0, 1) for a point: the same on every build
const hash = (x, y, z) => { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); };
const T = (x, y, z) => (x.isVector3 ? new THREE.Matrix4().makeTranslation(x.x, x.y, x.z) : new THREE.Matrix4().makeTranslation(x, y, z));
const RX = (a) => new THREE.Matrix4().makeRotationX(a), RY = (a) => new THREE.Matrix4().makeRotationY(a), RZ = (a) => new THREE.Matrix4().makeRotationZ(a);
const SC = (x, y = x, z = x) => new THREE.Matrix4().makeScale(x, y, z);
const chain = (...ms) => ms.reduce((a, b) => a.multiply(b), new THREE.Matrix4());
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const shade = (hex, k) => new THREE.Color(hex).multiplyScalar(k);
const WHITE = new THREE.Color(1, 1, 1);
// a frame at `at` with +x along x and +y as close to `up` as it can be
function basis(at, x, up) {
  const X = x.clone().normalize(), Z = new THREE.Vector3().crossVectors(X, up);
  if (Z.lengthSq() < 1e-8) Z.crossVectors(X, Math.abs(X.y) < 0.9 ? v3(0, 1, 0) : v3(1, 0, 0));
  Z.normalize();
  return new THREE.Matrix4().makeBasis(X, new THREE.Vector3().crossVectors(Z, X), Z).setPosition(at);
}

// ---------------------------------------------------------------- surfaces

// A surface through rows of points (every row the same length): quads between neighbors, closed around unless
// open, with optional pole caps {p, c} past the last row (top) and before the first (bottom). color(i, j) gives a
// vertex color. Faces point outward when the rows advance along u and each row turns from e1 toward u x e1.
function gridGeo(rows, { open = false, top, bottom, color } = {}) {
  const n = rows[0].length, m = rows.length, pos = [], col = [], idx = [];
  const add = (p, c) => { pos.push(p.x, p.y, p.z); col.push(c.r, c.g, c.b); return pos.length / 3 - 1; };
  rows.forEach((r, i) => r.forEach((p, j) => add(p, color ? color(i, j) : WHITE)));
  const at = (i, j) => i * n + (j % n), cols = open ? n - 1 : n;
  for (let i = 0; i < m - 1; i++) for (let j = 0; j < cols; j++) idx.push(at(i, j), at(i, j + 1), at(i + 1, j + 1), at(i, j), at(i + 1, j + 1), at(i + 1, j));
  if (top) { const P = add(top.p, top.c ?? WHITE); for (let j = 0; j < cols; j++) idx.push(at(m - 1, j), at(m - 1, j + 1), P); }
  if (bottom) { const P = add(bottom.p, bottom.c ?? WHITE); for (let j = 0; j < cols; j++) idx.push(at(0, j + 1), at(0, j), P); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
// rings of k points around a path of centers (radius r, or [r1, r2] for an oval), turned so the first point of each
// ring leans toward hint and carried along the path without twisting
function tubeRows(centers, radii, k, hint, phase = 0) {
  const rows = [], e1 = hint.clone(), t = v3(), e2 = v3();
  centers.forEach((c, i) => {
    t.subVectors(centers[Math.min(centers.length - 1, i + 1)], centers[Math.max(0, i - 1)]).normalize();
    e1.addScaledVector(t, -e1.dot(t));
    if (e1.lengthSq() < 1e-8) e1.crossVectors(t, Math.abs(t.x) < 0.9 ? v3(1, 0, 0) : v3(0, 1, 0));
    e1.normalize(); e2.crossVectors(t, e1);
    const r = radii[i], ra = Array.isArray(r) ? r[0] : r, rb = Array.isArray(r) ? r[1] : r;
    rows.push(Array.from({ length: k }, (_, j) => { const q = ((j + phase) / k) * TAU; return c.clone().addScaledVector(e1, Math.cos(q) * ra).addScaledVector(e2, Math.sin(q) * rb); }));
  });
  return rows;
}
const tube = (centers, radii, k, hint, opts = {}) => gridGeo(tubeRows(centers, radii, k, hint, opts.phase), opts);
// a copy with its faces split apart and each face colored from list by where it is: camouflage patches
function camoFaces(geo, list, scale) {
  const g = geo.toNonIndexed(), P = g.attributes.position, C = g.attributes.color, c = new THREE.Color();
  for (let i = 0; i < P.count; i += 3) {
    const x = (P.getX(i) + P.getX(i + 1) + P.getX(i + 2)) / 3, y = (P.getY(i) + P.getY(i + 1) + P.getY(i + 2)) / 3, z = (P.getZ(i) + P.getZ(i + 1) + P.getZ(i + 2)) / 3;
    c.set(list[Math.floor(hash(Math.round(x * scale), Math.round(y * scale), Math.round(z * scale)) * list.length)]);
    for (let k = 0; k < 3; k++) C.setXYZ(i + k, C.getX(i + k) * c.r, C.getY(i + k) * c.g, C.getZ(i + k) * c.b);
  }
  return g;
}

// ---------------------------------------------------------------- factions

const SKIN = 0xa98872, HAIR = 0x352a20, STEEL = 0x2e2e2b, BRASS = 0xa8843f, OLIVE = 0x4c5232;
// faction cloth and kit: tunic, trousers, boots, the lower-leg wrap (US canvas leggings, Soviet puttees; null:
// German jackboots) and how far up the shin it reaches, webbing, bags, helmet, rifle wood and the weapon models
const FACTIONS = [
  // USA: olive drab wool, khaki canvas webbing and leggings, russet boots, the M1 helmet
  { tunic: 0x5f6046, legs: 0x57553f, boots: 0x4a3322, wrap: 0x8f8a6c, wrapMat: 'canvas', wrapUp: 0.42, web: 0x857f5f, webMat: 'canvas', bag: 0x77714f, can: OLIVE,
    helmet: 'm1', wood: 0x6e4a2c, rifle: 'garand', smg: 'thompson', carbine: 'm1carbine', scoped: 'm1903', flamer: 'm2' },
  // Germany: field grey, black leather Y-straps and jackboots, bread bag and gas mask can, the Stahlhelm
  { tunic: 0x5d6668, legs: 0x575f61, boots: 0x1f1d1a, wrap: null, wrapMat: 'leather', wrapUp: 0.64, web: 0x232120, webMat: 'leather', bag: 0x7a6f52, can: 0x4f5446,
    helmet: 'stahlhelm', wood: 0x5e3f28, rifle: 'kar98', smg: 'mp40', carbine: 'kar98', scoped: 'kar98', flamer: 'fmw41' },
  // USSR: khaki gymnastyorka, puttees over ankle boots, brown leather, the rolled greatcoat, the SSh-40
  { tunic: 0x7f7a5c, legs: 0x6f6a50, boots: 0x2b2724, wrap: 0x6f6b58, wrapMat: 'wool', wrapUp: 0.45, web: 0x5a4430, webMat: 'leather', bag: 0x6e6449, can: 0x4d5238,
    helmet: 'ssh40', wood: 0x6b4527, rifle: 'mosin', smg: 'ppsh', carbine: 'mosin', scoped: 'mosin', flamer: 'roks2', roll: 0x7d7462 },
  // UK: brown-khaki battledress (the blouse ends at the belt, the trousers ride high), '37 pattern webbing in pale
  // blanco, short web anklets over black ammunition boots, the Mk II Brodie helmet; the No.4 rifle, Sten and Bren
  { tunic: 0x6e5f42, legs: 0x66583e, boots: 0x1d1b18, wrap: 0xa49a74, wrapMat: 'canvas', wrapUp: 0.3, web: 0xa0976f, webMat: 'canvas', bag: 0x938a63, can: 0x55573e,
    helmet: 'brodie', wood: 0x6a4126, rifle: 'lee', smg: 'sten', carbine: 'lee', scoped: 'no4t', bren: 'bren' },
];
// sniper camouflage: per-face patches on the smock (and the helmet cover or hood)
const CAMO = [[0x5f6046, 0x4a4d34, 0x6b6648], [0x6b6a4a, 0x4e5636, 0x7a6a4c, 0x3e4430], [0x6b6e4a, 0x3f4a2e, 0x8a8562],
  [0xb4a476, 0x7c8248, 0x8c6c48, 0xc4b88c]]; // UK: the Denison smock's brushstroke brown and green on sand

// Which job each man of a squad has (and so which figure he is): the squad leader, riflemen in two stances, the
// rangers' bazooka, the sniper and his spotter, and the crews at their guns. B and C are the same job in another stance.
// A British rifle section's last man carries its Bren; commandos are Thompson and Sten men with a Bren and a rifle.
export function soldierKit(type, i, fac = 0) {
  switch (type) {
    case 'flamer': return ['flamer', 'rifleB', 'rifle'][i] ?? 'rifle';
    case 'rifle': case 'conscript': return i === 0 ? 'leader' : fac === 3 && type === 'rifle' && i === 4 ? 'bren' : ['rifle', 'rifleB', 'rifleC'][(i - 1) % 3];
    case 'commando': return ['leader', 'tommy', 'bren', 'tommyB', 'rifle'][i] ?? 'tommy';
    case 'ranger': return i % 3 === 1 ? 'bazooka' : i % 2 ? 'smg' : 'smgB';
    case 'sniper': return i === 0 ? 'sniper' : 'spotter';
    case 'engineer': return i % 2 ? 'engineerB' : 'engineer';
    case 'mg': return ['gunner', 'feeder'][i] ?? 'ammo';
    case 'mortar': return ['loader', 'ammo', 'spotter'][i] ?? 'ammo';
    case 'at': case 'howitzer': return ['layer', 'shell', 'ammo', 'carbine'][i] ?? 'ammo';
    case 'flak': return ['shell', 'ammo', 'spotter'][i] ?? 'ammo';
    default: return 'rifle';
  }
}

// ---------------------------------------------------------------- the body

const HIP = 0.7, HIPZ = 0.085, THIGH = 0.32, SHIN = 0.318, ANKLE = 0.062, UPPER = 0.235, FORE = 0.25, FIST = 0.035;
const SHO = [-0.005, 1.1, 0.152], PIVOT = v3(0, 1.195, 0), HEAD = v3(0.012, 1.27, 0);
// torso rings, canonical (standing straight): [height, half width, front, back]
const TORSO = [[0.6, 0.146, 0.086, 0.096], [0.68, 0.15, 0.09, 0.1], [0.8, 0.134, 0.09, 0.086], [0.92, 0.145, 0.1, 0.09], [1.02, 0.156, 0.102, 0.094],
  [1.09, 0.162, 0.084, 0.09], [1.14, 0.128, 0.064, 0.068], [1.19, 0.05, 0.044, 0.046]];
const sp = (c, e = 0.72) => Math.sign(c) * Math.abs(c) ** e;
function section(y) {
  let i = 0;
  while (i < TORSO.length - 2 && TORSO[i + 1][0] < y) i++;
  const a = TORSO[i], b = TORSO[i + 1], t = clamp((y - a[0]) / (b[0] - a[0]), 0, 1);
  return [1, 2, 3].map((k) => a[k] + (b[k] - a[k]) * t);
}
// a canonical point on the torso at height y and angle a (0 the front, + toward the left), out beyond the cloth
function torsoAt(y, a, out = 0) {
  const [w, f, b] = section(y), c = Math.cos(a), s = Math.sin(a);
  return v3(sp(c) * ((c >= 0 ? f : b) + out), y, -sp(s) * (w + out));
}
// how much of the spine's lean and turn a height gets: none at the hips, all of it at the chest
const waist = (y) => smooth((y - 0.68) / 0.36);

// Stances in the body's own frame: where the pelvis is (root) and how far it pitches forward (tilt), then each leg
// (left, right): the ankle, which way the toes point, which way the knee bends, or a knee on the ground.
const A = ANKLE;
const STANCES = {
  stand: { root: [0, 0.69, 0], tilt: 0.02, legs: [{ ankle: [0.01, A, -0.1], toe: [0.97, 0, -0.24], pole: [1, 0, -0.1] }, { ankle: [-0.02, A, 0.1], toe: [0.97, 0, 0.24], pole: [1, 0, 0.1] }] },
  stride: { root: [0, 0.665, 0], tilt: 0.04, legs: [{ ankle: [0.19, A, -0.11], toe: [0.98, 0, -0.2], pole: [1, 0, -0.1] }, { ankle: [-0.17, A, 0.12], toe: [0.55, 0, 0.83], pole: [0.6, 0, 0.8] }] },
  brace: { root: [0, 0.645, 0], tilt: 0.04, legs: [{ ankle: [0.21, A, -0.15], toe: [0.95, 0, -0.3], pole: [1, 0, -0.2] }, { ankle: [-0.17, A, 0.17], toe: [0.4, 0, 0.9], pole: [0.5, 0, 0.9] }] },
  kneel: { root: [-0.02, 0.37, 0], tilt: 0.05, legs: [{ ankle: [0.27, A, -0.12], toe: [0.98, 0, -0.15], pole: [1, 1.2, -0.1] }, { knee: [-0.03, 0.05, 0.1], ankle: [-0.33, 0.15, 0.11], toe: [0.5, -0.87, 0] }] },
  sit: { root: [-0.06, 0.13, 0], tilt: -0.12, legs: [{ ankle: [0.42, A, -0.17], toe: [0.9, 0.3, -0.2], pole: [0.3, 1, -0.3] }, { ankle: [0.36, A, 0.2], toe: [0.9, 0.3, 0.3], pole: [0.3, 1, 0.4] }] },
  run: { root: [0, 0.63, 0], tilt: 0.15, legs: [{ ankle: [0.25, 0.1, -0.08], toe: [0.95, -0.3, -0.05], pole: [1, 0.3, 0] }, { ankle: [-0.3, 0.21, 0.09], toe: [0.2, -0.98, 0], pole: [1, -0.4, 0] }] },
  prone: { root: [-0.33, 0.11, 0], tilt: 1.44, legs: [{ ankle: [-0.95, 0.075, -0.22], toe: [-0.3, -0.9, -0.3], pole: [0, -1, 0] }, { ankle: [-0.87, 0.08, 0.33], toe: [-0.2, -0.9, 0.4], pole: [0.1, -0.5, 1] }] },
};

// The body for a pose spec: B puts the pelvis in place (F: the whole man's own turn and shift), M(t) adds t of the
// spine's lean (+ forward) and turn (+ brings the right shoulder forward), U = M(1) carries the chest, arms and head.
function makeBody(s) {
  const stance = STANCES[s.stance], st = s.legs ? { ...stance, legs: s.legs } : stance, F = s.F ?? new THREE.Matrix4(), lean = s.lean ?? 0, turn = s.turn ?? 0;
  const B = chain(F, T(V(s.root ?? st.root)), RZ(-(s.tilt ?? st.tilt)), T(0, -HIP, 0)), cache = new Map();
  const M = (t) => {
    const k = Math.round(t * 100);
    if (!cache.has(k)) cache.set(k, chain(B, T(0, HIP, 0), RZ(-lean * (k / 100)), RY(turn * (k / 100)), T(0, -HIP, 0)));
    return cache.get(k);
  };
  return { s, st, F, B, M, U: M(1), at: (p) => p.clone().applyMatrix4(M(waist(p.y))), on: (y) => M(waist(y)) };
}
// the knee for a hip and ankle: two-bone IK bending toward pole
function bend(a, c, l1, l2, pole) {
  const d = c.clone().sub(a), L = Math.min(d.length(), (l1 + l2) * 0.999), u = d.normalize();
  const x = (l1 * l1 - l2 * l2 + L * L) / (2 * L), h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  const p = pole.clone().addScaledVector(u, -pole.dot(u));
  if (p.lengthSq() < 1e-8) p.crossVectors(u, v3(0, 0, 1));
  return a.clone().addScaledVector(u, x).addScaledVector(p.normalize(), h);
}
const dirF = (body, d) => V(d).transformDirection(body.F);
function leg(body, side, L) {
  const hip = v3(0, HIP, side * HIPZ).applyMatrix4(body.B);
  let ankle = V(L.ankle).applyMatrix4(body.F), knee;
  if (L.knee) {
    knee = hip.clone().add(V(L.knee).applyMatrix4(body.F).sub(hip).setLength(THIGH));
    ankle = knee.clone().add(ankle.sub(knee).setLength(SHIN));
  } else {
    const max = (THIGH + SHIN) * 0.995;
    if (hip.distanceTo(ankle) > max) ankle = hip.clone().add(ankle.clone().sub(hip).setLength(max));
    knee = bend(hip, ankle, THIGH, SHIN, dirF(body, L.pole ?? [1, 0, 0]));
  }
  return { hip, knee, ankle, toe: dirF(body, L.toe), pole: dirF(body, L.pole ?? [1, 0, 0]) };
}
// an arm from its shoulder to a fist at `hand`, the elbow bending toward pole; when the fist is out of reach the
// forearm stretches (err says by how much)
function arm(body, side, hand, pole) {
  const sho = v3(SHO[0], SHO[1], side * SHO[2]).applyMatrix4(body.U), l2 = FORE + FIST, d = sho.distanceTo(hand), max = (UPPER + l2) * 0.999;
  return { sho, hand: hand.clone(), elbow: bend(sho, hand, UPPER, d > max ? d / 0.999 - UPPER : l2, V(pole)), err: Math.max(0, d - max) };
}

// ---------------------------------------------------------------- weapons

const RIFLES = {
  garand: { L: 0.864, fore: 0.62, hand: 0.5 },
  kar98: { L: 0.866, fore: 0.64, hand: 0.5, bolt: true },
  mosin: { L: 0.96, fore: 0.77, hand: 0.52, bolt: true },
  m1903: { L: 0.86, fore: 0.645, hand: 0.5, bolt: true },
  m1carbine: { L: 0.705, fore: 0.47, hand: 0.4, mag: true },
  // the No.4: wood nearly to the muzzle, a stub of barrel past the nose cap, the box magazine under the bolt
  lee: { L: 0.885, fore: 0.79, hand: 0.5, bolt: true, mag: true },
  no4t: { L: 0.885, fore: 0.79, hand: 0.5, bolt: true, mag: true },
};
// A weapon in its own frame: butt at x = 0, bore along +x on y = 0, muzzle at x = L; grip and fore are where the
// right and left fists hold it, butt the point that goes into the shoulder. detail 1: the far prism; 2: slung on the
// back (stock and barrel only).
function weapon(kind, F, detail = 0) {
  const model = F[kind] ?? kind, out = [], add = (geo, color, m, mat) => out.push({ geo, color, m: m ?? new THREE.Matrix4(), mat });
  const X = (x0, x1, r, color, sides = 5, y = 0, mat = 'gunmetal', z = 0) => add(new THREE.CylinderGeometry(r, r, x1 - x0, sides, 1, true), color, chain(T((x0 + x1) / 2, y, z), RZ(-Math.PI / 2)), mat);
  const R = RIFLES[model], bayonet = model === 'mosin' && kind === 'rifle';
  if (model === 'bren' || model === 'sten') return britishGun(model, F, detail, X, add, out);
  if (R) {
    const { L, fore: f } = R, info = { L, grip: [0.28, -0.036], fore: [R.hand, -0.024], butt: [0, -0.01], parts: out };
    if (detail === 1) { X(0, L + (bayonet ? 0.3 : 0), 0.02, F.wood, 3, -0.01, 'wood'); return info; }
    if (detail === 2) { add(extrudeProfile([[0, -0.06], [0.3, -0.03], [f, -0.012], [f, 0.008], [0, 0.02]], 0.03), F.wood, null, 'wood'); X(f - 0.06, L, 0.008, STEEL, 4); return info; }
    add(extrudeProfile([[0, -0.066], [0.03, -0.064], [0.25, -0.032], [0.3, -0.046], [0.34, -0.028], [f, -0.016], [f, 0.006], [0.3, 0.01], [0.06, 0.02], [0, 0.022]], 0.03), F.wood, null, 'wood');
    X(f - 0.06, L, 0.008, STEEL);
    add(box(0.17, 0.028, 0.024), STEEL, T(0.39, 0.012, 0), 'gunmetal'); // receiver
    if (R.bolt) add(box(0.012, 0.012, 0.045), STEEL, T(0.36, 0.016, 0.028), 'gunmetal');
    if (R.mag) add(box(0.03, 0.055, 0.02), STEEL, T(0.36, -0.04, 0), 'gunmetal');
    if (bayonet) add(new THREE.CylinderGeometry(0, 0.007, 0.33, 3, 1, true), 0x7a7a74, chain(T(L + 0.145, -0.012, 0.01), RZ(-Math.PI / 2)), 'gunmetal');
    if (kind === 'scoped') { X(0.29, 0.56, 0.014, 0x1f1f1c, 6, 0.046, 'gunmetal', model === 'mosin' || model === 'no4t' ? -0.012 : 0); add(box(0.07, 0.03, 0.012), STEEL, T(0.42, 0.028, 0), 'gunmetal'); }
    if (model === 'no4t') add(box(0.09, 0.016, 0.034), F.wood, T(0.12, 0.028, 0), 'wood'); // the sniper's cheek rest
    return info;
  }
  if (model === 'bazooka') {
    const L = 1.07, info = { L, grip: [0.58 * L, -0.085], fore: [0.76 * L, -0.075], butt: [0.45 * L, -0.035], parts: out };
    if (detail === 1) { X(0, L, 0.03, 0x4a5032, 3, 0, 'armor-paint'); return info; }
    X(0.05, L, 0.026, 0x4a5032, 8, 0, 'armor-paint');
    add(new THREE.CylinderGeometry(0.026, 0.04, 0.07, 8, 1, true), 0x4a5032, chain(T(0.035, 0, 0), RZ(-Math.PI / 2)), 'armor-paint'); // flared back end
    add(box(0.16, 0.04, 0.028), F.wood, T(0.42 * L, -0.042, 0), 'wood'); // shoulder stock
    add(box(0.03, 0.075, 0.026), F.wood, chain(T(0.58 * L, -0.06, 0), RZ(-0.2)), 'wood'); // trigger grip
    add(box(0.03, 0.065, 0.026), F.wood, T(0.76 * L, -0.055, 0), 'wood'); // front grip
    return info;
  }
  // flame guns: the hose end at x = 0, the nozzle at L, held at the hip. The M2 and the Flammenwerfer 41 are a tube
  // with two grips and an igniter head; the ROKS-2 was made to pass for a rifle, with a wooden stock and fore-end.
  if (kind === 'flamer') {
    const L = model === 'fmw41' ? 0.95 : model === 'roks2' ? 0.92 : 0.8, rifleLike = model === 'roks2';
    const info = { L, grip: [rifleLike ? 0.27 : 0.12, -0.05], fore: [L * 0.55, -0.04], butt: [0, -0.01], parts: out };
    if (detail === 1) { X(0, L, 0.024, rifleLike ? F.wood : STEEL, 3, 0, rifleLike ? 'wood' : 'gunmetal'); return info; }
    if (rifleLike) {
      add(extrudeProfile([[0, -0.06], [0.03, -0.06], [0.24, -0.03], [0.3, -0.045], [0.34, -0.026], [0.62, -0.016], [0.62, 0.008], [0.3, 0.012], [0, 0.02]], 0.032), F.wood, null, 'wood');
      X(0.3, L - 0.06, 0.013, STEEL, 6);
      X(L - 0.06, L, 0.02, STEEL, 6); // the nozzle
      add(box(0.06, 0.04, 0.03), STEEL, T(0.36, -0.03, 0), 'gunmetal'); // the valve under the receiver
    } else {
      const tubeC = model === 'm2' ? 0x4a5032 : STEEL, tubeM = model === 'm2' ? 'armor-paint' : 'gunmetal';
      X(0, 0.1, 0.022, STEEL, 6); // the hose fitting
      X(0.1, L - 0.1, 0.017, tubeC, 5, 0, tubeM); // the fuel tube
      X(L - 0.12, L, 0.03, STEEL, 6); // the igniter head round the nozzle
      add(box(0.03, 0.08, 0.026), F.wood, chain(T(0.12, -0.05, 0), RZ(-0.25)), 'wood'); // the rear grip and its valve
      add(box(0.03, 0.07, 0.026), F.wood, chain(T(L * 0.55, -0.045, 0), RZ(-0.1)), 'wood'); // the front grip
      if (model === 'm2') X(L - 0.24, L - 0.12, 0.022, tubeC, 6, 0.034, tubeM); // the igniter cylinder over the barrel
      else add(box(0.05, 0.05, 0.035), STEEL, T(L - 0.08, -0.035, 0), 'gunmetal'); // the igniter cartridge box
    }
    return info;
  }
  // submachine guns
  const S = {
    thompson: { L: 0.63, grip: [0.255, -0.065], fore: [0.45, -0.03], butt: [0, -0.01] },
    mp40: { L: 0.65, grip: [0.24, -0.065], fore: [0.33, -0.1], butt: [0, -0.02] },
    ppsh: { L: 0.658, grip: [0.22, -0.04], fore: [0.42, -0.034], butt: [0, -0.01] },
  }[model], L = S.L, info = { ...S, parts: out };
  if (detail === 1) { X(0, L, 0.022, model === 'mp40' ? STEEL : F.wood, 3, -0.01, model === 'mp40' ? 'gunmetal' : 'wood'); return info; }
  if (model === 'thompson') {
    add(extrudeProfile([[0, -0.07], [0.025, -0.07], [0.19, -0.024], [0.2, 0.012], [0, 0.016]], 0.034), F.wood, null, 'wood');
    add(box(0.21, 0.046, 0.032), STEEL, T(0.3, 0.004, 0), 'gunmetal');
    add(box(0.032, 0.075, 0.028), F.wood, chain(T(0.255, -0.05, 0), RZ(-0.25)), 'wood'); // pistol grip
    add(box(0.11, 0.032, 0.03), F.wood, T(0.45, -0.012, 0), 'wood'); // fore-end
    add(box(0.028, 0.11, 0.02), STEEL, T(0.34, -0.07, 0), 'gunmetal'); // stick magazine
    X(0.4, L, 0.012, STEEL);
  } else if (model === 'mp40') {
    X(0.17, 0.44, 0.019, STEEL, 6);
    add(box(0.17, 0.012, 0.03), STEEL, T(0.09, -0.012, 0), 'gunmetal'); // folding stock
    add(box(0.018, 0.06, 0.034), STEEL, T(0.01, -0.028, 0), 'gunmetal'); // butt plate
    add(box(0.032, 0.075, 0.028), 0x2a2622, chain(T(0.24, -0.05, 0), RZ(-0.25)), 'gunmetal');
    add(box(0.026, 0.15, 0.02), STEEL, T(0.33, -0.095, 0), 'gunmetal'); // the long magazine
    X(0.44, L, 0.01, STEEL);
  } else {
    add(extrudeProfile([[0, -0.07], [0.025, -0.07], [0.2, -0.028], [0.35, -0.028], [0.35, 0.014], [0.2, 0.01], [0, 0.014]], 0.036), F.wood, null, 'wood');
    X(0.35, 0.6, 0.02, STEEL, 6); // perforated barrel jacket
    X(0.6, L, 0.012, STEEL);
    add(new THREE.CylinderGeometry(0.055, 0.055, 0.03, 8), STEEL, chain(T(0.31, -0.07, 0), RX(Math.PI / 2)), 'gunmetal'); // drum
  }
  return info;
}

// The Bren light MG (the curved magazine standing on top, carrying handle, gas tube under the barrel, coned flash
// hider, bipod) and the Sten Mk II (skeleton butt, tube receiver, the magazine sticking out to the left), in
// weapon()'s frame and details.
function britishGun(model, F, detail, X, add, out) {
  const W = 0x34332e;
  if (model === 'bren') {
    const L = 0.9, info = { L, grip: [0.3, -0.06], fore: [0.55, -0.03], butt: [0, -0.02], parts: out };
    if (detail === 1) { X(0, L, 0.022, STEEL, 3, -0.005); return info; }
    add(extrudeProfile([[0, -0.075], [0.03, -0.075], [0.2, -0.03], [0.24, -0.012], [0.24, 0.016], [0, 0.02]], 0.03), W, null, 'gunmetal'); // butt
    add(box(0.3, 0.05, 0.036), STEEL, T(0.38, 0.002, 0), 'gunmetal'); // receiver
    add(box(0.03, 0.075, 0.026), F.wood, chain(T(0.3, -0.055, 0), RZ(-0.3)), 'wood'); // pistol grip
    add(box(0.034, 0.075, 0.022), W, chain(T(0.405, 0.058, 0), RZ(-0.2)), 'gunmetal'); // the curved magazine, in two
    add(box(0.034, 0.06, 0.022), W, chain(T(0.432, 0.112, 0), RZ(-0.65)), 'gunmetal');
    add(box(0.1, 0.014, 0.016), F.wood, chain(T(0.6, 0.045, 0), RZ(0.12)), 'wood'); // carrying handle
    X(0.53, L - 0.05, 0.014, STEEL, 6);
    X(0.53, 0.78, 0.01, STEEL, 5, -0.026); // gas tube
    add(new THREE.CylinderGeometry(0.02, 0.013, 0.06, 5, 1, true), STEEL, chain(T(L - 0.03, 0, 0), RZ(-Math.PI / 2)), 'gunmetal'); // flash hider
    for (const z of [-1, 1]) add(new THREE.CylinderGeometry(0.006, 0.006, 0.17, 3, 1, true), STEEL, chain(T(0.77, -0.03, 0), RX(-0.14 * z), RZ(0.4), T(0, -0.085, 0)), 'gunmetal'); // bipod
    return info;
  }
  const L = 0.6, info = { L, grip: [0.24, -0.05], fore: [0.47, -0.014], butt: [0, -0.03], parts: out };
  if (detail === 1) { X(0, L, 0.018, STEEL, 3, -0.01); return info; }
  add(extrudeProfile([[0, -0.07], [0.016, -0.07], [0.016, -0.04], [0.2, -0.012], [0.2, 0.004], [0.016, -0.02], [0.016, 0], [0, 0]], 0.014), STEEL, null, 'gunmetal'); // skeleton butt
  X(0.19, 0.44, 0.02, STEEL, 6); // receiver
  X(0.44, 0.53, 0.014, W, 6); // barrel sleeve
  X(0.53, L, 0.008, STEEL, 4);
  add(box(0.07, 0.04, 0.022), STEEL, T(0.235, -0.03, 0), 'gunmetal'); // trigger housing
  add(box(0.026, 0.02, 0.17), W, T(0.37, -0.004, -0.1), 'gunmetal'); // the magazine, out to the left
  return info;
}

// Things carried or set down, in their own frame: an ammo can (origin at the handle, hanging below it), an AT round
// along x (origin mid-round), a flak clip standing up (origin at its middle), a mortar bomb along y (origin at the
// tail), binoculars along x (eyepieces at the origin), the MG belt from (0,0,0) to (1,0,0).
function item(kind, F, far) {
  const out = [], add = (geo, color, m, mat) => out.push({ geo, color, m: m ?? new THREE.Matrix4(), mat });
  const along = (r0, r1, x0, x1, color, sides, mat) => add(new THREE.CylinderGeometry(r1, r0, x1 - x0, sides, 1, false), color, chain(T((x0 + x1) / 2, 0, 0), RZ(-Math.PI / 2)), mat);
  if (kind === 'can') {
    add(box(0.22, 0.14, 0.08), F.can, T(0, -0.085, 0), 'armor-paint');
    if (!far) add(box(0.07, 0.012, 0.014), STEEL, T(0, -0.01, 0), 'gunmetal');
  } else if (kind === 'round') {
    if (far) add(box(0.4, 0.05, 0.05), BRASS, null, 'gunmetal');
    else { along(0.03, 0.03, -0.22, 0.08, BRASS, 6, 'gunmetal'); along(0.028, 0.009, 0.08, 0.2, 0x3a3b33, 6, 'gunmetal'); }
  } else if (kind === 'clip') {
    add(box(0.05, 0.26, 0.15), BRASS, T(0, -0.02, 0), 'gunmetal');
    if (!far) add(box(0.04, 0.08, 0.14), 0x3a3b33, T(0, 0.15, 0), 'gunmetal');
  } else if (kind === 'bomb') {
    if (far) add(box(0.06, 0.28, 0.06), 0x4f5236, T(0, 0.14, 0), 'armor-paint');
    else {
      add(new THREE.LatheGeometry([[0, 0.04], [0.013, 0.1], [0.032, 0.14], [0.032, 0.22], [0, 0.28]].map(([x, y]) => new THREE.Vector2(x, y)), 6), 0x4f5236, null, 'armor-paint');
      add(box(0.055, 0.06, 0.055), 0x4f5236, chain(T(0, 0.04, 0), RY(Math.PI / 4)), 'armor-paint');
    }
  } else if (kind === 'binos') {
    for (const z of [-0.026, 0.026]) add(new THREE.CylinderGeometry(0.017, 0.015, 0.085, far ? 3 : 6, 1, true), 0x2a2a26, chain(T(0.04, 0, z), RZ(-Math.PI / 2)), 'gunmetal');
  } else if (kind === 'belt') {
    add(box(1, 0.01, 0.045), BRASS, T(0.5, 0, 0), 'gunmetal');
  }
  return out;
}

// ---------------------------------------------------------------- jobs and poses

// Where a pose puts the muzzle flash, relative to standing: unit-models.js moves the soldier node by this in each
// posture (stand, crouch, prone, retreat) so client/fx.js HAND lands on the muzzle the rig aims there.
export const AIM_SHIFT = [[0, 0], [0.05, -0.33], [0.28, -0.84], [-0.25, 0.15]];
const HAND = { rifle: [0.72, 1.1, 0.2], conscript: [0.72, 1.1, 0.2], engineer: [0.6, 1.0, 0.2], ranger: [0.62, 0.9, 0.2], sniper: [1.13, 1.08, 0.2] };
const BAZ = [0.63, 0.93, 0.25];
const FLAME = [0.9, 0.78, 0.2]; // the flame gun's nozzle, held at the hip
const flash = (type, k, h = HAND[type] ?? HAND.rifle) => v3(h[0] + AIM_SHIFT[k][0], h[1] + AIM_SHIFT[k][1], h[2]);
// where each hold puts the weapon on the body (canonical): the shoulder pocket, under the right arm, on top of the
// right shoulder, at the right hip (the flame gun)
const ANCHOR = { aim: [0.05, 1.075, 0.105], under: [0.0, 0.97, 0.14], shoulder: [0.0, 1.14, 0.13], hip: [0.06, 0.8, 0.17] };
// the guns, from each crewman's own slot (client/models/guns.js GUN_SLOTS): MG gunner grips (right, left), the MG42's
// butt, the belt feed seen from the feeder, the mortar's mouth seen from the loader
const MG = [
  { R: [0.767, 0.222, 0], L: [0.82, 0.33, -0.06], feed: [0.79, 0.25, -0.8] },
  { R: [0.782, 0.244, 0], L: [0.52, 0.355, -0.03], butt: [0.43, 0.31, 0], feed: [0.8, 0.28, -0.8] },
  { R: [0.56, 0.39, 0.074], L: [0.56, 0.39, -0.074], feed: [0.66, 0.44, -0.76] },
];
const MOUTH = v3(0.633, 0.644, -0.819);

// The pose a corpse uses. Same parts as the living postures, so the mesh still matches, but the chest is down in
// the dirt, the arms are slack, and a weapon lies beside the body instead of being aimed. Crews are not left
// reaching for a gun the body does not include. This is not posture 2: that one stays the aiming prone.
function fallenSpec(ctx) {
  const { type, job } = ctx, base = /[BC]$/.test(job) ? job.slice(0, -1) : job;
  // lean +0.5 rolls the chest into the dirt. The aiming prone uses about -0.3, which props the chest up to sight.
  const lie = { stance: 'prone', turn: 0.06, lean: 0.5, yaw: 0.35, fallen: true };
  const gun = { rifle: 'rifle', leader: 'smg', sniper: 'scoped', engineer: 'carbine', smg: 'smg', bazooka: 'bazooka', carbine: 'carbine', flamer: 'flamer', bren: 'bren', tommy: 'thompson' }[base];
  if (gun) return { ...lie, gun: { kind: gun, hold: 'dropped' } };
  const carry = base === 'spotter' ? 'binos' : base === 'ammo' || base === 'feeder' ? 'can' : base === 'shell' ? (type === 'flak' ? 'clip' : 'round') : base === 'loader' ? 'bomb' : null;
  return { ...lie, sling: true, ...(carry ? { carry, down: true } : {}), ...(base === 'feeder' ? { belt: 'can' } : {}) };
}

// A pose spec for job in posture k (0 stand, 1 crouch, 2 prone, 3 retreat): stance, spine lean and turn, the man's
// own yaw, the weapon and how it is held, where the hands go and what is carried.
function spec(ctx, k) {
  const { type, job, fac } = ctx, v = /[BC]$/.test(job) ? job.at(-1) : '', B = v === 'B', C = v === 'C', base = v ? job.slice(0, -1) : job;
  const run = { stance: 'run', turn: 0.1, lean: 0.12 };
  // lying down: chest propped up; aiming, the body lies angled off to the left of the line of fire so the rifle
  // crosses in front of the chest over the left elbow
  const prone = { stance: 'prone', turn: -0.1, lean: -0.42 }, proneAim = { stance: 'prone', turn: -0.05, lean: -0.3, yaw: C ? -0.16 : -0.28 };
  switch (base) {
    case 'rifle': case 'leader': case 'sniper': case 'engineer': case 'bren': case 'tommy': {
      const kind = { leader: 'smg', sniper: 'scoped', engineer: 'carbine', bren: 'bren', tommy: 'thompson' }[base] ?? 'rifle';
      const target = flash(type, k), aim = { kind, hold: 'aim', target };
      if (k === 0) {
        if (C) return { stance: 'stand', turn: -0.6, lean: -0.03, gun: { ...aim, psi: -0.03 } };
        return { stance: base === 'leader' || base === 'sniper' || base === 'bren' || B ? 'brace' : 'stride', turn: B ? -0.82 : -0.68, lean: B ? 0.1 : 0.05, gun: { ...aim, psi: B ? 0.04 : 0 } };
      }
      if (k === 1) return { stance: 'kneel', turn: C ? -0.45 : -0.55, lean: C ? 0.22 : 0.14, gun: aim };
      if (k === 2) return { ...proneAim, gun: aim };
      return { ...run, gun: { kind, hold: 'port' } };
    }
    case 'flamer': {
      const target = flash('flamer', k, FLAME), gun = { kind: 'flamer', hold: 'hip', target };
      if (k === 0) return { stance: 'brace', turn: -0.35, lean: 0.12, gun };
      if (k === 1) return { stance: 'kneel', turn: -0.35, lean: 0.14, gun };
      if (k === 2) return { ...proneAim, gun: { ...gun, hold: 'aim', target: target.add(v3(0, 0.1, 0)) } };
      return { ...run, gun: { kind: 'flamer', hold: 'port' } };
    }
    case 'smg': {
      const target = flash('ranger', k);
      if (k === 0) return { stance: B ? 'brace' : 'stride', turn: -0.3, lean: 0.1, gun: { kind: 'smg', hold: 'under', target, psi: B ? 0.06 : 0 } };
      if (k === 1) return { stance: 'kneel', turn: -0.35, lean: 0.12, gun: { kind: 'smg', hold: 'under', target } };
      // the ranger's flash point lies down lower than a rifleman's: the muzzle stays a hand above the ground
      if (k === 2) return { ...proneAim, gun: { kind: 'smg', hold: 'aim', target: target.add(v3(0, 0.1, 0)) } };
      return { ...run, gun: { kind: 'smg', hold: 'port' } };
    }
    case 'bazooka': {
      const gun = { kind: 'bazooka', hold: 'shoulder' };
      if (k === 0) return { stance: 'kneel', turn: -0.2, lean: 0.06, gun: { ...gun, target: V(BAZ) } };
      if (k === 1) return { stance: 'sit', turn: -0.15, lean: 0.3, gun: { ...gun, target: V(BAZ).add(v3(AIM_SHIFT[1][0], AIM_SHIFT[1][1], 0)) } };
      if (k === 2) return { ...prone, lean: -0.5, gun: { ...gun, target: V(BAZ).add(v3(AIM_SHIFT[2][0], AIM_SHIFT[2][1] + 0.12, 0)) } };
      return { ...run, gun: { ...gun, hold: 'carry' } };
    }
    case 'carbine': {
      const gun = { kind: 'carbine', hold: 'aim' };
      if (k === 0) return { stance: 'stand', turn: -0.5, lean: 0.06, gun: { ...gun, target: v3(0.45, 0.78, 0.12), psi: 0.35 } };
      if (k === 1) return { stance: 'kneel', turn: -0.55, lean: 0.14, gun: { ...gun, target: v3(0.75, 0.76, 0.2) } };
      if (k === 2) return { ...proneAim, gun: { ...gun, target: v3(1.0, 0.26, 0.2) } };
      return { ...run, gun: { kind: 'carbine', hold: 'port' } };
    }
    case 'spotter': {
      const binos = { binos: true, sling: true };
      if (k === 0) return { stance: type === 'sniper' ? 'kneel' : 'stand', turn: 0.1, lean: 0.05, ...binos };
      if (k === 1) return { stance: 'kneel', turn: 0.1, lean: 0.1, ...binos };
      if (k === 2) return { ...prone, lean: -0.5, turn: 0, ...binos };
      return { ...run, sling: true, carry: 'binos' };
    }
    case 'ammo':
      if (k === 0) return { stance: 'stand', turn: 0.05, sling: true, carry: 'can' };
      if (k === 1) return { stance: 'kneel', turn: 0.15, lean: 0.55, sling: true, carry: 'can', down: true };
      if (k === 2) return { ...prone, turn: 0, sling: true, carry: 'can', down: true };
      return { ...run, sling: true, carry: 'can' };
    case 'shell': {
      const what = type === 'flak' ? 'clip' : 'round';
      if (k === 0) return { stance: 'stand', turn: -0.1, lean: 0.04, sling: true, carry: what };
      if (k === 1) return { stance: 'kneel', turn: -0.1, lean: 0.12, sling: true, carry: what };
      if (k === 2) return { ...prone, turn: 0, sling: true, carry: what, down: true };
      return { ...run, sling: true, carry: what };
    }
    case 'layer':
      if (k < 2) return { stance: 'kneel', turn: -0.15, lean: 0.12, sling: true, point: true };
      if (k === 2) return { ...prone, turn: 0, lean: -0.5, sling: true };
      return { ...run, sling: true };
    case 'gunner': {
      if (k === 3) return { ...run, sling: true };
      const g = MG[fac] ?? MG[0];
      if (g.butt) return { ...prone, lean: -0.5, turn: -0.1, sling: true, hands: { R: g.R, L: g.L, poleL: [0.2, -1, -0.6] }, place: { anchor: ANCHOR.aim, at: g.butt } };
      return { ...prone, lean: fac === 2 ? -0.75 : -0.5, turn: 0, sling: true, hands: { R: g.R, L: g.L }, approach: 0.36 };
    }
    case 'feeder': {
      if (k === 3) return { ...run, sling: true, carry: 'can', belt: 'can' };
      const g = MG[fac] ?? MG[0], feed = V(g.feed), R = feed.clone().add(v3(-0.1, -0.03, 0.12)), L = feed.clone().add(v3(-0.02, 0, 0.05));
      return { ...(k === 2 ? { ...prone, lean: -0.6 } : { stance: 'kneel', lean: 0.7, turn: -0.2 }), yaw: 0.8, sling: true, carry: 'can', down: true, belt: 'feed', hands: { R, L }, approach: k === 2 ? 0.34 : 0.24 };
    }
    case 'loader': {
      if (k === 3) return { ...run, sling: true, carry: 'bomb' };
      if (k === 2) return { ...prone, turn: 0, sling: true, carry: 'bomb', down: true };
      return { stance: 'kneel', lean: 0.12, turn: -0.1, yaw: 0.91, sling: true, carry: 'bomb', bombOver: true, approach: 0.34 };
    }
    default: return { stance: 'stand', sling: true };
  }
}

// the head looking along dir (soldier space), as far as the neck allows; jut moves it toward the stock and roll
// tilts it onto the stock
function headMatrix(body, dir, { jut = [0, 0, 0], roll = 0 } = {}) {
  const d = dir.clone().applyMatrix4(new THREE.Matrix4().extractRotation(body.U).invert()).normalize();
  const look = clamp(Math.atan2(-d.z, d.x), -1.1, 1.1), nod = clamp(-Math.atan2(d.y, Math.hypot(d.x, d.z)), -1.3, 0.8);
  return chain(body.U, T(PIVOT.clone().add(V(jut))), RY(look), RZ(-nod), RX(roll), T(HEAD.clone().sub(PIVOT)));
}

// Solve a pose: the body placed so the weapon or the hands land where the spec wants them, then the legs, arms and
// head, the weapon's frame and the carried things in the soldier's own space.
function solve(ctx, k, phase = null) {
  const s = k === 'fallen' ? fallenSpec(ctx) : spec(ctx, k);
  if (phase !== null && k !== 'fallen') {
    // Each boot spends half a cycle planted, travelling back as the body advances, then swings forward.
    const low = k === 1, crawl = k === 2;
    s.root = crawl ? [-0.33 + 0.025 * Math.sin(phase * Math.PI * 2), 0.11, 0] : [0, (low ? 0.47 : 0.61) + 0.018 * Math.cos(phase * Math.PI * 4), 0];
    if (low || k === 0) { s.stance = 'stride'; s.tilt = low ? 0.18 : 0.15; }
    s.turn = (k === 0 ? s.turn ?? 0 : crawl ? -0.1 : 0.1) + (crawl || k === 0 ? 0.04 : 0.08) * Math.sin(phase * Math.PI * 2);
    s.legs = [-1, 1].map((side, i) => {
      const t = (phase + i * 0.5) % 1, swing = Math.max(0, Math.sin((t - 0.5) * Math.PI * 2));
      if (crawl) return { ankle: [-0.92 + 0.12 * Math.cos(t * Math.PI * 2), 0.075 + 0.025 * swing, side * (0.22 + 0.06 * swing)], toe: [-0.3, -0.9, side * 0.3], pole: [0.2, -1, side * 0.2] };
      const reach = low ? 0.19 : 0.31, x = t < 0.5 ? reach - 4 * reach * t : -reach + 2 * reach * smooth((t - 0.5) * 2);
      return { ankle: [x, A + (low ? 0.08 : 0.13) * swing, side * 0.1], toe: [1, 0.18 * swing, 0], pole: [1, 0.15, side * 0.08] };
    });
  }
  const F = ctx.F, info = s.gun ? weapon(s.gun.kind, F) : null, hold = s.gun?.hold;
  let M0 = RY(s.yaw ?? 0), body = makeBody({ ...s, F: M0 }), W = null;
  const shift = (d) => { M0 = T(d.x, 0, d.z).multiply(M0); body = makeBody({ ...s, F: M0 }); };
  // dropped: flat on the dirt beside the right hip, muzzle out to the man's right, turned with him, not along the aim line
  if (hold === 'dropped') W = chain(M0, T(0.05, 0.02, 0.46), RY(-Math.PI / 2), RZ(0.12));
  else if (s.gun?.target) {
    // the muzzle on the target, the butt on the body's anchor for the hold, the body moved to fit
    const w = info.butt, Aw = V(ANCHOR[hold]).applyMatrix4(body.U), L = info.L, a = L - w[0], ya = w[1];
    const p = Math.atan2(ya, a) + Math.asin(clamp((s.gun.target.y - Aw.y) / Math.hypot(a, ya), -1, 1));
    const R = chain(RY(s.gun.psi ?? 0), RZ(p)), butt = s.gun.target.clone().sub(v3(L, 0, 0).applyMatrix4(R));
    W = chain(T(butt), R);
    shift(v3(w[0], w[1], 0).applyMatrix4(W).sub(Aw));
  }
  if (s.place) shift(V(s.place.at).sub(V(s.place.anchor).applyMatrix4(body.U)));
  // hands that must reach a point: the shoulders `approach` back from it, facing the man's own way
  const facing = v3(1, 0, 0).transformDirection(M0);
  let handsAt = s.hands ? V(s.hands.R).add(V(s.hands.L)).multiplyScalar(0.5) : null, bomb = null;
  if (s.bombOver) { bomb = MOUTH.clone().add(v3(0, 0.05, 0)); handsAt = bomb.clone().add(v3(0, 0.15, 0)); }
  if (s.approach && handsAt) shift(handsAt.clone().addScaledVector(facing, -s.approach).sub(v3(SHO[0], SHO[1], 0).applyMatrix4(body.U)));
  const U = body.U, rot = (d) => V(d).transformDirection(U), legs = body.st.legs.map((L, i) => leg(body, i ? 1 : -1, L));
  const prone = s.stance === 'prone', neck = () => v3(SHO[0], SHO[1] + 0.12, 0).applyMatrix4(U);
  if (hold === 'port') W = chain(U, T(0.15, 0.86, 0.1), RY(1.1), RZ(0.85), T(-info.grip[0], -info.grip[1], 0));
  if (hold === 'carry') W = chain(U, T(0.0, 1.16, 0.13), RZ(0.18), T(-info.butt[0], -info.butt[1], 0));
  const things = [];
  // the weapon slung across the back, butt at the right hip, muzzle over the left shoulder
  let sling = null;
  if (s.sling) {
    const butt = body.at(v3(-0.13, 0.62, 0.13)), top = body.at(v3(-0.14, 1.4, -0.15));
    sling = basis(butt, top.clone().sub(butt), rot([-1, 0, 0]));
  }
  // hands: on the weapon, on the gun, on the binoculars, or free
  let hR, hL, pR = rot([-0.3, -0.5, 1]), pL = rot([0, -1, -0.4]), gaze = facing.clone();
  if (W && hold !== 'carry') {
    // lying down the left hand slides back along the fore-end so the elbow can rest on the ground
    hR = V([...info.grip, 0]).applyMatrix4(W); hL = v3(info.fore[0] - (prone && hold === 'aim' ? 0.09 : 0), info.fore[1], 0).applyMatrix4(W);
    gaze = v3(1, 0, 0).transformDirection(W);
    if (hold === 'aim') { pR = prone ? V([0, -1, 0.5]) : rot([-0.1, -0.35, 1]); pL = prone ? V([0.3, -1, -0.3]) : rot([0.1, -1, -0.3]); }
    if (hold === 'port') { gaze = facing.clone().add(v3(0, -0.1, 0)); pR = rot([-0.4, -0.6, 1]); pL = rot([-0.2, -1, -0.6]); }
    if (hold === 'under' || hold === 'hip') { pR = rot([-1, -0.3, 0.6]); pL = rot([0, -1, -0.6]); }
    if (hold === 'shoulder') { pR = rot([0, -1, 0.6]); pL = rot([0, -1, -0.5]); }
  } else if (hold === 'carry') {
    hR = V([...info.grip, 0]).applyMatrix4(W); hL = v3(0.08, 0.84, -0.2).applyMatrix4(U); pL = rot([-1, 0, -0.3]); pR = rot([0, -1, 0.5]);
  } else if (s.hands) {
    hR = V(s.hands.R); hL = V(s.hands.L);
    pR = V([0.2, -1, 0.6]); pL = V(s.hands.poleL ?? [0.2, -1, -0.6]);
    gaze = prone ? facing.clone() : hR.clone().add(hL).multiplyScalar(0.5).sub(neck());
  }
  // the head first (binoculars sit at the eyes), then the free hands
  const look = s.fallen ? v3(0.2, -0.35, 0.9).transformDirection(M0) : s.binos ? facing.clone().add(v3(0, prone ? 0.1 : 0.05, 0)) : bomb ? bomb.clone().sub(neck()) : gaze;
  const H = headMatrix(body, look, s.fallen ? { jut: [0.01, 0.01, 0.04], roll: 0.35 } : hold === 'aim' ? { jut: [0.035, -0.02, 0.05], roll: 0.22 } : {});
  if (s.binos) {
    things.push({ kind: 'binos', m: chain(H, T(0.095, 0, 0), RZ(0.05)) });
    hR = v3(0.11, -0.012, 0.042).applyMatrix4(H); hL = v3(0.11, -0.012, -0.042).applyMatrix4(H);
    pR = rot([0, -1, 0.8]); pL = rot([0, -1, -0.8]);
  }
  if (s.carry && !s.down && !s.binos) {
    if (s.carry === 'can' || s.carry === 'binos') {
      hR = v3(s.stance === 'run' ? -0.12 : 0.02, 0.66, 0.2).applyMatrix4(U); pR = rot([-1, 0, 0.3]);
      things.push({ kind: s.carry, m: s.carry === 'can' ? T(hR.clone().add(v3(0, -0.02, 0))) : chain(T(hR.clone().add(v3(0.01, -0.04, 0))), RZ(-1.3)) });
    } else if (s.carry === 'round') {
      // across the chest, both hands under it
      things.push({ kind: 'round', m: chain(U, T(0.2, 0.92, 0), RY(Math.PI / 2 - 0.25), RZ(0.12)) });
      hR = v3(0.18, 0.88, 0.11).applyMatrix4(U); hL = v3(0.21, 0.89, -0.11).applyMatrix4(U);
      pR = rot([-0.5, -1, 0.6]); pL = rot([-0.5, -1, -0.6]);
    } else if (s.carry === 'clip') {
      things.push({ kind: 'clip', m: chain(U, T(0.21, 0.98, 0), RZ(-0.1)) });
      hR = v3(0.19, 0.93, 0.085).applyMatrix4(U); hL = v3(0.2, 0.96, -0.085).applyMatrix4(U);
      pR = rot([-0.5, -1, 0.6]); pL = rot([-0.5, -1, -0.6]);
    } else if (s.carry === 'bomb') {
      if (bomb) {
        // fins down over the mortar's mouth, about to let go
        things.push({ kind: 'bomb', m: T(bomb) });
        const side = v3(0, 1, 0).cross(facing).normalize();
        hR = bomb.clone().add(v3(0, 0.17, 0)).addScaledVector(side, 0.04).addScaledVector(facing, -0.02);
        hL = bomb.clone().add(v3(0, 0.13, 0)).addScaledVector(side, -0.04).addScaledVector(facing, -0.02);
        pR = rot([0, -1, 1]); pL = rot([0, -1, -1]);
      } else {
        things.push({ kind: 'bomb', m: chain(U, T(0.19, 0.78, 0.02), RZ(-0.5)) });
        hR = v3(0.16, 0.86, 0.1).applyMatrix4(U); hL = v3(0.17, 0.92, -0.06).applyMatrix4(U);
        pR = rot([-0.5, -1, 0.6]); pL = rot([-0.5, -1, -0.6]);
      }
    }
  } else if (s.carry && s.down) {
    // set down on the ground beside him
    const g = (prone ? v3(0.45, 0, 0.32) : v3(0.25, 0, 0.23)).applyMatrix4(M0), m = chain(M0.clone().setPosition(g), RY(prone ? 0.3 : 0.6));
    const lift = { can: T(0, 0.155, 0), round: chain(T(0, 0.03, 0), RY(0.4)), clip: chain(T(0, 0.075, 0), RZ(Math.PI / 2)), bomb: chain(T(0, 0.032, 0), RZ(Math.PI / 2)), binos: T(0, 0.02, 0) }[s.carry];
    things.push({ kind: s.carry, m: chain(m, lift) });
    if (!s.hands) {
      if (prone) { hR = v3(0.36, 0.06, 0.24).applyMatrix4(M0); hL = v3(0.38, 0.06, -0.16).applyMatrix4(M0); pR = V([0, -1, 0.5]); pL = V([0, -1, -0.5]); }
      else { hR = g.clone().add(v3(0, 0.17, 0)); pR = rot([-0.5, -0.4, 1]); }
    }
  }
  if (s.point) { hR = v3(0.5, 1.12, 0.22).applyMatrix4(U); pR = rot([0, -1, 0.5]); hL = legs[0].knee.clone().add(v3(0, 0.06, 0)); pL = rot([-0.3, -0.3, -1]); }
  if (!hR) {
    if (prone) { hR = v3(0.3, 0.05, 0.14).applyMatrix4(M0); pR = V([0, -1, 0.5]); }
    else if (s.stance === 'run') { hR = v3(phase === null ? -0.14 : -0.05 - 0.16 * Math.sin(phase * Math.PI * 2), 0.78, 0.2).applyMatrix4(U); pR = rot([-1, 0, 0.3]); }
    else { hR = v3(0.02, 0.64, 0.21).applyMatrix4(body.on(0.64)); pR = rot([-1, 0, 0.3]); }
  }
  if (!hL) {
    if (prone) { hL = v3(0.32, 0.05, -0.16).applyMatrix4(M0); pL = V([0, -1, -0.5]); }
    else if (s.stance === 'run') { hL = v3(phase === null ? 0.2 : 0.05 + 0.16 * Math.sin(phase * Math.PI * 2), 0.84, -0.17).applyMatrix4(U); pL = rot([-1, -0.3, -0.3]); }
    else { hL = v3(0.02, 0.64, -0.21).applyMatrix4(body.on(0.64)); pL = rot([-1, 0, -0.3]); }
  }
  // the MG belt from the can to the feed (or folded on the can)
  if (s.belt) {
    const can = things.find((t) => t.kind === 'can'), from = v3(0, -0.02, 0).applyMatrix4(can.m);
    const to = s.belt === 'feed' ? hL.clone() : from.clone().add(v3(0.01, 0.005, 0));
    things.push({ kind: 'belt', m: basis(from, to.clone().sub(from), v3(0, 1, 0)).multiply(SC(Math.max(0.01, from.distanceTo(to)), 1, 1)) });
  }
  if (s.fallen) {
    // one hand by the helmet, the other flung out along the ground. Reach is the real arm, so the elbow does not stretch.
    const reach = UPPER + FORE + FIST - 0.05, sho = (side) => v3(SHO[0], SHO[1], side * SHO[2]).applyMatrix4(U);
    const put = (at, dir) => { const d = V(dir); if (d.length() > reach) d.setLength(reach); return at.clone().add(d); };
    hL = put(sho(-1), [0.16, 0.06, -0.28]);
    hR = put(sho(1), [0.1, 0.05, 0.38]);
    pL = V([0.2, -0.2, -1]); pR = V([0.15, -0.2, 1]);
  }
  const arms = [arm(body, -1, hL, pL), arm(body, 1, hR, pR)];
  return { s, body, legs, arms, H, W, info, sling, things, M0 };
}

// ---------------------------------------------------------------- the near figure

// head rows in its own frame: [height, front, back, half width]; columns around from the face toward the left
const HEAD_ROWS = [[-0.09, 0.035, 0.04, 0.035], [-0.072, 0.068, 0.05, 0.052], [-0.045, 0.076, 0.066, 0.058], [-0.018, 0.076, 0.076, 0.061],
  [0.005, 0.074, 0.08, 0.062], [0.03, 0.076, 0.08, 0.062], [0.083, 0.038, 0.045, 0.034]];
const HEAD_COLS = [0, 28, 75, 130, 180, -130, -75, -28].map((d) => (d * Math.PI) / 180);
function headGeo(hair, brim) {
  // face relief by (row, column angle): nose, its bridge, eye sockets, brow, mouth, chin, jaw, ears
  const bump = (i, c) => {
    if (i === 3) return c === 0 ? 0.028 : c === 28 ? 0.004 : c === 75 ? 0.01 : 0;
    if (i === 4) return c === 0 ? 0.008 : c === 28 ? -0.012 : c === 75 ? 0.01 : 0;
    if (i === 5 && c < 30) return 0.007;
    if (i === 2 && c === 0) return -0.004;
    if (i === 1) return c === 0 ? 0.012 : c === 28 ? 0.004 : 0;
    return 0;
  };
  const deg = (j) => Math.round(Math.abs(HEAD_COLS[j]) * (180 / Math.PI));
  const rows = HEAD_ROWS.map(([y, f, b, w], i) => HEAD_COLS.map((a, j) => {
    const c = Math.cos(a), s = Math.sin(a), r = bump(i, deg(j));
    return v3(sp(c, 0.8) * (c >= 0 ? f : b) + c * r, y, -sp(s, 0.8) * w - s * r);
  }));
  const skin = new THREE.Color(SKIN), hairC = new THREE.Color(HAIR);
  const color = (i, j) => {
    const c = deg(j);
    if (hair && ((c >= 130 && i >= 2) || (c >= 75 && i >= 5) || i >= 6)) return hairC;
    // shading baked in: deep eye sockets, the mouth line, the jaw and chin underside; under a helmet the brim
    // shades the brow and eyes (the soldiers cast no shadows of their own)
    const front = c <= 75, k = i === 0 ? 0.58
      : i === 1 ? (c <= 28 ? 0.84 : 0.78)
      : i === 2 ? (c === 0 ? 0.68 : c === 28 ? 0.9 : 1)
      : i === 3 ? (c === 0 ? 1.04 : c === 28 ? 0.9 : 1)
      : i === 4 ? (c === 0 ? (brim ? 0.66 : 0.9) : c === 28 ? (brim ? 0.38 : 0.5) : front ? 0.82 : 1)
      : i === 5 && front ? (brim ? 0.5 : 1.02) : 1;
    return skin.clone().multiplyScalar(k);
  };
  return gridGeo(rows, { color, top: { p: v3(-0.004, 0.093, 0), c: hair ? hairC : skin } });
}
const HELMETS = {
  m1: { color: 0x4f5536, sx: 0.112, sz: 0.097, rings: [[1.03, -0.004], [1.0, 0.012], [0.96, 0.045], [0.84, 0.085], [0.55, 0.112]], apex: 0.122, side: 0.024, back: 0.012, y: 0.014, tilt: 0.1 },
  stahlhelm: { color: 0x4f5650, sx: 0.102, sz: 0.091, rings: [[0, -0.03], [1.08, 0], [1.02, 0.02], [0.99, 0.055], [0.86, 0.095], [0.55, 0.125]], apex: 0.135, side: 0.035, back: 0.045, y: 0.018, tilt: 0.08 },
  ssh40: { color: 0x47502f, sx: 0.104, sz: 0.092, rings: [[1.04, -0.004], [1.0, 0.01], [0.97, 0.05], [0.86, 0.095], [0.56, 0.125]], apex: 0.135, side: 0.012, back: 0.012, y: 0.006, tilt: 0.06 },
  brodie: { color: 0x5a593d, sx: 0.098, sz: 0.089, rings: [[1.6, 0.03], [1.62, 0.04], [1.0, 0.052], [0.93, 0.084], [0.66, 0.11]], apex: 0.122, side: 0, back: 0, y: 0, tilt: 0.05,
    lip: 0.62, lipY: 0, far: [[1.58, 0.035], [0.97, 0.06], [0.6, 0.108]] },
  hood: { color: 0x6b6e4a, sx: 0.092, sz: 0.078, rings: [[1.02, -0.02], [1.0, 0.0], [0.98, 0.04], [0.85, 0.08], [0.5, 0.105]], apex: 0.112, side: 0.07, back: 0.1, y: 0.0, tilt: 0.12 },
};
// A helmet shell in the head's frame: rings from a rolled lip under the rim up to the crown, the rim dropping at
// the sides (side) and back (back); the Stahlhelm's rim (scale 0) flares out at the sides and back. The Brodie's lip
// (lip, lipY) runs in under its flat brim to the bowl.
function helmetGeo(kind, segs, color) {
  const H = HELMETS[kind];
  const ring = ([s, y], i) => Array.from({ length: segs }, (_, j) => {
    const a = (j / segs) * TAU, c = Math.cos(a), sn = Math.sin(a), sc = s || 1.08 + 0.14 * (1 - Math.max(0, c) ** 2);
    const d = (i <= 1 ? 1 : i === 2 ? 0.4 : 0) * (H.side * sn * sn + H.back * Math.max(0, -c) ** 2);
    return v3(c * H.sx * sc, y - d, -sn * H.sz * sc);
  });
  const rings = H.rings.map(ring), lip = H.lip ?? 0.9, rows = [rings[0].map((p) => v3(p.x * lip, p.y + (H.lipY ?? 0.012), p.z * lip)), ...rings];
  return gridGeo(rows, { color: (i, j) => color(i, j, rows[i][j]).multiplyScalar(i === 0 ? 0.5 : 1), top: { p: v3(0, H.apex, 0), c: color(rows.length, 0, v3(0, H.apex, 0)) } });
}
// the Soviet pilotka: a folded side cap, a band around the head and a ridge along the top
function pilotkaGeo() {
  const n = 8, a = (j) => (j / n) * TAU, ring = (y, dy, x, z) => Array.from({ length: n }, (_, j) => v3(Math.cos(a(j)) * x, y - dy * Math.abs(Math.cos(a(j))), -Math.sin(a(j)) * z));
  // the turned-up flap around the head, the crown over it, the folded ridge on top
  const rows = [ring(0.028, -0.006, 0.086, 0.071), ring(0.068, 0, 0.085, 0.054), ring(0.112, 0.014, 0.08, 0.01)];
  return gridGeo(rows, { color: (i) => (i ? WHITE : shade(0xffffff, 0.8)) });
}
// the commando's green beret in the head's frame: the leather band low at the back, the crown pulled down over the
// right ear, the badge over the left eye
const BERET = 0x34502f;
function beretGeo() {
  const n = 10, ring = (r, z, y, dy, cx, cz, tilt) => Array.from({ length: n }, (_, j) => {
    const a = (j / n) * TAU, c = Math.cos(a), s = Math.sin(a);
    return v3(cx + c * r, y + dy * c + tilt * s, cz - s * z);
  });
  const rows = [ring(0.077, 0.064, 0.033, 0.017, -0.004, 0, 0), ring(0.078, 0.065, 0.045, 0.017, -0.004, 0, 0), ring(0.094, 0.086, 0.088, 0, -0.008, 0.024, 0.018), ring(0.06, 0.055, 0.114, 0, -0.012, 0.022, 0.01)];
  const band = new THREE.Color(0x2b2419), wool = new THREE.Color(BERET);
  return gridGeo(rows, { color: (i) => (i < 2 ? band : wool), top: { p: v3(-0.012, 0.12, 0.018), c: shade(BERET, 1.08) } });
}
// a band around the torso from y0 to y1 (the belt)
function band(body, y0, y1, out, cols = 10) {
  return gridGeo([y0, y1].map((y) => Array.from({ length: cols }, (_, j) => body.at(torsoAt(y, (j / cols) * TAU, out)))));
}
// a strap lying on the torso along path [[y, a], ...], w wide
function strap(body, path, w, out = 0.008) {
  const pts = path.map(([y, a]) => torsoAt(y, a, out));
  const rows = pts.map((p, i) => {
    const t = pts[Math.min(i + 1, pts.length - 1)].clone().sub(pts[Math.max(i - 1, 0)]).normalize();
    const n = v3(p.x, Math.max(0, p.y - 1.04) * 3, p.z).normalize(), side = t.clone().cross(n).normalize().multiplyScalar(w / 2);
    return [p.clone().sub(side), p.clone().add(side)].map((q) => body.at(q));
  });
  return gridGeo(rows, { open: true });
}
const onTorso = (body, y, a, out = 0) => chain(body.on(y), T(torsoAt(y, a, out)), RY(a));

// Cloth panels follow the bent torso rather than sitting on it as rigid boxes.
function clothPanel(body, points, out = 0.008) {
  const g = new THREE.BufferGeometry(), canonical = points.map(([y, a]) => torsoAt(y, a, out)), p = canonical.map(v => body.at(v));
  const normal = canonical[2].clone().sub(canonical[0]).cross(canonical[1].clone().sub(canonical[0]));
  const outward = v3(canonical[0].x, 0, canonical[0].z), flip = normal.dot(outward) < 0;
  g.setAttribute('position', new THREE.Float32BufferAttribute(p.flatMap(v => v.toArray()), 3));
  g.setIndex(Array.from({ length: p.length - 2 }, (_, i) => flip ? [0, i + 1, i + 2] : [0, i + 2, i + 1]).flat());
  g.computeVertexNormals();
  return g;
}
// A soft bag with a tapered bottom, folded flap and fastening strap. +x is its outer face.
function bagGeo(depth, height, width, color, { pouch = false, mat = 'canvas' } = {}) {
  const body = box(depth, height, width), p = body.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), top = y > 0;
    p.setXYZ(i, p.getX(i) * (top ? 0.82 : 0.92), y, p.getZ(i) * (top ? 0.94 : 0.86));
  }
  body.computeVertexNormals();
  const face = new THREE.BufferGeometry(), x = depth / 2 + 0.001;
  face.setAttribute('position', new THREE.Float32BufferAttribute([
    x * 0.82, height * 0.5, -width * 0.47, x * 0.82, height * 0.5, width * 0.47,
    x, height * 0.28, -width * 0.46, x, height * 0.28, width * 0.46,
    x + 0.001, height * (pouch ? 0.03 : -0.05), -width * 0.36,
    x + 0.001, height * (pouch ? 0.03 : -0.05), width * 0.36,
  ], 3));
  face.setIndex([0, 3, 2, 0, 1, 3, 2, 5, 4, 2, 3, 5]);
  face.computeVertexNormals();
  const parts = [{ geo: body, color, mat }, { geo: face, color: shade(color, 1.09), mat }];
  if (!pouch) {
    const clasp = new THREE.PlaneGeometry(height * 0.35, width * 0.09);
    parts.push({ geo: clasp, color: shade(color, 0.6), m: chain(T(x + 0.003, -height * 0.1, 0), RY(Math.PI / 2), RZ(Math.PI / 2)), mat });
  }
  return merge(parts);
}

function nearParts(r, ctx) {
  const { F, job, fac, type } = ctx, P = [], b = r.body, add = (geo, color, m, mat) => P.push({ geo, color: color ?? 0xffffff, m: m ?? new THREE.Matrix4(), mat });
  const sniper = job === 'sniper' || (type === 'sniper' && job === 'spotter');
  // torso: the tunic down over the hips, the hem a shade darker
  const cols = 8, torso = gridGeo(TORSO.filter((_, i) => i !== 5).map(([y]) => Array.from({ length: cols }, (_, j) => b.at(torsoAt(y, (j / cols) * TAU)))), {
    color: (i) => shade(fac === 3 && i < 2 ? F.legs : F.tunic, i === 0 ? 0.9 : 1), bottom: { p: b.at(v3(0, 0.6, 0)), c: shade(fac === 3 ? F.legs : F.tunic, 0.8) } });
  add(sniper && fac ? camoFaces(torso, CAMO[fac], 14) : torso, null, null, 'wool');
  // Turned collar leaves or the gymnastyorka's stand collar, a closure and fitted pocket flaps.
  const cloth = shade(F.tunic, sniper && fac ? 0.9 : 1.08);
  for (const side of [-1, 1]) {
    if (fac !== 2) add(clothPanel(b, [[1.18, side * 0.2], [1.15, side * 0.82], [1.105, side * 0.35]]), cloth, null, 'wool');
    add(clothPanel(b, [[1.075, side * 0.22], [1.075, side * 0.68], [0.995, side * 0.65], [0.995, side * 0.2]]), shade(F.tunic, 0.92), null, 'wool');
    add(clothPanel(b, [[1.078, side * 0.2], [1.078, side * 0.7], [1.049, side * 0.65], [1.049, side * 0.22]], 0.013), cloth, null, 'wool');
  }
  if (fac === 2) add(band(b, 1.164, 1.19, 0.005, 8), cloth, null, 'wool');
  const closureTop = fac === 2 ? 1.165 : 1.11, closureBottom = fac === 2 ? 1.025 : 0.83;
  add(clothPanel(b, [[closureTop, -0.055], [closureTop, 0.055], [closureBottom, 0.055], [closureBottom, -0.055]], 0.01), shade(F.tunic, 0.83), null, 'wool');
  // belt and webbing
  add(band(b, 0.775, 0.825, 0.009), F.web, null, F.webMat);
  if (fac === 0) for (const s of [1, -1]) add(strap(b, [[0.82, 0.42 * s], [0.95, 0.4 * s], [1.05, 0.45 * s], [1.115, 0.75 * s], [1.15, 1.4 * s], [1.1, 2.2 * s], [1.0, 2.6 * s], [0.82, 2.72 * s]], 0.046), F.web, null, F.webMat);
  if (fac === 1) for (const s of [1, -1]) add(strap(b, [[0.82, 0.5 * s], [0.96, 0.42 * s], [1.06, 0.45 * s], [1.12, 0.8 * s], [1.15, 1.4 * s], [1.1, 2.4 * s], [1.0, 2.95 * s]], 0.042), F.web, null, F.webMat);
  // pouches on the belt front, then each faction's bags
  const crew = !['rifle', 'leader', 'smg', 'sniper', 'engineer', 'bazooka', 'bren', 'tommy'].includes(job.replace(/[BC]$/, ''));
  if (fac !== 3) for (const s of [1, -1]) add(bagGeo(0.045, 0.075, fac === 1 ? 0.12 : 0.11, fac === 1 ? 0x2a2724 : F.web, { pouch: true, mat: F.webMat }), null, onTorso(b, 0.805, 0.5 * s, 0.03), F.webMat);
  add(box(0.014, 0.036, 0.05), fac === 1 ? 0x686862 : 0x9a9275, onTorso(b, 0.8, 0, 0.024), 'gunmetal');
  if (fac === 0) {
    add(new THREE.CylinderGeometry(0.034, 0.034, 0.1, 6), 0x5d6147, chain(onTorso(b, 0.74, -2.1, 0.03), SC(0.65, 1, 1)), 'canvas'); // canteen
    if (!crew && !job.startsWith('engineer')) add(bagGeo(0.075, 0.18, 0.18, F.bag), null, onTorso(b, 0.97, Math.PI, 0.026), 'canvas'); // haversack
  } else if (fac === 1) {
    add(bagGeo(0.065, 0.12, 0.15, F.bag), null, onTorso(b, 0.73, -2.2, 0.026), 'canvas'); // bread bag
    if (job !== 'flamer') add(new THREE.CylinderGeometry(0.038, 0.038, 0.22, 6), 0x4f5549, chain(onTorso(b, 0.84, -2.75, 0.045), RX(-0.35)), 'armor-paint'); // gas mask can (the flamer's tanks are there)
    add(box(0.024, 0.16, 0.075), 0x4a4236, onTorso(b, 0.72, 2.3, 0.02), 'wood'); // entrenching tool
  } else if (fac === 3) {
    // '37 pattern: the braces from the basic pouches over the shoulders, crossed on the back under the small pack
    for (const s of [1, -1]) add(strap(b, [[0.98, 0.42 * s], [1.07, 0.5 * s], [1.13, 0.8 * s], [1.15, 1.4 * s], [1.1, 2.2 * s], [0.98, 2.85 * s], [0.86, 3.45 * s], [0.81, 3.7 * s]], 0.04), F.web, null, F.webMat);
    for (const s of [1, -1]) add(bagGeo(0.064, 0.13, 0.105, F.web, { pouch: true }), null, onTorso(b, 0.955, 0.42 * s, 0.034), F.webMat); // basic pouches, high on the chest
    add(new THREE.CylinderGeometry(0.036, 0.036, 0.12, 5), 0x5e5a44, chain(onTorso(b, 0.73, -2.25, 0.034), SC(0.7, 1, 1)), 'canvas'); // water bottle in its carrier
    add(box(0.03, 0.12, 0.11), F.web, onTorso(b, 0.73, Math.PI, 0.026), F.webMat); // entrenching tool carrier
    if (!crew && !job.startsWith('engineer')) add(bagGeo(0.08, 0.17, 0.2, F.bag), null, onTorso(b, 1.0, Math.PI, 0.03), 'canvas'); // small pack
    if (type === 'commando') {
      // the toggle rope coiled over the left shoulder to the right hip
      const loop = [[1.14, 1.5], [1.01, 0.6], [0.88, -0.35], [0.82, -1.3], [0.97, -2.6], [1.14, 2.35]].map(([y, a]) => b.at(torsoAt(y, a, 0.045)));
      const rows = tubeRows([loop.at(-1), ...loop, loop[0]], Array(loop.length + 2).fill(0.02), 3, v3(0, 1, 0)).slice(1, loop.length + 1);
      add(gridGeo([...rows, rows[0]], { color: (i, j) => shade(0xc2b58c, j % 2 ? 0.85 : 1) }), null, null, 'canvas');
    }
  } else {
    if (!crew && type !== 'conscript' && type !== 'engineer') add(bagGeo(0.06, 0.14, 0.16, F.bag), null, onTorso(b, 0.94, Math.PI, 0.03), 'canvas'); // veshmeshok
    if (job.startsWith('rifle') || job === 'leader' || job.startsWith('engineer')) {
      // the rolled greatcoat over the left shoulder to the right hip
      const loop = [[1.13, 1.45], [1.0, 0.55], [0.86, -0.4], [0.8, -1.3], [0.96, -2.65], [1.13, 2.3]].map(([y, a]) => b.at(torsoAt(y, a, 0.026)));
      const rows = tubeRows([loop.at(-1), ...loop, loop[0]], Array(loop.length + 2).fill(0.055), 6, v3(0, 1, 0)).slice(1, loop.length + 1);
      add(gridGeo([...rows, rows[0]], { color: (i, j) => shade(F.roll, i === 1 || i === 4 ? 0.62 : j % 2 ? 0.9 : 1) }), null, null, 'wool');
    }
  }
  if (job === 'flamer') {
    // the tanks on his back, and the hose from under them round his right hip to the gun
    const back = (y, dz, out) => chain(onTorso(b, y, Math.PI, out), T(0, 0, dz));
    if (fac === 2) {
      // ROKS-2: the flat box tank in a canvas cover, worn like a pack, the pressure cylinder under it
      add(box(0.11, 0.34, 0.3), 0x5f5a42, back(0.9, 0, 0.065), 'canvas');
      for (const y of [0.8, 1.0]) add(box(0.116, 0.025, 0.31), 0x4a4434, back(y, 0, 0.065), 'leather');
      add(new THREE.CylinderGeometry(0.03, 0.03, 0.22, 6), STEEL, chain(back(0.7, 0, 0.1), RX(Math.PI / 2)), 'gunmetal');
    } else if (fac === 1) {
      // Flammenwerfer 41: the fuel tank and the smaller nitrogen tank side by side on a frame
      add(new THREE.CylinderGeometry(0.07, 0.07, 0.38, 6), 0x4f5446, back(0.9, 0.075, 0.08), 'armor-paint');
      add(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 6), 0x5c6152, back(0.93, -0.09, 0.06), 'armor-paint');
      for (const y of [0.74, 1.06]) add(box(0.03, 0.035, 0.32), STEEL, back(y, 0, 0.03), 'gunmetal');
    } else {
      // M2-2: two fuel tanks with the pressure tank between and behind them, the valve on top
      for (const dz of [-0.075, 0.075]) add(new THREE.CylinderGeometry(0.066, 0.066, 0.44, 6), 0x4a5032, back(0.9, dz, 0.075), 'armor-paint');
      add(new THREE.CylinderGeometry(0.045, 0.045, 0.24, 5), 0x5a6040, back(0.92, 0, 0.17), 'armor-paint');
      add(box(0.05, 0.04, 0.06), STEEL, back(1.14, 0, 0.1), 'gunmetal');
    }
    if (r.W) {
      const from = v3(0, -0.22, 0).applyMatrix4(back(0.9, 0.05, 0.08)), hip = b.at(torsoAt(0.68, -1.7, 0.08)), to = v3(0, 0, 0).applyMatrix4(r.W);
      add(tube([from, hip, to], [0.016, 0.016, 0.016], 5, v3(0, 1, 0)), 0x2a2724, null, 'rubber');
    }
  }
  if (job.startsWith('engineer')) {
    if (fac === 1) {
      add(bagGeo(0.08, 0.14, 0.18, 0x5a5440), null, onTorso(b, 0.76, 1.9, 0.03), 'canvas'); // satchel charge
      add(new THREE.CylinderGeometry(0.012, 0.012, 0.26, 4, 1, true), 0x6b5236, chain(onTorso(b, 0.84, 0.9, 0.02), RX(0.5)), 'wood'); // stick grenade
      add(new THREE.CylinderGeometry(0.03, 0.03, 0.07, 4), 0x4f5549, chain(onTorso(b, 0.84, 0.9, 0.02), RX(0.5), T(0, 0.15, 0)), 'armor-paint');
    } else {
      add(bagGeo(0.07, 0.2, 0.18, F.bag), null, onTorso(b, 0.96, Math.PI, 0.03), 'canvas'); // pack
      add(box(0.012, 0.15, 0.13), 0x3b3a34, onTorso(b, 0.86, Math.PI, 0.075), 'gunmetal'); // shovel blade
      add(new THREE.CylinderGeometry(0.012, 0.012, 0.3, 4, 1, true), F.wood, onTorso(b, 1.1, Math.PI, 0.075), 'wood'); // handle
    }
  }
  // head, then the helmet or cap
  const H = r.H, cap = type === 'conscript' && job !== 'leader', beret = type === 'commando';
  add(headGeo(cap || beret || (sniper && fac === 2), !cap && !beret), null, chain(H, SC(0.93, 1, 0.93)), 'plain');
  for (const side of [-1, 1]) add(new THREE.PlaneGeometry(0.019, 0.006), 0x493b32, chain(H, T(0.063, 0.005, side * 0.034), RY(side * 0.5 + Math.PI / 2)), 'plain');
  add(new THREE.PlaneGeometry(0.024, 0.004), 0x78564b, chain(H, T(0.071, -0.044, 0), RY(Math.PI / 2)), 'plain');
  if (cap) add(pilotkaGeo(), 0x77714f, chain(H, T(0.004, 0, 0), RX(0.15)), 'wool');
  else if (beret) {
    add(beretGeo(), null, H, 'wool');
    add(box(0.008, 0.024, 0.02), 0xb9b2a0, chain(H, T(0.074, 0.062, -0.031), RY(0.42)), 'gunmetal'); // cap badge
  } else {
    const kind = sniper && fac === 2 ? 'hood' : F.helmet, Hd = HELMETS[kind];
    const net = fac === 0 || fac === 3 ? (i, j, p) => shade(Hd.color, 0.82 + 0.18 * hash(p.x * 40, p.y * 40, p.z * 40)) : (i, j, p) => shade(Hd.color, 0.93 + 0.07 * hash(p.x * 30, p.y * 30, p.z * 30));
    let g = helmetGeo(kind, 8, net);
    if (sniper && fac) g = camoFaces(g, CAMO[fac], 30);
    add(g, null, chain(H, T(0, Hd.y, 0), RZ(Hd.tilt)), kind === 'hood' ? 'wool' : 'armor-paint');
  }
  if (!cap && !beret && !(sniper && fac === 2)) {
    // Two narrow ribbons from the helmet sides to the chin. They share the soldier mesh.
    const strapRows = [[-0.005, -0.01, 0.069], [0.042, -0.072, 0.043]].map(([x, y, z]) => [v3(x - 0.006, y, z), v3(x + 0.006, y, z)]);
    for (const side of [-1, 1]) {
      const rows = strapRows.map(row => row.map(p => v3(p.x, p.y, p.z * side)));
      if (side === 1) rows.forEach(row => row.reverse());
      add(gridGeo(rows, { open: true }), F.web, H, F.webMat);
    }
  }
  // legs: trousers, then the boots or leggings or puttees, then the boot itself
  for (const L of r.legs) {
    const thigh = L.knee.clone().sub(L.hip).normalize(), shin = L.ankle.clone().sub(L.knee).normalize(), edge = L.ankle.clone().lerp(L.knee, F.wrapUp);
    add(tube([L.hip.clone().addScaledVector(thigh, -0.05), L.knee, edge],
      [0.09, 0.064, 0.054], 6, L.pole), F.legs, null, 'wool');
    const wrap = F.wrap ?? F.boots, n = fac === 2 ? 4 : 3, top = fac === 1 ? 0.07 : fac === 2 ? 0.062 : 0.066;
    add(tube(Array.from({ length: n }, (_, i) => edge.clone().lerp(L.ankle, i / (n - 1))), Array.from({ length: n }, (_, i) => top + (0.052 - top) * (i / (n - 1))), 6, L.pole,
      { color: (i) => shade(wrap, (fac === 2 || fac === 3) && i % 2 ? 0.86 : 1) }), null, null, F.wrapMat);
    if (fac === 3 && L === r.legs[0]) {
      // the battledress map pocket on the front of the left thigh
      const out = r.legs[0].hip.clone().sub(r.legs[1].hip).normalize(), front = L.pole.clone().addScaledVector(thigh, -L.pole.dot(thigh)).normalize();
      add(box(0.15, 0.014, 0.1), shade(F.legs, 1.05), basis(L.hip.clone().lerp(L.knee, 0.5).addScaledVector(front.addScaledVector(out, 0.4).normalize(), 0.07), thigh, front), 'wool');
    }
    add(extrudeProfile([[-0.05, -0.062], [0.17, -0.062], [0.178, -0.035], [0.09, -0.012], [0.03, 0.03], [-0.055, 0.03]], 0.078), F.boots, basis(L.ankle, L.toe, L.knee.clone().sub(L.ankle)), 'leather');
  }
  // arms: sleeves, the owner's band on the left upper arm, fists
  r.arms.forEach((a, side) => {
    const upper = a.elbow.clone().sub(a.sho).normalize(), fore = a.hand.clone().sub(a.elbow).normalize(), wrist = a.hand.clone().addScaledVector(fore, -FIST);
    const pole = a.elbow.clone().sub(a.sho.clone().lerp(a.hand, 0.5));
    add(tube([a.sho.clone().addScaledVector(upper, -0.02), a.elbow, a.elbow.clone().addScaledVector(fore, 0.12), wrist.clone().addScaledVector(fore, -0.022), wrist],
      [0.054, 0.045, 0.042, 0.036, 0.03], 6, pole, { color: (i) => shade(F.tunic, i === 4 ? 0.72 : i === 3 ? 0.9 : 1) }), null, null, 'wool');
    if (side === 0) add(tube([0.36, 0.56].map((t) => a.sho.clone().lerp(a.elbow, t)), [0.053, 0.05], 6, pole), ctx.owner, null, 'canvas');
    add(extrudeProfile([[-0.04, -0.018], [0.018, -0.026], [0.036, -0.002], [0.02, 0.024], [-0.04, 0.018]], 0.04), shade(SKIN, 0.9), basis(a.hand, fore, pole), 'plain');
  });
  // the weapon in the hands or on the back, then what he carries
  if (r.W) for (const p of r.info.parts) add(p.geo, p.color, r.W.clone().multiply(p.m), p.mat);
  if (r.sling) for (const p of weapon('carbine', F, 2).parts) add(p.geo, p.color, r.sling.clone().multiply(p.m), p.mat);
  for (const t of r.things) for (const p of item(t.kind, F, false)) add(p.geo, p.color, t.m.clone().multiply(p.m), p.mat);
  return P;
}

// ---------------------------------------------------------------- the far figure

function farParts(r, ctx) {
  const { F } = ctx, P = [], b = r.body, add = (geo, color, m, mat) => P.push({ geo, color: color ?? 0xffffff, m: m ?? new THREE.Matrix4(), mat });
  add(gridGeo([0.62, 0.92, 1.12].map((y) => Array.from({ length: 5 }, (_, j) => b.at(torsoAt(y, (j / 5) * TAU + 0.3)))), { top: { p: b.at(v3(0, 1.19, 0)) } }), F.tunic, null, 'wool');
  const head = gridGeo([-0.035, 0.035].map(y => Array.from({ length: 6 }, (_, j) => v3(Math.cos((j / 6) * TAU) * 0.075, y, -Math.sin((j / 6) * TAU) * 0.062))), { top: { p: v3(0, 0.09, 0) }, bottom: { p: v3(0.01, -0.09, 0) } });
  add(head, SKIN, r.H, 'plain');
  const cap = ctx.type === 'conscript' && ctx.job !== 'leader', beret = ctx.type === 'commando', Hd = HELMETS[F.helmet];
  const shell = gridGeo((Hd.far ?? [[1.05, 0], [0.8, 0.08], [0.48, Hd.apex * 0.88]]).map(([s, y]) => Array.from({ length: 6 }, (_, j) => v3(Math.cos((j / 6) * TAU) * Hd.sx * s, y, -Math.sin((j / 6) * TAU) * Hd.sz * s))), { top: { p: v3(0, Hd.apex, 0) } });
  if (beret) add(head, BERET, chain(r.H, T(-0.006, 0.062, 0.016), SC(1.12, 0.5, 1.2)), 'wool'); // the beret, pulled to the right
  else add(cap ? head : shell, cap ? 0x7a7456 : Hd.color, chain(r.H, cap ? T(0, 0.03, 0) : T(0, Hd.y, 0), cap ? SC(0.9, 0.5, 0.9) : RZ(Hd.tilt)), cap ? 'wool' : 'armor-paint');
  for (const L of r.legs) add(tube([L.hip, L.knee, L.ankle.clone().add(L.toe.clone().multiplyScalar(0.05))], [0.075, 0.055, 0.045], 3, L.pole, { color: (i) => new THREE.Color(i === 2 ? F.boots : F.legs) }), null, null, 'wool');
  r.arms.forEach((a, side) => {
    const own = new THREE.Color(F.tunic).lerp(new THREE.Color(ctx.owner), 0.4);
    add(tube([a.sho, a.elbow, a.hand], [0.045, 0.04, 0.03], 3, a.elbow.clone().sub(a.sho.clone().lerp(a.hand, 0.5)), { color: (i) => (i === 2 ? new THREE.Color(SKIN) : side === 0 && i === 0 ? own : new THREE.Color(F.tunic)) }), null, null, 'wool');
  });
  if (r.W) for (const p of weapon(r.s.gun.kind, F, 1).parts) add(p.geo, p.color, r.W.clone().multiply(p.m), p.mat);
  else if (r.sling) for (const p of weapon('carbine', F, 1).parts) add(p.geo, p.color, r.sling.clone().multiply(p.m), p.mat);
  const t = r.things.find((x) => x.kind !== 'belt' && x.kind !== 'binos');
  if (t) for (const p of item(t.kind, F, true)) add(p.geo, p.color, t.m.clone().multiply(p.m), p.mat);
  else if (ctx.job === 'flamer') add(box(0.12, 0.4, 0.26), F.flamer === 'roks2' ? 0x5f5a42 : 0x4d5240, onTorso(b, 0.9, Math.PI, 0.06), 'armor-paint'); // the tanks
  else add(box(0.06, 0.16, 0.16), F.bag, onTorso(b, 0.95, Math.PI, 0.03), 'canvas');
  return P;
}

// ---------------------------------------------------------------- building

// darker low down and under overhangs, a touch lighter on faces that look up: from the standing build only
const shadeFalloff = (p, n) => (0.85 + 0.15 * smooth(p.y / 0.5)) * (1 + 0.1 * Math.max(0, n.y)) * (1 - 0.18 * Math.max(0, -n.y));
// One soldier: the four posture builds merged with the same parts in the same order; the standing one is the
// geometry and the others ride in userData.poses ({position, normal} per posture 1 to 3).
function figure(ctx, far) {
  const muzzle = (r) => r.W ? v3(r.info.L, 0, 0).applyMatrix4(r.W) : null;
  const rigs = [0, 1, 2, 3].map((k) => solve(ctx, k));
  const geos = rigs.map((r) => merge(far ? farParts(r, ctx) : nearParts(r, ctx)));
  const n = geos[0].attributes.position.count;
  geos.forEach((g, k) => { if (g.attributes.position.count !== n) throw new Error(`${ctx.type} ${ctx.job}: posture ${k} has ${g.attributes.position.count} vertices, not ${n}`); });
  const body = ao(geos[0], { falloff: shadeFalloff });
  body.userData.muzzle = muzzle(rigs[0]);
  body.userData.poses = geos.slice(1).map((g, i) => ({ position: g.attributes.position, normal: g.attributes.normal, muzzle: muzzle(rigs[i + 1]) }));
  const fallenRig = solve(ctx, 'fallen'), fallenGeo = merge(far ? farParts(fallenRig, ctx) : nearParts(fallenRig, ctx));
  if (fallenGeo.attributes.position.count !== n) throw new Error(`${ctx.type} ${ctx.job}: fallen pose has ${fallenGeo.attributes.position.count} vertices, not ${n}`);
  body.userData.fallen = { position: fallenGeo.attributes.position, normal: fallenGeo.attributes.normal };
  body.userData.gait = [[3, 8], [0, 4], [1, 4], [2, 4]].flatMap(([posture, count]) => Array.from({ length: count }, (_, i) => {
    const r = solve(ctx, posture, i / count), g = merge(far ? farParts(r, ctx) : nearParts(r, ctx));
    if (g.attributes.position.count !== n) throw new Error(`${ctx.type} ${ctx.job}: gait changed topology`);
    return { position: g.attributes.position, normal: g.attributes.normal, posture, muzzle: muzzle(r) };
  }));
  return body;
}
// for the check script: the solved rig of a soldier in posture k
export function rigOf(type, fac, i, k, phase = null) { const job = soldierKit(type, i, fac); return solve({ type, fac, job, F: FACTIONS[fac] ?? FACTIONS[0], owner: 0x3b73d6 }, k, phase); }

const bodies = new Map();
// One soldier of a squad, near and far: each a group holding one vertex-colored body for unit-models.js to bake.
export function soldier(type, fac, i, f) {
  const kit = soldierKit(type, i, fac), F = FACTIONS[fac] ?? { ...FACTIONS[0], tunic: f.uniform };
  const group = (far) => {
    const key = `${type}|${fac}|${f.color}|${kit}|${far}`;
    if (!bodies.has(key)) bodies.set(key, figure({ type, fac, job: kit, F, owner: f.color }, far));
    const g = new THREE.Group(), o = new THREE.Object3D();
    o.userData.geo = bodies.get(key); o.userData.paint = 0xffffff;
    g.add(o);
    return g;
  };
  return { kit, near: group(0), far: group(1) };
}
